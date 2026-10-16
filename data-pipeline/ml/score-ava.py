"""
score-ava.py — Score a model's predictions over one whole AVA
==============================================================

Grades predict.py output for one AVA against the hand-traced blocks, counting
only what lies inside the official AVA outline (outside it the tracing is
incomplete).  Run it on an AVA the model never trained on.

Three kinds of score
--------------------
  Pixels   — IoU, precision, recall of the raw thresholded probability map.
  Edges    — boundary F1 at 1 m and 3 m: the share of predicted edge pixels
             within that distance of a traced edge, and vice versa.
  Blocks   — after the production clean-up (fill holes, close, drop small
             blobs; same as vectorize-predictions.py):
               missed block      traced block less than --hit-frac covered
               false alarm       predicted shape less than --fa-frac on any
                                 traced block
             These two counts are the best guide to QGIS clean-up time.

Output
------
  Printed summary, and in --out-dir:
    score.json          every number above
    missed.geojson      traced blocks the model missed      (open in QGIS)
    false_alarms.geojson predicted shapes with no vineyard  (open in QGIS)
    predicted.geojson   all cleaned predicted shapes inside the AVA

Usage
-----
  .venv/bin/python ml/score-ava.py \\
      --pred-dir data/predictions/<run>/van_duzer \\
      --avas     data/training/gold6-avas.geojson --ava "Van Duzer Corridor" \\
      --labels   data/BlocksUpdated/Clipped_vanduzer.gpkg \\
      --out-dir  data/scores/<run>/van_duzer
"""

import argparse
import importlib.util
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
import rasterio.features
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from tqdm import tqdm

# Reuse the production clean-up so scores reflect what lands in QGIS
_spec = importlib.util.spec_from_file_location(
    "vectorize", Path(__file__).resolve().parent.parent / "scripts" / "vectorize-predictions.py")
vectorize = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vectorize)

EDGE_TOLERANCES_M = (1.0, 3.0)


def edges(mask: np.ndarray) -> np.ndarray:
    # border_value=1 so the tile's own border isn't counted as an edge
    return mask & ~ndimage.binary_erosion(mask, border_value=1)


_W = {}   # per-process state for score_tile, set by _init_worker


def _init_worker(ava, truth, threshold, min_area, closing):
    _W.update(ava=ava, truth=truth, sindex=gpd.GeoSeries(truth).sindex,
              threshold=threshold, min_area=min_area, closing=closing)


def score_tile(path):
    """Pixel and edge counts plus cleaned predicted shapes for one tile."""
    ava, truth = _W["ava"], _W["truth"]
    with rasterio.open(path) as src:
        raw, tf, shp = src.read(1), src.transform, (src.height, src.width)
        tb = box(*src.bounds)
    if not ava.intersects(tb):
        return None
    prob = raw / 255.0 if raw.dtype == np.uint8 else raw
    pred = prob >= _W["threshold"]

    inside = rasterio.features.rasterize([(mapping(ava.intersection(tb)), 1)],
                                         out_shape=shp, transform=tf, dtype=np.uint8).astype(bool)
    tile_truth = [truth[i] for i in _W["sindex"].query(tb, predicate="intersects")]
    true = np.zeros(shp, dtype=bool)
    if tile_truth:
        true = rasterio.features.rasterize([(mapping(t), 1) for t in tile_truth],
                                           out_shape=shp, transform=tf, dtype=np.uint8).astype(bool)

    # ── Pixels ──
    counts = {"tp": int((pred & true & inside).sum()),
              "fp": int((pred & ~true & inside).sum()),
              "fn": int((~pred & true & inside).sum())}

    # ── Edges ──
    px = abs(tf.a)
    pe, te = edges(pred) & inside, edges(true) & inside
    dist_to_true = ndimage.distance_transform_edt(~edges(true)) * px
    dist_to_pred = ndimage.distance_transform_edt(~edges(pred)) * px
    for d in EDGE_TOLERANCES_M:
        counts[(d, "pred_hit")] = int((dist_to_true[pe] <= d).sum())
        counts[(d, "pred_n")] = int(pe.sum())
        counts[(d, "true_hit")] = int((dist_to_pred[te] <= d).sum())
        counts[(d, "true_n")] = int(te.sum())

    # ── Shapes, using the production clean-up ──
    cleaned = vectorize.postprocess_mask(pred.astype(np.uint8), tf, _W["min_area"], _W["closing"])
    polys = [shape(geom) for geom, v in shapes(cleaned, transform=tf) if v == 1]
    return tb, counts, polys


