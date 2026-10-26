"""
run-folds.py — Run the model v2 comparison across every GPU on the machine
===========================================================================

Builds the job list and keeps every GPU busy with one job at a time.
Candidates: A = 0.773 model, decoder retrained (encoder frozen), own stats;
B = fresh model, encoder frozen; C = fresh model, encoder gradually unfrozen.

--plan pair (default, the simplified comparison) — Van Duzer Corridor and
Lower Long Tom are both held out of training and graded:

  baseline-pair         the current 0.773 model, predicted + scored on both
  A-pair, B-pair, C-pair  trained once on the other four AVAs, scored on both

--plan six (full leave-one-AVA-out) — every AVA takes a turn as the test:

  baseline-<ava>        the current 0.773 model, predicted + scored on each AVA
  {A,B,C}-holdout-<ava> trained with that AVA held out, scored on it

--final A|B|C trains that candidate on all six AVAs (the production model;
nothing is left to score it on) instead of running a comparison.

Each training job predicts its held-out AVA(s) with its best checkpoint and
scores them with score-ava.py.  Finished jobs (every score.json present, or a
final job's checkpoint) are skipped, so re-running the same command after a
crash or a stop picks up where it left off.

Output per job:  <out>/<job>/train.log
                 <out>/<job>/<ava>/{predict.log, score.log, predictions/, score/}
Checkpoints:     ml/checkpoints/<job>/
Summary:         <out>/results.csv and <out>/results.md   (also via --summarize)
With --sync-to DIR, each finished job (results + checkpoints) and the summary
are copied to DIR right away — e.g. a persistent Lambda filesystem, so nothing
is lost if the instance goes away mid-run.

Usage (on the GPU machine, from data-pipeline/)
-----
  .venv/bin/python ml/run-folds.py --dry-run          # show the plan
  .venv/bin/python ml/run-folds.py --smoke            # 3-batch, 1-tile run of everything
  .venv/bin/python ml/run-folds.py                    # the real thing, all GPUs
  .venv/bin/python ml/run-folds.py --only '^A-'       # just candidate A
  .venv/bin/python ml/run-folds.py --plan six         # full leave-one-AVA-out
  .venv/bin/python ml/run-folds.py --final B          # winner, trained on all six
  .venv/bin/python ml/run-folds.py --summarize        # rebuild the results table
"""

import argparse
import csv
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ML = Path(__file__).resolve().parent
ROOT = ML.parent

# Hand-traced blocks snapshotted from the production database by
# scripts/export-db-labels.py; regions.geojson is the graded area per AVA
# (AVA outline minus loose tax-lot polygons)
LABEL_DIR = "data/BlocksDB-2026-10-16"
LABELS = {
    "Eola-Amity Hills": f"{LABEL_DIR}/eola-amity-hills.gpkg",
    "McMinnville": f"{LABEL_DIR}/mcminnville.gpkg",
    "Mt. Pisgah Polk County Oregon": f"{LABEL_DIR}/mt-pisgah.gpkg",
    "Van Duzer Corridor": f"{LABEL_DIR}/van-duzer-corridor.gpkg",
    "Lower Long Tom": f"{LABEL_DIR}/lower-long-tom.gpkg",
    "Tualatin Hills": f"{LABEL_DIR}/tualatin-hills.gpkg",
}
BASELINE_CKPT = "ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt"
BASELINE_STATS = "data/patches-osip-2022/stats.json"
PAIR = ["Van Duzer Corridor", "Lower Long Tom"]   # hilly + windy, flat valley floor
NEVER = "100000"   # an unfreeze epoch that never arrives = encoder stays frozen

# Training settings per candidate (extra train.py arguments)
CANDIDATES = {
    "A": ["--ckpt", BASELINE_CKPT, "--weights-only", "--stats", BASELINE_STATS,
          "--unfreeze-start", NEVER, "--lr", "3e-5", "--epochs", "20", "--patience", "5"],
    "B": ["--unfreeze-start", NEVER, "--lr", "1e-4", "--epochs", "50", "--patience", "10"],
    "C": ["--unfreeze-start", "5", "--unfreeze-interval", "5", "--lr", "1e-4",
          "--epochs", "60", "--patience", "15"],
}


