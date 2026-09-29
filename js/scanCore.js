// Pure image-processing core for "scan a printed chart" (no DOM access, so it
// can be unit-tested under Node). Images are plain {data, width, height}
// objects in RGBA layout — the same shape as a canvas ImageData.
//
// Pipeline: perspective-straighten the photographed page (warpPerspective),
// estimate the grid from line periodicity (estimateGrid), then classify every
// cell either by colour or by symbol shape (readCells). Nothing here tries to
// be clever about OCR — cells are clustered by similarity and the UI asks the
// person to say which thread each cluster is.

// ---------------------------------------------------------------------------
// Perspective warp
// ---------------------------------------------------------------------------

/** Solve the 3x3 homography H mapping each `from` point to its `to` point. */
export function solveHomography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = gaussSolve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function gaussSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Corners are degenerate.');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * @param {{data,width,height}} src
 * @param {number[][]} corners - [TL, TR, BR, BL] in source pixel coordinates
 * @param {number} maxDim - longest side of the output
 */
export function warpPerspective(src, corners, maxDim = 1400) {
  const [tl, tr, br, bl] = corners;
  let W = (dist(tl, tr) + dist(bl, br)) / 2;
  let H = (dist(tl, bl) + dist(tr, br)) / 2;
  const k = Math.min(1, maxDim / Math.max(W, H));
  W = Math.max(8, Math.round(W * k));
  H = Math.max(8, Math.round(H * k));

  const M = solveHomography(
    [[0, 0], [W, 0], [W, H], [0, H]],
    corners,
  );
  const out = new Uint8ClampedArray(W * H * 4);
  const { data: s, width: sw, height: sh } = src;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = M[6] * px + M[7] * py + 1;
      const sx = (M[0] * px + M[1] * py + M[2]) / d - 0.5;
      const sy = (M[3] * px + M[4] * py + M[5]) / d - 0.5;
      const o = (y * W + x) * 4;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] =
          s[i00 + c] * (1 - fx) * (1 - fy) + s[i10 + c] * fx * (1 - fy) +
          s[i01 + c] * (1 - fx) * fy + s[i11 + c] * fx * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

// ---------------------------------------------------------------------------
// Grid estimation
// ---------------------------------------------------------------------------

export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Best repeating period (in px) of a 1-D "ink" profile, or null. */
function dominantPeriod(profile) {
  const n = profile.length;
  const r = 6;
  const hp = new Float64Array(n);
  let run = 0;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + profile[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n, i + r + 1);
    hp[i] = profile[i] - (prefix[b] - prefix[a]) / (b - a);
    run += hp[i] * hp[i];
  }
  if (run < 1e-6) return null;

  const maxLag = Math.floor(n / 3);
  const ac = new Float64Array(maxLag + 2);
  for (let l = 3; l <= maxLag + 1; l++) {
    let s = 0;
    let e = 0;
    for (let i = 0; i + l < n; i++) {
      s += hp[i] * hp[i + l];
      e += hp[i] * hp[i] + hp[i + l] * hp[i + l];
    }
    ac[l] = e > 0 ? (2 * s) / e : 0;
  }
  let best = 0;
  for (let l = 4; l <= maxLag; l++) best = Math.max(best, ac[l]);
  if (best < 0.15) return null;
  for (let l = 4; l <= maxLag; l++) {
    if (ac[l] >= best * 0.75 && ac[l] >= ac[l - 1] && ac[l] >= ac[l + 1]) return l;
  }
  return null;
}

/**
 * Guess the number of columns/rows in a straightened chart image from the
 * periodicity of its grid lines. Returns { cols, rows } (either may be null
 * when nothing periodic was found) — the UI lets the person correct it.
 */
export function estimateGrid(img) {
  const { data, width: W, height: H } = img;
  const colInk = new Float64Array(W);
  const rowInk = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const ink = 255 - luminance(data[o], data[o + 1], data[o + 2]);
      colInk[x] += ink;
      rowInk[y] += ink;
    }
  }
  for (let x = 0; x < W; x++) colInk[x] /= H;
  for (let y = 0; y < H; y++) rowInk[y] /= W;
  const px = dominantPeriod(colInk);
  const py = dominantPeriod(rowInk);
  return {
    cols: px ? Math.max(1, Math.round(W / px)) : null,
    rows: py ? Math.max(1, Math.round(H / py)) : null,
  };
}

// ---------------------------------------------------------------------------
// Cell reading
// ---------------------------------------------------------------------------

