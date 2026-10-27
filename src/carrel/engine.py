"""The library, read through the engine's paperlib.py, exactly as the engine's scripts read it.

paperlib.py finds its library when it is imported ($PAPER_LIBRARY, else the working
directory) and keeps the paths as module constants, so it is imported once per process,
after the library is named.
"""

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

DEFAULT_ENGINE = "~/projects/products/agentic-paper-library"
CONFIG_NAME = "paper-library.yaml"


class LibraryError(Exception):
    pass


@dataclass(frozen=True)
class Paper:
    title: str
    year: str
    topic: str  # the folder under the library's papers, e.g. "llm/memory"
    text: str  # the paper file the agent reads, relative to the library root
    pdf: str  # the PDF, relative to pdf_root, with "/" separators


def engine_path(given: str | os.PathLike | None = None) -> Path:
    path = Path(given or os.environ.get("CARREL_ENGINE") or DEFAULT_ENGINE).expanduser().resolve()
    if not (path / "scripts" / "paperlib.py").is_file():
        raise LibraryError(
            f"no engine at {path}: scripts/paperlib.py is missing (pass --engine or set CARREL_ENGINE)"
        )
    return path


def _import_paperlib(root: Path, engine: Path) -> ModuleType:
    loaded = sys.modules.get("paperlib")
    if loaded is not None:
        if Path(loaded.LIBRARY_ROOT).resolve() != root:
            raise LibraryError(f"paperlib is already loaded for {loaded.LIBRARY_ROOT}, not {root}")
        return loaded
    os.environ["PAPER_LIBRARY"] = str(root)
    sys.path.insert(0, str(engine / "scripts"))
    import paperlib

    return paperlib


class Library:
    def __init__(self, root: str | os.PathLike, engine: str | os.PathLike | None = None):
        self.root = Path(root).expanduser().resolve()
        if not (self.root / CONFIG_NAME).is_file():
            raise LibraryError(f"{self.root} is not a library: it has no {CONFIG_NAME}")
        self.engine = engine_path(engine)
        self.lib = _import_paperlib(self.root, self.engine)

    @property
    def pdf_root(self) -> Path:
        return Path(self.lib.PDF_ROOT).resolve()

    @property
    def papers_dir(self) -> Path:
        return Path(self.lib.LIBRARY_DIR).resolve()

    @property
    def notes_dir(self) -> Path:
        return Path(self.lib.NOTES_DIR).resolve()

    @property
    def cache_dir(self) -> Path:
        return Path(self.lib.CACHE_DIR).expanduser().resolve()

    @property
    def overview_dir(self) -> Path | None:
        """The reader's own note per paper, kept outside the library when configured."""
        return Path(self.lib.OVERVIEW_DIR).expanduser().resolve() if self.lib.OVERVIEW_DIR else None

    def outside_folders(self) -> list[Path]:
        """The folders the library's config places outside the library root (the PDFs, the
        overview notes, notes or reviews kept elsewhere), so a session reaches them as it
        reaches the library. Only those that exist."""
        configured = [
            self.lib.PDF_ROOT,
            self.lib.LIBRARY_DIR,
            self.lib.NOTES_DIR,
            self.lib.REVIEWS_DIR,
            self.lib.CATALOG_DIR,
            Path(self.lib.INBOX_FILE).parent,
            self.lib.OVERVIEW_DIR,
        ]
        folders = []
        for folder in configured:
            if folder is None:
                continue
            path = Path(folder).expanduser().resolve()
            if path.is_dir() and not path.is_relative_to(self.root) and path not in folders:
                folders.append(path)
        return folders

    def papers(self) -> list[Paper]:
        """Every paper that has a PDF, by topic and title. Web articles without a printed
        PDF are left out: there is nothing to show above the chat."""
        papers = []
        for path, meta in self.lib.paper_index().items():
            pdf = Path(self.lib.pdf_path_for(path))
            if pdf.is_file():
                rel = pdf.relative_to(self.lib.PDF_ROOT).as_posix()
                papers.append(self._paper(Path(path), meta, rel))
        return sorted(papers, key=lambda p: (p.topic, p.title.lower()))

    def paper_for_pdf(self, rel: str) -> Paper | None:
        """The paper whose PDF is at `rel` under pdf_root, or None when the library has no
        text for it."""
        self.resolve_pdf(rel)
        bare = self.papers_dir / Path(rel).parent / self.lib.paper_stem(rel)
        text = Path(self.lib.paper_file_for(bare))
        if not text.is_file():
            return None
        meta, _ = self.lib.read_paper(text)
        return self._paper(text, meta, rel)

    def paper_info(self, paper: Paper) -> dict:
        """What the library knows of a paper, without reading it: its frontmatter in the
        engine's field order, and whether the agent's note and the reader's overview exist."""
        meta, _ = self.lib.read_paper(self.root / paper.text)
        order = [key for key in self.lib.FIELDS if key in meta]
        order += [key for key in meta if key not in order]
        overview = self.overview_note(paper)
        return {
            "fields": [
                [key, _plain(meta[key])] for key in order if meta[key] not in (None, "", [])
            ],
            "topic": paper.topic,
            "notes": Path(self.lib.note_path(paper.text)).is_file(),
            "overview": bool(overview and overview.is_file()),
        }

    def overview_note(self, paper: Paper) -> Path | None:
        """The reader's overview note for a paper, where the overview skill writes it (and the
        engine's scripts look for it), or None when the library keeps no overview notes."""
        folder = self.overview_dir
        return folder / f"{self.lib.paper_stem(paper.text)}.md" if folder else None

    def resolve_pdf(self, rel: str) -> Path:
        """The PDF at `rel` under pdf_root. Anything that leaves pdf_root, by `..`, an
        absolute path or a symlink, or that is not a PDF, is refused with LookupError."""
        root = self.pdf_root
        target = (root / rel).resolve()
        if (
            not target.is_relative_to(root)
            or target.suffix.lower() != ".pdf"
            or not target.is_file()
        ):
            raise LookupError(rel)
        return target

    def _paper(self, text: Path, meta: dict, pdf: str) -> Paper:
        text = text.resolve()
        return Paper(
            title=str(meta.get("title") or self.lib.paper_stem(text)),
            year=str(meta.get("published") or "")[:4],
            topic=text.parent.relative_to(self.papers_dir).as_posix(),
            text=text.relative_to(self.root).as_posix(),
            pdf=pdf,
        )


def _plain(value: object) -> str | list[str]:
    """A frontmatter value as text: YAML reads dates as dates."""
    if isinstance(value, list):
        return [str(item) for item in value]
    return value.isoformat() if hasattr(value, "isoformat") else str(value)
