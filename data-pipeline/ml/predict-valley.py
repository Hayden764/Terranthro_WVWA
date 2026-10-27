"""
predict-valley.py — Run the vineyard model over the whole Willamette Valley, in batches
======================================================================================

The valley is ~8,300 OSIP tiles (~520 GB of photos), more than an instance's
disk holds, so photos never pile up:

  download thread   fetches the next batch of tiles while the GPU works
  GPU               predicts each tile, saves its probability map (uint8),
                    deletes the photo
  CPU pool          cleans each probability map up the production way (fill
                    holes, 3 m closing) and turns it into polygons

At most three batches of photos are on disk at once (one being predicted, one
queued, one downloading).  Progress is kept per tile: done/<batch>.json lists
the tiles finished, so re-running the same command after a crash or a stop
carries on with the rest, and tiles whose download failed are retried.

When every tile is done the polygons are merged into one layer.  Shapes cut
by a tile edge are joined to their other half first, and only then held to
the minimum area, so a vineyard straddling an edge is neither split nor
dropped.

Output (under --out)
  probs/<tile>_prob.tif         probability map, uint8 0-255
  shapes/<batch>.gpkg           per-batch polygons (before the cross-tile merge)
  done/<batch>.json             tiles finished / failed
  valley-vineyards-<year>.gpkg  the merged result (EPSG:32610)
With --sync-to DIR, shapes/, done/ and the merged layer are copied there as
they are written (the probability maps stay on the instance).

Usage (from data-pipeline/)
-----
  python3 ml/predict-valley.py --ckpt <best.ckpt> --stats <stats.json>        # the full run
  python3 ml/predict-valley.py ... --only 474953_4988013,476201_4988013       # a few tiles
  python3 ml/predict-valley.py ... --merge-only                               # rebuild the layer
"""

import argparse
import importlib.util
import json
import queue
import shutil
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import requests
from rasterio.features import shapes
from shapely import wkb
from shapely.geometry import box, shape
from shapely.ops import unary_union

ML = Path(__file__).resolve().parent
ROOT = ML.parent
sys.path.insert(0, str(ML))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


vectorize = load("vectorize", ROOT / "scripts" / "vectorize-predictions.py")
dl = load("download_osip", ROOT / "scripts" / "download-osip.py")

THRESHOLD = 128        # uint8 probability >= 0.5
EDGE_M = 0.5           # a shape this close to its tile's edge may continue next door


# ── Polygons from one probability map (CPU pool) ──────────────────────────────

def tile_shapes(prob_path, min_area, closing):
    """Production clean-up of one tile → [(wkb, touches_edge)]."""
    with rasterio.open(prob_path) as src:
        pred = (src.read(1) >= THRESHOLD).astype(np.uint8)
        tf, tb = src.transform, box(*src.bounds)
    # The closing treats beyond-the-edge as empty and would shave ~3 m off
    # every shape at the tile edge, so the two halves of a vineyard never meet.
    # Extend the map past its edges first, clean up, then trim back.
    pad = max(1, round(closing / abs(tf.a))) + 2
    padded = np.pad(pred, pad, mode="edge")
    # min_area 0 here: a small piece at the edge may be half of a big vineyard
    cleaned = vectorize.postprocess_mask(padded, tf, 0, closing)[pad:-pad, pad:-pad]
    inner = tb.buffer(-EDGE_M)
    out = []
    for geom, v in shapes(cleaned, transform=tf):
        if v != 1:
            continue
        p = shape(geom)
        edge = not inner.contains(p)
        if edge or p.area >= min_area:
            out.append((wkb.dumps(p), edge))
    return out


# ── Download thread ───────────────────────────────────────────────────────────

def download_batch(tiles, photo_dir, year, workers):
    """Download a batch, retrying failures twice → (ok paths by tile id, failed ids)."""
    photo_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "osip-downloader/1.0"
    todo, got = dict(tiles), {}
    for _ in range(3):
        with ThreadPoolExecutor(workers) as pool:
            res = dict(zip(todo, pool.map(
                lambda t: dl.download_tile(t, year, photo_dir, session), todo.values())))
        for tid, (path, status, _) in res.items():
            if status in ("ok", "skip"):
                got[tid] = path
        todo = {k: v for k, v in todo.items() if k not in got}
        if not todo:
            break
    return got, sorted(todo)


