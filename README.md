# StitchCraft

A client-side, offline-installable PWA that turns a photo into a printable
cross-stitch pattern, with perceptual (CIEDE2000) thread-colour matching
across multiple brands and pattern sizing driven by real-world dimensions
(e.g. a 1"×2" keyring).

Nothing ever leaves the device — there is no server, no build step, and no
runtime dependencies. Everything (colour maths, quantization, dithering,
PDF export) is hand-rolled in plain JS modules.

## Running it

Any static file server works, e.g.:

```
npx http-server .
# or
python3 -m http.server 8000
```

Then open the printed URL. Installing as a PWA (browser's "Install app" /
"Add to Home Screen") makes it work fully offline afterwards.

## Project layout

- `index.html`, `css/styles.css` — mobile-first UI, a 5-step wizard (Upload →
  Size → Crop → Adjust → Pattern).
- `js/colorMath.js` — sRGB ↔ Lab ↔ XYZ conversions and CIEDE2000.
- `js/threadData.js` — central colour table. DMC ships with a full,
  manufacturer-referenced 454-shade catalogue. Anchor, Madeira and Sullivans
  currently ship with a small, clearly-marked "starter" set only (no full
  published RGB chart for those brands was available while building this) —
  see the comment at the top of the file for how to extend them.
- `js/crosswalk.js` — runtime, nearest-CIEDE2000-match brand-to-brand colour
  lookup (never a copied third-party conversion chart).
- `js/quantize.js` — median-cut (default) and k-means quantization, plus
  Floyd–Steinberg dithering.
- `js/imageProcessing.js` — crop/resample, brightness/contrast, edge
  enhancement, click-to-remove background.
- `js/sizing.js` — Aida count ↔ physical size ↔ stitch grid, presets,
  validation.
- `js/pattern.js`, `js/render.js` — builds the stitch pattern + floss legend
  and renders the printable symbol/colour charts.
- `js/pdfExport.js` — hand-rolled PDF writer (raw DeviceRGB image XObjects,
  Flate-compressed via the browser's native `CompressionStream`).
- `js/state.js` — localStorage persistence of last-used brand/count/size.
- `manifest.json`, `sw.js`, `icons/` — PWA shell (installable, offline cache).

## Data sourcing note

Brand colour codes and RGB values are factual data, not copyrightable. DMC's
table here is built from DMC's own published RGB references. Cross-brand
conversion is always computed at runtime as a nearest-perceptual match
(CIEDE2000) against whichever brand's own colour list is selected — never a
copied commercial conversion chart — and the UI flags an approximate match.
