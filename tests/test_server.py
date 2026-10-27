from urllib.parse import quote

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from carrel.server import make_app
from carrel.session import Sessions

TAILNET = "laptop.example.ts.net"
READER = "reader@example.com"
PDF = quote("recsys/Wide & Deep. A Test Paper.pdf")


@pytest.fixture
def client(library):
    return TestClient(
        make_app(library, hosts={TAILNET}, logins={READER}), base_url="http://127.0.0.1:8517"
    )


def test_index_lists_papers(client):
    response = client.get("/")
    assert response.status_code == 200
    assert f'href="/read/{PDF}"' in response.text
    assert "Wide &amp; Deep: A Test Paper" in response.text
    assert 'data-pdf=""' in response.text
    assert "script-src 'self'" in response.headers["content-security-policy"]


def test_read_page_is_the_same_page_with_the_paper_showing(client):
    response = client.get(f"/read/{PDF}")
    assert response.status_code == 200
    assert 'data-pdf="recsys/Wide &amp; Deep. A Test Paper.pdf"' in response.text
    assert 'data-pdf-title="Wide &amp; Deep: A Test Paper"' in response.text
    assert f'href="/read/{PDF}"' in response.text  # the list, on its tab
    assert client.get("/read/recsys/missing.pdf").status_code == 404


def test_pdf_in_ranges(client):
    response = client.get(f"/pdf/{PDF}", headers={"Range": "bytes=0-8"})
    assert response.status_code == 206
    assert response.content == b"%PDF-1.4\n"
    assert client.get("/pdf/..%2Fpaper-library.yaml").status_code == 404


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ({"Host": "evil.example"}, 403),  # DNS rebinding
        (
            {"Host": f"{TAILNET}:8443"},
            403,
        ),  # through tailscale serve, but no login: a tagged device
        ({"Host": f"{TAILNET}:8443", "Tailscale-User-Login": "someone@else.com"}, 403),
        ({"Host": f"{TAILNET}:8443", "Tailscale-User-Login": READER}, 200),
        ({"Host": "localhost:8517"}, 200),  # on the laptop itself
    ],
)
def test_who_is_admitted(client, headers, status):
    assert client.get("/", headers=headers).status_code == status


def test_websocket_needs_its_own_origin(client):
    host = {"Host": "127.0.0.1:8517"}
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws", headers={**host, "Origin": "https://evil.example"}
        ) as socket:
            socket.receive_text()
    with client.websocket_connect(
        "/ws", headers={**host, "Origin": "http://127.0.0.1:8517"}
    ) as socket:
        assert socket.receive_json()["kind"] == "Chat"
        socket.send_json({"type": "nonsense"})
        message = socket.receive_json()
    assert (message["seq"], message["kind"]) == (1, "Error")


OWN = {"Host": "127.0.0.1:8517", "Origin": "http://127.0.0.1:8517"}


def test_a_chat_outlives_its_page(library, monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude"))
    sessions = Sessions(library)
    client = TestClient(make_app(library, sessions=sessions), base_url="http://127.0.0.1:8517")
    with client.websocket_connect("/ws?chat=new", headers=OWN) as socket:
        chat = socket.receive_json()["data"]
        socket.send_json({"type": "nonsense"})
        socket.receive_json()
    talk = sessions.chats[chat["id"]]
    assert not talk.subscribers  # the page left; the chat stays
    # The page comes back with the last message it saw, and gets only what follows.
    url = f"/ws?chat={chat['id']}&after=0&epoch={chat['epoch']}"
    with client.websocket_connect(url, headers=OWN) as socket:
        again = socket.receive_json()
        assert (again["data"]["id"], again["data"]["replay_from"]) == (chat["id"], 0)
        assert socket.receive_json()["kind"] == "Error"


def test_a_paper_to_open_beside_the_chat_and_what_the_library_knows_of_it(client):
    paper = client.get(f"/api/paper/{PDF}").json()
    info = paper.pop("info")
    assert paper == {
        "pdf": "recsys/Wide & Deep. A Test Paper.pdf",
        "title": "Wide & Deep: A Test Paper",
        "pdf_url": f"/pdf/{PDF}",
    }
    assert ["summary", "A paper for the tests."] in info["fields"]
    assert info["overview"] is False
    assert client.get("/api/paper/recsys/missing.pdf").status_code == 404


def test_no_chats_yet(client, monkeypatch, tmp_path):
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "claude"))
    assert client.get("/api/chats").json() == []


