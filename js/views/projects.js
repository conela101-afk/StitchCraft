// Projects view: the WIP/FO tracker. A list grouped by status, and a detail
// panel per project with a tap-to-mark stitch chart, status changes, notes
// and a progress-photo log.
//
// A project doesn't have to be backed by an in-app Pattern — someone
// logging a kit they're stitching from a printed leaflet still wants to
// track it. Those projects have no patternId and fall back to a simpler
// %-or-stitch-count progress input instead of the tap-to-mark chart, which
// needs real grid dimensions to work from.

import { listProjects, getProject, updateProject, deleteProject, addProjectPhoto, getPattern, saveProject } from '../db.js';
import { renderTrackerChart, chartCellFromEvent, renderColorChart } from '../render.js';
import { navigate, onRoute } from '../router.js';
import { showToast } from '../toast.js';

const listPanel = document.getElementById('projectsListPanel');
const detailPanel = document.getElementById('projectDetailPanel');
const emptyEl = document.getElementById('projectsEmpty');
const groupsEl = document.getElementById('projectGroups');

const newProjectToggleBtn = document.getElementById('newProjectToggleBtn');
const newProjectForm = document.getElementById('newProjectForm');
const newProjectNameInput = document.getElementById('newProjectName');
const newProjectPhotoInput = document.getElementById('newProjectPhoto');
const newProjectStatusSelect = document.getElementById('newProjectStatus');
const newProjectNotesInput = document.getElementById('newProjectNotes');
const newProjectCreateBtn = document.getElementById('newProjectCreateBtn');
const newProjectCancelBtn = document.getElementById('newProjectCancelBtn');

