"""
sub-ava-review.py — Sort the sub-AVA run's outlines into what needs reviewing
=============================================================================

Takes the merged layer from run-sub-avas.sh and marks each outline:

  ava         the unseen AVA holding its centre, if any
  db_frac     share of it inside existing vineyard_blocks
  status      known (>= 50 % in the database) | partial (20-50 %) | new (< 20 %)
  first_run   its centre is in a tile the whole-valley run already did
  cleaned     share of it inside the hand-cleaned whole-valley layer

Only new outlines outside first_run tiles still need a first look: the others
were either already judged in the whole-valley clean-up or are in the database.
Read-only against the database and the cleaned layer.

Usage
-----
  .venv/bin/python scripts/sub-ava-review.py
"""

import click
import geopandas as gpd
import psycopg2

AVAS = ["Chehalem Mountains", "Dundee Hills", "Yamhill-Carlton"]
UTM = 32610


def share_inside(g, other):
    """Share of each geometry in g lying inside the other layer's polygons."""
    pairs = gpd.overlay(g[["oid", "geometry"]], other[["geometry"]], how="intersection",
                        keep_geom_type=True)
    inside = pairs.assign(a=pairs.area).groupby("oid").a.sum()
    return (g.oid.map(inside).fillna(0) / g.area).clip(upper=1).round(3)


@click.command()
@click.option("--merged", default="data/sub-ava-2022/valley-vineyards-2022.gpkg", show_default=True,
              type=click.Path(exists=True))
@click.option("--tiles", default="data/valley/sub-ava-tiles.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--avas", default="data/ava/oregon_avas.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--cleaned", default="data/valley/valley-vineyards-2022.gpkg", show_default=True,
              type=click.Path(exists=True))
@click.option("--env", "env_file", default="../server/.env", show_default=True,
              type=click.Path(exists=True))
@click.option("--out", "out_path", default="data/valley/sub-ava-vineyards-2022.gpkg", show_default=True,
              type=click.Path())
def main(merged, tiles, avas, cleaned, env_file, out_path):
    g = gpd.read_file(merged).to_crs(UTM).drop(columns="in_ava")
    g["oid"] = range(len(g))
    url = next(l.split("=", 1)[1].strip().strip('"')
               for l in open(env_file) if l.startswith("DATABASE_URL="))
    con = psycopg2.connect(url)
    con.set_session(readonly=True)
    db = gpd.read_postgis("SELECT geometry FROM vineyard_blocks WHERE geometry IS NOT NULL",
                          con, geom_col="geometry").to_crs(UTM)
    con.close()
    db["geometry"] = db.geometry.buffer(0)

    a = gpd.read_file(avas).to_crs(UTM)
    a = a[a.name.isin(AVAS)][["name", "geometry"]]
    centre = gpd.GeoDataFrame({"oid": g.oid}, geometry=g.representative_point(), crs=UTM)
    # An outline in Chehalem and Yamhill-Carlton's overlap is counted once
    hit = gpd.sjoin(centre, a, predicate="within").drop_duplicates("oid").set_index("oid").name
    g["ava"] = g.oid.map(hit)

    t = gpd.read_file(tiles).to_crs(UTM)
    before = gpd.sjoin(centre, t[t.ran_before][["geometry"]], predicate="within").oid
    g["first_run"] = g.oid.isin(before)

    g["db_frac"] = share_inside(g, db)
    g["status"] = "new"
    g.loc[g.db_frac >= 0.2, "status"] = "partial"
    g.loc[g.db_frac >= 0.5, "status"] = "known"
    g["cleaned"] = share_inside(g, gpd.read_file(cleaned).to_crs(UTM))

    g.drop(columns="oid").to_file(out_path, driver="GPKG")
    click.echo(f"{len(g):,} outlines, {g.area_ha.sum():,.0f} ha → {out_path}\n")
    click.echo(g.groupby([g.ava.fillna("(outside the three)"), "first_run", "status"])
               .area_ha.agg(["count", "sum"]).round(0).astype(int).to_string())
    r = g[(g.status == "new") & ~g.first_run]
    click.echo(f"\nTo review (new, not in a first-run tile): {len(r):,} outlines, {r.area_ha.sum():,.0f} ha")
    click.echo(r.groupby(r.ava.fillna("(outside the three)")).area_ha.agg(["count", "sum", "median"]).round(2).to_string())
    bands = [(0.1, 0.5), (0.5, 2), (2, 10), (10, 1e9)]
    for lo, hi in bands:
        s = r[(r.area_ha >= lo) & (r.area_ha < hi)]
        click.echo(f"  {lo}-{hi} ha: {len(s)} outlines, {s.area_ha.sum():.0f} ha")


if __name__ == "__main__":
    main()
