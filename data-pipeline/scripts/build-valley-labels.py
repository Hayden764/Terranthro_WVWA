#!/usr/bin/env python3
"""
build-valley-labels.py — Whole-valley training labels for the 2022 vineyard retrain
====================================================================================

The model-v2 labels covered six hand-traced AVAs.  Since then the rest of the
Willamette Valley has been hand-traced (staging_blocks in
new_vineyards_staging.gpkg), so the retrain can learn from the whole valley.
This writes one dated folder that cut-patches-ava.py reads directly:

  blocks.gpkg          every vineyard polygon: the database blocks plus the
                       staging blocks (origin, source id, loose flag)
  regions.geojson      the training regions, each with its ignored areas cut
                       out: the nine traced AVAs, the rest of the valley by
                       county, and one held-out test area
  review.gpkg          the same pieces as layers to look over in QGIS:
                       blocks, regions, ignore (with a reason), hard_negatives
                       and test_area
  hard_negatives.gpkg  outlines the 2022 valley run drew that are not on any
                       label: the confirmed false alarms (orchards, berries,
                       nurseries, grass seed).  cut-patches-ava.py --hard-neg
                       makes sure every one of them lands in a training patch
  summary.json         counts and areas

Labels inside a region are taken as complete: anything not traced counts as
"not vineyard".  A traced block is always vineyard, even inside the areas
below; only the ground around it is ignored.  Ignored (mask 255, no say in
training or scoring):
  * outside the Willamette Valley AVA
  * whole-lot 'tax-lot' blocks in the six original training AVAs (as before)
  * a ring of --loose-ring-m either side of every other 'tax-lot' outline
    (Chehalem, Dundee, Yamhill-Carlton and a few elsewhere): cleaned to about
    1 ha but not traced edge-exact, so they teach "vineyard here" without
    teaching sloppy edges
  * tiles the 2022 valley run skipped as built-up or high ground (outside the
    nine traced AVAs): the model never looked there, so their tracing is less
    certain
  * possible_vineyards_to_check.gpkg outlines plus --possible-buffer-m:
    sites not yet decided

Reads the production database read-only (DATABASE_URL in server/.env).  The
GeoPackages QGIS has open are copied to a temporary folder first and read from
the copy, so their write-ahead logs are never touched.

Usage
-----
  cd data-pipeline
  .venv/bin/python scripts/build-valley-labels.py --out data/labels-valley-2022-2026-11-18
"""

import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

import click
import geopandas as gpd
import pandas as pd
import psycopg2
from shapely import make_valid
from shapely.geometry import box

UTM = 32610
GOLD6 = ["Eola-Amity Hills", "McMinnville", "Mt. Pisgah Polk County Oregon",
         "Van Duzer Corridor", "Lower Long Tom", "Tualatin Hills"]
SUB3 = ["Chehalem Mountains", "Dundee Hills", "Yamhill-Carlton"]
TRACED = GOLD6 + SUB3
TEST_AREA_NAME = "Test - Mt Angel-Monitor"
# 10 x 10 OSIP tiles (12.5 km square) between Mt. Angel, Monitor and Woodburn:
# ~300 ha of vineyard among nurseries, berries and hazelnuts; the window with the
# most 2022 false alarms that also holds 150-400 ha of traced vineyard.
TEST_AREA_BOX = (509979.67, 4986462.0, 509979.67 + 12475.0, 4986462.0 + 12475.0)
MIN_REGION_KM2 = 5.0


def read_copy(path: Path, tmp: Path, **kw) -> gpd.GeoDataFrame:
    """Read a GeoPackage from a temporary copy (with its -wal/-shm) so QGIS's file is untouched."""
    for f in path.parent.glob(path.name + "*"):
        shutil.copy2(f, tmp / f.name)
    return gpd.read_file(tmp / path.name, **kw)


def clean(geoms: gpd.GeoSeries) -> gpd.GeoSeries:
    return geoms.apply(lambda g: make_valid(g) if g is not None else g).buffer(0)


@click.command()
@click.option("--out", "out_dir", required=True, type=click.Path())
@click.option("--staging", default="data/Vineyards_W_Names/new_vineyards_staging.gpkg",
              show_default=True, type=click.Path(exists=True))
@click.option("--possible", default="data/Vineyards_W_Names/possible_vineyards_to_check.gpkg",
              show_default=True, type=click.Path(exists=True))
@click.option("--valley-run", default="data/valley/valley-vineyards-2022.gpkg original",
              show_default=True, type=click.Path(exists=True),
              help="The 2022 valley run as it came off the model, before hand cleaning")
@click.option("--valley", default="../apps/wvwa/public/data/willamette_valley.geojson",
              show_default=True, type=click.Path(exists=True))
