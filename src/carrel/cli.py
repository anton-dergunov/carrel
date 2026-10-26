"""carrel serve | carrel tools"""

import argparse
import logging
import os
import sys
from pathlib import Path

from . import APP_NAME, __version__
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
    library = Library(find_library(args.library), args.engine)
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


def tools(args) -> None:
    from .usage import report

    library = find_library(args.library).resolve()
    print(report(library))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog=APP_NAME, description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("serve", help="serve the library to the tablet")
    run.add_argument(
        "--library", help="the library folder (default: $PAPER_LIBRARY, or the one here)"
    )
    run.add_argument(
        "--engine",
        help="the agentic-paper-library checkout (default: $CARREL_ENGINE, "
        "or ~/projects/products/agentic-paper-library)",
    )
    run.add_argument("--port", type=int, default=DEFAULT_PORT)
    run.add_argument(
        "--login",
        action="append",
        help="a Tailscale login allowed in (default: this Mac's user); repeatable",
    )
    run.add_argument(
        "--add-dir",
        action="append",
        metavar="FOLDER",
        help="another folder the agent may read (writing asks); repeatable. The folders the "
        "library's config names, such as overview_dir, are included already",
    )
    run.set_defaults(func=serve)

    used = commands.add_parser(
        "tools", help="what carrel's sessions used, and what the reader was asked"
    )
    used.add_argument("--library")
    used.set_defaults(func=tools)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except LibraryError as error:
        sys.exit(f"{APP_NAME}: {error}")
