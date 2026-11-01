"""The bench: a page served to the tablet that shows the same crop of a paper drawn several ways,
side by side at the size the tablet reads it, and keeps the reader's picks.

    uv run python experiments/crisp-pages/bench.py --library ~/papers [--port 8519]
    tailscale serve --bg --https=8444 http://127.0.0.1:8519    # once: the bench on the tailnet

Then open https://<this machine>.<tailnet>.ts.net:8444/ on the tablet. It is carrel's own
admission (server.Guard): a loopback Host, or the reader's Tailscale login; nothing here is
carrel's server, and nothing it does changes the library.

What it serves:
- `/` the bench page (`bench/`), and carrel's static files at `/static/` for PDF.js;
- `/api/crops` the crops of `papers.yaml`, without their paths;
- `/pdf/<id>` the crop's page as a one-page PDF (`?whole=1` the whole paper, for measuring;
  `?embolden=W` every text object filled and stroked with a W pt line, built in memory);
- `/render/<id>?zoom=Z` the crop drawn by MuPDF at Z device pixels a point, with `aa` its
  anti-aliasing level (0–8), `gamma` an exponent on the tones (above 1 darkens the greys),
  `sauvola` a threshold's k (0 for none), and `embolden` as for the PDF;
- `POST /api/pick`, `POST /api/measure` one line appended to picks.jsonl or measurements.jsonl.
"""

import argparse
import asyncio
import json
import re
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pymupdf
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
from carrel.server import STATIC, Guard, csp  # noqa: E402

PAGE = HERE / "bench"
PICKS = HERE / "picks.jsonl"
MEASUREMENTS = HERE / "measurements.jsonl"
MAX_RECORD = 256 * 1024
NO_STORE = {"Cache-Control": "no-store"}

# MuPDF's anti-aliasing level is global to the process, so one drawing at a time.
mupdf = threading.Lock()


def load_crops() -> dict[str, dict]:
    return {
        crop["id"]: crop for crop in yaml.safe_load((HERE / "papers.yaml").read_text())["crops"]
    }


# Emboldening: every text object filled, then stroked with a hairline (text rendering mode 2), as
# MuPDF and KOReader embolden. A stream that hides its text (mode 3, a scan's OCR layer) keeps
# it hidden. The fill colours set inside a text object are given to the stroke too; a colour set
# before it is not, and the stroke stays the default black.
NUM = rb"-?(?:\d+\.?\d*|\.\d+)"
TOKEN_END = rb"(?=[\s\[\]()<>/%]|$)"
TOKEN_START = rb"(?:(?<=[\s\]\)>])|^)"
BT = re.compile(TOKEN_START + rb"BT" + TOKEN_END)
TEXT_OBJECT = re.compile(
    TOKEN_START + rb"BT" + TOKEN_END + rb"(.*?)" + TOKEN_START + rb"ET" + TOKEN_END, re.S
)
MODE = re.compile(rb"(" + NUM + rb")(\s+)Tr" + TOKEN_END)
FILL = re.compile(
    rb"((?:"
    + NUM
    + rb"\s+){3})rg"
    + TOKEN_END
    + rb"|((?:"
    + NUM
    + rb"\s+){4})k"
    + TOKEN_END
    + rb"|("
    + NUM
    + rb"\s+)g"
    + TOKEN_END
)


def embolden_stream(data: bytes, width: float) -> bytes:
    if not BT.search(data):
        return data
    hides = any(float(m.group(1)) == 3 for m in MODE.finditer(data))
    stroke = f" {width:.3f} w ".encode()

    def mirror(match: re.Match) -> bytes:
        rgb, cmyk, grey = match.groups()
        if rgb:
            return rgb + b"rg " + rgb + b"RG"
        if cmyk:
            return cmyk + b"k " + cmyk + b"K"
        return grey + b"g " + grey + b"G"

    def text_object(match: re.Match) -> bytes:
        body = FILL.sub(mirror, match.group(1))
        # Mode 0 (fill) becomes 2 (fill, then stroke); other modes keep theirs.
        body = MODE.sub(
            lambda m: (b"2" if float(m.group(1)) == 0 else m.group(1)) + m.group(2) + b"Tr", body
        )
        start = b"BT" + stroke + (b"" if hides else b"2 Tr ")
        return start + body + b"ET"

    return TEXT_OBJECT.sub(text_object, data)


