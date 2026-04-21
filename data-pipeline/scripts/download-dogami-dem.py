"""
DOGAMI LiDAR DEM Downloader for Willamette Valley
===================================================
Downloads bare-earth DEMs from DOGAMI's ArcGIS ImageServer, which has complete
1m LiDAR-derived coverage of the Willamette Valley at 3m mosaic resolution.

Use this when USGS 3DEP 1m tiles (download-1m-dem.py) don't cover an AVA.
DOGAMI data is 3m resolution but covers the entire WV with no gaps.

DOGAMI ImageServer:
    https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer

Approach:
    - For each AVA (or combined WV bbox), reproject bbox WGS84 → Oregon LCC
    - Call exportImage to get a Float32 GeoTIFF at 3m resolution
    - GDAL warp to UTM Zone 10N (EPSG:32610) at 3m to match existing pipeline
    - Derive slope and aspect with gdal.DEMProcessing
    - Convert to COG and upload to R2

Output (default, separate from TNM 1m COGs so we don't clobber USGS data):
    {output_dir}/OR/willamette_valley_dogami/elevation.tif
    {output_dir}/OR/willamette_valley_dogami/slope.tif
    {output_dir}/OR/willamette_valley_dogami/aspect.tif

Usage:
    # Download all 3 core AVAs, no upload:
    python download-dogami-dem.py --avas chehalem-mountains,dundee-hills,yamhill-carlton --no-upload

    # All 11 WV sub-AVAs (full valley):
    python download-dogami-dem.py --avas all

    # Single AVA:
    python download-dogami-dem.py --avas dundee-hills --no-upload

    # Custom bbox (west,south,east,north):
    python download-dogami-dem.py --bbox "-123.5,45.1,-122.8,45.6"

    # Dry run — show bboxes without downloading:
    python download-dogami-dem.py --avas dundee-hills --dry-run
"""

import os
import sys
import json
import time
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import requests
from osgeo import gdal, osr

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DOGAMI_IMAGESERVER = (
    "https://gis.dogami.oregon.gov/arcgis/rest/services/"
    "lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer/exportImage"
)
DOGAMI_SR = 102970       # Oregon Lambert Conformal Conic (EPSG:102970)
DOGAMI_PIXEL_SIZE = 3    # native mosaic resolution: 3 FEET/pixel (~0.9m)
                         # — Oregon LCC linear unit is foot, not meter.
TARGET_CRS = "EPSG:32610"  # UTM Zone 10N — matches existing pipeline
OUTPUT_PIXEL_SIZE = 3    # UTM 10N output resolution in METERS (matches TNM pipeline)
FT_TO_M = 0.3048

NODATA = -9999.0
MAX_EXPORT_PIXELS = 2_500   # empirical DOGAMI ceiling — requests ≥3000px
                            # return HTTP 500. 2500×2500 = ~25MB and works.
                            # (Stated maxImageHeight is 120000 but the server
                            # can't actually produce tiles that large.)
BBOX_BUFFER_DEG = 0.01   # ~1km buffer for edge-artifact-free slope/aspect
MAX_RETRIES = 3
RETRY_BACKOFF = 2
REQUEST_TIMEOUT = 300

# R2 upload target — separate key from USGS TNM 1m so compute script can
# prefer USGS where it has data and fall back to DOGAMI.
R2_PREFIX = "topography-data/OR/willamette_valley_dogami"
OUTPUT_FOLDER_NAME = "willamette_valley_dogami"

