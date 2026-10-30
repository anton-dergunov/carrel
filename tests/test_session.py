import asyncio
import json
import os
import re
import time
import uuid

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolPermissionContext,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from carrel import session as session_module
from carrel.session import (
    CACHE_TTL,
    Session,
    Sessions,
    agent_settings,
    history,
    to_wire,
)
from carrel.settings import Settings

PDF = "recsys/Wide & Deep. A Test Paper.pdf"
RESULT = ResultMessage(
    subtype="success",
    duration_ms=10,
    duration_api_ms=8,
    is_error=False,
    num_turns=1,
    session_id="s",
    total_cost_usd=0.01,
)


@pytest.mark.parametrize(
    "message",
    [
        AssistantMessage(
            content=[
                TextBlock("| a |\n|---|\n| 1 |"),
                ThinkingBlock("hm", "sig"),
                ToolUseBlock("t1", "Read", {"file_path": "x.txt"}),
            ],
            model="m",
        ),
        UserMessage(content=[ToolResultBlock("t1", "text", False)]),
        StreamEvent(
            uuid="u",
            session_id="s",
            event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}},
        ),
        SystemMessage(subtype="init", data={"model": "m"}),
        RESULT,
    ],
)
def test_messages_go_out_as_json(message):
    data = to_wire(message)
    assert json.loads(json.dumps(data)) == data


def test_an_unknown_message_is_passed_as_its_repr():
    assert to_wire(object())["repr"].startswith("<object")


def test_settings(library):
    settings = agent_settings(library)
    assert settings["sandbox"]["enabled"]
    assert str(library.root) in settings["sandbox"]["filesystem"]["allowWrite"]
    # An absolute path in a permission rule starts with "//".
    for folder in (library.notes_dir, library.overview_dir):
        assert f"Edit(//{str(folder).lstrip('/')}/**)" in settings["permissions"]["allow"]
        assert str(folder) in settings["sandbox"]["filesystem"]["allowWrite"]


def test_a_session_reaches_the_folders_the_library_names(library, tmp_path):
    talk = Session(library, extra_folders=(tmp_path,))
    assert talk.options().add_dirs == [library.overview_dir, tmp_path]


def test_a_chat_carries_the_readers_note(library):
    assert Session(library).options().system_prompt is None
    talk = Sessions(library, settings=Settings(note=" A reader of papers. ")).get(None)
    assert talk.options().system_prompt == {
        "type": "preset",
        "preset": "claude_code",
        "append": "# The reader\n\nA reader of papers.",
    }


async def test_a_chat_runs_on_the_model_of_the_page_that_started_it(library):
    talk = Session(library, connect=connecting(FakeClient()))
    assert (talk.state()["model"], talk.options().model) == (None, "opus")
    await talk.handle({"type": "ask", "text": "What is it?", "model": "haiku"})
    assert (talk.state()["model"], talk.options().model) == ("haiku", "haiku")
    # Another device asks in the same chat: it keeps the model its process started on.
    talk.busy = False
    await talk.handle({"type": "ask", "text": "And?", "model": "sonnet"})
    assert talk.state()["model"] == "haiku"
    # Once its process ends, the next question chooses again; a name not ours is the default.
    await talk.close()
    assert talk.state()["model"] is None
    await talk.handle({"type": "ask", "text": "Again?", "model": "gpt"})
    assert talk.state()["model"] == "opus"
    await talk.close()


def test_claude_code_keeps_the_chat_under_its_id_and_lists_it(library):
    talk = Session(library)
    options = talk.options()
    assert (options.session_id, options.resume) == (talk.id, None)
    assert options.env["CLAUDE_CODE_ENTRYPOINT"] == "carrel"
    talk.started = True
    assert (talk.options().session_id, talk.options().resume) == (None, talk.id)


class Outbox:
    """A page attached to a chat."""

    def __init__(self):
        self.messages = []
        self.arrived = asyncio.Event()

    async def __call__(self, message):
        self.messages.append(message)
        self.arrived.set()

    async def next(self, kind):
        while True:
            for message in self.messages:
                if message["kind"] == kind:
                    self.messages.remove(message)
                    return message
            self.arrived.clear()
            await asyncio.wait_for(self.arrived.wait(), 2)


async def attached(library, **kwargs) -> tuple[Session, Outbox]:
    outbox = Outbox()
    talk = Session(library, **kwargs)
    await talk.attach(outbox)
    return talk, outbox


def context(tool_use_id="t1"):
    return ToolPermissionContext(tool_use_id=tool_use_id)


