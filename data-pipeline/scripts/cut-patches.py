"""
Patch Cutter — NAIP + Gold Standard Vineyard Blocks
=====================================================
Slices NAIP GeoTIFF tiles into 256×256 training patches, computes NDVI as a
5th channel, rasterizes the gold-standard block polygons as binary masks, and
writes train/val patch sets ready for the U-Net dataloader.

Input
-----
    data/naip/or/2022/*.tif              — 4-band RGBIR GeoTIFF tiles (uint8)
    data/training/dundee_hills_edited_blocks.geojson  — QA'd block polygons

Output
------
    data/patches/
        train/
            images/   {tile}_{y}_{x}.npy   (5, 256, 256) float32
            masks/    {tile}_{y}_{x}.npy   (256, 256) uint8
        val/
            images/   ...
            masks/    ...
        stats.json        per-channel mean + std for the dataloader normaliser
        manifest.json     every patch with metadata (split, tile, vineyard_pct)

Channel layout (axis 0)
-----------------------
    0  Red    — raw DN / 255  → [0, 1]
    1  Green  — raw DN / 255  → [0, 1]
    2  Blue   — raw DN / 255  → [0, 1]
    3  NIR    — raw DN / 255  → [0, 1]
    4  NDVI   — (NIR-R)/(NIR+R) → [-1, 1]  (amplifies vine-canopy signal)

Geographic train / val split
-----------------------------
Blocks are sorted by their centroid easting (UTM) and the easternmost
--val-pct fraction is withheld for validation.  This keeps train and val
spatially separated within Dundee Hills while distributing both sets across
the full N-S extent of the AVA.  Adjust --val-side to use northing instead.

Memory strategy
---------------
Full NAIP tiles are 17 000×17 000 px at 0.3 m/px (~1.5 GB uint8, ~5.8 GB
float32).  Loading the whole tile at once causes OOM on most laptops.

Instead we use a two-pass windowed approach:
  Pass 1 — scan the uint8 mask (already compact at ~290 MB) to classify
            every sliding-window position as positive or negative.  No image
            I/O at all.
  Pass 2 — down-sample the negative pool to neg_ratio × n_positives, then
            read image data only for selected windows via rasterio windowed
            I/O.  Peak memory ≈ mask (~290 MB) + one patch (<2 MB).

Usage
-----
    # Default run (2022 tiles, 256px patches, 20% val by easting):
    python cut-patches.py

    # Check patch counts without writing anything to disk:
    python cut-patches.py --dry-run

    # Re-run and overwrite existing patches:
    python cut-patches.py --overwrite
"""

import json
import logging
import random
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import click
import numpy as np
import rasterio
import rasterio.features
from rasterio.warp import transform_bounds
from rasterio.crs import CRS
from rasterio.windows import Window as RioWindow
from shapely.geometry import box, shape, mapping
from shapely.ops import transform as shapely_transform
import pyproj
import geopandas as gpd
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PATCH_SIZE   = 256          # pixels — width and height of each patch
STRIDE       = 128          # sliding-window stride (50% overlap)
EROSION_M    = 3.0          # metres to erode polygon inward before rasterising
MIN_POS_PCT  = 0.05         # ≥5% vineyard pixels → keep as positive patch
NEG_RATIO    = 2.0          # negative patches per positive
HARD_NEG_NDVI_THRESHOLD = 0.35  # NDVI mean above which a neg patch is "hard"
VAL_PCT      = 0.20         # fraction of blocks held out for validation
RANDOM_SEED  = 42

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def reproject_geom(geom, src_crs: str, dst_crs: str):
    """Reproject a Shapely geometry between two CRS strings."""
    transformer = pyproj.Transformer.from_crs(
        src_crs, dst_crs, always_xy=True
    )
    return shapely_transform(transformer.transform, geom)


def erode_geom(geom, metres: float):
    """
    Shrink a polygon inward by *metres*.  Strips the uncertain alignment zone
    from block edges before rasterising — handles the ~1–2px eastward offset
    seen between the MapTiler basemap (used for digitising) and NAIP.
    """
    result = geom.buffer(-metres)
    if result.is_empty:
        logger.debug(f"Polygon too small to survive {metres}m erosion — skipping")
        return None
    return result


# ---------------------------------------------------------------------------
# NDVI
# ---------------------------------------------------------------------------

