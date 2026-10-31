# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is only what is left to build. What is built is described in [architecture.md](architecture.md) as soon as it is built; the area map has its own plan, [plan-area-map.md](plan-area-map.md).

## Steps

Each step ends with a sitting on the iPad (and the e-ink tablet, where it says so); what the sitting finds goes into the step, or into architecture.md when it settles something. Steps 1–5, the library's views, and starting at login are built and described in [architecture.md](architecture.md).

6. **The area map.** Entering an area opens a map of its own subtopics, and more if the sitting asks ([plan-area-map.md](plan-area-map.md)).

7. **Highlights, gathered.**
   - A mark on a paper's row for the papers with highlights. Counting them from the PDFs means opening every one, so the count comes from the saves carrel makes itself.
   - The paper's highlights listed in its contents, beside its headings, each one a jump to its page.

8. **Settings: themes, font sizes, e-ink.** One Settings dialog, as in [Lectern](https://github.com/anton-dergunov/lectern), reusing its implementation where it fits:
   - themes and font sizes for the page, the chat and the library;
   - e-ink, as Lectern does it: no animation, pages turned rather than scrolled, the chat's stream shown in a few large updates. Try both the chat below the PDF and the chat as a sheet over the page.

9. **The NAS.** A Docker image, and the instructions to install it:
   - logging in to the Claude subscription there (a long-lived token from `claude setup-token`, kept out of the image);
   - Tailscale, on the NAS or in the container, and who is let in;
   - the library, the PDFs, the engine checkout and the model cache as volumes, with ripgrep in the image.

10. **A Mac app.** Carrel in a window of its own on the Mac, built on the same pages, with a menu bar item as an option for having it always to hand.
    - A thin native shell around a WebView (Swift and WKWebView), or a framework like Tauri.
    - Does the app start the server itself, or rely on the login agent and only show its page?
    - The layout and the keyboard on a wide screen, and the pinch on a trackpad.

11. **Offline on the tablet.** A copy of the library on the iPad or an Android phone (the PDFs are 7 GB now), so carrel works with no server: the library, the papers, their highlights and overviews. The chat is not available offline, and the page says so.
    - A Home Screen web app with a service worker and storage on the device, or a native wrapper; Safari's storage quota and when it evicts.
    - What to keep on the device (everything, or chosen areas and recent papers), and when to sync.
    - Highlights made offline, written back to the laptop without clashing with the version check that guards saving a PDF.
    - The library's document, the overview notes and the reviews kept on the device; text search on the device; meaning search left out offline.
