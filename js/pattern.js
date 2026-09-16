// Builds a stitch pattern (grid of thread-colour indices) from a quantized
// image, and computes the floss legend (stitch counts, skein estimates) for
// a chosen brand.

import { quantizePalette, mapToPalette } from './quantize.js';
import { legendRowForBrand } from './crosswalk.js';
import { skeinEstimate } from './sizing.js';

// Distinct glyphs for the B&W symbol chart — chosen to stay visually
// distinguishable from one another at small print sizes.
export const SYMBOLS = [
  '●', '■', '▲', '◆', '★', '✚', '○', '□', '△', '◇',
  '☆', '✖', '◐', '◉', '▣', '▤', '▥', '▦', '▧', '▨',
  '♦', '♣', '♠', '♥', '✦', '✧', '⬟', '⬢', '⬣', '⚫',
  '⚪', '▮', '▯', '◒', '◓', '◔', '◕', '⊕', '⊗', '⊘',
];

export function symbolFor(index) {
  return SYMBOLS[index % SYMBOLS.length];
}

/**
 * @param {ImageData} imageData - already cropped/resampled to the stitch grid
 *   resolution (1 image pixel == 1 stitch).
 * @param {number} colorCount
 * @param {'median-cut'|'k-means'} algorithm
 * @param {boolean} dither
 */
export function buildPattern(imageData, colorCount, algorithm, dither) {
  const palette = quantizePalette(imageData, colorCount, algorithm);
  const { indices, width, height } = mapToPalette(imageData, palette, dither);

  const counts = new Array(palette.length).fill(0);
  for (const idx of indices) {
    if (idx >= 0) counts[idx]++;
  }

  const colors = palette.map((p, i) => ({
    index: i,
    rgb: p.rgb,
    symbol: symbolFor(i),
    stitchCount: counts[i],
  })).filter((c) => c.stitchCount > 0);

  return { width, height, indices, colors };
}

/**
 * Build the floss legend for a pattern against a chosen brand.
 * Returns an array sorted by descending stitch count.
 */
export function buildLegend(pattern, brandKey) {
  return pattern.colors
    .map((c) => {
      const match = legendRowForBrand(c.rgb, brandKey);
      return {
        ...c,
        threadCode: match.code,
        threadName: match.name,
        approximate: !!match.approximate,
        skeins: skeinEstimate(c.stitchCount),
      };
    })
    .sort((a, b) => b.stitchCount - a.stitchCount);
}