def test_the_note_is_shared_by_every_page(client):
    settings = client.get("/api/settings").json()
    assert (settings["note"], settings["default_model"]) == ("", "opus")
    assert [model["id"] for model in settings["models"]] == ["opus", "sonnet", "haiku"]
    saved = client.put("/api/settings", json={"note": "Brief."}, headers=OWN)
    assert saved.json()["note"] == "Brief."
    assert client.get("/api/settings").json()["note"] == "Brief."
    client.put("/api/settings", json={"note": ""}, headers=OWN)


@pytest.mark.parametrize(
    "body, headers, status",
    [
        ('{"note": 3}', OWN, 400),
        ("not json", OWN, 400),
        ('{"note": "x"}', {"Host": "127.0.0.1:8517"}, 403),
        ('{"note": "x"}', {**OWN, "Origin": "https://evil.example"}, 403),
    ],
)
def test_settings_not_saved(client, body, headers, status):
    assert client.put("/api/settings", content=body, headers=headers).status_code == status
    assert client.get("/api/settings").json()["note"] == ""


@pytest.fixture
def pdf_file(library):
    """The test paper's PDF, put back as it was after a test that saves it."""
    path = library.resolve_pdf("recsys/Wide & Deep. A Test Paper.pdf")
    original = path.read_bytes()
    yield path
    path.write_bytes(original)


def save(client, body, version, base, headers=OWN):
    return client.put(
        f"/pdf/{PDF}",
        content=body,
        headers={**headers, "If-Match": version, "X-Carrel-Base-Length": str(base)},
    )


def test_highlights_are_saved_into_the_pdf(client, pdf_file):
    loaded = client.get(f"/pdf/{PDF}")
    first = loaded.content + b"1 0 obj <</Subtype /Highlight>> endobj\n%%EOF\n"
    response = save(client, first, loaded.headers["etag"], len(loaded.content))
    assert response.status_code == 204
    assert pdf_file.read_bytes() == first
    assert not list(pdf_file.parent.glob(".*.tmp"))
    # The next save is the paper as loaded with the update made since, not the last save.
    second = loaded.content + b"1 0 obj <</Subtype /Highlight /C [1 0 0]>> endobj\n%%EOF\n"
    response = save(client, second, response.headers["etag"], len(loaded.content))
    assert response.status_code == 204
    assert pdf_file.read_bytes() == second
    assert client.get(f"/pdf/{PDF}").headers["etag"] == response.headers["etag"]


def test_a_pdf_changed_elsewhere_is_not_overwritten(client, pdf_file):
    loaded = client.get(f"/pdf/{PDF}")
    update = loaded.content + b"%%EOF\n"
    # Another device's save, or a sync, since this page loaded the paper.
    elsewhere = loaded.content + b"% another device\n"
    pdf_file.write_bytes(elsewhere)
    assert save(client, update, loaded.headers["etag"], len(loaded.content)).status_code == 409
    # The right version, but not the paper the page loaded.
    version = client.get(f"/pdf/{PDF}").headers["etag"]
    other = b"%PDF-1.7\n" + b"1" * len(loaded.content)
    assert save(client, other, version, len(loaded.content)).status_code == 409
    assert pdf_file.read_bytes() == elsewhere


