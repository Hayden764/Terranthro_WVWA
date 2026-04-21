"""
1m LiDAR DEM Downloader for Willamette Valley
===============================================
Downloads 1m DEM tiles from USGS The National Map (TNM) bulk download API,
mosaics them, derives slope and aspect, and outputs Cloud Optimized GeoTIFFs.

IMPORTANT — why per-AVA, not full-WV:
  The Willamette Valley at 1m resolution (~160km × 230km) requires a
  ~147 GB intermediate raster which will OOM or run out of disk. Running
  per-AVA keeps each DEM to 200 MB – 1.5 GB. After processing, all AVA
  DEMs are merged into the single willamette_valley_1m output so the
  rest of the pipeline (compute-parcel-topo-stats.py, TiTiler) is unchanged.

Usage:
    # Three AVAs we currently have vineyard data for:
    python download-1m-dem.py --avas chehalem-mountains,dundee-hills,yamhill-carlton

    # All WV sub-AVAs in one go:
    python download-1m-dem.py --avas all

    # Single AVA, skip upload:
    python download-1m-dem.py --avas dundee-hills --no-upload

    # Custom bbox (advanced — will still try to produce willamette_valley_1m output):
    python download-1m-dem.py --bbox "-123.5,45.1,-123.0,45.5"

Output (always written to):
    {output_dir}/OR/willamette_valley_1m/elevation.tif
    {output_dir}/OR/willamette_valley_1m/slope.tif
    {output_dir}/OR/willamette_valley_1m/aspect.tif

Upload path (Cloudflare R2):
    topography-data/OR/willamette_valley_1m/elevation.tif  (etc.)
"""

import os
import sys
import json
import time
import logging
import subprocess
import tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Tuple, Dict

import click
import requests
from osgeo import gdal
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# USGS TNM products API
TNM_API_URL = "https://tnmaccess.nationalmap.gov/api/v1/products"
TNM_DATASET = "Digital Elevation Model (DEM) 1 meter"

MAX_RETRIES = 3
RETRY_BACKOFF = 2     # seconds
REQUEST_TIMEOUT = 300  # seconds — tiles can be large (100–500 MB each)
NODATA = -9999.0
BBOX_BUFFER_DEG = 0.005  # ~500m buffer around each AVA for edge-artifact-free slope/aspect

# R2 target (matches existing upload convention)
R2_PREFIX = "topography-data/OR/willamette_valley_1m"

