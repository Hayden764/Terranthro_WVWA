#!/usr/bin/env python3
"""
classify-members.py  (vineyard-scrape Phase 0b)
===============================================
Post-processes websites.csv to:
  1. Patch Domaine Lumineux's website (recid 193).
  2. Add member_type + scrape_target columns.
  3. Mark exact-duplicate recids (same recid listed twice in the source).
  4. Write members_classified.csv — the authoritative input for Phase 1.

member_type values:
  winery          → wine producer / estate  (scrape_target = true)
  tasting_room    → satellite location of a winery already in this list
                    (scrape_target = true, notes names the parent)
  restaurant      → food-primary establishment
  hotel           → hotel / motel
  bnb             → bed & breakfast / inn
  vacation_rental → short-term rental property
  wine_bar        → wine bar not owned by a producing winery here
  other           → other non-winery member (farm destination, etc.)
  duplicate       → recid already seen earlier in the list

Usage:
  python3 classify-members.py
"""

import csv
from collections import Counter
from pathlib import Path

REPO    = Path(__file__).parents[2]
IN_CSV  = REPO / "data-pipeline" / "data" / "scrape" / "websites.csv"
OUT_CSV = REPO / "data-pipeline" / "data" / "scrape" / "members_classified.csv"

DOMAINE_LUMINEUX_RECID    = 193
DOMAINE_LUMINEUX_WEBSITE  = "https://domainelumineux.com/"

# ── Hard-coded overrides ─────────────────────────────────────────────────────
# recid (int) → (member_type, classification_notes)
OVERRIDES: dict[int, tuple[str, str]] = {
    # Restaurants ─────────────────────────────────────────────────────────────
    2328: ("restaurant", "Grounded Table — wine-country restaurant, McMinnville"),
    278:  ("restaurant", "Trellis — wine-country restaurant"),
    4545: ("restaurant", "Wooden Heart — wood-fired restaurant, Dundee"),
    5900: ("restaurant", "The Bay House — restaurant (moved from coast to wine country)"),
    5753: ("restaurant", "Douglas On Third — likely restaurant, no description"),
    # Hotels ──────────────────────────────────────────────────────────────────
    5380: ("hotel", "Fairfield by Marriott Portland-Newberg"),
    5807: ("hotel", "Holiday Inn Express Newberg"),
    # B&Bs / Inns ─────────────────────────────────────────────────────────────
    403:  ("bnb", "A'Tuscan Estate — B&B, McMinnville"),
    407:  ("bnb", "Bed & Breakfasts of Yamhill County — B&B directory, not a winery"),
    546:  ("bnb", "Black Walnut Inn & Vineyard — accommodation-primary inn"),
    2820: ("bnb", "The Gaard House — four-bedroom B&B near Carlton"),
    # Vacation rentals ────────────────────────────────────────────────────────
    67:   ("vacation_rental",
           "AtTheJoy — luxury vacation home; its wine label is Aubaine (recid 2091)"),
    6102: ("vacation_rental", "Cascadia Getaways — vacation-rental management company"),
    2559: ("vacation_rental", "The Boutique Retreat — vacation rental"),
    6104: ("vacation_rental",
           "The Market Lofts — vacation lofts above Red Hills Market"),
    902:  ("vacation_rental", "The Park House McMinnville — luxury vacation rental"),
    # Non-winery other ────────────────────────────────────────────────────────
    5006: ("other",
           "Durant at Red Ridge Farms — olive farm / farm destination; "
           "the winery is Durant Vineyards (recid 39)"),
    2441: ("other", "The Ground — farm/food/community ecosystem, not a winery"),
    # Wine bars (not a producing winery's own tasting room) ───────────────────
    4853: ("wine_bar",
           "Park & Main Carlton — wine-bar/restaurant hybrid, not a producing winery"),
    # Tasting rooms (satellite locations for wineries already in this list) ───
    4865: ("tasting_room",
           "Résonance Dundee Hills Tasting Room — extra location for Résonance (recid 153)"),
    5529: ("tasting_room",
           "Stoller Wine Bar | Newberg — extra location for Stoller Family Estate (recid 160)"),
    470:  ("tasting_room",
           "Troon Vineyard Wine Bar — satellite tasting room for Troon Vineyard"),
}

