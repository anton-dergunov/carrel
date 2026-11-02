"""Measures the PDF in the Mac app as the eye sees it: real wheel events and clicks, the window
recorded at 60 fps, and each frame of the PDF's pane classified.

    uv run --with numpy python scripts/mac-bench/bench.py spin [--at X,Y] [--runs N]
    uv run --with numpy python scripts/mac-bench/bench.py clicks X,Y X,Y ... [--runs N]
    uv run --with numpy python scripts/mac-bench/bench.py video RECORDING.mov [--rect X,Y,W,H]
    uv run --with numpy python scripts/mac-bench/bench.py frames DIR ... [--grey G]

`spin` flicks a free-spinning wheel violently over the paper in view: to the start, down, and to
the start again (from the middle of a long paper, so that the pages crossed are not all drawn). It
prints how long the pane showed nothing painted (the viewer's grey), a page blank, or a blurred
preview. `clicks` clicks each point in turn (tabs, in screen points) and prints, per click, when
the pane changed and whether any frame after that differed from where it settled (a flash, a
preview, a redraw). `video` sorts the frames of a screen recording made elsewhere (the iPad's,
flicked by hand) the same way, with ffmpeg. `frames` sorts again the frames an earlier spin kept
(each folder under --out holding a frames.csv), after a change to how frames are sorted.

The app must be on screen with a paper open; the terminal needs Screen Recording and
Accessibility. `--app` measures another app's window (com.apple.Safari), `--rect X,Y,W,H` the
pane in the window's points (by default its left 58%, under the tabs), `--grey` the viewer's
background as gray (223 in the light theme). Frames are kept under --out (a temporary folder).
`--json FILE` appends each run's result to FILE, named by `--label`.
"""

import argparse
import json
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


def laplacian(g):
    return np.abs(4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:])


def fineness(g):
    """How much detail the finest scale holds against the next: the Laplacian's mean at the
    frame's own pixels over its mean at half of them, or None where there is too little to tell
    (under 2% ink: a gap's soft edges alone read as blurred). A page drawn sharp gives about 0.93,
    whether text or photographs, and 0.75–0.85 while it moves (the compositor resamples it at a
    fractional offset); one drawn at half the resolution and enlarged, about 0.55. A scan whose own
    pixels are coarse, or a photograph the PDF holds at low resolution, reads as blurred too."""
    if (g < 160).mean() < 0.02:
        return None
    h, w = g.shape[0] // 2 * 2, g.shape[1] // 2 * 2
    half = (g[:h:2, :w:2] + g[1:h:2, :w:2] + g[:h:2, 1:w:2] + g[1:h:2, 1:w:2]) / 4
    coarse = laplacian(half).mean()
    return None if coarse < 2 else laplacian(g).mean() / coarse


