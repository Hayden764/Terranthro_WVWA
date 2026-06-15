"""
score-parcels.py — flag the most suspicious vineyard label polygons
====================================================================

For every parcel polygon, mask the OSIP imagery to the polygon interior,
compute NDVI = (NIR - R)/(NIR + R) per pixel, and report what fraction of
the interior is actually vegetated (NDVI > --veg-thr).

A parcel that is genuinely canopy-clipped should be ~all vegetation
(veg_frac near 1.0).  Parcels with a LOW veg_frac enclose bare ground,
buildings, water, or roads — i.e. the label is wrong or sloppy.  These are
the ones worth inspecting first in QGIS.

Parcels that fall in imagery gaps (no OSIP tile) are skipped.

Output: a CSV sorted worst-first, plus a small GeoJSON of the worst N so
you can load just those in QGIS and zoom straight to them.
"""
import argparse, csv, json
from pathlib import Path

import numpy as np
import geopandas as gpd
import rasterio
from rasterio.mask import mask as rio_mask
from shapely.geometry import mapping


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parcels", required=True)
    ap.add_argument("--raster", required=True, help="OSIP VRT or tif (R,G,B,NIR)")
    ap.add_argument("--out-csv", required=True)
    ap.add_argument("--out-geojson", default=None,
                    help="optional GeoJSON of the worst --worst parcels")
    ap.add_argument("--veg-thr", type=float, default=0.30,
                    help="NDVI above this counts as vegetation")
    ap.add_argument("--worst", type=int, default=50)
    ap.add_argument("--min-valid-px", type=int, default=500,
                    help="skip parcels with fewer valid (in-imagery) pixels")
    args = ap.parse_args()

    parcels = gpd.read_file(args.parcels)
    src = rasterio.open(args.raster)
    parcels = parcels.to_crs(src.crs)

    id_field = next((f for f in
                     ["parcel_id", "vineyard_name", "owner_name"]
                     if f in parcels.columns), None)

    rows = []
    skipped_gap = 0
    for i, row in parcels.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        try:
            arr, _ = rio_mask(src, [mapping(geom)], crop=True, filled=True,
                              indexes=[1, 4])  # R, NIR
        except (ValueError, Exception):
            skipped_gap += 1
            continue

        red = arr[0].astype(np.float32)
        nir = arr[1].astype(np.float32)

        # valid = inside polygon AND has imagery (not an all-zero gap pixel)
        inside = (red + nir) > 0
        valid_px = int(inside.sum())
        if valid_px < args.min_valid_px:
            skipped_gap += 1
            continue

        denom = nir + red
        ndvi = np.where(denom > 0, (nir - red) / denom, 0.0)
        veg = (ndvi > args.veg_thr) & inside
        veg_frac = float(veg.sum()) / valid_px
        mean_ndvi = float(ndvi[inside].mean())

        rows.append({
            "idx": int(i),
            "id": str(row[id_field]) if id_field else str(i),
            "ava": str(row.get("ava_name", "")),
            "source": str(row.get("source_dataset", "")),
            "acres": round(float(row.get("acres", 0) or 0), 2),
            "valid_px": valid_px,
            "veg_frac": round(veg_frac, 3),
            "mean_ndvi": round(mean_ndvi, 3),
        })

    rows.sort(key=lambda r: r["veg_frac"])  # worst (least vegetated) first

    with open(args.out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    n = len(rows)
    print(f"Parcels scored        : {n}")
    print(f"Skipped (gap/too small): {skipped_gap}")
    if n:
        fracs = np.array([r["veg_frac"] for r in rows])
        print(f"veg_frac  p10/med/p90 : "
              f"{np.percentile(fracs,10):.2f} / "
              f"{np.percentile(fracs,50):.2f} / "
              f"{np.percentile(fracs,90):.2f}")
        print(f"parcels < 0.70 veg    : {(fracs<0.70).sum()}")
        print(f"parcels < 0.50 veg    : {(fracs<0.50).sum()}")
        print(f"\n--- {min(args.worst,n)} most suspicious (lowest veg_frac) ---")
        for r in rows[:args.worst]:
            print(f"  veg={r['veg_frac']:.2f}  ndvi={r['mean_ndvi']:+.2f}  "
                  f"{r['acres']:>6.2f}ac  {r['source']:<16} {r['id']}")

    if args.out_geojson and n:
        worst_idx = {r["idx"] for r in rows[:args.worst]}
        sub = parcels.loc[sorted(worst_idx)].to_crs("EPSG:4326")
        sub.to_file(args.out_geojson, driver="GeoJSON")
        print(f"\nWrote worst-{args.worst} polygons -> {args.out_geojson}")


if __name__ == "__main__":
    main()