const STATUSES = [
  { key: 'stash', label: 'Stash' },
  { key: 'wip', label: 'WIP' },
  { key: 'fo', label: 'FO' },
  { key: 'frogged', label: 'Frogged' },
  { key: 'gifted', label: 'Gifted' },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

const CARD_THUMB_PX = 56;
const CHART_CELL_PX = 18;

function fmtDate(ts) {
  return ts ? new Date(ts).toLocaleDateString() : '—';
}

function progressLabel(progress) {
  if (!progress) return '0% done';
  if (progress.mode === 'stitches') {
    if (progress.total) {
      const pct = Math.round((100 * progress.value) / progress.total);
      return `${pct}% done`;
    }
    return `${progress.value || 0} stitches`;
  }
  return `${progress.value || 0}% done`;
}

function progressPercent(progress) {
  if (!progress) return 0;
  if (progress.mode === 'stitches') {
    return progress.total ? Math.round((100 * progress.value) / progress.total) : null;
  }
  return progress.value || 0;
}

// ---------------------------------------------------------------------------
// New-project form
// ---------------------------------------------------------------------------

function resetNewProjectForm() {
  newProjectNameInput.value = '';
  newProjectPhotoInput.value = '';
  newProjectStatusSelect.value = 'stash';
  newProjectNotesInput.value = '';
}

newProjectToggleBtn.addEventListener('click', () => {
  newProjectForm.hidden = !newProjectForm.hidden;
});
newProjectCancelBtn.addEventListener('click', () => {
  newProjectForm.hidden = true;
  resetNewProjectForm();
});
newProjectCreateBtn.addEventListener('click', async () => {
  const name = newProjectNameInput.value.trim();
  if (!name) {
    showToast('Give the project a name.');
    return;
  }
  const file = newProjectPhotoInput.files[0];
  const status = newProjectStatusSelect.value;
  const now = Date.now();
  const project = await saveProject({
    name,
    referencePhoto: file || undefined,
    status,
    notes: newProjectNotesInput.value.trim(),
    startDate: status === 'wip' ? now : null,
    finishDate: status === 'fo' ? now : null,
    progress: { mode: 'percent', value: 0, total: null },
  });
  resetNewProjectForm();
  newProjectForm.hidden = true;
  navigate(`projects/${project.id}`);
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function renderList() {
  detailPanel.hidden = true;
  listPanel.hidden = false;

  const projects = await listProjects();
  emptyEl.hidden = projects.length > 0;
  groupsEl.innerHTML = '';
  if (projects.length === 0) return;

  const byStatus = new Map(STATUSES.map((s) => [s.key, []]));
  for (const p of projects) {
    if (!byStatus.has(p.status)) byStatus.set(p.status, []);
    byStatus.get(p.status).push(p);
  }

  for (const { key, label } of STATUSES) {
    const items = byStatus.get(key) || [];
    if (items.length === 0) continue;
    const group = document.createElement('div');
    group.className = 'project-group';
    const h3 = document.createElement('h3');
    h3.textContent = `${label} (${items.length})`;
    group.appendChild(h3);
    for (const project of items) {
      group.appendChild(await buildProjectCard(project));
    }
    groupsEl.appendChild(group);
  }
}

function buildThumbForProject(project) {
  if (project.referencePhoto) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(project.referencePhoto);
    img.alt = '';
    return img;
  }
  const placeholder = document.createElement('span');
  placeholder.className = 'thumb-placeholder';
  placeholder.textContent = '🧵';
  return placeholder;
}

async function buildProjectCard(project) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'project-card';
  card.addEventListener('click', () => navigate(`projects/${project.id}`));

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'thumb-wrap';

  const info = document.createElement('div');
  info.className = 'project-info';

  const name = document.createElement('div');
  name.className = 'pattern-name';

  let pct = null;
  let pctLabel = '';

  if (project.patternId) {
    const pattern = await getPattern(project.patternId);
    if (pattern) {
      const cellSize = Math.max(1, Math.floor(CARD_THUMB_PX / Math.max(pattern.width, pattern.height, 1)));
      thumbWrap.appendChild(renderColorChart(pattern, cellSize));
      pct = Math.round((100 * project.stitchedCells.length) / (pattern.width * pattern.height));
      pctLabel = `${pct}% done`;
    }
    name.textContent = pattern ? pattern.name : 'Pattern removed';
  } else {
    thumbWrap.appendChild(buildThumbForProject(project));
    name.textContent = project.name || 'Untitled project';
    pct = progressPercent(project.progress);
    pctLabel = progressLabel(project.progress);
  }
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'pattern-meta';
  meta.innerHTML = `<span class="status-pill ${project.status}">${STATUS_LABEL[project.status] || project.status}</span>${pctLabel ? ' · ' + pctLabel : ''}`;
  info.appendChild(meta);

  if (pct !== null) {
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    const fill = document.createElement('span');
    fill.style.width = `${Math.min(100, pct)}%`;
    bar.appendChild(fill);
    info.appendChild(bar);
  }

  card.appendChild(thumbWrap);
  card.appendChild(info);
  return card;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

let currentProject = null;
let currentPattern = null;
let stitchedSet = new Set();
let chartView = 'symbol';
let summaryEl = null;
let chartWrapEl = null;

async function renderDetail(id) {
  listPanel.hidden = true;
  detailPanel.hidden = false;
  detailPanel.innerHTML = '<div class="card"><p class="hint" style="margin:0;">Loading…</p></div>';

  const project = await getProject(id);
  if (!project) {
    detailPanel.innerHTML = '<div class="card"><p class="hint" style="margin:0;">Project not found.</p></div>';
    return;
  }
  const pattern = project.patternId ? await getPattern(project.patternId) : null;

  currentProject = project;
  currentPattern = pattern;
  stitchedSet = new Set(project.stitchedCells);
  chartView = 'symbol';

  paintDetail();
}

function buildStatusRow(project) {
  const statusRow = document.createElement('div');
  statusRow.className = 'status-choices';
  for (const { key, label } of STATUSES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.classList.toggle('active', project.status === key);
    btn.addEventListener('click', () => setStatus(key));
    statusRow.appendChild(btn);
  }
  return statusRow;
}

function buildNotesCard(project) {
  const notesCard = document.createElement('div');
  notesCard.className = 'card';
  notesCard.innerHTML = '<h2>Notes</h2>';
  const textarea = document.createElement('textarea');
  textarea.value = project.notes || '';
  textarea.placeholder = 'Floss substitutions, fabric count, gift recipient…';
  let notesTimer = null;
  textarea.addEventListener('input', () => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      project.notes = textarea.value;
      await updateProject(project.id, { notes: textarea.value });
    }, 500);
  });
  notesCard.appendChild(textarea);
  return notesCard;
}

