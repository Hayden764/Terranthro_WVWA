"""
download-osip.py — Download OSIP 30cm imagery via ArcGIS REST exportImage
=========================================================================

Downloads 4-band (R, G, B, NIR) 0.305m orthoimagery from the Oregon Spatial
Imagery Program for the geographic extent of a vineyard block GeoJSON.

The imagery is tiled into 4096×4096-pixel chunks (≈1.25 km per side) in
EPSG:32610 (UTM Zone 10N) — the same CRS our pipeline uses for NAIP, so
cut-patches.py can consume the output tiles without modification.

Only tiles that intersect at least one vineyard block are downloaded.  This
avoids fetching large swathes of non-agricultural terrain and keeps the total
download to a few GB rather than tens of GB.

Service endpoints
-----------------
  OSIP_2022_SL — 4-band (RGBNIR), 0.305 m, Oregon State Lambert native
  OSIP_2024_SL — same structure, imagery acquired June–Aug 2024

  The _WM variants serve only RGB (cached for web display).  Always use _SL
  for training data so NIR is available for NDVI computation.

Usage
-----
  # Default: 2022 imagery, Chehalem+Dundee Hills blocks file
  .venv/bin/python scripts/download-osip.py

  # Check tile count and estimated download size without downloading
  .venv/bin/python scripts/download-osip.py --dry-run

  # Download 2024 imagery
  .venv/bin/python scripts/download-osip.py --year 2024

  # Custom blocks file
  .venv/bin/python scripts/download-osip.py --blocks data/training/my_blocks.geojson
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import click
import geopandas as gpd
import requests
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL   = (
    "https://imagery.oregonexplorer.info/arcgis/rest/services"
    "/OSIP_{year}/OSIP_{year}_SL/ImageServer/exportImage"
)
OUTPUT_CRS = 32610    # UTM Zone 10N (WGS84) — matches our NAIP pipeline
RESOLUTION = 0.3048   # metres per pixel (exactly 1 US foot)
TILE_PX    = 4096     # pixels per tile side — well within API max (15000×4100)
TILE_M     = TILE_PX * RESOLUTION   # ≈ 1247.5 m per tile side


# ---------------------------------------------------------------------------
# Tile grid helpers
# ---------------------------------------------------------------------------

def utm_bbox_from_blocks(blocks_file: Path, buffer_m: float):
    """Return (xmin, ymin, xmax, ymax) in UTM Zone 10N for the block extent."""
    gdf = gpd.read_file(blocks_file)
    gdf = gdf[gdf.geometry.notna()].to_crs(epsg=OUTPUT_CRS)
    b   = gdf.total_bounds   # [xmin, ymin, xmax, ymax]
    return b[0] - buffer_m, b[1] - buffer_m, b[2] + buffer_m, b[3] + buffer_m


def make_tile_grid(xmin, ymin, xmax, ymax):
    """Generate a regular grid of (xmin, ymin, xmax, ymax) tile tuples."""
    tiles = []
    x = xmin
    while x < xmax:
        y = ymin
        while y < ymax:
            tiles.append((x, y, min(x + TILE_M, xmax), min(y + TILE_M, ymax)))
            y += TILE_M
        x += TILE_M
    return tiles


def filter_to_intersecting(tiles, blocks_file: Path):
    """Drop tiles that don't intersect any vineyard block polygon."""
    gdf    = gpd.read_file(blocks_file)
    gdf    = gdf[gdf.geometry.notna()].to_crs(epsg=OUTPUT_CRS)
    sindex = gdf.sindex
    return [t for t in tiles if list(sindex.intersection(t))]


# ---------------------------------------------------------------------------
# Tile download
# ---------------------------------------------------------------------------

def download_tile(tile, year: int, out_dir: Path, session: requests.Session, retries: int = 3):
    """
    Download one tile from OSIP and save as GeoTIFF.

    Returns (out_path, status, error_msg) where status is 'ok'|'skip'|'error'.

    Uses a two-step approach: request with f=json to let the server generate
    the output file (avoids server-side timeout on f=image direct streaming),
    then download from the returned href URL.

    Confirmed output: 4-band uint8 GeoTIFF, EPSG:32610, 0.3048 m/px.
    """
    xmin, ymin, xmax, ymax = tile

    # Pixel dimensions for this tile (edge tiles may be smaller than TILE_PX)
    width  = max(1, round((xmax - xmin) / RESOLUTION))
    height = max(1, round((ymax - ymin) / RESOLUTION))

    fname    = f"osip{year}_{int(xmin)}_{int(ymin)}.tif"
    out_path = out_dir / fname

    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path, "skip", None

    export_params = {
        "bbox":      f"{xmin:.2f},{ymin:.2f},{xmax:.2f},{ymax:.2f}",
        "bboxSR":    OUTPUT_CRS,
        "size":      f"{width},{height}",
        "imageSR":   OUTPUT_CRS,
        "format":    "tiff",
        "f":         "json",   # step 1: server generates file, returns href
    }

    url = BASE_URL.format(year=year)

    for attempt in range(retries):
        try:
            # Step 1 — ask server to render the tile and return the output URL
            meta_resp = session.get(url, params=export_params, timeout=60)
            meta_resp.raise_for_status()
            meta      = meta_resp.json()
            href      = meta.get("href")
            if not href:
                return out_path, "error", f"No href in response: {meta}"

            # Step 2 — download the generated GeoTIFF from the temp URL
            img_resp = session.get(href, timeout=180)
            img_resp.raise_for_status()
            data = img_resp.content

            # Validate TIFF magic bytes (II = little-endian, MM = big-endian)
            if data[:2] not in (b"II", b"MM"):
                snippet = data[:400].decode("utf-8", errors="replace")
                return out_path, "error", f"href returned non-TIFF data: {snippet}"

            out_path.write_bytes(data)
            return out_path, "ok", None

        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                return out_path, "error", str(exc)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command()
