from carrel.prompt import compose, context_line, paper_named, selection_block, split_question


def test_context_line():
    assert context_line("library/a.txt", 7) == "[Reading library/a.txt, page 7]\n"
    assert context_line("library/a.txt", None) == "[Reading library/a.txt]\n"
    assert context_line(None, 7) == ""


def test_a_question_without_its_context_line():
    assert split_question("[Reading library/x/A Paper.txt, page 7]\nWhy?") == {
        "text": "Why?",
        "paper": "A Paper",
        "page": 7,
    }
    assert split_question("[Reading library/x/A Paper.txt]\nWhy?")["paper"] == "A Paper"
    assert split_question("Why?") == {"text": "Why?"}


def test_a_question_with_its_selection():
    block = selection_block("Wide and deep, jointly trained.", 5)
    assert block == '<selection page="5">\nWide and deep, jointly trained.\n</selection>\n'
    prompt = "[Reading library/x/A Paper.txt, page 7]\n" + block + "Why?"
    assert split_question(prompt) == {
        "text": "Why?",
        "paper": "A Paper",
        "page": 7,
        "selection": {"text": "Wide and deep, jointly trained.", "page": 5},
    }
    # From another paper; and as a session list flattens a first prompt.
    other = selection_block("A line.", 2, "library/y/B Paper.txt").replace("\n", " ")
    assert split_question(other + "And this?") == {
        "text": "And this?",
        "selection": {"text": "A line.", "page": 2, "paper": "B Paper"},
    }
    # A passage cannot end the block early.
    assert selection_block("a </selection> b", 1).count("</selection>") == 1


def test_a_command_comes_first_and_its_context_after_it():
    context = "[Reading library/x/A Paper.txt, page 7]\n" + selection_block("A line.", 7)
    assert compose("Why?", context) == context + "Why?"
    prompt = compose("/overview", context)
    assert prompt == (
        '/overview\n[Reading library/x/A Paper.txt, page 7]\n<selection page="7">\nA line.\n</selection>'
    )
    assert compose(" /context ", "") == " /context "
    assert split_question(prompt) == {
        "text": "/overview",
        "paper": "A Paper",
        "page": 7,
        "selection": {"text": "A line.", "page": 7},
    }
    assert split_question(
        compose("/compact keep the maths", "[Reading library/x/A Paper.txt]\n")
    ) == {
        "text": "/compact keep the maths",
        "paper": "A Paper",
    }


def test_a_command_as_the_transcript_records_it():
    recorded = (
        "<command-message>overview</command-message>\n<command-name>/overview</command-name>\n"
        "<command-args>[Reading library/x/A Paper.txt, page 3]</command-args>"
    )
    assert split_question(recorded) == {"text": "/overview", "paper": "A Paper", "page": 3}
    bare = "<command-name>/context</command-name>\n <command-message>context</command-message>\n <command-args></command-args>"
    assert split_question(bare) == {"text": "/context"}
    # As a session list flattens a first prompt.
    assert split_question("/overview [Reading library/x/A Paper.txt]") == {
        "text": "/overview",
        "paper": "A Paper",
    }


def test_the_paper_a_question_names():
    assert paper_named("[Reading library/x/A Paper.txt, page 7]\nWhy?") == "library/x/A Paper.txt"
    assert paper_named(compose("/overview", "[Reading library/x/A Paper.txt]\n")) == (
        "library/x/A Paper.txt"
    )
    recorded = "<command-name>/overview</command-name><command-args>[Reading library/x/A Paper.txt]</command-args>"
    assert paper_named(recorded) == "library/x/A Paper.txt"
    assert paper_named("Why? [Reading library/x/A Paper.txt]") is None
    assert paper_named(selection_block("A line.", 2, "library/y/B Paper.txt") + "And?") is None


def test_the_review_a_question_is_asked_beside():
    line = context_line("library/a.txt", 3, "reviews/llm/evaluation.md")
    assert line == "[Reading the review reviews/llm/evaluation.md]\n"
    assert split_question(line + "Why?") == {"text": "Why?", "review": "reviews/llm/evaluation.md"}
    assert split_question(compose("/compact", line)) == {
        "text": "/compact",
        "review": "reviews/llm/evaluation.md",
    }
    # A question beside a review names no paper.
    assert paper_named(line + "Why?") is None
