import json
from pathlib import Path

import pytest

from carrel.usage import bash_program, permission_answers, record_permission, tally, transcripts_dir


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
    counts = tally(tmp_path)
    assert counts["sessions"]["sessions"] == 1
    assert counts["tools"] == {"Bash": 1, "Read": 2, "WebFetch": 1}
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
