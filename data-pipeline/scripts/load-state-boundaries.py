"""
Load State Boundaries
=====================
Fills states.geometry / states.outline (migration 028) for every state already
in the states table, then recomputes each AVA's per-state portion
(ava_states.geometry / acres) with refresh_ava_state_portions().

  geometry  Census TIGER/Line 2024 legal boundary — river centrelines and
            3 nmi of territorial sea; what AVAs are clipped against
  outline   Census cartographic boundary 2024, 1:500k — shoreline-clipped;
            what maps draw

Sources (public domain), downloaded to data/boundaries/:
    https://www2.census.gov/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip
    https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip

Prerequisite:
    - Migration 028 applied
    - DATABASE_URL is set in environment

Usage:
    python load-state-boundaries.py --dry-run    # show what would load
    python load-state-boundaries.py
"""

import os
import sys
from pathlib import Path

import click
import geopandas as gpd
import psycopg2

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "boundaries"
LEGAL = DATA_DIR / "tl_2024_us_state" / "tl_2024_us_state.shp"
CARTO = DATA_DIR / "cb_2024_us_state_500k" / "cb_2024_us_state_500k.shp"
SOURCE = "Census TIGER/Line 2024; cartographic 1:500k"


def by_state(path: Path) -> dict:
    gdf = gpd.read_file(path).to_crs(4326)
    return {r.STUSPS: r.geometry for r in gdf.itertuples()}


@click.command()
@click.option("--dry-run", is_flag=True, default=False, help="Show what would load; write nothing.")
def main(dry_run):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    for p in (LEGAL, CARTO):
        if not p.exists():
            click.echo(f"Missing {p} — download and unzip the Census files (see docstring).", err=True)
            sys.exit(1)

    legal, carto = by_state(LEGAL), by_state(CARTO)
    conn = psycopg2.connect(dsn)
    with conn, conn.cursor() as cur:
        cur.execute("SELECT abbreviation FROM states ORDER BY abbreviation")
        abbrs = [r[0] for r in cur.fetchall()]
        for abbr in abbrs:
            if abbr not in legal or abbr not in carto:
                click.echo(f"  {abbr}: not in the Census files — skipped")
                continue
            click.echo(f"  {abbr}: legal {len(legal[abbr].wkt) // 1000} KB WKT, "
                       f"outline {len(carto[abbr].wkt) // 1000} KB WKT")
            if dry_run:
                continue
            cur.execute(
                """UPDATE states
                      SET geometry = ST_Multi(ST_MakeValid(ST_GeomFromText(%s, 4326))),
                          outline  = ST_Multi(ST_MakeValid(ST_GeomFromText(%s, 4326))),
                          centroid = ST_PointOnSurface(ST_GeomFromText(%s, 4326)),
                          boundary_source = %s
                    WHERE abbreviation = %s""",
                (legal[abbr].wkt, carto[abbr].wkt, carto[abbr].wkt, SOURCE, abbr),
            )
        if dry_run:
            click.echo("--dry-run: nothing written")
            return
        cur.execute("SELECT refresh_ava_state_portions()")
        click.echo(f"Recomputed {cur.fetchone()[0]} AVA state portions")
        cur.execute(
            """SELECT a.slug, s.abbreviation, av.acres,
                      round((ST_Area(a.geometry::geography) / 4046.8564224)::numeric) AS full_acres
                 FROM ava_states av JOIN avas a ON a.id = av.ava_id JOIN states s ON s.id = av.state_id
                WHERE a.id IN (SELECT ava_id FROM ava_states GROUP BY ava_id HAVING count(*) > 1)
                ORDER BY a.slug, s.abbreviation"""
        )
        for slug, abbr, acres, full in cur.fetchall():
            click.echo(f"    {slug:24} {abbr}  {acres:>12,.0f} of {full:>12,.0f} ac")
    conn.close()


if __name__ == "__main__":
    main()
