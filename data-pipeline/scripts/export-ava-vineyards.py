#!/usr/bin/env python3
"""
export-ava-vineyards.py

Exports vineyard parcels from PostGIS into three per-AVA GeoJSON files,
classified by which AVA boundary each parcel's interior point falls inside:

  - Yamhill-Carlton
  - Dundee Hills
  - Chehalem Mountains  (absorbs its sub-AVAs Ribbon Ridge & Laurelwood District,
                          which sit geographically inside the Chehalem boundary)

All three source datasets (chehalem-dundee, yamhill-carlton, adelsheim) are
included. They were verified to be spatially disjoint, so combining them gives
the most complete + most current picture with no double-counting.

Classification rule: ST_PointOnSurface (a representative point guaranteed to lie
inside the parcel) tested for containment in each AVA boundary polygon. This
honors the "centroid inside boundary" rule while staying robust for odd shapes.

Each output feature preserves `parcel_id` and `source_dataset` so the polygons
can be edited in QGIS and re-imported into the database later.

Usage:
  cd data-pipeline
  python3 scripts/export-ava-vineyards.py
"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor
from shapely.geometry import shape, Point
from shapely.prepared import prep

# ── Paths ──────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
BOUNDARY_DIR = REPO_ROOT / "public" / "data"
OUT_DIR = REPO_ROOT / "data-pipeline" / "data" / "AVA_Vineyards"

# AVA slug -> (boundary geojson filename, output folder, output filename)
AVAS = {
    "yamhill_carlton": ("yamhill_carlton.geojson", "Yamhill_Carlton", "yamhill_carlton-vineyards.geojson"),
    "dundee_hills": ("dundee_hills.geojson", "Dundee_Hills", "dundee_hills-vineyards.geojson"),
    "chehalem_mountains": ("chehalem_mountains.geojson", "Chehalem_Mountains", "chehalem_mountains-vineyards.geojson"),
}

SOURCE_DATASETS = ("chehalem-dundee", "yamhill-carlton", "adelsheim")

# Parcels whose interior point falls outside all 3 AVA boundaries are written
# here so they can be visualized in QGIS and assigned to an AVA later by hand.
UNCLASSIFIED = ("_Unclassified", "unclassified-vineyards.geojson")

# Auto-load server/.env so DATABASE_URL is available without manual export
_env_file = REPO_ROOT / "server" / ".env"
if _env_file.exists() and not os.environ.get("DATABASE_URL"):
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())


def get_conn():
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        parsed = urlparse(database_url)
        is_supabase = "supabase" in (parsed.hostname or "")
        ssl_config = {"sslmode": "require"} if is_supabase else {}
        return psycopg2.connect(database_url, **ssl_config)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ.get("DB_NAME", "terranthro"),
        user=os.environ.get("DB_USER", "terranthro_user"),
        password=os.environ.get("DB_PASSWORD", "terranthro_pass"),
    )


QUERY = """
SELECT
    vp.id,
    vp.source_dataset,
    vp.vineyard_name,
    vp.vineyard_org,
    vp.owner_name,
    vp.ava_name,
    vp.nested_ava,
    vp.nested_nested_ava,
    vp.situs_address,
    vp.situs_city,
    vp.situs_zip,
    vp.acres,
    vp.varietals_list,
    ST_AsGeoJSON(vp.geometry)::json            AS geometry,
    ST_X(ST_PointOnSurface(vp.geometry))       AS pt_x,
    ST_Y(ST_PointOnSurface(vp.geometry))       AS pt_y
FROM vineyard_parcels vp
WHERE vp.source_dataset = ANY(%s)
ORDER BY vp.id
"""


def load_boundaries():
    boundaries = {}
    for slug, (fname, _, _) in AVAS.items():
        path = BOUNDARY_DIR / fname
        with open(path) as f:
            gj = json.load(f)
        feat = gj["features"][0] if gj.get("type") == "FeatureCollection" else gj
        geom = shape(feat["geometry"])
        boundaries[slug] = prep(geom)  # prepared geometry = fast repeated contains()
    return boundaries


def main():
    boundaries = load_boundaries()

    try:
        conn = get_conn()
    except Exception as e:
        print(f"DB connection failed: {e}", file=sys.stderr)
        sys.exit(1)

    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(QUERY, (list(SOURCE_DATASETS),))
        rows = cur.fetchall()

    buckets = {slug: [] for slug in AVAS}
    unclassified = []

    for row in rows:
        pt = Point(row["pt_x"], row["pt_y"])
        assigned = None
        for slug, bnd in boundaries.items():
            if bnd.contains(pt):
                assigned = slug
                break

        properties = {
            "parcel_id": row["id"],
            "source_dataset": row["source_dataset"],
            "assigned_ava": assigned,
            "vineyard_name": row["vineyard_name"],
            "vineyard_org": row["vineyard_org"],
            "owner_name": row["owner_name"],
            "ava_name": row["ava_name"],
            "nested_ava": row["nested_ava"],
            "nested_nested_ava": row["nested_nested_ava"],
            "situs_address": row["situs_address"],
            "situs_city": row["situs_city"],
            "situs_zip": row["situs_zip"],
            "acres": float(row["acres"]) if row["acres"] is not None else None,
            "varietals_list": row["varietals_list"],
        }
        feature = {
            "type": "Feature",
            "geometry": row["geometry"],
            "properties": properties,
        }
        if assigned is None:
            unclassified.append(feature)
        else:
            buckets[assigned].append(feature)

    print(f"\nClassified {len(rows) - len(unclassified)} / {len(rows)} parcels "
          f"from datasets {SOURCE_DATASETS}\n")
    for slug, (_, folder, fname) in AVAS.items():
        feats = buckets[slug]
        out_path = OUT_DIR / folder / fname
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f)
        # per-dataset breakdown for transparency
        by_src = {}
        for ft in feats:
            by_src[ft["properties"]["source_dataset"]] = by_src.get(ft["properties"]["source_dataset"], 0) + 1
        breakdown = ", ".join(f"{k}: {v}" for k, v in sorted(by_src.items()))
        print(f"  {slug:20s} {len(feats):4d} blocks  ({breakdown})")
        print(f"  {'':20s}      -> {out_path.relative_to(REPO_ROOT)}")

    if unclassified:
        folder, fname = UNCLASSIFIED
        out_path = OUT_DIR / folder / fname
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w") as f:
            json.dump({"type": "FeatureCollection", "features": unclassified}, f)
        print(f"\n  {'unclassified':20s} {len(unclassified):4d} blocks  "
              f"(outside all 3 AVA boundaries — assign by hand in QGIS)")
        print(f"  {'':20s}      -> {out_path.relative_to(REPO_ROOT)}")
    print()


if __name__ == "__main__":
    main()
