"""
VineyardDataset — PyTorch Dataset + LightningDataModule
========================================================

Loads 256×256 five-channel NAIP patches (.npy) and binary vineyard masks
(.npy) produced by cut-patches.py, normalises each channel using the
per-channel mean/std from stats.json, and applies geometric + spectral
data augmentation during training.

Channel layout  (axis 0 in each image .npy):
  0  Red    float32  [0, 1]  before normalisation
  1  Green  float32  [0, 1]
  2  Blue   float32  [0, 1]
  3  NIR    float32  [0, 1]
  4  NDVI   float32  [-1, 1]

Augmentation strategy (training split only)
--------------------------------------------
  Geometric — applied identically to image AND mask:
    HorizontalFlip, VerticalFlip, RandomRotate90
    Justified: NAIP tiles have no canonical orientation; a vineyard
    looks the same from every compass direction.

  Spectral  — applied to RGB channels 0-2 ONLY:
    Brightness / contrast / saturation jitter
    Justified: visible-band brightness varies with sun angle, haze, and
    sensor gain.  NIR and NDVI are left unchanged — they are physically
    meaningful indices whose range is constrained by vegetation
    biophysics, not atmospheric effects.

Normalisation
-------------
  z = (x - mean) / std  per channel, using the stats computed by
  cut-patches.py over all training patches.  Applied AFTER augmentation
  so the augmented values are also normalised.
"""

import json
from pathlib import Path
from typing import Optional, Tuple

import albumentations as A
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
import lightning as L


class VineyardDataset(Dataset):
    """
    One sample = (image_tensor, mask_tensor).

    image_tensor — (5, 256, 256) float32, normalised
    mask_tensor  — (256, 256)    float32, values 0.0 or 1.0
    """

    def __init__(
        self,
        patches_dir: Path,
        split: str,          # "train" or "val"
        stats: dict,         # contents of stats.json
        augment: bool = False,
    ):
        self.img_dir  = patches_dir / split / "images"
        self.mask_dir = patches_dir / split / "masks"
        self.augment  = augment

        # Normalisation constants — reshaped to (5, 1, 1) so numpy
        # broadcasting applies them channel-wise to (5, H, W) arrays.
        self.mean = np.array(stats["mean"], dtype=np.float32).reshape(5, 1, 1)
        self.std  = np.array(stats["std"],  dtype=np.float32).reshape(5, 1, 1)

        # File list — filter out macOS ._* resource-fork sidecar files
        self.files = sorted(
            p.name for p in self.img_dir.glob("*.npy")
            if not p.name.startswith("._")
        )
        if not self.files:
            raise FileNotFoundError(
                f"No .npy patches found in {self.img_dir}. "
                "Did you run cut-patches.py first?"
            )

        # ── Augmentation pipelines ──────────────────────────────────────────
        # albumentations works in HWC format; we transpose before/after.
        # geo_aug is applied to image + mask together (same spatial transform).
        self.geo_aug = A.Compose([
            A.HorizontalFlip(p=0.5),
            A.VerticalFlip(p=0.5),
            A.RandomRotate90(p=0.5),
        ])

        # rgb_aug is applied only to the first 3 channels.
        self.rgb_aug = A.Compose([
            A.ColorJitter(
                brightness=0.2,
                contrast=0.2,
                saturation=0.1,
                hue=0.03,
                p=0.4,
            ),
        ])

    def __len__(self) -> int:
        return len(self.files)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        fname = self.files[idx]

        # Load from disk — (5, H, W) float32 and (H, W) uint8
        img  = np.load(self.img_dir  / fname)
        mask = np.load(self.mask_dir / fname)

        # ── Augmentation (training only) ──────────────────────────────────
        if self.augment:
            # albumentations expects HWC format → transpose temporarily
            img_hwc = img.transpose(1, 2, 0)   # (H, W, 5)

            # 1. Geometric: flip / rotate image AND mask together.
            #    The same spatial transform is applied to both, keeping
            #    pixels and labels aligned.
            out = self.geo_aug(image=img_hwc, mask=mask)
            img_hwc, mask = out["image"], out["mask"]

            # 2. Spectral: colour jitter on RGB only.
            #    Split the 5 channels, jitter RGB, leave NIR+NDVI untouched.
            rgb      = img_hwc[:, :, :3]    # (H, W, 3)  visible
            spectral = img_hwc[:, :, 3:]    # (H, W, 2)  NIR + NDVI

            rgb = self.rgb_aug(image=rgb)["image"]

            # Recombine and transpose back to (5, H, W)
            img = np.concatenate([rgb, spectral], axis=2).transpose(2, 0, 1)

        # ── Normalise: (x - mean) / std ───────────────────────────────────
        img = (img - self.mean) / self.std   # (5, H, W) float32

        # ── Convert to PyTorch tensors ────────────────────────────────────
        img_t  = torch.from_numpy(img.copy()).float()
        mask_t = torch.from_numpy(mask.astype(np.float32))   # 0.0 / 1.0

        return img_t, mask_t


class VineyardDataModule(L.LightningDataModule):
    """
    Lightning DataModule — wraps train + val datasets and creates
    DataLoaders.  Centralises all data-loading config in one place.

    Separating the data logic here means train.py never has to know
    where files live or how normalisation works.
    """

    def __init__(
        self,
        patches_dir: Path,
        stats_path: Path,
        batch_size: int = 16,
        num_workers: int = 0,    # 0 = load in main process (safe on macOS)
    ):
        super().__init__()
        self.patches_dir = patches_dir
        self.stats_path  = stats_path
        self.batch_size  = batch_size
        self.num_workers = num_workers

    def setup(self, stage: Optional[str] = None):
        """Called by Lightning before train/val loops begin."""
        with open(self.stats_path) as f:
            stats = json.load(f)

        self.train_ds = VineyardDataset(
            self.patches_dir, split="train", stats=stats, augment=True
        )
        self.val_ds = VineyardDataset(
            self.patches_dir, split="val", stats=stats, augment=False
        )

    def train_dataloader(self) -> DataLoader:
        return DataLoader(
            self.train_ds,
            batch_size=self.batch_size,
            shuffle=True,         # new random order every epoch
            num_workers=self.num_workers,
            pin_memory=True,      # faster CPU→GPU transfer
            drop_last=True,       # avoid 1-sample batches that break BatchNorm
            persistent_workers=(self.num_workers > 0),
        )

    def val_dataloader(self) -> DataLoader:
        return DataLoader(
            self.val_ds,
            batch_size=self.batch_size,
            shuffle=False,        # deterministic val pass
            num_workers=self.num_workers,
            pin_memory=True,
            persistent_workers=(self.num_workers > 0),
        )
