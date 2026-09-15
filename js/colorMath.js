// Colour space conversion and perceptual distance (CIEDE2000).
// Pure functions, no dependencies.

const D65 = { x: 95.047, y: 100.0, z: 108.883 };

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function rgbToXyz([r, g, b]) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  return [x * 100, y * 100, z * 100];
}

function xyzToLabF(t) {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

export function xyzToLab([x, y, z]) {
  const fx = xyzToLabF(x / D65.x);
  const fy = xyzToLabF(y / D65.y);
  const fz = xyzToLabF(z / D65.z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

export function xyzToRgb([x, y, z]) {
  const xn = x / 100, yn = y / 100, zn = z / 100;
  const rl = xn * 3.2404542 + yn * -1.5371385 + zn * -0.4985314;
  const gl = xn * -0.9692660 + yn * 1.8760108 + zn * 0.0415560;
  const bl = xn * 0.0556434 + yn * -0.2040259 + zn * 1.0572252;
  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

function labFInv(t) {
  const delta = 6 / 29;
  return t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);
}

export function labToXyz([L, a, b]) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  return [labFInv(fx) * D65.x, labFInv(fy) * D65.y, labFInv(fz) * D65.z];
}

export function labToRgb(lab) {
  return xyzToRgb(labToXyz(lab));
}

// CIEDE2000 colour difference between two Lab colours.
// Reference: Sharma, Wu, Dalal (2005).
export function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const kL = 1, kC = 1, kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const C7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + Math.pow(25, 7))));

  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const h1p = (Math.atan2(b1, a1p) * 180) / Math.PI + (Math.atan2(b1, a1p) < 0 ? 360 : 0);
  const h2p = (Math.atan2(b2, a2p) * 180) / Math.PI + (Math.atan2(b2, a2p) < 0 ? 360 : 0);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;

  const dE = Math.sqrt(
    Math.pow(dLp / (kL * SL), 2) +
      Math.pow(dCp / (kC * SC), 2) +
      Math.pow(dHp / (kH * SH), 2) +
      RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  );

  return dE;
}

// Convenience: perceptual distance directly between two sRGB triples.
export function rgbDistance(rgb1, rgb2) {
  return ciede2000(rgbToLab(rgb1), rgbToLab(rgb2));
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

// Find the nearest colour (by CIEDE2000) in a palette. palette: [{rgb:[r,g,b], ...}]
// Precomputed Lab values are cached on the object under __lab to avoid recomputation.
export function nearestInPalette(rgb, palette) {
  const lab = rgbToLab(rgb);
  let best = null;
  let bestDist = Infinity;
  for (const entry of palette) {
    if (!entry.__lab) entry.__lab = rgbToLab(entry.rgb);
    const d = ciede2000(lab, entry.__lab);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }
  return { entry: best, distance: bestDist };
}
