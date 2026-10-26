import asyncio
import json

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
from carrel.session import Session, agent_settings, context_line, to_wire

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


def test_context_line():
    assert context_line("library/a.txt", 7) == "[Reading library/a.txt, page 7]\n"
    assert context_line("library/a.txt", None) == "[Reading library/a.txt]\n"
    assert context_line(None, 7) == ""


def test_settings(library):
    settings = agent_settings(library)
    assert settings["sandbox"]["enabled"]
    assert str(library.root) in settings["sandbox"]["filesystem"]["allowWrite"]
    # An absolute path in a permission rule starts with "//".
    for folder in (library.notes_dir, library.overview_dir):
        assert f"Edit(//{str(folder).lstrip('/')}/**)" in settings["permissions"]["allow"]
        assert str(folder) in settings["sandbox"]["filesystem"]["allowWrite"]


def test_a_session_reaches_the_folders_the_library_names(library, tmp_path):
    talk = Session(library, Outbox(), extra_folders=(tmp_path,))
    assert talk.options().add_dirs == [library.overview_dir, tmp_path]


class Outbox:
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


def context(tool_use_id="t1"):
    return ToolPermissionContext(tool_use_id=tool_use_id)


@pytest.mark.parametrize("allow", [True, False])
async def test_permission_round_trip(library, state, allow):
    outbox = Outbox()
    talk = Session(library, outbox)
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


async def test_sandboxed_bash_is_allowed_without_asking(library, state):
    outbox = Outbox()
    talk = Session(library, outbox)
    command = {"command": 'cd /lib; f="a b.txt"; grep -c x "$f"'}
    assert isinstance(await talk.can_use_tool("Bash", command, context()), PermissionResultAllow)
    assert outbox.messages == []
    assert json.loads((state / "carrel" / "permissions.jsonl").read_text())["by"] == "sandbox"


async def test_bash_outside_the_sandbox_asks(library, monkeypatch):
    monkeypatch.setattr(session_module, "PERMISSION_TIMEOUT", 0.01)
    outbox = Outbox()
    command = {"command": "curl https://example.com", "dangerouslyDisableSandbox": True}
    result = await Session(library, outbox).can_use_tool("Bash", command, context())
    assert isinstance(result, PermissionResultDeny)
    assert outbox.messages[0]["kind"] == "PermissionRequest"


async def test_an_unanswered_request_is_denied(library, monkeypatch):
    monkeypatch.setattr(session_module, "PERMISSION_TIMEOUT", 0.01)
    result = await Session(library, Outbox()).can_use_tool("Edit", {"file_path": "x"}, context())
    assert isinstance(result, PermissionResultDeny)


async def test_closing_denies_what_is_waiting(library):
    outbox = Outbox()
    talk = Session(library, outbox)
    asking = asyncio.create_task(talk.can_use_tool("Edit", {"file_path": "x"}, context()))
    await outbox.next("PermissionRequest")
    await talk.close()
    assert isinstance(await asking, PermissionResultDeny)


class FakeClient:
    """Claude Code, as far as a session sees it: a prompt in, messages out."""

    def __init__(self):
        self.prompts = []
        self.replies = asyncio.Queue()

    async def query(self, prompt):
        self.prompts.append(prompt)
        await self.replies.put(AssistantMessage(content=[TextBlock("An answer.")], model="m"))
        await self.replies.put(RESULT)

    async def receive_messages(self):
        while True:
            yield await self.replies.get()

    async def disconnect(self):
        pass


async def test_a_turn(library):
    outbox, client = Outbox(), FakeClient()

    async def connect():
        return client

    talk = Session(library, outbox, connect=connect)
    await talk.handle({"type": "ask", "text": "What is it?", "paper": PDF, "page": 3})
    assert client.prompts == [
        "[Reading library/recsys/Wide & Deep. A Test Paper.txt, page 3]\nWhat is it?"
    ]
    assert talk.busy
    await talk.handle({"type": "ask", "text": "And?", "paper": PDF})
    assert (await outbox.next("Error"))["data"]["message"] == "A turn is still running."
    assert (await outbox.next("AssistantMessage"))["data"]["content"] == [{"text": "An answer."}]
    await outbox.next("ResultMessage")
    assert not talk.busy
    await talk.close()


async def test_a_paper_outside_the_library_gets_no_context_line(library):
    client = FakeClient()

    async def connect():
        return client

    talk = Session(library, Outbox(), connect=connect)
    await talk.ask("Hi", "../escape.pdf", 1)
    assert client.prompts == ["Hi"]
    await talk.close()
