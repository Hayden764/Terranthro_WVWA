#!/usr/bin/env python3
"""
export-all-parcels.py

Exports ALL vineyard parcels (both winery-linked and independent / unlinked)
from PostGIS to a unified master GeoJSON FeatureCollection file.

Usage:
  python3 export-all-parcels.py
"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor

# ── Paths ──────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_FILE = REPO_ROOT / "data-pipeline" / "data" / "all-vineyard-parcels.geojson"

# Auto-load server/.env so DATABASE_URL is available without manual export
_env_file = REPO_ROOT / "server" / ".env"
if _env_file.exists() and not os.environ.get("DATABASE_URL"):
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())


# ── DB connection ──────────────────────────────────────────────────────────────
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
    vp.winery_id,
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
    w.title AS winery_title,
    ST_AsGeoJSON(vp.geometry)::json AS geometry
FROM vineyard_parcels vp
LEFT JOIN wineries w ON vp.winery_id = w.id
ORDER BY vp.id
"""


def main():
    try:
        conn = get_conn()
    except Exception as e:
        print(f"DB connection failed: {e}", file=sys.stderr)
        sys.exit(1)

    with conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(QUERY)
        rows = cur.fetchall()

    features = []
    for row in rows:
        geometry = row["geometry"]
        properties = {
            "parcel_id": row["id"],
            "winery_id": row["winery_id"],
            "winery_title": row["winery_title"],
            "source_dataset": row["source_dataset"],
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
        features.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": properties,
        })

    feature_collection = {
        "type": "FeatureCollection",
        "features": features,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(feature_collection, f)

    print(f"Exported all {len(features)} parcels (linked & independent) → {OUT_FILE}")


if __name__ == "__main__":
    main()
