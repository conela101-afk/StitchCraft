# Progress

Last updated: 2026-09-21

## Read this first

Earlier sessions' commit messages and prior chat summaries claimed the
pattern Library, manual Designer, and WIP/FO Tracker "never landed" or
"don't work." **That was wrong.** An audit + deep functional testing this
session (headless-browser-driven, not just code reading) found the app is
in substantially better shape than that: every feature below actually
works end to end. The real problem was a broken *deployment*, not broken
*code* — see "Deployment" below. Don't restart a rebuild without re-reading
this file; there is nothing here worth scrapping.

## What's done (verified working, not just present in code)

All of these were driven end-to-end in a headless browser this session —
upload/draw real input, click through the UI, and check the actual
result (canvas pixels, IndexedDB persistence, downloaded files) — not
just read for plausibility.

- **Image-to-pattern wizard** (Upload → Size → Crop → Adjust → Pattern):
  photo upload, Aida count selector, stitch width, client-side
  median-cut/k-means quantization, CIEDE2000 DMC floss matching. Produces
  a working pattern + legend.
- **PDF "digitise a printed chart" fallback** (`js/pdfDigitize.js`): hand-rolled
  PDF structural reader (no library). Verified all three paths:
  - single embedded raster image → auto-loads into the wizard,
  - multiple embedded images → picker grid, selection works,
  - vector-drawn PDF (no photo) → correctly detected, shows "hand-copy in
    Designer instead" guidance rather than guessing.
- **Pattern grid view/editor**: canvas-rendered (not DOM grid), symbol +
  colour toggle, zoom/pan via the wizard/tracker chart renderers.
- **Manual Pattern Designer** (`js/designer.js`): new blank pattern, pencil/
  line/rect/fill/eyedropper/eraser tools, undo/redo, resize canvas, save to
  Library. Verified drawing actually mutates canvas pixels and undo/redo
  round-trips correctly.
- **Thread/floss legend**: symbol, code, name, stitch count, estimated
  skeins, generated per-pattern.
- **Pattern library** (`js/views/library.js`, `js/db.js`): save/import/export,
  IndexedDB persistence verified to survive a full page reload.
- **Import/export**: PNG, PDF (`js/pdfExport.js`, hand-rolled, no library),
  JSON, and **.oxs** (Open Cross Stitch) — round-trip export→import
  verified to reproduce the same pattern.
- **WIP/FO project tracker** (`js/views/projects.js`): create/status/notes/
  photo log, tap-to-mark stitch chart tied to a saved pattern, and
  patternless projects (kits stitched from a leaflet, tracked by %/count
  instead of a grid).
- **Accessibility**: symbol + colour always paired in the legend; approximate
  brand matches are flagged with visible text, never colour alone.

## Known, honestly-disclosed limitations (not bugs)

- **Thread brand data**: only **DMC** (454 shades) has a full manufacturer
  catalogue. Anchor and Madeira ship with just verified black/white;
  Sullivans has 12 name-estimated shades. Everything else nearest-matches
  via CIEDE2000 against whichever brand is selected, and the UI visibly
  flags this ("approx. match" text next to the symbol+colour swatch — see
  `js/crosswalk.js`, `js/threadData.js`). Extending real manufacturer RGB
  data for Anchor/Madeira/Sullivans is the main remaining data-quality gap.
- **.oxs**: only reads/writes full stitches. Backstitch, French knots, and
  half/quarter stitches aren't part of this app's Pattern model, so an
  imported file's backstitches are silently dropped, and export always
  writes an empty `<backstitches/>`. Documented at the top of `js/oxsIO.js`.
- **PDF digitize**: a hand-rolled structural reader, not a real PDF
  renderer. Doesn't handle encrypted PDFs, cross-reference streams, or
  compressed object streams (ObjStm). Reports "couldn't analyse" rather than
  guessing wrong in those cases. Documented at the top of `js/pdfDigitize.js`.

## Deployment (the thing that was actually broken)

GitHub Pages was building from `claude/new-session-9iabhl`, an abandoned
one-off session branch frozen at commit `43cc7a1` — from *before* the nav
shell, Library, Designer, or Tracker were ever merged into `main`. Every
feature phase since then landed on `main` but never reached the branch
Pages actually served, so the live site looked stuck on "upload only,"
matching the original complaint exactly. This was root-caused on
2026-09-17 by checking the Pages deployment history via the GitHub API
(all Actions-based deploy attempts had failed; the "deploy from a branch"
mode was quietly pointed at that stale branch).

**Fix applied**: fast-forwarded `claude/new-session-9iabhl` to the current
`main` tip (`43cc7a1..7dbeb96`), confirmed via the GitHub API that the
resulting Pages build succeeded and now serves `main`'s content.

**Still open** — needs a human with repo Settings access (not doable via
API): go to **Settings → Pages → Source** and switch the branch from
`claude/new-session-9iabhl` to `main`. Until that's done, a push to `main`
does **not** auto-deploy — it silently sits there until someone repeats the
fast-forward-push workaround. This is the single highest-priority
non-code fix outstanding.

## What's next (not yet built)

- Pattern grid **zoom/pan** and **recolor** beyond what the Designer offers
  — worth checking against the original spec's "basic recolor/edit" ask on
  a *saved* pattern (today, recoloring an existing photo-derived pattern
  means reopening it in the Designer; there's no direct "swap this colour
  everywhere" tool on the wizard output itself).
  - Confirm this is genuinely a gap before building anything — it wasn't
    tested this session.
- Real manufacturer RGB catalogues for Anchor, Madeira, Sullivans, if a
  legitimate published source can be found (see limitation above).
- The Pages Settings repoint above.

## Known issues

None currently open in the code. See "Known, honestly-disclosed
limitations" above for the data/format gaps that are by design, not bugs.

## Session log

- **2026-09-17 to 2026-09-21**: Full audit contradicting the "nothing
  works" premise. Deep-tested every feature in a headless browser
  (Playwright) rather than trusting code inspection alone — caught and
  corrected three of my own false-positive "bugs" that were actually test
  setup mistakes (wrong panel checked, off-canvas click coordinates, a
  misunderstood single-image auto-skip) before concluding the app itself
  was sound. Root-caused and fixed the real issue: a stale GitHub Pages
  deployment source, unrelated to the app code.
