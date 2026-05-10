"""
U-Net Vineyard Segmentation — Training Script
==============================================

Architecture
------------
U-Net (Ronneberger et al. 2015) with a ResNet34 encoder.

  Encoder  — ResNet34 pretrained on ImageNet.
    Stacked residual blocks progressively downsample the 256×256 input:
      256→128→64→32→16→8 px, each level doubling the feature-map depth.
    The deepest (8×8) representation captures the most semantic meaning:
    "is this a dense, regularly-spaced row crop?"
    Pretrained ImageNet weights give a huge head-start over random init.

    5-channel adaptation (RGBNIR+NDVI → ResNet34 expects 3 channels):
    segmentation-models-pytorch inflates the pretrained conv1 kernel
    (64, 3, 7, 7) → averages to (64, 1, 7, 7) → tiles to (64, 5, 7, 7),
    scaled by 3/5 so the activation magnitudes stay similar.
    NIR and NDVI get sensible starting weights, not random noise.

  Decoder  — U-Net expanding path with skip connections.
    At each upsampling step the decoder concatenates a skip connection
    from the matching encoder level.  This fuses:
      • Semantic context from deep layers ("vineyard vs orchard")
      • Fine spatial detail from shallow layers ("exact boundary location")
    Without skip connections: blurry, imprecise boundaries.
    With them: crisp pixel-accurate delineation.

Loss Functions
--------------
  total_loss = Dice + Focal   (equal weight)

  Dice Loss — optimises 2·TP / (2·TP + FP + FN) directly.
    Handles extreme class imbalance: vineyards are <2% of any tile.
    A model predicting "all background" achieves 98% accuracy but 0% Dice.
    Dice loss refuses to reward that lazy solution.

  Focal Loss — modified binary cross-entropy with γ=2 (default).
    Down-weights easy examples (model already predicts confidently).
    Pixels the model has "figured out" contribute little to the gradient.
    Hard pixels — block edges, shadowed canopy, partial cover — dominate.
    Complements Dice by sharpening boundary predictions.

Primary Metric: IoU (Intersection over Union / Jaccard index)
  IoU = TP / (TP + FP + FN)
  Of all pixels that are vineyard in *either* prediction or label,
  what fraction are vineyard in *both*?
  0.0 = no overlap at all.  1.0 = perfect.
  0.65+ = good for agricultural parcel segmentation.  0.75+ = strong.
  Used for early stopping and checkpoint selection.

Optimiser & Schedule
--------------------
  AdamW with cosine annealing LR.
  AdamW = Adam + decoupled weight decay (better regularisation).
  CosineAnnealingLR smoothly decays LR from base_lr → eta_min over
  T_max epochs.  Helps the model escape shallow local minima in later
  epochs without aggressive step-decay.

Hardware
--------
  Trainer(accelerator="auto") detects in priority order:
    CUDA GPU  → fastest (~5-10 min / epoch)
    MPS (Apple Silicon M-series) → medium (~20-40 min / epoch)
    CPU       → slow but works (~2-4 hr / epoch on 16-core)

Usage
-----
  # From data-pipeline/ directory:
  .venv/bin/python ml/train.py

  # Resume from checkpoint:
  .venv/bin/python ml/train.py --ckpt ml/checkpoints/unet-...ckpt
"""

import argparse
import sys
from pathlib import Path

# Allow `from dataset import ...` when run as `python ml/train.py`
sys.path.insert(0, str(Path(__file__).resolve().parent))

import torch
import torchmetrics
import segmentation_models_pytorch as smp
import lightning as L
from lightning.pytorch.callbacks import (
    EarlyStopping,
    ModelCheckpoint,
    LearningRateMonitor,
)
from lightning.pytorch.loggers import CSVLogger

from dataset import VineyardDataModule


# ---------------------------------------------------------------------------
# Lightning Module — model + training logic
# ---------------------------------------------------------------------------

