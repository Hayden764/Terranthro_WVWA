#!/usr/bin/env python3
"""
update-yc-parcels.py
====================
Replaces existing yamhill-carlton vineyard_parcels that overlap with the new
DeepPlanet segmented polygons, then inserts the new finer-grained segments.

Strategy:
  1. Load DeepPlanet_YC_All.geojson and validate geometries.
  2. Compute a union of all incoming geometries (Shapely, UTM for accuracy).
  3. DELETE FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton'
       AND ST_Intersects(geometry, <union>) — only removes the overlapping rows.
  4. Insert the new parcels using the same column mapping as seed-vineyards.py.
  5. Re-run AVA spatial join scoped to the newly inserted row IDs.

Schema stays completely unchanged. seed-vineyards.py is not touched.

Usage:
  cd data-pipeline
  python3 scripts/update-yc-parcels.py [--dry-run]

Environment:
  DATABASE_URL  (or DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD)
  Reads from server/.env if not already exported.
"""

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import execute_values
from shapely.geometry import shape
from shapely.ops import unary_union
import argparse

# ── Paths ──────────────────────────────────────────────────────────────────────
NEW_GEOJSON = Path("/Volumes/T7/Terranthro/WV_Vineyards/DeepPlanet_YC_All.geojson")

# Load .env from server/ if DATABASE_URL not already set
def _load_dotenv():
    env_path = Path(__file__).parents[2] / "server" / ".env"
    if env_path.exists() and not os.getenv("DATABASE_URL"):
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()

# ── DB connection ──────────────────────────────────────────────────────────────
def get_conn():
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        parsed = urlparse(database_url)
        is_supabase = "supabase" in (parsed.hostname or "")
        ssl_config = {"sslmode": "require"} if is_supabase else {}
        return psycopg2.connect(database_url, **ssl_config)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        dbname=os.getenv("DB_NAME", "terranthro"),
        user=os.getenv("DB_USER", "terranthro_user"),
        password=os.getenv("DB_PASSWORD", "terranthro_pass"),
    )

# ── Step 1: Load + validate ────────────────────────────────────────────────────
def load_and_validate(path: Path):
    print(f"Loading {path.name}...")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"  Total features: {len(features)}")

    valid, skipped = [], 0
    bad_z1 = 0

    for feat in features:
        geom = feat.get("geometry")
        if not geom or not geom.get("coordinates"):
            skipped += 1
            continue

        # Test Shapely parse
        try:
            shp = shape(geom)
            if shp.is_empty:
                skipped += 1
                continue
        except Exception:
            skipped += 1
            continue

        # Validate z1 parse
        p = feat.get("properties", {})
        z1_raw = p.get("YC_Z1_VineyardID")
        if z1_raw is not None:
            try:
                int(float(z1_raw))
            except (ValueError, TypeError):
                bad_z1 += 1

        valid.append(feat)

    print(f"  Valid: {len(valid)}  |  Skipped (null/empty geometry): {skipped}  |  Unparseable YC_Z1_VineyardID: {bad_z1}")
    if skipped:
        print(f"  WARNING: {skipped} features will be omitted.")
    return valid

# ── Step 2: Build union of incoming geometries ─────────────────────────────────
def build_union_wkt(features):
    """Returns WKT of the union of all incoming geometries in WGS84."""
    print("Building union of incoming geometries...")
    shapes = [shape(f["geometry"]) for f in features]
    union = unary_union(shapes)
    wkt = union.wkt
    print(f"  Union geometry type: {union.geom_type}")
    return wkt

# ── Step 3: Delete overlapping existing parcels ────────────────────────────────
def delete_overlapping(cur, union_wkt: str, dry_run: bool):
    cur.execute("""
        SELECT COUNT(*)
        FROM vineyard_parcels
        WHERE source_dataset = 'yamhill-carlton'
          AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromText(%s), 4326))
    """, (union_wkt,))
    count = cur.fetchone()[0]
    print(f"  Existing rows that overlap new data: {count}")

    if dry_run:
        print("  [dry-run] Skipping DELETE.")
        return count

    cur.execute("""
        DELETE FROM vineyard_parcels
        WHERE source_dataset = 'yamhill-carlton'
          AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromText(%s), 4326))
    """, (union_wkt,))
    deleted = cur.rowcount
    print(f"  Deleted {deleted} overlapping rows.")
    return deleted

