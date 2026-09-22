"""
Per-Block / Per-Vineyard Soils + Bedrock Geology Compute Script
================================================================
Area-weighted overlay of vineyard_blocks.geometry and vineyards.geometry against
  - geology: DOGAMI Oregon Geologic Data Compilation (OGDC-8, MapUnitPolys)
  - soils:   USDA SSURGO map units (built by download-ssurgo.py)
writing the dominant unit, a grower-facing class, and the full unit breakdown to
vineyard_block_geology / vineyard_geology and vineyard_block_soils / vineyard_soils.
The paired "Jory silty clay loam over Grande Ronde Basalt" label is the
vineyard_block_terroir / vineyard_terroir views (migration 023).

Prerequisite:
    - Migrations 022_geology.sql and 023_soils_terroir.sql have been applied
    - OGDC-8 GIS bundle unzipped under data-pipeline/data/geology/OR/
      (https://www.oregon.gov/dogami/pubs/pages/dds/p-ogdc-8.aspx)
    - data-pipeline/data/soils/OR/ssurgo_or.gpkg built by download-ssurgo.py
    - DATABASE_URL is set in environment

Usage:
    python compute-soil-geology-stats.py
    python compute-soil-geology-stats.py --layers soils --dry-run
    python compute-soil-geology-stats.py --block-ids 1,2,3
    python compute-soil-geology-stats.py --vineyard-ids 10,11 --skip-blocks
"""

import json
import os
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional

import click
import geopandas as gpd
import pandas as pd
import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).resolve().parent))
from terroir_classes import geology_class  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent / ".." / "data"
DEFAULT_GDB = (DATA_DIR / "geology" / "OR" / "OGDC8_GIS_bundle_5.15" /
               "OGDC8_Geodatabase_5.15" / "OGDC8.gdb")
DEFAULT_SSURGO = DATA_DIR / "soils" / "OR" / "ssurgo_or.gpkg"
WORK_CRS = 2994          # NAD83(HARN) / Oregon Lambert (ft) — native OGDC CRS
MIN_UNIT_PCT = 1.0       # units below this share of the footprint are dropped from `units`

OGDC_FIELDS = ["MapUnit", "MapUnitName", "ThematicFormation", "ThematicMember",
               "ThematicRockType", "ThematicLithology", "ThematicAge"]
SSURGO_FIELDS = ["mukey", "muname", "compname", "comppct_r", "surface_texture",
                 "parent_material", "drainagecl", "taxorder", "taxclname",
                 "brockdepmin", "aws0150wta", "soil_class"]


def _clean(v) -> Optional[str]:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    v = str(v).strip()
    return None if v == "" or v.lower() == "no data" else v


def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Layer definitions
# ---------------------------------------------------------------------------

def geology_unit(u) -> dict:
    rt, fm, li = _clean(u["ThematicRockType"]), _clean(u["ThematicFormation"]), _clean(u["ThematicLithology"])
    return {
        "map_unit": _clean(u["MapUnit"]),
        "name": _clean(u["MapUnitName"]),
        "formation": fm,
        "member": _clean(u["ThematicMember"]),
        "rock_type": rt,
        "lithology": li,
        "age": _clean(u["ThematicAge"]),
        "terroir_class": geology_class(rt, fm, li),
    }


def geology_row(d: dict) -> dict:
    return {
        "map_unit": d["map_unit"], "map_unit_name": d["name"], "formation": d["formation"],
        "member": d["member"], "rock_type": d["rock_type"], "lithology": d["lithology"],
        "age": d["age"], "terroir_class": d["terroir_class"], "data_source": "DOGAMI OGDC-8",
    }


