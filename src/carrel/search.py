"""Text search over the papers' text layers (`GET /api/search?q=&topic=`).

Ripgrep counts the matches in every paper file, in 0.03–0.25 s over 2,000 papers where Python
takes over a second; the papers with the most matches are then read in Python for a few
snippets each, with the page each is on (the nearest `[page N]` line above it). Ripgrep is
told to read every file as text, hidden and ignored ones too, or it skips some papers, and to
match across lines (-U, which costs nothing here), as a phrase in a paper breaks across them.
"""

import bisect
import re
import shutil
import subprocess
from pathlib import Path

SHORTEST, LONGEST = 3, 200
MOST_PAPERS = 30
SNIPPETS = 3
CONTEXT = 70  # characters of text either side of a match
TIMEOUT_S = 10

# What a regex treats as more than itself, for ripgrep (Rust's regex) and Python alike.
_SPECIAL = re.compile(r"([\\.+*?()|\[\]{}^$#&\-~])")
_PAGE = re.compile(r"^\[page (\d+)\]$", re.M)
_FRONTMATTER_END = re.compile(r"\A---\n.*?\n---\n", re.S)


class SearchError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def pattern(query: str) -> str:
    """The query's words, each as itself, with any run of spaces or a line break between them:
    a layout text puts runs of spaces between words, and a phrase can break across lines."""
    return r"\s+".join(_SPECIAL.sub(r"\\\1", word) for word in query.split())


def _counts(rg: str, regex: str, folder: Path) -> dict[Path, int]:
    command = [rg, "--count-matches", "-i", "-U", "--no-ignore", "--hidden", "-a", "--no-messages"]
    command += ["-g", "*.txt", "-g", "*.md", "-g", "!README.md", "-e", regex, str(folder)]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired as error:
        raise SearchError("The search took too long; try more words.", 504) from error
    if done.returncode not in (0, 1):
        raise SearchError(done.stderr.strip() or "ripgrep failed", 500)
    counts = {}
    for line in done.stdout.splitlines():
        path, _, count = line.rpartition(":")
        if path and count.isdigit():
            counts[Path(path)] = int(count)
    return counts


def _spaced(text: str) -> str:
    """Text with each run of spaces and line breaks made one space, a space at either end
    kept, so the snippet reads as the paper does on either side of the match. The text layer's
    page lines are not the paper's text, and are left out."""
    return re.sub(r"\s+", " ", _PAGE.sub(" ", text))


def _snippets(text: str, compiled: re.Pattern) -> list[dict]:
    head = _FRONTMATTER_END.match(text)
    start = head.end() if head else 0
    marks = [(m.start(), int(m[1])) for m in _PAGE.finditer(text)]
    positions = [at for at, _ in marks]
    hits = []
    for found in compiled.finditer(text, start):
        at = bisect.bisect_right(positions, found.start()) - 1
        before = _spaced(text[max(start, found.start() - CONTEXT) : found.start()])
        after = _spaced(text[found.end() : found.end() + CONTEXT])
        hits.append(
            {
                "page": marks[at][1] if at >= 0 else None,
                "before": before,
                "match": " ".join(found[0].split()),
                "after": after,
            }
        )
        if len(hits) == SNIPPETS:
            break
    return hits


def search(query: str, folder: Path, root: Path, papers: dict[str, dict]) -> dict:
    """The papers under `folder` whose text holds `query`, the most matches first: `papers`
    maps a paper file (relative to `root`) to its entry in the library's document, and only
    those are found (a paper without a PDF is not)."""
    query = " ".join(query.split())
    if not SHORTEST <= len(query) <= LONGEST:
        raise SearchError(f"Search for {SHORTEST} to {LONGEST} characters.", 400)
    rg = shutil.which("rg")
    if not rg:
        raise SearchError("Text search needs ripgrep on the laptop: brew install ripgrep.", 503)
    regex = pattern(query)
    found = []
    for path, count in _counts(rg, regex, folder).items():
        try:
            text = path.resolve().relative_to(root).as_posix()
        except ValueError:
            continue
        if text in papers:
            found.append((count, text))
    found.sort(key=lambda each: (-each[0], papers[each[1]]["title"].lower()))
    compiled = re.compile(regex, re.I)
    results = []
    for count, text in found[:MOST_PAPERS]:
        entry = papers[text]
        body = (root / text).read_text(encoding="utf-8", errors="replace")
        results.append(
            {
                "pdf": entry["pdf"],
                "text": text,
                "title": entry["title"],
                "topic": entry["topic"],
                "count": count,
                "hits": _snippets(body, compiled),
            }
        )
    return {"query": query, "total": len(found), "papers": results}
