"""
NAIP Tile Downloader — USDA NRCS Box (2024) + Planetary Computer (2022/2020)
=============================================================================
Downloads 4-band RGBIR NAIP GeoTIFFs for a target area of interest.

2024 Source  →  USDA NRCS Box shared folder (county-level ZIP archives)
                https://nrcs.app.box.com/v/naip/folder/308423344614

Older years  →  Microsoft Planetary Computer STAC (individual COG tiles,
                no account needed)

The script resolves which Oregon county ZIP(s) cover the AOI, downloads
them, checks tiles inside using GDAL /vsizip/ (no extraction needed to
check overlap), extracts only the intersecting TIFs, then deletes the ZIP.

Output
------
    data/naip/{state}/{year}/{tile_name}.tif

Usage
-----
    # Default: 2024 Dundee Hills tiles from NRCS Box
    python download-naip.py

    # Custom AOI:
    python download-naip.py --bbox "-123.15,45.22,-122.95,45.35"

    # Fall back to PC for 2022 data:
    python download-naip.py --year 2022

    # Specific counties only (skip auto-detect):
    python download-naip.py --counties or071,or067

    # Keep the ZIP after extraction (re-use for multiple AOIs):
    python download-naip.py --keep-zip

    # List tiles without downloading:
    python download-naip.py --dry-run

    # Re-download tiles that already exist:
    python download-naip.py --overwrite
"""

import os
import re
import sys
import json
import time
import shutil
import zipfile
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import requests
import rasterio
from rasterio.warp import transform_bounds
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# NRCS Box — Oregon 2024 NAIP county-level ZIPs
# Folder: "or_m" (id 308423344614) inside 2024 → OR hierarchy
NRCS_BOX_FOLDER_URL  = "https://nrcs.app.box.com/v/naip/folder/308423344614"
NRCS_SHARED_NAME     = "naip"   # vanity name from /v/naip — stable
NRCS_DOWNLOAD_URL    = (
    "https://nrcs.app.box.com/index.php"
    "?rm=box_download_shared_file"
    "&shared_name={shared_name}"
    "&file_id=f_{file_id}"
)

# Planetary Computer — older years (2022, 2020)
PC_STAC_URL  = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PC_TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/naip"

# Default AOI: Dundee Hills gold-standard training area + buffer
# Derived from 96 QA'd block polygons (402 ac, 27 vineyards)
DUNDEE_BBOX = (-123.115, 45.232, -123.010, 45.325)  # W, S, E, N

# Oregon county FIPS → (name, rough WGS84 bbox [W, S, E, N])
# Only WV-relevant counties shown; NRCS Box 2024 availability noted
OR_COUNTIES: Dict[str, Dict] = {
    "or003": {"name": "Benton",      "bbox": (-123.90, 44.25, -122.95, 44.85), "nrcs_2024": True},
    "or005": {"name": "Clackamas",   "bbox": (-122.85, 44.70, -121.75, 45.75), "nrcs_2024": True},
    "or039": {"name": "Lane",        "bbox": (-124.20, 43.43, -121.75, 44.40), "nrcs_2024": True},
    "or043": {"name": "Linn",        "bbox": (-123.25, 44.22, -121.75, 44.80), "nrcs_2024": False},  # missing from folder
    "or047": {"name": "Marion",      "bbox": (-123.37, 44.70, -122.26, 45.27), "nrcs_2024": False},  # missing from folder
    "or053": {"name": "Polk",        "bbox": (-123.72, 44.72, -123.05, 45.27), "nrcs_2024": False},  # missing from folder
    "or067": {"name": "Washington",  "bbox": (-123.49, 45.30, -122.68, 45.78), "nrcs_2024": False},  # missing from folder
    "or071": {"name": "Yamhill",     "bbox": (-123.72, 44.98, -122.97, 45.75), "nrcs_2024": True},
}

