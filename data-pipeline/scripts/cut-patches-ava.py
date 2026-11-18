"""
cut-patches-ava.py — Region-scoped training patches with an ignore mask
========================================================================

Cuts OSIP tiles into training patches for regions whose vineyards have been
hand-digitised completely *inside the region outline* (an AVA, a county's
share of the valley, a test area).  Labels outside the outline are
incomplete, so every pixel outside it is written as IGNORE (255) and
contributes nothing to the loss or the metrics.  Holes in a region outline
(see build-valley-labels.py) are ignored the same way.

Differences from cut-patches.py (kept for reproducing the 0.773 model):
  * No train/val split at cut time.  Every patch is tagged with its region in
    manifest.json and the split happens at training time (--holdout-ava), so
    leave-one-out folds need no re-cutting.
  * No inward erosion by default — these labels were digitised on OSIP
    itself, so there is no basemap misalignment to strip.
  * Negatives are sampled per region from every tile inside the outline,
    including tiles with no vineyards (forest, orchards, grass seed).
  * --hard-neg: every non-overlapping window that holds a known false alarm
    (an outline the model drew that turned out not to be vineyard) is cut
    too, on top of the random negatives, tagged kind "false_alarm".
  * Images are stored as raw uint8 (4, P, P) RGBN — ~4x smaller than the
    float32 5-channel stack.  NDVI is computed in the dataloader.
  * One .npz per patch (image + mask), in one folder per tile.  exFAT (the
    T7) slows to a crawl creating files in a folder that already holds tens
    of thousands, so no folder is allowed to grow large.

Two ways to get the photos
--------------------------
  --tiles-dir DIR   the tiles are already on disk (the six-AVA cut).  Exact:
                    negatives are sampled to precisely --neg-ratio per region.
  --stream YEAR     the whole valley: plan from the OSIP tile grid alone, then
                    download a batch of tiles, cut it, delete the photos and
                    move on (--download-dir).  The plan is made from each
                    tile's nominal pixel grid, so negatives are sampled with
                    a per-region probability that hits --neg-ratio on
                    average.  Resumable: a tile whose patches/<tile>/_meta.json
                    exists is skipped.  --dry-run needs no downloads.
                    To use many CPUs: --plan-only once, then one process per
                    --shard K/N (each with its own --download-dir), then
                    --finish-only to write manifest.json + ava_stats.json.

Mask values
-----------
    0    not vineyard
    1    vineyard
    255  outside the region — ignored

Output
------
    <out>/patches/{tile}/{region}__{y}_{x}.npz
        img   (4, P, P) uint8  R, G, B, NIR
        mask  (P, P)    uint8  0 / 1 / 255
    <out>/patches/{tile}/_meta.json   that tile's manifest rows + channel sums
    <out>/manifest.json   one entry per patch: file (relative to <out>), ava, tile, y, x, kind,
                          vineyard_pct (of in-region pixels), inside_pct, ndvi_mean
                          (the region is stored under "ava", the name the trainer reads)
    <out>/ava_stats.json  per-region channel sums over in-region pixels, so the
                          trainer can build normalisation stats from the
                          training regions only

Usage
-----
    # six AVAs, photos on disk
    .venv/bin/python scripts/cut-patches-ava.py \\
        --tiles-dir data/osip-2022-gold6 \\
        --avas data/BlocksDB-2026-10-16/regions.geojson \\
        --label "Eola-Amity Hills=data/BlocksDB-2026-10-16/eola-amity-hills.gpkg" \\
        ... \\
        --out data/patches-gold6-db-2022 --dry-run

    # whole valley, downloading as it goes
    L=data/labels-valley-2022-2026-11-18
    .venv/bin/python scripts/cut-patches-ava.py --stream 2022 \\
        --avas $L/regions.geojson --label-all $L/blocks.gpkg --hard-neg $L/hard_negatives.gpkg \\
        --download-dir /tmp/osip --out data/patches-valley-2022 --dry-run
"""

import importlib.util
import json
import random
import shutil
import sys
import threading
import queue
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import click
import geopandas as gpd
import numpy as np
import rasterio
import rasterio.features
import requests
from rasterio.transform import from_bounds
from shapely.geometry import box, mapping
from tqdm import tqdm

IGNORE = 255
HERE = Path(__file__).resolve().parent


