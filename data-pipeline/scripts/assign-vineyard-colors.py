#!/usr/bin/env python3
"""
assign-vineyard-colors.py

Assigns each named WVWA-MEMBER vineyard a palette slot (color_index) so that no
two spatially adjacent member vineyards share a color — the "map coloring"
problem, solved with a greedy graph-coloring so the result is deterministic and
legible.

Only member vineyards are colored: on the map, non-members render grey and
unnamed parcels render white, so neither needs a palette slot. A member vineyard
therefore only has to differ from its adjacent *member* vineyards; grey/white
neighbours are a separate visual class and can't clash.

Pipeline:
  1. Fetch all parcels that are WVWA-member-linked and have a non-empty
     vineyard_name.
  2. Dissolve parcels into one geometry per normalized vineyard_name.
  3. Build an adjacency graph over member vineyards:
       - near-touching pairs (gap <= --tolerance metres), and
       - Delaunay neighbours within --max-delaunay metres (so isolated
         vineyards still differ from their nearest neighbours → better spread).
  4. Greedy-colour (Welsh-Powell order, load-balanced slot choice) into a
     palette of --palette-size slots. No adjacent pair repeats.
  5. Upsert (vineyard_key, color_index, ...) into the vineyard_colors table.

The palette HEX values are NOT stored here — they live in the frontend paint
expression (WVWAMap.jsx). This script only assigns integer slots, so recolouring
the map is a frontend-only change as long as the slot count stays the same.

Usage:
  python3 assign-vineyard-colors.py                 # compute + write
  python3 assign-vineyard-colors.py --dry-run       # compute + report, no write
  python3 assign-vineyard-colors.py --palette-size 12 --tolerance 100
"""

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import psycopg2
import psycopg2.extras

# ── Config ──────────────────────────────────────────────────────────────────
# Projected CRS for metric buffering/centroids (Willamette Valley → UTM 10N).
PROJECTED_CRS = 32610
DEFAULT_PALETTE_SIZE = 11      # colorblind-safe hues defined on the frontend
DEFAULT_TOLERANCE_M = 75.0     # gap up to this counts as "adjacent"
DEFAULT_MAX_DELAUNAY_M = 3000.0  # cap on non-touching Delaunay edges

REPO_ROOT = Path(__file__).resolve().parents[2]

# Auto-load server/.env so DATABASE_URL is available without manual export
_env_file = REPO_ROOT / "server" / ".env"
if _env_file.exists() and not os.environ.get("DATABASE_URL"):
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, val = line.partition("=")
            os.environ.setdefault(key.strip(), val.strip())


def get_conn():
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        parsed = urlparse(dsn)
        is_supabase = "supabase" in (parsed.hostname or "")
        ssl_config = {"sslmode": "require"} if is_supabase else {}
        return psycopg2.connect(dsn, **ssl_config)

    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        dbname=os.environ.get("DB_NAME", "terranthro"),
        user=os.environ.get("DB_USER", "terranthro_user"),
        password=os.environ.get("DB_PASSWORD", "terranthro_pass"),
    )


