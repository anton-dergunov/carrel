"""Look at carrel the way the iPad shows it, in WebKit at 820x1180.

    uv run --group shots python scripts/shots.py URL --out DIR [--size WxH | --landscape] [--dark]
        [--layout PLACE] [--tabs] [--find QUERY] [--highlight] [--settings] [--note TEXT]
        [--info] [--overview] [--type TEXT] [--chat ID] [--ask QUESTION] [--model M]
        [--view areas|all] [--area TOPIC] [--rich] [--search Q [--text | --meaning]] [--review SCOPE [--peek]]

URL is a page of a running carrel: a reading page, e.g. http://127.0.0.1:8517/read/<pdf>, or
the library, http://127.0.0.1:8517/. Takes a shot once the PDF, or the library, is drawn.
--size sets the window (--landscape: 1180x820), --dark the dark theme. The library: --view
starts it in Areas or All, --area at a topic (--rich with rich rows); --search types Q into its
search box, and with --text searches the papers' text and taps the first snippet, which opens
the paper at that page with Q in find; with --meaning it describes Q to meaning search and prints
the nearest papers. --review opens the review of SCOPE in its tab; --peek
taps a paper it cites, then the peek's first page. --layout puts the chat below, above, left, right, on a tab, or
hides it, as this device's choice. With --tabs, it opens the list, a second paper, goes back
to the first and checks it comes back at the page it was on, closes the second, and reloads
to see the tabs come back. --find types QUERY into find a letter at a time and prints what it
found. --highlight turns the pen on, selects a line on page 1 and checks it is highlighted, saved
and quoted for the chat; reloads, taps the highlight, recolours it, asks about it, and removes it,
checking each save. It writes into the served PDF: run it against a carrel serving a throwaway
library, never the reader's own. --settings opens the chat's settings from the model's name and
takes a shot; --note also types TEXT into the note about the reader and checks it is saved,
which changes the note every chat carries: serve with XDG_STATE_HOME set to a scratch folder
for it. --info opens the page badge's sheet, with what the library knows of the paper.
--overview looks at the chat's Overview button, opens the paper's overview note and deletes it,
which moves the note to the Trash: a throwaway library again, with a note put in its
overview_dir by hand (no model is asked). --type types TEXT into the question box and takes a
shot without sending it, for the slash commands' list. --chat opens the chat with that id and
takes a shot of each of a few of its formulas, code blocks and tables: an earlier chat, VS Code's or
carrel's, is drawn from its transcript, and no question is asked, so it can be the reader's
library. The browser's chats run on Haiku (--model), as testing the page needs no more. With --ask, it also types the question, waits for the answer
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
LIBRARY_DRAWN = "#area-page .area-title, #all-view .rows, #all-view .list-note"
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
    page.wait_for_selector("#papers-pane .paper-row:visible", timeout=30_000)
    links = page.locator("#papers-pane .paper-row:visible")
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
    page.locator('.tab.paper[aria-selected="true"] .close').click()
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


def settings_pass(page, note: str | None, out: Path) -> None:
    """The chat's settings, opened from the model's name on the status line."""
    page.click("#model")
    page.wait_for_selector("#reader-note")
    page.wait_for_timeout(400)  # the dialog's fade
    print(
        "settings: model",
        page.inner_text('#settings-dialog [aria-checked="true"] .name'),
        "| note:",
        repr(page.input_value("#reader-note")),
    )
    page.screenshot(path=out / "settings-1-sheet.png")
    if note is not None:
        with page.expect_response(
            lambda r: r.url.endswith("/api/settings") and r.request.method == "PUT"
        ) as info:
            page.fill("#reader-note", note)
        print(
            "note saved:",
            info.value.status,
            "|",
            page.inner_text("#settings-dialog .note-foot"),
        )
        page.screenshot(path=out / "settings-2-note.png")
    page.click("#settings-dialog .settings-title button")  # Done
    page.wait_for_timeout(300)
    print("closed, status line:", page.inner_text("#chat-foot"))


def info_pass(page, out: Path) -> None:
    """The page badge's sheet: what the library knows of the paper, then its pages."""
    page.click("#page-badge")
    page.wait_for_selector("#paper-info:not([hidden])", timeout=10_000)
    page.wait_for_timeout(300)
    print("paper info:", " | ".join(page.inner_text("#paper-info").splitlines()))
    page.screenshot(path=out / "info.png")
    page.click("#page-badge")


