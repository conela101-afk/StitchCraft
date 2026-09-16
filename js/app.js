import { loadImageFromFile, imageToCanvas, cropAndResample, constrainAspect, applyBrightnessContrast, applyEdgeEnhancement, removeBackgroundByClick, getImageData, putImageData } from './imageProcessing.js';
import { AIDA_COUNTS, UNITS, PRESETS, sizeToGrid, gridToSize, formatLength, validateGrid, inchesToCm, cmToInches } from './sizing.js';
import { buildPattern, buildLegend } from './pattern.js';
import { renderColorChart, renderSymbolChart, renderLegendCanvas, canvasToPngBlob } from './render.js';
import { canvasesToPdf } from './pdfExport.js';
import { loadSettings, saveSettings } from './state.js';
import { BRANDS, BRAND_NAMES } from './threadData.js';
import { rgbToHex } from './colorMath.js';
import { savePattern, saveProject } from './db.js';
import { exportPatternJSON } from './patternIO.js';
import { exportPatternOXS } from './oxsIO.js';
import { extractPdfImages } from './pdfDigitize.js';
import { composeTitledPage, downloadBlob } from './exportUtils.js';
import { navigate } from './router.js';
import { showToast, hideToast } from './toast.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STEPS = ['upload', 'size', 'crop', 'adjust', 'pattern'];
let stepIndex = 0;

const settings = loadSettings();

const state = {
  originalCanvas: null,
  crop: null, // {x,y,w,h} in original canvas px
  workCanvas: null, // cropped, working-resolution canvas (pre-adjustment)
  baseImageData: null, // pristine pixel data at working resolution
  adjustedCanvas: null, // latest adjusted (brightness/contrast/edge/bg) canvas
  bgClicks: [], // [{x,y,tolerance}] in working-resolution px
  pattern: null,
  legend: null,
  chartView: 'symbol',
  savedPatternId: null,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const stepsNav = $('stepsNav');
const backBtn = $('backBtn');
const nextBtn = $('nextBtn');

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------

function furthestUnlockedStep() {
  if (!state.originalCanvas) return 0;
  return STEPS.length - 1; // once an image is loaded, all steps are browsable
}

function goToStep(index) {
  if (index < 0 || index >= STEPS.length) return;
  if (index > 0 && !state.originalCanvas) return;

  document.querySelectorAll('.step').forEach((el) => el.classList.remove('active'));
  $(`step-${STEPS[index]}`).classList.add('active');

  document.querySelectorAll('.steps-nav button').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
    btn.disabled = i > furthestUnlockedStep();
  });

  stepIndex = index;
  backBtn.hidden = index === 0;

  syncFooterForStep();

  if (STEPS[index] === 'crop') layoutCropBox();
  if (STEPS[index] === 'adjust') recomputeAdjustedPreview();
  if (STEPS[index] === 'pattern') generatePattern();

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function syncFooterForStep() {
  const step = STEPS[stepIndex];
  if (step === 'upload') {
    nextBtn.textContent = 'Choose a photo to begin';
    nextBtn.disabled = true;
  } else if (step === 'pattern') {
    nextBtn.textContent = 'Done';
    nextBtn.disabled = false;
  } else {
    nextBtn.textContent = 'Next';
    nextBtn.disabled = false;
  }
}

stepsNav.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-step]');
  if (!btn || btn.disabled) return;
  goToStep(STEPS.indexOf(btn.dataset.step));
});

backBtn.addEventListener('click', () => goToStep(stepIndex - 1));
nextBtn.addEventListener('click', () => {
  if (STEPS[stepIndex] === 'pattern') {
    showToast('Pattern ready — scroll up to export.');
    return;
  }
  if (STEPS[stepIndex] === 'crop') finalizeCrop();
  if (STEPS[stepIndex] === 'adjust') finalizeAdjust();
  goToStep(stepIndex + 1);
});

// ---------------------------------------------------------------------------
// STEP 1: Upload
// ---------------------------------------------------------------------------