def slug(ava: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", ava.lower().replace("polk county oregon", "")).strip("-")


def build_jobs(plan, final=None):
    """Each job: held-out AVAs (left out of training) = the AVAs it is scored on."""
    if final:
        return [{"name": f"final-{final}", "avas": [], "kind": "train", "cand": final}]
    if plan == "pair":
        jobs = [{"name": "baseline-pair", "avas": PAIR, "kind": "baseline"}]
        jobs += [{"name": f"{c}-pair", "avas": PAIR, "kind": "train", "cand": c}
                 for c in CANDIDATES]
        return jobs
    jobs = [{"name": f"baseline-{slug(a)}", "avas": [a], "kind": "baseline"} for a in LABELS]
    for cand in CANDIDATES:
        jobs += [{"name": f"{cand}-holdout-{slug(a)}", "avas": [a], "kind": "train", "cand": cand}
                 for a in LABELS]
    return jobs


def is_done(job, out_root: Path) -> bool:
    out = out_root / job["name"]
    if not job["avas"]:
        return (out / "final.json").exists()
    return all((out / slug(a) / "score" / "score.json").exists() for a in job["avas"])


def best_checkpoint(ckpt_dir: Path) -> Path:
    scored = []
    for p in ckpt_dir.glob("*.ckpt"):
        m = re.search(r"val_iou=(\d+\.\d+)\.ckpt$", p.name)
        if m and not p.name.startswith("._"):
            scored.append((float(m.group(1)), p))
    if not scored:
        raise RuntimeError(f"no checkpoint in {ckpt_dir}")
    return max(scored)[1]


def run_step(cmd, log: Path, env) -> None:
    with open(log, "w") as f:
        f.write("$ " + " ".join(cmd) + "\n\n")
        f.flush()
        rc = subprocess.run(cmd, cwd=ROOT, env=env, stdout=f, stderr=subprocess.STDOUT).returncode
    if rc:
        raise RuntimeError(f"exit {rc} — see {log}")


def run_job(job, gpu, args, workers):
    out = Path(args.out) / job["name"]
    out.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, CUDA_VISIBLE_DEVICES="" if gpu is None else str(gpu))
    py = sys.executable
    smoke_predict = ["--max-tiles", "1"] if args.smoke else []

    if job["kind"] == "baseline":
        ckpt, stats = ROOT / BASELINE_CKPT, ROOT / BASELINE_STATS
    else:
        ckpt_dir = ML / "checkpoints" / job["name"]
        shutil.rmtree(ckpt_dir, ignore_errors=True)   # never pick up a stale run's checkpoint
        holdout = [x for a in job["avas"] for x in ("--holdout-ava", a)] or ["--no-holdout"]
        train = [py, "ml/train.py", "--ava-patches-dir", args.patches, *holdout,
                 "--run-name", job["name"],
                 "--batch-size", str(args.batch_size), "--num-workers", str(workers),
                 *CANDIDATES[job["cand"]]]
        if args.smoke:
            train += ["--limit-batches", "3", "--epochs", "1"]
        run_step(train, out / "train.log", env)
        ckpt, stats = best_checkpoint(ckpt_dir), ckpt_dir / "stats.json"
        if not job["avas"]:
            (out / "final.json").write_text(json.dumps(
                {"candidate": job["cand"], "ckpt": str(ckpt.relative_to(ROOT)),
                 "stats": str(stats.relative_to(ROOT))}, indent=2))

    for ava in job["avas"]:
        ava_out = out / slug(ava)
        ava_out.mkdir(exist_ok=True)
        pred_dir = ava_out / "predictions"
        shutil.rmtree(pred_dir, ignore_errors=True)
        run_step([py, "ml/predict.py", "--ckpt", str(ckpt), "--stats", str(stats),
                  "--osip-dir", args.tiles, "--out-dir", str(pred_dir),
                  "--avas", args.avas, "--ava", ava, "--prob-dtype", "uint8",
                  *smoke_predict], ava_out / "predict.log", env)
        run_step([py, "ml/score-ava.py", "--pred-dir", str(pred_dir), "--avas", args.avas,
                  "--ava", ava, "--labels", LABELS[ava],
                  "--out-dir", str(ava_out / "score")], ava_out / "score.log", env)
        if not args.keep_predictions:
            shutil.rmtree(pred_dir, ignore_errors=True)
    if args.sync_to:
        dest = Path(args.sync_to)
        shutil.copytree(out, dest / "runs" / job["name"], dirs_exist_ok=True)
        if job["kind"] == "train":
            shutil.copytree(ckpt_dir, dest / "checkpoints" / job["name"], dirs_exist_ok=True)