def ndvi(patch: np.ndarray) -> np.ndarray:
    r = patch[0].astype(np.float32)
    n = patch[3].astype(np.float32)
    return (n - r) / (n + r + 1e-6)


def burn(geoms, transform, shape, value, out=None):
    if out is None:
        out = np.zeros(shape, dtype=np.uint8)
    geoms = [mapping(g) for g in geoms if g is not None and not g.is_empty]
    if geoms:
        rasterio.features.rasterize(
            [(g, value) for g in geoms], out=out, transform=transform, dtype=np.uint8
        )
    return out


def region_key(name: str) -> str:
    return name.replace(" ", "_").replace(".", "")


class Labels:
    """Region outlines, their (clipped) vineyard blocks and the known false alarms."""

    def __init__(self, avas_file, labels, label_all, hard_neg, erosion_m, crs):
        avas = gpd.read_file(avas_file).to_crs(crs).set_index("name")
        specs = [s.split("=", 1) for s in labels]
        if label_all:
            specs += [(name, label_all) for name in avas.index if name not in dict(specs)]
        if not specs:
            sys.exit("Give --label per region or --label-all")
        cache = {}
        self.regions = {}
        for name, path in specs:
            if name not in avas.index:
                sys.exit(f"Region '{name}' not in {avas_file}")
            if path not in cache:
                g = gpd.read_file(path)
                g = g[g.geometry.notna()].to_crs(crs)
                geoms = g.geometry.buffer(0)
                if erosion_m:
                    geoms = geoms.buffer(-erosion_m)
                cache[path] = gpd.GeoSeries(geoms.values, crs=crs)
            geoms = cache[path]
            reg = avas.loc[name].geometry
            mine = geoms[geoms.intersects(reg)]
            self.regions[name] = (reg, gpd.GeoSeries([x.intersection(reg) for x in mine], crs=crs))
            click.echo(f"{name}: {len(mine)} blocks")
        self.hard = None
        if hard_neg:
            h = gpd.read_file(hard_neg).to_crs(crs)
            self.hard = gpd.GeoSeries(h.geometry.buffer(0).values, crs=crs)
            click.echo(f"False alarms: {len(self.hard)}")

    def touching(self, tb):
        return [n for n, (reg, _) in self.regions.items() if reg.intersects(tb)]

    def masks(self, name, tb, tf, shape):
        """inside (0/1), vineyard (0/1), false alarm (0/1) for one region on one tile."""
        reg, blocks = self.regions[name]
        inside = burn([reg.intersection(tb)], tf, shape, 1)
        vine = burn(blocks.iloc[blocks.sindex.query(tb, predicate="intersects")], tf, shape, 1)
        fa = None
        if self.hard is not None:
            fa = burn(self.hard.iloc[self.hard.sindex.query(tb, predicate="intersects")], tf, shape, 1)
        return inside, vine, fa


def classify(lab, tb, tf, shape, P, stride, min_inside, min_pos_pct, fa_min_pct):
    """→ {region: {"pos": [...], "neg": [...], "fa": [...]}}, each (y, x, vp, inside_frac)."""
    out = {}
    for name in lab.touching(tb):
        inside, vine, fa = lab.masks(name, tb, tf, shape)
        c = {"pos": [], "neg": [], "fa": []}
        for y in range(0, shape[0] - P + 1, stride):
            for x in range(0, shape[1] - P + 1, stride):
                ins = inside[y:y + P, x:x + P]
                n_in = int(ins.sum())
                if n_in < min_inside * P * P:
                    continue
                vp = float(vine[y:y + P, x:x + P][ins == 1].mean())
                rec = (y, x, vp, n_in / (P * P))
                if vp >= min_pos_pct:
                    c["pos"].append(rec)
                elif y % P == 0 and x % P == 0:   # non-overlapping negatives
                    if fa is not None and fa[y:y + P, x:x + P][ins == 1].mean() >= fa_min_pct:
                        c["fa"].append(rec)
                    else:
                        c["neg"].append(rec)
        out[name] = c
    return out