WV_AVA_MAP: Dict[str, Dict] = {
    "chehalem-mountains":       {"geojson": "chehalem_mountains.geojson",       "folder": "chehalem_mountains"},
    "dundee-hills":             {"geojson": "dundee_hills.geojson",             "folder": "dundee_hills"},
    "eola-amity-hills":         {"geojson": "eola_amity_hills.geojson",         "folder": "eola_amity_hills"},
    "laurelwood-district":      {"geojson": "laurelwood_district.geojson",      "folder": "laurelwood_district"},
    "lower-long-tom":           {"geojson": "lower_long_tom.geojson",           "folder": "lower_long_tom"},
    "mcminnville":              {"geojson": "mcminnville.geojson",              "folder": "mcminnville"},
    "mount-pisgah-polk-county": {"geojson": "mount_pisgah_polk_county.geojson", "folder": "mount_pisgah_polk_county"},
    "ribbon-ridge":             {"geojson": "ribbon_ridge.geojson",             "folder": "ribbon_ridge"},
    "tualatin-hills":           {"geojson": "tualatin_hills.geojson",           "folder": "tualatin_hills"},
    "van-duzer-corridor":       {"geojson": "van_duzer_corridor.geojson",       "folder": "van_duzer_corridor"},
    "yamhill-carlton":          {"geojson": "yamhill_carlton.geojson",          "folder": "yamhill_carlton"},
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
# Coordinate helpers
# ---------------------------------------------------------------------------


def wgs84_to_oregon_lcc(west: float, south: float, east: float, north: float) -> Tuple[float, float, float, float]:
    """Reproject WGS84 bbox corners to Oregon LCC (EPSG:102970)."""
    src = osr.SpatialReference()
    src.ImportFromEPSG(4326)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    dst = osr.SpatialReference()
    dst.ImportFromEPSG(DOGAMI_SR)

    ct = osr.CoordinateTransformation(src, dst)

    # Transform all four corners and take envelope
    corners = [
        ct.TransformPoint(west, south),
        ct.TransformPoint(east, south),
        ct.TransformPoint(west, north),
        ct.TransformPoint(east, north),
    ]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    return min(xs), min(ys), max(xs), max(ys)


def load_ava_bbox(geojson_path: str, buffer: float = BBOX_BUFFER_DEG) -> Tuple[float, float, float, float]:
    """Read GeoJSON and return buffered WGS84 bounding box (west, south, east, north)."""
    with open(geojson_path) as f:
        data = json.load(f)

    coords: List[Tuple[float, float]] = []

    def collect(obj):
        t = obj.get("type", "")
        if t == "FeatureCollection":
            for feat in obj.get("features", []):
                collect(feat)
        elif t == "Feature":
            collect(obj.get("geometry", {}))
        elif t == "Polygon":
            for ring in obj.get("coordinates", []):
                coords.extend(ring)
        elif t == "MultiPolygon":
            for poly in obj.get("coordinates", []):
                for ring in poly:
                    coords.extend(ring)

    collect(data)
    if not coords:
        raise ValueError(f"No coordinates found in {geojson_path}")

    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lons) - buffer, min(lats) - buffer, max(lons) + buffer, max(lats) + buffer


def union_bboxes(boxes: List[Tuple[float, float, float, float]]) -> Tuple[float, float, float, float]:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


# ---------------------------------------------------------------------------
# DOGAMI download
# ---------------------------------------------------------------------------


