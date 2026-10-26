# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is what is left to build. How the built parts work, and why, is in [architecture.md](architecture.md); a step's notes move there after its sitting on the iPad.

## Feedback still open

From the reader's sittings on the iPad, numbered as the steps below cite them. Items 1–11, 15, 19 and 20 are built.

**Settings**

12. **A note about the reader**, passed to every chat: who they are, their level, how they like answers. It's one text, appended to the system prompt.
13. **The model** to use.

**The PDF**

14. **A citation goes to the exact spot**, not just the page: the rectangle, highlighted. This is the same technique as in vscode-pdf-viewer; see the engine's [precise-pdf-locations](../../agentic-paper-library/docs/tasks/precise-pdf-locations.md).

**The library**

16. **Notes and reviews**, readable in the app.
17. **Add and remove papers**, through `paperlib add` and `paperlib remove`, showing their output.
18. **A better paper list.** This is a project of its own: the topic tree, year, authors, summary, notes and reading status (the old part 4).

## Steps

Each step ends with a sitting on the iPad, and its findings are added here. Steps 1–3 (the app and its chats; layout and tabs; the text layer) are built and described in [architecture.md](architecture.md).

4. **Settings** (items 12, 13). The reader's note, kept on the server so every device shares it, and the model, chosen on each device. The model goes back to Opus, and the settings replace `serve --model`'s Haiku default.
   Decided with the reader:
   - **The settings open from the model's name** on the chat's status line, as a dialog over the page (a sheet over the chat was too cramped below the paper).
   - **The model is each device's own**, kept by the page and sent with each question.
   - **A change reaches the next chat only.** A running chat keeps its model and note, so its prompt cache stays valid.
   Built (2026-10-26), before the sitting:
   - **The dialog.** The model is chosen with one tap, from a radio list, and the note is saved as it is typed, with no Save button. When the open chat runs on another model than the one chosen, the dialog says that this chat stays on it.
   - **The note** is appended to Claude Code's system prompt under "The reader". A chat resumed after its cache expired keeps the note it began with, because Claude Code keeps the system prompt it first recorded. It starts on the model its device chooses now.
   - **Checked** in WebKit (`scripts/shots.py --settings --note …`) and with one question on Haiku: the answer followed the note.
5. **The chat as the VS Code panel reads** (the old part 2). Maths with KaTeX, code, and slash commands typed in the box. The skills that suit reading (`/paper-info`, `/overview`) become buttons. A dozen real questions from VS Code sittings should read as well as they did there.
6. **The library** (items 16–18, the old part 4). Notes and reviews, add and remove, the paper list. Search.
7. **The PDF's exact spots** (item 14), shared with vscode-pdf-viewer, and the paper's highlights listed in its contents.
8. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
