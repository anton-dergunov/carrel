# Plan: a faster PDF

Scrolling and switching papers in carrel feel slower than vscode-pdf-viewer on the same Mac, with the same PDF.js (6.3.289). This is what could close the gap, roughly in the order worth trying. What is built is described in [architecture.md](architecture.md#layout-and-tabs); this file keeps only what is left.

## What matters, and what to keep

- **The iPad and the Mac first**, where the reader reads and notices speed. The e-ink tablet is slow by design and read at the pace of its page turns: what helps the others may help it as a bonus, but nothing is tuned for it at their cost.
- **Keep what the crisp-pages research settled** ([experiments/crisp-pages](../experiments/crisp-pages/README.md), Settings → Pages in [architecture.md](architecture.md)). Nothing here may undo it:
  - On e-ink each page is drawn once, whole and sharp (`maxCanvasPixels` 16.7 MP in `read.js`). PDF.js's capped first drawing plus a detail canvas made the text jump up on every turn there; don't bring the two drawings back on e-ink, as a smaller canvas or a lower cap would.
  - Settings → Pages: letters as outlines (`disableFontFace`, which reloads the paper), bolder letters and sharper edges drawn on every canvas, the detail canvas too, at `pagerendered` (`page-adjust.js`), and the darker greys, contrast and scans' black and white as filters on the canvases alone. A change to how or when pages are drawn (kept documents, pages drawn ahead, PDF.js's newer drawing options) must keep these applied to every canvas the reader sees, once each: a page struck twice is bolder.
  - The previews behind the pages, and the place each tab keeps.

## What we know

- **carrel's own code costs nothing measurable.** A bare PDF.js viewer, made from the same vendored files, draws a page after a jump in the same time as carrel's page, in WebKit and in Chromium, and carrel's page does no work while idle.
- **The engine differs.** vscode-pdf-viewer runs in VS Code's Chromium; carrel runs in WebKit (Safari, the iPad, the Mac app's WKWebView). In headless runs Chromium drew a page after a jump in 62 ms against WebKit's 72–78 ms. The gap the eye sees on the real screen is larger than that.
- **Done so far:** the pages' canvases on the GPU (`enableHWA`): in WebKit at 2x, 74 → 46–63 ms after a jump, and the slowest scroll frames 25–33 → 18–19 ms. A preview behind each page until it is drawn, so a fast scroll or a tab no longer shows white sheets. Nothing drawn while the paper flies past (`scroll-gate.js`), a tab put back from a copy of its pages (`snapshots.js`), and the last three papers kept loaded: what each does is in [architecture.md](architecture.md#layout-and-tabs).
- **The Mac was swapping** (9–12 GB of swap, 16 GB of RAM) while this was measured, which slows every app, WebKit's drawing included. Lowering it is a task of its own, outside carrel.

## What the Mac app showed (2026-11-01)

Measured with `scripts/mac-bench/bench.py`: wheel events as a free-spinning wheel sends them (90 events 8 ms apart, 14 lines falling to 2), over a 24-page paper in a 1230 pt pane, on the 8192×2304 screen Crisp makes for the 32:9 monitor; the window recorded at 60 fps and each frame of the pane sorted.

- **The grey is WebKit not painting, not the page being busy.** During a flick the pane showed the viewer's grey (nothing painted, not even the white pages) for 1.6–2 s over three flicks. The page's scripts cost almost nothing (81 ms of frame callbacks in 484 frames), and the page's, GPU and app processes were idle 80% of the time; Safari, with the same page on the same screen, showed the same grey. It is not the app's set-up.
- **Drawing pages during a flick made it worse.** PDF.js drew every page crossed (24–29 draws for three flicks, 70–130 ms each at 2468×3192 px); held back, 4–6 draws. In a quiet moment the grey fell to 0.2–0.3 s; later, with the window server at 45% of a core and a system daemon at 100%, only by about a quarter (1.1 → 0.85 s, runs ranging 0.55–1.4 s). The machine's load moves these numbers more than anything carrel does: compare in alternating runs.
- **The size of the canvases matters most.** With every canvas hidden, no frame took over 31 ms and the grey fell to 0.15 s; with PDF.js's cap at 4 MP (the whole page drawn at 860 px wide, the part in view sharp), 0.08–0.17 s against 0.18–0.53 s in the same runs. Showing a canvas drawn a minute earlier was as quick as one drawn a second earlier: it is the canvases moving on screen that costs, not bringing them back.
- **What did not help:** the pinch's wheel listener made passive (WebKit then scrolled ahead of the painting: more grey, 0.2–0.4 s against 0.03–0.08 s), the previews as composited images instead of backgrounds, reading the layout every frame.
- **Tabs:** 150–250 ms from the click to the sharp page, through a white pane and blurred previews, before; 40–70 ms after, in one change, the first frame matching the settled one but for the page badge.

