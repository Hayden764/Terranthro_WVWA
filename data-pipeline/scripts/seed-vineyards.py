#!/usr/bin/env python3
"""
seed-vineyards.py

Migrates vineyard and winery data from GeoJSON/CSV source files into PostGIS.

Run order:
  1. Seed wineries from wineries.json
  2. Seed Adelsheim parcels (unnested from Wineries_with_Polygons_Adelsheim.geojson)
  3. Seed vineyard blocks from adelsheim_vineyard_blocks.csv
  4. Seed Chehalem/Dundee parcels from ChehalemMtn_DundeeHills_Vineyards_merged.geojson
  5. Seed Yamhill-Carlton parcels from YC_Vineyards_gdb.geojson
  6. Resolve ava_id via spatial join

All inserts are idempotent (ON CONFLICT DO NOTHING or UPDATE).

Usage:
  python3 seed-vineyards.py

Environment variables (or .env in server/):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
"""

import csv
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import execute_values

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = Path("/Volumes/T7/Terranthro/WV_Vineyards")
WINERIES_JSON   = BASE / "wineries.json"
ADELSHEIM_GEOJSON = BASE / "Wineries_with_Polygons_Adelsheim.geojson"
BLOCKS_CSV      = BASE / "adelsheim_vineyard_blocks.csv"
CHEHALEM_GEOJSON = BASE / "ChehalemMtn_DundeeHills_Vineyards_merged_no_linked.geojson"
YC_GEOJSON      = BASE / "YC_Vineyards_gdb_no_linked.geojson"

# ── DB connection ──────────────────────────────────────────────────────────────
def get_conn():
    """
    Accepts DATABASE_URL (Supabase / Railway / any Postgres connection string)
    or individual DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD vars.

    Supabase requires SSL; the rejectUnauthorized=False is safe for seeding scripts.
    """
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

# ── Category classification (mirrors WVWAMap.jsx classifyListing) ─────────────
def classify_listing(title: str, description: str) -> str:
    text = (title + " " + (description or "")).lower()
    is_hotel      = bool(re.search(r"hotel|silo suite|b&b|bed and breakfast|\blodge\b|resort|inn |overnight|accommodation", text))
    is_restaurant = bool(re.search(r"restaurant|\bdining\b|bistro|\bcafe\b|culinary|farm-to-table", text))
    is_winery     = bool(re.search(r"winery|pinot|chardonnay|cellar|vineyard|sparkling|viticulture", text))

    if is_hotel and not is_restaurant and not is_winery:
        return "hotel"
    if is_restaurant and not is_winery:
        return "restaurant"
    if is_winery:
        return "winery"
    if is_hotel:
        return "hotel"
    return "winery"

# ── Name normalization (mirrors link_vineyard_blocks.py) ──────────────────────
def normalize_vineyard_name(name: str) -> str:
    name = name.strip()
    name = re.sub(r"\s*\(Estate\)\s*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*Vineyard\s*$", "", name, flags=re.IGNORECASE)
    return name.strip()

# ── Step 1: Seed wineries ─────────────────────────────────────────────────────
def seed_wineries(cur):
    print("Step 1: Seeding wineries...")
    with open(WINERIES_JSON, encoding="utf-8") as f:
        raw = json.load(f)

    seen = set()
    rows = []
    for w in raw:
        recid = w.get("recid")
        if recid in seen:
            continue
        seen.add(recid)

        title = w.get("title", "")
        desc  = w.get("description") or ""
        phone = w.get("phone") or None
        url_field = w.get("url")
        url = url_field.get("url") if isinstance(url_field, dict) else (url_field or None)
        image_url = w.get("image_url") or None
        category  = classify_listing(title, desc)
        coords = w.get("loc", {}).get("coordinates", [None, None])
        lng, lat = coords[0], coords[1]

        rows.append((recid, title, desc or None, phone, url, image_url, category, lng, lat))

    execute_values(
        cur,
        """
        INSERT INTO wineries (recid, title, description, phone, url, image_url, category, location)
        VALUES %s
        ON CONFLICT (recid) DO NOTHING
        """,
        rows,
        template="(%s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
    )
    print(f"  Inserted up to {len(rows)} wineries (duplicates skipped)")