@pytest.mark.parametrize("allow", [True, False])
async def test_permission_round_trip(library, state, allow):
    talk, outbox = await attached(library)
    asked = ToolPermissionContext(tool_use_id="t1", title="Claude wants to edit INBOX.txt")
    asking = asyncio.create_task(talk.can_use_tool("Edit", {"file_path": "INBOX.txt"}, asked))
    request = await outbox.next("PermissionRequest")
    assert request["data"]["tool"] == "Edit"
    assert request["data"]["title"] == "Claude wants to edit INBOX.txt"
    assert "description" not in request["data"]
    talk.answer(request["data"]["id"], allow)
    result = await asking
    assert isinstance(result, PermissionResultAllow if allow else PermissionResultDeny)
    assert (await outbox.next("PermissionDecision"))["data"]["allow"] is allow
    logged = json.loads((state / "carrel" / "permissions.jsonl").read_text())
    assert (logged["tool"], logged["what"], logged["allow"]) == ("Edit", "INBOX.txt", allow)


async def test_a_request_waits_for_a_page_that_comes_back(library):
    talk, outbox = await attached(library)
    asking = asyncio.create_task(talk.can_use_tool("Edit", {"file_path": "x"}, context()))
    await outbox.next("PermissionRequest")
    talk.detach(outbox)
    back = Outbox()
    await talk.attach(back)
    request = await back.next("PermissionRequest")
    talk.answer(request["data"]["id"], True)
    assert isinstance(await asking, PermissionResultAllow)


async def test_sandboxed_bash_is_allowed_without_asking(library, state):
    talk, outbox = await attached(library)
    command = {"command": 'cd /lib; f="a b.txt"; grep -c x "$f"'}
    assert isinstance(await talk.can_use_tool("Bash", command, context()), PermissionResultAllow)
    assert [m["kind"] for m in outbox.messages] == ["Chat"]
    assert json.loads((state / "carrel" / "permissions.jsonl").read_text())["by"] == "sandbox"


async def test_bash_outside_the_sandbox_asks(library, monkeypatch):
    monkeypatch.setattr(session_module, "PERMISSION_TIMEOUT", 0.01)
    talk, outbox = await attached(library)
    command = {"command": "curl https://example.com", "dangerouslyDisableSandbox": True}
    result = await talk.can_use_tool("Bash", command, context())
    assert isinstance(result, PermissionResultDeny)
    await outbox.next("PermissionRequest")


async def test_an_unanswered_request_is_denied(library, monkeypatch):
    monkeypatch.setattr(session_module, "PERMISSION_TIMEOUT", 0.01)
    result = await Session(library).can_use_tool("Edit", {"file_path": "x"}, context())
    assert isinstance(result, PermissionResultDeny)


async def test_closing_denies_what_is_waiting(library):
    talk, outbox = await attached(library)
    asking = asyncio.create_task(talk.can_use_tool("Edit", {"file_path": "x"}, context()))
    await outbox.next("PermissionRequest")
    await talk.close()
    assert isinstance(await asking, PermissionResultDeny)


class FakeClient:
    """Claude Code, as far as a session sees it: a prompt in, messages out."""

    def __init__(self):
        self.prompts = []
        self.replies = asyncio.Queue()
        self.connected = True

    async def query(self, prompt):
        self.prompts.append(prompt)
        await self.replies.put(
            StreamEvent(
                uuid="u",
                session_id="s",
                event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": "A"}},
            )
        )
        await self.replies.put(AssistantMessage(content=[TextBlock("An answer.")], model="m"))
        await self.replies.put(RESULT)

    async def receive_messages(self):
        while True:
            yield await self.replies.get()

    async def get_server_info(self):
        return {
            "commands": [
                {"name": "overview", "description": "A pre-read note", "argumentHint": ""},
                {"name": "doctor", "description": "Health-check", "builtin": True},
                {"name": "__hidden", "description": "", "builtin": True},
            ]
        }

    async def disconnect(self):
        self.connected = False


def connecting(client):
    async def connect():
        return client

    return connect


async def test_a_turn(library, state):
    client = FakeClient()
    talk, outbox = await attached(library, connect=connecting(client))
    await talk.handle({"type": "ask", "text": "What is it?", "paper": PDF, "page": 3})
    assert client.prompts == [
        "[Reading library/recsys/Wide & Deep. A Test Paper.txt, page 3]\nWhat is it?"
    ]
    assert (await outbox.next("Question"))["data"] == {
        "text": "What is it?",
        "paper": "Wide & Deep: A Test Paper",
        "pdf": PDF,
        "page": 3,
    }
    assert talk.busy
    await talk.handle({"type": "ask", "text": "And?", "paper": PDF})
    assert (await outbox.next("Error"))["data"]["message"] == "A turn is still running."
    assert (await outbox.next("AssistantMessage"))["data"]["content"] == [{"text": "An answer."}]
    await outbox.next("ResultMessage")
    assert not talk.busy
    assert talk.state()["cache_expires_at"] == pytest.approx(talk.last_turn_end + CACHE_TTL)
    # Carrel keeps the ids of the sessions it started, for `carrel tools`.
    assert talk.id in (state / "carrel" / "sessions.jsonl").read_text()
    await talk.close()