const uploadZone = $('uploadZone');
const fileInput = $('fileInput');
const cameraInput = $('cameraInput');
const pdfPicker = $('pdfPicker');
const pdfPickerGrid = $('pdfPickerGrid');
const pdfFallback = $('pdfFallback');

$('pickFileBtn').addEventListener('click', () => fileInput.click());
$('cameraBtn').addEventListener('click', () => cameraInput.click());
fileInput.addEventListener('change', () => fileInput.files[0] && handleFile(fileInput.files[0]));
cameraInput.addEventListener('change', () => cameraInput.files[0] && handleFile(cameraInput.files[0]));

['dragover', 'dragenter'].forEach((evt) =>
  uploadZone.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  uploadZone.addEventListener(evt, (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
  })
);
uploadZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  pdfPicker.hidden = true;
  pdfFallback.hidden = true;
  pdfPickerGrid.innerHTML = '';

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    await handlePdfFile(file);
    return;
  }
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image or PDF file.');
    return;
  }
  await useImageFile(file);
}

async function useImageFile(file) {
  try {
    const img = await loadImageFromFile(file);
    state.originalCanvas = imageToCanvas(img, 1600);
    initCropFromAspect();
    $('cropImg').src = state.originalCanvas.toDataURL('image/png');
    goToStep(1); // -> size
  } catch (err) {
    console.error(err);
    showToast('Could not load that image.');
  }
}

const PDF_FALLBACK_MESSAGES = {
  vector: 'This looks like a vector-drawn pattern (grid lines, symbols and a legend, not a scanned image) — there’s no reliable automatic way to convert that into stitches. Try photographing a printed copy instead, or hand-copy it in the Designer using the pattern’s own legend.',
  'unsupported-filter': 'This PDF has an embedded page image, but in a format this app can’t decode (e.g. CCITT fax or JPEG2000). Try a photo or screenshot of the rendered page instead.',
  unparseable: 'Couldn’t confidently read this PDF’s structure (it may use a newer/compressed PDF format this app doesn’t parse). Try a photo or screenshot of the rendered page instead.',
};