class VineyardSegModel(L.LightningModule):
    """
    Wraps the U-Net in Lightning's Module pattern, which separates:
      1. Model architecture       → __init__
      2. Forward pass             → forward
      3. Train / val step logic   → training_step, validation_step
      4. Optimiser configuration  → configure_optimizers

    Lightning handles the training loop, device placement, gradient
    accumulation, logging, and checkpointing — we just define the logic.
    """

    def __init__(
        self,
        lr: float = 3e-4,
        weight_decay: float = 1e-4,
        t_max: int = 60,
        freeze_encoder_epochs: int = 5,
    ):
        super().__init__()
        self.save_hyperparameters()   # saves all hparams to ckpt

        # ── U-Net model ──────────────────────────────────────────────────────
        # encoder_name  : which CNN backbone to use as the encoder
        # encoder_weights: "imagenet" → use pretrained weights (then inflate)
        # in_channels   : 5 (R, G, B, NIR, NDVI)
        # classes       : 1 output channel (binary mask probability)
        # activation    : None → we get raw logits; sigmoid applied manually
        #                 so the loss functions can use numerically stable
        #                 log-sum-exp tricks internally
        self.model = smp.Unet(
            encoder_name="resnet34",
            encoder_weights="imagenet",
            in_channels=5,
            classes=1,
            activation=None,
        )

        # ── Loss functions ───────────────────────────────────────────────────
        # from_logits=True: DiceLoss applies sigmoid internally (more stable)
        self.dice_loss  = smp.losses.DiceLoss(mode="binary", from_logits=True)
        self.focal_loss = smp.losses.FocalLoss(mode="binary")

        # ── Validation metrics ───────────────────────────────────────────────
        # torchmetrics objects accumulate predictions across all val batches
        # then compute the epoch-level metric in one go — no manual averaging.
        self.val_iou  = torchmetrics.JaccardIndex(task="binary", threshold=0.5)
        # torchmetrics >= 1.0: Dice == F1Score for binary segmentation
        self.val_dice = torchmetrics.F1Score(task="binary", threshold=0.5)

    # ── Encoder warmup ───────────────────────────────────────────────────────
    def on_train_epoch_start(self):
        """
        Freeze the encoder for the first `freeze_encoder_epochs` epochs so the
        randomly-initialised decoder learns to use the pretrained ResNet features
        without corrupting them via large early gradients.

        After the warmup, unfreeze the encoder.  The optimiser already has a
        separate (10× lower) LR group for encoder params so fine-tuning is
        gentle — catastrophic forgetting of ImageNet features is avoided.
        """
        n = self.hparams.freeze_encoder_epochs
        if self.current_epoch < n:
            for p in self.model.encoder.parameters():
                p.requires_grad_(False)
            if self.current_epoch == 0:
                print(f"\n  Encoder FROZEN for epochs 0–{n - 1} (decoder warmup)")
        elif self.current_epoch == n:
            for p in self.model.encoder.parameters():
                p.requires_grad_(True)
            print(f"\n  Encoder UNFROZEN at epoch {n} — fine-tuning all layers (encoder LR = {self.hparams.lr * 0.1:.1e})")

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Returns raw logits (B, 1, H, W).  Apply sigmoid for probabilities."""
        return self.model(x)

    def _compute_loss(self, logits, masks):
        """
        Shared loss computation for train and val steps.
        Both losses expect (B, 1, H, W) logits and (B, 1, H, W) targets.
        """
        masks_4d = masks.unsqueeze(1)           # (B,H,W) → (B,1,H,W)
        dice  = self.dice_loss(logits, masks_4d)
        focal = self.focal_loss(logits, masks_4d)
        return dice + focal, dice, focal

    def training_step(self, batch, batch_idx):
        imgs, masks = batch                     # (B,5,H,W), (B,H,W)
        logits = self(imgs)                     # (B,1,H,W)
        loss, dice, focal = self._compute_loss(logits, masks)

        self.log("train_loss",  loss,  prog_bar=True,  on_step=False, on_epoch=True)
        self.log("train_dice_l", dice, prog_bar=False, on_step=False, on_epoch=True)
        self.log("train_focal",  focal,prog_bar=False, on_step=False, on_epoch=True)
        return loss

    def validation_step(self, batch, batch_idx):
        imgs, masks = batch
        logits = self(imgs)
        loss, _, _ = self._compute_loss(logits, masks)

        # Probabilities for metric computation (sigmoid → [0,1])
        probs = torch.sigmoid(logits.squeeze(1))   # (B, H, W)

        # Update metric accumulators (Lightning calls .compute() at epoch end)
        self.val_iou(probs,  masks.long())
        self.val_dice(probs, masks.int())

        self.log("val_loss", loss,          prog_bar=True,  on_step=False, on_epoch=True)
        self.log("val_iou",  self.val_iou,  prog_bar=True,  on_step=False, on_epoch=True)
        self.log("val_dice", self.val_dice, prog_bar=True,  on_step=False, on_epoch=True)

    def configure_optimizers(self):
        """
        AdamW with differential LRs + CosineAnnealingLR.

        Differential learning rates prevent catastrophic forgetting of the
        pretrained encoder:
          • Decoder params → lr        (e.g. 1e-4)  — learn fast from scratch
          • Encoder params → lr × 0.1  (e.g. 1e-5)  — fine-tune gently

        During the freeze warmup epochs the encoder's requires_grad=False so
        the lower LR is irrelevant; it kicks in properly after unfreezing.

        CosineAnnealingLR decays both LR groups from their base values to
        eta_min=1e-6 over T_max epochs.
        """
        encoder_params = list(self.model.encoder.parameters())
        encoder_ids    = {id(p) for p in encoder_params}
        decoder_params = [p for p in self.parameters() if id(p) not in encoder_ids]

        param_groups = [
            {"params": decoder_params, "lr": self.hparams.lr,         "name": "decoder"},
            {"params": encoder_params, "lr": self.hparams.lr * 0.1,   "name": "encoder"},
        ]
        optimizer = torch.optim.AdamW(param_groups, weight_decay=self.hparams.weight_decay)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer,
            T_max=self.hparams.t_max,
            eta_min=1e-6,
        )
        return {
            "optimizer": optimizer,
            "lr_scheduler": {
                "scheduler": scheduler,
                "interval": "epoch",   # step once per epoch (not per batch)
            },
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train U-Net vineyard segmentation model")
    parser.add_argument("--ckpt", type=str, default=None,
                        help="Path to checkpoint to resume training from")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--patience", type=int, default=12,
                        help="Early stopping patience (epochs without val_iou improvement)")
    parser.add_argument("--freeze-encoder-epochs", type=int, default=5,
                        help="Freeze encoder for first N epochs (decoder-only warmup)")
    args = parser.parse_args()

    # ── Paths ─────────────────────────────────────────────────────────────────
    ml_dir      = Path(__file__).resolve().parent
    data_dir    = ml_dir.parent / "data"
    patches_dir = data_dir / "patches"
    stats_path  = patches_dir / "stats.json"
    ckpt_dir    = ml_dir / "checkpoints"
    log_dir     = ml_dir / "logs"
    ckpt_dir.mkdir(exist_ok=True)
    log_dir.mkdir(exist_ok=True)

    # ── Data module ───────────────────────────────────────────────────────────
    dm = VineyardDataModule(
        patches_dir=patches_dir,
        stats_path=stats_path,
        batch_size=args.batch_size,
        num_workers=0,   # 0 = load in main process; safe on macOS
                         # increase to 4 on Linux/GPU machines for speed
    )
    dm.setup()

    print(f"\n{'='*55}")
    print(f"  Training patches   : {len(dm.train_ds):,}")
    print(f"  Val patches        : {len(dm.val_ds):,}")
    print(f"  Batch size         : {args.batch_size}")
    print(f"  Steps/epoch        : {len(dm.train_ds) // args.batch_size}")
    print(f"  Max epochs         : {args.epochs}")
    print(f"  LR (decoder)       : {args.lr:.1e}")
    print(f"  LR (encoder)       : {args.lr * 0.1:.1e}  (after warmup)")
    print(f"  Encoder frozen for : epochs 0–{args.freeze_encoder_epochs - 1}")
    print(f"  Gradient clip      : 1.0")
    print(f"  Early stop after   : {args.patience} epochs without val_iou gain")
    print(f"{'='*55}\n")

    # ── Model ─────────────────────────────────────────────────────────────────
    model = VineyardSegModel(
        lr=args.lr,
        weight_decay=1e-4,
        t_max=args.epochs,
        freeze_encoder_epochs=args.freeze_encoder_epochs,
    )

    # ── Callbacks ─────────────────────────────────────────────────────────────
    callbacks = [
        # Save the top-3 checkpoints ranked by val_iou (higher = better).
        # Filename encodes epoch and IoU so you can tell checkpoints apart.
        ModelCheckpoint(
            dirpath=ckpt_dir,
            filename="unet-resnet34-ep{epoch:02d}-iou{val_iou:.3f}",
            monitor="val_iou",
            mode="max",
            save_top_k=3,
            verbose=True,
        ),
        # Stop early if val_iou hasn't improved for `patience` epochs.
        # Prevents overfitting and saves time.
        EarlyStopping(
            monitor="val_iou",
            mode="max",
            patience=args.patience,
            verbose=True,
        ),
        # Log the learning rate at each epoch so you can see the cosine decay.
        LearningRateMonitor(logging_interval="epoch"),
    ]

    # ── Trainer ───────────────────────────────────────────────────────────────
    # accelerator="auto" detects hardware in order: CUDA → MPS → CPU.
    # On an M-series Mac MPS is used automatically (no code changes needed).
    #
    # gradient_clip_val=1.0 — clips the global gradient norm to 1.0 before
    # each optimizer step.  Prevents a single bad batch from producing a huge
    # parameter update that blows up the model.  Standard practice for U-Nets
    # on imbalanced segmentation tasks.
    trainer = L.Trainer(
        max_epochs=args.epochs,
        accelerator="auto",
        devices=1,
        callbacks=callbacks,
        logger=CSVLogger(str(log_dir), name="vineyard_unet"),
        log_every_n_steps=10,
        enable_progress_bar=True,
        deterministic=False,   # True → reproducible but ~20% slower
        gradient_clip_val=1.0, # prevent encoder corruption from runaway gradients
    )

    # ── Train ─────────────────────────────────────────────────────────────────
    trainer.fit(model, dm, ckpt_path=args.ckpt)

    # ── Summary ───────────────────────────────────────────────────────────────
    best_ckpt  = trainer.checkpoint_callback.best_model_path
    best_score = trainer.checkpoint_callback.best_model_score
    print(f"\n{'='*55}")
    print(f"  Training complete.")
    print(f"  Best val IoU : {best_score:.4f}")
    print(f"  Checkpoint   : {best_ckpt}")
    print(f"  Training log : {log_dir}/vineyard_unet/")
    print(f"{'='*55}\n")
    print("Next step — run inference:")
    print("  .venv/bin/python ml/predict.py --ckpt", best_ckpt)


if __name__ == "__main__":
    main()
