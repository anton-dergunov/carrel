# Other PDF renderers

**Question.** After several rounds of tuning PDF.js ([architecture.md](../../docs/architecture.md), Speed of the PDF), a fast flick still shows grey and blurred pages, and pages blink as they come in. The grey there was WebKit not painting the large canvases PDF.js draws on the main thread. Would a renderer that draws tiles on other threads do better, on the Mac and on the iPad, and by how much?

**Status.** Done, 2 Nov 2026: the Mac (42 spins: 7 renderers, 2 papers, 3 rounds) and the iPad (8 recordings flicked by hand: 3 web viewers and Files, twice each), with the reader's own impressions. The renderer was not what made carrel slow; what in carrel does is the next question.

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

The iPad Air 11" in portrait (1640 × 2360 px), Safari, the long paper from page 78, three hard flicks down and up by hand, recorded with Control Centre, twice per viewer in alternation. Files is iPadOS's own viewer, PDFKit; it showed its thumbnails beside the page, so its pages were narrower than the web viewers' (1340 px against 1640). The share of the time the paper moved, both recordings together; settled is over the stops between flicks (the first stop, before any flick, and the last, as the recording was stopped, left out).

| Viewer | Blank | Blurred | Sharp | Settled, median (75th percentile) |
|---|---|---|---|---|
| Files (PDFKit) | 22% | 7% | 70% | 117 ms (417) |
| PDF.js | 35% | 7% | 58% | 133 ms (233) |
| EmbedPDF | 32% | 41% | 27% | 500 ms (750) |
| MuPDF.js | 22% | 58% | 21% | 150 ms (383) |

**From the inside** ([runs.jsonl](runs.jsonl)): on the long paper bare PDF.js kept 52–58 frames a second, with a frame now and then 130–270 ms late as it drew a page on the main thread; MuPDF.js, drawing in workers, 59 frames a second with none over 53 ms; EmbedPDF 54–56, none over 108.

**What the reader saw**, which is what decides: Files was the best, and bare PDF.js not far behind; next to PDF.js in carrel, bare PDF.js flies, on the iPad and still more next to carrel's Mac app. EmbedPDF and MuPDF.js were somewhat slower than bare PDF.js, but still faster than carrel. Carrel is slowest and laggiest of all in the Mac app, slower there than on the iPad. The same PDF.js, the same version, in vscode-pdf-viewer (Chromium) flies too.

## Conclusions

- **The renderer is not what makes carrel slow.** Bare PDF.js 6.3.289 in WebKit, the version carrel ships, is close to Apple's own viewer on the iPad (58% of a flick sharp against 70%, settled in the same ~120 ms) and far ahead of carrel by the reader's eye; on the Mac it settled at once, with nothing grey. Whatever carrel adds around PDF.js costs more than any change of renderer would gain. On the Mac that is measured too: in the same `WKWebView`, carrel showed grey for 0.4 s a spin and bare PDF.js none.
- **EmbedPDF and MuPDF.js are dropped.** In WebKit both trade white pages for blurred ones, and are sharp for a third or less of a flick; EmbedPDF also takes half a second to settle. Neither is worth a viewer's rewrite.
- **PDFKit is the best, and for the Mac app only.** Natively it is the best on both devices, but an app on the iPad needs installing from Xcode: with a free Apple ID it stops opening after 7 days and must be installed again; to last a year, the Apple Developer Program ($99 a year), App Store or not. Carrel stays a web page on the iPad. In the Mac app it is possible (signed for this Mac, it needs nothing), at the cost of every PDF feature written twice.
- **Chromium draws PDF.js with fewer white pages** (a seventh of WebKit's on the Mac), which is why vscode-pdf-viewer looks as it does; but bare PDF.js in WebKit already flies by the reader's eye, so it is not the cause of carrel's slowness either.

**Next.** Find what in carrel's reading makes PDF.js slow, by taking carrel's additions away one at a time and measuring each with this bench (the Mac's spin, in the same web view, and the reader's eye on the iPad), rather than by guessing at a cause. Before any renderer is reconsidered.