async function handlePdfFile(file) {
  showToast('Analysing PDF pages…', 60000);
  let result;
  try {
    result = await extractPdfImages(file);
  } catch (err) {
    console.error(err);
    hideToast();
    showToast(err.message || 'Could not read that PDF.');
    return;
  }
  hideToast();

  const { images, reason } = result;
  if (images.length === 0) {
    pdfFallback.textContent = PDF_FALLBACK_MESSAGES[reason] || PDF_FALLBACK_MESSAGES.unparseable;
    pdfFallback.hidden = false;
    return;
  }
  if (images.length === 1) {
    await useImageFile(images[0]);
    return;
  }

  pdfPicker.hidden = false;
  for (const blob of images) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pattern-card';
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    thumbWrap.appendChild(img);
    btn.appendChild(thumbWrap);
    btn.addEventListener('click', () => useImageFile(blob));
    pdfPickerGrid.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// STEP 2: Size
// ---------------------------------------------------------------------------

const presetGrid = $('presetGrid');
const aidaSelect = $('aidaSelect');
const unitToggle = $('unitToggle');
const unitLabel = $('unitLabel');
const widthInput = $('widthInput');
const heightInput = $('heightInput');
const stitchWInput = $('stitchWInput');
const stitchHInput = $('stitchHInput');
const sizeWarnings = $('sizeWarnings');

PRESETS.forEach((preset) => {
  const btn = document.createElement('button');
  btn.className = 'preset-btn';
  btn.dataset.id = preset.id;
  btn.innerHTML = `${preset.label.split('(')[0].trim()}<div class="preset-size">${preset.widthIn}" × ${preset.heightIn}"</div>`;
  btn.addEventListener('click', () => applyPreset(preset));
  presetGrid.appendChild(btn);
});

function applyPreset(preset) {
  settings.widthIn = preset.widthIn;
  settings.heightIn = preset.heightIn;
  syncSizeInputsFromInches();
  recalcGridFromSize();
  updateAspectAndCropLock();
  document.querySelectorAll('.preset-btn').forEach((b) => b.classList.toggle('selected', b.dataset.id === preset.id));
}

function currentUnit() {
  return settings.unit;
}

function syncSizeInputsFromInches() {
  const unit = currentUnit();
  widthInput.value = (unit === UNITS.CM ? inchesToCm(settings.widthIn) : settings.widthIn).toFixed(2);
  heightInput.value = (unit === UNITS.CM ? inchesToCm(settings.heightIn) : settings.heightIn).toFixed(2);
}

function recalcGridFromSize() {
  const { stitchesW, stitchesH } = sizeToGrid(settings.widthIn, settings.heightIn, settings.aidaCount);
  stitchWInput.value = stitchesW;
  stitchHInput.value = stitchesH;
  renderSizeWarnings(stitchesW, stitchesH);
}

function recalcSizeFromGrid() {
  const stitchesW = parseInt(stitchWInput.value, 10) || 1;
  const stitchesH = parseInt(stitchHInput.value, 10) || 1;
  const { widthIn, heightIn } = gridToSize(stitchesW, stitchesH, settings.aidaCount);
  settings.widthIn = widthIn;
  settings.heightIn = heightIn;
  syncSizeInputsFromInches();
  renderSizeWarnings(stitchesW, stitchesH);
}

function renderSizeWarnings(stitchesW, stitchesH) {
  const warnings = validateGrid(stitchesW, stitchesH);
  sizeWarnings.innerHTML = warnings.map((w) => `<div class="warning-box">${w}</div>`).join('');
}

function updateAspectAndCropLock() {
  if (state.originalCanvas) {
    state.crop = constrainAspect(state.crop, settings.widthIn / settings.heightIn, state.originalCanvas.width, state.originalCanvas.height);
    layoutCropBox();
  }
}

aidaSelect.addEventListener('change', () => {
  settings.aidaCount = parseInt(aidaSelect.value, 10);
  recalcGridFromSize();
  saveSettings(settings);
});

unitToggle.addEventListener('change', () => {
  settings.unit = unitToggle.checked ? UNITS.CM : UNITS.INCH;
  unitLabel.textContent = settings.unit === UNITS.CM ? 'centimetres (toggle for inches)' : 'inches (toggle for cm)';
  syncSizeInputsFromInches();
  saveSettings(settings);
});

widthInput.addEventListener('input', () => {
  const v = parseFloat(widthInput.value) || 0.1;
  settings.widthIn = currentUnit() === UNITS.CM ? cmToInches(v) : v;
  recalcGridFromSize();
  updateAspectAndCropLock();
  saveSettings(settings);
});
heightInput.addEventListener('input', () => {
  const v = parseFloat(heightInput.value) || 0.1;
  settings.heightIn = currentUnit() === UNITS.CM ? cmToInches(v) : v;
  recalcGridFromSize();
  updateAspectAndCropLock();
  saveSettings(settings);
});
stitchWInput.addEventListener('input', () => {
  recalcSizeFromGrid();
  updateAspectAndCropLock();
});
stitchHInput.addEventListener('input', () => {
  recalcSizeFromGrid();
  updateAspectAndCropLock();
});

function initSizeUI() {
  aidaSelect.value = String(settings.aidaCount);
  unitToggle.checked = settings.unit === UNITS.CM;
  unitLabel.textContent = settings.unit === UNITS.CM ? 'centimetres (toggle for inches)' : 'inches (toggle for cm)';
  syncSizeInputsFromInches();
  recalcGridFromSize();
}

// ---------------------------------------------------------------------------
// STEP 3: Crop
// ---------------------------------------------------------------------------

const cropStage = $('cropStage');
const cropImg = $('cropImg');
const cropBox = $('cropBox');
const aspectLockToggle = $('aspectLockToggle');
const MIN_CROP = 20;

function initCropFromAspect() {
  const w = state.originalCanvas.width;
  const h = state.originalCanvas.height;
  const targetAspect = settings.widthIn / settings.heightIn;
  let cw = w * 0.8;
  let ch = cw / targetAspect;
  if (ch > h * 0.8) {
    ch = h * 0.8;
    cw = ch * targetAspect;
  }
  state.crop = { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

function layoutCropBox() {
  if (!state.crop || !cropImg.complete || !cropImg.naturalWidth) return;
  const displayedW = cropImg.clientWidth || cropImg.getBoundingClientRect().width;
  const scale = displayedW / cropImg.naturalWidth;
  cropBox.style.left = state.crop.x * scale + 'px';
  cropBox.style.top = state.crop.y * scale + 'px';
  cropBox.style.width = state.crop.w * scale + 'px';
  cropBox.style.height = state.crop.h * scale + 'px';
}
window.addEventListener('resize', () => {
  if (STEPS[stepIndex] === 'crop') layoutCropBox();
});
cropImg.addEventListener('load', () => {
  if (STEPS[stepIndex] === 'crop') layoutCropBox();
});

let dragMode = null; // 'move' | 'nw' | 'ne' | 'sw' | 'se'
let dragStart = null;
let cropStart = null;

function naturalScale() {
  const displayedW = cropImg.clientWidth || cropImg.getBoundingClientRect().width;
  return cropImg.naturalWidth / displayedW;
}

cropBox.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  dragMode = handle ? handle.dataset.handle : 'move';
  dragStart = { x: e.clientX, y: e.clientY };
  cropStart = { ...state.crop };
  cropBox.setPointerCapture(e.pointerId);
  e.preventDefault();
});

cropBox.addEventListener('pointermove', (e) => {
  if (!dragMode) return;
  const scale = naturalScale();
  const dx = (e.clientX - dragStart.x) * scale;
  const dy = (e.clientY - dragStart.y) * scale;
  const bw = state.originalCanvas.width;
  const bh = state.originalCanvas.height;
  const aspect = settings.widthIn / settings.heightIn;
  const locked = aspectLockToggle.checked;

  if (dragMode === 'move') {
    let x = cropStart.x + dx;
    let y = cropStart.y + dy;
    x = Math.max(0, Math.min(x, bw - cropStart.w));
    y = Math.max(0, Math.min(y, bh - cropStart.h));
    state.crop = { ...cropStart, x, y };
  } else {
    const anchors = {
      nw: { ax: cropStart.x + cropStart.w, ay: cropStart.y + cropStart.h },
      ne: { ax: cropStart.x, ay: cropStart.y + cropStart.h },
      sw: { ax: cropStart.x + cropStart.w, ay: cropStart.y },
      se: { ax: cropStart.x, ay: cropStart.y },
    };
    const { ax, ay } = anchors[dragMode];
    const mx = dragMode === 'nw' || dragMode === 'sw' ? cropStart.x + dx : cropStart.x + cropStart.w + dx;
    const my = dragMode === 'nw' || dragMode === 'ne' ? cropStart.y + dy : cropStart.y + cropStart.h + dy;

    let newW = Math.abs(mx - ax);
    let newH = locked ? newW / aspect : Math.abs(my - ay);
    newW = Math.max(MIN_CROP, newW);
    newH = Math.max(MIN_CROP, newH);

    let newX = dragMode === 'nw' || dragMode === 'sw' ? ax - newW : ax;
    let newY = dragMode === 'nw' || dragMode === 'ne' ? ay - newH : ay;

    // Clamp to bounds, re-deriving locked dimension if needed.
    if (newX < 0) { newW += newX; newX = 0; }
    if (newY < 0) { newH += newY; newY = 0; }
    if (newX + newW > bw) newW = bw - newX;
    if (newY + newH > bh) newH = bh - newY;
    if (locked) {
      newH = newW / aspect;
      if (newY + newH > bh) { newH = bh - newY; newW = newH * aspect; }
      if (dragMode === 'nw' || dragMode === 'sw') newX = ax - newW;
      if (dragMode === 'nw' || dragMode === 'ne') newY = ay - newH;
    }
    state.crop = { x: newX, y: newY, w: Math.max(MIN_CROP, newW), h: Math.max(MIN_CROP, newH) };
  }
  layoutCropBox();
});

function endDrag(e) {
  if (dragMode) {
    try { cropBox.releasePointerCapture(e.pointerId); } catch {}
  }
  dragMode = null;
}
cropBox.addEventListener('pointerup', endDrag);
cropBox.addEventListener('pointercancel', endDrag);

function finalizeCrop() {
  // no-op: state.crop already holds the final rect in natural px
}

// ---------------------------------------------------------------------------
// STEP 4: Adjust
// ---------------------------------------------------------------------------

const adjustCanvas = $('adjustPreviewCanvas');
const brightnessSlider = $('brightnessSlider');
const contrastSlider = $('contrastSlider');
const brightnessValue = $('brightnessValue');
const contrastValue = $('contrastValue');
const edgeToggle = $('edgeToggle');
const ditherToggle = $('ditherToggle');
const colorCountSlider = $('colorCountSlider');
const colorCountValue = $('colorCountValue');
const algorithmSelect = $('algorithmSelect');
const resetBgBtn = $('resetBgBtn');
const bgRemovedStatus = $('bgRemovedStatus');

const WORK_MAX_DIM = 480;

function buildWorkCanvas() {
  const c = state.crop;
  const scale = Math.min(1, WORK_MAX_DIM / Math.max(c.w, c.h));
  const outW = Math.max(1, Math.round(c.w * scale));
  const outH = Math.max(1, Math.round(c.h * scale));
  state.workCanvas = cropAndResample(state.originalCanvas, c, outW, outH);
  state.baseImageData = getImageData(state.workCanvas);
  state.bgClicks = [];
  bgRemovedStatus.textContent = 'None';
}

function recomputeAdjustedPreview() {
  if (!state.workCanvas) buildWorkCanvas();
  const w = state.workCanvas.width;
  const h = state.workCanvas.height;

  const imageData = new ImageData(new Uint8ClampedArray(state.baseImageData.data), w, h);
  applyBrightnessContrast(imageData, Number(brightnessSlider.value), Number(contrastSlider.value));
  if (edgeToggle.checked) applyEdgeEnhancement(imageData, 0.6);
  for (const click of state.bgClicks) {
    removeBackgroundByClick(imageData, click.x, click.y, click.tolerance);
  }

  adjustCanvas.width = w;
  adjustCanvas.height = h;
  adjustCanvas.style.width = Math.min(360, w) + 'px';
  putImageData(adjustCanvas, imageData);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  putImageData(outCanvas, new ImageData(new Uint8ClampedArray(imageData.data), w, h));
  state.adjustedCanvas = outCanvas;
}

brightnessSlider.addEventListener('input', () => {
  brightnessValue.textContent = brightnessSlider.value;
  recomputeAdjustedPreview();
});
contrastSlider.addEventListener('input', () => {
  contrastValue.textContent = contrastSlider.value;
  recomputeAdjustedPreview();
});
edgeToggle.addEventListener('change', recomputeAdjustedPreview);

adjustCanvas.addEventListener('click', (e) => {
  const rect = adjustCanvas.getBoundingClientRect();
  const scaleX = adjustCanvas.width / rect.width;
  const scaleY = adjustCanvas.height / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);
  state.bgClicks.push({ x, y, tolerance: 32 });
  bgRemovedStatus.textContent = `${state.bgClicks.length} region${state.bgClicks.length > 1 ? 's' : ''} removed`;
  recomputeAdjustedPreview();
});

