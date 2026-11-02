"""The bench: the same papers in each renderer the experiment compares, served to the Mac's
browsers and to the iPad, and the timings their pages keep.

    ./experiments/pdf-renderers/fetch.sh                       # once: EmbedPDF and MuPDF.js
    uv run python experiments/pdf-renderers/bench.py --library ~/papers [--port 8519]
    tailscale serve --bg --https=8444 http://127.0.0.1:8519    # once: the bench on the tailnet

Then open http://127.0.0.1:8519/ on the Mac, or https://<this machine>.<tailnet>.ts.net:8444/ on
the iPad. It is carrel's own admission (server.Guard): a loopback Host, or the reader's Tailscale
login; nothing here is carrel's server, and nothing it does changes the library.

What it serves:
- `/` the list of papers and viewers; `/view/<viewer>?paper=<id>` a paper in one viewer
  (`pdfjs`, `embedpdf`, `mupdf`), opened at the paper's middle page (`&page=N` another);
- `/api/papers` the papers of `papers.yaml`, without their paths; `/pdf/<id>` a paper's PDF;
- `/viewers/` the viewers' scripts, `/vendor/` the renderers `fetch.sh` fetched, `/static/`
  carrel's static files, for PDF.js;
- `POST /api/log` one line appended to runs.jsonl: what a viewer's page measured.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import uvicorn
import yaml
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "src"))
from carrel import tailnet  # noqa: E402
from carrel.engine import Library  # noqa: E402
from carrel.server import STATIC, Guard  # noqa: E402

VIEWERS = HERE / "viewers"
VENDOR = HERE / "vendor"
RUNS = HERE / "runs.jsonl"
MAX_RECORD = 256 * 1024
NO_STORE = {"Cache-Control": "no-store"}
NAMES = ("pdfjs", "embedpdf", "mupdf")

# Carrel's policy, with WebAssembly allowed to compile: PDFium and MuPDF are nothing else. The
# bench's alone; carrel's pages keep theirs.
CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; "
    "connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)


def load_papers() -> dict[str, dict]:
    papers = yaml.safe_load((HERE / "papers.yaml").read_text())["papers"]
    return {paper["id"]: paper for paper in papers}


def make_app(library: Library, hosts: set[str], logins: set[str]):
    papers = load_papers()

    async def index(request: Request) -> Response:
        return FileResponse(
            VIEWERS / "index.html", headers={"Content-Security-Policy": CSP, **NO_STORE}
        )

    async def view(request: Request) -> Response:
        name = request.path_params["viewer"]
        if name not in NAMES:
            return PlainTextResponse("No such viewer.", status_code=404)
        return FileResponse(
            VIEWERS / f"{name}.html", headers={"Content-Security-Policy": CSP, **NO_STORE}
        )

    async def paper_list(request: Request) -> Response:
        public = [{k: v for k, v in paper.items() if k != "pdf"} for paper in papers.values()]
        return JSONResponse(public, headers=NO_STORE)

    async def pdf(request: Request) -> Response:
        paper = papers.get(request.path_params["id"])
        if paper is None:
            return PlainTextResponse("No such paper.", status_code=404)
        return FileResponse(
            library.resolve_pdf(paper["pdf"]),
            media_type="application/pdf",
            headers={"Cache-Control": "max-age=3600"},
        )

    async def log(request: Request) -> Response:
        body = await request.body()
        if len(body) > MAX_RECORD:
            return PlainTextResponse("Too large.", status_code=413)
        try:
            record = json.loads(body)
        except ValueError:
            return PlainTextResponse("Not JSON.", status_code=400)
        if not isinstance(record, dict):
            return PlainTextResponse("Not a record.", status_code=400)
        record = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **record}
        with RUNS.open("a") as out:
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
        return JSONResponse({"ok": True})

    routes = [
        Route("/", index),
        Route("/view/{viewer}", view),
        Route("/api/papers", paper_list),
        Route("/pdf/{id}", pdf),
        Route("/api/log", log, methods=["POST"]),
        Mount("/viewers", StaticFiles(directory=VIEWERS)),
        Mount("/vendor", StaticFiles(directory=VENDOR, check_dir=False)),
        Mount("/static", StaticFiles(directory=STATIC)),
    ]
    return Guard(Starlette(routes=routes), hosts, logins)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--library", default="~/papers")
    parser.add_argument("--port", type=int, default=8519)
    args = parser.parse_args()
    if not (VENDOR / "VERSIONS").exists():
        sys.exit(f"Run {HERE / 'fetch.sh'} first.")
    library = Library(args.library)
    name, login = tailnet.identity()
    app = make_app(library, {name} if name else set(), {login} if login else set())
    print(f"The bench: http://127.0.0.1:{args.port}/")
    if name:
        print(
            f"  on the tailnet (once `tailscale serve --bg --https=8444 http://127.0.0.1:{args.port}`): https://{name}:8444/"
        )
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
