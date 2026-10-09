"""
Terrain Distribution per AVA
============================
For every Oregon AVA, summarises the DOGAMI 3 m lidar topography over the AVA's
Oregon portion (ava_states.geometry, migration 028) and writes:

  ava_terrain_distribution (migration 029)
      elevation  100 ft bins
      slope      1° bins (45°+ open-ended)
      aspect     8 compass sectors, plus flat land (slope < 3°)
  ava_topo_stats
      elevation min/max (1st / 99.9th percentile) and mean (ft), slope mean/max (°),
      dominant aspect (sector centre °)

An AVA whose regulation limits it by elevation (LEGAL_ELEVATION_FT) is summarised
over that band only: land the drawn polygon encloses outside it is not in the AVA.

Rasters are the same folders the statewide map tiles are built from
(build-topo-value-tiles.py --sources statewide): elevation in feet, slope and
aspect in degrees, UTM 10N, mosaicked through VRTs. They are read at 9 m (3×3
averaging; nearest for aspect) — plenty for land-share statistics and ~9× less
I/O than full resolution on the million-acre AVAs.

Prerequisite:
    - Migrations 028 and 029 applied; state boundaries loaded
    - All five DOGAMI regions downloaded (download-dogami-dem.py --clip …)
    - DATABASE_URL is set in environment

Usage:
    python compute-ava-terrain.py --dry-run          # compute + print, write nothing
    python compute-ava-terrain.py                    # every Oregon AVA
    python compute-ava-terrain.py --avas dundee-hills,rogue-valley
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import List, Optional

import click
import numpy as np
import psycopg2
import psycopg2.extras
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("topo_tiles", HERE / "build-topo-value-tiles.py")
tt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tt)

DECIMATE = 3                    # read 3 m rasters at 9 m
STRIP_ROWS = 1024               # output rows per strip (bounds memory on huge AVAs)
ELEV_BIN_FT = 100
SLOPE_MAX_BIN = 45
FLAT_SLOPE_DEG = 3.0
SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
# The summary min/max are these percentiles of the land, so a stray lidar
# pixel (water surfaces read tens of feet below sea level) can't set them. The
# low end is the 1st percentile: most sub-AVAs are drawn along the 200-ft contour
# from 1950s-90s USGS quads, and the thin edge slivers that line's ±5-10 ft map
# accuracy leaves inside the polygon would otherwise set the minimum (196 ft for
# Dundee Hills at the 0.1th).
RANGE_PCT = (1.0, 99.9)
# AVAs whose CFR text limits them to an elevation band, in feet.
LEGAL_ELEVATION_FT = {
    "yamhill-carlton": (200, 1000),  # 27 CFR 9.183: "at or above 200 feet ... at or below 1,000 feet"
}
FT_OFFSET, FT_SPAN = 500, 16000  # 1 ft histogram over -500..15,500 ft for those percentiles
NODATA = -9999
SQM_PER_ACRE = 4046.8564224
SOURCE = "DOGAMI lidar 3 m"
VRT_DIR = tt.TOPO_DIR / "statewide_vrt"


def statewide_rasters() -> dict:
    """Persistent VRT mosaics of elevation / slope / aspect over every region."""
    folders = [tt.TOPO_DIR / f for f in tt.SOURCE_SETS["statewide"][0]]
    for f in folders:
        tt.derive_missing(f)
    VRT_DIR.mkdir(exist_ok=True)
    return {layer: tt.source_raster(folders, layer, VRT_DIR) for layer in ("elevation", "slope", "aspect")}


def fetch_avas(conn, slugs: Optional[List[str]]):
    sql = """SELECT a.id, a.slug, ST_AsGeoJSON(av.geometry)
             FROM avas a
             JOIN ava_states av ON av.ava_id = a.id
             JOIN states s ON s.id = av.state_id
             WHERE s.abbreviation = 'OR' AND av.geometry IS NOT NULL"""
    params: list = []
    if slugs:
        sql += " AND a.slug = ANY(%s)"
        params.append(slugs)
    with conn.cursor() as cur:
        cur.execute(sql + " ORDER BY a.slug", params)
        return [(i, s, json.loads(g)) for i, s, g in cur.fetchall()]


def summarise(geom_wgs84: dict, ras: dict, band_ft: Optional[tuple] = None) -> Optional[dict]:
    with rasterio.open(ras["elevation"]) as e, rasterio.open(ras["slope"]) as s, rasterio.open(ras["aspect"]) as a:
        geom = transform_geom("EPSG:4326", e.crs, geom_wgs84)
        xs = [p[0] for poly in _polys(geom) for ring in poly for p in ring]
        ys = [p[1] for poly in _polys(geom) for ring in poly for p in ring]
        win = from_bounds(min(xs), min(ys), max(xs), max(ys), e.transform).round_offsets().round_lengths()
        win = win.intersection(Window(0, 0, e.width, e.height))
        out_w = max(1, int(win.width // DECIMATE))
        px_area = (e.res[0] * DECIMATE) * (e.res[1] * DECIMATE)

        elev_hist, slope_hist = {}, np.zeros(SLOPE_MAX_BIN + 1)
        ft_hist = np.zeros(FT_SPAN, dtype=np.int64)
        sector_area, flat_area = np.zeros(8), 0.0
        n = 0
        e_sum, s_sum, s_max = 0.0, 0.0, 0.0
        src_rows = STRIP_ROWS * DECIMATE
        for r0 in range(int(win.row_off), int(win.row_off + win.height), src_rows):
            h = min(src_rows, int(win.row_off + win.height) - r0)
            strip = Window(win.col_off, r0, win.width, h)
            shape = (max(1, h // DECIMATE), out_w)
            ev = e.read(1, window=strip, out_shape=shape, resampling=Resampling.average).astype("float64")
            sv = s.read(1, window=strip, out_shape=shape, resampling=Resampling.average).astype("float64")
            av = a.read(1, window=strip, out_shape=shape, resampling=Resampling.nearest).astype("float64")
            tr = e.window_transform(strip) * rasterio.Affine.scale(strip.width / shape[1], strip.height / shape[0])
            inside = ~geometry_mask([geom], out_shape=shape, transform=tr, all_touched=False)
            ok = inside & (ev > NODATA + 1)
            if band_ft:
                ok &= (ev >= band_ft[0]) & (ev <= band_ft[1])
            if not ok.any():
                continue
            ev, sv, av = ev[ok], np.maximum(sv[ok], 0), av[ok]
            n += ev.size
            ft_hist += np.bincount(np.clip(np.round(ev).astype(int) + FT_OFFSET, 0, FT_SPAN - 1), minlength=FT_SPAN)
            e_sum += ev.sum()
            s_sum += sv.sum()
            s_max = max(s_max, sv.max())
            for b, c in zip(*np.unique(np.floor(ev / ELEV_BIN_FT).astype(int), return_counts=True)):
                elev_hist[int(b)] = elev_hist.get(int(b), 0) + int(c)
            slope_hist += np.bincount(np.minimum(np.floor(sv).astype(int), SLOPE_MAX_BIN), minlength=SLOPE_MAX_BIN + 1)
            flat = (sv < FLAT_SLOPE_DEG) | (av < 0) | (av > 360)
            flat_area += flat.sum()
            sec = (np.floor(((av[~flat] + 22.5) % 360) / 45)).astype(int)
            sector_area += np.bincount(sec, minlength=8)
        if n == 0:
            return None

    acres = lambda count: float(count) * px_area / SQM_PER_ACRE
    pct = lambda count: float(count) / n * 100.0
    cdf = np.cumsum(ft_hist) / n * 100.0
    e_min, e_max = (float(np.searchsorted(cdf, p) - FT_OFFSET) for p in RANGE_PCT)
    rows = []
    for b in sorted(elev_hist):
        rows.append(("elevation", b * ELEV_BIN_FT, (b + 1) * ELEV_BIN_FT, acres(elev_hist[b]), pct(elev_hist[b])))
    for b, c in enumerate(slope_hist):
        if c:
            rows.append(("slope", int(b), int(b) + 1 if b < SLOPE_MAX_BIN else 90, acres(c), pct(c)))
    for i, c in enumerate(sector_area):
        if c:
            rows.append(("aspect", i * 45 - 22.5, i * 45 + 22.5, acres(c), pct(c)))
    if flat_area:
        rows.append(("aspect", -1, -1, acres(flat_area), pct(flat_area)))
    dominant = int(np.argmax(sector_area)) if sector_area.any() else None
    return {
        "rows": rows,
        "summary": {
            "elevation_min_ft": e_min, "elevation_max_ft": e_max, "elevation_mean_ft": e_sum / n,
            "slope_mean_deg": s_sum / n, "slope_max_deg": float(s_max),
            "aspect_dominant_deg": dominant * 45.0 if dominant is not None else None,
        },
        "acres": acres(n),
        "dominant": SECTORS[dominant] if dominant is not None else None,
        "flat_pct": pct(flat_area),
    }


def _polys(geom: dict):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]


def write(conn, ava_id: int, res: dict) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ava_terrain_distribution WHERE ava_id = %s", (ava_id,))
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO ava_terrain_distribution (ava_id, layer, bin_lo, bin_hi, acres, pct, data_source)
               VALUES %s""",
            [(ava_id, layer, lo, hi, round(ac, 1), round(p, 2), SOURCE) for layer, lo, hi, ac, p in res["rows"]],
        )
        s = res["summary"]
        cur.execute(
            """INSERT INTO ava_topo_stats (ava_id, elevation_min_ft, elevation_max_ft, elevation_mean_ft,
                                           slope_mean_deg, slope_max_deg, aspect_dominant_deg, data_source, computed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
               ON CONFLICT (ava_id) DO UPDATE SET
                 elevation_min_ft = EXCLUDED.elevation_min_ft, elevation_max_ft = EXCLUDED.elevation_max_ft,
                 elevation_mean_ft = EXCLUDED.elevation_mean_ft, slope_mean_deg = EXCLUDED.slope_mean_deg,
                 slope_max_deg = EXCLUDED.slope_max_deg, aspect_dominant_deg = EXCLUDED.aspect_dominant_deg,
                 data_source = EXCLUDED.data_source, computed_at = NOW()""",
            (ava_id, round(s["elevation_min_ft"], 2), round(s["elevation_max_ft"], 2), round(s["elevation_mean_ft"], 2),
             round(s["slope_mean_deg"], 4), round(s["slope_max_deg"], 4), s["aspect_dominant_deg"], SOURCE),
        )


