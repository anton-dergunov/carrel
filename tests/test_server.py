from urllib.parse import quote

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from carrel.server import make_app

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
    assert "script-src 'self'" in response.headers["content-security-policy"]


def test_read_page(client):
    response = client.get(f"/read/{PDF}")
    assert response.status_code == 200
    assert 'data-pdf="recsys/Wide &amp; Deep. A Test Paper.pdf"' in response.text
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
        socket.send_json({"type": "nonsense"})
        message = socket.receive_json()
    assert (message["seq"], message["kind"]) == (1, "Error")
