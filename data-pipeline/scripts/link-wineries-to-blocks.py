#!/usr/bin/env python3
"""
link-wineries-to-blocks.py — Connect winery points to vineyard blocks per AVA
==============================================================================

Two linkage pathways per block:
  1. parcel     — the winery point sits in the same parcel deed as the block
  2. owner_exact — normalized winery title == normalized block ownername (suffix-stripped)
  3. owner_fuzzy — rapidfuzz token_sort_ratio above --fuzzy-threshold (default 80)

Priority: parcel > owner_exact > owner_fuzzy (first hit wins per block).

Per-AVA outputs (--out-dir):
  {ava}-linked-blocks.geojson   — blocks with linked_winery, link_type, match_score
  {ava}-stats.json              — hit/miss counts broken down by method

Global outputs:
  wineries-linked.geojson       — winery points + parcelid, n_blocks, total_acres,
                                   linked_avas, linked_block_ids
  winery-block-links.csv        — flat join table (winery, block_id, ava, link_type, score)
  summary-stats.json            — overall counts + per-AVA table

Usage
-----
  cd data-pipeline
  .venv/bin/python scripts/link-wineries-to-blocks.py \\
      --wineries  /Volumes/T7/Terranthro/WV_Vineyards/wineries.geojson \\
      --blocks-dir data/BlocksWithOwners \\
      --parcels   data/Parcel_WIllamette.gpkg \\
      --out-dir   data/WineryLinks

  # Single AVA:
  ... --ava eola_amity_hills
"""

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from rapidfuzz import fuzz

# ---------------------------------------------------------------------------
# Constants / patterns
# ---------------------------------------------------------------------------

PARCEL_CRS = 4326

# Same suffix-stripping as attribute-blocks-with-owners.py + link-yc-wineries.py
SUFFIX_RE = re.compile(
    r"\s+(vineyard|vineyards|estate|estates|winery|cellars|wines|wine|"
    r"farm|farms|ranch|llc|l\.l\.c\.?|co\.|co|inc\.?|ltd\.?|trust|trustee|"
    r"properties|property|family|partnership|lp|llp)\s*$",
    re.IGNORECASE,
)

AVA_FILES = [
    "chehalem_mountains-blocks-owners.geojson",
    "dundee_hills-blocks-owners.geojson",
    "eola_amity_hills-blocks-owners.geojson",
    "lower_long_tom-blocks-owners.geojson",
    "mcminnville-blocks-owners.geojson",
    "mount_pisgah_polk_county-blocks-owners.geojson",
    "tualatin_hills-blocks-owners.geojson",
    "van_duzer_corridor-blocks-owners.geojson",
    "yamhill_carlton-blocks-owners.geojson",
]

# ---------------------------------------------------------------------------
# Name normalization
# ---------------------------------------------------------------------------

def normalize(name: str) -> str:
    """Lowercase, strip common business suffixes, collapse whitespace."""
    if not name:
        return ""
    s = re.sub(r"\s+", " ", str(name)).strip()
    prev = None
    while prev != s:
        prev = s
        s = SUFFIX_RE.sub("", s).strip().rstrip(",").strip()
    return s.lower()


def norm_parcelid(pid) -> str:
    """Normalize parcelid to a plain integer string (strips trailing .0 from floats)."""
    if pid is None or (isinstance(pid, float) and math.isnan(pid)):
        return ""
    s = str(pid).strip()
    # "7029.0" -> "7029"
    if s.endswith(".0"):
        s = s[:-2]
    return s

# ---------------------------------------------------------------------------
# Step 1 — Enrich winery points with their parcel
# ---------------------------------------------------------------------------

