"""
cut-patches-ava.py — AVA-scoped training patches with an ignore mask
=====================================================================

Cuts OSIP tiles into training patches for AVAs whose vineyards have been
hand-digitised completely *inside the official AVA outline*.  Labels outside
the outline are incomplete, so every pixel outside the AVA is written as
IGNORE (255) and contributes nothing to the loss or the metrics.

Differences from cut-patches.py (kept for reproducing the 0.773 model):
  * No train/val split at cut time.  Every patch is tagged with its AVA in
    manifest.json and the split happens at training time (--val-ava), so
    leave-one-AVA-out folds need no re-cutting.
  * No inward erosion by default — these labels were digitised on OSIP
    itself, so there is no basemap misalignment to strip.
  * Negatives are sampled per AVA from every tile inside the outline,
    including tiles with no vineyards (forest, orchards, grass seed).
  * Images are stored as raw uint8 (4, P, P) RGBN — ~4x smaller than the
    float32 5-channel stack.  NDVI is computed in the dataloader.
  * One .npz per patch (image + mask), in one folder per tile.  exFAT (the
    T7) slows to a crawl creating files in a folder that already holds tens
    of thousands, so no folder is allowed to grow large.

Mask values
-----------
    0    not vineyard
    1    vineyard
    255  outside the AVA — ignored

Output
------
    <out>/patches/{tile}/{ava}__{y}_{x}.npz
        img   (4, P, P) uint8  R, G, B, NIR
        mask  (P, P)    uint8  0 / 1 / 255
    <out>/manifest.json   one entry per patch: file (relative to <out>), ava, tile, y, x, kind,
                          vineyard_pct (of in-AVA pixels), inside_pct, ndvi_mean
    <out>/ava_stats.json  per-AVA channel sums over in-AVA pixels, so the
                          trainer can build normalisation stats from the
                          training AVAs only

Usage
-----
    .venv/bin/python scripts/cut-patches-ava.py \\
        --tiles-dir data/osip-2022-gold6 \\
        --avas data/training/gold6-avas.geojson \\
        --label "Eola-Amity Hills=data/BlocksUpdated/Edited_Eola.gpkg" \\
        --label "McMinnville=data/BlocksUpdated/Edited_Mac.gpkg" \\
        ... \\
        --out data/patches-gold6-2022 --dry-run
"""

import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import click
import geopandas as gpd
import numpy as np
import rasterio
import rasterio.features
from shapely.geometry import box, mapping
from tqdm import tqdm

IGNORE = 255


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


@click.command()
@click.option("--tiles-dir", type=click.Path(exists=True), required=True)
@click.option("--avas", "avas_file", type=click.Path(exists=True), required=True,
              help="GeoJSON of AVA outlines with a 'name' column")
@click.option("--label", "labels", multiple=True, required=True,
              help='"AVA name=path/to/labels" — repeat once per AVA')
@click.option("--out", "out_dir", type=click.Path(), required=True)
@click.option("--patch-size", type=int, default=256, show_default=True)
@click.option("--stride", type=int, default=128, show_default=True,
              help="Stride for positive patches (negatives use patch-size)")
@click.option("--erosion-m", type=float, default=0.0, show_default=True)
@click.option("--min-inside", type=float, default=0.5, show_default=True,
              help="Minimum fraction of a patch inside the AVA")
@click.option("--min-pos-pct", type=float, default=0.05, show_default=True,
              help="Vineyard fraction of in-AVA pixels for a positive patch")
@click.option("--neg-ratio", type=float, default=1.5, show_default=True,
              help="Negative patches per positive, per AVA")
@click.option("--hard-ndvi", type=float, default=0.35, show_default=True,
              help="Negative patches with mean NDVI above this are tagged hard_negative")
