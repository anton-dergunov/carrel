"""Look at the reading page the way the iPad shows it, in WebKit at 820x1180.

    uv run --group shots python scripts/shots.py URL --out DIR [--layout PLACE] [--tabs]
        [--find QUERY] [--highlight] [--ask QUESTION]

URL is a reading page of a running carrel, e.g. http://127.0.0.1:8517/read/<pdf>. Takes a
shot once the PDF is drawn. --layout puts the chat below, above, left, right, on a tab, or
hides it, as this device's choice. With --tabs, it opens the list, a second paper, goes back
to the first and checks it comes back at the page it was on, closes the second, and reloads
to see the tabs come back. --find types QUERY into find a letter at a time and prints what it
found. --highlight turns the pen on, selects a line on page 1 and checks it is highlighted, saved
and quoted for the chat; reloads, taps the highlight, recolours it, asks about it, and removes it,
checking each save. It writes into the served PDF: run it against a carrel serving a throwaway
library, never the reader's own. With --ask, it also types the question, waits for the answer
(this runs a real Claude Code turn, which costs; --allow taps Allow on each permission
request), opens the turn's fold, taps the answer's first citation, reloads the page to see
the chat come back, and takes a shot after each step. Prints the page the PDF is on at each
step. Each run starts a new chat: the browser remembers none.
"""

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

IPAD = {"width": 820, "height": 1180}
LAYOUTS = ["bottom", "top", "left", "right", "tab", "hidden"]


def layout_script(layout: str) -> str:
    """Sets this device's layout before the page's own script reads it."""
    place, hidden = ("bottom", True) if layout == "hidden" else (layout, False)
    value = json.dumps({"place": place, "hidden": hidden, "share": 0.4})
    return f"localStorage.setItem('carrel.layout', {json.dumps(value)});"


def tabs_pass(page, out: Path) -> None:
    """Two papers in tabs: the first keeps its place while the second is showing."""
    first = page.url
    page.locator("#viewerContainer").evaluate("c => c.scrollTop = c.scrollHeight / 3")
    page.wait_for_timeout(1200)
    kept = page.inner_text("#page-badge")
    print("first paper at:", kept)
    page.click("#tab-papers")
    page.wait_for_timeout(300)
    print("list showing, address:", page.url)
    page.screenshot(path=out / "tabs-1-list.png")
    links = page.locator("#papers li a")
    for i in range(links.count()):
        href = links.nth(i).get_attribute("href")
        if href and href not in first:
            links.nth(i).click()
            break
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.wait_for_timeout(800)
    print(
        "second paper:",
        page.inner_text("#page-badge"),
        "| tabs:",
        page.locator(".tab.paper").count(),
    )
    page.screenshot(path=out / "tabs-2-second.png")
    page.locator(".tab.paper .label").first.click()
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.wait_for_timeout(1200)
    back = page.inner_text("#page-badge")
    print("first again at:", back, "(kept)" if back == kept else f"(was {kept})")
    page.screenshot(path=out / "tabs-3-first-again.png")
    page.locator(".tab.paper .label").nth(1).click()
    page.wait_for_timeout(800)
    page.locator(".tab.paper .close").click()
    page.wait_for_timeout(800)
    print("closed the second; tabs:", page.locator(".tab.paper").count(), "| address:", page.url)
    page.reload()
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.wait_for_timeout(1200)
    print(
        "after a reload, tabs:",
        page.locator(".tab.paper").count(),
        "| at:",
        page.inner_text("#page-badge"),
    )
    page.screenshot(path=out / "tabs-4-reload.png")


def find_pass(page, query: str, out: Path) -> None:
    """Find, typed as fingers type it: a letter at a time."""
    page.click("#find-button")
    page.type("#find-input", query, delay=120)
    page.wait_for_timeout(1500)
    print(
        f"find {query!r}:",
        page.inner_text("#find-count"),
        "| marked:",
        page.locator(".textLayer .highlight").count(),
    )
    page.screenshot(path=out / "find.png")
    page.click("#find-done")


def center(page, selector: str) -> tuple[float, float]:
    box = page.locator(selector).first.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def saved(page, act) -> str:
    """Does `act()` and waits for the PDF to be saved; the save's status."""
    with page.expect_response(lambda r: r.request.method == "PUT", timeout=10_000) as info:
        act()
    return str(info.value.status)


