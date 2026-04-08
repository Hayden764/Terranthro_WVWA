#!/usr/local/Caskroom/miniforge/base/bin/python
"""
compute-ava-climate-stats.py
============================
Clips national growing-season COGs to each AVA polygon, computes
per-AVA statistics (mean, min, max, std_dev, p10, p90), and upserts
them into the ava_climate_stats table.

Usage:
    python compute-ava-climate-stats.py                   # Oregon 2025 (default)
    python compute-ava-climate-stats.py --state CA        # California
    python compute-ava-climate-stats.py --year 2026       # future vintage
    python compute-ava-climate-stats.py --dry-run         # print stats, no DB write

Requirements:
    pip install rasterio numpy shapely pyproj psycopg2-binary
"""

import os
import sys
import json
import argparse
import re
import numpy as np
import rasterio
from rasterio.mask import mask as rio_mask
from rasterio.crs import CRS
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform
from pyproj import Transformer
import psycopg2
from psycopg2.extras import execute_values

# ── Paths ──────────────────────────────────────────────────────────────────────
GEOJSON_DIR  = "/Volumes/T7/Terranthro/TerranthroSite/client/public/data"
INDICES_DIR  = "/Volumes/T7/Terranthro/TerranthroSite/client/public/climate-data/indices"

# ── DB (Docker local) ─────────────────────────────────────────────────────────
DB_URL = "postgresql://terranthro_user:terranthro_pass@localhost:5432/terranthro"

# ── Variables to compute ──────────────────────────────────────────────────────
# (variable_name, cog_filename_template, unit)
VARIABLES = [
    ("gdd_winkler", "gdd_winkler_accumulated_{year}_cog.tif", "°F·days"),
    ("huglin",      "huglin_{year}_cog.tif",                  "index"),
    ("gst",         "gst_smarthobday_{year}_cog.tif",         "°C"),
    ("ppt",         "ppt_growing_season_{year}_total_cog.tif","mm"),
]

# ── CRS transformer cache ─────────────────────────────────────────────────────
_transformers = {}

def get_transformer(src_epsg: int, dst_epsg: int):
    key = (src_epsg, dst_epsg)
    if key not in _transformers:
        _transformers[key] = Transformer.from_crs(
            src_epsg, dst_epsg, always_xy=True
        )
    return _transformers[key]


def reproject_geometry(geojson_geom: dict, src_epsg: int, dst_epsg: int):
    """Reproject a GeoJSON geometry dict from src_epsg to dst_epsg."""
    geom = shape(geojson_geom)
    t = get_transformer(src_epsg, dst_epsg)
    projected = shapely_transform(t.transform, geom)
    return mapping(projected)


# ── Helpers ───────────────────────────────────────────────────────────────────
def load_geojson(state: str):
    path = os.path.join(GEOJSON_DIR, f"{state}_avas.geojson")
    if not os.path.exists(path):
        print(f"❌  GeoJSON not found: {path}")
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def slug_from_ava_id(ava_id: str) -> str:
    """Strip trailing _YYYYMMDD date suffix from ava_id to get the slug."""
    return re.sub(r'_\d{8}$', '', ava_id)


def compute_stats(data: np.ndarray):
    """Compute summary stats from a 1-D valid-pixel array."""
    valid = data[~np.isnan(data)]
    if valid.size == 0:
        return None
    return {
        "mean":     float(np.mean(valid)),
        "min":      float(np.min(valid)),
        "max":      float(np.max(valid)),
        "std_dev":  float(np.std(valid)),
        "p10":      float(np.percentile(valid, 10)),
        "p90":      float(np.percentile(valid, 90)),
        "n_pixels": int(valid.size),
    }


def clip_to_geometry(cog_path: str, geometry_geojson: dict, cog_epsg: int):
    """
    Clip a raster to the given GeoJSON geometry (EPSG:4326) and return
    a flat float32 array of valid pixel values.
    The geometry is reprojected to match the COG CRS before masking.
    """
    proj_geom = reproject_geometry(geometry_geojson, 4326, cog_epsg)

    with rasterio.open(cog_path) as src:
        try:
            out_image, _ = rio_mask(
                src, [proj_geom], crop=True, nodata=np.nan, filled=True
            )
        except Exception as e:
            raise ValueError(f"Mask failed: {e}")

        data = out_image[0].astype(np.float32)
        nodata = src.nodata
        if nodata is not None:
            data[data == float(nodata)] = np.nan

        return data.flatten()


# ── COG metadata helper ───────────────────────────────────────────────────────
def get_cog_epsg(cog_path: str) -> int:
    with rasterio.open(cog_path) as src:
        return src.crs.to_epsg()


# ── DB helpers ────────────────────────────────────────────────────────────────
def get_db_ava_map(conn, state: str):
    """Return {slug: db_id} for all AVAs in the given state."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT a.slug, a.id
            FROM avas a
            JOIN ava_states av ON a.id = av.ava_id
            JOIN states s ON av.state_id = s.id
            WHERE s.abbreviation = %s
        """, (state,))
        return {row[0]: row[1] for row in cur.fetchall()}