# Sizes of available NRCS Box 2024 files (for user info, GB)
NRCS_FILE_INFO: Dict[str, Dict] = {
    "or001": {"file_id": "1714717576045", "size_gb": 3.94},
    "or003": {"file_id": "1714690091800", "size_gb": 1.02},
    "or005": {"file_id": "1714701452693", "size_gb": 1.93},
    "or007": {"file_id": "1714695555683", "size_gb": 1.03},
    "or009": {"file_id": "1714693941120", "size_gb": 0.86},
    "or011": {"file_id": "1714726756336", "size_gb": 2.08},
    "or013": {"file_id": "1714752572832", "size_gb": 3.54},
    "or015": {"file_id": "1714730754052", "size_gb": 2.55},
    "or017": {"file_id": "1714837674679", "size_gb": 4.87},
    "or019": {"file_id": "1714857510756", "size_gb": 7.63},
    "or021": {"file_id": "1714787385282", "size_gb": 1.82},
    "or025": {"file_id": "1714858832444", "size_gb": 9.95},
    "or037": {"file_id": "1714857467763", "size_gb": 9.27},
    "or039": {"file_id": "1714846096241", "size_gb": 5.73},
    "or045": {"file_id": "1714722566353", "size_gb": 9.03},
    "or059": {"file_id": "1714676783690", "size_gb": 4.14},
    "or063": {"file_id": "1714680577266", "size_gb": 3.79},
    "or065": {"file_id": "1803322154343", "size_gb": 3.49},
    "or069": {"file_id": "1714680873423", "size_gb": 2.01},
    "or071": {"file_id": "1714682675388", "size_gb": 0.93},
}

MAX_RETRIES     = 3
RETRY_BACKOFF   = 2
REQUEST_TIMEOUT = 1800   # 30 min — county ZIPs can be several GB
STREAM_CHUNK    = 2_097_152  # 2 MB
TOKEN_REFRESH_BUFFER = 120

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def bboxes_intersect(
    a: Tuple[float, float, float, float],
    b: Tuple[float, float, float, float],
) -> bool:
    """Return True if two WGS84 bboxes (W, S, E, N) overlap."""
    aw, as_, ae, an = a
    bw, bs, be, bn = b
    return ae >= bw and be >= aw and an >= bs and bn >= as_


def aoi_to_counties(
    bbox: Tuple[float, float, float, float],
    state: str,
) -> List[str]:
    """
    Return county FIPS codes (e.g. 'or071') whose rough bbox intersects
    the target AOI.  Only checks counties in OR_COUNTIES; for other states
    the caller must pass --counties explicitly.
    """
    if state != "or":
        return []
    return [
        fips for fips, info in OR_COUNTIES.items()
        if bboxes_intersect(bbox, info["bbox"])
    ]


def tile_intersects_aoi(
    tif_path: str,
    aoi: Tuple[float, float, float, float],
) -> bool:
    """
    Open a raster (supports /vsizip/ paths) and check if it intersects
    the WGS84 AOI bbox.  Returns False on any read error.
    """
    try:
        with rasterio.open(tif_path) as src:
            b = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
            return bboxes_intersect(b, aoi)
    except Exception as exc:
        logger.debug(f"Could not read {tif_path}: {exc}")
        return False


# ---------------------------------------------------------------------------
# NRCS Box download (2024)
# ---------------------------------------------------------------------------

NRCS_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def create_nrcs_session() -> Tuple["requests.Session", str, str]:
    """
    Open an authenticated Box session for the NRCS NAIP shared folder.

    Box requires three things to authorise a file download:
      1. Session cookies (box_visitor_id, z, bv, cn) — set by the page load.
      2. requestToken — a per-session CSRF value embedded in the page HTML.
      3. sharedName — the *internal* Box token for this shared link
         (e.g. "kx173sgjkk9bn6rl5s9klmwf19vio963"), NOT the vanity name "naip".

    Using a requests.Session() ensures the cookies from step 1 are
    automatically replayed on every subsequent request.

    Returns (session, request_token, shared_name).
    """
    session = requests.Session()
    session.headers.update({"User-Agent": NRCS_UA})

    logger.info(f"Loading NRCS Box folder page to establish session ...")
    resp = session.get(NRCS_BOX_FOLDER_URL, timeout=30)
    resp.raise_for_status()

    rt_m = re.search(r'"requestToken":"([a-f0-9]{40,})"', resp.text)
    sn_m = re.search(r'"sharedName":"([a-zA-Z0-9_\-]+)"', resp.text)

    if not rt_m:
        raise RuntimeError(
            "Could not find requestToken in NRCS Box page HTML. "
            "The page structure may have changed — verify the URL is still accessible."
        )
    if not sn_m:
        raise RuntimeError(
            "Could not find sharedName in NRCS Box page HTML. "
            "Try loading the URL in a browser to confirm it is still public."
        )

    request_token = rt_m.group(1)
    shared_name   = sn_m.group(1)
    cookie_count  = len(session.cookies)
    logger.info(f"Session established — {cookie_count} cookie(s) set.")
    return session, request_token, shared_name


