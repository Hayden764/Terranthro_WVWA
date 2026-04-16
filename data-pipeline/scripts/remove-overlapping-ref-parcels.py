#!/usr/bin/env python3
"""
remove-overlapping-ref-parcels.py

Removes reference parcels (Chehalem/Dundee and Yamhill-Carlton datasets) that
overlap with linked winery polygons from the Adelsheim dataset.

When both a linked winery polygon and a reference parcel cover the same ground,
map interactions (hover/click) fire on both layers simultaneously — this script
removes the reference duplicates so only the linked polygon remains interactive.

Overlap detection uses a minimum area ratio threshold (default 5%) to avoid
removing parcels that merely share a boundary edge.

Outputs cleaned GeoJSON files with a `_no_linked` suffix alongside the originals:
  ChehalemMtn_DundeeHills_Vineyards_merged_no_linked.geojson
  YC_Vineyards_gdb_no_linked.geojson

Usage:
  python3 remove-overlapping-ref-parcels.py [--threshold 0.05] [--dry-run]

After confirming the output, update seed-vineyards.py to point to these files.
"""

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE = Path("/Volumes/T7/Terranthro/WV_Vineyards")
ADELSHEIM_GEOJSON = BASE / "Wineries_with_Polygons_Adelsheim.geojson"
CHEHALEM_GEOJSON  = BASE / "ChehalemMtn_DundeeHills_Vineyards_merged.geojson"
YC_GEOJSON        = BASE / "YC_Vineyards_gdb.geojson"

# UTM Zone 10N — accurate area calculations for the Willamette Valley
UTM_CRS = "EPSG:32610"
WGS84   = "EPSG:4326"


def load_linked_polygons() -> gpd.GeoDataFrame:
    """
    Extract all nested vineyard_polygons from the Adelsheim winery GeoJSON.
    Each top-level feature is a Point (winery location) with a
    `vineyard_polygons` array of polygon features in its properties.
    """
    with open(ADELSHEIM_GEOJSON) as f:
        data = json.load(f)

    features = []
    for winery_feat in data["features"]:
        props = winery_feat.get("properties") or {}
        for poly_feat in props.get("vineyard_polygons") or []:
            # Each entry is a GeoJSON Feature with geometry + properties
            if poly_feat and poly_feat.get("geometry"):
                features.append(poly_feat)

    if not features:
        print("ERROR: No linked vineyard polygons found in Adelsheim GeoJSON.")
        sys.exit(1)

    gdf = gpd.GeoDataFrame.from_features(features, crs=WGS84)
    print(f"  Loaded {len(gdf):,} linked winery polygons from Adelsheim dataset")
    return gdf


def find_overlapping_indices(
    ref_gdf: gpd.GeoDataFrame,
    linked_gdf: gpd.GeoDataFrame,
    min_overlap_ratio: float,
    label: str,
) -> set:
    """
    Return the integer iloc positions of reference parcels whose intersection
    with any linked polygon is at least `min_overlap_ratio` of the reference
    parcel's own area.

    Steps:
      1. Coarse pass — sjoin(intersects) to get candidates quickly
      2. Fine pass — compute actual intersection area ratio for each candidate
    """
    # Project to UTM for area calculations
    ref_utm    = ref_gdf.to_crs(UTM_CRS).reset_index(drop=True)
    linked_utm = linked_gdf.to_crs(UTM_CRS)[["geometry"]].reset_index(drop=True)

    # ── Coarse: spatial join to find candidates ────────────────────────────────
    ref_indexed = ref_utm.copy()
    ref_indexed["_ref_idx"] = ref_indexed.index

    joined = gpd.sjoin(
        ref_indexed[["_ref_idx", "geometry"]],
        linked_utm,
        how="inner",
        predicate="intersects",
    )

    if joined.empty:
        print(f"  [{label}] No intersecting parcels found — nothing to remove.")
        return set()

    candidate_ref_indices = joined["_ref_idx"].unique()
    candidate_linked_indices = joined["index_right"].unique()

    print(f"  [{label}] Coarse pass: {len(candidate_ref_indices):,} reference parcels "
          f"intersect {len(candidate_linked_indices):,} linked polygons — checking area ratios...")

    # ── Fine: compute overlap area ratio for each candidate ref parcel ─────────
    to_remove = set()

    # Build a unary union of only the relevant linked polygons for speed
    relevant_linked = linked_utm.loc[candidate_linked_indices, "geometry"]
    linked_union = relevant_linked.unary_union

    for ref_idx in candidate_ref_indices:
        ref_geom = ref_utm.at[ref_idx, "geometry"]
        if ref_geom is None or ref_geom.is_empty:
            continue

        try:
            intersection = ref_geom.intersection(linked_union)
        except Exception:
            # Geometry errors (self-intersections etc.) — treat as no overlap
            continue

        if intersection.is_empty:
            continue

        ref_area = ref_geom.area
        if ref_area == 0:
            continue

        ratio = intersection.area / ref_area
        if ratio >= min_overlap_ratio:
            to_remove.add(ref_idx)

    return to_remove