def write_tile(lab, out_dir, tname, img, tb, tf, items, hard_ndvi):
    """Write one tile's patches + _meta.json.  items: [(region, kind, (y, x, vp, inside))]."""
    shape = img.shape[1:]
    tile_dir = out_dir / "patches" / Path(tname).stem
    tile_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    sums = {}
    for name in sorted({i[0] for i in items}):   # sorted: set order varies between runs
        reg, blocks = lab.regions[name]
        mask = np.full(shape, IGNORE, dtype=np.uint8)
        burn([reg.intersection(tb)], tf, shape, 0, out=mask)
        burn(blocks.iloc[blocks.sindex.query(tb, predicate="intersects")], tf, shape, 1, out=mask)
        s = {"n": 0, "sum": np.zeros(5), "sumsq": np.zeros(5)}
        for _, kind, (y, x, vp, inside) in (i for i in items if i[0] == name):
            P = lab.P
            pi = img[:, y:y + P, x:x + P]
            pm = mask[y:y + P, x:x + P]
            nd = ndvi(pi)
            valid = pm != IGNORE
            if kind == "negative" and float(nd[valid].mean()) >= hard_ndvi:
                kind = "hard_negative"
            rel = f"patches/{Path(tname).stem}/{region_key(name)}__{y:05d}_{x:05d}.npz"
            np.savez(out_dir / rel, img=pi, mask=pm)
            ch = np.concatenate([pi.astype(np.float64) / 255.0, nd[None].astype(np.float64)])
            v = ch[:, valid]
            s["n"] += v.shape[1]
            s["sum"] += v.sum(1)
            s["sumsq"] += (v ** 2).sum(1)
            rows.append({"file": rel, "ava": name, "tile": tname, "y": y, "x": x,
                         "kind": kind, "vineyard_pct": round(vp, 4),
                         "inside_pct": round(inside, 4),
                         "ndvi_mean": round(float(nd[valid].mean()), 4)})
        sums[name] = {"n": s["n"], "sum": s["sum"].tolist(), "sumsq": s["sumsq"].tolist()}
    (tile_dir / "_meta.json").write_text(json.dumps({"rows": rows, "sums": sums}))
    return rows


def finish(out_dir, region_names):
    manifest = []
    sums = {a: {"n": 0, "sum": np.zeros(5), "sumsq": np.zeros(5)} for a in region_names}
    for meta in sorted((out_dir / "patches").glob("*/_meta.json")):
        m = json.loads(meta.read_text())
        manifest += m["rows"]
        for a, s in m["sums"].items():
            sums[a]["n"] += s["n"]
            sums[a]["sum"] += np.array(s["sum"])
            sums[a]["sumsq"] += np.array(s["sumsq"])
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (out_dir / "ava_stats.json").write_text(json.dumps({
        "channels": ["red", "green", "blue", "nir", "ndvi"],
        "avas": {a: {"n": s["n"], "sum": s["sum"].tolist(), "sumsq": s["sumsq"].tolist()}
                 for a, s in sums.items() if s["n"]},
    }, indent=1))
    kinds = defaultdict(int)
    for m in manifest:
        kinds[m["kind"]] += 1
    click.echo(f"\nWrote {len(manifest):,} patches → {out_dir}  " + dict(kinds).__repr__())


def thin_negative_tiles(lab, tiles, p_neg, keep, max_p, seed, tname):
    """Keep a fixed random share of the tiles that hold no block and no false alarm.

    Such tiles only supply random negatives, and where p_neg is small that is a
    handful of patches per 67 MB photo, so they are most of the download for
    little data.  A kept tile samples its negatives at p_neg / keep, which leaves
    the expected count unchanged.  Tiles on a region whose p_neg is above max_p
    are always kept.  → (tiles to cut, {tile: p_neg multiplier})
    """
    kept, boost = [], {}
    for t in tiles:
        tb = box(*t)
        names = lab.touching(tb)
        busy = any(len(lab.regions[n][1].sindex.query(tb, predicate="intersects")) for n in names)
        if lab.hard is not None:
            busy = busy or len(lab.hard.sindex.query(tb, predicate="intersects")) > 0
        if busy or keep >= 1 or max(p_neg[n] for n in names) > max_p:
            kept.append(t)
        elif random.Random(f"{seed}-thin-{tname(t)}").random() < keep:
            kept.append(t)
            boost[t] = 1.0 / keep
    return kept, boost


