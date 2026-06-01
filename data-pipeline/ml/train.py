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
  0.65+ = good for agricultural parcel segmentation.  0.75+ = strong.

Encoder Unfreezing Strategy (gradual, block-by-block)
------------------------------------------------------
  Previous approach: unfreeze ALL encoder layers at once → catastrophic
  forgetting.  The decoder's large accumulated gradients destroyed the
  pretrained ResNet features before it could adapt.

  New approach — gradual unfreezing with layer-wise LR decay (LLRD):
    Phase 0  epochs 0 → unfreeze_start-1  : decoder only (warmup)
    Phase 1  epoch unfreeze_start          : unfreeze layer4 (deepest)
    Phase 2  epoch unfreeze_start+interval : unfreeze layer3
    Phase 3  epoch +2×interval            : unfreeze layer2
    Phase 4  epoch +3×interval            : unfreeze layer1 + stem

  Each block gets a progressively lower LR (LLRD):
    layer4 → encoder_lr          (most task-specific, largest update)
    layer3 → encoder_lr / 3
    layer2 → encoder_lr / 9
    layer1 + stem → encoder_lr / 27  (most general, barely touched)

  Why: shallow encoder layers encode universal features (edges, colours)
  that transfer perfectly.  Deep layers encode semantic concepts
  ("row-crop texture") that benefit from gentle, AVA-specific adaptation.

  With encoder_lr = 5e-6:
    layer4 LR = 5.0e-06
    layer3 LR = 1.7e-06
    layer2 LR = 5.6e-07
    layer1 LR = 1.9e-07

Optimiser & Schedule
--------------------
  AdamW with cosine annealing LR.
  CosineAnnealingLR smoothly decays every LR group from its base value
  → eta_min=1e-7 over T_max epochs.

Hardware
--------
  Trainer(accelerator="auto") detects: CUDA → MPS → CPU.

Usage
-----
  # Train from scratch on all-vineyard-parcels data:
  .venv/bin/python ml/train.py

  # Fine-tune from an existing checkpoint (weights only, fresh optimizer):
  .venv/bin/python ml/train.py \\
      --ckpt          ml/checkpoints/unet-resnet34-ep02-iou0.773.ckpt \\
      --weights-only \\
      --lr            3e-5 \\
      --encoder-lr    2e-6

  # Resume a crashed training run (full state restore):
  .venv/bin/python ml/train.py --ckpt ml/checkpoints/last.ckpt
