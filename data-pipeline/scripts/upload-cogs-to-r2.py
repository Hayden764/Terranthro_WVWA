"""
Upload 1m LiDAR COGs to Cloudflare R2.

Tries rclone first (Go-based TLS, better for large uploads), then falls back to
boto3 with 100 MB multipart chunks. AWS CLI is NOT used because its default 8 MB
parts have caused persistent SSL MAC errors on large (>1 GB) R2 uploads.

Prerequisites:
  rclone:  brew install rclone
           Configure [r2] in ~/.config/rclone/rclone.conf (see README)
  boto3:   pip install boto3

Usage:
    python upload-cogs-to-r2.py
    python upload-cogs-to-r2.py --cog-dir /path/to/OR/willamette_valley_1m
    python upload-cogs-to-r2.py --layers elevation  # upload just one layer
    python upload-cogs-to-r2.py --backend boto3     # skip rclone, use boto3 directly
"""

import os
import sys
import logging
from pathlib import Path

import click
import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
import urllib3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

ACCOUNT_ID    = "96e85f10dcee27dcd62d571f5f51fee8"
BUCKET        = "terranthro-cogs"
R2_PREFIX     = "topography-data/OR/willamette_valley_1m"
LAYERS        = ["elevation", "slope", "aspect"]

# R2 credentials (from ~/.aws/credentials [r2-terranthro])
ACCESS_KEY    = "a58c3960c68b92a118ecf5a2c3227f24"
SECRET_KEY    = "35cd5bcb77296281c1ee733d1cb0a9e339579fda67a3c4f599169ec41e7938a2"

CHUNK_SIZE    = 100 * 1024 * 1024  # 100 MB — ~28 parts per 2.8 GB file


@click.command()
@click.option("--cog-dir", type=click.Path(exists=True), default=None,
              help="Directory containing elevation.tif / slope.tif / aspect.tif")
@click.option("--layers", type=str, default=",".join(LAYERS),
              show_default=True, help="Comma-separated layer names to upload.")
@click.option("--no-verify-ssl", is_flag=True, default=False,
              help="Disable SSL certificate verification (boto3 backend only).")
@click.option("--backend", type=click.Choice(["rclone", "boto3"]), default="rclone",
              show_default=True, help="Upload backend to use.")
def main(cog_dir, layers, no_verify_ssl, backend):
    script_dir = Path(__file__).resolve().parent
    if cog_dir is None:
        cog_dir = script_dir / ".." / "data" / "topography" / "OR" / "willamette_valley_1m"
    cog_dir = Path(cog_dir).resolve()

    layer_list = [l.strip() for l in layers.split(",") if l.strip()]

    # Build boto3 client only if needed
    s3 = None
    transfer_config = None
    if backend == "boto3":
        if no_verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            logger.warning("SSL verification disabled — use only for debugging.")
        endpoint = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
        boto_config = Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "adaptive"},
        )
        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=ACCESS_KEY,
            aws_secret_access_key=SECRET_KEY,
            region_name="auto",
            verify=(not no_verify_ssl),
            config=boto_config,
        )
        transfer_config = TransferConfig(
            multipart_threshold=CHUNK_SIZE,
            multipart_chunksize=CHUNK_SIZE,
            max_concurrency=1,   # single-threaded to avoid concurrent TLS sessions
            use_threads=False,
        )

    click.echo(f"\nR2 Upload — {BUCKET}/{R2_PREFIX}")
    click.echo(f"  Backend:    {backend}")
    click.echo(f"  Layers:     {', '.join(layer_list)}\n")

    failures = []
    for layer in layer_list:
        local_path = cog_dir / f"{layer}.tif"
        if not local_path.exists():
            click.echo(f"  ✗ {layer}.tif not found at {local_path}", err=True)
            failures.append(layer)
            continue

        size_mb = local_path.stat().st_size / 1_048_576
        r2_key = f"{R2_PREFIX}/{layer}.tif"
        click.echo(f"  → Uploading {layer}.tif ({size_mb:.0f} MB)...")

        ok = False
        if backend == "rclone":
            ok = _upload_rclone(local_path, r2_key)
        else:
            ok = _upload_boto3(local_path, r2_key, s3, transfer_config, no_verify_ssl)

        if ok:
            click.echo(f"\n  ✓ {layer}.tif uploaded")
        else:
            click.echo(f"\n  ✗ {layer}.tif FAILED", err=True)
            failures.append(layer)

    click.echo()
    if failures:
        click.echo(f"Failed: {', '.join(failures)}", err=True)
        sys.exit(1)
    else:
        click.echo("All uploads complete ✓")


def _upload_rclone(local_path, r2_key: str) -> bool:
    """Upload via rclone (Go-based TLS — better for large files to R2)."""
    import subprocess
    dest = f"r2:{BUCKET}/{r2_key}"
    cmd = [
        "rclone", "copyto", str(local_path), dest,
        "--s3-chunk-size", "200M",
        "--transfers", "1",
        "--s3-upload-concurrency", "1",
        "--s3-no-check-bucket",
        "--progress",
        "--stats", "15s",
    ]
    result = subprocess.run(cmd)
    return result.returncode == 0


def _upload_boto3(local_path, r2_key: str, s3_client, transfer_config, no_verify_ssl: bool) -> bool:
    """Upload via boto3 with 100 MB multipart chunks."""
    try:
        s3_client.upload_file(
            str(local_path),
            BUCKET,
            r2_key,
            ExtraArgs={"ContentType": "image/tiff"},
            Config=transfer_config,
            Callback=ProgressCallback(local_path.stat().st_size, local_path.stem),
        )
        return True
    except Exception as e:
        click.echo(f"\n    Error: {e}", err=True)
        return False


class ProgressCallback:
    """Simple progress reporter for boto3 upload_file."""
    def __init__(self, total_bytes: int, label: str):
        self._total = total_bytes
        self._seen = 0
        self._label = label

    def __call__(self, bytes_amount: int):
        self._seen += bytes_amount
        pct = self._seen / self._total * 100
        mb_done = self._seen / 1_048_576
        mb_total = self._total / 1_048_576
        print(f"\r    {self._label}: {mb_done:.0f}/{mb_total:.0f} MB ({pct:.1f}%)", end="", flush=True)


if __name__ == "__main__":
    main()
