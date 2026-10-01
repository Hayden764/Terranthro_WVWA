#!/usr/bin/env python3
"""
enrich-wineries-from-google.py
================================
Tags vineyard blocks in data/WineryLinks/*-linked-blocks.geojson with the
canonical winery / vineyard NAMES from Google Places (produced by
download-places-by-ava.py).

How the linkage works
---------------------
A Google "winery" pin is the tasting room / building, which usually sits
*outside* the planted vineyard block polygon — so a point-in-block join only
catches a handful. But the building and its planted blocks almost always share
the same tax PARCEL. So, exactly like link-wineries-to-blocks.py's strongest
pathway, we link by parcel:

  1. Find which parcel each Google pin falls inside (point-in-parcel).
  2. Every block whose primary_parcelid — or any parcelid in its `owners`
     array — matches that parcel receives the Google name.

Each pin is filed by its Google type:
  - types containing "winery"  -> google_winery_name
  - types containing "vineyard" (and not winery) -> google_vineyard_name
Multiple pins on one parcel are joined with " | ".

This is purely ADDITIVE: it writes two new properties onto each block
(google_winery_name, google_vineyard_name) and never overwrites the existing
linked_winery / vineyard_name fields.

Usage
-----
  cd /Volumes/T7/Terranthro/Terranthro_WVWA

  # All AVAs (pairs every *-linked-blocks.geojson with its *_places.geojson)
  python data-pipeline/scripts/enrich-wineries-from-google.py \\
      --google-dir data-pipeline/data/google-wineries \\
      --links-dir  data-pipeline/data/WineryLinks \\
      --parcels    data-pipeline/data/Parcel_WIllamette.gpkg

  # Single AVA, preview only
  python data-pipeline/scripts/enrich-wineries-from-google.py \\
      --google-dir data-pipeline/data/google-wineries \\
      --links-dir  data-pipeline/data/WineryLinks \\
      --parcels    data-pipeline/data/Parcel_WIllamette.gpkg \\
      --ava eola_amity_hills --dry-run

By default the linked-blocks files are updated in place. Pass --out-dir to
write the tagged copies somewhere else instead.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

PARCEL_CRS = 4326
BBOX_PAD   = 0.001   # ~100 m — tiny per-pin parcel lookup window

# ── Helpers ───────────────────────────────────────────────────────────────────

def norm_pid(pid) -> str:
    """Normalise a parcelid to a plain string, stripping a trailing '.0'."""
    if pid is None or (isinstance(pid, float) and math.isnan(pid)):
        return ""
    s = str(pid).strip()
    return s[:-2] if s.endswith(".0") else s


def block_parcel_ids(props: dict) -> set:
    """All parcelids a block touches: primary_parcelid + every owners[].parcelid."""
    pids = set()
    pp = norm_pid(props.get("primary_parcelid"))
    if pp:
        pids.add(pp)

    owners = props.get("owners")
    if isinstance(owners, str):
        try:
            owners = json.loads(owners)
        except Exception:
            owners = []
    for o in owners or []:
        op = norm_pid(o.get("parcelid"))
        if op:
            pids.add(op)
    return pids


def classify(place_types: list) -> str:
    """Return 'winery' or 'vineyard' for which name field this pin fills."""
    types = place_types or []
    if "winery" in types:
        return "winery"
    if "vineyard" in types:
        return "vineyard"
    return "winery"   # default bucket for farm/other

# ── Parcel lookup ─────────────────────────────────────────────────────────────

def parcel_for_point(parcels_path: Path, pt) -> str:
    """Point-in-parcel via a tiny bbox pushdown read. Returns parcelid or ''."""
    x, y = pt.x, pt.y
    near = gpd.read_file(
        parcels_path,
        bbox=(x - BBOX_PAD, y - BBOX_PAD, x + BBOX_PAD, y + BBOX_PAD),
        columns=["parcelid", "geometry"],
    ).to_crs(PARCEL_CRS)
    for _, r in near.iterrows():
        if r.geometry is not None and r.geometry.contains(pt):
            return norm_pid(r["parcelid"])
    return ""

# ── Per-AVA processing ────────────────────────────────────────────────────────

def process_ava(slug: str, google_path: Path, blocks_path: Path,
                parcels_path: Path, out_dir: Path, dry_run: bool):
    print(f"\n[{slug}]")

    places = json.loads(google_path.read_text())
    blocks = json.loads(blocks_path.read_text())

    # 1. Map every parcelid referenced by this AVA's blocks -> [block indices]
    parcel_to_blocks = {}
    for idx, f in enumerate(blocks["features"]):
        for pid in block_parcel_ids(f["properties"]):
            parcel_to_blocks.setdefault(pid, []).append(idx)

    # 2. For each pin, resolve its parcel and bucket its name by type
    #    parcel -> {"winery": set(names), "vineyard": set(names)}
    parcel_names = {}
    pins_total   = 0
    pins_matched = 0
    for pf in places["features"]:
        geom = pf.get("geometry")
        if not geom:
            continue
        pins_total += 1
        name = (pf.get("properties") or {}).get("name")
        if not name:
            continue
        pt = shape(geom)
        pid = parcel_for_point(parcels_path, pt)
        if not pid or pid not in parcel_to_blocks:
            continue
        pins_matched += 1
        bucket = classify((pf.get("properties") or {}).get("types"))
        slot = parcel_names.setdefault(pid, {"winery": set(), "vineyard": set()})
        slot[bucket].add(name)

    # 3. Write the names onto every block sharing a matched parcel
    blocks_tagged = 0
    sample = []
    for pid, names in parcel_names.items():
        win_name = " | ".join(sorted(names["winery"]))   or None
        vin_name = " | ".join(sorted(names["vineyard"])) or None
        for idx in parcel_to_blocks[pid]:
            props = blocks["features"][idx]["properties"]
            if win_name:
                props["google_winery_name"] = win_name
            if vin_name:
                props["google_vineyard_name"] = vin_name
            blocks_tagged += 1
            if len(sample) < 8:
                sample.append((props.get("block_id"), win_name, vin_name))

    print(f"  Google pins              : {pins_total}")
    print(f"  pins matched to a parcel : {pins_matched}")
    print(f"  blocks tagged            : {blocks_tagged}")
    if sample:
        print("  sample:")
        for bid, w, v in sample:
            tag = []
            if w: tag.append(f"winery='{w}'")
            if v: tag.append(f"vineyard='{v}'")
            print(f"    {bid}: {', '.join(tag)}")

    if dry_run:
        return blocks_tagged

    out_path = (out_dir / blocks_path.name) if out_dir else blocks_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(blocks))
    print(f"  written → {out_path}")
    return blocks_tagged

# ── Main ──────────────────────────────────────────────────────────────────────

def discover_avas(google_dir: Path, links_dir: Path, only: str | None):
    """Pair {slug}_places.geojson with {slug}-linked-blocks.geojson."""
    pairs = []
    for blocks_path in sorted(links_dir.glob("*-linked-blocks.geojson")):
        if blocks_path.name.startswith("._"):
            continue
        slug = blocks_path.name.replace("-linked-blocks.geojson", "")
        if only and slug != only:
            continue
        google_path = google_dir / f"{slug}_places.geojson"
        if not google_path.exists():
            print(f"[skip] {slug}: no Google file at {google_path}")
            continue
        pairs.append((slug, google_path, blocks_path))
    return pairs


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--google-dir", required=True, type=Path,
                    help="Dir of {slug}_places.geojson from download-places-by-ava.py")
    ap.add_argument("--links-dir",  required=True, type=Path,
                    help="Dir of {slug}-linked-blocks.geojson (WineryLinks)")
    ap.add_argument("--parcels",    required=True, type=Path,
                    help="Parcel GeoPackage for point-in-parcel lookup")
    ap.add_argument("--ava",        default=None,
                    help="Process a single AVA slug (default: all paired)")
    ap.add_argument("--out-dir",    default=None, type=Path,
                    help="Write tagged copies here (default: overwrite in place)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Preview tagging without writing files")
    args = ap.parse_args()

    for p in [args.google_dir, args.links_dir, args.parcels]:
        if not p.exists():
            sys.exit(f"Not found: {p}")

    if args.dry_run:
        print("=== DRY RUN — no files will be written ===")

    pairs = discover_avas(args.google_dir, args.links_dir, args.ava)
    if not pairs:
        sys.exit("No AVA file pairs found to process.")

    total = 0
    for slug, google_path, blocks_path in pairs:
        total += process_ava(
            slug, google_path, blocks_path, args.parcels, args.out_dir, args.dry_run,
        )

    print(f"\n{'='*55}")
    verb = "would be tagged" if args.dry_run else "tagged"
    print(f"Done — {total} block(s) {verb} across {len(pairs)} AVA(s).")


if __name__ == "__main__":
    main()