def main():
    ap = argparse.ArgumentParser(description="Score predictions over one whole AVA")
    ap.add_argument("--pred-dir", required=True, help="predict.py output (*_prob.tif)")
    ap.add_argument("--avas", required=True)
    ap.add_argument("--ava", required=True)
    ap.add_argument("--labels", required=True, help="Hand-traced blocks for this AVA")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--min-area", type=float, default=1000.0, help="m², as in production")
    ap.add_argument("--closing", type=float, default=3.0, help="m, as in production")
    ap.add_argument("--hit-frac", type=float, default=0.5,
                    help="A traced block counts as found if this share of it is predicted")
    ap.add_argument("--fa-frac", type=float, default=0.2,
                    help="A predicted shape is a false alarm if less than this share is vineyard")
    ap.add_argument("--workers", type=int, default=min(16, os.cpu_count() or 1),
                    help="Tiles scored in parallel")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    probs = sorted(p for p in Path(args.pred_dir).glob("*_prob.tif") if not p.name.startswith("._"))
    if not probs:
        raise SystemExit(f"No *_prob.tif in {args.pred_dir}")

    with rasterio.open(probs[0]) as src:
        crs = src.crs
    ava = gpd.read_file(args.avas).to_crs(crs).set_index("name").loc[args.ava].geometry
    g = gpd.read_file(args.labels)
    g = g[g.geometry.notna()].to_crs(crs)
    truth = [b for b in (x.buffer(0).intersection(ava) for x in g.geometry) if b.area > 1]

    tp = fp = fn = 0
    edge = {d: {"pred_hit": 0, "pred_n": 0, "true_hit": 0, "true_n": 0} for d in EDGE_TOLERANCES_M}
    pred_polys = []
    tile_boxes = []

    init = (ava, truth, args.threshold, args.min_area, args.closing)
    with ProcessPoolExecutor(args.workers, initializer=_init_worker, initargs=init) as pool:
        for res in tqdm(pool.map(score_tile, probs), total=len(probs), desc="score", unit="tile"):
            if res is None:
                continue
            tb, c, polys = res
            tile_boxes.append(tb)
            tp, fp, fn = tp + c["tp"], fp + c["fp"], fn + c["fn"]
            for d in EDGE_TOLERANCES_M:
                for k in edge[d]:
                    edge[d][k] += c[(d, k)]
            pred_polys += polys

    # Block-level scores cover only the area that has predictions, so a
    # partial run (e.g. a quick test on a few tiles) isn't counted as misses
    scored = unary_union(tile_boxes).intersection(ava)
    truth = [b for b in (t.intersection(scored) for t in truth) if b.area > 1]

    # Tiles cut shapes at their borders; merge across tiles, then clip to the AVA
    merged = unary_union(pred_polys).intersection(ava) if pred_polys else box(0, 0, 0, 0)
    preds = [p for p in getattr(merged, "geoms", [merged]) if p.area >= args.min_area]
    preds = [vectorize.drop_holes(p) for p in preds]
    pred_union = unary_union(preds) if preds else box(0, 0, 0, 0)
    truth_union = unary_union(truth)

    missed = [t for t in truth if t.intersection(pred_union).area < args.hit_frac * t.area]
    false_alarms = [p for p in preds if p.intersection(truth_union).area < args.fa_frac * p.area]

    def f1(p, r):
        return 2 * p * r / (p + r) if p + r else 0.0

    pix_p = tp / (tp + fp) if tp + fp else 0.0
    pix_r = tp / (tp + fn) if tp + fn else 0.0
    result = {
        "ava": args.ava,
        "pred_dir": str(args.pred_dir),
        "threshold": args.threshold,
        "ava_coverage": round(scored.area / ava.area, 4),
        "pixels": {"iou": round(tp / (tp + fp + fn), 4) if tp + fp + fn else 0.0,
                   "precision": round(pix_p, 4), "recall": round(pix_r, 4),
                   "f1": round(f1(pix_p, pix_r), 4)},
        "edges": {},
        "blocks": {
            "traced": len(truth),
            "missed": len(missed),
            "missed_ha": round(sum(t.area for t in missed) / 1e4, 2),
            "predicted_shapes": len(preds),
            "false_alarms": len(false_alarms),
            "false_alarm_ha": round(sum(p.area for p in false_alarms) / 1e4, 2),
            "traced_ha": round(truth_union.area / 1e4, 2),
            "predicted_ha": round(pred_union.area / 1e4, 2),
        },
        "settings": {"min_area_m2": args.min_area, "closing_m": args.closing,
                     "hit_frac": args.hit_frac, "fa_frac": args.fa_frac},
    }
    for d, e in edge.items():
        p = e["pred_hit"] / e["pred_n"] if e["pred_n"] else 0.0
        r = e["true_hit"] / e["true_n"] if e["true_n"] else 0.0
        result["edges"][f"{d:g}m"] = {"precision": round(p, 4), "recall": round(r, 4),
                                      "f1": round(f1(p, r), 4)}

    (out_dir / "score.json").write_text(json.dumps(result, indent=2))
    for name, geoms in [("missed", missed), ("false_alarms", false_alarms), ("predicted", preds)]:
        gdf = gpd.GeoDataFrame({"area_m2": [round(x.area, 1) for x in geoms]},
                               geometry=list(geoms), crs=crs).to_crs(4326)
        gdf.to_file(out_dir / f"{name}.geojson", driver="GeoJSON")

    px, b = result["pixels"], result["blocks"]
    print(f"\n{args.ava}   (AVA covered by predictions: {result['ava_coverage']:.1%})")
    print(f"  Pixels   IoU {px['iou']:.3f}   precision {px['precision']:.3f}   recall {px['recall']:.3f}")
    for k, e in result["edges"].items():
        print(f"  Edges    within {k:>3}: F1 {e['f1']:.3f}   (precision {e['precision']:.3f}, recall {e['recall']:.3f})")
    print(f"  Blocks   missed {b['missed']} of {b['traced']} ({b['missed_ha']} ha)")
    print(f"           false alarms {b['false_alarms']} of {b['predicted_shapes']} shapes ({b['false_alarm_ha']} ha)")
    print(f"  Area     traced {b['traced_ha']} ha   predicted {b['predicted_ha']} ha")
    print(f"\n  → {out_dir}")
    if result["ava_coverage"] < 0.999:
        print("  WARNING: predictions don't cover the whole AVA — scores are partial")


if __name__ == "__main__":
    main()