def overview_pass(page, out: Path) -> None:
    """The Overview button, the note it shows, and Delete."""
    page.wait_for_timeout(800)  # the note looked up
    button = page.locator("#overview")
    print(
        "overview button:",
        button.get_attribute("title"),
        "| has a note:",
        "has-note" in (button.get_attribute("class") or ""),
    )
    page.screenshot(path=out / "overview-1-button.png")
    if "has-note" not in (button.get_attribute("class") or ""):
        return
    button.click()
    page.wait_for_selector("#overview-sheet:not([hidden])")
    page.wait_for_timeout(300)
    print(
        "overview sheet:",
        page.inner_text("#overview-sheet .name"),
        "| maths:",
        page.locator("#overview-sheet .katex").count(),
    )
    page.screenshot(path=out / "overview-2-sheet.png")
    page.get_by_role("button", name="Delete").click()
    page.wait_for_timeout(200)
    page.screenshot(path=out / "overview-3-confirm.png")
    with page.expect_response(lambda r: r.request.method == "DELETE") as info:
        page.locator("#overview-sheet .buttons").get_by_role("button", name="Delete").click()
    page.wait_for_timeout(300)
    print(
        "deleted:",
        info.value.status,
        "| sheet hidden:",
        page.locator("#overview-sheet").is_hidden(),
        "| button:",
        button.get_attribute("title"),
    )


def type_pass(page, text: str, out: Path) -> None:
    """Types into the question box, a letter at a time, and sends nothing."""
    page.click("#question")
    page.type("#question", text, delay=80)
    if text.startswith("/"):
        # The first list starts a Claude Code process on the laptop.
        page.wait_for_selector("#commands:not([hidden])", timeout=20_000)
    page.wait_for_timeout(300)
    names = page.locator("#commands .name").all_inner_texts()
    print(f"typed {text!r}, commands listed:", len(names), names[:8])
    page.screenshot(path=out / "type.png")
    page.fill("#question", "")


def chat_pass(page, chat: str, out: Path) -> None:
    """An earlier chat, drawn from its transcript: its formulas, code blocks and tables."""
    if page.locator("#tab-chat").is_visible():
        page.click("#tab-chat")
    page.wait_for_selector(".question", timeout=15_000)
    page.wait_for_timeout(1500)
    print(
        f"chat {chat[:8]}:",
        page.locator(".question").count(),
        "questions |",
        page.locator(".answer .katex").count(),
        "formulas, of them",
        page.locator(".answer .katex-error").count(),
        "failed |",
        page.locator(".answer .code").count(),
        "code blocks,",
        page.locator(".answer code.hljs").count(),
        "coloured |",
        page.locator(".answer .table").count(),
        "tables",
    )
    for error in page.locator(".answer .katex-error").all()[:5]:
        print("  failed:", error.get_attribute("title"))
    # The most lines any entry of a table's first column is broken over: 1 when none is.
    lines = page.evaluate(
        """() => [...document.querySelectorAll('.answer table')].map((table) =>
             Math.max(...[...table.rows].map((row) => {
               const range = document.createRange();
               range.selectNodeContents(row.cells[0]);
               return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
             })))"""
    )
    if lines:
        print("  tables' first columns, most lines to an entry:", lines)
    # Each formula, code block and table in its answer, a few of each kind.
    shown = 0
    kinds = (
        ".answer .maths.display",
        ".answer .maths:not(.display)",
        ".answer .code",
        ".answer .table",
    )
    for selector in kinds:
        for each in page.locator(selector).all()[:3]:
            each.scroll_into_view_if_needed()
            page.wait_for_timeout(150)
            shown += 1
            page.screenshot(path=out / f"chat-{chat[:8]}-{shown:02}.png")
    if not shown:
        page.screenshot(path=out / f"chat-{chat[:8]}-01.png")


