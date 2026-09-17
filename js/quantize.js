// Colour quantization: median-cut (default) and k-means (alternate).
// Operates on Lab colour space for perceptually even clustering; final
// nearest-colour lookups use CIEDE2000. No dithering: at 1 pixel per stitch,
// error diffusion doesn't blend — it just pushes runs of stitches across a
// palette boundary once accumulated error tips them over.

import { rgbToLab, labToRgb, ciede2000 } from './colorMath.js';

// Sample pixels from an ImageData (skipping fully-transparent ones), capped
// for performance on large images.
function sampleLabPixels(imageData, maxSamples = 20000) {
  const { data, width, height } = imageData;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const samples = [];
  for (let i = 0; i < total; i += step) {
    const p = i * 4;
    if (data[p + 3] < 16) continue; // skip transparent (removed background)
    samples.push(rgbToLab([data[p], data[p + 1], data[p + 2]]));
  }
  return samples;
}

// --- Median-cut ---------------------------------------------------------

function boxRange(box, samples) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const idx of box) {
    const s = samples[idx];
    for (let c = 0; c < 3; c++) {
      if (s[c] < min[c]) min[c] = s[c];
      if (s[c] > max[c]) max[c] = s[c];
    }
  }
  return { min, max, range: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function averageLab(box, samples) {
  const sum = [0, 0, 0];
  for (const idx of box) {
    const s = samples[idx];
    sum[0] += s[0];
    sum[1] += s[1];
    sum[2] += s[2];
  }
  const n = box.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

export function medianCut(imageData, k) {
  const samples = sampleLabPixels(imageData);
  if (samples.length === 0) return [];
  let boxes = [samples.map((_, i) => i)];

  while (boxes.length < k) {
    // Split the box with the largest range on its longest channel.
    let splitIdx = -1;
    let splitChannel = 0;
    let bestRange = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { range } = boxRange(box, samples);
      const ch = range[0] >= range[1] && range[0] >= range[2] ? 0 : range[1] >= range[2] ? 1 : 2;
      if (range[ch] > bestRange) {
        bestRange = range[ch];
        splitIdx = i;
        splitChannel = ch;
      }
    });
    if (splitIdx === -1) break; // no more splittable boxes

    const box = boxes[splitIdx];
    box.sort((a, b) => samples[a][splitChannel] - samples[b][splitChannel]);
    const mid = Math.floor(box.length / 2);
    const left = box.slice(0, mid);
    const right = box.slice(mid);
    boxes.splice(splitIdx, 1, left, right);
  }

  return boxes
    .filter((b) => b.length > 0)
    .map((box) => ({ rgb: labToRgb(averageLab(box, samples)), weight: box.length }));
}

// --- K-means --------------------------------------------------------------

export function kMeans(imageData, k, iterations = 10) {
  const samples = sampleLabPixels(imageData);
  if (samples.length === 0) return [];
  const n = samples.length;
  k = Math.min(k, n);

  // k-means++ style seeding for stability.
  const centroids = [samples[Math.floor(Math.random() * n)]];
  while (centroids.length < k) {
    const distances = samples.map((s) => {
      let min = Infinity;
      for (const c of centroids) {
        const d = labDistSq(s, c);
        if (d < min) min = d;
      }
      return min;
    });
    const sum = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    let chosen = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(samples[chosen]);
  }

  let assignments = new Array(n).fill(0);
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = labDistSq(samples[i], centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
    }
    const sums = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const a = assignments[i];
      sums[a][0] += samples[i][0];
      sums[a][1] += samples[i][1];
      sums[a][2] += samples[i][2];
      sums[a][3] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
    if (!changed) break;
  }

  const counts = new Array(centroids.length).fill(0);
  assignments.forEach((a) => counts[a]++);
  return centroids.map((c, i) => ({ rgb: labToRgb(c), weight: counts[i] })).filter((c) => c.weight > 0);
}

function labDistSq(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

export function quantizePalette(imageData, k, algorithm = 'median-cut') {
  const palette = algorithm === 'k-means' ? kMeans(imageData, k) : medianCut(imageData, k);
  palette.forEach((p) => (p.lab = rgbToLab(p.rgb)));
  return palette;
}

function nearestPaletteIndex(lab, palette) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = ciede2000(lab, palette[i].lab);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Map every pixel of imageData to the nearest colour in `palette`
 * (array of {rgb, lab}).
 * Returns { indices: Int32Array(width*height) (-1 = transparent/removed),
 *           width, height }.
 */
export function mapToPalette(imageData, palette) {
  const { width, height, data } = imageData;
  const indices = new Int32Array(width * height).fill(-1);
  if (palette.length === 0) return { indices, width, height };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const alpha = data[i * 4 + 3];
      if (alpha < 16) continue; // transparent -> no stitch

      const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      const lab = rgbToLab(rgb);
      indices[i] = nearestPaletteIndex(lab, palette);
    }
  }

  return { indices, width, height };
}
