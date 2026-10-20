"""Build the garment masks used by the web app from the model photo.

Uses the SegFormer clothes-parsing model to find upper clothes, pants and
shoes, then splits the white T-shirt out of the upper clothes and keeps only
the shoe uppers (not the white soles), so each garment can be recolored on
its own.

Usage: python tools/make_masks.py assets/model.jpg assets/
Needs: torch, transformers, pillow, numpy, scipy
"""

import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFilter
from scipy import ndimage
from transformers import AutoModelForSemanticSegmentation, SegformerImageProcessor

MODEL = "mattmdjaga/segformer_b2_clothes"
UPPER, PANTS, LEFT_SHOE, RIGHT_SHOE = 4, 6, 9, 10


def segment(img):
    processor = SegformerImageProcessor.from_pretrained(MODEL)
    model = AutoModelForSemanticSegmentation.from_pretrained(MODEL)
    with torch.no_grad():
        logits = model(**processor(images=img, return_tensors="pt")).logits
    logits = torch.nn.functional.interpolate(logits, size=img.size[::-1], mode="bilinear", align_corners=False)
    return logits.argmax(dim=1)[0].numpy()


def largest_parts(mask, keep=1):
    labels, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    best = np.argsort(sizes)[::-1][:keep] + 1
    return np.isin(labels, best)


def save(mask, path, feather=1.2):
    im = Image.fromarray((mask * 255).astype(np.uint8), "L")
    im.filter(ImageFilter.GaussianBlur(feather)).save(path, optimize=True)


def main(photo_path, out_dir):
    out = Path(out_dir)
    img = Image.open(photo_path).convert("RGB")
    rgb = np.asarray(img).astype(np.float32)
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    seg = segment(img)

    upper = largest_parts(seg == UPPER)
    # The T-shirt is the bright, neutral fabric in the neckline of the shirt.
    ys, xs = np.nonzero(upper)
    top = ys.min()
    neck = np.zeros_like(upper)
    neck[top : top + int(0.12 * (ys.max() - top)), :] = True
    near_upper = ndimage.binary_dilation(upper, iterations=6)
    tshirt = near_upper & neck & (luma > 150) & (sat < 40)
    tshirt = largest_parts(ndimage.binary_closing(tshirt, iterations=2))
    tshirt = ndimage.binary_fill_holes(tshirt)
    shirt = upper & ~tshirt
    # Light shirt buttons stay as they are.
    shirt &= ~((luma > 120) & ~ndimage.binary_dilation(tshirt, iterations=3))
    shirt = ndimage.binary_closing(shirt, iterations=1) & upper & ~tshirt

    pants = largest_parts(seg == PANTS)

    shoes = largest_parts((seg == LEFT_SHOE) | (seg == RIGHT_SHOE), keep=2)
    # Keep the dark leather upper; leave the white sole and tan heel tab alone.
    shoes &= (luma < 110) & (sat < 60)
    shoes = ndimage.binary_closing(shoes, iterations=2)

    out.mkdir(parents=True, exist_ok=True)
    save(tshirt, out / "mask-tshirt.png")
    save(shirt, out / "mask-shirt.png")
    save(pants, out / "mask-pants.png")
    save(shoes, out / "mask-shoes.png")
    for name, m in [("tshirt", tshirt), ("shirt", shirt), ("pants", pants), ("shoes", shoes)]:
        print(f"{name}: {int(m.sum())} px")


if __name__ == "__main__":
    main(*sys.argv[1:3])