def page_pdf(path: Path, page: int | None, embolden: float) -> bytes:
    doc = pymupdf.open(path)
    try:
        if page is not None:
            doc.select([page - 1])
        if embolden > 0:
            streams = set()
            for each in doc:
                streams.update(each.get_contents())
            for xref in range(1, doc.xref_length()):
                if doc.xref_is_stream(xref) and doc.xref_get_key(xref, "Subtype") == (
                    "name",
                    "/Form",
                ):
                    streams.add(xref)
            for xref in streams:
                doc.update_stream(xref, embolden_stream(doc.xref_stream(xref), embolden))
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def sauvola(grey: np.ndarray, window: int, k: float, r: float = 128.0) -> np.ndarray:
    """Black on white: a pixel is ink when darker than its neighbourhood's mean, lowered by k
    where the neighbourhood is flat (Sauvola and Pietikäinen, 2000)."""
    pad = window // 2
    padded = np.pad(grey.astype(np.float64), pad + 1, mode="edge")
    total = padded.cumsum(0).cumsum(1)
    squares = (padded**2).cumsum(0).cumsum(1)
    h, w = grey.shape
    y0, y1 = np.arange(h), np.arange(h) + window
    x0, x1 = np.arange(w), np.arange(w) + window

    def box(table: np.ndarray) -> np.ndarray:
        return (
            table[np.ix_(y1, x1)]
            - table[np.ix_(y0, x1)]
            - table[np.ix_(y1, x0)]
            + table[np.ix_(y0, x0)]
        )

    n = window * window
    mean = box(total) / n
    std = np.sqrt(np.maximum(box(squares) / n - mean**2, 0))
    threshold = mean * (1 + k * (std / r - 1))
    return np.where(grey > threshold, 255, 0).astype(np.uint8)


def render_crop(
    path: Path, crop: dict, zoom: float, aa: int, gamma: float, k: float, embolden: float = 0
) -> bytes:
    source = page_pdf(path, crop["page"], embolden)
    with mupdf:
        before = pymupdf.TOOLS.show_aa_level()["text"]
        pymupdf.TOOLS.set_aa_level(aa)
        try:
            doc = pymupdf.open(stream=source, filetype="pdf")
            page = doc[0]
            pix = page.get_pixmap(
                matrix=pymupdf.Matrix(zoom, zoom), clip=pymupdf.Rect(crop["rect"]), alpha=False
            )
            doc.close()
        finally:
            pymupdf.TOOLS.set_aa_level(before)
    if gamma != 1 or k > 0:
        pixels = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if gamma != 1:
            table = (255 * (np.arange(256) / 255) ** gamma).round().astype(np.uint8)
            pixels = table[pixels]
        if k > 0:
            grey = pixels.mean(axis=2)
            window = max(15, int(round(zoom * 12)) | 1)  # about 12 pt: a few lines of text
            pixels = np.repeat(sauvola(grey, window, k)[:, :, None], 3, axis=2)
        pix = pymupdf.Pixmap(
            pymupdf.csRGB, pix.width, pix.height, np.ascontiguousarray(pixels).tobytes(), False
        )
    return pix.tobytes("png")


def make_app(library: Library, hosts: set[str], logins: set[str]):
    crops = load_crops()

    def crop_for(request: Request) -> dict:
        crop = crops.get(request.path_params["id"])
        if crop is None:
            raise LookupError(request.path_params["id"])
        return crop

    async def index(request: Request) -> Response:
        return FileResponse(
            PAGE / "index.html", headers={"Content-Security-Policy": csp(request), **NO_STORE}
        )

    async def crop_list(request: Request) -> Response:
        public = [{k: v for k, v in crop.items() if k != "pdf"} for crop in crops.values()]
        return JSONResponse(public, headers=NO_STORE)

    async def pdf(request: Request) -> Response:
        try:
            crop = crop_for(request)
            embolden = float(request.query_params.get("embolden", 0))
        except (LookupError, ValueError):
            return PlainTextResponse("No such crop.", status_code=404)
        whole = request.query_params.get("whole") == "1"
        path = library.resolve_pdf(crop["pdf"])
        data = await asyncio.to_thread(page_pdf, path, None if whole else crop["page"], embolden)
        return Response(
            data, media_type="application/pdf", headers={"Cache-Control": "max-age=3600"}
        )

    async def render(request: Request) -> Response:
        try:
            crop = crop_for(request)
            query = request.query_params
            zoom = min(float(query.get("zoom", 4)), 16.0)
            aa = max(0, min(int(query.get("aa", 8)), 8))
            gamma = float(query.get("gamma", 1))
            k = float(query.get("sauvola", 0))
            embolden = float(query.get("embolden", 0))
        except (LookupError, ValueError):
            return PlainTextResponse("No such crop.", status_code=404)
        path = library.resolve_pdf(crop["pdf"])
        data = await asyncio.to_thread(render_crop, path, crop, zoom, aa, gamma, k, embolden)
        return Response(data, media_type="image/png", headers={"Cache-Control": "max-age=3600"})

    def appender(path: Path):
        async def append(request: Request) -> Response:
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
            with path.open("a") as out:
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
            return JSONResponse({"ok": True})

        return append

    routes = [
        Route("/", index),
        Route("/api/crops", crop_list),
        Route("/pdf/{id}", pdf),
        Route("/render/{id}", render),
        Route("/api/pick", appender(PICKS), methods=["POST"]),
        Route("/api/measure", appender(MEASUREMENTS), methods=["POST"]),
        Mount("/bench", StaticFiles(directory=PAGE)),
        Mount("/static", StaticFiles(directory=STATIC)),
    ]
    return Guard(Starlette(routes=routes), hosts, logins)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--library", default="~/papers")
    parser.add_argument("--port", type=int, default=8519)
    args = parser.parse_args()
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
