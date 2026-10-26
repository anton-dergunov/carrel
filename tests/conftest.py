"""One small library for the whole run: paperlib.py reads its library when it is imported."""

import os
from pathlib import Path

import pytest

from carrel.engine import Library

PAPER = """---
title: "Wide & Deep: A Test Paper"
authors: [A. Author]
published: 2016-06-24
source: pdf
summary: A paper for the tests.
added: 2026-10-26
---
[page 1]
Hello.
"""


@pytest.fixture(scope="session")
def library(tmp_path_factory) -> Library:
    root = tmp_path_factory.mktemp("library")
    overview = tmp_path_factory.mktemp("overview")
    (root / "paper-library.yaml").write_text(
        f"reader: the reader\npdf_root: pdfs\noverview_dir: {overview}\n"
    )
    topic = root / "library" / "recsys"
    topic.mkdir(parents=True)
    (topic / "Wide & Deep. A Test Paper.txt").write_text(PAPER)
    (topic / "No PDF Yet.txt").write_text(PAPER.replace("Wide & Deep: A Test Paper", "No PDF Yet"))
    pdfs = root / "pdfs" / "recsys"
    pdfs.mkdir(parents=True)
    (pdfs / "Wide & Deep. A Test Paper.pdf").write_bytes(b"%PDF-1.4\n" + b"0" * 2000 + b"\n%%EOF\n")
    outside = tmp_path_factory.mktemp("outside")
    (outside / "secret.pdf").write_bytes(b"%PDF-1.4 secret")
    (root / "pdfs" / "escape.pdf").symlink_to(outside / "secret.pdf")
    (root / "pdfs" / "notes.txt").write_text("not a pdf")

    os.environ["PAPERS_CACHE"] = str(tmp_path_factory.mktemp("cache"))
    return Library(root)


@pytest.fixture(autouse=True)
def state(tmp_path, monkeypatch) -> Path:
    """Permission answers are logged here, not in the reader's own state folder."""
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    return tmp_path / "state"
