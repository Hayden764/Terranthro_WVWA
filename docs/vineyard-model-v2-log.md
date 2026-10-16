# Vineyard Detection Model v2 — Process Log

A plain-language record of retraining the vineyard detection model on the
hand-traced AVA outlines. Newest entries at the bottom. Technical details
for each step are in the appendix.

## Why retrain

The current model ("0.773") was trained on rough vineyard outlines from the
Chehalem Mountains and Dundee Hills. Its edges come out loose, and every
outline needs hand-tightening in QGIS. Since then we have hand-traced exact
block boundaries for six AVAs across very different landscapes. A model
trained on those should draw tighter edges and handle more kinds of
countryside, which means less hand-correction for the rest of the valley.

## The six training AVAs

Eola-Amity Hills, McMinnville, Mt. Pisgah (Polk County), Van Duzer Corridor,
Lower Long Tom, Tualatin Hills.

Chehalem Mountains, Dundee Hills and Yamhill-Carlton are **left out**. Their
outlines have been cleaned up but are not yet to the same standard.

## Ground rules

- **Only the inside of the official AVA line counts.** Some blocks were
  traced outside the AVA lines, but not all of them, so the area outside is
  incomplete. Anything outside the line is marked "don't grade this" and the
  model is neither rewarded nor penalised there.
- **2022 photos for training.** The tracing was done on 2022 imagery, so
  training uses the same photos.
- **Fair testing.** The model is always graded on an AVA it never saw during
  training.

---

## 2026-10-15 — Photos downloaded

Downloaded the 2022 OSIP aerial photos (30 cm, colour + near-infrared) for
all six AVAs: 1,078 photo tiles, about 72 GB. Checked every tile opens, has
no black or missing areas, and that every part of every AVA is covered.
Result: complete coverage, no gaps. (Last time, download errors left
blacked-out holes in Eola-Amity and McMinnville.)

## 2026-10-15 — Training "flashcards" cut

Cut the photos into 73,678 small squares (256 × 256 pixels, about 78 m
across), each paired with an answer key from the hand tracing: vineyard,
not vineyard, or "outside the AVA, don't grade".

| AVA | Vineyard squares | Non-vineyard squares | …of which dense green (easily confused) |
|---|---|---|---|
| Eola-Amity Hills | 13,775 | 20,662 | 8,309 |
| Van Duzer Corridor | 4,440 | 6,660 | 1,430 |
| Tualatin Hills | 4,162 | 6,243 | 3,529 |
| McMinnville | 2,849 | 4,273 | 2,868 |
| Lower Long Tom | 2,265 | 3,397 | 2,454 |
| Mt. Pisgah | 1,981 | 2,971 | 1,474 |

Eola-Amity has far more vineyard than the others. During training each AVA
is drawn equally often so Eola doesn't dominate what the model learns.

Observation: photo brightness differs between AVAs (Eola-Amity and Van Duzer
are brighter than McMinnville and Lower Long Tom), likely different flight
days. The model is trained with random brightness/colour changes so it
doesn't depend on any one flight's look.

## 2026-10-15 — Test plan decided

Three candidate models will be compared:

- **A — Touch-up:** keep the current model, retrain only its final layers on
  the new outlines.
- **B — Fresh, cautious:** a new model taught only from the new outlines, with
  its general visual knowledge locked.
- **C — Fresh, fully adjustable:** like B, but slowly unlocking that general
  knowledge so it can adapt to vineyard photos. (This is what went wrong last
  time; it is only kept if it actually scores better.)

**Testing method: every AVA takes a turn as the test.** Each candidate is
trained six times, each time hiding a different AVA and grading on it. That
gives every candidate a score in every AVA. The current model is graded on
all six as the baseline to beat (it never saw any of them).

What gets measured:
- **Overlap (IoU):** how well predicted vineyard area matches the tracing.
- **Edge accuracy:** how closely predicted edges follow the traced edges.
- **Missed blocks** and **false alarms** (shapes drawn where there is no
  vineyard). These two are the best guide to how much QGIS clean-up is left.

