"""The chats: Claude Code sessions in the library, kept on the server, reached through WebSockets.

A chat outlives the socket that started it. Its messages are numbered and kept, so a page
that reloads, opens another paper, or wakes after the tablet slept attaches again and
catches up from the last number it saw. A chat whose prompt cache has expired is closed;
its transcript stays, and the next question resumes it.

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
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    ToolPermissionContext,
    get_session_info,
    get_session_messages,
    list_sessions,
)

from .engine import Library, Paper
from .usage import record_permission, record_session

# How long a permission request waits for the reader before it is denied.
PERMISSION_TIMEOUT = 300

# How long the prompt cache keeps a chat after its last turn. A chat idle this long is
# closed, and a question in it reads the whole chat again at full price.
CACHE_TTL = 3600

# Closed chats kept in memory; older ones are read again from their transcripts.
KEEP_CLOSED = 20

# Claude Code's session lists (VS Code's, `claude --resume`) leave out the SDK's sessions
# ("sdk-py", "sdk-ts", "sdk-cli"); under a name of its own, carrel's chats are listed beside
# the reader's. Not "cli": Claude Code turns that into "sdk-cli" when it runs for a program.
# Like the terminal's, these sessions get the Artifact tools and the claude-code-guide agent.
ENTRYPOINT = "carrel"

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


# The context line; a session list's first prompt has it on one line with the question.
_CONTEXT = re.compile(r"^\[Reading (?P<text>[^\n]+?)(?:, page (?P<page>\d+))?\][\n ]")


def split_question(prompt: str) -> dict:
    """A prompt as the reader asked it: the question, and the paper its context line names."""
    found = _CONTEXT.match(prompt)
    if not found:
        return {"text": prompt}
    question = {"text": prompt[found.end() :], "paper": Path(found["text"]).stem}
    if found["page"]:
        question["page"] = int(found["page"])
    return question


def to_wire(message: Any) -> dict:
    """An SDK message as JSON-ready data. The SDK's messages are dataclasses; anything else
    is passed as its repr, so a new message type is shown plainly rather than dropped."""
    if dataclasses.is_dataclass(message) and not isinstance(message, type):
        data = dataclasses.asdict(message)
    else:
        data = {"repr": repr(message)}
    return json.loads(json.dumps(data, default=str))


def history(session_id: str, directory: Path) -> list[tuple[str, dict]]:
    """A chat's transcript as the kinds the page draws: the reader's questions, the model's
    messages, and the tools' results."""
    drawn = []
    for message in get_session_messages(session_id, directory=str(directory)):
        content = (message.message or {}).get("content")
        if message.type == "assistant":
            drawn.append(("AssistantMessage", {"content": content or []}))
        elif isinstance(content, str):
            drawn.append(("Question", split_question(content)))
        elif any(block.get("type") == "tool_result" for block in content or []):
            drawn.append(("UserMessage", {"content": content}))
        else:
            text = "\n".join(block["text"] for block in content or [] if "text" in block)
            if text:
                drawn.append(("Question", split_question(text)))
    return json.loads(json.dumps(drawn, default=str))