resetBgBtn.addEventListener('click', () => {
  state.bgClicks = [];
  bgRemovedStatus.textContent = 'None';
  recomputeAdjustedPreview();
});

colorCountSlider.addEventListener('input', () => {
  colorCountValue.textContent = colorCountSlider.value;
  settings.colorCount = Number(colorCountSlider.value);
  saveSettings(settings);
});
algorithmSelect.addEventListener('change', () => {
  settings.algorithm = algorithmSelect.value;
  saveSettings(settings);
});
ditherToggle.addEventListener('change', () => {
  settings.dither = ditherToggle.checked;
  saveSettings(settings);
});

function finalizeAdjust() {
  recomputeAdjustedPreview();
}

// ---------------------------------------------------------------------------
// STEP 5: Pattern
// ---------------------------------------------------------------------------

const brandSelect = $('brandSelect');
const brandNote = $('brandNote');
const chartCanvas = $('chartCanvas');
const legendTable = $('legendTable');
const patternStats = $('patternStats');
const chartToggleBtns = document.querySelectorAll('#step-pattern .chart-toggle button');

chartToggleBtns.forEach((btn) =>
  btn.addEventListener('click', () => {
    chartToggleBtns.forEach((b) => b.classList.toggle('active', b === btn));
    state.chartView = btn.dataset.view;
    renderChart();
  })
);