## 2026-10-15 — Scoring tool and run plan

**Scoring tool built.** For one AVA it compares the model's map with the hand
tracing, inside the AVA line only, and reports overlap, edge accuracy at
1 m and 3 m, missed blocks and false alarms. It also saves the missed blocks
and false alarms as map layers to open in QGIS. A one-tile trial with the
current model on Mt. Pisgah showed edges matching within 3 m 72 % of the
time but within 1 m only 39 % — the loose-edge problem this retraining is
meant to fix.

**Keeping the test honest.** The hidden AVA plays no part in training at all,
not even in choosing which saved version of the model to keep. That choice
is made on a separate 10 % of photo tiles from the training AVAs.

**Running on an 8-GPU machine.** The 18 training runs are independent, so each
GPU runs one at a time from a shared queue: first the current model is
graded on all six AVAs, then candidate A on all six, then B, then C. This
costs the same GPU-hours as one GPU but finishes in about a day instead of
two to three. Re-running the same command after an interruption skips
anything already finished.

Candidate settings:

| | Starts from | Learning | Max rounds (epochs) | Stops early after no gain for |
|---|---|---|---|---|
| A | current model | final layers only, slow | 20 | 5 |
| B | general-purpose starting point | final layers only | 50 | 10 |
| C | general-purpose starting point | all layers, unlocked gradually from round 5 to 20 | 60 | 15 |

## 2026-10-16 — First full run on Lambda (rehearsal)

Ran on an 8-GPU Lambda machine (8× A100 40 GB). Photos were downloaded and
training squares re-cut on the machine itself rather than uploaded; a
300-square spot check showed them pixel-for-pixel identical to the Mac's.
The current model and candidate A finished on all six AVAs; B finished one
before the run was stopped (see next entry).

| AVA | Overlap: current → A | Edges within 1 m: current → A | Missed blocks: current → A | False alarms: current → A |
|---|---|---|---|---|
| Mt. Pisgah | 0.715 → 0.932 | 0.236 → 0.516 | 11 → 1 | 31 → 11 |
| Eola-Amity Hills | 0.739 → 0.900 | 0.234 → 0.606 | 107 → 53 | 268 → 73 |
| Lower Long Tom | 0.633 → 0.870 | 0.123 → 0.393 | 13 → 3 | 112 → 33 |
| McMinnville | 0.731 → 0.788 | 0.204 → 0.444 | 10 → 4 | 68 → 62 |
| Van Duzer | 0.593 → 0.753 | 0.072 → 0.253 | 24 → 1 | 227 → 106 |
| Tualatin Hills | 0.457 → 0.511 | 0.063 → 0.141 | 35 → 10 | 463 → 434 |

Even the simplest new candidate missed far fewer blocks (72 vs 200 of
1,798), drew edges about 2.5× more accurately, and produced 40 % fewer false
alarms. Tualatin Hills remains hard: hundreds of false-alarm shapes in its
large area of non-vineyard farmland and forest.

## 2026-10-16 — Labels switched to the database; run stopped

Comparing the training outlines with the production database showed two
AVAs had drifted. The database holds the latest QGIS edits:

- **McMinnville:** the database has 41 ha of vineyard missing from the
  training file. 34 ha of candidate A's McMinnville "false alarms" were
  these vineyards — the model was right and was marked down.
- **Tualatin Hills:** four vineyards (and one in McMinnville) are stored in
  the database as whole county tax lots rather than traced canopy.

Decision: **the database is the source of truth.** Labels are now a dated
snapshot of the database's traced blocks (2026-10-16, 1,824 blocks). The
five tax-lot polygons are left out of the labels and their areas are marked
"don't grade", like outside the AVA line. Those five vineyards should be
re-traced in the database separately.

The run was stopped so the full comparison can be redone on the corrected
labels. The results above are kept as a rehearsal; they show the method
works, but the final numbers will come from the rerun.

**Paused until the week of 2026-10-19.** To resume: start an 8-GPU instance
with the `ModelTrainingOutput` filesystem attached, run `lambda-prep.sh`
(downloads the photos and cuts the new training squares, ~1 hour), the smoke
test, then the full run.

