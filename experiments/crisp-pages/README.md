# Crisp pages on e-ink

**Question.** On the Boox Tab X C (13.3", 3200×2400, Kaleido 3, Chrome) a paper's text looks thin and grey, and turning the tablet's contrast up makes carrel's chat and library far too heavy. What, done to the page alone, makes it crisp enough that the tablet's contrast can stay at its default? The plan, the candidates and why: [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md).

**Status.** Round 1 (one knob at a time) is ready to run; nothing is picked yet.

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
| Embolden | Every text object filled, then stroked (rendering mode 2), in a copy of the page made on the laptop | 0.1–0.7 pt |
| Glyphs as paths | PDF.js with `disableFontFace`: its own glyph outlines instead of the browser's font rasteriser | on |
| Drawn on the laptop | MuPDF renders the crop at the device's pixels, anti-aliasing 8/4/2/0, with a gamma | 6 recipes |
| Sharpen | Unsharp mask over the canvas's pixels (a worker), about one device pixel | 0.4–3 |
| Contrast | CSS `contrast()` | 1.15–2.5 |
| Threshold, one cut (scans) | SVG: grey, then a step at the level | 45–85% |
| Threshold, Sauvola (scans) | A worker: ink where darker than its neighbourhood's mean, lowered by k | k 0.05–0.5 |

Any knob can be drawn over the laptop's rendering instead of PDF.js's (the "Over" control).

### What PDF.js does on the tablet

Read from PDF.js 6.3.289 while building the bench, and to be checked on the Boox with Measure:

- On Android and iOS its viewer caps a canvas at 5.24 MP. A letter page at page width on a 1200 CSS px window at 2× is 7.4 MP, so the page's canvas is drawn at 42% of the device's pixels (the cap, then halved because a detail canvas will follow), and the part in view is drawn again at full resolution by the detail canvas. Once that is drawn the text in view is at full resolution; between a page turn and the detail canvas it is soft. In Chromium on the laptop at the Boox's size the detail canvas followed 30–90 ms after a turn.
- `useSystemFonts: false` on Android is a setting of PDF.js's own viewer app. Carrel builds its document without it, so PDF.js's default (true) applies. Most papers embed their fonts, so this decides little either way.

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

None yet.