def download_dogami_tile(
    bbox_lcc: Tuple[float, float, float, float],
    output_path: str,
    dry_run: bool = False,
) -> bool:
    """
    Download a single tile from DOGAMI's ImageServer.
    bbox_lcc: (xmin, ymin, xmax, ymax) in Oregon LCC (EPSG:102970).
    Returns True on success.
    """
    xmin, ymin, xmax, ymax = bbox_lcc
    width_ft = xmax - xmin
    height_ft = ymax - ymin
    width_km = width_ft * FT_TO_M / 1000
    height_km = height_ft * FT_TO_M / 1000

    # Compute pixel dimensions at native 3-ft resolution
    px_w = min(int(width_ft / DOGAMI_PIXEL_SIZE) + 1, MAX_EXPORT_PIXELS)
    px_h = min(int(height_ft / DOGAMI_PIXEL_SIZE) + 1, MAX_EXPORT_PIXELS)

    # If area is larger than MAX_EXPORT_PIXELS, we'd need to tile — log a warning
    if (width_ft / DOGAMI_PIXEL_SIZE) > MAX_EXPORT_PIXELS or (height_ft / DOGAMI_PIXEL_SIZE) > MAX_EXPORT_PIXELS:
        logger.warning(
            f"Requested area ({width_km:.1f}km × {height_km:.1f}km) exceeds "
            f"{MAX_EXPORT_PIXELS}px limit at 3ft. Output will be at reduced resolution. "
            f"Consider splitting into smaller AVAs."
        )

    params = {
        "bbox":        f"{xmin},{ymin},{xmax},{ymax}",
        "bboxSR":      DOGAMI_SR,
        "imageSR":     DOGAMI_SR,
        "size":        f"{px_w},{px_h}",
        "format":      "tiff",
        "pixelType":   "F32",
        "noData":      NODATA,
        "noDataInterpretation": "esriNoDataMatchAny",
        "interpolation": "RSP_BilinearInterpolation",
        "f":           "image",
    }

    size_mb_est = px_w * px_h * 4 / 1_048_576
    logger.info(
        f"Requesting DOGAMI tile: {px_w}×{px_h}px "
        f"({width_km:.1f}km × {height_km:.1f}km) ~{size_mb_est:.0f}MB"
    )

    if dry_run:
        logger.info(f"[DRY RUN] Would write to: {output_path}")
        return True

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(
                DOGAMI_IMAGESERVER,
                params=params,
                timeout=REQUEST_TIMEOUT,
                stream=True,
            )
            resp.raise_for_status()
            content_type = resp.headers.get("Content-Type", "")
            if "image" not in content_type and "tiff" not in content_type:
                logger.error(f"Unexpected content-type: {content_type}. Body: {resp.text[:300]}")
                return False

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1_048_576):
                    f.write(chunk)
            size_mb = Path(output_path).stat().st_size / 1_048_576
            logger.info(f"Downloaded: {output_path} ({size_mb:.1f} MB)")
            return True

        except requests.RequestException as e:
            wait = RETRY_BACKOFF ** (attempt + 1)
            logger.warning(f"Attempt {attempt+1}/{MAX_RETRIES} failed: {e}. Retrying in {wait}s")
            time.sleep(wait)

    logger.error(f"Failed to download DOGAMI tile after {MAX_RETRIES} attempts")
    return False


# ---------------------------------------------------------------------------
# Raster processing (warp → slope → aspect → COG)
# ---------------------------------------------------------------------------


def warp_to_utm(input_path: str, output_path: str) -> str:
    """
    Reproject a DOGAMI Oregon LCC GeoTIFF to UTM Zone 10N (EPSG:32610) at 3m.
    """
    logger.info(f"Warping {Path(input_path).name} → UTM 10N @ {OUTPUT_PIXEL_SIZE}m …")
    opts = gdal.WarpOptions(
        format="GTiff",
        srcSRS=f"EPSG:{DOGAMI_SR}",
        dstSRS=TARGET_CRS,
        xRes=OUTPUT_PIXEL_SIZE,
        yRes=OUTPUT_PIXEL_SIZE,
        targetAlignedPixels=True,  # snap extent to multiples of xRes/yRes so
                                   # adjacent tiles line up perfectly in the VRT
        resampleAlg=gdal.GRA_Bilinear,
        srcNodata=NODATA,
        dstNodata=NODATA,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
        multithread=True,
        warpOptions=["NUM_THREADS=ALL_CPUS"],
    )
    ds = gdal.Warp(output_path, input_path, options=opts)
    if ds is None:
        raise RuntimeError(f"gdal.Warp failed: {input_path} → {output_path}")
    ds.FlushCache()
    ds = None
    mb = Path(output_path).stat().st_size / 1_048_576
    logger.info(f"Warped: {output_path} ({mb:.1f} MB)")
    return output_path


