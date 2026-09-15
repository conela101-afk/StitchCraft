// Client-side image pre-processing: brightness/contrast, edge enhancement,
// and colour-threshold background removal. All functions operate on and
// return ImageData / canvases; nothing ever leaves the device.

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export function imageToCanvas(img, maxDim = 1600) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

// Crop a canvas to a rect given in source-pixel coordinates, resampling to
// `outW`x`outH` (the stitch grid resolution).
export function cropAndResample(canvas, rect, outW, outH) {
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);
  return out;
}

// Constrain a crop rect to a fixed aspect ratio (w/h), keeping it centred and
// clamped within the source image bounds. Used to lock the crop tool to the
// target physical size ratio (e.g. a 1x2 keyring stays 1:2).
export function constrainAspect(rect, aspect, boundsW, boundsH) {
  let { x, y, w, h } = rect;
  const currentAspect = w / h;
  if (currentAspect > aspect) {
    const newW = h * aspect;
    x += (w - newW) / 2;
    w = newW;
  } else {
    const newH = w / aspect;
    y += (h - newH) / 2;
    h = newH;
  }
  x = Math.max(0, Math.min(x, boundsW - w));
  y = Math.max(0, Math.min(y, boundsH - h));
  w = Math.min(w, boundsW - x);
  h = Math.min(h, boundsH - y);
  return { x, y, w, h };
}

export function applyBrightnessContrast(imageData, brightness = 0, contrast = 0) {
  // brightness: -100..100, contrast: -100..100
  const data = imageData.data;
  const b = brightness * 2.55;
  const c = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = data[i + ch] + b;
      v = c * (v - 128) + 128;
      data[i + ch] = Math.max(0, Math.min(255, v));
    }
  }
  return imageData;
}

// Simple unsharp-mask style edge enhancement (3x3 Laplacian blended in).
export function applyEdgeEnhancement(imageData, amount = 0.5) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const si = ((y + ky) * width + (x + kx)) * 4 + ch;
            sum += src[si] * kernel[k++];
          }
        }
        const sharpened = Math.max(0, Math.min(255, sum));
        data[i + ch] = src[i + ch] * (1 - amount) + sharpened * amount;
      }
    }
  }
  return imageData;
}

// Colour-threshold "click to remove" background: flood-fills from the
// clicked pixel, removing (alpha=0) any connected pixel within `tolerance`
// colour distance of the seed colour. Not full segmentation, just a simple
// magic-wand.
export function removeBackgroundByClick(imageData, seedX, seedY, tolerance = 32) {
  const { width, height, data } = imageData;
  const idx = (x, y) => (y * width + x) * 4;
  const seedI = idx(seedX, seedY);
  const seed = [data[seedI], data[seedI + 1], data[seedI + 2]];

  const visited = new Uint8Array(width * height);
  const stack = [[seedX, seedY]];
  const tol2 = tolerance * tolerance;

  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const p = y * width + x;
    if (visited[p]) continue;
    visited[p] = 1;

    const i = p * 4;
    const dr = data[i] - seed[0];
    const dg = data[i + 1] - seed[1];
    const db = data[i + 2] - seed[2];
    if (dr * dr + dg * dg + db * db > tol2) continue;

    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return imageData;
}

export function getImageData(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

export function putImageData(canvas, imageData) {
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas;
}