def summarize(out_root: Path):
    rows = []
    for score in sorted(out_root.glob("*/*/score/score.json")):
        r = json.loads(score.read_text())
        name = score.parent.parent.parent.name
        rows.append({
            "job": name, "candidate": name.split("-")[0], "ava": r["ava"],
            "coverage": r["ava_coverage"], "iou": r["pixels"]["iou"],
            "precision": r["pixels"]["precision"], "recall": r["pixels"]["recall"],
            "edge_f1_1m": r["edges"]["1m"]["f1"], "edge_f1_3m": r["edges"]["3m"]["f1"],
            "blocks": r["blocks"]["traced"], "missed": r["blocks"]["missed"],
            "missed_ha": r["blocks"]["missed_ha"], "shapes": r["blocks"]["predicted_shapes"],
            "false_alarms": r["blocks"]["false_alarms"],
            "false_alarm_ha": r["blocks"]["false_alarm_ha"],
        })
    if not rows:
        print("No scores yet.")
        return
    with open(out_root / "results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    lines = ["| Candidate | AVA | IoU | Edge F1 1 m | Edge F1 3 m | Missed blocks | False alarms |",
             "|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (r["candidate"], r["ava"])):
        lines.append(f"| {r['candidate']} | {r['ava']} | {r['iou']:.3f} | {r['edge_f1_1m']:.3f} | "
                     f"{r['edge_f1_3m']:.3f} | {r['missed']} / {r['blocks']} | "
                     f"{r['false_alarms']} ({r['false_alarm_ha']} ha) |")
    lines += ["", "| Candidate | AVAs scored | Mean IoU | Mean edge F1 1 m | Missed blocks | False alarms |",
              "|---|---|---|---|---|---|"]
    for cand in sorted({r["candidate"] for r in rows}):
        rs = [r for r in rows if r["candidate"] == cand]
        lines.append(f"| {cand} | {len(rs)} | {sum(r['iou'] for r in rs) / len(rs):.3f} | "
                     f"{sum(r['edge_f1_1m'] for r in rs) / len(rs):.3f} | "
                     f"{sum(r['missed'] for r in rs)} / {sum(r['blocks'] for r in rs)} | "
                     f"{sum(r['false_alarms'] for r in rs)} |")
    (out_root / "results.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


def detect_gpus():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=index", "--format=csv,noheader"],
                             capture_output=True, text=True, check=True).stdout
        return [int(x) for x in out.split()]
    except (OSError, subprocess.CalledProcessError):
        return []


def main():
    ap = argparse.ArgumentParser(description="Run the model v2 comparison on all GPUs")
    ap.add_argument("--patches", default="data/patches-gold6-db-2022")
    ap.add_argument("--tiles", default="data/osip-2022-gold6")
    ap.add_argument("--avas", default=f"{LABEL_DIR}/regions.geojson")
    ap.add_argument("--out", default="data/model-v2-runs")
    ap.add_argument("--plan", choices=["pair", "six"], default="pair",
                    help="pair: hold out Van Duzer + Lower Long Tom together; "
                         "six: full leave-one-AVA-out")
    ap.add_argument("--final", choices=list(CANDIDATES), default=None,
                    help="Train this candidate on all six AVAs instead of comparing")
    ap.add_argument("--gpus", default=None,
                    help="Comma-separated GPU ids  [default: every GPU nvidia-smi lists]")
    ap.add_argument("--cpu-slots", type=int, default=1,
                    help="Parallel jobs when there is no GPU (local testing)")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--only", default=None, help="Regex on job names, e.g. '^B-' or 'van-duzer'")
    ap.add_argument("--smoke", action="store_true", help="3 batches, 1 epoch, 1 tile per job")
    ap.add_argument("--keep-predictions", action="store_true",
                    help="Keep probability maps (uint8, ~10 MB/tile) after scoring")
    ap.add_argument("--sync-to", default=None,
                    help="Copy each finished job's results + checkpoints here (persistent storage)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--summarize", action="store_true")
    args = ap.parse_args()

    out_root = ROOT / args.out
    if args.summarize:
        summarize(out_root)
        return

    jobs = build_jobs(args.plan, args.final)
    if args.only:
        jobs = [j for j in jobs if re.search(args.only, j["name"])]
    todo = [j for j in jobs if not is_done(j, out_root)]

    gpus = [int(g) for g in args.gpus.split(",")] if args.gpus else detect_gpus()
    slots = gpus or [None] * args.cpu_slots
    workers = max(1, (os.cpu_count() or 2) // len(slots) - 1)
    if not gpus and sys.platform == "darwin":
        # macOS dataloader workers leave torch_shm_manager daemons holding the
        # multiprocessing resource-tracker pipe open, so train.py never exits
        workers = 0

    print(f"Jobs: {len(jobs)} total, {len(jobs) - len(todo)} already scored, {len(todo)} to run")
    print(f"Slots: {'GPUs ' + ','.join(map(str, gpus)) if gpus else f'{len(slots)} CPU'}"
          f"   dataloader workers per job: {workers}")
    for j in todo:
        print(f"  {j['name']}")
    if args.dry_run or not todo:
        return

    out_root.mkdir(parents=True, exist_ok=True)
    q = queue.Queue()
    for j in todo:
        q.put(j)
    status, lock = {}, threading.Lock()
    status_path = out_root / "status.json"

    def record(name, **kw):
        with lock:
            status[name] = {**status.get(name, {}), **kw}
            status_path.write_text(json.dumps(status, indent=2))

    def worker(gpu):
        while True:
            try:
                job = q.get_nowait()
            except queue.Empty:
                return
            t0 = time.time()
            record(job["name"], state="running", gpu=gpu, started=time.strftime("%H:%M:%S"))
            print(f"[{time.strftime('%H:%M:%S')}] gpu {gpu}: start {job['name']}", flush=True)
            try:
                run_job(job, gpu, args, workers)
                state = "done"
            except Exception as exc:
                state = f"failed: {exc}"
            mins = (time.time() - t0) / 60
            record(job["name"], state=state, minutes=round(mins, 1))
            print(f"[{time.strftime('%H:%M:%S')}] gpu {gpu}: {state} {job['name']} ({mins:.0f} min)",
                  flush=True)

    threads = [threading.Thread(target=worker, args=(g,)) for g in slots]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    failed = [n for n, s in status.items() if s["state"] != "done"]
    print(f"\nFinished. {len(status) - len(failed)} done, {len(failed)} failed.")
    for n in failed:
        print(f"  {n}: {status[n]['state']}")
    summarize(out_root)
    if args.sync_to:
        for name in ("results.csv", "results.md", "status.json"):
            if (out_root / name).exists():
                (Path(args.sync_to) / "runs").mkdir(parents=True, exist_ok=True)
                shutil.copy2(out_root / name, Path(args.sync_to) / "runs" / name)


if __name__ == "__main__":
    main()
