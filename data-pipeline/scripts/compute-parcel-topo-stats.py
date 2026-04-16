"""
Per-Parcel Topography Statistics Compute Script
================================================
Clips the Willamette Valley 1m elevation and slope COGs to each vineyard parcel
and computes min/max/mean/std/percentile statistics, then upserts into the
vineyard_parcel_topo_stats table.

Prerequisite:
    - download-1m-dem.py has been run and the 3 COGs exist
    - Migration 002_vineyard_parcel_topo_stats.sql has been applied
    - DATABASE_URL (or DB_* vars) are set in environment

Usage:
    python compute-parcel-topo-stats.py
    python compute-parcel-topo-stats.py --dry-run
    python compute-parcel-topo-stats.py --parcel-ids 1,2,3
    python compute-parcel-topo-stats.py --workers 8 --cog-dir /path/to/topography
"""

import os
import sys
import json
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, List, Tuple

import click
import numpy as np
import psycopg2
import psycopg2.extras
import rasterio
import rasterio.crs
import rasterio.transform
from rasterio.mask import mask as rasterio_mask
from rasterio.warp import transform_geom
from shapely.geometry import shape, mapping
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

METERS_TO_FEET = 3.28084
NODATA = -9999.0

# 16-point compass labels for aspect (each covers 22.5°, starting at N=0°)
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
    """Convert an aspect angle (0–360) to a 16-point compass label."""
    if deg < 0:
        return "Flat"
    idx = int((deg + 11.25) / 22.5) % 16
    return COMPASS_LABELS_16[idx]


def dominant_aspect(aspect_data: np.ndarray) -> Tuple[float, str]:
    """
    Find the most common aspect direction from a pixel array.
    Bins pixels into 16 compass sectors, returns centroid degrees + label.
    Flat pixels (value <= 0 or -1) are excluded.
    """
    valid = aspect_data[aspect_data > 0]
    if len(valid) == 0:
        return -1.0, "Flat"

    # 16 bins of 22.5° each, starting at N (0/360°)
    bin_edges = np.arange(0, 361, 22.5)
    bin_centroids = bin_edges[:-1] + 11.25  # mid-point of each bin

    counts, _ = np.histogram(valid, bins=bin_edges)
    dominant_idx = int(np.argmax(counts))
    centroid_deg = bin_centroids[dominant_idx]
    label = COMPASS_LABELS_16[dominant_idx]

    return float(centroid_deg), label


def circular_mean(angles_deg: np.ndarray) -> float:
    """Circular mean of angle array (handles 0/360 wrap-around)."""
    if len(angles_deg) == 0:
        return -1.0
    rad = np.deg2rad(angles_deg)
    sin_mean = np.mean(np.sin(rad))
    cos_mean = np.mean(np.cos(rad))
    mean_rad = np.arctan2(sin_mean, cos_mean)
    mean_deg = float(np.rad2deg(mean_rad)) % 360
    return mean_deg


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_db_connection():
    """Connect to PostgreSQL using DATABASE_URL or individual DB_* env vars."""
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


