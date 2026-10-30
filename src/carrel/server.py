"""The HTTP server: the one page (the library, an area of it, a paper or a review showing), the
library as one document, the PDFs, and the chats' WebSocket.

It listens on 127.0.0.1 only. `tailscale serve` publishes it to the tailnet over HTTPS,
keeps the Host the browser asked for, and says who is asking in `Tailscale-User-Login`
(no such header comes from a tagged device). So a request is admitted when:

- its Host is one of ours (a hostile page's own domain pointed here is not: DNS rebinding);
- it carries the reader's Tailscale login, or, with no login, it is addressed to the
  loopback name itself, which a proxied request never is;
- for the WebSocket, and for anything but GET and HEAD, its Origin is the page's own.

What a page can change on the laptop is a paper's PDF, with the highlights made in it
(`PUT /pdf/…`), the chats' settings (`PUT /api/settings`), and a paper's overview note,
which it can only move to the Trash (`DELETE /api/overview/…`); and a page can write a line
to the server's log.
"""

import asyncio
import contextlib
import html
import json
import logging
import os
import shutil
import time
from pathlib import Path
from string import Template
from urllib.parse import quote, urlsplit

from send2trash import send2trash
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

from .catalog import Catalog
from .engine import Library
from .session import Session, Sessions
from .settings import DEFAULT_MODEL, LONGEST_NOTE, MODELS, Settings

log = logging.getLogger("carrel")

PACKAGE = Path(__file__).parent
STATIC = PACKAGE / "static"
PAGES = PACKAGE / "pages"
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
SAFE_METHODS = {"GET", "HEAD"}
# A paper's PDF as a page saves it; the largest in the library is a few tens of MB.
MAX_PDF = 256 * 1024 * 1024
# A line of a page's log, as the page sends it.
MAX_LOG = 8192
# The settings as a page sends them: the note and a little more.
MAX_SETTINGS = 4 * LONGEST_NOTE + 1024


def hostname(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        return host[1:].partition("]")[0]
    return host.rsplit(":", 1)[0] if ":" in host else host


def refusal(headers: Headers, own_page: bool, hosts: set[str], logins: set[str]) -> str | None:
    """Why a request is refused, or None to admit it. `own_page`: it must come from one of
    carrel's own pages (the WebSocket, and whatever changes something)."""
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
        own_page
        and urlsplit(headers.get("origin", "")).netloc.lower() != headers.get("host", "").lower()
    ):
        return "The request did not come from carrel's own page."
    return None


class Guard:
    def __init__(self, app, hosts: set[str], logins: set[str]):
        self.app = app
        self.hosts = {host.lower() for host in hosts}
        self.logins = {login.lower() for login in logins}

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            own_page = scope["type"] == "websocket" or scope["method"] not in SAFE_METHODS
            reason = refusal(Headers(scope=scope), own_page, self.hosts, self.logins)
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


def version(path: Path) -> str:
    """The PDF's version, as its ETag: a save names the version it extends."""
    stat = path.stat()
    return f'"{stat.st_mtime_ns}-{stat.st_size}"'


