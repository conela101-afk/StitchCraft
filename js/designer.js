// Manual pattern Designer: grid canvas with pencil/line/rect/fill/eyedropper/
// eraser tools, a thread-brand palette, undo/redo, canvas resize, and the
// same save/export surface as the wizard's Pattern step. Produces the exact
// same Pattern shape everything else in the app consumes, so render.js,
// pdfExport.js and patternIO.js are reused unmodified.

import { symbolFor, buildLegend } from './pattern.js';
import { renderColorChart, renderSymbolChart, chartCellFromEvent, canvasToPngBlob, renderLegendCanvas } from './render.js';
import { canvasesToPdf } from './pdfExport.js';
import { BRANDS } from './threadData.js';
import { rgbToHex } from './colorMath.js';
import { savePattern, saveProject, listPatterns, getPattern } from './db.js';
import { exportPatternJSON } from './patternIO.js';
import { exportPatternOXS } from './oxsIO.js';
import { composeTitledPage, downloadBlob, slugify } from './exportUtils.js';
import { navigate, onRoute } from './router.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);
const CELL_SIZE = 18;

const startCard = $('designerStartCard');
const workspace = $('designerWorkspace');
const newWInput = $('designerNewW');
const newHInput = $('designerNewH');
const aidaSelect = $('designerAidaSelect');
const newBtn = $('designerNewBtn');
const openSelect = $('designerOpenSelect');
const openBtn = $('designerOpenBtn');
const backBtn = $('designerBackBtn');
const statsEl = $('designerStats');
const toolsEl = $('designerTools');
const undoBtn = $('designerUndoBtn');
const redoBtn = $('designerRedoBtn');
const canvasWrap = $('designerCanvasWrap');
const brandSelect = $('designerBrandSelect');
const swatchFilter = $('designerSwatchFilter');
const paletteStrip = $('designerPaletteStrip');
const brandStrip = $('designerBrandStrip');
const resizeWInput = $('designerResizeW');
const resizeHInput = $('designerResizeH');
const resizeBtn = $('designerResizeBtn');
const nameInput = $('designerNameInput');
const saveBtn = $('designerSaveBtn');
const startProjectBtn = $('designerStartProjectBtn');
const exportPngBtn = $('designerExportPngBtn');
const exportPdfBtn = $('designerExportPdfBtn');
const exportJsonBtn = $('designerExportJsonBtn');
const exportOxsBtn = $('designerExportOxsBtn');
const viewColorBtn = $('designerViewColor');
const viewSymbolBtn = $('designerViewSymbol');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let width = 30;
let height = 30;
let indices = new Int32Array(width * height).fill(-1);
let palette = []; // [{index, rgb, symbol}]
let nextPaletteIndex = 0;
let brandKey = 'DMC';
let activeColorIndex = null;
let activeTool = 'pencil';
let previousDrawTool = 'pencil';
let aidaCount = 14;
let chartView = 'color';
let currentPatternId = null;
let undoStack = [];
let redoStack = [];

let dragging = false;
let strokeDiffs = null;
let dragStartCell = null;
let currentCanvas = null;

function cellIndex(col, row) {
  return row * width + col;
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function findPaletteByRgb(rgb) {
  return palette.find((p) => p.rgb[0] === rgb[0] && p.rgb[1] === rgb[1] && p.rgb[2] === rgb[2]);
}

function addOrSelectColor(rgb) {
  let entry = findPaletteByRgb(rgb);
  if (!entry) {
    entry = { index: nextPaletteIndex, rgb: [...rgb], symbol: symbolFor(nextPaletteIndex) };
    nextPaletteIndex += 1;
    palette.push(entry);
  }
  activeColorIndex = entry.index;
  renderPaletteStrip();
  renderBrandStrip();
  return entry;
}

function renderPaletteStrip() {
  paletteStrip.innerHTML = '';
  if (palette.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.style.margin = '0';
    hint.textContent = 'No colours yet — tap a brand colour below to add one.';
    paletteStrip.appendChild(hint);
    return;
  }
  for (const entry of palette) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = rgbToHex(entry.rgb);
    btn.title = entry.symbol;
    btn.classList.toggle('selected', entry.index === activeColorIndex);
    btn.addEventListener('click', () => {
      activeColorIndex = entry.index;
      renderPaletteStrip();
      renderBrandStrip();
    });
    paletteStrip.appendChild(btn);
  }
}