def fetch_parcels(conn, parcel_ids: Optional[List[int]] = None) -> List[dict]:
    """
    Fetch vineyard parcel geometries from the database.
    Returns list of {id, vineyard_name, geojson_geom} dicts.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if parcel_ids:
            cur.execute(
                """
                SELECT id, vineyard_name,
                       ST_AsGeoJSON(ST_Transform(geometry, 4326))::json AS geom
                FROM vineyard_parcels
                WHERE id = ANY(%s)
                ORDER BY id
                """,
                (parcel_ids,),
            )
        else:
            cur.execute(
                """
                SELECT id, vineyard_name,
                       ST_AsGeoJSON(ST_Transform(geometry, 4326))::json AS geom
                FROM vineyard_parcels
                ORDER BY id
                """
            )
        return [dict(row) for row in cur.fetchall()]


def upsert_stats(conn, stats_row: dict, dry_run: bool = False) -> None:
    """Upsert a stats row into vineyard_parcel_topo_stats."""
    if dry_run:
        return

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO vineyard_parcel_topo_stats (
                parcel_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
                elevation_std_ft, slope_mean_deg, slope_max_deg, slope_p10_deg,
                slope_p90_deg, aspect_dominant_deg, aspect_mean_deg,
                pixel_count, data_source, computed_at
            ) VALUES (
                %(parcel_id)s, %(elevation_min_ft)s, %(elevation_max_ft)s,
                %(elevation_mean_ft)s, %(elevation_std_ft)s, %(slope_mean_deg)s,
                %(slope_max_deg)s, %(slope_p10_deg)s, %(slope_p90_deg)s,
                %(aspect_dominant_deg)s, %(aspect_mean_deg)s,
                %(pixel_count)s, %(data_source)s, NOW()
            )
            ON CONFLICT (parcel_id) DO UPDATE SET
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
# Per-parcel stats computation
# ---------------------------------------------------------------------------


def compute_parcel_stats(
    parcel: dict,
    elev_src: rasterio.DatasetReader,
    slope_src: rasterio.DatasetReader,
    aspect_src: rasterio.DatasetReader,
) -> Optional[dict]:
    """
    Clip the three COGs to one parcel and compute statistics.
    Returns a dict ready for upsert, or None if no valid pixels found.
    """
    parcel_id = parcel["id"]
    geom_wgs84 = parcel["geom"]

    # Reproject geometry from WGS84 to the COG CRS (UTM 10N)
    cog_crs = elev_src.crs
    try:
        geom_utm = transform_geom(
            src_crs="EPSG:4326",
            dst_crs=cog_crs,
            geom=geom_wgs84,
        )
    except Exception as e:
        logger.warning(f"Parcel {parcel_id}: CRS transform failed: {e}")
        return None

    shapes = [geom_utm]

    # --- Elevation ---
    try:
        elev_data, _ = rasterio_mask(
            elev_src, shapes, crop=True, nodata=NODATA, all_touched=False
        )
        elev_vals = elev_data[0][elev_data[0] != NODATA]
    except Exception as e:
        logger.warning(f"Parcel {parcel_id}: elevation mask failed: {e}")
        return None

    if len(elev_vals) == 0:
        logger.debug(f"Parcel {parcel_id}: no valid elevation pixels (parcel may be outside WV COG)")
        return None

    # Convert meters → feet
    elev_ft = elev_vals * METERS_TO_FEET

    # --- Slope ---
    try:
        slope_data, _ = rasterio_mask(
            slope_src, shapes, crop=True, nodata=NODATA, all_touched=False
        )
        slope_vals = slope_data[0][slope_data[0] != NODATA]
        slope_vals = slope_vals[slope_vals >= 0]  # drop edge artifacts
    except Exception as e:
        logger.warning(f"Parcel {parcel_id}: slope mask failed: {e}")
        slope_vals = np.array([])

    # --- Aspect ---
    try:
        aspect_data, _ = rasterio_mask(
            aspect_src, shapes, crop=True, nodata=NODATA, all_touched=False
        )
        aspect_vals = aspect_data[0][aspect_data[0] != NODATA]
    except Exception as e:
        logger.warning(f"Parcel {parcel_id}: aspect mask failed: {e}")
        aspect_vals = np.array([])

    # --- Build stats row ---
    row = {
        "parcel_id":           parcel_id,
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
        "pixel_count":         int(len(elev_vals)),
        "data_source":         "3DEP 1m",
    }

    if len(aspect_vals) > 0:
        dom_deg, _ = dominant_aspect(aspect_vals)
        row["aspect_dominant_deg"] = round(dom_deg, 2)
        # Only compute circular mean for non-flat pixels
        non_flat = aspect_vals[aspect_vals > 0]
        if len(non_flat) > 0:
            row["aspect_mean_deg"] = round(circular_mean(non_flat), 2)

    return row


def process_parcel_worker(args) -> Tuple[int, Optional[dict], Optional[str]]:
    """
    Worker function for thread pool. Opens COG files per-call (rasterio is not thread-safe
    when sharing DatasetReader objects, so we open in each worker).
    Returns (parcel_id, stats_row_or_None, error_msg_or_None).
    """
    parcel, elev_path, slope_path, aspect_path = args
    parcel_id = parcel["id"]

    try:
        with rasterio.open(elev_path) as elev_src, \
             rasterio.open(slope_path) as slope_src, \
             rasterio.open(aspect_path) as aspect_src:
            row = compute_parcel_stats(parcel, elev_src, slope_src, aspect_src)
            return parcel_id, row, None
    except Exception as e:
        return parcel_id, None, str(e)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--cog-dir",
    type=click.Path(exists=True),
    default=None,
    help="Directory containing willamette_valley_1m/ COG subfolder. "
         "Default: ../data/topography/OR/",
)
@click.option(
    "--parcel-ids",
    type=str,
    default=None,
    help="Comma-separated parcel IDs to process (default: all).",
)
@click.option(
    "--workers",
    type=int,
    default=4,
    show_default=True,
    help="Parallel workers for stats computation.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Compute stats and print results without writing to the database.",
)
@click.option(
    "--verbose",
    is_flag=True,
    default=False,
    help="Print per-parcel stats as they are computed.",
)
def main(cog_dir, parcel_ids, workers, dry_run, verbose):
    """
    Compute per-vineyard-parcel topography statistics from 1m LiDAR COGs
    and upsert into the vineyard_parcel_topo_stats table.
    """
    script_dir = Path(__file__).resolve().parent

    if cog_dir is None:
        cog_dir = script_dir / ".." / "data" / "topography" / "OR"
    cog_dir = Path(cog_dir).resolve()

    elev_path  = cog_dir / "willamette_valley_1m" / "elevation.tif"
    slope_path = cog_dir / "willamette_valley_1m" / "slope.tif"
    aspect_path = cog_dir / "willamette_valley_1m" / "aspect.tif"

    for p in [elev_path, slope_path, aspect_path]:
        if not p.exists():
            click.echo(f"Error: COG not found: {p}", err=True)
            click.echo("Run download-1m-dem.py first.", err=True)
            sys.exit(1)

    click.echo(f"\nPer-Parcel Topography Stats")
    click.echo(f"  COGs:     {cog_dir / 'willamette_valley_1m'}")
    click.echo(f"  Workers:  {workers}")
    click.echo(f"  Dry run:  {dry_run}\n")

    # Parse parcel IDs filter
    id_filter = None
    if parcel_ids:
        try:
            id_filter = [int(x.strip()) for x in parcel_ids.split(",")]
        except ValueError:
            click.echo("Error: --parcel-ids must be comma-separated integers", err=True)
            sys.exit(1)

    # Connect to database
    try:
        conn = get_db_connection()
    except Exception as e:
        click.echo(f"Database connection failed: {e}", err=True)
        sys.exit(1)

    # Fetch parcel geometries
    click.echo("Fetching parcel geometries from database...")
    parcels = fetch_parcels(conn, id_filter)
    click.echo(f"Found {len(parcels)} parcels to process.\n")

    if not parcels:
        click.echo("No parcels found. Exiting.")
        conn.close()
        sys.exit(0)

    # Process parcels in parallel
    work_args = [(p, str(elev_path), str(slope_path), str(aspect_path)) for p in parcels]

    completed = 0
    failed = 0
    skipped = 0  # no valid pixels

    with tqdm(total=len(parcels), desc="Computing stats", unit="parcel") as pbar:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(process_parcel_worker, args): args[0]["id"]
                       for args in work_args}

            for future in as_completed(futures):
                parcel_id, row, err = future.result()

                if err:
                    logger.warning(f"Parcel {parcel_id}: {err}")
                    failed += 1
                elif row is None:
                    skipped += 1
                else:
                    if verbose or dry_run:
                        click.echo(
                            f"  Parcel {parcel_id}: "
                            f"elev {row['elevation_mean_ft']:.0f}ft "
                            f"(range {row['elevation_min_ft']:.0f}–{row['elevation_max_ft']:.0f}ft), "
                            f"slope {row['slope_mean_deg']:.1f}°, "
                            f"aspect {degrees_to_compass(row['aspect_dominant_deg'] or -1)} "
                            f"({row['aspect_dominant_deg'] or 'n/a'}°), "
                            f"pixels={row['pixel_count']}"
                        )
                    try:
                        upsert_stats(conn, row, dry_run=dry_run)
                        completed += 1
                    except Exception as e:
                        logger.error(f"Parcel {parcel_id}: DB upsert failed: {e}")
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
