"""
Load County Boundaries
======================
Fills counties.fips / counties.geometry (migration 032) for every county in
Oregon, Washington and Idaho — the states the 23 Oregon AVAs touch — adding
any county the table does not have yet (it held 20 of Oregon's 36).

OWB release snapshots attribute each block to the county containing its
point-on-surface, so these are the legal (full-resolution) boundaries, not
the generalised cartographic ones.

Source (public domain), downloaded to data/boundaries/:
    https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip
    (unzip to data/boundaries/tl_2024_us_county/)

Prerequisite:
    - Migration 032 applied
    - DATABASE_URL is set in environment

Usage:
    python load-county-boundaries.py --dry-run    # show what would load
    python load-county-boundaries.py
"""

import os
import sys
from pathlib import Path

import click
import geopandas as gpd
import psycopg2

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "boundaries"
COUNTIES = DATA_DIR / "tl_2024_us_county" / "tl_2024_us_county.shp"
STATE_FIPS = {"41": "OR", "53": "WA", "16": "ID"}


@click.command()
@click.option("--dry-run", is_flag=True, default=False, help="Show what would load; write nothing.")
def main(dry_run):
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    if not COUNTIES.exists():
        click.echo(f"Missing {COUNTIES} — download and unzip the Census file (see docstring).", err=True)
        sys.exit(1)

    gdf = gpd.read_file(COUNTIES)
    gdf = gdf[gdf.STATEFP.isin(STATE_FIPS)].to_crs(4326)
    click.echo(f"{len(gdf)} counties in OR/WA/ID")

    conn = psycopg2.connect(dsn)
    added = updated = 0
    with conn, conn.cursor() as cur:
        cur.execute("SELECT abbreviation, id FROM states")
        state_ids = dict(cur.fetchall())
        for r in gdf.sort_values(["STATEFP", "NAME"]).itertuples():
            abbr = STATE_FIPS[r.STATEFP]
            if abbr not in state_ids:
                click.echo(f"  {abbr} not in states — skipped {r.NAME}")
                continue
            cur.execute(
                "SELECT id FROM counties WHERE state_id = %s AND (fips = %s OR lower(name) = lower(%s))",
                (state_ids[abbr], r.GEOID, r.NAME),
            )
            row = cur.fetchone()
            if dry_run:
                click.echo(f"  {abbr} {r.NAME:20} {r.GEOID}  {'update' if row else 'ADD'}")
                continue
            if row:
                cur.execute(
                    """UPDATE counties
                          SET fips = %s, geometry = ST_Multi(ST_MakeValid(ST_GeomFromText(%s, 4326)))
                        WHERE id = %s""",
                    (r.GEOID, r.geometry.wkt, row[0]),
                )
                updated += 1
            else:
                cur.execute(
                    """INSERT INTO counties (name, state_id, fips, geometry)
                       VALUES (%s, %s, %s, ST_Multi(ST_MakeValid(ST_GeomFromText(%s, 4326))))""",
                    (r.NAME, state_ids[abbr], r.GEOID, r.geometry.wkt),
                )
                added += 1
        if dry_run:
            click.echo("--dry-run: nothing written")
            return
        cur.execute("SELECT refresh_lookup_geometry()")  # rebuild county_subdivided
        cur.execute(
            """SELECT s.abbreviation, count(*), count(c.geometry)
                 FROM counties c JOIN states s ON s.id = c.state_id
                GROUP BY 1 ORDER BY 1"""
        )
        for abbr, n, with_geom in cur.fetchall():
            click.echo(f"  {abbr}: {n} counties, {with_geom} with boundaries")
    conn.close()
    click.echo(f"Updated {updated}, added {added}")


if __name__ == "__main__":
    main()
