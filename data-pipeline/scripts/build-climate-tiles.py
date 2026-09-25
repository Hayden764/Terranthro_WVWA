"""
Climate Map Tiles (heat + rain)
===============================
Builds one PMTiles file per map layer from the Oregon-cropped PRISM 800m monthly
grids written by download-prism-monthly.py (source-layer = layer id):

  Heat (tmean)
    gdd_normal   climate-normal.pmtiles        1991–2020 mean growing degree days
    gdd_warming  climate-warming.pmtiles       2016–2025 mean minus the 1991–2020 normal
    gdd_vintage  climate-vintage.pmtiles       each vintage minus the normal (prop `yr`)
  Rain (ppt)
    ppt_annual   climate-rain-annual.pmtiles   1991–2020 mean annual precipitation, inches
    ppt_harvest  climate-rain-harvest.pmtiles  1991–2020 mean Sep–Oct precipitation, inches
    ppt_vintage  climate-rain-vintage.pmtiles  each vintage's Sep–Oct rain as % of normal (prop `yr`)

Vintage layers hold every year in one file; the frontend filters by `yr`, so the
year slider is instant. GDD matches the API (server/src/routes/climate.js):
Apr–Oct, base 50°F, from monthly means × days in month; harvest = Sep–Oct, as in
the API's season summaries. GDD anomaly bins match the vintage stripes in
src/components/climate/ClimateVintages.jsx, and every band edge matches
src/config/climateMapConfig.js — keep them in sync.

Each grid is upsampled (bilinear) before banding so band edges are smooth rather
than 800m stair-steps, sieved (small speckle regions merge into their neighbour,
so no gaps), polygonised and simplified per band. Two detail tiers, like the
soils tiles: coarse geometry for zooms 4–7, finer for 8–10 (the map overzooms
beyond that — 800m data has nothing more to show). Keep low-zoom tiles small:
unsieved/unsimplified bands made 7–11 MB tiles that killed the WebGL context.

Output goes to data-pipeline/data/tiles/climate-*.pmtiles and, with --public, is
also copied to public/tiles/ for local dev (both gitignored). Upload for
production alongside soils/geology (R2 bucket terranthro-cogs, prefix earth/).

Usage:
    python build-climate-tiles.py --public
    python build-climate-tiles.py --public --layers ppt_annual,ppt_harvest,ppt_vintage
"""

import calendar
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import click
import numpy as np
import rasterio
import shapely
from rasterio.enums import Resampling
from rasterio.features import shapes, sieve
from shapely.geometry import MultiPolygon, mapping, shape

ROOT = Path(__file__).resolve().parent / ".."
PRISM_DIR = ROOT / "data" / "climate" / "prism" / "monthly"
OUT_DIR = ROOT / "data" / "tiles"
REPO_PUBLIC_TILES = ROOT / ".." / "public" / "tiles"

GDD_MONTHS = range(4, 11)
NORMAL = (1991, 2020)
RECENT = (2016, 2025)
UPSAMPLE = 4          # 800m → ~200m before banding
# (name, minzoom, maxzoom, sieve size in upsampled cells, simplify tolerance in degrees)
TIERS = [
    ("low", 4, 7, 400, 0.008),   # merge regions under ~16 km²; ~650m tolerance
    ("high", 8, 10, 25, 0.0025),  # merge regions under ~1 km²; ~200m tolerance
]

# Heat accumulation bands (°F·days). Winkler boundaries (Jones 2010) at 1500,
# 2000, 2500, 3000, 3500 are all band edges.
NORMAL_EDGES = [1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500]
# Anomaly bins — identical to STRIPE_EDGES in ClimateVintages.jsx
ANOM_EDGES = [-350, -250, -150, -50, 50, 150, 250, 350]
# Rain bands (inches). Valley floor ≈ 40–45 in/yr and 4–5 in over Sep–Oct.
ANNUAL_PPT_EDGES = [15, 25, 35, 45, 55, 70, 90, 120]
HARVEST_PPT_EDGES = [1.5, 2.5, 3.5, 4.5, 5.5, 7, 9, 12]
# Harvest rain as % of normal; log-symmetric (½× ↔ 2×, ⅔× ↔ 1.5×, 0.8× ↔ 1.25×)
PPT_PCT_EDGES = [50, 67, 80, 125, 150, 200]
HARVEST_MONTHS = (9, 10)