def soil_unit(u) -> dict:
    pm = _clean(u["parent_material"])
    return {
        "mukey": _clean(u["mukey"]),
        "name": _clean(u["muname"]),
        "series": _clean(u["compname"]),
        "component_pct": _num(u["comppct_r"]),
        "texture": _clean(u["surface_texture"]),
        "parent_material": pm,
        "drainage": _clean(u["drainagecl"]),
        "tax_order": _clean(u["taxorder"]),
        "tax_class": _clean(u["taxclname"]),
        "bedrock_depth_cm": _num(u["brockdepmin"]),
        "available_water_cm": _num(u["aws0150wta"]),
        "soil_class": _clean(u["soil_class"]),
    }


def soil_row(d: dict) -> dict:
    return {
        "mukey": d["mukey"], "map_unit_name": d["name"], "series": d["series"],
        "component_pct": d["component_pct"], "texture": d["texture"],
        "parent_material": d["parent_material"], "drainage": d["drainage"],
        "tax_order": d["tax_order"], "tax_class": d["tax_class"],
        "bedrock_depth_cm": d["bedrock_depth_cm"], "available_water_cm": d["available_water_cm"],
        "soil_class": d["soil_class"], "data_source": "USDA SSURGO",
    }


LAYERS: Dict[str, dict] = {
    "geology": {
        "fields": OGDC_FIELDS,
        "unit": geology_unit,
        "row": geology_row,
        "class_key": "terroir_class",
        "tables": {"vineyard_blocks": ("vineyard_block_geology", "block_id"),
                   "vineyards": ("vineyard_geology", "vineyard_id")},
    },
    "soils": {
        "fields": SSURGO_FIELDS,
        "unit": soil_unit,
        "row": soil_row,
        "class_key": "soil_class",
        "tables": {"vineyard_blocks": ("vineyard_block_soils", "block_id"),
                   "vineyards": ("vineyard_soils", "vineyard_id")},
    },
}


def load_source(layer: str, path: Path, targets: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Load source polygons in the targets' extent. The bbox filter runs in each
    source's native CRS (OGDC = WORK_CRS, SSURGO gpkg = EPSG:4326)."""
    if layer == "geology":
        gdf = gpd.read_file(path, layer="MapUnitPolys", bbox=tuple(targets.total_bounds),
                            columns=OGDC_FIELDS, engine="pyogrio")
    else:
        gdf = gpd.read_file(path, layer="mapunits", bbox=tuple(targets.to_crs(4326).total_bounds),
                            columns=SSURGO_FIELDS, engine="pyogrio")
    gdf = gdf.to_crs(WORK_CRS)
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db_connection():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        click.echo("Error: DATABASE_URL is not set", err=True)
        sys.exit(1)
    return psycopg2.connect(dsn)


def fetch_geoms(conn, table: str, ids: Optional[List[int]]) -> gpd.GeoDataFrame:
    sql = f"SELECT id, geometry FROM {table} WHERE geometry IS NOT NULL"
    params = None
    if ids:
        sql += " AND id = ANY(%(ids)s)"
        params = {"ids": ids}
    gdf = gpd.read_postgis(sql, conn, geom_col="geometry", params=params)
    return gdf.to_crs(WORK_CRS)


def upsert(conn, table: str, key: str, rows: List[dict]) -> None:
    cols = [key] + [c for c in rows[0] if c != key]
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols[1:])
    values = [tuple(json.dumps(r[c]) if c == "units" else r[c] for c in cols) for r in rows]
    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s "
            f"ON CONFLICT ({key}) DO UPDATE SET {updates}, computed_at = NOW()",
            values,
            page_size=500,
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

