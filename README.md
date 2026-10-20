# Outfit Builder

A small web page that shows one photo of a man and lets you change the color
of each garment: T-shirt, shirt, pants and shoes. Clicking a color swatch
repaints that garment on the photo, keeping its folds and shadows.

## Run it

The page reads the photo's pixels, so it must be served over HTTP (opening
`index.html` straight from disk won't work):

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it works

- `assets/model.jpg` is the photo.
- `assets/mask-*.png` mark where each garment is (white = garment).
- `app.js` lists the colors per garment and recolors the masked pixels.
  Colors marked `original: true` are the photo's own and show it untouched.

To add a color, add an entry to the `colors` list of that garment in `app.js`.

## Using a different photo

Replace `assets/model.jpg`, then rebuild the masks:

```sh
pip install torch transformers pillow numpy scipy
python tools/make_masks.py assets/model.jpg assets/
```

Then set the `original` colors in `app.js` to match the new photo.
