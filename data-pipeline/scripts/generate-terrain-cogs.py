"""
Terrain COG Generator for Terranthro

Generates Cloud Optimized GeoTIFFs for elevation, slope, and aspect
from USGS 3DEP elevation data, clipped to AOI boundaries.

Usage:
    python generate-terrain-cogs.py
    python generate-terrain-cogs.py --states CA,OR --products elevation,slope
    python generate-terrain-cogs.py --avas dundee_hills,willamette_valley
    python generate-terrain-cogs.py --input-dir /path/to/custom/aois
"""

import os
import sys
import json
import math
import time
import logging
import tempfile
import glob
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict

import click
import numpy as np
import requests
from osgeo import gdal, ogr, osr
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

THREEDEP_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/"
    "3DEPElevation/ImageServer/exportImage"
)

DEFAULT_IMAGE_PARAMS = {
    "bboxSR": "4326",
    "imageSR": "4326",
    "format": "tiff",
    "pixelType": "F32",
    "interpolation": "RSP_BilinearInterpolation",
    "noDataInterpretation": "esriNoDataMatchAny",
    "noData": "-9999",
    "f": "json",
}

NODATA = -9999.0
BBOX_BUFFER_DEG = 0.005  # ~500m buffer for slope/aspect edge context
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # seconds
REQUEST_TIMEOUT = 120  # seconds
MIN_PIXEL_DIM = 4
TILE_OVERLAP_PX = 10  # pixels of overlap between adjacent tiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Suppress GDAL warnings cluttering output
gdal.UseExceptions()
gdal.SetConfigOption("CPL_LOG", "/dev/null")

# ---------------------------------------------------------------------------
# AOI Data Model
# ---------------------------------------------------------------------------


@dataclass
class AOIRecord:
    """A single Area of Interest for terrain processing."""

    aoi_id: str
    name: str
    state: str
    geometry: object  # shapely Polygon or MultiPolygon
    source_file: str
    properties: dict = field(default_factory=dict)

    @property
    def primary_state(self) -> str:
        return self.state.strip().split("|")[0].strip()

    @property
    def slug(self) -> str:
        return self.aoi_id.lower().replace(" ", "_").replace("-", "_")


# ---------------------------------------------------------------------------
# AOI Loading
# ---------------------------------------------------------------------------


def load_aois_from_directory(
    input_dir: str,
    state_filter: Optional[List[str]] = None,
    ava_filter: Optional[List[str]] = None,
) -> List[AOIRecord]:
    """Scan a directory for GeoJSON/shapefile AOIs and return AOIRecords."""
    input_path = Path(input_dir)
    if not input_path.is_dir():
        logger.error(f"Input directory does not exist: {input_dir}")
        return []

    aois: List[AOIRecord] = []

    # Collect GeoJSON files
    for filepath in sorted(input_path.glob("*.geojson")):
        if filepath.name.startswith("._"):
            continue
        try:
            aois.extend(_parse_geojson_file(str(filepath)))
        except Exception as e:
            logger.warning(f"Failed to parse {filepath.name}: {e}")

    # Collect shapefiles
    for filepath in sorted(input_path.glob("*.shp")):
        if filepath.name.startswith("._"):
            continue
        try:
            aois.extend(_parse_shapefile(str(filepath)))
        except Exception as e:
            logger.warning(f"Failed to parse {filepath.name}: {e}")

    # Apply filters
    if state_filter:
        state_set = {s.upper() for s in state_filter}
        aois = [
            a for a in aois
            if any(s.strip().upper() in state_set for s in a.state.split("|"))
        ]

    if ava_filter:
        ava_set = {a.lower() for a in ava_filter}
        aois = [a for a in aois if a.aoi_id.lower() in ava_set]

    aois.sort(key=lambda a: (a.primary_state, a.aoi_id))
    return aois


def _parse_geojson_file(filepath: str) -> List[AOIRecord]:
    """Parse a GeoJSON file into AOIRecord(s)."""
    with open(filepath, "r") as f:
        data = json.load(f)

    features = data.get("features", [])
    if not features:
        return []

    # Group features by aoi_id (or treat all as one if no ava_id property)
    groups: Dict[str, list] = {}
    for feat in features:
        props = feat.get("properties", {})
        aoi_id = props.get("ava_id") or Path(filepath).stem
        groups.setdefault(aoi_id, []).append(feat)

    records = []
    for aoi_id, feats in groups.items():
        props = feats[0].get("properties", {})
        name = props.get("name", aoi_id.replace("_", " ").title())
        state = props.get("state", "UNKNOWN")

        geometries = []
        for feat in feats:
            geom = feat.get("geometry")
            if geom:
                geometries.append(shape(geom))

        if not geometries:
            continue

        geometry = unary_union(geometries) if len(geometries) > 1 else geometries[0]

        records.append(AOIRecord(
            aoi_id=aoi_id,
            name=name,
            state=state,
            geometry=geometry,
            source_file=filepath,
            properties=props,
        ))

    return records


