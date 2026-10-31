"""Running carrel from login onwards, as a launchd agent serving one library.

Taken from Lectern's `lectern agent` (anton-dergunov/lectern, `src/lectern/agent.py`). What
carrel adds: the agent runs `carrel serve` with the options it was installed with, and with
the installing shell's PATH, since launchd's own lacks Homebrew's `rg` and `uv` (which runs
`paperlib`) and the `tailscale` command.
"""

import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import APP_NAME

LABEL = f"com.anton.{APP_NAME}"
# Carried from the installing shell into the agent: launchd gives it almost nothing.
CARRIED = ("PATH", "XDG_STATE_HOME")


class AgentError(Exception):
    pass


def plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def log_path() -> Path:
    return Path.home() / "Library" / "Logs" / f"{APP_NAME}.log"


def _domain() -> str:
    return f"gui/{os.getuid()}"


def program() -> str:
    """The `carrel` command, by absolute path: launchd has no shell PATH. Under `uv run` it
    is the checkout's own `.venv/bin/carrel`, which `uv sync` keeps in place."""
    found = shutil.which(APP_NAME) or sys.argv[0]
    path = Path(found).expanduser()
    if not path.is_file():
        raise AgentError(f"cannot find the {APP_NAME} command to run at login")
    return str(path.absolute())


def plist(executable: str, serve_args: list[str], env: dict[str, str]) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [executable, "serve", *serve_args],
        "EnvironmentVariables": {name: env[name] for name in CARRIED if env.get(name)},
        "RunAtLoad": True,
        # Restarted if it crashes, left alone if it stops by itself: it does that when it
        # finds a carrel already answering on the port.
        "KeepAlive": {"SuccessfulExit": False},
        "ProcessType": "Background",
        "StandardOutPath": str(log_path()),
        "StandardErrorPath": str(log_path()),
    }


def _launchctl(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(["launchctl", *arguments], capture_output=True, text=True)


def _unload(wait_s: float = 15) -> bool:
    """Unloads the agent, and waits until it is gone: `bootout` returns while a carrel is
    still closing its chats, and loading the agent again before then fails."""
    service = f"{_domain()}/{LABEL}"
    if _launchctl("bootout", service).returncode != 0:
        return False
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline and _launchctl("print", service).returncode == 0:
        time.sleep(0.2)
    return True


def install(serve_args: list[str]) -> Path:
    path = plist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    log_path().parent.mkdir(parents=True, exist_ok=True)
    # Replacing a loaded agent needs it unloaded first; not being loaded is not an error.
    _unload()
    with path.open("wb") as file:
        plistlib.dump(plist(program(), serve_args, dict(os.environ)), file)
    done = _launchctl("bootstrap", _domain(), str(path))
    if done.returncode != 0:
        raise AgentError(f"launchctl could not load {path}: {done.stderr.strip()}")
    return path


def uninstall() -> bool:
    """True if there was an agent to remove."""
    path = plist_path()
    loaded = _unload()
    existed = path.exists()
    path.unlink(missing_ok=True)
    return loaded or existed


def restart_command() -> str:
    """What starts the agent afresh, as typed in a terminal."""
    return f"launchctl kickstart -k {_domain()}/{LABEL}"


def describe(printed: str) -> str:
    """What `launchctl print` says about the agent, in a few words."""
    fields: dict[str, str] = {}
    for line in printed.splitlines():
        key, separator, value = line.strip().partition(" = ")
        # The service's own fields come first; nested sections repeat names like `state`.
        if separator:
            fields.setdefault(key, value)
    if fields.get("state") == "running" and "pid" in fields:
        return f"running (pid {fields['pid']})"
    return f"loaded, not running (last exit code {fields.get('last exit code', 'unknown')})"


def status() -> str:
    """One of: not installed, installed but not loaded, running (pid N), loaded, not running."""
    if not plist_path().exists():
        return "not installed"
    done = _launchctl("print", f"{_domain()}/{LABEL}")
    if done.returncode != 0:
        return "installed but not loaded"
    return describe(done.stdout)


def installed_arguments() -> list[str]:
    """The `carrel serve` options the agent was installed with, for `status`."""
    try:
        with plist_path().open("rb") as file:
            return plistlib.load(file)["ProgramArguments"][2:]
    except (OSError, KeyError, plistlib.InvalidFileException):
        return []