---

## Appendix — technical details

**Imagery.** OSIP 2022 `_SL` ImageServer, 4-band RGBN, 0.3048 m, EPSG:32610,
4096 px tiles. Download extent = the six official AVA outlines
(`data/training/gold6-avas.geojson`, from `data/ava/oregon_avas.geojson`).
Tiles in `data-pipeline/data/osip-2022-gold6/`. `download-osip.py` was fixed
to select tiles by true geometry rather than bounding box (1,803 → 1,078
tiles).

**Labels.** Since 2026-10-16: `data-pipeline/data/BlocksDB-2026-10-16/`,
exported read-only from production `vineyard_blocks` by
`scripts/export-db-labels.py` — one `.gpkg` per AVA (every source except
`tax-lot`) plus `regions.geojson`, the graded area per AVA (official outline
minus tax-lot polygons: ids 7813, 7955, 9330, 9347 in Tualatin Hills, 9574 in
McMinnville). `regions.geojson` is passed as `--avas` to the cutter, predictor
and scorer. Clipped to the graded area at cut time; no inward erosion
(tracing was done on OSIP itself). The rehearsal run used the June files in
`data/BlocksUpdated/` (`Edited_Eola.gpkg`, `Edited_Mac.gpkg`,
`Edit_Mount_Pisgah.gpkg`, `Clipped_vanduzer.gpkg`,
`Lower_long_tom_edited.gpkg`, `clipped_tualatinHills.gpkg`).

**Lambda filesystem (`ModelTrainingOutput`).** `data-pipeline/` (code,
labels, 0.773 model), `rehearsal-old-labels/` (rehearsal results,
checkpoints, `results.md`), and `data-pipeline/data/patches-gold6-2022.tar`
(the rehearsal's training squares, built from the old labels — obsolete).

**Patches.** `scripts/cut-patches-ava.py` → `data-pipeline/data/patches-gold6-2022/`.
One `.npz` per patch (`img` uint8 4×256×256 RGBN, `mask` uint8 0/1/255),
grouped in one folder per tile (exFAT slows badly with tens of thousands of
files in one folder). Positives: ≥5 % vineyard of in-AVA pixels, stride 128.
Negatives: non-overlapping, 1.5 per positive per AVA, from every tile in the
AVA. "Hard negative" = mean NDVI ≥ 0.35. Patches must be ≥50 % inside the
AVA. `manifest.json` tags each patch with its AVA; `ava_stats.json` holds
per-AVA channel sums so normalisation is computed from training AVAs only.

**Training.** `ml/train.py --ava-patches-dir … --holdout-ava "<AVA>" --run-name …`.
U-Net ResNet34, 5 channels (RGBN + NDVI computed in the loader), Dice + Focal
loss, both ignoring mask value 255. AVA-balanced sampling by default.
Checkpoint selection on 10 % of training-AVA tiles (`--val-tile-frac`, fixed
seed, ~6,200 patches). Normalisation stats from the training AVAs, written to
`ml/checkpoints/<run>/stats.json`; candidate A uses the 0.773 model's own
`data/patches-osip-2022/stats.json` (`--stats`).

**Scoring.** `ml/score-ava.py` on `predict.py --avas … --ava … --prob-dtype uint8`
output. Threshold 0.5; block-level scores after the production clean-up
(fill holes, 3 m closing, 1,000 m² minimum). A traced block is "missed" if
under 50 % of it is predicted; a predicted shape is a "false alarm" if under
20 % of it is traced vineyard.

**Runs.** `ml/run-folds.py` — job queue over all GPUs (`nvidia-smi`), one job
per GPU, resumable (skips jobs with `score/score.json`). Output in
`data/model-v2-runs/<job>/`, summary in `results.csv` / `results.md`.
`--smoke` runs every step with 3 batches and 1 tile. On macOS, dataloader
workers leave `torch_shm_manager` daemons that stop `train.py` exiting, so
local CPU runs use `--num-workers 0`.
