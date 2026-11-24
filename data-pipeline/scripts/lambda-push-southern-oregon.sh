#!/usr/bin/env bash
# =============================================================================
# lambda-push-southern-oregon.sh — send the Southern Oregon 2022 prediction run to Lambda
# =============================================================================
# Run on the Mac from data-pipeline/.  Copies into <fs>/data-pipeline the code
# (ml/, scripts/), the tile list (scripts/valley-tiles.py output) and the
# Southern Oregon AVA outline.  The run reads W-valley from
# <fs>/model-v3/checkpoints/W-valley:
#   * on TrainingRun2 (Arizona) it is already there — push without --with-model
#   * on any other filesystem (e.g. ModelTrainingOutput, California) pass
#     --with-model to send the Mac's ml/checkpoints/W-valley (best ckpt +
#     stats.json) there first.  The Mac copy must be the real 2026-11-20 model
#     fetched from TrainingRun2, not the 2026-11-18 epoch-00 smoke checkpoint.
# Uses tar over ssh (macOS openrsync silently sends nothing) with retries and
# checksums, as lambda-push-valley.sh does.
#
#   bash scripts/lambda-push-southern-oregon.sh ubuntu@<instance-ip> /lambda/nfs/TrainingRun2
#   bash scripts/lambda-push-southern-oregon.sh ubuntu@<instance-ip> /lambda/nfs/ModelTrainingOutput --with-model
# =============================================================================
set -euo pipefail

HOST=${1:?usage: lambda-push-southern-oregon.sh ubuntu@<ip> /lambda/nfs/<filesystem> [--with-model]}
FS=${2:?usage: lambda-push-southern-oregon.sh ubuntu@<ip> /lambda/nfs/<filesystem> [--with-model]}
WITH_MODEL=${3:-}
DEST=$FS/data-pipeline

cd "$(dirname "$0")/.."
R=data/southern-oregon
[ -f $R/so-tiles.geojson ] || { echo "No $R/so-tiles.geojson — run scripts/valley-tiles.py first"; exit 1; }
ssh "$HOST" "mkdir -p '$DEST'"

if [ "$WITH_MODEL" = "--with-model" ]; then
  CK=ml/checkpoints/W-valley
  BEST=$(ls $CK/*.ckpt 2>/dev/null | grep -v '/\._' | sort -t= -k3 -n | tail -1)
  [ -n "$BEST" ] && [ -f $CK/stats.json ] || { echo "No W-valley checkpoint + stats.json in $CK"; exit 1; }
  case "$BEST" in *epepoch=00-*) echo "$BEST is the epoch-00 smoke checkpoint — fetch the real W-valley from TrainingRun2 first"; exit 1;; esac
  echo "Sending model $(basename "$BEST") …"
  ssh "$HOST" "mkdir -p '$FS/model-v3/checkpoints/W-valley'"
  for try in 1 2 3 4 5; do
    COPYFILE_DISABLE=1 tar --no-xattrs -C $CK -cf - "$(basename "$BEST")" stats.json \
      | ssh "$HOST" "tar -xf - -C '$FS/model-v3/checkpoints/W-valley' 2>/dev/null" || true
    L=$(md5 -q "$BEST"); RM=$(ssh "$HOST" "md5sum '$FS/model-v3/checkpoints/W-valley/$(basename "$BEST")'" 2>/dev/null | cut -d' ' -f1 || true)
    [ "$L" = "$RM" ] && { echo "Model arrived intact."; break; }
    [ "$try" = 5 ] && { echo "Model upload failed after 5 tries."; exit 1; }
    sleep 5
  done
fi

FILES=(ml/*.py scripts/*.py scripts/*.sh $R/so-tiles.geojson $R/southern_oregon.geojson)
LOCAL=$(md5 -r "${FILES[@]}" | awk '{print $1, $2}' | sort -k2)
for try in 1 2 3 4 5; do
  echo "Sending code, tile list and outline (try $try) …"
  COPYFILE_DISABLE=1 tar --no-xattrs -cf - "${FILES[@]}" \
    | ssh "$HOST" "tar -xf - -C '$DEST' 2>/dev/null" || true
  REMOTE=$(ssh "$HOST" "cd '$DEST' && md5sum ${FILES[*]}" 2>/dev/null | awk '{print $1, $2}' | sort -k2 || true)
  if [ "$LOCAL" = "$REMOTE" ]; then echo "All ${#FILES[@]} files arrived intact."; break; fi
  [ "$try" = 5 ] && { echo "Upload still incomplete after 5 tries."; exit 1; }
  sleep 5
done
echo
echo "Done. On the instance:"
echo "  tmux new -s so"
echo "  bash $DEST/scripts/lambda-run-southern-oregon.sh $FS 2>&1 | tee -a ~/so.log"
