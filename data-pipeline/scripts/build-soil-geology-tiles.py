"""
Soils + Geology Map Tiles
=========================
Builds two PMTiles vector tilesets for the map's "Soils & Geology" layers:

    geology.pmtiles  (source-layer `geology`) — DOGAMI OGDC-8 map units
    soils.pmtiles    (source-layer `soils`)   — USDA SSURGO map units

Each feature carries a `cls` property (grower-facing class from
terroir_classes.py) that the frontend colours by, plus the short attribute set
shown in the click popup. Output goes to data-pipeline/data/tiles/ and, with
--public, is also copied to public/tiles/ for local dev (both gitignored).

Upload for production (R2 bucket terranthro-cogs, prefix earth/ — the frontend default
in src/config/earthLayersConfig.js):
    aws s3 cp data-pipeline/data/tiles/geology.pmtiles s3://terranthro-cogs/earth/ \
        --profile r2-terranthro --endpoint-url https://<acct>.r2.cloudflarestorage.com

Usage:
    python build-soil-geology-tiles.py --public
    python build-soil-geology-tiles.py --layers geology
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import click
import geopandas as gpd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from terroir_classes import geology_class  # noqa: E402

ROOT = Path(__file__).resolve().parent / ".."
DATA_DIR = ROOT / "data"
REPO_PUBLIC_TILES = ROOT / ".." / "public" / "tiles"
DEFAULT_GDB = (DATA_DIR / "geology" / "OR" / "OGDC8_GIS_bundle_5.15" /
               "OGDC8_Geodatabase_5.15" / "OGDC8.gdb")
DEFAULT_SSURGO = DATA_DIR / "soils" / "OR" / "ssurgo_or.gpkg"
OUT_DIR = DATA_DIR / "tiles"


def geology_features(gdb: Path) -> gpd.GeoDataFrame:
    g = gpd.read_file(gdb, layer="MapUnitPolys", engine="pyogrio",
                      columns=["MapUnit", "MapUnitName", "ThematicFormation", "ThematicRockType",
                               "ThematicLithology", "ThematicAge"])
    clean = lambda s: s.where(~s.fillna("").str.lower().isin(["", "no data"]))  # noqa: E731
    out = gpd.GeoDataFrame({
        "unit": g["MapUnit"],
        "name": g["MapUnitName"],
        "fm": clean(g["ThematicFormation"]),
        "rock": clean(g["ThematicRockType"]),
        "lith": clean(g["ThematicLithology"]),
        "age": clean(g["ThematicAge"]),
    }, geometry=g.geometry, crs=g.crs)
    out["cls"] = [geology_class(r, f, l) for r, f, l in zip(out.rock, out.fm, out.lith)]
    return out


def soil_features(gpkg: Path) -> gpd.GeoDataFrame:
    s = gpd.read_file(gpkg, layer="mapunits", engine="pyogrio",
                      columns=["mukey", "musym", "muname", "compname", "comppct_r",
                               "surface_texture", "parent_material", "drainagecl",
                               "taxorder", "brockdepmin", "soil_class"])
    out = gpd.GeoDataFrame({
        "mukey": s["mukey"],
        "sym": s["musym"],
        "name": s["muname"],
        "series": s["compname"],
        "pct": s["comppct_r"],
        "tex": s["surface_texture"],
        "pm": s["parent_material"],
        "drain": s["drainagecl"],
        "order": s["taxorder"],
        "rockcm": s["brockdepmin"],
        "cls": s["soil_class"],
    }, geometry=s.geometry, crs=s.crs)
    return out


LOW_MAX_ZOOM = 10   # z5–10: polygons dissolved by class (colour only, small + exact)
HIGH_MIN_ZOOM = 11  # z11–14: every map unit with its popup attributes


def _write_seq(gdf: gpd.GeoDataFrame, path: Path) -> None:
    gdf = gdf.to_crs(4326)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    gdf.to_file(path, driver="GeoJSONSeq", engine="pyogrio")


def _tippecanoe(src: Path, out: Path, layer: str, minzoom: int, maxzoom: int, extra=()) -> None:
    cmd = ["tippecanoe", "-o", str(out), "--force", "-l", layer,
           "-Z", str(minzoom), "-z", str(maxzoom),
           "--detect-shared-borders", "--no-tiny-polygon-reduction", *extra, str(src)]
    click.echo(" ".join(cmd))
    subprocess.run(cmd, check=True)


def run_tippecanoe(gdf: gpd.GeoDataFrame, layer: str, out: Path) -> None:
    """Two zoom bands joined into one PMTiles. Tippecanoe's coalesce/drop options
    would merge neighbouring units under one unit's attributes and mis-colour the
    map, so low zooms get an exact dissolve-by-class instead and high zooms keep
    every polygon (no feature dropping)."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # Low zooms: simplify (~30 m) then dissolve by class
        low = gdf[["cls", "geometry"]].copy()
        low["cls"] = low["cls"].fillna("")
        low["geometry"] = low.geometry.simplify(30 if gdf.crs.is_projected else 0.0003)
        low = low.dissolve(by="cls", as_index=False).explode(index_parts=False)
        low["cls"] = low["cls"].replace("", None)
        click.echo(f"  low zooms: {len(low):,} dissolved polygons")
        _write_seq(low, tmp / "low.geojsonl")
        _tippecanoe(tmp / "low.geojsonl", tmp / "low.pmtiles", layer, 5, LOW_MAX_ZOOM,
                    extra=["--no-feature-limit", "--no-tile-size-limit"])

        _write_seq(gdf, tmp / "high.geojsonl")
        _tippecanoe(tmp / "high.geojsonl", tmp / "high.pmtiles", layer, HIGH_MIN_ZOOM, 14,
                    extra=["--no-feature-limit", "--no-tile-size-limit", "--simplify-only-low-zooms"])

        cmd = ["tile-join", "-o", str(out), "--force", "--no-tile-size-limit",
               str(tmp / "low.pmtiles"), str(tmp / "high.pmtiles")]
        click.echo(" ".join(cmd))
        subprocess.run(cmd, check=True)
    click.echo(f"  → {out} ({out.stat().st_size / 1e6:.1f} MB)")


@click.command()
@click.option("--layers", default="geology,soils", show_default=True)
@click.option("--gdb", type=click.Path(exists=True, path_type=Path), default=DEFAULT_GDB)
@click.option("--ssurgo", type=click.Path(path_type=Path), default=DEFAULT_SSURGO)
@click.option("--public", "copy_public", is_flag=True, default=False,
              help="Also copy outputs to public/tiles/ for local dev")
def main(layers, gdb, ssurgo, copy_public):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for layer in [l.strip() for l in layers.split(",") if l.strip()]:
        click.echo(f"\n== {layer}")
        gdf = geology_features(gdb) if layer == "geology" else soil_features(ssurgo)
        click.echo(f"  {len(gdf):,} polygons; classes:\n{gdf.cls.value_counts(dropna=False).to_string()}")
        out = OUT_DIR / f"{layer}.pmtiles"
        run_tippecanoe(gdf, layer, out)
        if copy_public:
            REPO_PUBLIC_TILES.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out, REPO_PUBLIC_TILES / out.name)
            click.echo(f"  copied → public/tiles/{out.name}")


if __name__ == "__main__":
    main()
