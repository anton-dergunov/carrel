# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. The task began in the engine as [docs/tasks/tablet-reader.md](../../agentic-paper-library/docs/tasks/tablet-reader.md); that note keeps the reasoning behind the decisions, and this file is the plan from here on.

## Done: part 1, the prototype (2026-10-26)

On the iPad over Tailscale, a question about the open paper gets a streamed answer with its tables drawn as tables, and tapping a citation moves the PDF to that page and table.

Decisions taken:

- **Its own repository.** It imports the engine's `paperlib.py`, so the library is read exactly as the scripts read it.
- **Who connects.** The server listens on 127.0.0.1 and is published by `tailscale serve` on port 8443. It admits only the reader's Tailscale login, and checks Host and Origin. There is no password.
- **What the agent may do.**
  - It has Claude Code's default tools, as in the terminal and VS Code.
  - Bash runs in Claude Code's sandbox. Inside it, a command runs without asking: Claude Code's own check of a command's text is overridden, since the sandbox is the boundary.
  - Web search and fetch, `paperlib`, and edits in the notes and overview folders run without asking.
  - Anything else comes to the tablet as Allow / Deny, with Claude Code's reason: leaving the sandbox, reaching an unlisted host, editing elsewhere.
  - `carrel tools` tallies use and answers, to decide what to allow next.
- **Folders.** The folders the library's config names outside it (`pdf_root`, `overview_dir`, …) are open to the agent. `--add-dir` opens more.

Found while building it:

- Claude Code asks about everyday reading commands that it cannot check from their text, such as `cd …; f="…"; grep "$f"`, even when they run in the sandbox. Carrel allows a sandboxed Bash command itself.
- The SDK bundles its own Claude Code: 0.2.174 ships 2.1.310, not the version on the PATH.
- Sessions follow the library's conventions. They add Q&A to a paper's note unless told not to.

## Feedback after the first sitting (2026-10-26)

From the reader, after using it on the iPad. Grouped, in the order the steps below take them.

**The screen**
1. **A Home Screen app.** Full screen, without Safari's address bar and tabs, because the PDF and the chat already share a small screen.
2. **Pinch zooms the PDF, not the page.** Today a pinch zooms the whole page, chat included.
3. **A flexible layout.**
   - Drag the split between the PDF and the chat.
   - Put the chat at the bottom, top, left or right.
   - Or make it a side panel that opens and closes.
   - Or put it on its own switchable tab.
   - Each device remembers its choice.

**Papers and chats**

4. **Papers in tabs**, one paper per tab.
5. **The chat stays put when another paper opens.** Today a link to another paper, or a paper from the list, opens it with a new, empty chat. The chat belongs to the sitting, not the paper. Each question still says which paper and page are open.
6. **The chat must not close after the first question.** Find out why it does on the iPad. Likely causes are the page reloading, or Safari dropping the WebSocket while the tablet sleeps. Then keep sessions on the server: numbered messages, so a reconnect catches up (the old part 5). *Found: the page reloaded (a citation to another paper, or "Papers"); see step 1.*
7. **New chat, and the previous chats.**
   - A button to start a new chat.
   - A list of earlier chats to return to, with their first question and how long ago each last ran.
   - Resuming uses the SDK's `resume`.
8. **The prompt cache's time.**
   - Show how long the chat's prompt cache has left: 60 minutes from the last turn.
   - Once it has expired, close the session.
   - A question in an expired chat warns that a new chat may cost less, and goes ahead only if the reader confirms.

**The chat's display**

9. **Everything but the answer folds away.** Tool calls, thinking and system messages go in one section per turn, collapsed and as small as possible.
10. **Usage limits in one place.** The rate-limit events ("Close to the usage limit · 79% used") repeat as rows many times a turn. Show the limits once, in a status line or the settings, updated as they change, never as chat rows.
11. **The chat on the papers list too**, not only beside a PDF.

**Settings**

