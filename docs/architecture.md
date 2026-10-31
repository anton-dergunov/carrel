# Architecture

How carrel works as built, and why it works that way. A part is described here as soon as it is built; [plan.md](plan.md) keeps only what is left, and what to check at the next sitting on the iPad. The task began in the engine as [docs/tasks/tablet-reader.md](../../agentic-paper-library/docs/tasks/tablet-reader.md), which keeps the earliest reasoning.

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

**One page.** `/`, `/area/<topic>`, `/read/<pdf>` and `/review/<scope>` are the same page, with the library on its own tab and a tab per open paper or review. Nothing reloads between them. The chat beside the library asks about the paper or review shown last, or about the library when none is open.

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
  - The library is an icon that stays at the left while the papers' tabs scroll.
  - Every paper's tab has its close button, so any tab closes with one tap.
- **Find** (for the paper showing) takes the place of the tabs while it is open.
- **Layout** opens a sheet with where the chat sits.
- **The chat button** draws where the chat is, dashed when it is hidden, and shows and hides it. A dot on it marks an answer or a permission request that came while the chat was out of sight.
- **The page number** is a faint badge in the PDF's corner. A tap opens the paper's sheet: a field to go to a page, what the library knows of the paper, and its contents ([below](#the-overview-and-the-properties)).
- **The chat has no header.** Its status line names the model, which opens the settings, and holds two icons, for earlier chats and a new chat. The box says which paper a question is about.

## A citation's mark

A citation the agent writes with the engine's `paperlib locate` carries the rectangles where the PDF prints what it cites (`rect=`, in points from the page's top-left). `cite-mark.js` draws them over the page, as vscode-pdf-viewer does, and the rectangles decide where the page scrolls: the mark is put in the middle of the pane. How `locate` finds a place, and how well, is the engine's [experiments/pdf-locations](../../agentic-paper-library/experiments/pdf-locations/README.md).
- **An overlay, never an annotation.** A layer inside the page's div, placed in percentages of the page, so zoom and rotation need no work. PDF.js empties the page's div when it draws the page again (a pinch, a new zoom), so the layer is put back on `pagerender`. Nothing reaches the PDF, so the saves (`PUT /pdf`) never carry it.
- **It arrives, then rests.** A ring contracts onto the mark once its page is drawn, then the mark stays while the reader scrolls. A tap on the page, Escape, another citation, or leaving the paper's tab takes it away. A mark that faded on its own would be gone by the time the reader looked up from the chat, and e-ink shows no animation; with reduced motion there is none.
- **Two shapes.** A phrase or a value (a box up to 24 pt tall) gets a soft wash with a hairline under it, as if underlined in ink; a table, a figure or an equation gets a thin outline. One ink, `#2a6f97`, in both themes, as the page stays white; it is none of the six highlight colours, so a mark never looks like a saved highlight.
- **In the address.** `/read/<pdf>?page=7&rect=…` opens the paper with the mark, as a link in the chat does, until the place the reader scrolls to replaces it.
- **The agent's sandbox.** `paperlib` runs through `uv run`, which writes its cache on every run, so the session's environment points `UV_CACHE_DIR` into the engine's cache folder, which the sandbox lets it write. Without it, `paperlib locate` failed here on uv's cache, and the agent had to work around it.

## Pages cited in plain text

The agent links most page citations, but leaves some plain: a page mentioned in passing ("Table 6 on p. 20"), a range to read ("pp. 8–10"). `page-links.js` makes those links when an answer is drawn, at no cost to the answer. Measured in the engine's [experiments/link-coverage](../../agentic-paper-library/experiments/link-coverage/README.md): 507 of 525 plain citations linked, none to the wrong paper.
- **Which paper.** The one the question was asked about, and only when every link in the answer goes to it. When the question names none, the one paper the answer links. A chat read back from its transcript finds the paper's PDF by its stem in the library's list. An answer that links two papers is left alone: a plain "p. 7" in it could be either's.
- **Another paper named.** A citation whose sentence names another library paper just before it ("FASTopic paper, p. 6") stays plain. A paper's name is its title before the colon, when that is three words or fewer.
- **What the link holds.** The page, a range's first page, and the named destination its label gives (`Table 6` → `table.6`, `§5.2` → `subsection.5.2`, `Appendix A.3` → `subsection.A.3`), which finds the table in a LaTeX paper even where the cited page is wrong. Never a rectangle: that needs `paperlib locate`.
- **Only text.** Code, maths and the agent's own links are left as they are.

## The text layer

Find, highlights and the selection all work on PDF.js's text layer.

**Find.** It worked in WebKit, at the iPad's size and under Playwright's iPad emulation, but on the iPad itself it found nothing ("evalua" in ClaimReceipt was "Not found").
- **Why.** The page's own error log, sent to the server (`page error: …`), showed every page failing in PDF.js's `getTextContent`. That function reads the page's text with `for await` over a stream, and Safari 26.6 cannot iterate a stream that way, though Playwright's newer WebKit can. PDF.js caught the error and searched empty pages. The pages were still drawn, since drawing reads the stream another way.
- **The fix.** `polyfill.js` adds the Streams standard's iterator before PDF.js loads. PDF.js's legacy build has no polyfill for this either.

**Highlights go into the paper's PDF.** They are ordinary Highlight annotations written the way vscode-pdf-viewer writes them: PDF.js's highlight editor, appended to the file as an incremental update. Both apps, and any other PDF app, show and edit the same ones. Highlights carry no notes.
- **The pen.** It sits in the bar, beside find. While it is on, a selection is highlighted once it settles. Nothing is offered beside a selection, because iOS puts its Copy / Look Up menu below it near the top of the screen and above it near the bottom, and Android the other way round.
- **One band per line.** PDF.js measures a selection by the text layer's spans, and a space the PDF sets apart from its words gets a span one space of the browser's font wide, so its highlight had holes, and small capitals made a line ragged. A line's boxes are joined into one, from its first word to its last and as tall as its tallest; boxes further apart than the line is high stay apart, so the gutter between columns is left alone. Where a highlight starts and ends inside a span is still PDF.js's estimate, from a stand-in font stretched to the span's width.
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

**Tables** wrap their text, as lectern's do. A short entry (16 characters or fewer, such as "Fig. 1, p. 3") stays on one line, and a longer one keeps at least 8em, so a column of references is not squeezed to its longest word beside a column of sentences. A table that cannot fit even so scrolls sideways.

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
- **The result.** The note is written once, as a file, and the sheet shows it. A tap on the skill's link to the note opens the sheet too, later as well: the link is the note's path on the laptop, which the server maps back to its paper (`/api/overview-note`), so with another paper open its paper's tab opens and the sheet over it.
- **Which chat is about the paper.** The open chat counts when it has no questions yet, or when each of its questions was asked with this paper open; otherwise the button starts a new chat, and the other waits in the list.
- **What a question is about.** The paper open when it was asked, which each question records. A paper only mentioned in a question does not count.
- **Why the rule exists.** At the first sitting, the button asked in a chat about another paper whose cache had expired, and the reader met the expired-cache question.

**The paper's sheet** opens from the page badge. Everything in it comes with no model call, from the paper's frontmatter and the agent's note. There is no `/paper-info` button.
- **On top**, a bar that stays as the sheet scrolls: the field to go to a page, and the button that opens the sheet out.
- **The head**: the title in the reading serif, the authors (the first three, the rest a tap away), the year and the arXiv link.
- **Sections that fold**, each under a header row with its Lucide icon, its title and a note on what it holds, so a folded one still says whether it is worth opening. They had crowded the sheet as one scroll, with the page field and the contents far down.
  - About (`info`): the summary, then the type with its icon, the topic, the date added and the text layer. Its note is the type and the area.
  - The agent's reading (`book-open-check`): the family and the evidence. Its note is the family.
  - Digest (`scroll-text`): the digest, drawn the first time it opens. Its note counts the points.
  - Similar papers (`orbit`), [below](#the-library). Its note counts them.
  - Contents (`list-tree`): the PDF's outline. Its note counts its top level.
  - **What each device remembers.** A tap folds or opens a section, and the device keeps the choice. A new device opens About and Contents.
  - **Notes that repeat.** About's and the reading's notes show only while folded, since the open section says the same.
- **At the foot**, the overview when there is one, and Remove.
- **Small, as before**: by the badge, closed by a tap anywhere else.
- **Opened out** for reading the details: over the page below the tabs, chat and all, with larger type. A tap elsewhere leaves it open; ×, Escape or making it small again close it. The pane alone was too small in portrait, with the chat below the paper.
  - Once it is 760 px wide (the iPad in both orientations), it has two columns: the head and the paper's sections on the left, Similar papers and Contents on the right.
- **On a phone** (under 600 px wide), the badge opens it over the whole page at once, inside the safe areas. The pane keeps its layout to itself, so a sheet over the page is moved out of it while open.

**The PDF's links stay under the sheets.** PDF.js gives each link a z-index of its own, and at the first sitting they showed through the sheets over the paper. The viewer is now a stacking context of its own, under them.

## The library

The library tab is the reader's view of the whole collection: four views of one document, and one search box that narrows whichever is showing, at three depths (titles on the device, the papers' text and their meaning on the laptop). Each device remembers its view, area, rows, sort, chips and depth.

**One document.** `GET /api/library` holds every paper that has a PDF, with its title, authors, dates, summary, topic, type and arXiv id, and its marks: the reader's overview note, the reviews that cite it, whether the agent has read it, and how many of carrel's questions were about it. With them come the topics (each with its own and its total count), the review scopes in their order, and the reviews.
- **Built from the engine's reads**: `paper_index`, `load_topics`, `load_reviews` with `review_links`, `read_note`, `review_scopes`. The type is the frontmatter's, which every paper has: the engine writes it when a paper is filed and replaces it when the paper is read ([experiments/paper-type](../../agentic-paper-library/experiments/paper-type/README.md)).
- **Fresh without cost.** Building it takes about a second on 2,275 papers, mostly checking that each PDF is there and reading the notes' heads. Whether anything changed takes 16 ms: a walk that counts the files of the folders it comes from and finds the latest change. So it is kept with its gzip (1.8 MB, 0.5 MB compressed) and an ETag, and built again only when that changes. A page that has it gets a 304. A global gzip would have broken the PDFs' range requests, so only this answer is compressed.
- **Chats discussed** come from the transcripts tagged `carrel`, found with `rg -l` among 150 MB in a tenth of a second and counted once per file until it changes.
- **The page filters on the device**, every word against one haystack per paper; rows use `content-visibility: auto`, so 2,275 rows stay quick on the iPad.
- **Highlights are not a mark.** Counting them means opening every PDF; they could come later from the saves carrel makes itself.

**The views.**
- **Desk**, where a new device's library opens: the papers and reviews open on this device and the papers of recent chats, the papers added lately, and each group of review scopes as pips (reviewed, read, to read).
- **Areas**: the topic tree beside an area's page on a pane 860 px wide or more, and on a narrower one the page alone with a breadcrumb. An area's page has its scope, its review's card (or the review above that covers it), its subtopics as bars, a histogram of the years published that narrows the rows, and the rows. The library's own page is a squarified treemap of the areas, with "Every area" as bars under it. Every tile names its area and its count: labels are measured with the page's font (15 px down to 11 px, wrapping between words, the count after the name or under it), and the tiles too small for one are merged into a hatched "+N more", laid out last, which opens the area's page (at the top, "+N more areas" goes to "Every area"). An area's header takes what its label needs, up to a third of the tile, and an area too small to name one subtopic shows its own label alone. What to do next with the map is [plan-area-map.md](plan-area-map.md).
- **All**: every paper, with chips for area, type (whose menu is the icons' legend), years and the papers touched.
- **Timeline**: a row of dots a year, coloured by top-level area, or by month added; a year opens All at that year.
- **Rows** are compact or rich and sorted by topic, date added or published; a TeX title reads as text (τ²-Bench). The whole row is the link. A small Lucide icon in its gutter gives the paper's type (method `flask-conical`, survey `map`, benchmark `gauge`, study `microscope`, system `cpu`, position `megaphone`, theory `sigma`), and its marks are the reader's overview, a review's citation and carrel's chats.
- **The look.** Titles in the reading serif, the rest in the UI sans with counts and years in tabular figures; rows at least 44 px to tap, with hairline separators. The top-level areas have muted hues of equal lightness, in both themes, shared by the treemap, the bars and the Timeline. Nothing moves but short fades, and nothing at all with reduced motion.

**Text search** (`GET /api/search`) is the box's second depth. Ripgrep counts the matches in every text layer in 0.03–0.25 s, where Python took 1.25 s; it reads hidden and ignored files as text (without that it misses papers) and matches across lines (`-U`, which costs nothing here and finds a phrase broken over a line). The 30 papers with the most matches are then read in Python for three snippets each, with the page from the nearest `[page N]` line above. A snippet opens the paper at that page with the words in find.

**Meaning search** (`GET /api/meaning`) is the box's third depth: the 60 papers nearest a description, in the area showing or the whole library, as rows with a four-step meter of how near each is among them. It is the engine's `meaning.py`, which `paperlib meaning` and `paperlib similar` also use, so the agent searches the same way.
- **The encoder** is Qwen3-Embedding-0.6B, chosen on this library ([experiments/meaning-search](../../agentic-paper-library/experiments/meaning-search/README.md)). On 32 reader-style queries graded by a model, its nDCG@10 was 0.752, against 0.628 for the best small encoder (bge-base) and 0.504 for BM25 over the same text.
- **What is embedded**: each paper's title, summary and abstract, the abstract taken from the head of its own text. Title and abstract alone scored about the same; title and summary alone, much lower. The opening of the body is being measured.
- **The cache** is the engine's: one vector a text, named by the digest of the model and the text, so only a new or changed paper is embedded again. The server keeps the vectors in memory (about 9 MB), built in a thread when it starts and built again when the library's document changes.
- **The model is loaded only to embed a question or a new paper**, and freed after 10 minutes without a question. It holds about 1.2 GB, and most visits ask nothing.
  - The server holds 150 MB at rest.
  - The first Meaning search after a rest waits about 7 s while torch and the model load; later ones answer in about 80 ms.
- **The agent's `paperlib meaning`** loads its own copy for each call, in Claude Code's sandbox, which hides the GPU. On the CPU in float32 a call takes 8–9 s, as it does on the GPU: most of it is importing torch and loading the model, and a query itself is 174 ms against 65 ms.
- **Similar papers**: the paper's sheet lists the eight nearest papers in a section of its own (`GET /api/similar/<pdf>`), and a tap opens one in its tab.

**A review opens in a tab of its own** and keeps its place. It is drawn as the agent's answers are, with Obsidian's callouts as boxes. A paper's link opens a peek (its title, year, summary, Open, and Open at p. N for the pages the same paragraph cites); a page link opens the paper there; another review's link opens its tab. The server resolves the links (`/api/review/<scope>`), since a paper's link points at its text and the peek opens its PDF. A question asked beside a review carries `[Reading the review <file>]`.

**Adding and removing** run the engine's own commands, one at a time, and stream their output into a sheet. An arXiv paper is filed by the engine (a model picks its area and writes its summary); a web page or an uploaded PDF goes into the area the reader picks. Remove, in the paper's sheet, deletes its text, PDF and the agent's note once the reader confirms, and with a reason records it as skipped. What happened is read from the library, not from the exit code: `paperlib add` exits 0 for a paper it already has, and `remove` exits 1 when the check afterwards finds a review still linking the paper it did remove.
