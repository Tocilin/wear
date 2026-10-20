// Outfit builder: recolors each garment of one photo using per-garment masks.
// The masks are grayscale PNGs (white = garment) the same size as the photo.

const PHOTO = "assets/model.jpg";

// Where to buy the pants shown. `price: null` hides the price.
const TROUSER = {
  brand: "01.ALGO",
  name: "WarpTech Commuter Slim Fit Trouser",
  fit: "Slim",
  size: "34 × 34",
  price: "$88",
  store: "Stitch Fix",
  url: "https://www.stitchfix.com/product/01-Algo-WarpTech-Commuter-Slim-Fit-Trouser/N32ZMVNWX",
};
const FIVE_POCKET = {
  ...TROUSER,
  name: "WarpTech Commuter 5 Pocket Slim Fit Pant",
  price: null,
  url: null,
};

const CATEGORIES = [
  {
    id: "tshirt",
    label: "T-shirt",
    mask: "assets/mask-tshirt.png",
    colors: [
      { name: "White", hex: "#f4f3ef", original: true },
      { name: "Heather Gray", hex: "#a9a9a6" },
      { name: "Black", hex: "#262626" },
    ],
  },
  {
    id: "shirt",
    label: "Shirt",
    mask: "assets/mask-shirt.png",
    colors: [
      { name: "Dark Navy", hex: "#1f2c4c", original: true },
      { name: "Light Blue", hex: "#8db3e8" },
    ],
  },
  {
    id: "pants",
    label: "Pants",
    mask: "assets/mask-pants.png",
    colors: [
      // Sampled from the 01.ALGO WarpTech Commuter product photos.
      { name: "Khaki", hex: "#b4a18b", product: TROUSER },
      { name: "Light Grey", hex: "#868183", product: FIVE_POCKET },
      { name: "Blue", hex: "#213a61", product: TROUSER },
    ],
  },
  {
    id: "shoes",
    label: "Shoes",
    mask: "assets/mask-shoes.png",
    colors: [
      { name: "Navy Sneakers", hex: "#1f2a44", original: true },
      { name: "White Sneakers", hex: "#f1f1ee" },
    ],
  },
];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const panel = document.getElementById("panel");
const summary = document.getElementById("summary");
const loading = document.getElementById("loading");
const randomButton = document.getElementById("random");

// Selected color index per category; start on the photo's own colors.
const selected = {};
for (const cat of CATEGORIES) {
  selected[cat.id] = Math.max(0, cat.colors.findIndex((c) => c.original));
}

let base;        // ImageData of the untouched photo
let luma;        // Float32Array, luminance of each photo pixel
const regions = {}; // per category: { idx: Uint32Array, alpha: Float32Array, ref, strength }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function pixelsOf(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0, w, h);
  return cx.getImageData(0, 0, w, h).data;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function buildRegion(maskData) {
  const idx = [];
  const alpha = [];
  const core = [];
  for (let p = 0, i = 0; i < maskData.length; p++, i += 4) {
    const a = maskData[i] / 255;
    if (a > 0.01) {
      idx.push(p);
      alpha.push(a);
      if (a > 0.5) core.push(luma[p]);
    }
  }
  core.sort((x, y) => x - y);
  const ref = Math.max(core.length ? core[core.length >> 1] : 128, 1);
  // Dark fabrics carry relatively more noise in their shading, so lifting
  // them to a light color needs the shading toned down.
  const strength = Math.min(1, Math.max(0.35, ref / 150));
  return { idx: Uint32Array.from(idx), alpha: Float32Array.from(alpha), ref, strength };
}

// Paint a garment in `rgb`, keeping the photo's folds and shadows.
function recolor(out, region, rgb) {
  const { idx, alpha, ref, strength } = region;
  for (let k = 0; k < idx.length; k++) {
    const p = idx[k];
    const i = p * 4;
    // Clamped so stray background pixels at the edges don't glow and deep
    // shadows along the seams don't turn into black outlines.
    const s = Math.min(Math.max(luma[p] / ref, 0.4), 1.6);
    const a = alpha[k];
    for (let ch = 0; ch < 3; ch++) {
      const t = rgb[ch];
      const v = t * (1 + strength * (s - 1));
      out[i + ch] = out[i + ch] * (1 - a) + v * a;
    }
  }
}

