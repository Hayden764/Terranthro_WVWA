"""
1m LiDAR DEM Downloader for Willamette Valley
===============================================
Downloads 1m DEM tiles from USGS The National Map (TNM) bulk download API,
mosaics them, derives slope and aspect, and outputs Cloud Optimized GeoTIFFs.

Usage:
    python download-1m-dem.py
    python download-1m-dem.py --bbox "-124.1,43.8,-122.4,45.9"
    python download-1m-dem.py --output-dir /path/to/output --no-upload
    python download-1m-dem.py --overwrite --workers 4

Output:
    {output_dir}/OR/willamette_valley_1m/elevation.tif
    {output_dir}/OR/willamette_valley_1m/slope.tif
    {output_dir}/OR/willamette_valley_1m/aspect.tif

Upload path (R2):
    topography-data/OR/willamette_valley_1m/elevation.tif  (etc.)
"""

import os
import sys
import json
import math
import time
import logging
import subprocess
import tempfile
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Tuple

import click
import requests
from osgeo import gdal
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Willamette Valley bounding box (generous buffer outside the AVA boundary)
WV_BBOX_DEFAULT = (-124.1, 43.8, -122.4, 45.9)

# USGS TNM products API
TNM_API_URL = "https://tnmaccess.nationalmap.gov/api/v1/products"
TNM_DATASET = "Digital Elevation Model (DEM) 1 meter"

MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds
REQUEST_TIMEOUT = 300  # seconds — tiles can be large
NODATA = -9999.0

# R2 target (matches existing upload convention)
R2_PREFIX = "topography-data/OR/willamette_valley_1m"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

gdal.UseExceptions()
gdal.SetConfigOption("CPL_LOG", "/dev/null")


# ---------------------------------------------------------------------------
# TNM tile discovery
# ---------------------------------------------------------------------------


def query_tnm_tiles(bbox: Tuple[float, float, float, float]) -> List[dict]:
    """
    Query the TNM products API for all 1m DEM tiles intersecting the given bbox.

    Returns a list of product dicts with at least 'downloadURL' and 'title'.
    Handles TNM pagination (max 50 per page, uses offset).
    """
    west, south, east, north = bbox
    bbox_str = f"{west},{south},{east},{north}"

    params = {
        "datasets": TNM_DATASET,
        "bbox": bbox_str,
        "outputFormat": "JSON",
        "max": 50,
        "offset": 0,
    }

    session = requests.Session()
    session.headers.update({"User-Agent": "Terranthro/1.0 (1m-dem-downloader)"})

    all_products = []
    total = None

    logger.info(f"Querying TNM for 1m DEM tiles in bbox {bbox_str}")

    while True:
        for attempt in range(MAX_RETRIES):
            try:
                resp = session.get(TNM_API_URL, params=params, timeout=60)
                resp.raise_for_status()
                data = resp.json()
                break
            except (requests.RequestException, ValueError) as e:
                if attempt < MAX_RETRIES - 1:
                    wait = RETRY_BACKOFF ** (attempt + 1)
                    logger.warning(f"TNM query failed (attempt {attempt+1}): {e}. Retrying in {wait}s")
                    time.sleep(wait)
                else:
                    raise RuntimeError(f"TNM API query failed after {MAX_RETRIES} attempts: {e}")

        items = data.get("items", [])
        if total is None:
            total = data.get("total", 0)
            logger.info(f"TNM reports {total} matching tiles")

        all_products.extend(items)

        if len(all_products) >= total or not items:
            break

        params["offset"] += params["max"]
        time.sleep(0.2)  # Be gentle with the API

    logger.info(f"Retrieved {len(all_products)} tile records from TNM")
    return all_products


def extract_download_url(product: dict) -> Optional[str]:
    """Extract the GeoTIFF download URL from a TNM product record."""
    # TNM products have a 'downloadURL' at top level, or urls nested under 'urls'
    url = product.get("downloadURL")
    if url and url.lower().endswith((".tif", ".tiff", ".img")):
        return url

    # Fallback: check urls dict
    urls = product.get("urls", {})
    for fmt in ("TIFF", "GeoTIFF", "IMG"):
        if fmt in urls:
            return urls[fmt]

    # Last resort: any .tif link in urls values
    for v in urls.values():
        if isinstance(v, str) and v.lower().endswith((".tif", ".tiff")):
            return v

    return None


# ---------------------------------------------------------------------------
# Tile downloading
# ---------------------------------------------------------------------------


