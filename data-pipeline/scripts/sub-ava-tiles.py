"""
sub-ava-tiles.py — Choose the tiles the whole-valley run skipped in the unseen sub-AVAs
=======================================================================================

valley-tiles.py dropped tiles already hand-traced, so Chehalem Mountains, Dundee
Hills and Yamhill-Carlton only ran along their edges.  This marks the tiles
touching those AVAs that have not run, so ml/predict-valley.py can finish them.
Reads valley-tiles.py's output and writes the same fields; `keep` now means
"run in this pass", and `ran_before` marks the tiles the valley run already did.
--all runs those too, for an instance without the valley run's saved maps.

Usage
-----
  .venv/bin/python scripts/sub-ava-tiles.py
"""

import click
import geopandas as gpd

AVAS = ["Chehalem Mountains", "Dundee Hills", "Yamhill-Carlton"]


@click.command()
@click.option("--tiles", default="data/valley/valley-tiles.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--avas", default="data/ava/oregon_avas.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--out", "out_path", default="data/valley/sub-ava-tiles.geojson", show_default=True,
              type=click.Path())
@click.option("--all", "run_all", is_flag=True, help="Also re-run the tiles already done")
def main(tiles, avas, out_path, run_all):
    g = gpd.read_file(tiles)
    a = gpd.read_file(avas).to_crs(g.crs)
    g = g[g.intersects(a[a.name.isin(AVAS)].geometry.union_all())].copy()
    g["ran_before"] = g.keep
    g["keep"] = True if run_all else ~g.ran_before
    click.echo(f"Tiles touching the three AVAs: {len(g):,}")
    click.echo(f"  already run: {int(g.ran_before.sum()):,}")
    click.echo(f"  to run:      {int(g.keep.sum()):,}")
    g.to_file(out_path, driver="GeoJSON")
    click.echo(f"→ {out_path}")


if __name__ == "__main__":
    main()
