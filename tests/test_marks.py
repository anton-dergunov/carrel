"""The reader's highlights, stars and tags: the index of the PDFs' highlights, the library's
document, the routes that write the marks, and the agent kept from writing them."""

import os
from pathlib import Path
from urllib.parse import quote

import pymupdf
import pytest
from conftest import DPO, WIDE
from starlette.testclient import TestClient

from carrel.catalog import Catalog
from carrel.highlights import Highlights
from carrel.server import make_app
from carrel.session import agent_settings

OWN = {"Host": "127.0.0.1:8517", "Origin": "http://127.0.0.1:8517"}
WIDE_TEXT = f"library/{WIDE}.txt"
DPO_TEXT = f"library/{DPO}.txt"


@pytest.fixture
def marks_file(library):
    """The shared example library's marks are taken away after each test."""
    yield library.reader_file
    library.reader_file.unlink(missing_ok=True)


@pytest.fixture
def client(library, marks_file):
    return TestClient(make_app(library), base_url="http://127.0.0.1:8517")


def highlighted_pdf(path: Path, count: int) -> None:
    """A PDF with `count` yellow highlights on its first page."""
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    for i in range(count):
        page.insert_text((72, 100 + 40 * i), f"Passage number {i} worth keeping.", fontsize=11)
    words = page.get_text("words", sort=True)
    for i in range(count):
        line = [word for word in words if abs(word[1] - (100 + 40 * i - 9)) < 8]
        annot = page.add_highlight_annot([pymupdf.Rect(word[:4]).quad for word in line[1:3]])
        annot.set_colors(stroke=(1, 0.92, 0.23))
        annot.update()
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)


class PdfFolder:
    """What Highlights needs of a library: its PDFs, and the engine's reading of them."""

    def __init__(self, library, root: Path):
        self.pdf_root = root
        self.read = 0
        self._library = library

    def resolve_pdf(self, rel: str) -> Path:
        path = (self.pdf_root / rel).resolve()
        if not path.is_relative_to(self.pdf_root.resolve()) or not path.is_file():
            raise LookupError(rel)
        return path

    def read_highlights(self, pdf: Path) -> list[dict]:
        self.read += 1
        return self._library.read_highlights(pdf)


def test_the_highlights_are_read_from_the_pdfs_and_kept(library, tmp_path):
    folder = PdfFolder(library, tmp_path / "pdfs")
    highlighted_pdf(folder.pdf_root / "a/One.pdf", 2)
    highlighted_pdf(folder.pdf_root / "a/None.pdf", 0)
    index = Highlights(folder, tmp_path / "state.json")
    index.refresh()
    assert index.counts() == {"a/One.pdf": 2}
    assert folder.read == 2 and index.revision > 0
    first = index.items("a/One.pdf")
    assert [each["text"] for each in first] == ["number 0", "number 1"]
    assert first[0]["page"] == 1 and first[0]["name"] == "yellow"

    # Kept: a new index reads nothing that has not changed.
    again = Highlights(folder, tmp_path / "state.json")
    again.refresh()
    assert folder.read == 2 and again.counts() == {"a/One.pdf": 2}

    # A highlight added elsewhere, and a PDF gone.
    revision = again.revision
    highlighted_pdf(folder.pdf_root / "a/None.pdf", 3)
    (folder.pdf_root / "a/One.pdf").unlink()
    again.refresh()
    assert again.counts() == {"a/None.pdf": 3} and again.revision > revision

    # Asked for one PDF, it is read again when it changed since.
    highlighted_pdf(folder.pdf_root / "a/None.pdf", 1)
    os.utime(folder.pdf_root / "a/None.pdf", ns=(1, 1))
    assert len(again.items("a/None.pdf")) == 1
    with pytest.raises(LookupError):
        again.items("../outside.pdf")


def test_a_pdf_that_cannot_be_read_has_none(library, tmp_path):
    folder = PdfFolder(library, tmp_path / "pdfs")
    (folder.pdf_root).mkdir()
    (folder.pdf_root / "broken.pdf").write_bytes(b"%PDF-1.4 not really")
    index = Highlights(folder, tmp_path / "state.json")
    index.refresh()
    assert index.counts() == {} and index.items("broken.pdf") == []


class Counted:
    revision = 7

    def counts(self):
        return {f"{WIDE}.pdf": 4}

    def refresh_soon(self):
        pass