def _parse_shapefile(filepath: str) -> List[AOIRecord]:
    """Parse a shapefile into AOIRecord(s) using geopandas."""
    import geopandas as gpd

    gdf = gpd.read_file(filepath)
    records = []

    for _, row in gdf.iterrows():
        aoi_id = row.get("ava_id", Path(filepath).stem)
        name = row.get("name", str(aoi_id).replace("_", " ").title())
        state = row.get("state", "UNKNOWN")

        records.append(AOIRecord(
            aoi_id=str(aoi_id),
            name=str(name),
            state=str(state),
            geometry=row.geometry,
            source_file=filepath,
            properties=row.to_dict(),
        ))

    return records


# ---------------------------------------------------------------------------
# DEM Fetcher
# ---------------------------------------------------------------------------


class DEMFetcher:
    """Fetches elevation data from USGS 3DEP ImageServer."""

    def __init__(self, max_image_size: int = 4096, resolution_arcsec: float = 1 / 3):
        self.max_image_size = max_image_size
        self.resolution_arcsec = resolution_arcsec
        self.resolution_deg = resolution_arcsec / 3600.0
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Terranthro/1.0 (terrain-cog-generator)"
        })

    def fetch_dem(
        self,
        geometry,
        buffer_deg: float = BBOX_BUFFER_DEG,
        temp_dir: Optional[str] = None,
    ) -> str:
        """Fetch DEM covering the buffered bounding box of a geometry."""
        if temp_dir is None:
            temp_dir = tempfile.gettempdir()

        minx, miny, maxx, maxy = geometry.bounds
        minx -= buffer_deg
        miny -= buffer_deg
        maxx += buffer_deg
        maxy += buffer_deg

        width_deg = maxx - minx
        height_deg = maxy - miny
        width_px = max(MIN_PIXEL_DIM, int(math.ceil(width_deg / self.resolution_deg)))
        height_px = max(MIN_PIXEL_DIM, int(math.ceil(height_deg / self.resolution_deg)))

        if width_px <= self.max_image_size and height_px <= self.max_image_size:
            output_path = os.path.join(temp_dir, "dem_raw.tif")
            self._download_tile(
                (minx, miny, maxx, maxy), width_px, height_px, output_path
            )
            return output_path

        # Need tiling
        tiles = self._compute_tile_grid(minx, miny, maxx, maxy, width_px, height_px)
        logger.info(f"  Large area: splitting into {len(tiles)} tiles")

        tile_paths = []
        for i, tile in enumerate(tiles):
            tile_path = os.path.join(temp_dir, f"tile_{tile['ix']}_{tile['iy']}.tif")
            logger.info(
                f"  Downloading tile {i + 1}/{len(tiles)} "
                f"({tile['width_px']}x{tile['height_px']} px)"
            )
            self._download_tile(
                (tile["minx"], tile["miny"], tile["maxx"], tile["maxy"]),
                tile["width_px"],
                tile["height_px"],
                tile_path,
            )
            tile_paths.append(tile_path)
            # Brief pause between requests to be kind to USGS servers
            if i < len(tiles) - 1:
                time.sleep(0.5)

        output_path = os.path.join(temp_dir, "dem_raw.tif")
        self._mosaic_tiles(tile_paths, output_path, (minx, miny, maxx, maxy))
        return output_path

    def _compute_tile_grid(
        self,
        minx: float,
        miny: float,
        maxx: float,
        maxy: float,
        total_width_px: int,
        total_height_px: int,
    ) -> List[Dict]:
        """Compute tile grid for large DEM requests."""
        n_tiles_x = math.ceil(total_width_px / self.max_image_size)
        n_tiles_y = math.ceil(total_height_px / self.max_image_size)

        width_deg = maxx - minx
        height_deg = maxy - miny
        tile_width_deg = width_deg / n_tiles_x
        tile_height_deg = height_deg / n_tiles_y
        overlap_deg = self.resolution_deg * TILE_OVERLAP_PX

        tiles = []
        for iy in range(n_tiles_y):
            for ix in range(n_tiles_x):
                t_minx = minx + ix * tile_width_deg - (overlap_deg if ix > 0 else 0)
                t_maxx = minx + (ix + 1) * tile_width_deg + (
                    overlap_deg if ix < n_tiles_x - 1 else 0
                )
                t_miny = miny + iy * tile_height_deg - (overlap_deg if iy > 0 else 0)
                t_maxy = miny + (iy + 1) * tile_height_deg + (
                    overlap_deg if iy < n_tiles_y - 1 else 0
                )

                t_width_px = max(
                    MIN_PIXEL_DIM,
                    min(
                        self.max_image_size,
                        int(math.ceil((t_maxx - t_minx) / self.resolution_deg)),
                    ),
                )
                t_height_px = max(
                    MIN_PIXEL_DIM,
                    min(
                        self.max_image_size,
                        int(math.ceil((t_maxy - t_miny) / self.resolution_deg)),
                    ),
                )

                tiles.append({
                    "ix": ix,
                    "iy": iy,
                    "minx": t_minx,
                    "miny": t_miny,
                    "maxx": t_maxx,
                    "maxy": t_maxy,
                    "width_px": t_width_px,
                    "height_px": t_height_px,
                })

        return tiles

    def _download_tile(
        self,
        bbox: Tuple[float, float, float, float],
        width_px: int,
        height_px: int,
        output_path: str,
    ) -> str:
        """Download a single DEM tile from 3DEP ImageServer with retries."""
        params = {
            **DEFAULT_IMAGE_PARAMS,
            "bbox": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
            "size": f"{width_px},{height_px}",
        }

        for attempt in range(MAX_RETRIES):
            try:
                response = self.session.get(
                    THREEDEP_URL, params=params, timeout=REQUEST_TIMEOUT
                )
                response.raise_for_status()
                result = response.json()

                if "href" not in result:
                    error_info = result.get("error", result)
                    raise RuntimeError(f"No href in response: {error_info}")

                img_response = self.session.get(
                    result["href"], stream=True, timeout=REQUEST_TIMEOUT
                )
                img_response.raise_for_status()

                with open(output_path, "wb") as f:
                    for chunk in img_response.iter_content(chunk_size=65536):
                        f.write(chunk)

                return output_path

            except (requests.RequestException, RuntimeError) as e:
                if attempt < MAX_RETRIES - 1:
                    wait = RETRY_BACKOFF_BASE ** (attempt + 1)
                    logger.warning(
                        f"Tile download failed (attempt {attempt + 1}/{MAX_RETRIES}): "
                        f"{e}. Retrying in {wait}s..."
                    )
                    time.sleep(wait)
                else:
                    raise RuntimeError(
                        f"Failed to download tile after {MAX_RETRIES} attempts: {e}"
                    )

    def _mosaic_tiles(
        self,
        tile_paths: List[str],
        output_path: str,
        target_bbox: Tuple[float, float, float, float],
    ) -> str:
        """Mosaic multiple DEM tiles into a single raster."""
        warp_options = gdal.WarpOptions(
            format="GTiff",
            outputBounds=[
                target_bbox[0],
                target_bbox[1],
                target_bbox[2],
                target_bbox[3],
            ],
            xRes=self.resolution_deg,
            yRes=self.resolution_deg,
            srcNodata=NODATA,
            dstNodata=NODATA,
            resampleAlg="bilinear",
            creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER"],
        )
        gdal.Warp(output_path, tile_paths, options=warp_options)
        return output_path


