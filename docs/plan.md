# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is what is left to build; the library has its own plan, [plan-library.md](plan-library.md). How the built parts work, and why, is in [architecture.md](architecture.md); a step's notes move there after its sitting on the iPad.

## Feedback still open

From the reader's sittings on the iPad, numbered as the steps below cite them. Items 1–13, 15, 19 and 20 are built.

**The PDF**

14. **A citation goes to the exact spot**, not just the page: the rectangle, highlighted. This is the same technique as in vscode-pdf-viewer; see the engine's [precise-pdf-locations](../../agentic-paper-library/docs/tasks/precise-pdf-locations.md).

**The library**, planned in [plan-library.md](plan-library.md)

16. **Notes and reviews**, readable in the app.
17. **Add and remove papers**, through `paperlib add` and `paperlib remove`, showing their output.
18. **A better paper list**: the topic tree, year, authors, summary, notes and reading status.

**The chat**

21. **A resumed chat shows no output for a local command** such as `/context`: its transcript keeps it where the SDK does not read.
22. **A background task's notification in a VS Code chat** is drawn as a question.

## Steps

Each step ends with a sitting on the iPad, and its findings are added here. Steps 1–5 (the app and its chats; layout and tabs; the text layer; settings; the chat as the VS Code panel reads, with the overview and the properties) are built and described in [architecture.md](architecture.md).

6. **The library** (items 16–18): its own plan, [plan-library.md](plan-library.md).
7. **The PDF's exact spots** (item 14), shared with vscode-pdf-viewer, and the paper's highlights listed in its contents.
8. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
