# Plan: crisp pages on e-ink (research)

**This is research, with the reader in the loop.** It is a session of its own, not a change to make between others. Nothing is chosen in advance: the reader looks at the candidates on the e-ink tablet itself and picks, round after round, and the settings carrel ends up with come from those picks. E-ink is the reader's main reading device, so this is worth doing thoroughly. Built so far: the bench; round 1 on the Boox (two colour modes), the iPad and the Mac's monitor ([experiments/crisp-pages](../experiments/crisp-pages/README.md)); and Settings → Pages in carrel with its winners (letters as outlines, darker greys, contrast, scans in black and white), each device's own, described in [architecture.md](architecture.md). Left: embolden and sharpening by routes carrel can ship (round 2 on the bench), then a sitting reading with them on.

## The problem

On the Boox Tab X C (13.3", 3200×2400, Kaleido 3, Chrome), a paper's text looks thin and grey. To read it, the reader turned up the tablet's contrast, which applies to the whole screen, and then the chat and the library's rows became far too heavy: the supplementary text outweighs the paper. (Carrel's own heavier e-ink text made it worse, and is gone now.) The goal is pages crisp enough on their own that the tablet's contrast can go back to normal. The same control helps a scanned paper on the iPad and the Mac.

## What we know

- **Pages are PDF.js canvases** (6.3.289), drawn at the device pixel ratio, with the text layer transparent over them (`read.js`).
- **PDF.js caps a canvas on Android and iOS at 5.24 MP** (`maxCanvasPixels`, which its viewer component takes from its own options). A page at page width on a 2400 px-wide screen is about 7.4 MP, so the page's canvas is drawn at 42% of the device's pixels (the cap, halved because a detail canvas follows), and the detail canvas redraws the part in view at full size, uncapped. So the page in view is at full resolution once the detail canvas is drawn, and soft between a turn and then. How long that is on the Boox is for the bench's Measure.
- **Android draws PDF.js's text with grey anti-aliasing and no hinting**, which is where thin stems come from. (`useSystemFonts: false` on Android is a setting of PDF.js's own viewer app; carrel's `getDocument` passes none, so PDF.js's default, true, applies, and it only matters for fonts a PDF does not embed.)
- **The only filter on pages today is Dark pages** (`--pdf-filter` on `.pdfViewer .page`, with the previews behind it). A new one has to compose with it, in the one `filter` property, or on the canvas alone.
- **E-ink shows 16 greys**, and the tablet's own per-app settings (contrast, dithering, text enhancement, refresh mode) act on everything carrel draws.

## Candidates

Each is a knob, not a verdict. A round shows several side by side at a few strengths.

1. **Contrast and brightness** (CSS `contrast()`, `brightness()` on the page). Cheap and on the GPU. Pushes the greys of anti-aliased edges darker, but greys the paper's white too unless brightness makes up for it.
2. **A tone curve** (SVG `feComponentTransfer`, a gamma or a table). Darkens the mid-greys that make stems look thin and keeps white white and black black. The closest to what e-ink readers call "darken text" (KOReader's gamma).
3. **Sharpening** (an unsharp mask through SVG `feConvolveMatrix`). Crisper edges at small sizes; may ring around them on e-ink.
4. **Thresholding, for scans** (a global cut via `feComponentTransfer` `discrete`, or adaptive, Sauvola, in a worker over the canvas's pixels). Turns a grey, speckled scan into clean black on white; ruins figures and photos unless it is applied to text only.
5. **Embolden the glyphs.** Have PDF.js draw text as paths (`disableFontFace`) and stroke them with a hairline as well as fill them, as MuPDF and KOReader embolden. Text only, figures untouched; slower to draw, to be measured.
6. **More pixels.** A higher `maxCanvasPixels` or output scale on the Boox, if the cap above turns out to be what blurs it, weighed against memory and the time to draw a page.
7. **Pages drawn on the laptop.** PyMuPDF renders the page at the tablet's size, processed there (any of the above, MuPDF's own anti-aliasing levels), and serves an image, with the text layer still from PDF.js. The heaviest option; it may also feed plan-performance's previews made by the server.
8. **The tablet's own settings**, recorded beside every pick: the aim is the tablet's defaults, but its "text enhancement" or a dithering mode may do part of the work for free.

## The papers

Picked from the library, two or three of each, the same crops every round:
- modern LaTeX (arXiv, Computer Modern and Times), body text and a dense table;
- a Word-made paper (Calibri or Times New Roman);
- thin Type 1 fonts (an older conference paper);
- scanned: an old journal paper, clean and noisy, with a figure;
- a page with maths and a figure, to see what a knob does to them.

## The bench

- **A page served to the tablet.** A small script of its own (not carrel's server), served on the tailnet or the home network, that the reader opens in Chrome on the Boox. It shows one crop at the tablet's real size as a grid of variants (two to four at a time, since the screen has to show them at full size), labelled, with sliders for the chosen knob and a "this one" button.
- **Picks are kept.** Every pick is recorded with the knob, its strength, the crop and the tablet's settings, in `experiments/crisp-pages/` (committed, per the experiment rules), so a later round starts from it and the choice can be explained later.
- **Stills too.** The same variants rendered at the Boox's resolution as PNGs, to look at on the laptop between rounds. A photo of the tablet's screen is the only true picture of e-ink; the reader's eye is the judge.
- **Rounds.** First a wide sweep, one knob at a time; then the two or three best, combined; then a sitting reading a whole paper with the winner. Each round narrows the next.

## What it should end in

- **Settings → Pages, each device's own** (decided after round 1): one switch over the adjustments, which keeps them when off, and no choice kept per paper, which would leave the reader unsure what is on, though which adjustment helps does change from paper to paper. Each kind of screen starts with what the research found it preferred.
- What it costs to draw a page with it, on the Boox and the iPad.
- A line in architecture.md on what was chosen and why, with the picks that settled it.