def winkler(lo):
    if lo is None or lo < 1500:
        return "Too cool"
    for edge, name in [(2000, "Region Ia"), (2500, "Region Ib"), (3000, "Region II"),
                       (3500, "Region III"), (4000, "Region IV")]:
        if lo < edge:
            return name
    return "Region V"


def read_month(var, year, month):
    with rasterio.open(PRISM_DIR / var / f"prism_{var}_or_800m_{year}{month:02d}.tif") as src:
        return src.read(1, masked=True).astype("float64"), src.profile


def ppt_inches(year, months):
    total, profile = None, None
    for m in months:
        a, profile = read_month("ppt", year, m)
        total = a / 25.4 if total is None else total + a / 25.4
    return total, profile


def gdd_year(year):
    total, profile = None, None
    for m in GDD_MONTHS:
        with rasterio.open(PRISM_DIR / "tmean" / f"prism_tmean_or_800m_{year}{m:02d}.tif") as src:
            if profile is None:
                profile = src.profile
            a = src.read(1, masked=True).astype("float64")
        g = np.maximum(0, a * 9 / 5 + 32 - 50) * calendar.monthrange(year, m)[1]
        total = g if total is None else total + g
    return total, profile


def upsample(grid, profile):
    """Bilinear upsample a masked grid; returns (values, valid mask, transform)."""
    h, w = grid.shape
    filled = grid.filled(np.nan).astype("float32")
    with rasterio.io.MemoryFile() as mf:
        with mf.open(driver="GTiff", height=h, width=w, count=1, dtype="float32",
                     crs=profile["crs"], transform=profile["transform"], nodata=np.nan) as ds:
            ds.write(filled, 1)
            out = ds.read(1, out_shape=(h * UPSAMPLE, w * UPSAMPLE), resampling=Resampling.bilinear)
            transform = ds.transform * ds.transform.scale(1 / UPSAMPLE, 1 / UPSAMPLE)
    return out, np.isfinite(out), transform


def band_features(values, valid, transform, edges, props_for, sieve_px, tol):
    """Classify into bins by `edges`, sieve speckles, polygonise, collect per bin."""
    cls = np.digitize(np.where(valid, values, 0), edges).astype("int16")
    cls[~valid] = -1
    cls = sieve(cls, size=sieve_px, mask=valid)
    regions = [(shape(g), int(v)) for g, v in shapes(cls, mask=valid, transform=transform)]
    # The regions tile the grid, so simplify them as one coverage: shared edges are
    # simplified once and neighbouring bands stay gapless.
    simplified = shapely.coverage_simplify([g for g, _ in regions], tol)
    by_bin = {}
    for poly, (_, v) in zip(simplified, regions):
        if not poly.is_empty and poly.area > 0:
            by_bin.setdefault(v, []).append(poly)
    feats = []
    for b, polys in sorted(by_bin.items()):
        if b < 0:
            continue
        # shapes() regions of one value never overlap, so a plain collect is a valid dissolve
        geom = MultiPolygon([g for p in polys for g in getattr(p, "geoms", [p])])
        lo = edges[b - 1] if b > 0 else None
        hi = edges[b] if b < len(edges) else None
        feats.append({"type": "Feature", "geometry": mapping(geom),
                      "properties": {"bin": b, "lo": lo, "hi": hi, **props_for(lo, hi)}})
    return feats


def write_seq(feats, path):
    with open(path, "w") as f:
        for ft in feats:
            f.write(json.dumps(ft) + "\n")


OUT_NAMES = {
    "gdd_normal": "climate-normal", "gdd_warming": "climate-warming", "gdd_vintage": "climate-vintage",
    "ppt_annual": "climate-rain-annual", "ppt_harvest": "climate-rain-harvest", "ppt_vintage": "climate-rain-vintage",
}
YEARS = range(NORMAL[0], RECENT[1] + 1)
mean_of = lambda grids, a, b: np.ma.mean(np.ma.stack([grids[y] for y in range(a, b + 1)]), axis=0)  # noqa: E731


