# Architecture

How carrel works as built, and why it works that way. A part is described here as soon as it is built; [plan.md](plan.md) keeps only what is left to build. The task began in the engine as [docs/tasks/tablet-reader.md](../../agentic-paper-library/docs/tasks/tablet-reader.md), which keeps the earliest reasoning.

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, in the library, and the browser only shows its messages. The app is served to the tablet over Tailscale.

## The library and the engine

Carrel has its own repository and imports the engine's `paperlib.py`, so the library is read exactly as the scripts read it. The folders the library's config names outside it (`pdf_root`, `overview_dir`, …) come from there too.

## Who connects

The server listens on 127.0.0.1 and is published to the tailnet by `tailscale serve` on port 8443, over HTTPS. It admits only the reader's Tailscale login and checks Host and Origin. There is no password.

## Starting at login

`carrel agent install` (with serve's own options) writes a launchd agent, `~/Library/LaunchAgents/com.anton.carrel.plist`, that runs `carrel serve` from login onwards, logging to `~/Library/Logs/carrel.log`; `status` and `uninstall` check and remove it. It is Lectern's `lectern agent`, with three changes:
- **Everything named.** launchd knows nothing of the shell's folder or environment, so the agent runs with the library, the engine and the extra folders as absolute paths, and with the installing shell's `PATH` (and `XDG_STATE_HOME`, when set): launchd's own lacks Homebrew's `rg` and `uv`, which runs `paperlib`, and the `tailscale` command. The program is the checkout's `.venv/bin/carrel`, which `uv sync` keeps in place.
- **One carrel per port.** `serve` first asks the port's `GET /api/ping` (`{app, version, library, tablet}`, the last its tailnet address when `tailscale serve` publishes it). When a carrel answers, it says so and exits 0, and launchd, which restarts it only after a failure (`KeepAlive: {SuccessfulExit: false}`), leaves it stopped. So a hand-typed `carrel serve` tells where carrel already runs.
- **Waiting for the old one.** `launchctl bootout` returns while carrel is still closing its chats, and loading the agent again before then fails, so `install` waits until the old one is gone.

The agent keeps running the code it started with: after a change, or `uv sync`, `launchctl kickstart -k gui/$UID/com.anton.carrel` restarts it. Chats under launchd use the same Claude Code login, from the login keychain.

## The Mac app

`macos/` is Carrel in a window of its own: carrel's page in a WKWebView, at `http://127.0.0.1:<port>/`, with the server found or started behind it. It is a shell: the page is the same one the tablet loads, and admission is unchanged (a loopback Host with no Tailscale login, and the page's own Origin).
- **Swift, not Tauri.** Tauri would draw in the same WKWebView on the Mac and adds a Rust toolchain; its gain is Windows and Linux builds, which the browser covers. The shell is a few hundred lines, easy to rewrite if they are ever wanted.
- **From Acervo's app** (`acervo-llm-dictionary/macos`): moving between a window and the menu bar (`AppActivation`), staying in the menu bar after a launch at login (`LaunchContext`), the login item read from the system, the Edit menu, the file panel, outside links in the browser, and the project in XcodeGen's `project.yml`. Not taken: its own static server and scheme (carrel's server serves the page, on a fixed port, so the page's storage keeps its origin), its own updater, and turning the login item on at first launch.

**Finding the server.** The app asks the port's `/api/ping`. A carrel answering (the login agent's, or one typed in a terminal) is shown and never stopped. With none, the app starts `carrel serve --exit-with-stdin` itself, logging to `~/Library/Logs/carrel-app.log`, and shows the page once the ping answers.
- **Its own server goes with it.** On quit the app sends SIGTERM, which closes the chats, and waits for it (SIGKILL after 15 s). The server also stops when its stdin closes, and the app holds the other end, so a server the app started never outlives it, even when the app is killed.
- **The setup, first found wins:** the app's Settings; the login agent's plist (its `carrel`, `--library`, `--engine`, `--port` and the rest of its options); the login shell (`carrel` on its PATH, `PAPER_LIBRARY`, `CARREL_ENGINE`). With the agent installed, nothing needs setting. An app opened from the Finder has launchd's bare PATH, as the agent does, so the app reads the login shell's environment once (`$SHELL -l -i -c 'env -0'`, 5 s at most) and passes on its PATH, `XDG_STATE_HOME`, `PAPER_LIBRARY` and `CARREL_ENGINE`.
- **When it cannot start one**, the window says why, with the last lines of the log and buttons for Settings, Try Again and the log.

