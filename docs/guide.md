# Using carrel

Everything carrel does, and how to set it up. The [README](../README.md) shows it in pictures; [architecture.md](architecture.md) says how it is built.

- [Install](#install)
- [Reading on a tablet](#reading-on-a-tablet)
- [Always on](#always-on)
- [The Mac app](#the-mac-app)
- [Reading a paper](#reading-a-paper)
- [Asking](#asking)
- [Highlights](#highlights)
- [The paper's sheet and its overview](#the-papers-sheet-and-its-overview)
- [Your library](#your-library)
- [Search](#search)
- [Reviews](#reviews)
- [Chats](#chats)
- [How it looks](#how-it-looks)
- [Who can reach it, and what the agent may do](#who-can-reach-it-and-what-the-agent-may-do)

## Install

Carrel runs on the laptop that holds your library, and shows it to your other devices. It needs, on that laptop:

- [uv](https://docs.astral.sh/uv/), and [ripgrep](https://github.com/BurntSushi/ripgrep) for the text search (`brew install ripgrep`);
- Claude Code, logged in: the chats run on your own plan;
- a library made with [agentic-paper-library](https://github.com/anton-dergunov/agentic-paper-library), and a checkout of that engine. Carrel looks for it at `~/projects/products/agentic-paper-library`; give another place with `--engine` or `CARREL_ENGINE`;
- npm, once, to fetch the browser libraries.

```sh
git clone https://github.com/anton-dergunov/carrel && cd carrel
uv sync
./scripts/vendor.sh        # once, and again after a version change in it
uv run carrel serve --library ~/papers
```

Carrel now answers at `http://127.0.0.1:8517/` on the laptop. Open it there to try it; the next section brings it to the tablet.

**The library.** `--library` names the library folder (by default `$PAPER_LIBRARY`, or the folder you are in). The folders its `paper-library.yaml` names outside it, such as `pdf_root` and `overview_dir`, are carrel's too.

## Reading on a tablet

Carrel listens on the laptop only. [Tailscale](https://tailscale.com/) brings it to your tablet, at home or away, over your own tailnet. With Tailscale on the laptop and the tablet, publish carrel to the tailnet once:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8517
```

Then open `https://your-laptop.your-tailnet.ts.net:8443/` on the tablet. On an iPad, Share → Add to Home Screen makes it a full-screen app with its own icon.

Only your own Tailscale login is let in. To let in another login of your tailnet, add `--login them@example.com` to `carrel serve` (it can be given more than once).

## Always on

To have carrel running from login onwards (macOS), install it as a login agent, with the same options as `serve`:

```sh
uv run carrel agent install --library ~/papers
uv run carrel agent status       # running? which library, which version
uv run carrel agent uninstall
```

Its output goes to `~/Library/Logs/carrel.log`. It keeps running the version it started with: after updating carrel, restart it:

```sh
launchctl kickstart -k gui/$(id -u)/com.anton.carrel
```

A `carrel serve` typed while it runs says where carrel already is, instead of starting a second one.

## The Mac app

The Mac app shows carrel's pages in a window of its own. It draws them with Chromium, where a paper flicked through as fast as a mouse wheel spins stays painted, as it does not in Safari. Building it needs Node and npm:

```sh
./scripts/mac-app.sh --install    # into ~/Applications
```

**Which carrel it shows.** It shows the carrel already running, such as the login agent's. When none is running, it starts one itself and stops it when you quit. It runs the library and the `carrel` command it finds in the login agent or your shell, or the ones you name in its Settings.

**Menus and keys.**
- ⌘F find in the paper.
- ⌘= and ⌘− zoom the paper or the map.
- ⌘L ask; ⇧⌘L shows or hides the chat.
- ⌘W closes the tab; ⇧⌘[ and ⇧⌘] move between tabs; ⌘1 goes to the library.
- ⌘N adds a paper.

**In the menu bar.** Settings can put carrel in the menu bar, with the tablet's address to copy and the server to start or stop, and open it at login.

## Reading a paper

Tap a paper and it opens in a tab, with a chat beside it. The library has its tab at the left, and each paper and review you open gets one of its own. A tab comes back at the page it was on, and the tabs come back after a reload. Each device remembers its own tabs.

**The page badge.** The page number in the corner opens the paper's sheet: go to a page, or jump through the contents (see [below](#the-papers-sheet-and-its-overview)).

**Find.** The magnifier, or ⌘F, finds words in the paper, a match at a time.

**Zoom.** Pinch to zoom. On an iPad, while the page is wider than the screen, a finger's pan keeps to the direction it mostly runs along.

**Where the chat sits.** Below, above, left or right of the paper, over the bottom of the page, or on a tab of its own; or hidden. Drag the split to resize it; a double tap puts it back to its default size. Each device keeps its own choice, set in Settings.

## Asking

Each question carries what you have open: the paper and the page you are on, or the review. The agent starts from that paper instead of searching for it.

**Citations.** Answers cite the page, and often the table, figure or equation: "p. 7, Table 2". Tap a citation and the paper turns there and marks the spot, or the cited paper opens in a tab of its own, beside the same chat. A page written in plain text, "p. 7", is a link too.

**A passage.** Select text, or tap a highlight and then Ask, and the passage goes with your next question, with its page.

**Commands.** Type `/` for the library's skills and Claude Code's commands: `/overview`, `/add-paper`, `/literature-review`, `/paper-info` and the rest.

**Answers** draw maths, code with its colours and a copy button, tables, and diagrams. The work behind an answer is folded into one line above it; tap it to see each step.

## Highlights

Turn on the pen in the bar, select a passage, and it is highlighted. Tap a highlight to change its colour (six of them), remove it, or ask about it.

Highlights are written into the PDF itself, the standard way, and saved at once: there is nothing to save, and every PDF app sees them. Highlights made elsewhere, in Preview or on another device, show in carrel too.

## The paper's sheet and its overview

The page badge opens the paper's sheet. Its sections fold:

- **The paper**: title, authors, year and arXiv id; your star, and your tags.
- **About**: its summary, type, topic and when it was added.
- **The agent's reading** and **Digest**: the notes the library's agent keeps on the paper.
- **Similar papers**: the nearest papers by meaning, from anywhere in the library.
- **Contents**: the paper's headings, with your highlights among them, each a tap away.
- **Overview**, and **Remove from the library…**.

The sheet can be opened out over the whole pane.

**Star and tags** are yours alone: no agent writes them. Starred papers wait on Desk, and both can filter All.

**The overview** is a short note to read before the paper: the setting, the key idea and why it works, the evidence, and questions to ask of it. The notebook button under the chat shows the note when the paper has one, with no model call. When it has none, it offers to write one with the library's `/overview`, in the chat about the paper. The note is kept in your notes folder; Delete moves it to the Trash.

## Your library

The library's tab has five views:

- **Desk**: the papers you were reading and asking about, the ones you starred to read, your tags, recently added papers, and the reviews.
- **Areas**: the topic tree, and each area as a map of its subtopics sized by their papers, with its review and a histogram of its years.
- **All**: every paper, with chips to filter by area, type, years, your tags, and what you have touched (starred, highlighted, with an overview, cited in a review, asked about). Rows can be compact or rich, sorted by topic, year or when added.
- **Timeline**: the papers by the year they were published, or by when you added them.
- **Map**: every paper placed by what it is about, with its regions named. Tap a paper for a peek and its nearest neighbours; a search lights up the papers it finds.

**Adding and removing.** The + in the library's bar adds a paper: an arXiv id or address, a web page's address, or a PDF from the tablet. The library's own command files it and writes its summary, and its output streams in as it works. Remove a paper from its sheet.

## Search

The search box at the top of the library has three depths:

- **Titles** filters titles, authors and summaries as you type, on the device.
- **Text** searches the full text of every paper on the laptop. Each match is shown in its sentence with its page; tap one and the paper opens there, with the words found.
- **Meaning** finds the papers nearest a description, in your own words. In Map it lights them up.

Meaning search embeds each paper's title, summary and abstract with the encoder the library's [experiment](https://github.com/anton-dergunov/agentic-paper-library/tree/main/experiments/meaning-search) chose. The model loads for a question and is freed after ten idle minutes.

## Reviews

When an area has a literature review, it shows on Desk and on the area's page. A review opens in a tab of its own. Tap a paper it cites for a peek with its summary, then open it, or open it at the page the review cites. The chat beside a review is asked about the review.

## Chats

A chat is a Claude Code session on the laptop, in the library. The tablet only shows it, so leaving the page, a reload or a sleeping tablet never ends it.

- **New chat**, and **earlier chats**, from the buttons under the chat. The list holds every chat in the library: carrel's, and the ones you had in VS Code or the terminal. Carrel's chats show up there too.
- **The line under the chat** shows the model, how long the chat's prompt cache has left, and your usage limits.
- **The model** is chosen per device, in Settings or by tapping its name. A new chat starts on it.
- **About me**, in Settings, is a note added to each new chat's instructions: who you are, what you know, how you like answers. It is kept on the laptop and shared by every device.

Settings reach a chat when it starts, never a running one: changing the model or the note mid-chat would throw away its prompt cache.

## How it looks

Each device keeps its own look, in Settings (the gear):

- **Colours**: Carrel's own, light, dark or following the system; black and white; or e-ink, in black only or in colour. **Dark pages** draws the paper light on dark too.
- **Text size**: for the library, the chat and everything else, each on its own.
- **Pages**: **Adjust pages** for a small or e-ink screen: letters drawn as outlines, bolder letters, sharper edges, darker greys, more contrast, and scanned pages in black and white, each at its own strength.

**On e-ink.** Carrel picks the e-ink look by itself on an e-ink tablet. Nothing moves: pages turn instead of scrolling, with buttons for the paper and the chat, and an answer appears in a few large steps rather than streaming.

## Who can reach it, and what the agent may do

**Who can reach it.** Carrel listens on the laptop only. A request must come either from the laptop itself, or through `tailscale serve` with the Tailscale login of an allowed reader: yours, and those `--login` adds.

**What the agent may do.** The agent is Claude Code with its own tools, in the library. Without asking, it may:
- read the library and search the web;
- run the library's own command, `paperlib`;
- write in the notes and the overview folders;
- run commands in Claude Code's sandbox, which writes only in the library, the PDFs, the cache and the note folders, and reaches only the sites reading needs.

Anything else, such as leaving the sandbox or reaching another site, is put to you as Allow or Deny. `--add-dir FOLDER` opens another folder for reading; writing there asks.

**What was used.** `carrel tools` lists the tools carrel's chats used, what you were asked, and the papers asked about:

```sh
uv run carrel tools --library ~/papers
```
