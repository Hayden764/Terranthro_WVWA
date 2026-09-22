"""
Monthly PRISM Climate per AVA and per Vineyard
==============================================
Reads the Oregon-cropped PRISM monthly grids written by download-prism-monthly.py
and writes one row per (entity, year, month) to climate_monthly (migration 024):

  - AVAs:      mean over every 800m cell whose centre falls inside the AVA
               boundary (public/data/<slug>.geojson); small AVAs with fewer than
               4 such cells fall back to every cell the boundary touches.
  - Vineyards: the cell under ST_PointOnSurface(vineyards.geometry).

All grids share one Oregon window, so masks / pixel indices are built once.

Usage:
    python compute-climate-monthly.py                 # all years on disk
    python compute-climate-monthly.py --start 2025 --skip-vineyards
"""

import io
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

import click
import numpy as np
import psycopg2
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import rowcol
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent / ".."
PRISM_DIR = ROOT / "data" / "climate" / "prism" / "monthly"
AVA_DIR = ROOT / ".." / "public" / "data"
AVA_FILES = [
    "willamette_valley", "chehalem_mountains", "laurelwood_district", "ribbon_ridge",
    "dundee_hills", "eola_amity_hills", "lower_long_tom", "mcminnville",
    "mount_pisgah_polk_county", "tualatin_hills", "van_duzer_corridor", "yamhill_carlton",
]
VARS = {"tmean": "tmean_c", "tmin": "tmin_c", "tmax": "tmax_c", "ppt": "ppt_mm"}
NAME_RE = re.compile(r"prism_(\w+)_or_800m_(\d{4})(\d{2})\.tif$")


def ava_masks(transform, shape):
    masks = {}
    for stem in AVA_FILES:
        gj = json.loads((AVA_DIR / f"{stem}.geojson").read_text())
        geoms = [f["geometry"] for f in gj["features"]] if gj.get("type") == "FeatureCollection" else [gj["geometry"]]
        inside = ~geometry_mask(geoms, out_shape=shape, transform=transform, all_touched=False)
        if inside.sum() < 4:
            inside = ~geometry_mask(geoms, out_shape=shape, transform=transform, all_touched=True)
        masks[stem.replace("_", "-")] = inside
    return masks


def vineyard_pixels(conn, transform, shape):
    with conn.cursor() as cur:
        cur.execute("""SELECT id, ST_X(p), ST_Y(p) FROM (
                         SELECT id, ST_PointOnSurface(ST_Transform(geometry, 4326)) p
                         FROM vineyards WHERE geometry IS NOT NULL) s""")
        rows = cur.fetchall()
    out = {}
    for vid, x, y in rows:
        r, c = rowcol(transform, x, y)
        if 0 <= r < shape[0] and 0 <= c < shape[1]:
            out[str(vid)] = (r, c)
    return out


@click.command()
@click.option("--start", default=1991, show_default=True)
@click.option("--end", default=2100, show_default=True)
@click.option("--skip-vineyards", is_flag=True, default=False)
def main(start, end, skip_vineyards):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    conn = psycopg2.connect(dsn)

    files = []
    for var in VARS:
        for p in sorted((PRISM_DIR / var).glob("prism_*_or_800m_*.tif")):
            m = NAME_RE.search(p.name)
            if m and start <= int(m.group(2)) <= end:
                files.append((var, int(m.group(2)), int(m.group(3)), p))
    if not files:
        click.echo("No PRISM grids found.")
        return

    with rasterio.open(files[0][3]) as ref:
        transform, shape = ref.transform, (ref.height, ref.width)
    masks = ava_masks(transform, shape)
    vpix = {} if skip_vineyards else vineyard_pixels(conn, transform, shape)
    click.echo(f"{len(files)} grids · {len(masks)} AVAs · {len(vpix)} vineyards")
    if vpix:
        vr = np.array([rc[0] for rc in vpix.values()])
        vc = np.array([rc[1] for rc in vpix.values()])
        vkeys = list(vpix.keys())

    # (entity_type, key, year, month) -> {column: value}
    values = defaultdict(dict)
    for var, year, month, path in tqdm(files, unit="grid"):
        with rasterio.open(path) as src:
            if (src.height, src.width) != shape or src.transform != transform:
                raise RuntimeError(f"{path.name}: grid differs from reference window")
            arr = src.read(1).astype("float64")
            nodata = src.nodata
        valid = arr != nodata if nodata is not None else np.isfinite(arr)
        col = VARS[var]
        for slug, m in masks.items():
            sel = m & valid
            if sel.any():
                values[("ava", slug, year, month)][col] = float(arr[sel].mean())
        if vpix:
            samp = arr[vr, vc]
            ok = valid[vr, vc]
            for k, v, good in zip(vkeys, samp, ok):
                if good:
                    values[("vineyard", k, year, month)][col] = float(v)

    click.echo(f"{len(values):,} entity-months → climate_monthly")
    buf = io.StringIO()
    for (etype, key, year, month), v in values.items():
        cells = [v.get(c) for c in VARS.values()]
        buf.write("\t".join([etype, key, str(year), str(month)] +
                            ["\\N" if x is None else f"{x:.4f}" for x in cells]) + "\n")
    buf.seek(0)
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE cm_load (LIKE climate_monthly INCLUDING DEFAULTS) ON COMMIT DROP")
        cur.copy_expert("COPY cm_load (entity_type, entity_key, year, month, tmean_c, tmin_c, tmax_c, ppt_mm) "
                        "FROM STDIN", buf)
        cur.execute("""
            INSERT INTO climate_monthly (entity_type, entity_key, year, month, tmean_c, tmin_c, tmax_c, ppt_mm)
            SELECT entity_type, entity_key, year, month, tmean_c, tmin_c, tmax_c, ppt_mm FROM cm_load
            ON CONFLICT (entity_type, entity_key, year, month) DO UPDATE SET
              tmean_c = COALESCE(EXCLUDED.tmean_c, climate_monthly.tmean_c),
              tmin_c  = COALESCE(EXCLUDED.tmin_c,  climate_monthly.tmin_c),
              tmax_c  = COALESCE(EXCLUDED.tmax_c,  climate_monthly.tmax_c),
              ppt_mm  = COALESCE(EXCLUDED.ppt_mm,  climate_monthly.ppt_mm),
              computed_at = NOW()""")
    conn.commit()
    conn.close()
    click.echo("done")


if __name__ == "__main__":
    main()