function otsu(lums) {
  const hist = new Array(256).fill(0);
  for (const l of lums) hist[Math.min(255, Math.max(0, Math.round(l)))]++;
  const total = lums.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

function median(arr) {
  arr.sort((a, b) => a - b);
  return arr[arr.length >> 1];
}

function cellBounds(cx, cy, cols, rows, W, H, margin) {
  const cw = W / cols;
  const ch = H / rows;
  return {
    x0: Math.round(cx * cw + cw * margin),
    x1: Math.round((cx + 1) * cw - cw * margin),
    y0: Math.round(cy * ch + ch * margin),
    y1: Math.round((cy + 1) * ch - ch * margin),
  };
}

/**
 * Erase grid lines from a binary ink image: any dark run longer than ~1.6
 * cells (horizontally or vertically) is a rule, not a symbol. Removed pixels
 * are dilated by one so anti-aliased fringes go too.
 */
function stripGridLines(ink, W, H, minRunX, minRunY) {
  const kill = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!ink[y * W + x]) { x++; continue; }
      let e = x;
      while (e < W && ink[y * W + e]) e++;
      if (e - x >= minRunX) for (let k = x; k < e; k++) kill[y * W + k] = 1;
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!ink[y * W + x]) { y++; continue; }
      let e = y;
      while (e < H && ink[e * W + x]) e++;
      if (e - y >= minRunY) for (let k = y; k < e; k++) kill[k * W + x] = 1;
      y = e;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!kill[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) out[yy * W + xx] = 1;
        }
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (out[i]) ink[i] = 0;
}

const BLOCKS = 10;

/** Median colour of a cell's inner area — robust to a symbol drawn on it. */
function cellColor(img, b) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const o = (y * img.width + x) * 4;
      rs.push(img.data[o]);
      gs.push(img.data[o + 1]);
      bs.push(img.data[o + 2]);
    }
  }
  if (!rs.length) return [255, 255, 255];
  return [median(rs), median(gs), median(bs)];
}

/**
 * Shape signature of the dark ink inside a cell, made shift/scale tolerant by
 * cropping to the ink's bounding box and resampling to BLOCKS×BLOCKS. Aspect
 * ratio is appended (weighted) so "—" and "|" don't collapse together.
 * Returns null for a blank cell.
 */
function cellShape(ink, W, b, minInk) {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  let count = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (ink[y * W + x]) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  if (count / area < minInk) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const v = new Float64Array(BLOCKS * BLOCKS + 20);
  const cnt = new Float64Array(BLOCKS * BLOCKS);
  for (let y = minY; y <= maxY; y++) {
    const by = Math.min(BLOCKS - 1, Math.floor(((y - minY) / bh) * BLOCKS));
    for (let x = minX; x <= maxX; x++) {
      const bx = Math.min(BLOCKS - 1, Math.floor(((x - minX) / bw) * BLOCKS));
      cnt[by * BLOCKS + bx]++;
      if (ink[y * W + x]) v[by * BLOCKS + bx]++;
    }
  }
  for (let i = 0; i < BLOCKS * BLOCKS; i++) v[i] = cnt[i] ? v[i] / cnt[i] : 0;
  const aw = bw / (b.x1 - b.x0);
  const ah = bh / (b.y1 - b.y0);
  for (let i = 0; i < 10; i++) {
    v[BLOCKS * BLOCKS + i] = aw;
    v[BLOCKS * BLOCKS + 10 + i] = ah;
  }
  return v;
}

const vecDist = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

// CIE76 ΔE in Lab — plenty for grouping printed flat colours.
function toLab([r, g, b]) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Leader clustering followed by a couple of reassignment passes, then merging
 * of the smallest clusters down to `maxClusters`.
 * @returns {{assign: Int32Array, centroids: Float64Array[]}}
 */
