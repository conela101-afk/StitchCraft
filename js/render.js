// Canvas rendering for the printable chart and legend.

import { rgbToHex } from './colorMath.js';

const GRID_LINE = '#c9c9c9';
const GRID_LINE_BOLD = '#333333';
const BOLD_EVERY = 10;

function drawGrid(ctx, cols, rows, cellSize, originX, originY) {
  ctx.save();
  for (let x = 0; x <= cols; x++) {
    ctx.strokeStyle = x % BOLD_EVERY === 0 ? GRID_LINE_BOLD : GRID_LINE;
    ctx.lineWidth = x % BOLD_EVERY === 0 ? 1.4 : 0.5;
    ctx.beginPath();
    ctx.moveTo(originX + x * cellSize, originY);
    ctx.lineTo(originX + x * cellSize, originY + rows * cellSize);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.strokeStyle = y % BOLD_EVERY === 0 ? GRID_LINE_BOLD : GRID_LINE;
    ctx.lineWidth = y % BOLD_EVERY === 0 ? 1.4 : 0.5;
    ctx.beginPath();
    ctx.moveTo(originX, originY + y * cellSize);
    ctx.lineTo(originX + cols * cellSize, originY + y * cellSize);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderColorChart(pattern, cellSize = 16) {
  const { width, height, indices, colors } = pattern;
  const canvas = document.createElement('canvas');
  canvas.width = width * cellSize + 1;
  canvas.height = height * cellSize + 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = indices[y * width + x];
      if (idx < 0) continue;
      const color = colors.find((c) => c.index === idx);
      ctx.fillStyle = rgbToHex(color.rgb);
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
  drawGrid(ctx, width, height, cellSize, 0, 0);
  return canvas;
}

export function renderSymbolChart(pattern, cellSize = 20) {
  const { width, height, indices, colors } = pattern;
  const canvas = document.createElement('canvas');
  canvas.width = width * cellSize + 1;
  canvas.height = height * cellSize + 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(cellSize * 0.68)}px sans-serif`;
  ctx.fillStyle = '#111111';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = indices[y * width + x];
      if (idx < 0) continue;
      const color = colors.find((c) => c.index === idx);
      ctx.fillText(color.symbol, x * cellSize + cellSize / 2, y * cellSize + cellSize / 2 + 1);
    }
  }
  drawGrid(ctx, width, height, cellSize, 0, 0);
  return canvas;
}

export function renderLegendCanvas(legend, meta, brandKey) {
  const rowH = 34;
  const width = 720;
  const headerH = 110;
  const height = headerH + legend.length * rowH + 40;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(meta.title || 'StitchCraft Pattern', 20, 32);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#444444';
  ctx.fillText(
    `${meta.widthStitches}×${meta.heightStitches} stitches · ${meta.aidaCount}-count Aida · ${meta.sizeLabel} · ${brandKey} floss`,
    20,
    54
  );
  if (meta.approxNote) {
    ctx.fillStyle = '#8a5a00';
    ctx.font = 'italic 12px sans-serif';
    wrapText(ctx, meta.approxNote, 20, 74, width - 40, 16);
  }

  let y = headerH;
  ctx.font = '13px sans-serif';
  for (const row of legend) {
    ctx.fillStyle = rgbToHex(row.rgb);
    ctx.fillRect(20, y, 22, 22);
    ctx.strokeStyle = '#999999';
    ctx.strokeRect(20, y, 22, 22);

    ctx.fillStyle = '#111111';
    ctx.font = '16px sans-serif';
    ctx.fillText(row.symbol, 54, y + 17);

    ctx.font = '13px sans-serif';
    const codeLabel = row.threadCode && row.threadCode !== '—' ? row.threadCode : 'no code';
    ctx.fillText(`${codeLabel} — ${row.threadName}${row.approximate ? ' (approx.)' : ''}`, 84, y + 16);
    ctx.fillStyle = '#555555';
    ctx.fillText(`${row.stitchCount} stitches · ~${row.skeins} skein${row.skeins > 1 ? 's' : ''}`, 84, y + 30);

    y += rowH;
  }
  return canvas;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word + ' ';
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