def classify(frames, grey, tolerance=1):
    """Each frame: 'grey' (more than a quarter of the pane unpainted), 'blank' (a run of rows with
    no ink over 40% of the pane), 'blurred' (a quarter of the pane, or more, drawn below its
    resolution: see fineness), or 'ok'. `tolerance` is how far from `grey` a pixel may be and
    still be unpainted (a video's compression moves it).

    'blurred' once meant under 60% of the sharpest frame's detail within two seconds, which took a
    page of photographs beside a page of text for blurred."""
    kinds = []
    for frame in frames:
        g = load(frame).astype(np.float64)
        core = g[:, g.shape[1] * 6 // 100 : g.shape[1] * 94 // 100]
        greyish = np.abs(core - grey) <= tolerance
        inkless = ~(core < 200).any(axis=1) & (greyish.mean(axis=1) < 0.5)
        run = best = 0
        for row in inkless:
            run = run + 1 if row else 0
            best = max(best, run)
        strips = np.array_split(core, 4)
        fine = [fineness(strip) for strip in strips]
        kinds.append(
            "grey"
            if greyish.mean() > 0.25
            else "blank"
            if best / len(core) > 0.4
            else "blurred"
            if any(f is not None and f < 0.65 for f in fine)
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
        shown = shown_times(times, kinds)
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
        settled = settling(times, frames)
        print(f"  settled after each stop: {settled} ms")
        keep(
            args,
            {
                "what": "spin",
                "run": run + 1,
                "settled": settled,
                **{k: round(v) for k, v in shown.items()},
            },
        )


def offset(a, b, most=200):
    """How far the pane's content moved between two frames, in rows: the shift of their row
    profiles that matches them best (0 when not shifting matches best)."""
    best, moved = np.abs(a - b).mean(), 0
    for s in range(-most, most + 1):
        x, y = a[max(0, s) : len(a) + min(0, s)], b[max(0, -s) : len(b) + min(0, -s)]
        if s and len(x) >= len(a) // 2 and (d := np.abs(x - y).mean()) < best:
            best, moved = d, s
    return moved


def settling(times, frames):
    """After each time the paper stopped and stayed still for 400 ms or more, how long the pane
    went on changing: the drawing catching up (0 when it was done as it stopped)."""
    pictures = [load(frame).astype(np.float64) for frame in frames]
    profiles = [g[:, g.shape[1] // 10 : g.shape[1] * 9 // 10].mean(axis=1) for g in pictures]
    moving = [False] + [offset(profiles[i], profiles[i - 1]) != 0 for i in range(1, len(pictures))]
    changed = [False] + [
        np.abs(pictures[i] - pictures[i - 1]).mean() > 0.2 for i in range(1, len(pictures))
    ]
    settled, i = [], 1
    while i < len(pictures):
        if not (moving[i - 1] and not moving[i]):
            i += 1
            continue
        stop, j, last = times[i - 1], i, None
        while j < len(pictures) and not moving[j]:
            last = times[j] if changed[j] else last
            j += 1
        if times[min(j, len(times) - 1)] - stop >= 400:
            settled.append(round(0 if last is None else last - stop))
        i = j
    return settled


def shown_times(times, kinds):
    """How long each kind was on screen: each frame until the next."""
    shown = {}
    for t, next_t, kind in zip(times, times[1:], kinds):
        shown[kind] = shown.get(kind, 0) + next_t - t
    return shown


def again(args, folder):
    for csv in sorted(Path(folder).rglob("frames.csv")):
        run = csv.parent
        t0 = float((run / "t0").read_text())
        times = [t0 + float(line) for line in csv.read_text().split()[1:]]
        frames = sorted(run.glob("f*.pgm"))
        shown = shown_times(times, classify(frames, args.grey))
        settled = settling(times, frames)
        name = str(run.relative_to(folder))
        print(
            f"{name}: "
            + ", ".join(f"{k} {shown.get(k, 0):.0f} ms" for k in ("grey", "blank", "blurred", "ok"))
            + f"; settled after each stop: {settled} ms"
        )
        keep(
            args,
            {
                "what": "frames",
                "run": name,
                "settled": settled,
                **{k: round(v) for k, v in shown.items()},
            },
        )


def keep(args, result):
    if args.json:
        record = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "app": args.app, "label": args.label}
        with open(args.json, "a") as out:
            out.write(json.dumps({**record, **result}) + "\n")


def video(args, path):
    """A recording's frames, as it has them (a phone's are variable: a frame only when the screen
    changed), each shown until the next; the time each kind was on screen, in all and while the
    paper moved (from the first frame that differs from the one before to half a second after the
    last)."""
    out = Path(args.out) / Path(path).stem
    out.mkdir(parents=True, exist_ok=True)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height"]
        + ["-of", "csv=p=0", path],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()[0]
    w, h = map(int, probe.split(","))
    # By default the screen under the browser's bar and the status bar: its top tenth left out.
    x, y, cw, ch = map(int, args.rect.split(",")) if args.rect else (0, h // 10, w, h - h // 10)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", path, "-fps_mode", "passthrough"]
        + ["-vf", f"crop={cw}:{ch}:{x}:{y},scale=iw/2:ih/2,format=gray", str(out / "f%05d.pgm")],
        check=True,
    )
    times = [
        float(line.strip(",")) * 1000
        for line in subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries"]
            + ["frame=best_effort_timestamp_time", "-of", "csv=p=0", path],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
        if line.strip() not in ("", "N/A")
    ]
    frames = sorted(out.glob("f*.pgm"))
    n = min(len(times), len(frames))
    times, frames = times[:n], frames[:n]
    kinds = classify(frames, args.grey, tolerance=4)
    moving = [False] * n
    previous = load(frames[0])
    for i in range(1, n):
        current = load(frames[i])
        if np.abs(current - previous).mean() > 1:
            j = i
            while j < n and times[j] - times[i] < 500:
                moving[j] = True
                j += 1
        previous = current
    shown, shown_moving = {}, {}
    end = times + [times[-1] + 1000 / 60]
    for i, kind in enumerate(kinds):
        lasted = end[i + 1] - end[i]
        shown[kind] = shown.get(kind, 0) + lasted
        if moving[i]:
            shown_moving[kind] = shown_moving.get(kind, 0) + lasted
    total = sum(shown_moving.values()) or 1
    print(
        f"{Path(path).name}: {n} frames over {(end[-1] - end[0]) / 1000:.1f} s, moving {total / 1000:.1f} s; while moving: "
        + ", ".join(
            f"{kind} {shown_moving.get(kind, 0):.0f} ms ({100 * shown_moving.get(kind, 0) / total:.0f}%)"
            for kind in ("grey", "blank", "blurred", "ok")
        )
    )
    keep(
        args,
        {
            "what": "video",
            "file": Path(path).name,
            "moving": round(total),
            **{k: round(v) for k, v in shown_moving.items()},
        },
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
            kinds = classify(frames[first : settled + 1], args.grey)[:-1]
            unlike = [kind for kind, d in zip(kinds, between) if d > 0.5]
            seen = ", ".join(
                f"{unlike.count(k)} {k}" for k in ("grey", "blank", "blurred", "ok") if k in unlike
            )
            print(
                f"click {run + 1}: on screen {times[first] - at:.0f} ms after, {off} frames after that unlike where it settled"
                + (f" ({seen})" if seen else "")
            )


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("what", choices=["spin", "clicks", "video", "frames"])
    parser.add_argument(
        "points",
        nargs="*",
        help="clicks: X,Y screen points to click in turn; video: recordings; frames: folders",
    )
    parser.add_argument("--at", help="spin: the screen point to spin over (by default the pane)")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--app", default="com.anton.carrel.app")
    parser.add_argument(
        "--rect", help="the pane, X,Y,W,H in the window's points (video: in the recording's pixels)"
    )
    parser.add_argument("--grey", type=int, default=223)
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="spin: each change of kind, in time"
    )
    parser.add_argument("--out", default=tempfile.mkdtemp(prefix="carrel-bench-"))
    parser.add_argument("--json", help="a file each run's result is appended to")
    parser.add_argument("--label", default="", help="what was measured, for --json")
    args = parser.parse_args()
    if args.what == "video":
        for path in args.points:
            video(args, path)
        return
    if args.what == "frames":
        for folder in args.points:
            again(args, folder)
        return
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