function buildPhotoCard(project) {
  const photoCard = document.createElement('div');
  photoCard.className = 'card';
  photoCard.innerHTML = '<h2>Progress photos</h2>';
  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/*';
  photoInput.multiple = true;
  photoInput.hidden = true;
  photoInput.addEventListener('change', () => addPhotos(photoInput.files));
  const addPhotoBtn = document.createElement('button');
  addPhotoBtn.type = 'button';
  addPhotoBtn.className = 'btn btn-secondary';
  addPhotoBtn.textContent = 'Add photo';
  addPhotoBtn.addEventListener('click', () => photoInput.click());
  photoCard.appendChild(addPhotoBtn);
  photoCard.appendChild(photoInput);

  const log = document.createElement('div');
  log.className = 'photo-log';
  for (const photo of project.photos || []) {
    log.appendChild(buildPhotoItem(photo));
  }
  photoCard.appendChild(log);
  return photoCard;
}

function paintDetail() {
  const project = currentProject;
  detailPanel.innerHTML = '';

  const back = document.createElement('a');
  back.href = '#/projects';
  back.className = 'back-link';
  back.textContent = '← All projects';
  detailPanel.appendChild(back);

  if (!project.patternId) {
    paintPatternlessDetail();
    return;
  }

  const pattern = currentPattern;

  if (!pattern) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<p class="hint" style="margin:0 0 10px;">The pattern behind this project was deleted from the Library, so it can't be displayed or stitched.</p>`;
    card.appendChild(deleteProjectBtn());
    detailPanel.appendChild(card);
    return;
  }

  const headCard = document.createElement('div');
  headCard.className = 'card';
  const h2 = document.createElement('h2');
  h2.textContent = pattern.name;
  headCard.appendChild(h2);

  const total = pattern.width * pattern.height;
  const pct = total > 0 ? Math.round((100 * stitchedSet.size) / total) : 0;
  const summary = document.createElement('div');
  summary.className = 'progress-summary';
  summary.innerHTML = `<span class="pct">${pct}%</span><span class="count">${stitchedSet.size} / ${total} stitches</span>`;
  headCard.appendChild(summary);
  summaryEl = summary;

  headCard.appendChild(buildStatusRow(project));

  const dates = document.createElement('div');
  dates.className = 'pattern-meta';
  dates.style.marginTop = '8px';
  dates.textContent = `Started ${fmtDate(project.startDate)} · Finished ${fmtDate(project.finishDate)}`;
  headCard.appendChild(dates);

  detailPanel.appendChild(headCard);

  const chartCard = document.createElement('div');
  chartCard.className = 'card';
  const chartHeading = document.createElement('h2');
  chartHeading.textContent = 'Chart';
  chartCard.appendChild(chartHeading);

  const toggle = document.createElement('div');
  toggle.className = 'chart-toggle';
  const symBtn = document.createElement('button');
  symBtn.textContent = 'Symbols (B&W)';
  symBtn.classList.toggle('active', chartView === 'symbol');
  symBtn.addEventListener('click', () => {
    chartView = 'symbol';
    paintDetail();
  });
  const colBtn = document.createElement('button');
  colBtn.textContent = 'Colour';
  colBtn.classList.toggle('active', chartView === 'color');
  colBtn.addEventListener('click', () => {
    chartView = 'color';
    paintDetail();
  });
  toggle.appendChild(symBtn);
  toggle.appendChild(colBtn);
  chartCard.appendChild(toggle);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'tracker-chart-wrap';
  const canvas = renderTrackerChart(pattern, stitchedSet, CHART_CELL_PX, chartView);
  canvas.addEventListener('click', (e) => onChartClick(canvas, e));
  chartWrap.appendChild(canvas);
  chartCard.appendChild(chartWrap);
  chartWrapEl = chartWrap;

  const hint = document.createElement('p');
  hint.className = 'tracker-hint';
  hint.textContent = 'Tap a stitch to mark it done. Tap again to undo.';
  chartCard.appendChild(hint);

  detailPanel.appendChild(chartCard);

  detailPanel.appendChild(buildNotesCard(project));
  detailPanel.appendChild(buildPhotoCard(project));

  const dangerCard = document.createElement('div');
  dangerCard.className = 'card';
  dangerCard.appendChild(deleteProjectBtn());
  detailPanel.appendChild(dangerCard);
}

function paintPatternlessDetail() {
  const project = currentProject;

  const headCard = document.createElement('div');
  headCard.className = 'card';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = project.name || '';
  nameInput.placeholder = 'Untitled project';
  nameInput.className = 'project-name-input';
  let nameTimer = null;
  nameInput.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(async () => {
      project.name = nameInput.value;
      await updateProject(project.id, { name: nameInput.value });
    }, 500);
  });
  headCard.appendChild(nameInput);

  headCard.appendChild(buildStatusRow(project));

  const dates = document.createElement('div');
  dates.className = 'pattern-meta';
  dates.style.marginTop = '8px';
  dates.textContent = `Started ${fmtDate(project.startDate)} · Finished ${fmtDate(project.finishDate)}`;
  headCard.appendChild(dates);

  detailPanel.appendChild(headCard);

  const refCard = document.createElement('div');
  refCard.className = 'card';
  refCard.innerHTML = '<h2>Reference</h2>';
  if (project.referencePhoto) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(project.referencePhoto);
    img.alt = 'Reference chart or leaflet';
    img.className = 'reference-photo';
    refCard.appendChild(img);
  } else {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.margin = '0';
    hint.textContent = 'No reference photo added.';
    refCard.appendChild(hint);
  }
  const refInput = document.createElement('input');
  refInput.type = 'file';
  refInput.accept = 'image/*';
  refInput.hidden = true;
  refInput.addEventListener('change', async () => {
    const file = refInput.files[0];
    if (!file) return;
    project.referencePhoto = file;
    await updateProject(project.id, { referencePhoto: file });
    paintDetail();
  });
  const refBtn = document.createElement('button');
  refBtn.type = 'button';
  refBtn.className = 'btn btn-secondary';
  refBtn.style.marginTop = '10px';
  refBtn.textContent = project.referencePhoto ? 'Replace reference photo' : 'Add reference photo';
  refBtn.addEventListener('click', () => refInput.click());
  refCard.appendChild(refBtn);
  refCard.appendChild(refInput);
  detailPanel.appendChild(refCard);

  const progressCard = document.createElement('div');
  progressCard.className = 'card';
  progressCard.innerHTML = '<h2>Progress</h2><p class="hint">No stitch grid to tap through for this project, so track it by percent or a raw stitch count instead.</p>';
  const progress = project.progress || { mode: 'percent', value: 0, total: null };

  const modeField = document.createElement('div');
  modeField.className = 'field';
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Track by';
  modeField.appendChild(modeLabel);
  const modeSelect = document.createElement('select');
  modeSelect.innerHTML = '<option value="percent">% complete</option><option value="stitches">Stitch count</option>';
  modeSelect.value = progress.mode;
  modeField.appendChild(modeSelect);
  progressCard.appendChild(modeField);

  const valueField = document.createElement('div');
  valueField.className = 'field';
  const valueLabel = document.createElement('label');
  valueLabel.textContent = progress.mode === 'stitches' ? 'Stitches done' : 'Percent complete';
  valueField.appendChild(valueLabel);
  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.min = '0';
  if (progress.mode !== 'stitches') valueInput.max = '100';
  valueInput.value = progress.value || 0;
  valueField.appendChild(valueInput);
  progressCard.appendChild(valueField);

  const totalField = document.createElement('div');
  totalField.className = 'field';
  totalField.hidden = progress.mode !== 'stitches';
  const totalLabel = document.createElement('label');
  totalLabel.textContent = 'Total stitches (optional, for a % readout)';
  totalField.appendChild(totalLabel);
  const totalInput = document.createElement('input');
  totalInput.type = 'number';
  totalInput.min = '0';
  totalInput.value = progress.total || '';
  totalField.appendChild(totalInput);
  progressCard.appendChild(totalField);

  async function saveProgress() {
    const mode = modeSelect.value;
    const value = Number(valueInput.value) || 0;
    const total = totalInput.value ? Number(totalInput.value) : null;
    project.progress = { mode, value, total };
    await updateProject(project.id, { progress: project.progress });
  }

  modeSelect.addEventListener('change', () => {
    valueLabel.textContent = modeSelect.value === 'stitches' ? 'Stitches done' : 'Percent complete';
    valueInput.max = modeSelect.value === 'stitches' ? '' : '100';
    totalField.hidden = modeSelect.value !== 'stitches';
    saveProgress();
  });
  let progressTimer = null;
  const scheduleSave = () => {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(saveProgress, 400);
  };
  valueInput.addEventListener('input', scheduleSave);
  totalInput.addEventListener('input', scheduleSave);

  detailPanel.appendChild(progressCard);

  detailPanel.appendChild(buildNotesCard(project));
  detailPanel.appendChild(buildPhotoCard(project));

  const dangerCard = document.createElement('div');
  dangerCard.className = 'card';
  dangerCard.appendChild(deleteProjectBtn());
  detailPanel.appendChild(dangerCard);
}

function buildPhotoItem(photo) {
  const item = document.createElement('div');
  item.className = 'photo-item';
  const img = document.createElement('img');
  img.src = URL.createObjectURL(photo.blob);
  img.alt = photo.caption || 'Progress photo';
  item.appendChild(img);
  const date = document.createElement('div');
  date.className = 'photo-date';
  date.textContent = fmtDate(photo.takenAt);
  item.appendChild(date);
  return item;
}

function deleteProjectBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary';
  btn.style.color = 'var(--danger)';
  btn.style.borderColor = 'var(--danger)';
  btn.textContent = 'Delete project';
  btn.addEventListener('click', async () => {
    if (!confirm('Delete this project? Progress and photos will be lost. The saved pattern stays in your Library.')) return;
    await deleteProject(currentProject.id);
    showToast('Project deleted.');
    navigate('projects');
  });
  return btn;
}

async function onChartClick(canvas, event) {
  const pos = chartCellFromEvent(canvas, currentPattern, CHART_CELL_PX, event);
  if (!pos) return;
  if (stitchedSet.has(pos.cell)) {
    stitchedSet.delete(pos.cell);
  } else {
    stitchedSet.add(pos.cell);
  }
  currentProject.stitchedCells = Array.from(stitchedSet);
  await updateProject(currentProject.id, { stitchedCells: currentProject.stitchedCells });
  updateChartAndProgress();
}

// Redraws just the chart canvas and progress figures, leaving the notes
// textarea and photo log (with their object URLs) untouched — a full
// paintDetail() on every single tap would both discard in-progress note
// edits and leak a fresh blob URL per photo on each click.
function updateChartAndProgress() {
  const pattern = currentPattern;
  const total = pattern.width * pattern.height;
  const pct = total > 0 ? Math.round((100 * stitchedSet.size) / total) : 0;

  if (summaryEl) {
    summaryEl.querySelector('.pct').textContent = `${pct}%`;
    summaryEl.querySelector('.count').textContent = `${stitchedSet.size} / ${total} stitches`;
  }
  if (chartWrapEl) {
    chartWrapEl.innerHTML = '';
    const canvas = renderTrackerChart(pattern, stitchedSet, CHART_CELL_PX, chartView);
    canvas.addEventListener('click', (e) => onChartClick(canvas, e));
    chartWrapEl.appendChild(canvas);
  }
}

async function setStatus(status) {
  const patch = { status };
  if (status === 'wip' && !currentProject.startDate) patch.startDate = Date.now();
  if (status === 'fo' && !currentProject.finishDate) patch.finishDate = Date.now();
  const updated = await updateProject(currentProject.id, patch);
  currentProject = updated;
  paintDetail();
}

async function addPhotos(fileList) {
  for (const file of fileList) {
    await addProjectPhoto(currentProject.id, { blob: file, caption: '' });
  }
  currentProject = await getProject(currentProject.id);
  showToast(fileList.length > 1 ? 'Photos added.' : 'Photo added.');
  paintDetail();
}

// ---------------------------------------------------------------------------

onRoute('projects', (params) => {
  if (params[0]) {
    renderDetail(params[0]);
  } else {
    renderList();
  }
});

export { renderList as renderProjects };
