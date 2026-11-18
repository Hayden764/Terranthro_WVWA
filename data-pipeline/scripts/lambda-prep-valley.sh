#!/usr/bin/env bash
# =============================================================================
# lambda-prep-valley.sh — get a Lambda instance ready for the whole-valley retrain
# =============================================================================
# Run on the GPU instance after lambda-push-valley.sh has put the code, labels
# and final-C checkpoint on the persistent filesystem.  Works on the instance's
# fast local disk (~/data-pipeline):
#   1. copy code, labels and checkpoints from the filesystem
#      (C-pair and final-C come from <fs>/checkpoints if this filesystem has
#      them — TrainingRun2 does; a missing one's grading job is skipped)
#   2. install deps (lambda-setup.sh)
#   3. download the 2022 photos of the three graded regions (Van Duzer, Lower
#      Long Tom, Mt Angel-Monitor test area), kept for prediction
#   4. cut the whole-valley training patches: plan once, then SHARDS processes
#      each downloading, cutting and deleting its share of the ~10k tiles
# Safe to re-run: downloads skip existing tiles, shards skip cut tiles, and the
# cut is skipped entirely once manifest.json exists.
#
#   bash /lambda/nfs/<filesystem>/data-pipeline/scripts/lambda-prep-valley.sh /lambda/nfs/<filesystem> [SHARDS]
# =============================================================================
set -euo pipefail

FS=${1:?usage: lambda-prep-valley.sh /lambda/nfs/<filesystem> [shards]}
SHARDS=${2:-8}
WORK=~/data-pipeline
L=data/labels-valley-2022-2026-11-18
P=data/patches-valley-2022
H=data/osip-2022-holdout
VALLEY=data/valley/willamette_valley.geojson

echo "=== 1/4  Copy code, labels and checkpoints to $WORK   [$(date +%H:%M)]"
mkdir -p "$WORK"
rsync -a "$FS/data-pipeline/" "$WORK/"
cd "$WORK"
for c in C-pair final-C; do
  if [ -d "$FS/checkpoints/$c" ]; then
    mkdir -p ml/checkpoints/$c && rsync -a "$FS/checkpoints/$c/" ml/checkpoints/$c/
    echo "$c checkpoint: found"
  else
    echo "$c checkpoint: not on this filesystem — its grading job will be skipped"
  fi
done

echo "=== 2/4  Install dependencies   [$(date +%H:%M)]"
bash scripts/lambda-setup.sh
pip install -q requests

echo "=== 3/4  Download the graded regions' 2022 photos   [$(date +%H:%M)]"
python3 - <<EOF
import geopandas as gpd
r = gpd.read_file("$L/regions.geojson")
r[r.name.isin(["Van Duzer Corridor", "Lower Long Tom", "Test - Mt Angel-Monitor"])].to_file(
    "$L/holdout-regions.geojson", driver="GeoJSON")
EOF
for pass in 1 2 3 4 5 6; do
  echo "--- pass $pass"
  python3 scripts/download-osip.py --blocks $L/holdout-regions.geojson --buffer-m 0 \
    --out $H --workers 8 | tee /tmp/osip-pass.txt
  grep -q "Errors : 0" /tmp/osip-pass.txt && break
done
grep -q "Errors : 0" /tmp/osip-pass.txt || { echo "Graded photos incomplete — re-run this script."; exit 1; }
echo "Graded photo tiles: $(ls $H/*.tif | wc -l)"

echo "=== 4/4  Cut whole-valley patches ($SHARDS shards)   [$(date +%H:%M)]"
CUT="python3 scripts/cut-patches-ava.py --stream 2022 --valley $VALLEY --avas $L/regions.geojson
     --label-all $L/blocks.gpkg --hard-neg $L/hard_negatives.gpkg --out $P"
if [ -f "$P/manifest.json" ]; then
  echo "Patch set already there — skipping. (Delete $P/manifest.json to finish again.)"
else
  mkdir -p $P/logs
  [ -f "$P/plan.json" ] || $CUT --plan-only 2>&1 | grep -v "it/s]" | tee $P/logs/plan.log
  # Tiles with no block or false alarm only give random negatives (a few per
  # 67 MB photo): download a fifth of them and take 5× the negatives from each.
  # The state server manages only ~10 MB/s, so this halves the cut (9,868 → 4,925 tiles).
  pids=()
  for k in $(seq 0 $((SHARDS - 1))); do
    $CUT --shard $k/$SHARDS --neg-tile-keep 0.2 --dl-workers 3 --download-dir ~/photos-shard$k \
      >> $P/logs/shard$k.log 2>&1 &
    pids+=($!)
  done
  bad=0
  for pid in "${pids[@]}"; do wait "$pid" || bad=1; done
  [ "$bad" = 0 ] || { echo "A shard stopped early — see $P/logs/shard*.log, then re-run this script."; exit 1; }
  rm -f $P/failed_tiles-*.txt.prev
  if ls $P/failed_tiles-*.txt >/dev/null 2>&1; then
    echo "Some tiles failed to download:"; cat $P/failed_tiles-*.txt | wc -l
    echo "Re-run this script to retry them (cut tiles are skipped)."
    for f in $P/failed_tiles-*.txt; do mv "$f" "$f.prev"; done
    exit 1
  fi
  $CUT --finish-only | tail -1
  mkdir -p "$FS/patches-valley-2022" && cp $P/plan.json $P/manifest.json $P/ava_stats.json "$FS/patches-valley-2022/"
fi
du -sh $P | cut -f1 | sed 's/^/Patch set size: /'

nvidia-smi --query-gpu=index,name,memory.total --format=csv
echo
echo "Ready   [$(date +%H:%M)]. Next:"
echo "  cd $WORK"
echo "  python3 ml/run-folds.py --plan valley --smoke --out data/model-v3-smoke"
echo "  python3 ml/run-folds.py --plan valley --sync-to $FS/model-v3"