# ---------------------------------------------------------------------------
# Terrain Derivation
# ---------------------------------------------------------------------------


def derive_slope(elevation_path: str, output_path: str) -> str:
    """Derive slope in degrees from an elevation raster."""
    options = gdal.DEMProcessingOptions(
        format="GTiff",
        slopeFormat="degree",
        computeEdges=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES"],
    )
    gdal.DEMProcessing(output_path, elevation_path, "slope", options=options)
    return output_path


def derive_aspect(elevation_path: str, output_path: str) -> str:
    """Derive aspect in degrees (0-360, flat=-1) from an elevation raster."""
    options = gdal.DEMProcessingOptions(
        format="GTiff",
        computeEdges=True,
        creationOptions=["COMPRESS=DEFLATE", "TILED=YES"],
    )
    gdal.DEMProcessing(output_path, elevation_path, "aspect", options=options)
    return output_path


# ---------------------------------------------------------------------------
# Raster Clipping
# ---------------------------------------------------------------------------


def clip_raster_to_geometry(
    input_path: str,
    output_path: str,
    geometry,
    nodata: float = NODATA,
) -> str:
    """Clip a raster to the exact boundary of a shapely geometry."""
    # Write geometry to a temp cutline GeoJSON
    cutline_path = output_path + ".cutline.geojson"
    try:
        cutline_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": mapping(geometry),
                }
            ],
        }
        with open(cutline_path, "w") as f:
            json.dump(cutline_geojson, f)

        warp_options = gdal.WarpOptions(
            format="GTiff",
            cutlineDSName=cutline_path,
            cropToCutline=True,
            srcNodata=nodata,
            dstNodata=nodata,
            creationOptions=["COMPRESS=DEFLATE", "TILED=YES"],
        )
        gdal.Warp(output_path, input_path, options=warp_options)
    finally:
        if os.path.exists(cutline_path):
            os.remove(cutline_path)

    return output_path


