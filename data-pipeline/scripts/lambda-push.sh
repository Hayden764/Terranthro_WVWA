#!/usr/bin/env bash
# =============================================================================
# lambda-push.sh — send the model v2 code + training data to a Lambda filesystem
# =============================================================================
# Run on the Mac from data-pipeline/.  Copies, into <remote-dir>/data-pipeline:
#   * the code (ml/, scripts/) — the working tree, so unpushed commits are fine
#   * the six AVAs' hand-traced labels, the AVA outlines, the 0.773 model and
#     its stats.json
# About 130 MB.  The photos and training patches are NOT sent: lambda-prep.sh
# downloads the photos from OSIP and re-cuts the identical patch set on the
# instance, which is far faster than uploading 24 GB from a home connection.
#
#   bash scripts/lambda-push.sh ubuntu@<instance-ip> /lambda/nfs/<filesystem-name>
# =============================================================================
set -euo pipefail

HOST=${1:?usage: lambda-push.sh ubuntu@<ip> /lambda/nfs/<filesystem>}
DEST=${2:?usage: lambda-push.sh ubuntu@<ip> /lambda/nfs/<filesystem>}/data-pipeline

cd "$(dirname "$0")/.."
ssh "$HOST" "mkdir -p '$DEST'"

echo "1/2  Code"
rsync -a --relative --exclude='._*' --exclude='__pycache__' \
  ml/*.py scripts/*.py scripts/*.sh "$HOST:$DEST/"

echo "2/2  Labels, AVA outlines, baseline model"
rsync -a --relative --partial --exclude='._*' \
  data/BlocksUpdated/Edited_Eola.gpkg \
  data/BlocksUpdated/Edited_Mac.gpkg \
  data/BlocksUpdated/Edit_Mount_Pisgah.gpkg \
  data/BlocksUpdated/Clipped_vanduzer.gpkg \
  data/BlocksUpdated/Lower_long_tom_edited.gpkg \
  data/BlocksUpdated/clipped_tualatinHills.gpkg \
  data/training/gold6-avas.geojson \
  data/patches-osip-2022/stats.json \
  "ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt" \
  "$HOST:$DEST/"

echo
echo "Done. Everything is in $HOST:$DEST"