def compute_ndvi(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """
    Compute NDVI = (NIR - Red) / (NIR + Red).

    Inputs are uint8 [0, 255].  Output is float32 in approximately [-1, 1].
    The epsilon prevents divide-by-zero on pure-black pixels.
    """
    r = red.astype(np.float32)
    n = nir.astype(np.float32)
    return (n - r) / (n + r + 1e-6)


def build_5ch_image(patch_data: np.ndarray) -> np.ndarray:
    """
    Convert a (4, H, W) uint8 NAIP patch [R, G, B, NIR] into a
    (5, H, W) float32 array [R/255, G/255, B/255, NIR/255, NDVI].
    """
    r, g, b, nir = patch_data[0], patch_data[1], patch_data[2], patch_data[3]
    ndvi = compute_ndvi(r, nir)
    return np.stack([
        r.astype(np.float32)   / 255.0,
        g.astype(np.float32)   / 255.0,
        b.astype(np.float32)   / 255.0,
        nir.astype(np.float32) / 255.0,
        ndvi,
    ], axis=0)   # (5, H, W)


# ---------------------------------------------------------------------------
# Mask rasterisation
# ---------------------------------------------------------------------------

def rasterise_blocks(
    blocks: gpd.GeoDataFrame,
    tile_crs: CRS,
    tile_transform,
    tile_shape: Tuple[int, int],
    erosion_m: float,
) -> np.ndarray:
    """
    Burn block polygons to a binary mask aligned to the NAIP tile grid.

    Steps:
      1. Reproject each block from WGS84 → tile CRS (UTM 10N)
      2. Buffer inward by *erosion_m* to strip edge-alignment uncertainty
      3. Rasterise to (H, W) uint8 mask (1 = vineyard, 0 = background)
    """
    H, W = tile_shape
    mask = np.zeros((H, W), dtype=np.uint8)

    tile_crs_str = tile_crs.to_string()
    shapes = []

    for _, row in blocks.iterrows():
        geom = shape(row.geometry)
        try:
            utm_geom = reproject_geom(geom, "EPSG:4326", tile_crs_str)
        except Exception as exc:
            logger.debug(f"Reproject failed for block {row.get('id', '?')}: {exc}")
            continue

        eroded = erode_geom(utm_geom, erosion_m)
        if eroded is None:
            continue

        shapes.append((mapping(eroded), 1))

    if shapes:
        rasterio.features.rasterize(
            shapes,
            out=mask,
            transform=tile_transform,
            fill=0,
            dtype=np.uint8,
        )

    return mask


# ---------------------------------------------------------------------------
# Block ↔ tile intersection
# ---------------------------------------------------------------------------

def blocks_intersect_tile(
    blocks: gpd.GeoDataFrame,
    tile_bounds_wgs84: Tuple[float, float, float, float],
) -> gpd.GeoDataFrame:
    """Return the subset of *blocks* that intersect the tile's WGS84 bbox."""
    tile_box = box(*tile_bounds_wgs84)
    return blocks[blocks.geometry.apply(
        lambda g: shape(g).intersects(tile_box)
    )]


# ---------------------------------------------------------------------------
# Patch extraction — windowed reads (memory-efficient)
# ---------------------------------------------------------------------------

def extract_patches_windowed(
    src,               # open rasterio DatasetReader
    mask: np.ndarray,  # (H, W) uint8 — full-tile vineyard mask
    patch_size: int,
    stride: int,
    min_pos_pct: float,
    neg_ratio: float,
    rng: random.Random,
) -> Tuple[List[np.ndarray], List[np.ndarray], List[Dict]]:
    """
    Memory-efficient patch extractor using rasterio windowed reads.

    Pass 1 — scan the compact uint8 mask to classify every sliding-window
             position as positive (vp ≥ min_pos_pct) or negative candidate.
             No image I/O at all — just mask arithmetic.

    Pass 2 — down-sample the negative pool, then issue rasterio windowed
             reads only for selected positions.  Each read loads a single
             256×256×4-band patch (~1 MB) — peak memory stays near the mask
             size (~290 MB) rather than the full-tile float32 (~5.8 GB).

    Hard-negative classification (high-NDVI background) is applied to all
    sampled negatives after their image data is read.
    """
    H, W = mask.shape

    pos_positions: List[Tuple[int, int, float]] = []  # (y, x, vp)
    neg_positions: List[Tuple[int, int, float]] = []  # (y, x, vp)

    # ── Pass 1: classify from mask only ──────────────────────────────────────
    for y in range(0, H - patch_size + 1, stride):
        for x in range(0, W - patch_size + 1, stride):
            vp = float(mask[y : y + patch_size, x : x + patch_size].mean())
            if vp >= min_pos_pct:
                pos_positions.append((y, x, vp))
            else:
                neg_positions.append((y, x, vp))

    # ── Sample negatives before any I/O ──────────────────────────────────────
    n_pos      = len(pos_positions)
    n_neg_want = max(1, int(n_pos * neg_ratio)) if n_pos > 0 else 0

    if len(neg_positions) > n_neg_want:
        sampled_negs = rng.sample(neg_positions, n_neg_want)
    else:
        sampled_negs = list(neg_positions)

    # ── Pass 2: windowed image reads for selected patches only ───────────────
    imgs: List[np.ndarray]      = []
    masks_out: List[np.ndarray] = []
    metas: List[Dict]           = []

    for y, x, vp in pos_positions:
        win        = RioWindow(col_off=x, row_off=y, width=patch_size, height=patch_size)
        patch_data = src.read(window=win)           # (4, P, P) uint8
        img_p      = build_5ch_image(patch_data)    # (5, P, P) float32
        mask_p     = mask[y : y + patch_size, x : x + patch_size].copy()
        imgs.append(img_p)
        masks_out.append(mask_p)
        metas.append({"vineyard_pct": vp, "y": y, "x": x, "kind": "positive"})

    for y, x, vp in sampled_negs:
        win        = RioWindow(col_off=x, row_off=y, width=patch_size, height=patch_size)
        patch_data = src.read(window=win)
        img_p      = build_5ch_image(patch_data)
        mask_p     = mask[y : y + patch_size, x : x + patch_size].copy()
        ndvi_mean  = float(img_p[4].mean())
        kind = "hard_negative" if ndvi_mean >= HARD_NEG_NDVI_THRESHOLD else "background"
        imgs.append(img_p)
        masks_out.append(mask_p)
        metas.append({
            "vineyard_pct": vp, "y": y, "x": x,
            "kind": kind, "ndvi_mean": ndvi_mean,
        })

    return imgs, masks_out, metas


# ---------------------------------------------------------------------------
# Normalisation stats
# ---------------------------------------------------------------------------

def compute_channel_stats(image_paths: List[Path]) -> Dict:
    """
    Compute per-channel mean and std over all training image patches.

    Uses Welford's parallel merge algorithm — one numpy pass per patch
    (not per pixel), so 4 983 patches completes in seconds rather than hours.

    For each patch we compute the batch mean and M2 via numpy, then merge
    with the running aggregates using the Chan et al. parallel formula:
        delta  = batch_mean - running_mean
        new_n  = running_n + batch_n
        mean   += delta * batch_n / new_n
        M2     += batch_M2 + delta² * running_n * batch_n / new_n
    """
    logger.info(f"Computing normalisation stats from {len(image_paths)} training patches ...")
    n_channels = 5
    count = np.zeros(n_channels, dtype=np.float64)
    mean  = np.zeros(n_channels, dtype=np.float64)
    M2    = np.zeros(n_channels, dtype=np.float64)

    for path in tqdm(image_paths, desc="  stats", leave=False):
        arr  = np.load(path)                                    # (5, P, P) float32
        flat = arr.reshape(n_channels, -1).astype(np.float64)  # (5, P²)

        batch_n    = flat.shape[1]                              # P² = 65 536
        batch_mean = flat.mean(axis=1)                          # (5,)
        batch_M2   = flat.var(axis=1, ddof=0) * batch_n        # (5,)

        # Welford parallel merge
        new_count  = count + batch_n
        delta      = batch_mean - mean
        # Guard against first iteration (count == 0)
        safe_n     = np.where(new_count > 0, new_count, 1.0)
        mean       = mean + delta * (batch_n / safe_n)
        M2         = M2 + batch_M2 + delta ** 2 * (count * batch_n / safe_n)
        count      = new_count

    std = np.sqrt(M2 / (count - 1))
    return {
        "channels": ["red", "green", "blue", "nir", "ndvi"],
        "mean":     mean.tolist(),
        "std":      std.tolist(),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command()
@click.option("--naip-dir",    type=click.Path(exists=True), default=None,
              help="Directory of NAIP GeoTIFF tiles.  Default: ../data/naip/or/2022/")
@click.option("--blocks-file", type=click.Path(exists=True), default=None,
              help="Gold-standard block GeoJSON.  Default: ../data/training/dundee_hills_edited_blocks.geojson")
@click.option("--output-dir",  type=click.Path(), default=None,
              help="Root output directory for patches.  Default: ../data/patches/")
@click.option("--patch-size",  type=int, default=PATCH_SIZE,    show_default=True)
@click.option("--stride",      type=int, default=STRIDE,        show_default=True)
@click.option("--erosion-m",   type=float, default=EROSION_M,   show_default=True,
              help="Inward erosion applied to block polygons before rasterising (metres).")
@click.option("--min-pos-pct", type=float, default=MIN_POS_PCT, show_default=True,
              help="Minimum vineyard pixel fraction for a patch to count as positive.")
@click.option("--neg-ratio",   type=float, default=NEG_RATIO,   show_default=True,
              help="Target ratio of negative to positive patches per tile.")
@click.option("--val-pct",     type=float, default=VAL_PCT,     show_default=True,
              help="Fraction of blocks withheld for validation (sorted by easting).")
@click.option("--val-side",    type=click.Choice(["east", "west", "north", "south"]),
              default="east", show_default=True,
              help="Which edge of the AVA to use as the validation zone.")
@click.option("--overwrite",   is_flag=True, default=False,
              help="Delete and recreate the output directory if it already exists.")
@click.option("--dry-run",     is_flag=True, default=False,
              help="Count patches without writing anything to disk.")
@click.option("--seed",        type=int, default=RANDOM_SEED, show_default=True)
def main(naip_dir, blocks_file, output_dir, patch_size, stride, erosion_m,
         min_pos_pct, neg_ratio, val_pct, val_side, overwrite, dry_run, seed):
    """
    Cut 256×256 NAIP patches and binary vineyard masks for U-Net training.

    Produces a 5-channel image stack [R, G, B, NIR, NDVI] per patch.
    Uses rasterio windowed reads so full tiles are never loaded into RAM.
    Applies a geographic train/val split so no spatial region leaks.
    """
    script_dir = Path(__file__).resolve().parent
    rng = random.Random(seed)

    # ── Resolve paths ─────────────────────────────────────────────────────────
    if naip_dir is None:
        naip_dir = script_dir / ".." / "data" / "naip" / "or" / "2022"
    naip_dir = Path(naip_dir).resolve()

    if blocks_file is None:
        blocks_file = (
            script_dir / ".." / "data" / "training"
            / "dundee_hills_edited_blocks.geojson"
        )
    blocks_file = Path(blocks_file).resolve()

    if output_dir is None:
        output_dir = script_dir / ".." / "data" / "patches"
    output_dir = Path(output_dir).resolve()

    # ── Find NAIP tiles (skip macOS resource-fork sidecar files) ─────────────
    tiles = sorted([
        p for p in naip_dir.glob("*.tif")
        if not p.name.startswith("._")
    ])
    if not tiles:
        click.echo(f"No .tif files found in {naip_dir}", err=True)
        sys.exit(1)

    # ── Load gold-standard blocks ─────────────────────────────────────────────
    blocks_gdf   = gpd.read_file(blocks_file)
    blocks_gdf   = blocks_gdf[blocks_gdf.geometry.notna()].reset_index(drop=True)
    total_blocks = len(blocks_gdf)
    logger.info(f"Loaded {total_blocks} gold-standard blocks from {blocks_file.name}")

    # ── Geographic train / val split ──────────────────────────────────────────
    blocks_gdf["_cx"] = blocks_gdf.geometry.apply(lambda g: shape(g).centroid.x)
    blocks_gdf["_cy"] = blocks_gdf.geometry.apply(lambda g: shape(g).centroid.y)

    axis_map = {
        "east":  ("_cx", False),
        "west":  ("_cx", True),
        "north": ("_cy", False),
        "south": ("_cy", True),
    }
    sort_col, ascending = axis_map[val_side]

    blocks_sorted = blocks_gdf.sort_values(sort_col, ascending=ascending).reset_index(drop=True)
    n_val     = max(1, int(len(blocks_sorted) * val_pct))
    val_ids   = set(blocks_sorted.iloc[:n_val].index)
    train_ids = set(blocks_sorted.index) - val_ids

    train_blocks = blocks_gdf.loc[list(train_ids)].reset_index(drop=True)
    val_blocks   = blocks_gdf.loc[list(val_ids)].reset_index(drop=True)

    logger.info(
        f"Geographic split ({val_side}-most {val_pct:.0%} → val): "
        f"{len(train_blocks)} train blocks / {len(val_blocks)} val blocks"
    )

    # ── Set up output dirs ────────────────────────────────────────────────────
    if not dry_run:
        if output_dir.exists() and overwrite:
            import shutil
            shutil.rmtree(output_dir)
            logger.info(f"Deleted existing output dir: {output_dir}")
        for split in ("train", "val"):
            (output_dir / split / "images").mkdir(parents=True, exist_ok=True)
            (output_dir / split / "masks").mkdir(parents=True, exist_ok=True)

    # ── Main loop ─────────────────────────────────────────────────────────────
    click.echo(f"\nProcessing {len(tiles)} NAIP tile(s) ...\n")

    manifest: List[Dict]   = []
    counters = {"train": {"pos": 0, "neg": 0}, "val": {"pos": 0, "neg": 0}}
    train_img_paths: List[Path] = []

    for tile_path in tiles:
        tile_stem = tile_path.stem
        logger.info(f"Tile: {tile_stem}")

        with rasterio.open(tile_path) as src:
            tile_crs       = src.crs
            tile_transform = src.transform
            tile_shape     = (src.height, src.width)
            bounds_wgs84   = transform_bounds(tile_crs, "EPSG:4326", *src.bounds)

            # Fast early-exit: skip if neither split has any overlapping blocks
            any_intersect = any(
                len(blocks_intersect_tile(sb, bounds_wgs84)) > 0
                for sb in [train_blocks, val_blocks]
            )
            if not any_intersect:
                logger.info("  No blocks intersect tile — skipping")
                logger.info("")
                continue

            # src stays open through both split iterations for windowed reads
            for split, split_blocks in [("train", train_blocks), ("val", val_blocks)]:
                relevant = blocks_intersect_tile(split_blocks, bounds_wgs84)
                if len(relevant) == 0:
                    continue

                logger.info(f"  {split}: {len(relevant)} block(s) intersect tile")

                # Rasterise mask at full-tile resolution (uint8 only, ~290 MB)
                mask = rasterise_blocks(
                    relevant, tile_crs, tile_transform, tile_shape, erosion_m
                )

                vineyard_px = int(mask.sum())
                if vineyard_px == 0:
                    logger.info(f"  {split}: mask is empty after erosion — skipping")
                    del mask
                    continue

                logger.info(
                    f"  {split}: {vineyard_px:,} vineyard px "
                    f"({vineyard_px / mask.size:.1%} of tile)"
                )

                # Windowed patch extraction — reads only selected 256×256 windows
                imgs, masks, metas = extract_patches_windowed(
                    src, mask, patch_size, stride,
                    min_pos_pct, neg_ratio, rng,
                )
                del mask   # free mask memory before next iteration

                n_pos = sum(1 for m in metas if m["kind"] == "positive")
                n_neg = len(metas) - n_pos
                logger.info(f"  {split}: {n_pos} positive, {n_neg} negative patches")

                counters[split]["pos"] += n_pos
                counters[split]["neg"] += n_neg

                if not dry_run:
                    for img_p, mask_p, meta in zip(imgs, masks, metas):
                        fname    = f"{tile_stem}_{meta['y']:05d}_{meta['x']:05d}.npy"
                        img_out  = output_dir / split / "images" / fname
                        mask_out = output_dir / split / "masks"  / fname

                        np.save(img_out,  img_p)
                        np.save(mask_out, mask_p)

                        meta.update({"tile": tile_stem, "split": split, "file": fname})
                        manifest.append(meta)

                        if split == "train":
                            train_img_paths.append(img_out)

        logger.info("")

    # ── Summary ───────────────────────────────────────────────────────────────
    click.echo("─" * 55)
    click.echo(f"  Train:  {counters['train']['pos']} positive  +  {counters['train']['neg']} negative")
    click.echo(f"  Val:    {counters['val']['pos']} positive  +  {counters['val']['neg']} negative")
    total = sum(v["pos"] + v["neg"] for v in counters.values())
    click.echo(f"  Total:  {total} patches")

    if dry_run:
        click.echo("\n[DRY RUN] No files written.")
        return

    # ── Normalisation stats ───────────────────────────────────────────────────
    if train_img_paths:
        stats = compute_channel_stats(train_img_paths)
        stats_path = output_dir / "stats.json"
        with open(stats_path, "w") as f:
            json.dump(stats, f, indent=2)
        click.echo(f"\nNormalisation stats → {stats_path}")
        for ch, m, s in zip(stats["channels"], stats["mean"], stats["std"]):
            click.echo(f"  {ch:<5} mean={m:.4f}  std={s:.4f}")

    # ── Manifest ──────────────────────────────────────────────────────────────
    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    click.echo(f"\nManifest ({len(manifest)} entries) → {manifest_path}")

    # ── Disk usage ────────────────────────────────────────────────────────────
    total_bytes = sum(p.stat().st_size for p in output_dir.rglob("*.npy"))
    click.echo(f"Disk usage: {total_bytes / 1e9:.2f} GB")
    click.echo(f"\nOutput: {output_dir}")


if __name__ == "__main__":
    main()