def report(counts, n_neg_by_region, P):
    click.echo("")
    total = 0
    for name, c in counts.items():
        n = c["pos"] + n_neg_by_region[name] + c["fa"]
        total += n
        click.echo(f"{name:32s} positive {c['pos']:7d}   negative {n_neg_by_region[name]:7d}"
                   f" (of {c['neg']})   false alarm {c['fa']:6d}")
    click.echo(f"\nTotal patches: {total:,}   est. disk {total * (4 * P * P + P * P) / 1e9:.1f} GB")


@click.command()
@click.option("--tiles-dir", type=click.Path(exists=True), default=None,
              help="Photos already on disk")
@click.option("--stream", "stream_year", type=int, default=None,
              help="Download this OSIP year tile by tile instead of --tiles-dir")
@click.option("--valley", default="../apps/wvwa/public/data/willamette_valley.geojson",
              show_default=True, type=click.Path(exists=True),
              help="--stream: the area whose OSIP tile grid is used (same grid as predict-valley.py)")
@click.option("--download-dir", type=click.Path(), default=None,
              help="--stream: where photos wait to be cut (deleted after)")
@click.option("--keep-photos", is_flag=True, help="--stream: don't delete photos after cutting")
@click.option("--batch", type=int, default=40, show_default=True, help="--stream: tiles per download batch")
@click.option("--dl-workers", type=int, default=8, show_default=True)
@click.option("--avas", "avas_file", type=click.Path(exists=True), required=True,
              help="GeoJSON of region outlines with a 'name' column")
@click.option("--label", "labels", multiple=True,
              help='"Region name=path/to/labels" — repeat once per region')
@click.option("--label-all", type=click.Path(exists=True), default=None,
              help="One label file for every region not given its own --label")
@click.option("--hard-neg", type=click.Path(exists=True), default=None,
              help="Known false-alarm polygons; every window holding one is cut")
@click.option("--fa-min-pct", type=float, default=0.05, show_default=True,
              help="Share of a window's in-region pixels that must be false alarm")
@click.option("--out", "out_dir", type=click.Path(), required=True)
@click.option("--patch-size", type=int, default=256, show_default=True)
@click.option("--stride", type=int, default=128, show_default=True,
              help="Stride for positive patches (negatives use patch-size)")
@click.option("--erosion-m", type=float, default=0.0, show_default=True)
@click.option("--min-inside", type=float, default=0.5, show_default=True,
              help="Minimum fraction of a patch inside the region")
@click.option("--min-pos-pct", type=float, default=0.05, show_default=True,
              help="Vineyard fraction of in-region pixels for a positive patch")
@click.option("--neg-ratio", type=float, default=1.5, show_default=True,
              help="Random negative patches per positive, per region (false alarms come on top)")
@click.option("--hard-ndvi", type=float, default=0.35, show_default=True,
              help="Negative patches with mean NDVI above this are tagged hard_negative")
@click.option("--seed", type=int, default=42, show_default=True)
@click.option("--dry-run", is_flag=True)
@click.option("--shard", default=None, help="--stream: cut only every Nth tile, e.g. 3/8 (0-based)")
@click.option("--plan-only", is_flag=True, help="--stream: write plan.json and stop")
@click.option("--finish-only", is_flag=True,
              help="--stream: only gather the tiles' _meta.json into manifest.json")
@click.option("--neg-tile-keep", type=float, default=1.0, show_default=True,
              help="--stream: share of tiles with no block or false alarm to download; each "
                   "kept one gives proportionally more negatives (only where p_neg <= 0.1)")
def main(tiles_dir, stream_year, valley, download_dir, keep_photos, batch, dl_workers, avas_file,
         labels, label_all, hard_neg, fa_min_pct, out_dir, patch_size, stride, erosion_m,
         min_inside, min_pos_pct, neg_ratio, hard_ndvi, seed, dry_run, shard, plan_only,
         finish_only, neg_tile_keep):
    if (tiles_dir is None) == (stream_year is None):
        sys.exit("Give exactly one of --tiles-dir or --stream YEAR")
    out_dir = Path(out_dir)
    P = patch_size
    args = (P, stride, min_inside, min_pos_pct, fa_min_pct)
    if tiles_dir:
        run_local(Path(tiles_dir), avas_file, labels, label_all, hard_neg, erosion_m, out_dir,
                  args, neg_ratio, hard_ndvi, seed, dry_run)
    elif finish_only:
        names = gpd.read_file(avas_file)["name"].tolist()
        finish(out_dir, names)
    else:
        if not (dry_run or plan_only) and not download_dir:
            sys.exit("--stream needs --download-dir")
        run_stream(stream_year, Path(valley), download_dir, keep_photos, batch, dl_workers,
                   avas_file, labels, label_all, hard_neg, erosion_m, out_dir, args, neg_ratio,
                   hard_ndvi, seed, dry_run, shard, plan_only, neg_tile_keep)