class Session:
    """One chat. Its messages go to every page attached to it, and are kept for the next."""

    def __init__(
        self,
        library: Library,
        session_id: str | None = None,
        connect: Callable | None = None,
        extra_folders: tuple[Path, ...] = (),
        limits: dict | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.library = library
        self.id = session_id or str(uuid.uuid4())
        # Numbers restart when the server does; a page that saw another epoch draws anew.
        self.epoch = uuid.uuid4().hex[:8]
        # Folders the session reaches beside the library: read freely, written on asking.
        self.folders = list(dict.fromkeys([*library.outside_folders(), *extra_folders]))
        self._connect = connect or self._connect_client
        self._clock = clock
        self.limits = limits if limits is not None else {}
        self.seq = 0
        self.log: list[dict] = []
        self.subscribers: set[Send] = set()
        self.client: ClaudeSDKClient | None = None
        self.busy = False
        self.started = False  # Claude Code has a transcript for it: the next start resumes
        self.last_turn_end: float | None = None
        self.last_used = clock()
        self._relay: asyncio.Task | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._sending = asyncio.Lock()  # the relay, permission requests and attaching all send

    @classmethod
    def from_transcript(cls, library: Library, session_id: str, **kwargs) -> "Session | None":
        """A chat Claude Code ran in the library before, carrel's or the reader's own."""
        info = get_session_info(session_id, directory=str(library.root))
        if info is None:
            return None
        talk = cls(library, session_id, **kwargs)
        talk.started = True
        talk.last_turn_end = info.last_modified / 1000
        for kind, data in history(session_id, library.root):
            talk.seq += 1
            talk.log.append({"seq": talk.seq, "kind": kind, "data": data})
        return talk

    def state(self) -> dict:
        expires = self.last_turn_end + CACHE_TTL if self.last_turn_end else None
        return {
            "id": self.id,
            "epoch": self.epoch,
            "busy": self.busy,
            "live": self.client is not None,
            "cache_expires_at": expires,
            "limits": self.limits,
        }

    def expired(self) -> bool:
        return bool(self.last_turn_end) and self._clock() > self.last_turn_end + CACHE_TTL

    async def attach(self, send: Send, after: int = 0, epoch: str | None = None) -> None:
        """Sends a page the chat's state and the messages after the last it saw, then
        everything that follows."""
        if epoch != self.epoch:
            after = 0
        async with self._sending:
            await send({"kind": "Chat", "data": {**self.state(), "replay_from": after}})
            for message in self.log:
                if message["seq"] > after:
                    await send(message)
            self.subscribers.add(send)
        self.last_used = self._clock()

    def detach(self, send: Send) -> None:
        self.subscribers.discard(send)
        self.last_used = self._clock()

    async def emit(self, kind: str, data: dict, keep: bool = True) -> None:
        """Sends a message to every page attached; a kept one is numbered and replayed."""
        async with self._sending:
            message = {"kind": kind, "data": data}
            if keep:
                self.seq += 1
                message = {"seq": self.seq, **message}
                self.log.append(message)
            for send in list(self.subscribers):
                try:
                    await send(message)
                except Exception:  # that page has gone; it catches up when it is back
                    self.subscribers.discard(send)

    async def emit_state(self) -> None:
        await self.emit("Chat", self.state(), keep=False)

    async def handle(self, message: dict) -> None:
        """A message from a page."""
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
        self.last_used = self._clock()
        try:
            found = self._paper(paper)
            page = page if isinstance(page, int) and page > 0 else None
            question = {"text": text}
            if found:
                question |= {
                    "paper": found.title,
                    "pdf": found.pdf,
                    **({"page": page} if page else {}),
                }
            await self.emit("Question", question)
            await self.emit_state()
            if self.client is None:
                self.client = await self._connect()
                self._relay = asyncio.create_task(self._relay_messages())
            if not self.started:
                record_session(self.id)
                self.started = True
            await self.client.query(context_line(found.text if found else None, page) + text)
        except BaseException:
            self.busy = False
            raise

    def _paper(self, pdf: str | None) -> Paper | None:
        """The paper whose PDF is open, when it is one of the library's."""
        if not pdf:
            return None
        try:
            return self.library.paper_for_pdf(pdf)
        except LookupError:
            return None

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
            env={"PAPER_LIBRARY": str(self.library.root), "CLAUDE_CODE_ENTRYPOINT": ENTRYPOINT},
            **({"resume": self.id} if self.started else {"session_id": self.id}),
        )

    async def _relay_messages(self) -> None:
        try:
            async for message in self.client.receive_messages():
                if isinstance(message, RateLimitEvent):
                    # Shown once, as the latest of each limit, not as a row per event.
                    info = message.rate_limit_info
                    self.limits[info.rate_limit_type or "limit"] = to_wire(info)
                    await self.emit("Limits", self.limits, keep=False)
                    continue
                await self.emit(type(message).__name__, to_wire(message))
                if isinstance(message, ResultMessage):
                    self.busy = False
                    self.last_turn_end = self._clock()
                    # The complete messages are in the log; the stream that drew them is not
                    # needed to draw the chat again.
                    async with self._sending:
                        self.log = [m for m in self.log if m["kind"] != StreamEvent.__name__]
                    await self.emit_state()
            ended = "Claude Code stopped."
        except Exception as error:
            ended = f"Claude Code stopped: {error}"
        # It ended under us: say so, do not hang. The next question starts it again.
        self._relay = None
        await self.close()
        await self.emit("Error", {"message": ended})
        await self.emit_state()

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
        """Ends Claude Code's process. The chat stays, and its next question resumes it."""
        for answer in self._pending.values():
            if not answer.done():
                answer.set_result(False)
        if self._relay:
            self._relay.cancel()
            self._relay = None
        client, self.client = self.client, None
        self.busy = False
        if client:
            try:
                await client.disconnect()
            except Exception:
                pass


class Sessions:
    """The chats this server keeps, by id."""

    def __init__(
        self,
        library: Library,
        extra_folders: tuple[Path, ...] = (),
        connect: Callable | None = None,
        clock: Callable[[], float] = time.time,
    ):
        self.library = library
        self.chats: dict[str, Session] = {}
        self.limits: dict = {}  # the latest usage limits, shared by every chat
        self._made = dict(extra_folders=extra_folders, connect=connect, clock=clock)
        self._clock = clock

    def get(self, session_id: str | None) -> Session:
        """The chat with this id: kept here, else read from its transcript, else a new one
        (under this id, when it is a valid one)."""
        if session_id in self.chats:
            return self.chats[session_id]
        made = dict(self._made, limits=self.limits)
        talk = None
        if session_id and _is_uuid(session_id):
            talk = Session.from_transcript(self.library, session_id, **made)
        talk = talk or Session(self.library, session_id if _is_uuid(session_id) else None, **made)
        self.chats[talk.id] = talk
        self._forget_closed()
        return talk

    def listing(self, limit: int = 50) -> list[dict]:
        """The chats Claude Code ran in the library, newest first, with this server's state."""
        chats = []
        for info in list_sessions(directory=str(self.library.root), limit=limit):
            first = split_question(info.first_prompt or "")
            live = self.chats.get(info.session_id)
            chats.append(
                {
                    "id": info.session_id,
                    "title": info.custom_title or first["text"][:120] or info.summary,
                    "first_question": first["text"][:300],
                    "paper": first.get("paper"),
                    "last_modified": info.last_modified / 1000,
                    "live": bool(live and live.client),
                    "busy": bool(live and live.busy),
                }
            )
        return chats

    async def reap(self) -> None:
        """Closes the chats whose prompt cache has expired."""
        for talk in list(self.chats.values()):
            if talk.client and not talk.busy and talk.expired():
                await talk.close()
                await talk.emit_state()

    async def reap_forever(self, every: float = 60) -> None:
        while True:
            await asyncio.sleep(every)
            await self.reap()

    def _forget_closed(self) -> None:
        closed = [talk for talk in self.chats.values() if not talk.client and not talk.subscribers]
        closed.sort(key=lambda talk: talk.last_used)
        for talk in closed[: max(0, len(closed) - KEEP_CLOSED)]:
            del self.chats[talk.id]

    async def close(self) -> None:
        for talk in list(self.chats.values()):
            await talk.close()


def _is_uuid(value: str | None) -> bool:
    try:
        return bool(value) and str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False
