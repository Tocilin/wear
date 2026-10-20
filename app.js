// Outfit builder: recolors each garment of one photo using per-garment masks.
// The masks are grayscale PNGs (white = garment) the same size as the photo.

const PHOTO = "assets/model.jpg";

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
      { name: "Stone / Khaki", hex: "#c6aa7f" },
      { name: "Light Gray", hex: "#c4c3c1", original: true },
      { name: "Taupe / Gray", hex: "#8b7c70" },
      { name: "Olive", hex: "#5f6a3a" },
      { name: "Navy", hex: "#1f2a47" },
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
  let sum = 0;
  let weight = 0;
  for (let p = 0, i = 0; i < maskData.length; p++, i += 4) {
    const a = maskData[i] / 255;
    if (a > 0.01) {
      idx.push(p);
      alpha.push(a);
      if (a > 0.5) {
        sum += luma[p];
        weight++;
      }
    }
  }
  const ref = Math.max(weight ? sum / weight : 128, 1);
  // Dark fabrics carry relatively more noise in their shading, so lifting
  // them to a light color needs the shading toned down.
  const strength = Math.min(1, Math.max(0.35, ref / 150));
  return { idx: Uint32Array.from(idx), alpha: Float32Array.from(alpha), ref, strength };
}

// Paint a garment in `rgb`, keeping the photo's folds and shadows.
function recolor(out, region, rgb) {
  const { idx, alpha, ref, strength } = region;
  const src = base.data;
  for (let k = 0; k < idx.length; k++) {
    const p = idx[k];
    const i = p * 4;
    const s = luma[p] / ref;
    const a = alpha[k];
    for (let ch = 0; ch < 3; ch++) {
      const t = rgb[ch];
      let v;
      if (s <= 1) {
        v = t * (1 - strength * (1 - s));
      } else {
        v = t + (255 - t) * Math.min(1, strength * (s - 1) * 0.6);
      }
      out[i + ch] = src[i + ch] * (1 - a) + v * a;
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

    function update() {
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === selected[cat.id])));
      current.textContent = cat.colors[selected[cat.id]].name;
    }
    update();

    group.append(title, current, swatches);
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
  } catch (err) {
    loading.textContent = `${err.message}. Serve this folder over HTTP (see README).`;
    console.error(err);
  }
}

init();
