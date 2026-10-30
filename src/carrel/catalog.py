"""The library as one document for the page: every paper with what the library knows of it,
the topics and the reviews (`GET /api/library`).

Building it takes about a second on a library of 2,000 papers, most of it checking that
each PDF is there and reading the notes' heads. Checking whether anything changed takes a
hundredth of that: a walk that counts the files of the folders it is built from and finds
the latest change. So the document is kept, with its gzip and an ETag, and built again
only when that signature changes.
"""

import gzip
import hashlib
import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from .engine import Library
from .usage import discussed, transcripts_dir

# The frontmatter a row shows, in this order; empty ones are left out.
FIELDS = ("title", "authors", "published", "added", "summary", "arxiv")


@dataclass(frozen=True)
class Built:
    body: bytes
    gzipped: bytes
    etag: str


def _stamp(path: Path, deep: bool = True, suffix: str = "") -> tuple[int, int]:
    """How many files a folder holds and the latest time one, or the folder, changed. A file
    that is added, removed or edited changes it."""
    count, latest = 0, 0
    try:
        latest = path.stat().st_mtime_ns
    except OSError:
        return 0, 0
    if not path.is_dir():
        return 1, latest
    stack = [path]
    while stack:
        try:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if deep and not entry.name.startswith("."):
                                stack.append(Path(entry.path))
                                latest = max(latest, entry.stat().st_mtime_ns)
                        elif entry.name.endswith(suffix):
                            count += 1
                            latest = max(latest, entry.stat().st_mtime_ns)
                    except OSError:
                        continue
        except OSError:
            continue
    return count, latest


def _plain(value: object) -> object:
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    return str(value) if value not in (None, "") else None


class Catalog:
    def __init__(self, library: Library, transcripts: Path | None = None):
        self.library = library
        self.transcripts = transcripts or transcripts_dir(library.root)
        self._lock = threading.Lock()
        self._signature: tuple | None = None
        self._built: Built | None = None

    def signature(self) -> tuple:
        library = self.library
        overview = library.overview_dir
        return (
            _stamp(library.papers_dir),
            _stamp(library.notes_dir, deep=False),
            _stamp(overview, deep=False) if overview else None,
            _stamp(library.reviews_dir),
            _stamp(library.topics_file),
            _stamp(self.transcripts, deep=False, suffix=".jsonl"),
        )

    def current(self) -> Built:
        """The document, built again when the library has changed since it was last built."""
        with self._lock:
            signature = self.signature()
            if self._built is None or signature != self._signature:
                body = json.dumps(self.document(), ensure_ascii=False, separators=(",", ":"))
                data = body.encode("utf-8")
                self._built = Built(
                    data,
                    gzip.compress(data, compresslevel=6, mtime=0),
                    '"' + hashlib.sha256(data).hexdigest()[:32] + '"',
                )
                self._signature = signature
            return self._built

    def document(self) -> dict:
        library = self.library
        reviews = library.reviews()
        cited: dict[str, list[str]] = {}
        for review in reviews:
            for text in review["cites"]:
                cited.setdefault(text, []).append(review["scope"])
        chats = discussed(library.root, self.transcripts)
        overviews = library.overview_names()

        papers, counts = [], {}
        for paper, meta in library.entries():
            entry = {"pdf": paper.pdf, "text": paper.text}
            for field in FIELDS:
                value = _plain(meta.get(field))
                if value:
                    entry[field] = value
            entry.setdefault("title", paper.title)
            entry["topic"] = paper.topic
            kind = library.paper_type(paper.text, meta)
            if kind:
                entry["type"] = kind
            if library.has_overview(paper, overviews):
                entry["overview"] = True
            if paper.text in cited:
                entry["reviews"] = cited[paper.text]
            if chats.get(paper.text):
                entry["chats"] = chats[paper.text]
            papers.append(entry)
            counts[paper.topic] = counts.get(paper.topic, 0) + 1

        return {
            "library": library.root.name,
            "papers": papers,
            "topics": _topics(library.topics(), counts),
            "reviews": [
                {
                    **{key: review[key] for key in ("scope", "title", "updated", "path")},
                    "abstract": review["abstract"],
                    "cites": len(review["cites"]),
                }
                for review in reviews
            ],
        }


def _topics(declared: dict[str, str], counts: dict[str, int]) -> list[dict]:
    """Each topic with its scope, its own papers (`count`) and those under it (`total`): the
    declared ones in the file's order, then any folder holding papers that is not declared."""
    paths = list(declared) + sorted(topic for topic in counts if topic not in declared)
    totals = dict.fromkeys(paths, 0)
    for topic, count in counts.items():
        parts = topic.split("/")
        for depth in range(1, len(parts) + 1):
            ancestor = "/".join(parts[:depth])
            if ancestor in totals:
                totals[ancestor] += count
    return [
        {
            "path": path,
            "scope": declared.get(path, ""),
            "count": counts.get(path, 0),
            "total": totals[path],
        }
        for path in paths
    ]