def get_nrcs_download_url(
    file_id: str,
    session: "requests.Session",
    request_token: str,
    shared_name: str,
) -> str:
    """
    Resolve the direct boxcloud.com download URL for a Box file.
    Must use the same *session* that loaded the folder page so that
    Box session cookies are replayed automatically.
    """
    box_url = NRCS_DOWNLOAD_URL.format(
        shared_name=shared_name,
        file_id=file_id,
    )
    resp = session.get(
        box_url,
        headers={"X-Request-Token": request_token},
        allow_redirects=False,
        timeout=30,
    )
    if resp.status_code not in (301, 302, 303, 307, 308):
        raise RuntimeError(
            f"Expected redirect from Box, got HTTP {resp.status_code}. "
            f"Session or token may have expired — restart the script to re-auth."
        )
    location = resp.headers.get("Location", "")
    if not location:
        raise RuntimeError("Box redirect had no Location header.")
    return location


def download_county_zip(
    county: str,
    output_path: Path,
    session: "requests.Session",
    request_token: str,
    shared_name: str,
    dry_run: bool = False,
) -> bool:
    """
    Download an NRCS Box county ZIP to *output_path*.
    Returns True on success or if file already exists.
    """
    info = NRCS_FILE_INFO.get(county)
    if not info:
        logger.error(f"No NRCS Box 2024 entry for county {county}")
        return False

    if output_path.exists():
        logger.info(f"  ZIP already on disk: {output_path.name}")
        return True

    size_gb = info["size_gb"]
    logger.info(f"  Downloading {county} ZIP ({size_gb:.2f} GB) ...")

    if dry_run:
        logger.info(f"  [DRY RUN] Would write → {output_path}")
        return True

    # Resolve the signed boxcloud.com URL using the authenticated session
    try:
        dl_url = get_nrcs_download_url(info["file_id"], session, request_token, shared_name)
    except RuntimeError as exc:
        logger.error(f"  Failed to get download URL: {exc}")
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".tmp")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # boxcloud.com signed URLs are self-contained — no session needed here
            with requests.get(dl_url, stream=True, timeout=REQUEST_TIMEOUT) as r:
                r.raise_for_status()
                total = int(r.headers.get("Content-Length", 0))
                with open(tmp_path, "wb") as f, tqdm(
                    total=total,
                    unit="B", unit_scale=True, unit_divisor=1024,
                    desc=f"    {output_path.name}",
                    leave=False,
                ) as pbar:
                    for chunk in r.iter_content(chunk_size=STREAM_CHUNK):
                        f.write(chunk)
                        pbar.update(len(chunk))
            tmp_path.rename(output_path)
            final_gb = output_path.stat().st_size / 1e9
            logger.info(f"  Downloaded: {output_path.name} ({final_gb:.2f} GB)")
            return True

        except (requests.RequestException, OSError) as exc:
            wait = RETRY_BACKOFF ** attempt
            logger.warning(f"  Attempt {attempt}/{MAX_RETRIES} failed: {exc}")
            if attempt < MAX_RETRIES:
                logger.info(f"  Re-fetching signed URL and retrying in {wait}s ...")
                time.sleep(wait)
                try:
                    dl_url = get_nrcs_download_url(
                        info["file_id"], session, request_token, shared_name
                    )
                except RuntimeError:
                    pass
            else:
                logger.error(f"  FAILED after {MAX_RETRIES} attempts")
                if tmp_path.exists():
                    tmp_path.unlink()
                return False

    return False


