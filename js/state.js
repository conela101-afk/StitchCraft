// Persist last-used settings (brand, Aida count, size, units) across visits.

const KEY = 'stitchcraft.settings.v1';

const DEFAULTS = {
  brand: 'DMC',
  aidaCount: 14,
  unit: 'in',
  widthIn: 2,
  heightIn: 2,
  colorCount: 12,
  algorithm: 'median-cut',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(partial) {
  const current = loadSettings();
  const next = { ...current, ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private browsing quota, etc.) — fail silently,
    // the app still works, it just won't remember settings next time.
  }
  return next;
}