# Keyword fallback — only fires when no hard-coded override exists.
# Checked against lowercased name, then description.
NAME_KEYWORDS: list[tuple[str, str]] = [
    ("marriott",          "hotel"),
    ("holiday inn",       "hotel"),
    ("fairfield",         "hotel"),
    ("hilton",            "hotel"),
    ("bed & breakfast",   "bnb"),
    ("bed and breakfast", "bnb"),
    ("inn express",       "hotel"),
    ("vacation rental",   "vacation_rental"),
    ("getaways",          "vacation_rental"),
]
DESC_KEYWORDS: list[tuple[str, str]] = [
    ("hotel",             "hotel"),
    ("bed & breakfast",   "bnb"),
    ("bed and breakfast", "bnb"),
    ("vacation rental",   "vacation_rental"),
    ("vacation home",     "vacation_rental"),
]

# If any of these appear in name or description, the entry is definitely a winery —
# overrides DESC_KEYWORDS matches so incidental mentions of "hotel" etc. don't misfire.
WINERY_SIGNALS = (
    "winery", "vineyard", "pinot noir", "chardonnay", "pinot gris",
    "tasting room", "estate wine", "cellar", "vintage", "harvest",
    "winegrowing", "winemaker", "winemaking",
)

SCRAPE_TYPES = {"winery", "tasting_room"}


# ── Classification ───────────────────────────────────────────────────────────
def classify(recid: int, name: str, desc: str) -> tuple[str, str]:
    """Return (member_type, notes). Overrides take priority over keywords."""
    if recid in OVERRIDES:
        return OVERRIDES[recid]

    name_l = name.lower()
    desc_l = desc.lower()
    combined = name_l + " " + desc_l

    for kw, mtype in NAME_KEYWORDS:
        if kw in name_l:
            return mtype, f"Auto: name contains '{kw}'"

    # Only apply description keywords when there are no clear winery signals —
    # prevents incidental mentions of "hotel" etc. in a winery description from misfiring.
    has_winery_signal = any(s in combined for s in WINERY_SIGNALS)
    if not has_winery_signal:
        for kw, mtype in DESC_KEYWORDS:
            if kw in desc_l:
                return mtype, f"Auto: description contains '{kw}'"

    return "winery", ""


# ── Main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    rows = list(csv.DictReader(IN_CSV.open(encoding="utf-8")))
    seen_recids: dict[int, int] = {}   # recid → index of first occurrence
    results: list[dict] = []

    for row in rows:
        recid = int(row["recid"])
        name  = row["winery"]
        desc  = row.get("description", "")

        # 1. Patch Domaine Lumineux
        if recid == DOMAINE_LUMINEUX_RECID and not row.get("website"):
            row["website"]        = DOMAINE_LUMINEUX_WEBSITE
            row["website_source"] = "manual"
            row["status"]         = "resolved"

        # 2. Duplicate detection (same recid appearing >1 time in wineries.json)
        if recid in seen_recids:
            member_type = "duplicate"
            notes = (
                f"Duplicate recid — first occurrence at output row "
                f"{seen_recids[recid] + 1} ({results[seen_recids[recid]]['winery']})"
            )
        else:
            seen_recids[recid] = len(results)
            member_type, notes = classify(recid, name, desc)

        row["member_type"]         = member_type
        row["scrape_target"]       = "true" if member_type in SCRAPE_TYPES else "false"
        row["classification_notes"] = notes
        results.append(row)

    # Build fieldnames preserving original order, then append new columns
    base_fields = list(rows[0].keys())
    new_fields  = ["member_type", "scrape_target", "classification_notes"]
    fieldnames  = base_fields + [f for f in new_fields if f not in base_fields]

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        wtr = csv.DictWriter(f, fieldnames=fieldnames)
        wtr.writeheader()
        wtr.writerows(results)

    # ── Summary ──────────────────────────────────────────────────────────────
    counts       = Counter(r["member_type"] for r in results)
    scrape_count = sum(1 for r in results if r["scrape_target"] == "true")
    non_wineries = [r for r in results if r["member_type"] not in SCRAPE_TYPES]

    print(f"\nClassified {len(results)} members → {OUT_CSV.relative_to(REPO)}")
    print()
    print(f"  {'type':<22s} count")
    print(f"  {'-'*30}")
    for mtype, n in sorted(counts.items(), key=lambda x: -x[1]):
        marker = "✓" if mtype in SCRAPE_TYPES else "✗"
        print(f"  {marker} {mtype:<20s} {n}")
    print()
    print(f"  scrape_target=true  : {scrape_count}")
    print(f"  scrape_target=false : {len(results) - scrape_count}")

    if non_wineries:
        print(f"\n  Non-winery / excluded ({len(non_wineries)}):")
        for r in non_wineries:
            print(f"    [{r['member_type']:<16s}] {r['winery']}")


if __name__ == "__main__":
    main()
