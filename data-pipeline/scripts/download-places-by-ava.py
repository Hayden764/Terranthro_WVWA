"""
AVA Winery & Vineyard Finder
-----------------------------
Loads an AVA boundary from a GeoJSON file in public/data/,
tiles the bounding box with overlapping circles, queries Google
Places Nearby Search (New) for wineries and vineyards, deduplicates
by place_id, clips to the true AVA polygon, and writes a GeoJSON.

Requirements:
    pip install requests shapely

Usage:
    export GOOGLE_PLACES_API_KEY="your_key_here"

    # Search a named AVA (filename without .geojson, underscores or spaces ok)
    python download-places-by-ava.py --ava eola_amity_hills

    # Any arbitrary GeoJSON boundary
    python download-places-by-ava.py --boundary /path/to/region.geojson

    # Override output file, tile radius, or place types
    python download-places-by-ava.py --ava yamhill_carlton --radius 2500
    python download-places-by-ava.py --ava dundee_hills --types winery vineyard farm

Available AVA files (public/data/<name>.geojson):
    chehalem_mountains, dundee_hills, eola_amity_hills, laurelwood_district,
    lower_long_tom, mcminnville, mount_pisgah_polk_county, ribbon_ridge,
    tualatin_hills, van_duzer_corridor, willamette_valley, yamhill_carlton
"""

import os
import sys
import json
import time
import math
import argparse
import requests
from pathlib import Path
from shapely.geometry import Point, shape

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).resolve().parent
REPO_ROOT    = SCRIPT_DIR.parent.parent
AVA_DATA_DIR = REPO_ROOT / "apps" / "wvwa" / "public" / "data"

# ── Config ────────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")

# Default tile radius in meters. ~50% overlap at this spacing.
DEFAULT_RADIUS_M = 3000

# Google Places (New) caps at 20 results per request.
MAX_RESULTS_PER_TILE = 20

# Place types to search. Run one API pass per type to maximise recall.
DEFAULT_TYPES = ["winery", "vineyard"]

# ── AVA Loader ────────────────────────────────────────────────────────────────

def load_boundary(geojson_path: Path):
    """
    Returns (name, shapely_geometry) from a GeoJSON FeatureCollection
    or single Feature with a Polygon or MultiPolygon geometry.
    """
    with open(geojson_path) as f:
        data = json.load(f)

    if data["type"] == "FeatureCollection":
        features = data["features"]
        if not features:
            raise ValueError(f"No features in {geojson_path}")
        feat = features[0]
    elif data["type"] == "Feature":
        feat = data
    else:
        # Bare geometry
        return geojson_path.stem, shape(data)

    name = (
        feat.get("properties", {}).get("name")
        or feat.get("properties", {}).get("ava_id")
        or geojson_path.stem
    )
    return name, shape(feat["geometry"])


def resolve_ava_path(ava_arg: str) -> Path:
    """Accepts 'eola_amity_hills', 'Eola Amity Hills', etc."""
    slug = ava_arg.lower().replace(" ", "_").replace("-", "_")
    p = AVA_DATA_DIR / f"{slug}.geojson"
    if not p.exists():
        raise FileNotFoundError(
            f"No AVA file found at {p}\n"
            f"Available: {[x.stem for x in AVA_DATA_DIR.glob('*.geojson')]}"
        )
    return p

# ── Tile Generator ────────────────────────────────────────────────────────────

def _deg_lat(meters):
    return meters / 111_320

def _deg_lng(meters, lat):
    return meters / (111_320 * math.cos(math.radians(lat)))

def generate_tiles(polygon, radius_m):
    """
    Yields (lat, lng) centers covering the polygon's bbox.
    Step = radius so adjacent circles overlap by ~radius width.
    Only yields centers whose circle intersects the polygon.
    """
    minx, miny, maxx, maxy = polygon.bounds  # lng, lat order
    center_lat = (miny + maxy) / 2

    step_lat = _deg_lat(radius_m)
    step_lng = _deg_lng(radius_m, center_lat)

    lat = miny
    while lat <= maxy:
        lng = minx
        while lng <= maxx:
            circle_center = Point(lng, lat)
            # Quick prefilter: skip tiles whose center is far outside polygon
            if polygon.distance(circle_center) * 111_320 <= radius_m:
                yield (round(lat, 6), round(lng, 6))
            lng += step_lng
        lat += step_lat

# ── Places API ────────────────────────────────────────────────────────────────

FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.types",
    "places.rating",
    "places.userRatingCount",
    "places.websiteUri",
    "places.nationalPhoneNumber",
])

