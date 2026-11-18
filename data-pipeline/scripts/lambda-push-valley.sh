#!/usr/bin/env bash
# =============================================================================
# lambda-push-valley.sh — send the whole-valley retrain inputs to a Lambda filesystem
# =============================================================================
# Run on the Mac from data-pipeline/.  Copies, into <remote-dir>/data-pipeline:
#   * the code (ml/, scripts/) — the working tree, so unpushed commits are fine
#   * the valley labels (blocks, regions, hard negatives, summary; ~38 MB —
#     review.gpkg stays on the Mac)
#   * the valley outline (data/valley/willamette_valley.geojson)
#   * the cutting plan data/patches-valley-2022/plan.json, made on the Mac with
#     cut-patches-ava.py --stream 2022 --plan-only (~1.5 h of CPU the GPU
#     instance doesn't have to pay for)
# The production model final-C is NOT sent: lambda-prep-valley.sh takes it
# (and C-pair) from <fs>/checkpoints, where TrainingRun2 already has both.
# Uses tar over ssh: macOS's openrsync silently sends nothing to the instance.
# Big uploads get connection resets, so it retries and checks checksums.
# Photos and patches are NOT sent — lambda-prep-valley.sh downloads and cuts
# them on the instance.
#
#   bash scripts/lambda-push-valley.sh ubuntu@<instance-ip> /lambda/nfs/<filesystem-name>
# =============================================================================
set -euo pipefail

HOST=${1:?usage: lambda-push-valley.sh ubuntu@<ip> /lambda/nfs/<filesystem>}
DEST=${2:?usage: lambda-push-valley.sh ubuntu@<ip> /lambda/nfs/<filesystem>}/data-pipeline

cd "$(dirname "$0")/.."
[ -f data/patches-valley-2022/plan.json ] || { echo "No plan.json — run the --plan-only cut first"; exit 1; }
ssh "$HOST" "mkdir -p '$DEST'"

L=data/labels-valley-2022-2026-11-18
FILES=(ml/*.py scripts/*.py scripts/*.sh $L/blocks.gpkg $L/regions.geojson $L/hard_negatives.gpkg
       $L/summary.json data/valley/willamette_valley.geojson data/patches-valley-2022/plan.json)
LOCAL=$(md5 -r "${FILES[@]}" | awk '{print $1, $2}' | sort -k2)
for try in 1 2 3 4 5; do
  echo "Sending code, labels, valley outline and plan (try $try) …"
  COPYFILE_DISABLE=1 tar --no-xattrs -cf - "${FILES[@]}" \
    | ssh "$HOST" "tar -xf - -C '$DEST' 2>/dev/null" || true
  REMOTE=$(ssh "$HOST" "cd '$DEST' && md5sum ${FILES[*]}" 2>/dev/null | awk '{print $1, $2}' | sort -k2 || true)
  if [ "$LOCAL" = "$REMOTE" ]; then echo "All ${#FILES[@]} files arrived intact."; break; fi
  [ "$try" = 5 ] && { echo "Upload still incomplete after 5 tries."; exit 1; }
  sleep 5
done
echo
echo "Done. On the instance:"
echo "  tmux new -s valley"
echo "  bash $DEST/scripts/lambda-run-valley.sh ${2} 2>&1 | tee -a ~/valley.log"