@pytest.mark.parametrize(
    ("body", "base", "headers", "status"),
    [
        (b"%PDF-1.4 and more", 5, {"Host": "127.0.0.1:8517"}, 403),  # no Origin
        (b"%PDF-1.4 and more", 5, {**OWN, "Origin": "https://evil.example"}, 403),
        (b"<html>not a pdf</html>", 5, OWN, 400),
        (b"%PDF-1.4 and more", 0, OWN, 400),
        (b"%PDF-1.4 and more", 99, OWN, 400),
    ],
)
def test_what_is_not_saved(client, pdf_file, body, base, headers, status):
    version = client.get(f"/pdf/{PDF}").headers["etag"]
    assert save(client, body, version, base, headers).status_code == status
    assert client.put("/pdf/escape.pdf", content=body, headers=OWN).status_code == 404


def test_a_page_writes_to_the_log(client, caplog):
    entry = {"level": "error", "message": "Unable to get text content for page 1", "where": "/"}
    assert client.post("/api/log", json=entry, headers=OWN).status_code == 204
    assert "page error: Unable to get text content for page 1 (/)" in caplog.text
    assert (
        client.post("/api/log", json=entry, headers={"Host": "127.0.0.1:8517"}).status_code == 403
    )
    assert client.post("/api/log", content=b"[]", headers=OWN).status_code == 400


def test_the_overview_note_shown_and_moved_to_the_trash(client, library, monkeypatch):
    trashed = []
    monkeypatch.setattr("carrel.server.send2trash", lambda path: trashed.append(path))
    assert client.get(f"/api/overview/{PDF}").json() is None
    note = library.overview_note(library.paper_for_pdf("recsys/Wide & Deep. A Test Paper.pdf"))
    note.write_text("# Wide & Deep\n\nWhat it does.\n")
    try:
        assert client.get(f"/api/overview/{PDF}").json() == {
            "name": "Wide & Deep. A Test Paper",
            "text": "# Wide & Deep\n\nWhat it does.\n",
        }
        assert client.get("/api/overview/..%2Fpaper-library.yaml").status_code == 404
        # Only from carrel's own page.
        assert (
            client.delete(f"/api/overview/{PDF}", headers={"Host": "127.0.0.1:8517"}).status_code
            == 403
        )
        assert trashed == []
        assert client.delete(f"/api/overview/{PDF}", headers=OWN).status_code == 204
        assert trashed == [note]
    finally:
        note.unlink()


def test_a_link_to_an_overview_note_finds_its_paper(client, library):
    folder = library.overview_dir
    path = str(folder / "Wide & Deep. A Test Paper.md")
    assert client.get("/api/overview-note", params={"path": path}).status_code == 404
    (folder / "Wide & Deep. A Test Paper.md").write_text("# Wide & Deep\n")
    try:
        assert client.get("/api/overview-note", params={"path": path}).json() == {
            "pdf": "recsys/Wide & Deep. A Test Paper.pdf"
        }
        for elsewhere in (
            str(library.root / "Wide & Deep. A Test Paper.md"),
            "Wide & Deep. A Test Paper.md",
            str(folder / "sub" / ".." / ".." / "Wide & Deep. A Test Paper.md"),
            "",
        ):
            assert client.get("/api/overview-note", params={"path": elsewhere}).status_code == 404
    finally:
        (folder / "Wide & Deep. A Test Paper.md").unlink()


class Commands:
    """Claude Code, as far as listing its commands goes."""

    async def get_server_info(self):
        return {"commands": [{"name": "overview", "description": "A pre-read note"}]}

    async def disconnect(self):
        pass


def test_the_slash_commands(library):
    async def connect():
        return Commands()

    app = make_app(library, sessions=Sessions(library, connect=connect))
    with TestClient(app, base_url="http://127.0.0.1:8517") as client:
        assert client.get("/api/commands").json() == [
            {"name": "overview", "description": "A pre-read note", "hint": ""}
        ]