def highlight_pass(page, out: Path) -> None:
    """A highlight made with the pen, saved, tapped, recoloured, asked about and removed."""
    if page.get_attribute("#pen", "aria-pressed") != "true":
        page.click("#pen")
    select = """() => {
      const span = [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')]
        .find((each) => each.textContent.length > 40);
      const range = document.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.firstChild, 40);
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(range);
      return range.toString();
    }"""
    status = saved(page, lambda: print("selected:", repr(page.evaluate(select))))
    page.wait_for_timeout(300)
    print(
        "highlighted, saved:",
        status,
        "| highlights:",
        page.locator(".highlightEditor").count(),
        "| quoted:",
        repr(page.inner_text("#quote .words")),
    )
    page.screenshot(path=out / "highlight-1-made.png")
    page.reload()
    page.wait_for_selector(".annotationLayer .highlightAnnotation", timeout=30_000)
    page.wait_for_timeout(800)
    print(
        "after a reload, in the file:",
        page.locator(".annotationLayer .highlightAnnotation").count(),
    )
    page.touchscreen.tap(*center(page, ".annotationLayer .highlightAnnotation"))
    page.wait_for_timeout(300)
    print("tapped, panel shown:", page.locator("#mark-panel").is_visible())
    page.screenshot(path=out / "highlight-2-panel.png")
    print("recoloured, saved:", saved(page, lambda: page.click('#mark-panel [aria-label="Pink"]')))
    page.wait_for_timeout(300)
    page.screenshot(path=out / "highlight-3-pink.png")
    page.touchscreen.tap(*center(page, ".highlightEditor, .annotationLayer .highlightAnnotation"))
    page.wait_for_timeout(300)
    page.click("#mark-ask")
    page.wait_for_timeout(500)
    print("asked about it, quoted:", repr(page.inner_text("#quote .words")))
    page.screenshot(path=out / "highlight-4-ask.png")
    page.touchscreen.tap(*center(page, ".highlightEditor, .annotationLayer .highlightAnnotation"))
    page.wait_for_timeout(300)
    print("removed, saved:", saved(page, lambda: page.click("#mark-remove")))
    page.click("#pen")  # off again
    page.reload()
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.wait_for_timeout(1000)
    print(
        "after a reload, in the file:",
        page.locator(".annotationLayer .highlightAnnotation").count(),
    )


def wait_for_answer(page, timeout: int, allow: bool, out: Path) -> None:
    """Waits for the turn's end, printing each permission request (and tapping Allow)."""
    seen = 0
    deadline = time.monotonic() + timeout

    def ended() -> bool:
        return (
            page.locator("#stop").is_hidden()
            and not page.locator(".work.running").count()
            and page.locator(".answer, .row.result").count() > 0
        )

    while not ended():
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
    parser.add_argument("--layout", choices=LAYOUTS, help="where the chat sits")
    parser.add_argument("--tabs", action="store_true", help="open, switch and close paper tabs")
    parser.add_argument("--find", help="find this in the paper, typed a letter at a time")
    parser.add_argument(
        "--highlight", action="store_true", help="make, save, change and remove a highlight"
    )
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
        if args.layout:
            page.add_init_script(layout_script(args.layout))
        page.goto(args.url)
        page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
        page.wait_for_timeout(800)
        print("opened:", page.inner_text("#page-badge"))
        page.screenshot(path=args.out / f"1-open{'-' + args.layout if args.layout else ''}.png")

        if args.tabs:
            tabs_pass(page, args.out)

        if args.find:
            find_pass(page, args.find, args.out)

        if args.highlight:
            highlight_pass(page, args.out)

        if args.ask:
            page.fill("#question", args.ask)
            page.click("#send")
            wait_for_answer(page, args.timeout, args.allow, args.out)
            page.wait_for_timeout(500)
            print("answered:", page.locator(".work > summary, .row.result").last.inner_text())
            print("status:", page.inner_text("#status"))
            page.screenshot(path=args.out / "2-answer.png")
            if page.locator(".work").count():
                page.locator(".work > summary").last.click()
                page.wait_for_timeout(300)
                page.screenshot(path=args.out / "3-fold.png")
                page.locator(".work > summary").last.click()
            citation = page.locator('.answer a[href^="http://pdf.invalid/"]').first
            if citation.count():
                print("citation:", citation.inner_text(), citation.get_attribute("href"))
                citation.click()
                page.wait_for_timeout(1500)
                print("after the citation:", page.inner_text("#page-badge"), "| url:", page.url)
                print("questions still shown:", page.locator(".question").count())
                page.screenshot(path=args.out / "4-citation.png")
            else:
                print("no citation in the answer")
            page.reload()
            page.wait_for_selector(".question", timeout=15_000)
            page.wait_for_timeout(1000)
            print("after a reload, questions shown:", page.locator(".question").count())
            page.screenshot(path=args.out / "5-reload.png")
        browser.close()


if __name__ == "__main__":
    main()
