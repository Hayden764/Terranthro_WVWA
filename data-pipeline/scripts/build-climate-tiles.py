"""
Climate (Heat Accumulation) Map Tiles
=====================================
Builds climate-{normal,warming,vintage}.pmtiles for the map's Climate layers from the Oregon-cropped PRISM
800m monthly tmean grids written by download-prism-monthly.py:

    source-layer `gdd_normal`   1991–2020 mean growing degree days, banded
    source-layer `gdd_warming`  2016–2025 mean minus the 1991–2020 normal
    source-layer `gdd_vintage`  each vintage minus the 1991–2020 normal (prop `yr`;
                                the frontend filters by year, so the slider is instant)

GDD matches the API (server/src/routes/climate.js): Apr–Oct, base 50°F, from
monthly means × days in month. Anomaly bins match the vintage stripes in
src/components/climate/ClimateVintages.jsx, and band edges match
src/config/climateMapConfig.js — keep all three in sync.

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
TMEAN_DIR = ROOT / "data" / "climate" / "prism" / "monthly" / "tmean"
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


def winkler(lo):
    if lo is None or lo < 1500:
        return "Too cool"
    for edge, name in [(2000, "Region Ia"), (2500, "Region Ib"), (3000, "Region II"),
                       (3500, "Region III"), (4000, "Region IV")]:
        if lo < edge:
            return name
    return "Region V"


def gdd_year(year):
    total, profile = None, None
    for m in GDD_MONTHS:
        with rasterio.open(TMEAN_DIR / f"prism_tmean_or_800m_{year}{m:02d}.tif") as src:
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


@click.command()
@click.option("--public", "copy_public", is_flag=True, default=False,
              help="Also copy climate-*.pmtiles to public/tiles/ for local dev")
def main(copy_public):
    years = range(NORMAL[0], RECENT[1] + 1)
    grids, profile = {}, None
    for y in years:
        grids[y], profile = gdd_year(y)
    click.echo(f"GDD grids for {len(grids)} vintages")

    normal = np.ma.mean(np.ma.stack([grids[y] for y in range(NORMAL[0], NORMAL[1] + 1)]), axis=0)
    recent = np.ma.mean(np.ma.stack([grids[y] for y in range(RECENT[0], RECENT[1] + 1)]), axis=0)

    anomalies = {"gdd_warming": recent - normal, **{y: grids[y] - normal for y in years}}
    up = {"gdd_normal": upsample(normal, profile)}
    up.update({k: upsample(v, profile) for k, v in anomalies.items()})
    click.echo("upsampled")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        parts = []
        for tier, zmin, zmax, sieve_px, tol in TIERS:
            layers = {
                "gdd_normal": band_features(*up["gdd_normal"], NORMAL_EDGES,
                                            lambda lo, hi: {"region": winkler(lo)}, sieve_px, tol),
                "gdd_warming": band_features(*up["gdd_warming"], ANOM_EDGES, lambda lo, hi: {}, sieve_px, tol),
                "gdd_vintage": [f for y in years for f in band_features(
                    *up[y], ANOM_EDGES, lambda lo, hi, y=y: {"yr": y}, sieve_px, tol)],
            }
            part = tmp / f"{tier}.pmtiles"
            cmd = ["tippecanoe", "-o", str(part), "--force", "-Z", str(zmin), "-z", str(zmax),
                   "--no-feature-limit", "--no-tile-size-limit", "--detect-shared-borders"]
            for name, feats in layers.items():
                p = tmp / f"{tier}-{name}.geojsonl"
                write_seq(feats, p)
                cmd += ["-L", json.dumps({"file": str(p), "layer": name})]
            subprocess.run(cmd, check=True, capture_output=True)
            click.echo(f"{tier} (z{zmin}–{zmax}): " + ", ".join(f"{k} {len(v)}" for k, v in layers.items()))
            parts.append(str(part))
        # One file per layer, so the light normal/warming layers never download the
        # 35 vintages packed into the vintage tiles
        for name in ("gdd_normal", "gdd_warming", "gdd_vintage"):
            out = OUT_DIR / f"climate-{name.removeprefix('gdd_')}.pmtiles"
            subprocess.run(["tile-join", "-o", str(out), "--force", "--no-tile-size-limit", "-l", name, *parts],
                           check=True, capture_output=True)
            click.echo(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB)")
            if copy_public:
                REPO_PUBLIC_TILES.mkdir(parents=True, exist_ok=True)
                shutil.copy2(out, REPO_PUBLIC_TILES / out.name)


if __name__ == "__main__":
    main()
