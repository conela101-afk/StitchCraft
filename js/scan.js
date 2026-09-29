// "Scan a printed chart" view: photo -> mark corners -> straighten -> check
// grid -> read cells -> review/assign threads -> save. The image maths lives
// in scanCore.js; this file is the UI around it. Produces the same Pattern
// shape as the wizard and Designer, so saving/exporting reuses their paths.

import { warpPerspective, estimateGrid, readCells } from './scanCore.js';
import { symbolFor } from './pattern.js';
import { renderColorChart, renderSymbolChart, chartCellFromEvent } from './render.js';
import { BRANDS, BRAND_NAMES } from './threadData.js';
import { matchInBrand } from './crosswalk.js';
import { rgbToHex } from './colorMath.js';
import { savePattern, saveProject } from './db.js';
import { exportPatternJSON } from './patternIO.js';
import { downloadBlob, slugify } from './exportUtils.js';
import { navigate, onRoute } from './router.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);
const CELL = 24;
const MAX_SRC = 2400;

const startCard = $('scanStartCard');
const cornersCard = $('scanCornersCard');
const gridCard = $('scanGridCard');
const reviewCard = $('scanReviewCard');
const cornersCanvas = $('scanCornersCanvas');
const gridCanvas = $('scanGridCanvas');
const chartCanvas = $('scanChartCanvas');
const colsInput = $('scanCols');
const rowsInput = $('scanRows');
const modeSelect = $('scanMode');
const maxInput = $('scanMaxClasses');
const sensInput = $('scanSensitivity');
const sensOut = $('scanSensitivityOut');
const whiteField = $('scanWhiteField');
const whiteBlank = $('scanWhiteBlank');
const classList = $('scanClassList');
const brandSelect = $('scanBrand');
const codesList = $('scanCodes');
const nameInput = $('scanName');
const aidaSelect = $('scanAida');

let srcImg = null; // {data,width,height} of the (downscaled) photo
let srcCanvas = null;
let corners = []; // [TL,TR,BR,BL] in srcCanvas pixels
let dragging = -1;
let rect = null; // straightened {data,width,height}
let rectCanvas = null;
let cols = 30;
let rows = 30;
let indices = new Int32Array(0);
let classes = []; // {id,count,rgb,sample,code}
let active = null; // class id | 'blank' | null
let chartView = 'symbol';
let savedId = null;

// ---------------------------------------------------------------------------
// Step 0: load photo
// ---------------------------------------------------------------------------

async function loadFile(file) {
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = Math.round(bmp.width * k);
    srcCanvas.height = Math.round(bmp.height * k);
    srcCanvas.getContext('2d').drawImage(bmp, 0, 0, srcCanvas.width, srcCanvas.height);
    srcImg = srcCanvas.getContext('2d').getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  } catch (err) {
    console.error(err);
    showToast('Could not open that image.');
    return;
  }
  const { width: w, height: h } = srcCanvas;
  const mx = w * 0.06;
  const my = h * 0.06;
  corners = [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
  savedId = null;
  rect = null;
  gridCard.hidden = true;
  reviewCard.hidden = true;
  cornersCard.hidden = false;
  drawCorners();
  cornersCard.scrollIntoView({ behavior: 'smooth' });
}

