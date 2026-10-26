"""The HTTP server: the paper list, the reading page, the PDFs, and the chats' WebSocket.

It listens on 127.0.0.1 only. `tailscale serve` publishes it to the tailnet over HTTPS,
keeps the Host the browser asked for, and says who is asking in `Tailscale-User-Login`
(no such header comes from a tagged device). So a request is admitted when:

- its Host is one of ours (a hostile page's own domain pointed here is not: DNS rebinding);
- it carries the reader's Tailscale login, or, with no login, it is addressed to the
  loopback name itself, which a proxied request never is;
- for the WebSocket, its Origin is the page's own.
"""

import asyncio
import contextlib
import html
import json
import logging
import time
from pathlib import Path
from string import Template
from urllib.parse import quote, urlsplit

from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    PlainTextResponse,
    Response,
)
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .engine import Library
from .session import Session, Sessions

log = logging.getLogger("carrel")

PACKAGE = Path(__file__).parent
STATIC = PACKAGE / "static"
PAGES = PACKAGE / "pages"
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def hostname(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].partition("]")[0]
    return host.rsplit(":", 1)[0] if ":" in host else host


def refusal(headers: Headers, websocket: bool, hosts: set[str], logins: set[str]) -> str | None:
    """Why a request is refused, or None to admit it."""
    host = hostname(headers.get("host", ""))
    if host not in hosts | LOOPBACK:
        return "This server does not answer to that name."
    login = headers.get("tailscale-user-login")
    if login is None:
        if host not in LOOPBACK:
            return "Sign in to Tailscale as this library's reader."
    elif login.lower() not in logins:
        return f"{login} is not this library's reader."
    if (
        websocket
        and urlsplit(headers.get("origin", "")).netloc.lower() != headers.get("host", "").lower()
    ):
        return "The connection did not come from carrel's own page."
    return None


class Guard:
    def __init__(self, app, hosts: set[str], logins: set[str]):
        self.app = app
        self.hosts = {host.lower() for host in hosts}
        self.logins = {login.lower() for login in logins}

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            reason = refusal(
                Headers(scope=scope), scope["type"] == "websocket", self.hosts, self.logins
            )
            if reason:
                if scope["type"] == "websocket":
                    await WebSocket(scope, receive, send).close(code=1008, reason=reason)
                else:
                    await PlainTextResponse(reason, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def csp(request: Request) -> str:
    socket = ("wss://" if request.url.scheme == "https" else "ws://") + request.headers.get(
        "host", ""
    )
    return (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; "
        f"connect-src 'self' {socket}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )


def page(request: Request, name: str, **values: str) -> HTMLResponse:
    text = Template((PAGES / name).read_text(encoding="utf-8")).substitute(values)
    return HTMLResponse(text, headers={"Content-Security-Policy": csp(request)})


def make_app(
    library: Library,
    hosts: set[str] = frozenset(),
    logins: set[str] = frozenset(),
    extra_folders: tuple[Path, ...] = (),
    sessions: Sessions | None = None,
    model: str | None = None,
):
    sessions = sessions or Sessions(library, extra_folders, model=model)

    def papers() -> str:
        topics: dict[str, list[str]] = {}
        for paper in library.papers():
            year = f' <span class="year">{html.escape(paper.year)}</span>' if paper.year else ""
            topics.setdefault(paper.topic, []).append(
                f'<li><a href="/read/{quote(paper.pdf)}">{html.escape(paper.title)}</a>{year}</li>'
            )
        return "\n".join(
            f"<section><h2>{html.escape(topic)}</h2><ul>{''.join(items)}</ul></section>"
            for topic, items in topics.items()
        )

    def shell(request: Request, pdf: str = "", title: str = "") -> Response:
        """The one page: the paper list and the open papers in tabs, and the chat beside them.
        The address only says which tab is showing."""
        return page(
            request,
            "app.html",
            library=html.escape(library.root.name),
            papers=papers(),
            title=html.escape(title or library.root.name),
            pdf=html.escape(pdf, quote=True),
            pdf_title=html.escape(title, quote=True),
        )

    async def index(request: Request) -> Response:
        return shell(request)

    async def read(request: Request) -> Response:
        rel = request.path_params["path"]
        try:
            library.resolve_pdf(rel)
        except LookupError:
            return PlainTextResponse("No such PDF in the library.", status_code=404)
        paper = library.paper_for_pdf(rel)
        return shell(request, rel, paper.title if paper else Path(rel).stem)

    async def paper(request: Request) -> Response:
        """A paper to open beside the chat without leaving the page."""
        rel = request.path_params["path"]
        try:
            library.resolve_pdf(rel)
        except LookupError:
            return JSONResponse({"error": "No such PDF in the library."}, status_code=404)
        found = library.paper_for_pdf(rel)
        return JSONResponse(
            {
                "pdf": rel,
                "title": found.title if found else Path(rel).stem,
                "pdf_url": "/pdf/" + quote(rel),
            }
        )

    async def chats(request: Request) -> Response:
        listing = await asyncio.to_thread(sessions.listing)
        return JSONResponse(listing)

    async def pdf(request: Request) -> Response:
        try:
            path = library.resolve_pdf(request.path_params["path"])
        except LookupError:
            return PlainTextResponse("No such PDF in the library.", status_code=404)
        return FileResponse(
            path, media_type="application/pdf", headers={"Cache-Control": "no-cache"}
        )

    async def session(websocket: WebSocket) -> None:
        """A page attached to a chat: `?chat=<id>` (or `new`), and `after=<seq>&epoch=<e>`
        for the last message it has. Leaving detaches the page; the chat goes on."""
        await websocket.accept()
        query = websocket.query_params
        try:
            after = int(query.get("after", "0"))
        except ValueError:
            after = 0
        talk = sessions.get(None if query.get("chat") in (None, "", "new") else query["chat"])

        async def send(message: dict) -> None:
            await websocket.send_text(json.dumps(message, ensure_ascii=False))

        opened = time.monotonic()
        log.info("page attached to chat %s (after %d)", talk.id, after)
        await talk.attach(send, after, query.get("epoch"))
        running: set[asyncio.Task] = set()
        code = None
        try:
            while True:
                message = await websocket.receive_json()
                # A turn's first message starts Claude Code, which takes a few seconds; the
                # socket keeps reading meanwhile, so Stop and permission answers get through.
                task = asyncio.create_task(_handle(talk, message))
                running.add(task)
                task.add_done_callback(running.discard)
        except WebSocketDisconnect as gone:
            code = gone.code
        finally:
            talk.detach(send)
            log.info(
                "page left chat %s after %d s (close code %s)",
                talk.id,
                time.monotonic() - opened,
                code,
            )

    @contextlib.asynccontextmanager
    async def lifespan(app):
        reaper = asyncio.create_task(sessions.reap_forever())
        try:
            yield
        finally:
            reaper.cancel()
            await sessions.close()

    app = Starlette(
        routes=[
            Route("/", index),
            Route("/read/{path:path}", read),
            Route("/pdf/{path:path}", pdf),
            Route("/api/paper/{path:path}", paper),
            Route("/api/chats", chats),
            WebSocketRoute("/ws", session),
            Mount("/static", StaticFiles(directory=STATIC), name="static"),
        ],
        lifespan=lifespan,
    )
    return Guard(app, set(hosts), set(logins))


async def _handle(talk: Session, message: dict) -> None:
    try:
        await talk.handle(message if isinstance(message, dict) else {})
    except Exception as error:
        talk.busy = False
        await talk.emit("Error", {"message": f"{type(error).__name__}: {error}"})
        await talk.emit_state()