def search_nearby(lat, lng, radius_m, place_type):
    url = "https://places.googleapis.com/v1/places:searchNearby"
    headers = {
        "Content-Type":    "application/json",
        "X-Goog-Api-Key":  API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
    }
    body = {
        "includedTypes": [place_type],
        "maxResultCount": MAX_RESULTS_PER_TILE,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": float(radius_m),
            }
        },
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=10)
        resp.raise_for_status()
        return resp.json().get("places", [])
    except requests.exceptions.RequestException as e:
        print(f"  [ERROR] ({lat}, {lng}) type={place_type}: {e}")
        return []

# ── Clip ──────────────────────────────────────────────────────────────────────

def within_polygon(place, polygon):
    loc = place.get("location", {})
    lat, lng = loc.get("latitude"), loc.get("longitude")
    if lat is None or lng is None:
        return False
    return polygon.contains(Point(lng, lat))

# ── GeoJSON ───────────────────────────────────────────────────────────────────

def to_feature(place):
    loc = place.get("location", {})
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [loc.get("longitude"), loc.get("latitude")],
        },
        "properties": {
            "place_id":     place.get("id"),
            "name":         (place.get("displayName") or {}).get("text"),
            "address":      place.get("formattedAddress"),
            "rating":       place.get("rating"),
            "review_count": place.get("userRatingCount"),
            "website":      place.get("websiteUri"),
            "phone":        place.get("nationalPhoneNumber"),
            "types":        place.get("types", []),
        },
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Download wineries/vineyards for an AVA or region.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ava",      metavar="NAME",
                       help="AVA slug or name (matches public/data/<name>.geojson)")
    group.add_argument("--boundary", metavar="PATH",
                       help="Path to any GeoJSON boundary file")
    parser.add_argument("--radius",  type=int, default=DEFAULT_RADIUS_M,
                        help=f"Tile search radius in meters (default: {DEFAULT_RADIUS_M})")
    parser.add_argument("--types",   nargs="+", default=DEFAULT_TYPES,
                        help=f"Place types to query (default: {DEFAULT_TYPES})")
    parser.add_argument("--output",  metavar="FILE",
                        help="Output GeoJSON path (default: <ava>_places.geojson)")
    args = parser.parse_args()

    if not API_KEY:
        print("Error: set GOOGLE_PLACES_API_KEY before running.")
        sys.exit(1)

    # Load boundary
    if args.ava:
        geojson_path = resolve_ava_path(args.ava)
    else:
        geojson_path = Path(args.boundary)

    ava_name, polygon = load_boundary(geojson_path)

    output_file = args.output or f"{geojson_path.stem}_places.geojson"

    tiles = list(generate_tiles(polygon, args.radius))

    print(f"Region:         {ava_name}")
    print(f"Boundary file:  {geojson_path}")
    print(f"Place types:    {args.types}")
    print(f"Tiles:          {len(tiles)}  (radius={args.radius}m)")
    print(f"Max API calls:  {len(tiles) * len(args.types)}")
    print(f"Output:         {output_file}")
    print("-" * 50)

    seen_ids  = set()
    all_places = []

    for place_type in args.types:
        print(f"\n── Type: {place_type} ──")
        for i, (lat, lng) in enumerate(tiles, 1):
            print(f"  Tile {i}/{len(tiles)} ({lat}, {lng})...", end=" ", flush=True)
            results = search_nearby(lat, lng, args.radius, place_type)

            new_count = 0
            for place in results:
                pid = place.get("id")
                if pid and pid not in seen_ids:
                    seen_ids.add(pid)
                    all_places.append(place)
                    new_count += 1

            print(f"{len(results)} returned, {new_count} new")
            time.sleep(0.2)

    print("\n" + "-" * 50)
    print(f"Raw total (pre-clip):  {len(all_places)} unique places")

    clipped = [p for p in all_places if within_polygon(p, polygon)]
    print(f"Within AVA polygon:    {len(clipped)} places")

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "ava":               ava_name,
            "boundary_file":     str(geojson_path),
            "place_types":       args.types,
            "tile_radius_m":     args.radius,
            "tile_count":        len(tiles),
            "total_before_clip": len(all_places),
            "total_after_clip":  len(clipped),
        },
        "features": [to_feature(p) for p in clipped],
    }

    with open(output_file, "w") as f:
        json.dump(geojson, f, indent=2)

    print(f"\nSaved → {output_file}")

    # Summary table
    print("\nName                              | Rating | Reviews | Types")
    print("-" * 70)
    for p in sorted(clipped, key=lambda x: x.get("rating") or 0, reverse=True):
        name    = ((p.get("displayName") or {}).get("text") or "Unknown")[:33]
        rating  = p.get("rating", "—")
        reviews = p.get("userRatingCount", "—")
        types   = ", ".join(p.get("types", []))[:20]
        print(f"{name:<33} | {rating:<6} | {reviews:<7} | {types}")


if __name__ == "__main__":
    main()
