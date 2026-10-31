"""The meaning map (`GET /api/map`): the library's papers laid out by what they are about, from
the vectors meaning search keeps, with its regions named by a model.

`map_layout.py` draws a map; this keeps the one drawn last, in the state folder, and draws it
again when a paper or its vector changes (the fingerprint).

- **Answered at once.** A request gets the map as last drawn. When the library has changed since,
  the answer says `drawing` while a new one is drawn in the background, and the page asks again;
  only a library never drawn waits (202).
- **Drawn in a child process** (`python -m carrel.map_layout`). UMAP and numba hold about 250 MB
  once imported, and the server rests at 150 MB; the child draws the map in about 15 s and gives
  it all back when it exits.
- **Named after, off the path that draws.** One model call through Claude Code (no tools, no
  settings, nothing saved) names every region and neighbourhood that has no name. A region holding
  mostly the papers of a named region of the map before keeps its name (`carry_names`), so adding a
  paper renames nothing and asks only about what changed. Until then a region shows the folders
  most of its papers are in.
"""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from . import map_layout
from .usage import state_dir

log = logging.getLogger("carrel")

NAMED_FROM = 20  # a group's most central titles the naming call sees
LONGEST_NAME = 40
NAMES_MODEL = "sonnet"  # unless the library's config names a `filing_model`
DRAW_TIMEOUT_S = 600

NAMES_PROMPT = """\
You are naming the regions of a map of one reader's library of research papers. Each group is a \
set of papers that sit together on the map because their subjects are related; neighbourhoods \
("hood") are smaller groups inside the larger regions ("region"). Papers are listed by title, \
most central first.

Give every group asked about a name of one to four words that a researcher would recognise as \
the field or question its papers share, like the name of a region on a printed map. Prefer the \
specific ("preference optimisation", "click models") to the generic ("methods", "learning"). \
Lower case except for acronyms and proper names, no punctuation. Names must be distinct from \
each other and from the names already on the map, and a neighbourhood's name must not repeat \
its region's.

Answer with a JSON object mapping each group id asked about to its name, and nothing else."""

Namer = Callable[[str, Sequence[str]], Mapping[str, Any]]


@dataclass(frozen=True)
class Served:
    etag: str
    body: bytes
    gzipped: bytes


def map_file(root: Path) -> Path:
    """Where a library's map is kept: one file a library, named by its folder."""
    tag = hashlib.sha256(str(root).encode()).hexdigest()[:8]
    return state_dir() / "maps" / f"{root.name}-{tag}.json"