**The window.** Its title is the page's. Safari's Develop menu can attach its Web Inspector to the page (`isInspectable`), to profile it as the app draws it. Carrel's own addresses stay in it; any other web address opens in the browser, `window.open` included; a paper link (`pdf.invalid`) never navigates, since the page handles it. Adding a PDF opens the Mac's file panel.

**Menus call the page.** Each menu item that acts on the library runs one of the page's commands, `window.carrel.command(name)` (`commands.js`), and gets back whether it did anything: Add Paper (⌘N), Close Tab (⌘W, which closes the window on the library), Find (⌘F: the paper's find, or the library's search box), Library (⌘1), Next and Previous Tab (⇧⌘] and ⇧⌘[), Ask (⌘L), Show or Hide Chat (⇧⌘L), Page Settings (⌥⌘,). Zoom (⌘0, ⌘=, ⌘−) is the paper's, or the meaning map's, and the whole page's only when neither is showing. The page takes a few keys itself, in a browser too: ⌘F (Ctrl+F), since the browser's find cannot search the pages PDF.js has not drawn; and ⌘= ⌘− ⌘0, and + − 0 alone, which zoom the paper as they zoom the map. Where there is nothing of the page's to zoom, ⌘= and the rest are left to the browser.

**The menu bar item** is off until Settings turns it on. A click shows or hides the window; a right click has the server's status, Copy Tablet Address, Start or Stop Server (the app's own), Settings and Quit. With it on, closing the window leaves Carrel in the menu bar with no Dock icon, and a launch at login stays there.

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

