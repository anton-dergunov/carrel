# Crisp pages: where the research stands (1 Nov 2026, night)

For the next session: read this, then [README.md](README.md) (method, results, conclusions, what carrel took, round 2), then `uv run python experiments/crisp-pages/summary.py` (its last table scores each strength against chance). The research plan is [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md); what is built is in [docs/architecture.md](../../docs/architecture.md) (Settings → Pages).

## Done

- **Round 1**, 498 picks and 35 measurements: the Boox (Optimal and Custom High Contrast), the iPad (Chrome), the MacBook's external monitor (Chrome, at a paper width of 1100 CSS px). Conclusions in the README: outlines on the Boox; darker greys and sharpening on the iPad; a light embolden on the Boox and the Mac; little else anywhere. Every adjustment depends on the paper and the device.
- **Settings → Pages in carrel** (decided with the reader): one switch per device over letters as outlines, darker greys, contrast, and scans in black and white; device defaults from the research; `scans.py` and `/api/scans` find the scanned pages. Checked in WebKit: filters, the scan marking, the dialog, the reload with outlines. Scrolling with darker greys: the median frame unchanged (17 ms), occasional slow frames (worst 49–95 ms against 25) in headless WebKit; to be watched on the iPad.
- **Round 2 knobs on the bench**: "Embolden, shippable" (a double strike beside the stroke) and "Sharpen, shippable" (an SVG convolution beside the worker). See the README.

## Next

1. **Round 2 with the reader**: Embolden, shippable on the Boox and the Mac's monitor; Sharpen, shippable on the iPad. Reload the bench page first. Then `summary.py`: is the shippable route picked as often as the round-1 one at the same strength?
2. **If they match, ship them**: embolden as a strength in Settings → Pages (Off, 0.05, 0.1, 0.18 pt; e-ink starts at 0.1), drawn by `read.js` over each page's canvas and detail canvas after PDF.js draws it (`pagerendered`); sharpening as an SVG filter beside darker greys (a touch screen starts at its strength). Both join `boot.js`'s `PAGES`, `pageFilters`, and the tests in `tests/look.test.mjs`.
3. **A sitting with Settings → Pages** on each device, reading whole papers: are the defaults right, does darker greys keep scrolling smooth on the iPad, does reloading for outlines feel right.
4. Then the research is done: a line in architecture.md on what was chosen, with the picks that settled it (mostly there already), and plan-crisp-pages.md retired into the README.

## Notes

- Close calls: the reader picked one of several equally good cells rather than "no difference" when one cell was clearly worse; a ratio near 1 means "as good as the rest".
- The Boox's Chrome says only "Android 10; K", so carrel's e-ink detection does not see it; e-ink's page defaults follow the E-ink colours instead.
- `gpt3-body` under Resolution was picked twice four seconds apart (14:31:44 and :48); `summary.py` counts both.
