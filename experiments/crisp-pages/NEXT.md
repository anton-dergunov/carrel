# Crisp pages: where the research stands (1 Nov 2026, late)

For the next session: read this, then [README.md](README.md) (method, results, conclusions, what carrel took, round 2), then `uv run python experiments/crisp-pages/summary.py` (its last table scores each strength against chance). The research plan is [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md); what is built is in [docs/architecture.md](../../docs/architecture.md) (Settings → Pages).

## Done

- **Round 1**, 498 picks and 35 measurements, and **round 2**, 52 picks: see the README (conclusions, what carrel took, round 2's results).
- **Settings → Pages in carrel**, each device's own, with every winner: letters as outlines, bolder letters (a double strike of the canvas), darker greys, sharper edges (a worker over each drawn page), contrast, scans in black and white (`scans.py`, `/api/scans`). Defaults from the research per kind of screen. Checked in WebKit and Chromium: filters, the scan marking, the dialog, the reload with outlines, the strike and the sharpening reaching the pages and undone exactly, scrolling at 17 ms frames with them on.

## Next

1. **A sitting with Settings → Pages** on each device, reading whole papers: are the defaults right (e-ink: outlines, 0.05 pt, scans; a touch screen: greys 1.5, sharpen 0.7; desktop: off), does scrolling stay smooth on the iPad with darker greys on (a CSS SVG filter: occasional slow frames in headless WebKit), does a page look right while the sharpening is worked out after it is drawn, and on the Boox, does the strike's second draw show as a second repaint.
2. Then the research is done: plan-crisp-pages.md retired into the README.

## Notes

- Close calls: the reader picked one of several equally good cells rather than "no difference" when one cell was clearly worse; a ratio near 1 means "as good as the rest".
- The Boox's Chrome says only "Android 10; K", so carrel's e-ink detection does not see it; e-ink's page defaults follow the E-ink colours instead.
- `gpt3-body` under Resolution was picked twice four seconds apart (14:31:44 and :48); `summary.py` counts both.
