# Crisp pages: where round 1 stands (1 Nov 2026)

For the next session: read this, then [README.md](README.md) (method, knobs, crops, how to run), then `uv run python experiments/crisp-pages/summary.py` for the picks so far. The research plan is [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md).

## Done

- The bench is built and works on the Boox: `bench.py` (server), `bench/` (the page), `papers.yaml` (15 crops of 6 kinds), `stills.py`, `summary.py`, `find_papers.py`. The reader runs the server in their own terminal; `tailscale serve --bg --https=8444 http://127.0.0.1:8519` publishes it.
- **Boox measured** (`measurements.jsonl`, two papers, PDF.js's cap). Chrome there: `devicePixelRatio` 2.8125, window 853×1012 CSS px (2400×3200 device px); the paper at page width is 821–853 CSS px. The page's canvas is drawn at 42% of the device's pixels, and the detail canvas then redraws the part in view at 100%, typically 0.1–0.4 s after a turn and about 1 s at worst (GPT-3 pp. 3 and 5). So the page in view is at full resolution once it settles; it is soft only briefly after a turn.
- **Boox, knobs Resolution and Tone curve swept** (`picks.jsonl`, 23 picks, 14:31–14:45). The reader's words: on Resolution "anything but the worst option (without the detail layer) looked good enough; I was basically just guessing what's better". On Tone curve "the difference is very minimal; I tend to prefer the smaller boost, but it's nuanced. Most papers are strangely good enough already."
  - Resolution over full resolution: 1.25× picked 9 times, 1.5× 3, the baseline 6 (scans 2 of 2, maths 2 of 3, Word 2 of 3). Read as noise, as the reader says, apart from "before the detail canvas" never being picked.
  - Tone curve: gamma 1.25 ×2, 1.5 ×1, 1.8 ×4, baseline ×1, over 7 screens (no scans or maths yet). A slight lean towards a mild curve.

## Open

1. **What contrast was the Boox set to for these picks?** The Device form's Contrast field was empty (the Refresh field says "Color mode: Optimal"). Ask the reader, and add it to these 23 picks by hand in `picks.jsonl` (`tablet.contrast`) if they know. From now on the field is filled before judging; `summary.py` splits rows by it.
2. **"Most papers are good enough already."** The problem was thin grey text at the tablet's default contrast. If the bench's baseline looks fine at the default contrast, the problem may have been something carrel did then and does not now (its heavier e-ink text is gone), or something in carrel's page the bench lacks (the text layer, the previews behind the page, Dark pages, the page's own colours). Check: open one of the crops' papers in carrel on the Boox, beside the bench's baseline of the same crop, at the default contrast.
3. **The rest of round 1 on the Boox**, in this order: Embolden, Drawn on the laptop, Sharpen, Contrast, Glyphs as paths; the two thresholds on the scans. About one crop of each kind a knob.
4. **A second Boox contrast setting:** only the knobs that won at the default, plus Resolution as a reference.
5. **iPad and phone:** Measure once each, then the knobs that did something on the Boox.
6. Then: round 2 (combine the winners, tune their strengths) or, if nothing beats the baseline clearly, conclude that carrel's pages need no Pages setting and say why in the README.

## Notes

- `gpt3-body` under Resolution was picked twice four seconds apart (14:31:44 and :48), probably a reload; `summary.py` counts both. Drop one when writing results up.
- `stills.py`'s Boox now uses the measured 853×1012 at 2.8125.
- Nothing is committed yet; the commit messages suggested in the first session cover the bench and the summary change.
