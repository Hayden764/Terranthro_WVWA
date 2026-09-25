"""
Topography Value Tiles (for browser-side colouring + range filtering)
=====================================================================
Encodes the Willamette Valley 3m DOGAMI topography (elevation ft / slope° /
aspect°) as Terrarium raster-dem tiles packed as PMTiles. Each pixel stores the
*value*, not a colour; the map colours it with a MapLibre `color-relief` layer
(src/components/TopographyLayer.jsx), so legend classes and custom ranges can be
shown/faded instantly without rebuilding tiles.

    topo-elevation.pmtiles   feet, rounded to 1 ft
    topo-slope.pmtiles       degrees, rounded to 0.25°
    topo-aspect.pmtiles      degrees clockwise from north, rounded to 1°;
                             FLAT (-50) where slope < 3° (aspect is noise there)

Outside the data every pixel is NODATA (-500); the frontend colours anything
below -100 transparent. Sentinels must match src/config/topographyConfig.js.

Terrarium: value = R*256 + G + B/256 - 32768. Values are rounded so B is nearly
constant and PNG compresses well. Tiles are lossless PNG — lossy compression
would corrupt the values — and every resampling step is value-safe: elevation
and slope average down to the tile grid *before* encoding; aspect (circular)
uses nearest; overview zooms use nearest on the encoded tiles.

Native zoom 14 (~6.8 m ground pixels at 45°N); the map overzooms beyond that.

Pipeline per layer: gdalwarp → Web Mercator float grid on the z14 tile grid →
encode to RGB (rasterio, windowed) → gdal_translate MBTiles (PNG) → gdaladdo
nearest overviews down to z8 → PMTiles.

Output: data-pipeline/data/tiles/topo/topo-<layer>.pmtiles
Upload: aws s3 cp <file> s3://terranthro-cogs/topography-tiles/OR/willamette_valley/ --profile r2-terranthro

Usage:
    python build-topo-value-tiles.py
    python build-topo-value-tiles.py --layers slope --bbox -123.12,45.23,-123.02,45.31   # pilot area
"""

import subprocess
import tempfile
from pathlib import Path

import click
import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent / ".."
SRC_DIR = ROOT / "data" / "topography" / "OR" / "willamette_valley_dogami"
OUT_DIR = ROOT / "data" / "tiles" / "topo"

NATIVE_ZOOM = 14
MIN_ZOOM = 8
Z_RES = 156543.03392804097 / 2 ** NATIVE_ZOOM   # Web Mercator metres per pixel at z14
NODATA = -500.0
FLAT = -50.0
FLAT_SLOPE_DEG = 3.0
SRC_NODATA = -9999

# layer → (source COG, warp resampling, rounding step)
LAYERS = {
    "elevation": ("elevation.tif", "average", 1.0),
    "slope":     ("slope.tif",     "average", 0.25),
    "aspect":    ("aspect.tif",    "near",    1.0),
}


def run(cmd):
    click.echo("$ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True)


def warp(src: Path, dst: Path, resampling: str, bbox):
    cmd = ["gdalwarp", "-overwrite", "-t_srs", "EPSG:3857", "-tr", Z_RES, Z_RES, "-tap",
           "-r", resampling, "-srcnodata", SRC_NODATA, "-dstnodata", SRC_NODATA, "-ot", "Float32",
           "-co", "TILED=YES", "-co", "COMPRESS=DEFLATE", "-co", "BIGTIFF=YES",
           "-multi", "-wo", "NUM_THREADS=ALL_CPUS", "--config", "GDAL_CACHEMAX", "2048"]
    if bbox:
        cmd += ["-te", *bbox, "-te_srs", "EPSG:4326"]
    run(cmd + [src, dst])


def encode(layer: str, grids: dict, dst: Path, step: float):
    """Write the Terrarium-encoded RGB GeoTIFF, block by block."""
    with rasterio.open(grids[layer]) as src:
        profile = src.profile
        profile.update(count=3, dtype="uint8", nodata=None, compress="deflate", tiled=True,
                       blockxsize=512, blockysize=512, BIGTIFF="YES")
        slope_src = rasterio.open(grids["slope"]) if layer == "aspect" else None
        elev_src = rasterio.open(grids["elevation"]) if layer == "aspect" else None
        with rasterio.open(dst, "w", **profile) as out:
            for row in range(0, src.height, 2048):
                for col in range(0, src.width, 2048):
                    win = Window(col, row, min(2048, src.width - col), min(2048, src.height - row))
                    v = src.read(1, window=win).astype("float64")
                    missing = v <= SRC_NODATA + 1
                    if layer == "aspect":
                        # aspect.tif stores 0 (not nodata) outside the valley; use elevation's footprint
                        missing |= elev_src.read(1, window=win) <= SRC_NODATA + 1
                        s = slope_src.read(1, window=win)
                        flat = (~missing) & ((s < FLAT_SLOPE_DEG) | (v < 0) | (v > 360))
                        v = np.round(v / step) * step % 360
                        v[flat] = FLAT
                    else:
                        if layer == "slope":
                            v = np.maximum(v, 0)  # the source has a few small negative slopes
                        v = np.round(v / step) * step
                    v[missing] = NODATA
                    t = v + 32768.0
                    r = np.floor(t / 256)
                    g = np.floor(t - r * 256)
                    b = np.round((t - r * 256 - g) * 256)
                    out.write(np.stack([r, g, np.minimum(b, 255)]).astype("uint8"), window=win)
        for f in (slope_src, elev_src):
            if f:
                f.close()


@click.command()
@click.option("--layers", default="elevation,slope,aspect", show_default=True)
@click.option("--bbox", default=None, help="lon_min,lat_min,lon_max,lat_max — build a pilot area only")
@click.option("--suffix", default="", help="Appended to output names, e.g. -pilot")
def main(layers, bbox, suffix):
    from pmtiles.convert import mbtiles_to_pmtiles

    names = [n.strip() for n in layers.split(",") if n.strip()]
    bbox = [float(x) for x in bbox.split(",")] if bbox else None
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT_DIR) as tmp:
        tmp = Path(tmp)
        # Aspect needs the slope + elevation grids on the same tile grid
        needed = sorted(set(names) | ({"slope", "elevation"} if "aspect" in names else set()),
                        key=list(LAYERS).index)
        grids = {}
        for name in needed:
            src, resampling, _ = LAYERS[name]
            grids[name] = tmp / f"{name}_3857.tif"
            warp(SRC_DIR / src, grids[name], resampling, bbox)

        for name in names:
            click.echo(f"\n== {name}")
            rgb = tmp / f"{name}_rgb.tif"
            encode(name, grids, rgb, LAYERS[name][2])
            mbt = tmp / f"{name}.mbtiles"
            run(["gdal_translate", rgb, mbt, "-of", "MBTILES", "-co", "TILE_FORMAT=PNG",
                 "-co", "RESAMPLING=NEAREST", "-co", "ZOOM_LEVEL_STRATEGY=LOWER",
                 "-co", f"NAME=Willamette Valley {name} values",
                 "--config", "GDAL_CACHEMAX", "2048", "--config", "GDAL_NUM_THREADS", "ALL_CPUS"])
            factors = [str(2 ** i) for i in range(1, NATIVE_ZOOM - MIN_ZOOM + 1)]
            run(["gdaladdo", "-r", "nearest", mbt, *factors, "--config", "GDAL_NUM_THREADS", "ALL_CPUS"])
            out = OUT_DIR / f"topo-{name}{suffix}.pmtiles"
            mbtiles_to_pmtiles(str(mbt), str(out), NATIVE_ZOOM)
            click.echo(f"  → {out.name} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