def enrich_wineries_with_parcels(wineries_path: Path, parcels_path: Path) -> gpd.GeoDataFrame:
    """
    Point-in-polygon join: each winery gets the parcelid + ownername it sits in.

    Wineries span the full WV so a single bbox would pull ~1M parcels. Instead
    we do one tiny per-winery bbox lookup (≈100 m pad) via pyogrio pushdown.
    """
    win = gpd.read_file(wineries_path).to_crs(PARCEL_CRS).reset_index(drop=True)
    pad = 0.001   # ~100 m in degrees

    parcel_ids = []
    parcel_owners = []

    for i, row in win.iterrows():
        x, y = row.geometry.x, row.geometry.y
        bbox = (x - pad, y - pad, x + pad, y + pad)
        nearby = gpd.read_file(
            parcels_path,
            bbox=bbox,
            columns=["parcelid", "ownername", "geometry"],
        ).to_crs(PARCEL_CRS)

        matched_pid = None
        matched_owner = None
        for _, p in nearby.iterrows():
            if p.geometry and p.geometry.contains(row.geometry):
                matched_pid = norm_parcelid(p["parcelid"])
                matched_owner = p["ownername"]
                break

        parcel_ids.append(matched_pid or "")
        parcel_owners.append(matched_owner)

    win["winery_parcelid"]  = parcel_ids
    win["winery_ownername"] = parcel_owners
    win["norm_title"]       = win["title"].apply(normalize)

    n_placed = sum(1 for p in parcel_ids if p)
    print(f"  wineries placed in a parcel: {n_placed} / {len(win)}")
    return win


# ---------------------------------------------------------------------------
# Step 2 — Build winery lookup structures
# ---------------------------------------------------------------------------

def build_winery_lookups(wineries: gpd.GeoDataFrame):
    """
    Returns:
        by_parcel  : {parcelid_str -> winery_title}
        by_norm    : {norm_title   -> winery_title}   (exact normalized)
        fuzzy_list : [(norm_title, winery_title), ...]  (for rapidfuzz scan)
    """
    by_parcel = {}
    by_norm = {}
    fuzzy_list = []

    for _, w in wineries.iterrows():
        pid = w["winery_parcelid"]
        if pid:
            by_parcel[pid] = w["title"]
        nt = w["norm_title"]
        if nt:
            by_norm[nt] = w["title"]
            fuzzy_list.append((nt, w["title"]))

    return by_parcel, by_norm, fuzzy_list


# ---------------------------------------------------------------------------
# Step 3 — Link one block to the best winery match
# ---------------------------------------------------------------------------

def link_block(block_props: dict, by_parcel: dict, by_norm: dict,
               fuzzy_list: list, fuzzy_threshold: float):
    """
    Returns (winery_title, link_type, match_score) or (None, None, None).
    Priority: parcel > owner_exact > owner_fuzzy.
    """
    pid = norm_parcelid(block_props.get("primary_parcelid"))
    if pid and pid in by_parcel:
        return by_parcel[pid], "parcel", 1.0

    raw_owner = block_props.get("primary_ownername") or ""
    norm_owner = normalize(raw_owner)

    if norm_owner and norm_owner in by_norm:
        return by_norm[norm_owner], "owner_exact", 1.0

    # Also check all overlapping parcel owners (the full owners JSON array)
    owners_json = block_props.get("owners", "[]")
    if isinstance(owners_json, str):
        try:
            owners_json = json.loads(owners_json)
        except Exception:
            owners_json = []
    for o in owners_json:
        o_pid = norm_parcelid(o.get("parcelid"))
        if o_pid and o_pid in by_parcel:
            return by_parcel[o_pid], "parcel", 1.0
        o_norm = normalize(o.get("ownername") or "")
        if o_norm and o_norm in by_norm:
            return by_norm[o_norm], "owner_exact", 1.0

    # Fuzzy fallback
    if norm_owner and fuzzy_list:
        best_score = 0.0
        best_winery = None
        for nt, title in fuzzy_list:
            score = fuzz.token_sort_ratio(norm_owner, nt)
            if score > best_score:
                best_score = score
                best_winery = title
        if best_score >= fuzzy_threshold:
            return best_winery, "owner_fuzzy", round(best_score / 100, 4)

    return None, None, None


# ---------------------------------------------------------------------------
# Step 4 — Process one AVA
# ---------------------------------------------------------------------------