@click.option("--avas", default="data/ava/oregon_avas.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--tiles", default="data/valley/valley-tiles.geojson", show_default=True,
              type=click.Path(exists=True))
@click.option("--counties", default="data/boundaries/tl_2024_us_county", show_default=True,
              type=click.Path(exists=True))
@click.option("--env", "env_file", default="../server/.env", show_default=True,
              type=click.Path(exists=True))
@click.option("--loose-ring-m", default=3.0, show_default=True)
@click.option("--possible-buffer-m", default=10.0, show_default=True)
@click.option("--hard-neg-max-overlap", default=0.2, show_default=True,
              help="A valley-run outline is a false alarm when at most this share of it is on a label")
def main(out_dir, staging, possible, valley_run, valley, avas, tiles, counties, env_file,
         loose_ring_m, possible_buffer_m, hard_neg_max_overlap):
    out_dir = Path(out_dir)
    if out_dir.exists() and any(out_dir.iterdir()):
        raise click.ClickException(f"{out_dir} already has files; pick a new folder")
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="valley-labels-"))

    # ── Labels ───────────────────────────────────────────────────────────────
    url = next(l.split("=", 1)[1].strip().strip('"')
               for l in open(env_file) if l.startswith("DATABASE_URL="))
    con = psycopg2.connect(url)
    con.set_session(readonly=True)
    db = gpd.read_postgis(
        "SELECT id, source_dataset, geometry FROM vineyard_blocks WHERE geometry IS NOT NULL",
        con, geom_col="geometry").to_crs(UTM)
    con.close()
    st = read_copy(Path(staging), tmp, layer="staging_blocks", fid_as_index=True).to_crs(UTM)
    n_bad_staging = int((~st.is_valid).sum())

    avas_g = gpd.read_file(avas).to_crs(UTM).set_index("name")
    gold6 = avas_g.loc[GOLD6].geometry.union_all()
    traced = avas_g.loc[TRACED].geometry.union_all()

    db["geometry"] = clean(db.geometry)
    st["geometry"] = clean(st.geometry)
    db_taxlot = db.source_dataset.eq("tax-lot")
    whole_lot = db_taxlot & db.representative_point().within(gold6)
    blocks = pd.concat([
        gpd.GeoDataFrame({"origin": "db", "src_id": db.id, "source": db.source_dataset.fillna(""),
                          "loose": db_taxlot & ~whole_lot}, geometry=db.geometry, crs=UTM)[~whole_lot],
        gpd.GeoDataFrame({"origin": "staging", "src_id": st.index,
                          "source": "staging-traced", "loose": False}, geometry=st.geometry, crs=UTM),
    ], ignore_index=True)
    blocks = blocks[~blocks.is_empty]
    blocks["ha"] = (blocks.area / 1e4).round(3)

    # ── Ignored areas ────────────────────────────────────────────────────────
    ign = []
    for g in db[whole_lot].geometry:
        ign.append(("whole tax lot in a training AVA", g))
    loose = blocks[blocks.loose].geometry
    rings = (loose.buffer(loose_ring_m).difference(loose.buffer(-loose_ring_m)))
    ign += [("loose tax-lot edge", g) for g in rings if not g.is_empty]
    t = gpd.read_file(tiles).to_crs(UTM)
    skipped = t[(t.urban_frac >= 0.3) | (t.floor_ft.fillna(0) > 1500)]
    for row in skipped.itertuples():
        g = row.geometry.difference(traced)
        if not g.is_empty:
            why = "built-up tile not run in 2022" if row.urban_frac >= 0.3 else "high-ground tile not run in 2022"
            ign.append((why, g))
    pv = read_copy(Path(possible), tmp, layer="possible_vineyard_outlines").to_crs(UTM)
    ign += [("possible vineyard to check", g) for g in clean(pv.geometry).buffer(possible_buffer_m)]
    ignore = gpd.GeoDataFrame({"reason": [r for r, _ in ign]}, geometry=[g for _, g in ign], crs=UTM)
    # A traced block is always vineyard: only the ground around it is ignored.
    # (Loose-edge rings are the exception — they exist to blur a block's own edge.)
    sidx = blocks.sindex
    def keep_blocks(row):
        if row.reason == "loose tax-lot edge":
            return row.geometry
        hit = blocks.geometry.iloc[sidx.query(row.geometry, predicate="intersects")]
        return row.geometry.difference(hit.union_all()) if len(hit) else row.geometry
    ignore["geometry"] = ignore.apply(keep_blocks, axis=1)
    ignore = ignore[~ignore.is_empty]
    ignore_u = ignore.geometry.union_all()

    # ── Regions ──────────────────────────────────────────────────────────────
    wv = gpd.read_file(valley).to_crs(UTM).geometry.union_all()
    test_box = box(*TEST_AREA_BOX)
    pieces, taken = [], None
    for name in TRACED:   # in order, so nested AVAs never count twice
        g = avas_g.loc[name].geometry.intersection(wv)
        if taken is not None:
            g = g.difference(taken)
        taken = g if taken is None else taken.union(g)
        pieces.append((name, "traced AVA", g))
    rest = wv.difference(taken)
    test_area = rest.intersection(test_box)
    rest = rest.difference(test_area)
    co = gpd.read_file(counties).query("STATEFP == '41'").to_crs(UTM)
    for c in co.itertuples():
        g = rest.intersection(c.geometry)
        if g.area / 1e6 >= MIN_REGION_KM2:
            pieces.append((f"Valley - {c.NAME}", "rest of valley", g))
    pieces.append((TEST_AREA_NAME, "test area", test_area))

    regions = gpd.GeoDataFrame({"name": [p[0] for p in pieces], "kind": [p[1] for p in pieces]},
                               geometry=[p[2] for p in pieces], crs=UTM)
    regions["km2_total"] = (regions.area / 1e6).round(1)
    regions["geometry"] = regions.geometry.difference(ignore_u)
    regions["km2_used"] = (regions.area / 1e6).round(1)
    clipped = blocks.copy()
    stats = []
    for r in regions.itertuples():
        inside = clipped.geometry.intersection(r.geometry)
        stats.append((round(inside.area.sum() / 1e4, 1), int((inside.area > 100).sum())))
    regions["vine_ha"] = [s[0] for s in stats]
    regions["blocks"] = [s[1] for s in stats]

    # ── Hard negatives: the 2022 run's false alarms ──────────────────────────
    run = read_copy(Path(valley_run), tmp).to_crs(UTM)
    run["geometry"] = clean(run.geometry)
    lab_u = blocks.geometry.union_all()
    on_label = run.geometry.intersection(lab_u).area / run.area
    hard = run[(on_label <= hard_neg_max_overlap) & ~run.geometry.within(ignore_u)][["geometry"]].copy()
    hard["ha"] = (hard.area / 1e4).round(3)

    # ── Write ────────────────────────────────────────────────────────────────
    blocks.to_file(out_dir / "blocks.gpkg", layer="blocks", driver="GPKG")
    regions[["name", "kind", "geometry"]].to_file(out_dir / "regions.geojson", driver="GeoJSON")
    hard.to_file(out_dir / "hard_negatives.gpkg", layer="hard_negatives", driver="GPKG")
    rv = out_dir / "review.gpkg"
    blocks.to_file(rv, layer="blocks", driver="GPKG")
    regions.to_file(rv, layer="regions", driver="GPKG")
    ignore.dissolve("reason").reset_index().to_file(rv, layer="ignore", driver="GPKG")
    hard.to_file(rv, layer="hard_negatives", driver="GPKG")
    gpd.GeoDataFrame({"name": [TEST_AREA_NAME]}, geometry=[test_area], crs=UTM).to_file(
        rv, layer="test_area", driver="GPKG")

    summary = {
        "built": datetime.now().isoformat(timespec="seconds"),
        "blocks": {"db": int((blocks.origin == "db").sum()),
                   "staging": int((blocks.origin == "staging").sum()),
                   "loose_db": int(blocks.loose.sum()),
                   "db_whole_lots_ignored": db[whole_lot].id.tolist(),
                   "staging_invalid_fixed": n_bad_staging,
                   "ha": round(float(blocks.area.sum() / 1e4), 1)},
        "ignore_km2": {k: round(float(v / 1e6), 2) for k, v in
                       ignore.dissolve("reason").area.items()},
        "hard_negatives": {"n": len(hard), "ha": round(float(hard.area.sum() / 1e4), 1)},
        "regions": regions.drop(columns="geometry").to_dict("records"),
        "settings": {"loose_ring_m": loose_ring_m, "possible_buffer_m": possible_buffer_m,
                     "hard_neg_max_overlap": hard_neg_max_overlap,
                     "test_area_box_utm10": TEST_AREA_BOX},
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    shutil.rmtree(tmp, ignore_errors=True)

    click.echo(f"Blocks: {summary['blocks']['db']} db + {summary['blocks']['staging']} staging"
               f" = {summary['blocks']['ha']} ha  ({summary['blocks']['loose_db']} loose)")
    click.echo(f"Hard negatives: {len(hard)} ({summary['hard_negatives']['ha']} ha)")
    click.echo("Ignored km²: " + ", ".join(f"{k} {v}" for k, v in summary["ignore_km2"].items()))
    click.echo(regions.drop(columns="geometry").to_string(index=False))
    click.echo(f"→ {out_dir}")


if __name__ == "__main__":
    main()