brandSelect.addEventListener('change', () => {
  settings.brand = brandSelect.value;
  saveSettings(settings);
  updateBrandNote();
  if (state.pattern) {
    state.legend = buildLegend(state.pattern, settings.brand);
    renderLegend();
  }
});

function updateBrandNote() {
  const brand = BRANDS[settings.brand];
  if (!brand.complete) {
    brandNote.hidden = false;
    brandNote.textContent = `${brand.label} ships with a small starter colour set in this build (no full manufacturer chart was available) — codes are matched to the nearest colour and flagged "approx." where coverage is thin. DMC has the fullest catalogue.`;
  } else {
    brandNote.hidden = true;
  }
}

function generatePattern() {
  if (!state.adjustedCanvas) recomputeAdjustedPreview();
  const stitchesW = parseInt(stitchWInput.value, 10);
  const stitchesH = parseInt(stitchHInput.value, 10);

  showToast('Generating pattern…', 60000);
  setTimeout(() => {
    const gridCanvas = cropAndResample(state.adjustedCanvas, { x: 0, y: 0, w: state.adjustedCanvas.width, h: state.adjustedCanvas.height }, stitchesW, stitchesH);
    const gridData = getImageData(gridCanvas);
    state.pattern = buildPattern(gridData, settings.colorCount, settings.algorithm, settings.dither);
    state.legend = buildLegend(state.pattern, settings.brand);
    state.savedPatternId = null;

    brandSelect.value = settings.brand;
    updateBrandNote();
    renderChart();
    renderLegend();
    renderStats(stitchesW, stitchesH);
    hideToast();
  }, 30);
}

