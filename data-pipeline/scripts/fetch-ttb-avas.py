"""
TTB AVA Boundary Fetch
======================
Downloads every Oregon AVA boundary from TTB's own AVA Map Explorer feature
service (AVAs_Production, published by TTB's Regulations and Rulings Division)
and replaces the AVA boundary files the app and pipeline read.

Outputs:
  public/data/<slug>.geojson               the 12 Willamette Valley files the map,
                                           /api/avas and the stats scripts read
                                           (existing properties kept, geometry swapped)
  data-pipeline/data/ava/oregon_avas.geojson
                                           all established OR AVAs (statewide set)
  data-pipeline/data/ava/ttb_oregon_raw.geojson
                                           raw service response, incl. pending
                                           boundary modifications
  data-pipeline/data/topography/coverage/ava_boundaries.geojson
  data-pipeline/data/topography/coverage/willamette_valley_boundary.geojson

The official boundaries are the text descriptions in 27 CFR part 9; the Map
Explorer polygons are TTB's digitization of them.

Usage:
    python fetch-ttb-avas.py
    python fetch-ttb-avas.py --dry-run     # download + compare, write nothing
"""

import json
from datetime import date
from pathlib import Path

import click
import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import MultiPolygon, mapping

SERVICE_URL = (
    "https://services7.arcgis.com/ykuAbKu9MbV93nAe/arcgis/rest/services/"
    "AVAs_Production/FeatureServer/0/query"
)
SOURCE = "TTB AVA Map Explorer (AVAs_Production feature service)"

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DATA = REPO_ROOT / "public" / "data"
PIPELINE_DATA = REPO_ROOT / "data-pipeline" / "data"
COVERAGE = PIPELINE_DATA / "topography" / "coverage"

# public/data file stem → TTB `Name` (after strip)
WV_FILES = {
    "willamette_valley": "Willamette Valley",
    "chehalem_mountains": "Chehalem Mountains",
    "dundee_hills": "Dundee Hills",
    "eola_amity_hills": "Eola-Amity Hills",
    "laurelwood_district": "Laurelwood District",
    "lower_long_tom": "Lower Long Tom",
    "mcminnville": "McMinnville",
    "mount_pisgah_polk_county": "Mt. Pisgah Polk County Oregon",
    "ribbon_ridge": "Ribbon Ridge",
    "tualatin_hills": "Tualatin Hills",
    "van_duzer_corridor": "Van Duzer Corridor",
    "yamhill_carlton": "Yamhill-Carlton",
}
# Names used in coverage/ava_boundaries.geojson (sub-AVAs only)
COVERAGE_NAMES = {"Mt. Pisgah Polk County Oregon": "Mount Pisgah Polk County"}

ACRE_M2 = 4046.8564224


def fetch_oregon() -> dict:
    r = requests.get(
        SERVICE_URL,
        params={
            "where": "States LIKE '%OR%'",
            "outFields": "*",
            "outSR": 4326,
            "geometryPrecision": 7,
            "f": "geojson",
        },
        timeout=300,
    )
    r.raise_for_status()
    fc = r.json()
    if fc.get("exceededTransferLimit"):
        raise click.ClickException("TTB service truncated the response; page the query.")
    return fc


def iso_date(ms):
    return None if ms is None else pd.to_datetime(ms, unit="ms").date().isoformat()


def clean_props(p: dict) -> dict:
    """TTB attribute names → snake_case, with 'None' strings and NaN nulled."""
    def v(x):
        if isinstance(x, str):
            x = x.strip()
            return None if x in ("", "None", "<Null>") else x
        if isinstance(x, float) and x != x:  # pandas NaN → JSON null, not bare NaN
            return None
        return x
    return {
        "name": v(p["Name"]),
        "states": v(p["States"]),
        "counties": v(p["Counties"]),
        "status": v(p["Status"]),
        "established": iso_date(p["Established"]),
        "cfr_section": v(p["CFR_Section"]),
        "within": v(p["Within"]),
        "contains": v(p["Contains_"]),
        "partially_overlaps": v(p["Partially_Overlaps"]),
        "note": v(p["Note"]),
    }


