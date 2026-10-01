#!/usr/bin/env python3
"""
attribute-blocks-with-owners.py — Attach parcel owners to vineyard blocks (per AVA)
===================================================================================

Spatially joins the Willamette Valley parcels layer (which carries `ownername`)
onto the per-AVA vineyard block layers, so every block learns which parcel
owner(s) it sits on. Blocks are then grouped by owner into candidate vineyards
to help identify them.

Two kinds of block inputs are handled (see MANIFEST below):
  - Raw / edited blocks (only `area_m2`)         -> joined against the parcels.
  - Already parcel-derived `*-vineyards.geojson` -> passed through, mapping their
                                                    existing owner_name/parcel_id
                                                    into the standard output schema.

Join rule ("keep all overlapping owners"): a block can straddle several parcels,
so for each block we record EVERY overlapping parcel with its overlap area and
percentage. The largest-overlap parcel becomes the `primary_owner*`.

Areas are computed in EPSG:32610 (UTM 10N) — polygon areas in EPSG:4326 degrees
are meaningless (same reasoning as scripts/vectorize-predictions.py). Owner-name
normalization for grouping reuses the suffix regex from scripts/link-yc-wineries.py.

Usage
-----
  cd data-pipeline
  .venv/bin/python scripts/attribute-blocks-with-owners.py \
      --parcels    data/Parcel_WIllamette.gpkg \
      --blocks-dir data/BlocksUpdated \
      --out-dir    data/BlocksWithOwners

  # Single AVA (fast smoke test):
  .venv/bin/python scripts/attribute-blocks-with-owners.py ... --ava mount_pisgah_polk_county
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

METRIC_CRS = 32610          # UTM zone 10N — metres, correct for the WV
SQ_M_PER_ACRE = 4046.8564224
BBOX_PAD_M = 200.0          # pad the AVA window so edge parcels aren't clipped out

# Parcel attributes carried onto each block (besides geometry).
PARCEL_COLS = [
    "parcelid", "ownername", "owneraddr", "ownercity",
    "ownerstate", "ownerzip", "taxacctnum", "usedesc",
]

# Trailing business/agricultural suffixes stripped when grouping owners.
# (mirrors SUFFIX_RE in scripts/link-yc-wineries.py)
SUFFIX_RE = re.compile(
    r"\s+(vineyard|vineyards|estate|estates|winery|cellars|wines|wine|"
    r"farm|farms|ranch|llc|l\.l\.c\.?|co\.|co|inc\.?|ltd\.?|trust|trustee|"
    r"properties|property|family|partnership|lp|llp)\s*$",
    re.IGNORECASE,
)

# Block file -> (ava_slug, has_owner). Layer is the file's only layer, so we
# let geopandas read the default layer. has_owner=True means the file already
# carries owner_name/parcel_id and is passed through (no parcel join).
MANIFEST = [
    ("Clipped_vanduzer.gpkg",                "van_duzer_corridor",       False),
    ("Edit_Mount_Pisgah.gpkg",               "mount_pisgah_polk_county", False),
    ("Edited_Eola.gpkg",                     "eola_amity_hills",         False),
    ("Edited_Mac.gpkg",                      "mcminnville",              False),
    ("Lower_long_tom_edited.gpkg",           "lower_long_tom",           False),
    ("clipped_tualatinHills.gpkg",           "tualatin_hills",           False),
    ("chehalem_mountains-vineyards.geojson", "chehalem_mountains",       True),
    ("dundee_hills-vineyards.geojson",       "dundee_hills",             True),
    ("yamhill_carlton-vineyards.geojson",    "yamhill_carlton",          True),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _s(v):
    """Coerce a field to a clean string or None (handles NaN floats from geopandas)."""
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return s or None


def normalize_owner(name: str) -> str:
    """Collapse owner-name variants into a grouping key (lowercased, suffix-stripped)."""
    if not name:
        return ""
    s = re.sub(r"\s+", " ", str(name)).strip()
    # strip suffixes repeatedly (e.g. "Foo Vineyards LLC" -> "foo")
    prev = None
    while prev != s:
        prev = s
        s = SUFFIX_RE.sub("", s).strip().rstrip(",").strip()
    return s.lower()


def acres_of(area_m2: float) -> float:
    return round(area_m2 / SQ_M_PER_ACRE, 4)


def load_parcels_for_bbox(parcels_path: Path, bbox) -> gpd.GeoDataFrame:
    """Read only the parcels intersecting bbox (EPSG:4326) via spatial-index pushdown."""
    cols = PARCEL_COLS + ["geometry"]
    gdf = gpd.read_file(parcels_path, bbox=bbox, columns=cols)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    return gdf.to_crs(METRIC_CRS)


# ---------------------------------------------------------------------------
# Per-AVA processing
# ---------------------------------------------------------------------------

def process_join(blocks_path: Path, ava_slug: str, parcels_path: Path,
                 min_overlap_pct: float) -> list[dict]:
    """Join raw blocks against parcels; return one output record per block."""
    blocks = gpd.read_file(blocks_path)
    if blocks.crs is None:
        blocks = blocks.set_crs(4326)
    blocks = blocks.to_crs(METRIC_CRS).reset_index(drop=True)
    blocks["block_id"] = [f"{ava_slug}-{i}" for i in range(len(blocks))]
    blocks["block_area_m2"] = blocks.geometry.area

    # Parcel window from the blocks' own extent (in EPSG:4326), padded.
    bounds4326 = blocks.to_crs(4326).total_bounds  # minx,miny,maxx,maxy
    pad_deg = BBOX_PAD_M / 111_320.0
    bbox = (bounds4326[0] - pad_deg, bounds4326[1] - pad_deg,
            bounds4326[2] + pad_deg, bounds4326[3] + pad_deg)
    parcels = load_parcels_for_bbox(parcels_path, bbox)
    print(f"    parcels in window: {len(parcels):,}")

    block_keep = blocks[["block_id", "block_area_m2", "geometry"]]
    pieces = gpd.overlay(block_keep, parcels, how="intersection",
                         keep_geom_type=True)
    pieces["overlap_m2"] = pieces.geometry.area
    pieces["overlap_pct"] = pieces["overlap_m2"] / pieces["block_area_m2"]

    by_block = {bid: [] for bid in blocks["block_id"]}
    for _, p in pieces.iterrows():
        if p["overlap_m2"] <= 0:
            continue
        by_block[p["block_id"]].append({
            "ownername": _s(p.get("ownername")),
            "parcelid": _s(p.get("parcelid")),
            "taxacctnum": _s(p.get("taxacctnum")),
            "owneraddr": _s(p.get("owneraddr")),
            "ownercity": _s(p.get("ownercity")),
            "usedesc": _s(p.get("usedesc")),
            "overlap_m2": round(float(p["overlap_m2"]), 2),
            "overlap_pct": round(float(p["overlap_pct"]), 4),
        })

    records = []
    for _, b in blocks.iterrows():
        owners = sorted(by_block[b["block_id"]],
                        key=lambda o: o["overlap_m2"], reverse=True)
        # Drop sliver overlaps below threshold, but never drop the largest.
        if owners:
            kept = [o for o in owners if o["overlap_pct"] >= min_overlap_pct]
            owners = kept if kept else owners[:1]
        primary = owners[0] if owners else None
        records.append(_make_record(b, ava_slug, owners, primary))
    return records


def process_passthrough(blocks_path: Path, ava_slug: str) -> list[dict]:
    """Pass through files that already carry owner_name/parcel_id."""
    blocks = gpd.read_file(blocks_path)
    if blocks.crs is None:
        blocks = blocks.set_crs(4326)
    blocks_m = blocks.to_crs(METRIC_CRS).reset_index(drop=True)
    blocks = blocks.to_crs(4326).reset_index(drop=True)

    records = []
    for i, (_, b) in enumerate(blocks.iterrows()):
        area_m2 = float(blocks_m.geometry.iloc[i].area)
        owner = {
            "ownername": _s(b.get("owner_name")),
            "parcelid": _s(b.get("parcel_id")),
            "taxacctnum": None,
            "owneraddr": _s(b.get("situs_address")),
            "ownercity": _s(b.get("situs_city")),
            "usedesc": None,
            "overlap_m2": round(area_m2, 2),
            "overlap_pct": 1.0,
        }
        owners = [owner] if owner["ownername"] else []
        rec = {
            "block_id": f"{ava_slug}-{i}",
            "ava": ava_slug,
            "area_m2": round(area_m2, 2),
            "acres": acres_of(area_m2),
            "primary_ownername": owner["ownername"],
            "primary_parcelid": owner["parcelid"],
            "n_owners": len(owners),
            "owners": json.dumps(owners),
            "vineyard_name": _s(b.get("vineyard_name")),
            "vineyard_org": _s(b.get("vineyard_org")),
            "geometry": blocks.geometry.iloc[i],
        }
        records.append(rec)
    return records


def _make_record(block_row, ava_slug, owners, primary) -> dict:
    # Always trust the geometry-derived UTM area: some source files carry a
    # stored `area_m2` column that is unreliable (NaN / 0.0).
    area_m2 = float(block_row["block_area_m2"])
    return {
        "block_id": block_row["block_id"],
        "ava": ava_slug,
        "area_m2": round(area_m2, 2),
        "acres": acres_of(area_m2),
        "primary_ownername": primary["ownername"] if primary else None,
        "primary_parcelid": primary["parcelid"] if primary else None,
        "n_owners": len(owners),
        "owners": json.dumps(owners),
        "vineyard_name": None,
        "vineyard_org": None,
        # geometry stays in METRIC_CRS here; reprojected to 4326 on write.
        "geometry": block_row["geometry"],
    }


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_ava_geojson(records: list[dict], src_crs: int, out_path: Path):
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=src_crs)
    gdf = gdf.to_crs(4326)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(out_path, driver="GeoJSON")


def write_grouped_summary(all_records: list[dict], out_dir: Path):
    groups = {}
    for r in all_records:
        name = r["primary_ownername"]
        if not name:
            continue
        key = normalize_owner(name)
        g = groups.setdefault(key, {
            "owner_group": key,
            "raw_ownernames": set(),
            "avas": set(),
            "n_blocks": 0,
            "total_acres": 0.0,
            "block_ids": [],
        })
        g["raw_ownernames"].add(name)
        g["avas"].add(r["ava"])
        g["n_blocks"] += 1
        g["total_acres"] += r["acres"]
        g["block_ids"].append(r["block_id"])

    rows = []
    for g in groups.values():
        rows.append({
            "owner_group": g["owner_group"],
            "raw_ownernames": " | ".join(sorted(g["raw_ownernames"])),
            "avas": " | ".join(sorted(g["avas"])),
            "n_blocks": g["n_blocks"],
            "total_acres": round(g["total_acres"], 2),
            "block_ids": ",".join(g["block_ids"]),
        })
    rows.sort(key=lambda x: x["total_acres"], reverse=True)

    df = pd.DataFrame(rows, columns=[
        "owner_group", "raw_ownernames", "avas",
        "n_blocks", "total_acres", "block_ids",
    ])
    df.to_csv(out_dir / "grouped-vineyards.csv", index=False)
    (out_dir / "grouped-vineyards.json").write_text(
        json.dumps(rows, indent=2))
    return len(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parcels", required=True, type=Path,
                    help="WV parcels gpkg with ownername (Parcel_WIllamette.gpkg)")
    ap.add_argument("--blocks-dir", required=True, type=Path,
                    help="Directory of per-AVA block layers (BlocksUpdated)")
    ap.add_argument("--out-dir", required=True, type=Path,
                    help="Output directory for enriched layers + summary")
    ap.add_argument("--ava", default=None,
                    help="Process a single AVA slug (default: all)")
    ap.add_argument("--min-overlap-pct", type=float, default=0.05,
                    help="Ignore parcel overlaps below this share of a block "
                         "(default: 0.05); the largest overlap is always kept")
    args = ap.parse_args()

    if not args.parcels.exists():
        sys.exit(f"Parcels file not found: {args.parcels}")
    args.out_dir.mkdir(parents=True, exist_ok=True)

    manifest = MANIFEST
    if args.ava:
        manifest = [m for m in MANIFEST if m[1] == args.ava]
        if not manifest:
            sys.exit(f"Unknown --ava '{args.ava}'. "
                     f"Known: {', '.join(m[1] for m in MANIFEST)}")

    all_records = []
    for fname, ava_slug, has_owner in manifest:
        blocks_path = args.blocks_dir / fname
        if not blocks_path.exists():
            print(f"[skip] {ava_slug}: {fname} not found")
            continue
        print(f"[{ava_slug}] {fname}  (passthrough={has_owner})")

        if has_owner:
            records = process_passthrough(blocks_path, ava_slug)
            src_crs = 4326
        else:
            records = process_join(blocks_path, ava_slug, args.parcels,
                                   args.min_overlap_pct)
            src_crs = METRIC_CRS

        n_attr = sum(1 for r in records if r["primary_ownername"])
        print(f"    blocks: {len(records)}  with owner: {n_attr}  "
              f"unattributed: {len(records) - n_attr}")

        out_path = args.out_dir / f"{ava_slug}-blocks-owners.geojson"
        write_ava_geojson(records, src_crs, out_path)
        print(f"    -> {out_path}")
        all_records.extend(records)

    if all_records:
        n_groups = write_grouped_summary(all_records, args.out_dir)
        print(f"\nGrouped vineyards: {n_groups} owner groups across "
              f"{len(all_records)} blocks")
        print(f"  -> {args.out_dir / 'grouped-vineyards.csv'}")


if __name__ == "__main__":
    main()
