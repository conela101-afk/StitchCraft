// PDF "digitise a printed chart" fallback — detect before attempting.
//
// A full PDF renderer (real content-stream interpretation, font/glyph
// rendering, colour space conversion, etc.) is well outside this app's
// no-dependencies/no-build-step architecture. Instead of rendering-and-
// hoping, this does a lightweight structural read of the PDF — enough to
// classify each page as either:
//
//   - "image"  — dominated by a single embedded raster image, the shape of
//                a scanned photo or an exported/printed full-page image.
//                The embedded image is extracted directly (better fidelity
//                than re-rastering) and handed to the normal photo pipeline.
//   - "vector" — dominated by path-drawing and text-showing operators, the
//                shape of an actual vector-drawn chart (grid lines + symbol
//                glyphs + a legend). There is no continuous-tone image for
//                the colour-quantize pipeline to work with here, so nothing
//                is attempted — the caller shows a specific explanation
//                instead of a silently wrong result.
//
// This is a hand-rolled, minimal PDF reader: it scans for `N G obj`/`endobj`
// blocks (not a real xref/trailer walk) and a small recursive-descent parser
// for PDF dictionary/array/name/number/reference syntax. It does not handle
// encrypted PDFs, cross-reference streams, or compressed object streams
// (ObjStm) — common in some modern PDF generators — and reports those as
// "couldn't analyse" rather than guessing. True general-purpose PDF parsing
// (arbitrary bought-pattern layouts, embedded fonts, etc.) is out of scope;
// see the in-app messaging this module's `reason` codes drive.

const MAX_SCAN_BYTES = 30 * 1024 * 1024;
const VECTOR_OP_THRESHOLD = 8; // path+text ops above this reads as a drawn chart, not a scan
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 're', 'f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*']);
const TEXT_SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

// ---------------------------------------------------------------------------
// Byte/text plumbing
// ---------------------------------------------------------------------------

function bytesToLatin1(bytes) {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

async function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // malformed/unsupported stream — caller treats as unreadable
  }
}

