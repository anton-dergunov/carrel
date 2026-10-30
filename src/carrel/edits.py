"""Adding papers to the library and taking them out, from the page: the engine's own commands,
run one at a time, their output streamed back as they print it.

- an arXiv id or address: `paperlib add`, which asks a model for the folder and the summary;
- a web page's address, into an area the reader picks: `paperlib add-web`;
- a PDF the page uploads, into an area the reader picks: `paperlib add-pdf`;
- a paper out: `paperlib remove --yes`, which deletes its text, PDF and the agent's note (the
  reader's overview note and the reviews stay), and with a reason records it as skipped.

Each answer is a stream of JSON lines: {"line": text} as the command prints, then {"done":
true, "code": n, …what happened}. What happened is read from the library, not the exit code:
`paperlib add` exits 0 for a paper it already has, and `remove` exits 1 when the library's
check afterwards finds a review still linking the paper it removed. So an add says which
papers appeared ({"added": [{pdf, title}]}), and a remove whether the paper is gone
({"removed": bool}). The engine rebuilds the indexes after each, and the library's document
follows (catalog.py notices the change).
"""

import asyncio
import json
import os
import re
import tempfile
from collections.abc import AsyncIterator, Callable
from pathlib import Path

from .engine import Library

ARXIV = re.compile(
    r"^(?:https?://(?:www\.)?(?:export\.)?arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/?$"
)
WEB = re.compile(r"^https?://[^\s/]+\.[^\s]+$")
LONGEST_TITLE = 300
LONGEST_REASON = 300


class EditError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def arxiv_id(source: str) -> str | None:
    found = ARXIV.match(source.strip())
    return found[1] if found else None


class Edits:
    """The library's add and remove, one at a time. `command(args)` makes the command line
    for `paperlib <args>` (the engine's bin/paperlib, in the library)."""

    def __init__(self, library: Library, command: Callable[[list[str]], list[str]] | None = None):
        self.library = library
        self.command = command or (lambda args: [str(library.engine / "bin" / "paperlib"), *args])
        self.running = asyncio.Lock()
        self._finishing: set[asyncio.Task] = set()

    def _topic(self, topic: str | None) -> str:
        topic = (topic or "").strip("/")
        if topic not in self.library.topics():
            raise EditError("Choose one of the library's areas.")
        return topic

    def add_args(
        self, source: str, topic: str | None = None, title: str | None = None
    ) -> list[str]:
        """The command that adds `source`: an arXiv paper, filed by the engine, or a web page,
        into `topic`."""
        source = source.strip()
        found = arxiv_id(source)
        if found:
            return ["add", found]
        if WEB.match(source):
            args = ["add-web", source, self._topic(topic)]
            if title:
                args += ["--title", _one_line(title, LONGEST_TITLE)]
            return args
        raise EditError("Give an arXiv id or address, or a web page's address.")

    def pdf_args(self, pdf: Path, topic: str | None, title: str | None) -> list[str]:
        args = ["add-pdf", str(pdf), self._topic(topic)]
        if title:
            args += ["--title", _one_line(title, LONGEST_TITLE)]
        return args

    def remove_args(self, rel: str, reason: str | None = None) -> list[str]:
        try:
            paper = self.library.paper_for_pdf(rel)
        except LookupError as error:
            raise EditError("No such paper in the library.", 404) from error
        if not paper:
            raise EditError("No such paper in the library.", 404)
        args = ["remove", paper.text, "--yes"]
        if reason and reason.strip():
            args += ["--reason", _one_line(reason, LONGEST_REASON)]
        return args

    def papers_now(self) -> set[Path]:
        return set(self.library.lib.paper_files())

    def added_since(self, before: set[Path]) -> dict:
        """The papers that appeared since `before`, with their PDFs."""
        added = []
        for path in sorted(self.papers_now() - before):
            pdf = Path(self.library.lib.pdf_path_for(path))
            if pdf.is_file():
                meta, _ = self.library.lib.read_paper(path)
                rel = pdf.relative_to(self.library.lib.PDF_ROOT).as_posix()
                added.append({"pdf": rel, "title": str(meta.get("title") or path.stem)})
        return {"added": added}

    def gone(self, args: list[str]) -> dict:
        """Whether the paper a remove named is no longer in the library."""
        return {"removed": not (self.library.root / args[1]).exists()}

    async def run(
        self,
        args: list[str],
        cleanup: Path | None = None,
        outcome: Callable[[], dict] | None = None,
    ) -> AsyncIterator[bytes]:
        """Runs `paperlib <args>`, yielding its output as JSON lines, then the exit code and
        `outcome()`, what the library says happened; refused while another runs."""
        if self.running.locked():
            raise EditError("Another paper is being added or removed; wait for it.", 409)
        await self.running.acquire()

        async def stream() -> AsyncIterator[bytes]:
            process = None
            ended = False
            try:
                env = dict(os.environ, PAPER_LIBRARY=str(self.library.root))
                process = await asyncio.create_subprocess_exec(
                    *self.command(args),
                    cwd=self.library.root,
                    env=env,
                    stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
                async for raw in process.stdout:
                    yield _line({"line": _plain(raw.decode("utf-8", "replace").rstrip("\n"))})
                code = await process.wait()
                ended = True
                happened = await asyncio.to_thread(outcome) if outcome else {}
                yield _line({"done": True, "code": code, **happened})
            finally:
                if process and not ended:
                    # The page left: the command runs to its end, and the next waits for it.
                    task = asyncio.get_running_loop().create_task(self._finish(process, cleanup))
                    self._finishing.add(task)
                    task.add_done_callback(self._finishing.discard)
                else:
                    discard_upload(cleanup)
                    self.running.release()

        return stream()

    async def _finish(self, process, cleanup: Path | None) -> None:
        try:
            async for _ in process.stdout:
                pass
            await process.wait()
        finally:
            discard_upload(cleanup)
            self.running.release()


def discard_upload(upload: Path | None) -> None:
    """An uploaded PDF's temporary file and its folder, once the command is done with it."""
    if upload:
        upload.unlink(missing_ok=True)
        try:
            upload.parent.rmdir()
        except OSError:
            pass


async def save_upload(chunks: AsyncIterator[bytes], name: str, limit: int) -> Path:
    """An uploaded PDF, into a temporary file named as the reader's file was."""
    stem = re.sub(r"[^\w .,()&'-]+", " ", Path(name or "paper.pdf").stem).strip() or "paper"
    folder = Path(tempfile.mkdtemp(prefix="carrel-add-"))
    path = folder / f"{stem[:120]}.pdf"
    size = 0
    with open(path, "wb") as file:
        async for chunk in chunks:
            size += len(chunk)
            if size > limit:
                file.close()
                path.unlink()
                raise EditError("Too large for a paper.", 413)
            file.write(chunk)
    with open(path, "rb") as file:
        if file.read(5) != b"%PDF-":
            path.unlink()
            raise EditError("That is not a PDF.")
    return path


def _one_line(text: str, longest: int) -> str:
    return " ".join(str(text).split())[:longest]


_ESCAPES = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _plain(text: str) -> str:
    """A line as the page shows it: without the terminal's colours."""
    return _ESCAPES.sub("", text)


def _line(entry: dict) -> bytes:
    return (json.dumps(entry, ensure_ascii=False) + "\n").encode("utf-8")
