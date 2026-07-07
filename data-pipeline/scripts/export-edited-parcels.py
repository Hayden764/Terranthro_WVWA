#!/usr/bin/env python3
"""
export-edited-parcels.py

Exports all vineyard parcels that have had their geometry manually edited
(as recorded in winery_edit_log) to a GeoJSON FeatureCollection.

Re-run anytime to refresh the output with the latest edits from the database.

Usage:
  python3 export-edited-parcels.py

Environment variables (set in shell or load server/.env first):
  DATABASE_URL  — full Postgres connection string (preferred)
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD  — individual vars
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
OUT_FILE = REPO_ROOT / "data-pipeline" / "data" / "edited-parcels.geojson"

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
SELECT DISTINCT ON (vp.id)
    vp.id,
    vp.vineyard_name,
    vp.vineyard_org,
    vp.ava_name,
    vp.nested_ava,
    vp.nested_nested_ava,
    vp.acres,
    vp.source_dataset,
    vp.winery_id,
    ST_AsGeoJSON(vp.geometry)::json AS geometry
FROM vineyards vp
INNER JOIN winery_edit_log wel
    ON wel.entity_id = vp.id
    AND wel.entity_type = 'vineyard_parcel'
    AND wel.field_name = 'geometry'
WHERE vp.geometry IS NOT NULL
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
            "vineyard_id": row["id"],
            "vineyard_name": row["vineyard_name"],
            "vineyard_org": row["vineyard_org"],
            "ava_name": row["ava_name"],
            "nested_ava": row["nested_ava"],
            "nested_nested_ava": row["nested_nested_ava"],
            "acres": float(row["acres"]) if row["acres"] is not None else None,
            "source_dataset": row["source_dataset"],
            "winery_id": row["winery_id"],
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

    print(f"Exported {len(features)} edited parcel(s) → {OUT_FILE}")


if __name__ == "__main__":
    main()
