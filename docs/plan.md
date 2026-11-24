# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is only what is left to build. What is built is described in [architecture.md](architecture.md) as soon as it is built.

## Tasks

1. **The NAS, and a Mac app that stands alone.** Both package carrel with its engine, so they are one step.
   - A Docker image, and the instructions to install it:
     - logging in to the Claude subscription there (a long-lived token from `claude setup-token`, kept out of the image);
     - Tailscale, on the NAS or in the container, and who is let in;
     - the library, the PDFs, the engine checkout and the model cache as volumes, with ripgrep in the image.
   - The Mac app with everything inside, for someone with no terminal and no checkout. Today it shows a running carrel or starts an installed one ([architecture.md](architecture.md#the-mac-app)). Standing alone, it needs:
     - Python, carrel and the engine in the bundle, the same as the image: about 1.5 GB, most of it torch for meaning search (a smaller encoder runtime would help both);
     - ripgrep and uv inside, since `paperlib` runs through `uv run`;
     - signing in to Claude from the app (or a `claude setup-token` token), kept in the Keychain;
     - a first run that chooses a library or makes a new one;
     - a Developer ID, with every bundled binary signed (Electron's and Python's) and the app notarized, to hand it to others;
     - updates, through Electron's own updater rather than one of our own;
     - the app's setup choosing the bundled `carrel` when there is one, ahead of the agent's and the shell's.

2.  **Offline on the tablet.** A copy of the library on the iPad or an Android phone (the PDFs are 7 GB now), so carrel works with no server: the library, the papers, their highlights and overviews. The chat is not available offline, and the page says so.
    - A Home Screen web app with a service worker and storage on the device, or a native wrapper; Safari's storage quota and when it evicts.
    - What to keep on the device (everything, or chosen areas and recent papers), and when to sync.
    - Highlights made offline, written back to the laptop without clashing with the version check that guards saving a PDF.
    - The library's document, the overview notes and the reviews kept on the device; text search on the device; meaning search left out offline.

3. **Less memory on the Mac, above all while the window is closed.** The Mac app is usually closed, yet on 2026-11-24 it held about 1.7 GB on a 16 GB Mac that was deep in swap. PDFs must stay as crisp and the app as snappy as now; measure each change with `scripts/mac-bench` before and after.
   - **The closed window.** Closing it only hides it (`main.js`, `window.on('close')`), so the page's process (428 MB) and Chromium's GPU process (686 MB) stay as they were. After some time hidden (a few minutes), let them go: either drop what the page holds (the kept papers, the snapshots, the drawn canvases) and draw again on show, or destroy the window and build it again on show. The tabs come back from `localStorage` and the chats live on the server, so a new window loses nothing but the time to draw the current paper.
   - **Canvas size.** On the Mac `maxCanvasPixels` is left to PDF.js's default, 2^25 (33.5 M pixels, 134 MB a canvas), and the display it is drawn for is HiDPI (an ultrawide at 8192×2304). Try a cap such as e-ink's 2^24, with PDF.js's detail canvas keeping the part in view sharp, and compare the sharpness and the time to settle with `mac-bench`.
   - **Kept papers.** `KEPT_PAPERS = 3`, each with its snapshots (about 70 MB on the Mac). One or two may be enough on the Mac, or keep them only while the window is shown.
   - **`carrel serve`** held 533 MB after 4 days. Find what: likely torch staying imported after the encoder is freed (`IDLE_S`), or the meaning `Space`. If it is torch, embed in a child process that exits when idle, so the server itself stays small. Lectern's server shares the setup and may gain the same way.