def layer_grids(names):
    """{layer: [(grid, edges, props_fn)]} for the requested layers; vintage layers get one entry per year."""
    out, profile = {}, None
    if any(n.startswith("gdd_") for n in names):
        gdd = {}
        for y in YEARS:
            gdd[y], profile = gdd_year(y)
        normal = mean_of(gdd, *NORMAL)
        out["gdd_normal"] = [(normal, NORMAL_EDGES, lambda lo, hi: {"region": winkler(lo)})]
        out["gdd_warming"] = [(mean_of(gdd, *RECENT) - normal, ANOM_EDGES, lambda lo, hi: {})]
        out["gdd_vintage"] = [(gdd[y] - normal, ANOM_EDGES, lambda lo, hi, y=y: {"yr": y}) for y in YEARS]
    if any(n.startswith("ppt_") for n in names):
        annual, harvest = {}, {}
        for y in YEARS:
            annual[y], profile = ppt_inches(y, range(1, 13))
            harvest[y], _ = ppt_inches(y, HARVEST_MONTHS)
        harvest_normal = mean_of(harvest, *NORMAL)
        # Guard the % against near-zero normals (none in Oregon, but keep it finite)
        safe_normal = np.ma.masked_less(harvest_normal, 0.05)
        out["ppt_annual"] = [(mean_of(annual, *NORMAL), ANNUAL_PPT_EDGES, lambda lo, hi: {})]
        out["ppt_harvest"] = [(harvest_normal, HARVEST_PPT_EDGES, lambda lo, hi: {})]
        out["ppt_vintage"] = [(100 * harvest[y] / safe_normal, PPT_PCT_EDGES, lambda lo, hi, y=y: {"yr": y})
                              for y in YEARS]
    return {n: out[n] for n in names}, profile


@click.command()
@click.option("--public", "copy_public", is_flag=True, default=False,
              help="Also copy the .pmtiles files to public/tiles/ for local dev")
@click.option("--layers", default=",".join(OUT_NAMES), show_default=True,
              help="Comma-separated layer ids to build")
def main(copy_public, layers):
    names = [n.strip() for n in layers.split(",") if n.strip()]
    unknown = set(names) - set(OUT_NAMES)
    if unknown:
        raise click.BadParameter(f"unknown layers: {', '.join(sorted(unknown))}")
    grids, profile = layer_grids(names)
    click.echo(f"grids ready for {', '.join(names)}")
    up = {n: [(upsample(g, profile), e, f) for g, e, f in items] for n, items in grids.items()}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for name in names:
            parts = []
            for tier, zmin, zmax, sieve_px, tol in TIERS:
                feats = [f for (vals, valid, tf), edges, props in up[name]
                         for f in band_features(vals, valid, tf, edges, props, sieve_px, tol)]
                src = tmp / f"{name}-{tier}.geojsonl"
                write_seq(feats, src)
                part = tmp / f"{name}-{tier}.pmtiles"
                subprocess.run(["tippecanoe", "-o", str(part), "--force", "-Z", str(zmin), "-z", str(zmax),
                                "--no-feature-limit", "--no-tile-size-limit", "--detect-shared-borders",
                                "-l", name, str(src)], check=True, capture_output=True)
                parts.append(str(part))
                click.echo(f"{name} {tier} (z{zmin}–{zmax}): {len(feats)} band features")
            out = OUT_DIR / f"{OUT_NAMES[name]}.pmtiles"
            subprocess.run(["tile-join", "-o", str(out), "--force", "--no-tile-size-limit", *parts],
                           check=True, capture_output=True)
            click.echo(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB)")
            if copy_public:
                REPO_PUBLIC_TILES.mkdir(parents=True, exist_ok=True)
                shutil.copy2(out, REPO_PUBLIC_TILES / out.name)


if __name__ == "__main__":
    main()