def process_ava(blocks_path: Path, ava_slug: str, by_parcel: dict,
                by_norm: dict, fuzzy_list: list, fuzzy_threshold: float,
                out_dir: Path):
    """Annotate all blocks in one AVA and write per-AVA outputs."""
    blocks = gpd.read_file(blocks_path)

    linked_winery_col = []
    link_type_col = []
    match_score_col = []
    flat_rows = []       # for global CSV

    counts = defaultdict(int)
    winery_hits = defaultdict(set)   # winery_title -> set of block_ids

    for _, row in blocks.iterrows():
        props = row.to_dict()
        winery, link_type, score = link_block(
            props, by_parcel, by_norm, fuzzy_list, fuzzy_threshold
        )
        linked_winery_col.append(winery)
        link_type_col.append(link_type)
        match_score_col.append(score)

        if link_type:
            counts[link_type] += 1
            winery_hits[winery].add(row["block_id"])
        else:
            counts["unmatched"] += 1

        if winery:
            flat_rows.append({
                "winery_title": winery,
                "block_id": row["block_id"],
                "ava": ava_slug,
                "link_type": link_type,
                "match_score": score,
                "block_acres": row.get("acres"),
                "primary_ownername": row.get("primary_ownername"),
            })

    blocks = blocks.copy()
    blocks["linked_winery"] = linked_winery_col
    blocks["link_type"] = link_type_col
    blocks["match_score"] = match_score_col

    out_path = out_dir / f"{ava_slug}-linked-blocks.geojson"
    blocks.to_file(out_path, driver="GeoJSON")

    n = len(blocks)
    stats = {
        "ava": ava_slug,
        "total_blocks": n,
        "linked": {
            "parcel":       counts["parcel"],
            "owner_exact":  counts["owner_exact"],
            "owner_fuzzy":  counts["owner_fuzzy"],
            "total":        counts["parcel"] + counts["owner_exact"] + counts["owner_fuzzy"],
        },
        "unmatched": counts["unmatched"],
        "pct_linked": round(
            100 * (n - counts["unmatched"]) / n, 1) if n else 0,
        "wineries_linked": sorted(winery_hits.keys()),
        "n_wineries_linked": len(winery_hits),
    }
    (out_dir / f"{ava_slug}-stats.json").write_text(json.dumps(stats, indent=2))

    _print_ava_stats(stats)
    return stats, flat_rows, winery_hits


def _print_ava_stats(s: dict):
    l = s["linked"]
    print(
        f"    blocks {s['total_blocks']:>4} | "
        f"parcel {l['parcel']:>3}  exact {l['owner_exact']:>3}  "
        f"fuzzy {l['owner_fuzzy']:>3}  unmatched {s['unmatched']:>3}  "
        f"({s['pct_linked']}% linked) | "
        f"wineries: {s['n_wineries_linked']}"
    )


# ---------------------------------------------------------------------------
# Step 5 — Write global outputs
# ---------------------------------------------------------------------------

