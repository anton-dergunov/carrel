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
