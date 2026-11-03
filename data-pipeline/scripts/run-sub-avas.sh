#!/usr/bin/env bash
# =============================================================================
# run-sub-avas.sh — finish the unseen sub-AVAs on a Lambda instance and score them
# =============================================================================
# Predicts the 243 tiles the whole-valley run skipped in Chehalem Mountains,
# Dundee Hills and Yamhill-Carlton, then grades each whole AVA against its
# database outlines, using the valley run's saved maps for the other 225 tiles.
# Everything is copied to $FS/sub-ava-2022 as it is written.  Safe to re-run.
# Away from that filesystem: run sub-ava-tiles.py --all first and send the final
# model to <dir>/checkpoints/final-C.  <dir> can be any folder on the instance.
#
# From the Mac (data-pipeline/), with the filesystem holding the valley run attached:
#   rsync -a --relative --exclude='._*' --exclude='__pycache__' ml/*.py scripts/*.py scripts/*.sh \
#     data/BlocksDB-unseen-2026-11-02 data/valley/sub-ava-tiles.geojson \
#     data/valley/willamette_valley.geojson ubuntu@<ip>:/lambda/nfs/<filesystem>/data-pipeline/
# On the instance:
#   bash /lambda/nfs/<filesystem>/data-pipeline/scripts/run-sub-avas.sh /lambda/nfs/<filesystem>
# =============================================================================
set -euo pipefail

FS=${1:?usage: run-sub-avas.sh /lambda/nfs/<filesystem>}
WORK=~/data-pipeline
OUT=data/sub-ava-2022
L=data/BlocksDB-unseen-2026-11-02
CKPT="$FS/checkpoints/final-C/unet-resnet34-epepoch=15-iouval_iou=0.957.ckpt"

mkdir -p "$WORK"
rsync -a --exclude='checkpoints' "$FS/data-pipeline/" "$WORK/"
cd "$WORK"
bash scripts/lambda-setup.sh
pip install -q requests

python3 ml/predict-valley.py --ckpt "$CKPT" --stats "$FS/checkpoints/final-C/stats.json" \
  --tiles data/valley/sub-ava-tiles.geojson --valley data/valley/willamette_valley.geojson \
  --out "$OUT" --sync-to "$FS/sub-ava-2022"

python3 - <<PY
import json, shutil
from pathlib import Path
tiles = json.load(open("data/valley/sub-ava-tiles.geojson"))["features"]
ran = [f["properties"]["tile"] for f in tiles if not f["properties"]["keep"]]
for t in ran:
    shutil.copy2(f"$FS/valley-2022/probs/{t}_prob.tif", f"$OUT/probs/{t}_prob.tif")
print(f"Copied {len(ran)} saved maps; {len(list(Path('$OUT/probs').glob('*.tif')))} in all")
PY

for pair in "Chehalem Mountains=chehalem-mountains" "Dundee Hills=dundee-hills" "Yamhill-Carlton=yamhill-carlton"; do
  python3 ml/score-ava.py --pred-dir "$OUT/probs" --avas "$L/regions.geojson" --ava "${pair%%=*}" \
    --labels "$L/${pair##*=}.gpkg" --out-dir "$OUT/score/${pair##*=}"
done
rsync -a "$OUT/score" "$FS/sub-ava-2022/"
echo "All done → $FS/sub-ava-2022"