def write_pdf(path: Path, data: bytes, base: int, expected: str | None) -> str | None:
    """Replaces the PDF with `data`, the paper as the page loaded it (its first `base` bytes)
    and the page's update after them, when the file is still the version the page last saw
    and begins with those bytes. The new version, or None when the file is not as the page
    thinks and nothing was written."""
    if version(path) != expected:
        return None
    with open(path, "rb") as file:
        if file.read(base) != data[:base]:
            return None
    partial = path.with_name(f".{path.name}.carrel-{os.getpid()}.tmp")
    try:
        with open(partial, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        shutil.copymode(path, partial)
        os.replace(partial, path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return version(path)


class PageFiles(StaticFiles):
    """The page's scripts and styles, asked after again at every load (a 304 when unchanged).
    Sent with only their Last-Modified, Safari keeps one it has for a while by how old it is, so a
    change to carrel reached the iPad only days later, if a reload did not happen to ask."""

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


def page(request: Request, name: str, **values: str) -> HTMLResponse:
    text = Template((PAGES / name).read_text(encoding="utf-8")).substitute(values)
    return HTMLResponse(text, headers={"Content-Security-Policy": csp(request)})


def make_app(
    library: Library,
    hosts: set[str] = frozenset(),
    logins: set[str] = frozenset(),
    extra_folders: tuple[Path, ...] = (),
    sessions: Sessions | None = None,
    settings: Settings | None = None,
    catalog: Catalog | None = None,
):
    sessions = sessions or Sessions(library, extra_folders, settings=settings)
    catalog = catalog or Catalog(library)
    # One PDF written at a time: a save checks the file's version, then replaces it.
    writing = asyncio.Lock()

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

    def shell(
        request: Request, pdf: str = "", title: str = "", area: str = "", review: str = ""
    ) -> Response:
        """The one page: the library and the open papers and reviews in tabs, and the chat
        beside them. The address only says which tab, or which area of the library, shows."""
        return page(
            request,
            "app.html",
            library=html.escape(library.root.name),
            papers=papers(),
            title=html.escape(title or library.root.name),
            pdf=html.escape(pdf, quote=True),
            pdf_title=html.escape(title, quote=True),
            area=html.escape(area, quote=True),
            review=html.escape(review, quote=True),
        )

    async def index(request: Request) -> Response:
        return shell(request)

    async def area(request: Request) -> Response:
        """The library open at one of its topics."""
        topic = request.path_params["topic"].strip("/")
        known = await asyncio.to_thread(library.topics)
        if topic not in known and not (library.papers_dir / topic).is_dir():
            return PlainTextResponse("No such area in the library.", status_code=404)
        return shell(request, title=f"{topic} · {library.root.name}", area=topic)

    async def review_page(request: Request) -> Response:
        """The page with a literature review's tab showing."""
        scope = request.path_params["scope"].strip("/")
        reviews = await asyncio.to_thread(library.lib.load_reviews)
        if scope not in reviews:
            return PlainTextResponse("No review of that area in the library.", status_code=404)
        title = str(reviews[scope]["meta"].get("title") or scope)
        return shell(request, title=title, review=scope)

    async def library_document(request: Request) -> Response:
        """Every paper, topic and review, as one document. It changes only when the library
        does: a page that has it gets a 304, and it goes compressed (the PDFs do not: a
        compressed range is no range)."""
        built = await asyncio.to_thread(catalog.current)
        headers = {"ETag": built.etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        if built.etag in [
            tag.strip() for tag in request.headers.get("if-none-match", "").split(",")
        ]:
            return Response(status_code=304, headers=headers)
        if "gzip" in request.headers.get("accept-encoding", "").lower():
            headers["Content-Encoding"] = "gzip"
            return Response(built.gzipped, media_type="application/json", headers=headers)
        return Response(built.body, media_type="application/json", headers=headers)

    async def read(request: Request) -> Response:
        rel = request.path_params["path"]
        try:
            library.resolve_pdf(rel)
        except LookupError:
            return PlainTextResponse("No such PDF in the library.", status_code=404)
        paper = library.paper_for_pdf(rel)
        return shell(request, rel, paper.title if paper else Path(rel).stem)

    async def paper(request: Request) -> Response:
        """A paper to open beside the chat without leaving the page, and what the library
        knows of it."""
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
                **({"info": library.paper_info(found)} if found else {}),
            }
        )

    def overview_note(rel: str) -> Path | None:
        """The paper's overview note, when it has one."""
        try:
            found = library.paper_for_pdf(rel)
        except LookupError:
            return None
        note = found and library.overview_note(found)
        return note if note and note.is_file() else None

    async def overview(request: Request) -> Response:
        """The reader's overview note for a paper, as the overview skill wrote it; null for a
        paper that has none, which is no error."""
        rel = request.path_params["path"]
        try:
            library.resolve_pdf(rel)
        except LookupError:
            return JSONResponse({"error": "No such PDF in the library."}, status_code=404)
        note = overview_note(rel)
        if not note:
            return JSONResponse(None)
        text = await asyncio.to_thread(note.read_text, encoding="utf-8")
        return JSONResponse({"name": note.stem, "text": text})

    async def overview_paper(request: Request) -> Response:
        """The paper whose overview note a link in the chat names by its path on the laptop,
        so the page opens the paper and shows the note."""
        found = library.paper_for_overview_note(request.query_params.get("path", ""))
        note = found and library.overview_note(found)
        if not note or not note.is_file():
            return JSONResponse({"error": "No overview note there."}, status_code=404)
        return JSONResponse({"pdf": found.pdf})

    async def delete_overview(request: Request) -> Response:
        """An overview note wanted for one reading only: to the Trash, whence it can come
        back. Nothing else the skill wrote is touched."""
        note = overview_note(request.path_params["path"])
        if not note:
            return PlainTextResponse("This paper has no overview note.", status_code=404)
        await asyncio.to_thread(send2trash, note)
        log.info("overview note moved to the Trash: %s", note)
        return Response(status_code=204)

    async def commands(request: Request) -> Response:
        try:
            listed = await sessions.command_list()
        except Exception as error:
            log.warning("could not list the slash commands: %s", error)
            listed = []
        return JSONResponse(listed)

    async def chats(request: Request) -> Response:
        listing = await asyncio.to_thread(sessions.listing)
        return JSONResponse(listing)

    def settings_reply(values: dict) -> JSONResponse:
        return JSONResponse(
            {
                **values,
                "models": [{"id": alias, "name": name} for alias, name in MODELS.items()],
                "default_model": DEFAULT_MODEL,
                "longest_note": LONGEST_NOTE,
            }
        )

    async def get_settings(request: Request) -> Response:
        return settings_reply(sessions.settings.get())

    async def put_settings(request: Request) -> Response:
        """The reader's note, for the chats that start from now on."""
        body = await request.body()
        if len(body) > MAX_SETTINGS:
            return PlainTextResponse("Too long.", status_code=413)
        try:
            saved = await asyncio.to_thread(sessions.settings.update, json.loads(body))
        except ValueError as error:
            return PlainTextResponse(str(error), status_code=400)
        log.info("settings: a note of %d characters", len(saved["note"]))
        return settings_reply(saved)

    async def pdf(request: Request) -> Response:
        try:
            path = library.resolve_pdf(request.path_params["path"])
        except LookupError:
            return PlainTextResponse("No such PDF in the library.", status_code=404)
        return FileResponse(
            path,
            media_type="application/pdf",
            headers={"Cache-Control": "no-cache", "ETag": version(path)},
        )

    async def save_pdf(request: Request) -> Response:
        """The paper's PDF with the highlights made in the page: what PDF.js saved, the
        bytes it loaded and an incremental update after them. `If-Match` names the version
        it loaded or last saved, `X-Carrel-Base-Length` how many bytes it loaded."""
        rel = request.path_params["path"]
        try:
            path = library.resolve_pdf(rel)
        except LookupError:
            return PlainTextResponse("No such PDF in the library.", status_code=404)
        try:
            base = int(request.headers.get("x-carrel-base-length", ""))
        except ValueError:
            return PlainTextResponse("Say how many bytes the page loaded.", status_code=400)
        data = bytearray()
        async for chunk in request.stream():
            data += chunk
            if len(data) > MAX_PDF:
                return PlainTextResponse("Too large for a paper.", status_code=413)
        if not data.startswith(b"%PDF-") or not 0 < base <= len(data):
            return PlainTextResponse("Not a PDF this page loaded.", status_code=400)
        async with writing:
            saved = await asyncio.to_thread(
                write_pdf, path, bytes(data), base, request.headers.get("if-match")
            )
        if saved is None:
            log.info("not saved, changed elsewhere: %s", rel)
            return PlainTextResponse("The PDF changed since the page loaded it.", status_code=409)
        log.info("saved %s (%d bytes after the %d loaded)", rel, len(data) - base, base)
        return Response(status_code=204, headers={"ETag": saved})

    async def page_log(request: Request) -> Response:
        """A line from a page's console: what goes wrong on the iPad is seen here."""
        body = await request.body()
        if len(body) > MAX_LOG:
            return PlainTextResponse("Too long.", status_code=413)
        try:
            entry = json.loads(body)
        except ValueError:
            entry = None
        if not isinstance(entry, dict):
            return PlainTextResponse("Not a log entry.", status_code=400)
        level, message, where, stack = (
            str(entry.get(key) or "") for key in ("level", "message", "where", "stack")
        )
        log.warning(
            "page %s: %s%s%s",
            level or "log",
            message,
            f" ({where})" if where else "",
            f"\n{stack}" if stack else "",
        )
        return Response(status_code=204)

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
            Route("/area/{topic:path}", area),
            Route("/review/{scope:path}", review_page),
            Route("/api/library", library_document),
            Route("/pdf/{path:path}", pdf, methods=["GET", "HEAD"]),
            Route("/pdf/{path:path}", save_pdf, methods=["PUT"]),
            Route("/api/log", page_log, methods=["POST"]),
            Route("/api/paper/{path:path}", paper),
            Route("/api/overview-note", overview_paper, methods=["GET", "HEAD"]),
            Route("/api/overview/{path:path}", overview, methods=["GET", "HEAD"]),
            Route("/api/overview/{path:path}", delete_overview, methods=["DELETE"]),
            Route("/api/commands", commands),
            Route("/api/chats", chats),
            Route("/api/settings", get_settings, methods=["GET", "HEAD"]),
            Route("/api/settings", put_settings, methods=["PUT"]),
            WebSocketRoute("/ws", session),
            Mount("/static", PageFiles(directory=STATIC), name="static"),
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