function renderBrandStrip() {
  const filter = swatchFilter.value.trim().toLowerCase();
  const swatches = BRANDS[brandKey].colors.filter(
    (c) => !filter || c.code.toLowerCase().includes(filter) || c.name.toLowerCase().includes(filter)
  );
  const frag = document.createDocumentFragment();
  for (const c of swatches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = rgbToHex(c.rgb);
    btn.title = `${c.code} — ${c.name}`;
    const existing = findPaletteByRgb(c.rgb);
    btn.classList.toggle('selected', !!existing && existing.index === activeColorIndex);
    btn.addEventListener('click', () => addOrSelectColor(c.rgb));
    frag.appendChild(btn);
  }
  brandStrip.innerHTML = '';
  brandStrip.appendChild(frag);
}

brandSelect.addEventListener('change', () => {
  brandKey = brandSelect.value;
  renderBrandStrip();
});
swatchFilter.addEventListener('input', renderBrandStrip);

// ---------------------------------------------------------------------------
// Canvas rendering + drawing tools
// ---------------------------------------------------------------------------

function livePattern() {
  return { width, height, indices, colors: palette };
}

function redrawCanvas(overlayCells) {
  const canvas = chartView === 'symbol' ? renderSymbolChart(livePattern(), CELL_SIZE) : renderColorChart(livePattern(), CELL_SIZE);
  if (overlayCells && overlayCells.length && activeColorIndex !== null) {
    const entry = palette.find((p) => p.index === activeColorIndex);
    if (entry) {
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = rgbToHex(entry.rgb);
      for (const cell of overlayCells) {
        const col = cell % width;
        const row = Math.floor(cell / width);
        ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
      ctx.restore();
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvasWrap.innerHTML = '';
  canvasWrap.appendChild(canvas);
  currentCanvas = canvas;
}

function bresenhamLine(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

function rectCells(x0, y0, x1, y1) {
  const points = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) points.push([x, y]);
  }
  return points;
}

function previewCellsFor(start, end) {
  const pts = activeTool === 'rect' ? rectCells(start.col, start.row, end.col, end.row) : bresenhamLine(start.col, start.row, end.col, end.row);
  return pts.map(([c, r]) => cellIndex(c, r));
}

function paintCell(cell, value, diffs) {
  if (indices[cell] === value) return;
  diffs.push({ cell, prev: indices[cell], next: value });
  indices[cell] = value;
}

function floodFill(startCell, newValue) {
  const target = indices[startCell];
  if (target === newValue) return [];
  const diffs = [];
  const stack = [startCell];
  const seen = new Uint8Array(width * height);
  while (stack.length) {
    const cell = stack.pop();
    if (seen[cell]) continue;
    seen[cell] = 1;
    if (indices[cell] !== target) continue;
    diffs.push({ cell, prev: indices[cell], next: newValue });
    indices[cell] = newValue;
    const col = cell % width;
    const row = Math.floor(cell / width);
    if (col > 0) stack.push(cell - 1);
    if (col < width - 1) stack.push(cell + 1);
    if (row > 0) stack.push(cell - width);
    if (row < height - 1) stack.push(cell + width);
  }
  return diffs;
}

function pickColorAt(cell) {
  const value = indices[cell];
  if (value < 0) return;
  activeColorIndex = value;
  renderPaletteStrip();
  renderBrandStrip();
  setTool(previousDrawTool);
}

function cellFromEvent(event) {
  return chartCellFromEvent(currentCanvas, { width, height }, CELL_SIZE, event);
}

function onPointerDown(e) {
  const pos = cellFromEvent(e);
  if (!pos) return;
  if (activeTool !== 'eyedropper' && activeColorIndex === null) {
    showToast('Pick a colour first.');
    return;
  }
  currentCanvas.setPointerCapture(e.pointerId);

  if (activeTool === 'eyedropper') {
    pickColorAt(pos.cell);
    return;
  }
  dragging = true;
  if (activeTool === 'pencil' || activeTool === 'eraser') {
    strokeDiffs = [];
    paintCell(pos.cell, activeTool === 'eraser' ? -1 : activeColorIndex, strokeDiffs);
    redrawCanvas();
  } else if (activeTool === 'line' || activeTool === 'rect') {
    dragStartCell = pos;
    redrawCanvas(previewCellsFor(pos, pos));
  } else if (activeTool === 'fill') {
    const diffs = floodFill(pos.cell, activeColorIndex);
    if (diffs.length) pushCommand(diffs);
    dragging = false;
    redrawCanvas();
    updateStats();
  }
}

function onPointerMove(e) {
  if (!dragging) return;
  const pos = cellFromEvent(e);
  if (!pos) return;
  if (activeTool === 'pencil' || activeTool === 'eraser') {
    paintCell(pos.cell, activeTool === 'eraser' ? -1 : activeColorIndex, strokeDiffs);
    redrawCanvas();
  } else if (activeTool === 'line' || activeTool === 'rect') {
    redrawCanvas(previewCellsFor(dragStartCell, pos));
  }
}

function commitDrag(e) {
  if (!dragging) return;
  dragging = false;
  if (activeTool === 'pencil' || activeTool === 'eraser') {
    if (strokeDiffs && strokeDiffs.length) pushCommand(strokeDiffs);
    strokeDiffs = null;
  } else if ((activeTool === 'line' || activeTool === 'rect') && dragStartCell) {
    const pos = cellFromEvent(e) || dragStartCell;
    const cells = previewCellsFor(dragStartCell, pos);
    const diffs = [];
    for (const cell of cells) {
      if (indices[cell] !== activeColorIndex) {
        diffs.push({ cell, prev: indices[cell], next: activeColorIndex });
        indices[cell] = activeColorIndex;
      }
    }
    if (diffs.length) pushCommand(diffs);
    dragStartCell = null;
    redrawCanvas();
  }
  updateStats();
}

function onPointerUp(e) {
  commitDrag(e);
}
function onPointerLeave(e) {
  if (dragging) commitDrag(e);
}

function setTool(tool) {
  if (tool !== 'eyedropper') previousDrawTool = tool;
  activeTool = tool;
  toolsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
}
toolsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tool]');
  if (!btn) return;
  setTool(btn.dataset.tool);
});