function renderStats(stitchesW, stitchesH) {
  const sizeLabel = `${formatLength(settings.widthIn, settings.unit)} × ${formatLength(settings.heightIn, settings.unit)}`;
  patternStats.innerHTML = `
    <span><strong>${stitchesW}×${stitchesH}</strong> stitches</span>
    <span><strong>${settings.aidaCount}</strong> count</span>
    <span><strong>${sizeLabel}</strong></span>
    <span><strong>${state.pattern.colors.length}</strong> colours</span>
  `;
}

function renderChart() {
  if (!state.pattern) return;
  const canvas = state.chartView === 'symbol' ? renderSymbolChart(state.pattern, 20) : renderColorChart(state.pattern, 18);
  chartCanvas.width = canvas.width;
  chartCanvas.height = canvas.height;
  chartCanvas.getContext('2d').drawImage(canvas, 0, 0);
}

function renderLegend() {
  legendTable.innerHTML = state.legend
    .map(
      (row) => `
    <tr>
      <td><div class="legend-swatch" style="background:${rgbToHex(row.rgb)}"></div></td>
      <td class="legend-symbol">${row.symbol}</td>
      <td>
        ${row.threadCode && row.threadCode !== '—' ? row.threadCode : '<em>no code</em>'} — ${row.threadName}
        ${row.approximate ? '<div class="legend-approx">approx. match</div>' : ''}
      </td>
      <td>${row.stitchCount} st.<br />~${row.skeins} skein${row.skeins > 1 ? 's' : ''}</td>
    </tr>`
    )
    .join('');
}

