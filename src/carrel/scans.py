"""Which pages of a paper are scans, for the page's black-and-white option, which acts on them
alone (`/api/scans`).

A scan is a page that is one picture: images cover nearly all of it, whatever text an OCR layer
lays invisibly over them. Found with PyMuPDF when a paper is opened, in a few milliseconds for a
paper of thirty pages, and kept in memory by the PDF's version.
"""

import logging
import threading
from pathlib import Path

import pymupdf

from .engine import Library
from .highlights import _reading, file_version

log = logging.getLogger("carrel")

# The share of a page its images cover for it to be a scan; a page with a large figure stays
# well under it (crisp-pages found papers' scans at 0.95 and over).
COVERED = 0.85


def scanned_pages(path: Path) -> list[int]:
    """The numbers (from 1) of the pages of the PDF at `path` that are scans."""
    pages = []
    with _reading, pymupdf.open(path) as doc:
        for page in doc:
            area = abs(page.rect)
            if not area:
                continue
            covered = sum(
                abs(pymupdf.Rect(info["bbox"]) & page.rect) for info in page.get_image_info()
            )
            if covered / area >= COVERED:
                pages.append(page.number + 1)
    return pages


class Scans:
    def __init__(self, library: Library):
        self.library = library
        self._lock = threading.Lock()
        self._known: dict[str, tuple[str, list[int]]] = {}  # pdf -> (version, pages)

    def pages(self, rel: str) -> list[int]:
        """The scanned pages of the PDF at `rel` under pdf_root. LookupError for a path that is
        not a PDF of the library; none for a PDF PyMuPDF cannot open."""
        path = self.library.resolve_pdf(rel)
        version = file_version(path.stat())
        with self._lock:
            known = self._known.get(rel)
        if known and known[0] == version:
            return known[1]
        try:
            pages = scanned_pages(path)
        except Exception as error:
            log.warning("scans: could not read %s: %s", path.name, error)
            pages = []
        with self._lock:
            self._known[rel] = (version, pages)
        return pages
