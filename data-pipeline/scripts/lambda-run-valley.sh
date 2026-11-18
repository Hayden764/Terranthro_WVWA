#!/usr/bin/env bash
# =============================================================================
# lambda-run-valley.sh — the whole-valley retrain, start to finish, unattended
# =============================================================================
# Runs lambda-prep-valley.sh (deps, graded photos, patch cut) and then
# run-folds.py --plan valley, syncing every finished job (scores + checkpoints)
# to the persistent filesystem as it goes.  Start it in tmux and walk away;
# re-running it after a crash picks up where it stopped.  When it ends, the
# results table is in <fs>/model-v3/runs/results.md and the instance can be shut down.
#
#   tmux new -s valley
#   bash /lambda/nfs/<filesystem>/data-pipeline/scripts/lambda-run-valley.sh /lambda/nfs/<filesystem> 2>&1 | tee -a ~/valley.log
#
# Add --smoke as a second argument for a quick end-to-end check first.
# =============================================================================
set -euo pipefail

FS=${1:?usage: lambda-run-valley.sh /lambda/nfs/<filesystem> [--smoke]}
SMOKE=${2:-}

bash "$FS/data-pipeline/scripts/lambda-prep-valley.sh" "$FS"
cd ~/data-pipeline
if [ "$SMOKE" = "--smoke" ]; then
  python3 ml/run-folds.py --plan valley --smoke --out data/model-v3-smoke
  echo "Smoke run finished — check data/model-v3-smoke/results.md, then run without --smoke."
  exit 0
fi
echo "=== Training + grading   [$(date +%H:%M)]"
# Own folder: TrainingRun2 already holds the v2 runs and their results.md
python3 ml/run-folds.py --plan valley --sync-to "$FS/model-v3"
echo "=== All done   [$(date +%H:%M)] — results in $FS/model-v3/runs/results.md; safe to terminate the instance."
