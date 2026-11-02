# Other PDF renderers

**Question.** After several rounds of tuning PDF.js ([architecture.md](../../docs/architecture.md), Speed of the PDF), a fast flick still shows grey and blurred pages, and pages blink as they come in. The grey there was WebKit not painting the large canvases PDF.js draws on the main thread. Would a renderer that draws tiles on other threads do better, on the Mac and on the iPad, and by how much?

**Status.** 2 Nov 2026. The renderers: done, on the Mac (42 spins: 7 renderers, 2 papers, 3 rounds) and the iPad (8 recordings flicked by hand), with the reader's impressions; the renderer is not what made carrel slow. What in carrel does: on the Mac (89 spins taking carrel apart, below), the pinch's wheel listener stalled the scroll; and by the reader's eye, the previews and the gate, which stopped a fast spin on blurred pages where vscode-pdf-viewer stops on sharp ones. All three are changed (2 Nov 2026, Afterwards).

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

Every web viewer has the same pane: the whole window, a grey (223), the pages as wide as the pane and 8 px apart, the PDF fetched whole before it is opened, as carrel does.

**On the Mac**, `scripts/mac-bench/bench.py spin` flicks a free-spinning wheel over the pane (to the start, to the end, to the start again, 1.5 s apart), records the window at 60 fps and sorts each frame: unpainted (a quarter of the pane or more one flat colour that is not white: what lies under the page, where WebKit has not painted), blank (a page laid out, white, not drawn), blurred (a quarter of the pane or more drawn below its resolution), or ok. It also measures how long the paper stood still while it was being scrolled (stalled: each wait over 50 ms for the next frame that moved it), and after each stop how long the pane went on changing (settled). [mac_runs.py](mac_runs.py) runs every renderer in turn, round after round, in the same 1230 × 1000 pt pane: the web viewers in the PDFKit app's `WKWebView` (the engine of carrel's Mac app and of the iPad's Safari), in the window its `PDFView` has; Chrome as an instance of its own. [side_by_side.py](side_by_side.py) makes one video a paper of a round's recordings, every renderer in a grid, at their real speed.

Unpainted was first "grey": the pane's own colour, 223, given to the bench. But where WebKit has not painted it shows neither the pane's colour nor the page's, and what it shows depends on the page: a flat 223 under carrel's beige pane, 218 under the bench's grey one. So the same unpainted frames were "grey" in carrel and "blank" in bare PDF.js, and carrel seemed to show grey that PDF.js did not. Every run was sorted again with the flat-colour rule; the tables below are those.

Blurred had to be measured anew too. The bench took a frame for blurred when it held under 60% of the detail of the sharpest frame near it, and a page of photographs held less than a page of text, sharp or not. It now compares a frame's detail at its own pixels with its detail at half of them (`fineness`): about 0.93 for a sharp page, text or photograph, 0.75–0.85 while it moves (the compositor resamples it), 0.55 for a page drawn at half resolution and enlarged. Even so, a photograph the PDF holds at low resolution reads as blurred, so on the figures paper only unpainted, blank, stalled and settled are compared.

**On the iPad**, nothing can post a flick, so the reader flicks by hand: three hard flicks down and up, with Control Centre's screen recording on, for each viewer and for Files, in alternation. `bench.py video` sorts the recording's frames the same way. A phone's recording has a frame only when the screen changed; each counts until the next. What is compared is the share of the time the paper moved that it showed unpainted, blank or blurred, which does not depend on how many flicks there were.

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

| Renderer | Unpainted | Blank | Blurred | Stalled | Settled |
|---|---|---|---|---|---|
| carrel (PDF.js, previews, WebKit) | 439 | 172 | 1074 | 448 | 0 (184) |
| PDF.js, WebKit | 1599 | 167 | 78 | 0 | 0 (0) |
| EmbedPDF, WebKit | 812 | 281 | 2123 | 125 | 264 (448) |
| MuPDF.js, WebKit | 69 | 203 | 1814 | 0 | 170 (176) |
| PDFKit | 0 | 334 | 138 | 0 | 0 (0) |
| PDF.js, Chrome | 0 | 218 | 234 | 17 | 0 (0) |
| PDFium, Chrome | 0 | 229 | 1062 | 0 | 0 (17) |

The figures paper (25 pages of generated images, 44 MB):

| Renderer | Unpainted | Blank | Stalled | Settled |
|---|---|---|---|---|
| carrel | 395 | 1124 | 458 | 99 (800) |
| PDF.js, WebKit | 1117 | 2872 | 51 | 0 (0) |
| EmbedPDF, WebKit | 762 | 853 | 209 | 397 (984) |
| MuPDF.js, WebKit | 22 | 0 | 0 | 217 (267) |
| PDFKit | 0 | 0 | 0 | 0 (0) |
| PDF.js, Chrome | 24 | 2199 | 73 | 0 (0) |
| PDFium, Chrome | 0 | 0 | 39 | 0 (17) |

