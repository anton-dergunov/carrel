"""The format of a question as carrel sends it to Claude Code, and reading it back.

A question is the reader's text after a context line, `[Reading <paper text>, page N]`, and
the passage they selected, `<selection page="N">…</selection>`. A slash command goes first,
or Claude Code does not run it, and the two follow it as the last lines of its arguments.
Reading back serves a resumed chat's transcript, the chat list, and the library's count of
the papers discussed. Only the current format is read.
"""

import re
from pathlib import Path


def context_line(paper_text: str | None, page: int | None) -> str:
    """What the reader has open, in front of each question, so the agent does not search
    for the paper."""
    if not paper_text:
        return ""
    where = f", page {page}" if page else ""
    return f"[Reading {paper_text}{where}]\n"


def selection_block(text: str, page: int | None, paper_text: str | None = None) -> str:
    """What the reader selected in a paper, after the context line: the page it is on, and the
    paper when it is not the one the context line names."""
    text = text.replace("</selection>", "")
    attributes = (f' paper="{paper_text}"' if paper_text else "") + (
        f' page="{page}"' if page else ""
    )
    return f"<selection{attributes}>\n{text}\n</selection>\n"


def compose(text: str, context: str) -> str:
    """The prompt for a question: the context line and the selection, then the question. A
    slash command comes first, or Claude Code does not run it; the context then reaches the
    command as the last lines of its arguments, so `/overview` alone means the paper open."""
    if text.lstrip().startswith("/"):
        return f"{text.strip()}\n{context}".rstrip("\n") if context else text
    return context + text


# The context line and the selection after it; a session list's first prompt has them on one
# line with the question. Claude Code keeps a command's arguments without the last newline.
_CONTEXT = re.compile(r"^\[Reading (?P<text>[^\n]+?)(?:, page (?P<page>\d+))?\](?:[\n ]|$)")
_SELECTION = re.compile(
    r'<selection(?: paper="(?P<paper>[^"]*)")?(?: page="(?P<page>\d+)")?>[\n ]'
    r"(?P<text>.*?)[\n ]</selection>(?:[\n ]|$)",
    re.DOTALL,
)
# A command as a transcript records it, its name and its arguments in tags, in either order.
_COMMAND_NAME = re.compile(r"<command-name>(/[^<]*)</command-name>")
_COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)
# Where a command's own arguments end and the context after them begins.
_AFTER_COMMAND = re.compile(r"[\n ](?=\[Reading |<selection[ >])")


def _command(prompt: str) -> tuple[str | None, str]:
    """A prompt's slash command, if it starts with one, and what follows it: the context."""
    named = _COMMAND_NAME.search(prompt)
    if named:
        args = _COMMAND_ARGS.search(prompt)
        prompt = named[1] + (f" {args[1]}" if args and args[1].strip() else "")
    if not prompt.startswith("/"):
        return None, prompt
    after = _AFTER_COMMAND.search(prompt)
    return (prompt[: after.start()], prompt[after.end() :]) if after else (prompt, "")


def paper_named(prompt: str) -> str | None:
    """The paper file a question's context line names, as the library root sees it."""
    found = _CONTEXT.match(_command(prompt)[1])
    return found["text"] if found else None


def split_question(prompt: str) -> dict:
    """A prompt as the reader asked it: the question, the paper its context line names, and
    the passage it quotes."""
    command, prompt = _command(prompt)
    question = {}
    found = _CONTEXT.match(prompt)
    if found:
        prompt = prompt[found.end() :]
        question["paper"] = Path(found["text"]).stem
        if found["page"]:
            question["page"] = int(found["page"])
    quoted = _SELECTION.match(prompt)
    if quoted:
        prompt = prompt[quoted.end() :]
        selection = {"text": quoted["text"]}
        if quoted["page"]:
            selection["page"] = int(quoted["page"])
        if quoted["paper"]:
            selection["paper"] = Path(quoted["paper"]).stem
        question["selection"] = selection
    return {"text": prompt if command is None else command, **question}