def load_geojson(path: Path) -> gpd.GeoDataFrame:
    """Read a GeoJSON file without relying on fiona."""
    with open(path) as f:
        data = json.load(f)
    gdf = gpd.GeoDataFrame.from_features(data["features"], crs=WGS84)
    return gdf


def write_geojson(gdf: gpd.GeoDataFrame, path: Path) -> None:
    """Write a GeoDataFrame to GeoJSON without relying on fiona."""
    import shapely.geometry as sg
    features = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        props = {k: v for k, v in row.items() if k != "geometry"}
        # Convert non-serialisable types (numpy ints, floats, NaN, etc.)
        clean_props = {}
        for k, v in props.items():
            if pd.isna(v) if not isinstance(v, (list, dict)) else False:
                clean_props[k] = None
            else:
                clean_props[k] = v.item() if hasattr(v, "item") else v
        features.append({
            "type": "Feature",
            "geometry": sg.mapping(geom) if geom else None,
            "properties": clean_props,
        })
    collection = {"type": "FeatureCollection", "features": features}
    with open(path, "w") as f:
        json.dump(collection, f)


def clean_dataset(
    geojson_path: Path,
    linked_gdf: gpd.GeoDataFrame,
    min_overlap_ratio: float,
    label: str,
    dry_run: bool,
) -> None:
    ref_gdf = load_geojson(geojson_path)

    original_count = len(ref_gdf)
    print(f"\n[{label}]")
    print(f"  Input:  {geojson_path.name} — {original_count:,} parcels")

    to_remove = find_overlapping_indices(ref_gdf, linked_gdf, min_overlap_ratio, label)

    removed_count   = len(to_remove)
    remaining_count = original_count - removed_count
    pct             = (removed_count / original_count * 100) if original_count else 0

    print(f"  Result: {removed_count:,} parcels removed ({pct:.1f}%), "
          f"{remaining_count:,} remaining")

    if dry_run:
        print("  [dry-run] Skipping file write.")
        return

    cleaned_gdf = ref_gdf[~ref_gdf.index.isin(to_remove)].copy()

    out_name = geojson_path.stem + "_no_linked.geojson"
    out_path = geojson_path.parent / out_name
    write_geojson(cleaned_gdf, out_path)
    print(f"  Output: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.05,
        metavar="RATIO",
        help="Minimum overlap ratio (0–1) to remove a reference parcel. Default: 0.05 (5%%)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print statistics without writing output files.",
    )
    args = parser.parse_args()

    print("remove-overlapping-ref-parcels.py")
    print(f"  Overlap threshold : {args.threshold:.0%}")
    print(f"  Dry run           : {args.dry_run}")
    print()

    # Validate input files
    for p in [ADELSHEIM_GEOJSON, CHEHALEM_GEOJSON, YC_GEOJSON]:
        if not p.exists():
            print(f"ERROR: Input file not found: {p}")
            sys.exit(1)

    print("Loading linked winery polygons...")
    linked_gdf = load_linked_polygons()

    clean_dataset(CHEHALEM_GEOJSON, linked_gdf, args.threshold, "Chehalem/Dundee", args.dry_run)
    clean_dataset(YC_GEOJSON,       linked_gdf, args.threshold, "Yamhill-Carlton", args.dry_run)

    print("\nDone.")
    if not args.dry_run:
        print("\nNext steps:")
        print("  1. Inspect the output files to confirm removed counts look correct.")
        print("  2. Update seed-vineyards.py constants CHEHALEM_GEOJSON / YC_GEOJSON")
        print("     to point to the *_no_linked.geojson files, then re-seed the database.")


if __name__ == "__main__":
    main()