The same wheel events carry a `PDFView` less far than a web page: in the first second of a spin the web viewers went from page 78 to page 60, PDFKit to page 73. PDFKit crossed fewer pages, so its numbers flatter it.

### The iPad

The iPad Air 11" in portrait (1640 × 2360 px), Safari, the long paper from page 78, three hard flicks down and up by hand, recorded with Control Centre, twice per viewer in alternation. Files is iPadOS's own viewer, PDFKit; it showed its thumbnails beside the page, so its pages were narrower than the web viewers' (1340 px against 1640). The share of the time the paper moved, both recordings together; settled is over the stops between flicks (the first stop, before any flick, and the last, as the recording was stopped, left out). The recordings take in the viewers' opening too, which for MuPDF.js is slow.

| Viewer | Unpainted | Blank | Blurred | Sharp | Settled, median (75th percentile) |
|---|---|---|---|---|---|
| Files (PDFKit) | 3% | 21% | 6% | 70% | 117 ms (417) |
| PDF.js | 23% | 15% | 4% | 58% | 133 ms (233) |
| EmbedPDF | 19% | 18% | 37% | 26% | 500 ms (750) |
| MuPDF.js | 19% | 9% | 53% | 20% | 150 ms (383) |

**From the inside** ([runs.jsonl](runs.jsonl)): on the long paper bare PDF.js kept 52–58 frames a second, with a frame now and then 130–270 ms late as it drew a page on the main thread; MuPDF.js, drawing in workers, 59 frames a second with none over 53 ms; EmbedPDF 54–56, none over 108.

**What the reader saw**, which is what decides: Files was the best, and bare PDF.js not far behind; next to PDF.js in carrel, bare PDF.js flies, on the iPad and still more next to carrel's Mac app. EmbedPDF and MuPDF.js were somewhat slower than bare PDF.js, but still faster than carrel. Carrel is slowest and laggiest of all in the Mac app, slower there than on the iPad. The same PDF.js, the same version, in vscode-pdf-viewer (Chromium) flies too.

### Conclusions on the renderers

- **The renderer is not what makes carrel slow.** Bare PDF.js 6.3.289 in WebKit, the version carrel ships, is close to Apple's own viewer on the iPad (58% of a flick sharp against 70%, settled in the same ~120 ms) and flies by the reader's eye next to carrel.
- **EmbedPDF and MuPDF.js are dropped.** In WebKit both trade white pages for blurred ones, and are sharp for a quarter of a flick or less; EmbedPDF also takes half a second to settle. Neither is worth a viewer's rewrite.
- **PDFKit is the best, and for the Mac app only.** Natively it is the best on both devices, but an app on the iPad needs installing from Xcode: with a free Apple ID it stops opening after 7 days and must be installed again; to last a year, the Apple Developer Program ($99 a year), App Store or not. Carrel stays a web page on the iPad. In the Mac app it is possible (signed for this Mac, it needs nothing), at the cost of every PDF feature written twice.
- **Chromium paints PDF.js at once**: none of WebKit's unpainted frames, so an eighth of its time without a page (218 against 1766 ms on the long paper); which is why vscode-pdf-viewer looks as it does. But bare PDF.js in WebKit already flies by the reader's eye, so WebKit is not the cause of carrel's slowness either.

## What in carrel makes PDF.js slow

**Method.** Elimination, not guessing. Carrel's page can be loaded without any of its additions to PDF.js, or parts of the page around it, named in the address (`?off=previews,gate`; `all` is every addition to the reader), by [static/off.js](../../src/carrel/static/off.js); nothing in the page offers it. [mac_runs.py](mac_runs.py)'s `--carrel-off` runs each variant in turn with the others, in the same web view and pane. A bench page, `/view/carrel-reader`, loads carrel's reader module alone (read.js, boot.js and carrel's stylesheets, in carrel's markup for the pane, without app.js: no tabs, chat or library), and can swap carrel's stylesheet for PDF.js's (`&css=pdfjs`). The long paper throughout, three rounds a variant, alternating, then four more for the decisive ones on both papers. Settings → Pages was off, as on the reader's Mac when it was slow.

**Results** (the long paper, ms a spin, the mean of 3–4 spins):