def derive_slope(dem_path: str, slope_path: str) -> str:
    """Derive slope (degrees) from a DEM using GDAL."""
    logger.info("Deriving slope …")
    opts = gdal.DEMProcessingOptions(
        slopeFormat="degree",
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
    )
    ds = gdal.DEMProcessing(slope_path, dem_path, "slope", options=opts)
    if ds is None:
        raise RuntimeError(f"gdal.DEMProcessing (slope) failed")
    ds.FlushCache(); ds = None
    logger.info(f"Slope: {slope_path} ({Path(slope_path).stat().st_size/1_048_576:.1f} MB)")
    return slope_path


def derive_aspect(dem_path: str, aspect_path: str) -> str:
    """Derive aspect (0–360°) from a DEM using GDAL."""
    logger.info("Deriving aspect …")
    opts = gdal.DEMProcessingOptions(
        zeroForFlat=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
    )
    ds = gdal.DEMProcessing(aspect_path, dem_path, "aspect", options=opts)
    if ds is None:
        raise RuntimeError(f"gdal.DEMProcessing (aspect) failed")
    ds.FlushCache(); ds = None
    logger.info(f"Aspect: {aspect_path} ({Path(aspect_path).stat().st_size/1_048_576:.1f} MB)")
    return aspect_path


def convert_to_cog(input_path: str, output_path: str) -> str:
    """Convert a GeoTIFF to Cloud Optimized GeoTIFF."""
    logger.info(f"Converting {Path(input_path).name} → COG …")
    opts = gdal.TranslateOptions(
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE",
            "BLOCKSIZE=512",
            "OVERVIEWS=AUTO",
            "OVERVIEW_RESAMPLING=BILINEAR",
        ],
    )
    ds = gdal.Translate(output_path, input_path, options=opts)
    if ds is None:
        raise RuntimeError(f"gdal.Translate (COG) failed: {input_path}")
    ds.FlushCache(); ds = None
    mb = Path(output_path).stat().st_size / 1_048_576
    logger.info(f"COG written: {output_path} ({mb:.1f} MB)")
    return output_path


def convert_feet_to_meters(input_path: str, output_path: str) -> str:
    """
    DOGAMI elevation values are in FEET (raster values themselves, independent
    of coordinate system). We need meters for the downstream pipeline so slope
    derivation produces rise/run in consistent units (and so compute-parcel-
    topo-stats.py's meters→feet conversion works).

    Writes a scaled copy: new_val = old_val * 0.3048 (with nodata preserved).
    """
    logger.info(f"Converting pixel values feet → meters: {Path(input_path).name}")
    src = gdal.Open(input_path)
    if src is None:
        raise RuntimeError(f"Failed to open {input_path}")
    band = src.GetRasterBand(1)
    arr = band.ReadAsArray()
    nodata = band.GetNoDataValue()

    import numpy as np
    mask = (arr == nodata) if nodata is not None else None
    arr = arr * FT_TO_M
    if mask is not None:
        arr[mask] = nodata if nodata is not None else NODATA

    driver = gdal.GetDriverByName("GTiff")
    dst = driver.Create(
        output_path,
        src.RasterXSize, src.RasterYSize, 1, gdal.GDT_Float32,
        options=["COMPRESS=DEFLATE", "TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512"],
    )
    dst.SetGeoTransform(src.GetGeoTransform())
    dst.SetProjection(src.GetProjection())
    dband = dst.GetRasterBand(1)
    dband.SetNoDataValue(nodata if nodata is not None else NODATA)
    dband.WriteArray(arr)
    dst.FlushCache()
    dst = None; src = None
    logger.info(f"Converted to meters: {output_path}")
    return output_path


