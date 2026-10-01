"""
Per-Block Topography Statistics Compute Script
================================================
Mirror of compute-parcel-topo-stats.py but operates on vineyard_blocks.geometry
and writes to vineyard_block_topo_stats.

Prerequisite:
    - download-1m-dem.py and/or download-dogami-dem.py have been run
    - Migrations 011_block_geometry_acres.sql and
      012_vineyard_block_topo_stats.sql have been applied
    - vineyard_blocks rows have geometry populated (NULL geometry rows are skipped)
    - DATABASE_URL (or DB_* vars) are set in environment

Usage:
    python compute-block-topo-stats.py
    python compute-block-topo-stats.py --dry-run
    python compute-block-topo-stats.py --block-ids 1,2,3
    python compute-block-topo-stats.py --workers 8 --cog-dir /path/to/topography
"""

import os
import sys
import math
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, List, Tuple

import click
import numpy as np
import psycopg2
import psycopg2.extras
import rasterio
from rasterio.features import geometry_mask, bounds as feature_bounds
from rasterio.warp import transform_geom
from rasterio.windows import from_bounds as window_from_bounds, Window
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Elevation rasters are stored in FEET; horizontal grid is metres (UTM). To get
# slope in degrees, the metre pixel run is expressed in feet via this factor
# (equivalent to gdaldem -s 3.28084). Aspect is direction-only, unit-free.
FT_PER_M = 3.28084
NODATA = -9999.0

COMPASS_LABELS_16 = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def degrees_to_compass(deg: float) -> str:
    if deg < 0:
        return "Flat"
    idx = int((deg + 11.25) / 22.5) % 16
    return COMPASS_LABELS_16[idx]


def dominant_aspect(aspect_data: np.ndarray) -> Tuple[float, str]:
    valid = aspect_data[aspect_data > 0]
    if len(valid) == 0:
        return -1.0, "Flat"
    bin_edges = np.arange(0, 361, 22.5)
    bin_centroids = bin_edges[:-1] + 11.25
    counts, _ = np.histogram(valid, bins=bin_edges)
    dominant_idx = int(np.argmax(counts))
    return float(bin_centroids[dominant_idx]), COMPASS_LABELS_16[dominant_idx]