def library_pass(page, args, out: Path) -> None:
    """The library: its view, an area, a search by titles, by text or by meaning."""
    page.wait_for_selector(LIBRARY_DRAWN, timeout=30_000)
    page.wait_for_timeout(600)
    view = page.get_attribute("#papers-pane", "data-view")
    title = page.locator("#area-page .area-title")
    print(
        "library:",
        view,
        "|",
        title.inner_text() if view == "areas" and title.count() else "",
        "|",
        page.inner_text("#library-count") or page.inner_text("#area-page .area-count")
        if view == "areas"
        else page.inner_text("#library-count"),
        "| rows:",
        page.locator(".paper-row").count(),
        "| tiles:",
        page.locator(".treemap .tile").count(),
        "| tree:",
        page.locator("#area-tree").is_visible(),
    )
    page.screenshot(
        path=out / f"library-{view}{'-' + args.area.replace('/', '-') if args.area else ''}.png"
    )
    if not args.search:
        return
    if args.text or args.meaning:
        page.click(f'#depth [data-depth="{"text" if args.text else "meaning"}"]')
    page.type("#filter", args.search, delay=60)
    if args.meaning:
        page.wait_for_selector(".text-head, .list-note.error", timeout=60_000)
        page.wait_for_timeout(400)
        titles = page.locator(".paper-row .title")
        print(
            "meaning search:",
            page.locator(".text-head").first.inner_text()
            if page.locator(".text-head").count()
            else page.inner_text(".list-note.error"),
            "| first:",
            [titles.nth(i).inner_text()[:60] for i in range(min(5, titles.count()))],
        )
    elif args.text:
        page.wait_for_selector(".text-result, .text-head, .list-note.error", timeout=20_000)
        page.wait_for_timeout(400)
        print(
            "text search:",
            page.locator(".text-head").first.inner_text()
            if page.locator(".text-head").count()
            else "",
            "| papers shown:",
            page.locator(".text-result").count(),
        )
    else:
        page.wait_for_timeout(600)
        print(
            "searched titles:",
            page.inner_text("#library-count") or "",
            "| rows:",
            page.locator(".paper-row").count(),
        )
    depth = "-text" if args.text else "-meaning" if args.meaning else ""
    page.screenshot(path=out / f"library-search{depth}.png")
    if args.text and page.locator(".snippet").count():
        snippet = page.locator(".snippet").first
        print("tapping:", " ".join(snippet.inner_text().split())[:120])
        snippet.click()
        page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
        page.wait_for_timeout(2500)
        print(
            "opened at:",
            page.inner_text("#page-badge"),
            "| find:",
            page.input_value("#find-input"),
            page.inner_text("#find-count"),
            "| marked:",
            page.locator(".textLayer .highlight").count(),
        )
        page.screenshot(path=out / "library-search-opened.png")


