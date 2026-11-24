#!/usr/bin/env bash
# =============================================================================
# lambda-run-southern-oregon.sh — predict vineyards over the Southern Oregon AVA (2022 OSIP)
# =============================================================================
# Run on the GPU instance after lambda-push-southern-oregon.sh.  Works on the
# instance's local disk (~/data-pipeline):
#   1. copy code + tile list from the filesystem, and the W-valley model from
#      <fs>/model-v3/checkpoints/W-valley (best val_iou checkpoint + stats.json)
#   2. install deps (lambda-setup.sh)
#   3. ml/predict-valley.py over the ~5,700 kept tiles at a 0.3 cutoff
#      (W-valley's wine-country recall setting), syncing shapes/, done/ and the
#      merged layer to <fs>/southern-oregon-2022 as batches finish
# The state photo server is the bottleneck (~10 MB/s, occasional outages), so
# the prediction step is re-run up to 5 times with a 10-minute pause: each run
# picks up the tiles not yet done, including failed downloads.
# Probability maps (uint8) are copied to <fs>/southern-oregon-2022/probs at the end.
#
#   bash /lambda/nfs/TrainingRun2/data-pipeline/scripts/lambda-run-southern-oregon.sh /lambda/nfs/TrainingRun2
# =============================================================================
set -euo pipefail
FS=${1:?usage: lambda-run-southern-oregon.sh /lambda/nfs/<filesystem>}
WORK=~/data-pipeline
R=data/southern-oregon
OUT=data/southern-oregon-2022
SYNC=$FS/southern-oregon-2022
CK=ml/checkpoints/W-valley

echo "=== 1/3  Copy code, tile list and W-valley   [$(date +%H:%M)]"
mkdir -p "$WORK" "$SYNC"
rsync -a "$FS/data-pipeline/" "$WORK/"
cd "$WORK"
[ -d "$FS/model-v3/checkpoints/W-valley" ] || { echo "No W-valley on $FS/model-v3/checkpoints — wrong filesystem?"; exit 1; }
rm -rf $CK && mkdir -p $CK && rsync -a "$FS/model-v3/checkpoints/W-valley/" $CK/
CKPT=$(python3 - <<EOF
import re
from pathlib import Path
s = [(float(m.group(1)), p) for p in Path("$CK").glob("*.ckpt")
     if not p.name.startswith("._") and (m := re.search(r"val_iou=(\d+\.\d+)\.ckpt$", p.name))]
print(max(s)[1])
EOF
)
echo "Model: $CKPT"

echo "=== 2/3  Install dependencies   [$(date +%H:%M)]"
bash scripts/lambda-setup.sh
pip install -q requests

echo "=== 3/3  Predict Southern Oregon   [$(date +%H:%M)]"
PRED=(python3 ml/predict-valley.py --ckpt "$CKPT" --stats $CK/stats.json
      --tiles $R/so-tiles.geojson --valley $R/southern_oregon.geojson
      --out $OUT --name southern-oregon-vineyards --threshold 0.3 --sync-to "$SYNC")
for run in 1 2 3 4 5; do
  echo "--- prediction run $run   [$(date +%H:%M)]"
  "${PRED[@]}" || echo "predict-valley exited with an error"
  left=$(python3 - <<EOF
import json, geopandas as gpd
from pathlib import Path
keep = set(gpd.read_file("$R/so-tiles.geojson").query("keep").tile)
done = set()
for m in Path("$OUT/done").glob("[!.]*.json"):
    done |= set(json.loads(m.read_text())["tiles_ok"])
print(len(keep - done))
EOF
)
  echo "Tiles left: $left"
  [ "$left" = 0 ] && break
  [ "$run" = 5 ] && { echo "Still $left tiles left after 5 runs — re-run this script later."; exit 1; }
  sleep 600
done

echo "Copying probability maps to $SYNC/probs …"
mkdir -p "$SYNC/probs" && rsync -a $OUT/probs/ "$SYNC/probs/"
echo "=== All done   [$(date +%H:%M)] — $SYNC/southern-oregon-vineyards-2022.gpkg; safe to terminate the instance."
