"""One small library for the whole run: paperlib.py reads its library when it is imported.

It is the engine's example library (two arXiv papers and a web article, their PDFs not
committed, so empty ones stand in), with carrel's own test papers, notes and a review added.
"""

import os
import shutil
from pathlib import Path

import pytest

from carrel.engine import Library, engine_path

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

DPO = "llm/post-training/preference-learning/Direct Preference Optimization. Your Language Model is Secretly a Reward Model"
LARIMAR = "llm/memory/parametric/Larimar. Large Language Models with Episodic Memory Control"
WIDE = "recsys/Wide & Deep. A Test Paper"

REVIEW = """---
scope: recsys
title: Recommender systems
updated: 2026-10-12
---

# Recommender systems

> [!abstract]
> Recommenders **rank** items for a person; [Wide & Deep][wide] joins a memorising part
> and a generalising one.
>
> A second paragraph the card leaves out.

## Introduction

Joint training helps ([p. 1][wide@1]). Preferences can also be learned directly ([DPO][dpo]),
and the [memory review](llm/memory.md) is elsewhere. See [the web](https://example.com).

[wide]: ../library/recsys/Wide%20%26%20Deep.%20A%20Test%20Paper.txt
[wide@1]: http://pdf.invalid/recsys/Wide%20%26%20Deep.%20A%20Test%20Paper.pdf?page=1
[dpo]: ../library/llm/post-training/preference-learning/Direct%20Preference%20Optimization.%20Your%20Language%20Model%20is%20Secretly%20a%20Reward%20Model.txt
"""


def empty_pdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4\n" + b"0" * 2000 + b"\n%%EOF\n")


@pytest.fixture(scope="session")
def library(tmp_path_factory) -> Library:
    root = tmp_path_factory.mktemp("example") / "library"
    shutil.copytree(
        engine_path() / "examples" / "library",
        root,
        ignore=shutil.ignore_patterns("pdfs", ".claude"),
    )
    overview = tmp_path_factory.mktemp("overview")
    config = root / "paper-library.yaml"
    config.write_text(config.read_text() + f"overview_dir: {overview}\n")
    with open(root / "catalog" / "topics.yaml", "a") as topics:
        topics.write("recsys: Recommender systems — ranking items for a person.\n")

    # The example's two arXiv papers have PDFs here; its web article has none.
    for stem in (DPO, LARIMAR):
        empty_pdf(root / "pdfs" / f"{stem}.pdf")
    # The type is the frontmatter's, never the note's: Larimar's note says study.
    notes = root / "notes"
    notes.mkdir(exist_ok=True)
    (notes / f"{Path(DPO).name}.md").write_text(
        "# DPO\n\ntype: method\nfamily: preference optimisation\n\n## Digest\n\n- a claim\n"
    )
    (notes / f"{Path(LARIMAR).name}.md").write_text("# Larimar\n\ntype: study\n\n## Digest\n")
    larimar = root / "library" / f"{LARIMAR}.txt"
    larimar.write_text(
        larimar.read_text().replace("\ntype: method\n", "\ntype: system\n", 1)
    )

    topic = root / "library" / "recsys"
    topic.mkdir(parents=True)
    (topic / "Wide & Deep. A Test Paper.txt").write_text(PAPER)
    (topic / "No PDF Yet.txt").write_text(PAPER.replace("Wide & Deep: A Test Paper", "No PDF Yet"))
    empty_pdf(root / "pdfs" / f"{WIDE}.pdf")
    outside = tmp_path_factory.mktemp("outside")
    (outside / "secret.pdf").write_bytes(b"%PDF-1.4 secret")
    (root / "pdfs" / "escape.pdf").symlink_to(outside / "secret.pdf")
    (root / "pdfs" / "notes.txt").write_text("not a pdf")

    reviews = root / "reviews"
    reviews.mkdir(exist_ok=True)
    (reviews / "recsys.md").write_text(REVIEW)

    os.environ["PAPERS_CACHE"] = str(tmp_path_factory.mktemp("cache"))
    return Library(root)


@pytest.fixture(autouse=True)
def state(tmp_path, monkeypatch) -> Path:
    """Permission answers are logged here, not in the reader's own state folder."""
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    return tmp_path / "state"