@click.option("--seed", type=int, default=42, show_default=True)
@click.option("--dry-run", is_flag=True)
def main(tiles_dir, avas_file, labels, out_dir, patch_size, stride, erosion_m,
         min_inside, min_pos_pct, neg_ratio, hard_ndvi, seed, dry_run):
    rng = random.Random(seed)
    out_dir = Path(out_dir)
    P = patch_size

    tiles = sorted(p for p in Path(tiles_dir).glob("*.tif") if not p.name.startswith("._"))
    with rasterio.open(tiles[0]) as src:
        crs = src.crs
    avas = gpd.read_file(avas_file).to_crs(crs).set_index("name")

    label_map = {}
    for spec in labels:
        name, path = spec.split("=", 1)
        if name not in avas.index:
            sys.exit(f"AVA '{name}' not in {avas_file}")
        g = gpd.read_file(path)
        g = g[g.geometry.notna()].to_crs(crs)
        geoms = g.geometry.buffer(0)
        if erosion_m:
            geoms = geoms.buffer(-erosion_m)
        ava_geom = avas.loc[name].geometry
        label_map[name] = (ava_geom, [x.intersection(ava_geom) for x in geoms])
        click.echo(f"{name}: {len(g)} blocks")

    # ── Pass 1: classify every window from masks only ────────────────────────
    # candidates[ava] = {"pos": [...], "neg": [...]}, each (tile, y, x, vp, inside)
    candidates = {a: {"pos": [], "neg": []} for a in label_map}
    for tile in tqdm(tiles, desc="scan"):
        with rasterio.open(tile) as src:
            tb, tf, shape = box(*src.bounds), src.transform, (src.height, src.width)
        for ava, (ava_geom, blocks) in label_map.items():
            if not ava_geom.intersects(tb):
                continue
            inside = burn([ava_geom.intersection(tb)], tf, shape, 1)
            vine = burn([b for b in blocks if b.intersects(tb)], tf, shape, 1)
            for y in range(0, shape[0] - P + 1, stride):
                for x in range(0, shape[1] - P + 1, stride):
                    ins = inside[y:y + P, x:x + P]
                    n_in = int(ins.sum())
                    if n_in < min_inside * P * P:
                        continue
                    vp = float(vine[y:y + P, x:x + P][ins == 1].mean())
                    rec = (tile.name, y, x, vp, n_in / (P * P))
                    if vp >= min_pos_pct:
                        candidates[ava]["pos"].append(rec)
                    elif y % P == 0 and x % P == 0:   # non-overlapping negatives
                        candidates[ava]["neg"].append(rec)

    plan = []
    click.echo("")
    for ava, c in candidates.items():
        n_neg = min(len(c["neg"]), int(len(c["pos"]) * neg_ratio))
        negs = rng.sample(c["neg"], n_neg)
        plan += [(ava, "positive", r) for r in c["pos"]] + [(ava, "negative", r) for r in negs]
        click.echo(f"{ava:32s} positive {len(c['pos']):6d}   negative {n_neg:6d}"
                   f"   (of {len(c['neg'])} available)")
    est_gb = len(plan) * (4 * P * P + P * P) / 1e9
    click.echo(f"\nTotal patches: {len(plan):,}   est. disk {est_gb:.1f} GB")
    if dry_run:
        click.echo("[DRY RUN] nothing written.")
        return

    # ── Pass 2: write patches, grouped by tile so each tile is opened once ───
    by_tile = defaultdict(list)
    for item in plan:
        by_tile[item[2][0]].append(item)

    manifest = []
    sums = {a: {"n": 0, "sum": np.zeros(5), "sumsq": np.zeros(5)} for a in label_map}
    for tname, items in tqdm(sorted(by_tile.items()), desc="write"):
        with rasterio.open(Path(tiles_dir) / tname) as src:
            tb, tf, shape = box(*src.bounds), src.transform, (src.height, src.width)
            img = src.read()
        tile_dir = out_dir / "patches" / Path(tname).stem
        tile_dir.mkdir(parents=True, exist_ok=True)
        for ava in sorted({i[0] for i in items}):   # sorted: set order varies between runs
            ava_geom, blocks = label_map[ava]
            mask = np.full(shape, IGNORE, dtype=np.uint8)
            burn([ava_geom.intersection(tb)], tf, shape, 0, out=mask)
            burn([b for b in blocks if b.intersects(tb)], tf, shape, 1, out=mask)
            for _, kind, (_, y, x, vp, inside) in (i for i in items if i[0] == ava):
                pi = img[:, y:y + P, x:x + P]
                pm = mask[y:y + P, x:x + P]
                nd = ndvi(pi)
                valid = pm != IGNORE
                if kind == "negative" and float(nd[valid].mean()) >= hard_ndvi:
                    kind = "hard_negative"
                rel = f"patches/{Path(tname).stem}/{ava.replace(' ', '_').replace('.', '')}__{y:05d}_{x:05d}.npz"
                np.savez(out_dir / rel, img=pi, mask=pm)
                ch = np.concatenate([pi.astype(np.float64) / 255.0, nd[None].astype(np.float64)])
                v = ch[:, valid]
                s = sums[ava]
                s["n"] += v.shape[1]
                s["sum"] += v.sum(1)
                s["sumsq"] += (v ** 2).sum(1)
                manifest.append({"file": rel, "ava": ava, "tile": tname, "y": y, "x": x,
                                 "kind": kind, "vineyard_pct": round(vp, 4),
                                 "inside_pct": round(inside, 4),
                                 "ndvi_mean": round(float(nd[valid].mean()), 4)})

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    (out_dir / "ava_stats.json").write_text(json.dumps({
        "channels": ["red", "green", "blue", "nir", "ndvi"],
        "avas": {a: {"n": s["n"], "sum": s["sum"].tolist(), "sumsq": s["sumsq"].tolist()}
                 for a, s in sums.items()},
    }, indent=1))
    click.echo(f"\nWrote {len(manifest):,} patches → {out_dir}")


if __name__ == "__main__":
    main()
