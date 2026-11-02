"""The Mac's runs: each renderer opened in turn on the same paper at the same pane size, flicked by
scripts/mac-bench/bench.py (one spin each), and closed, round after round, so that the machine's
load falls on all of them alike. Results are appended to results.jsonl.

    uv run --with numpy python experiments/pdf-renderers/mac_runs.py [--papers long,figures]
        [--rounds 3] [--only webkit-mupdf,...] [--look]

The web viewers run in the PDFKit app's web view (WKWebView: the engine of carrel's Mac app and
of the iPad's Safari), in the same window as its PDFView, and in an instance of Chrome with a
profile of its own, so the reader's own windows are left be. The bench (bench.py) and carrel
(`carrel serve`, for carrel itself) must be serving, and the app built (README.md). `--look`
screenshots each window once instead, to check the panes. It takes the mouse and the screen.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BENCH = "http://127.0.0.1:8519"
CARREL = "http://127.0.0.1:8517"
PDF_ROOT = Path.home() / "Yandex.Disk.localized/Papers"
PDFKIT = HERE / "pdfkit/build/Build/Products/Debug/PDFKitSpike.app"
RESULTS = HERE / "results.jsonl"

# The pane every renderer gets, in points; each window is placed at the screen's top left.
PANE_W, PANE_H = 1230, 1000
CHAT_W = 520
TITLE_BAR = 32
# Chrome's bars above the page (tabs, address), in points; measured with --look.
CHROME_BAR = 87
# Carrel itself, chat beside the paper: wide enough that its paper pane is about PANE_W.
CARREL_W = 2050

APP = "com.anton.carrel.pdfkit-spike"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def app_open(target: str, page: int, pane_w: int, chat_w: int) -> str:
    subprocess.run(
        ["open", "-n", str(PDFKIT), "--args", target, str(page)]
        + [str(pane_w), str(chat_w), str(PANE_H)],
        check=True,
    )
    return APP


def app_close():
    subprocess.run(["pkill", "-f", "PDFKitSpike.app/Contents/MacOS/PDFKitSpike"])


chrome = {}


def chrome_open(url: str) -> str:
    """Chrome as an instance of its own; the bench measures it by its process id."""
    profile = Path(tempfile.mkdtemp(prefix="carrel-chrome-"))
    process = subprocess.Popen(
        [CHROME, f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check"]
        + ["--window-position=0,0", f"--window-size={PANE_W},{CHROME_BAR + PANE_H}"]
        + ["--new-window", url],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    chrome.update(process=process, profile=profile)
    return str(process.pid)


def chrome_close():
    chrome["process"].terminate()
    chrome["process"].wait(timeout=10)
    shutil.rmtree(chrome["profile"], ignore_errors=True)


def targets(paper: dict, carrel_rect, chrome_rect, chrome_grey) -> dict:
    """Each renderer: how to open it (returning the app or process the bench measures), the pane
    in its window's points, its grey, and how to close it."""
    pdf = PDF_ROOT / paper["pdf"]
    page = paper["page"]

    def view(name):
        return f"{BENCH}/view/{name}?paper={paper['id']}"

    pane = (0, TITLE_BAR, PANE_W, PANE_H)
    out = {}
    for name in ("pdfjs", "embedpdf", "mupdf"):
        out[f"webkit-{name}"] = (
            lambda name=name: app_open(view(name), page, PANE_W, CHAT_W),
            pane,
            223,
            app_close,
        )
    out["webkit-carrel"] = (
        lambda: app_open(f"{CARREL}/read/{quote(paper['pdf'])}?page={page}", page, CARREL_W, 0),
        carrel_rect,
        223,
        app_close,
    )
    out["pdfkit"] = (lambda: app_open(str(pdf), page, PANE_W, CHAT_W), pane, 223, app_close)
    out["chrome-pdfjs"] = (
        lambda: chrome_open(view("pdfjs")),
        (0, CHROME_BAR, PANE_W, PANE_H),
        223,
        chrome_close,
    )
    out["chrome-pdfium"] = (
        lambda: chrome_open(
            f"{BENCH}/pdf/{paper['id']}#page={page}&toolbar=0&navpanes=0&view=FitH"
        ),
        chrome_rect,
        chrome_grey,
        chrome_close,
    )
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--papers", default="long,figures")
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--only", help="the renderers to run, by name")
    parser.add_argument("--look", action="store_true")
    parser.add_argument("--out", default="/tmp/carrel-renderers")
    # Settled by --look: the paper's pane in carrel's window, and Chrome's own viewer's.
    parser.add_argument("--carrel-rect", default="0,71,1230,960")
    parser.add_argument("--chrome-rect", default="0,87,1230,1000")
    parser.add_argument("--chrome-grey", type=int, default=32)
    args = parser.parse_args()
    rect = lambda text: tuple(map(int, text.split(",")))  # noqa: E731
    papers = {p["id"]: p for p in yaml.safe_load((HERE / "papers.yaml").read_text())["papers"]}
    for round_ in range(1, (1 if args.look else args.rounds) + 1):
        for paper_id in args.papers.split(","):
            paper = papers[paper_id]
            chosen = targets(
                paper, rect(args.carrel_rect), rect(args.chrome_rect), args.chrome_grey
            )
            for name, (start, pane, grey, stop) in chosen.items():
                if args.only and name not in args.only.split(","):
                    continue
                app = start()
                # MuPDF.js compiles its WebAssembly twice; the others are up in a second or two.
                time.sleep(10 if "mupdf" in name else 6)
                try:
                    if args.look:
                        shot = Path(args.out) / f"look-{name}-{paper_id}.png"
                        shot.parent.mkdir(parents=True, exist_ok=True)
                        subprocess.run(
                            [
                                "screencapture",
                                "-x",
                                "-R",
                                f"0,0,{CARREL_W},{PANE_H + 160}",
                                str(shot),
                            ]
                        )
                        window = subprocess.run(
                            [str(Path.home() / ".cache/carrel-bench/input"), "window", app],
                            capture_output=True,
                            text=True,
                        ).stdout.strip()
                        print(shot, "window", window)
                    else:
                        label = f"{name} {paper_id}"
                        print(f"round {round_}: {label}", flush=True)
                        subprocess.run(
                            [sys.executable, str(ROOT / "scripts/mac-bench/bench.py"), "spin"]
                            + ["--app", app, "--rect", ",".join(map(str, pane))]
                            + ["--grey", str(grey), "--runs", "1", "--json", str(RESULTS)]
                            + ["--label", label, "--out", f"{args.out}/{round_}-{paper_id}-{name}"],
                            check=False,
                        )
                finally:
                    stop()
                time.sleep(1.5)


if __name__ == "__main__":
    main()
