# Crisp pages: where the research stands (1 Nov 2026, late)

For the next session: read this, then [README.md](README.md) (method, results, conclusions, what carrel took, round 2), then `uv run python experiments/crisp-pages/summary.py` (its last table scores each strength against chance). The research plan is [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md); what is built is in [docs/architecture.md](../../docs/architecture.md) (Settings → Pages).

## Done

- **Round 1**, 498 picks and 35 measurements, and **round 2**, 52 picks: see the README (conclusions, what carrel took, round 2's results).
- **The sitting** (README): e-ink far easier to read; the iPad too crisp with its crop winners, so only e-ink starts with Pages on; the e-ink page jump on every turn traced to PDF.js's two drawings and fixed by drawing e-ink pages whole.
- **Settings → Pages in carrel**, each device's own, with every winner: letters as outlines, bolder letters (a double strike of the canvas), darker greys, sharper edges (a worker over each drawn page), contrast, scans in black and white (`scans.py`, `/api/scans`). Defaults from the research per kind of screen. Checked in WebKit and Chromium: filters, the scan marking, the dialog, the reload with outlines, the strike and the sharpening reaching the pages and undone exactly, scrolling at 17 ms frames with them on.

## Next

1. **On the Boox, the pages drawn whole**: does a turn still feel as quick, does Chrome stay up over a long paper (up to about 300 MB of page canvases), and is the jump gone. If memory is a problem, lower `EINK_CANVAS_PIXELS` in `read.js` towards 8 MP (a page at page width is 7.4 MP).
2. The iPad and the Mac keep whatever their Pages switch was last set to; the reader turns it off there once (the new defaults reach only a device with nothing chosen).
3. Then the research is done: plan-crisp-pages.md retired into the README.

## Notes

- Close calls: the reader picked one of several equally good cells rather than "no difference" when one cell was clearly worse; a ratio near 1 means "as good as the rest".
- The Boox's Chrome says only "Android 10; K", so carrel's e-ink detection does not see it; e-ink's page defaults follow the E-ink colours instead.
- `gpt3-body` under Resolution was picked twice four seconds apart (14:31:44 and :48); `summary.py` counts both.
