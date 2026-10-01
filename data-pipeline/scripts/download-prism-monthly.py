"""
PRISM Monthly Download (800m, cropped to Oregon)
================================================
Fetches PRISM monthly time-series grids from the PRISM web service
(https://services.nacse.org/prism/data/get/us/800m/<var>/<yyyymm>), crops each
CONUS COG to an Oregon bounding box and keeps only the crop:

    data-pipeline/data/climate/prism/monthly/<var>/prism_<var>_or_800m_<yyyymm>.tif

Units as delivered by PRISM: temperatures °C, precipitation mm.

PRISM allows each file to be downloaded at most twice per 24 h, so the script
skips anything already on disk and paces requests. Data younger than ~6 months
is provisional and may be re-issued; re-run with --refresh-recent to refetch it.

Usage:
    python download-prism-monthly.py                      # tmin,tmax,tmean,ppt 1991–2025
    python download-prism-monthly.py --start 2024 --end 2025 --vars ppt
"""

import io
import time
import zipfile
from datetime import date
from pathlib import Path

import click
import requests
import rasterio
from rasterio.windows import from_bounds
from tqdm import tqdm

BASE_URL = "https://services.nacse.org/prism/data/get/us/800m"
OUT_ROOT = Path(__file__).resolve().parent / ".." / "data" / "climate" / "prism" / "monthly"
# Oregon plus a small margin (lon/lat, PRISM grids are NAD83 geographic)
OREGON_BOUNDS = (-124.8, 41.8, -116.3, 46.4)


def crop_zip_to_oregon(zip_bytes: bytes, out_path: Path) -> None:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        tif = next(n for n in zf.namelist() if n.endswith(".tif"))
        data = zf.read(tif)
    with rasterio.MemoryFile(data) as mem, mem.open() as src:
        win = from_bounds(*OREGON_BOUNDS, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(1, window=win)
        profile = src.profile.copy()
        profile.update(
            driver="GTiff", height=arr.shape[0], width=arr.shape[1],
            transform=src.window_transform(win), compress="deflate",
            tiled=True, blockxsize=256, blockysize=256,
        )
        tmp = out_path.with_suffix(".part.tif")
        with rasterio.open(tmp, "w", **profile) as dst:
            dst.write(arr, 1)
        tmp.rename(out_path)


@click.command()
@click.option("--vars", "variables", default="tmin,tmax,tmean,ppt", show_default=True)
@click.option("--start", default=1991, show_default=True, help="First year")
@click.option("--end", default=2025, show_default=True, help="Last year")
@click.option("--pause", default=1.0, show_default=True, help="Seconds between requests")
@click.option("--refresh-recent", is_flag=True, default=False,
              help="Re-download months newer than 6 months (provisional data)")
def main(variables, start, end, pause, refresh_recent):
    variables = [v.strip() for v in variables.split(",") if v.strip()]
    today = date.today()
    jobs = []
    for var in variables:
        (OUT_ROOT / var).mkdir(parents=True, exist_ok=True)
        for year in range(start, end + 1):
            for month in range(1, 13):
                if (year, month) >= (today.year, today.month):
                    continue  # month not finished yet
                out = OUT_ROOT / var / f"prism_{var}_or_800m_{year}{month:02d}.tif"
                age_months = (today.year - year) * 12 + today.month - month
                if out.exists() and not (refresh_recent and age_months <= 6):
                    continue
                jobs.append((var, year, month, out))

    click.echo(f"{len(jobs)} grids to fetch → {OUT_ROOT}")
    session = requests.Session()
    session.headers.update({"User-Agent": "Terranthro/1.0 (prism-monthly)"})
    failed = []
    for var, year, month, out in tqdm(jobs, unit="grid"):
        url = f"{BASE_URL}/{var}/{year}{month:02d}"
        try:
            r = session.get(url, timeout=300)
            r.raise_for_status()
            if not r.content.startswith(b"PK"):
                raise RuntimeError(f"not a zip: {r.content[:120]!r}")
            crop_zip_to_oregon(r.content, out)
        except Exception as e:  # keep going; report at the end
            failed.append(f"{var} {year}-{month:02d}: {e}")
            tqdm.write(f"FAILED {var} {year}-{month:02d}: {e}")
        time.sleep(pause)

    click.echo(f"done; {len(failed)} failed")
    for f in failed:
        click.echo("  " + f)


if __name__ == "__main__":
    main()