@click.command()
@click.option("--avas", "slugs", default=None, help="Comma-separated AVA slugs (default: every Oregon AVA).")
@click.option("--dry-run", is_flag=True, default=False, help="Compute and print; write nothing.")
def main(slugs, dry_run):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    ras = statewide_rasters()
    conn = psycopg2.connect(dsn)
    avas = fetch_avas(conn, [s.strip() for s in slugs.split(",")] if slugs else None)
    click.echo(f"{len(avas)} AVAs")
    results = {}
    for ava_id, slug, geom in avas:
        band = LEGAL_ELEVATION_FT.get(slug)
        res = summarise(geom, ras, band)
        if res is None:
            click.echo(f"  {slug:40} no topography data")
            continue
        s = res["summary"]
        results[slug] = {"summary": s, "rows": res["rows"]}
        click.echo(f"  {slug:40} {res['acres']:>11,.0f} ac  elev {s['elevation_min_ft']:,.0f}–{s['elevation_max_ft']:,.0f} ft "
                   f"(mean {s['elevation_mean_ft']:,.0f})  slope {s['slope_mean_deg']:.1f}°  "
                   f"{res['dominant']}-facing, {res['flat_pct']:.0f}% flat"
                   + (f"  [legal band {band[0]:,}–{band[1]:,} ft]" if band else ""))
        if not dry_run:
            write(conn, ava_id, res)
            conn.commit()
    out = tt.ROOT / "data" / "topography" / "ava_terrain_distribution.json"
    out.write_text(json.dumps(results, indent=1))
    click.echo(f"{'--dry-run: nothing written to the database; ' if dry_run else 'written; '}full results in {out.name}")
    conn.close()


if __name__ == "__main__":
    main()
