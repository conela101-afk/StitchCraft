// Import/export of the .oxs (Open Cross Stitch) XML interchange format used
// by PCStitch, WinStitch, KXStitch, MacStitch and others — a documented,
// structured grid+palette format, so it's realistic to parse without OCR
// (unlike arbitrary bought-pattern PDFs).
//
// Schema reference (there's no single canonical spec; this follows the
// common shape shared by Ursa Software's OXS format and the real-world
// samples produced by the tools above):
//
//   <chart>
//     <format .../>
//     <properties oxsversion="1.0" software="..." chartwidth="W" chartheight="H"
//                 charttitle="..." author="..." stitchesperinch="N" palettecount="N"/>
//     <palette>
//       <palette_item index="0" number="cloth" name="cloth" color="RRGGBB"/>
//       <palette_item index="1" number="DMC 310" name="Black" color="000000" symbol="X"/>
//       ...
//     </palette>
//     <fullstitches>
//       <stitch x="0" y="0" palindex="1"/>
//       ...
//     </fullstitches>
//     <backstitches/>
//   </chart>
//
// Coordinates are 0-based. palindex 0 conventionally means "cloth"
// (background/unstitched) and is never referenced by a <stitch>.
// StitchCraft only reads/writes full stitches — backstitch, French knots,
// half/quarter stitches aren't part of this app's Pattern model, so an
// imported file's backstitches etc. are dropped silently, and export always
// writes an empty <backstitches/>.

import { symbolFor } from './pattern.js';
import { legendRowForBrand } from './crosswalk.js';
import { rgbToHex, hexToRgb } from './colorMath.js';

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function exportPatternOXS(pattern) {
  const brandKey = pattern.brand || 'DMC';
  const name = pattern.name || 'StitchCraft pattern';
  const aida = pattern.aidaCount || 14;

  const paletteXml = pattern.colors
    .map((c) => {
      const legend = legendRowForBrand(c.rgb, brandKey);
      const number = legend.code && legend.code !== '—' ? `${brandKey} ${legend.code}` : 'custom';
      return `    <palette_item index="${c.index + 1}" number="${xmlEscape(number)}" name="${xmlEscape(legend.name || '')}" color="${rgbToHex(c.rgb).slice(1).toUpperCase()}" symbol="${xmlEscape(c.symbol)}"/>`;
    })
    .join('\n');

  const stitchXml = [];
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const idx = pattern.indices[y * pattern.width + x];
      if (idx < 0) continue;
      stitchXml.push(`    <stitch x="${x}" y="${y}" palindex="${idx + 1}"/>`);
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<chart>
  <format comments01="Exported from StitchCraft"/>
  <properties oxsversion="1.0" software="StitchCraft" chartwidth="${pattern.width}" chartheight="${pattern.height}" charttitle="${xmlEscape(name)}" author="" stitchesperinch="${aida}" stitchesperinch_y="${aida}" palettecount="${pattern.colors.length + 1}"/>
  <palette>
    <palette_item index="0" number="cloth" name="cloth" color="FFFFFF"/>
${paletteXml}
  </palette>
  <fullstitches>
${stitchXml.join('\n')}
  </fullstitches>
  <backstitches/>
</chart>
`;
  return new Blob([xml], { type: 'application/xml' });
}

export async function importPatternOXS(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error('Could not read that file.');
  }

  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('That file is not valid XML.');
  }
  const chart = doc.querySelector('chart');
  if (!chart) {
    throw new Error('Not an .oxs cross-stitch file (missing a <chart> root element).');
  }

  const props = chart.querySelector('properties');
  const width = parseInt(props?.getAttribute('chartwidth') || '', 10);
  const height = parseInt(props?.getAttribute('chartheight') || '', 10);
  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error('OXS file is missing valid chart dimensions.');
  }
  const aidaCount = parseInt(props?.getAttribute('stitchesperinch') || '', 10) || null;
  const name = props?.getAttribute('charttitle') || 'Imported pattern';

  const paletteItems = Array.from(chart.querySelectorAll('palette > palette_item'));
  const palindexToIndex = new Map();
  const colors = [];
  let brand = null;
  for (const item of paletteItems) {
    const number = item.getAttribute('number') || '';
    if (number.trim().toLowerCase() === 'cloth') continue; // background, not a stitch colour
    const palindex = item.getAttribute('index');
    const rgb = hexToRgb(item.getAttribute('color') || '000000');
    const idx = colors.length;
    colors.push({ index: idx, rgb, symbol: symbolFor(idx), stitchCount: 0 });
    palindexToIndex.set(palindex, idx);
    const dmcMatch = number.match(/^DMC\b/i);
    if (dmcMatch && !brand) brand = 'DMC';
  }
  if (colors.length === 0) {
    throw new Error('OXS file has no usable colour palette.');
  }

  const indices = new Int32Array(width * height).fill(-1);
  for (const s of chart.querySelectorAll('fullstitches > stitch')) {
    const x = parseInt(s.getAttribute('x'), 10);
    const y = parseInt(s.getAttribute('y'), 10);
    const paletteIdx = palindexToIndex.get(s.getAttribute('palindex'));
    if (paletteIdx === undefined) continue;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= width || y < 0 || y >= height) continue;
    const cell = y * width + x;
    if (indices[cell] < 0) colors[paletteIdx].stitchCount++;
    indices[cell] = paletteIdx;
  }

  return {
    name,
    width,
    height,
    aidaCount,
    indices: Array.from(indices),
    colors: colors.filter((c) => c.stitchCount > 0),
    brand,
    source: 'imported',
  };
}