// Just decodability — no size threshold. Unlike a blind whole-file byte scan
// (which needs a size filter to reject false-positive tiny fragments), this
// is only ever called on an image object the content-stream analysis has
// already identified as the page's dominant content, so any decodable size
// is legitimate.
function isDecodableImage(blob) {
  return new Promise((resolveFn) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolveFn(img.naturalWidth > 0 && img.naturalHeight > 0);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolveFn(false);
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Minimal PDF value parser (dicts/arrays/names/numbers/refs/strings)
// ---------------------------------------------------------------------------

function skipWs(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\r' || s[i] === '\n' || s[i] === '\f' || s[i] === '\0' || s[i] === '%')) {
    if (s[i] === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    } else {
      i++;
    }
  }
  return i;
}

function parseName(s, i) {
  let j = i + 1;
  let name = '';
  while (j < s.length && !/[\s()<>[\]{}/%]/.test(s[j])) {
    if (s[j] === '#' && /^[0-9a-fA-F]{2}$/.test(s.slice(j + 1, j + 3))) {
      name += String.fromCharCode(parseInt(s.slice(j + 1, j + 3), 16));
      j += 3;
    } else {
      name += s[j];
      j++;
    }
  }
  return { value: name, next: j };
}

function parseLiteralString(s, i) {
  let j = i + 1;
  let depth = 1;
  while (j < s.length && depth > 0) {
    if (s[j] === '\\') {
      j += 2;
      continue;
    }
    if (s[j] === '(') depth++;
    else if (s[j] === ')') depth--;
    j++;
  }
  return { value: s.slice(i + 1, j - 1), next: j };
}

function parseHexString(s, i) {
  let j = i + 1;
  while (j < s.length && s[j] !== '>') j++;
  return { value: s.slice(i + 1, j), next: j + 1 };
}

function parseArray(s, i) {
  i += 1;
  const arr = [];
  for (let guard = 0; guard < 100000; guard++) {
    i = skipWs(s, i);
    if (i >= s.length || s[i] === ']') {
      i += 1;
      break;
    }
    const res = parseValue(s, i);
    arr.push(res.value);
    i = res.next;
  }
  return { value: arr, next: i };
}

function parseDict(s, i) {
  i += 2; // skip '<<'
  const obj = {};
  for (let guard = 0; guard < 100000; guard++) {
    i = skipWs(s, i);
    if (i >= s.length || s.startsWith('>>', i)) {
      i += 2;
      break;
    }
    if (s[i] !== '/') break; // malformed — bail rather than loop forever
    const keyRes = parseName(s, i);
    i = skipWs(s, keyRes.next);
    const valRes = parseValue(s, i);
    obj[keyRes.value] = valRes.value;
    i = valRes.next;
  }
  return { value: obj, next: i };
}

function parseValue(s, i) {
  i = skipWs(s, i);
  if (s.startsWith('<<', i)) return parseDict(s, i);
  if (s[i] === '[') return parseArray(s, i);
  if (s[i] === '/') return parseName(s, i);
  if (s[i] === '(') return parseLiteralString(s, i);
  if (s[i] === '<') return parseHexString(s, i);
  const refMatch = /^(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+R\b/.exec(s.slice(i));
  if (refMatch) return { value: { ref: parseInt(refMatch[1], 10) }, next: i + refMatch[0].length };
  const numMatch = /^[+-]?\d*\.?\d+/.exec(s.slice(i));
  if (numMatch) return { value: parseFloat(numMatch[0]), next: i + numMatch[0].length };
  const kwMatch = /^(true|false|null)\b/.exec(s.slice(i));
  if (kwMatch) return { value: kwMatch[0] === 'true' ? true : kwMatch[0] === 'false' ? false : null, next: i + kwMatch[0].length };
  return { value: undefined, next: i + 1 }; // unknown token — skip one char, keep going
}

// ---------------------------------------------------------------------------
// Object scan (regex-based `N G obj ... endobj`, not a real xref walk)
// ---------------------------------------------------------------------------

function scanObjects(latin1) {
  const objects = new Map();
  const objRe = /(\d+)[ \t]+(\d+)[ \t]+obj\b/g;
  let m;
  while ((m = objRe.exec(latin1))) {
    const num = parseInt(m[1], 10);
    const headerEnd = m.index + m[0].length;
    const endobjIdx = latin1.indexOf('endobj', headerEnd);
    if (endobjIdx === -1) continue;
    const streamKwIdx = latin1.indexOf('stream', headerEnd);
    let dictEnd = endobjIdx;
    let streamStart = -1;
    let streamEnd = -1;
    if (streamKwIdx !== -1 && streamKwIdx < endobjIdx) {
      dictEnd = streamKwIdx;
      let p = streamKwIdx + 6;
      if (latin1[p] === '\r') p++;
      if (latin1[p] === '\n') p++;
      streamStart = p;
      const endstreamIdx = latin1.indexOf('endstream', streamStart);
      streamEnd = endstreamIdx === -1 ? endobjIdx : endstreamIdx;
    }
    objects.set(num, { dictText: latin1.slice(headerEnd, dictEnd), streamStart, streamEnd });
  }
  return objects;
}

function getValue(objects, cache, num) {
  if (cache.has(num)) return cache.get(num);
  const obj = objects.get(num);
  let result;
  if (obj) {
    const start = skipWs(obj.dictText, 0);
    result = start < obj.dictText.length ? parseValue(obj.dictText, start).value : undefined;
  }
  cache.set(num, result);
  return result;
}

function resolve(objects, cache, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'ref' in value) {
    return getValue(objects, cache, value.ref);
  }
  return value;
}

function isDict(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && !('ref' in v);
}

function resolveInherited(objects, cache, pageDict, key) {
  let dict = pageDict;
  for (let depth = 0; dict && depth < 16; depth++) {
    if (key in dict) return resolve(objects, cache, dict[key]);
    const parent = resolve(objects, cache, dict.Parent);
    if (!isDict(parent) || parent === dict) break;
    dict = parent;
  }
  return undefined;
}

function readStreamRaw(objects, cache, bytesArr, num) {
  const obj = objects.get(num);
  if (!obj || obj.streamStart < 0) return null;
  const dict = getValue(objects, cache, num);
  if (!isDict(dict)) return null;
  let end = obj.streamEnd;
  const length = resolve(objects, cache, dict.Length);
  if (typeof length === 'number' && length >= 0 && obj.streamStart + length <= bytesArr.length) {
    end = obj.streamStart + length;
  }
  if (end < obj.streamStart) end = obj.streamStart;
  return { dict, raw: bytesArr.slice(obj.streamStart, end) };
}

async function getDecodedContentBytes(objects, cache, bytesArr, num) {
  const r = readStreamRaw(objects, cache, bytesArr, num);
  if (!r) return null;
  const filter = r.dict.Filter;
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  if (filters.includes('FlateDecode')) return inflateBytes(r.raw);
  return r.raw;
}

// ---------------------------------------------------------------------------
// Content-stream operator classification
// ---------------------------------------------------------------------------

function classifyContentStream(text) {
  let pathOps = 0;
  let textOps = 0;
  const doNames = [];
  const tokenRe = /\/[^\s()<>[\]{}/%]+|BI\b|EI\b|[A-Za-z*'"]+|[-+]?\d*\.?\d+/g;
  let lastName = null;
  let inInline = false;
  let m;
  while ((m = tokenRe.exec(text))) {
    const tok = m[0];
    if (inInline) {
      if (tok === 'EI') inInline = false;
      continue;
    }
    if (tok === 'BI') {
      inInline = true;
      continue;
    }
    if (tok[0] === '/') {
      lastName = tok.slice(1);
      continue;
    }
    if (tok === 'Do') {
      if (lastName) doNames.push(lastName);
      continue;
    }
    if (PATH_OPS.has(tok)) pathOps++;
    else if (TEXT_SHOW_OPS.has(tok)) textOps++;
  }
  return { pathOps, textOps, doNames };
}

function resolveXObjectNum(objects, cache, resourcesDict, name) {
  const xobjDict = resolve(objects, cache, isDict(resourcesDict) ? resourcesDict.XObject : undefined);
  if (!isDict(xobjDict)) return null;
  const ref = xobjDict[name];
  return ref && typeof ref === 'object' && 'ref' in ref ? ref.ref : null;
}

function getContentStreamNums(pageDict) {
  const c = pageDict.Contents;
  if (Array.isArray(c)) return c.filter((x) => x && typeof x === 'object' && 'ref' in x).map((x) => x.ref);
  if (c && typeof c === 'object' && 'ref' in c) return [c.ref];
  return [];
}

async function analyzePage(objects, cache, bytesArr, pageDict) {
  const contentNums = getContentStreamNums(pageDict);
  if (contentNums.length === 0) return { kind: 'unknown' };

  let combined = '';
  for (const num of contentNums) {
    const decoded = await getDecodedContentBytes(objects, cache, bytesArr, num);
    if (decoded) combined += bytesToLatin1(decoded) + '\n';
  }
  if (!combined.trim()) return { kind: 'unknown' };

  const { pathOps, textOps, doNames } = classifyContentStream(combined);
  const resources = resolveInherited(objects, cache, pageDict, 'Resources');

  const imageObjNums = [];
  for (const name of doNames) {
    const objNum = resolveXObjectNum(objects, cache, resources, name);
    if (objNum == null) continue;
    const xdict = getValue(objects, cache, objNum);
    if (isDict(xdict) && xdict.Subtype === 'Image') imageObjNums.push(objNum);
  }

  if (imageObjNums.length > 0 && pathOps + textOps <= VECTOR_OP_THRESHOLD) {
    return { kind: 'image', imageObjNums: [...new Set(imageObjNums)] };
  }
  if (pathOps + textOps > VECTOR_OP_THRESHOLD || imageObjNums.length === 0) {
    return { kind: 'vector' };
  }
  return { kind: 'unknown' };
}

// ---------------------------------------------------------------------------
// Image XObject extraction
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const buf = new Uint8Array(4 + 4 + data.length + 4);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, data.length);
  buf.set(typeBytes, 4);
  buf.set(data, 8);
  dv.setUint32(8 + data.length, crc32(buf.subarray(4, 8 + data.length)));
  return buf;
}

