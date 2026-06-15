"""
vectorize-predictions.py — Convert vineyard prediction masks to GeoJSON polygons
=================================================================================

Reads binary mask GeoTIFFs (uint8, 0/255) produced by ml/predict.py, applies
raster-level post-processing to clean up noise, then extracts polygons and
writes a single GeoJSON file of vineyard polygons.

Post-processing pipeline (raster, per tile)
-------------------------------------------
  1. Fill holes  — interior gaps inside vineyard regions are closed
                   (e.g. shadowed vine rows that the model missed)
  2. Close       — small morphological closing joins fragments separated by
                   narrow gaps and smooths jagged edges
  3. Remove blobs — connected components below --min-area are dropped before
                   vectorizing, so no tiny polygons ever reach the output

Post-processing pipeline (vector, per polygon)
----------------------------------------------
  4. Drop interior rings  — removes any remaining donuts/holes inside polygons
  5. Simplify             — reduces vertex count, smooths boundaries

Designed to produce clean polygons suitable for:
  - QGIS editing and visual QA
  - Use as training labels in the next training round (--blocks-file)
  - Import into the Terranthro database

Usage
-----
  # Vectorize all masks in a predictions directory
  .venv/bin/python scripts/vectorize-predictions.py \
      --masks-dir  data/predictions/eola-2022/ \
      --out        data/training/eola-amity-predicted.geojson

  # Raise minimum area to reduce false positives (default: 500 m²)
  .venv/bin/python scripts/vectorize-predictions.py \
      --masks-dir  data/predictions/eola-2022/ \
      --out        data/training/eola-amity-predicted.geojson \
      --min-area   1000

  # Output in UTM (skip reprojection to WGS84)
  .venv/bin/python scripts/vectorize-predictions.py \
      --masks-dir  data/predictions/eola-2022/ \
      --out        data/training/eola-amity-predicted.geojson \
      --crs        32610
"""

import argparse
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
import rasterio
from rasterio.features import shapes
import numpy as np
import json
from tqdm import tqdm
from scipy import ndimage


# ---------------------------------------------------------------------------
# Raster post-processing
# ---------------------------------------------------------------------------

def postprocess_mask(binary: np.ndarray, transform, min_area_m2: float, closing_m: float):
    """
    Clean up a binary uint8 mask (1/0) in the raster domain before vectorizing.

      1. Fill holes inside connected foreground regions.
      2. Morphological closing — joins nearby fragments, smooths edges.
      3. Remove small connected components below min_area_m2.

    Returns a cleaned uint8 array (1/0).
    """
    mask = binary.astype(bool)

    # 1. Fill interior holes (e.g. shadowed rows the model missed)
    mask = ndimage.binary_fill_holes(mask)

    # 2. Morphological closing — radius in pixels from closing_m
    pixel_size = abs(transform.a)          # metres per pixel (EPSG:32610)
    radius_px  = max(1, round(closing_m / pixel_size))
    struct     = ndimage.generate_binary_structure(2, 1)
    struct     = ndimage.iterate_structure(struct, radius_px)
    mask       = ndimage.binary_closing(mask, structure=struct)

    # 3. Remove small blobs
    labeled, n = ndimage.label(mask)
    if n > 0:
        sizes      = ndimage.sum(mask, labeled, range(1, n + 1))
        px_area    = pixel_size ** 2
        keep       = np.array(sizes) * px_area >= min_area_m2
        remove_ids = np.where(~keep)[0] + 1
        for rid in remove_ids:
            mask[labeled == rid] = False

    return mask.astype(np.uint8)


# ---------------------------------------------------------------------------
# Per-tile vectorization
# ---------------------------------------------------------------------------

def vectorize_mask(mask_path: Path, min_area_m2: float, closing_m: float):
    """
    Load a mask tile, post-process it, and return (polygons, crs).
    Polygons are shapely geometries in the tile's native CRS (EPSG:32610).
    """
    with rasterio.open(mask_path) as src:
        data      = src.read(1)
        transform = src.transform
        crs       = src.crs

    binary  = (data == 255).astype(np.uint8)
    cleaned = postprocess_mask(binary, transform, min_area_m2, closing_m)

    polys = []
    for geom, val in shapes(cleaned, transform=transform):
        if val != 1:
            continue
        s = shape(geom)
        if s.area >= min_area_m2:
            polys.append(s)

    return polys, crs


