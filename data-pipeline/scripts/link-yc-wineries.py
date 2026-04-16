#!/usr/bin/env python3
"""
link-yc-wineries.py
===================
Matches new YC vineyard parcels (id >= 8661) to winery records by:
  1. vineyard_name exact (normalized)
  2. vineyard_org   exact (normalized)
  3. vineyard_org   contains winery title or vice-versa (partial)

Only matches to wineries with category = 'winery' (excludes hotels, restaurants).
Atticus Hotel false-match is avoided by this filter.

Updates vineyard_parcels.winery_id for all matched rows.

Usage:
  python3 link-yc-wineries.py [--dry-run]
"""

import os, re, sys, argparse
import psycopg2
from pathlib import Path

# ── Load env ───────────────────────────────────────────────────────────────────
def _load_env():
    env_path = Path(__file__).parents[2] / "server" / ".env"
    if env_path.exists() and not os.getenv("DATABASE_URL"):
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

_load_env()

SUFFIX_RE = re.compile(
    r"\s+(vineyard|vineyards|estate|estates|winery|cellars|wines|wine|"
    r"farm|farms|ranch|llc|co\.|co|inc\.?|ltd\.?)\s*$",
    re.IGNORECASE
)

def normalize(s: str) -> str:
    if not s: return ""
    s = s.strip().lower()
    s = SUFFIX_RE.sub("", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def get_conn():
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return psycopg2.connect(dsn, sslmode="require")
    raise RuntimeError("DATABASE_URL not set")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN — no changes will be written ===\n")

    conn = get_conn()
    cur = conn.cursor()

    # Load wineries (winery category only — exclude hotel/restaurant)
    cur.execute("SELECT id, recid, title FROM wineries WHERE category = 'winery'")
    wineries = cur.fetchall()
    print(f"Loaded {len(wineries)} winery records (category=winery)")

    # Build lookup tables
    by_exact     = {}   # normalized title -> (id, title)
    by_words     = []   # [(normalized_title, id, title)] for partial matching

    for wid, recid, title in wineries:
        norm = normalize(title)
        if norm:
            by_exact[norm] = (wid, title)
            by_words.append((norm, wid, title))

    # Load distinct vineyard_name / vineyard_org from new YC parcels
    cur.execute("""
        SELECT DISTINCT vineyard_name, vineyard_org
        FROM vineyard_parcels
        WHERE source_dataset = 'yamhill-carlton' AND id >= 8661
        ORDER BY vineyard_name
    """)
    yc_names = cur.fetchall()
    print(f"Processing {len(yc_names)} distinct vineyard name/org combos\n")

    # Build match map: (vineyard_name, vineyard_org) -> (winery_id, winery_title, match_reason)
    matches   = {}
    unmatched = []

    for vname, vorg in yc_names:
        norm_name = normalize(vname or "")
        norm_org  = normalize(vorg or "")
        match = None

        # 1. Exact on vineyard_name
        if norm_name and norm_name in by_exact:
            wid, wtitle = by_exact[norm_name]
            match = (wid, wtitle, "name_exact")

        # 2. Exact on vineyard_org
        if not match and norm_org and norm_org in by_exact:
            wid, wtitle = by_exact[norm_org]
            match = (wid, wtitle, "org_exact")

        # 3. Partial: normalized org starts with / equals a winery name (longest match wins)
        if not match and norm_org:
            best = None
            best_len = 0
            for wnorm, wid, wtitle in by_words:
                if not wnorm: continue
                if norm_org.startswith(wnorm) or wnorm.startswith(norm_org):
                    if len(wnorm) > best_len:
                        best = (wid, wtitle, "org_partial")
                        best_len = len(wnorm)
            if best:
                match = best

        # 4. Partial: normalized vineyard_name starts with / equals a winery name
        if not match and norm_name:
            best = None
            best_len = 0
            for wnorm, wid, wtitle in by_words:
                if not wnorm: continue
                if norm_name.startswith(wnorm) or wnorm.startswith(norm_name):
                    if len(wnorm) > best_len:
                        best = (wid, wtitle, "name_partial")
                        best_len = len(wnorm)
            if best:
                match = best

        if match:
            matches[(vname, vorg)] = match
        else:
            unmatched.append((vname, vorg))

    print(f"=== MATCHED ({len(matches)}) ===")
    for (vname, vorg), (wid, wtitle, reason) in sorted(matches.items(), key=lambda x: x[0][0] or ""):
        print(f"  [{reason}] '{vname}' ({vorg}) -> '{wtitle}' [winery_id={wid}]")

    print(f"\n=== UNMATCHED ({len(unmatched)}) ===")
    for vname, vorg in unmatched:
        print(f"  '{vname}' (org: {vorg})")

    if args.dry_run:
        print("\n=== DRY RUN complete — no changes made ===")
        conn.close()
        return

    # Apply updates
    print(f"\nApplying {len(matches)} winery_id links...")
    total_rows = 0
    for (vname, vorg), (wid, wtitle, reason) in matches.items():
        conditions = []
        params = []
        if vname:
            conditions.append(f"vineyard_name = %s")
            params.append(vname)
        else:
            conditions.append("vineyard_name IS NULL")
        if vorg:
            conditions.append(f"vineyard_org = %s")
            params.append(vorg)
        else:
            conditions.append("vineyard_org IS NULL")

        where = " AND ".join(conditions)
        params_full = [wid] + params
        cur.execute(
            f"""UPDATE vineyard_parcels
                SET winery_id = %s
                WHERE source_dataset = 'yamhill-carlton'
                  AND id >= 8661
                  AND {where}""",
            params_full
        )
        total_rows += cur.rowcount

    conn.commit()
    print(f"  Updated {total_rows} parcel rows across {len(matches)} vineyard names.")

    # Summary
    cur.execute("SELECT COUNT(*) FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton' AND id >= 8661 AND winery_id IS NOT NULL")
    linked_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM vineyard_parcels WHERE source_dataset = 'yamhill-carlton' AND id >= 8661")
    total_count = cur.fetchone()[0]
    print(f"\nFinal: {linked_count}/{total_count} new YC parcels linked to wineries.")
    conn.close()

if __name__ == "__main__":
    main()