def write_global_outputs(wineries: gpd.GeoDataFrame, all_flat_rows: list,
                         per_ava_stats: list, out_dir: Path):
    # Flat CSV
    df = pd.DataFrame(all_flat_rows, columns=[
        "winery_title", "block_id", "ava", "link_type",
        "match_score", "block_acres", "primary_ownername",
    ])
    df.to_csv(out_dir / "winery-block-links.csv", index=False)

    # Enrich winery points
    winery_stats = defaultdict(lambda: {"n_blocks": 0, "total_acres": 0.0,
                                         "avas": set(), "block_ids": []})
    for r in all_flat_rows:
        ws = winery_stats[r["winery_title"]]
        ws["n_blocks"] += 1
        ws["total_acres"] += r["block_acres"] or 0.0
        ws["avas"].add(r["ava"])
        ws["block_ids"].append(r["block_id"])

    win = wineries.copy()
    win["n_blocks"]    = win["title"].map(lambda t: winery_stats[t]["n_blocks"])
    win["total_acres"] = win["title"].map(
        lambda t: round(winery_stats[t]["total_acres"], 2))
    win["linked_avas"] = win["title"].map(
        lambda t: " | ".join(sorted(winery_stats[t]["avas"])))
    win["linked_block_ids"] = win["title"].map(
        lambda t: ",".join(winery_stats[t]["block_ids"]))
    win["n_blocks"] = win["n_blocks"].fillna(0).astype(int)
    win.to_file(out_dir / "wineries-linked.geojson", driver="GeoJSON")

    # Summary stats
    total_blocks = sum(s["total_blocks"] for s in per_ava_stats)
    total_linked = sum(s["linked"]["total"]  for s in per_ava_stats)
    summary = {
        "total_blocks_all_avas":  total_blocks,
        "total_linked":           total_linked,
        "total_unmatched":        total_blocks - total_linked,
        "pct_linked":             round(100 * total_linked / total_blocks, 1) if total_blocks else 0,
        "by_method": {
            "parcel":      sum(s["linked"]["parcel"]      for s in per_ava_stats),
            "owner_exact": sum(s["linked"]["owner_exact"] for s in per_ava_stats),
            "owner_fuzzy": sum(s["linked"]["owner_fuzzy"] for s in per_ava_stats),
        },
        "wineries_matched": int((win["n_blocks"] > 0).sum()),
        "wineries_unmatched": int((win["n_blocks"] == 0).sum()),
        "per_ava": per_ava_stats,
    }
    (out_dir / "summary-stats.json").write_text(json.dumps(summary, indent=2))
    return summary


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--wineries",        required=True, type=Path)
    ap.add_argument("--blocks-dir",      required=True, type=Path)
    ap.add_argument("--parcels",         required=True, type=Path)
    ap.add_argument("--out-dir",         required=True, type=Path)
    ap.add_argument("--ava",             default=None,
                    help="Process a single AVA slug (default: all)")
    ap.add_argument("--fuzzy-threshold", type=float, default=80.0,
                    help="Minimum rapidfuzz token_sort_ratio to accept a fuzzy match (default 80)")
    args = ap.parse_args()

    for p in [args.wineries, args.blocks_dir, args.parcels]:
        if not p.exists():
            sys.exit(f"Not found: {p}")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: enrich wineries
    print("Enriching winery points with parcel info…")
    wineries = enrich_wineries_with_parcels(args.wineries, args.parcels)

    # Step 2: build lookups
    by_parcel, by_norm, fuzzy_list = build_winery_lookups(wineries)
    print(f"  parcel lookup: {len(by_parcel)} entries")
    print(f"  exact-name lookup: {len(by_norm)} entries")
    print(f"  fuzzy candidates: {len(fuzzy_list)}")

    # Step 3: per-AVA
    ava_files = AVA_FILES
    if args.ava:
        ava_files = [f for f in AVA_FILES if f.startswith(args.ava)]
        if not ava_files:
            sys.exit(f"Unknown --ava '{args.ava}'. Known slugs: "
                     + ", ".join(f.split("-blocks")[0] for f in AVA_FILES))

    all_flat_rows = []
    per_ava_stats = []

    for fname in ava_files:
        blocks_path = args.blocks_dir / fname
        if not blocks_path.exists():
            print(f"[skip] {fname} not found in {args.blocks_dir}")
            continue
        ava_slug = fname.replace("-blocks-owners.geojson", "")
        print(f"\n[{ava_slug}]")
        stats, flat_rows, _ = process_ava(
            blocks_path, ava_slug, by_parcel, by_norm, fuzzy_list,
            args.fuzzy_threshold, args.out_dir,
        )
        per_ava_stats.append(stats)
        all_flat_rows.extend(flat_rows)

    # Step 4: global outputs
    print("\nWriting global outputs…")
    summary = write_global_outputs(wineries, all_flat_rows, per_ava_stats, args.out_dir)

    print(f"\n{'='*60}")
    print(f"SUMMARY — {summary['total_blocks_all_avas']} blocks across {len(per_ava_stats)} AVAs")
    print(f"  Linked    : {summary['total_linked']} ({summary['pct_linked']}%)")
    print(f"    by parcel      : {summary['by_method']['parcel']}")
    print(f"    by exact owner : {summary['by_method']['owner_exact']}")
    print(f"    by fuzzy owner : {summary['by_method']['owner_fuzzy']}")
    print(f"  Unmatched : {summary['total_unmatched']}")
    print(f"  Wineries matched  : {summary['wineries_matched']} / "
          f"{summary['wineries_matched'] + summary['wineries_unmatched']}")
    print(f"\nOutputs → {args.out_dir}/")
    print(f"  {len(per_ava_stats)} per-AVA linked-blocks + stats files")
    print(f"  wineries-linked.geojson, winery-block-links.csv, summary-stats.json")


if __name__ == "__main__":
    main()
