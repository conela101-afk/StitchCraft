// Import/export of the StitchCraft pattern JSON format — the common
// currency between the wizard, Library, Designer and Tracker.

const FORMAT = 'stitchcraft-pattern';
const FORMAT_VERSION = 1;

/**
 * @param {object} pattern - a Pattern record (or the plain {width,height,
 *   indices,colors} shape straight out of pattern.js).
 * @returns {Blob} JSON blob ready for download.
 */
export function exportPatternJSON(pattern) {
  const payload = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    name: pattern.name || 'Untitled pattern',
    width: pattern.width,
    height: pattern.height,
    aidaCount: pattern.aidaCount ?? null,
    indices: Array.from(pattern.indices),
    colors: pattern.colors,
    brand: pattern.brand ?? null,
    source: pattern.source || 'photo',
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/**
 * @param {File} file
 * @returns {Promise<object>} a Pattern record (without id/createdAt/updatedAt)
 *   ready to hand to db.js's savePattern.
 */
export async function importPatternJSON(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  validatePatternShape(data);

  return {
    name: data.name || 'Imported pattern',
    width: data.width,
    height: data.height,
    aidaCount: data.aidaCount ?? null,
    indices: data.indices,
    colors: data.colors,
    brand: data.brand ?? null,
    source: 'imported',
  };
}

function validatePatternShape(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Not a StitchCraft pattern file.');
  }
  if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width <= 0 || data.height <= 0) {
    throw new Error('Pattern is missing a valid width/height.');
  }
  if (!Array.isArray(data.indices) || data.indices.length !== data.width * data.height) {
    throw new Error('Pattern grid data is missing or the wrong size.');
  }
  if (!Array.isArray(data.colors) || data.colors.length === 0) {
    throw new Error('Pattern has no colour palette.');
  }
  for (const c of data.colors) {
    if (
      !c ||
      !Number.isInteger(c.index) ||
      !Array.isArray(c.rgb) ||
      c.rgb.length !== 3 ||
      typeof c.symbol !== 'string'
    ) {
      throw new Error('Pattern colour palette is malformed.');
    }
  }
}