def downloader(batches, q, args, out):
    try:
        for name, tiles in batches:
            t0 = time.time()
            got, failed = download_batch(tiles, out / "photos" / name, args.year, args.dl_workers)
            print(f"[{time.strftime('%H:%M:%S')}] {name}: downloaded {len(got)}/{len(tiles)} "
                  f"in {(time.time() - t0) / 60:.0f} min", flush=True)
            q.put((name, got, failed))
    except Exception as exc:   # don't leave the GPU loop waiting forever
        print(f"DOWNLOAD THREAD FAILED: {exc!r}", flush=True)
    q.put(None)


# ── Merge ─────────────────────────────────────────────────────────────────────

def merge(out, year, min_area, simplify, valley, sync_to):
    parts = [gpd.read_file(p) for p in sorted((out / "shapes").glob("*.gpkg"))]
    parts = [p for p in parts if len(p)]
    if not parts:
        print("No shapes to merge.")
        return
    g = gpd.GeoDataFrame(pd_concat(parts), crs=parts[0].crs)
    g["edge"] = g.edge.astype(bool)   # GeoPackage stores booleans as integers
    inner = list(g.geometry[~g.edge])
    # Join the halves of shapes cut by tile edges (they share the pixel grid,
    # so a hair of buffer makes touching halves overlap)
    edge = unary_union([p.buffer(0.01) for p in g.geometry[g.edge]]).buffer(-0.01)
    polys = inner + list(getattr(edge, "geoms", [edge]))
    polys = [vectorize.drop_holes(p) for p in polys if not p.is_empty]
    if simplify > 0:
        polys = [p.simplify(simplify, preserve_topology=True) for p in polys]
    polys = [p for p in polys if not p.is_empty and p.area >= min_area]

    res = gpd.GeoDataFrame({"area_ha": [round(p.area / 1e4, 3) for p in polys]},
                           geometry=polys, crs=g.crs)
    ava = gpd.read_file(valley).to_crs(res.crs).geometry.union_all()
    res["in_ava"] = res.geometry.intersects(ava)
    path = out / f"valley-vineyards-{year}.gpkg"
    res.to_file(path, driver="GPKG")
    print(f"Merged: {len(res):,} shapes, {res.area_ha.sum():,.0f} ha "
          f"({int(res.in_ava.sum()):,} inside the AVA) → {path}")
    if sync_to:
        shutil.copy2(path, Path(sync_to) / path.name)


