import time
from urllib.parse import quote

import pymupdf
import pytest
from starlette.testclient import TestClient

from carrel.previews import WIDTH, Previews, render
from carrel.server import make_app

WIDE = "recsys/Wide & Deep. A Test Paper.pdf"


def two_pages(path):
    doc = pymupdf.open()
    for words in ("The first page.", "The second page."):
        doc.new_page().insert_text((72, 72), words)
    doc.save(path)
    return path


def test_a_page_is_drawn_small_as_a_jpeg(tmp_path):
    data = render(two_pages(tmp_path / "paper.pdf"), 2)
    assert data[:3] == b"\xff\xd8\xff"
    assert pymupdf.Pixmap(data).width == WIDTH
    with pytest.raises(LookupError):
        render(tmp_path / "paper.pdf", 3)


def drawn(previews, count, version):
    """Waits for the background to draw `count` pictures of `version`; their names."""
    for _ in range(200):
        names = sorted(path.name for path in previews.folder.rglob("*.jpg"))
        if len(names) == count and all(name.startswith(f"{version}-") for name in names):
            return names
        time.sleep(0.01)
    raise AssertionError(f"drawn: {names}")


def test_pictures_are_kept_by_the_pdfs_version(library, monkeypatch):
    previews = Previews(library)
    target = library.resolve_pdf(WIDE)
    original = target.read_bytes()
    try:
        two_pages(target)
        first, version = previews.picture(WIDE, 1)
        # The other page is drawn after it, in the background.
        assert drawn(previews, 2, version) == [f"{version}-1.jpg", f"{version}-2.jpg"]
        with monkeypatch.context() as patched:
            patched.setattr("carrel.previews.render", lambda *args: pytest.fail("drawn again"))
            assert previews.picture(WIDE, 1) == (first, version)
        # A new version is drawn again, and the old one's pictures go.
        two_pages(target)
        _, newer = previews.picture(WIDE, 2)
        assert newer != version
        assert drawn(previews, 2, newer) == [f"{newer}-1.jpg", f"{newer}-2.jpg"]
    finally:
        target.write_bytes(original)


def test_the_page_asks_for_a_picture_by_its_version(library):
    target = library.resolve_pdf(WIDE)
    original = target.read_bytes()
    client = TestClient(make_app(library), base_url="http://127.0.0.1:8517")
    try:
        two_pages(target)
        version = Previews(library).version(WIDE)
        named = client.get(f"/api/preview/{quote(WIDE)}?page=1&v={version}")
        assert named.status_code == 200
        assert named.headers["content-type"] == "image/jpeg"
        assert "immutable" in named.headers["cache-control"]
        assert (
            client.get(f"/api/preview/{quote(WIDE)}?page=1").headers["cache-control"] == "no-cache"
        )
        assert client.get(f"/api/preview/{quote(WIDE)}?page=9").status_code == 404
        assert client.get(f"/api/preview/{quote(WIDE)}?page=x").status_code == 404
        assert client.get("/api/preview/nowhere.pdf?page=1").status_code == 404
    finally:
        target.write_bytes(original)


def test_the_papers_used_longest_ago_go_past_the_limit(library):
    previews = Previews(library, most_bytes=1)
    target = library.resolve_pdf(WIDE)
    original = target.read_bytes()
    try:
        old = previews.folder / "old-paper"
        old.mkdir(parents=True)
        (old / "1-1.jpg").write_bytes(b"x" * 100)
        two_pages(target)
        _, version = previews.picture(WIDE, 1)
        drawn(previews, 2, version)
        for _ in range(200):
            if not old.exists():
                break
            time.sleep(0.01)
        # The paper just drawn stays, over the limit as it is; the other goes.
        assert not old.exists()
        assert len(list(previews.folder.rglob("*.jpg"))) == 2
    finally:
        target.write_bytes(original)