# ── Step 4: Insert new parcels ─────────────────────────────────────────────────
def insert_new_parcels(cur, features, dry_run: bool):
    print("Inserting new parcels...")
    rows = []
    skipped = 0

    for feat in features:
        p = feat.get("properties", {})
        geom = feat.get("geometry")
        if not geom:
            skipped += 1
            continue

        geom_str = json.dumps(geom)

        # Parse z1_vineyard_id
        z1_raw = p.get("YC_Z1_VineyardID")
        z1 = None
        if z1_raw is not None:
            try:
                z1 = int(float(z1_raw))
            except (ValueError, TypeError):
                pass

        # Parse acres (vineyard total, as per project convention)
        acres_raw = p.get("YC_VA0_TotalVineAcres")
        acres = None
        if acres_raw is not None:
            try:
                acres = float(acres_raw)
            except (ValueError, TypeError):
                pass

        rows.append((
            None,                                        # winery_id — not linked
            "yamhill-carlton",                           # source_dataset
            p.get("YC_A1_VineyardName") or None,        # vineyard_name
            p.get("YC_B1_VineyardOrganization") or None, # vineyard_org
            p.get("Owner3") or None,                     # owner_name
            p.get("YC_C1_AVA") or None,                 # ava_name
            p.get("YC_C2_NestAVA") or None,             # nested_ava
            p.get("YC_C3_NestNestAVA") or None,         # nested_nested_ava
            p.get("Situs") or None,                      # situs_address
            p.get("SitusCity") or None,                  # situs_city
            p.get("SitusZip") or None,                   # situs_zip
            acres,                                       # acres
            p.get("YC_W1_VarietalsList") or None,       # varietals_list
            z1,                                          # z1_vineyard_id
            geom_str,                                    # geometry
        ))

    if dry_run:
        print(f"  [dry-run] Would insert {len(rows)} rows (skipped {skipped} null geoms).")
        return []

    inserted_ids = execute_values(
        cur,
        """
        INSERT INTO vineyard_parcels
          (winery_id, source_dataset, vineyard_name, vineyard_org, owner_name,
           ava_name, nested_ava, nested_nested_ava, situs_address, situs_city, situs_zip,
           acres, varietals_list, z1_vineyard_id, geometry)
        VALUES %s
        RETURNING id
        """,
        rows,
        template="""(
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
        )""",
        fetch=True,
    )
    ids = [r[0] for r in inserted_ids]
    print(f"  Inserted {len(ids)} new parcels (skipped {skipped} null geoms).")
    return ids

# ── Step 5: Resolve ava_id for new rows only ───────────────────────────────────
def resolve_ava_ids(cur, new_ids: list, dry_run: bool):
    if not new_ids:
        print("  No new IDs to resolve.")
        return

    id_list = tuple(new_ids)
    sql = """
        UPDATE vineyard_parcels vp
        SET ava_id = a.id
        FROM avas a
        WHERE vp.id = ANY(%s)
          AND vp.ava_id IS NULL
          AND ST_Intersects(vp.geometry, a.geometry)
          AND (
            a.name ILIKE vp.nested_ava
            OR a.name ILIKE vp.ava_name
          )
    """
    if dry_run:
        print("  [dry-run] Skipping AVA resolution.")
        return

    cur.execute(sql, (list(id_list),))
    print(f"  Resolved ava_id for {cur.rowcount} of {len(new_ids)} new parcels.")

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Replace overlapping YC vineyard parcels with DeepPlanet segments.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would change without modifying the DB.")
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN — no changes will be written ===\n")

    # Step 1: Validate
    features = load_and_validate(NEW_GEOJSON)
    if not features:
        print("ERROR: No valid features found. Aborting.")
        sys.exit(1)

    # Step 2: Build union
    union_wkt = build_union_wkt(features)

    # Connect
    print("\nConnecting to database...")
    try:
        conn = get_conn()
    except psycopg2.OperationalError as e:
        print(f"ERROR: Could not connect: {e}", file=sys.stderr)
        sys.exit(1)

    conn.autocommit = False
    cur = conn.cursor()

    try:
        # Step 3: Delete overlapping rows
        print("\nStep 3: Deleting overlapping existing yamhill-carlton parcels...")
        delete_overlapping(cur, union_wkt, args.dry_run)

        # Step 4: Insert new parcels
        print("\nStep 4: Inserting new DeepPlanet segments...")
        new_ids = insert_new_parcels(cur, features, args.dry_run)

        # Step 5: Resolve AVA IDs
        print("\nStep 5: Resolving ava_id for new parcels...")
        resolve_ava_ids(cur, new_ids, args.dry_run)

        if not args.dry_run:
            conn.commit()
            print("\nCommitted.")

            # Summary
            cur.execute("SELECT COUNT(*) FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton'")
            total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton' AND ava_id IS NOT NULL")
            resolved = cur.fetchone()[0]
            print(f"\n── Summary ──────────────────────────────────────────")
            print(f"  yamhill-carlton total rows : {total}")
            print(f"  ava_id resolved            : {resolved}")
            print(f"  New parcel IDs             : {min(new_ids)} – {max(new_ids)}" if new_ids else "  New parcel IDs             : (none)")
            print(f"\nNew parcel IDs for topo stats:")
            print(",".join(str(i) for i in new_ids))
        else:
            print("\n=== DRY RUN complete — no changes made. ===")

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()