def fetch_vineyards(conn):
    """
    Return a GeoDataFrame with one dissolved geometry per normalized MEMBER
    vineyard name. Requires geopandas/shapely (imported lazily so --help works
    without them).

    Only WVWA-member-linked parcels are included — non-members render grey on the
    map and don't participate in the color graph.
    """
    import geopandas as gpd
    from shapely import wkt  # noqa: F401  (ensures shapely is present)

    sql = """
        SELECT
            LOWER(TRIM(vp.vineyard_name)) AS vineyard_key,
            ST_AsText(vp.geometry)        AS wkt
        FROM vineyards vp
        JOIN wineries w ON vp.winery_id = w.id
        WHERE vp.vineyard_name IS NOT NULL
          AND TRIM(vp.vineyard_name) <> ''
          AND vp.geometry IS NOT NULL
          AND COALESCE(w.is_wvwa_member, false) = true
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    if not rows:
        return gpd.GeoDataFrame(columns=["vineyard_key", "geometry"], crs=4326)

    from shapely import from_wkt

    keys = [r[0] for r in rows]
    geoms = [from_wkt(r[1]) for r in rows]
    gdf = gpd.GeoDataFrame({"vineyard_key": keys}, geometry=geoms, crs=4326)

    # Repair invalid geometries so buffer/centroid are well-defined.
    gdf["geometry"] = gdf.geometry.buffer(0)

    # One geometry per vineyard (a vineyard = all parcels sharing its name).
    dissolved = gdf.dissolve(by="vineyard_key", as_index=False)
    return dissolved.to_crs(PROJECTED_CRS)


def build_adjacency(gdf_m, tolerance_m, max_delaunay_m):
    """
    Build an adjacency dict {node_index: set(neighbour_indices)} combining:
      - near-touching pairs (gap <= tolerance_m), via a buffered spatial join, and
      - Delaunay edges shorter than max_delaunay_m (spread for isolated vineyards).
    """
    import geopandas as gpd

    n = len(gdf_m)
    adj = {i: set() for i in range(n)}
    gdf_m = gdf_m.reset_index(drop=True)

    # ── Near-touching pairs: buffer each geometry by the tolerance, then any
    #    overlap with another (unbuffered) geometry means the gap <= tolerance.
    buffered = gdf_m.copy()
    buffered["geometry"] = buffered.geometry.buffer(tolerance_m)
    joined = gpd.sjoin(
        buffered[["geometry"]],
        gdf_m[["geometry"]],
        predicate="intersects",
        how="inner",
    )
    for left_i, right_i in zip(joined.index, joined["index_right"]):
        if left_i != right_i:
            adj[int(left_i)].add(int(right_i))
            adj[int(right_i)].add(int(left_i))

    # ── Delaunay edges (only if enough points), capped by distance.
    if n >= 4:
        from scipy.spatial import Delaunay

        cents = np.array([[c.x, c.y] for c in gdf_m.geometry.centroid])
        try:
            tri = Delaunay(cents)
        except Exception:
            tri = None
        if tri is not None:
            for simplex in tri.simplices:
                for a, b in ((simplex[0], simplex[1]),
                             (simplex[1], simplex[2]),
                             (simplex[0], simplex[2])):
                    a, b = int(a), int(b)
                    if a == b:
                        continue
                    dist = float(np.hypot(*(cents[a] - cents[b])))
                    if dist <= max_delaunay_m:
                        adj[a].add(b)
                        adj[b].add(a)

    return adj


def greedy_color(adj, palette_size):
    """
    Welsh-Powell greedy colouring with load-balanced slot choice.

    Nodes are coloured in descending-degree order. Among the palette slots not
    used by an already-coloured neighbour, we pick the globally least-used slot
    so colours spread evenly across the map instead of clustering on slot 0.

    Returns (color_of_node dict, forced_clashes count). A forced clash only
    happens if a node's neighbours already occupy every slot (needs
    degree >= palette_size), which is unlikely for a near-planar graph.
    """
    order = sorted(adj.keys(), key=lambda k: len(adj[k]), reverse=True)
    color = {}
    usage = [0] * palette_size
    forced_clashes = 0

    for node in order:
        used = {color[m] for m in adj[node] if m in color}
        available = [c for c in range(palette_size) if c not in used]
        if available:
            chosen = min(available, key=lambda c: usage[c])
        else:
            # Every slot taken by a neighbour — reuse the least-used slot.
            chosen = min(range(palette_size), key=lambda c: usage[c])
            forced_clashes += 1
        color[node] = chosen
        usage[chosen] += 1

    return color, forced_clashes


def write_colors(conn, gdf_m, color, adj, palette_size):
    rows = [
        (
            gdf_m.iloc[i]["vineyard_key"],
            int(color[i]),
            len(adj[i]),
            int(palette_size),
        )
        for i in range(len(gdf_m))
    ]
    with conn.cursor() as cur:
        # Replace the full assignment so removed vineyards don't linger.
        cur.execute("TRUNCATE vineyard_colors")
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO vineyard_colors
                (vineyard_key, color_index, neighbor_count, palette_size)
            VALUES %s
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--palette-size", type=int, default=DEFAULT_PALETTE_SIZE,
                        help=f"number of palette slots (default {DEFAULT_PALETTE_SIZE})")
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE_M,
                        help=f"gap in metres counted as adjacent (default {DEFAULT_TOLERANCE_M})")
    parser.add_argument("--max-delaunay", type=float, default=DEFAULT_MAX_DELAUNAY_M,
                        help=f"cap on non-touching Delaunay edges in metres (default {DEFAULT_MAX_DELAUNAY_M})")
    parser.add_argument("--dry-run", action="store_true",
                        help="compute and report, but do not write to the database")
    args = parser.parse_args()

    if args.palette_size < 2:
        print("palette-size must be >= 2", file=sys.stderr)
        sys.exit(1)

    try:
        conn = get_conn()
    except Exception as e:
        print(f"DB connection failed: {e}", file=sys.stderr)
        sys.exit(1)

    print("Fetching + dissolving member vineyards by name...")
    gdf_m = fetch_vineyards(conn)
    n = len(gdf_m)
    if n == 0:
        print("No named member vineyards found — nothing to color.")
        return
    print(f"  {n} named member vineyards")

    print(f"Building adjacency (tolerance={args.tolerance}m, "
          f"max-delaunay={args.max_delaunay}m)...")
    adj = build_adjacency(gdf_m, args.tolerance, args.max_delaunay)
    degrees = [len(adj[i]) for i in range(n)]
    max_degree = max(degrees) if degrees else 0
    avg_degree = (sum(degrees) / n) if n else 0
    print(f"  max degree={max_degree}, avg degree={avg_degree:.1f}")

    if max_degree >= args.palette_size:
        print(f"  ⚠ max degree ({max_degree}) >= palette size "
              f"({args.palette_size}); some forced clashes are possible.")

    print(f"Coloring into {args.palette_size} slots...")
    color, forced = greedy_color(adj, args.palette_size)
    usage = [0] * args.palette_size
    for c in color.values():
        usage[c] += 1
    print(f"  slot usage: {usage}")
    if forced:
        print(f"  ⚠ {forced} vineyard(s) had no clash-free slot (reused least-used).")
    else:
        print("  ✓ no adjacent vineyards share a color")

    if args.dry_run:
        print("Dry run — not writing to database.")
        return

    written = write_colors(conn, gdf_m, color, adj, args.palette_size)
    print(f"Wrote {written} rows to vineyard_colors.")


if __name__ == "__main__":
    main()
