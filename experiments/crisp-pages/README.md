# Crisp pages on e-ink

**Question.** On the Boox Tab X C (13.3", 3200×2400, Kaleido 3, Chrome) a paper's text looks thin and grey, and turning the tablet's contrast up makes carrel's chat and library far too heavy. What, done to the page alone, makes it crisp enough that the tablet's contrast can stay at its default? The plan, the candidates and why: [docs/plan-crisp-pages.md](../../docs/plan-crisp-pages.md).

**Status.** Rounds 1 and 2 done: the Boox in two colour modes, the iPad and the Mac's monitor, 550 picks and 35 measurements. Every winner is in carrel's Settings → Pages; left is a sitting reading with them ([NEXT.md](NEXT.md)). Where it stands and what is next: [NEXT.md](NEXT.md).

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

105 picks over every knob (the bench with the third Glyphs cell and Embolden from 0.05 pt). Chrome there has `devicePixelRatio` 2 and a window 820×1048 CSS px, so a page at page width is about 3.5 MP, under PDF.js's 5.24 MP cap: the whole page is drawn at full resolution at once (Measure: 100% of the device's pixels, no detail canvas), and "before the detail canvas" is the same picture as the baseline there. The crops were drawn at the portrait page width (820 px); the reader reads larger on the iPad, up to 1.5×, and judged that this does not call for a second pass.

The reader: different things matter than on e-ink. Contrast and sharpening are worth much more; the tone curve and glyphs as paths matter little, with no font difference seen; the laptop's drawing is consistently worse than the iPad's own; the thresholds are perceived quite differently from e-ink.

| Knob | Screens | Baseline | No difference | A variant |
|---|---|---|---|---|
| Contrast | 15 | 4 | 0 | 11: 1.15 ×3, 1.3 ×6, 1.5 ×2 |
| Sharpen | 15 | 2 | 2 | 11: 0.4 ×3, 0.7 ×2, 1 ×6 |
| Tone curve | 15 | 1 | 0 | 14: gamma 1.25 ×4, 1.5 ×6, 1.8 ×4 |
| Embolden | 12 | 5 | 0 | 7, all 0.05 pt |
| Glyphs as paths | 12 | 1 | 10 | 1 (the standard fonts alone) |
| Drawn on the laptop | 15 | 15 | 0 | 0 |
| Resolution | 15 | 1 | 7 | 7 (1.25× ×6) |
| Threshold, one cut (scans) | 3 | 1 | 0 | 2 |
| Threshold, Sauvola (scans) | 3 | 0 | 0 | 3, k 0.05–0.2 |