| Variant | Unpainted + blank | Blurred | Stalled |
|---|---|---|---|
| bare PDF.js | 1400–1770 | 50–130 | 0 |
| carrel | 610–670 | 1030–1090 | 210–450 |
| carrel, its reader's additions all off | 1280–1450 | 10–30 | 0 |
| carrel without the gate (no page drawn during a flick) | 1116 | 753 | 927 |
| carrel without the previews | 2221 | 0 | 253 |
| carrel without the pinch (its touch and wheel listeners) | 665–703 | 1000–1090 | 13–57 |
| carrel without the snapshots, the Pages adjustments, find, or the citation mark | 520–550 | 1080–1190 | 210–250 |
| carrel, all off, and the page's parts too (the badge's blur, the other tabs' panes, containment, the chat, the fixed body) | 1308 | 26 | 0 |
| carrel's reader alone, all off | 1377–1386 | 100–140 | 0 |
| carrel's reader alone, all off, PDF.js's stylesheet | 1515 | 84 | 0 |
| bare PDF.js under carrel's content policy (no WebAssembly) | 1496 | 73 | 0 |

On the figures paper, stalled: bare PDF.js 51–110, carrel 234–458, carrel without the pinch 84; unpainted + blank: bare PDF.js 3730–3990, carrel 620–1520, carrel without the pinch 951.

**What they show.**

- **Carrel paints no worse than bare PDF.js; it stalls.** Its pages are unpainted or white for 0.6 s a spin against bare PDF.js's 1.4–1.8 s (the previews and the gate do their work), but the paper stands still while it is being scrolled for 0.2–0.45 s a spin, where bare PDF.js never does on the long paper. Stalled is the measured part of laggy.
- **The stalls are the pinch's wheel listener.** Without pinch.js, carrel stalls 13–57 ms a spin on the long paper, as bare PDF.js does, and keeps what the previews give. pinch.js listens to `wheel` on the scrolling pane without `passive` (to cancel a trackpad's pinch, which comes as wheel events with ctrlKey), so WebKit cannot scroll on its own: every wheel event waits for the main thread, and the main thread is drawing pages. Without the gate, which keeps the main thread free during a flick, the stalls quadruple (927 ms), which is the same cause seen from the other side. Nothing else in carrel's reader or page moved the stalls.
- **The earlier finding that a passive wheel listener made things worse was the colour artefact.** architecture.md recorded that the pinch's wheel listener made passive let "WebKit scroll ahead of its painting, and the grey grew"; grey there was the unpainted backdrop counted only when it happened to be the pane's colour. Without the pinch, unpainted and blank together are unchanged (665–703 against 610–670 ms).
- **On the iPad** the same holds for touch, by the code, not yet by measurement: pinch.js listens to `touchstart` and `touchmove`, and pan.js to `touchmove`, on the pane without `passive`, and bare PDF.js listens to none. Safari then cannot start or carry a scroll without asking the main thread. The reader is to compare, by eye, carrel with `?off=pinch,pan` against carrel as it is.

**Afterwards.** The reader compared carrel with vscode-pdf-viewer (the same PDF.js, in Chromium) on the long paper, the MX Master's wheel spun free at full speed. vscode-pdf-viewer is sharp the moment the wheel stops; carrel flickered more (unpainted areas) and stopped on blurred pages, sharp only after them. The blur is two of carrel's additions, which this bench had kept for cutting unpainted time: the previews, a blurred picture of every page not yet drawn, and the gate, which begins no page while the paper moves fast, so the pages under the stop are drawn only after it. Both are removed, with the laptop's previews and their cache. The pinch's listeners are kept but no longer hold a scroll: the wheel is cancelled only while ctrl is held, a touch pinch listens to `touchmove` only while it lasts, and pan.js only while the paper is wider than its pane.

**Then the flicker came back, and it is WebKit's.** Without the previews and the gate, the reader saw carrel flicker in a fast spin far more than vscode-pdf-viewer: the pane all grey, nothing painted, not even the pages' white. Recorded by hand on the Mac (the MX Master spun free at full speed through the long paper, `bench.py video`, `mac-hand-spin` in results.jsonl), the share of the time the paper moved that the pane was unpainted: bare PDF.js in Safari 52%, carrel in Safari 49%, carrel's Mac app 47%, vscode-pdf-viewer (Chromium) 5%; side by side in one recording, carrel's app 40% against vscode-pdf-viewer's 6%. By the reader's eye too, bare PDF.js, carrel in Safari and carrel's app flicker alike, and vscode-pdf-viewer far less. So at this speed the unpainted pane is WebKit drawing PDF.js, not carrel, and the earlier verdict that bare PDF.js in WebKit flies holds only for slower flicks. The previews and the gate hid it (unpainted 439 ms a spin against bare PDF.js's 1599 on the bench), at the cost of blurred pages and a late sharp one at the stop.

**So the Mac app moved to Chromium.** Carrel in a Chrome window showed no flicker and was much snappier to the reader's eye; Preview (PDFKit) snappier again, but not by much next to it. The Mac app is now Electron around the same page, and PDFKit in the Mac app alone is recorded in architecture.md (Speed of the PDF) as considered and left, with what it would cost.
