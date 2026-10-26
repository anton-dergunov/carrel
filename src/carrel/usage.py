"""What the agent used while reading, to decide which tools run without asking.

Claude Code writes each session to ~/.claude/projects/<folder>/<id>.jsonl, tagged with its
`entrypoint`. Carrel's are tagged "carrel" (so that Claude Code lists them; the earliest are
the SDK's, "sdk-py"), and carrel also keeps their ids itself. Those say which tools ran.
What the reader was asked, and answered, carrel keeps too, one line each.
"""

import json
import os
import re
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

# The tag of carrel's sessions, and of its first ones, which ran as the SDK's.
OUR_ENTRYPOINTS = {"carrel", "sdk-py"}


def state_dir() -> Path:
    return Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state") / "carrel"


def permissions_log() -> Path:
    return state_dir() / "permissions.jsonl"


def sessions_log() -> Path:
    return state_dir() / "sessions.jsonl"


def _append(log: Path, entry: dict) -> None:
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a", encoding="utf-8") as file:
            file.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass  # a log that cannot be written must not stop the reading


def record_session(session_id: str, log: Path | None = None) -> None:
    """A Claude Code session carrel started, for `carrel tools` to tell from the reader's own."""
    _append(log or sessions_log(), {"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "id": session_id})


def carrel_sessions(log: Path | None = None) -> set[str]:
    log = log or sessions_log()
    if not log.is_file():
        return set()
    ids = set()
    for line in log.read_text(encoding="utf-8").splitlines():
        try:
            ids.add(json.loads(line)["id"])
        except (ValueError, KeyError, TypeError):
            continue
    return ids


def _gist(tool_input: dict) -> str:
    """The part of a tool's input that says what it does, not its whole content."""
    for key in ("command", "file_path", "url", "host", "pattern", "query", "path"):
        if key in tool_input:
            return str(tool_input[key])[:300]
    return json.dumps(tool_input, ensure_ascii=False)[:300]


def record_permission(
    tool: str, tool_input: dict, allow: bool, log: Path | None = None, by: str = "reader"
) -> None:
    entry = {
        "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tool": tool,
        "what": _gist(tool_input),
        "allow": allow,
        "by": by,
    }
    _append(log or permissions_log(), entry)


def transcripts_dir(library_root: Path) -> Path:
    """Where Claude Code keeps the sessions run in a folder: its path with every character
    other than a letter or digit turned into "-"."""
    return Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(library_root))


_LEADING = re.compile(r"^(?:cd\s+[^&;|]+(?:&&|;)\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|env\s+)+")


def bash_program(command: str) -> str:
    """The program a command line runs, without a leading `cd …&&` or variable settings."""
    first = _LEADING.sub("", command.strip().split("\n", 1)[0]).split()
    return Path(first[0]).name if first else ""


def tally(transcripts: Path, ids: set[str] | None = None) -> dict[str, Counter]:
    """Counts the tools carrel's sessions used: those whose ids it kept or that carry its
    tag, and the earliest ones, tagged as the SDK's."""
    ids = carrel_sessions() if ids is None else ids
    counts = {name: Counter() for name in ("sessions", "tools", "bash", "read", "web")}
    for path in sorted(transcripts.glob("*.jsonl")):
        known = path.stem in ids
        ours = False
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("type") != "assistant" or not (
                known or entry.get("entrypoint") in OUR_ENTRYPOINTS
            ):
                continue
            ours = True
            for block in (entry.get("message") or {}).get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name, given = block.get("name", "?"), block.get("input") or {}
                counts["tools"][name] += 1
                if name == "Bash":
                    counts["bash"][bash_program(str(given.get("command", "")))] += 1
                elif name == "Read":
                    suffix = Path(str(given.get("file_path", ""))).suffix or "(none)"
                    counts["read"][suffix + (" pages" if given.get("pages") else "")] += 1
                elif name == "WebFetch":
                    counts["web"][urlsplit(str(given.get("url", ""))).netloc] += 1
                elif name == "WebSearch":
                    counts["web"]["(search)"] += 1
        if ours:
            counts["sessions"]["sessions"] += 1
    return counts


def permission_answers(log: Path | None = None) -> Counter:
    counts = Counter()
    log = log or permissions_log()
    if log.is_file():
        for line in log.read_text(encoding="utf-8").splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            # The program for Bash and the host for the sandbox's network requests: what an
            # allow rule or the domain list would name.
            what = ""
            if entry["tool"] == "Bash" and entry["what"].split():
                what = Path(entry["what"].split()[0]).name
            elif entry["tool"] == "SandboxNetworkAccess":
                what = entry["what"]
            answer = "allowed" if entry.get("allow") else "denied"
            if entry.get("by", "reader") != "reader":
                answer += f" by the {entry['by']}"
            counts[f"{entry['tool']} {what}".strip() + f": {answer}"] += 1
    return counts


def report(library_root: Path) -> str:
    counts = tally(transcripts_dir(library_root))
    lines = [f"{counts['sessions']['sessions']} carrel sessions in {transcripts_dir(library_root)}"]
    sections = [
        ("Tools", counts["tools"]),
        ("Bash programs", counts["bash"]),
        ("Read, by file type", counts["read"]),
        ("Web", counts["web"]),
        (f"Asked of the reader ({permissions_log()})", permission_answers()),
    ]
    for title, counter in sections:
        if counter:
            lines += ["", title] + [f"  {n:6}  {key}" for key, n in counter.most_common()]
    return "\n".join(lines)