def as_multi(geom):
    return geom if geom.geom_type == "MultiPolygon" else MultiPolygon([geom])


def write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    # 6 decimals ≈ 0.1 m, well under the service's 2.5 m generalization
    path.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False))


def round_coords(geom_json: dict) -> dict:
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    return {"type": geom_json["type"], "coordinates": r(geom_json["coordinates"])}


@click.command()
@click.option("--dry-run", is_flag=True, help="Download and compare only.")
def main(dry_run):
    today = date.today().isoformat()
    raw = fetch_oregon()
    gdf = gpd.GeoDataFrame.from_features(raw["features"], crs=4326)
    gdf["Name"] = gdf["Name"].str.strip()
    gdf["geometry"] = gdf.geometry.make_valid().apply(as_multi)
    est = gdf[gdf["Status"] == "Established"].sort_values("Name")
    click.echo(f"TTB: {len(gdf)} Oregon features, {len(est)} established")

    missing = set(WV_FILES.values()) - set(est["Name"])
    if missing:
        raise click.ClickException(f"Not in TTB response: {sorted(missing)}")

    # ── Compare against current files ──────────────────────────────────────
    est_m = est.to_crs(2992)
    for stem, name in WV_FILES.items():
        path = PUBLIC_DATA / f"{stem}.geojson"
        new = est_m[est_m.Name == name].geometry.union_all()
        if path.exists():
            old = gpd.read_file(path).to_crs(2992).geometry.union_all()
            diff = old.symmetric_difference(new).area * 0.09290304 / ACRE_M2
            click.echo(f"  {stem:26s} {new.area * 0.09290304 / ACRE_M2:10,.0f} ac   changed {diff:8,.0f} ac")
    if dry_run:
        return

    source_props = {"boundary_source": SOURCE, "boundary_retrieved": today}

    # ── Raw response (incl. pending modifications) ─────────────────────────
    write_json(PIPELINE_DATA / "ava" / "ttb_oregon_raw.geojson", raw)

    # ── Statewide set ──────────────────────────────────────────────────────
    write_json(PIPELINE_DATA / "ava" / "oregon_avas.geojson", {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "properties": {**clean_props(row), **source_props},
             "geometry": round_coords(mapping(row.geometry))}
            for _, row in est.iterrows()
        ],
    })

    # ── Per-AVA files: keep existing properties, swap geometry ─────────────
    for stem, name in WV_FILES.items():
        path = PUBLIC_DATA / f"{stem}.geojson"
        row = est[est.Name == name].iloc[0]
        ttb = clean_props(row)
        props = {}
        if path.exists():
            old = json.loads(path.read_text())
            if old.get("features"):
                props = dict(old["features"][0]["properties"])
        props.update({
            "ttb_name": ttb["name"],
            "cfr_section": ttb["cfr_section"],
            "counties": ttb["counties"],
            **source_props,
        })
        write_json(path, {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": props,
                          "geometry": round_coords(mapping(row.geometry))}],
        })

    # ── Pipeline coverage files ────────────────────────────────────────────
    subs = est[est.Name.isin(set(WV_FILES.values()) - {"Willamette Valley"})]
    write_json(COVERAGE / "ava_boundaries.geojson", {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature",
             "properties": {"name": COVERAGE_NAMES.get(n, n)},
             "geometry": round_coords(mapping(g))}
            for n, g in zip(subs.Name, subs.geometry)
        ],
    })
    wv_file = json.loads((PUBLIC_DATA / "willamette_valley.geojson").read_text())
    write_json(COVERAGE / "willamette_valley_boundary.geojson", wv_file)

    click.echo("Wrote TTB boundaries.")


if __name__ == "__main__":
    main()
