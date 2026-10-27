# Architecture

How carrel works as built, and why it works that way. What is left to build is in [plan.md](plan.md), which also keeps a step's notes until its sitting on the iPad. The task began in the engine as [docs/tasks/tablet-reader.md](../../agentic-paper-library/docs/tasks/tablet-reader.md), which keeps the earliest reasoning.

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, in the library, and the browser only shows its messages. The app is served to the tablet over Tailscale.

## The library and the engine

Carrel has its own repository and imports the engine's `paperlib.py`, so the library is read exactly as the scripts read it. The folders the library's config names outside it (`pdf_root`, `overview_dir`, …) come from there too.

## Who connects

The server listens on 127.0.0.1 and is published to the tailnet by `tailscale serve` on port 8443, over HTTPS. It admits only the reader's Tailscale login and checks Host and Origin. There is no password.

## What the agent may do

- It has Claude Code's default tools, as in the terminal and VS Code.
- **Bash runs in Claude Code's sandbox.** Inside it, a command runs without asking. Claude Code's own check of a command's text is overridden, since the sandbox is the boundary. Claude Code asks about everyday reading commands that it cannot check from their text, such as `cd …; f="…"; grep "$f"`, even when they run in the sandbox, so carrel allows a sandboxed Bash command itself.
- **Without asking:** web search and fetch, `paperlib`, and edits in the notes and overview folders.
- **Put to the reader:** anything else comes to the tablet as Allow / Deny, with Claude Code's reason. That includes leaving the sandbox, reaching an unlisted host, and editing elsewhere.
- **Folders.** The folders the library's config names outside it are open to the agent, and `--add-dir` opens more.
- **What to allow next.** `carrel tools` tallies tool use and the reader's answers, so the rules are widened from evidence.

Sessions follow the library's conventions: they add Q&A to a paper's note unless told not to.

The SDK bundles its own Claude Code: 0.2.174 ships 2.1.310, not the version on the PATH.

## Chats

**A chat lives on the server, and a page only attaches to it.** Its messages are numbered. A page keeps the chat's id, reattaches after a reload, a sleep or a lost connection, and asks for the messages after the last one it drew. Leaving a page never ends a chat. One log line per attach and leave says what dropped.

This came from the first sitting, where the chat closed after the first question. Opening another paper, from a citation or the list, loaded a new page, its WebSocket closed, and the server ended the Claude Code session with it. Safari dropping the socket while the tablet slept would have done the same.

**In Claude Code's own lists.** Carrel's sessions run in the library, so they are saved beside the VS Code ones. Claude Code's lists (VS Code's, `claude --resume`) hide sessions tagged as the SDK's (`sdk-py`, `sdk-ts`, `sdk-cli`), so carrel's are tagged `carrel`.
- **Not `cli`.** Claude Code turns that into `sdk-cli` when a program runs it.
- **What the tag brings.** Under it a session also gets what the terminal's get: the Artifact tools, two more skills and the `claude-code-guide` agent.
- **How `carrel tools` finds them.** By the ids carrel keeps in its state folder.

**Earlier chats.** The list is the SDK's `list_sessions` for the library, so it includes the reader's VS Code chats too. Opening one draws its transcript and resumes it on the next question; a resumed session keeps its id.

**The prompt cache.**
- The countdown runs from the end of the last turn.
- The server closes a chat's Claude Code process after 60 minutes idle.
- A question in an expired chat asks first, since a new chat may cost less.

**The display.** Everything but the answer (tools, thinking, system messages) folds into one section per turn. The usage limits are shown once, on the status line, as they change.

## Settings

The chat's settings open from the model's name on its status line, as a small dialog over the page: a sheet over the chat was too cramped below the paper. It sits near the top and within the area above the keyboard, so the note being typed stays in sight.

- **The model is each device's own**, chosen with one tap from a list and kept in the page's `localStorage`. A page sends it with every question, and it is used when that question starts the chat's Claude Code process. A chat no device has chosen for runs on Opus.
- **The note about the reader is the server's**, so every device shares it. It is appended to Claude Code's system prompt under "The reader". It is saved as it is typed, with no Save button.
- **When a change applies.** Both apply only when a Claude Code process starts: a new chat, or one resumed after its cache expired. A running chat keeps the model it started on, so its prompt cache stays valid, and the dialog says so when the device has chosen another one. A resumed chat keeps the note it began with, because Claude Code keeps the system prompt it first recorded.

## The screen

