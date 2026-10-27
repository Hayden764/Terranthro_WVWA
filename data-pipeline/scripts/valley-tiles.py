"""
valley-tiles.py — Choose the OSIP tiles to run the vineyard model on across the Willamette Valley
==================================================================================================

Lays the download-osip.py tile grid over the Willamette Valley AVA and drops
tiles that can't hold unmapped vineyard:

  * high ground  — the lowest point in the tile (inside the AVA) is above
                   --max-floor-ft.  The highest valley vineyard block reaches
                   1,336 ft, so 1,500 ft leaves a margin.
  * traced       — at least 99 % of the tile's in-AVA area lies in an AVA
                   already hand-traced (the six training AVAs plus Chehalem
                   Mountains, Dundee Hills and Yamhill-Carlton)
  * built-up     — at least --urban-frac of the tile is covered by tax lots
                   under 1 acre (county parcel data); only 1 known block
                   (0.6 ha) sits in such a tile at 30 %

Writes every tile with its measurements and a `keep` flag, so the cut-offs
can be revisited without recomputing.  Read by ml/predict-valley.py.

Usage
-----
  .venv/bin/python scripts/valley-tiles.py --out data/valley/valley-tiles.geojson
"""

import importlib.util
from pathlib import Path

import click
import geopandas as gpd
import numpy as np
import rasterio
from rasterio.mask import mask
from shapely.geometry import box
from tqdm import tqdm

HERE = Path(__file__).resolve().parent
TRACED = ["Eola-Amity Hills", "McMinnville", "Mt. Pisgah Polk County Oregon", "Van Duzer Corridor",
          "Lower Long Tom", "Tualatin Hills", "Chehalem Mountains", "Dundee Hills", "Yamhill-Carlton"]
SMALL_LOT_M2 = 4047   # 1 acre
UTM = 32610


def load_downloader():
    spec = importlib.util.spec_from_file_location("download_osip", HERE / "download-osip.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@click.command()
@click.option("--out", "out_path", required=True, type=click.Path())
@click.option("--valley", default="../apps/wvwa/public/data/willamette_valley.geojson",
              show_default=True, type=click.Path(exists=True))
@click.option("--avas", default="data/ava/oregon_avas.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--dem", default="data/topography/OR/willamette_valley/elevation.tif",
              show_default=True, type=click.Path(exists=True), help="Elevation in metres")
@click.option("--parcels", default="data/Parcel_WIllamette.gpkg", show_default=True,
              type=click.Path(exists=True))
@click.option("--max-floor-ft", default=1500.0, show_default=True)
@click.option("--urban-frac", default=0.3, show_default=True)
def main(out_path, valley, avas, dem, parcels, max_floor_ft, urban_frac):
    dl = load_downloader()
    xmin, ymin, xmax, ymax = dl.utm_bbox_from_blocks(Path(valley), 0)
    tiles = dl.filter_to_intersecting(dl.make_tile_grid(xmin, ymin, xmax, ymax), Path(valley))
    click.echo(f"Valley tiles: {len(tiles):,}")

    wv = gpd.read_file(valley).to_crs(UTM).geometry.union_all()
    a = gpd.read_file(avas).to_crs(UTM)
    traced = a[a.name.isin(TRACED)].geometry.union_all()

    # Built-up share: area of sub-acre lots, binned to tiles by lot centroid
    lots = gpd.read_file(parcels, columns=["calcarea"]).to_crs(UTM)
    small = lots[lots.geometry.area < SMALL_LOT_M2]
    x0, y0, s = xmin, ymin, dl.TILE_M   # the grid's origin and step
    c = small.geometry.centroid
    keys = zip(np.floor((c.x - x0) / s).astype(int), np.floor((c.y - y0) / s).astype(int))
    small_area = {}
    for k, ar in zip(keys, small.geometry.area):
        small_area[k] = small_area.get(k, 0.0) + ar

    rows = []
    with rasterio.open(dem) as d:
        for t in tqdm(tiles, desc="tiles", unit="tile"):
            tb = box(*t)
            part = tb.intersection(wv)
            try:
                arr, _ = mask(d, [gpd.GeoSeries([part], crs=UTM).to_crs(d.crs).iloc[0]],
                              crop=True, filled=True, nodata=-9999)
                v = arr[0][arr[0] > -9000] * 3.28084
            except ValueError:   # sliver outside the DEM
                v = np.array([])
            k = (int(round((t[0] - x0) / s)), int(round((t[1] - y0) / s)))
            rows.append({
                "tile": f"{int(t[0])}_{int(t[1])}",
                "floor_ft": round(float(v.min()), 1) if v.size else None,
                "traced_frac": round(part.intersection(traced).area / part.area, 4),
                "urban_frac": round(small_area.get(k, 0.0) / tb.area, 4),
                "geometry": tb,
            })

    g = gpd.GeoDataFrame(rows, crs=UTM)
    high = g.floor_ft.notna() & (g.floor_ft > max_floor_ft)
    done = g.traced_frac >= 0.99
    urban = g.urban_frac >= urban_frac
    g["keep"] = ~(high | done | urban)
    click.echo(f"  high ground (floor > {max_floor_ft:.0f} ft): {int(high.sum()):,}")
    click.echo(f"  already traced:                    {int(done.sum()):,}")
    click.echo(f"  built-up (>= {urban_frac:.0%} sub-acre lots):  {int(urban.sum()):,}")
    click.echo(f"Keep: {int(g.keep.sum()):,} tiles")

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    g.to_file(out_path, driver="GeoJSON")
    click.echo(f"→ {out_path}")


if __name__ == "__main__":
    main()
