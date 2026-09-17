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
 *   resolution (1 image pixel == 1 stitch). Not dithered: error-diffusion at
 *   1-pixel-per-stitch resolution pushes whole runs of similar-toned stitches
 *   across a palette boundary once accumulated error tips them over, which
 *   reads as stray off-hue blotches rather than a smooth blend — solid
 *   quantized blocks read better at chart resolution anyway.
 * @param {number} colorCount
 * @param {'median-cut'|'k-means'} algorithm
 */
export function buildPattern(imageData, colorCount, algorithm) {
  const palette = quantizePalette(imageData, colorCount, algorithm);
  const { indices, width, height } = mapToPalette(imageData, palette);

  const counts = new Array(palette.length).fill(0);
  for (const idx of indices) {
    if (idx >= 0) counts[idx]++;
  }

  const colors = palette.map((p, i) => ({
    index: i,
    rgb: p.rgb,
    sourceRgb: p.rgb, // pristine quantized centroid — the anchor for re-snapping to a different brand later
    symbol: symbolFor(i),
    stitchCount: counts[i],
  })).filter((c) => c.stitchCount > 0);

  return { width, height, indices, colors };
}

/**
 * Snap each palette entry's rgb to the nearest real swatch in `brandKey`, so
 * the chart, PNG/PDF export and legend all show the actual thread colour the
 * legend claims rather than the raw quantization centroid. Always re-snaps
 * from the original quantized colour (not the currently-snapped one), so
 * switching brands back and forth doesn't drift.
 */
export function applyBrandSnap(pattern, brandKey) {
  pattern.colors = pattern.colors.map((c) => {
    const anchor = c.sourceRgb || c.rgb;
    const match = legendRowForBrand(anchor, brandKey);
    return { ...c, rgb: match.rgb, sourceRgb: anchor };
  });
  return pattern;
}

/**
 * Build the floss legend for a pattern against a chosen brand.
 * Returns an array sorted by descending stitch count.
 */
export function buildLegend(pattern, brandKey) {
  return pattern.colors
    .map((c) => {
      const match = legendRowForBrand(c.sourceRgb || c.rgb, brandKey);
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