## Options

### 0. Measure in the real app first

`scripts/mac-bench/bench.py` is the eye's view as numbers (above); the Mac app's page can also be inspected, Safari → Develop → (this Mac) → Carrel, whose Timelines show where a frame goes. Measure each option below before and after, in alternating runs.

### 1. Smaller canvases on the Mac

The one measured lever left on a flick's grey (above). PDF.js's cap with its detail canvas draws the part in view sharp, but at a reading scroll the rest of a page shows at the lower resolution until the detail canvas follows, which is why the reader postponed it (Not now). A cap nearer the page's own size (say 6 MP, a page at 85% of the screen's pixels) may keep most of the gain at less blur: try it and judge on the screen. Fewer pages kept drawn (PDF.js keeps ten) is the other way to fewer canvases.

### 2. Previews made by the server

The previews are drawn in the browser today, the first time a paper is opened. The laptop could make them once instead, with PyMuPDF (the engine's dependency already), keep them on disk by the PDF's version, and serve them as images. Then a paper opened for the first time has its previews at once, the browser draws nothing for them, and the iPad saves the work and the battery. The offline step (plan step 10) could carry them too.

### 3. Draw further ahead

PDF.js draws the pages in view and one more in the direction of the scroll. With the viewer idle, drawing two or three ahead would leave fewer pages to the preview. PDF.js has no option for it: it means hooking its rendering queue, as `scroll-gate.js` already does, which is internal and may change with a PDF.js update. Drawing a figure-heavy page held the main thread for about 60 ms at a time; ahead of the reader, that lands while they may start scrolling again.

### 4. A lighter text layer

Each page drawn also gets its text layer: an element per run of text, positioned and scaled, which is what selection and find use. On dense pages that is thousands of elements. If the Timelines show it taking a large share of a frame, build it a moment after the canvas, or only for the pages in view. Hiding every text layer changed nothing in a flick's frames on the Mac (2026-11-01), so this is for the moment a page is drawn, not for the scroll.

### 5. PDF.js's newer drawing options

- `enableOptimizedPartialRendering` (off by default): zoomed in, draw only the part of a page in view. Helps reading at large zoom, not scrolling at page width.
- `enableWebGPU` (experimental in PDF.js's API): Safari 26 has WebGPU. Worth a test when PDF.js calls it stable; it could change WebKit's numbers the most.

### 6. Chromium for the Mac app

What makes vscode-pdf-viewer faster is most likely Chromium itself. An Electron (or CEF) shell would draw like VS Code. Tauri would not: it uses the same WKWebView.
- Cost: a 150–250 MB app with its own browser engine, more memory on a Mac that is already short of it, and two engines to test against (the iPad stays WebKit whatever the Mac app uses).
- Only after 0–4, and only if the measured gap on the real screen is still worth it. The grey is WebKit's painting during a scroll (above), which neither carrel nor PDF.js controls; Chromium rasterises ahead of a scroll on other threads, which is what this would buy.

### Not now

- **Smaller drawn pages on the Mac** at PDF.js's 4 MP cap: postponed by the reader on 2026-10-31 for the blur off the detail canvas; option 1 is the gentler version to try.
- **PDFKit for the Mac app:** Apple's renderer is fast, but the page, its highlights, citation marks, find and links would then be written twice, once for the iPad's web page and once natively.
