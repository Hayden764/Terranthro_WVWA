#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════
# FROZEN — PRE-018 MODEL. Do NOT run against the migrated database.
# Migration 018 unified the model (vineyard_parcels → vineyards,
# blocks carry all polygons). This script assumes the old per-polygon
# parcel model and is kept for historical reference only.
# ═══════════════════════════════════════════════════════════════════
"""
seed-grower-orgs.py — Phase 2b: create owner orgs for unmatched west vineyards
==============================================================================

Every NAMED west vineyard that isn't already linked to a winery gets a real
owner organization (a non-member row in the `wineries` table), and its parcels
are linked to it. Two sources:

  1. vineyard_org is a real producer/grower name  -> org named after vineyard_org
  2. vineyard_org == 'Independent'                 -> org named after vineyard_name

New orgs are non-members (is_wvwa_member=false, recid NULL, location NULL), so
they render GRAY on the map but become real, clickable, account-able entities.
`produces_wine` is inferred from the name (winery/cellars/wines -> producer);
everything that owns a vineyard gets grows_grapes=true.

Unnamed parcels (NULL vineyard_name) are left ownerless — they have no identity.

Idempotent: an org is reused if one with the same title already exists, so
re-running won't create duplicates.

Usage:
  cd data-pipeline
  .venv/bin/python scripts/seed-grower-orgs.py            # dry-run
  .venv/bin/python scripts/seed-grower-orgs.py --commit
"""

import argparse
import re
import sys
from pathlib import Path

SOURCE_DATASET = "wvwa-ml-2025"
PRODUCER_RE = re.compile(r"\b(winery|wineries|cellars?|wines?|vintner)\b", re.I)


def get_database_url():
    import os
    if os.getenv("DATABASE_URL"):
        return os.getenv("DATABASE_URL")
    env = Path(__file__).resolve().parents[2] / "server" / ".env"
    for line in env.read_text().splitlines():
        if line.strip().startswith("DATABASE_URL"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("DATABASE_URL not found")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="write to DB (default dry-run)")
    args = ap.parse_args()

    import psycopg2
    conn = psycopg2.connect(get_database_url(), connect_timeout=20, sslmode="require")
    conn.autocommit = False
    cur = conn.cursor()

    # (org_title, link_predicate_sql, link_params) for each org to create.
    #  - producers/growers: link by vineyard_org
    #  - independents:      link by vineyard_name (org == 'Independent')
    cur.execute(
        """SELECT DISTINCT vineyard_org FROM vineyard_parcels
           WHERE source_dataset=%s AND winery_id IS NULL AND vineyard_name IS NOT NULL
             AND lower(coalesce(vineyard_org,'')) <> 'independent' AND vineyard_org IS NOT NULL""",
        (SOURCE_DATASET,),
    )
    producer_names = [r[0] for r in cur.fetchall()]

    cur.execute(
        """SELECT DISTINCT vineyard_name FROM vineyard_parcels
           WHERE source_dataset=%s AND winery_id IS NULL
             AND lower(coalesce(vineyard_org,''))='independent' AND vineyard_name IS NOT NULL""",
        (SOURCE_DATASET,),
    )
    independent_names = [r[0] for r in cur.fetchall()]

    jobs = (
        [(n, "vineyard_org = %s AND lower(coalesce(vineyard_org,'')) <> 'independent'", n, True)
         for n in producer_names]
        + [(n, "vineyard_name = %s AND lower(coalesce(vineyard_org,''))='independent'", n, False)
           for n in independent_names]
    )

    created = reused = linked = 0
    for title, pred, pval, is_producer_group in jobs:
        produces = bool(PRODUCER_RE.search(title)) if is_producer_group else False
        # Reuse an existing org with this exact title, else create one.
        cur.execute("SELECT id FROM wineries WHERE lower(title)=lower(%s) LIMIT 1", (title,))
        row = cur.fetchone()
        if row:
            org_id = row[0]; reused += 1
        else:
            cur.execute(
                """INSERT INTO wineries
                     (title, category, is_wvwa_member, produces_wine, grows_grapes, has_tasting_room)
                   VALUES (%s, %s, false, %s, true, false) RETURNING id""",
                (title, 'winery' if produces else 'other', produces),
            )
            org_id = cur.fetchone()[0]; created += 1
        cur.execute(
            f"""UPDATE vineyard_parcels SET winery_id=%s
                WHERE source_dataset=%s AND winery_id IS NULL AND {pred}""",
            (org_id, SOURCE_DATASET, pval),
        )
        linked += cur.rowcount

    print(f"producer/grower orgs: {len(producer_names)}   independent orgs: {len(independent_names)}")
    print(f"  would create: {created}   reuse existing: {reused}   parcels linked: {linked}")

    if not args.commit:
        conn.rollback(); conn.close()
        print("\nDry-run. Re-run with --commit to write.")
        return

    conn.commit()
    cur.execute(
        "SELECT COUNT(*) FROM vineyard_parcels WHERE source_dataset=%s AND winery_id IS NULL AND vineyard_name IS NOT NULL",
        (SOURCE_DATASET,),
    )
    print(f"  committed. named west vineyards still ownerless: {cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main()