export function clusterVectors(vecs, distFn, threshold, maxClusters) {
  const centroids = [];
  const sizes = [];
  const assign = new Int32Array(vecs.length).fill(-1);

  const nearest = (v) => {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      if (!sizes[i]) continue;
      const d = distFn(v, centroids[i]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return [bi, bd];
  };
  const addTo = (ci, v) => {
    const n = sizes[ci]++;
    for (let k = 0; k < v.length; k++) centroids[ci][k] = (centroids[ci][k] * n + v[k]) / (n + 1);
  };

  for (let i = 0; i < vecs.length; i++) {
    if (!vecs[i]) continue;
    const [bi, bd] = nearest(vecs[i]);
    if (bi >= 0 && bd <= threshold) {
      assign[i] = bi;
      addTo(bi, vecs[i]);
    } else {
      centroids.push(Float64Array.from(vecs[i]));
      sizes.push(1);
      assign[i] = centroids.length - 1;
    }
  }

  const recompute = () => {
    for (let c = 0; c < centroids.length; c++) {
      sizes[c] = 0;
      centroids[c].fill(0);
    }
    for (let i = 0; i < vecs.length; i++) {
      if (assign[i] < 0) continue;
      const c = assign[i];
      sizes[c]++;
      for (let k = 0; k < vecs[i].length; k++) centroids[c][k] += vecs[i][k];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sizes[c]) for (let k = 0; k < centroids[c].length; k++) centroids[c][k] /= sizes[c];
    }
  };
  recompute();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < vecs.length; i++) {
      if (!vecs[i]) continue;
      assign[i] = nearest(vecs[i])[0];
    }
    recompute();
  }

  // Merge the smallest clusters into their nearest neighbour until within cap.
  let live = () => sizes.map((s, i) => [s, i]).filter(([s]) => s > 0);
  while (live().length > maxClusters) {
    const [, small] = live().sort((a, b) => a[0] - b[0])[0];
    let bi = -1;
    let bd = Infinity;
    for (const [, i] of live()) {
      if (i === small) continue;
      const d = distFn(centroids[small], centroids[i]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    for (let i = 0; i < assign.length; i++) if (assign[i] === small) assign[i] = bi;
    sizes[small] = 0;
    recompute();
  }

  // Renumber to 0..n-1, biggest first.
  const order = live().sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const remap = new Map(order.map((old, n) => [old, n]));
  for (let i = 0; i < assign.length; i++) if (assign[i] >= 0) assign[i] = remap.get(assign[i]);
  return { assign, centroids: order.map((i) => centroids[i]) };
}

/**
 * Classify every cell of a straightened chart.
 *
 * @param {{data,width,height}} img
 * @param {number} cols
 * @param {number} rows
 * @param {object} opts
 * @param {'symbols'|'colors'} opts.mode
 * @param {number} opts.maxClasses
 * @param {number} opts.sensitivity 0..1 — higher splits into more distinct classes
 * @param {boolean} opts.whiteIsBlank - colour mode: treat near-white cells as empty
 * @returns {{indices: Int32Array, classes: {id, count, rgb, sample:[number,number]}[]}}
 *   indices: -1 = blank cell.
 */
export function readCells(img, cols, rows, opts = {}) {
  const { mode = 'symbols', maxClasses = 30, sensitivity = 0.5, whiteIsBlank = true } = opts;
  const { data, width: W, height: H } = img;
  const total = cols * rows;

  let ink = null;
  if (mode === 'symbols') {
    const lums = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) lums[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    const thr = otsu(lums);
    ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) ink[i] = lums[i] < thr ? 1 : 0;
    stripGridLines(ink, W, H, Math.ceil((W / cols) * 1.6), Math.ceil((H / rows) * 1.6));
  }

  const margin = mode === 'symbols' ? 0.16 : 0.25;
  const colors = new Array(total);
  const vecs = new Array(total).fill(null);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const b = cellBounds(cx, cy, cols, rows, W, H, margin);
      if (b.x1 <= b.x0 || b.y1 <= b.y0) continue;
      const rgb = cellColor(img, b);
      colors[i] = rgb;
      if (mode === 'symbols') {
        vecs[i] = cellShape(ink, W, b, 0.03);
      } else {
        const white = luminance(...rgb) > 225 && Math.max(...rgb) - Math.min(...rgb) < 25;
        if (!(whiteIsBlank && white)) vecs[i] = toLab(rgb);
      }
    }
  }

  const s = Math.min(1, Math.max(0, sensitivity));
  const threshold = mode === 'symbols' ? 0.34 - s * 0.28 : 16 - s * 13;
  const distFn = mode === 'symbols' ? vecDist : labDist;
  const { assign, centroids } = clusterVectors(vecs, distFn, threshold, maxClasses);

  const classes = centroids.map((c, id) => ({ id, count: 0, rgb: [0, 0, 0], sample: [0, 0], _best: Infinity }));
  const sums = classes.map(() => [0, 0, 0]);
  for (let i = 0; i < total; i++) {
    const c = assign[i];
    if (c < 0) continue;
    const cls = classes[c];
    cls.count++;
    const rgb = colors[i];
    for (let k = 0; k < 3; k++) sums[c][k] += rgb[k];
    const d = distFn(vecs[i], centroids[c]);
    if (d < cls._best) {
      cls._best = d;
      cls.sample = [i % cols, Math.floor(i / cols)];
    }
  }
  for (const cls of classes) {
    // Symbol classes carry the cell's background colour, colour classes their own.
    cls.rgb = sums[cls.id].map((v) => Math.round(v / Math.max(1, cls.count)));
    delete cls._best;
  }
  return { indices: assign, classes };
}
