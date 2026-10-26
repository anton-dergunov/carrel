"""One conversation: a Claude Code session in the library, reached through one WebSocket.

Claude Code runs through the Agent SDK with its default tools, as in the terminal and VS
Code. What it may do without asking is set by two things, both passed as one settings layer:

- Permission rules: reading in the library and the PDFs (Claude Code's default for the
  session's folders), web search and fetch, `paperlib`, and writing notes.
- The sandbox around Bash: a command runs without asking when it stays inside the sandbox,
  which writes only in the library, the PDFs and the engine's cache, and reaches only the
  listed domains.

Anything else is put to the reader on the tablet as Allow / Deny.
"""

import asyncio
import dataclasses
import json
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    ToolPermissionContext,
)

from .engine import Library
from .usage import record_permission

# How long a permission request waits for the reader before it is denied.
PERMISSION_TIMEOUT = 300

# What `paperlib add` and `paperlib info` reach: arXiv's listing, API and PDFs. Others are
# added as the sandbox reports them.
ALLOWED_DOMAINS = ["arxiv.org", "export.arxiv.org", "*.arxiv.org"]

# Never read, whatever a session's folders are.
SECRETS = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config", "~/.netrc", "~/.claude.json"]

Send = Callable[[dict], Awaitable[None]]


def note_folders(library: Library) -> list[Path]:
    """Where a session writes without asking: the library's notes, and the reader's own
    overview notes when the library keeps them elsewhere."""
    return [folder for folder in (library.notes_dir, library.overview_dir) if folder]


def agent_settings(library: Library) -> dict:
    """The settings layer a session runs with, on top of the library's own."""
    writable = [library.root, library.pdf_root, library.cache_dir, *note_folders(library)]
    return {
        "permissions": {
            "allow": [
                "WebSearch",
                "WebFetch",
                "Bash(paperlib *)",
                # An absolute path in a rule starts with "//".
                *(f"Edit(/{folder}/**)" for folder in note_folders(library)),
            ],
            "deny": [f"Read({path}/**)" for path in SECRETS],
        },
        "sandbox": {
            "enabled": True,
            "autoAllowBashIfSandboxed": True,
            "allowUnsandboxedCommands": True,
            "filesystem": {
                "allowWrite": list(dict.fromkeys(str(folder) for folder in writable)),
                "denyRead": SECRETS,
            },
            "network": {"allowedDomains": ALLOWED_DOMAINS},
        },
    }


def context_line(paper_text: str | None, page: int | None) -> str:
    """What the reader has open, in front of each question, so the agent does not search
    for the paper."""
    if not paper_text:
        return ""
    where = f", page {page}" if page else ""
    return f"[Reading {paper_text}{where}]\n"


def to_wire(message: Any) -> dict:
    """An SDK message as JSON-ready data. The SDK's messages are dataclasses; anything else
    is passed as its repr, so a new message type is shown plainly rather than dropped."""
    if dataclasses.is_dataclass(message) and not isinstance(message, type):
        data = dataclasses.asdict(message)
    else:
        data = {"repr": repr(message)}
    return json.loads(json.dumps(data, default=str))


