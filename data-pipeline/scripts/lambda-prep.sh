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
#   4. re-cut the training patches (73,678) — the cutter is deterministic, so
#      this reproduces the Mac's patch set; the manifest fingerprint is checked
#      against the Mac's and per-AVA counts shown if newer libraries differ
# Safe to re-run: downloads skip existing tiles; the cut is skipped if the
# patch set is already there and matches.
#
#   bash /lambda/nfs/<filesystem>/data-pipeline/scripts/lambda-prep.sh /lambda/nfs/<filesystem>
# =============================================================================
set -euo pipefail

FS=${1:?usage: lambda-prep.sh /lambda/nfs/<filesystem>}
WORK=~/data-pipeline
MANIFEST_SHA=f10d9043c554f075d7dfc62f14d770ecaa92631978b01d1e6254f96d7355ac09

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
if [ -f data/patches-gold6-2022/manifest.json ] && \
   echo "$MANIFEST_SHA  data/patches-gold6-2022/manifest.json" | sha256sum -c --quiet 2>/dev/null; then
  echo "Patch set already there and matches — skipping."
else
  rm -rf data/patches-gold6-2022
  python3 scripts/cut-patches-ava.py --tiles-dir data/osip-2022-gold6 \
    --avas data/training/gold6-avas.geojson --out data/patches-gold6-2022 \
    --label "Eola-Amity Hills=data/BlocksUpdated/Edited_Eola.gpkg" \
    --label "McMinnville=data/BlocksUpdated/Edited_Mac.gpkg" \
    --label "Mt. Pisgah Polk County Oregon=data/BlocksUpdated/Edit_Mount_Pisgah.gpkg" \
    --label "Van Duzer Corridor=data/BlocksUpdated/Clipped_vanduzer.gpkg" \
    --label "Lower Long Tom=data/BlocksUpdated/Lower_long_tom_edited.gpkg" \
    --label "Tualatin Hills=data/BlocksUpdated/clipped_tualatinHills.gpkg"
  if echo "$MANIFEST_SHA  data/patches-gold6-2022/manifest.json" | sha256sum -c --quiet 2>/dev/null; then
    echo "Patch set matches the Mac's exactly."
  else
    # Newer geometry libraries can shift a boundary pixel or two; that's fine
    # for training, but show the counts so they can be compared with the Mac's
    # (Mac: 73,678 patches; positives Eola 13,775, Van Duzer 4,440,
    #  Tualatin 4,162, McMinnville 2,849, Lower Long Tom 2,265, Mt. Pisgah 1,981)
    echo "NOTE: patch manifest differs slightly from the Mac's. Counts here:"
    python3 -c "import json,collections as c; m=json.load(open('data/patches-gold6-2022/manifest.json')); print(len(m),'patches'); [print(f'  {a:32s} positives {n}') for a,n in sorted(c.Counter(x['ava'] for x in m if x['kind']=='positive').items())]"
  fi
fi

nvidia-smi --query-gpu=index,name,memory.total --format=csv
echo
echo "Ready. Next:"
echo "  cd $WORK"
echo "  python3 ml/run-folds.py --smoke --out data/model-v2-smoke"
