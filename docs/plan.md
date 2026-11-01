# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is only what is left to build. What is built is described in [architecture.md](architecture.md) as soon as it is built; a faster PDF has its own plan, [plan-performance.md](plan-performance.md).

## Steps

Each step ends with a sitting on the iPad (and the e-ink tablet, where it says so); what the sitting finds goes into the step, or into architecture.md when it settles something. Steps 1–5, the library's views and their area maps, starting at login and the Mac app are built and described in [architecture.md](architecture.md).

6. **Highlights, gathered.**
   - A mark on a paper's row for the papers with highlights. Counting them from the PDFs means opening every one, so the count comes from the saves carrel makes itself.
   - The paper's highlights listed in its contents, beside its headings, each one a jump to its page.

7. **Settings: themes, font sizes, e-ink.** One Settings dialog, as in [Lectern](https://github.com/anton-dergunov/lectern), reusing its implementation where it fits:
   - themes and font sizes for the page, the chat and the library;
   - e-ink, as Lectern does it: no animation, pages turned rather than scrolled, the chat's stream shown in a few large updates. Try both the chat below the PDF and the chat as a sheet over the page.

8. **The NAS, and a Mac app that stands alone.** Both package carrel with its engine, so they are one step.
   - A Docker image, and the instructions to install it:
     - logging in to the Claude subscription there (a long-lived token from `claude setup-token`, kept out of the image);
     - Tailscale, on the NAS or in the container, and who is let in;
     - the library, the PDFs, the engine checkout and the model cache as volumes, with ripgrep in the image.
   - The Mac app with everything inside, for someone with no terminal and no checkout. Today it shows a running carrel or starts an installed one ([architecture.md](architecture.md#the-mac-app)). Standing alone, it needs:
     - Python, carrel and the engine in the bundle, the same as the image: about 1.5 GB, most of it torch for meaning search (a smaller encoder runtime would help both);
     - ripgrep and uv inside, since `paperlib` runs through `uv run`;
     - signing in to Claude from the app (or a `claude setup-token` token), kept in the Keychain;
     - a first run that chooses a library or makes a new one;
     - a Developer ID, with every bundled binary signed and the app notarized, to hand it to others;
     - updates, through Sparkle rather than an updater of our own;
     - the app's setup choosing the bundled `carrel` when there is one, ahead of the agent's and the shell's.

9. **The Mac app, after a sitting.** What a week of use on the Mac settles: the chat's width beside the paper on a large screen, the keys worth adding to the menus, whether the menu bar item earns its place.

10. **Offline on the tablet.** A copy of the library on the iPad or an Android phone (the PDFs are 7 GB now), so carrel works with no server: the library, the papers, their highlights and overviews. The chat is not available offline, and the page says so.
    - A Home Screen web app with a service worker and storage on the device, or a native wrapper; Safari's storage quota and when it evicts.
    - What to keep on the device (everything, or chosen areas and recent papers), and when to sync.
    - Highlights made offline, written back to the laptop without clashing with the version check that guards saving a PDF.
    - The library's document, the overview notes and the reviews kept on the device; text search on the device; meaning search left out offline.

11. **Liking/ranking papers** (favourites, etc)