def drop_holes(geom):
    """Remove interior rings from a Polygon or MultiPolygon."""
    if isinstance(geom, Polygon):
        return Polygon(geom.exterior)
    if isinstance(geom, MultiPolygon):
        return MultiPolygon([Polygon(p.exterior) for p in geom.geoms])
    return geom


def main():
    parser = argparse.ArgumentParser(
        description="Vectorize vineyard prediction masks to a GeoJSON polygon file"
    )
    parser.add_argument("--masks-dir", required=True,
                        help="Directory containing *_mask.tif files")
    parser.add_argument("--out",       required=True,
                        help="Output GeoJSON path")
    parser.add_argument("--min-area",  type=float, default=500.0,
                        help="Minimum polygon area in m² (default: 500)")
    parser.add_argument("--closing",   type=float, default=3.0,
                        help="Morphological closing radius in metres — joins nearby fragments (default: 3.0)")
    parser.add_argument("--simplify",  type=float, default=1.0,
                        help="Simplification tolerance in metres (default: 1.0)")
    parser.add_argument("--crs",       type=int,   default=4326,
                        help="Output CRS as EPSG code (default: 4326 / WGS84)")
    args = parser.parse_args()

    masks_dir = Path(args.masks_dir)
    out_path  = Path(args.out)
    mask_files = sorted(masks_dir.glob("*_mask.tif"))

    if not mask_files:
        print(f"No *_mask.tif files found in {masks_dir}")
        return

    print(f"Mask files      : {len(mask_files)}")
    print(f"Min area        : {args.min_area} m²")
    print(f"Closing radius  : {args.closing} m")
    print(f"Simplify        : {args.simplify} m")
    print(f"Output CRS      : EPSG:{args.crs}")
    print(f"Output          : {out_path}")

    all_polys = []
    native_crs = None

    for mask_path in tqdm(mask_files, desc="Vectorizing", unit="tile"):
        polys, crs = vectorize_mask(mask_path, args.min_area, args.closing)
        all_polys.extend(polys)
        if native_crs is None:
            native_crs = crs

    print(f"\nRaw polygons    : {len(all_polys)}")

    # Drop interior rings (holes inside vineyard polygons)
    all_polys = [drop_holes(p) for p in all_polys]

    # Simplify to reduce vertex count and smooth jagged edges
    if args.simplify > 0:
        all_polys = [p.simplify(args.simplify, preserve_topology=True) for p in all_polys]
        all_polys = [p for p in all_polys if not p.is_empty and p.area >= args.min_area]

    print(f"After clean     : {len(all_polys)}")

    # Capture area in the NATIVE CRS (metres, EPSG:32610) BEFORE any
    # reprojection — polygon .area in degrees (EPSG:4326) is meaningless.
    areas_m2 = [p.area for p in all_polys]
    total_ha = sum(areas_m2) / 10_000

    # Reproject to output CRS if needed
    if args.crs != int(native_crs.to_epsg()):
        from pyproj import Transformer
        from shapely.ops import transform as shp_transform

        transformer = Transformer.from_crs(
            native_crs.to_epsg(), args.crs, always_xy=True
        )
        all_polys = [
            shp_transform(transformer.transform, p) for p in all_polys
        ]

    # Build GeoJSON — area_m2 carried from the pre-reprojection metres value
    features = [
        {
            "type": "Feature",
            "geometry": mapping(p),
            "properties": {"area_m2": round(a, 1)},
        }
        for p, a in zip(all_polys, areas_m2)
        if p.is_valid and not p.is_empty
    ]

    geojson = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": f"EPSG:{args.crs}"}},
        "features": features,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(geojson, f)

    print(f"Features written: {len(features)}")
    print(f"Total area      : {total_ha:.1f} ha")
    print(f"Output          : {out_path}")


if __name__ == "__main__":
    main()
