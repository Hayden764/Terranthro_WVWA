"""
predict.py — Sliding-window inference on OSIP GeoTIFF tiles
============================================================

Loads the trained U-Net checkpoint and runs inference over full OSIP tiles
using a sliding 256×256 window with 50% overlap.  Overlapping predictions are
averaged to produce smooth probability maps without boundary artefacts.

Output per tile
---------------
  {out_dir}/{tile_stem}_prob.tif   — float32 probability map  [0, 1]
  {out_dir}/{tile_stem}_mask.tif   — uint8 binary mask (0 / 255)  [if --threshold]

Both outputs are GeoTIFFs with the same CRS and geotransform as the input tile.

Usage
-----
  # Inference on all 2022 tiles
  .venv/bin/python ml/predict.py \\
      --ckpt     ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt \\
      --osip-dir data/osip/or/2022/ \\
      --out-dir  data/predictions/2022/

  # Also write binary masks at threshold 0.5
  .venv/bin/python ml/predict.py \\
      --ckpt      ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt \\
      --osip-dir  data/osip/or/2022/ \\
      --out-dir   data/predictions/2022/ \\
      --threshold 0.5

  # Single tile
  .venv/bin/python ml/predict.py \\
      --ckpt     ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt \\
      --osip-dir data/osip/or/2022/ \\
      --out-dir  data/predictions/2022/ \\
      --tile     osip2022_492906_5008940.tif
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
import torch
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train import VineyardSegModel

PATCH_PX = 256
STRIDE   = 128   # 50% overlap


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_stats(stats_path: Path) -> dict:
    """Load per-channel mean/std from stats.json."""
    with open(stats_path) as f:
        return json.load(f)


def tile_to_tensor(img_path: Path, stats: dict):
    """
    Read a 4-band uint8 OSIP tile, compute NDVI, normalise, and return
    a float32 numpy array (5, H, W) together with the rasterio profile.
    """
    with rasterio.open(img_path) as src:
        data    = src.read()          # (4, H, W) uint8  bands: R G B NIR
        profile = src.profile.copy()

    r, g, b, nir = [data[i].astype(np.float32) / 255.0 for i in range(4)]

    # NDVI — clamp to [-1, 1] to handle edge cases
    ndvi = (nir - r) / (nir + r + 1e-8)
    ndvi = np.clip(ndvi, -1.0, 1.0)

    channels = [r, g, b, nir, ndvi]
    means    = stats["mean"]   # list of 5 floats [red, green, blue, nir, ndvi]
    stds     = stats["std"]

    img = np.stack(
        [(ch - means[i]) / stds[i] for i, ch in enumerate(channels)],
        axis=0,
    ).astype(np.float32)   # (5, H, W)

    return img, profile


def sliding_window_predict(model, img: np.ndarray, device, batch_size: int = 64, stride: int = STRIDE) -> np.ndarray:
    """
    Run U-Net over `img` (5, H, W) using a sliding 256×256 window.

    Returns a float32 probability map (H, W) in [0, 1].
    Overlapping window predictions are averaged.
    """
    _, H, W = img.shape

    # Pad so every window position is fully inside the image
    pad_h = (stride - (H - PATCH_PX) % stride) % stride
    pad_w = (stride - (W - PATCH_PX) % stride) % stride
    if pad_h or pad_w:
        img = np.pad(img, ((0, 0), (0, pad_h), (0, pad_w)), mode="reflect")

    pH, pW = img.shape[1], img.shape[2]

    ys = range(0, pH - PATCH_PX + 1, stride)
    xs = range(0, pW - PATCH_PX + 1, stride)
    windows = [(y, x) for y in ys for x in xs]

    pred_sum = np.zeros((pH, pW), dtype=np.float32)
    pred_cnt = np.zeros((pH, pW), dtype=np.float32)

    model.eval()
    with torch.no_grad():
        for start in range(0, len(windows), batch_size):
            coords = windows[start : start + batch_size]
            batch  = np.stack(
                [img[:, y : y + PATCH_PX, x : x + PATCH_PX] for y, x in coords]
            )
            logits = model(torch.from_numpy(batch).to(device))   # (N,1,256,256)
            probs  = torch.sigmoid(logits).squeeze(1).cpu().numpy()

            for (y, x), prob in zip(coords, probs):
                pred_sum[y : y + PATCH_PX, x : x + PATCH_PX] += prob
                pred_cnt[y : y + PATCH_PX, x : x + PATCH_PX] += 1.0

    pred = pred_sum / np.maximum(pred_cnt, 1.0)
    return pred[:H, :W]   # crop padding


def save_geotiff(arr: np.ndarray, profile: dict, out_path: Path, dtype="float32"):
    """Write a single-band array as a GeoTIFF."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    profile.update(
        count=1,
        dtype=dtype,
        compress="lzw",
        tiled=True,
        blockxsize=256,
        blockysize=256,
    )
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(arr.astype(dtype), 1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Sliding-window vineyard inference on OSIP tiles")
    parser.add_argument("--ckpt",       required=True,  help="Path to .ckpt checkpoint")
    parser.add_argument("--osip-dir",   required=True,  help="Directory of OSIP GeoTIFF tiles")
    parser.add_argument("--out-dir",    required=True,  help="Output directory for prediction maps")
    parser.add_argument("--stats",      default=None,   help="Path to stats.json  [default: auto-detect]")
    parser.add_argument("--tile",       default=None,   help="Run on a single tile filename only")
    parser.add_argument("--threshold",  type=float,     default=None,
                        help="If set, also write a binary mask at this threshold (e.g. 0.5)")
    parser.add_argument("--batch-size", type=int,       default=64,
                        help="Number of patches per GPU batch  [default: 64]")
    parser.add_argument("--stride",     type=int,       default=STRIDE,
                        help="Sliding window stride in pixels  [default: 128 = 50%% overlap]")
    args = parser.parse_args()

    osip_dir = Path(args.osip_dir)
    out_dir  = Path(args.out_dir)
    ckpt     = Path(args.ckpt)

    # ── Stats ──────────────────────────────────────────────────────────────
    if args.stats:
        stats_path = Path(args.stats)
    else:
        # Walk upward from osip_dir looking for patches-osip-* stats.json
        candidates = sorted(ckpt.parent.parent.parent.glob("data/patches*/stats.json"))
        if not candidates:
            candidates = sorted(Path(".").glob("data/patches*/stats.json"))
        if not candidates:
            parser.error("Could not auto-detect stats.json — pass --stats explicitly")
        stats_path = candidates[-1]   # most recent
    print(f"Normalisation stats : {stats_path}")
    stats = load_stats(stats_path)

    # ── Model ──────────────────────────────────────────────────────────────
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device              : {device}")
    model = VineyardSegModel.load_from_checkpoint(str(ckpt))
    model.to(device).eval()
    print(f"Checkpoint          : {ckpt.name}")

    # ── Tiles ──────────────────────────────────────────────────────────────
    if args.tile:
        tiles = [osip_dir / args.tile]
    else:
        tiles = sorted(osip_dir.glob("osip*.tif"))
        tiles = [t for t in tiles if not t.name.startswith("._")]

    print(f"Tiles to process    : {len(tiles)}")
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = skipped = errors = 0

    for tile_path in tqdm(tiles, unit="tile", desc="Inference"):
        prob_path = out_dir / f"{tile_path.stem}_prob.tif"
        if prob_path.exists() and prob_path.stat().st_size > 0:
            skipped += 1
            continue
        try:
            img, profile = tile_to_tensor(tile_path, stats)
            prob         = sliding_window_predict(model, img, device, batch_size=args.batch_size, stride=args.stride)

            save_geotiff(prob, profile, prob_path, dtype="float32")

            if args.threshold is not None:
                mask_path = out_dir / f"{tile_path.stem}_mask.tif"
                save_geotiff((prob >= args.threshold).astype(np.uint8) * 255,
                             profile, mask_path, dtype="uint8")
            ok += 1
        except Exception as exc:
            tqdm.write(f"  ERROR {tile_path.name}: {exc}")
            errors += 1

    disk_gb = sum(p.stat().st_size for p in out_dir.glob("*.tif")) / 1e9
    print(f"\nDone  — ok: {ok}  skipped: {skipped}  errors: {errors}")
    print(f"Disk usage : {disk_gb:.2f} GB")
    print(f"Output     : {out_dir}")


if __name__ == "__main__":
    main()
