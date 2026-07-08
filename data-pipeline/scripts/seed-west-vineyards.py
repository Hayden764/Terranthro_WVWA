#!/usr/bin/env python3
"""
seed-west-vineyards.py — Load the 6 western-AVA ML vineyard layers into PostGIS
==============================================================================

Source: data/Vineyards_W_Names/  (U-Net-detected vineyard polygons, attributed
with vineyard_name / vineyard_org). Each file is one AVA.

Model (matches the live schema, no migration required):
  • A named vineyard  -> one vineyards row.
        geometry  = ST_Union of that vineyard's detected polygons (the footprint)
        acres     = geography area of the union
        source_dataset = 'wvwa-ml-2025'
  • Each detected polygon -> one vineyard_blocks row under its parent parcel.
        geometry  = the individual polygon (acres auto-computed by trg_block_acres)
        block_name = the source block_id (for traceability)
  • Unnamed polygons (~40%) -> collected under ONE placeholder parcel per AVA,
        named "<AVA Name> Unnamed Vineyard", so they are still on the map and can
        be re-assigned later via the editor/portal.

vineyard_name + vineyard_org are the load-bearing connectors. owner_name is
populated opportunistically from primary_ownername when present but is not
required.

Idempotent: deletes everything tagged source_dataset='wvwa-ml-2025' (parcels
cascade to their blocks) before re-inserting.

Usage
-----
  cd data-pipeline
  .venv/bin/python scripts/seed-west-vineyards.py            # dry-run (no DB writes)
  .venv/bin/python scripts/seed-west-vineyards.py --commit   # write to the DB

DB connection: DATABASE_URL (read from ../server/.env if not in the environment).
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
from shapely.ops import unary_union
from shapely.validation import make_valid

# ── Config ──────────────────────────────────────────────────────────────────
SOURCE_DATASET = "wvwa-ml-2025"
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "Vineyards_W_Names"

# filename -> (ava_slug, AVA display name used for ava_name + placeholder label)
FILE_MAP = {
    "eola_amity_vineyard_names.gpkg":            ("eola_amity_hills",         "Eola-Amity Hills"),
    "van_duzer_corridor_vineyard_names.gpkg":    ("van_duzer_corridor",       "Van Duzer Corridor"),
    "lower_long_tom-blocks-owners.geojson":      ("lower_long_tom",           "Lower Long Tom"),
    "mcminnville-blocks-owners.geojson":         ("mcminnville",              "McMinnville"),
    "mount_pisgah_polk_county-blocks-owners.geojson": ("mount_pisgah_polk_county", "Mount Pisgah, Polk County"),
    "tualatin_hills-blocks-owners.geojson":      ("tualatin_hills",           "Tualatin Hills"),
}


# ── Helpers ─────────────────────────────────────────────────────────────────
def _clean(v):
    """Clean string or None (handles NaN/'None'/empty)."""
    if v is None:
        return None
    s = str(v).strip()
    if not s or s.lower() in ("none", "nan"):
        return None
    return s


def _mode(values):
    """Most common non-null value in an iterable, or None."""
    vals = [v for v in (_clean(x) for x in values) if v]
    if not vals:
        return None
    return Counter(vals).most_common(1)[0][0]


def load_layer(path: Path):
    """Read a source file, return a GeoDataFrame in EPSG:4326 with valid geom."""
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    # repair invalid geometries
    gdf["geometry"] = gdf.geometry.apply(
        lambda g: g if (g is not None and g.is_valid) else (make_valid(g) if g is not None else None)
    )
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)
    return gdf


def build_for_ava(gdf, slug, display_name):
    """
    Return (parcels, blocks) where:
      parcels = [ {key, vineyard_name, vineyard_org, owner_name, geom_geojson}, ... ]
      blocks  = { parcel_key: [ {block_name, geom_geojson}, ... ] }
    parcel_key is a temporary in-memory id used to link blocks before DB insert.
    """
    parcels, blocks = [], {}

    named_idx, unnamed_idx = [], []
    for i, row in gdf.iterrows():
        (named_idx if _clean(row.get("vineyard_name")) else unnamed_idx).append(i)

    # ── Named vineyards: group by exact vineyard_name ──
    groups = {}
    for i in named_idx:
        name = _clean(gdf.at[i, "vineyard_name"])
        groups.setdefault(name, []).append(i)

    for name, idxs in groups.items():
        key = f"{slug}::{name}"
        sub = gdf.loc[idxs]
        parcels.append({
            "key": key,
            "vineyard_name": name,
            "vineyard_org": _mode(sub.get("vineyard_org", [])),
            "owner_name": _mode(sub.get("primary_ownername", [])),
            "ava_name": display_name,
            "geom": json.dumps(unary_union(list(sub.geometry)).__geo_interface__),
        })
        blocks[key] = [
            {"block_name": _clean(gdf.at[i, "block_id"]),
             "geom": json.dumps(gdf.at[i, "geometry"].__geo_interface__)}
            for i in idxs
        ]

    # ── Unnamed polygons: each becomes its own NULL-named parcel ──
    # Rendered gray with a "Not yet named" popup; one detected polygon per parcel
    # (parcel == block for these) so every patch is independently clickable.
    for i in unnamed_idx:
        key = f"{slug}::unnamed::{i}"
        geom = json.dumps(gdf.at[i, "geometry"].__geo_interface__)
        parcels.append({
            "key": key,
            "vineyard_name": None,
            "vineyard_org": None,
            "owner_name": None,
            "ava_name": display_name,
            "geom": geom,
        })
        blocks[key] = [
            {"block_name": _clean(gdf.at[i, "block_id"]), "geom": geom}
        ]

    return parcels, blocks


# ── DB ──────────────────────────────────────────────────────────────────────
def get_database_url():
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    env_path = Path(__file__).resolve().parents[2] / "server" / ".env"
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("DATABASE_URL not found (env or server/.env)")


def insert(conn, all_parcels, all_blocks):
    cur = conn.cursor()
    cur.execute("DELETE FROM vineyards WHERE source_dataset = %s", (SOURCE_DATASET,))
    print(f"  deleted {cur.rowcount} existing '{SOURCE_DATASET}' parcels (blocks cascade)")

    n_parcels = n_blocks = 0
    for p in all_parcels:
        cur.execute(
            """
            INSERT INTO vineyards
              (source_dataset, vineyard_name, vineyard_org, ava_name,
               acres, geometry)
            VALUES (%s, %s, %s, %s,
              ROUND((ST_Area(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))::geography)
                     / 4046.856422)::numeric, 3),
              ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))))
            RETURNING id
            """,
            (SOURCE_DATASET, p["vineyard_name"], p["vineyard_org"],
             p["ava_name"], p["geom"], p["geom"]),
        )
        parcel_id = cur.fetchone()[0]
        n_parcels += 1

        for b in all_blocks.get(p["key"], []):
            cur.execute(
                """
                INSERT INTO vineyard_blocks
                  (vineyard_id, vineyard_name, block_name, geometry, source_dataset)
                VALUES (%s, %s, %s, ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))), %s)
                """,
                (parcel_id, p["vineyard_name"], b["block_name"], b["geom"], SOURCE_DATASET),
            )
            n_blocks += 1
    cur.close()
    return n_parcels, n_blocks


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true",
                    help="actually write to the DB (default is a dry-run)")
    args = ap.parse_args()

    all_parcels, all_blocks = [], {}
    print(f"Reading {len(FILE_MAP)} AVA layers from {DATA_DIR}\n")
    print(f"{'AVA':28} {'feat':>5} {'named':>5} {'vineyards':>9} {'unnamed':>7} {'blocks':>6}")
    grand_feat = grand_parcels = grand_blocks = 0
    for fname, (slug, disp) in FILE_MAP.items():
        path = DATA_DIR / fname
        if not path.exists():
            print(f"[skip] {disp}: {fname} not found"); continue
        gdf = load_layer(path)
        parcels, blocks = build_for_ava(gdf, slug, disp)
        n_unnamed = sum(1 for p in parcels if "::unnamed::" in p["key"])
        n_named_vineyards = len(parcels) - n_unnamed
        n_blk = sum(len(v) for v in blocks.values())
        print(f"{disp:28} {len(gdf):5} {len(gdf)-n_unnamed:5} {n_named_vineyards:9} {n_unnamed:7} {n_blk:6}")
        grand_feat += len(gdf); grand_parcels += len(parcels); grand_blocks += n_blk
        all_parcels.extend(parcels); all_blocks.update(blocks)

    print(f"\nPLAN: {grand_parcels} parcels (vineyards) + {grand_blocks} blocks "
          f"from {grand_feat} detected polygons")

    if not args.commit:
        print("\nDry-run only. Re-run with --commit to write to the database.")
        return

    import psycopg2
    print(f"\nConnecting to database...")
    conn = psycopg2.connect(get_database_url(), connect_timeout=20, sslmode="require")
    conn.autocommit = False
    try:
        np, nb = insert(conn, all_parcels, all_blocks)
        conn.commit()
        print(f"  inserted {np} parcels + {nb} blocks. Committed.")
    except Exception as e:
        conn.rollback()
        print(f"ERROR (rolled back): {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