function render() {
  const frame = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  for (const cat of CATEGORIES) {
    const color = cat.colors[selected[cat.id]];
    if (!color.original) recolor(frame.data, regions[cat.id], hexToRgb(color.hex));
  }
  ctx.putImageData(frame, 0, 0);
  summary.textContent = CATEGORIES.map((cat) => cat.colors[selected[cat.id]].name + " " + cat.label.toLowerCase()).join(" · ");
}

const refreshers = []; // redraw each category's swatch state

// Pick a random color for every garment, making sure the outfit changes.
function randomize() {
  const before = CATEGORIES.map((cat) => selected[cat.id]).join();
  do {
    for (const cat of CATEGORIES) selected[cat.id] = Math.floor(Math.random() * cat.colors.length);
  } while (CATEGORIES.map((cat) => selected[cat.id]).join() === before);
  refreshers.forEach((refresh) => refresh());
  render();
}

function renderDetails(el, product) {
  el.hidden = !product;
  el.replaceChildren();
  if (!product) return;

  const name = document.createElement("p");
  name.className = "details-name";
  name.textContent = `${product.brand} ${product.name}`;

  const facts = document.createElement("p");
  facts.className = "details-facts";
  facts.textContent = [`Size ${product.size}`, `${product.fit} fit`, product.price].filter(Boolean).join(" · ");

  el.append(name, facts);
  if (product.url) {
    const buy = document.createElement("a");
    buy.className = "details-buy";
    buy.href = product.url;
    buy.target = "_blank";
    buy.rel = "noopener";
    const store = document.createElement("span");
    store.className = "details-store";
    store.textContent = ` at ${product.store}`;
    buy.append("Buy", store);
    el.append(buy);
  }
}

function buildPanel() {
  for (const cat of CATEGORIES) {
    const group = document.createElement("div");
    group.className = "group";

    const title = document.createElement("h2");
    title.textContent = cat.label;
    const current = document.createElement("p");
    current.className = "current";

    const swatches = document.createElement("div");
    swatches.className = "swatches";
    swatches.setAttribute("role", "group");
    swatches.setAttribute("aria-label", `${cat.label} color`);

    const buttons = cat.colors.map((color, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.setProperty("--c", color.hex);
      b.title = color.name;
      b.setAttribute("aria-label", color.name);
      b.addEventListener("click", () => {
        selected[cat.id] = i;
        update();
        render();
      });
      swatches.appendChild(b);
      return b;
    });

    const details = document.createElement("div");
    details.className = "details";

    function update() {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === selected[cat.id])));
      const color = cat.colors[selected[cat.id]];
      current.textContent = color.name;
      renderDetails(details, color.product);
    }
    update();
    refreshers.push(update);

    group.append(title, current, swatches, details);
    panel.appendChild(group);
  }
}

async function init() {
  buildPanel();
  try {
    const [photo, ...masks] = await Promise.all([PHOTO, ...CATEGORIES.map((c) => c.mask)].map(loadImage));
    const w = photo.naturalWidth;
    const h = photo.naturalHeight;
    canvas.width = w;
    canvas.height = h;

    const data = pixelsOf(photo, w, h);
    base = new ImageData(new Uint8ClampedArray(data), w, h);
    luma = new Float32Array(w * h);
    for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
      luma[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    CATEGORIES.forEach((cat, n) => {
      regions[cat.id] = buildRegion(pixelsOf(masks[n], w, h));
    });

    render();
    loading.hidden = true;
    randomButton.hidden = false;
    randomButton.addEventListener("click", randomize);
  } catch (err) {
    loading.textContent = `${err.message}. Serve this folder over HTTP (see README).`;
    console.error(err);
  }
}

init();