$('scanPickBtn').addEventListener('click', () => $('scanFileInput').click());
$('scanCameraBtn').addEventListener('click', () => $('scanCameraInput').click());
$('scanFileInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('scanCameraInput').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });

// ---------------------------------------------------------------------------
// Step 1: corners
// ---------------------------------------------------------------------------

function drawCorners() {
  const c = cornersCanvas;
  c.width = srcCanvas.width;
  c.height = srcCanvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  const r = Math.max(10, c.width / 45);
  ctx.lineWidth = Math.max(2, r / 5);
  ctx.strokeStyle = '#e0402c';
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(224,64,44,0.35)';
  for (const [x, y] of corners) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function pointerToSrc(e) {
  const b = cornersCanvas.getBoundingClientRect();
  return [((e.clientX - b.left) * cornersCanvas.width) / b.width, ((e.clientY - b.top) * cornersCanvas.height) / b.height];
}

cornersCanvas.addEventListener('pointerdown', (e) => {
  const [px, py] = pointerToSrc(e);
  let best = -1;
  let bd = Infinity;
  corners.forEach(([x, y], i) => {
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = i; }
  });
  if (bd < cornersCanvas.width / 8) {
    dragging = best;
    cornersCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});
cornersCanvas.addEventListener('pointermove', (e) => {
  if (dragging < 0) return;
  const [px, py] = pointerToSrc(e);
  corners[dragging] = [Math.min(cornersCanvas.width - 1, Math.max(0, px)), Math.min(cornersCanvas.height - 1, Math.max(0, py))];
  drawCorners();
});
const endDrag = () => { dragging = -1; };
cornersCanvas.addEventListener('pointerup', endDrag);
cornersCanvas.addEventListener('pointercancel', endDrag);

$('scanStraightenBtn').addEventListener('click', () => {
  try {
    rect = warpPerspective(srcImg, corners, 1400);
  } catch (err) {
    showToast('Those corners do not form a valid shape — re-place them.');
    return;
  }
  rectCanvas = document.createElement('canvas');
  rectCanvas.width = rect.width;
  rectCanvas.height = rect.height;
  rectCanvas.getContext('2d').putImageData(new ImageData(rect.data, rect.width, rect.height), 0, 0);

  const g = estimateGrid(rect);
  const hint = $('scanGridHint');
  if (g.cols && g.rows) {
    cols = g.cols;
    rows = g.rows;
    hint.textContent = `Detected about ${cols} × ${rows} stitches. The red grid should sit on the chart's cells — adjust the counts until it lines up.`;
  } else {
    hint.textContent = "Couldn't detect the grid automatically — enter the number of columns and rows (count them on the printed chart).";
  }
  colsInput.value = cols;
  rowsInput.value = rows;
  gridCard.hidden = false;
  reviewCard.hidden = true;
  drawGridOverlay();
  gridCard.scrollIntoView({ behavior: 'smooth' });
});

// ---------------------------------------------------------------------------
// Step 2: grid + read
// ---------------------------------------------------------------------------

function drawGridOverlay() {
  cols = Math.max(1, Math.min(400, parseInt(colsInput.value, 10) || 1));
  rows = Math.max(1, Math.min(400, parseInt(rowsInput.value, 10) || 1));
  const c = gridCanvas;
  c.width = rect.width;
  c.height = rect.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(rectCanvas, 0, 0);
  ctx.strokeStyle = 'rgba(224,64,44,0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= cols; x++) { const px = Math.round((x * rect.width) / cols) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, rect.height); }
  for (let y = 0; y <= rows; y++) { const py = Math.round((y * rect.height) / rows) + 0.5; ctx.moveTo(0, py); ctx.lineTo(rect.width, py); }
  ctx.stroke();
}

colsInput.addEventListener('input', () => rect && drawGridOverlay());
rowsInput.addEventListener('input', () => rect && drawGridOverlay());
sensInput.addEventListener('input', () => { sensOut.textContent = sensInput.value; });
modeSelect.addEventListener('change', () => {
  whiteField.hidden = modeSelect.value !== 'colors';
  sensInput.closest('.field').hidden = false;
});
$('scanRecropBtn').addEventListener('click', () => { cornersCard.scrollIntoView({ behavior: 'smooth' }); });

$('scanReadBtn').addEventListener('click', () => {
  if (!rect) return;
  drawGridOverlay();
  const mode = modeSelect.value;
  const res = readCells(rect, cols, rows, {
    mode,
    maxClasses: Math.max(2, parseInt(maxInput.value, 10) || 30),
    sensitivity: Number(sensInput.value) / 100,
    whiteIsBlank: whiteBlank.checked,
  });
  indices = res.indices;
  classes = res.classes.map((c) => ({ ...c, code: '' }));
  if (mode === 'colors') autoAssignCodes();
  active = null;
  chartView = mode === 'colors' ? 'color' : 'symbol';
  syncViewButtons();
  savedId = null;
  reviewCard.hidden = false;
  renderReview();
  if (!classes.length) showToast('No symbols found — check the grid alignment and chart type.', 4000);
  reviewCard.scrollIntoView({ behavior: 'smooth' });
});

// ---------------------------------------------------------------------------
// Step 3: review
// ---------------------------------------------------------------------------

function initBrands() {
  brandSelect.innerHTML = BRAND_NAMES.map((k) => `<option value="${k}">${BRANDS[k].label}${BRANDS[k].complete ? '' : ' (approx.)'}</option>`).join('');
  refreshCodeList();
}

function refreshCodeList() {
  codesList.id = 'scanCodes';
  codesList.innerHTML = BRANDS[brandSelect.value].colors.map((c) => `<option value="${c.code}">${c.name}</option>`).join('');
}

function findThread(code) {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  return BRANDS[brandSelect.value].colors.find((t) => t.code.toLowerCase() === c) || null;
}

function autoAssignCodes() {
  for (const c of classes) {
    const m = matchInBrand(c.rgb, brandSelect.value);
    if (m) c.code = m.code;
  }
}

function classRgb(c) {
  const t = findThread(c.code);
  if (t) return t.rgb;
  // Unassigned: spread hues so the colour view stays readable until threads are chosen.
  const h = (c.id * 47) % 360;
  const s = 0.55;
  const l = 0.6;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function recount() {
  const counts = new Map();
  for (const i of indices) if (i >= 0) counts.set(i, (counts.get(i) || 0) + 1);
  for (const c of classes) c.count = counts.get(c.id) || 0;
}

function thumb(c) {
  const t = document.createElement('canvas');
  t.width = t.height = 44;
  const cw = rect.width / cols;
  const ch = rect.height / rows;
  const [sx, sy] = c.sample;
  const ctx = t.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 44, 44);
  ctx.drawImage(rectCanvas, sx * cw, sy * ch, cw, ch, 0, 0, 44, 44);
  return t;
}

function renderClassList() {
  classList.innerHTML = '';
  const mk = (id, label, body) => {
    const row = document.createElement('div');
    row.className = 'scan-class' + (active === id ? ' active' : '');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'scanActive';
    radio.checked = active === id;
    radio.addEventListener('change', () => { active = id; renderClassList(); });
    row.append(radio, label, body);
    return row;
  };

  for (const c of classes.filter((k) => k.count > 0)) {
    const body = document.createElement('div');
    body.className = 'scan-class-body';
    const sym = document.createElement('strong');
    sym.textContent = symbolFor(c.id);
    const swatch = document.createElement('span');
    swatch.className = 'scan-swatch';
    swatch.style.background = rgbToHex(classRgb(c));
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('list', 'scanCodes');
    input.placeholder = 'Thread code';
    input.value = c.code;
    input.addEventListener('focus', () => { active = c.id; });
    input.addEventListener('input', () => {
      c.code = input.value.trim();
      swatch.style.background = rgbToHex(classRgb(c));
      drawChart();
    });
    const count = document.createElement('span');
    count.className = 'scan-count';
    count.textContent = `${c.count} st.`;
    const merge = document.createElement('select');
    merge.innerHTML = '<option value="">Merge into…</option>' +
      classes.filter((k) => k.id !== c.id && k.count > 0).map((k) => `<option value="${k.id}">${symbolFor(k.id)} ${k.code || ''}</option>`).join('');
    merge.addEventListener('change', () => {
      if (merge.value === '') return;
      const to = Number(merge.value);
      for (let i = 0; i < indices.length; i++) if (indices[i] === c.id) indices[i] = to;
      if (active === c.id) active = to;
      renderReview();
    });
    body.append(sym, swatch, input, count, merge);
    classList.appendChild(mk(c.id, thumb(c), body));
  }

  const eraseBody = document.createElement('div');
  eraseBody.className = 'scan-class-body';
  eraseBody.innerHTML = '<strong>Empty</strong><span class="scan-count">tap cells to clear them</span>';
  const blankThumb = document.createElement('div');
  classList.appendChild(mk('blank', blankThumb, eraseBody));
}

function currentPattern() {
  recount();
  const used = classes.filter((c) => c.count > 0);
  return {
    id: savedId || undefined,
    name: nameInput.value.trim() || 'Scanned pattern',
    width: cols,
    height: rows,
    aidaCount: Number(aidaSelect.value),
    indices,
    colors: used.map((c) => {
      const rgb = classRgb(c);
      return { index: c.id, rgb, sourceRgb: rgb, symbol: symbolFor(c.id), stitchCount: c.count };
    }),
    brand: brandSelect.value,
    source: 'scanned',
  };
}

function drawChart() {
  const p = currentPattern();
  const c = chartView === 'color' ? renderColorChart(p, CELL) : renderSymbolChart(p, CELL);
  chartCanvas.width = c.width;
  chartCanvas.height = c.height;
  chartCanvas.getContext('2d').drawImage(c, 0, 0);
}

function renderReview() {
  recount();
  renderClassList();
  drawChart();
}

function syncViewButtons() {
  $('scanViewSymbol').classList.toggle('active', chartView === 'symbol');
  $('scanViewColor').classList.toggle('active', chartView === 'color');
}
$('scanViewSymbol').addEventListener('click', () => { chartView = 'symbol'; syncViewButtons(); drawChart(); });
$('scanViewColor').addEventListener('click', () => { chartView = 'color'; syncViewButtons(); drawChart(); });

chartCanvas.addEventListener('click', (e) => {
  if (active === null) { showToast('Pick a row (or Empty) first, then tap cells.'); return; }
  const hit = chartCellFromEvent(chartCanvas, { width: cols, height: rows }, CELL, e);
  if (!hit) return;
  indices[hit.cell] = active === 'blank' ? -1 : active;
  renderReview();
});

brandSelect.addEventListener('change', () => {
  refreshCodeList();
  if (modeSelect.value === 'colors') autoAssignCodes();
  renderReview();
});

// ---------------------------------------------------------------------------
// Save / export
// ---------------------------------------------------------------------------

function warnIfUnassigned() {
  const missing = classes.filter((c) => c.count > 0 && !findThread(c.code)).length;
  if (missing) showToast(`${missing} symbol${missing > 1 ? 's have' : ' has'} no matching thread code yet.`, 3500);
}

async function ensureSaved() {
  if (savedId) return savedId;
  const rec = await savePattern(currentPattern());
  savedId = rec.id;
  return rec.id;
}

$('scanSaveBtn').addEventListener('click', async () => {
  try {
    warnIfUnassigned();
    await ensureSaved();
    showToast('Saved to library.');
  } catch (err) {
    console.error(err);
    showToast('Could not save — storage may be unavailable.');
  }
});

$('scanProjectBtn').addEventListener('click', async () => {
  try {
    const patternId = await ensureSaved();
    const project = await saveProject({ patternId, status: 'wip', startDate: Date.now() });
    showToast('Project started.');
    navigate(`projects/${project.id}`);
  } catch (err) {
    console.error(err);
    showToast('Could not start project — storage may be unavailable.');
  }
});

$('scanJsonBtn').addEventListener('click', () => {
  const p = currentPattern();
  downloadBlob(exportPatternJSON(p), `${slugify(p.name)}.json`);
});

initBrands();
onRoute('scan', () => {});