"""

import argparse
import sys
from pathlib import Path

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
# Encoder block registry
# ---------------------------------------------------------------------------

def _encoder_blocks(encoder):
    """
    Return ordered list of (name, [params]) for each ResNet34 encoder block,
    from deepest (most task-specific) to shallowest (most general).

    LLRD assigns a separate LR to each group so shallow layers barely move
    while the deepest layer adapts most aggressively to vineyard features.
    """
    return [
        ("layer4", list(encoder.layer4.parameters())),
        ("layer3", list(encoder.layer3.parameters())),
        ("layer2", list(encoder.layer2.parameters())),
        ("stem",   list(encoder.layer1.parameters())
                 + list(encoder.conv1.parameters())
                 + list(encoder.bn1.parameters())),
    ]


# ---------------------------------------------------------------------------
# Lightning Module
# ---------------------------------------------------------------------------

class VineyardSegModel(L.LightningModule):

    def __init__(
        self,
        lr: float          = 1e-4,    # decoder learning rate
        encoder_lr: float  = 5e-6,    # layer4 LR; shallower blocks get lr/3, /9, /27
        weight_decay: float = 1e-4,
        t_max: int          = 100,    # cosine annealing period (= max_epochs)
        unfreeze_start: int = 10,     # epoch to unfreeze first encoder block
        unfreeze_interval: int = 10,  # epochs between successive block unfreeze steps
    ):
        super().__init__()
        self.save_hyperparameters()

        self.model = smp.Unet(
            encoder_name="resnet34",
            encoder_weights="imagenet",
            in_channels=5,
            classes=1,
            activation=None,
        )

        self.dice_loss  = smp.losses.DiceLoss(mode="binary", from_logits=True)
        self.focal_loss = smp.losses.FocalLoss(mode="binary")

        self.val_iou  = torchmetrics.JaccardIndex(task="binary", threshold=0.5)
        self.val_dice = torchmetrics.F1Score(task="binary", threshold=0.5)

        # Freeze all encoder params at init; unfrozen gradually in training
        for p in self.model.encoder.parameters():
            p.requires_grad_(False)

    # ── Gradual encoder unfreezing ────────────────────────────────────────────
    def on_train_epoch_start(self):
        """
        Implements the gradual block-by-block unfreeze schedule.

        At each trigger epoch, the next encoder block (deepest first) has its
        parameters unfrozen.  Its optimizer LR group was already configured
        with the correct LLRD value — no optimizer surgery needed, just flip
        requires_grad.

        Adam's momentum buffers for previously-frozen params are zero, so
        the first update after unfreezing is clean and conservative.
        """
        hp    = self.hparams
        epoch = self.current_epoch

        blocks   = _encoder_blocks(self.model.encoder)
        schedule = [
            hp.unfreeze_start + i * hp.unfreeze_interval
            for i in range(len(blocks))
        ]

        if epoch == 0:
            print(f"\n  Encoder FROZEN  — decoder warmup for {hp.unfreeze_start} epochs")
            print(f"  Unfreeze plan   : layer4 @ ep{schedule[0]}, "
                  f"layer3 @ ep{schedule[1]}, "
                  f"layer2 @ ep{schedule[2]}, "
                  f"stem @ ep{schedule[3]}")

        for trigger, (block_name, block_params) in zip(schedule, blocks):
            if epoch == trigger:
                for p in block_params:
                    p.requires_grad_(True)
                # Find matching LR from optimizer for the log message
                lr_val = next(
                    pg["lr"] for pg in self.optimizers().param_groups
                    if pg.get("name") == f"enc.{block_name}"
                )
                print(f"\n  ✓ Unfroze encoder.{block_name} at epoch {epoch}"
                      f"  (LR = {lr_val:.2e})")

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)

    def _compute_loss(self, logits, masks):
        masks_4d = masks.unsqueeze(1)
        dice  = self.dice_loss(logits, masks_4d)
        focal = self.focal_loss(logits, masks_4d)
        return dice + focal, dice, focal

    def training_step(self, batch, batch_idx):
        imgs, masks = batch
        logits = self(imgs)
        loss, dice, focal = self._compute_loss(logits, masks)
        self.log("train_loss",   loss,  prog_bar=True,  on_step=False, on_epoch=True)
        self.log("train_dice_l", dice,  prog_bar=False, on_step=False, on_epoch=True)
        self.log("train_focal",  focal, prog_bar=False, on_step=False, on_epoch=True)
        return loss

    def validation_step(self, batch, batch_idx):
        imgs, masks = batch
        logits = self(imgs)
        loss, _, _ = self._compute_loss(logits, masks)
        probs = torch.sigmoid(logits.squeeze(1))
        self.val_iou(probs,  masks.long())
        self.val_dice(probs, masks.int())
        self.log("val_loss", loss,          prog_bar=True,  on_step=False, on_epoch=True)
        self.log("val_iou",  self.val_iou,  prog_bar=True,  on_step=False, on_epoch=True)
        self.log("val_dice", self.val_dice, prog_bar=True,  on_step=False, on_epoch=True)

    def configure_optimizers(self):
        """
        Five param groups with layer-wise LR decay (LLRD):

          Group       params                 LR
          ─────────── ────────────────────── ──────────────────
          decoder     decoder + seg_head     lr          (e.g. 1e-4)
          enc.layer4  ResNet layer4          encoder_lr  (e.g. 5e-6)
          enc.layer3  ResNet layer3          encoder_lr/3
          enc.layer2  ResNet layer2          encoder_lr/9
          enc.stem    layer1 + conv1 + bn1   encoder_lr/27

        All encoder groups start with requires_grad=False and are
        enabled one-by-one in on_train_epoch_start.  The optimizer
        tracks them from the start so Adam's state is ready the moment
        they unfreeze (momentum buffers initialised to zero = clean start).
        """
        hp = self.hparams
        enc = self.model.encoder

        blocks = _encoder_blocks(enc)
        enc_ids = {id(p) for _, params in blocks for p in params}
        decoder_params = [p for p in self.parameters() if id(p) not in enc_ids]

        param_groups = [
            {"params": decoder_params,  "lr": hp.lr,               "name": "decoder"},
            {"params": blocks[0][1],    "lr": hp.encoder_lr,        "name": "enc.layer4"},
            {"params": blocks[1][1],    "lr": hp.encoder_lr / 3,    "name": "enc.layer3"},
            {"params": blocks[2][1],    "lr": hp.encoder_lr / 9,    "name": "enc.layer2"},
            {"params": blocks[3][1],    "lr": hp.encoder_lr / 27,   "name": "enc.stem"},
        ]

        optimizer = torch.optim.AdamW(param_groups, weight_decay=hp.weight_decay)
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=hp.t_max, eta_min=1e-7,
        )
        return {
            "optimizer": optimizer,
            "lr_scheduler": {"scheduler": scheduler, "interval": "epoch"},
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train U-Net vineyard segmentation model")

    # ── Checkpoint ────────────────────────────────────────────────────────────
    parser.add_argument("--ckpt", type=str, default=None,
                        help="Checkpoint path — full resume OR weights-only source")
    parser.add_argument("--weights-only", action="store_true",
                        help="Load model weights from --ckpt but start a fresh "
                             "optimizer/scheduler  (use for fine-tuning)")

    # ── Data ─────────────────────────────────────────────────────────────────
    parser.add_argument("--patches-dir", type=str, default=None,
                        help="Patches directory  [default: ml/../data/patches]")
    parser.add_argument("--batch-size",  type=int, default=32)
    parser.add_argument("--num-workers", type=int, default=4,
                        help="DataLoader workers  [default: 4; set 0 on macOS]")

    # ── Optimiser ─────────────────────────────────────────────────────────────
    parser.add_argument("--lr",         type=float, default=1e-4,
                        help="Decoder learning rate  [default: 1e-4]")
    parser.add_argument("--encoder-lr", type=float, default=5e-6,
                        help="Encoder layer4 LR; shallower blocks get /3, /9, /27  [default: 5e-6]")
    parser.add_argument("--epochs",     type=int,   default=100)
    parser.add_argument("--patience",   type=int,   default=20,
                        help="Early-stopping patience in epochs  [default: 20]")

    # ── Encoder unfreezing ────────────────────────────────────────────────────
    parser.add_argument("--unfreeze-start",    type=int, default=10,
                        help="Epoch to unfreeze first encoder block (layer4)  [default: 10]")
    parser.add_argument("--unfreeze-interval", type=int, default=10,
                        help="Epochs between successive block unfreeze steps  [default: 10]")

    args = parser.parse_args()

    # ── Paths ─────────────────────────────────────────────────────────────────
    ml_dir   = Path(__file__).resolve().parent
    data_dir = ml_dir.parent / "data"

    patches_dir = Path(args.patches_dir) if args.patches_dir else data_dir / "patches"
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
        num_workers=args.num_workers,
    )
    dm.setup()

    enc_lr = args.encoder_lr
    us, ui = args.unfreeze_start, args.unfreeze_interval

    print(f"\n{'='*60}")
    print(f"  Training patches      : {len(dm.train_ds):,}")
    print(f"  Val patches           : {len(dm.val_ds):,}")
    print(f"  Batch size            : {args.batch_size}")
    print(f"  Steps/epoch           : {len(dm.train_ds) // args.batch_size}")
    print(f"  Max epochs            : {args.epochs}")
    print(f"  Patience              : {args.patience}")
    print(f"  Gradient clip         : 1.0")
    print(f"  LR — decoder          : {args.lr:.1e}")
    print(f"  LR — enc.layer4       : {enc_lr:.1e}  (unfreezes ep {us})")
    print(f"  LR — enc.layer3       : {enc_lr/3:.1e}  (unfreezes ep {us+ui})")
    print(f"  LR — enc.layer2       : {enc_lr/9:.1e}  (unfreezes ep {us+2*ui})")
    print(f"  LR — enc.stem         : {enc_lr/27:.1e}  (unfreezes ep {us+3*ui})")
    print(f"{'='*60}\n")

    # ── Model ─────────────────────────────────────────────────────────────────
    model = VineyardSegModel(
        lr=args.lr,
        encoder_lr=args.encoder_lr,
        weight_decay=1e-4,
        t_max=args.epochs,
        unfreeze_start=args.unfreeze_start,
        unfreeze_interval=args.unfreeze_interval,
    )

    # ── Callbacks ─────────────────────────────────────────────────────────────
    callbacks = [
        ModelCheckpoint(
            dirpath=ckpt_dir,
            filename="unet-resnet34-ep{epoch:02d}-iou{val_iou:.3f}",
            monitor="val_iou",
            mode="max",
            save_top_k=3,
            verbose=True,
        ),
        EarlyStopping(
            monitor="val_iou",
            mode="max",
            patience=args.patience,
            verbose=True,
        ),
        LearningRateMonitor(logging_interval="epoch"),
    ]

    # ── Trainer ───────────────────────────────────────────────────────────────
    trainer = L.Trainer(
        max_epochs=args.epochs,
        accelerator="auto",
        devices=1,
        callbacks=callbacks,
        logger=CSVLogger(str(log_dir), name="vineyard_unet"),
        log_every_n_steps=10,
        enable_progress_bar=True,
        deterministic=False,
        gradient_clip_val=1.0,
    )

    # ── Train ─────────────────────────────────────────────────────────────────
    if args.ckpt and args.weights_only:
        raw = torch.load(args.ckpt, map_location="cpu")
        model.load_state_dict(raw["state_dict"])
        print(f"Weights loaded from   : {Path(args.ckpt).name}  (fresh optimizer)")
        trainer.fit(model, dm)
    else:
        trainer.fit(model, dm, ckpt_path=args.ckpt)

    # ── Summary ───────────────────────────────────────────────────────────────
    best_ckpt  = trainer.checkpoint_callback.best_model_path
    best_score = trainer.checkpoint_callback.best_model_score
    print(f"\n{'='*60}")
    print(f"  Training complete.")
    print(f"  Best val IoU  : {best_score:.4f}")
    print(f"  Checkpoint    : {best_ckpt}")
    print(f"  Training log  : {log_dir}/vineyard_unet/")
    print(f"{'='*60}\n")
    print("Next step — run inference:")
    print("  .venv/bin/python ml/predict.py --ckpt", best_ckpt)


if __name__ == "__main__":
    main()
