"""
eval-holdout.py — honest generalization score on an unseen region
=================================================================

Loads a trained checkpoint and evaluates it on patches from a region the
model never trained on (e.g. the western yamhill-carlton AVA), using the
SAME patch-level IoU / Dice metric the training script reports.

Key detail: patches are normalized with the ORIGINAL training stats.json
(the eastern stats the model was trained with), NOT freshly-computed western
stats — the model expects inputs on the same scale it learned on.

Evaluates every patch under --patches-dir (both train/ and val/ subdirs),
since none of them were used to train the checkpoint.

Usage
-----
  .venv/bin/python ml/eval-holdout.py \
      --ckpt        ml/checkpoints/unet-resnet34-epepoch=02-iouval_iou=0.773.ckpt \
      --patches-dir data/patches-west-eval \
      --stats       data/patches-osip-2022/stats.json
"""
import argparse, json, glob
from pathlib import Path

import numpy as np
import torch
import torchmetrics
import segmentation_models_pytorch as smp
from torch.utils.data import Dataset, DataLoader


class FlatPatchDataset(Dataset):
    """Every *.npy image under {patches_dir}/{train,val}/images, normalized."""
    def __init__(self, patches_dir: Path, stats: dict):
        self.mean = np.array(stats["mean"], np.float32).reshape(5, 1, 1)
        self.std  = np.array(stats["std"],  np.float32).reshape(5, 1, 1)
        self.files = []
        for split in ("train", "val"):
            d = patches_dir / split / "images"
            self.files += [p for p in sorted(glob.glob(str(d / "*.npy")))
                           if not Path(p).name.startswith("._")]
        if not self.files:
            raise FileNotFoundError(f"No patches under {patches_dir}")

    def __len__(self): return len(self.files)

    def __getitem__(self, i):
        img_path = self.files[i]
        mask_path = img_path.replace("/images/", "/masks/")
        img = np.load(img_path)
        mask = np.load(mask_path)
        img = (img - self.mean) / self.std
        return (torch.from_numpy(img.copy()).float(),
                torch.from_numpy(mask.astype(np.float32)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--patches-dir", required=True)
    ap.add_argument("--stats", required=True,
                    help="stats.json the model was TRAINED with (eastern)")
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    stats = json.load(open(args.stats))
    ds = FlatPatchDataset(Path(args.patches_dir), stats)
    dl = DataLoader(ds, batch_size=args.batch_size, shuffle=False, num_workers=4)
    print(f"Patches to evaluate : {len(ds):,}")

    # Build the same architecture as train.py and load weights.
    model = smp.Unet(encoder_name="resnet34", encoder_weights=None,
                     in_channels=5, classes=1, activation=None)
    raw = torch.load(args.ckpt, map_location="cpu")
    sd = raw["state_dict"] if "state_dict" in raw else raw
    # Lightning prefixes weights with "model." — strip it.
    sd = {k.replace("model.", "", 1): v for k, v in sd.items()
          if k.startswith("model.")}
    missing, unexpected = model.load_state_dict(sd, strict=False)
    if missing:    print(f"  (missing keys: {len(missing)})")
    if unexpected: print(f"  (unexpected keys: {len(unexpected)})")
    model.eval()

    iou  = torchmetrics.JaccardIndex(task="binary", threshold=args.threshold)
    dice = torchmetrics.F1Score(task="binary", threshold=args.threshold)
    # Also track positive-only IoU (patches that actually contain vineyard)
    iou_pos = torchmetrics.JaccardIndex(task="binary", threshold=args.threshold)

    n_done = 0
    with torch.no_grad():
        for imgs, masks in dl:
            logits = model(imgs)
            probs = torch.sigmoid(logits.squeeze(1))
            iou(probs, masks.long())
            dice(probs, masks.int())
            # positive patches only
            has_vine = masks.flatten(1).sum(1) > 0
            if has_vine.any():
                iou_pos(probs[has_vine], masks[has_vine].long())
            n_done += imgs.size(0)
            if n_done % 1280 == 0:
                print(f"  ...{n_done:,}/{len(ds):,}")

    print("\n" + "=" * 50)
    print(f"  HONEST HOLD-OUT SCORE (unseen western region)")
    print(f"  Checkpoint : {Path(args.ckpt).name}")
    print(f"  Patches    : {len(ds):,}")
    print(f"  IoU  (all) : {iou.compute().item():.4f}")
    print(f"  Dice (all) : {dice.compute().item():.4f}")
    print(f"  IoU  (vineyard patches only) : {iou_pos.compute().item():.4f}")
    print("=" * 50)


if __name__ == "__main__":
    main()
