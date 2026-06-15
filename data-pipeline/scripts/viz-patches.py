"""
viz-patches.py — montage of positive & negative training patches
=================================================================
Samples patches, classifies each by its mask (positive = has vineyard px,
negative = none), and renders a grid:

  - Positive patches : RGB with the vineyard mask outlined/tinted in red,
                       plus the matching NDVI panel.
  - Negative patches : RGB only, labeled background vs hard-negative
                       (high mean NDVI = green stuff that is NOT vineyard).

Stored patches are (5,256,256) float32: RGB in [0,1], NIR [0,1], NDVI [-1,1].
"""
import argparse, glob, random
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load(img_path):
    img = np.load(img_path)
    mask = np.load(img_path.replace("/images/", "/masks/"))
    return img, mask


def rgb(img):
    return np.clip(np.transpose(img[:3], (1, 2, 0)), 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--patches-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-pos", type=int, default=8)
    ap.add_argument("--n-neg", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    pd = Path(args.patches_dir)
    files = []
    for split in ("train", "val"):
        files += [p for p in glob.glob(str(pd / split / "images" / "*.npy"))
                  if not Path(p).name.startswith("._")]
    rng.shuffle(files)

    pos, neg = [], []
    for f in files:
        if len(pos) >= args.n_pos and len(neg) >= args.n_neg:
            break
        img, mask = load(f)
        vp = float(mask.mean())
        if vp > 0 and len(pos) < args.n_pos:
            pos.append((img, mask, vp))
        elif vp == 0 and len(neg) < args.n_neg:
            neg.append((img, mask, float(img[4].mean())))

    # Layout: positives take 2 columns each (RGB+mask | NDVI); negatives 1 col.
    ncol = 4
    pos_rows = (args.n_pos + ncol - 1) // ncol
    neg_rows = (args.n_neg + ncol - 1) // ncol
    nrows = pos_rows + neg_rows + 2  # +2 for section header rows
    fig, axes = plt.subplots(nrows, ncol, figsize=(ncol * 3, nrows * 3))
    for a in axes.ravel():
        a.axis("off")

    def header(r, text, color):
        axes[r, 0].text(0, 0.5, text, fontsize=15, fontweight="bold",
                        color=color, transform=axes[r, 0].transAxes)

    header(0, "POSITIVE PATCHES  (RGB + vineyard mask in red)", "darkred")
    for i, (img, mask, vp) in enumerate(pos):
        r = 1 + i // ncol
        c = i % ncol
        ax = axes[r, c]; ax.axis("on"); ax.set_xticks([]); ax.set_yticks([])
        base = rgb(img).copy()
        overlay = base.copy()
        overlay[mask > 0] = overlay[mask > 0] * 0.45 + np.array([1, 0, 0]) * 0.55
        ax.imshow(overlay)
        ax.set_title(f"vineyard {vp*100:.0f}%", fontsize=10)

    hr = 1 + pos_rows
    header(hr, "NEGATIVE PATCHES  (no vineyard label)", "navy")
    for i, (img, mask, ndvi_mean) in enumerate(neg):
        r = hr + 1 + i // ncol
        c = i % ncol
        ax = axes[r, c]; ax.axis("on"); ax.set_xticks([]); ax.set_yticks([])
        ax.imshow(rgb(img))
        kind = "hard-neg" if ndvi_mean >= 0.35 else "background"
        ax.set_title(f"{kind}  ndvi={ndvi_mean:+.2f}", fontsize=10)

    plt.tight_layout()
    fig.savefig(args.out, dpi=110, bbox_inches="tight")
    print(f"pos shown: {len(pos)}  neg shown: {len(neg)}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