// Reconstructs a minimal PNG (filter type "none" per scanline) from raw,
// already-decompressed 8-bit sample data — for PDFs that store an
// uncompressed-pixel raster image under FlateDecode rather than DCTDecode.
async function buildPngFromRaw(samples, width, height, colorType) {
  const bpp = colorType === 2 ? 3 : 1; // DeviceRGB : DeviceGray
  const stride = width * bpp;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter type 0 = None
    filtered.set(samples.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = await deflateBytes(filtered);
  if (!idat) throw new Error('compression unavailable');

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;

  return new Blob([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], {
    type: 'image/png',
  });
}

async function extractImageBlob(objects, cache, bytesArr, objNum) {
  const r = readStreamRaw(objects, cache, bytesArr, objNum);
  if (!r) return { error: 'unsupported' };
  const { dict, raw } = r;
  const filter = dict.Filter;
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];

  if (filters.includes('DCTDecode')) {
    return { blob: new Blob([raw], { type: 'image/jpeg' }) };
  }

  if (filters.length === 0 || (filters.length === 1 && filters[0] === 'FlateDecode')) {
    const pixels = filters.includes('FlateDecode') ? await inflateBytes(raw) : raw;
    if (!pixels) return { error: 'unsupported' };
    const { Width: width, Height: height, BitsPerComponent: bpc = 8, ColorSpace: colorSpace } = dict;
    if (bpc !== 8 || !width || !height) return { error: 'unsupported' };
    const colorType = colorSpace === 'DeviceRGB' ? 2 : colorSpace === 'DeviceGray' ? 0 : null;
    if (colorType === null) return { error: 'unsupported' }; // Indexed/CMYK/ICC not handled
    const expected = width * height * (colorType === 2 ? 3 : 1);
    if (pixels.length < expected) return { error: 'unsupported' };
    try {
      return { blob: await buildPngFromRaw(pixels.subarray(0, expected), width, height, colorType) };
    } catch {
      return { error: 'unsupported' };
    }
  }

  return { error: 'unsupported' }; // CCITTFax, JPX, JBIG2, etc. — not decodable here
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {File} file
 * @param {number} maxImages
 * @returns {Promise<{images: Blob[], reason: null|'vector'|'unsupported-filter'|'unparseable'}>}
 */
export async function extractPdfImages(file, maxImages = 8) {
  if (file.size > MAX_SCAN_BYTES) {
    throw new Error('That PDF is too large to analyse.');
  }
  const bytesArr = new Uint8Array(await file.arrayBuffer());
  const latin1 = bytesToLatin1(bytesArr);
  const objects = scanObjects(latin1);
  if (objects.size === 0) return { images: [], reason: 'unparseable' };

  const cache = new Map();
  const pageNums = [];
  for (const num of objects.keys()) {
    const val = getValue(objects, cache, num);
    if (isDict(val) && val.Type === 'Page') pageNums.push(num);
  }
  if (pageNums.length === 0) return { images: [], reason: 'unparseable' };

  let sawVector = false;
  let sawImagePage = false;
  let sawUnsupportedImage = false;
  const seen = new Set();
  const images = [];

  for (const pageNum of pageNums) {
    const pageDict = getValue(objects, cache, pageNum);
    let result;
    try {
      result = await analyzePage(objects, cache, bytesArr, pageDict);
    } catch {
      result = { kind: 'unknown' };
    }
    if (result.kind === 'vector') {
      sawVector = true;
      continue;
    }
    if (result.kind !== 'image') continue;
    sawImagePage = true;
    for (const objNum of result.imageObjNums) {
      if (seen.has(objNum)) continue;
      seen.add(objNum);
      const { blob, error } = await extractImageBlob(objects, cache, bytesArr, objNum);
      if (blob && (await isDecodableImage(blob))) images.push(blob);
      else if (error) sawUnsupportedImage = true;
      if (images.length >= maxImages) break;
    }
    if (images.length >= maxImages) break;
  }

  if (images.length > 0) return { images, reason: null };
  if (sawUnsupportedImage) return { images: [], reason: 'unsupported-filter' };
  if (sawVector && !sawImagePage) return { images: [], reason: 'vector' };
  return { images: [], reason: 'unparseable' };
}
