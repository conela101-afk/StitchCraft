// IndexedDB persistence for saved patterns and tracked projects.
// Photos and full stitch grids can exceed localStorage's ~5MB cap, so
// anything pattern/project-sized lives here instead of state.js.

const DB_NAME = 'stitchcraft';
const DB_VERSION = 1;
const STORE_PATTERNS = 'patterns';
const STORE_PROJECTS = 'projects';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PATTERNS)) {
        db.createObjectStore(STORE_PATTERNS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const projects = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        projects.createIndex('patternId', 'patternId');
        projects.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export async function savePattern(pattern) {
  const now = Date.now();
  const record = {
    id: pattern.id || uuid(),
    name: pattern.name || 'Untitled pattern',
    width: pattern.width,
    height: pattern.height,
    aidaCount: pattern.aidaCount,
    indices: pattern.indices,
    colors: pattern.colors,
    brand: pattern.brand,
    source: pattern.source || 'photo',
    createdAt: pattern.createdAt || now,
    updatedAt: now,
  };
  const store = await tx(STORE_PATTERNS, 'readwrite');
  await request(store.put(record));
  return record;
}

export async function getPattern(id) {
  const store = await tx(STORE_PATTERNS, 'readonly');
  return request(store.get(id));
}

export async function listPatterns() {
  const store = await tx(STORE_PATTERNS, 'readonly');
  const all = await request(store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deletePattern(id) {
  const store = await tx(STORE_PATTERNS, 'readwrite');
  await request(store.delete(id));
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function saveProject(project) {
  const now = Date.now();
  const record = {
    id: project.id || uuid(),
    patternId: project.patternId,
    status: project.status || 'stash',
    startDate: project.startDate ?? null,
    finishDate: project.finishDate ?? null,
    stitchedCells: project.stitchedCells || [],
    notes: project.notes || '',
    photos: project.photos || [],
    createdAt: project.createdAt || now,
    updatedAt: now,
  };
  const store = await tx(STORE_PROJECTS, 'readwrite');
  await request(store.put(record));
  return record;
}

export async function getProject(id) {
  const store = await tx(STORE_PROJECTS, 'readonly');
  return request(store.get(id));
}

export async function listProjects() {
  const store = await tx(STORE_PROJECTS, 'readonly');
  const all = await request(store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateProject(id, partial) {
  const store = await tx(STORE_PROJECTS, 'readwrite');
  const existing = await request(store.get(id));
  if (!existing) throw new Error(`Project ${id} not found`);
  const next = { ...existing, ...partial, id: existing.id, updatedAt: Date.now() };
  await request(store.put(next));
  return next;
}

export async function deleteProject(id) {
  const store = await tx(STORE_PROJECTS, 'readwrite');
  await request(store.delete(id));
}

export async function addProjectPhoto(id, { blob, takenAt = Date.now(), caption = '' }) {
  const store = await tx(STORE_PROJECTS, 'readwrite');
  const existing = await request(store.get(id));
  if (!existing) throw new Error(`Project ${id} not found`);
  const photo = { id: uuid(), blob, takenAt, caption };
  existing.photos = [...(existing.photos || []), photo];
  existing.updatedAt = Date.now();
  await request(store.put(existing));
  return photo;
}
