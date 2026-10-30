import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from carrel.catalog import Catalog
from carrel.server import make_app

WIDE = "library/recsys/Wide & Deep. A Test Paper.txt"
DPO = "library/llm/post-training/preference-learning/Direct Preference Optimization. Your Language Model is Secretly a Reward Model.txt"
LARIMAR = (
    "library/llm/memory/parametric/Larimar. Large Language Models with Episodic Memory Control.txt"
)


def transcript(folder: Path, name: str, *entries: dict) -> None:
    """A Claude Code transcript, written as Claude Code writes it: compact JSON lines."""
    folder.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(entry, separators=(",", ":")) for entry in entries]
    (folder / f"{name}.jsonl").write_text("\n".join(lines) + "\n")


def question(text: str, entrypoint: str = "carrel") -> dict:
    return {"type": "user", "entrypoint": entrypoint, "message": {"role": "user", "content": text}}


@pytest.fixture
def transcripts(tmp_path) -> Path:
    folder = tmp_path / "transcripts"
    transcript(
        folder,
        "a",
        question(f"[Reading {WIDE}, page 1]\nWhy?"),
        question(f"[Reading {WIDE}]\nAnd?"),
        {"type": "assistant", "entrypoint": "carrel", "message": {"content": [f"[Reading {DPO}]"]}},
        {
            "type": "user",
            "entrypoint": "carrel",
            "message": {"content": [{"type": "text", "text": f"/overview\n[Reading {DPO}]"}]},
        },
    )
    # The reader's own session in the terminal, about the same paper: not carrel's.
    transcript(folder, "b", question(f"[Reading {WIDE}]\nWhy?", entrypoint="cli"))
    return folder


@pytest.fixture
def document(library, transcripts) -> dict:
    return Catalog(library, transcripts).document()


def by_text(document: dict) -> dict:
    return {paper["text"]: paper for paper in document["papers"]}


def test_each_paper_with_its_fields(document):
    papers = by_text(document)
    assert sorted(papers) == sorted([WIDE, DPO, LARIMAR])  # with a PDF only
    assert papers[WIDE] == {
        "pdf": "recsys/Wide & Deep. A Test Paper.pdf",
        "text": WIDE,
        "title": "Wide & Deep: A Test Paper",
        "authors": ["A. Author"],
        "published": "2016-06-24",
        "added": "2026-10-26",
        "summary": "A paper for the tests.",
        "topic": "recsys",
        "reviews": ["recsys"],
        "chats": 2,
    }
    assert papers[DPO]["arxiv"] and papers[DPO]["topic"] == "llm/post-training/preference-learning"


def test_the_scopes_and_what_the_agent_has_read(document):
    # Without review_scopes in the config, the top-level folders.
    assert document["scopes"] == [{"group": "", "scopes": ["deep-learning", "llm", "recsys"]}]
    papers = by_text(document)
    assert papers[DPO]["read"] and papers[LARIMAR]["read"] and "read" not in papers[WIDE]


def test_the_type_from_the_frontmatter_else_the_note(document):
    papers = by_text(document)
    assert papers[DPO]["type"] == "method"  # its frontmatter's
    assert papers[LARIMAR]["type"] == "system"  # its frontmatter's, not its note's "study"
    assert "type" not in papers[WIDE]


def test_the_marks(library, transcripts):
    note = library.overview_dir / "Larimar. Large Language Models with Episodic Memory Control.md"
    note.write_text("# Overview\n")
    try:
        papers = by_text(Catalog(library, transcripts).document())
    finally:
        note.unlink()
    assert papers[LARIMAR]["overview"] is True
    assert "overview" not in papers[WIDE]
    assert papers[DPO]["reviews"] == ["recsys"] and papers[DPO]["chats"] == 1
    assert "reviews" not in papers[LARIMAR] and "chats" not in papers[LARIMAR]


def test_topics_with_their_totals(document):
    topics = {topic["path"]: topic for topic in document["topics"]}
    assert topics["llm"] == {
        "path": "llm",
        "scope": "Large language models — how they are built, adapted, used and evaluated.",
        "count": 0,
        "total": 2,
    }
    assert (topics["llm/memory"]["count"], topics["llm/memory"]["total"]) == (0, 1)
    assert (topics["llm/memory/parametric"]["count"], topics["recsys"]["count"]) == (1, 1)
    assert topics["deep-learning"]["total"] == 0  # its one paper, a web article, has no PDF
    assert [topic["path"] for topic in document["topics"]][:2] == [
        "deep-learning",
        "deep-learning/optimizers-and-schedules",
    ]


def test_reviews(document):
    assert document["reviews"] == [
        {
            "scope": "recsys",
            "title": "Recommender systems",
            "updated": "2026-10-12",
            "checked": "",
            "path": "reviews/recsys.md",
            "abstract": "Recommenders rank items for a person; Wide & Deep joins a memorising part and a generalising one.",
            "cites": 2,
        }
    ]


