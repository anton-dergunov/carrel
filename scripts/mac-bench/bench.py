"""Measures the PDF in the Mac app as the eye sees it: real wheel events and clicks, the window
recorded at 60 fps, and each frame of the PDF's pane classified.

    uv run --with numpy python scripts/mac-bench/bench.py spin [--at X,Y] [--runs N]
    uv run --with numpy python scripts/mac-bench/bench.py clicks X,Y X,Y ... [--runs N]

`spin` flicks a free-spinning wheel violently over the paper in view: to the start, down, and to
the start again (from the middle of a long paper, so that the pages crossed are not all drawn). It
prints how long the pane showed nothing painted (the viewer's grey), a page blank, or a blurred
preview. `clicks` clicks each point in turn (tabs, in screen points) and prints, per click, when
the pane changed and whether any frame after that differed from where it settled (a flash, a
preview, a redraw).

The app must be on screen with a paper open; the terminal needs Screen Recording and
Accessibility. `--app` measures another app's window (com.apple.Safari), `--rect X,Y,W,H` the
pane in the window's points (by default its left 58%, under the tabs), `--grey` the viewer's
background as gray (223 in the light theme). Frames are kept under --out (a temporary folder).
"""

import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BIN = Path.home() / ".cache" / "carrel-bench"


def tool(name):
    """The Swift tool, compiled again when its source changed."""
    source, binary = HERE / f"{name}.swift", BIN / name
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        BIN.mkdir(parents=True, exist_ok=True)
        subprocess.run(["swiftc", "-O", str(source), "-o", str(binary)], check=True)
    return str(binary)


def window(app):
    out = subprocess.run(
        [tool("input"), "window", app], capture_output=True, text=True, check=True
    ).stdout
    x, y, w, h = map(int, out.split())
    return x, y, w, h


def record(app, seconds, out, rect, act):
    """Records `rect` of the window while `act()` runs; the frames' wall-clock times and paths."""
    capture = subprocess.Popen(
        [tool("capture"), app, str(seconds), str(out), *map(str, rect)],
        stdout=subprocess.PIPE,
        text=True,
    )
    assert capture.stdout.readline().strip() == "recording", "the recording did not start"
    time.sleep(0.3)
    act()
    capture.wait()
    t0 = float((out / "t0").read_text())
    times = [t0 + float(line) for line in (out / "frames.csv").read_text().split()[1:]]
    return times, sorted(out.glob("f*.pgm"))


def load(path):
    data = path.read_bytes()
    _, size, _, pixels = data.split(b"\n", 3)
    w, h = map(int, size.split())
    return np.frombuffer(pixels, dtype=np.uint8).reshape(h, w).astype(np.int16)


def classify(frames, grey):
    """Each frame: 'grey' (more than a quarter of the pane unpainted), 'blank' (a run of rows with
    no ink over 40% of the pane), 'blurred' (under 60% of the sharpest frame within two seconds),
    or 'ok'."""
    stats = []
    for frame in frames:
        g = load(frame)
        core = g[:, g.shape[1] * 6 // 100 : g.shape[1] * 94 // 100]
        greyish = np.abs(core - grey) <= 1
        inkless = ~(core < 200).any(axis=1) & (greyish.mean(axis=1) < 0.5)
        run = best = 0
        for row in inkless:
            run = run + 1 if row else 0
            best = max(best, run)
        lap = np.abs(
            4 * core[1:-1, 1:-1]
            - core[:-2, 1:-1]
            - core[2:, 1:-1]
            - core[1:-1, :-2]
            - core[1:-1, 2:]
        )
        stats.append((float(greyish.mean()), best / len(core), float(lap.mean())))
    sharp = [s for _, _, s in stats]
    kinds = []
    for i, (grey_share, blank, s) in enumerate(stats):
        near = max(sharp[max(0, i - 120) : i + 120])
        kinds.append(
            "grey"
            if grey_share > 0.25
            else "blank"
            if blank > 0.4
            else "blurred"
            if s < 0.6 * near
            else "ok"
        )
    return kinds


def spin(args, rect, at):
    x, y = at

    def act():
        for direction in ("up", "down", "up"):
            subprocess.run(
                [tool("input"), "spin", str(x), str(y), direction, "90", "14", "2", "8"], check=True
            )
            time.sleep(1.5)

    for run in range(args.runs):
        out = Path(args.out) / f"spin{run + 1}"
        times, frames = record(args.app, 8.5, out, rect, act)
        kinds = classify(frames, args.grey)
        shown = {}
        for t, next_t, kind in zip(times, times[1:], kinds):
            shown[kind] = shown.get(kind, 0) + next_t - t
        if args.verbose:
            previous = None
            for t, kind in zip(times, kinds):
                if kind != previous:
                    print(f"  {t - times[0]:7.0f} ms  {kind}")
                previous = kind
        print(
            f"spin {run + 1}: "
            + ", ".join(
                f"{kind} {shown.get(kind, 0):.0f} ms" for kind in ("grey", "blank", "blurred", "ok")
            )
        )


def clicks(args, rect, points):
    for run in range(args.runs):
        out = Path(args.out) / f"clicks{run + 1}"
        when = []

        def act():
            for x, y in points:
                up = subprocess.run(
                    [tool("input"), "click", str(x), str(y)],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                when.append(float(up.stdout))
                time.sleep(1.6)

        times, frames = record(args.app, 1 + 1.7 * len(points), out, rect, act)
        for at in when:
            before = max(i for i, t in enumerate(times) if t < at)
            settled = max(i for i, t in enumerate(times) if t < at + 800)
            last = load(frames[settled])
            first = next(
                (
                    i
                    for i in range(before + 1, settled + 1)
                    if np.abs(load(frames[i]) - load(frames[before])).mean() > 1
                ),
                None,
            )
            if first is None:
                print(f"click {run + 1}: no change")
                continue
            between = [np.abs(load(frames[i]) - last).mean() for i in range(first, settled)]
            off = sum(d > 0.5 for d in between)
            print(
                f"click {run + 1}: on screen {times[first] - at:.0f} ms after, {off} frames after that unlike where it settled"
            )


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("what", choices=["spin", "clicks"])
    parser.add_argument("points", nargs="*", help="clicks: X,Y screen points to click in turn")
    parser.add_argument("--at", help="spin: the screen point to spin over (by default the pane)")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--app", default="com.anton.carrel.app")
    parser.add_argument("--rect", help="the pane, X,Y,W,H in the window's points")
    parser.add_argument("--grey", type=int, default=223)
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="spin: each change of kind, in time"
    )
    parser.add_argument("--out", default=tempfile.mkdtemp(prefix="carrel-bench-"))
    args = parser.parse_args()
    wx, wy, ww, wh = window(args.app)
    rect = tuple(map(int, args.rect.split(","))) if args.rect else (20, 80, int(ww * 0.58), wh - 92)
    print(f"window {ww}x{wh} at {wx},{wy}; pane {rect}; frames in {args.out}")
    if args.what == "spin":
        at = (
            tuple(map(int, args.at.split(",")))
            if args.at
            else (wx + rect[0] + rect[2] // 2, wy + rect[1] + rect[3] // 2)
        )
        spin(args, rect, at)
    else:
        if not args.points:
            sys.exit("clicks: which points?")
        clicks(args, rect, [tuple(map(int, p.split(","))) for p in args.points])


if __name__ == "__main__":
    main()
