"""
SSURGO Download + Attribute Build
=================================
1. Lists a state's soil survey areas from USDA Soil Data Access (SDA).
2. Downloads each area's Web Soil Survey bundle and keeps only the map-unit
   polygons (spatial/soilmu_a_*.shp).
3. Queries SDA for per-mukey attributes (dominant component, parent material,
   surface texture, drainage, depth to restriction) plus the grower-facing
   soil_class (terroir_classes.soil_classes) and merges everything into
   one GeoPackage: data-pipeline/data/soils/<STATE>/ssurgo_<state>.gpkg
   (layer `mapunits`, EPSG:4326).

Usage:
    python download-ssurgo.py                 # all Oregon areas
    python download-ssurgo.py --areas OR071,OR053
    python download-ssurgo.py --skip-download  # rebuild gpkg from cached zips
"""

import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import click
import geopandas as gpd
import pandas as pd
import requests
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from terroir_classes import soil_classes  # noqa: E402

SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
WSS_URL = "https://websoilsurvey.sc.egov.usda.gov/DSD/Download/Cache/SSA/wss_SSA_{area}_%5B{date}%5D.zip"
DATA_ROOT = Path(__file__).resolve().parent / ".." / "data" / "soils"


def sda(query: str) -> pd.DataFrame:
    r = requests.post(SDA_URL, json={"format": "JSON+COLUMNNAME", "query": query}, timeout=300)
    r.raise_for_status()
    table = r.json().get("Table", [])
    if not table:
        return pd.DataFrame()
    return pd.DataFrame(table[1:], columns=table[0])


def list_areas(state: str) -> pd.DataFrame:
    df = sda(f"SELECT areasymbol, areaname, saverest FROM sacatalog "
             f"WHERE areasymbol LIKE '{state}%' ORDER BY areasymbol")
    df["date"] = df["saverest"].map(
        lambda s: datetime.strptime(s, "%m/%d/%Y %I:%M:%S %p").strftime("%Y-%m-%d"))
    return df


def download_area(area: str, date: str, wss_dir: Path) -> Path:
    """Download (cached) and return path to the area's zip."""
    out = wss_dir / f"{area}_{date}.zip"
    if out.exists() and out.stat().st_size > 0:
        return out
    r = requests.get(WSS_URL.format(area=area, date=date), timeout=600, stream=True)
    r.raise_for_status()
    tmp = out.with_suffix(".part")
    with open(tmp, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
    tmp.rename(out)
    return out


def read_polys(zip_path: Path, area: str) -> gpd.GeoDataFrame:
    a = area.lower()
    gdf = gpd.read_file(f"zip://{zip_path}!{area}/spatial/soilmu_a_{a}.shp", engine="pyogrio")
    gdf.columns = [c.lower() if c != "geometry" else c for c in gdf.columns]
    gdf = gdf[["areasymbol", "musym", "mukey", "geometry"]]
    return gdf.to_crs(4326)


def mukey_attributes(areas: List[str]) -> pd.DataFrame:
    """One row per mukey: map unit + dominant (highest comppct) component attributes."""
    in_list = ",".join(f"'{a}'" for a in areas)
    q = f"""
    SELECT mu.mukey, mu.muname, mu.mukind,
           c.cokey, c.compname, c.comppct_r, c.compkind, c.taxorder, c.taxsubgrp,
           c.taxclname, c.drainagecl, c.hydgrp, c.slope_r,
           mag.brockdepmin, mag.wtdepannmin, mag.aws0150wta,
           (SELECT TOP 1 pmg.pmgroupname FROM copmgrp pmg
              WHERE pmg.cokey = c.cokey AND pmg.rvindicator = 'Yes') AS parent_material,
           (SELECT TOP 1 tg.texdesc FROM chorizon ch
              JOIN chtexturegrp tg ON tg.chkey = ch.chkey AND tg.rvindicator = 'Yes'
              WHERE ch.cokey = c.cokey
                AND (ch.hzname IS NULL OR ch.hzname NOT LIKE 'O%')
                AND tg.texdesc NOT LIKE '%decomposed%' AND tg.texdesc NOT LIKE '%plant material%'
              ORDER BY ch.hzdept_r) AS surface_texture
    FROM legend l
    JOIN mapunit mu ON mu.lkey = l.lkey
    LEFT JOIN muaggatt mag ON mag.mukey = mu.mukey
    LEFT JOIN component c ON c.cokey = (
        SELECT TOP 1 c2.cokey FROM component c2
        WHERE c2.mukey = mu.mukey ORDER BY c2.comppct_r DESC, c2.cokey)
    WHERE l.areasymbol IN ({in_list})
    """
    df = sda(q)
    for col in ["comppct_r", "slope_r", "brockdepmin", "wtdepannmin", "aws0150wta"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.drop(columns=["cokey"])


@click.command()
@click.option("--state", default="OR", show_default=True)
@click.option("--areas", default=None, help="Comma-separated area symbols (default: all in state)")
@click.option("--skip-download", is_flag=True, default=False)
def main(state: str, areas: Optional[str], skip_download: bool):
    root = DATA_ROOT / state
    wss_dir = root / "wss"
    wss_dir.mkdir(parents=True, exist_ok=True)

    catalog = list_areas(state)
    if areas:
        wanted = {a.strip().upper() for a in areas.split(",")}
        catalog = catalog[catalog.areasymbol.isin(wanted)]
    click.echo(f"{len(catalog)} survey areas in {state}")

    frames, failed = [], []
    for _, row in tqdm(list(catalog.iterrows()), desc="survey areas", unit="area"):
        area, date = row.areasymbol, row.date
        try:
            zp = (wss_dir / f"{area}_{date}.zip") if skip_download else download_area(area, date, wss_dir)
            frames.append(read_polys(zp, area))
        except Exception as e:
            failed.append(area)
            tqdm.write(f"  {area}: FAILED ({e})")

    polys = pd.concat(frames, ignore_index=True)
    click.echo(f"{len(polys):,} map-unit polygons from {len(frames)} areas")

    ok_areas = sorted(polys.areasymbol.unique())
    attrs = pd.concat([mukey_attributes(ok_areas[i:i + 10]) for i in range(0, len(ok_areas), 10)],
                      ignore_index=True).drop_duplicates("mukey")
    click.echo(f"{len(attrs):,} map units with attributes")
    attrs["soil_class"] = soil_classes(attrs["compname"], attrs["parent_material"])

    polys = gpd.GeoDataFrame(polys.merge(attrs, on="mukey", how="left"), crs=4326)
    polys["geometry"] = polys.geometry.make_valid()
    out = root / f"ssurgo_{state.lower()}.gpkg"
    polys.to_file(out, layer="mapunits", engine="pyogrio")
    click.echo(f"Wrote {out}")
    if failed:
        click.echo(f"Failed areas: {','.join(failed)}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
