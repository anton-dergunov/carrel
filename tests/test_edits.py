import json
import sys
from pathlib import Path

import pytest
from conftest import DPO, WIDE
from starlette.testclient import TestClient

from carrel.edits import EditError, Edits, arxiv_id
from carrel.server import make_app

ORIGIN = {"Origin": "http://127.0.0.1:8517"}
# What the engine would be asked: here, a command that prints its arguments, and, for a PDF,
# whether the uploaded file is there while it runs.
SHOW = (
    "import sys, os; args = sys.argv[1:]; print('ran', *args); "
    "print('exists' if args[0] == 'add-pdf' and os.path.isfile(args[1]) else 'no file'); "
    "sys.exit(3 if 'fail' in args else 0)"
)


def fake(args):
    return [sys.executable, "-c", SHOW, *args]


@pytest.fixture
def client(library):
    app = make_app(library, edits=Edits(library, command=fake))
    return TestClient(app, base_url="http://127.0.0.1:8517")


def lines(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines()]


def test_arxiv_ids():
    assert arxiv_id("1706.03762") == "1706.03762"
    assert arxiv_id("https://arxiv.org/abs/1706.03762v7") == "1706.03762"
    assert arxiv_id("arxiv.org/pdf/2401.00001.pdf") is None  # an address names its scheme
    assert arxiv_id("https://arxiv.org/pdf/2401.00001v2.pdf") == "2401.00001"
    assert arxiv_id("not an id") is None