async def test_a_command_reaches_claude_code_first(library, state):
    client = FakeClient()
    talk, outbox = await attached(library, connect=connecting(client))
    await talk.handle({"type": "ask", "text": "/overview", "paper": PDF, "page": 3})
    assert client.prompts == [
        "/overview\n[Reading library/recsys/Wide & Deep. A Test Paper.txt, page 3]"
    ]
    assert (await outbox.next("Question"))["data"]["text"] == "/overview"
    await outbox.next("ResultMessage")
    await talk.close()


async def test_the_commands_claude_code_offers(library):
    client = FakeClient()
    chats = Sessions(library, connect=connecting(client))
    # Before any chat started, a process is started to ask, and closed.
    assert [c["name"] for c in await chats.command_list()] == ["overview", "doctor"]
    assert not client.connected
    # A chat's process says which commands are bound to a terminal.
    client = FakeClient()
    talk = Session(library, connect=connecting(client), commands=chats.commands)
    await talk.ask("Hi")
    await client.replies.put(
        SystemMessage(subtype="init", data={"terminal_slash_commands": ["doctor"]})
    )
    await client.replies.put(RESULT)
    while talk.busy or "terminal" not in chats.commands:
        await asyncio.sleep(0.01)
    assert await chats.command_list() == [
        {"name": "overview", "description": "A pre-read note", "hint": ""}
    ]
    await talk.close()


async def test_a_question_carries_what_the_reader_selected(library, state):
    client = FakeClient()
    talk, outbox = await attached(library, connect=connecting(client))
    selection = {"pdf": PDF, "page": 2, "text": "  Wide and\ndeep,   jointly trained. "}
    await talk.handle(
        {"type": "ask", "text": "Why?", "paper": PDF, "page": 3, "selection": selection}
    )
    assert client.prompts == [
        "[Reading library/recsys/Wide & Deep. A Test Paper.txt, page 3]\n"
        '<selection page="2">\nWide and deep, jointly trained.\n</selection>\nWhy?'
    ]
    question = (await outbox.next("Question"))["data"]
    assert question["selection"] == {
        "text": "Wide and deep, jointly trained.",
        "pdf": PDF,
        "page": 2,
    }
    await outbox.next("ResultMessage")
    # From a paper that is not the one open, it names the paper.
    await talk.handle({"type": "ask", "text": "And?", "selection": selection})
    assert client.prompts[1].startswith(
        '<selection paper="library/recsys/Wide & Deep. A Test Paper.txt" page="2">'
    )
    assert (await outbox.next("Question"))["data"]["selection"][
        "paper"
    ] == "Wide & Deep: A Test Paper"
    await outbox.next("ResultMessage")
    # One that names no paper of the library's is left out.
    await talk.handle({"type": "ask", "text": "So?", "selection": {"pdf": "x.pdf", "text": "y"}})
    assert client.prompts[2] == "So?"
    await talk.close()


async def test_a_page_catches_up_from_the_last_message_it_saw(library):
    talk, outbox = await attached(library, connect=connecting(FakeClient()))
    await talk.ask("What is it?")
    await outbox.next("ResultMessage")
    # The stream drew the answer as it came; the complete message replaces it.
    assert "StreamEvent" not in [m["kind"] for m in talk.log]
    assert [m["kind"] for m in talk.log] == ["Question", "AssistantMessage", "ResultMessage"]
    seen = talk.log[0]["seq"]

    back = Outbox()
    await talk.attach(back, after=seen, epoch=talk.epoch)
    chat = back.messages.pop(0)
    assert (chat["kind"], chat["data"]["replay_from"]) == ("Chat", seen)
    assert [m["kind"] for m in back.messages] == ["AssistantMessage", "ResultMessage"]

    # After the server restarted, the numbers mean nothing: everything again.
    again = Outbox()
    await talk.attach(again, after=seen, epoch="earlier")
    assert again.messages[0]["data"]["replay_from"] == 0
    assert len(again.messages) == 1 + len(talk.log)
    await talk.close()


