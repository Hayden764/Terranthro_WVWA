#!/usr/bin/env bash
# =============================================================================
# lambda-setup.sh — install the inference deps on a fresh Lambda GPU instance
# =============================================================================
# Lambda's base image ships CUDA PyTorch (torch 2.7, cuda True) compiled
# against NumPy 1.x. The order below matters:
#   1. install geo/ML libs (this pulls numpy 2.x + opencv 4.13)
#   2. pin numpy<2 (so the base torch's NumPy ABI works) + torchmetrics/lightning
#   3. pin opencv to a numpy-1.x build (4.13 hard-requires numpy>=2)
# Reusing base torch (don't pip install torch) keeps GPU support guaranteed.
#
# Run from data-pipeline/ on the Lambda box:  bash scripts/lambda-setup.sh
# =============================================================================
set -e

pip install segmentation-models-pytorch rasterio geopandas shapely pyproj scipy click tqdm albumentations
pip install "numpy<2" torchmetrics lightning
pip install "opencv-python-headless==4.10.0.84"

python -c "import numpy, torch, torchmetrics, lightning, segmentation_models_pytorch, albumentations, rasterio, geopandas; print('numpy', numpy.__version__, '| cuda', torch.cuda.is_available(), '| ALL IMPORTS OK')"