class MeaningMap:
    """`meaning` is carrel's Meaning, whose space holds the vectors. `namer(prompt, ids)` answers
    `{id: name}` (default: a model through Claude Code); `child=False` draws in this process."""

    def __init__(self, meaning, *, namer: Namer | None = None, child: bool = True):
        self.meaning = meaning
        self.library = meaning.library
        self.path = map_file(self.library.root)
        model = getattr(self.library.lib, "CONFIG", {}).get("filing_model") or NAMES_MODEL
        self.namer = namer or claude_namer(model, self.path.parent)
        self.child = child
        self._guard = threading.Lock()
        self._worker: threading.Thread | None = None
        self._failed: str | None = None  # a fingerprint whose drawing failed: not tried again
        self._served: Served | None = None

    @property
    def drawing(self) -> bool:
        return self._worker is not None

    def current(self) -> Served | None:
        """The map as last drawn, starting to draw a new one when the library has changed or to
        name it when it has regions without names; None when there is none yet."""
        ids, vectors, _ = self.meaning.snapshot()
        wanted = map_layout.fingerprint(self.meaning.encoder.model, ids, vectors)
        stored = self._read()
        fresh = stored is not None and stored.get("fingerprint") == wanted
        if (not fresh and self._failed != wanted) or (fresh and stored["names"] == "pending"):
            self._start()
        if stored is None:
            return None
        return self._serve(
            stored, drawing=self.drawing and not (fresh and stored["names"] != "pending")
        )

    def warm(self) -> None:
        """Draws the map in a thread if it is out of date, once the space is built."""

        def run() -> None:
            try:
                self.current()
            except Exception:
                log.exception("meaning map: could not start")

        threading.Thread(target=run, name="meaning-map-warm", daemon=True).start()

    def _serve(self, stored: dict, drawing: bool) -> Served:
        etag = f'"{stored["fingerprint"]}.{stored["names"]}.{int(drawing)}"'
        if self._served is None or self._served.etag != etag:
            body = json.dumps({**stored, "drawing": drawing}, separators=(",", ":")).encode()
            self._served = Served(etag, body, gzip.compress(body, 6))
        return self._served

    # Drawing and naming, one worker at a time.

    def _start(self) -> None:
        with self._guard:
            if self._worker is not None:
                return
            self._worker = threading.Thread(target=self._work, name="meaning-map", daemon=True)
            self._worker.start()

    def _work(self) -> None:
        try:
            while self._step():
                pass
        except Exception:
            log.exception("meaning map: the worker stopped")
        finally:
            with self._guard:
                self._worker = None

    def _step(self) -> bool:
        """Draws or names what is out of date; whether there may be more to do."""
        ids, vectors, built = self.meaning.snapshot()
        model = self.meaning.encoder.model
        wanted = map_layout.fingerprint(model, ids, vectors)
        stored = self._read()
        if stored is None or stored.get("fingerprint") != wanted:
            if self._failed == wanted:
                return False
            began = time.monotonic()
            topics = [built.papers.get(paper, {}).get("topic", "") for paper in ids]
            previous = {p["id"]: (p["x"], p["y"]) for p in stored["points"]} if stored else None
            try:
                body = self._draw(ids, topics, vectors, previous)
            except Exception:
                log.exception("meaning map: could not draw %d papers", len(ids))
                self._failed = wanted
                return False
            left = map_layout.carry_names(body, stored)
            body.update(
                fingerprint=wanted,
                model=model,
                drawn=time.strftime("%Y-%m-%dT%H:%M:%S"),
                names="pending" if left else ("ready" if body["regions"] else "none"),
            )
            self._write(body)
            log.info(
                "meaning map: %d papers drawn in %.0f s, %d regions to name",
                len(ids),
                time.monotonic() - began,
                left,
            )
            return True
        if stored["names"] == "pending":
            self._name(stored, built.papers)
            return True
        return False

    def _draw(self, ids, topics, vectors, previous) -> dict:
        if not self.child:
            return map_layout.build(ids, topics, vectors, previous)
        with tempfile.TemporaryDirectory(prefix="carrel-map-") as folder:
            given, drawn = Path(folder) / "in.npz", Path(folder) / "out.json"
            np.savez(
                given,
                ids=np.array(ids),
                topics=np.array(topics),
                vectors=vectors,
                previous=np.array(json.dumps(previous or {})),
            )
            done = subprocess.run(
                [sys.executable, "-m", "carrel.map_layout", str(given), str(drawn)],
                capture_output=True,
                text=True,
                timeout=DRAW_TIMEOUT_S,
            )
            if done.returncode != 0:
                raise RuntimeError(f"the drawing exited {done.returncode}: {done.stderr[-2000:]}")
            return json.loads(drawn.read_text(encoding="utf-8"))

    def _name(self, stored: dict, papers: Mapping[str, dict]) -> None:
        asked = [region["id"] for region in stored["regions"] if not region.get("name")]
        began = time.monotonic()
        try:
            named = parse_names(self.namer(names_request(stored, papers), asked), asked)
        except Exception:
            log.exception("meaning map: naming failed")
            named = {}
        for region in stored["regions"]:
            if region["id"] in named:
                region["name"] = named[region["id"]]
        # A naming that failed, or left some out, is not asked again until the map changes:
        # those regions keep their folders.
        stored["names"] = "ready" if len(named) == len(asked) else "none"
        self._write(stored)
        log.info(
            "meaning map: %d of %d regions named in %.0f s",
            len(named),
            len(asked),
            time.monotonic() - began,
        )

    # The stored map.

    def _read(self) -> dict | None:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write(self, body: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        partial = self.path.with_name(f"{self.path.name}.{os.getpid()}.part")
        partial.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8")
        os.replace(partial, self.path)


# The names.


def names_request(stored: Mapping[str, Any], papers: Mapping[str, dict]) -> str:
    """The groups without a name, each with its level, its region and its most central titles,
    after the names already on the map."""
    points = stored["points"]
    kept = [region["name"] for region in stored["regions"] if region.get("name")]
    lines = []
    if kept:
        lines += ["Names already on the map: " + "; ".join(kept), ""]
    for region in stored["regions"]:
        if region.get("name"):
            continue
        inside = f" (inside r{region['region']})" if region["level"] == "hood" else ""
        lines.append(f"## {region['id']}: {region['level']}{inside}")
        chosen = sorted(map_layout.members(stored, region), key=lambda i: -points[i]["rank"])
        for i in chosen[:NAMED_FROM]:
            title = papers.get(points[i]["id"], {}).get("title")
            if title:
                lines.append(f"- {' '.join(str(title).split())}")
        lines.append("")
    return "\n".join(lines)


def parse_names(reply: Any, asked: Sequence[str]) -> dict[str, str]:
    """Only the ids asked about, only non-empty strings, trimmed and bounded: a name for a group
    that does not exist is dropped, not trusted."""
    if not isinstance(reply, Mapping):
        return {}
    wanted = set(asked)
    out = {}
    for key, value in reply.items():
        if key in wanted and isinstance(value, str):
            name = " ".join(value.split()).strip(" .·\"'")
            if len(name) > LONGEST_NAME:
                name = name[: LONGEST_NAME + 1].rsplit(" ", 1)[0]
            if name:
                out[key] = name
    return out


def claude_namer(model: str, folder: Path) -> Namer:
    """One request to `model` through the SDK's Claude Code: no tools, none of the reader's
    settings, nothing saved, run in the maps' folder so no chat list shows it."""

    def name(prompt: str, ids: Sequence[str]) -> Mapping[str, Any]:
        return asyncio.run(_ask(model, folder, prompt, list(ids)))

    return name


async def _ask(model: str, folder: Path, prompt: str, ids: list[str]) -> Mapping[str, Any]:
    from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

    folder.mkdir(parents=True, exist_ok=True)
    schema = {
        "type": "object",
        "properties": {key: {"type": "string"} for key in ids},
        "required": ids,
        "additionalProperties": False,
    }
    options = ClaudeAgentOptions(
        cwd=folder,
        model=model,
        tools=[],
        setting_sources=[],
        max_turns=3,
        system_prompt=NAMES_PROMPT,
        output_format={"type": "json_schema", "schema": schema},
        extra_args={"no-session-persistence": None},
    )
    reply: Any = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            if message.is_error:
                raise RuntimeError(f"the model answered with an error: {message.result}")
            reply = getattr(message, "structured_output", None)
            if reply is None and message.result:
                reply = json.loads(message.result)
    return reply