async def test_every_page_attached_sees_the_chat_and_a_gone_one_is_dropped(library):
    talk, first = await attached(library, connect=connecting(FakeClient()))
    second = Outbox()
    await talk.attach(second)

    async def gone(message):
        raise RuntimeError("the socket closed")

    talk.subscribers.add(gone)
    await talk.ask("What is it?")
    await first.next("ResultMessage")
    await second.next("ResultMessage")
    assert gone not in talk.subscribers
    await talk.close()


async def test_a_chat_closes_when_its_cache_expires_and_resumes_on_the_next_question(library):
    now = [1000.0]
    client = FakeClient()
    chats = Sessions(library, connect=connecting(client), clock=lambda: now[0])
    talk = chats.get(None)
    outbox = Outbox()
    await talk.attach(outbox)
    await talk.ask("What is it?")
    await outbox.next("ResultMessage")
    now[0] += CACHE_TTL - 1
    await chats.reap()
    assert talk.client is client
    now[0] += 2
    await chats.reap()
    assert talk.client is None and not client.connected
    assert talk.options().resume == talk.id
    assert chats.get(talk.id) is talk
    await chats.close()


def test_a_new_chat_keeps_the_id_a_page_remembers(library, claude_home):
    chats = Sessions(library)
    remembered = str(uuid.uuid4())
    assert chats.get(remembered).id == remembered
    assert chats.get("not an id").id != "not an id"
    assert chats.get(None).id != chats.get(None).id


TRANSCRIPT = [
    ("user", "[Reading library/recsys/Wide & Deep. A Test Paper.txt, page 2]\nWhat is it?"),
    (
        "assistant",
        [
            {"type": "thinking", "thinking": "", "signature": "s"},
            {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "x.txt"}},
        ],
    ),
    ("user", [{"type": "tool_result", "tool_use_id": "t1", "content": "text"}]),
    ("assistant", [{"type": "text", "text": "A test paper."}]),
    ("user", [{"type": "text", "text": "And?"}]),
    ("assistant", [{"type": "text", "text": "Nothing more."}]),
]


@pytest.fixture
def claude_home(tmp_path, monkeypatch):
    """Where Claude Code keeps its transcripts, for the tests."""
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude"))
    return tmp_path / "claude"


def write_transcript(claude_home, root, session_id, turns=TRANSCRIPT):
    folder = claude_home / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(root))
    folder.mkdir(parents=True, exist_ok=True)
    lines, parent = [], None
    for i, (role, content) in enumerate(turns):
        line = {
            "type": role,
            "uuid": f"{session_id[:8]}-{i}",
            "parentUuid": parent,
            "sessionId": session_id,
            "cwd": str(root),
            "timestamp": f"2026-10-26T17:49:{i:02}.000Z",
            "message": {"role": role, "content": content},
        }
        lines.append(json.dumps(line))
        parent = line["uuid"]
    path = folder / f"{session_id}.jsonl"
    path.write_text("\n".join(lines) + "\n")
    day_ago = time.time() - 86400
    os.utime(path, (day_ago, day_ago))


def test_a_command_in_a_transcript(library, claude_home):
    session_id = str(uuid.uuid4())
    turns = [
        (
            "user",
            "<command-message>overview</command-message>\n<command-name>/overview</command-name>\n"
            "<command-args>[Reading library/recsys/Wide & Deep. A Test Paper.txt]</command-args>",
        ),
        ("assistant", [{"type": "text", "text": "I've written the overview note."}]),
    ]
    write_transcript(claude_home, library.root, session_id, turns)
    drawn = history(session_id, library.root)
    assert drawn[0] == ["Question", {"text": "/overview", "paper": "Wide & Deep. A Test Paper"}]


def test_a_transcript_as_the_page_draws_it(library, claude_home):
    session_id = str(uuid.uuid4())
    write_transcript(claude_home, library.root, session_id)
    drawn = history(session_id, library.root)
    assert [kind for kind, _ in drawn] == [
        "Question",
        "AssistantMessage",
        "UserMessage",
        "AssistantMessage",
        "Question",
        "AssistantMessage",
    ]
    assert drawn[0][1] == {"text": "What is it?", "paper": "Wide & Deep. A Test Paper", "page": 2}
    assert drawn[4][1] == {"text": "And?"}


async def test_an_earlier_chat_comes_back_from_its_transcript(library, claude_home):
    session_id = str(uuid.uuid4())
    write_transcript(claude_home, library.root, session_id)
    chats = Sessions(library)
    talk = chats.get(session_id)
    assert talk.started and talk.options().resume == session_id
    assert len(talk.log) == len(TRANSCRIPT)
    assert talk.expired()  # its last turn was long ago
    [listed] = chats.listing()
    assert listed["id"] == session_id
    assert listed["first_question"] == "What is it?"
    assert listed["paper"] == "Wide & Deep. A Test Paper"
