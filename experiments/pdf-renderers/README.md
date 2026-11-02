# Other PDF renderers

**Question.** After several rounds of tuning PDF.js ([architecture.md](../../docs/architecture.md), Speed of the PDF), a fast flick still shows grey and blurred pages, and pages blink as they come in. The grey there was WebKit not painting the large canvases PDF.js draws on the main thread. Would a renderer that draws tiles on other threads do better, on the Mac and on the iPad, and by how much?

**Status.** The Mac measured, 2 Nov 2026 (42 spins: 7 renderers, 2 papers, 3 rounds). The iPad not yet: its recordings are by hand.

## The renderers

| Renderer | How it draws | Licence | Where it runs here |
|---|---|---|---|
| PDF.js 6.3.289 (carrel's) | Each page as one canvas, on the main thread, from a worker's parsing | Apache-2.0 | carrel itself, and a bare `PDFViewer` with carrel's options and nothing else (`viewers/pdfjs.js`) |
| EmbedPDF 2.15.1 | PDFium compiled to WebAssembly, in a worker; each page a picture at low resolution with 768 px tiles over the part in view, shown as `<img>`s | MIT | its own viewer, toolbars left out (`viewers/embedpdf.js`) |
| MuPDF.js 1.28.1 | MuPDF compiled to WebAssembly; no viewer, so a minimal one: two workers, each page first whole at a quarter of the screen's resolution, then bands 512 device px tall at full resolution once the paper moves under two screens a second, shown as `bitmaprenderer` canvases | AGPL-3.0 | `viewers/mupdf.js`, `viewers/mupdf-worker.js` |
| PDFKit | Apple's: tiles drawn on other threads, composited by Core Animation | Apple's SDK | Preview on the Mac; Files on the iPad; and `pdfkit/`, a Mac app with a `PDFView` beside an empty `WKWebView`, laid out as carrel lays out its PDF |
| PDFium in Chrome | Chrome's own viewer: PDFium in native code, tiles on other threads | BSD-3-Clause | Chrome on the Mac, the PDF opened directly |

PDF.js in Chrome (the bare viewer) is also measured: it says what Electron would give the Mac app, the same PDF.js with Chromium drawing.

### The licences

MuPDF.js is under the AGPL, as is PyMuPDF, which carrel already uses (`previews.py`, `scans.py`, and the engine's `highlights.py`); MuPDF.js would add no obligation carrel does not have now. Carrel's own files stay MIT. Whoever distributes carrel with MuPDF in it, or runs it as a service for other people, must offer the source of the whole of it under the AGPL's terms, which a public repository already does. It would matter for a closed or paid version (Artifex sells a commercial licence) or for the App Store, whose terms do not sit with the GPL family. EmbedPDF (MIT) and PDFKit carry no such condition.

## Method

The same three papers in every renderer ([papers.yaml](papers.yaml)), each opened at its middle page:

| Id | Paper | Kind |
|---|---|---|
| `text` | ZeRO: Memory Optimizations Toward Training Trillion Parameter Models | LaTeX, text with a few plots (24 pages, 0.8 MB) |
| `figures` | Scalable Diffusion Models with Transformers | pages of generated images (25 pages, 44 MB) |
| `long` | Sparks of Artificial General Intelligence | a long report with figures (155 pages, 7 MB) |

Every web viewer has the same pane: the whole window, carrel's grey (223), the pages as wide as the pane and 8 px apart, the PDF fetched whole before it is opened, as carrel does.

**On the Mac**, `scripts/mac-bench/bench.py spin` flicks a free-spinning wheel over the pane (to the start, to the end, to the start again, 1.5 s apart), records the window at 60 fps and sorts each frame: grey (nothing painted), blank (a page with no ink), blurred (a quarter of the pane or more drawn below its resolution), or ok; and after each stop, how long the pane went on changing (settled). [mac_runs.py](mac_runs.py) runs every renderer in turn, round after round, in the same 1230 × 1000 pt pane: the web viewers in the PDFKit app's `WKWebView` (the engine of carrel's Mac app and of the iPad's Safari), in the window its `PDFView` has; Chrome as an instance of its own. [side_by_side.py](side_by_side.py) makes one video a paper of a round's recordings, every renderer in a grid, at their real speed.

Blurred had to be measured anew. The bench took a frame for blurred when it held under 60% of the detail of the sharpest frame near it, and a page of photographs held less than a page of text, sharp or not. It now compares a frame's detail at its own pixels with its detail at half of them (`fineness`): about 0.93 for a sharp page, text or photograph, 0.75–0.85 while it moves (the compositor resamples it), 0.55 for a page drawn at half resolution and enlarged. Even so, a photograph the PDF holds at low resolution reads as blurred, so on the figures paper only grey, blank and settled are compared.

**On the iPad**, nothing can post a flick, so the reader flicks by hand: three hard flicks down and up, with Control Centre's screen recording on, for each viewer and for Files, in alternation. `bench.py video` sorts the recording's frames the same way. A phone's recording has a frame only when the screen changed; each counts until the next. What is compared is the share of the time the paper moved that it showed grey, blank or blurred, which does not depend on how many flicks there were.

**From the inside**, each viewer's page keeps its frames that came late (over 25 ms) and, but EmbedPDF's (its pages carry no number to watch), each page's time from coming into view to its first pixels and to sharp (`viewers/frames.js`, kept in `runs.jsonl`). It cannot see a frame WebKit did not paint; the recordings do.

## Running it

```sh
./experiments/pdf-renderers/fetch.sh                                  # once: EmbedPDF and MuPDF.js, into vendor/
uv run python experiments/pdf-renderers/bench.py --library ~/papers   # http://127.0.0.1:8519/
tailscale serve --bg --https=8444 http://127.0.0.1:8519               # once: the bench on the tailnet, for the iPad

# The PDFKit app, which also shows the web viewers in its WKWebView (Xcode, brew install xcodegen)
(cd experiments/pdf-renderers/pdfkit && xcodegen generate --quiet \
  && xcodebuild -project PDFKitSpike.xcodeproj -scheme PDFKitSpike -derivedDataPath build -quiet)

# On the Mac: every renderer in turn (it takes the mouse and the screen for about 15 minutes),
# then a video a paper of one round
uv run --with numpy python experiments/pdf-renderers/mac_runs.py --out /tmp/carrel-renderers
uv run --with numpy --with pillow python experiments/pdf-renderers/side_by_side.py /tmp/carrel-renderers --round 1

# The iPad's recordings, AirDropped into recordings/ (not in git)
uv run --with numpy python scripts/mac-bench/bench.py video experiments/pdf-renderers/recordings/*.mov \
  --json experiments/pdf-renderers/results.jsonl --label "ipad"
```

MuPDF.js takes a few seconds to open a paper: each of its two workers compiles 10 MB of WebAssembly and opens its own copy. That is not what is measured here; a real viewer would compile once and keep its workers.

## Results

### The Mac

A 1230 × 1000 pt pane on the MacBook Air's 8192 × 2304 screen (Crisp's, for a 5120 × 1440 monitor), the mean of three spins, in ms; settled is the median and the longest of nine stops.

The long paper (155 pages, from page 78):

| Renderer | Grey | Blank | Blurred | Settled |
|---|---|---|---|---|
| carrel (PDF.js, previews, WebKit) | 439 | 172 | 1074 | 0 (184) |
| PDF.js, WebKit | 0 | 1761 | 78 | 0 (0) |
| EmbedPDF, WebKit | 0 | 1140 | 2073 | 264 (448) |
| MuPDF.js, WebKit | 0 | 305 | 1798 | 170 (176) |
| PDFKit | 0 | 708 | 94 | 0 (0) |
| PDF.js, Chrome | 0 | 262 | 228 | 0 (0) |
| PDFium, Chrome | 0 | 234 | 1062 | 0 (17) |

The figures paper (25 pages of generated images, 44 MB):

| Renderer | Grey | Blank | Settled |
|---|---|---|---|
| carrel | 395 | 1124 | 99 (800) |
| PDF.js, WebKit | 0 | 3989 | 0 (0) |
| EmbedPDF, WebKit | 0 | 1621 | 397 (984) |
| MuPDF.js, WebKit | 0 | 34 | 217 (267) |
| PDFKit | 0 | 0 | 0 (0) |
| PDF.js, Chrome | 0 | 2257 | 0 (0) |
| PDFium, Chrome | 0 | 0 | 0 (17) |

The same wheel events carry a `PDFView` less far than a web page: in the first second of a spin the web viewers went from page 78 to page 60, PDFKit to page 73. PDFKit crossed fewer pages, so its numbers flatter it.

### The iPad

Not yet measured.

## Conclusions

So far, from the Mac alone.

- **WebKit, not PDF.js, is most of the blank.** The same PDF.js page shows a seventh of the blank pages in Chrome that it shows in WebKit on the long paper (262 against 1761 ms), with little blur, and settles as fast. On the Mac, Chromium (Electron) would do more than any renderer in WebKit; it does nothing for the iPad.
- **EmbedPDF is no better in WebKit.** Fewer blank pages than bare PDF.js, but more blur than anything else, and the slowest to settle (a quarter to a whole second after a stop). Drawing its tiles as `<img>`s from blob URLs costs WebKit as much as PDF.js's canvases. Not worth pursuing.
- **Drawing off the main thread in WebKit trades blank for blur.** MuPDF.js's workers keep the pages from ever showing white, as PDFium in Chrome and PDFKit do, but each page arrives first at a quarter of its resolution and is sharp only 170–220 ms after the paper stops (its 120 ms wait for the scroll to settle, then the bands). That is about what carrel's previews already give, with a sharper placeholder; not the step a change of renderer would need to be.
- **PDFKit is the best on the Mac**: nothing blank on the figures paper, almost no blur, sharp as the paper stops; with the caveat that it was carried less far.
- **Carrel shows grey that bare PDF.js does not** (0.4 s a spin, in the same web view), so something carrel adds around PDF.js (the scroll gate, the previews, the snapshots, or its layout) leaves the pane unpainted. That is worth finding whatever renderer is chosen.

The iPad decides between PDFKit and staying with PDF.js: it is where the reader reads, and there Chromium is not an option.