The tallies agree with the reader except for the tone curve, picked over the baseline on 14 of 15 screens though it felt unimportant: a small, consistent preference, or the close-call guessing below (the iPad's picks lean to position A, 37 of 86).

### The MacBook Air, an external monitor, Chrome

133 picks. Resolution first, at the window's full width (2048 CSS px), conclusive: on the desktop PDF.js has no cap, so "before the detail canvas" is the baseline again. Every other knob at the reader's reading size on that monitor (Paper width 1100 CSS px). The monitor is a 5K-class panel scaled 1.25× (`devicePixelRatio` 2), further from the eyes than a tablet.

The reader: almost nothing made a difference. Glyphs as paths were consistently worse, duller and less sharp.

| Knob | Screens | No difference | Preferred (picked ÷ by chance) |
|---|---|---|---|
| Embolden | 24 | 10 | 0.05 pt 1.71, 0.1 pt 1.71; baseline 0.29, 0.18 pt 0.29 |
| Glyphs as paths | 24 | 0 | baseline 1.88, standard fonts alone 1.13, paths 0.00 (never picked) |
| Sharpen | 16 | 3 | baseline 2.15; unsharp 0.7 1.23 |
| Contrast | 17 | 9 | no strength above the baseline |
| Tone curve | 16 | 16 | – |
| Drawn on the laptop | 15 | 0 | baseline 2.40 |

### Across devices

- **Glyphs as paths does two things.** Of the 15 crops, three use fonts the PDF does not embed: ERR and Demšar (Times-Roman, Times-Bold) and Counterfactual (Arial). In carrel these are drawn in whatever Android substitutes; as paths, PDF.js draws its own standard fonts, which is the better font the reader saw. But paths also won on papers that embed every font (GPT-3's body and table, Contrastive Multiview Coding, Collaborative Filtering for Implicit Feedback, the intuition busters), so PDF.js filling its own outlines looks better there than Chrome's font rasteriser too. After the two Boox passes the bench shows the standard fonts alone as a third cell, to tell the two apart, and Embolden starts at 0.05 pt, since 0.1 pt, then the gentlest, won most.
- **What PDF.js draws on the Boox** (Measure, 16 runs over 15 papers): Chrome's `devicePixelRatio` is 2.8125 and its window 853×1012 CSS px; the paper at page width is 821 px. Every page's canvas is drawn at 40–42% of the device's pixels, and the detail canvas then redraws the part in view at 100%, a median 130–360 ms after a turn per paper and 0.7 s at worst. So once it settles a page is at full resolution; resolution is not why text looked thin. On the iPad there is no such soft first drawing.
- **Close calls lean to the top row.** On the Boox, A and B (the top row) were picked about twice as often as C and D in both modes (Optimal 58 to 29, High Contrast 58 to 23), though the order is shuffled; on the iPad A was picked 37 times of 86, D 9. Where the difference is small (tone curve, resolution), a pick is partly a guess, and the tallies for those knobs are weak evidence. Glyphs as paths and embolden on the Boox, "no difference" for sharpen there, and contrast and sharpening on the iPad are clear.
- **The cost of each knob is not measured yet.** The times the bench kept for each cell include loading that cell's own copy of the paper, so they do not compare. Measure now draws a whole paper with glyphs as paths in carrel's own viewer, for that.

## Conclusions

A pick was made among a baseline and up to three strengths, so picking at random favours "a change" three to one. The conclusions read each strength's picks against what chance gives it (`summary.py`'s last table: above 1 preferred, below 1 not); the reader's impressions are beside them. The reader's tactic on a screen with three good cells and one bad was to pick one of the good, which spreads the picks among the good but never on the bad: a ratio near 1 means "as good as the rest", 0 means "worse".

| | Boox (e-ink, the main reading device) | iPad | Mac, external monitor |
|---|---|---|---|
| Glyphs as paths | **Yes**: 2.19 (Optimal, both visits), 1.50 (High Contrast); baseline 0.12, 0.58 | No difference (10 of 12) | **No**: never picked, duller |
| …its standard fonts alone | 0.27 (Optimal), 0.75 (High Contrast), with the outlines beside it: the outlines are what helps, not the fonts | – | 1.13, about the baseline |
| Embolden | **0.1 pt**: 2.22 and 1.67; 0.18 pt even, 0.25 pt never; 0.05 pt not shown there | 0.05 pt only (2.33, baseline 1.67); 0.1 pt and up never | **0.05–0.1 pt**: 1.71 each, baseline 0.29 |
| Tone curve | Unclear: baseline 1.22, gamma 1.8 1.39, 1.25–1.5 0.70; in High Contrast the baseline wins | **Gamma 1.5**: 1.60, baseline 0.27 | No difference (16 of 16) |
| Sharpen | No difference (15 of 16) | **Unsharp 1**: 1.85, baseline 0.62 | No: baseline 2.15 |
| Contrast | No difference (11 of 15) | 1.3: 1.60, baseline 1.07, a weak lean | No |
| Threshold for scans | Yes, any of 45–65%: 1.33 each, baseline never (7 screens) | Slight | No |
| Drawn on the laptop | No | **No**: baseline every time | No |
| Resolution | Only the page before its detail canvas, much worse | Nothing to choose | Nothing to choose |

- **Each device wants different options**, and the reader notices them most on e-ink, less on the iPad, least on the Mac's monitor (further away, fewer pixels to the degree). On the Mac's own screen the reader expects the iPad's answers.
- **What it costs.** Glyphs as paths on the Boox (Measure, 15 papers each way): the page in view is sharp a median 174 ms after a turn, against 171 ms as carrel draws it; per paper the two are within noise. The filters (tone, contrast, threshold) run on the GPU. Embolden and sharpening are drawn here by routes carrel cannot ship as they are (a rewritten copy of the page on the laptop; a worker over every canvas's pixels), so their cost depends on the route carrel takes.

## What carrel took from it

Decided with the reader on 1 Nov 2026, and built ([architecture.md](../../docs/architecture.md), Settings → Pages):

- **Each device's own, not each paper's.** Which adjustment helps changes from paper to paper, but a choice kept per paper would leave the reader unsure what is on and why a paper looks as it does. So one switch, Adjust pages, over the adjustments, which keeps them when off: a paper can be seen as it is and back in a tap. No presets.
- **The controls**: letters as outlines; darker greys (gamma 1.25, 1.5, 1.8); contrast (1.15, 1.3, 1.5), which the tallies did not favour but the reader wants for pictures on the colour e-ink screen, which cannot show every colour; scans in black and white (ink below 55%), on the pages that are scans alone.
- **Where each kind of screen starts**: e-ink with outlines, bolder letters at 0.05 pt and black-and-white scans; a touch screen with darker greys at 1.5 and sharper edges at 0.7; a desktop with nothing on.
- **Left out**: drawing on the laptop (worse on the iPad, slower everywhere), more resolution than the screen's, Sauvola's threshold (the one cut is as good on these scans, and runs on the GPU).

## Round 2: routes carrel can ship

Embolden and sharpening were drawn in round 1 in ways carrel cannot use. Emboldening rewrote a copy of the page on the laptop, but carrel saves highlights into the PDF as the page loaded it, so it cannot load a rewritten one. Sharpening worked over every pixel in a worker, too slow for every page. Two knobs on the bench put a shippable route beside the round-1 one at the same strengths:

- **Embolden, shippable**: a double strike. The page's canvas is drawn over itself, moved sideways by the stroke's width in device pixels, keeping the darker of the two. It thickens a letter's vertical stems as the stroke does, and every line of a figure a little too.
- **Sharpen, shippable**: the same unsharp mask as one 3×3 SVG convolution on the canvas, on the GPU, as the other filters are.

If the shippable route is picked as often as the round-1 one, it ships at the strength the reader chose; if it is worse, the next idea is tried there.

### Round 2's results

52 picks, 1 Nov 2026, on the first screen of each knob (the shippable route and the round-1 one at the lowest strength, and the shippable one a step stronger). Scores against chance, as in the conclusions:

| | Baseline | Shippable, lowest | Round 1's, lowest | Shippable, a step up |
|---|---|---|---|---|
| Embolden, Boox Optimal | 0.40 | strike 0.05 pt: 1.20 | stroke 0.05 pt: 1.20 | strike 0.1 pt: 1.20 |
| Embolden, Boox High Contrast | 0.80 | 2.00 | 1.20 | 0.00 |
| Embolden, Mac monitor | 0.33 | 1.00 | 2.67 | 0.00 |
| Sharpen, iPad | 0.25 | GPU 0.4: 0.75 | worker 0.4: 1.00 | GPU 0.7: 2.00 |

The reader: both very shippable. The double strike now and then looked a little bolder than the stroke, and was preferred about half as often as the stroke was, otherwise even; the GPU sharpening was more than enough. On the Boox the strike matches the stroke; on the Mac's monitor it reads bolder at the same width, and 0.1 pt is too much there.

**What shipped.** The double strike, as bolder letters (0.05, 0.1, 0.18 pt; e-ink starts at 0.05, the step that matched the stroke everywhere). Sharpening as round 1's worker, not the GPU's SVG filter the reader also liked: as a CSS filter on the page the convolution was worked out at every frame of a scroll, 600–950 ms a frame in headless Chromium and stalls of 280 ms in WebKit, and baking it into the canvas with a canvas filter is ignored by WebKit. The worker sharpens each page once it is drawn (scrolling stayed at 17 ms frames); round 2 found the two alike. A touch screen starts at 0.7.
