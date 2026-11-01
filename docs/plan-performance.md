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
- **Done so far:** the pages' canvases on the GPU (`enableHWA`): in WebKit at 2x, 74 → 46–63 ms after a jump, and the slowest scroll frames 25–33 → 18–19 ms. A preview behind each page until it is drawn, so a fast scroll or a tab no longer shows white sheets.
- **The Mac was swapping** (12 GB of swap, 16 GB of RAM) while this was measured, which slows every app, WebKit's drawing included. Lowering it is a task of its own, outside carrel.

## Options

### 0. Measure in the real app first

The Mac app's page can now be inspected: Safari → Develop → (this Mac) → Carrel. Its Timelines show where a scroll's frames go: drawing the canvas, building the text layer, layout, compositing. Each option below should be measured there before and after.
- The eye's view, as a number: record the window (`screencapture -V`) while scrolling with real wheel events and switching tabs, and count the frames where the pane goes white. The headless runs did not show what the real app showed, so this check is the one to keep. The scripts used on 2026-10-31 were throwaway; worth keeping a tidy one in `scripts/`.

### 1. Keep the recent papers open

A tab switch fetches the paper again and parses it again, since the papers share one viewer and the previous document is destroyed. Keeping the last few documents (PDF.js's `PDFDocumentProxy`, with the version a save names) and only handing them to the viewer would skip both: a few hundred ms on a large paper, more over the tailnet on the iPad.
- Cost: the worker's memory for each kept paper, tens of MB. Keep two or three, and drop them under memory pressure.
- Watch: a save to a paper that is kept but not showing, and a paper changed on disk meanwhile (the version check already guards the save).

### 2. Previews made by the server

The previews are drawn in the browser today, the first time a paper is opened. The laptop could make them once instead, with PyMuPDF (the engine's dependency already), keep them on disk by the PDF's version, and serve them as images. Then a paper opened for the first time has its previews at once, the browser draws nothing for them, and the iPad saves the work and the battery. The offline step (plan step 10) could carry them too.

### 3. Draw further ahead

PDF.js draws the pages in view and one more in the direction of the scroll. With the viewer idle, drawing two or three ahead would leave fewer pages to the preview. PDF.js has no option for it: it means hooking its rendering queue, which is internal and may change with a PDF.js update. Try after 1 and 2, if fast scrolling still shows previews too often.

### 4. A lighter text layer

Each page drawn also gets its text layer: an element per run of text, positioned and scaled, which is what selection and find use. On dense pages that is thousands of elements. If the Timelines show it taking a large share of a frame, build it a moment after the canvas, or only for the pages in view.

### 5. PDF.js's newer drawing options

- `enableOptimizedPartialRendering` (off by default): zoomed in, draw only the part of a page in view. Helps reading at large zoom, not scrolling at page width.
- `enableWebGPU` (experimental in PDF.js's API): Safari 26 has WebGPU. Worth a test when PDF.js calls it stable; it could change WebKit's numbers the most.

### 6. Chromium for the Mac app

What makes vscode-pdf-viewer faster is most likely Chromium itself. An Electron (or CEF) shell would draw like VS Code. Tauri would not: it uses the same WKWebView.
- Cost: a 150–250 MB app with its own browser engine, more memory on a Mac that is already short of it, and two engines to test against (the iPad stays WebKit whatever the Mac app uses).
- Only after 0–4, and only if the measured gap on the real screen is still worth it.

### Not now

- **Smaller drawn pages on the Mac** (`maxCanvasPixels`, as PDF.js already caps it on the iPad, with its detail canvas keeping the part in view sharp): less memory, at some sharpness off screen. Postponed by the reader on 2026-10-31.
- **PDFKit for the Mac app:** Apple's renderer is fast, but the page, its highlights, citation marks, find and links would then be written twice, once for the iPad's web page and once natively.
