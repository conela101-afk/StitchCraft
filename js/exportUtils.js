// Small shared helpers for turning a rendered canvas into a downloaded file.
// Used by the wizard's Pattern step, the Library view, and the Tracker.

export function composeTitledPage(chart, title) {
  const pad = 40;
  const canvas = document.createElement('canvas');
  canvas.width = chart.width + pad * 2;
  canvas.height = chart.height + pad * 2 + 40;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(title, pad, 34);
  ctx.drawImage(chart, pad, 60);
  return canvas;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
