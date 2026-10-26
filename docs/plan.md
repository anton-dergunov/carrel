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
19. **The selection goes with the question.** Text selected in the paper is passed to Claude Code with the next question. *(From the second sitting.)*
20. **Find did not find on the iPad.** "evalua" in ClaimReceipt was "Not found", though the abstract has it. *(From the second sitting.)*

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
   - **Not done:** no service worker, since iOS opens a Home Screen app full screen without one.

   Found at the sitting (2026-10-26):
   - **Pinching the PDF scrolled it fast.** PDF.js's `TouchManager` rescales the viewer at every step of the pinch and moves the scroll to keep the point under the fingers. Safari scrolled the same container with the same fingers at the same time, and the two added up. Now, while the fingers move, the container can't scroll and the pages are only scaled as a picture. When the fingers lift, the viewer takes the new scale once, and the scroll is set so the same spot of the page sits under them. Pinching back to the page's width snaps to fit-width.
   - **A pinch on the chat still zoomed the whole page.** iOS ignores `user-scalable=no`, and it ignored `touch-action` on `body`. Cancelling Safari's `gesturestart`/`gesturechange` events stops it.
   - **The keyboard could hide the box being typed in.** Safari sometimes scrolls the page up to show it, and sometimes doesn't. Now the reading page is pinned to the area above the keyboard (the visual viewport). The PDF gets shorter, and the chat keeps up to 70% of what is left. Any layout from step 2 should fit that area the same way.
   - **The status bar** (clock, date) stays: iPadOS gives web apps no way to hide it. The manifest asks for `fullscreen` in case it is honoured, and the bar is translucent, over the PDF.
2. **Layout and tabs** (items 3, 4, 11). The split can be dragged and placed on any side, collapsed, or put on a tab, and each device remembers it. Papers sit in tabs, and the chat appears on the list page too.
   Built (2026-10-26), before the sitting:
   - **One page.** `/` and `/read/<pdf>` are the same page, with the paper list on its own tab and a tab per open paper. Nothing reloads between them, and the chat beside the list asks about the paper shown last, or about the library when none is open.
   - **Tabs.** A paper opens in a tab after the one showing; a citation to an open paper goes to its tab. All papers share one PDF viewer, and each tab keeps its place (page, zoom, scroll), so coming back to a tab puts the paper back where it was. Several viewers would each keep their rendered pages, which is what makes iPad Safari drop a page. The address names the tab showing, and the Home Screen app, which always starts at `/`, opens the tab that was showing last.
   - **Layout.** The chat sits below, above, left or right of the paper, or on a tab of its own, and can be hidden. The split is dragged, and each side keeps its own size (a double tap puts it back at 40%). Above or below the paper the chat still keeps up to 70% of the area above the keyboard. Dragging resizes the panes as the finger moves, a step a frame; the PDF keeps its scale meanwhile and fits the new width when the finger lifts, since drawing every page at a new scale at each step is what made it slow. Moving only a line and resizing at the end was quicker, but looked broken and left the reader guessing how big the chat would be.
   - **The controls.** A paper set to the page width is about as tall as the iPad's screen, so the controls take one row between them, and anything used rarely waits in a sheet:
     - The bar holds the tabs and three small grey icons (Lucide's, ISC). The list is an icon that stays at the left while the papers' tabs scroll. Every paper's tab has its close button, so any tab closes with one tap.
     - Find (for the paper showing) takes the place of the tabs while it is open.
     - Layout opens a sheet with where the chat sits; the reading settings will join it.
     - The chat button draws where the chat is, dashed when it is hidden, and shows and hides it. A dot on it marks an answer or a permission request that came while the chat was out of sight.
     - The page number is a faint badge in the PDF's corner; a tap opens the paper's contents and a field to go to a page. Highlights (step 7) will be listed there too.
     - The chat has no header: earlier chats and a new chat are two icons on its status line, which also names the model, and the box says which paper a question is about.
   - **The keyboard, again.** Opening the keyboard sometimes moved the paper up and back down, and closing it down and back up, mostly on a newly opened paper. Safari slides the whole page up to show the box while its keyboard rises, and reports where it went only now and then, so pinning the page to the visible area put it back a moment late. A tap on a box now focuses it without that scroll (as lectern's find does), and while the keyboard comes and goes the page is fitted at every frame. To check at the sitting.
   - **The model.** While carrel is being tried out, chats run on Haiku (`serve --model`, default `haiku`) to spend little.
3. **The text layer** (items 15, 19, 20). Chosen before settings, as everything on it goes together: find, highlights and the selection.
   Decided with the reader:
   - **Highlights go into the paper's PDF**, as ordinary Highlight annotations written the way vscode-pdf-viewer writes them (PDF.js's highlight editor, appended to the file as an incremental update), so both apps and any other PDF app show and edit the same ones. This answers the open question: no notes on highlights yet, and the notes format does not change.
   - **Saved at once**, with no unsaved state and no Save: iOS may close the app in the background, and what was not saved is gone.
   - **A pen, as Lectern has.** While it is on, a selection is highlighted once it settles. Nothing is offered beside a selection: iOS puts its Copy / Look Up menu below it near the top of the screen and above it near the bottom, and Android the other way round.
   Built (2026-10-26), before the sitting:
   - **Find.** It works in WebKit, at the iPad's size and under Playwright's iPad emulation, typed a letter at a time (1 of 19 for "evalua"). iPadOS 26.6 has every newer JavaScript feature PDF.js's find uses. PDF.js catches an error reading a page's text, writes it to the console and searches an empty page, which would show "Not found"; only the iPad's console can say which error. So a page now sends its errors, rejected promises and console warnings to the server's log (`page error: …`). To read at the sitting.
   - **Highlights.** The pen sits in the bar, beside find. A tap on a highlight opens a small panel under it (above it near the bottom of the pane): its six colours (vscode-pdf-viewer's), Remove, and Ask. A new highlight takes the colour used last. Each change is sent to the laptop as the paper as loaded plus PDF.js's update. The server writes it only if the file is still the version the page loaded or last saved, and still begins with the bytes the page loaded; it replaces the file in one step. A paper changed elsewhere meanwhile (another device, vscode-pdf-viewer, the sync) is loaded again, and a notice says the last change was not saved. A save that could not reach the laptop leaves a red dot on the pen and is tried again with the next change, when the network is back, and when the app comes back to the screen.
   - **The selection.** A passage selected in the paper, or just highlighted, or picked with the panel's Ask, shows over the question box with its page; a tap on it goes there, and × drops it. The next question carries it after the context line, as `<selection page="5">…</selection>`, naming the paper too when it is not the one open, and the question's bubble shows it. It is kept by the page rather than read when the question is sent, since tapping the box clears the selection on iOS.
   - **Checked in WebKit** (`scripts/shots.py --find … --highlight`, on a throwaway library): a highlight is made with the pen, saved, back after a reload, recoloured, quoted with Ask and removed, each saved; the file passes `qpdf --check`, and its original bytes are untouched.
4. **Settings** (items 12, 13). The reader's note and the model, kept on the server so every device shares them. The model goes back to Opus here, and the settings replace `serve --model`'s Haiku default.
5. **The chat as the VS Code panel reads** (the old part 2). Maths with KaTeX, code, and slash commands typed in the box. The skills that suit reading (`/paper-info`, `/overview`) become buttons. A dozen real questions from VS Code sittings should read as well as they did there.
6. **The library** (items 16–18, the old part 4). Notes and reviews, add and remove, the paper list. Search.
7. **The PDF's exact spots** (item 14), shared with vscode-pdf-viewer, and the paper's highlights listed in its contents.
8. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
