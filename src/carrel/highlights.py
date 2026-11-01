"""The reader's highlights in every paper's PDF, for the mark on a paper's row and the list in
its contents.

The PDFs themselves are read, whichever app made the highlights (carrel, vscode-pdf-viewer, a
tablet's reader through the synced folder), with the engine's `highlights.py` (PyMuPDF): about
6 ms a paper, so 14 s for 2,275 papers the first time. What was found is kept in the state
folder with each PDF's version (its modification time and size), and only a PDF that changed
is read again: when the server starts, when the library's document is asked for (at most once
a minute), and at once after carrel saves a paper.
"""

import json
import logging
import os
import threading
import time
from pathlib import Path

from .engine import Library
from .usage import state_dir

log = logging.getLogger("carrel")

# How often the PDFs are looked over again for changes made elsewhere.
EVERY_S = 60

# PyMuPDF is not safe in two threads at once: one PDF is read at a time.
_reading = threading.Lock()


def file_version(stat: os.stat_result) -> str:
    return f"{stat.st_mtime_ns}-{stat.st_size}"


class Highlights:
    def __init__(self, library: Library, path: Path | None = None):
        self.library = library
        self.path = path or state_dir() / "highlights" / f"{library.root.name}.json"
        self.revision = 0  # changes whenever a paper's count does
        self._lock = threading.Lock()
        self._known: dict[str, dict] | None = None  # pdf -> {version, items}
        self._refreshing = False
        self._checked = 0.0

    def counts(self) -> dict[str, int]:
        """How many highlights each PDF that has any holds, by its path under pdf_root."""
        with self._lock:
            known = self._loaded()
            return {pdf: len(entry["items"]) for pdf, entry in known.items() if entry["items"]}

    def items(self, rel: str) -> list[dict]:
        """A PDF's highlights, read again when it changed since. LookupError for a path that is
        not a PDF of the library."""
        path = self.library.resolve_pdf(rel)
        version = file_version(path.stat())
        with self._lock:
            entry = self._loaded().get(rel)
            if entry and entry["version"] == version:
                return entry["items"]
        items = self._read(path)
        with self._lock:
            self._store(rel, version, items)
            self._save()
        return items

    def refresh(self) -> None:
        """Reads again every PDF that changed since it was last read, and forgets those gone."""
        started = time.monotonic()
        root = self.library.pdf_root
        found: dict[str, str] = {}
        for folder, folders, files in os.walk(root):
            folders[:] = [name for name in folders if not name.startswith(".")]
            for name in files:
                if name.lower().endswith(".pdf") and not name.startswith("."):
                    path = Path(folder) / name
                    try:
                        found[path.relative_to(root).as_posix()] = file_version(path.stat())
                    except OSError:
                        continue
        with self._lock:
            known = self._loaded()
            changed = [
                rel
                for rel, version in found.items()
                if known.get(rel, {}).get("version") != version
            ]
            gone = [rel for rel in known if rel not in found]
            for rel in gone:
                if known.pop(rel)["items"]:
                    self.revision += 1
        for rel in changed:
            items = self._read(root / rel)
            with self._lock:
                self._store(rel, found[rel], items)
        if changed or gone:
            with self._lock:
                self._save()
            log.info(
                "highlights: %d PDFs read in %.1f s, %d with highlights",
                len(changed),
                time.monotonic() - started,
                len(self.counts()),
            )

    def refresh_soon(self, every: float = EVERY_S) -> None:
        """Looks the PDFs over in a thread, unless that was done in the last `every` seconds
        or is being done."""
        with self._lock:
            if self._refreshing or time.monotonic() - self._checked < every:
                return
            self._refreshing = True
            self._checked = time.monotonic()
        threading.Thread(target=self._refresh_once, name="carrel-highlights", daemon=True).start()

    def _refresh_once(self) -> None:
        try:
            self.refresh()
        except Exception:
            log.exception("highlights: the PDFs could not be looked over")
        finally:
            with self._lock:
                self._refreshing = False
                self._checked = time.monotonic()

    def _read(self, path: Path) -> list[dict]:
        try:
            with _reading:
                return self.library.read_highlights(path)
        except Exception as error:  # a PDF PyMuPDF cannot open is a PDF with no highlights
            log.warning("highlights: could not read %s: %s", path.name, error)
            return []

    def _store(self, rel: str, version: str, items: list[dict]) -> None:
        known = self._loaded()
        before = len(known.get(rel, {}).get("items") or [])
        known[rel] = {"version": version, "items": items}
        if len(items) != before:  # the library's document shows the counts only
            self.revision += 1

    def _loaded(self) -> dict[str, dict]:
        if self._known is None:
            try:
                saved = json.loads(self.path.read_text(encoding="utf-8"))
                self._known = (
                    saved.get("pdfs", {}) if saved.get("root") == str(self.library.pdf_root) else {}
                )
            except (OSError, ValueError):
                self._known = {}
        return self._known

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        partial = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
        partial.write_text(
            json.dumps(
                {"root": str(self.library.pdf_root), "pdfs": self._known}, ensure_ascii=False
            ),
            encoding="utf-8",
        )
        os.replace(partial, partial.with_name(self.path.name))