12. **A note about the reader**, passed to every chat: who they are, their level, how they like answers. It's one text, appended to the system prompt.
13. **The model** to use.

**The PDF**

14. **A citation goes to the exact spot**, not just the page: the rectangle, highlighted. This is the same technique as in vscode-pdf-viewer; see the engine's [precise-pdf-locations](../../agentic-paper-library/docs/tasks/precise-pdf-locations.md).
15. **Highlights**, saved into the PDF itself, as vscode-pdf-viewer does.

**The library**

16. **Notes and reviews**, readable in the app.
17. **Add and remove papers**, through `paperlib add` and `paperlib remove`, showing their output.
18. **A better paper list.** This is a project of its own: the topic tree, year, authors, summary, notes and reading status (the old part 4).

## Steps

Each step ends with a sitting on the iPad, and its findings are added here.

1. **The app and its chats** (items 1, 2, 5–10). This is what makes it usable daily.
   - **The shell.** A web app manifest, icons, and full screen on the Home Screen; served over HTTPS by `tailscale serve`, which a service worker needs. Pinch zooms only the PDF.
   - **Sessions on the server.** Each one has an id and numbered messages, and the browser reconnects and catches up. Sessions are listed with their first question and last turn. There's a new-chat button, resuming, the cache countdown and the expiry warning. An idle session is closed (the old part 5).
   - **The paper beside a chat.** The chat outlives the paper: opening another paper replaces the PDF, not the chat.
   - **The display.** A folded section per turn for everything but the answer, and a usage status line.
   Built (2026-10-26), before the sitting:
   - **Why the chat closed.** Opening another paper, from a citation or the list, loaded a new page. Its WebSocket closed, and the server ended the Claude Code session with it. The iPad's transcript shows the answer at 17:50:53 and the process gone at 17:53:38. Safari dropping the socket while the tablet sleeps would have done the same. Now a chat lives on the server, and a page only attaches to it. The page keeps the chat's id, reattaches after a reload, sleep or lost connection, and asks for the messages after the last one it drew. Leaving a page never ends a chat. One log line per attach and leave says what dropped.
   - **Chats in Claude Code on the laptop.** Carrel's sessions always ran in the library and were saved beside the VS Code ones. Claude Code's lists (VS Code's, `claude --resume`) hide sessions tagged as the SDK's (`sdk-py`, `sdk-ts`, `sdk-cli`). They are now tagged `carrel`. Not `cli`: Claude Code turns that into `sdk-cli` when a program runs it. Under that tag a session also gets what the terminal's get: the Artifact tools, two more skills and the `claude-code-guide` agent. `carrel tools` finds carrel's sessions by the ids carrel keeps in its state folder.
   - **Earlier chats.** The list is the SDK's `list_sessions` for the library, so it includes the reader's VS Code chats too. Opening one draws its transcript and resumes it on the next question. A resumed session keeps its id.
   - **The cache.** The countdown runs from the end of the last turn. The server closes a chat's Claude Code process after 60 minutes idle. A question in an expired chat asks first.
   - **Not done:** no service worker, since iOS opens a Home Screen app full screen without one. Pinch and the Home Screen app are checked only on the iPad.
2. **Layout and tabs** (items 3, 4, 11). The split can be dragged and placed on any side, collapsed, or put on a tab, and each device remembers it. Papers sit in tabs, and the chat appears on the list page too.
3. **Settings** (items 12, 13). The reader's note and the model, kept on the server so every device shares them.
4. **The chat as the VS Code panel reads** (the old part 2). Maths with KaTeX, code, and slash commands typed in the box. The skills that suit reading (`/paper-info`, `/overview`) become buttons. A dozen real questions from VS Code sittings should read as well as they did there.
5. **The library** (items 16–18, the old part 4). Notes and reviews, add and remove, the paper list. Search.
6. **The PDF** (items 14, 15). Exact spots and highlights, shared with vscode-pdf-viewer.
7. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Highlights and notes on the PDF: where do the notes go, and does that change the notes format?
- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
