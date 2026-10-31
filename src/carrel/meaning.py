"""Meaning search and a paper's similar papers (`GET /api/meaning`, `/api/similar/<pdf>`).

The engine's meaning.py embeds and ranks; this keeps its space of the library's papers in
memory (their vectors, about 9 MB), and builds it again when the library's document changes
(its ETag), which embeds only the papers that are new or changed. The space is built in a thread
when the server starts. Only the papers in the library's document (those with a PDF) are found.

The model (about 1.2 GB) is needed only to embed a question or a new paper; a paper's similar papers
are found from the vectors alone. So it is loaded when first needed, about 4 s, and freed after
IDLE_S without a question.
"""

import logging
import threading
import time

from .catalog import Built, Catalog
from .engine import Library

SHORTEST, LONGEST = 3, 200
MOST_PAPERS = 60
SIMILAR = 8
IDLE_S = 600  # the model is freed after this long without a question

log = logging.getLogger("carrel")


class MeaningError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


class Meaning:
    def __init__(self, library: Library, catalog: Catalog, encoder=None):
        self.library = library
        self.catalog = catalog
        self.engine = library.meaning()
        self.encoder = encoder or self.engine.SentenceEncoder()
        # One build or question at a time: the model is not shared between threads.
        self._lock = threading.Lock()
        self._etag: str | None = None
        self._space = None
        self._used = time.monotonic()

    def _current(self) -> tuple[object, Built]:
        built = self.catalog.current()
        if self._space is None or built.etag != self._etag:
            root = self.library.root
            papers = {
                path: meta
                for path, meta in self.library.lib.paper_index().items()
                if path.relative_to(root).as_posix() in built.papers
            }
            self._space = self.engine.build(self.encoder, papers=papers)
            self._etag = built.etag
        return self._space, built

    def warm(self) -> None:
        """Build the space in a thread, embedding what is missing (which loads the model)."""

        def run() -> None:
            try:
                with self._lock:
                    space, _ = self._current()
                    self._used = time.monotonic()
                log.info("meaning search ready: %d papers", len(space.papers))
            except Exception:
                log.exception("meaning search could not start")

        threading.Thread(target=run, name="meaning-warm", daemon=True).start()

    def _rows(self, found, built: Built) -> list[dict]:
        root = self.library.root
        rows = []
        for path, score in found:
            text = path.relative_to(root).as_posix()
            paper = built.papers[text]
            row = {"text": text, "pdf": paper["pdf"], "title": paper["title"]}
            if paper.get("published"):
                row["year"] = paper["published"][:4]
            rows.append({**row, "score": round(score, 4)})
        return rows

    def search(self, query: str, topic: str = "") -> dict:
        """The papers nearest the description, in the topic and below it or the whole library."""
        query = " ".join(query.split())
        if not SHORTEST <= len(query) <= LONGEST:
            raise MeaningError(f"Describe it in {SHORTEST} to {LONGEST} characters.", 400)
        with self._lock:
            space, built = self._current()
            found = space.search(query, MOST_PAPERS, within=topic or None)
            self._used = time.monotonic()
        return {"query": query, "papers": self._rows(found, built)}

    def similar(self, pdf: str) -> dict | None:
        """A paper's nearest papers, named by its PDF (as the page names papers), or None for a
        paper the library's document doesn't hold."""
        with self._lock:
            space, built = self._current()
            text = next((t for t, paper in built.papers.items() if paper["pdf"] == pdf), None)
            if text is None:
                return None
            found = space.similar(self.library.root / text, SIMILAR)
        return {"pdf": pdf, "papers": self._rows(found, built)}

    def release_idle(self, idle_s: float = IDLE_S) -> bool:
        """Free the model when nothing has used it for `idle_s`; whether it was freed."""
        unload = getattr(self.encoder, "unload", None)
        if unload is None or time.monotonic() - self._used < idle_s:
            return False
        with self._lock:
            freed = unload()
        if freed:
            log.info("meaning search: model freed after %d min idle", idle_s // 60)
        return freed
