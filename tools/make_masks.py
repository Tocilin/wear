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
from transformers import AutoModelForSemanticSegmentation

MODEL = "mattmdjaga/segformer_b2_clothes"
UPPER, PANTS, LEFT_SHOE, RIGHT_SHOE = 4, 6, 9, 10
SKIN = [11, 12, 13, 14, 15]  # face, legs, arms


def segment(img):
    model = AutoModelForSemanticSegmentation.from_pretrained(MODEL)
    # Same preprocessing as the model's own processor: 512x512, ImageNet normalization.
    x = np.asarray(img.resize((512, 512), Image.BILINEAR), dtype=np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = torch.from_numpy(x.transpose(2, 0, 1)[None].astype(np.float32))
    with torch.no_grad():
        logits = model(pixel_values=x).logits
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
    # Grow by a pixel so the feathered edge doesn't leave a rim of the old color.
    mask = ndimage.binary_dilation(mask, iterations=1)
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
    neck[top : top + int(0.3 * (ys.max() - top)), :] = True
    near_upper = ndimage.binary_dilation(upper, iterations=6)
    candidates = ndimage.binary_closing(near_upper & neck & (luma > 130) & (sat < 40), iterations=2)
    # Of the bright patches, take the one closest to the shirt's center line
    # (the others are background showing past the shoulders).
    labels, n = ndimage.label(candidates)
    center_x = xs.mean()
    sizes = ndimage.sum(candidates, labels, range(1, n + 1))
    centers = ndimage.center_of_mass(candidates, labels, range(1, n + 1))
    scores = [abs(cx - center_x) if size > 200 else np.inf for size, (_, cx) in zip(sizes, centers)]
    tshirt = ndimage.binary_fill_holes(labels == int(np.argmin(scores)) + 1)
    shirt = upper & ~tshirt
    # Light shirt buttons stay as they are.
    shirt &= ~((luma > 120) & ~ndimage.binary_dilation(tshirt, iterations=3))
    shirt = ndimage.binary_closing(shirt, iterations=1) & upper & ~tshirt

    pants = largest_parts(seg == PANTS)
    # The shaded shirt hem gets labeled as pants or nothing; give the dark
    # pixels hugging the shirt back to it.
    hem = ndimage.binary_dilation(shirt, iterations=6) & ~tshirt & (luma < 90)
    hem = ndimage.binary_closing(hem | shirt, iterations=2) & ~shirt & ~tshirt
    hem &= ~np.isin(seg, SKIN)
    shirt |= hem
    pants &= ~hem

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