def test_it_is_built_again_only_when_the_library_changes(library, transcripts):
    catalog = Catalog(library, transcripts)
    first = catalog.current()
    assert catalog.current() is first
    paper = library.root / WIDE
    text = paper.read_text()
    paper.write_text(text.replace("A paper for the tests.", "Changed."))
    try:
        changed = catalog.current()
        assert changed is not first and changed.etag != first.etag
        assert by_text(json.loads(changed.body))[WIDE]["summary"] == "Changed."
    finally:
        paper.write_text(text)
    assert catalog.current().etag == first.etag
    # A new question in a chat counts too.
    transcript(transcripts, "c", question(f"[Reading {LARIMAR}]\nHow?"))
    assert by_text(json.loads(catalog.current().body))[LARIMAR]["chats"] == 1


@pytest.fixture
def client(library, transcripts):
    app = make_app(library, catalog=Catalog(library, transcripts))
    return TestClient(app, base_url="http://127.0.0.1:8517")


def test_the_document_revalidates_and_goes_compressed(client):
    response = client.get("/api/library", headers={"Accept-Encoding": "identity"})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "no-cache"
    assert "content-encoding" not in response.headers
    assert len(response.json()["papers"]) == 3
    etag = response.headers["etag"]
    again = client.get("/api/library", headers={"If-None-Match": etag})
    assert (again.status_code, again.content) == (304, b"")
    packed = client.get("/api/library", headers={"Accept-Encoding": "gzip"})
    assert packed.headers["content-encoding"] == "gzip"
    assert packed.json() == response.json()  # the client unpacks it
    assert packed.headers["etag"] == etag


def test_an_area_and_a_review_are_the_one_page(client):
    area = client.get("/area/llm/memory")
    assert area.status_code == 200
    assert 'data-area="llm/memory"' in area.text and 'data-review=""' in area.text
    assert client.get("/area/recsys").status_code == 200
    assert client.get("/area/nowhere").status_code == 404
    review = client.get("/review/recsys")
    assert review.status_code == 200
    assert 'data-review="recsys"' in review.text
    assert "<title>Recommender systems</title>" in review.text
    assert client.get("/review/llm").status_code == 404


def test_a_review_and_where_its_links_lead(client):
    review = client.get("/api/review/recsys").json()
    assert (review["scope"], review["title"], review["updated"]) == (
        "recsys",
        "Recommender systems",
        "2026-10-12",
    )
    assert review["markdown"].startswith("# Recommender systems\n")
    assert "scope:" not in review["markdown"]  # no frontmatter
    wide = {"text": WIDE, "pdf": "recsys/Wide & Deep. A Test Paper.pdf"}
    links = review["links"]
    assert links["../library/recsys/Wide%20%26%20Deep.%20A%20Test%20Paper.txt"] == wide
    assert (
        links["http://pdf.invalid/recsys/Wide%20%26%20Deep.%20A%20Test%20Paper.pdf?page=1"] == wide
    )
    assert any(value.get("text") == DPO for value in links.values())
    assert "https://example.com" not in links
    assert client.get("/api/review/llm").status_code == 404


@pytest.fixture
def texts(library):
    """Words in two papers' text layers, the second on its third page; put back afterwards."""
    larimar = library.root / LARIMAR
    wide = library.root / WIDE
    kept = {path: path.read_text() for path in (larimar, wide)}
    larimar.write_text(
        kept[larimar] + "\n[page 2]\nnothing\n[page 3]\nA memory   of\nepisodes, kept.\n"
    )
    wide.write_text(kept[wide] + "Memory of episodes here, and memory of episodes again.\n")
    yield
    for path, text in kept.items():
        path.write_text(text)


def test_text_search(client, texts):
    found = client.get("/api/search", params={"q": "memory of  episodes"}).json()
    assert found["total"] == 2
    first, second = found["papers"]
    assert (first["pdf"], first["count"], first["title"]) == (
        "recsys/Wide & Deep. A Test Paper.pdf",
        2,
        "Wide & Deep: A Test Paper",
    )
    assert [hit["page"] for hit in first["hits"]] == [1, 1]
    # Across runs of spaces and a line break, on the page above it, with the spacing kept.
    (hit,) = second["hits"]
    assert (hit["page"], hit["match"], hit["after"]) == (3, "memory of episodes", ", kept. ")
    assert hit["before"].endswith(" nothing A ")  # no page lines in it
    # In an area only.
    scoped = client.get("/api/search", params={"q": "memory of episodes", "topic": "llm"}).json()
    assert [paper["topic"] for paper in scoped["papers"]] == ["llm/memory/parametric"]
    # A paper without a PDF is not found, even when its text holds the words.
    assert client.get("/api/search", params={"q": "A paper for the tests"}).json()["total"] == 1


def test_text_search_refuses(client, monkeypatch):
    assert client.get("/api/search", params={"q": "ab"}).status_code == 400
    assert client.get("/api/search", params={"q": "x" * 201}).status_code == 400
    assert client.get("/api/search", params={"q": "memory", "topic": "../.."}).status_code == 404
    monkeypatch.setattr("carrel.search.shutil.which", lambda name: None)
    response = client.get("/api/search", params={"q": "memory"})
    assert response.status_code == 503 and "ripgrep" in response.json()["error"]


def test_text_search_shows_the_papers_with_the_most_matches(library, client, monkeypatch, texts):
    monkeypatch.setattr("carrel.search.MOST_PAPERS", 1)
    found = client.get("/api/search", params={"q": "memory of episodes"}).json()
    assert (found["total"], len(found["papers"])) == (2, 1)