def extract_aoi_tiles(
    zip_path: Path,
    output_dir: Path,
    aoi: Tuple[float, float, float, float],
    overwrite: bool = False,
) -> List[Path]:
    """
    Extract NAIP imagery from *zip_path* to *output_dir*.

    Two ZIP formats exist on NRCS Box:
      • GeoTIFF individual tiles (_i folders, not yet uploaded for OR 2024)
        → Uses GDAL /vsizip/ to check each tile's spatial extent; extracts
          only tiles that intersect *aoi*.
      • MrSID county mosaic (_m folders, current OR 2024 content)
        → Extracts the .sid + all sidecar files (.aux, .sdw, .xml) as-is.
          AOI clipping is not possible without the proprietary MrSID decoder.
          The .sid can be opened directly in QGIS (which bundles the decoder)
          for the alignment check.  For the ML training pipeline use
          --year 2022 to get individual GeoTIFF COGs instead.

    Returns list of extracted file paths.
    """
    extracted: List[Path] = []
    output_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as z:
        all_names = z.namelist()

    tif_names = [n for n in all_names if n.lower().endswith((".tif", ".tiff"))]
    sid_names = [n for n in all_names if n.lower().endswith(".sid")]

    # ── MrSID county mosaic ───────────────────────────────────────────────────
    if sid_names and not tif_names:
        logger.info(
            f"  ZIP contains a MrSID county mosaic ({len(sid_names)} .sid file) "
            f"and {len(all_names) - len(sid_names)} sidecar file(s)."
        )
        logger.info(
            "  Extracting all files — QGIS reads .sid natively for the "
            "alignment check.  For rasterio-based ML pipeline use --year 2022."
        )
        with zipfile.ZipFile(zip_path) as z:
            for name in all_names:
                out_path = output_dir / Path(name).name
                if out_path.exists() and not overwrite:
                    logger.info(f"  SKIP  {out_path.name} (already extracted)")
                    extracted.append(out_path)
                    continue
                logger.info(f"  Extracting {Path(name).name} ...")
                with z.open(name) as src, open(out_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                mb = out_path.stat().st_size / 1_048_576
                logger.info(f"  OK    {out_path.name} ({mb:.0f} MB)")
                extracted.append(out_path)
        return extracted

    # ── Individual GeoTIFF tiles ──────────────────────────────────────────────
    logger.info(f"  ZIP contains {len(tif_names)} GeoTIFF(s) — checking AOI overlap ...")

    matching: List[str] = []
    for tif_name in tif_names:
        vsi = f"/vsizip/{zip_path}/{tif_name}"
        if tile_intersects_aoi(vsi, aoi):
            matching.append(tif_name)

    logger.info(f"  {len(matching)} tile(s) intersect the AOI")

    if not matching:
        logger.warning(
            "  No GeoTIFF tiles in this ZIP intersect the AOI. "
            "Check that the correct county was selected."
        )
        return []

    with zipfile.ZipFile(zip_path) as z:
        for tif_name in matching:
            out_path = output_dir / Path(tif_name).name
            if out_path.exists() and not overwrite:
                logger.info(f"  SKIP  {out_path.name} (already extracted)")
                extracted.append(out_path)
                continue
            logger.info(f"  Extracting {Path(tif_name).name} ...")
            with z.open(tif_name) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            mb = out_path.stat().st_size / 1_048_576
            logger.info(f"  OK    {out_path.name} ({mb:.0f} MB)")
            extracted.append(out_path)

    return extracted


# ---------------------------------------------------------------------------
# Planetary Computer fallback (2022 / 2020)
# ---------------------------------------------------------------------------

class PCToken:
    """Manages a PC SAS token, auto-renewing before expiry."""

    def __init__(self):
        self._token: Optional[str] = None
        self._expiry: Optional[datetime] = None

    def get(self) -> str:
        if self._needs_refresh():
            self._refresh()
        return self._token

    def _needs_refresh(self) -> bool:
        if not self._token or not self._expiry:
            return True
        return (self._expiry - datetime.now(timezone.utc)).total_seconds() < TOKEN_REFRESH_BUFFER

    def _refresh(self):
        logger.info("Fetching Planetary Computer SAS token ...")
        resp = requests.get(PC_TOKEN_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        self._token = data["token"]
        raw = data.get("msft:expiry", "")
        try:
            self._expiry = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            from datetime import timedelta
            self._expiry = datetime.now(timezone.utc) + timedelta(hours=1)
        logger.info(f"PC token valid until {self._expiry.strftime('%H:%M:%S UTC')}")


def sign_url(href: str, token: str) -> str:
    sep = "&" if "?" in href else "?"
    return f"{href}{sep}{token}"


def search_naip_pc(
    bbox: Tuple[float, float, float, float],
    year: int,
    state: str,
) -> List[Dict]:
    """Query PC STAC for NAIP tiles intersecting bbox in the given year."""
    west, south, east, north = bbox
    payload = {
        "collections": [" naip"],
        "bbox":     [west, south, east, north],
        "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z",
        "limit":    100,
        "query":    {"naip:state": {"eq": state}},
    }
    payload["collections"] = ["naip"]
    resp = requests.post(PC_STAC_URL, json=payload, timeout=60)
    if resp.status_code != 200:
        logger.error(f"PC STAC search failed: HTTP {resp.status_code}")
        return []
    items = resp.json().get("features", [])
    items.sort(key=lambda x: x.get("properties", {}).get("datetime", ""), reverse=True)
    return items


def download_pc_tile(
    item: Dict,
    output_dir: Path,
    token_mgr: PCToken,
    overwrite: bool = False,
    dry_run: bool = False,
) -> bool:
    """Download one PC NAIP tile COG."""
    item_id  = item.get("id", "unknown")
    href     = item.get("assets", {}).get("image", {}).get("href", "")
    out_path = output_dir / f"{item_id}.tif"

    if out_path.exists() and not overwrite:
        logger.info(f"  SKIP  {out_path.name} (already on disk)")
        return True
    if not href:
        logger.warning(f"  No image href for {item_id}")
        return False

    acq = item.get("properties", {}).get("datetime", "?")[:10]
    logger.info(f"  TILE  {item_id}  acquired {acq}")
    if dry_run:
        logger.info(f"  [DRY RUN] Would download → {out_path}")
        return True

    signed = sign_url(href, token_mgr.get())
    tmp = out_path.with_suffix(".tmp")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            signed = sign_url(href, token_mgr.get())
            with requests.get(signed, stream=True, timeout=REQUEST_TIMEOUT) as r:
                r.raise_for_status()
                total = int(r.headers.get("Content-Length", 0))
                with open(tmp, "wb") as f, tqdm(
                    total=total, unit="B", unit_scale=True, unit_divisor=1024,
                    desc=f"    {out_path.name}", leave=False,
                ) as pbar:
                    for chunk in r.iter_content(chunk_size=STREAM_CHUNK):
                        f.write(chunk)
                        pbar.update(len(chunk))
            tmp.rename(out_path)
            logger.info(f"  OK    {out_path.name} ({out_path.stat().st_size/1_048_576:.0f} MB)")
            return True
        except (requests.RequestException, OSError) as exc:
            wait = RETRY_BACKOFF ** attempt
            logger.warning(f"  Attempt {attempt}/{MAX_RETRIES} failed: {exc}")
            if attempt < MAX_RETRIES:
                time.sleep(wait)
            else:
                logger.error(f"  FAILED {item_id}")
                if tmp.exists():
                    tmp.unlink()
                return False
    return False


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command()
@click.option(
    "--bbox",
    type=str, default=None,
    help=(
        "AOI as 'west,south,east,north' in WGS84.  "
        f"Default: Dundee Hills training area ({','.join(str(v) for v in DUNDEE_BBOX)})."
    ),
)
@click.option(
    "--year",
    type=int, default=2024, show_default=True,
    help=(
        "NAIP year.  2024 → NRCS Box (county ZIPs).  "
        "2022/2020 → Planetary Computer (individual COG tiles)."
    ),
)
@click.option(
    "--state",
    type=str, default="or", show_default=True,
    help="Two-letter state code (lowercase).",
)
@click.option(
    "--counties",
    type=str, default=None,
    help=(
        "Comma-separated county codes to force-download, e.g. 'or071,or067'.  "
        "If omitted, counties are inferred from the bbox."
    ),
)
@click.option(
    "--output-dir",
    type=click.Path(), default=None,
    help="Root output dir.  Tiles land in {output_dir}/{state}/{year}/.  Default: ../data/naip/",
)
@click.option(
    "--keep-zip",
    is_flag=True, default=False,
    help="Keep county ZIP after extracting tiles (useful if re-running with different AOIs).",
)
@click.option(
    "--overwrite",
    is_flag=True, default=False,
    help="Re-download / re-extract tiles that already exist on disk.",
)
@click.option(
    "--dry-run",
    is_flag=True, default=False,
    help="Show what would be downloaded without writing anything.",
)
def main(bbox, year, state, counties, output_dir, keep_zip, overwrite, dry_run):
    """
    Download NAIP RGBIR GeoTIFFs for an area of interest.

    2024 data comes from USDA NRCS Box (county-level ZIPs, tiles extracted
    to AOI).  Earlier years use Planetary Computer STAC (individual COG tiles).
    """
    script_dir = Path(__file__).resolve().parent

    if output_dir is None:
        output_dir = script_dir / ".." / "data" / "naip"
    output_dir = Path(output_dir).resolve()
    tile_dir   = output_dir / state / str(year)

    # ── Resolve AOI ───────────────────────────────────────────────────────────
    if bbox:
        try:
            aoi = tuple(float(x) for x in bbox.split(","))
            assert len(aoi) == 4
        except (ValueError, AssertionError):
            click.echo("Error: --bbox must be 'west,south,east,north'", err=True)
            sys.exit(1)
    else:
        aoi = DUNDEE_BBOX

    west, south, east, north = aoi

    click.echo("\nNAIP Tile Downloader")
    click.echo(f"  AOI        : W={west} S={south} E={east} N={north}")
    click.echo(f"  Year       : {year}  |  State: {state.upper()}")
    click.echo(f"  Source     : {'NRCS Box (county ZIPs)' if year == 2024 else 'Planetary Computer STAC'}")
    click.echo(f"  Output     : {tile_dir}")
    click.echo(f"  Keep ZIP   : {keep_zip}  |  Overwrite: {overwrite}  |  Dry run: {dry_run}\n")

    tile_dir.mkdir(parents=True, exist_ok=True)

    # ═════════════════════════════════════════════════════════════════════════
    # 2024 — NRCS Box
    # ═════════════════════════════════════════════════════════════════════════
    if year == 2024:
        # Determine target counties
        if counties:
            target_counties = [c.strip().lower() for c in counties.split(",")]
        else:
            target_counties = aoi_to_counties(aoi, state)
            if not target_counties:
                click.echo(
                    "Could not auto-detect counties for the given bbox + state. "
                    "Use --counties or071,or067 to specify them explicitly.",
                    err=True,
                )
                sys.exit(1)

        click.echo(f"Target counties: {', '.join(target_counties)}\n")

        # Warn about counties missing from NRCS Box 2024 folder
        missing_from_box = [
            c for c in target_counties
            if c not in NRCS_FILE_INFO
        ]
        if missing_from_box:
            for c in missing_from_box:
                name = OR_COUNTIES.get(c, {}).get("name", c)
                click.echo(
                    f"  WARNING: {c} ({name}) is not yet in the NRCS Box 2024 folder.\n"
                    f"  Check https://nrcs.app.box.com/v/naip for updates, or use\n"
                    f"  --year 2022 to fall back to Planetary Computer.",
                    err=True,
                )
            target_counties = [c for c in target_counties if c in NRCS_FILE_INFO]
            if not target_counties:
                sys.exit(1)

        # Establish a Box session (loads page, sets cookies, extracts tokens).
        # One session covers all county downloads — don't re-auth per file.
        if not dry_run:
            try:
                box_session, request_token, shared_name = create_nrcs_session()
            except Exception as exc:
                click.echo(f"Failed to establish NRCS Box session: {exc}", err=True)
                sys.exit(1)
        else:
            box_session = request_token = shared_name = "dry-run"

        all_extracted: List[Path] = []

        for county in target_counties:
            info     = NRCS_FILE_INFO[county]
            name     = OR_COUNTIES.get(county, {}).get("name", county)
            zip_path = tile_dir / f"nrcs_2024_{county}.zip"

            click.echo(f"[{county}] {name} County  ({info['size_gb']:.2f} GB ZIP)")

            # Step 1: download ZIP
            ok = download_county_zip(
                county, zip_path, box_session, request_token, shared_name,
                dry_run=dry_run,
            )
            if not ok:
                click.echo(f"  Download failed for {county} — skipping.", err=True)
                continue

            if dry_run:
                click.echo(f"  [DRY RUN] Would extract AOI tiles from ZIP\n")
                continue

            # Step 2: inspect ZIP + extract intersecting tiles
            extracted = extract_aoi_tiles(zip_path, tile_dir, aoi, overwrite=overwrite)
            all_extracted.extend(extracted)

            # Step 3: clean up ZIP unless --keep-zip
            if not keep_zip and zip_path.exists():
                zip_path.unlink()
                logger.info(f"  Deleted ZIP: {zip_path.name}")

            click.echo()

        if not dry_run:
            click.echo(f"{'─'*55}")
            click.echo(f"  Extracted tiles : {len(all_extracted)}")
            click.echo(f"  Output dir      : {tile_dir}")
            if all_extracted:
                total_mb = sum(p.stat().st_size for p in all_extracted) / 1_048_576
                click.echo(f"  Total on disk   : {total_mb:.0f} MB")
                click.echo(
                    f"\nNext step: open the .tif file(s) in QGIS alongside\n"
                    f"  data/training/dundee_hills_edited_blocks.geojson\n"
                    f"to verify polygon-to-NAIP alignment before cutting training patches."
                )

    # ═════════════════════════════════════════════════════════════════════════
    # 2022 / 2020 — Planetary Computer
    # ═════════════════════════════════════════════════════════════════════════
    else:
        items = search_naip_pc(aoi, year, state)
        if not items:
            click.echo(
                f"\nNo NAIP tiles found for {year} on Planetary Computer.\n"
                f"Available Oregon years on PC: 2022 (30 cm), 2020 (60 cm).",
                err=True,
            )
            sys.exit(1)

        click.echo(f"Found {len(items)} PC tile(s):\n")
        for item in items:
            acq = item.get("properties", {}).get("datetime", "?")[:10]
            click.echo(f"  {item['id']:<50}  acquired {acq}")

        if dry_run:
            click.echo(f"\n[DRY RUN] {len(items)} tile(s) would be downloaded to {tile_dir}")
            sys.exit(0)

        click.echo(f"\nDownloading {len(items)} tile(s) ...\n")
        token_mgr = PCToken()
        ok_count  = sum(
            download_pc_tile(item, tile_dir, token_mgr, overwrite=overwrite)
            for item in items
        )

        click.echo(f"\n{'─'*55}")
        click.echo(f"  Downloaded : {ok_count} / {len(items)}")
        click.echo(f"  Output dir : {tile_dir}")
        if ok_count:
            total_mb = sum(f.stat().st_size for f in tile_dir.glob("*.tif")) / 1_048_576
            click.echo(f"  Total size : {total_mb:.0f} MB")
            click.echo(
                f"\nNext step: open the .tif file(s) in QGIS alongside\n"
                f"  data/training/dundee_hills_edited_blocks.geojson\n"
                f"to verify polygon-to-NAIP alignment before cutting training patches."
            )


if __name__ == "__main__":
    main()
