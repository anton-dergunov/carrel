import json
from pathlib import Path

import pytest

from carrel.usage import (
    bash_program,
    carrel_sessions,
    discussed,
    permission_answers,
    record_permission,
    record_session,
    tally,
    transcripts_dir,
)


@pytest.mark.parametrize(
    ("command", "program"),
    [
        ("grep -n 'win rate' library/x.txt", "grep"),
        ("cd ~/papers && sed -n 10,20p a.txt", "sed"),
        ("PAPER_LIBRARY=~/papers /Users/me/.local/bin/paperlib info 2401.1", "paperlib"),
        ("cd a; cd b && cat x\nmore", "cat"),
        ("", ""),
    ],
)
def test_bash_program(command, program):
    assert bash_program(command) == program


def _line(entrypoint, *blocks):
    return json.dumps(
        {
            "type": "assistant",
            "entrypoint": entrypoint,
            "message": {
                "content": [{"type": "tool_use", "name": n, "input": i} for n, i in blocks]
            },
        }
    )


def test_tally_counts_only_carrel_sessions(tmp_path):
    (tmp_path / "a.jsonl").write_text(
        "\n".join(
            [
                _line(
                    "sdk-py", ("Bash", {"command": "grep x y"}), ("Read", {"file_path": "/l/p.txt"})
                ),
                _line(
                    "sdk-py",
                    ("Read", {"file_path": "/p/p.pdf", "pages": "3"}),
                    ("WebFetch", {"url": "https://arxiv.org/abs/1"}),
                ),
                "not json",
            ]
        )
    )
    (tmp_path / "b.jsonl").write_text(_line("claude-vscode", ("Edit", {"file_path": "x"})))
    (tmp_path / "c.jsonl").write_text(_line("carrel", ("Glob", {"pattern": "*"})))
    # A session whose tag says nothing, but whose id carrel kept.
    (tmp_path / "d.jsonl").write_text(_line("cli", ("Grep", {"pattern": "x"})))
    (tmp_path / "e.jsonl").write_text(_line("cli", ("Write", {"file_path": "x"})))
    counts = tally(tmp_path, ids={"d"})
    assert counts["sessions"]["sessions"] == 3
    assert counts["tools"] == {"Bash": 1, "Read": 2, "WebFetch": 1, "Glob": 1, "Grep": 1}
    assert counts["bash"] == {"grep": 1}
    assert counts["read"] == {".txt": 1, ".pdf pages": 1}
    assert counts["web"] == {"arxiv.org": 1}


def test_permission_answers(tmp_path):
    log = tmp_path / "permissions.jsonl"
    record_permission("Bash", {"command": "git log -1"}, True, log)
    record_permission("Bash", {"command": "git push"}, False, log)
    record_permission("SandboxNetworkAccess", {"host": "example.com"}, False, log)
    record_permission("Bash", {"command": 'cd a; grep x "$f"'}, True, log, by="sandbox")
    assert permission_answers(log) == {
        "Bash git: allowed": 1,
        "Bash git: denied": 1,
        "SandboxNetworkAccess example.com: denied": 1,
        "Bash cd: allowed by the sandbox": 1,
    }


def test_transcripts_dir():
    assert transcripts_dir(Path("/Users/me/.cache/my_lib")).name == "-Users-me--cache-my-lib"


def test_carrel_keeps_its_session_ids(tmp_path):
    log = tmp_path / "sessions.jsonl"
    assert carrel_sessions(log) == set()
    record_session("a", log)
    record_session("b", log)
    log.write_text(log.read_text() + "not json\n")
    assert carrel_sessions(log) == {"a", "b"}


@pytest.mark.parametrize("ripgrep", [True, False])
def test_the_papers_carrel_s_chats_asked_about(tmp_path, monkeypatch, ripgrep):
    if not ripgrep:
        monkeypatch.setattr("carrel.usage.shutil.which", lambda name: None)

    def line(text, entrypoint="carrel"):
        entry = {"type": "user", "entrypoint": entrypoint, "message": {"content": text}}
        return json.dumps(entry, separators=(",", ":"))

    (tmp_path / "a.jsonl").write_text(
        "\n".join(
            [
                line("[Reading library/x/A.txt, page 2]\nWhy?"),
                line(
                    "<command-name>/overview</command-name><command-args>[Reading library/x/B.txt]</command-args>"
                ),
                line("No paper open."),
                "not json " + line("[Reading library/x/A.txt]"),
            ]
        )
    )
    (tmp_path / "b.jsonl").write_text(line("[Reading library/x/A.txt]\nWhy?", entrypoint="cli"))
    assert discussed(Path("/nowhere"), tmp_path) == {"library/x/A.txt": 1, "library/x/B.txt": 1}
    assert discussed(Path("/nowhere"), tmp_path / "missing") == {}
