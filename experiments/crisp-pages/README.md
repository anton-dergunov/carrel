# Crisp pages on e-ink

**Question.** On the Boox Tab X C (13.3", 3200×2400, Kaleido 3, Chrome) a paper's text looks thin and grey, and turning the tablet's contrast up makes carrel's chat and library far too heavy. What, done to the page alone, makes it crisp enough that the tablet's contrast can stay at its default? The plan, the candidates and why: [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md).

**Status.** Round 1 done on the Boox in two colour modes (235 picks, 16 measurements); the iPad begun. Under way: the iPad, then the Mac, then the Boox again for the changed Glyphs and Embolden knobs. Where it stands and what is next: [NEXT.md](NEXT.md).

## Method

The reader judges, on the tablet itself. A bench page served from the laptop shows one crop of a paper at the size the tablet reads it in carrel (the page at page width, at the device's own pixels), drawn several ways side by side: the baseline as carrel draws it, and the same crop with one knob at three strengths. The cells are shuffled and labelled A–D, and what each is stays hidden until the pick. A pick (or "no difference") is kept with every cell's recipe, the device and the tablet's own settings.

The same comparisons run on the iPad and a 7" Android phone, for the knobs that did something on the Boox.

**Rounds.** 1: each knob alone against the baseline, on every kind of page. 2: the two or three that won, combined, with their strengths tuned. 3: a sitting reading a whole paper with the winner. Then the Pages part of carrel's Settings.

### The pages

Fifteen crops from the library, the same every round ([papers.yaml](papers.yaml)), found by [find_papers.py](find_papers.py) from each PDF's producer, fonts and images:

| Kind | Papers |
|---|---|
| Modern LaTeX | Language Models are Few-Shot Learners (Times, p. 4); Scaling up Test-Time Compute with Latent Reasoning (Computer Modern, p. 3) |
| A dense table | Language Models are Few-Shot Learners (p. 23) |
| Word | Online controlled experiments at large scale (Calibri); A/B testing intuition busters; Counterfactual Explanations without Opening the Black Box (Times New Roman) |
| Thin Type 1 | Expected Reciprocal Rank (2009); Statistical Comparisons of Classifiers over Multiple Data Sets (2006); Collaborative Filtering for Implicit Feedback Datasets (2008) |
| Scanned | Time, Clocks, and the Ordering of Events (1978, clean); Adaptive Mixtures of Local Experts (1991, noisy); Support-Vector Networks (1995, a figure) |
| Maths with a figure | SGDR; Contrastive Multiview Coding; Transcoders Find Interpretable LLM Feature Circuits |

### The knobs

| Knob | How it is drawn | Strengths |
|---|---|---|
| Resolution | PDF.js at 1.25–2× the device's pixels, shown at the same size; and the page as PDF.js draws it before its detail canvas | before detail, 1.25, 1.5, 2 |
| Tone curve | SVG `feComponentTransfer` gamma on the canvas: greys darker, white and black kept | 1.25–3.3 |
| Embolden | Every text object filled, then stroked (rendering mode 2), in a copy of the page made on the laptop | 0.1–0.7 pt (0.05 added after the Boox's first pass) |
| Glyphs as paths | PDF.js with `disableFontFace`: its own glyph outlines instead of the browser's font rasteriser, and its standard fonts for those the PDF does not embed | on; and, after the Boox's first pass, the standard fonts alone (`useSystemFonts: false`) |
| Drawn on the laptop | MuPDF renders the crop at the device's pixels, anti-aliasing 8/4/2/0, with a gamma | 6 recipes |
| Sharpen | Unsharp mask over the canvas's pixels (a worker), about one device pixel | 0.4–3 |
| Contrast | CSS `contrast()` | 1.15–2.5 |
| Threshold, one cut (scans) | SVG: grey, then a step at the level | 45–85% |
| Threshold, Sauvola (scans) | A worker: ink where darker than its neighbourhood's mean, lowered by k | k 0.05–0.5 |

Any knob can be drawn over the laptop's rendering instead of PDF.js's (the "Over" control).

### What PDF.js does on the tablet

Read from PDF.js 6.3.289 while building the bench, and confirmed on the Boox with Measure:

- On Android and iOS its viewer caps a canvas at 5.24 MP. A letter page at page width on a 1200 CSS px window at 2× is 7.4 MP, so the page's canvas is drawn at 42% of the device's pixels (the cap, then halved because a detail canvas will follow), and the part in view is drawn again at full resolution by the detail canvas. Once that is drawn the text in view is at full resolution; between a page turn and the detail canvas it is soft. In Chromium on the laptop at the Boox's size the detail canvas followed 30–90 ms after a turn.
- `useSystemFonts: false` on Android is a setting of PDF.js's own viewer app. Carrel builds its document without it, so PDF.js's default (true) applies. It matters for a font the PDF does not embed: Android has no Times or Arial, so such text is drawn in whatever the system substitutes. With `disableFontFace` PDF.js also turns `useSystemFonts` off and draws its own standard fonts (see Glyphs as paths below).

## Running it

```sh
uv run python experiments/crisp-pages/bench.py --library ~/papers          # in your own terminal; Ctrl-C ends it
tailscale serve --bg --https=8444 http://127.0.0.1:8519                    # once
# then on the tablet: https://<this Mac>.<tailnet>.ts.net:8444/
uv run --group shots python experiments/crisp-pages/stills.py              # every variant as PNGs, for the laptop (bench running)
uv run python experiments/crisp-pages/summary.py                           # the picks and measurements as tables
```

On each device: **Device** first (type the device's name and its own settings, which go with every pick), then **Measure** once on a paper, then **Compare**: choose a knob, pick a cell or "No difference", "Next crop" for the next page of that kind, and "Gentler"/"Stronger" to move the strengths. Give the e-ink screen a full refresh before judging.

Results: [picks.jsonl](picks.jsonl) and [measurements.jsonl](measurements.jsonl) (committed: device facts, recipes and choices, no paper text). Stills and photos of the tablet's screen are not committed; the papers are not openly licensed.

## Results

Round 1, 1 Nov 2026: the Boox Tab X C in two colour modes, and the iPad begun. Tallies with `summary.py`; a screen is one crop with the baseline and up to three strengths. The reader's verdict, in their words, comes first; the tallies agree with it except where noted.

**Every improvement depends on the paper.** Which knob helps, and how much, changed from paper to paper, so a winner is an option to turn on for a paper, not a setting for every page.

### The Boox, colour mode Optimal

127 picks over 15 crops, and Measure on 15 papers. The tablet's contrast was not recorded (the field was left empty).

| Knob | Screens | Baseline | No difference | A variant | The reader |
|---|---|---|---|---|---|
| Glyphs as paths | 13 | 1 | 3 | 9 | Liked it best; on some papers it also replaced a poor font with a much better one |
| Embolden | 18 | 4 | 0 | 14: 0.1 pt ×10, 0.18 pt ×4 | Works well sometimes. Never stronger than 0.18 pt; the baseline won three of six Word screens |
| Tone curve | 24 | 7 | 1 | 16: gamma 1.25 ×4, 1.5 ×4, 1.8 ×8 | Helps, but the difference is nuanced; prefers the smaller boost. The baseline won 3 of 5 thin Type 1 screens and 3 of 6 Word |
| Resolution | 16 | 6 | 0 | 10: 1.25× ×7, 1.5× ×3 (one of them recorded twice) | As carrel draws it was usually fine, the choice among the rest a guess; the page before its detail canvas is much worse and was never picked |
| Contrast | 15 | 1 | 11 | 3, all mild | Tiny change |
| Sharpen | 16 | 0 | 15 | 1 | Very little change |
| Drawn on the laptop | 15 | 1 | 8 | 6, anti-aliasing 2–8 | Rarely useful, and would make every page slower |
| Threshold, one cut (scans) | 7 | 0 | 1 | 6, 45–65% | Rarely useful, though the tallies favour it on scans; kept, for scans |
| Threshold, Sauvola (scans) | 3 | 1 | 1 | 1 | Rarely useful |

### The Boox, colour mode Custom High Contrast

108 picks, the same crops and knobs (the bench before the Glyphs and Embolden changes below, so directly comparable with Optimal). The reader's own colour adjustments on; a mode they would not read in, since it makes everything far too contrasty. The reader: mostly the same conclusions, but the knobs matter less; the default mode with the knobs gives more nuanced pages, and is preferred.

| Knob | Screens | Baseline | No difference | A variant |
|---|---|---|---|---|
| Glyphs as paths | 12 | 4 | 0 | 8 |
| Embolden | 12 | 7 | 0 | 5, all 0.1 pt |
| Tone curve | 15 | 7 | 0 | 8: gamma 1.25 ×4, 1.5 ×3, 1.8 ×1 |
| Resolution | 16 | 9 | 0 | 7: 1.25× ×4, 1.5× ×3 |
| Contrast | 15 | 4 | 7 | 4, mostly 1.15 |
| Sharpen | 15 | 0 | 15 | 0 |
| Drawn on the laptop | 15 | 3 | 5 | 7 |
| Threshold, one cut (scans) | 5 | 2 | 0 | 3, 45–55% |
| Threshold, Sauvola (scans) | 3 | 1 | 0 | 2, k 0.1 |

The tallies agree: with the tablet darkening everything, the baseline wins more often (embolden 7 of 12 against 4 of 18; resolution 9 of 16 against 6), and the strengths picked are lower (tone 1.25–1.5 rather than 1.8).

### The iPad 11", Chrome

Begun: Resolution on all 15 crops. Chrome there has `devicePixelRatio` 2 and a window 820×1048 CSS px, so a page at page width is about 3.5 MP, under PDF.js's 5.24 MP cap: the whole page is drawn at full resolution at once (Measure: 100% of the device's pixels, no detail canvas), and "before the detail canvas" is the same picture as the baseline there. The reader rarely saw a difference: 7 of 15 no difference, and every other pick was the cell in position A, which reads as a guess.

### Across devices

- **Glyphs as paths does two things.** Of the 15 crops, three use fonts the PDF does not embed: ERR and Demšar (Times-Roman, Times-Bold) and Counterfactual (Arial). In carrel these are drawn in whatever Android substitutes; as paths, PDF.js draws its own standard fonts, which is the better font the reader saw. But paths also won on papers that embed every font (GPT-3's body and table, Contrastive Multiview Coding, Collaborative Filtering for Implicit Feedback, the intuition busters), so PDF.js filling its own outlines looks better there than Chrome's font rasteriser too. After the two Boox passes the bench shows the standard fonts alone as a third cell, to tell the two apart, and Embolden starts at 0.05 pt, since 0.1 pt, then the gentlest, won most.
- **What PDF.js draws on the Boox** (Measure, 16 runs over 15 papers): Chrome's `devicePixelRatio` is 2.8125 and its window 853×1012 CSS px; the paper at page width is 821 px. Every page's canvas is drawn at 40–42% of the device's pixels, and the detail canvas then redraws the part in view at 100%, a median 130–360 ms after a turn per paper and 0.7 s at worst. So once it settles a page is at full resolution; resolution is not why text looked thin. On the iPad there is no such soft first drawing.
- **Close calls lean to the top row.** On the Boox, A and B (the top row) were picked about twice as often as C and D in both modes (Optimal 58 to 29, High Contrast 58 to 23), though the order is shuffled; on the iPad every pick that was not "no difference" was A. Where the difference is small (tone curve, resolution), a pick is partly a guess, and the tallies for those knobs are weak evidence. Glyphs as paths, embolden on the Boox, and "no difference" for sharpen are clear.
- **The cost of each knob is not measured yet.** The times the bench kept for each cell include loading that cell's own copy of the paper, so they do not compare. Measure now draws a whole paper with glyphs as paths in carrel's own viewer, for that.
