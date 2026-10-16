"""
export-db-labels.py — Snapshot hand-traced blocks from the database as training labels
=======================================================================================

The production database (vineyard_blocks) holds the latest QGIS edits, so it
is the source of truth for the model v2 labels.  For each of the six training
AVAs this writes:

  <out>/<ava-slug>.gpkg          hand-traced blocks intersecting the AVA
                                 (every source except 'tax-lot')
  <out>/regions.geojson          the graded area per AVA: the official AVA
                                 outline minus any 'tax-lot' blocks inside it

'tax-lot' blocks are whole county lots, not canopy tracing, so they are kept
out of the labels and cut out of the graded area — the cutter and scorer
treat them like outside-the-AVA: ignored.  Use regions.geojson wherever the
pipeline takes --avas.

Read-only against the database (DATABASE_URL in server/.env).

Usage
-----
  .venv/bin/python scripts/export-db-labels.py --out data/BlocksDB-2026-10-16
"""

import json
from pathlib import Path

import click
import geopandas as gpd
import psycopg2
from shapely.ops import unary_union

AVAS = {
    "Eola-Amity Hills": "eola-amity-hills",
    "McMinnville": "mcminnville",
    "Mt. Pisgah Polk County Oregon": "mt-pisgah",
    "Van Duzer Corridor": "van-duzer-corridor",
    "Lower Long Tom": "lower-long-tom",
    "Tualatin Hills": "tualatin-hills",
}
LOOSE_SOURCES = {"tax-lot"}


@click.command()
@click.option("--out", "out_dir", required=True, type=click.Path())
@click.option("--avas", "avas_file", default="data/training/gold6-avas.geojson",
              show_default=True, type=click.Path(exists=True))
@click.option("--env", "env_file", default="../server/.env", show_default=True,
              type=click.Path(exists=True))
def main(out_dir, avas_file, env_file):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    url = next(l.split("=", 1)[1].strip().strip('"')
               for l in open(env_file) if l.startswith("DATABASE_URL="))
    con = psycopg2.connect(url)
    con.set_session(readonly=True)
    blocks = gpd.read_postgis(
        "SELECT id, vineyard_id, vineyard_name, block_name, source_dataset, geometry "
        "FROM vineyard_blocks WHERE geometry IS NOT NULL", con, geom_col="geometry")
    con.close()

    avas = gpd.read_file(avas_file).to_crs(blocks.crs).set_index("name")
    regions = []
    summary = {}
    for name, slug in AVAS.items():
        ava = avas.loc[name].geometry
        here = blocks[blocks.intersects(ava)]
        traced = here[~here.source_dataset.isin(LOOSE_SOURCES)]
        loose = here[here.source_dataset.isin(LOOSE_SOURCES)]
        traced.to_file(out_dir / f"{slug}.gpkg", driver="GPKG")
        region = ava.difference(unary_union(loose.geometry)) if len(loose) else ava
        regions.append({"name": name, "geometry": region})
        summary[name] = {"traced_blocks": len(traced), "ignored_tax_lot_blocks": len(loose),
                         "ignored_ids": loose.id.tolist()}
        click.echo(f"{name:32s} traced {len(traced):4d}   tax-lot ignored {len(loose)}")

    gpd.GeoDataFrame(regions, crs=blocks.crs).to_file(out_dir / "regions.geojson", driver="GeoJSON")
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    click.echo(f"\n→ {out_dir}")


if __name__ == "__main__":
    main()