def pd_concat(frames):
    import pandas as pd
    return pd.concat(frames, ignore_index=True)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Predict vineyards across the Willamette Valley")
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--stats", required=True)
    ap.add_argument("--tiles", default="data/valley/valley-tiles.geojson",
                    help="scripts/valley-tiles.py output; only keep=true tiles are run")
    ap.add_argument("--valley", default="data/valley/willamette_valley.geojson")
    ap.add_argument("--year", type=int, default=2022)
    ap.add_argument("--out", default=None, help="[default: data/valley-<year>]")
    ap.add_argument("--batch", type=int, default=300, help="Tiles per batch (~20 GB of photos)")
    ap.add_argument("--dl-workers", type=int, default=8)
    ap.add_argument("--vec-workers", type=int, default=12)
    ap.add_argument("--gpu-batch", type=int, default=64)
    ap.add_argument("--min-area", type=float, default=1000.0, help="m², as in production")
    ap.add_argument("--closing", type=float, default=3.0, help="m, as in production")
    ap.add_argument("--simplify", type=float, default=1.0, help="m")
    ap.add_argument("--only", default=None, help="Comma-separated tile ids (testing)")
    ap.add_argument("--sync-to", default=None)
    ap.add_argument("--merge-only", action="store_true")
    args = ap.parse_args()

    out = ROOT / (args.out or f"data/valley-{args.year}")
    for d in ("probs", "shapes", "done", "photos"):
        (out / d).mkdir(parents=True, exist_ok=True)
    if args.sync_to:
        for d in ("shapes", "done"):
            (Path(args.sync_to) / d).mkdir(parents=True, exist_ok=True)

    if args.merge_only:
        merge(out, args.year, args.min_area, args.simplify, args.valley, args.sync_to)
        return

    grid = gpd.read_file(args.tiles)
    grid = grid[grid.keep] if not args.only else grid[grid.tile.isin(args.only.split(","))]
    finished = set()
    for m in (out / "done").glob("*.json"):
        finished |= set(json.loads(m.read_text())["tiles_ok"])
    todo = [(r.tile, tuple(r.geometry.bounds)) for r in grid.itertuples() if r.tile not in finished]
    todo.sort()
    batches = [(f"b{todo[i][0]}", todo[i:i + args.batch]) for i in range(0, len(todo), args.batch)]
    print(f"Tiles: {len(grid):,} selected, {len(grid) - len(todo):,} done, {len(todo):,} to run "
          f"in {len(batches)} batches of up to {args.batch}", flush=True)
    if not batches:
        merge(out, args.year, args.min_area, args.simplify, args.valley, args.sync_to)
        return

    predict = load("predict", ML / "predict.py")
    import torch
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    stats = predict.load_stats(Path(args.stats))
    model = predict.VineyardSegModel.load_from_checkpoint(args.ckpt).to(device).eval()
    print(f"Model: {Path(args.ckpt).name} on {device}", flush=True)

    q = queue.Queue(maxsize=1)
    threading.Thread(target=downloader, args=(batches, q, args, out), daemon=True).start()
    pool = ProcessPoolExecutor(args.vec_workers)
    pending = None   # the previous batch, whose polygons are still being made

    def finish(name, futures, failed):
        rows = []
        for tid, fut in futures.items():
            rows += [{"tile": tid, "edge": e, "geometry": wkb.loads(b)} for b, e in fut.result()]
        g = gpd.GeoDataFrame(rows, geometry="geometry", crs=32610) if rows else \
            gpd.GeoDataFrame({"tile": [], "edge": []}, geometry=[], crs=32610)
        g.to_file(out / "shapes" / f"{name}.gpkg", driver="GPKG")
        (out / "done" / f"{name}.json").write_text(json.dumps(
            {"tiles_ok": sorted(futures), "failed": failed, "shapes": len(g)}))
        if args.sync_to:
            for sub, fn in (("shapes", f"{name}.gpkg"), ("done", f"{name}.json")):
                shutil.copy2(out / sub / fn, Path(args.sync_to) / sub / fn)
        print(f"[{time.strftime('%H:%M:%S')}] {name}: {len(futures)} tiles done, "
              f"{len(g):,} shapes, {len(failed)} failed downloads", flush=True)

    n_done = 0
    while (item := q.get()) is not None:
        name, got, failed = item
        t0 = time.time()
        futures = {}
        for tid, photo in sorted(got.items()):
            try:
                img, profile = predict.tile_to_tensor(photo, stats)
                prob = predict.sliding_window_predict(model, img, device, batch_size=args.gpu_batch)
                prob_path = out / "probs" / f"{tid}_prob.tif"
                predict.save_geotiff(np.round(prob * 255), profile, prob_path, dtype="uint8")
                futures[tid] = pool.submit(tile_shapes, prob_path, args.min_area, args.closing)
            except Exception as exc:
                print(f"  ERROR {tid}: {exc}", flush=True)
                failed.append(tid)
            Path(photo).unlink(missing_ok=True)
        shutil.rmtree(out / "photos" / name, ignore_errors=True)
        n_done += len(futures)
        print(f"[{time.strftime('%H:%M:%S')}] {name}: predicted {len(futures)} tiles in "
              f"{(time.time() - t0) / 60:.0f} min  ({n_done:,}/{len(todo):,} this run)", flush=True)
        if pending:
            finish(*pending)
        pending = (name, futures, failed)
    if pending:
        finish(*pending)
    pool.shutdown()

    merge(out, args.year, args.min_area, args.simplify, args.valley, args.sync_to)


if __name__ == "__main__":
    main()
