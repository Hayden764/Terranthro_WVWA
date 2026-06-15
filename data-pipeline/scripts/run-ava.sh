#!/usr/bin/env bash
# =============================================================================
# run-ava.sh — end-to-end inference for one AVA
# =============================================================================
# download-to-complete  ->  predict  ->  vectorize
#
# The download step RE-RUNS until the OSIP server returns 0 errors (or
# MAX_PASSES is hit). download-osip.py skips tiles already on disk, so repeats
# only re-fetch the transient 500/503 failures — this is what prevents the
# "blacked-out areas" we saw on the first Eola/McMinnville run.
#
# Usage (run from data-pipeline/ on the Lambda box):
#   bash scripts/run-ava.sh <ava_name> [max_download_passes]
#
# Examples:
#   bash scripts/run-ava.sh tualatin_hills
#   bash scripts/run-ava.sh van_duzer_corridor 6
#
# Env overrides:
#   CKPT=...   checkpoint path   (default: the 0.773 model)
#   PY=...     python executable (default: python)
#   WORKERS=.. download threads  (default: 6 — stays under server limit)
# =============================================================================
set -euo pipefail

AVA="${1:?usage: run-ava.sh <ava_name> [max_passes]}"
MAX_PASSES="${2:-5}"
CKPT="${CKPT:-ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt}"
PY="${PY:-python}"
WORKERS="${WORKERS:-6}"

BND="boundaries/${AVA}.geojson"
OSIP="data/osip-${AVA}"
PRED="data/pred-${AVA}"
OUT="data/${AVA}-vineyards.geojson"
LOG="/tmp/dl-${AVA}.log"

[ -f "$BND" ] || { echo "ERROR: boundary not found: $BND"; exit 1; }

echo "############################################################"
echo "# $AVA"
echo "############################################################"

# ---- 1. download to completeness -------------------------------------------
for pass in $(seq 1 "$MAX_PASSES"); do
  echo "----- $AVA : download pass $pass / $MAX_PASSES -----"
  $PY scripts/download-osip.py \
      --blocks "$BND" --year 2022 --out "$OSIP" --workers "$WORKERS" | tee "$LOG"
  errs=$(grep -oE "Errors : [0-9]+" "$LOG" | tail -1 | grep -oE "[0-9]+" || echo "?")
  echo "----- $AVA : pass $pass finished with errors=$errs -----"
  if [ "$errs" = "0" ]; then
    echo "----- $AVA : download COMPLETE (0 errors) -----"
    break
  fi
  if [ "$pass" = "$MAX_PASSES" ]; then
    echo "!!! $AVA : still $errs errors after $MAX_PASSES passes — proceeding anyway"
  fi
done

# ---- 2. predict ------------------------------------------------------------
echo "----- $AVA : predict -----"
$PY ml/predict.py \
    --ckpt "$CKPT" --osip-dir "$OSIP" --out-dir "$PRED" \
    --stats stats.json --threshold 0.5 --batch-size 64

# ---- 3. vectorize ----------------------------------------------------------
echo "----- $AVA : vectorize -----"
$PY scripts/vectorize-predictions.py \
    --masks-dir "$PRED" --out "$OUT" \
    --min-area 1000 --closing 3 --simplify 1

echo "===== $AVA : DONE -> $OUT ====="