**A Home Screen app.** It opens full screen from the Home Screen, with a web app manifest and icons. iOS does this without a service worker, so there is none.

**The status bar stays.** The clock and date remain, since iPadOS gives web apps no way to hide them. The manifest asks for `fullscreen` in case that is ever honoured, and the bar is translucent, over the PDF.

**Pinch zooms the PDF, not the page.**
- **Why not as PDF.js does it.** PDF.js's `TouchManager` rescales the viewer at every step of a pinch and moves the scroll to keep the point under the fingers. Safari scrolled the same container with the same fingers at the same time, and the two added up, so the paper flew.
- **During the pinch.** The container can't scroll, and the pages are only scaled as a picture.
- **When the fingers lift.** The viewer takes the new scale once, and the scroll is set so the same spot of the page sits under them. Pinching back to the page's width snaps to fit-width.
- **On the chat.** iOS ignores `user-scalable=no`, and it ignored `touch-action` on `body`, so a pinch there still zoomed the whole page. Cancelling Safari's `gesturestart`/`gesturechange` events stops it.

**The keyboard.**
- **Fitted above it.** Safari sometimes scrolls the page up to show the box being typed in, and sometimes doesn't. So the page is fitted to the area above the keyboard (the visual viewport). The PDF gets shorter, and a chat above or below keeps up to 70% of what is left.
- **Focused without a scroll.** Safari slides the whole page up while its keyboard rises and reports where it went only now and then, so fitting the page put it back a moment late. A tap on a box therefore focuses it without that scroll, and while the keyboard comes and goes the page is fitted at every frame.

## Layout and tabs

**One page.** `/` and `/read/<pdf>` are the same page, with the paper list on its own tab and a tab per open paper. Nothing reloads between them. The chat beside the list asks about the paper shown last, or about the library when none is open.

**Tabs.**
- A paper opens in a tab after the one showing, and a citation to an open paper goes to its tab.
- **One viewer.** All papers share one PDF viewer, because several viewers would each keep their rendered pages, which is what makes iPad Safari drop a page. Each tab keeps its place (page, zoom, scroll), so coming back to a tab puts the paper back where it was.
- **The address.** It names the tab showing. The Home Screen app always starts at `/`, so it opens the tab that was showing last.

**Where the chat sits.** The chat sits below, above, left or right of the paper, or on a tab of its own, and it can be hidden. Each device remembers its choice.
- **The split is dragged,** and each side keeps its own size; a double tap puts it back at 40%.
- **While dragging.** The panes resize as the finger moves, a step a frame. The PDF keeps its scale meanwhile and fits the new width when the finger lifts, since drawing every page at a new scale at each step is what made it slow.
- **Why not move only a line.** Moving a line and resizing at the end was quicker, but it looked broken and left the reader guessing how big the chat would be.

## The controls

A paper set to the page width is about as tall as the iPad's screen, so the controls take one row, and anything used rarely waits in a sheet.

