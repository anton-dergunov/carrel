"""The Mac's runs as one video a paper: every renderer's recorded frames in a grid, each frame shown
from its own time until the next, all from the start of their spin, at 60 fps, so the flicks can
be watched side by side at their real speed.

    uv run --with numpy --with pillow python experiments/pdf-renderers/side_by_side.py RUNS_DIR \
        [--round 1] [--papers long,figures] [--out DIR]

RUNS_DIR is mac_runs.py's --out. Writes <paper>-round<N>.mp4 with ffmpeg.
"""

import argparse
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/mac-bench"))
import bench  # noqa: E402

ORDER = [
    ("webkit-carrel", "carrel (PDF.js, previews)"),
    ("webkit-pdfjs", "PDF.js, WebKit"),
    ("webkit-embedpdf", "EmbedPDF, WebKit"),
    ("webkit-mupdf", "MuPDF.js, WebKit"),
    ("pdfkit", "PDFKit"),
    ("chrome-pdfjs", "PDF.js, Chrome"),
    ("chrome-pdfium", "PDFium, Chrome"),
]
FPS = 60
CELL_W = 540
LABEL_H = 28


def frames_of(run: Path):
    t0 = float((run / "t0").read_text())
    times = [float(line) for line in (run / "frames.csv").read_text().split()[1:]]
    return [t - times[0] for t in times], sorted(run.glob("f*.pgm")), t0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("runs")
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--papers", default="long,figures")
    parser.add_argument("--out", default=".")
    args = parser.parse_args()
    font = ImageFont.load_default(size=18)
    for paper in args.papers.split(","):
        cells = []
        for name, label in ORDER:
            run = Path(args.runs) / f"{args.round}-{paper}-{name}" / "spin1"
            if not (run / "frames.csv").exists():
                continue
            times, paths, _ = frames_of(run)
            cells.append((label, times, paths))
        if not cells:
            continue
        first = bench.load(cells[0][2][0])
        cell_h = int(CELL_W * first.shape[0] / first.shape[1])
        cols = 4
        rows = (len(cells) + cols - 1) // cols
        width, height = cols * CELL_W, rows * (cell_h + LABEL_H)
        width, height = width + width % 2, height + height % 2
        duration = max(times[-1] for _, times, _ in cells) + 500
        out = Path(args.out) / f"{paper}-round{args.round}.mp4"
        encoder = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray"]
            + ["-s", f"{width}x{height}", "-r", str(FPS), "-i", "-"]
            + ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out)],
            stdin=subprocess.PIPE,
        )
        cache = {}
        for step in range(int(duration * FPS / 1000)):
            t = step * 1000 / FPS
            canvas = Image.new("L", (width, height), 255)
            draw = ImageDraw.Draw(canvas)
            for i, (label, times, paths) in enumerate(cells):
                k = max(0, int(np.searchsorted(times, t, side="right")) - 1)
                key = (i, k)
                if key not in cache:
                    image = Image.fromarray(bench.load(paths[k]).clip(0, 255).astype(np.uint8))
                    cache[key] = image.resize((CELL_W, cell_h))
                x, y = (i % cols) * CELL_W, (i // cols) * (cell_h + LABEL_H)
                draw.text((x + 8, y + 4), label, fill=0, font=font)
                canvas.paste(cache[key], (x, y + LABEL_H))
            draw.text(
                (width - CELL_W + 8, height - LABEL_H), f"{t / 1000:5.2f} s", fill=0, font=font
            )
            encoder.stdin.write(canvas.tobytes())
        encoder.stdin.close()
        encoder.wait()
        print(out)


if __name__ == "__main__":
    main()
