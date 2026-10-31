# carrel

Read a paper on a tablet with Claude Code beside it. Tap a paper: its PDF opens in a tab with a chat beside it, ready for a question. A citation in the answer moves the PDF to its page, or opens the other paper in its own tab beside the same chat. Put the chat below, above or beside the paper, or on a tab of its own, and drag the split; each device remembers its tabs and its layout. Find words in the paper, or jump through its contents from the page number in its corner.

The library has its own tab. Desk shows what you were reading and what came in lately; Areas shows the whole library as a map of its topics, each area with its review, its subtopics and its years; All lists every paper with filters for area, type, years and the ones you have worked with; Timeline shows the papers year by year; Map lays them out by what they are about, with its regions named, so related papers sit together whatever folder they are in. Search titles, search the papers' full text and open one at the page that matches, or describe what you are looking for and find the papers nearest it, which the map lights up. Reviews open in tabs of their own, with a preview of each paper they cite, and the chat beside a review is asked about it. Add a paper from arXiv, a web page or a PDF, or remove one, from the tablet.

A chat carries on through reloads and a sleeping tablet. Start a new one, or go back to an earlier one, including the chats you had in VS Code or the terminal in the library. Carrel's chats show up there too. A line under the chat shows how long the chat's prompt cache has left, and your usage limits.

The Claude Code session runs on the laptop, where the library, the engine and the PDFs are; the tablet only shows it. The library is an [agentic-paper-library](https://github.com/anton-dergunov/agentic-paper-library) library, read through the engine's own `paperlib.py`.

Status: part 1 of the [plan](https://github.com/anton-dergunov/agentic-paper-library/blob/main/docs/tasks/tablet-reader.md), a prototype.

## Setting up

It needs [uv](https://docs.astral.sh/uv/), Tailscale on the laptop and the tablet, a checkout of the engine (by default at `~/projects/products/agentic-paper-library`, else `--engine` or `CARREL_ENGINE`), and Claude Code logged in on the laptop: the session runs on your own plan.

```sh
brew install ripgrep    # the library's text search
uv sync
./scripts/vendor.sh     # once, and after a version change in it (needs npm)
uv run carrel serve --library ~/papers
tailscale serve --bg --https=8443 http://127.0.0.1:8517     # once
```

Then open `https://<laptop>.<tailnet>.ts.net:8443/` on the tablet, and add it to the Home Screen to have it full screen. Only your own Tailscale login is let in (`--login` adds another). The agent works with Claude Code's own tools, its Bash in Claude Code's sandbox; anything outside what reading needs is put to you as Allow / Deny. `carrel tools` shows what was used and asked.

To have carrel running from login onwards (macOS), install it as a login agent, with the same options as `serve`:

```sh
uv run carrel agent install --library ~/papers
uv run carrel agent status       # running? which library, which version
uv run carrel agent uninstall
```

Its output goes to `~/Library/Logs/carrel.log`. It keeps running the version it started with: after updating carrel, restart it with `launchctl kickstart -k gui/$(id -u)/com.anton.carrel`. A `carrel serve` typed while it runs says where carrel already is instead of starting a second one.

The folders your library's `paper-library.yaml` names outside it, such as `pdf_root` and `overview_dir`, are open to the agent; `--add-dir FOLDER` opens another for reading.

### On the Mac

Carrel also comes as a Mac app, with the same pages in a window of its own and menus for its keys (⌘F find, ⌘W close the tab, ⌘L ask, ⇧⌘[ and ⇧⌘] move between tabs). It needs Xcode and XcodeGen to build:

```sh
brew install xcodegen
./scripts/mac-app.sh --install    # into ~/Applications
```

It shows the carrel already running, such as the login agent's. When none is running, it starts one itself, with the library and the `carrel` command it finds in the login agent or your shell, or that you name in its Settings, and stops it when you quit. Settings can also put it in the menu bar and open it at login.