- **The bar** holds the tabs and a few small grey icons (Lucide's, ISC).
  - The list is an icon that stays at the left while the papers' tabs scroll.
  - Every paper's tab has its close button, so any tab closes with one tap.
- **Find** (for the paper showing) takes the place of the tabs while it is open.
- **Layout** opens a sheet with where the chat sits.
- **The chat button** draws where the chat is, dashed when it is hidden, and shows and hides it. A dot on it marks an answer or a permission request that came while the chat was out of sight.
- **The page number** is a faint badge in the PDF's corner. A tap opens the paper's contents and a field to go to a page.
- **The chat has no header.** Its status line names the model, which opens the settings, and holds two icons, for earlier chats and a new chat. The box says which paper a question is about.

## The text layer

Find, highlights and the selection all work on PDF.js's text layer.

**Find.** It worked in WebKit, at the iPad's size and under Playwright's iPad emulation, but on the iPad itself it found nothing ("evalua" in ClaimReceipt was "Not found").
- **Why.** The page's own error log, sent to the server (`page error: …`), showed every page failing in PDF.js's `getTextContent`. That function reads the page's text with `for await` over a stream, and Safari 26.6 cannot iterate a stream that way, though Playwright's newer WebKit can. PDF.js caught the error and searched empty pages. The pages were still drawn, since drawing reads the stream another way.
- **The fix.** `polyfill.js` adds the Streams standard's iterator before PDF.js loads. PDF.js's legacy build has no polyfill for this either.

**Highlights go into the paper's PDF.** They are ordinary Highlight annotations written the way vscode-pdf-viewer writes them: PDF.js's highlight editor, appended to the file as an incremental update. Both apps, and any other PDF app, show and edit the same ones. Highlights carry no notes.
- **The pen.** It sits in the bar, beside find. While it is on, a selection is highlighted once it settles. Nothing is offered beside a selection, because iOS puts its Copy / Look Up menu below it near the top of the screen and above it near the bottom, and Android the other way round.
- **The panel.** A tap on a highlight opens a small panel under it (above it near the bottom of the pane). It holds the six colours (vscode-pdf-viewer's), Remove, and Ask. A new highlight takes the colour used last.
- **Saved at once, with no Save.** iOS may close the app in the background, and what was not saved is gone. Each change is sent to the laptop as the paper as loaded plus PDF.js's update.
- **When it is written.** The server writes the change only if the file is still the version the page loaded or last saved, and still begins with the bytes the page loaded. It replaces the file in one step.
- **A paper changed elsewhere meanwhile** (another device, vscode-pdf-viewer, the sync) is loaded again, and a notice says the last change was not saved.
- **A save that could not reach the laptop** leaves a red dot on the pen. It is tried again with the next change, when the network is back, and when the app comes back to the screen.

**The selection goes with the question.** A passage selected in the paper, or just highlighted, or picked with the panel's Ask, shows over the question box with its page.
- A tap on it goes to the passage in the paper, and × drops it.
- The next question carries it after the context line, as `<selection page="5">…</selection>`, naming the paper too when it is not the one open. The question's bubble shows it.
- The page keeps the passage itself, rather than reading the selection when the question is sent, since tapping the box clears the selection on iOS.

## The chat's text

The chat reads as the VS Code panel does: a dozen real VS Code chats from the library, drawn from their transcripts, were the check.

**Maths** comes in the four forms the agent writes: `$…$`, `\(…\)`, `$$…$$` and `\[…\]`.
- **When it is drawn.** KaTeX draws it after the answer is sanitised, into placeholders that hold the TeX, never through DOMPurify.
- **Prices stay text.** A `$` follows Pandoc's rule: an opening `$` is not followed by a space, a closing one not preceded by one, and not followed by a digit.

**Code.** A block that names its language is coloured by highlight.js, and every block has a copy button.

**Diagrams.** A ```` ```mermaid ```` block, in an answer or a note, is drawn by Mermaid once the answer is complete.
- **Lectern's settings**: the page's colours and muted lines.
- **SVG text**, since WebKit wraps Mermaid's HTML labels too early.
- **Mermaid loads only when there is a diagram**, and one it cannot draw stays as its source.

**Slash commands run as in the terminal.**
- **The command goes first**, or Claude Code does not run it. The paper and the passage follow it among its arguments, so `/overview` alone means the paper open.
- **Typing `/`** lists the commands Claude Code offers in the library, with what each does.
- **Commands bound to a terminal** are left out once a chat has started. Claude Code names them only then.

## The overview and the properties

**The overview is a button on the chat's status line**, shown while a paper is open. It has two looks: a filled notebook, "Show the overview", when the paper has a note, and a grey one with a pen, "Write an overview", when it has none.

**A note that exists is shown with no model call**, in a sheet over the chat, beside the paper.
- **Delete** moves it to the Trash, for a note wanted only for one reading.
- **Left out of the sheet**: Obsidian's properties. A callout shows its title, and a `[[link]]` its text.

**A note that doesn't exist is written by the engine's `/overview`, in a chat about the paper.**
- **Why that chat.** The skill reads the whole paper into the chat, so the questions after it pay only for a cache read. A chat of its own, left behind, would make the reader's next chat read the paper a second time.
- **The result.** The note is written once, as a file, and the sheet shows it. A tap on the skill's link to the note opens the sheet too.
- **Which chat is about the paper.** The open chat counts when it has no questions yet, or when each of its questions was asked with this paper open; otherwise the button starts a new chat, and the other waits in the list.
- **What a question is about.** The paper open when it was asked, which each question records. A paper only mentioned in a question does not count.
- **Why the rule exists.** At the first sitting, the button asked in a chat about another paper whose cache had expired, and the reader met the expired-cache question.

**The paper's properties** come from its frontmatter, with no model call: title, authors, year, arXiv, summary, type, topic, the date added, and the overview when there is one. They head the sheet the page badge opens. There is no `/paper-info` button.

**The PDF's links stay under the sheets.** PDF.js gives each link a z-index of its own, and at the first sitting they showed through the sheets over the paper. The viewer is now a stacking context of its own, under them.