One dialog, as in Lectern, holds the look and the chat's settings. The gear in the strip opens it at the top, the model's name on the chat's status line opens it at the chat's part, and so does the Mac app's View ▸ Page Settings… (⌥⌘,; ⌘, is the app's own Settings). It is a dialog over the page, not a sheet over the chat, which was too cramped below the paper: two columns where it is 760 px wide or more (the look, then the layout and the chat's), so it is not too tall on the Mac and the iPad, and the whole screen on a phone, its title with Done staying in view as it scrolls. It sits near the top and within the area above the keyboard, so the note being typed stays in sight. Each part says where it is kept: on this device, or on the server for every device.

**Where the chat sits** is chosen here too, by layout.js's control: six places, applied at once behind the dialog, and the size back to where it started. It used to have a button in the strip, which the iPad needs room for.

**The look is each device's own**, since the iPad, the e-ink tablet and the Mac want different ones. `boot.js`, a plain script in the page's head, reads it from `localStorage` and applies it before the first paint, so a saved theme never flashes in after the page; the modules read it through `window.carrelLook` and hear of a change by a `carrel:look` event. A device that says it is an e-ink reader (its browser's name, or `(monochrome)`) starts in E-ink.
- **Colours.** Carrel's own warm light and grey dark, Lectern's Black & white, and Lectern's E-ink, black only or with colour. The first two are Light, Dark or Follow system, the default. Every colour is a variable in `themes.css`, one block a theme, and the map, the diagrams and the code read them from there. Lectern's Solarized was weighed: its light theme is already carrel's background, and its navy dark one would have meant tuning the areas' hues and the map again, and set the white page on navy.
- **Dark pages**, off by default, darken the PDF in a dark theme: each page, with what is drawn on it (a citation's mark, a selection, its preview), is inverted and its hues turned back, so a highlight keeps its colour. The PDF is not changed.
- **Pages**: how a paper's pages are drawn, under one switch (Adjust pages) that keeps the choices beneath it when off, so a paper can be seen as it is and back in a tap. Each device's own, and not each paper's: an adjustment changed from paper to paper in the research, but one kept per paper would leave the reader unsure what is on. Chosen by the reader on the Boox, the iPad and the Mac's monitor ([experiments/crisp-pages](../experiments/crisp-pages/README.md)):
  - **Letters as outlines**: the paper is loaded with PDF.js's `disableFontFace`, so PDF.js fills each letter's outline itself instead of the browser drawing the font, and a font the PDF does not embed comes from PDF.js's standard fonts. Crisper on e-ink (the clearest win of the research), duller on a monitor, nothing on the iPad; it costs nothing measurable in drawing on the Boox. A change loads the paper again, in place.
  - **Bolder letters** (0.05, 0.1, 0.18 pt) and **Sharper edges** (an unsharp mask of 0.4, 0.7, 1): drawn on each canvas once PDF.js has drawn it (`page-adjust.js`, at `pagerendered`). Bolder is a double strike: the canvas drawn over itself moved sideways by the width, keeping the darker, which the reader found as good as stroking every letter's outline, without changing the PDF that keeps the highlights. Sharper is worked out in a worker and put back unless the canvas was drawn again meanwhile: as a CSS filter the same mask was worked out again at every frame of a scroll (600–950 ms a frame in Chromium, stalls of 280 ms in WebKit), and a canvas filter is ignored by WebKit. A change draws the pages again.
  - **Darker greys** (a gamma of 1.25, 1.5 or 1.8 on the page's greys, white and black kept) and **Contrast** (1.15, 1.3, 1.5): filters on each page's canvases alone (`app.html`'s SVG filters, `--page-filter`), so the highlights and a citation's mark keep their colours, and Dark pages applies after them.
  - **Scans in black and white**: grey, then ink below 55%, on the pages that are scans alone. The laptop finds them when a paper is opened (`scans.py`, `/api/scans`: a page whose images cover 85% of it), in milliseconds, kept by the PDF's version.
  - **Where a device starts**: e-ink with the research's winners there, outlines, bolder letters at 0.05 pt and black-and-white scans, which made the Boox's pages far easier to read; every other screen with the pages as they are. The iPad's winners on small crops (darker greys, sharper edges) were too crisp on a whole page, read in the sitting. E-ink's choice follows the E-ink colours, since the Boox's Chrome does not say it is an e-ink reader.
- **Text sizes.** The library (with a review), the chat, and everything else, each 14 px and up: 17, 15 and 15 px by default, what the reader settled on for the Mac, the iPad, a phone and the e-ink tablet alike. Every font size in `app.css` is a multiple of its part's scale; paddings, icons and the 44 px rows to tap stay as they are. A box to type in never goes under 16 px, or Safari zooms into it. The area maps lay their labels out again at the library's size (still 11 px and up, scaled), the meaning map draws its names at it, and Mermaid draws at the chat's, as does a diagram drawn again when the look changes.

**E-ink**, as Lectern does it, for a screen where every repaint is slow and leaves ghosts:
- **A page is drawn once, whole and sharp.** On a phone or tablet PDF.js caps a canvas at 5.24 MP, and a page at page width on the Boox is 7.4 MP: it drew the page whole at 42% of the screen's pixels, then the part in view sharp, and the first drawing sat up to 5 CSS px lower than the second (measured by phase correlation of the two), so on every turn the text jumped up as the sharp one landed. On e-ink the cap is 16.7 MP (`read.js`), one drawing up to about 1.5× page width; PDF.js keeps about ten pages drawn, some 300 MB of canvases at most.
- **Nothing moves.** No transition, animation, shadow or smooth scroll, and the map flies nowhere. A filled shape is something pressed or chosen, and what the other themes fill gets a border. With black only, the area maps are outlines (a merged tile hatched, its words kept clear) and the map's dots are black.
- **Text keeps its regular weight.** Lectern's heavier text (500) drew the chat and the rows' summaries far darker than the paper on the Boox, whose Roboto has a true Medium; the serif titles, with no 500, never changed.
- **Pages turn rather than scroll** (`pager.js`). A turn moves what is in view a screenful at once, less two lines carried over; going back retraces the turns made, so Back then On ends where it began. In a paper, a page whose top is in the last quarter of the screen starts the next one. The ⌃ ⌄ in the strip turn the tab showing (the paper, the library's lists, a review, the chat on its tab; the Map pans), those on the chat's status line turn the chat, and so do the page keys, and a tap on the paper's left or right 30% outside a link, a highlight and the pen.
- **The stream in a few updates.** An answer is drawn a whole paragraph at a time, at most every 3 s, and whole once it is complete.

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
- **On a Mac's trackpad.** A pinch arrives as wheel events with `ctrlKey`, as ctrl and a mouse wheel do, and nothing says the fingers lifted. It is the same pinch: the pages scaled as a picture, and the viewer rescaled once no wheel event has come for 200 ms. The steps are the meaning map's.
- **On the chat.** iOS ignores `user-scalable=no`, and it ignored `touch-action` on `body`, so a pinch there still zoomed the whole page. Cancelling Safari's `gesturestart`/`gesturechange` events stops it.

**One finger keeps to an axis on the iPad.** Zoomed past the page's width, a swipe down drifted sideways: iPad Safari scrolls a box exactly as the finger goes, where Android's Chrome locks the scroll to the axis the swipe mostly runs along.
- **Why carrel pans.** WebKit has no axis lock for a box that scrolls, and no CSS gives one: `touch-action` is fixed when the finger lands, before its direction is known. Setting the sideways scroll back while Safari scrolls fights its scrolling, which runs apart from the page. So `pan.js` cancels one finger's moves and scrolls the container itself.
- **The lock.** Chosen when the finger has gone 6 px (the way it came is then scrolled at once) and kept until it lifts, as UIScrollView's directional lock does: within 30° of vertical it scrolls only up and down, within 30° of horizontal only sideways, and a diagonal moves freely.
- **Like Safari's own scroll.** The numbers are those Flutter's iOS scrolling measured against UIScrollView. The speed at release weighs the last three moves 0.6, 0.35 and 0.05, the newest least; a first version averaged the last 100 ms, which missed the speed a flick gains as it leaves the finger, and short swipes stopped too soon. The page coasts at UIScrollView's normal deceleration (0.998 a millisecond), on the locked axis. A flick while it still coasts, in the same direction and at least half as fast, adds `0.000816 · v^1.967` px/s of the coast's speed, so flick after flick goes faster. A tap that stops a coast is not a click. None of it on e-ink or with reduced motion, and there is no bounce at the ends.
- **What stays Safari's.** A paper at page width (there is nothing sideways to drift into), a long press (selecting text, the pen, a selection's handles), two fingers, and every device but an iPad or iPhone.

**The keyboard.**
- **Fitted above it.** Safari sometimes scrolls the page up to show the box being typed in, and sometimes doesn't. So the page is fitted to the area above the keyboard (the visual viewport). The PDF gets shorter, and a chat above or below keeps up to 70% of what is left.
- **Focused without a scroll.** Safari slides the whole page up while its keyboard rises and reports where it went only now and then, so fitting the page put it back a moment late. A tap on a box therefore focuses it without that scroll, and while the keyboard comes and goes the page is fitted at every frame.

## Layout and tabs

**One page.** `/`, `/area/<topic>`, `/read/<pdf>` and `/review/<scope>` are the same page, with the library on its own tab and a tab per open paper or review. Nothing reloads between them. The chat beside the library asks about the paper or review shown last, or about the library when none is open.

**Tabs.**
- A paper opens in a tab after the one showing, and a citation to an open paper goes to its tab.
- **Drawn on the GPU.** The pages' canvases are asked for with `enableHWA`. Without it PDF.js asks for canvases it will read back, which Safari keeps off the GPU. In WebKit at 2x, a page took 74 ms to appear after a jump and a scroll had frames of 25–33 ms; with it, 46–63 ms and 18–19 ms. carrel's own parts cost nothing measurable beside a bare PDF.js viewer.
- **A preview behind each page.** PDF.js draws a page only once it scrolls into view and keeps about ten drawn, so a fast scroll, or a tab (whose paper is loaded into the one viewer again), showed white sheets for a moment. Each page now has a small picture of itself (540 px wide, JPEG) as its background, shown until PDF.js draws it: taken from the page's canvas whenever PDF.js draws it, and drawn small for the other pages while the viewer is idle, nearest to the page in view first (`previews.js`). The last six papers keep theirs, so coming back to a tab shows its pages at once, blurred for a moment.
- **One viewer.** All papers share one PDF viewer, because several viewers would each keep their rendered pages, which is what makes iPad Safari drop a page. Each tab keeps its place (page, zoom, scroll), so coming back to a tab puts the paper back where it was.
- **The address.** It names the tab showing. The Home Screen app always starts at `/`, so it opens the tab that was showing last.

**Where the chat sits.** The chat sits below, above, left or right of the paper, over the bottom of it as a sheet, or on a tab of its own, and it can be hidden. Each device remembers its choice, made in the [Settings](#settings). Until it has chosen, the chat is beside the paper on a wide screen (1100 px or more, and 1.3 times as wide as tall: the Mac, a tablet held sideways) and below it otherwise.
- **The split is dragged,** and each side keeps its own size; a double tap puts it back at 40%. A finger has room to grab it on both sides of the line; a mouse or trackpad only on the far side, since the pane before the split has its scrollbar there.
- **While dragging.** The panes resize as the finger moves, a step a frame. The PDF keeps its scale meanwhile and fits the new width when the finger lifts, since drawing every page at a new scale at each step is what made it slow.
- **Over the page** the paper keeps the whole screen and the chat is a sheet over its bottom, shown and hidden by the Chat button; the page badge moves up above it. A tap on the paper leaves it open, so a passage can be selected, or a page turned, under it. It is there for e-ink, where a page that turns does not need the chat to give way, and the sitting compares it with Below.
- **Why not move only a line.** Moving a line and resizing at the end was quicker, but it looked broken and left the reader guessing how big the chat would be.

## The controls

A paper set to the page width is about as tall as the iPad's screen, so the controls take one row, and anything used rarely waits in a sheet.

- **The bar** holds the tabs and a few small grey icons (Lucide's, ISC).
  - The library is an icon that stays at the left while the papers' tabs scroll.
  - Every paper's tab has its close button, so any tab closes with one tap.
- **Find** (for the paper showing) takes the place of the tabs while it is open.
- **The chat button** draws where the chat is, dashed when it is hidden, and shows and hides it. A dot on it marks an answer or a permission request that came while the chat was out of sight. On a phone the bar has no room for it: it is a switch in the Settings' Layout, and the gear carries the dot.
- **The page number** is a faint badge in the PDF's corner. A tap opens the paper's sheet: a field to go to a page, what the library knows of the paper with the reader's star and tags, and its contents with their highlights ([below](#the-overview-and-the-properties)).
- **Settings** is the gear at the strip's end.
- **The chat has no header.** Its status line names the model, which opens the settings at the chat's part, and holds two icons, for earlier chats and a new chat. The box says which paper a question is about.

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

**Highlights gathered.** A paper's row marks its highlights with their count, and its Contents lists them among the headings, each a jump to its place.
- **Read from the PDFs, whichever app made them.** The engine's `highlights.py` reads a PDF's Highlight annotations with PyMuPDF, with the words under each and its note: about 6 ms a paper, 15 s for all 2,275 the first time. So highlights made in vscode-pdf-viewer, in a tablet's reader through the synced folder, or by the paper's authors are there too. One paper in the library carries 26 comments its author published as highlights, each with a note.
- **Kept, and read again only when a PDF changes.** carrel keeps what it found in its state folder, with each PDF's modification time and size. When the server starts, and at most once a minute when the library's document is asked for, it stats the PDFs (40 ms) and reads only those that changed. A save from carrel reads that one at once.
- **Placed among the headings** by where they are: a highlight goes under the last entry of the outline that leads to its page at or above it. A PDF without an outline lists its highlights alone, by page. A tap scrolls the highlight into the middle of the pane, as a citation's mark does, with no mark over it.
- **The words are found on the laptop**, from PyMuPDF's words inside the highlight's quads. PDF.js gives text only for pages it has drawn, and does not see highlights saved since the paper loaded.

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
- **Asked first.** The pen opens a strip at the chat's foot that asks before writing and says which chat it goes to, since a press costs a reading of the whole paper. Typing `/overview` runs it at once.
- **Why that chat.** The skill reads the whole paper into the chat, so the questions after it pay only for a cache read. A chat of its own, left behind, would make the reader's next chat read the paper a second time.
- **The result.** The note is written once, as a file, and the sheet shows it. A tap on the skill's link to the note opens the sheet too, later as well: the link is the note's path on the laptop, which the server maps back to its paper (`/api/overview-note`), so with another paper open its paper's tab opens and the sheet over it.
- **Which chat is about the paper.** The open chat counts when it has no questions yet, or when each of its questions was asked with this paper open; otherwise the button starts a new chat, and the other waits in the list.
- **What a question is about.** The paper open when it was asked, which each question records. A paper only mentioned in a question does not count.
- **Why the rule exists.** At the first sitting, the button asked in a chat about another paper whose cache had expired, and the reader met the expired-cache question.

**The paper's sheet** opens from the page badge. Everything in it comes with no model call, from the paper's frontmatter and the agent's note. There is no `/paper-info` button.
- **On top**, a bar that stays as the sheet scrolls: the field to go to a page, and the button that opens the sheet out.
- **The head**: the title in the reading serif with the reader's star beside it, the authors (the first three, the rest a tap away), the year and the arXiv link, then the reader's tags ([below](#the-library)).
- **Sections that fold**, each under a header row with its Lucide icon, its title and a note on what it holds, so a folded one still says whether it is worth opening. They had crowded the sheet as one scroll, with the page field and the contents far down.
  - About (`info`): the summary, then the type with its icon, the topic, the date added and the text layer. Its note is the type and the area.
  - The agent's reading (`book-open-check`): the family and the evidence. Its note is the family.
  - Digest (`scroll-text`): the digest, drawn the first time it opens. Its note counts the points.
  - Similar papers (`orbit`), [below](#the-library). Its note counts them.
  - Contents (`list-tree`): the PDF's table of contents, its outline, with the reader's highlights among its entries ([above](#the-text-layer)). Its note counts the top level and the highlights, or says the PDF has no table.
  - **What each device remembers.** A tap folds or opens a section, and the device keeps the choice. A new device opens About and Contents.
  - **Notes that repeat.** About's and the reading's notes show only while folded, since the open section says the same.
- **At the foot**, the overview when there is one, and Remove.
- **Small, as before**: by the badge, closed by a tap anywhere else.
- **Opened out** for reading the details: over the page below the tabs, chat and all, with larger type. A tap elsewhere leaves it open; ×, Escape or making it small again close it. The pane alone was too small in portrait, with the chat below the paper.
  - Once it is 760 px wide (the iPad in both orientations), it has two columns: the head and the paper's sections on the left, Similar papers and Contents on the right.
- **On a phone** (under 600 px wide), the badge opens it over the whole page at once, inside the safe areas. The pane keeps its layout to itself, so a sheet over the page is moved out of it while open.

**The PDF's links stay under the sheets.** PDF.js gives each link a z-index of its own, and at the first sitting they showed through the sheets over the paper. The viewer is now a stacking context of its own, under them.

## The library

The library tab is the reader's view of the whole collection: five views of one document, and one search box that narrows whichever is showing, at three depths (titles on the device, the papers' text and their meaning on the laptop). Each device remembers its view, area, rows, sort, chips and depth. An × in the box, or Escape, empties it; the × leaves the keyboard as it was, up or down (it cancels its `mousedown`, not its `pointerdown`, after which WebKit drops a tap's click).

**One document.** `GET /api/library` holds every paper that has a PDF, with its title, authors, dates, summary, topic, type and arXiv id, and its marks: the reader's overview note, the reviews that cite it, whether the agent has read it, and how many of carrel's questions were about it. With them come the topics (each with its own and its total count), the review scopes in their order, and the reviews.
- **Built from the engine's reads**: `paper_index`, `load_topics`, `load_reviews` with `review_links`, `read_note`, `review_scopes`. The type is the frontmatter's, which every paper has: the engine writes it when a paper is filed and replaces it when the paper is read ([experiments/paper-type](../../agentic-paper-library/experiments/paper-type/README.md)).
- **Fresh without cost.** Building it takes about a second on 2,275 papers, mostly checking that each PDF is there and reading the notes' heads. Whether anything changed takes 16 ms: a walk that counts the files of the folders it comes from and finds the latest change. So it is kept with its gzip (1.8 MB, 0.5 MB compressed) and an ETag, and built again only when that changes. A page that has it gets a 304. A global gzip would have broken the PDFs' range requests, so only this answer is compressed.
- **Chats discussed** come from the transcripts tagged `carrel`, found with `rg -l` among 150 MB in a tenth of a second and counted once per file until it changes.
- **The page filters on the device**, every word against one haystack per paper (title, authors, summary, area, type, year). Each sort's order is worked out once per library, so a search's matches are ordered by a number, and the rows are drawn 60 at once and the rest 200 at a time as the reader scrolls toward them; with `content-visibility: auto` on the rows, a key costs a few milliseconds where it cost 150–300 ms in WebKit on the Mac when every match was sorted by title and placed. The words are marked in the titles; when some are not in the title, a small line under it says where they are (an excerpt of the summary starting near the match, the matching authors, the area, the type or the year), each field only for words the ones before it lack. A rich row marks its authors and summary where they are and puts the line last.

**The views.**
- **Desk**, where a new device's library opens: the papers and reviews open on this device and the papers of recent chats, the papers starred to read (the newest star first), the reader's tags, the papers added lately, and each group of review scopes as pips (reviewed, read, to read).
- **Areas**: the topic tree beside an area's page on a pane 860 px wide or more, and on a narrower one the page alone with a breadcrumb. An area's page has its scope, the map of its subtopics, its review's card (or the review above that covers it), a histogram of the years published that narrows the rows, and the rows; while a title search narrows the area, its subtopics are bars of what matches instead of the map. The library's own page is the map of the areas, then "Every area" as bars, and the reviews. The maps are [below](#the-library).
- **All**: every paper, with chips for area, type (whose menu is the icons' legend), years, the reader's tags, and the papers touched (starred, highlighted, with an overview, cited in a review, asked about).
- **Timeline**: a row of dots a year, coloured by top-level area, or by month added; a year opens All at that year.
- **Map**: the papers laid out by meaning, [below](#the-library).
- **Rows** are compact or rich and sorted by topic, date added or published; a TeX title reads as text (τ²-Bench). The whole row is the link. A small Lucide icon in its gutter gives the paper's type (method `flask-conical`, survey `map`, benchmark `gauge`, study `microscope`, system `cpu`, position `megaphone`, theory `sigma`), and its marks are the reader's star, highlights (with their count) and tags, their overview, a review's citation and carrel's chats. A rich row names its tags after its authors.
- **The look.** Titles in the reading serif, the rest in the UI sans with counts and years in tabular figures; rows at least 44 px to tap, with hairline separators. The top-level areas have muted hues of equal lightness, in both themes, shared by the treemap, the bars and the Timeline. Nothing moves but short fades, and nothing at all with reduced motion.

**Stars and tags are the reader's own.** A star marks a paper to read later; a tag gathers papers for one of the reader's projects, across the areas, with an optional line on what it is for. Ranking papers was weighed and left: a star is an intention with a date, not a judgement, and a tag says what a paper is for.
- **Kept in the library**, in `catalog/reader.yaml`, through the engine's functions: each paper by its path, with the day it was starred or tagged. Not in the papers' frontmatter, which the filing model writes and every agent reads, so a `tags:` field there would invite an agent to fill it. The engine's `move`, `rename` and `remove` keep the paths in step, and `paperlib check` reports one that names no paper.
- **Never written by an agent.** A tag stands for a project only the reader knows. The guide says to read the file only when the reader names a tag or asks what they starred, and never to suggest, add or remove one. The engine has no command that writes it (`paperlib tags` and `starred` only read), carrel's sessions deny Edit on the file, and the sandbox denies Bash writing it.
- **Set in the paper's sheet**: the star beside the title, and the tags as pills under the byline, each with a ×. Tag opens a picker under them: a field that finds a tag or names a new one (lower case, words joined by hyphens), and the tags with a check on the paper's own, the device's recent ones first. The star is also in the map's peek and a review's peek. A change shows at once and goes back if the laptop could not keep it.
- **Where they show**: the row's marks; Desk's Starred to read and Your tags, a card per tag, the one used last first, opening its papers in All, with a pencil to describe, rename (onto another tag, the two become one) or delete it; All's Tags and Touched chips; the title search, which matches a tag's name; and the map, whose Areas list lights the starred papers or a tag's, so the reader sees where a project's papers sit and what lies near them, and decides alone what to add.

**The area maps** are squarified treemaps two levels deep: the library's areas with their subtopics inside, and on an area's page its subtopics with theirs. A tap on a tile enters its area, so each level gets the whole width, and the breadcrumb or the tree goes back up.
- **Every tile is named, with its count, or merged.** Labels are measured with the page's font before they are drawn (15 px down to 11 px, wrapping between words, the count after the name or under it), so none is cut. At each level the largest tiles that can be named are kept, and the rest become one hatched "+N more", laid out last.
  - Inside a tile, "+N more" enters that tile's area, whose own map names them.
  - At a map's own level, it opens a card that lists them, each with a bar and a link.
  - An area's header takes what its label needs, up to a third of the tile; a tile too small to name one subtopic shows its own label alone.
- **The labels shape the layout.** Squarify's rows alone gave long words ("interpretability", "experimentation") tiles of the right area and the wrong shape, and one such tile merged everything after it: in landscape beside the chat the map named 7 of the 21 areas, with 721 papers in "+14 more areas". Now a row takes the next tile when that leaves fewer labels that do not fit (a column widens as it takes more), five row-break tolerances are tried, and of the layouts that name the most, the least stretched is kept. Without the labels' say, a map 776 px wide named 13 areas where one 780 px wide named 18.
- **Its size.** The library's map fills the pane under it (at least 340 px, at most as tall as wide), and keeps its size while the keyboard is up for the search box. An area's map is as short as it can be while naming as much as it would at 0.62 of its width: graphs is a band of 140 px, llm about 440 px.
- **Measured** on the library (21 areas, 111 topics), with `shots.py`, which prints the counts (and with `--more` opens the card). The areas named:
  - 18 of 21 in portrait (780 × 483) and in landscape beside the chat (664 × 598); 19 at 1366 × 1024;
  - every area's own map names all its subtopics, llm's with 13 of their 15 children;
  - the smallest label is 11 px;
  - a layout takes about 30 ms.
- **The papers filed in a topic itself**, beside its subtopics, are a tile of their own, "general" in italics, once they are a twentieth of it: llm/architecture holds 19 of its 64 papers directly, and without the tile its subtopics' tiles were a third too large. A smaller share would only push a sibling into a "+N more".
- **What was weighed and left.**
  - A smaller font: 11 px is the floor on the iPad at arm's length, and e-ink wants larger.
  - Pinch to zoom: it competes with the page's own pinch and Safari's (`pinch.js`), and a scaled picture shows its labels only as large as they were drawn. Entering an area is the same zoom, with the labels laid out again.
  - Bands, an icicle chart with a column for each level, was drawn as a draft. Its labels read well, but a band needs 16 px to hold one, so in the same space it named 16 of 21 areas and 10 of 76 subtopics, and it scrolled. It added little to the map.
  - A sunburst puts its labels on arcs, hard to read and to tap; circle packing wastes a third of the space.

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

**The meaning map** (`GET /api/map`, the library's fifth view, Map) lays the papers out by what they are about, from the vectors meaning search keeps. It is Acervo's meaning map (`acervo-llm-dictionary`, `docs/features/meaning-map.md`), whose experiment chose its settings, with a paper for a sense.
- **The look.** An atlas: land where the papers are thick, traced as density contours, in a sea a shade darker. Each dot has its top-level area's hue, so the map shows where the meaning cuts across the folders. Far out it names its ten regions in spaced capitals; nearer, its 36 neighbourhoods in italics and the most central papers' short titles (the name before a colon); close in, every title, whole. A tap on a region's name flies to it.
- **A paper.** A tap peeks at it (its type, area, year, title, authors, summary, Open and the star) and draws lines to its five nearest papers by meaning. The peek lists them under Similar papers, the paper sheet's section, folded on a new device; a tap on one moves the peek and the lines to it, and that paper to the middle of the map the peek leaves uncovered (the peek stays on its side), so the reader can walk from neighbour to neighbour. The peek docks on the side of the map away from the paper (left or right on a map 760 px wide, else top or bottom), and the map keeps a tapped paper out from under it, so the second tap of a double tap, which zooms, reaches the map.
- **Lighting papers.** Words in the search box ring the papers they find and dim the rest, at each depth: titles on the device, the text's 30 papers and meaning's 60 from the laptop; "Show them" fits the map to them. Areas lists the areas with their hues and counts and lights one area's papers, and under "Yours" the starred papers and each tag. The lit papers' titles are shown at any zoom, where there is room.
- **The layout** (`map_layout.py`) is UMAP with the cosine metric, 12 neighbours and `min_dist` 0.1, a small distance that makes related papers clump into land with sea between. A fixed seed does not keep a map in place (UMAP may mirror it), so a new layout starts from the last one (a new paper beside its three nearest papers) and is then fitted onto it, rotation, reflection, scale and shift (Procrustes). The map moves as little as it can when papers are added; nothing is pinned.
- **Regions** are Ward clustering on the 2-D layout rather than on the vectors, so a name sits over its papers, cut twice from one tree so a neighbourhood lies in one region: about 10 and 36 on 2,275 papers, fewer on a smaller library, none under 150 papers.
- **Names** are written by a model, off the path that draws the map: one call through the SDK's Claude Code (no tools, none of the reader's settings, nothing saved, so no chat list shows it), on the library's `filing_model` or Sonnet, names every region without one; it took 9 s for 46. A region holding mostly the papers of a named region of the map before (60% shared) keeps its name, so a paper added renames nothing and asks only about what changed. Until a name lands, or when naming fails, a region shows the folders most of its papers are in.
- **Drawn in a child process** (`python -m carrel.map_layout`): UMAP and numba hold about 250 MB once imported, and the server rests at about 110 MB; the child takes about 15 s on 2,275 papers and gives it all back when it exits. It is drawn when the server starts if the library changed, and when the map is asked for after a change.
- **Answered at once.** The map last drawn is kept in the state folder (`maps/<library>.json`, positions, regions and names, no titles: the page joins them to the library's document). When the library has changed since, the answer is that map saying `drawing`, and the page asks again every 4 s; the papers then glide to their new places and the new ones ring. Only a library never drawn waits (202). An ETag of the fingerprint (every paper and its vector, the encoder, the layout's version) and the names' state spares the page a download (470 KB, 120 KB compressed).
- **Each device remembers where it left the map.** A pinch or a mouse wheel zooms, a drag pans, a double tap zooms in; on a keyboard, + − 0 and the arrows.

**A review opens in a tab of its own** and keeps its place. It is drawn as the agent's answers are, with Obsidian's callouts as boxes. A paper's link opens a peek (its title, year, summary, Open, and Open at p. N for the pages the same paragraph cites); a page link opens the paper there; another review's link opens its tab. The server resolves the links (`/api/review/<scope>`), since a paper's link points at its text and the peek opens its PDF. A question asked beside a review carries `[Reading the review <file>]`.

**Adding and removing** run the engine's own commands, one at a time, and stream their output into a sheet. An arXiv paper is filed by the engine (a model picks its area and writes its summary); a web page or an uploaded PDF goes into the area the reader picks. Remove, in the paper's sheet, deletes its text, PDF and the agent's note once the reader confirms, and with a reason records it as skipped. What happened is read from the library, not from the exit code: `paperlib add` exits 0 for a paper it already has, and `remove` exits 1 when the check afterwards finds a review still linking the paper it did remove.