@click.option("--year",      type=int,          default=2022,  show_default=True,
              help="OSIP vintage to download (2022 or 2024)")
@click.option("--blocks",    "blocks_file",     type=click.Path(exists=True), default=None,
              help="Vineyard block GeoJSON used to determine download extent")
@click.option("--buffer-m",  type=float,        default=500.0, show_default=True,
              help="Padding around block bounding box (metres)")
@click.option("--out",       "out_dir",         type=click.Path(),            default=None,
              help="Output directory  [default: data/osip/or/{year}/]")
@click.option("--workers",   type=int,          default=8,     show_default=True,
              help="Parallel download threads (API limit: 20)")
@click.option("--dry-run",   is_flag=True,      default=False,
              help="Show tile count + estimated size without downloading")
def main(year, blocks_file, buffer_m, out_dir, workers, dry_run):
    """
    Download 4-band (RGBNIR) OSIP tiles covering the vineyard block training area.

    Output tiles are GeoTIFFs in EPSG:32610 (UTM Zone 10N) at 0.305 m/px,
    compatible with cut-patches.py via --naip-dir.
    """
    script_dir  = Path(__file__).resolve().parent

    if blocks_file is None:
        blocks_file = (
            script_dir / ".." / "data" / "training"
            / "ChehalemMtn_DundeeHills_Vineyards_merged.geojson"
        )
    blocks_file = Path(blocks_file).resolve()

    if out_dir is None:
        out_dir = script_dir / ".." / "data" / "osip" / "or" / str(year)
    out_dir = Path(out_dir).resolve()

    # ── Build tile grid ───────────────────────────────────────────────────────
    click.echo(f"\nReading blocks from  : {blocks_file.name}")
    xmin, ymin, xmax, ymax = utm_bbox_from_blocks(blocks_file, buffer_m)

    all_tiles = make_tile_grid(xmin, ymin, xmax, ymax)
    tiles     = filter_to_intersecting(all_tiles, blocks_file)

    area_km2  = ((xmax - xmin) * (ymax - ymin)) / 1e6
    est_gb    = len(tiles) * 20 / 1024   # ~20 MB / tile (LZW-compressed TIFF)

    click.echo(f"Block extent + buffer: {area_km2:.0f} km²")
    click.echo(f"Full grid            : {len(all_tiles)} tiles ({TILE_PX}×{TILE_PX} px = {TILE_M/1000:.2f} km/side)")
    click.echo(f"Tiles with blocks    : {len(tiles)}")
    click.echo(f"Resolution           : {RESOLUTION} m/px  (4-band RGBNIR)")
    click.echo(f"Output CRS           : EPSG:{OUTPUT_CRS}  (UTM Zone 10N)")
    click.echo(f"OSIP year            : {year}")
    click.echo(f"Output directory     : {out_dir}")
    click.echo(f"Est. download size   : ~{est_gb:.1f} GB")

    if dry_run:
        click.echo("\n[DRY RUN] No files downloaded.")
        return

    # ── Download ──────────────────────────────────────────────────────────────
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers["User-Agent"] = "osip-downloader/1.0"

    ok = skipped = errors = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_tile, t, year, out_dir, session): t for t in tiles}
        with tqdm(total=len(tiles), unit="tile", desc=f"OSIP {year}") as bar:
            for fut in as_completed(futures):
                path, status, err = fut.result()
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    skipped += 1
                else:
                    tqdm.write(f"  ERROR {path.name}: {err}")
                    errors += 1
                bar.update(1)
                bar.set_postfix(ok=ok, skip=skipped, err=errors)

    actual_gb = sum(
        p.stat().st_size for p in out_dir.glob("osip*.tif")
        if not p.name.startswith("._")
    ) / 1e9

    click.echo(f"\nDownloaded : {ok}   Skipped : {skipped}   Errors : {errors}")
    click.echo(f"Disk usage : {actual_gb:.2f} GB")
    click.echo(f"Tiles in   : {out_dir}")
    click.echo()
    click.echo("Next — cut training patches:")
    click.echo(f"  .venv/bin/python scripts/cut-patches.py \\")
    click.echo(f"      --naip-dir data/osip/or/{year}/ \\")
    click.echo(f"      --blocks-file data/training/ChehalemMtn_DundeeHills_Vineyards_merged.geojson \\")
    click.echo(f"      --output-dir data/patches-osip-{year}/ \\")
    click.echo(f"      --erosion-m 1.0")


if __name__ == "__main__":
    main()