# Sub-AVA slug → folder name in public/data/ and output topography/
WV_AVA_MAP: Dict[str, Dict] = {
    "chehalem-mountains":  {"geojson": "chehalem_mountains.geojson",  "folder": "chehalem_mountains"},
    "dundee-hills":        {"geojson": "dundee_hills.geojson",        "folder": "dundee_hills"},
    "eola-amity-hills":    {"geojson": "eola_amity_hills.geojson",    "folder": "eola_amity_hills"},
    "laurelwood-district": {"geojson": "laurelwood_district.geojson", "folder": "laurelwood_district"},
    "lower-long-tom":      {"geojson": "lower_long_tom.geojson",      "folder": "lower_long_tom"},
    "mcminnville":         {"geojson": "mcminnville.geojson",         "folder": "mcminnville"},
    "mount-pisgah-polk-county": {"geojson": "mount_pisgah_polk_county.geojson", "folder": "mount_pisgah_polk_county"},
    "ribbon-ridge":        {"geojson": "ribbon_ridge.geojson",        "folder": "ribbon_ridge"},
    "tualatin-hills":      {"geojson": "tualatin_hills.geojson",      "folder": "tualatin_hills"},
    "van-duzer-corridor":  {"geojson": "van_duzer_corridor.geojson",  "folder": "van_duzer_corridor"},
    "yamhill-carlton":     {"geojson": "yamhill_carlton.geojson",     "folder": "yamhill_carlton"},
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

gdal.UseExceptions()
gdal.SetConfigOption("CPL_LOG", "/dev/null")


# ---------------------------------------------------------------------------
# AVA geometry helpers
# ---------------------------------------------------------------------------


def load_ava_bbox(geojson_path: str, buffer: float = BBOX_BUFFER_DEG) -> Tuple[float, float, float, float]:
    """
    Read a GeoJSON file and return a buffered bounding box (west, south, east, north).
    Works for any geometry type (Polygon, MultiPolygon, FeatureCollection).
    """
    with open(geojson_path) as f:
        data = json.load(f)

    coords = []

    def collect_coords(obj):
        t = obj.get("type", "")
        if t == "FeatureCollection":
            for feat in obj.get("features", []):
                collect_coords(feat)
        elif t == "Feature":
            collect_coords(obj.get("geometry", {}))
        elif t == "Polygon":
            for ring in obj.get("coordinates", []):
                coords.extend(ring)
        elif t == "MultiPolygon":
            for poly in obj.get("coordinates", []):
                for ring in poly:
                    coords.extend(ring)

    collect_coords(data)
    if not coords:
        raise ValueError(f"No coordinates found in {geojson_path}")

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return (
        min(lons) - buffer,
        min(lats) - buffer,
        max(lons) + buffer,
        max(lats) + buffer,
    )


# ---------------------------------------------------------------------------
# TNM tile discovery
# ---------------------------------------------------------------------------


def query_tnm_tiles(bbox: Tuple[float, float, float, float], label: str = "") -> List[dict]:
    """
    Query the TNM products API for all 1m DEM tiles intersecting the given bbox.
    Handles pagination (max 50 per page).
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

    all_products: List[dict] = []
    total = None
    tag = f"[{label}] " if label else ""

    logger.info(f"{tag}Querying TNM for 1m DEM tiles in bbox {bbox_str}")

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
                    logger.warning(f"{tag}TNM query failed (attempt {attempt+1}): {e}. Retrying in {wait}s")
                    time.sleep(wait)
                else:
                    raise RuntimeError(f"{tag}TNM API query failed after {MAX_RETRIES} attempts: {e}")

        items = data.get("items", [])
        if total is None:
            total = data.get("total", 0)
            logger.info(f"{tag}TNM reports {total} matching tiles")

        all_products.extend(items)

        if len(all_products) >= total or not items:
            break

        params["offset"] += params["max"]
        time.sleep(0.2)

    logger.info(f"{tag}Retrieved {len(all_products)} tile records")
    return all_products


def extract_download_url(product: dict) -> Optional[str]:
    """Extract the GeoTIFF download URL from a TNM product record."""
    url = product.get("downloadURL")
    if url and url.lower().endswith((".tif", ".tiff", ".img")):
        return url

    urls = product.get("urls", {})
    for fmt in ("TIFF", "GeoTIFF", "IMG"):
        if fmt in urls:
            return urls[fmt]

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
    label: str = "",
) -> List[str]:
    """Download all tiles in parallel. Returns paths of successfully downloaded files."""
    os.makedirs(tile_dir, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "Terranthro/1.0 (1m-dem-downloader)"})

    tasks = []
    seen_filenames = set()
    for i, product in enumerate(products):
        url = extract_download_url(product)
        if not url:
            logger.warning(f"No downloadable URL for product: {product.get('title', '?')}")
            continue
        source_id = product.get("sourceId", f"tile_{i:04d}")
        filename = f"{source_id}.tif"
        # Deduplicate in case same tile appears in multiple AVA queries
        if filename in seen_filenames:
            existing = os.path.join(tile_dir, filename)
            if os.path.exists(existing):
                tasks.append((url, existing, source_id, True))  # already exists
                continue
        seen_filenames.add(filename)
        tasks.append((url, os.path.join(tile_dir, filename), source_id, False))

    desc = f"Downloading ({label})" if label else "Downloading tiles"
    logger.info(f"[{label}] Downloading {len(tasks)} tiles with {workers} workers...")

    downloaded = []
    failed = 0

    # Separate already-existing tiles (from a previous partial run)
    to_download = [(url, path, sid) for url, path, sid, exists in tasks if not exists]
    already_have = [path for url, path, sid, exists in tasks if exists]
    downloaded.extend(already_have)
    if already_have:
        logger.info(f"[{label}] {len(already_have)} tiles already on disk — skipping re-download")

    if to_download:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(download_tile, url, path, session): (url, path)
                for url, path, _ in to_download
            }
            with tqdm(total=len(futures), desc=desc, unit="tile") as pbar:
                for future in as_completed(futures):
                    url, path = futures[future]
                    try:
                        if future.result():
                            downloaded.append(path)
                        else:
                            failed += 1
                    except Exception as e:
                        logger.error(f"Unexpected download error: {e}")
                        failed += 1
                    pbar.update(1)

    logger.info(f"[{label}] Downloaded {len(downloaded)} tiles, {failed} failed")
    return downloaded


# ---------------------------------------------------------------------------
# GDAL processing helpers
# ---------------------------------------------------------------------------


def build_vrt(tile_paths: List[str], vrt_path: str) -> str:
    """Build a GDAL VRT mosaic from a list of tile paths (no-op if list is empty)."""
    if not tile_paths:
        raise RuntimeError("Cannot build VRT from empty tile list")
    vrt_options = gdal.BuildVRTOptions(resampleAlg="nearest", srcNodata=NODATA)
    vrt = gdal.BuildVRT(vrt_path, tile_paths, options=vrt_options)
    if vrt is None:
        raise RuntimeError(f"gdal.BuildVRT returned None for {len(tile_paths)} tiles")
    vrt.FlushCache()
    vrt = None
    logger.info(f"Built VRT from {len(tile_paths)} tiles: {vrt_path}")
    return vrt_path


def warp_to_utm(
    input_path: str,
    output_path: str,
    resolution_m: float = 1.0,
) -> str:
    """
    Reproject to UTM zone 10N (EPSG:32610) at the specified metre resolution.
    Uses GDAL Warp with multithreading and tiled output.
    """
    warp_options = gdal.WarpOptions(
        format="GTiff",
        dstSRS="EPSG:32610",
        xRes=resolution_m,
        yRes=resolution_m,
        srcNodata=NODATA,
        dstNodata=NODATA,
        resampleAlg="bilinear",
        outputType=gdal.GDT_Float32,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
        multithread=True,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
    )
    gdal.Warp(output_path, input_path, options=warp_options)
    # Validate output
    ds = gdal.Open(output_path)
    if ds is None:
        raise RuntimeError(f"Warp produced no output at {output_path}")
    w, h = ds.RasterXSize, ds.RasterYSize
    ds = None
    logger.info(f"Warped to UTM: {output_path} ({w}x{h} px @ {resolution_m}m)")
    return output_path


def derive_slope(elevation_path: str, output_path: str) -> str:
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
    options = gdal.DEMProcessingOptions(
        format="GTiff",
        computeEdges=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=YES"],
    )
    gdal.DEMProcessing(output_path, elevation_path, "aspect", options=options)
    logger.info(f"Derived aspect: {output_path}")
    return output_path


def convert_to_cog(input_path: str, output_path: str) -> str:
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
    size_mb = Path(output_path).stat().st_size / 1_048_576
    logger.info(f"COG written: {output_path} ({size_mb:.1f} MB)")
    return output_path


def merge_vrts(utm_dem_paths: List[str], merged_vrt_path: str) -> str:
    """Merge multiple UTM GeoTIFFs into a single VRT (no resampling needed — same CRS/res)."""
    options = gdal.BuildVRTOptions(
        resampleAlg="nearest",
        srcNodata=NODATA,
        VRTNodata=NODATA,
    )
    vrt = gdal.BuildVRT(merged_vrt_path, utm_dem_paths, options=options)
    if vrt is None:
        raise RuntimeError("gdal.BuildVRT returned None for merge step")
    vrt.FlushCache()
    vrt = None
    logger.info(f"Merged {len(utm_dem_paths)} UTM DEMs into VRT: {merged_vrt_path}")
    return merged_vrt_path


# ---------------------------------------------------------------------------
# R2 upload
# ---------------------------------------------------------------------------


def upload_to_r2(
    local_path: str,
    r2_key: str,
    bucket: str,
    dry_run: bool = False,
    aws_profile: str = "r2-terranthro",
    account_id: str = "96e85f10dcee27dcd62d571f5f51fee8",
) -> bool:
    """
    Upload a file to Cloudflare R2 via the S3-compatible API using the AWS CLI.

    Uses `aws s3 cp` which supports multipart upload — required for files > 300 MiB
    (wrangler r2 object put has a 300 MiB limit and cannot handle the 2–3 GB COGs).

    Prerequisites:
      - AWS CLI installed (`aws --version`)
      - ~/.aws/credentials has an [r2-terranthro] profile with R2 Access Key ID / Secret
      - Profile endpoint is NOT set in credentials; we pass --endpoint-url at call time
    """
    size_mb = os.path.getsize(local_path) / 1_048_576
    action = "[DRY-RUN] Would upload" if dry_run else "Uploading"
    logger.info(f"{action}: {r2_key} ({size_mb:.1f} MB)")
    if dry_run:
        return True

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    cmd = [
        "aws", "s3", "cp",
        local_path,
        f"s3://{bucket}/{r2_key}",
        "--endpoint-url", endpoint,
        "--profile", aws_profile,
        "--content-type", "image/tiff",
        "--no-progress",
    ]
    for attempt in range(MAX_RETRIES):
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            logger.info(f"Uploaded: {r2_key}")
            return True
        wait = RETRY_BACKOFF ** (attempt + 1)
        logger.warning(
            f"Upload failed (attempt {attempt + 1}): {result.stderr.strip()}. "
            f"Retrying in {wait}s"
        )
        time.sleep(wait)

    logger.error(f"Failed to upload {r2_key} after {MAX_RETRIES} attempts")
    return False


# ---------------------------------------------------------------------------
# Per-AVA processing
# ---------------------------------------------------------------------------


def process_ava(
    slug: str,
    geojson_path: str,
    tile_dir: str,
    tmp_dir: str,
    workers: int,
) -> Optional[str]:
    """
    Download 1m DEM tiles for one AVA, warp to UTM, and return the path to
    the UTM elevation GeoTIFF (or None on failure).
    The slope/aspect are NOT derived here — that happens on the merged mosaic.
    """
    label = slug
    click.echo(f"\n  [{slug}] Loading boundary from {Path(geojson_path).name}...")

    try:
        bbox = load_ava_bbox(geojson_path, buffer=BBOX_BUFFER_DEG)
    except Exception as e:
        click.echo(f"  [{slug}] ERROR loading GeoJSON: {e}", err=True)
        return None

    west, south, east, north = bbox
    click.echo(f"  [{slug}] bbox: {west:.4f},{south:.4f},{east:.4f},{north:.4f}")

    # Check for cached tiles from a previous partial run
    ava_tile_dir = os.path.join(tile_dir, slug.replace("-", "_"))
    os.makedirs(ava_tile_dir, exist_ok=True)

    utm_path = os.path.join(tmp_dir, f"{slug.replace('-', '_')}_utm.tif")
    if os.path.exists(utm_path):
        click.echo(f"  [{slug}] UTM DEM already processed — reusing")
        return utm_path

    # Query TNM
    try:
        products = query_tnm_tiles(bbox, label=label)
    except Exception as e:
        click.echo(f"  [{slug}] TNM query failed: {e}", err=True)
        return None

    if not products:
        click.echo(f"  [{slug}] No 1m DEM tiles found — check TNM coverage for this area", err=True)
        return None

    # Download
    tile_paths = download_tiles_parallel(products, ava_tile_dir, workers=workers, label=label)
    if not tile_paths:
        click.echo(f"  [{slug}] All tile downloads failed", err=True)
        return None

    # Build VRT
    click.echo(f"  [{slug}] Building VRT from {len(tile_paths)} tiles...")
    vrt_path = os.path.join(tmp_dir, f"{slug.replace('-', '_')}_mosaic.vrt")
    try:
        build_vrt(tile_paths, vrt_path)
    except Exception as e:
        click.echo(f"  [{slug}] VRT failed: {e}", err=True)
        return None

    # Warp to UTM 1m
    click.echo(f"  [{slug}] Warping to UTM zone 10N at 1m...")
    try:
        warp_to_utm(vrt_path, utm_path, resolution_m=1.0)
    except Exception as e:
        click.echo(f"  [{slug}] Warp failed: {e}", err=True)
        return None

    return utm_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--avas",
    type=str,
    default=None,
    help=(
        "Comma-separated AVA slugs to process, or 'all' for every WV sub-AVA. "
        "Example: --avas chehalem-mountains,dundee-hills,yamhill-carlton\n"
        f"Available: {', '.join(WV_AVA_MAP)}"
    ),
)
@click.option(
    "--bbox",
    type=str,
    default=None,
    help="Alternative to --avas: supply a custom bbox 'west,south,east,north' directly.",
)
@click.option(
    "--geojson-dir",
    type=click.Path(exists=True),
    default=None,
    help="Directory containing AVA boundary GeoJSON files. "
         "Default: ../../public/data/ (relative to this script).",
)
@click.option(
    "--output-dir",
    type=click.Path(),
    default=None,
    help="Base directory for output COGs. Default: ../data/topography/",
)
@click.option(
    "--workers",
    type=int,
    default=4,
    show_default=True,
    help="Parallel download workers per AVA.",
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
    default="terranthro-cogs",
    show_default=True,
    help="R2 bucket name (S3-compatible, uses ~/.aws/credentials [r2-terranthro] profile).",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Query TNM and show tile counts but don't download or upload.",
)
@click.option(
    "--overwrite",
    is_flag=True,
    default=False,
    help="Overwrite existing willamette_valley_1m COG files.",
)
@click.option(
    "--keep-tiles",
    is_flag=True,
    default=False,
    help="Keep downloaded raw tiles after processing (default: delete with temp dir).",
)
def main(avas, bbox, geojson_dir, output_dir, workers, upload, bucket, dry_run, overwrite, keep_tiles):
    """
    Download USGS 1m LiDAR DEM tiles for specified Willamette Valley AVAs,
    merge them, derive slope and aspect, and write Cloud Optimized GeoTIFFs.

    Always outputs to willamette_valley_1m/ so the rest of the pipeline
    (compute-parcel-topo-stats.py, TiTiler) requires no changes.
    """
    script_dir = Path(__file__).resolve().parent

    # Resolve directories
    if geojson_dir is None:
        geojson_dir = str(script_dir / ".." / ".." / "public" / "data")
    if output_dir is None:
        output_dir = str(script_dir / ".." / "data" / "topography")

    geojson_dir = Path(geojson_dir).resolve()
    output_dir  = Path(output_dir).resolve()

    # Validate: must provide --avas or --bbox
    if not avas and not bbox:
        click.echo(
            "Error: provide --avas <slug,...> or --bbox <w,s,e,n>.\n"
            "  Quick start: --avas chehalem-mountains,dundee-hills,yamhill-carlton",
            err=True,
        )
        sys.exit(1)

    # Resolve AVA list
    if avas:
        if avas.strip().lower() == "all":
            ava_slugs = list(WV_AVA_MAP.keys())
        else:
            ava_slugs = [s.strip() for s in avas.split(",") if s.strip()]
        invalid = [s for s in ava_slugs if s not in WV_AVA_MAP]
        if invalid:
            click.echo(
                f"Error: unknown AVA slug(s): {', '.join(invalid)}\n"
                f"Available: {', '.join(WV_AVA_MAP)}",
                err=True,
            )
            sys.exit(1)
    else:
        ava_slugs = []  # bbox mode — no AVA-level processing

    # Output paths (always willamette_valley_1m)
    out_dir = output_dir / "OR" / "willamette_valley_1m"
    out_dir.mkdir(parents=True, exist_ok=True)

    products_needed = {
        "elevation": out_dir / "elevation.tif",
        "slope":     out_dir / "slope.tif",
        "aspect":    out_dir / "aspect.tif",
    }

    if not overwrite:
        existing = [n for n, p in products_needed.items() if p.exists()]
        if set(existing) == set(products_needed):
            # Validate CRS — existing files from a failed run may be in WGS84 (bad)
            # rather than UTM zone 10N (correct).
            invalid_crs = []
            for name, path in products_needed.items():
                try:
                    ds = gdal.Open(str(path))
                    if ds:
                        srs = ds.GetProjection()
                        ds = None
                        # UTM zone 10N contains "32610"; WGS84-only files do not
                        if "32610" not in srs:
                            invalid_crs.append(name)
                except Exception:
                    pass

            if invalid_crs:
                click.echo(
                    f"⚠️  Existing COGs are in the wrong CRS (not UTM zone 10N): "
                    f"{', '.join(invalid_crs)}\n"
                    f"   These are from a failed/partial previous run and will be replaced."
                )
                # Fall through — don't exit, let processing continue
            else:
                click.echo(
                    "All 3 COGs already exist at willamette_valley_1m/ and look valid. "
                    "Use --overwrite to regenerate."
                )
                sys.exit(0)
        if existing and set(existing) != set(products_needed):
            click.echo(f"Partial existing COGs (will overwrite): {', '.join(existing)}")

    # Header
    click.echo(f"\nWillamette Valley 1m LiDAR DEM Pipeline")
    if ava_slugs:
        click.echo(f"  AVAs:      {', '.join(ava_slugs)}")
    else:
        click.echo(f"  BBox:      {bbox}")
    click.echo(f"  Output:    {out_dir}")
    click.echo(f"  Workers:   {workers}")
    click.echo(f"  Upload:    {'yes → ' + bucket if upload else 'no'}")
    click.echo(f"  Dry run:   {dry_run}\n")

    # ── Dry-run: just show tile counts ────────────────────────────────────
    if dry_run:
        if ava_slugs:
            for slug in ava_slugs:
                entry = WV_AVA_MAP[slug]
                gj = geojson_dir / entry["geojson"]
                if not gj.exists():
                    click.echo(f"  [{slug}] GeoJSON not found: {gj}")
                    continue
                try:
                    bb = load_ava_bbox(str(gj))
                    tiles = query_tnm_tiles(bb, label=slug)
                    click.echo(f"  [{slug}] {len(tiles)} tiles in bbox "
                               f"{bb[0]:.4f},{bb[1]:.4f},{bb[2]:.4f},{bb[3]:.4f}")
                except Exception as e:
                    click.echo(f"  [{slug}] ERROR: {e}")
        else:
            parts = [float(x) for x in bbox.split(",")]
            tiles = query_tnm_tiles(tuple(parts))
            click.echo(f"  [custom bbox] {len(tiles)} tiles")
        sys.exit(0)

    # ── Main processing ───────────────────────────────────────────────────
    tile_cache_base = output_dir / "OR" / "_tile_cache"

    with tempfile.TemporaryDirectory(prefix="wv_1m_dem_") as tmp_dir:
        utm_dem_paths: List[str] = []

        if ava_slugs:
            # Per-AVA: download → warp → collect UTM DEMs
            click.echo(f"Processing {len(ava_slugs)} AVA(s)...")
            for slug in ava_slugs:
                entry = WV_AVA_MAP[slug]
                gj = geojson_dir / entry["geojson"]
                if not gj.exists():
                    click.echo(f"  [{slug}] GeoJSON not found: {gj} — skipping", err=True)
                    continue

                utm_path = process_ava(
                    slug=slug,
                    geojson_path=str(gj),
                    tile_dir=str(tile_cache_base),
                    tmp_dir=tmp_dir,
                    workers=workers,
                )
                if utm_path:
                    utm_dem_paths.append(utm_path)
                    click.echo(f"  [{slug}] ✓ UTM DEM ready")
                else:
                    click.echo(f"  [{slug}] ✗ Failed — skipping from merge", err=True)

        else:
            # BBox mode: single query/download → warp
            click.echo("Step 1: Querying TNM for tiles in custom bbox...")
            parts = [float(x) for x in bbox.split(",")]
            bb = tuple(parts)
            products = query_tnm_tiles(bb)
            if not products:
                click.echo("No tiles found.", err=True)
                sys.exit(1)

            tile_dir = str(tile_cache_base / "custom_bbox")
            tile_paths = download_tiles_parallel(products, tile_dir, workers=workers, label="custom")
            if not tile_paths:
                click.echo("All downloads failed.", err=True)
                sys.exit(1)

            vrt_path = os.path.join(tmp_dir, "custom_mosaic.vrt")
            build_vrt(tile_paths, vrt_path)

            utm_path = os.path.join(tmp_dir, "custom_utm.tif")
            warp_to_utm(vrt_path, utm_path, resolution_m=1.0)
            utm_dem_paths.append(utm_path)

        if not utm_dem_paths:
            click.echo("\nNo UTM DEMs produced — nothing to merge. Exiting.", err=True)
            sys.exit(1)

        # ── Merge all AVA UTM DEMs into one mosaic ─────────────────────────
        if len(utm_dem_paths) == 1:
            merged_elev_path = utm_dem_paths[0]
            click.echo(f"\nSingle AVA — skipping merge step")
        else:
            click.echo(f"\nMerging {len(utm_dem_paths)} UTM DEMs...")
            merged_vrt_path = os.path.join(tmp_dir, "merged_elevation.vrt")
            merge_vrts(utm_dem_paths, merged_vrt_path)
            merged_elev_path = merged_vrt_path

        # ── Derive slope and aspect from the merged DEM ────────────────────
        click.echo("Deriving slope...")
        slope_path = os.path.join(tmp_dir, "slope_utm.tif")
        derive_slope(merged_elev_path, slope_path)

        click.echo("Deriving aspect...")
        aspect_path = os.path.join(tmp_dir, "aspect_utm.tif")
        derive_aspect(merged_elev_path, aspect_path)

        # ── Convert all three to COG ────────────────────────────────────────
        click.echo("\nConverting to Cloud Optimized GeoTIFFs...")
        click.echo("  elevation.tif")
        convert_to_cog(merged_elev_path, str(products_needed["elevation"]))
        click.echo("  slope.tif")
        convert_to_cog(slope_path, str(products_needed["slope"]))
        click.echo("  aspect.tif")
        convert_to_cog(aspect_path, str(products_needed["aspect"]))

        # Tile cache cleanup
        if not keep_tiles and tile_cache_base.exists():
            import shutil
            shutil.rmtree(str(tile_cache_base), ignore_errors=True)
            click.echo("Cleaned up tile cache.")

    # ── Upload to R2 ──────────────────────────────────────────────────────
    if upload:
        click.echo("\nUploading COGs to Cloudflare R2...")
        all_ok = True
        for name, path in products_needed.items():
            if path.exists():
                ok = upload_to_r2(str(path), f"{R2_PREFIX}/{name}.tif", bucket)
                if not ok:
                    all_ok = False
        if not all_ok:
            click.echo("Warning: some uploads failed — COGs are saved locally.")
    else:
        click.echo("\nSkipping R2 upload (--no-upload).")

    # ── Summary ────────────────────────────────────────────────────────────
    click.echo("\n" + "=" * 60)
    click.echo("Pipeline complete!")
    for name, path in products_needed.items():
        size = f" ({path.stat().st_size / 1_073_741_824:.2f} GB)" if path.exists() else " (missing!)"
        click.echo(f"  {name}: {path}{size}")
    click.echo("=" * 60)


if __name__ == "__main__":
    main()
