"""Look at the reading page the way the iPad shows it, in WebKit at 820x1180.

    uv run --group shots python scripts/shots.py URL --out DIR [--ask QUESTION]

URL is a reading page of a running carrel, e.g. http://127.0.0.1:8517/read/<pdf>. Takes a
shot once the PDF is drawn. With --ask, it also types the question, waits for the answer
(this runs a real Claude Code turn, which costs; --allow taps Allow on each permission
request), taps the answer's first citation, and
takes a shot after each step. Prints the page the PDF is on at each step.
"""

import argparse
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

IPAD = {"width": 820, "height": 1180}


def wait_for_answer(page, timeout: int, allow: bool, out: Path) -> None:
    """Waits for the turn's end, printing each permission request (and tapping Allow)."""
    seen = 0
    deadline = time.monotonic() + timeout
    while not page.locator(".row.result").count():
        if time.monotonic() > deadline:
            page.screenshot(path=out / "timeout.png")
            raise TimeoutError(f"no answer in {timeout} s (screenshot: {out / 'timeout.png'})")
        requests = page.locator(".permission")
        for i in range(seen, requests.count()):
            print("asked:", requests.nth(i).inner_text().splitlines()[0])
            if allow:
                requests.nth(i).get_by_role("button", name="Allow").click()
        seen = requests.count()
        page.wait_for_timeout(300)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--ask")
    parser.add_argument("--browser", default="webkit", choices=["webkit", "chromium"])
    parser.add_argument("--timeout", type=int, default=240, help="seconds to wait for an answer")
    parser.add_argument("--allow", action="store_true", help="tap Allow on each permission request")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch()
        page = browser.new_page(viewport=IPAD, device_scale_factor=2, has_touch=True)
        page.on(
            "console",
            lambda m: (
                print(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None
            ),
        )
        page.on("pageerror", lambda e: print(f"page error: {e}"))
        page.goto(args.url)
        page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
        page.wait_for_timeout(800)
        print("opened:", page.inner_text("#page-label"))
        page.screenshot(path=args.out / "1-open.png")

        if args.ask:
            page.fill("#question", args.ask)
            page.click("#send")
            wait_for_answer(page, args.timeout, args.allow, args.out)
            page.wait_for_timeout(500)
            print("answered:", page.inner_text(".row.result"))
            page.screenshot(path=args.out / "2-answer.png")
            citation = page.locator('.answer a[href^="http://pdf.invalid/"]').first
            if citation.count():
                print("citation:", citation.inner_text(), citation.get_attribute("href"))
                citation.click()
                page.wait_for_timeout(1200)
                print("after the citation:", page.inner_text("#page-label"), "| url:", page.url)
                page.screenshot(path=args.out / "3-citation.png")
            else:
                print("no citation in the answer")
        browser.close()


if __name__ == "__main__":
    main()
