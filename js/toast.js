// Shared toast notification, used across the wizard and the Library/Projects views.

let timer = null;

export function showToast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (el.hidden = true), ms);
}

export function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}