function wizardPatternRecord() {
  return {
    name: `Pattern ${new Date().toLocaleDateString()}`,
    width: state.pattern.width,
    height: state.pattern.height,
    aidaCount: settings.aidaCount,
    indices: state.pattern.indices,
    colors: state.pattern.colors,
    brand: settings.brand,
    source: 'photo',
  };
}

async function ensurePatternSaved() {
  if (state.savedPatternId) return state.savedPatternId;
  const record = await savePattern(wizardPatternRecord());
  state.savedPatternId = record.id;
  return record.id;
}

$('saveToLibraryBtn').addEventListener('click', async () => {
  if (!state.pattern) return;
  try {
    await ensurePatternSaved();
    showToast('Saved to library.');
  } catch (err) {
    console.error(err);
    showToast('Could not save — storage may be unavailable.');
  }
});

$('startProjectBtn').addEventListener('click', async () => {
  if (!state.pattern) return;
  try {
    const patternId = await ensurePatternSaved();
    const project = await saveProject({ patternId, status: 'wip', startDate: Date.now() });
    showToast('Project started.');
    navigate(`projects/${project.id}`);
  } catch (err) {
    console.error(err);
    showToast('Could not start project — storage may be unavailable.');
  }
});

$('exportJsonBtn').addEventListener('click', () => {
  if (!state.pattern) return;
  downloadBlob(exportPatternJSON(wizardPatternRecord()), 'stitchcraft-pattern.json');
});

$('exportOxsBtn').addEventListener('click', () => {
  if (!state.pattern) return;
  downloadBlob(exportPatternOXS(wizardPatternRecord()), 'stitchcraft-pattern.oxs');
});

$('exportPngBtn').addEventListener('click', async () => {
  if (!state.pattern) return;
  const canvas = state.chartView === 'symbol' ? renderSymbolChart(state.pattern, 24) : renderColorChart(state.pattern, 24);
  const blob = await canvasToPngBlob(canvas);
  downloadBlob(blob, 'stitchcraft-pattern.png');
});

$('exportPdfBtn').addEventListener('click', async () => {
  if (!state.pattern) return;
  showToast('Building PDF…', 60000);
  try {
    const chartCanvasBig = state.chartView === 'symbol' ? renderSymbolChart(state.pattern, 24) : renderColorChart(state.pattern, 24);
    const page1 = composeTitledPage(chartCanvasBig, 'StitchCraft Pattern — Chart');
    const meta = {
      title: 'StitchCraft Pattern — Floss Legend',
      widthStitches: state.pattern.width,
      heightStitches: state.pattern.height,
      aidaCount: settings.aidaCount,
      sizeLabel: `${formatLength(settings.widthIn, settings.unit)} × ${formatLength(settings.heightIn, settings.unit)}`,
      approxNote: !BRANDS[settings.brand].complete
        ? 'Codes for this brand are approximate — see in-app note.'
        : '',
    };
    const page2 = renderLegendCanvas(state.legend, meta, settings.brand);
    const blob = await canvasesToPdf([page1, page2], { pageWidthIn: 8.5, pageHeightIn: 11 });
    downloadBlob(blob, 'stitchcraft-pattern.pdf');
  } finally {
    hideToast();
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initFromSettings() {
  initSizeUI();
  colorCountSlider.value = settings.colorCount;
  colorCountValue.textContent = settings.colorCount;
  algorithmSelect.value = settings.algorithm;
  ditherToggle.checked = settings.dither;
  brandSelect.value = settings.brand;
}

initFromSettings();
goToStep(0);

// PWA: service worker + install prompt
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

let deferredInstallPrompt = null;
const installBtn = $('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
});
