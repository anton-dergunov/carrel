# carrel

Read a paper on a tablet with Claude Code beside it. Tap a paper: its PDF opens in a tab with a chat beside it, ready for a question. A citation in the answer moves the PDF to its page, or opens the other paper in its own tab beside the same chat. Put the chat below, above or beside the paper, or on a tab of its own, and drag the split; each device remembers its tabs and its layout. Find words in the paper, or jump through its contents from the page number in its corner.

A chat carries on through reloads and a sleeping tablet. Start a new one, or go back to an earlier one, including the chats you had in VS Code or the terminal in the library. Carrel's chats show up there too. A line under the chat shows how long the chat's prompt cache has left, and your usage limits.

The Claude Code session runs on the laptop, where the library, the engine and the PDFs are; the tablet only shows it. The library is an [agentic-paper-library](https://github.com/anton-dergunov/agentic-paper-library) library, read through the engine's own `paperlib.py`.

Status: part 1 of the [plan](https://github.com/anton-dergunov/agentic-paper-library/blob/main/docs/tasks/tablet-reader.md), a prototype.

## Setting up

It needs [uv](https://docs.astral.sh/uv/), Tailscale on the laptop and the tablet, a checkout of the engine (by default at `~/projects/products/agentic-paper-library`, else `--engine` or `CARREL_ENGINE`), and Claude Code logged in on the laptop: the session runs on your own plan.

```sh
uv sync
./scripts/vendor.sh     # once, and after a version change in it (needs npm)
uv run carrel serve --library ~/papers
tailscale serve --bg --https=8443 http://127.0.0.1:8517     # once
```

Then open `https://<laptop>.<tailnet>.ts.net:8443/` on the tablet, and add it to the Home Screen to have it full screen. Only your own Tailscale login is let in (`--login` adds another). The agent works with Claude Code's own tools, its Bash in Claude Code's sandbox; anything outside what reading needs is put to you as Allow / Deny. `carrel tools` shows what was used and asked.

The folders your library's `paper-library.yaml` names outside it, such as `pdf_root` and `overview_dir`, are open to the agent; `--add-dir FOLDER` opens another for reading.
