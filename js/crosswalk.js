// Runtime brand-to-brand colour crosswalk.
//
// Per the build spec: never ship a copied third-party DMC<->Anchor/Madeira
// conversion chart. Instead, for any stitch colour, find the nearest colour
// (by CIEDE2000) within the *target* brand's own colour list. The result is
// always labelled as an approximation in the UI when the match isn't exact.

import { ciede2000, rgbToLab } from './colorMath.js';
import { BRANDS } from './threadData.js';

const EXACT_THRESHOLD = 1.0; // CIEDE2000 delta below this reads as "same colour"

/**
 * Find the best match for a reference RGB colour within a given brand's list.
 * Returns { code, name, rgb, distance, approximate, brand } or null if the
 * brand has no colours at all.
 */
export function matchInBrand(rgb, brandKey) {
  const brand = BRANDS[brandKey];
  if (!brand || brand.colors.length === 0) return null;

  const lab = rgbToLab(rgb);
  let best = null;
  let bestDist = Infinity;
  for (const entry of brand.colors) {
    if (!entry.__lab) entry.__lab = rgbToLab(entry.rgb);
    const d = ciede2000(lab, entry.__lab);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  return {
    code: best.code,
    name: best.name,
    rgb: best.rgb,
    distance: bestDist,
    approximate: bestDist > EXACT_THRESHOLD || best.verified !== true,
    verified: best.verified,
    brand: brandKey,
  };
}

/**
 * Build a legend row for a stitch colour (from quantization) against the
 * currently selected brand. `stitchRgb` is the cluster centroid colour used
 * for the pattern; matching happens purely at legend-build time, so switching
 * brands never requires re-quantizing the image.
 */
export function legendRowForBrand(stitchRgb, brandKey) {
  const match = matchInBrand(stitchRgb, brandKey);
  if (!match) {
    return { rgb: stitchRgb, code: '—', name: 'No catalogue data', approximate: true };
  }
  return match;
}
