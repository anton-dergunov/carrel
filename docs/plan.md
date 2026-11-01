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
     - a Developer ID, with every bundled binary signed and the app notarized, to hand it to others;
     - updates, through Sparkle rather than an updater of our own;
     - the app's setup choosing the bundled `carrel` when there is one, ahead of the agent's and the shell's.

2.  **Offline on the tablet.** A copy of the library on the iPad or an Android phone (the PDFs are 7 GB now), so carrel works with no server: the library, the papers, their highlights and overviews. The chat is not available offline, and the page says so.
    - A Home Screen web app with a service worker and storage on the device, or a native wrapper; Safari's storage quota and when it evicts.
    - What to keep on the device (everything, or chosen areas and recent papers), and when to sync.
    - Highlights made offline, written back to the laptop without clashing with the version check that guards saving a PDF.
    - The library's document, the overview notes and the reviews kept on the device; text search on the device; meaning search left out offline.