def test_an_arxiv_paper_is_filed_by_the_engine(client):
    response = client.post(
        "/api/add", json={"source": "https://arxiv.org/abs/1706.03762v7"}, headers=ORIGIN
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert lines(response) == [
        {"line": "ran add 1706.03762"},
        {"line": "no file"},
        {  # the stand-in adds nothing, and says nothing of why
            "done": True,
            "code": 0,
            "outcome": "failed",
            "reason": "The library's command ended without adding it.",
        },
    ]


def test_a_web_page_goes_into_an_area_the_reader_picks(client):
    asked = {
        "source": "https://distill.pub/2017/momentum/",
        "topic": "deep-learning",
        "title": "Why\nMomentum",
    }
    response = client.post("/api/add", json=asked, headers=ORIGIN)
    assert lines(response)[0] == {
        "line": "ran add-web https://distill.pub/2017/momentum/ deep-learning --title Why Momentum"
    }
    for wrong in (
        {"source": "https://distill.pub/x"},
        {"source": "https://x.org/y", "topic": "nowhere"},
        {"source": "words"},
        [],
    ):
        assert client.post("/api/add", json=wrong, headers=ORIGIN).status_code == 400


def test_a_pdf_is_uploaded_then_added(client):
    pdf = b"%PDF-1.4\n" + b"0" * 100
    response = client.post(
        "/api/add?topic=recsys&title=A%20Title&name=../My%20paper.pdf",
        content=pdf,
        headers={**ORIGIN, "Content-Type": "application/pdf"},
    )
    out = lines(response)
    assert out[0]["line"].startswith("ran add-pdf ") and out[0]["line"].endswith(
        "/My paper.pdf recsys --title A Title"
    )
    assert out[1] == {"line": "exists"}
    uploaded = Path(out[0]["line"].split(" ")[2].rsplit("/", 1)[0])
    assert not uploaded.exists()  # gone once the command is done
    bad = client.post(
        "/api/add?topic=recsys",
        content=b"<html>",
        headers={**ORIGIN, "Content-Type": "application/pdf"},
    )
    assert bad.status_code == 400


def test_a_paper_is_removed_with_its_reason(client):
    response = client.post(
        "/api/remove",
        json={"pdf": "recsys/Wide & Deep. A Test Paper.pdf", "reason": "a duplicate\n of another"},
        headers=ORIGIN,
    )
    assert lines(response)[0] == {
        "line": "ran remove library/recsys/Wide & Deep. A Test Paper.txt --yes --reason a duplicate of another"
    }
    assert (
        client.post("/api/remove", json={"pdf": "recsys/missing.pdf"}, headers=ORIGIN).status_code
        == 404
    )
    assert (
        client.post(
            "/api/remove", json={"pdf": "../paper-library.yaml"}, headers=ORIGIN
        ).status_code
        == 404
    )


def test_a_failing_command_says_so(library, client, monkeypatch):
    response = client.post(
        "/api/add",
        json={"source": "https://x.org/fail", "topic": "recsys", "title": "fail"},
        headers=ORIGIN,
    )
    assert lines(response)[-1] == {
        "done": True,
        "code": 3,
        "outcome": "failed",
        "reason": "The library's command ended without adding it.",
    }


def test_only_from_carrels_own_page(client):
    assert client.post("/api/add", json={"source": "1706.03762"}).status_code == 403
    assert (
        client.post(
            "/api/remove", json={"pdf": "x.pdf"}, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )


async def test_one_at_a_time(library):
    edits = Edits(library, command=fake)
    first = await edits.run(["add", "1706.03762"])
    with pytest.raises(EditError) as refused:
        await edits.run(["add", "1706.03763"])
    assert refused.value.status == 409
    assert [line async for line in first][-1] == b'{"done": true, "code": 0}\n'
    second = await edits.run(["add", "1706.03763"])  # free again
    assert [line async for line in second]


def test_what_an_add_brought_in(library):
    edits = Edits(library, command=fake)
    before = edits.papers_now()
    topic = library.papers_dir / "recsys"
    paper = topic / "New One.txt"
    pdf = library.pdf_root / "recsys" / "New One.pdf"
    paper.write_text(
        '---\ntitle: "A New One"\nsource: pdf\nsummary: s\nadded: 2026-10-30\n---\n[page 1]\n'
    )
    pdf.write_bytes(b"%PDF-1.4\n")
    try:
        assert edits.read_outcome(["add-pdf", "x.pdf", "recsys"], [], before) == {
            "outcome": "added",
            "papers": [
                {
                    "pdf": "recsys/New One.pdf",
                    "text": "library/recsys/New One.txt",
                    "title": "A New One",
                    "added": "2026-10-30",
                    "summary": "s",
                    "topic": "recsys",
                }
            ],
        }
        assert edits.gone(["remove", "library/recsys/New One.txt"]) == {"removed": False}
    finally:
        paper.unlink()
        pdf.unlink()
    assert edits.gone(["remove", "library/recsys/New One.txt"]) == {"removed": True}


def test_why_an_add_brought_nothing_in(library):
    """Read from the library, and from the lines the engine's add commands print."""
    edits = Edits(library, command=fake)
    before = edits.papers_now()
    outcome = edits.read_outcome
    wide = library.root / "library" / f"{WIDE}.txt"
    wide_pdf = library.pdf_root / f"{WIDE}.pdf"

    # An arXiv paper the library has: looked up by its id, whatever was printed.
    dpo = outcome(["add", "2305.18290"], ["2305.18290: Direct Preference Optimization"], before)
    assert dpo["outcome"] == "exists"
    [paper] = dpo["papers"]
    assert paper["pdf"] == f"{DPO}.pdf" and paper["arxiv"] == "2305.18290"
    assert paper["topic"] == "llm/post-training/preference-learning"

    # A web page or a PDF the library has: the path the engine names, its text or its PDF.
    for path in (wide, wide_pdf):
        found = outcome(
            ["add-pdf", "x.pdf", "recsys"], ["Title: x", f"skip (exists): {path}"], before
        )
        assert found["outcome"] == "exists"
        assert found["papers"][0]["title"] == "Wide & Deep: A Test Paper"
    assert outcome(["add-web", "u", "recsys"], ["skip (exists): /elsewhere/x.md"], before) == {
        "outcome": "failed",
        "reason": "The library's command ended without adding it.",
    }

    said = {
        "skipped": [
            "2401.00001: A Paper",
            "  skipped earlier (2026-09-01): off topic",
            "  not added; remove it from catalog/skipped.yaml to add it",
            "add: 0 added, 1 not added",
        ],
        "missing": ["2401.99999: not found on arXiv", "add: 0 added, 1 not added"],
        "no folder": [
            "2401.00001: A Paper",
            "  not added: no declared folder fits (it is about birds)",
            "  use the add-paper skill, which proposes a new folder",
        ],
        "model": ["2401.00001: A Paper", "  not added: claude -p failed: timeout"],
        "error": [
            "Rendering https://x.org ...",
            "error: the site answered with a bot check (Wait)",
        ],
    }
    assert outcome(["add", "2401.00001"], said["skipped"], before) == {
        "outcome": "skipped",
        "reason": "You skipped it on 2026-09-01: off topic",
    }
    reasons = {
        name: outcome(["add", "2401.00001"], printed, before)["reason"]
        for name, printed in said.items()
        if name != "skipped"
    }
    assert reasons == {
        "missing": "arXiv has no paper 2401.99999.",
        "no folder": "No area of the library fits it: it is about birds",
        "model": "claude -p failed: timeout",
        "error": "the site answered with a bot check (Wait)",
    }