def download_tile(url: str, output_path: str, session: requests.Session) -> bool:
    """Download a single DEM tile to disk. Returns True on success."""
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(url, stream=True, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()

            with open(output_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=131072):
                    f.write(chunk)
            return True

        except requests.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF ** (attempt + 1)
                logger.warning(f"Download failed (attempt {attempt+1}): {e}. Retrying in {wait}s")
                time.sleep(wait)
            else:
                logger.error(f"Failed to download {url} after {MAX_RETRIES} attempts: {e}")
                return False

    return False


def download_tiles_parallel(
    products: List[dict],
    tile_dir: str,
    workers: int = 4,
) -> List[str]:
    """
    Download all tiles in parallel. Returns list of successfully downloaded file paths.
    """
    os.makedirs(tile_dir, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "Terranthro/1.0 (1m-dem-downloader)"})

    tasks = []
    for i, product in enumerate(products):
        url = extract_download_url(product)
        if not url:
            logger.warning(f"No downloadable URL for product: {product.get('title', '?')}")
            continue
        title = product.get("title", f"tile_{i}")
        # Use product sourceId or title for a stable filename
        source_id = product.get("sourceId", f"tile_{i:04d}")
        filename = f"{source_id}.tif"
        tasks.append((url, os.path.join(tile_dir, filename), title))

    logger.info(f"Downloading {len(tasks)} tiles with {workers} workers...")

    downloaded = []
    failed = 0

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(download_tile, url, path, session): (url, path, title)
            for url, path, title in tasks
        }
        with tqdm(total=len(futures), desc="Downloading tiles", unit="tile") as pbar:
            for future in as_completed(futures):
                url, path, title = futures[future]
                try:
                    ok = future.result()
                    if ok:
                        downloaded.append(path)
                    else:
                        failed += 1
                except Exception as e:
                    logger.error(f"Unexpected error downloading {title}: {e}")
                    failed += 1
                pbar.update(1)

    logger.info(f"Downloaded {len(downloaded)} tiles, {failed} failed")
    return downloaded


# ---------------------------------------------------------------------------
# Mosaic + derive terrain products
# ---------------------------------------------------------------------------


def build_vrt(tile_paths: List[str], vrt_path: str) -> str:
    """Build a GDAL VRT mosaic from a list of tile paths."""
    vrt_options = gdal.BuildVRTOptions(resampleAlg="nearest", srcNodata=NODATA)
    vrt = gdal.BuildVRT(vrt_path, tile_paths, options=vrt_options)
    if vrt is None:
        raise RuntimeError("gdal.BuildVRT returned None — check tile list")
    vrt.FlushCache()
    vrt = None
    logger.info(f"Built VRT mosaic from {len(tile_paths)} tiles: {vrt_path}")
    return vrt_path


def warp_to_geotiff(
    input_path: str,
    output_path: str,
    bbox: Optional[Tuple[float, float, float, float]] = None,
    resolution_m: float = 1.0,
) -> str:
    """
    Warp/mosaic an input raster (or VRT) to a projected GeoTIFF.
    Reprojects to EPSG:32610 (UTM zone 10N) for correct 1m pixel sizing,
    then outputs Float32.
    """
    warp_options = gdal.WarpOptions(
        format="GTiff",
        dstSRS="EPSG:32610",       # UTM zone 10N — correct for Willamette Valley
        xRes=resolution_m,
        yRes=resolution_m,
        outputBounds=[bbox[0], bbox[1], bbox[2], bbox[3]] if bbox else None,
        outputBoundsSRS="EPSG:4326" if bbox else None,
        srcNodata=NODATA,
        dstNodata=NODATA,
        resampleAlg="bilinear",
        outputType=gdal.GDT_Float32,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
        multithread=True,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
    )
    gdal.Warp(output_path, input_path, options=warp_options)
    logger.info(f"Warped mosaic to UTM: {output_path}")
    return output_path


def derive_slope(elevation_path: str, output_path: str) -> str:
    """Derive slope in degrees from an elevation raster (must be in metric projection)."""
    options = gdal.DEMProcessingOptions(
        format="GTiff",
        slopeFormat="degree",
        computeEdges=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
    )
    gdal.DEMProcessing(output_path, elevation_path, "slope", options=options)
    logger.info(f"Derived slope: {output_path}")
    return output_path


def derive_aspect(elevation_path: str, output_path: str) -> str:
    """Derive aspect in degrees (0–360, flat=-1) from an elevation raster."""
    options = gdal.DEMProcessingOptions(
        format="GTiff",
        computeEdges=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
    )
    gdal.DEMProcessing(output_path, elevation_path, "aspect", options=options)
    logger.info(f"Derived aspect: {output_path}")
    return output_path