def merge_dems_vrt(dem_paths: List[str], vrt_path: str) -> str:
    """Merge multiple UTM DEMs into a VRT."""
    opts = gdal.BuildVRTOptions(resampleAlg="bilinear", srcNodata=NODATA, VRTNodata=NODATA)
    vrt = gdal.BuildVRT(vrt_path, dem_paths, options=opts)
    if vrt is None:
        raise RuntimeError("gdal.BuildVRT returned None")
    vrt.FlushCache(); vrt = None
    logger.info(f"Merged {len(dem_paths)} DEM(s) into VRT: {vrt_path}")
    return vrt_path


# ---------------------------------------------------------------------------
# R2 upload (rclone — same approach as upload-cogs-to-r2.py)
# ---------------------------------------------------------------------------


def upload_to_r2(local_path: str, r2_key: str, bucket: str, dry_run: bool = False) -> bool:
    size_mb = Path(local_path).stat().st_size / 1_048_576
    action = "[DRY-RUN] Would upload" if dry_run else "Uploading"
    logger.info(f"{action}: {r2_key} ({size_mb:.1f} MB)")
    if dry_run:
        return True

    dest = f"r2:{bucket}/{r2_key}"
    cmd = [
        "rclone", "copyto", local_path, dest,
        "--s3-chunk-size", "200M",
        "--transfers", "1",
        "--s3-upload-concurrency", "1",
        "--s3-no-check-bucket",
        "--progress",
    ]
    result = subprocess.run(cmd)
    if result.returncode == 0:
        logger.info(f"Uploaded: {r2_key}")
        return True
    logger.error(f"rclone upload failed for {r2_key}")
    return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--avas",
    type=str,
    default="chehalem-mountains,dundee-hills,yamhill-carlton",
    show_default=True,
    help="Comma-separated AVA slugs to download, or 'all' for all 11 WV sub-AVAs.",
)
@click.option(
    "--bbox",
    type=str,
    default=None,
    help="Custom bbox 'west,south,east,north' in WGS84. Overrides --avas.",
)
@click.option(
    "--geojson-dir",
    type=click.Path(exists=True),
    default=None,
    help="Directory containing AVA GeoJSON files. Default: ../../public/data/",
)
@click.option(
    "--output-dir",
    type=click.Path(),
    default=None,
    help="Base output directory. Default: ../data/topography/",
)
@click.option(
    "--upload/--no-upload",
    default=True,
    show_default=True,
    help="Upload finished COGs to Cloudflare R2 via rclone.",
)
@click.option(
    "--bucket",
    type=str,
    default="terranthro-cogs",
    show_default=True,
    help="R2 bucket name.",
)
@click.option(
    "--overwrite",
    is_flag=True,
    default=False,
    help="Re-download and reprocess even if output COGs already exist.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Show what would be downloaded without actually downloading.",
)
def main(avas, bbox, geojson_dir, output_dir, upload, bucket, overwrite, dry_run):
    """
    Download DOGAMI LiDAR DEMs for WV AVAs and produce elevation/slope/aspect COGs.
    DOGAMI provides complete 3m coverage where USGS 1m tiles are absent.
    """
    script_dir = Path(__file__).resolve().parent

    if geojson_dir is None:
        geojson_dir = script_dir / ".." / ".." / "public" / "data"
    geojson_dir = Path(geojson_dir).resolve()

    if output_dir is None:
        output_dir = script_dir / ".." / "data" / "topography"
    output_dir = Path(output_dir).resolve()

    final_dir = output_dir / "OR" / OUTPUT_FOLDER_NAME
    final_dir.mkdir(parents=True, exist_ok=True)

    click.echo(f"\nDOGAMI LiDAR DEM Download")
    click.echo(f"  Output:   {final_dir}")
    click.echo(f"  Upload:   {'yes → ' + bucket if upload else 'no'}")
    click.echo(f"  Dry run:  {dry_run}\n")

    # ── Resolve bounding box(es) ──────────────────────────────────────────────

    if bbox:
        try:
            w, s, e, n = [float(x) for x in bbox.split(",")]
        except ValueError:
            click.echo("Error: --bbox must be 'west,south,east,north'", err=True)
            sys.exit(1)
        combined_bbox_wgs84 = (w, s, e, n)
        label = f"custom bbox ({w},{s},{e},{n})"
    else:
        ava_list = list(WV_AVA_MAP.keys()) if avas.lower() == "all" else [a.strip() for a in avas.split(",")]
        invalid = [a for a in ava_list if a not in WV_AVA_MAP]
        if invalid:
            click.echo(f"Unknown AVAs: {', '.join(invalid)}. Valid: {', '.join(WV_AVA_MAP)}", err=True)
            sys.exit(1)

        boxes = []
        for slug in ava_list:
            gjson = geojson_dir / WV_AVA_MAP[slug]["geojson"]
            if not gjson.exists():
                click.echo(f"GeoJSON not found: {gjson}", err=True)
                sys.exit(1)
            boxes.append(load_ava_bbox(str(gjson)))
            click.echo(f"  AVA: {slug}")

        combined_bbox_wgs84 = union_bboxes(boxes)
        label = ", ".join(ava_list)

    w, s, e, n = combined_bbox_wgs84
    click.echo(f"\n  Combined WGS84 bbox: W={w:.4f} S={s:.4f} E={e:.4f} N={n:.4f}")

    # ── Check existing COGs ───────────────────────────────────────────────────

    final_elev = final_dir / "elevation.tif"
    final_slope = final_dir / "slope.tif"
    final_aspect = final_dir / "aspect.tif"

    if final_elev.exists() and final_slope.exists() and final_aspect.exists() and not overwrite:
        click.echo(f"\nCOGs already exist in {final_dir}")
        click.echo("Use --overwrite to replace them.")
        sys.exit(0)

    # Put tmp dir on the same filesystem as the output so we don't run out of
    # space on the system volume (raw + warped + slope + aspect can easily
    # exceed 10GB during processing).
    tmp_parent = output_dir / "_tmp"
    tmp_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="dogami_dem_", dir=str(tmp_parent)) as tmp:
        tmp = Path(tmp)

        # ── Step 1: Download from DOGAMI ImageServer ──────────────────────────

        # Reproject combined bbox to Oregon LCC for DOGAMI API
        bbox_lcc = wgs84_to_oregon_lcc(w, s, e, n)
        xmin, ymin, xmax, ymax = bbox_lcc
        area_km_w = (xmax - xmin) * FT_TO_M / 1000
        area_km_h = (ymax - ymin) * FT_TO_M / 1000
        click.echo(f"  Oregon LCC bbox (feet): {xmin:.0f},{ymin:.0f},{xmax:.0f},{ymax:.0f}")
        click.echo(f"  Area: {area_km_w:.1f}km × {area_km_h:.1f}km @ {DOGAMI_PIXEL_SIZE}ft (~0.9m) native\n")

        raw_lcc_path = str(tmp / "raw_dogami_lcc.tif")

        # Large areas need tiling — check if single request works
        width_px = int((xmax - xmin) / DOGAMI_PIXEL_SIZE)
        height_px = int((ymax - ymin) / DOGAMI_PIXEL_SIZE)

        if width_px <= MAX_EXPORT_PIXELS and height_px <= MAX_EXPORT_PIXELS:
            # Single request covers the whole area
            ok = download_dogami_tile(bbox_lcc, raw_lcc_path, dry_run=dry_run)
            if not ok:
                click.echo("DOGAMI download failed.", err=True)
                sys.exit(1)
            raw_paths = [raw_lcc_path]
        else:
            # Tile the request into a grid of MAX_EXPORT_PIXELS chunks
            tile_w = MAX_EXPORT_PIXELS * DOGAMI_PIXEL_SIZE
            tile_h = MAX_EXPORT_PIXELS * DOGAMI_PIXEL_SIZE
            import math
            n_cols = math.ceil((xmax - xmin) / tile_w)
            n_rows = math.ceil((ymax - ymin) / tile_h)
            total_tiles = n_cols * n_rows
            click.echo(
                f"Area too large for single request ({width_px}×{height_px}px). "
                f"Splitting into {n_cols}×{n_rows} = {total_tiles} tiles …"
            )
            raw_paths = []
            tile_idx = 0
            y = ymin
            while y < ymax:
                x = xmin
                while x < xmax:
                    tile_xmax = min(x + tile_w, xmax)
                    tile_ymax = min(y + tile_h, ymax)
                    tile_path = str(tmp / f"tile_{tile_idx:04d}.tif")
                    click.echo(f"  [tile {tile_idx+1}/{total_tiles}]")
                    ok = download_dogami_tile((x, y, tile_xmax, tile_ymax), tile_path, dry_run=dry_run)
                    if not ok and not dry_run:
                        click.echo(f"Tile {tile_idx} failed — aborting so we don't build a DEM with holes.", err=True)
                        sys.exit(1)
                    if ok:
                        raw_paths.append(tile_path)
                    tile_idx += 1
                    x += tile_w
                y += tile_h

        if dry_run:
            click.echo("\n[DRY RUN] Would proceed with warp → slope → aspect → COG → upload.")
            sys.exit(0)

        # ── Step 2: Warp each tile to UTM 10N ────────────────────────────────

        utm_paths = []
        for i, raw_path in enumerate(raw_paths):
            utm_path = str(tmp / f"utm_{i:04d}.tif")
            warp_to_utm(raw_path, utm_path)
            utm_paths.append(utm_path)

        # ── Step 2b: Convert pixel values feet → meters ─────────────────────
        # DOGAMI serves elevation in feet; we need meters to match the USGS
        # pipeline and so slope/aspect derivation works in consistent units.

        meter_paths = []
        for i, utm_path in enumerate(utm_paths):
            m_path = str(tmp / f"utm_m_{i:04d}.tif")
            convert_feet_to_meters(utm_path, m_path)
            meter_paths.append(m_path)

        # ── Step 3: Merge meter-unit tiles into VRT ──────────────────────────

        if len(meter_paths) == 1:
            merged_dem = meter_paths[0]
        else:
            vrt_path = str(tmp / "merged.vrt")
            merged_dem = merge_dems_vrt(meter_paths, vrt_path)

        # ── Step 4: Derive slope and aspect ──────────────────────────────────

        slope_tmp  = str(tmp / "slope_tmp.tif")
        aspect_tmp = str(tmp / "aspect_tmp.tif")
        derive_slope(merged_dem, slope_tmp)
        derive_aspect(merged_dem, aspect_tmp)

        # ── Step 5: Convert all three to COG ────────────────────────────────

        click.echo("\nConverting to Cloud Optimized GeoTIFFs …")
        convert_to_cog(merged_dem, str(final_elev))
        convert_to_cog(slope_tmp,  str(final_slope))
        convert_to_cog(aspect_tmp, str(final_aspect))

    # ── Step 6: Upload to R2 ─────────────────────────────────────────────────

    if upload:
        click.echo("\nUploading to R2 …")
        for layer, path in [("elevation", final_elev), ("slope", final_slope), ("aspect", final_aspect)]:
            ok = upload_to_r2(str(path), f"{R2_PREFIX}/{layer}.tif", bucket)
            if not ok:
                click.echo(f"Warning: upload failed for {layer}.tif", err=True)
    else:
        click.echo("\nSkipping R2 upload (--no-upload).")

    click.echo("\n✓ DOGAMI pipeline complete!")
    click.echo(f"  elevation: {final_elev} ({final_elev.stat().st_size/1_048_576:.1f} MB)")
    click.echo(f"  slope:     {final_slope} ({final_slope.stat().st_size/1_048_576:.1f} MB)")
    click.echo(f"  aspect:    {final_aspect} ({final_aspect.stat().st_size/1_048_576:.1f} MB)")


if __name__ == "__main__":
    main()