viewColorBtn.addEventListener('click', () => {
  chartView = 'color';
  viewColorBtn.classList.add('active');
  viewSymbolBtn.classList.remove('active');
  redrawCanvas();
});
viewSymbolBtn.addEventListener('click', () => {
  chartView = 'symbol';
  viewSymbolBtn.classList.add('active');
  viewColorBtn.classList.remove('active');
  redrawCanvas();
});

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

function pushCommand(diffs) {
  undoStack.push(diffs);
  redoStack = [];
  updateUndoRedoButtons();
}

function resetUndo() {
  undoStack = [];
  redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  const cmd = undoStack.pop();
  if (!cmd) return;
  for (const d of cmd) indices[d.cell] = d.prev;
  redoStack.push(cmd);
  updateUndoRedoButtons();
  redrawCanvas();
  updateStats();
}

function redo() {
  const cmd = redoStack.pop();
  if (!cmd) return;
  for (const d of cmd) indices[d.cell] = d.next;
  undoStack.push(cmd);
  updateUndoRedoButtons();
  redrawCanvas();
  updateStats();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length === 0;
  redoBtn.disabled = redoStack.length === 0;
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function updateStats() {
  let used = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] >= 0) used++;
  statsEl.innerHTML = `<span><strong>${width}×${height}</strong> stitches</span><span><strong>${palette.length}</strong> colours in palette</span><span><strong>${used}</strong> stitched</span>`;
}

// ---------------------------------------------------------------------------
// New / open / resize
// ---------------------------------------------------------------------------

function openWorkspace() {
  startCard.hidden = true;
  workspace.hidden = false;
}

function closeWorkspace() {
  workspace.hidden = true;
  startCard.hidden = false;
}

function startNewPattern() {
  width = Math.max(1, Math.min(400, parseInt(newWInput.value, 10) || 30));
  height = Math.max(1, Math.min(400, parseInt(newHInput.value, 10) || 30));
  aidaCount = parseInt(aidaSelect.value, 10);
  indices = new Int32Array(width * height).fill(-1);
  palette = [];
  nextPaletteIndex = 0;
  activeColorIndex = null;
  currentPatternId = null;
  chartView = 'color';
  nameInput.value = 'Untitled design';
  resizeWInput.value = width;
  resizeHInput.value = height;
  resetUndo();
  renderPaletteStrip();
  renderBrandStrip();
  openWorkspace();
  redrawCanvas();
  updateStats();
}

async function openExistingPattern(id) {
  const pattern = await getPattern(id);
  if (!pattern) {
    showToast('Could not find that pattern.');
    return;
  }
  width = pattern.width;
  height = pattern.height;
  aidaCount = pattern.aidaCount || 14;
  indices = Int32Array.from(pattern.indices);
  palette = pattern.colors.map((c) => ({ index: c.index, rgb: [...c.rgb], symbol: c.symbol }));
  nextPaletteIndex = palette.length ? Math.max(...palette.map((c) => c.index)) + 1 : 0;
  activeColorIndex = palette.length ? palette[0].index : null;
  currentPatternId = pattern.id;
  brandKey = pattern.brand && BRANDS[pattern.brand] ? pattern.brand : brandKey;
  brandSelect.value = brandKey;
  chartView = 'color';
  nameInput.value = pattern.name;
  resizeWInput.value = width;
  resizeHInput.value = height;
  resetUndo();
  renderPaletteStrip();
  renderBrandStrip();
  openWorkspace();
  redrawCanvas();
  updateStats();
}

