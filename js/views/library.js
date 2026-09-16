// Library view: browse, open, duplicate, delete, export and import saved
// patterns. "Open" expands an inline detail panel rather than routing
// elsewhere, since the Designer isn't the only place a saved pattern is
// useful yet.

import { listPatterns, deletePattern, savePattern, saveProject, getPattern } from '../db.js';
import { renderColorChart, renderSymbolChart, renderLegendCanvas, canvasToPngBlob } from '../render.js';
import { canvasesToPdf } from '../pdfExport.js';
import { buildLegend } from '../pattern.js';
import { exportPatternJSON, importPatternJSON } from '../patternIO.js';
import { composeTitledPage, downloadBlob } from '../exportUtils.js';
import { navigate } from '../router.js';
import { showToast } from '../toast.js';
import { BRANDS } from '../threadData.js';

const grid = document.getElementById('libraryGrid');
const emptyEl = document.getElementById('libraryEmpty');
const detailEl = document.getElementById('libraryDetail');
const importBtn = document.getElementById('importPatternBtn');
const importInput = document.getElementById('importPatternInput');

let openDetailId = null;

const THUMB_MAX_PX = 140;

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pattern';
}

export async function renderLibrary() {
  const patterns = await listPatterns();
  emptyEl.hidden = patterns.length > 0;
  grid.innerHTML = '';
  for (const pattern of patterns) {
    grid.appendChild(buildCard(pattern));
  }
  if (openDetailId && patterns.some((p) => p.id === openDetailId)) {
    await renderDetail(openDetailId);
  } else {
    openDetailId = null;
    detailEl.innerHTML = '';
  }
}

function actionBtn(label, onClick, danger = false) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (danger) btn.classList.add('danger');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function buildCard(pattern) {
  const card = document.createElement('div');
  card.className = 'pattern-card';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';
  const cellSize = Math.max(1, Math.floor(THUMB_MAX_PX / Math.max(pattern.width, pattern.height, 1)));
  thumbWrap.appendChild(renderColorChart(pattern, cellSize));
  card.appendChild(thumbWrap);

  const name = document.createElement('div');
  name.className = 'pattern-name';
  name.textContent = pattern.name;
  card.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'pattern-meta';
  meta.textContent = `${pattern.width}×${pattern.height} · ${pattern.colors.length} colours`;
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.appendChild(
    actionBtn('Open', async () => {
      openDetailId = pattern.id;
      await renderDetail(pattern.id);
      detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    })
  );
  actions.appendChild(actionBtn('Duplicate', () => duplicatePattern(pattern)));
  actions.appendChild(actionBtn('Export', () => exportJson(pattern)));
  actions.appendChild(actionBtn('Delete', () => removePattern(pattern.id), true));
  card.appendChild(actions);

  return card;
}

async function duplicatePattern(pattern) {
  await savePattern({
    name: `${pattern.name} (copy)`,
    width: pattern.width,
    height: pattern.height,
    aidaCount: pattern.aidaCount,
    indices: pattern.indices,
    colors: pattern.colors,
    brand: pattern.brand,
    source: pattern.source,
  });
  showToast('Pattern duplicated.');
  renderLibrary();
}

function exportJson(pattern) {
  downloadBlob(exportPatternJSON(pattern), `${slug(pattern.name)}.json`);
}

async function removePattern(id) {
  if (!confirm('Delete this pattern? This cannot be undone.')) return;
  await deletePattern(id);
  if (openDetailId === id) {
    openDetailId = null;
    detailEl.innerHTML = '';
  }
  showToast('Pattern deleted.');
  renderLibrary();
}

function primaryBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function secondaryBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

async function renderDetail(id) {
  const pattern = await getPattern(id);
  if (!pattern) return;
  const brandKey = pattern.brand && BRANDS[pattern.brand] ? pattern.brand : 'DMC';
  const legend = buildLegend(pattern, brandKey);

  detailEl.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'detail-panel';

  const back = document.createElement('a');
  back.href = '#';
  back.className = 'back-link';
  back.textContent = '← Close';
  back.addEventListener('click', (e) => {
    e.preventDefault();
    openDetailId = null;
    detailEl.innerHTML = '';
  });
  panel.appendChild(back);

  const h2 = document.createElement('h2');
  h2.textContent = pattern.name;
  panel.appendChild(h2);

  const stats = document.createElement('div');
  stats.className = 'stat-strip';
  stats.innerHTML = `<span><strong>${pattern.width}×${pattern.height}</strong> stitches</span><span><strong>${pattern.colors.length}</strong> colours</span><span><strong>${brandKey}</strong> floss</span>`;
  panel.appendChild(stats);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'chart-scroll';
  chartWrap.appendChild(renderSymbolChart(pattern, 18));
  panel.appendChild(chartWrap);

  const actions = document.createElement('div');
  actions.className = 'export-row';
  actions.appendChild(
    primaryBtn('Start a project', async () => {
      const project = await saveProject({ patternId: pattern.id, status: 'wip', startDate: Date.now() });
      navigate(`projects/${project.id}`);
    })
  );
  actions.appendChild(
    secondaryBtn('Download PNG', async () => {
      const blob = await canvasToPngBlob(renderSymbolChart(pattern, 24));
      downloadBlob(blob, `${slug(pattern.name)}.png`);
    })
  );
  actions.appendChild(
    secondaryBtn('Download PDF', async () => {
      const page1 = composeTitledPage(renderSymbolChart(pattern, 24), pattern.name);
      const meta = {
        title: `${pattern.name} — Floss Legend`,
        widthStitches: pattern.width,
        heightStitches: pattern.height,
        aidaCount: pattern.aidaCount || '—',
        sizeLabel: '',
        approxNote: !BRANDS[brandKey].complete ? 'Codes for this brand are approximate.' : '',
      };
      const page2 = renderLegendCanvas(legend, meta, brandKey);
      const blob = await canvasesToPdf([page1, page2], { pageWidthIn: 8.5, pageHeightIn: 11 });
      downloadBlob(blob, `${slug(pattern.name)}.pdf`);
    })
  );
  actions.appendChild(secondaryBtn('Export .json', () => exportJson(pattern)));
  panel.appendChild(actions);

  detailEl.appendChild(panel);
}

importBtn.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const record = await importPatternJSON(file);
    await savePattern(record);
    showToast('Pattern imported.');
    renderLibrary();
  } catch (err) {
    showToast(err.message || 'Could not import that pattern.');
  } finally {
    importInput.value = '';
  }
});
