"""The library, read through the engine's paperlib.py, exactly as the engine's scripts read it.

paperlib.py finds its library when it is imported ($PAPER_LIBRARY, else the working
directory) and keeps the paths as module constants, so it is imported once per process,
after the library is named.
"""

import os
import re
import sys
import unicodedata
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

    @property
    def reviews_dir(self) -> Path:
        return Path(self.lib.REVIEWS_DIR).resolve()

    @property
    def topics_file(self) -> Path:
        return Path(self.lib.TOPICS_FILE).resolve()

    def entries(self) -> list[tuple[Paper, dict]]:
        """Every paper that has a PDF, with its frontmatter (as JSON holds it: dates are
        strings), by topic and title. Web articles without a printed PDF are left out: there
        is nothing to show above the chat."""
        entries = []
        for path, meta in self.lib.paper_index().items():
            pdf = Path(self.lib.pdf_path_for(path))
            if pdf.is_file():
                rel = pdf.relative_to(self.lib.PDF_ROOT).as_posix()
                entries.append((self._paper(Path(path), meta, rel), meta))
        return sorted(entries, key=lambda entry: (entry[0].topic, entry[0].title.lower()))

    def papers(self) -> list[Paper]:
        return [paper for paper, _ in self.entries()]

    def topics(self) -> dict[str, str]:
        """The declared topic tree, {folder: scope}, in the file's order."""
        return {str(path): str(scope or "") for path, scope in self.lib.load_topics().items()}

    def reading(self, paper_text: str, meta: dict) -> tuple[str | None, bool]:
        """The paper's type, and whether the agent has read it (its note has a digest), from
        one read of its note. The type is the frontmatter's, else the one the reading gave;
        that fallback goes when the frontmatter always has it (the engine's paper-types task)."""
        note = self.lib.read_note(self.root / paper_text)
        kind = meta.get("type")
        if kind not in self.lib.TYPES:
            kind = (note or {}).get("fields", {}).get("type")
        return kind, bool(note and note["digest"] is not None)

    def review_scopes(self) -> list[dict]:
        """The areas to read and review, in their order: [{group, scopes: [scope]}]."""
        return [{"group": group, "scopes": scopes} for group, scopes in self.lib.review_scopes()]

    def overview_names(self) -> set[str]:
        """The stems of the papers that have an overview note, from one listing of its folder."""
        folder = self.overview_dir
        if not folder or not folder.is_dir():
            return set()
        return {_nfc(path.stem) for path in folder.glob("*.md")}

    def has_overview(self, paper: Paper, names: set[str]) -> bool:
        return _nfc(self.lib.paper_stem(paper.text)) in names

    def reviews(self) -> list[dict]:
        """Every literature review: its scope, title, date, file, the first paragraph of its
        abstract, and the paper files it cites (relative to the library root), by scope."""
        found = []
        for scope, review in sorted(self.lib.load_reviews().items()):
            meta = review["meta"]
            main = Path(review["main"]).resolve()
            cites: list[str] = []
            for path in review["files"]:
                for _, resolved, exists in self.lib.review_links(path):
                    rel = self._paper_file(Path(resolved)) if exists else None
                    if rel and rel not in cites:
                        cites.append(rel)
            found.append(
                {
                    "scope": scope,
                    "title": str(meta.get("title") or scope),
                    "updated": _plain(meta["updated"]) if meta.get("updated") else "",
                    "checked": _plain(meta["checked"]) if meta.get("checked") else "",
                    "path": main.relative_to(self.root).as_posix()
                    if main.is_relative_to(self.root)
                    else str(main),
                    "abstract": _abstract(main.read_text(encoding="utf-8")),
                    "cites": cites,
                }
            )
        return found

    def review(self, scope: str) -> dict | None:
        """A review to read: its markdown (each of its files without its frontmatter), and
        what its links lead to, {target as written: {text, pdf} for a paper, {review: scope}
        for another review}. None when the library has no review of `scope`."""
        reviews = self.lib.load_reviews()
        review = reviews.get(scope)
        if not review:
            return None
        mains = {Path(each["main"]).resolve(): name for name, each in reviews.items()}
        parts, links = [], {}
        for path in review["files"]:
            meta, body = self.lib.split_frontmatter(Path(path).read_text(encoding="utf-8"))
            parts.append(body.strip("\n"))
            for target, resolved, exists in self.lib.review_links(path):
                if target in links or not exists:
                    continue
                resolved = Path(resolved).resolve()
                if resolved in mains:
                    links[target] = {"review": mains[resolved]}
                    continue
                text = self._paper_file(resolved)
                pdf = Path(self.lib.pdf_path_for(resolved)) if text else None
                if pdf and pdf.is_file():
                    links[target] = {
                        "text": text,
                        "pdf": pdf.relative_to(self.lib.PDF_ROOT).as_posix(),
                    }
        meta = review["meta"]
        return {
            "scope": scope,
            "title": str(meta.get("title") or scope),
            "updated": _plain(meta["updated"]) if meta.get("updated") else "",
            "markdown": "\n\n".join(parts) + "\n",
            "links": links,
        }

    def _paper_file(self, path: Path) -> str | None:
        """A link's target as a paper file relative to the library root, or None when it is
        not a paper (another review, a doc)."""
        path = path.resolve()
        if path.suffix not in self.lib.PAPER_SUFFIXES or path.name == "README.md":
            return None
        if not path.is_relative_to(self.papers_dir):
            return None
        return path.relative_to(self.root).as_posix() if path.is_relative_to(self.root) else None

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
        note = self.lib.read_note(self.root / paper.text)
        return {
            "fields": [
                [key, _plain(meta[key])] for key in order if meta[key] not in (None, "", [])
            ],
            "topic": paper.topic,
            "notes": note is not None,
            "overview": bool(overview and overview.is_file()),
            # What the agent's reading wrote: its type, family and evidence, and the digest.
            **({"note": {**note["fields"], "digest": note["digest"] or ""}} if note else {}),
        }

    def overview_note(self, paper: Paper) -> Path | None:
        """The reader's overview note for a paper, where the overview skill writes it (and the
        engine's scripts look for it), or None when the library keeps no overview notes."""
        folder = self.overview_dir
        return folder / f"{self.lib.paper_stem(paper.text)}.md" if folder else None

    def paper_for_overview_note(self, path: str) -> Paper | None:
        """The paper whose overview note is at `path`, the laptop's path the overview skill
        gives in its reply, or None for any other file."""
        folder = self.overview_dir
        note = Path(path)
        if not folder or not note.is_absolute() or note.suffix != ".md":
            return None
        if _nfc(str(note.parent.resolve())) != _nfc(str(folder)):
            return None
        name = _nfc(note.stem)
        return next(
            (paper for paper in self.papers() if _nfc(self.lib.paper_stem(paper.text)) == name),
            None,
        )

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


_CALLOUT = re.compile(r"^> \[!abstract\][^\n]*\n((?:>[^\n]*\n?)*)", re.M | re.I)
_INLINE_LINK = re.compile(r"\[([^\]\n]+)\](?:\([^)\s]*\)|\[[^\]\n]*\])")


def _abstract(text: str) -> str:
    """The first paragraph of a review's `> [!abstract]` callout, as plain text."""
    found = _CALLOUT.search(text)
    if not found:
        return ""
    lines = [line[1:].strip() for line in found[1].splitlines()]
    paragraph = " ".join(lines[: lines.index("")] if "" in lines else lines)
    paragraph = _INLINE_LINK.sub(r"\1", paragraph)
    return re.sub(r"\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)|`", "", paragraph).strip()


def _nfc(text: str) -> str:
    """A name as one Unicode form: a synced folder may hand back another."""
    return unicodedata.normalize("NFC", text)