# ---------------------------------------------------------------------------
# COG Conversion
# ---------------------------------------------------------------------------


def convert_to_cog(input_path: str, output_path: str, nodata: float = NODATA) -> str:
    """Convert a GeoTIFF to a Cloud Optimized GeoTIFF."""
    translate_options = gdal.TranslateOptions(
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE",
            "BLOCKSIZE=512",
            "OVERVIEW_RESAMPLING=AVERAGE",
            "BIGTIFF=IF_SAFER",
            "NUM_THREADS=ALL_CPUS",
        ],
        noData=nodata,
    )
    gdal.Translate(output_path, input_path, options=translate_options)
    return output_path


# ---------------------------------------------------------------------------
# Single AOI Processor
# ---------------------------------------------------------------------------


def process_single_aoi(
    aoi: AOIRecord,
    output_dir: str,
    products: List[str],
    dem_fetcher: DEMFetcher,
    overwrite: bool = False,
) -> Dict:
    """Process a single AOI: download DEM, derive products, write COGs."""
    result = {
        "aoi_id": aoi.aoi_id,
        "status": "completed",
        "products": [],
        "error": None,
    }

    aoi_output_dir = os.path.join(output_dir, aoi.primary_state, aoi.slug)
    os.makedirs(aoi_output_dir, exist_ok=True)

    product_paths = {p: os.path.join(aoi_output_dir, f"{p}.tif") for p in products}

    # Check existing outputs
    if not overwrite:
        existing = [p for p, path in product_paths.items() if os.path.exists(path)]
        if set(existing) == set(products):
            result["status"] = "skipped"
            result["products"] = existing
            return result
        products_to_generate = [p for p in products if p not in existing]
    else:
        products_to_generate = list(products)

    with tempfile.TemporaryDirectory(prefix=f"terrain_{aoi.slug}_") as temp_dir:
        try:
            # Download DEM (buffered for slope/aspect context)
            logger.info(f"Downloading DEM for {aoi.aoi_id}...")
            raw_dem_path = dem_fetcher.fetch_dem(
                aoi.geometry, buffer_deg=BBOX_BUFFER_DEG, temp_dir=temp_dir
            )

            # Validate DEM
            ds = gdal.Open(raw_dem_path)
            if ds is None:
                raise RuntimeError("Failed to open downloaded DEM")
            band = ds.GetRasterBand(1)
            stats = band.ComputeStatistics(False)
            ds = None
            if stats[0] == stats[1] == 0 and stats[2] == 0:
                raise RuntimeError("DEM contains no valid elevation data")

            # Derive slope and aspect from buffered DEM
            buffered_slope_path = None
            buffered_aspect_path = None

            if "slope" in products_to_generate:
                logger.info(f"  Deriving slope for {aoi.aoi_id}...")
                buffered_slope_path = os.path.join(temp_dir, "slope_buffered.tif")
                derive_slope(raw_dem_path, buffered_slope_path)

            if "aspect" in products_to_generate:
                logger.info(f"  Deriving aspect for {aoi.aoi_id}...")
                buffered_aspect_path = os.path.join(temp_dir, "aspect_buffered.tif")
                derive_aspect(raw_dem_path, buffered_aspect_path)

            # Clip and convert each product to COG
            for product in products_to_generate:
                logger.info(f"  Writing COG: {product} for {aoi.aoi_id}...")

                if product == "elevation":
                    source_path = raw_dem_path
                elif product == "slope":
                    source_path = buffered_slope_path
                elif product == "aspect":
                    source_path = buffered_aspect_path
                else:
                    continue

                clipped_path = os.path.join(temp_dir, f"{product}_clipped.tif")
                clip_raster_to_geometry(source_path, clipped_path, aoi.geometry)
                convert_to_cog(clipped_path, product_paths[product])
                result["products"].append(product)

            result["status"] = "completed"

        except Exception as e:
            logger.error(f"Failed to process {aoi.aoi_id}: {e}")
            result["status"] = "failed"
            result["error"] = str(e)

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--input-dir",
    type=click.Path(),
    default=None,
    help="Directory containing GeoJSON/shapefile AOIs. "
    "Default: ../../client/src/data/avas/ (relative to script).",
)
@click.option(
    "--output-dir",
    type=click.Path(),
    default=None,
    help="Output directory for terrain COGs. Default: ../data/topography/",
)
@click.option(
    "--resolution",
    type=float,
    default=1 / 3,
    help="DEM resolution in arc-seconds. Default: 0.333 (~10m).",
)
@click.option(
    "--products",
    "products_str",
    type=str,
    default="elevation,slope,aspect",
    help="Comma-separated products to generate. Options: elevation,slope,aspect.",
)
@click.option(
    "--states",
    type=str,
    default=None,
    help="Filter by state abbreviation(s), comma-separated (e.g., CA,OR).",
)
@click.option(
    "--avas",
    type=str,
    default=None,
    help="Filter by specific AVA ID(s), comma-separated.",
)
@click.option(
    "--overwrite",
    is_flag=True,
    default=False,
    help="Overwrite existing COG files.",
)
@click.option(
    "--max-image-size",
    type=int,
    default=4096,
    help="Max pixels per dimension for ImageServer requests. Default: 4096.",
)
def main(input_dir, output_dir, resolution, products_str, states, avas, overwrite, max_image_size):
    """Generate terrain COGs (elevation, slope, aspect) for AOI boundaries.

    Downloads DEM data from USGS 3DEP ImageServer, derives terrain products,
    and outputs Cloud Optimized GeoTIFFs clipped to each AOI boundary.
    """
    script_dir = Path(__file__).resolve().parent

    if input_dir is None:
        input_dir = str(script_dir / ".." / ".." / "client" / "src" / "data" / "avas")
    if output_dir is None:
        output_dir = str(script_dir / ".." / "data" / "topography")

    input_dir = str(Path(input_dir).resolve())
    output_dir = str(Path(output_dir).resolve())

    # Parse products
    product_list = [p.strip() for p in products_str.split(",")]
    valid_products = {"elevation", "slope", "aspect"}
    invalid = set(product_list) - valid_products
    if invalid:
        click.echo(f"Error: Invalid products: {invalid}. Valid: {valid_products}", err=True)
        sys.exit(1)

    state_filter = [s.strip().upper() for s in states.split(",")] if states else None
    ava_filter = [a.strip().lower() for a in avas.split(",")] if avas else None

    # Load AOIs
    click.echo(f"Scanning AOIs from: {input_dir}")
    aois = load_aois_from_directory(input_dir, state_filter, ava_filter)

    if not aois:
        click.echo("No AOIs found matching filters.")
        sys.exit(0)

    # Group summary
    state_counts: Dict[str, int] = {}
    for aoi in aois:
        st = aoi.primary_state
        state_counts[st] = state_counts.get(st, 0) + 1

    click.echo(f"Found {len(aois)} AOIs across {len(state_counts)} state(s)")
    for st, count in sorted(state_counts.items()):
        click.echo(f"  {st}: {count} AOIs")
    click.echo(f"Products: {', '.join(product_list)}")
    click.echo(f"Resolution: {resolution:.4f} arc-seconds (~{resolution * 30:.0f}m)")
    click.echo(f"Output: {output_dir}")
    click.echo()

    fetcher = DEMFetcher(
        max_image_size=max_image_size,
        resolution_arcsec=resolution,
    )

    results = {"completed": [], "skipped": [], "failed": []}

    for aoi in tqdm(aois, desc="Processing AOIs", unit="aoi"):
        result = process_single_aoi(aoi, output_dir, product_list, fetcher, overwrite)
        results[result["status"]].append(result)

    # Summary
    click.echo()
    click.echo("=" * 60)
    click.echo("Processing Summary")
    click.echo("=" * 60)
    click.echo(f"  Completed: {len(results['completed'])}")
    click.echo(f"  Skipped:   {len(results['skipped'])}")
    click.echo(f"  Failed:    {len(results['failed'])}")

    if results["failed"]:
        click.echo()
        click.echo("Failed AOIs:")
        for r in results["failed"]:
            click.echo(f"  - {r['aoi_id']}: {r['error']}")

    click.echo()
    click.echo(f"Output directory: {os.path.abspath(output_dir)}")


if __name__ == "__main__":
    main()