def summarize(targets: gpd.GeoDataFrame, src: gpd.GeoDataFrame, key: str,
              fields: List[str], unit_fn: Callable, row_fn: Callable) -> List[dict]:
    """Overlay targets on source units; return one DB row per target id."""
    targets = targets.copy()
    targets["geometry"] = targets.geometry.make_valid()
    ov = gpd.overlay(targets[["id", "geometry"]], src, how="intersection", keep_geom_type=True)
    ov["area"] = ov.geometry.area

    agg = (pd.DataFrame(ov.drop(columns="geometry"))
             .astype({c: "object" for c in fields})
             .fillna({c: "" for c in fields})
             .groupby(["id"] + fields, as_index=False)["area"].sum())
    agg["pct"] = agg["area"] / agg.groupby("id")["area"].transform("sum") * 100.0

    rows = []
    for tid, grp in agg.sort_values("pct", ascending=False).groupby("id", sort=False):
        units = [{**unit_fn(u), "pct": round(float(u["pct"]), 1)}
                 for _, u in grp.iterrows() if u["pct"] >= MIN_UNIT_PCT]
        if not units:
            continue
        rows.append({key: int(tid), **row_fn(units[0]),
                     "dominant_pct": units[0]["pct"], "units": units})
    return rows


def _parse_ids(s: Optional[str], flag: str) -> Optional[List[int]]:
    if not s:
        return None
    try:
        return [int(x.strip()) for x in s.split(",") if x.strip()]
    except ValueError:
        click.echo(f"Error: {flag} must be comma-separated integers", err=True)
        sys.exit(1)


@click.command()
@click.option("--layers", default="geology,soils", show_default=True,
              help="Comma-separated: geology, soils")
@click.option("--gdb", type=click.Path(exists=True, path_type=Path), default=DEFAULT_GDB,
              show_default=True, help="Path to OGDC8.gdb")
@click.option("--ssurgo", type=click.Path(path_type=Path), default=DEFAULT_SSURGO,
              show_default=True, help="Path to ssurgo_<state>.gpkg")
@click.option("--block-ids", type=str, default=None, help="Only these vineyard_blocks ids")
@click.option("--vineyard-ids", type=str, default=None, help="Only these vineyards ids")
@click.option("--skip-blocks", is_flag=True, default=False)
@click.option("--skip-vineyards", is_flag=True, default=False)
@click.option("--dry-run", is_flag=True, default=False, help="Compute and print, write nothing")
def main(layers, gdb, ssurgo, block_ids, vineyard_ids, skip_blocks, skip_vineyards, dry_run):
    """Compute soils and bedrock geology per vineyard block and per vineyard."""
    conn = get_db_connection()

    target_ids = {}
    if not skip_blocks:
        target_ids["vineyard_blocks"] = _parse_ids(block_ids, "--block-ids")
    if not skip_vineyards:
        target_ids["vineyards"] = _parse_ids(vineyard_ids, "--vineyard-ids")

    targets = {t: fetch_geoms(conn, t, ids) for t, ids in target_ids.items()}
    nonempty = [t for t in targets.values() if len(t)]
    if not nonempty:
        click.echo("No geometries to process.")
        return
    extent = gpd.GeoDataFrame(pd.concat(nonempty), crs=WORK_CRS)

    for layer in [l.strip() for l in layers.split(",") if l.strip()]:
        spec = LAYERS[layer]
        path = gdb if layer == "geology" else ssurgo
        click.echo(f"\n== {layer}: loading source units from {path.name} ...")
        src = load_source(layer, path, extent)
        click.echo(f"  {len(src):,} source polygons in target extent")

        for src_table, t in targets.items():
            dst, key = spec["tables"][src_table]
            rows = summarize(t, src, key, spec["fields"], spec["unit"], spec["row"])
            classes = pd.Series([r[spec["class_key"]] for r in rows]).value_counts(dropna=False)
            click.echo(f"\n{src_table}: {len(rows)}/{len(t)} with {layer} "
                       f"({len(t) - len(rows)} outside coverage)")
            click.echo(classes.to_string())
            if dry_run:
                for r in rows[:5]:
                    click.echo(f"  {key}={r[key]}: {r['map_unit_name']} → "
                               f"{r[spec['class_key']]} {r['dominant_pct']}%")
                continue
            if rows:
                upsert(conn, dst, key, rows)
            click.echo(f"  wrote {len(rows)} rows → {dst}")

    conn.close()


if __name__ == "__main__":
    main()
