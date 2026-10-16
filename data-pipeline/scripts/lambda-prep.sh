#!/usr/bin/env bash
# =============================================================================
# lambda-prep.sh — build everything the model v2 runs need on a Lambda instance
# =============================================================================
# Run on the GPU instance after lambda-push.sh has sent the code and labels to
# the persistent filesystem.  Works on the fast local disk (~/data-pipeline):
#   1. copy code + labels from the filesystem
#   2. install deps (lambda-setup.sh)
#   3. download the 2022 OSIP photos for the six AVAs (1,078 tiles, ~72 GB),
#      retrying until none are missing
#   4. cut the training patches from the database label snapshot
# Safe to re-run: downloads skip existing tiles; the cut is skipped if the
# patch set is already there.
#
#   bash /lambda/nfs/<filesystem>/data-pipeline/scripts/lambda-prep.sh /lambda/nfs/<filesystem>
# =============================================================================
set -euo pipefail

FS=${1:?usage: lambda-prep.sh /lambda/nfs/<filesystem>}
WORK=~/data-pipeline

echo "=== 1/4  Copy code and labels to $WORK"
mkdir -p "$WORK"
rsync -a "$FS/data-pipeline/" "$WORK/"
cd "$WORK"

echo "=== 2/4  Install dependencies"
bash scripts/lambda-setup.sh
pip install -q requests

echo "=== 3/4  Download 2022 OSIP photos"
for pass in 1 2 3 4 5 6; do
  echo "--- pass $pass"
  python3 scripts/download-osip.py --blocks data/training/gold6-avas.geojson \
    --out data/osip-2022-gold6 --workers 8 | tee /tmp/osip-pass.txt
  grep -q "Errors : 0" /tmp/osip-pass.txt && break
done
n=$(ls data/osip-2022-gold6/*.tif | wc -l)
echo "Photo tiles: $n of 1078"
[ "$n" -eq 1078 ] || { echo "Photos incomplete — re-run this script."; exit 1; }

echo "=== 4/4  Cut training patches"
# Labels: hand-traced blocks snapshotted from the production database
# (scripts/export-db-labels.py); regions.geojson = AVA outlines minus tax-lot polygons
L=data/BlocksDB-2026-10-16
P=data/patches-gold6-db-2022
if [ -f "$P/manifest.json" ]; then
  echo "Patch set already there — skipping. (Delete $P to re-cut.)"
else
  python3 scripts/cut-patches-ava.py --tiles-dir data/osip-2022-gold6 \
    --avas $L/regions.geojson --out $P \
    --label "Eola-Amity Hills=$L/eola-amity-hills.gpkg" \
    --label "McMinnville=$L/mcminnville.gpkg" \
    --label "Mt. Pisgah Polk County Oregon=$L/mt-pisgah.gpkg" \
    --label "Van Duzer Corridor=$L/van-duzer-corridor.gpkg" \
    --label "Lower Long Tom=$L/lower-long-tom.gpkg" \
    --label "Tualatin Hills=$L/tualatin-hills.gpkg"
fi

nvidia-smi --query-gpu=index,name,memory.total --format=csv
echo
echo "Ready. Next:"
echo "  cd $WORK"
echo "  python3 ml/run-folds.py --smoke --out data/model-v2-smoke"
