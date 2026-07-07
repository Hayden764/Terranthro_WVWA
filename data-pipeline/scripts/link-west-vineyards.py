#!/usr/bin/env python3
"""
link-west-vineyards.py — Link wvwa-ml-2025 vineyards to winery/org records
==========================================================================

Sets vineyards.winery_id for west-AVA vineyards by matching their
`vineyard_org` (the operating entity) to a wineries.title / aliases entry.

Two passes, both high-precision:
  1. exact   — normalized (suffix-stripped) vineyard_org == winery name/alias
  2. fuzzy   — rapidfuzz token_sort_ratio >= threshold, applied ONLY to a small
               curated allow-list of org->winery pairs to avoid false positives
               (the 70-79 fuzzy band was all wrong: Stangeland->Styring, etc.)

Idempotent and re-runnable after a loader re-seed. vineyard_org == 'Independent'
is skipped by design (those are the grower case for Phase 2b).

Usage:
  cd data-pipeline
  .venv/bin/python scripts/link-west-vineyards.py            # dry-run
  .venv/bin/python scripts/link-west-vineyards.py --commit   # write winery_id
"""

import argparse
import re
import sys
from pathlib import Path

SOURCE_DATASET = "wvwa-ml-2025"

# Curated fuzzy matches that exact-match misses but are real (verified by hand).
# org value (as stored) -> exact winery title to link to.
FUZZY_ALLOW = {
    "Domaine Drouhin": "Domaine Drouhin Oregon",
}

SUF = re.compile(
    r"\s+(vineyards?|estates?|winery|cellars?|wines?|wine|farms?|ranch|llc|"
    r"inc\.?|ltd\.?|co\.?|company|trust|family|partnership|lp|llp|the)\s*$",
    re.I,
)


def norm(s):
    if not s:
        return ""
    s = re.sub(r"[^\w\s&]", " ", str(s))
    s = re.sub(r"\s+", " ", s).strip().lower()
    prev = None
    while prev != s:
        prev = s
        s = SUF.sub("", s).strip()
    return s


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
    ap.add_argument("--commit", action="store_true", help="write winery_id (default dry-run)")
    args = ap.parse_args()

    import psycopg2
    conn = psycopg2.connect(get_database_url(), connect_timeout=20, sslmode="require")
    conn.autocommit = False
    cur = conn.cursor()

    # winery lookup: normalized name/alias -> id ; and title -> id (for fuzzy allow-list)
    cur.execute("SELECT id, title, COALESCE(aliases, '{}') FROM wineries")
    by_norm, by_title = {}, {}
    for wid, title, aliases in cur.fetchall():
        by_title[title] = wid
        for nm in [title, *aliases]:
            k = norm(nm)
            if k:
                by_norm.setdefault(k, wid)

    cur.execute(
        """SELECT id, vineyard_name, vineyard_org FROM vineyards
           WHERE source_dataset = %s AND vineyard_org IS NOT NULL
             AND lower(vineyard_org) <> 'independent'""",
        (SOURCE_DATASET,),
    )
    rows = cur.fetchall()

    updates = []
    n_exact = n_fuzzy = 0
    for pid, vn, vo in rows:
        wid = by_norm.get(norm(vo))
        if wid:
            updates.append((wid, pid)); n_exact += 1
        elif vo in FUZZY_ALLOW and FUZZY_ALLOW[vo] in by_title:
            updates.append((by_title[FUZZY_ALLOW[vo]], pid)); n_fuzzy += 1

    print(f"candidates: {len(rows)} non-independent named west vineyards")
    print(f"  exact matches: {n_exact}   curated fuzzy: {n_fuzzy}   total to link: {len(updates)}")

    if not args.commit:
        print("\nDry-run. Re-run with --commit to write.")
        conn.rollback(); conn.close(); return

    from psycopg2.extras import execute_batch
    execute_batch(cur, "UPDATE vineyards SET winery_id=%s WHERE id=%s", updates)
    conn.commit()
    cur.execute(
        "SELECT COUNT(*) FROM vineyards WHERE source_dataset=%s AND winery_id IS NOT NULL",
        (SOURCE_DATASET,),
    )
    print(f"  committed. west vineyards now linked: {cur.fetchone()[0]}")
    conn.close()


if __name__ == "__main__":
    main()