def circular_mean(angles_deg: np.ndarray) -> float:
    if len(angles_deg) == 0:
        return -1.0
    rad = np.deg2rad(angles_deg)
    sin_mean = np.mean(np.sin(rad))
    cos_mean = np.mean(np.cos(rad))
    mean_rad = np.arctan2(sin_mean, cos_mean)
    return float(np.rad2deg(mean_rad)) % 360


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_db_connection():
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return psycopg2.connect(dsn)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ.get("DB_NAME", "terranthro"),
        user=os.environ.get("DB_USER", "postgres"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def fetch_blocks(conn, block_ids: Optional[List[int]] = None) -> List[dict]:
    """
    Fetch vineyard block geometries. Skips rows with NULL geometry.
    Returns list of {id, vineyard_name, block_name, geom} dicts.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if block_ids:
            cur.execute(
                """
                SELECT id, vineyard_name, block_name,
                       ST_AsGeoJSON(ST_Transform(geometry, 4326))::json AS geom
                FROM vineyard_blocks
                WHERE geometry IS NOT NULL
                  AND id = ANY(%s)
                ORDER BY id
                """,
                (block_ids,),
            )
        else:
            cur.execute(
                """
                SELECT id, vineyard_name, block_name,
                       ST_AsGeoJSON(ST_Transform(geometry, 4326))::json AS geom
                FROM vineyard_blocks
                WHERE geometry IS NOT NULL
                ORDER BY id
                """
            )
        return [dict(row) for row in cur.fetchall()]


def upsert_stats(conn, stats_row: dict, dry_run: bool = False) -> None:
    if dry_run:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO vineyard_block_topo_stats (
                block_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
                elevation_std_ft, slope_mean_deg, slope_max_deg, slope_p10_deg,
                slope_p90_deg, aspect_dominant_deg, aspect_mean_deg,
                pixel_count, data_source, computed_at
            ) VALUES (
                %(block_id)s, %(elevation_min_ft)s, %(elevation_max_ft)s,
                %(elevation_mean_ft)s, %(elevation_std_ft)s, %(slope_mean_deg)s,
                %(slope_max_deg)s, %(slope_p10_deg)s, %(slope_p90_deg)s,
                %(aspect_dominant_deg)s, %(aspect_mean_deg)s,
                %(pixel_count)s, %(data_source)s, NOW()
            )
            ON CONFLICT (block_id) DO UPDATE SET
                elevation_min_ft    = EXCLUDED.elevation_min_ft,
                elevation_max_ft    = EXCLUDED.elevation_max_ft,
                elevation_mean_ft   = EXCLUDED.elevation_mean_ft,
                elevation_std_ft    = EXCLUDED.elevation_std_ft,
                slope_mean_deg      = EXCLUDED.slope_mean_deg,
                slope_max_deg       = EXCLUDED.slope_max_deg,
                slope_p10_deg       = EXCLUDED.slope_p10_deg,
                slope_p90_deg       = EXCLUDED.slope_p90_deg,
                aspect_dominant_deg = EXCLUDED.aspect_dominant_deg,
                aspect_mean_deg     = EXCLUDED.aspect_mean_deg,
                pixel_count         = EXCLUDED.pixel_count,
                data_source         = EXCLUDED.data_source,
                computed_at         = NOW()
            """,
            stats_row,
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Per-block stats computation
# ---------------------------------------------------------------------------


def slope_aspect_horn(z: np.ndarray, res_m: float, nodata) -> Tuple[np.ndarray, np.ndarray]:
    """
    Derive slope (degrees) and aspect (GDAL convention: 0=N clockwise, flat=-1)
    from an elevation window using Horn's 3x3 method — the same algorithm gdaldem
    uses. Elevation is FEET; the metre pixel run is expressed in feet so the
    rise/run ratio is unit-consistent (equiv. gdaldem -s 3.28084). Edges are
    replicated (like computeEdges). nodata pixels become NaN and propagate.
    """
    z = z.astype("float64")
    if nodata is not None:
        z = np.where(z == nodata, np.nan, z)
    run = res_m * FT_PER_M  # pixel size in feet (matches feet elevation)
    zp = np.pad(z, 1, mode="edge")
    nw, n, ne = zp[:-2, :-2], zp[:-2, 1:-1], zp[:-2, 2:]
    w,      e = zp[1:-1, :-2],                zp[1:-1, 2:]
    sw, s, se = zp[2:, :-2],  zp[2:, 1:-1],   zp[2:, 2:]
    dzdx = ((ne + 2 * e + se) - (nw + 2 * w + sw)) / (8 * run)
    dzdy = ((sw + 2 * s + se) - (nw + 2 * n + ne)) / (8 * run)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = np.degrees(np.arctan2(dzdy, -dzdx))
    aspect = np.where(aspect < 0, 90.0 - aspect,
             np.where(aspect > 90.0, 360.0 - aspect + 90.0, 90.0 - aspect))
    aspect = np.where((dzdx == 0) & (dzdy == 0), -1.0, aspect)  # flat
    return slope, aspect


def compute_block_stats(
    block: dict,
    elev_src: rasterio.DatasetReader,
    data_source_label: str,
    buffer_px: int = 2,
) -> Optional[dict]:
    """
    Compute elevation/slope/aspect stats for one block from a single elevation
    raster. Slope and aspect are derived on the fly (no stored rasters). A small
    pixel buffer around the block keeps edge pixels' neighbours for a correct
    3x3 slope. Returns None if the block has no valid data here (→ tier fallback).
    """
    block_id = block["id"]
    try:
        geom = transform_geom(src_crs="EPSG:4326", dst_crs=elev_src.crs, geom=block["geom"])
    except Exception as e:
        logger.warning(f"Block {block_id}: CRS transform failed: {e}")
        return None

    # Windowed read: block bounds + buffer, clamped to the raster.
    minx, miny, maxx, maxy = feature_bounds(geom)
    try:
        win = window_from_bounds(minx, miny, maxx, maxy, transform=elev_src.transform)
    except Exception:
        return None
    col_off = max(0, math.floor(win.col_off) - buffer_px)
    row_off = max(0, math.floor(win.row_off) - buffer_px)
    col_end = min(elev_src.width,  math.ceil(win.col_off + win.width)  + buffer_px)
    row_end = min(elev_src.height, math.ceil(win.row_off + win.height) + buffer_px)
    if col_end <= col_off or row_end <= row_off:
        return None
    window = Window(col_off, row_off, col_end - col_off, row_end - row_off)

    elev = elev_src.read(1, window=window)
    if elev.size == 0:
        return None
    wt = elev_src.window_transform(window)
    nodata = elev_src.nodata

    # Mask to the block polygon (all_touched so sub-pixel blocks still catch a cell).
    poly_mask = geometry_mask([geom], out_shape=elev.shape, transform=wt,
                              invert=True, all_touched=True)
    valid = poly_mask & (elev != nodata) if nodata is not None else poly_mask
    if not np.any(valid):
        return None

    elev_ft = elev[valid].astype("float64")  # already feet
    elev_ft = elev_ft[(elev_ft > -500) & (elev_ft < 15_000)]
    if len(elev_ft) == 0:
        return None

    # Derive slope/aspect over the buffered window, then sample inside the polygon.
    res_m = abs(elev_src.res[0])
    slope, aspect = slope_aspect_horn(elev, res_m, nodata)
    slope_vals = slope[valid]
    slope_vals = slope_vals[np.isfinite(slope_vals) & (slope_vals >= 0) & (slope_vals <= 90)]
    aspect_vals = aspect[valid]
    aspect_vals = aspect_vals[np.isfinite(aspect_vals) & (aspect_vals >= -1) & (aspect_vals <= 360)]

    row = {
        "block_id":            block_id,
        "elevation_min_ft":    round(float(np.min(elev_ft)), 2),
        "elevation_max_ft":    round(float(np.max(elev_ft)), 2),
        "elevation_mean_ft":   round(float(np.mean(elev_ft)), 2),
        "elevation_std_ft":    round(float(np.std(elev_ft)), 2),
        "slope_mean_deg":      round(float(np.mean(slope_vals)), 4) if len(slope_vals) > 0 else None,
        "slope_max_deg":       round(float(np.max(slope_vals)), 4) if len(slope_vals) > 0 else None,
        "slope_p10_deg":       round(float(np.percentile(slope_vals, 10)), 4) if len(slope_vals) > 0 else None,
        "slope_p90_deg":       round(float(np.percentile(slope_vals, 90)), 4) if len(slope_vals) > 0 else None,
        "aspect_dominant_deg": None,
        "aspect_mean_deg":     None,
        "pixel_count":         int(len(elev_ft)),
        "data_source":         data_source_label,
    }

    if len(aspect_vals) > 0:
        dom_deg, _ = dominant_aspect(aspect_vals)
        row["aspect_dominant_deg"] = round(dom_deg, 2)
        non_flat = aspect_vals[aspect_vals > 0]
        if len(non_flat) > 0:
            row["aspect_mean_deg"] = round(circular_mean(non_flat), 2)

    return row


def process_block_worker(args) -> Tuple[int, Optional[dict], Optional[str]]:
    block, sources = args
    block_id = block["id"]
    last_err = None
    for label, elev_path in sources:
        try:
            with rasterio.open(elev_path) as elev_src:
                row = compute_block_stats(block, elev_src, label)
                if row is not None:
                    return block_id, row, None
        except Exception as e:
            last_err = str(e)
    return block_id, None, last_err


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option("--cog-dir", type=click.Path(exists=True), default=None,
              help="Directory containing the willamette_valley_1m/ and "
                   "willamette_valley_dogami/ elevation stores. Default: ../data/topography/OR/")
@click.option("--block-ids", type=str, default=None,
              help="Comma-separated block IDs to process (default: all with geometry).")
@click.option("--workers", type=int, default=4, show_default=True,
              help="Parallel workers for stats computation.")
@click.option("--dry-run", is_flag=True, default=False,
              help="Compute stats and print results without writing to the database.")
@click.option("--verbose", is_flag=True, default=False,
              help="Print per-block stats as they are computed.")
def main(cog_dir, block_ids, workers, dry_run, verbose):
    """Compute per-vineyard-block topography statistics from the 1m/3m elevation
    stores (feet). Slope and aspect are derived on the fly; 1m is preferred with
    3m DOGAMI fallback, and the tier used is recorded per block as data_source."""
    script_dir = Path(__file__).resolve().parent

    if cog_dir is None:
        cog_dir = script_dir / ".." / "data" / "topography" / "OR"
    cog_dir = Path(cog_dir).resolve()

    # Elevation-only tiers (feet). Slope/aspect are derived per block.
    primary_elev  = cog_dir / "willamette_valley_1m" / "elevation_1m.vrt"
    fallback_elev = cog_dir / "willamette_valley_dogami" / "elevation_3m.tif"

    sources: List[Tuple[str, Path]] = []
    if primary_elev.exists():
        sources.append(("3DEP 1m", primary_elev))
    if fallback_elev.exists():
        sources.append(("DOGAMI 3m", fallback_elev))

    if not sources:
        click.echo(f"Error: no elevation rasters found under {cog_dir}", err=True)
        click.echo("Expected willamette_valley_1m/elevation_1m.vrt and/or "
                   "willamette_valley_dogami/elevation_3m.tif.", err=True)
        click.echo("Run download-1m-dem.py --tiles ... and download-dogami-dem.py --clip ... first.",
                   err=True)
        sys.exit(1)

    click.echo(f"\nPer-Block Topography Stats (feet; slope/aspect derived on the fly)")
    for label, elev in sources:
        click.echo(f"  Source:   {label} ({elev.name})")
    click.echo(f"  Workers:  {workers}")
    click.echo(f"  Dry run:  {dry_run}\n")

    id_filter = None
    if block_ids:
        try:
            id_filter = [int(x.strip()) for x in block_ids.split(",")]
        except ValueError:
            click.echo("Error: --block-ids must be comma-separated integers", err=True)
            sys.exit(1)

    try:
        conn = get_db_connection()
    except Exception as e:
        click.echo(f"Database connection failed: {e}", err=True)
        sys.exit(1)

    click.echo("Fetching block geometries from database...")
    blocks = fetch_blocks(conn, id_filter)
    click.echo(f"Found {len(blocks)} blocks with geometry to process.\n")

    if not blocks:
        click.echo("No blocks found. Exiting.")
        conn.close()
        sys.exit(0)

    source_tuples = [(label, str(e)) for (label, e) in sources]
    work_args = [(b, source_tuples) for b in blocks]

    completed = 0
    failed = 0
    skipped = 0

    with tqdm(total=len(blocks), desc="Computing stats", unit="block") as pbar:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(process_block_worker, args): args[0]["id"]
                       for args in work_args}

            for future in as_completed(futures):
                block_id, row, err = future.result()

                if err:
                    logger.warning(f"Block {block_id}: {err}")
                    failed += 1
                elif row is None:
                    skipped += 1
                else:
                    if verbose or dry_run:
                        click.echo(
                            f"  Block {block_id}: "
                            f"elev {row['elevation_mean_ft']:.0f}ft "
                            f"(range {row['elevation_min_ft']:.0f}–{row['elevation_max_ft']:.0f}ft), "
                            f"slope {(row['slope_mean_deg'] or 0):.1f}°, "
                            f"aspect {degrees_to_compass(row['aspect_dominant_deg'] or -1)} "
                            f"({row['aspect_dominant_deg'] or 'n/a'}°), "
                            f"pixels={row['pixel_count']}"
                        )
                    try:
                        upsert_stats(conn, row, dry_run=dry_run)
                        completed += 1
                    except Exception as e:
                        logger.error(f"Block {block_id}: DB upsert failed: {e}")
                        conn.rollback()
                        failed += 1

                pbar.update(1)

    conn.close()

    click.echo()
    click.echo("=" * 60)
    click.echo(f"Stats computation complete")
    click.echo(f"  Written:  {completed}")
    click.echo(f"  Skipped:  {skipped}  (no pixels in COG extent)")
    click.echo(f"  Failed:   {failed}")
    if dry_run:
        click.echo("  (DRY RUN — no rows were written to the database)")
    click.echo("=" * 60)


if __name__ == "__main__":
    main()
