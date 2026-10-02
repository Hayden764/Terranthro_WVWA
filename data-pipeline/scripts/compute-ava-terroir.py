"""
Soil + Bedrock Make-up per AVA
==============================
For every AVA touching Oregon (avas table, migration 026), clips the statewide
soil and bedrock maps to the AVA boundary and sums the land area in each class,
writing ava_terroir_composition (migration 027):

  soil         SSURGO soil_class            (every class; shares sum to 100)
  soil_series  SSURGO dominant component    (top 12)
  bedrock      OGDC-8 bedrock terroir_class (every class; shares sum to 100)
  formation    OGDC-8 thematic formation    (top 12)

Sources, field choices and class rules are shared with
compute-soil-geology-stats.py (per-vineyard), so an AVA's "Volcanic" is the same
"Volcanic" the vineyard cards and map legend show. The sources cover Oregon
only, and each AVA is clipped to its Oregon portion (migration 028), so AVAs
that cross the state line are summarised over their Oregon part.

Prerequisite:
    - Migrations 026 and 027 applied; AVAs loaded (server/scripts/load-avas.mjs)
    - OGDC-8 gdb and ssurgo_or.gpkg in place (see compute-soil-geology-stats.py)
    - DATABASE_URL is set in environment

Usage:
    python compute-ava-terroir.py --dry-run          # compute + print, write nothing
    python compute-ava-terroir.py                    # all Oregon AVAs
    python compute-ava-terroir.py --avas rogue-valley,umpqua-valley
"""

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

import click
import geopandas as gpd
import pandas as pd
import psycopg2
import psycopg2.extras

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from terroir_classes import geology_class  # noqa: E402

# Reuse the per-vineyard script's paths, CRS, fields and loaders.
_spec = importlib.util.spec_from_file_location("soil_geology", HERE / "compute-soil-geology-stats.py")
sg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sg)

SQFT_PER_ACRE = 43560.0      # WORK_CRS (EPSG:2994) is in feet
TOP_DETAIL = 12              # rows kept for the soil_series / formation layers
UNCLASSIFIED = "Unclassified"
NOT_SURVEYED = "Not surveyed"    # SSURGO "NOTCOM" map units: survey not completed


def fetch_avas(conn, slugs: Optional[List[str]]) -> gpd.GeoDataFrame:
    # Oregon portion (ava_states.geometry, migration 028), else the whole AVA.
    sql = """SELECT a.id, a.slug, COALESCE(av.geometry, a.geometry) AS geom
             FROM avas a
             JOIN ava_states av ON av.ava_id = a.id
             JOIN states s ON s.id = av.state_id
             WHERE s.abbreviation = 'OR'"""
    params: list = []
    if slugs:
        sql += " AND a.slug = ANY(%s)"
        params.append(slugs)
    gdf = gpd.read_postgis(sql + " ORDER BY a.slug", conn, geom_col="geom", params=params, crs=4326)
    gdf = gdf.rename_geometry("geometry").to_crs(sg.WORK_CRS)
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf


def shares(df: pd.DataFrame, col: str, total: float, top: Optional[int]) -> List[dict]:
    """Area per class as rows ordered largest first; `top` trims detail layers."""
    s = df.groupby(col)["area"].sum().sort_values(ascending=False)
    if top:
        s = s.head(top)
    return [{"class": str(k), "acres": round(v / SQFT_PER_ACRE, 1), "pct": round(v / total * 100.0, 2),
             "rank": i + 1} for i, (k, v) in enumerate(s.items()) if v > 0]


def ava_composition(ava, soils_path: Path, gdb_path: Path) -> Dict[str, List[dict]]:
    one = gpd.GeoDataFrame({"id": [ava.id]}, geometry=[ava.geometry], crs=sg.WORK_CRS)
    out: Dict[str, List[dict]] = {}

    soils = sg.load_source("soils", soils_path, one)
    soils = gpd.clip(soils, one)
    if not soils.empty:
        soils["area"] = soils.geometry.area
        soils["soil_class"] = soils["soil_class"].map(sg._clean).fillna(UNCLASSIFIED)
        soils["series"] = soils["compname"].map(sg._clean)
        notcom = soils["series"].str.upper().eq("NOTCOM").fillna(False)
        soils.loc[notcom, "soil_class"] = NOT_SURVEYED
        soils.loc[notcom, "series"] = None
        total = soils["area"].sum()
        out["soil"] = shares(soils, "soil_class", total, None)
        out["soil_series"] = shares(soils.dropna(subset=["series"]), "series", total, TOP_DETAIL)

    geo = sg.load_source("geology", gdb_path, one)
    geo = gpd.clip(geo, one)
    if not geo.empty:
        geo["area"] = geo.geometry.area
        geo["bedrock"] = [geology_class(sg._clean(rt), sg._clean(fm), sg._clean(li)) or UNCLASSIFIED
                          for rt, fm, li in zip(geo["ThematicRockType"], geo["ThematicFormation"],
                                                geo["ThematicLithology"])]
        geo["formation"] = geo["ThematicFormation"].map(sg._clean)
        total = geo["area"].sum()
        out["bedrock"] = shares(geo, "bedrock", total, None)
        out["formation"] = shares(geo.dropna(subset=["formation"]), "formation", total, TOP_DETAIL)
    return out


SOURCES = {"soil": "USDA SSURGO", "soil_series": "USDA SSURGO",
           "bedrock": "DOGAMI OGDC-8", "formation": "DOGAMI OGDC-8"}


def write(conn, ava_id: int, comp: Dict[str, List[dict]]) -> None:
    rows = [(ava_id, layer, r["class"][:160], r["acres"], r["pct"], r["rank"], SOURCES[layer])
            for layer, items in comp.items() for r in items]
    with conn.cursor() as cur:
        cur.execute("DELETE FROM ava_terroir_composition WHERE ava_id = %s", (ava_id,))
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO ava_terroir_composition (ava_id, layer, class, acres, pct, rank, data_source)
               VALUES %s""",
            rows,
        )


@click.command()
@click.option("--avas", "slugs", default=None, help="Comma-separated AVA slugs (default: every Oregon AVA).")
@click.option("--ssurgo", type=click.Path(path_type=Path), default=sg.DEFAULT_SSURGO, show_default=True)
@click.option("--gdb", type=click.Path(path_type=Path), default=sg.DEFAULT_GDB, show_default=True)
@click.option("--dry-run", is_flag=True, default=False, help="Compute and print; write nothing.")
def main(slugs, ssurgo, gdb, dry_run):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    conn = psycopg2.connect(dsn)
    avas = fetch_avas(conn, [s.strip() for s in slugs.split(",")] if slugs else None)
    click.echo(f"{len(avas)} AVAs")

    results = {}
    for ava in avas.itertuples():
        comp = ava_composition(ava, ssurgo, gdb)
        results[ava.slug] = comp
        top = lambda layer: ", ".join(f"{r['class']} {r['pct']:.0f}%" for r in comp.get(layer, [])[:3])
        click.echo(f"  {ava.slug:40} soil: {top('soil')}\n  {'':40} bedrock: {top('bedrock')}")
        if not dry_run:
            write(conn, int(ava.id), comp)
            conn.commit()

    out = sg.DATA_DIR / "soils" / "ava_terroir_composition.json"
    out.write_text(json.dumps(results, indent=1))
    click.echo(f"{'--dry-run: nothing written to the database; ' if dry_run else 'written; '}"
               f"full results in {out.relative_to(sg.DATA_DIR.parent)}")
    conn.close()


if __name__ == "__main__":
    main()