def upsert_stats(conn, rows: list, dry_run: bool):
    if dry_run:
        print(f"    [DRY-RUN] would upsert {len(rows)} rows")
        return

    sql = """
        INSERT INTO ava_climate_stats
            (ava_id, year, month, variable, mean, min, max, std_dev, p10, p90, unit, data_source)
        VALUES %s
        ON CONFLICT (ava_id, year, month, variable)
        DO UPDATE SET
            mean        = EXCLUDED.mean,
            min         = EXCLUDED.min,
            max         = EXCLUDED.max,
            std_dev     = EXCLUDED.std_dev,
            p10         = EXCLUDED.p10,
            p90         = EXCLUDED.p90,
            unit        = EXCLUDED.unit,
            data_source = EXCLUDED.data_source,
            computed_at = NOW()
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Compute per-AVA climate stats from COGs")
    parser.add_argument("--state",   default="OR",  help="State abbreviation (default: OR)")
    parser.add_argument("--year",    type=int, default=2025, help="Vintage year (default: 2025)")
    parser.add_argument("--dry-run", action="store_true",   help="Print stats without writing to DB")
    args = parser.parse_args()

    STATE   = args.state.upper()
    YEAR    = args.year
    DRY_RUN = args.dry_run

    print()
    print("═" * 60)
    print(f"  AVA Climate Stats — {STATE}  |  {YEAR} Growing Season")
    if DRY_RUN:
        print("  DRY RUN — no DB writes")
    print("═" * 60)
    print()

    # Resolve COG paths + their EPSG codes
    cog_paths = {}
    for var, template, unit in VARIABLES:
        filename = template.format(year=YEAR)
        path = os.path.join(INDICES_DIR, filename)
        if not os.path.exists(path):
            print(f"⚠️   COG not found, skipping {var}: {filename}")
        else:
            epsg = get_cog_epsg(path)
            cog_paths[var] = (path, unit, epsg)
            print(f"  ✓ {var:12s}  {filename}  (EPSG:{epsg})")

    if not cog_paths:
        print("❌  No COGs found — aborting.")
        sys.exit(1)
    print()

    # Load GeoJSON
    geojson = load_geojson(STATE)
    features = geojson["features"]
    print(f"  AVAs in GeoJSON: {len(features)}")

    # Connect to DB
    conn = None
    db_ava_map = {}
    if not DRY_RUN:
        conn = psycopg2.connect(DB_URL)
        db_ava_map = get_db_ava_map(conn, STATE)
        print(f"  AVAs in DB ({STATE}): {len(db_ava_map)}")
    print()

    # ── Process each AVA ──────────────────────────────────────────────────────
    all_rows = []
    skipped  = []
    errors   = []

    for feat in features:
        props    = feat["properties"]
        ava_id   = props.get("ava_id", "")
        name     = props.get("name", ava_id)
        slug     = slug_from_ava_id(ava_id)
        geometry = feat["geometry"]

        # Look up DB id
        db_id = db_ava_map.get(slug)
        if not DRY_RUN and db_id is None:
            print(f"  ⚠️  '{slug}' not found in DB — skipping")
            skipped.append(slug)
            continue

        print(f"  → {name} ({slug})")

        ava_rows = []
        for var, (cog_path, unit, epsg) in cog_paths.items():
            try:
                pixels = clip_to_geometry(cog_path, geometry, epsg)
                stats  = compute_stats(pixels)

                if stats is None:
                    print(f"      {var}: no valid pixels — skipping")
                    continue

                print(f"      {var:12s}  mean={stats['mean']:8.1f}  "
                      f"range=[{stats['min']:.1f}, {stats['max']:.1f}]  "
                      f"p10={stats['p10']:.1f}  p90={stats['p90']:.1f}  "
                      f"n={stats['n_pixels']:,}")

                if not DRY_RUN:
                    ava_rows.append((
                        db_id,
                        YEAR,
                        None,           # month=NULL → full growing season
                        var,
                        round(stats["mean"],    4),
                        round(stats["min"],     4),
                        round(stats["max"],     4),
                        round(stats["std_dev"], 4),
                        round(stats["p10"],     4),
                        round(stats["p90"],     4),
                        unit,
                        "PRISM 30s",
                    ))

            except ValueError as e:
                print(f"      {var}: ⚠️  {e}")
                errors.append(f"{slug}/{var}: {e}")

        all_rows.extend(ava_rows)
        print()

    # ── Upsert ────────────────────────────────────────────────────────────────
    if not DRY_RUN and all_rows:
        print(f"  Upserting {len(all_rows)} stat rows to DB...")
        upsert_stats(conn, all_rows, DRY_RUN)
        print("  ✅ Done.")
    elif DRY_RUN:
        upsert_stats(conn, all_rows, DRY_RUN)

    if conn:
        conn.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("═" * 60)
    print(f"  AVAs processed : {len(features) - len(skipped)}")
    print(f"  Rows written   : {len(all_rows)}")
    print(f"  Skipped (no DB): {len(skipped)}")
    print(f"  Errors         : {len(errors)}")
    if errors:
        for e in errors:
            print(f"    • {e}")
    print("═" * 60)
    print()


if __name__ == "__main__":
    main()