def run_local(tiles_dir, avas_file, labels, label_all, hard_neg, erosion_m, out_dir, args,
              neg_ratio, hard_ndvi, seed, dry_run):
    rng = random.Random(seed)
    P = args[0]
    tiles = sorted(p for p in tiles_dir.glob("*.tif") if not p.name.startswith("._"))
    with rasterio.open(tiles[0]) as src:
        crs = src.crs
    lab = Labels(avas_file, labels, label_all, hard_neg, erosion_m, crs)
    lab.P = P

    # ── Pass 1: classify every window from masks only ────────────────────────
    candidates = {a: {"pos": [], "neg": [], "fa": []} for a in lab.regions}
    for tile in tqdm(tiles, desc="scan"):
        with rasterio.open(tile) as src:
            tb, tf, shape = box(*src.bounds), src.transform, (src.height, src.width)
        for name, c in classify(lab, tb, tf, shape, *args).items():
            for k in c:
                candidates[name][k] += [(tile.name, *r) for r in c[k]]

    plan = []
    n_neg = {}
    for ava, c in candidates.items():
        n_neg[ava] = min(len(c["neg"]), int(len(c["pos"]) * neg_ratio))
        negs = rng.sample(c["neg"], n_neg[ava])
        plan += ([(ava, "positive", r) for r in c["pos"]] + [(ava, "negative", r) for r in negs]
                 + [(ava, "false_alarm", r) for r in c["fa"]])
    report({a: {k: len(v) for k, v in c.items()} for a, c in candidates.items()}, n_neg, P)
    if dry_run:
        click.echo("[DRY RUN] nothing written.")
        return

    # ── Pass 2: write patches, grouped by tile so each tile is opened once ───
    by_tile = defaultdict(list)
    for ava, kind, (tname, *rec) in plan:
        by_tile[tname].append((ava, kind, tuple(rec)))
    for tname, items in tqdm(sorted(by_tile.items()), desc="write"):
        with rasterio.open(tiles_dir / tname) as src:
            write_tile(lab, out_dir, tname, src.read(), box(*src.bounds), src.transform,
                       items, hard_ndvi)
    finish(out_dir, list(lab.regions))