# ── Step 2: Seed Adelsheim parcels ────────────────────────────────────────────
def seed_adelsheim_parcels(cur) -> dict:
    """Returns {normalized_vineyard_name: [parcel_id, ...]} for block linking."""
    print("Step 2: Seeding Adelsheim parcels...")

    # Build recid → db id map
    cur.execute("SELECT recid, id FROM wineries")
    recid_to_id = {row[0]: row[1] for row in cur.fetchall()}

    with open(ADELSHEIM_GEOJSON, encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    parcel_names = defaultdict(list)  # normalized_name → list of insertion-order index

    for feat in data["features"]:
        props = feat.get("properties", {})
        recid = props.get("recid")
        winery_id = recid_to_id.get(recid)

        for poly_feat in (props.get("vineyard_polygons") or []):
            pp = poly_feat.get("properties", {})
            geom = json.dumps(poly_feat.get("geometry"))
            vineyard_name = pp.get("Vineyard_Name") or None
            if vineyard_name:
                parcel_names[normalize_vineyard_name(vineyard_name)].append(len(rows))

            rows.append((
                winery_id,
                "adelsheim",
                vineyard_name,
                pp.get("Vineyard_Organization") or None,
                pp.get("Owner3") or None,
                pp.get("Nested_AVA") or None,
                pp.get("Nested_AVA") or None,       # ava_name = nested_ava for Adelsheim
                pp.get("Nested_Nested_AVA") or None,
                pp.get("Situs") or None,
                pp.get("SitusCity") or None,
                pp.get("SitusZip") or None,
                pp.get("Acres") or None,
                None,  # varietals_list — not in Adelsheim properties
                None,  # z1_vineyard_id
                geom,
            ))

    cur.execute("DELETE FROM vineyard_parcels WHERE source_dataset = 'adelsheim'")

    inserted_ids = execute_values(
        cur,
        """
        INSERT INTO vineyard_parcels
          (winery_id, source_dataset, vineyard_name, vineyard_org, owner_name,
           nested_ava, ava_name, nested_nested_ava, situs_address, situs_city, situs_zip,
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

    # Build normalized_name → list of db parcel ids
    name_to_parcel_ids = defaultdict(list)
    for norm_name, idxs in parcel_names.items():
        for i, idx in enumerate(idxs):
            if idx < len(inserted_ids):
                name_to_parcel_ids[norm_name].append(inserted_ids[idx][0])

    print(f"  Inserted {len(rows)} Adelsheim parcels")
    return dict(name_to_parcel_ids)

# ── Step 3: Seed vineyard blocks ──────────────────────────────────────────────
def seed_blocks(cur, name_to_parcel_ids: dict):
    print("Step 3: Seeding vineyard blocks...")
    rows = []
    with open(BLOCKS_CSV, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            norm = normalize_vineyard_name(row.get("Vineyard", ""))
            parcel_ids = name_to_parcel_ids.get(norm, [None])
            # Associate with first matching parcel (or NULL if none matched)
            parcel_id = parcel_ids[0] if parcel_ids else None

            # Parse year_planted — may be "2003" or "2020-F" or empty
            year_raw = (row.get("Year Planted") or "").strip()
            year = None
            if year_raw:
                m = re.match(r"(\d{4})", year_raw)
                if m:
                    year = int(m.group(1))

            rows.append((
                parcel_id,
                row.get("Vineyard", "").strip(),
                row.get("Block") or None,
                row.get("Variety") or None,
                row.get("Clone") or None,
                row.get("Rootstock") or None,
                int(row["Rows"]) if row.get("Rows", "").strip().isdigit() else None,
                row.get("Spacing") or None,
                float(row["Vines/Acre"]) if row.get("Vines/Acre", "").strip() else None,
                int(row["Vines"]) if row.get("Vines", "").strip().isdigit() else None,
                float(row["Acres"]) if row.get("Acres", "").strip() else None,
                year,
            ))

    cur.execute("DELETE FROM vineyard_blocks")

    execute_values(
        cur,
        """
        INSERT INTO vineyard_blocks
          (vineyard_parcel_id, vineyard_name, block_name, variety, clone, rootstock,
           rows, spacing, vines_per_acre, vines, acres, year_planted)
        VALUES %s
        """,
        rows,
    )
    matched = sum(1 for r in rows if r[0] is not None)
    print(f"  Inserted {len(rows)} blocks ({matched} linked to parcels, {len(rows)-matched} unlinked)")

# ── Step 4: Seed Chehalem/Dundee parcels ──────────────────────────────────────
def seed_chehalem_parcels(cur):
    print("Step 4: Seeding Chehalem/Dundee parcels...")
    with open(CHEHALEM_GEOJSON, encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    skipped = 0
    for feat in data["features"]:
        geometry = feat.get("geometry")
        # Skip features with null/missing geometry or empty coordinate arrays
        if not geometry or not geometry.get("coordinates"):
            skipped += 1
            continue
        p = feat.get("properties", {})
        geom = json.dumps(geometry)
        rows.append((
            None,  # winery_id — not linked
            "chehalem-dundee",
            p.get("Vineyard_Name") or None,
            p.get("Vineyard_Organization") or None,
            p.get("Owner3") or None,
            p.get("Nested_AVA") or None,   # ava_name
            p.get("Nested_AVA") or None,   # nested_ava
            p.get("Nested_Nested_AVA") or None,
            p.get("Situs") or None,
            p.get("SitusCity") or None,
            p.get("SitusZip") or None,
            p.get("Acres") or None,
            p.get("W1_VarietalsList") or None,
            None,  # z1_vineyard_id
            geom,
        ))
    if skipped:
        print(f"  Skipped {skipped} features with null/invalid geometry")

    cur.execute("DELETE FROM vineyard_parcels WHERE source_dataset = 'chehalem-dundee'")

    execute_values(
        cur,
        """
        INSERT INTO vineyard_parcels
          (winery_id, source_dataset, vineyard_name, vineyard_org, owner_name,
           ava_name, nested_ava, nested_nested_ava, situs_address, situs_city, situs_zip,
           acres, varietals_list, z1_vineyard_id, geometry)
        VALUES %s
        """,
        rows,
        template="""(
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
        )""",
    )
    print(f"  Inserted {len(rows)} Chehalem/Dundee parcels")

# ── Step 5: Seed Yamhill-Carlton parcels ──────────────────────────────────────
def seed_yc_parcels(cur):
    print("Step 5: Seeding Yamhill-Carlton parcels...")
    with open(YC_GEOJSON, encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    skipped = 0
    for feat in data["features"]:
        geometry = feat.get("geometry")
        if not geometry or not geometry.get("coordinates"):
            skipped += 1
            continue
        p = feat.get("properties", {})
        geom = json.dumps(geometry)

        # Parse z1_vineyard_id — may be float string
        z1_raw = p.get("Z1_VineyardID")
        z1 = None
        if z1_raw is not None:
            try:
                z1 = int(float(z1_raw))
            except (ValueError, TypeError):
                pass

        rows.append((
            None,  # winery_id
            "yamhill-carlton",
            p.get("A1_VineyardName") or None,
            p.get("B1_VineyardOrganization") or None,
            None,  # owner_name — not in YC schema
            p.get("C1_AVA") or None,        # ava_name
            p.get("C2_NestAVA") or None,    # nested_ava
            p.get("C3_NestNestAVA") or None,
            None, None, None,               # no address fields in YC
            p.get("VA0_TotalVineAcres") or None,
            p.get("W1_VarietalsList") or None,
            z1,
            geom,
        ))

    cur.execute("DELETE FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton'")

    execute_values(
        cur,
        """
        INSERT INTO vineyard_parcels
          (winery_id, source_dataset, vineyard_name, vineyard_org, owner_name,
           ava_name, nested_ava, nested_nested_ava, situs_address, situs_city, situs_zip,
           acres, varietals_list, z1_vineyard_id, geometry)
        VALUES %s
        """,
        rows,
        template="""(
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)
        )""",
    )
    if skipped:
        print(f"  Skipped {skipped} features with null/invalid geometry")
    print(f"  Inserted {len(rows)} Yamhill-Carlton parcels")

# ── Step 6: Resolve ava_id via spatial join ───────────────────────────────────
def resolve_ava_ids(cur):
    print("Step 6: Resolving ava_id via spatial join...")
    cur.execute("""
        UPDATE vineyard_parcels vp
        SET ava_id = a.id
        FROM avas a
        WHERE vp.ava_id IS NULL
          AND ST_Intersects(vp.geometry, a.geometry)
          AND (
            a.name ILIKE vp.nested_ava
            OR a.name ILIKE vp.ava_name
          )
    """)
    print(f"  Resolved ava_id for {cur.rowcount} parcels")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("Connecting to database...")
    try:
        conn = get_conn()
    except psycopg2.OperationalError as e:
        print(f"ERROR: Could not connect to database: {e}", file=sys.stderr)
        sys.exit(1)

    conn.autocommit = False
    cur = conn.cursor()

    try:
        seed_wineries(cur)
        conn.commit()

        name_to_parcel_ids = seed_adelsheim_parcels(cur)
        conn.commit()

        seed_blocks(cur, name_to_parcel_ids)
        conn.commit()

        seed_chehalem_parcels(cur)
        conn.commit()

        seed_yc_parcels(cur)
        conn.commit()

        resolve_ava_ids(cur)
        conn.commit()

        # Summary
        cur.execute("SELECT COUNT(*) FROM wineries")
        print(f"\nDone. Wineries: {cur.fetchone()[0]}")
        cur.execute("SELECT source_dataset, COUNT(*) FROM vineyard_parcels GROUP BY 1 ORDER BY 1")
        print("Parcels by dataset:")
        for row in cur.fetchall():
            print(f"  {row[0]}: {row[1]}")
        cur.execute("SELECT COUNT(*) FROM vineyard_blocks")
        print(f"Blocks: {cur.fetchone()[0]}")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()
