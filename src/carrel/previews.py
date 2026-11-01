"""A small picture of each page of a paper, for the page to show behind the page until PDF.js has
drawn it (`/api/preview`).

The page used to draw these itself, the first time a paper was shown and again after every launch
or reload, so a paper came up white before its pictures did. Made here with PyMuPDF (some 10 ms a
page), kept on disk by the PDF's version and served under an address that names the version, the
browser keeps them as well: a paper shows its pages' pictures from the first frame, on every
device, and the tablet draws nothing for them.
"""

import hashlib
import logging
import os
import tempfile
import threading
from pathlib import Path

import pymupdf

from .engine import Library
from .highlights import _reading, file_version
from .usage import state_dir

log = logging.getLogger("carrel")

# The picture's width in pixels: a blur at full size, which is all it is for. Twice as wide made a
# flick through a paper show more of the viewer's grey on the Mac: WebKit paints them as it scrolls.
WIDTH = 540
QUALITY = 72
# The pages of a paper drawn ahead of being asked for: a book's are drawn as they are asked.
MOST_PAGES = 400


def render(path: Path, page: int, width: int = WIDTH) -> bytes:
    """Page `page` (from 1) of the PDF at `path`, `width` pixels wide, as a JPEG, its annotations
    (the reader's highlights) drawn. LookupError for a page it does not have."""
    with _reading, pymupdf.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise LookupError(f"no page {page}")
        found = doc[page - 1]
        zoom = width / max(found.rect.width, 1)
        pixmap = found.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return pixmap.tobytes("jpeg", jpg_quality=QUALITY)


class Previews:
    """The pictures, made once for each version of a PDF and kept in `folder` (by default the
    state folder's), the last version's only. A page asked for is drawn at once; the rest of its
    paper is drawn after it in the background, a page at a time, so that a request never waits for
    a whole paper."""

    def __init__(self, library: Library, folder: Path | None = None):
        self.library = library
        self.folder = folder or state_dir() / "previews" / library.root.name
        self._lock = threading.Lock()
        self._filling: set[tuple[str, str]] = set()  # (pdf, version) being drawn in the background

    def version(self, rel: str) -> str:
        """The PDF's version, as its ETag carries it. LookupError for a path that is not a PDF of
        the library."""
        return file_version(self.library.resolve_pdf(rel).stat())

    def picture(self, rel: str, page: int) -> tuple[bytes, str]:
        """The picture of page `page` of the PDF at `rel` under pdf_root, and the version it is of.
        LookupError for a path that is not a PDF of the library, or a page it does not have."""
        path = self.library.resolve_pdf(rel)
        version = file_version(path.stat())
        kept = self._kept(rel, version, page)
        try:
            data = kept.read_bytes()
        except FileNotFoundError:
            data = self._draw(path, page, kept)
        self._fill(rel, path, version)
        return data, version

    def _kept(self, rel: str, version: str, page: int) -> Path:
        return self.folder / hashlib.sha1(rel.encode()).hexdigest()[:20] / f"{version}-{page}.jpg"

    def _draw(self, path: Path, page: int, kept: Path) -> bytes:
        try:
            data = render(path, page)
        except LookupError:
            raise
        except Exception as error:
            log.warning("previews: could not draw page %d of %s: %s", page, path.name, error)
            raise LookupError(str(error)) from error
        version = kept.name.rsplit("-", 1)[0]
        with self._lock:
            kept.parent.mkdir(parents=True, exist_ok=True)
            # An older version's pictures go: the PDF changed (a highlight saved).
            for old in kept.parent.glob("*.jpg"):
                if not old.name.startswith(f"{version}-"):
                    old.unlink(missing_ok=True)
            handle, temporary = tempfile.mkstemp(dir=kept.parent, suffix=".part")
            with os.fdopen(handle, "wb") as out:
                out.write(data)
            os.replace(temporary, kept)
        return data

    def _fill(self, rel: str, path: Path, version: str) -> None:
        """Draws the paper's other pages in the background, once for each version."""
        with self._lock:
            if (rel, version) in self._filling:
                return
            self._filling.add((rel, version))
        threading.Thread(target=self._fill_all, args=(rel, path, version), daemon=True).start()

    def _fill_all(self, rel: str, path: Path, version: str) -> None:
        try:
            with _reading, pymupdf.open(path) as doc:
                count = min(doc.page_count, MOST_PAGES)
            for page in range(1, count + 1):
                kept = self._kept(rel, version, page)
                if kept.exists():
                    continue
                if file_version(path.stat()) != version:
                    return  # changed again: the next version's request draws it
                self._draw(path, page, kept)
        except Exception as error:
            log.warning("previews: stopped drawing %s: %s", path.name, error)
        # Done, the set keeps the version so it is not drawn again; one per paper is remembered.
        with self._lock:
            self._filling = {(r, v) for r, v in self._filling if r != rel or v == version}
