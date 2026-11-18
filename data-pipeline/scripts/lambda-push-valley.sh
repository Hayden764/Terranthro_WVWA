#!/usr/bin/env bash
# =============================================================================
# lambda-push-valley.sh — send the whole-valley retrain inputs to a Lambda filesystem
# =============================================================================
# Run on the Mac from data-pipeline/.  Copies, into <remote-dir>/data-pipeline:
#   * the code (ml/, scripts/) — the working tree, so unpushed commits are fine
#   * the valley labels (data/labels-valley-2022-2026-11-18, ~65 MB)
#   * the valley outline (data/valley/willamette_valley.geojson)
#   * the cutting plan data/patches-valley-2022/plan.json, made on the Mac with
#     cut-patches-ava.py --stream 2022 --plan-only (~1.5 h of CPU the GPU
#     instance doesn't have to pay for)
#   * the production model ml/checkpoints/final-C (~280 MB), graded on the
#     test area as a reference
# Uses tar over ssh: macOS's openrsync silently sends nothing to the instance.
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

echo "Sending code, labels, valley outline and final-C …"
COPYFILE_DISABLE=1 tar -cf - --exclude='._*' --exclude='__pycache__' \
  ml/*.py scripts/*.py scripts/*.sh \
  data/labels-valley-2022-2026-11-18 \
  data/valley/willamette_valley.geojson \
  data/patches-valley-2022/plan.json \
  ml/checkpoints/final-C \
  | ssh "$HOST" "tar -xf - -C '$DEST'"

ssh "$HOST" "cd '$DEST' && ls ml/checkpoints/final-C data/labels-valley-2022-2026-11-18 && du -sh ."
echo
echo "Done. On the instance:"
echo "  tmux new -s valley"
echo "  bash $DEST/scripts/lambda-prep-valley.sh ${2} 2>&1 | tee ~/prep.log"