def review_pass(page, peek: bool, out: Path) -> None:
    """A review in its tab, and the peek at a paper it cites."""
    page.wait_for_selector(".review-body", timeout=30_000)
    page.wait_for_timeout(1500)  # diagrams
    print(
        "review:",
        page.locator(".review-body h1").first.inner_text()
        if page.locator(".review-body h1").count()
        else "",
        "| callouts:",
        page.locator(".review-body .callout").count(),
        "| diagrams drawn:",
        page.locator(".review-body .diagram.drawn").count(),
        "| links to papers:",
        page.locator('.review-body a[data-kind="paper"]').count(),
        "| to pages:",
        page.locator('.review-body a[data-kind="page"]').count(),
        "| tab:",
        page.locator(".tab.review").count(),
    )
    page.screenshot(path=out / "review-1-open.png")
    if not peek:
        return
    # A paper cited with a page in the same paragraph, so the peek offers both.
    link = page.locator(
        '.review-body :is(p, li):has(a[data-kind="page"]) a[data-kind="paper"]'
    ).first
    if not link.count():
        link = page.locator('.review-body a[data-kind="paper"]').first
    link.scroll_into_view_if_needed()
    page.evaluate("document.getElementById('review-pane').scrollBy(0, -200)")
    page.wait_for_timeout(300)
    link.click()
    page.wait_for_selector("#peek:not([hidden])")
    page.wait_for_timeout(200)
    print("peek:", " | ".join(page.inner_text("#peek").splitlines()))
    page.screenshot(path=out / "review-2-peek.png")
    pages = page.locator("#peek .secondary")
    if pages.count():
        pages.first.click()
        page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
        page.wait_for_timeout(1500)
        print(
            "opened at:",
            page.inner_text("#page-badge"),
            "| tabs:",
            page.locator(".tab.paper").count(),
        )
        page.screenshot(path=out / "review-3-page.png")
        page.locator(".tab.review .label").first.click()
        page.wait_for_timeout(800)
        print(
            "back to the review, scrolled to:",
            page.evaluate("document.getElementById('review-pane').scrollTop"),
        )
        page.screenshot(path=out / "review-4-back.png")


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
    parser.add_argument("--settings", action="store_true", help="open the chat's settings")
    parser.add_argument("--note", help="with --settings, type this note about the reader")
    parser.add_argument("--info", action="store_true", help="what the library knows of the paper")
    parser.add_argument(
        "--overview", action="store_true", help="show the paper's overview note and delete it"
    )
    parser.add_argument("--type", help="type this into the question box, without sending it")
    parser.add_argument("--chat", help="open the chat with this id and shoot its answers")
    parser.add_argument(
        "--model", default="haiku", help="the model this browser's chats start on (default: haiku)"
    )
    parser.add_argument("--browser", default="webkit", choices=["webkit", "chromium"])
    parser.add_argument("--size", help="the window, WxH (default: the iPad in portrait, 820x1180)")
    parser.add_argument("--landscape", action="store_true", help="the iPad in landscape, 1180x820")
    parser.add_argument("--dark", action="store_true", help="the dark theme")
    parser.add_argument("--view", choices=["areas", "all"], help="the library's view")
    parser.add_argument("--area", help="the library open at this topic")
    parser.add_argument("--rich", action="store_true", help="the library's rows, rich")
    parser.add_argument("--search", help="type this into the library's search box")
    parser.add_argument(
        "--text", action="store_true", help="with --search, search the papers' text"
    )
    parser.add_argument(
        "--meaning", action="store_true", help="with --search, search the papers by meaning"
    )
    parser.add_argument("--review", help="open the review of this scope")
    parser.add_argument("--peek", action="store_true", help="with --review, peek at a cited paper")
    parser.add_argument("--timeout", type=int, default=240, help="seconds to wait for an answer")
    parser.add_argument("--allow", action="store_true", help="tap Allow on each permission request")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch()
        viewport = dict(IPAD)
        if args.landscape:
            viewport = {"width": 1180, "height": 820}
        if args.size:
            width, height = (int(n) for n in args.size.lower().split("x"))
            viewport = {"width": width, "height": height}
        page = browser.new_page(
            viewport=viewport,
            device_scale_factor=2,
            has_touch=True,
            color_scheme="dark" if args.dark else "light",
        )
        page.on(
            "console",
            lambda m: (
                print(f"console {m.type}: {m.text}") if m.type in ("error", "warning") else None
            ),
        )
        page.on("pageerror", lambda e: print(f"page error: {e}"))
        page.add_init_script(f"localStorage.setItem('carrel.model', {json.dumps(args.model)});")
        if args.layout:
            page.add_init_script(layout_script(args.layout))
        if args.chat:
            page.add_init_script(f"localStorage.setItem('carrel.chat', {json.dumps(args.chat)});")
        if args.view or args.area or args.rich:
            state = {
                "view": args.view or "areas",
                "area": args.area or "",
                "density": "rich" if args.rich else "compact",
            }
            page.add_init_script(
                f"localStorage.setItem('carrel.library', {json.dumps(json.dumps(state))});"
            )
        url = args.url
        if args.review:
            url = url.split("/", 3)[:3]
            url = "/".join(url) + "/review/" + args.review
        page.goto(url)
        if args.review:
            review_pass(page, args.peek, args.out)
        elif "/read/" in url:
            page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
            page.wait_for_timeout(800)
            print("opened:", page.inner_text("#page-badge"))
            page.screenshot(path=args.out / f"1-open{'-' + args.layout if args.layout else ''}.png")
        else:
            library_pass(page, args, args.out)

        if args.tabs:
            tabs_pass(page, args.out)

        if args.find:
            find_pass(page, args.find, args.out)

        if args.highlight:
            highlight_pass(page, args.out)

        if args.settings or args.note is not None:
            settings_pass(page, args.note, args.out)

        if args.info:
            info_pass(page, args.out)

        if args.overview:
            overview_pass(page, args.out)

        if args.type:
            type_pass(page, args.type, args.out)

        if args.chat:
            chat_pass(page, args.chat, args.out)

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
