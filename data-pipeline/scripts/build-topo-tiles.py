"""
Pre-rendered Topography Map Tiles
=================================
Renders the Willamette Valley 3m DOGAMI topography COGs (elevation ft / slope° /
aspect°) into coloured WebP raster tiles packed as PMTiles, so the map reads
them straight from R2 instead of rendering each tile through TiTiler.

    elevation.pmtiles  terrain ramp, 0–2650 ft
    slope.pmtiles      RdYlGn_r ramp, 0–41°
    aspect.pmtiles     hsv ramp, 0–360° (N = red, cyclic)

Ranges and ramps must match TOPO_LAYER_TYPES in src/config/topographyConfig.js
(legend + the data-range card read them from there).

aspect.tif stores 0 (not nodata) outside the valley, which would paint the
surrounding land red (0° = N), so aspect is first masked to elevation's
footprint with a `gdal raster calc` VRT (needs the GDAL >= 3.11 CLI).

Pipeline per layer: gdaldem color-relief (RGBA VRT, nodata → transparent) →
gdal_translate to Web Mercator MBTiles (WebP, native zoom 15 ≈ 3.4 m/px) →
gdaladdo overviews down to zoom 8 → PMTiles.

Output: data-pipeline/data/tiles/topo/<layer>.pmtiles
Upload: aws s3 cp <file> s3://terranthro-cogs/topography-tiles/OR/willamette_valley/ --profile r2-terranthro

Usage:
    python build-topo-tiles.py
    python build-topo-tiles.py --layers slope --quality 80
"""

import subprocess
import tempfile
from pathlib import Path

import click
import matplotlib

ROOT = Path(__file__).resolve().parent / ".."
SRC_DIR = ROOT / "data" / "topography" / "OR" / "willamette_valley_dogami"
OUT_DIR = ROOT / "data" / "tiles" / "topo"

# layer → (source COG, matplotlib colormap, min, max)
LAYERS = {
    "elevation": ("elevation.tif", "terrain",  0.0, 2650.0),
    "slope":     ("slope.tif",     "RdYlGn_r", 0.0, 41.0),
    "aspect":    ("aspect.tif",    "hsv",      0.0, 360.0),
}
MIN_ZOOM = 8
STEPS = 256


def write_color_file(path: Path, cmap_name: str, vmin: float, vmax: float) -> None:
    """gdaldem color-relief ramp: STEPS linear stops across [vmin, vmax] (values
    outside clamp to the end colours) and nodata → fully transparent."""
    cmap = matplotlib.colormaps[cmap_name]
    lines = []
    for i in range(STEPS):
        f = i / (STEPS - 1)
        r, g, b, _ = cmap(f)
        lines.append(f"{vmin + f * (vmax - vmin):.4f} {round(r * 255)} {round(g * 255)} {round(b * 255)} 255")
    lines.append("nv 0 0 0 0")
    path.write_text("\n".join(lines) + "\n")


def run(cmd) -> None:
    click.echo("$ " + " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True)


@click.command()
@click.option("--layers", default="elevation,slope,aspect", show_default=True)
@click.option("--quality", default=85, show_default=True, help="WebP quality")
def main(layers, quality):
    from pmtiles.convert import mbtiles_to_pmtiles

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for layer in [l.strip() for l in layers.split(",") if l.strip()]:
        src, cmap, vmin, vmax = LAYERS[layer]
        click.echo(f"\n== {layer} ({cmap}, {vmin}–{vmax})")
        with tempfile.TemporaryDirectory(dir=OUT_DIR) as tmp:
            tmp = Path(tmp)
            ramp = tmp / "ramp.txt"
            write_color_file(ramp, cmap, vmin, vmax)
            source = SRC_DIR / src
            if layer == "aspect":
                source = tmp / "aspect_masked.vrt"
                run(["gdal", "raster", "calc", "-i", f"A={SRC_DIR / src}",
                     "-i", f"E={SRC_DIR / 'elevation.tif'}",
                     "--calc", "E == -9999 ? -9999 : A", "--nodata", "-9999",
                     "--of", "VRT", source])
            vrt = tmp / f"{layer}_rgba.vrt"
            run(["gdaldem", "color-relief", source, ramp, vrt, "-alpha", "-of", "VRT"])

            mbt = tmp / f"{layer}.mbtiles"
            run(["gdal_translate", vrt, mbt, "-of", "MBTILES",
                 "-co", "TILE_FORMAT=WEBP", "-co", f"QUALITY={quality}",
                 "-co", "RESAMPLING=BILINEAR", "-co", "ZOOM_LEVEL_STRATEGY=AUTO",
                 "-co", f"NAME=Willamette Valley {layer}",
                 "--config", "GDAL_CACHEMAX", "2048", "--config", "GDAL_NUM_THREADS", "ALL_CPUS"])
            # Native zoom is 15 for 3 m data; factors 2..128 build zooms 14..8
            run(["gdaladdo", "-r", "average", mbt, "2", "4", "8", "16", "32", "64", "128",
                 "--config", "GDAL_NUM_THREADS", "ALL_CPUS"])

            out = OUT_DIR / f"{layer}.pmtiles"
            mbtiles_to_pmtiles(str(mbt), str(out), 15)
            click.echo(f"  → {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
