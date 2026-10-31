"""carrel serve | carrel agent | carrel tools"""

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import APP_NAME, __version__
from .agent import AgentError
from .engine import CONFIG_NAME, Library, LibraryError

DEFAULT_PORT = 8517
HTTPS_PORT = 8443


def find_library(given: str | None) -> Path:
    if given:
        return Path(given).expanduser()
    if os.environ.get("PAPER_LIBRARY"):
        return Path(os.environ["PAPER_LIBRARY"]).expanduser()
    here = Path.cwd().resolve()
    for folder in [here, *here.parents]:
        if (folder / CONFIG_NAME).is_file():
            return folder
    raise LibraryError("no library here: name one with --library or PAPER_LIBRARY")


def running(port: int) -> dict | None:
    """What a carrel already answering on this Mac's port says about itself."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=2) as response:
            ping = json.load(response)
    except (OSError, ValueError, urllib.error.URLError):
        return None
    return ping if isinstance(ping, dict) and ping.get("app") == APP_NAME else None


def serve(args) -> None:
    import uvicorn

    from . import tailnet
    from .server import make_app
    from .settings import DEFAULT_MODEL, Settings, settings_file

    sys.stdout.reconfigure(line_buffering=True)  # the banner reaches a log file at once
    # Pages attaching to chats and leaving them, to see what drops a connection.
    logging.basicConfig(format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger(APP_NAME).setLevel(logging.INFO)
    from .server import STATIC

    if not (STATIC / "vendor" / "pdfjs" / "pdf.min.mjs").is_file():
        raise LibraryError("the browser libraries are missing: run ./scripts/vendor.sh once")
    root = find_library(args.library).resolve()
    if ping := running(args.port):
        # Not an error, so that launchd leaves the login agent stopped rather than retrying.
        print(f"{APP_NAME} is already running on port {args.port}, serving {ping.get('library')}")
        if Path(ping.get("library", "")) != root:
            print(f"  to serve {root}, stop that one, or pass --port")
        return
    library = Library(root, args.engine)
    name, login = tailnet.identity()
    logins = set(args.login or ([login] if login else []))
    extra = tuple(Path(folder).expanduser().resolve() for folder in args.add_dir or [])
    for folder in extra:
        if not folder.is_dir():
            raise LibraryError(f"--add-dir {folder}: no such folder")
    settings = Settings(settings_file())
    app = make_app(
        library,
        hosts={name} if name else set(),
        logins=logins,
        extra_folders=extra,
        settings=settings,
    )

    print(f"{APP_NAME} {__version__}: {library.root} (PDFs in {library.pdf_root})")
    print(f"  chats run on the model each device chooses (at first {DEFAULT_MODEL})")
    for folder in [*library.outside_folders(), *extra]:
        print(f"  the agent also reads {folder}")
    print(f"  on this Mac:   http://127.0.0.1:{args.port}/")
    if name:
        print(
            f"  on the tailnet: https://{name}:{HTTPS_PORT}/  for {', '.join(sorted(logins)) or 'nobody'}"
        )
        if not tailnet.serves(HTTPS_PORT, args.port):
            print(
                f"  not published yet; once, run:  tailscale serve --bg --https={HTTPS_PORT} "
                f"http://127.0.0.1:{args.port}"
            )
    else:
        print("  Tailscale is not running: this Mac only")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", ws_max_size=4 * 2**20)


def serve_arguments(args) -> list[str]:
    """`carrel serve`'s options as the login agent runs them: every path absolute, the
    library and the engine named, since launchd knows nothing of the shell's folder or
    environment."""
    arguments = ["--library", str(find_library(args.library).resolve())]
    engine = args.engine or os.environ.get("CARREL_ENGINE")
    if engine:
        arguments += ["--engine", str(Path(engine).expanduser().resolve())]
    if args.port != DEFAULT_PORT:
        arguments += ["--port", str(args.port)]
    for login in args.login or []:
        arguments += ["--login", login]
    for folder in args.add_dir or []:
        arguments += ["--add-dir", str(Path(folder).expanduser().resolve())]
    return arguments


def agent(args) -> None:
    from . import agent

    if args.action == "install":
        path = agent.install(serve_arguments(args))
        print(
            f"{APP_NAME} starts at login from now on: {APP_NAME} serve {' '.join(agent.installed_arguments())}"
        )
        print(f"  agent: {path}")
        print(f"  log:   {agent.log_path()}")
        print(f"  after changing carrel's code or running uv sync:  {agent.restart_command()}")
    elif args.action == "uninstall":
        removed = agent.uninstall()
        print(f"{APP_NAME} " + ("no longer starts at login" if removed else "was not installed"))
    else:
        installed = agent.installed_arguments()
        port = (
            int(installed[installed.index("--port") + 1]) if "--port" in installed else DEFAULT_PORT
        )
        print(f"{APP_NAME} agent: {agent.status()}")
        if installed:
            print(f"  runs:  {APP_NAME} serve {' '.join(installed)}")
        ping = running(port)
        answering = (
            f"{APP_NAME} {ping.get('version')}, serving {ping.get('library')}" if ping else ""
        )
        print(f"  port {port}: {answering or 'nothing answering'}")
        print(f"  log:   {agent.log_path()}")
        if installed:
            print(f"  restart:  {agent.restart_command()}")


def tools(args) -> None:
    from .usage import report

    library = find_library(args.library).resolve()
    print(report(library))


def serve_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--library", help="the library folder (default: $PAPER_LIBRARY, or the one here)"
    )
    parser.add_argument(
        "--engine",
        help="the agentic-paper-library checkout (default: $CARREL_ENGINE, "
        "or ~/projects/products/agentic-paper-library)",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--login",
        action="append",
        help="a Tailscale login allowed in (default: this Mac's user); repeatable",
    )
    parser.add_argument(
        "--add-dir",
        action="append",
        metavar="FOLDER",
        help="another folder the agent may read (writing asks); repeatable. The folders the "
        "library's config names, such as overview_dir, are included already",
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog=APP_NAME, description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("serve", help="serve the library to the tablet")
    serve_options(run)
    run.set_defaults(func=serve)

    login = commands.add_parser(
        "agent",
        help="start carrel at login (macOS)",
        description="Install, remove or check the launchd agent that runs `carrel serve` "
        "from login onwards, with the options given to install.",
    )
    login.add_argument("action", choices=["install", "uninstall", "status"])
    serve_options(login)
    login.set_defaults(func=agent)

    used = commands.add_parser(
        "tools", help="what carrel's sessions used, and what the reader was asked"
    )
    used.add_argument("--library")
    used.set_defaults(func=tools)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (LibraryError, AgentError) as error:
        sys.exit(f"{APP_NAME}: {error}")
