"""
sam-segment.py — SAM-based vineyard boundary extraction
========================================================

Two modes:

  refine  (recommended)
    Loads a U-Net probability map, extracts bounding boxes of high-confidence
    regions, then feeds each box to SAM as a prompt.  SAM snaps to real image
    edges, giving cleaner polygon boundaries than the U-Net alone.

  auto
    Runs SAM's automatic mask generator on the raw image without any U-Net
    guidance.  Much slower and noisier; use 'refine' unless you have no prob map.

Cloud GPU (Modal — strongly recommended, ~100x faster than local CPU):
  pip install modal
  modal run ml/sam-segment.py::modal_refine -- \\
      --image    data/osip/or/2022/tile.tif \\
      --prob-map data/predictions/2022/tile_prob.tif \\
      --ckpt     /Volumes/T7/Terranthro/QGIS_Plugin/sam_vit_l_0b3195.pth \\
      --out-dir  data/sam-output/

  On first run, Modal uploads the checkpoint to a persistent Volume (~30s).
  Subsequent runs skip the upload.  GPU time is billed per second (~$0.001/tile).

Local CPU (slow — expect a few minutes per tile):
  .venv/bin/python ml/sam-segment.py refine \\
      --image    data/osip/or/2022/tile.tif \\
      --prob-map data/predictions/2022/tile_prob.tif \\
      --ckpt     /Volumes/T7/Terranthro/QGIS_Plugin/sam_vit_l_0b3195.pth \\
      --out-dir  data/sam-output/

Install (one-time):
  .venv/bin/pip install segment-anything

Output:
  {out_dir}/{stem}_sam_polygons.geojson   — polygons, same CRS as input tile
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import shapes as rio_shapes
import torch
from scipy import ndimage


# ---------------------------------------------------------------------------
# Raster helpers
# ---------------------------------------------------------------------------

def load_rgb_crop(src: rasterio.DatasetReader,
                  window: rasterio.windows.Window,
                  bands=(1, 2, 4)) -> np.ndarray:
    """
    Read a (window) crop from an open rasterio dataset and return uint8 RGB.
    SAM expects (H, W, 3) uint8 with pixel values in [0, 255].
    Uses 2–98 percentile stretch per band so dark/bright scenes look reasonable.
    """
    data = src.read(list(bands), window=window)   # (3, H, W) uint16 or uint8
    rgb  = np.moveaxis(data.astype(np.float32), 0, -1)   # (H, W, 3)
    for i in range(3):
        lo, hi = np.percentile(rgb[:, :, i], 2), np.percentile(rgb[:, :, i], 98)
        rgb[:, :, i] = np.clip((rgb[:, :, i] - lo) / max(hi - lo, 1) * 255, 0, 255)
    return rgb.astype(np.uint8)


def load_prob_map(prob_path: Path) -> tuple[np.ndarray, rasterio.Affine, object]:
    with rasterio.open(prob_path) as src:
        return src.read(1), src.transform, src.crs


# ---------------------------------------------------------------------------
# Region extraction from U-Net prob map
# ---------------------------------------------------------------------------

def extract_boxes(prob: np.ndarray,
                  threshold: float,
                  min_area_px: int,
                  pad_px: int) -> list[dict]:
    """
    Threshold the prob map, label connected components, and return pixel bboxes.
    Each dict has keys: y1, x1, y2, x2, area_px.
    """
    binary, _ = ndimage.label((prob >= threshold).astype(np.uint8))
    boxes = []
    H, W = prob.shape
    for i in range(1, binary.max() + 1):
        ys, xs = np.where(binary == i)
        if len(ys) < min_area_px:
            continue
        boxes.append({
            "y1": max(0, int(ys.min()) - pad_px),
            "x1": max(0, int(xs.min()) - pad_px),
            "y2": min(H - 1, int(ys.max()) + pad_px),
            "x2": min(W - 1, int(xs.max()) + pad_px),
            "area_px": len(ys),
        })
    return boxes


# ---------------------------------------------------------------------------
# SAM inference
# ---------------------------------------------------------------------------

def predict_box(predictor, rgb_crop: np.ndarray,
                box_in_crop: np.ndarray) -> tuple[np.ndarray, float]:
    """
    Run SAM on a single RGB crop with a bounding-box prompt.
    Returns (best_mask H×W bool, stability_score).
    """
    predictor.set_image(rgb_crop)
    masks, scores, _ = predictor.predict(
        box=box_in_crop,
        multimask_output=True,
    )
    best = int(np.argmax(scores))
    return masks[best], float(scores[best])


# ---------------------------------------------------------------------------
# Vectorisation
# ---------------------------------------------------------------------------

def mask_to_features(mask: np.ndarray,
                     crop_transform: rasterio.Affine,
                     score: float) -> list[dict]:
    """Convert a boolean mask to GeoJSON feature dicts using the crop transform."""
    features = []
    for geom, val in rio_shapes(mask.astype(np.uint8), transform=crop_transform):
        if val == 1:
            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"sam_score": round(score, 4)},
            })
    return features


def write_geojson(features: list[dict], crs, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": str(crs)}},
            "features": features,
        }, f, indent=2)


# ---------------------------------------------------------------------------
# Core logic (runs locally or inside Modal)
# ---------------------------------------------------------------------------

def run_refine(image_path: Path,
               prob_path: Path,
               ckpt_path: Path,
               out_dir: Path,
               threshold: float,
               model_type: str,
               min_area_m2: float,
               device: torch.device):
    from segment_anything import sam_model_registry, SamPredictor

    prob, prob_transform, crs = load_prob_map(prob_path)

    # Pixel area → m² (assumes square pixels in a projected CRS)
    px_size = abs(prob_transform.a)
    min_area_px = max(10, int(min_area_m2 / (px_size ** 2)))
    pad_px = max(32, int(20 / px_size))   # 20 m contextual buffer

    boxes = extract_boxes(prob, threshold, min_area_px, pad_px)
    print(f"U-Net found {len(boxes)} candidate regions "
          f"(threshold={threshold}, min={min_area_m2}m², pad={pad_px}px)")

    if not boxes:
        print("No regions found — try lowering --threshold")
        return

    print(f"Loading SAM {model_type} on {device}…")
    sam = sam_model_registry[model_type](checkpoint=str(ckpt_path))
    sam.to(device)
    predictor = SamPredictor(sam)

    all_features = []
    with rasterio.open(image_path) as src:
        for i, b in enumerate(boxes, 1):
            y1, x1, y2, x2 = b["y1"], b["x1"], b["y2"], b["x2"]
            window = rasterio.windows.Window(
                col_off=x1, row_off=y1,
                width=x2 - x1, height=y2 - y1
            )
            crop_rgb    = load_rgb_crop(src, window)
            crop_transform = rasterio.windows.transform(window, prob_transform)

            # Box in crop-local pixel coords (SAM expects [x1, y1, x2, y2])
            crop_box = np.array([0, 0, x2 - x1, y2 - y1], dtype=float)

            mask, score = predict_box(predictor, crop_rgb, crop_box)
            feats = mask_to_features(mask, crop_transform, score)
            all_features.extend(feats)

            print(f"  [{i}/{len(boxes)}] score={score:.3f}  "
                  f"→ {len(feats)} polygon(s)")

    stem = image_path.stem
    out_path = out_dir / f"{stem}_sam_polygons.geojson"
    write_geojson(all_features, crs, out_path)
    print(f"\nSaved {len(all_features)} polygons to {out_path}")


def run_auto(image_path: Path,
             ckpt_path: Path,
             out_dir: Path,
             model_type: str,
             device: torch.device):
    """SAM automatic mask generator — no U-Net guidance required."""
    from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

    with rasterio.open(image_path) as src:
        # For large tiles, read at reduced resolution to keep memory sane
        overview = src.read(
            [1, 2, 4],
            out_shape=(3, min(src.height, 2048), min(src.width, 2048)),
            resampling=rasterio.enums.Resampling.bilinear,
        )
        scale_y = src.height / overview.shape[1]
        scale_x = src.width  / overview.shape[2]
        scaled_transform = src.transform * rasterio.Affine.scale(scale_x, scale_y)
        crs = src.crs

    rgb = np.moveaxis(overview.astype(np.float32), 0, -1)
    for i in range(3):
        lo, hi = np.percentile(rgb[:, :, i], 2), np.percentile(rgb[:, :, i], 98)
        rgb[:, :, i] = np.clip((rgb[:, :, i] - lo) / max(hi - lo, 1) * 255, 0, 255)
    rgb = rgb.astype(np.uint8)

    print(f"Loading SAM {model_type} on {device}…")
    sam = sam_model_registry[model_type](checkpoint=str(ckpt_path))
    sam.to(device)
    mask_gen = SamAutomaticMaskGenerator(
        sam,
        points_per_side=32,
        pred_iou_thresh=0.86,
        stability_score_thresh=0.92,
        min_mask_region_area=200,
    )

    print(f"Running automatic mask generation on {rgb.shape[1]}×{rgb.shape[0]} image…")
    masks = mask_gen.generate(rgb)
    print(f"Generated {len(masks)} masks")

    features = []
    for m in masks:
        features.extend(
            mask_to_features(m["segmentation"], scaled_transform,
                             m.get("stability_score", 1.0))
        )

    out_path = out_dir / f"{image_path.stem}_sam_auto.geojson"
    write_geojson(features, crs, out_path)
    print(f"Saved {len(features)} polygons to {out_path}")


# ---------------------------------------------------------------------------
# Modal (cloud GPU) entry points
# ---------------------------------------------------------------------------
# Install: pip install modal  then  modal setup
#
# Usage:
#   modal run ml/sam-segment.py::modal_refine -- \\
#       --image    data/osip/or/2022/tile.tif \\
#       --prob-map data/predictions/2022/tile_prob.tif \\
#       --ckpt     /Volumes/T7/Terranthro/QGIS_Plugin/sam_vit_l_0b3195.pth \\
#       --out-dir  data/sam-output/

try:
    import modal

    _image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "torch==2.2.2", "torchvision==0.17.2",
            "segment-anything",
            "rasterio==1.3.9",
            "scipy",
            "numpy",
        )
    )
    _vol = modal.Volume.from_name("terranthro-sam-ckpts", create_if_missing=True)
    app  = modal.App("terranthro-sam")

    @app.function(
        gpu="A10G",
        image=_image,
        volumes={"/ckpts": _vol},
        timeout=900,
    )
    def _modal_refine_fn(image_bytes: bytes,
                         prob_bytes: bytes,
                         ckpt_bytes: bytes,
                         stem: str,
                         threshold: float,
                         model_type: str,
                         min_area_m2: float) -> bytes:
        import io, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            img_path  = tmp / f"{stem}.tif"
            prob_path = tmp / f"{stem}_prob.tif"
            ckpt_path = tmp / "sam.pth"
            out_dir   = tmp / "out"

            img_path.write_bytes(image_bytes)
            prob_path.write_bytes(prob_bytes)
            ckpt_path.write_bytes(ckpt_bytes)

            device = torch.device("cuda")
            run_refine(img_path, prob_path, ckpt_path, out_dir,
                       threshold, model_type, min_area_m2, device)

            out_file = out_dir / f"{stem}_sam_polygons.geojson"
            return out_file.read_bytes()

    @app.local_entrypoint()
    def modal_refine(image: str, prob_map: str, ckpt: str, out_dir: str,
                     threshold: float = 0.4, model_type: str = "vit_l",
                     min_area_m2: float = 200.0):
        image_path = Path(image)
        out        = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)

        result = _modal_refine_fn.remote(
            image_bytes   = image_path.read_bytes(),
            prob_bytes    = Path(prob_map).read_bytes(),
            ckpt_bytes    = Path(ckpt).read_bytes(),
            stem          = image_path.stem,
            threshold     = threshold,
            model_type    = model_type,
            min_area_m2   = min_area_m2,
        )
        out_path = out / f"{image_path.stem}_sam_polygons.geojson"
        out_path.write_bytes(result)
        print(f"Downloaded result to {out_path}")

except ImportError:
    pass   # modal not installed — local-only mode


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="SAM vineyard boundary extraction",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="mode", required=True)

    # -- refine ---------------------------------------------------------------
    p_refine = sub.add_parser("refine", help="U-Net boxes → SAM refinement")
    p_refine.add_argument("--image",       required=True,  help="OSIP GeoTIFF tile")
    p_refine.add_argument("--prob-map",    required=True,  help="U-Net _prob.tif output")
    p_refine.add_argument("--ckpt",        required=True,  help="SAM checkpoint .pth")
    p_refine.add_argument("--out-dir",     required=True)
    p_refine.add_argument("--model-type",  default="vit_l",
                          choices=["vit_h", "vit_l", "vit_b"])
    p_refine.add_argument("--threshold",   type=float, default=0.4,
                          help="U-Net confidence threshold [default: 0.4]")
    p_refine.add_argument("--min-area-m2", type=float, default=200.0,
                          help="Min vineyard area in m² to process [default: 200]")

    # -- auto -----------------------------------------------------------------
    p_auto = sub.add_parser("auto", help="SAM automatic masks (no U-Net)")
    p_auto.add_argument("--image",      required=True)
    p_auto.add_argument("--ckpt",       required=True)
    p_auto.add_argument("--out-dir",    required=True)
    p_auto.add_argument("--model-type", default="vit_l",
                        choices=["vit_h", "vit_l", "vit_b"])

    args = parser.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    if args.mode == "refine":
        run_refine(
            image_path  = Path(args.image),
            prob_path   = Path(args.prob_map),
            ckpt_path   = Path(args.ckpt),
            out_dir     = Path(args.out_dir),
            threshold   = args.threshold,
            model_type  = args.model_type,
            min_area_m2 = args.min_area_m2,
            device      = device,
        )
    else:
        run_auto(
            image_path = Path(args.image),
            ckpt_path  = Path(args.ckpt),
            out_dir    = Path(args.out_dir),
            model_type = args.model_type,
            device     = device,
        )


if __name__ == "__main__":
    main()
