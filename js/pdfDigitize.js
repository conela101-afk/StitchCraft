// Best-effort image extraction from a PDF, for the "digitise a printed
// chart" fallback: printed/bought pattern PDFs are almost always either a
// scanned photo or an exported raster page embedded with PDF's DCTDecode
// (JPEG) filter, which stores the JPEG bytes verbatim inside the PDF file.
// Rather than parsing the PDF object graph, xref table or content streams
// (a full PDF renderer is well beyond "no dependencies, no build step"),
// this scans the raw file bytes for JPEG start/end-of-image markers and
// hands each valid image back for the user to pick from.
//
// This is NOT a general PDF renderer. A text/vector-drawn PDF pattern (most
// commercial charts sold as PDF) won't contain an embedded raster image at
// all, so nothing will be found — see the in-app fallback messaging for
// what we tell the user to do instead (screenshot/photograph the rendered
// page and use the normal photo pipeline).

const SOI = [0xff, 0xd8, 0xff]; // JPEG start-of-image
const EOI = [0xff, 0xd9]; // JPEG end-of-image
const MAX_SCAN_BYTES = 60 * 1024 * 1024;
const MIN_CANDIDATE_BYTES = 400; // discard tiny icons/bullets embedded in the PDF

function findAllPositions(bytes, marker) {
  const positions = [];
  const first = marker[0];
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    positions.push(i);
  }
  return positions;
}

// `positions` is ascending; returns the first value strictly greater than `value`, or -1.
function firstAfter(positions, value) {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (positions[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo < positions.length ? positions[lo] : -1;
}

function isDecodableImage(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 40 && img.naturalHeight > 40);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}

/**
 * @param {File} file
 * @param {number} maxImages
 * @returns {Promise<Blob[]>} decodable JPEG blobs found in the PDF, largest scan order preserved
 */
export async function extractPdfImages(file, maxImages = 12) {
  if (file.size > MAX_SCAN_BYTES) {
    throw new Error('That PDF is too large to scan for embedded images.');
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const starts = findAllPositions(buf, SOI);
  const ends = findAllPositions(buf, EOI);

  const candidateBlobs = [];
  let lastEnd = -1;
  for (const start of starts) {
    if (start < lastEnd) continue; // nested SOI inside an image we already captured
    const eoi = firstAfter(ends, start + 3);
    if (eoi < 0) continue;
    const end = eoi + 2;
    if (end - start < MIN_CANDIDATE_BYTES) continue;
    candidateBlobs.push(new Blob([buf.slice(start, end)], { type: 'image/jpeg' }));
    lastEnd = end;
    if (candidateBlobs.length >= maxImages * 2) break;
  }

  const results = [];
  for (const blob of candidateBlobs) {
    if (await isDecodableImage(blob)) results.push(blob);
    if (results.length >= maxImages) break;
  }
  return results;
}
