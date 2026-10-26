"""The chats' settings: the models a chat may run on, and a note about the reader for the
system prompt.

The note is kept on the server, so every device shares it. The model is each device's own
(a page sends it with a question). Both apply when a chat's Claude Code process starts (a new
chat, or one resumed after its cache expired); a running chat keeps what it started with, so
its prompt cache stays valid.
"""

import json
import os
from pathlib import Path

from .usage import state_dir

# The aliases Claude Code takes, which follow each model's latest release.
MODELS = {"opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku"}
# What a chat runs on when the page names no model, or one not in MODELS.
DEFAULT_MODEL = "opus"
DEFAULTS = {"note": ""}
LONGEST_NOTE = 4000


def settings_file() -> Path:
    return state_dir() / "settings.json"


def checked(data: object) -> dict:
    """The settings in `data`, over the defaults for what it leaves out; ValueError when a
    value does not fit."""
    if not isinstance(data, dict):
        raise ValueError("Settings are an object.")
    settings = {**DEFAULTS, **{key: data[key] for key in DEFAULTS if key in data}}
    if not isinstance(settings["note"], str):
        raise ValueError("The note is text.")
    if len(settings["note"]) > LONGEST_NOTE:
        raise ValueError(f"The note is longer than {LONGEST_NOTE} characters.")
    return settings


def model(name: object) -> str:
    """The model a page asked for, when it is one of ours."""
    return name if isinstance(name, str) and name in MODELS else DEFAULT_MODEL


def load(path: Path) -> dict:
    """The saved settings, or the defaults when there are none or they cannot be read."""
    try:
        return checked(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save(path: Path, settings: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        partial.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(partial, path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


class Settings:
    """The settings as saved in `path`; with no path, kept in memory only."""

    def __init__(self, path: Path | None = None, **values):
        self.path = path
        self._values = checked({**(load(path) if path else {}), **values})

    def get(self) -> dict:
        return dict(self._values)

    def update(self, values: object) -> dict:
        """Saves the settings with `values` changed; ValueError when one does not fit, and
        nothing is saved."""
        if not isinstance(values, dict):
            raise ValueError("Settings are an object.")
        settings = checked({**self._values, **values})
        if self.path:
            save(self.path, settings)
        self._values = settings
        return self.get()
