import unicodedata

import pytest

PDF = "recsys/Wide & Deep. A Test Paper.pdf"


def test_papers_lists_those_with_a_pdf(library):
    papers = library.papers()
    assert [p.title for p in papers] == ["Wide & Deep: A Test Paper"]
    paper = papers[0]
    assert (paper.year, paper.topic, paper.pdf) == ("2016", "recsys", PDF)
    assert paper.text == "library/recsys/Wide & Deep. A Test Paper.txt"


def test_paper_for_pdf(library):
    assert library.paper_for_pdf(PDF).text == "library/recsys/Wide & Deep. A Test Paper.txt"


@pytest.mark.parametrize(
    "rel",
    [
        "../paper-library.yaml",
        "../../etc/passwd.pdf",
        "/etc/hosts",
        "escape.pdf",
        "notes.txt",
        "recsys/missing.pdf",
    ],
)
def test_resolve_pdf_refuses_what_is_not_a_pdf_in_the_library(library, rel):
    with pytest.raises(LookupError):
        library.resolve_pdf(rel)


def test_resolve_pdf(library):
    assert library.resolve_pdf(PDF) == (library.pdf_root / PDF).resolve()


def test_outside_folders_are_what_the_config_places_outside(library):
    # pdf_root and the notes are inside this library; the overview notes are not.
    assert library.outside_folders() == [library.overview_dir]


def test_paper_info_is_the_frontmatter_in_the_engines_order(library):
    info = library.paper_info(library.paper_for_pdf(PDF))
    assert info["fields"] == [
        ["title", "Wide & Deep: A Test Paper"],
        ["authors", ["A. Author"]],
        ["published", "2016-06-24"],
        ["source", "pdf"],
        ["summary", "A paper for the tests."],
        ["added", "2026-10-26"],
    ]
    assert (info["topic"], info["notes"], info["overview"]) == ("recsys", False, False)


def test_overview_note_is_where_the_skill_writes_it(library):
    paper = library.paper_for_pdf(PDF)
    note = library.overview_note(paper)
    assert note == library.overview_dir / "Wide & Deep. A Test Paper.md"
    note.write_text("# Overview\n")
    try:
        assert library.paper_info(paper)["overview"] is True
    finally:
        note.unlink()


def test_paper_for_overview_note_reads_the_path_the_skill_gives(library):
    paper = library.paper_for_pdf(PDF)
    note = str(library.overview_dir / "Wide & Deep. A Test Paper.md")
    assert library.paper_for_overview_note(note) == paper
    assert library.paper_for_overview_note(unicodedata.normalize("NFD", note)) == paper
    assert (
        library.paper_for_overview_note(str(library.root / "Wide & Deep. A Test Paper.md")) is None
    )
    assert library.paper_for_overview_note("Wide & Deep. A Test Paper.md") is None
    assert library.paper_for_overview_note(note.removesuffix(".md") + ".txt") is None
    assert library.paper_for_overview_note(str(library.overview_dir / "Another.md")) is None
