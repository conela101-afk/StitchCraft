// Minimal hand-rolled PDF writer — no PDF library dependency.
//
// Each "page" is a pre-rendered canvas (chart, or legend/brand-code text
// rendered to canvas); we embed it as a raw DeviceRGB image XObject, Flate-
// compressed via the browser's native CompressionStream when available
// (zlib/deflate output from CompressionStream('deflate') is byte-for-byte
// what PDF's /FilterFlateDecode expects, so no compression library is
// needed either).

const PT_PER_IN = 72;

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return { bytes, compressed: false };
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return { bytes: new Uint8Array(buf), compressed: true };
}

function canvasRgbBytes(canvas) {
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return rgb;
}

/**
 * @param {HTMLCanvasElement[]} canvases - one per page
 * @param {{pageWidthIn?: number, pageHeightIn?: number}} opts
 * @returns {Promise<Blob>}
 */
export async function canvasesToPdf(canvases, opts = {}) {
  const pageWidthPt = (opts.pageWidthIn ?? 8.5) * PT_PER_IN;
  const pageHeightPt = (opts.pageHeightIn ?? 11) * PT_PER_IN;

  const enc = new TextEncoder();
  const parts = [];
  let length = 0;
  const offsets = {};

  function write(bytesOrStr) {
    const bytes = typeof bytesOrStr === 'string' ? enc.encode(bytesOrStr) : bytesOrStr;
    parts.push(bytes);
    length += bytes.length;
  }
  function beginObject(num) {
    offsets[num] = length;
    write(`${num} 0 obj\n`);
  }
  function endObject() {
    write('endobj\n');
  }

  const n = canvases.length;
  const catalogNum = 1;
  const pagesNum = 2;
  const firstDynamic = 3;
  const pageNum = (i) => firstDynamic + i * 3;
  const contentNum = (i) => firstDynamic + i * 3 + 1;
  const imageNum = (i) => firstDynamic + i * 3 + 2;
  const totalObjects = 2 + n * 3;

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  beginObject(catalogNum);
  write(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>\n`);
  endObject();

  beginObject(pagesNum);
  const kids = Array.from({ length: n }, (_, i) => `${pageNum(i)} 0 R`).join(' ');
  write(`<< /Type /Pages /Kids [ ${kids} ] /Count ${n} >>\n`);
  endObject();

  for (let i = 0; i < n; i++) {
    const canvas = canvases[i];
    const rgb = canvasRgbBytes(canvas);
    const { bytes: imgBytes, compressed } = await deflate(rgb);

    // Fit the image to the page, preserving aspect ratio, centred.
    const scale = Math.min(pageWidthPt / canvas.width, pageHeightPt / canvas.height);
    const drawW = canvas.width * scale;
    const drawH = canvas.height * scale;
    const offX = (pageWidthPt - drawW) / 2;
    const offY = (pageHeightPt - drawH) / 2;

    beginObject(pageNum(i));
    write(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] ` +
        `/Resources << /XObject << /Im${i} ${imageNum(i)} 0 R >> >> /Contents ${contentNum(i)} 0 R >>\n`
    );
    endObject();

    const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offX.toFixed(2)} ${offY.toFixed(2)} cm\n/Im${i} Do\nQ\n`;
    const contentBytes = enc.encode(content);
    beginObject(contentNum(i));
    write(`<< /Length ${contentBytes.length} >>\nstream\n`);
    write(contentBytes);
    write('\nendstream\n');
    endObject();

    beginObject(imageNum(i));
    const filter = compressed ? ' /Filter /FlateDecode' : '';
    write(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8${filter} /Length ${imgBytes.length} >>\nstream\n`
    );
    write(imgBytes);
    write('\nendstream\n');
    endObject();
  }

  const xrefOffset = length;
  write(`xref\n0 ${totalObjects + 1}\n`);
  write('0000000000 65535 f \n');
  for (let num = 1; num <= totalObjects; num++) {
    write(`${String(offsets[num]).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjects + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(parts, { type: 'application/pdf' });
}