class Session:
    def __init__(
        self,
        library: Library,
        send: Send,
        connect: Callable | None = None,
        extra_folders: tuple[Path, ...] = (),
    ):
        self.library = library
        # Folders the session reaches beside the library: read freely, written on asking.
        self.folders = list(dict.fromkeys([*library.outside_folders(), *extra_folders]))
        self._send = send
        self._connect = connect or self._connect_client
        self.seq = 0
        self.client: ClaudeSDKClient | None = None
        self.busy = False
        self._relay: asyncio.Task | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._sending = asyncio.Lock()  # the relay and permission requests both send

    async def emit(self, kind: str, data: dict) -> None:
        async with self._sending:
            self.seq += 1
            await self._send({"seq": self.seq, "kind": kind, "data": data})

    async def handle(self, message: dict) -> None:
        """A message from the browser."""
        match message.get("type"):
            case "ask":
                await self.ask(
                    str(message.get("text") or ""), message.get("paper"), message.get("page")
                )
            case "permission":
                self.answer(str(message.get("id")), bool(message.get("allow")))
            case "stop":
                if self.client and self.busy:
                    await self.client.interrupt()
            case other:
                await self.emit("Error", {"message": f"unknown message type {other!r}"})

    async def ask(self, text: str, paper: str | None = None, page: int | None = None) -> None:
        if not text.strip():
            return
        if self.busy:
            await self.emit("Error", {"message": "A turn is still running."})
            return
        self.busy = True
        try:
            if self.client is None:
                self.client = await self._connect()
                self._relay = asyncio.create_task(self._relay_messages())
            page = page if isinstance(page, int) and page > 0 else None
            await self.client.query(context_line(self._paper_text(paper), page) + text)
        except BaseException:
            self.busy = False
            raise

    def _paper_text(self, pdf: str | None) -> str | None:
        """The paper file the agent reads for the PDF that is open."""
        if not pdf:
            return None
        try:
            found = self.library.paper_for_pdf(pdf)
        except LookupError:
            return None
        return found.text if found else None

    async def _connect_client(self) -> ClaudeSDKClient:
        client = ClaudeSDKClient(self.options())
        await client.connect()
        return client

    def options(self) -> ClaudeAgentOptions:
        return ClaudeAgentOptions(
            cwd=self.library.root,
            add_dirs=self.folders,
            settings=json.dumps(agent_settings(self.library)),
            can_use_tool=self.can_use_tool,
            include_partial_messages=True,
            enable_file_checkpointing=True,
            env={"PAPER_LIBRARY": str(self.library.root)},
        )

    async def _relay_messages(self) -> None:
        try:
            async for message in self.client.receive_messages():
                if isinstance(message, ResultMessage):
                    self.busy = False
                await self.emit(type(message).__name__, to_wire(message))
        except Exception as error:  # the session ended under us: say so, do not hang
            self.busy = False
            await self.emit("Error", {"message": f"The session ended: {error}"})

    async def can_use_tool(
        self, tool: str, tool_input: dict[str, Any], context: ToolPermissionContext
    ) -> PermissionResultAllow | PermissionResultDeny:
        """Puts a tool use the rules leave open to the reader."""
        if tool == "Bash" and not tool_input.get("dangerouslyDisableSandbox"):
            # The sandbox bounds what a command can write and reach, whatever its shape. Claude
            # Code still asks about commands it cannot check from their text ("Quoted text in
            # this command can't be checked before it runs"), which are the agent's everyday
            # `cd …; f="…"; grep … "$f"` while reading.
            record_permission(tool, tool_input, True, by="sandbox")
            return PermissionResultAllow()
        request = context.tool_use_id or uuid.uuid4().hex
        answer = asyncio.get_running_loop().create_future()
        self._pending[request] = answer
        # Claude Code's own wording and reason, when it gives them, say why it asks.
        why = {
            key: getattr(context, key, None)
            for key in ("title", "description", "decision_reason", "blocked_path")
        }
        await self.emit(
            "PermissionRequest",
            {
                "id": request,
                "tool": tool,
                "input": tool_input,
                **{k: v for k, v in why.items() if v},
            },
        )
        try:
            allow = await asyncio.wait_for(answer, PERMISSION_TIMEOUT)
        except TimeoutError:
            allow = False
        finally:
            self._pending.pop(request, None)
        record_permission(tool, tool_input, allow)
        await self.emit("PermissionDecision", {"id": request, "allow": allow})
        if allow:
            return PermissionResultAllow()
        return PermissionResultDeny(message="The reader did not allow this.")

    def answer(self, request: str, allow: bool) -> None:
        answer = self._pending.get(request)
        if answer and not answer.done():
            answer.set_result(allow)

    async def close(self) -> None:
        for answer in self._pending.values():
            if not answer.done():
                answer.set_result(False)
        if self._relay:
            self._relay.cancel()
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
