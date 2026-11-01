from pathlib import Path
from urllib.parse import quote

import pymupdf
import pytest
from starlette.testclient import TestClient

from carrel.scans import Scans, scanned_pages
from carrel.server import make_app

WIDE = "recsys/Wide & Deep. A Test Paper.pdf"


def paper(path: Path) -> Path:
    """Three pages: text, a scan (one picture of the whole page), and text with a figure."""
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "Typeset text.")
    picture = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 60, 80), False)
    picture.clear_with(200)
    scan = doc.new_page()
    scan.insert_image(scan.rect, pixmap=picture)
    figure = doc.new_page()
    figure.insert_text((72, 72), "Text above a figure.")
    figure.insert_image(pymupdf.Rect(72, 100, 500, 400), pixmap=picture)
    doc.save(path)
    return path


def test_a_scan_is_a_page_that_is_one_picture(tmp_path):
    assert scanned_pages(paper(tmp_path / "paper.pdf")) == [2]


def test_scans_are_kept_by_the_pdfs_version(library, monkeypatch):
    scans = Scans(library)
    target = library.resolve_pdf(WIDE)
    original = target.read_bytes()
    try:
        paper(target)
        assert scans.pages(WIDE) == [2]
        monkeypatch.setattr("carrel.scans.scanned_pages", lambda path: pytest.fail("read again"))
        assert scans.pages(WIDE) == [2]
    finally:
        target.write_bytes(original)


def test_a_pdf_pymupdf_cannot_open_has_no_scans(library):
    assert Scans(library).pages(WIDE) == []
    with pytest.raises(LookupError):
        Scans(library).pages("escape.pdf")


def test_the_page_asks_which_pages_are_scans(library):
    client = TestClient(make_app(library), base_url="http://127.0.0.1:8517")
    response = client.get(f"/api/scans/{quote(WIDE)}")
    assert response.status_code == 200
    assert response.json() == {"pdf": WIDE, "pages": []}
    assert client.get("/api/scans/nowhere.pdf").status_code == 404
