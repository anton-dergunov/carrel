# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is what is left to build. How the built parts work, and why, is in [architecture.md](architecture.md); a step's notes move there after its sitting on the iPad.

## Feedback still open

From the reader's sittings on the iPad, numbered as the steps below cite them. Items 1–13, 15, 19 and 20 are built.

**The PDF**

14. **A citation goes to the exact spot**, not just the page: the rectangle, highlighted. This is the same technique as in vscode-pdf-viewer; see the engine's [precise-pdf-locations](../../agentic-paper-library/docs/tasks/precise-pdf-locations.md).

**The library**

16. **Notes and reviews**, readable in the app. Step 5 shows a paper's overview note; the rest is step 6.
17. **Add and remove papers**, through `paperlib add` and `paperlib remove`, showing their output.
18. **A better paper list.** This is a project of its own: the topic tree, year, authors, summary, notes and reading status (the old part 4).

## Steps

Each step ends with a sitting on the iPad, and its findings are added here. Steps 1–4 (the app and its chats; layout and tabs; the text layer; settings) are built and described in [architecture.md](architecture.md).

5. **The chat as the VS Code panel reads** (the old part 2). Maths with KaTeX, code, and slash commands typed in the box. A paper's overview one tap away, and its properties without the model. A dozen real chats from VS Code sittings should read as well as they did there.
   Decided with the reader:
   - **Overview is a button on the chat's status line**, shown while a paper is open. It looks different when the paper has a note: a filled notebook, "Show the overview", against a grey one with a pen, "Write an overview".
   - **A note that exists is shown with no model call**, in a sheet over the chat, beside the paper. Delete moves it to the Trash, for a note wanted only for this reading.
   - **A note that doesn't is written by `/overview` in a chat about the paper.** The skill reads the whole paper into that chat, so the questions after it pay only a cache read; a chat of its own, left behind, would read the paper a second time. The note is generated once, as a file, and the sheet shows it.
   - **That chat is the one open when it is only about this paper** (no questions yet, or each asked with this paper open); otherwise the button starts a new chat, and the other waits in the list. Found at the first sitting: in a chat about another paper, with its cache expired, the button asked there and met the expired-cache question. What a question was about is the paper open when it was asked, which each question records; a paper only mentioned in a question does not count.
   - **The paper's properties come from its frontmatter**, with no model call, in the sheet the page badge opens. There is no `/paper-info` button.
   - **The check draws existing VS Code chats** with maths and code, with no new questions. Tables already draw well.
   Built (2026-10-27), before the sitting:
   - **Maths** in the four forms the agent writes (`$…$`, `\(…\)`, `$$…$$`, `\[…\]`), drawn by KaTeX after the answer is sanitised; a `$` follows Pandoc's rule, so prices stay text. **Code** that names its language is coloured (highlight.js), and every block has a copy button.
   - **Slash commands** run as in the terminal: the command goes first, and the paper and the passage follow it among its arguments, so `/overview` alone means the paper open. Typing `/` lists the commands Claude Code offers in the library, with what each does. Those bound to a terminal are left out once a chat has started (Claude Code names them only then).
   - **The overview** button and sheet, as decided. Obsidian's properties are left out of the sheet, a callout shows its title, and `[[links]]` their text. A tap on the skill's link to the note opens the sheet.
   - **Diagrams**: a ```` ```mermaid ```` block, in an answer or a note, is drawn by Mermaid 11.17.2 with lectern's settings (the page's colours, muted lines, SVG text, since WebKit wraps HTML labels early), once the answer is complete. Mermaid loads only when there is a diagram; one it cannot draw stays as its source.
   - **The PDF's links no longer show through the sheets over the paper** (found at the sitting): PDF.js gives each link a z-index of its own, so the viewer is now a stacking context of its own, under the sheets.
   - **The paper's properties** head the page badge's sheet: title, authors, year, arXiv, summary, type, topic, the date added, and the overview when there is one.
   - **Checked** in WebKit at the iPad's size: twelve VS Code chats from the library drawn from their transcripts (`shots.py --chat`), with no formula KaTeX could not draw and no `$` in code taken for maths; the overview sheet, its Delete, the properties and the command list on a throwaway library (`--overview`, `--info`, `--type /`). Slash commands were checked with one Haiku question in a scratch folder: a multi-line prompt still runs as the command, and the skill receives the context lines.
   - **Not yet:** a resumed chat shows no output for a local command such as `/context` (its transcript keeps it where the SDK does not read); a background task's notification in a VS Code chat is drawn as a question.
6. **The library** (items 16–18, the old part 4). Notes and reviews, add and remove, the paper list. Search.
7. **The PDF's exact spots** (item 14), shared with vscode-pdf-viewer, and the paper's highlights listed in its contents.
8. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