def test_the_document_has_the_marks(library, marks_file, tmp_path):
    library.star(library.paper_for_pdf(f"{WIDE}.pdf"), True)
    library.set_tags(library.paper_for_pdf(f"{WIDE}.pdf"), ["carrel", "memory talk"])
    library.set_tags(library.paper_for_pdf(f"{DPO}.pdf"), ["carrel"])
    library.edit_tag("carrel", about="Papers for carrel.")
    document = Catalog(library, tmp_path / "none", highlights=Counted()).document()
    papers = {paper["text"]: paper for paper in document["papers"]}
    wide = papers[WIDE_TEXT]
    assert wide["highlights"] == 4
    assert len(wide["starred"]) == 10 and wide["tags"] == ["carrel", "memory-talk"]
    assert papers[DPO_TEXT]["tags"] == ["carrel"] and "starred" not in papers[DPO_TEXT]
    assert [(tag["name"], tag["count"], tag["about"]) for tag in document["tags"]] == [
        ("carrel", 2, "Papers for carrel."),
        ("memory-talk", 1, ""),
    ]


def test_a_change_to_the_marks_or_the_highlights_builds_it_again(library, marks_file, tmp_path):
    counted = Counted()
    catalog = Catalog(library, tmp_path / "none", highlights=counted)
    first = catalog.current()
    assert catalog.current() is first
    counted.revision += 1
    second = catalog.current()
    assert second is not first
    library.star(library.paper_for_pdf(f"{WIDE}.pdf"), True)
    assert catalog.current() is not second


def test_starring_a_paper(client, library):
    url = f"/api/star/{quote(WIDE)}.pdf"
    response = client.put(url, json={"on": True}, headers=OWN)
    assert response.status_code == 200 and response.json()["starred"]
    assert library.marks()["starred"] == {WIDE_TEXT: response.json()["starred"]}
    assert client.put(url, json={"on": False}, headers=OWN).json()["starred"] is None
    assert library.marks()["starred"] == {}


def test_tagging_a_paper(client, library):
    url = f"/api/tags/{quote(WIDE)}.pdf"
    response = client.put(url, json={"tags": ["Memory Talk", "carrel"]}, headers=OWN)
    assert response.status_code == 200
    assert response.json()["tags"] == ["carrel", "memory-talk"]
    assert [tag["name"] for tag in response.json()["all"]] == ["carrel", "memory-talk"]

    # A description, a rename onto another tag, and a deletion.
    response = client.put("/api/tag/carrel", json={"about": "For carrel."}, headers=OWN)
    assert response.json()["all"][0]["about"] == "For carrel."
    response = client.put("/api/tag/memory-talk", json={"name": "carrel"}, headers=OWN)
    assert [(tag["name"], tag["count"]) for tag in response.json()["all"]] == [("carrel", 1)]
    assert client.delete("/api/tag/carrel", headers=OWN).json()["all"] == []
    assert library.marks()["paper_tags"] == {}


@pytest.mark.parametrize(
    ("method", "url", "body", "headers", "status"),
    [
        ("PUT", f"/api/star/{quote(WIDE)}.pdf", {"on": True}, {"Host": "127.0.0.1:8517"}, 403),
        ("PUT", f"/api/star/{quote(WIDE)}.pdf", {"on": "yes"}, OWN, 400),
        ("PUT", "/api/star/nowhere/Missing.pdf", {"on": True}, OWN, 404),
        ("PUT", "/api/star/escape.pdf", {"on": True}, OWN, 404),
        ("PUT", f"/api/tags/{quote(WIDE)}.pdf", {"tags": ["!!"]}, OWN, 400),
        ("PUT", f"/api/tags/{quote(WIDE)}.pdf", {"tags": "carrel"}, OWN, 400),
        ("PUT", "/api/tag/carrel", {"about": 3}, OWN, 400),
        ("PUT", "/api/tag/carrel", {"name": "$$"}, OWN, 400),
    ],
)
def test_what_is_not_marked(client, library, method, url, body, headers, status):
    assert client.request(method, url, json=body, headers=headers).status_code == status
    assert library.marks() == {"starred": {}, "paper_tags": {}, "tags": []}


def test_a_papers_highlights(client, library):
    response = client.get(f"/api/highlights/{quote(WIDE)}.pdf")
    # The example's PDFs are blank stand-ins: none to read.
    assert response.status_code == 200 and response.json() == {"pdf": f"{WIDE}.pdf", "items": []}
    assert client.get("/api/highlights/escape.pdf").status_code == 404


def test_the_agent_never_writes_the_marks(library):
    settings = agent_settings(library)
    assert f"Edit(/{library.reader_file})" in settings["permissions"]["deny"]
    assert str(library.reader_file) in settings["sandbox"]["filesystem"]["denyWrite"]