def convert_to_cog(input_path: str, output_path: str) -> str:
    """Convert a GeoTIFF to a Cloud Optimized GeoTIFF."""
    options = gdal.TranslateOptions(
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE",
            "BLOCKSIZE=512",
            "OVERVIEW_RESAMPLING=AVERAGE",
            "BIGTIFF=YES",
            "NUM_THREADS=ALL_CPUS",
            "OVERVIEWS=AUTO",
        ],
        noData=NODATA,
    )
    gdal.Translate(output_path, input_path, options=options)
    logger.info(f"COG written: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# R2 Upload
# ---------------------------------------------------------------------------


def upload_to_r2(local_path: str, r2_key: str, bucket: str, dry_run: bool = False) -> bool:
    """Upload a file to Cloudflare R2 using the locally installed wrangler binary."""
    size_mb = os.path.getsize(local_path) / 1_048_576
    logger.info(f"{'[DRY-RUN] Would upload' if dry_run else 'Uploading'}: {r2_key} ({size_mb:.1f} MB)")

    if dry_run:
        return True

    # Prefer data-pipeline/node_modules/.bin/wrangler, fall back to PATH
    script_dir = Path(__file__).resolve().parent
    local_wrangler = script_dir / ".." / "node_modules" / ".bin" / "wrangler"
    wrangler_bin = str(local_wrangler) if local_wrangler.exists() else "wrangler"

    # Run from data-pipeline dir so wrangler picks up wrangler.toml (account_id)
    cwd = str(script_dir / "..")

    cmd = [
        wrangler_bin, "r2", "object", "put",
        f"{bucket}/{r2_key}",
        f"--file={local_path}",
        "--content-type=image/tiff",
        "--remote",
    ]

    for attempt in range(MAX_RETRIES):
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
        if result.returncode == 0:
            logger.info(f"Uploaded: {r2_key}")
            return True
        wait = RETRY_BACKOFF ** (attempt + 1)
        logger.warning(f"Upload failed (attempt {attempt+1}): {result.stderr.strip()}. Retrying in {wait}s")
        time.sleep(wait)

    logger.error(f"Failed to upload {r2_key} after {MAX_RETRIES} attempts")
    return False

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--bbox",
    type=str,
    default=f"{WV_BBOX_DEFAULT[0]},{WV_BBOX_DEFAULT[1]},{WV_BBOX_DEFAULT[2]},{WV_BBOX_DEFAULT[3]}",
    show_default=True,
    help="Bounding box: west,south,east,north in WGS84.",
)
@click.option(
    "--output-dir",
    type=click.Path(),
    default=None,
    help="Directory for output COGs. Default: ../data/topography/",
)
@click.option(
    "--workers",
    type=int,
    default=4,
    show_default=True,
    help="Parallel workers for tile downloading.",
)
@click.option(
    "--upload/--no-upload",
    default=True,
    show_default=True,
    help="Upload finished COGs to Cloudflare R2.",
)
@click.option(
    "--bucket",
    type=str,
    default="terranthro-topography",
    show_default=True,
    help="R2 bucket name (for wrangler upload).",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Show what would happen without downloading or uploading.",
)
@click.option(
    "--overwrite",
    is_flag=True,
    default=False,
    help="Overwrite existing COG files.",
)
@click.option(
    "--keep-tiles",
    is_flag=True,
    default=False,
    help="Keep downloaded raw tiles after processing (default: delete).",
)
def main(bbox, output_dir, workers, upload, bucket, dry_run, overwrite, keep_tiles):
    """
    Download 1m LiDAR DEM tiles from USGS TNM for the Willamette Valley,
    mosaic and reproject to UTM, derive slope and aspect, and output COGs.
    """
    script_dir = Path(__file__).resolve().parent

    if output_dir is None:
        output_dir = str(script_dir / ".." / "data" / "topography")
    output_dir = Path(output_dir).resolve()

    # Parse bbox
    try:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError
        west, south, east, north = parts
    except (ValueError, TypeError):
        click.echo("Error: --bbox must be 'west,south,east,north'", err=True)
        sys.exit(1)

    aoi_bbox = (west, south, east, north)

    # Output paths
    out_subdir = output_dir / "OR" / "willamette_valley_1m"
    out_subdir.mkdir(parents=True, exist_ok=True)

    products_needed = {
        "elevation": out_subdir / "elevation.tif",
        "slope":     out_subdir / "slope.tif",
        "aspect":    out_subdir / "aspect.tif",
    }

    # Check overwrite
    if not overwrite:
        existing = [name for name, path in products_needed.items() if path.exists()]
        if set(existing) == set(products_needed):
            click.echo("All 3 COGs already exist. Use --overwrite to regenerate.")
            sys.exit(0)
        elif existing:
            click.echo(f"Existing COGs (will skip): {', '.join(existing)}")

    click.echo(f"\nWillamette Valley 1m LiDAR DEM Pipeline")
    click.echo(f"  BBox:       {west},{south},{east},{north}")
    click.echo(f"  Output dir: {out_subdir}")
    click.echo(f"  Workers:    {workers}")
    click.echo(f"  Upload:     {'yes → ' + bucket if upload else 'no'}")
    click.echo(f"  Dry run:    {dry_run}\n")

    # ── Step 1: Discover TNM tiles ────────────────────────────────────────
    click.echo("Step 1: Querying USGS TNM for 1m DEM tiles...")
    if dry_run:
        tiles = query_tnm_tiles(aoi_bbox)
        click.echo(f"[DRY-RUN] Would download {len(tiles)} tiles.")
        sys.exit(0)

    tiles = query_tnm_tiles(aoi_bbox)
    if not tiles:
        click.echo("No tiles found. Check your bbox or network connection.", err=True)
        sys.exit(1)

    click.echo(f"Found {len(tiles)} tiles to download.\n")

    # ── Step 2: Download tiles ────────────────────────────────────────────
    tmp_dir = tempfile.mkdtemp(prefix="wv_1m_dem_")
    try:
        tile_dir = os.path.join(tmp_dir, "tiles")
        click.echo(f"Step 2: Downloading tiles to temp dir...")
        tile_paths = download_tiles_parallel(tiles, tile_dir, workers=workers)

        if not tile_paths:
            click.echo("No tiles downloaded successfully. Aborting.", err=True)
            sys.exit(1)

        click.echo(f"\nStep 3: Building VRT mosaic from {len(tile_paths)} tiles...")
        vrt_path = os.path.join(tmp_dir, "mosaic.vrt")
        build_vrt(tile_paths, vrt_path)

        # ── Step 4: Warp to UTM + write elevation GeoTIFF ─────────────────
        click.echo("Step 4: Warping mosaic to UTM zone 10N at 1m resolution...")
        click.echo("  (This may take 10–30 minutes for full WV extent)")
        utm_dem_path = os.path.join(tmp_dir, "elevation_utm.tif")
        warp_to_geotiff(vrt_path, utm_dem_path, bbox=aoi_bbox, resolution_m=1.0)

        # ── Step 5: Derive slope and aspect ───────────────────────────────
        slope_intermediate = os.path.join(tmp_dir, "slope_raw.tif")
        aspect_intermediate = os.path.join(tmp_dir, "aspect_raw.tif")

        if "slope" not in [n for n, p in products_needed.items() if p.exists() and not overwrite]:
            click.echo("Step 5a: Deriving slope...")
            derive_slope(utm_dem_path, slope_intermediate)

        if "aspect" not in [n for n, p in products_needed.items() if p.exists() and not overwrite]:
            click.echo("Step 5b: Deriving aspect...")
            derive_aspect(utm_dem_path, aspect_intermediate)

        # ── Step 6: Convert to COG ─────────────────────────────────────────
        click.echo("Step 6: Converting to Cloud Optimized GeoTIFFs...")

        if overwrite or not products_needed["elevation"].exists():
            click.echo("  elevation.tif")
            convert_to_cog(utm_dem_path, str(products_needed["elevation"]))

        if overwrite or not products_needed["slope"].exists():
            click.echo("  slope.tif")
            convert_to_cog(slope_intermediate, str(products_needed["slope"]))

        if overwrite or not products_needed["aspect"].exists():
            click.echo("  aspect.tif")
            convert_to_cog(aspect_intermediate, str(products_needed["aspect"]))

    finally:
        if keep_tiles:
            click.echo(f"\nKeeping downloaded tiles at: {tile_dir}")
        else:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    # ── Step 7: Upload to R2 ──────────────────────────────────────────────
    if upload:
        click.echo("\nStep 7: Uploading COGs to Cloudflare R2...")
        upload_ok = True
        for product_name, local_path in products_needed.items():
            if local_path.exists():
                r2_key = f"{R2_PREFIX}/{product_name}.tif"
                ok = upload_to_r2(str(local_path), r2_key, bucket, dry_run=dry_run)
                if not ok:
                    upload_ok = False
        if not upload_ok:
            click.echo("\nWarning: Some uploads failed. COGs are saved locally.")
    else:
        click.echo("\nSkipping R2 upload (--no-upload).")

    # ── Summary ────────────────────────────────────────────────────────────
    click.echo("\n" + "=" * 60)
    click.echo("Pipeline complete!")
    for product_name, local_path in products_needed.items():
        size = ""
        if local_path.exists():
            size_gb = local_path.stat().st_size / 1_073_741_824
            size = f" ({size_gb:.2f} GB)"
        click.echo(f"  {product_name}: {local_path}{size}")
    click.echo("=" * 60)


if __name__ == "__main__":
    main()
