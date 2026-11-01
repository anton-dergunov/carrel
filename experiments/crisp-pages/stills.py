"""Every variant the bench shows, as pictures to look at on the laptop between rounds.

    uv run --group shots python experiments/crisp-pages/stills.py [--url http://127.0.0.1:8519/]
        [--device boox=1200x1600@2 ...] [--knob tone ...] [--crop gpt3-body ...] [--count 4]

Opens the bench (which must be running) in Chromium at each device's window and pixel ratio,
and shoots the grid for every knob, crop and window of strengths, labelled with what each cell
is, into stills/<device>/<crop>.<knob>.<offset>.png (not in git: the papers' pages are not
ours). Without --crop it takes one crop of each kind.

The devices default to what the bench measured on them, or a guess before that. Chromium on the
Mac rasterises glyphs its own way, not Android's: the stills are for orientation, and the
tablet's own screen is the judge.
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
MOBILE_CAP = 5242880  # PDF.js's canvas cap on Android and iOS, which desktop Chromium lacks
DEVICES = {
    # name: (CSS width, CSS height, device pixel ratio)
    "boox": (853, 1012, 2.8125),  # measured: Chrome on the Boox Tab X C
    "ipad": (820, 1180, 2.0),
    "phone": (412, 860, 2.625),
}


def device(text: str) -> tuple[str, tuple[int, int, float]]:
    name, _, size = text.partition("=")
    wh, _, ratio = size.partition("@")
    w, h = wh.split("x")
    return name, (int(w), int(h), float(ratio or 2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--url", default="http://127.0.0.1:8519/")
    parser.add_argument("--out", default=str(HERE / "stills"))
    parser.add_argument("--device", action="append", type=device, help="name=WxH@ratio")
    parser.add_argument("--knob", action="append")
    parser.add_argument("--crop", action="append")
    parser.add_argument("--count", type=int, default=4)
    args = parser.parse_args()
    devices = dict(args.device) if args.device else DEVICES
    out = Path(args.out)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, (width, height, ratio) in devices.items():
            context = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=ratio,
                bypass_csp=True,
            )
            page = context.new_page()
            page.on("console", lambda m: m.type == "error" and print(f"  console: {m.text}"))
            page.goto(f"{args.url}?still=1&knob=res&crop=gpt3-body")
            page.wait_for_function("window.benchKnobs")
            knobs = page.evaluate("window.benchKnobs")
            crops = json.loads(page.evaluate("fetch('/api/crops').then(r => r.text())"))
            if args.crop:
                chosen = [c for c in crops if c["id"] in args.crop]
            else:
                kinds = {}
                for crop in crops:
                    kinds.setdefault(crop["kind"], crop)
                chosen = list(kinds.values())
            folder = out / name
            folder.mkdir(parents=True, exist_ok=True)
            for knob, info in knobs.items():
                if args.knob and knob not in args.knob:
                    continue
                for crop in chosen:
                    if crop["id"] not in info["crops"]:
                        continue
                    for offset in range(0, info["levels"], args.count - 1):
                        query = f"still=1&knob={knob}&crop={crop['id']}&offset={offset}&count={args.count}&cap={MOBILE_CAP}"
                        page.goto(f"{args.url}?{query}")
                        page.wait_for_selector('#grid[data-ready="1"]', timeout=60_000)
                        target = folder / f"{crop['id']}.{knob}.{offset}.png"
                        page.locator("#grid").screenshot(path=str(target))
                        print(target.relative_to(out))
            context.close()
        browser.close()


if __name__ == "__main__":
    main()