def run_stream(year, valley, download_dir, keep_photos, batch, dl_workers, avas_file, labels,
               label_all, hard_neg, erosion_m, out_dir, args, neg_ratio, hard_ndvi, seed, dry_run,
               shard=None, plan_only=False, neg_tile_keep=1.0):
    spec = importlib.util.spec_from_file_location("download_osip", HERE / "download-osip.py")
    dl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dl)
    P = args[0]
    crs = f"EPSG:{dl.OUTPUT_CRS}"
    lab = Labels(avas_file, labels, label_all, hard_neg, erosion_m, crs)
    lab.P = P

    grid = dl.filter_to_intersecting(dl.make_tile_grid(*dl.utm_bbox_from_blocks(valley, 0)), valley)
    def nominal(t):
        w = max(1, round((t[2] - t[0]) / dl.RESOLUTION))
        h = max(1, round((t[3] - t[1]) / dl.RESOLUTION))
        return from_bounds(*t, w, h), (h, w)
    tiles = [t for t in grid if lab.touching(box(*t))]
    click.echo(f"OSIP grid: {len(grid):,} tiles, {len(tiles):,} touch a region")

    # ── Plan from the nominal pixel grid ─────────────────────────────────────
    plan_path = out_dir / "plan.json"
    if plan_path.exists():
        plan = json.loads(plan_path.read_text())
    elif shard:
        sys.exit(f"No {plan_path} — run --plan-only first so every shard samples the same way")
    else:
        counts = {a: {"pos": 0, "neg": 0, "fa": 0} for a in lab.regions}
        for t in tqdm(tiles, desc="plan"):
            tf, shape = nominal(t)
            for name, c in classify(lab, box(*t), tf, shape, *args).items():
                for k in c:
                    counts[name][k] += len(c[k])
        p_neg = {a: (min(1.0, c["pos"] * neg_ratio / c["neg"]) if c["neg"] else 0.0)
                 for a, c in counts.items()}
        plan = {"year": year, "counts": counts, "p_neg": p_neg, "seed": seed}
        if not dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            plan_path.write_text(json.dumps(plan, indent=1))
    report(plan["counts"], {a: round(c["neg"] * plan["p_neg"][a]) for a, c in plan["counts"].items()}, P)
    if dry_run:
        click.echo("[DRY RUN] nothing downloaded or written.")
        return
    if plan_only:
        click.echo(f"Plan → {plan_path}")
        return

    def tname(t):
        return f"osip{year}_{int(t[0])}_{int(t[1])}.tif"
    if shard:
        k, n = map(int, shard.split("/"))
        tiles = tiles[k::n]
        click.echo(f"Shard {k}/{n}: {len(tiles):,} tiles")
    # After sharding, so each shard keeps the tiles (and downloaded photos) it had
    n_all = len(tiles)
    tiles, boost = thin_negative_tiles(lab, tiles, plan["p_neg"], neg_tile_keep, 0.1, seed, tname)
    if boost:
        click.echo(f"Negative-only tiles thinned: {n_all:,} → {len(tiles):,} tiles "
                   f"({len(boost):,} kept negative-only tiles at {1 / neg_tile_keep:.0f}× p_neg)")
    todo = [t for t in tiles if not (out_dir / "patches" / Path(tname(t)).stem / "_meta.json").exists()]
    click.echo(f"{len(tiles) - len(todo):,} tiles already cut, {len(todo):,} to go")
    photo_dir = Path(download_dir)
    photo_dir.mkdir(parents=True, exist_ok=True)

    # Download the next batch while this one is cut; at most two batches on disk.
    q = queue.Queue(maxsize=1)
    def downloader():
        session = requests.Session()
        session.headers["User-Agent"] = "osip-downloader/1.0"
        try:
            for i in range(0, len(todo), batch):
                chunk, got = todo[i:i + batch], {}
                for _ in range(3):
                    left = [t for t in chunk if t not in got]
                    if not left:
                        break
                    with ThreadPoolExecutor(dl_workers) as pool:
                        res = pool.map(lambda t: dl.download_tile(t, year, photo_dir, session), left)
                    for t, (path, status, _) in zip(left, res):
                        if status in ("ok", "skip"):
                            got[t] = path
                q.put((chunk, got))
        except Exception as exc:
            click.echo(f"DOWNLOAD THREAD FAILED: {exc!r}")
        q.put(None)
    threading.Thread(target=downloader, daemon=True).start()

    failed = []
    bar = tqdm(total=len(todo), desc="cut")
    while (item := q.get()) is not None:
        chunk, got = item
        for t in chunk:
            bar.update(1)
            if t not in got:
                failed.append(tname(t))
                continue
            with rasterio.open(got[t]) as src:
                img, tb, tf = src.read(), box(*src.bounds), src.transform
            rng = random.Random(f"{seed}-{tname(t)}")
            items = []
            for name, c in classify(lab, tb, tf, img.shape[1:], *args).items():
                items += [(name, "positive", r) for r in c["pos"]]
                pn = min(1.0, plan["p_neg"][name] * boost.get(t, 1.0))
                items += [(name, "negative", r) for r in c["neg"] if rng.random() < pn]
                items += [(name, "false_alarm", r) for r in c["fa"]]
            write_tile(lab, out_dir, tname(t), img, tb, tf, items, hard_ndvi)
            if not keep_photos:
                Path(got[t]).unlink(missing_ok=True)
    bar.close()
    if failed:
        name = f"failed_tiles{'-' + shard.replace('/', 'of') if shard else ''}.txt"
        (out_dir / name).write_text("\n".join(failed))
        click.echo(f"{len(failed)} tiles failed to download — rerun to retry them")
    if not shard:
        finish(out_dir, list(lab.regions))


if __name__ == "__main__":
    main()
