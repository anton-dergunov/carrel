# Crisp pages: where the research stands (1 Nov 2026, evening)

For the next session: read this, then [README.md](README.md) (method, knobs, crops, round 1's results), then run `uv run python experiments/crisp-pages/summary.py` for every pick and measurement so far. The research plan is [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md).

## Done

- The bench (`bench.py`, `bench/`, `papers.yaml`, `stills.py`, `summary.py`, `find_papers.py`). The reader runs the server in their own terminal; `tailscale serve --bg --https=8444 http://127.0.0.1:8519` publishes it.
- **Round 1 on the Boox Tab X C, colour mode Optimal**: 127 picks and 16 measurements, written up in the README's Results. In short:
  - **Keep:** glyphs as paths (the reader's favourite), embolden at 0.1–0.18 pt, a mild tone curve (gamma 1.25–1.8), and a threshold for scans (the one cut, 45–65%: rarely needed, but the reader wants it for the scans where it helps).
  - **Drop:** sharpen, contrast, drawn on the laptop (and it would slow every page), resolution beyond the detail canvas.
  - **Every improvement depends on the paper**, so they are options for a paper, not one setting for all pages. This is the reader's decision.
  - The page in view is at full resolution once PDF.js's detail canvas is drawn, 0.1–0.4 s after a turn. Without the detail canvas it is much worse.
- **Round 1 again on the Boox in Custom High Contrast** with the reader's own colour adjustments (108 picks, the bench unchanged, so comparable): the same conclusions, the knobs mattering less (the baseline won more often, lower strengths picked). The reader prefers the default mode with the knobs: more nuanced pages. This mode is not a target.
- **The iPad begun:** Resolution on all 15 crops. The page there is under PDF.js's cap, drawn whole at full resolution at once, so the Resolution knob has nothing to show; the reader saw almost no difference.
- **A caution on close calls:** the top row (A, B) was picked about twice as often as the bottom row on the Boox, and on the iPad every non-"no difference" pick was A. Tone curve and resolution tallies are weak evidence; glyphs, embolden and sharpen's "no difference" are clear.
- After the two Boox passes, two changes to the bench: the Glyphs knob shows a third cell, PDF.js's standard fonts alone (`useSystemFonts: false`, the browser still drawing the font), to tell its two effects apart; Embolden starts at 0.05 pt. Measure has a Glyphs choice, to time a paper drawn as paths in carrel's own viewer.

## Under way (the reader, 1 Nov)

1. The iPad (Chrome), then the MacBook, with the knobs kept (Glyphs, Embolden, Tone curve, the thresholds on scans); Resolution only as a reference.
2. Then back on the Boox (Optimal) for the changed Glyphs knob (its third cell) and Embolden's 0.05 pt, and Measure once with Glyphs: as paths.

The tablet's settings go in the Device tab (a colour mode went into Refresh on the first pass and into Notes on the second); `summary.py` splits rows by every one of those fields.

## Next

1. **Fold in the iPad, the Mac and the Boox's second visit**: does the same set win, at the same strengths? On the iPad and the Mac the system has Times and Arial, so glyphs as paths may matter less there; the third Glyphs cell tells the font fix from the outlines.
2. **Glyphs as paths, its two effects**: from the third cell, is it the standard fonts (only papers that do not embed theirs) or the outlines (every paper)?
3. **What each kept knob costs to draw**: Measure on the Boox with glyphs as paths against as carrel, on two or three papers. The cell times in `picks.jsonl` include loading a document and do not compare.
4. **Round 2, the kept knobs combined** (paths + embolden + tone), on the papers where each won, with strengths tuned. The bench draws one knob over a base; combining needs a base made of the round-1 winners (a small change to `BASES` in `bench.js`).
5. **Per paper**, which the design now has to answer:
   - Can a paper's features predict which option helps (fonts not embedded → paths; thin Type 1 → embolden; Word → leave it), so a paper starts with a sensible choice and the reader only corrects it?
   - Where is the choice kept: per paper and per device (a paper may want embolden on the Boox, not on the iPad), in carrel's state folder or in the browser's `localStorage`? The reader's own data (`catalog/reader.yaml`) is the engine's; ask before using it.
   - How does each option ship in carrel: paths and the standard fonts are `getDocument` options; the tone curve and the scans' threshold are filters beside Dark pages; emboldening was done here by rewriting a copy of the page on the laptop, which carrel cannot do to the reader's PDF, so it needs another route (PDF.js has no stroke option for text: to be researched).
6. Then round 3 (a sitting reading whole papers with the options on) and the Pages part of carrel's Settings.

## Notes

- The Contrast field was empty for the Optimal pass, so the Boox's contrast for those picks is not on record.
- Position bias: the bench shuffles the cells, so it does not skew a knob's tally one way, but it adds noise. If it matters in round 2, show two cells at a time, side by side, so there is no top row.
- `gpt3-body` under Resolution was picked twice four seconds apart (14:31:44 and :48); `summary.py` counts both, and the README notes it.
- `stills.py`'s Boox is the measured 853×1012 at 2.8125.
