// Aida count and physical-size <-> stitch-grid calculations.

export const AIDA_COUNTS = [11, 14, 16, 18, 22];

export const UNITS = { INCH: 'in', CM: 'cm' };

export function inchesToCm(inches) {
  return inches * 2.54;
}
export function cmToInches(cm) {
  return cm / 2.54;
}

// Aida count = stitches per inch. Convert to/from stitches.
export function sizeToGrid(widthIn, heightIn, aidaCount) {
  return {
    stitchesW: Math.round(widthIn * aidaCount),
    stitchesH: Math.round(heightIn * aidaCount),
  };
}

export function gridToSize(stitchesW, stitchesH, aidaCount) {
  return {
    widthIn: stitchesW / aidaCount,
    heightIn: stitchesH / aidaCount,
  };
}

export function formatLength(inches, unit) {
  if (unit === UNITS.CM) return `${inchesToCm(inches).toFixed(1)} cm`;
  return `${inches.toFixed(2)} in`;
}

// Preset templates for small sellable items. Sizes are in inches (w x h);
// aspect is derived (w/h) and used to lock the crop tool.
export const PRESETS = [
  { id: 'keyring-sm', label: 'Keyring (1" x 1")', widthIn: 1, heightIn: 1 },
  { id: 'keyring-md', label: 'Keyring (1.5" x 1.5")', widthIn: 1.5, heightIn: 1.5 },
  { id: 'keyring-lg', label: 'Keyring (2" x 2")', widthIn: 2, heightIn: 2 },
  { id: 'keyring-tall', label: 'Keyring (1" x 2")', widthIn: 1, heightIn: 2 },
  { id: 'bag-charm', label: 'Bag charm (1.5" x 2")', widthIn: 1.5, heightIn: 2 },
  { id: 'bookmark', label: 'Bookmark (2" x 6")', widthIn: 2, heightIn: 6 },
  { id: 'ornament', label: 'Ornament (3" x 3")', widthIn: 3, heightIn: 3 },
  { id: 'mini-frame', label: 'Mini frame (4" x 4")', widthIn: 4, heightIn: 4 },
];

export const MIN_RECOGNISABLE_STITCHES = 20;
export const MAX_REASONABLE_STITCHES_SINGLE_PIECE = 300; // ~27" at 11ct

export function validateGrid(stitchesW, stitchesH) {
  const warnings = [];
  if (stitchesW < MIN_RECOGNISABLE_STITCHES || stitchesH < MIN_RECOGNISABLE_STITCHES) {
    warnings.push(
      `This grid (${stitchesW}×${stitchesH} stitches) is quite small — detail may not read clearly below about ${MIN_RECOGNISABLE_STITCHES}×${MIN_RECOGNISABLE_STITCHES} stitches. Consider a higher Aida count or a larger finished size.`
    );
  }
  if (stitchesW > MAX_REASONABLE_STITCHES_SINGLE_PIECE || stitchesH > MAX_REASONABLE_STITCHES_SINGLE_PIECE) {
    warnings.push(
      `This grid (${stitchesW}×${stitchesH} stitches) would need a large piece of Aida for a single item — consider a lower Aida count or a smaller finished size.`
    );
  }
  return warnings;
}

export function skeinEstimate(stitchCount) {
  // Rough rule of thumb: one skein (8m/8.7yd, 6-strand, used as 2 strands)
  // covers roughly 800-1000 full cross stitches on 14-count Aida. We use a
  // conservative 800/skein and round up.
  const perSkein = 800;
  return Math.max(1, Math.ceil(stitchCount / perSkein));
}