newBtn.addEventListener('click', startNewPattern);
openBtn.addEventListener('click', () => {
  const id = openSelect.value;
  if (!id) {
    showToast('Choose a pattern to open.');
    return;
  }
  openExistingPattern(id);
});
backBtn.addEventListener('click', closeWorkspace);

resizeBtn.addEventListener('click', () => {
  const newW = Math.max(1, Math.min(400, parseInt(resizeWInput.value, 10) || width));
  const newH = Math.max(1, Math.min(400, parseInt(resizeHInput.value, 10) || height));
  const newIndices = new Int32Array(newW * newH).fill(-1);
  const copyW = Math.min(width, newW);
  const copyH = Math.min(height, newH);
  for (let row = 0; row < copyH; row++) {
    for (let col = 0; col < copyW; col++) {
      newIndices[row * newW + col] = indices[row * width + col];
    }
  }
  width = newW;
  height = newH;
  indices = newIndices;
  resetUndo(); // old commands reference cell indices under the previous width
  redrawCanvas();
  updateStats();
  showToast('Canvas resized.');
});

async function refreshOpenList() {
  const patterns = await listPatterns();
  openSelect.innerHTML =
    '<option value="">Choose a saved pattern…</option>' +
    patterns.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} (${p.width}×${p.height})</option>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

onRoute('designer', refreshOpenList);

// ---------------------------------------------------------------------------
// Save / start project / export
// ---------------------------------------------------------------------------

function currentPatternForSave() {
  return {
    id: currentPatternId || undefined,
    name: nameInput.value.trim() || 'Untitled design',
    width,
    height,
    aidaCount,
    indices: Array.from(indices),
    colors: palette,
    brand: brandKey,
    source: 'manual',
  };
}

saveBtn.addEventListener('click', async () => {
  try {
    const record = await savePattern(currentPatternForSave());
    currentPatternId = record.id;
    showToast('Saved to library.');
  } catch (err) {
    console.error(err);
    showToast('Could not save — storage may be unavailable.');
  }
});

startProjectBtn.addEventListener('click', async () => {
  try {
    const record = await savePattern(currentPatternForSave());
    currentPatternId = record.id;
    const project = await saveProject({ patternId: record.id, status: 'wip', startDate: Date.now() });
    showToast('Project started.');
    navigate(`projects/${project.id}`);
  } catch (err) {
    console.error(err);
    showToast('Could not start project — storage may be unavailable.');
  }
});

exportJsonBtn.addEventListener('click', () => {
  downloadBlob(exportPatternJSON(currentPatternForSave()), `${slugify(nameInput.value)}.json`);
});

exportOxsBtn.addEventListener('click', () => {
  downloadBlob(exportPatternOXS(currentPatternForSave()), `${slugify(nameInput.value)}.oxs`);
});

exportPngBtn.addEventListener('click', async () => {
  const canvas = chartView === 'symbol' ? renderSymbolChart(livePattern(), 24) : renderColorChart(livePattern(), 24);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, `${slugify(nameInput.value)}.png`);
});

exportPdfBtn.addEventListener('click', async () => {
  const chartBig = chartView === 'symbol' ? renderSymbolChart(livePattern(), 24) : renderColorChart(livePattern(), 24);
  const page1 = composeTitledPage(chartBig, nameInput.value || 'StitchCraft Pattern');
  const legend = buildLegend(livePattern(), brandKey);
  const meta = {
    title: `${nameInput.value} — Floss Legend`,
    widthStitches: width,
    heightStitches: height,
    aidaCount,
    sizeLabel: '',
    approxNote: !BRANDS[brandKey].complete ? 'Codes for this brand are approximate.' : '',
  };
  const page2 = renderLegendCanvas(legend, meta, brandKey);
  const blob = await canvasesToPdf([page1, page2], { pageWidthIn: 8.5, pageHeightIn: 11 });
  downloadBlob(blob, `${slugify(nameInput.value)}.pdf`);
});

// ---------------------------------------------------------------------------

renderBrandStrip();
