"""The pictures in docs/pictures: carrel on a real library, captured, then composed.

    uv run --group shots python scripts/pictures.py [NAME ...] [--compose] [--server URL]

Each picture is docs/pictures/<name>.html, a page that places captures of carrel
(docs/pictures/captures/, not in git) with a heading. This script takes the captures from a
running carrel: a small tablet in WebKit (600x860, or 860x600 held sideways, with touch) and the
Mac app's page in Chromium (1040x650), both at 2x, so that a picture shown at the width of a page
can still be read; the hero and the pictures with an arrow raise the text sizes and zoom in more. A capture also keeps the
boxes of the places it names (captures/marks.js), which the pictures' arrows join (arrows.js).
Then each page is rendered at 2x to <name>.png (1920x1200; the hero 2120x1120 on no background)
and made smaller with pngquant. NAME retakes those pictures only; --compose only renders the
pages again, with no server.

The captures only read the library, with three exceptions, each the reader's own:
- `highlights` and `review` each ask Opus one question, which costs a turn of the reader's plan.
  Their chats' ids are kept in docs/pictures/chats.json, and a retake draws those chats again
  instead of asking: delete an entry to ask anew.
- A chat may write the agent's notes on its paper, as any chat in the library does.
Before committing, look at every new capture for what must not be published: the note about the
reader (Settings), the laptop's tailnet address, a login or an email.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from shots import center, look_script, wait_for_answer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PICTURES = ROOT / "docs" / "pictures"
CAPTURES = PICTURES / "captures"
CHATS = PICTURES / "chats.json"
TITLES = CAPTURES / "titles.json"
MARKS = CAPTURES / "marks.json"

# The devices: a small tablet, upright and sideways, and the Mac app's window, each smaller than
# the real thing, so that a picture shows it nearer the size it was drawn at. The pictures that
# show a citation or a highlight followed raise the text sizes a little too (the interface's, the
# library's and the chat's, in px); the rest keep carrel's own, 15, 17 and 15.
TABLET = (600, 860)
TABLET_SIDEWAYS = (860, 600)
MAC = (1040, 650)
MAC_NEAR = (900, 560)
SIDEWAYS_NEAR = "16,17,16"
HIGHLIGHT_SIZES = "18,20,19"
MAC_NEAR_SIZES = "20,22,15"
# The PPI paper's Equation 1 on its first page, in PDF points (x0, y0, x1, y1): the place the Mac
# picture's citation marks. The answer's own link marks the sentence that introduces it.
PPI_EQUATION = "313,481,526,533"

# The papers and the earlier chats the pictures show.
PAGED = "ml-systems/inference-and-serving/Efficient Memory Management for Large Language Model Serving with PagedAttention.pdf"
ZEP = "llm/memory/agent/Zep. A Temporal Knowledge Graph Architecture for Agent Memory.pdf"
LONGMEMEVAL = "llm/memory/benchmarks/LongMemEval. Benchmarking Chat Assistants on Long-Term Interactive Memory.pdf"
JUDGEBENCH = "llm/evaluation/methods/JudgeBench. A Benchmark for Evaluating LLM-based Judges.pdf"
PPI = "search-and-ranking/evaluation/Statistically Reliable LLM-Based Ranking Evaluation via Prediction-Powered Inference.pdf"
KV_CHAT = "0c640335-979a-4fe7-8408-8d0a46a61de6"  # How does KV cache work? (PagedAttention)
ZEP_CHAT = "e642b28b-cc8a-4d42-8748-7103aed27ec1"  # Zep's results on LongMemEval, in a table
PPI_CHAT = "01ba2cc4-8a66-4b39-ba7f-e7f2a5041962"  # Why is the PPI estimator novel?
REVIEW = "llm/evaluation"
# Where the map's peek opens: on this paper, the search lighting its neighbours.
MAP_PAPER = "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"

# What the library is searched for: a phrase by its text, and a description, by meaning, of the
# paper the phrase names, in none of its words.
TEXT_QUERY = "lost in the middle"
MEANING_QUERY = "models use evidence worse when it sits in the middle of a long prompt"

# The questions the pictures ask, once (see chats.json).
HIGHLIGHT_QUESTION = (
    "How does the benchmark test each of these five abilities? A short table, "
    "with the page for each."
)
REVIEW_QUESTION = (
    "I build LLM-as-judge evals for a chatbot. Which findings in this review matter most "
    "for me? Five short bullets, with the papers."
)


def read_url(server: str, pdf: str) -> str:
    return f"{server}/read/{quote(pdf)}"


def library_script(view: str, **state) -> str:
    value = {"view": view, "area": "", "density": "compact"} | state
    return f"localStorage.setItem('carrel.library', {json.dumps(json.dumps(value))});"


def layout_script(place: str, share: float) -> str:
    """Where the chat sits, and its share of the window, before the page's own script reads it."""
    place, hidden = ("bottom", True) if place == "hidden" else (place, False)
    value = json.dumps({"place": place, "hidden": hidden, "share": share})
    return f"localStorage.setItem('carrel.layout', {json.dumps(value)});"


class Shooter:
    """Opens carrel as a device, fresh each time: the tablet in WebKit, the Mac in Chromium."""

    def __init__(self, p, server: str):
        self.server = server
        self.webkit = p.webkit.launch()
        self.chromium = p.chromium.launch()

    def open(
        self,
        device: str,
        path: str = "/",
        *,
        size: tuple[int, int] | None = None,
        sizes: str | None = None,
        theme: str = "carrel-light",
        layout: str | None = None,
        share: float = 0.42,
        chat: str | None = None,
        library: str | None = None,
        camera: dict | None = None,
        dark_pages: bool = False,
        model: str = "opus",
    ):
        mac = device == "mac"
        width, height = size or (MAC if mac else TABLET)
        context = (self.chromium if mac else self.webkit).new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=2,
            has_touch=not mac,
            color_scheme="dark" if theme.endswith("dark") else "light",
        )
        page = context.new_page()
        page.on("pageerror", lambda e: print(f"  page error: {e}"))
        page.add_init_script(f"localStorage.setItem('carrel.model', {json.dumps(model)});")
        page.add_init_script(look_script(theme, dark_pages, sizes))
        if layout:
            page.add_init_script(layout_script(layout, share))
        if chat:
            page.add_init_script(f"localStorage.setItem('carrel.chat', {json.dumps(chat)});")
        if library:
            page.add_init_script(library)
        if camera:
            page.add_init_script(
                f"localStorage.setItem('carrel.map', {json.dumps(json.dumps(camera))});"
            )
        page.goto(path if path.startswith("http") else self.server + path)
        return page

    def paper(self, device: str, pdf: str, **options):
        page = self.open(device, read_url(self.server, pdf), **options)
        page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
        if options.get("chat"):
            page.wait_for_selector(".question", state="attached", timeout=20_000)
        page.wait_for_timeout(1200)
        return page

    def close(self):
        self.webkit.close()
        self.chromium.close()


def box(page, selector: str, last: bool = False) -> dict | None:
    """Where the first (or last) `selector` is on the screen, in the viewport's px."""
    found = page.locator(selector)
    if not found.count():
        print(f"  (no {selector})")
        return None
    return (found.last if last else found.first).bounding_box()


def shot(page, name: str, marks: dict | None = None, **options) -> None:
    """A capture; its page's title, which the Mac app shows in its title bar; and the boxes of
    the places `marks` names ({key: box}), for the arrows drawn over the picture."""
    path = CAPTURES / f"{name}.png"
    page.screenshot(path=path, **options)
    titles = json.loads(TITLES.read_text()) if TITLES.exists() else {}
    titles[name] = page.title() or "Carrel"
    TITLES.write_text(json.dumps(dict(sorted(titles.items())), indent=2, ensure_ascii=False) + "\n")
    known = json.loads(MARKS.read_text()) if MARKS.exists() else {}
    size = page.viewport_size
    clip = options.get("clip")
    origin = (clip["x"], clip["y"]) if clip else (0, 0)
    known[name] = {
        "size": [clip["width"], clip["height"]] if clip else [size["width"], size["height"]],
        "marks": {
            key: [b["x"] - origin[0], b["y"] - origin[1], b["width"], b["height"]]
            for key, b in (marks or {}).items()
            if b
        },
    }
    MARKS.write_text(json.dumps(dict(sorted(known.items())), indent=2) + "\n")
    (CAPTURES / "marks.js").write_text(f"window.MARKS = {json.dumps(known)};\n")
    print("  ", path.relative_to(ROOT))


def done(page) -> None:
    page.context.close()


def chat_ids() -> dict:
    return json.loads(CHATS.read_text()) if CHATS.exists() else {}


def asked(page, key: str, question: str) -> None:
    """Sends the question, waits for its answer and keeps the chat's id for the next retake."""
    print(f"  asking ({key}): {question}")
    page.fill("#question", question)
    page.click("#send")
    wait_for_answer(page, 900, False, CAPTURES)
    page.wait_for_timeout(800)
    chats = chat_ids() | {key: page.evaluate("localStorage.getItem('carrel.chat')")}
    CHATS.write_text(json.dumps(chats, indent=2) + "\n")


def scroll_chat(page, selector: str, at: float = 0.0, nth: int = -1) -> None:
    """Scrolls the chat so the `nth` `selector` in it (the last) is `at` of the way down it."""
    page.evaluate(
        """([selector, at, nth]) => {
          const log = document.getElementById('log');
          const target = [...log.querySelectorAll(selector)].at(nth);
          if (!target) return;
          const top = log.getBoundingClientRect().top + 8 + at * log.clientHeight;
          log.scrollTop += target.getBoundingClientRect().top - top;
        }""",
        [selector, at, nth],
    )
    page.wait_for_timeout(400)


def zoom_paper(page, width: float) -> None:
    """Zooms the paper in, a step of ⌘= at a time, until its page is `width` px wide."""
    for _ in range(30):
        now = page.evaluate(
            "document.querySelector('.pdfViewer .page').getBoundingClientRect().width"
        )
        if now >= width:
            break
        page.keyboard.press("Meta+Equal")
        page.wait_for_timeout(250)
    page.wait_for_timeout(900)


def scroll_paper(page, selector: str | None, left: float = 16, top: float | None = None) -> None:
    """Scrolls the paper so `selector` starts `left` px from the pane's left (None: centred
    across) and, given `top`, that many px from its top. Without a selector, centres the page."""
    page.evaluate(
        """([selector, left, top]) => {
          const pane = document.getElementById('viewerContainer');
          const view = pane.getBoundingClientRect();
          const target = selector ? document.querySelector(selector) : null;
          const where = target ? target.getBoundingClientRect() : null;
          if (!where) { pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) / 2; return; }
          pane.scrollLeft += left === null
            ? where.left + where.width / 2 - (view.left + view.width / 2)
            : where.left - view.left - left;
          if (top !== null) pane.scrollTop += where.top - view.top - top;
        }""",
        [selector, left, top],
    )
    page.wait_for_timeout(900)


# The scenes: each takes the captures of one picture.


def hide(page, selectors: list[str]) -> None:
    """Hides parts of the page, to make room in a picture: what is hidden is said in the
    picture's comment."""
    page.add_style_tag(content=", ".join(selectors) + " { display: none !important; }")
    page.wait_for_timeout(300)


def hide_text(page, scope: str, starts: list[str]) -> None:
    """Hides the paragraphs, headings and list items in the last `scope` whose text starts with
    one of `starts`, to make room in a picture, as `hide` does."""
    page.locator(scope).last.evaluate(
        """(root, starts) => {
          for (const node of root.querySelectorAll('p, h1, h2, h3, li'))
            if (starts.some((start) => node.textContent.trim().startsWith(start)))
              node.style.display = 'none';
        }""",
        starts,
    )
    page.wait_for_timeout(300)


def reading(s: Shooter) -> None:
    """The hero: a citation followed on a tablet held sideways, and the same reading on e-ink.
    The answer's opening, its heading, its intuition and its first equation are hidden, so that
    its question shows above the citation."""
    page = s.paper(
        "ipad",
        PAGED,
        size=TABLET_SIDEWAYS,
        sizes=SIDEWAYS_NEAR,
        layout="right",
        share=0.44,
        chat=KV_CHAT,
    )
    zoom_paper(page, 1060)
    link = '.answer a[href*="page=3&rect=90,360"]'
    page.locator(link).first.click()
    page.wait_for_timeout(2200)  # the page turns and the mark's ring settles
    scroll_paper(page, ".cite-mark > *", left=96, top=120)
    hide_text(
        page,
        ".answer:not(.aside, .digest)",
        ["The best source", "How it works", "Intuition.", "Each token gets"],
    )
    scroll_chat(page, ".question", 0.0, 0)
    print("  at:", page.inner_text("#page-badge"))
    shot(page, "reading-ipad", {"link": box(page, link), "mark": box(page, ".cite-mark > *")})
    done(page)

    page = s.paper("ipad", ZEP, theme="eink", layout="bottom", share=0.46, chat=ZEP_CHAT)
    zoom_paper(page, 745)
    page.locator('.answer a[href*="table.2"]').first.click()
    page.wait_for_timeout(1500)
    scroll_paper(page, None)
    scroll_chat(page, ".question", 0.0, 0)
    shot(page, "reading-eink")
    done(page)


def highlights(s: Shooter) -> None:
    """A highlight tapped, with its panel, and the question asked about it."""
    chat = chat_ids().get("highlights")
    page = s.paper(
        "ipad",
        LONGMEMEVAL,
        size=TABLET_SIDEWAYS,
        sizes=HIGHLIGHT_SIZES,
        layout="right",
        share=0.46,
        chat=chat,
    )
    page.wait_for_selector(".annotationLayer .highlightAnnotation", timeout=30_000)
    if not chat:
        page.touchscreen.tap(*center(page, ".annotationLayer .highlightAnnotation"))
        page.wait_for_timeout(400)
        page.click("#mark-ask")
        page.wait_for_timeout(300)
        asked(page, "highlights", HIGHLIGHT_QUESTION)
    zoom_paper(page, 760)
    scroll_paper(page, ".annotationLayer .highlightAnnotation", left=None, top=150)
    page.touchscreen.tap(*center(page, ".annotationLayer .highlightAnnotation"))
    page.wait_for_timeout(500)
    scroll_chat(page, ".question", 0.0)
    shot(
        page,
        "highlights",
        {
            "highlight": box(page, ".annotationLayer .highlightAnnotation"),
            "quote": box(page, ".question .quoted", last=True),
        },
    )
    done(page)


def paper(s: Shooter) -> None:
    """What the library knows of a paper, and its overview note."""
    page = s.paper("ipad", JUDGEBENCH, layout="bottom")
    page.click("#page-badge")
    page.wait_for_selector("#paper-info:not([hidden])", timeout=10_000)
    page.wait_for_timeout(1000)  # the similar papers and the outline come later
    if page.is_visible("#sheet-size"):
        page.click("#sheet-size")
        page.wait_for_timeout(400)
    shot(page, "paper-info")
    done(page)

    page = s.paper("ipad", JUDGEBENCH, layout="bottom", share=0.64)
    page.locator("#overview").click()
    page.wait_for_selector("#overview-sheet:not([hidden])")
    page.wait_for_timeout(800)
    shot(page, "paper-overview")
    done(page)


def library(s: Shooter) -> None:
    """Desk on the tablet, after two papers were opened, with its tags and all but four papers to
    continue hidden; Areas' map of the library on the Mac."""
    page = s.paper("ipad", PAGED, layout="hidden", library=library_script("desk"))
    page.goto(read_url(s.server, ZEP))
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.click("#tab-papers")
    page.wait_for_timeout(1200)
    hide(page, ["#desk-view .desk-section.tags", "#desk-view .continue > :nth-child(n + 5)"])
    shot(page, "desk")
    done(page)

    page = s.open("mac", layout="hidden", library=library_script("areas"))
    page.wait_for_selector("#area-page .area-title", timeout=30_000)
    page.wait_for_timeout(1500)
    shot(page, "library-areas", clip=page.locator("#area-page").bounding_box())
    done(page)


def browse(s: Shooter) -> None:
    """All on the tablet, rich rows narrowed by chips; Timeline on the Mac."""
    chips = {
        "areas": ["llm/evaluation"],
        "types": [],
        "from": 2024,
        "to": None,
        "tags": [],
        "touched": [],
    }
    page = s.open(
        "ipad",
        layout="hidden",
        library=library_script("all", density="rich", sort="added", chips=chips),
    )
    page.wait_for_selector("#all-view .rows", timeout=30_000)
    page.wait_for_timeout(1200)
    shot(page, "desk-all")
    done(page)

    page = s.open("mac", layout="hidden", library=library_script("timeline"))
    page.wait_for_selector("#timeline-view :is(.year, .timeline-year, svg, canvas)", timeout=30_000)
    page.wait_for_timeout(1500)
    shot(page, "timeline")
    done(page)


def map_scene(s: Shooter) -> None:
    """The map a little nearer than whole; then near one paper, lit by a meaning search, with
    the paper's peek open. Only the map is captured."""
    drawn = s.open("mac").evaluate("fetch('/api/map').then((r) => r.json())")
    points = drawn["points"]
    xs, ys = [p["x"] for p in points], [p["y"] for p in points]
    status = "#map-view .map-status"
    middle = {"cx": (min(xs) + max(xs)) / 2, "cy": (min(ys) + max(ys)) / 2 + 20, "z": 1.35}
    page = s.open(
        "mac", size=(700, 760), layout="hidden", library=library_script("map"), camera=middle
    )
    page.wait_for_selector(f"{status}:has-text('paper'):not(:has-text('Drawing'))", timeout=300_000)
    page.wait_for_timeout(3500)  # the map grows in
    shot(page, "map-whole", clip=page.locator("#map-view").bounding_box())
    done(page)

    target = next(p for p in points if MAP_PAPER in p["id"])
    near = {"cx": target["x"], "cy": target["y"] - 6, "z": 7}
    page = s.open(
        "mac", size=(700, 760), layout="hidden", library=library_script("map"), camera=near
    )
    page.wait_for_selector(f"{status}:has-text('paper'):not(:has-text('Drawing'))", timeout=300_000)
    page.wait_for_timeout(3000)
    page.click('#depth [data-depth="meaning"]')
    page.type("#filter", "how far an LLM judge agrees with human raters", delay=20)
    page.wait_for_selector(f"{status}:has-text('“'):not(:has(.searching))", timeout=120_000)
    page.wait_for_timeout(800)
    canvas = page.locator("#map-view canvas").bounding_box()
    page.mouse.click(canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2 + 6 * 0)
    page.wait_for_timeout(900)
    peek = page.locator("#map-view .map-peek")
    print("  peek:", peek.locator(".peek-title").inner_text() if peek.is_visible() else "(none)")
    shot(page, "map-search", clip=page.locator("#map-view").bounding_box())
    done(page)


def search(s: Shooter) -> None:
    """The papers' text searched, and a description searched by meaning."""
    page = s.open("ipad", layout="hidden", library=library_script("all"))
    page.wait_for_selector("#all-view .rows", timeout=30_000)
    page.click('#depth [data-depth="text"]')
    page.type("#filter", TEXT_QUERY, delay=30)
    page.wait_for_selector(".text-result, .list-note.error", timeout=30_000)
    page.wait_for_timeout(800)
    shot(page, "search-text")
    done(page)

    page = s.open("ipad", layout="hidden", library=library_script("all"))
    page.wait_for_selector("#all-view .rows", timeout=30_000)
    page.click('#depth [data-depth="meaning"]')
    page.type("#filter", MEANING_QUERY, delay=20)
    page.wait_for_selector(".text-head, .list-note.error", timeout=120_000)
    page.wait_for_timeout(800)
    shot(page, "search-meaning")
    done(page)


def review(s: Shooter) -> None:
    """A review in its tab, a peek at a paper it cites, and the chat beside it."""
    chat = chat_ids().get("review")
    page = s.open("mac", f"/review/{REVIEW}", layout="right", share=0.42, chat=chat)
    page.wait_for_selector(".review-body", timeout=30_000)
    page.wait_for_timeout(1500)
    if not chat:
        asked(page, "review", REVIEW_QUESTION)
    scroll_chat(page, ".question", 0.0)
    link = page.locator(
        '.review-body :is(p, li):has(a[data-kind="page"]) a[data-kind="paper"]'
    ).nth(2)
    link.scroll_into_view_if_needed()
    page.evaluate("document.getElementById('review-pane').scrollBy(0, -150)")
    page.wait_for_timeout(300)
    link.click()
    page.wait_for_selector("#peek:not([hidden])")
    page.wait_for_timeout(500)
    shot(page, "review", {"link": link.bounding_box()})
    done(page)


def chat(s: Shooter) -> None:
    """The chats in the library, the latest first; and the slash commands."""
    page = s.paper("ipad", PPI, layout="tab", chat=PPI_CHAT)
    page.click("#tab-chat")
    page.wait_for_timeout(1200)
    page.click("#chats")
    page.wait_for_selector("#chats-sheet:not([hidden])", timeout=10_000)
    page.wait_for_timeout(800)
    shot(page, "chat-earlier", clip={"x": 0, "y": 0, "width": 600, "height": 520})
    done(page)

    page = s.paper("ipad", PPI, layout="tab", chat=PPI_CHAT)
    page.click("#tab-chat")
    page.wait_for_timeout(1200)
    scroll_chat(page, ".answer .maths.display", 0.08, 0)
    page.click("#question")
    page.type("#question", "/", delay=80)
    page.wait_for_selector("#commands:not([hidden])", timeout=30_000)
    page.wait_for_timeout(400)
    shot(page, "chat-commands")
    done(page)


def looks(s: Shooter) -> None:
    """One paper and its chat in three looks."""
    for theme in ("carrel-light", "carrel-dark", "eink"):
        page = s.paper(
            "ipad",
            ZEP,
            theme=theme,
            dark_pages=theme == "carrel-dark",
            layout="bottom",
            share=0.46,
            chat=ZEP_CHAT,
        )
        zoom_paper(page, 745)
        page.locator('.answer a[href*="table.2"]').first.click()
        page.wait_for_timeout(1500)
        scroll_paper(page, None)
        scroll_chat(page, ".answer table", 0.12, 0)
        shot(page, f"looks-{theme}")
        done(page)


def mac(s: Shooter) -> None:
    """The Mac app's window: a paper and its chat side by side, an equation cited and marked. The
    answer's link marks the sentence that introduces Equation 1; it is pointed at the equation
    itself (PPI_EQUATION) before it is clicked."""
    page = s.paper(
        "mac", PPI, size=MAC_NEAR, sizes=MAC_NEAR_SIZES, layout="right", share=0.45, chat=PPI_CHAT
    )
    zoom_paper(page, 1000)
    link = '.answer a[href*="rect="]'
    page.locator(link).first.evaluate(
        "(a, rect) => { a.href = a.href.replace(/rect=[^&]*/, 'rect=' + rect); }", PPI_EQUATION
    )
    page.locator(link).first.click()
    page.wait_for_timeout(2200)
    scroll_paper(page, ".cite-mark > *", left=60, top=150)
    scroll_chat(page, link, 0.62, 0)
    shot(page, "mac", {"link": box(page, link), "mark": box(page, ".cite-mark > *")})
    done(page)


SCENES = {
    "reading": reading,
    "highlights": highlights,
    "paper": paper,
    "library": library,
    "browse": browse,
    "map": map_scene,
    "search": search,
    "review": review,
    "chat": chat,
    "looks": looks,
    "mac": mac,
}


def compose(p, names: list[str]) -> None:
    """Renders each picture's page at 2x, and makes the PNG smaller."""
    browser = p.chromium.launch()
    for name in names:
        source = PICTURES / f"{name}.html"
        if not source.exists():
            print(f"  (no {source.relative_to(ROOT)})")
            continue
        page = browser.new_page(device_scale_factor=2)
        failures = []
        page.on("pageerror", lambda error: failures.append(error))
        page.goto(source.as_uri())
        page.wait_for_load_state("networkidle")
        size = page.evaluate("[document.body.offsetWidth, document.body.offsetHeight]")
        page.set_viewport_size({"width": size[0], "height": size[1]})
        out = PICTURES / f"{name}.png"
        page.screenshot(path=out, omit_background=True)
        page.close()
        if failures:
            raise SystemExit(f"{source.name}: {failures[0]}")
        subprocess.run(
            ["pngquant", "--force", "--skip-if-larger", "--output", str(out), "256", str(out)],
            check=False,
        )
        print("  ", out.relative_to(ROOT), f"{out.stat().st_size // 1024} KB")
    browser.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("names", nargs="*", metavar="NAME", help=", ".join(SCENES))
    parser.add_argument("--compose", action="store_true", help="only render the pages again")
    parser.add_argument("--server", default="http://127.0.0.1:8517")
    args = parser.parse_args()
    names = args.names or list(SCENES)
    if unknown := [n for n in names if n not in SCENES]:
        parser.error(f"no picture {', '.join(unknown)}; the pictures: {', '.join(SCENES)}")
    CAPTURES.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        if not args.compose:
            shooter = Shooter(p, args.server.rstrip("/"))
            for name in names:
                print(name)
                SCENES[name](shooter)
            shooter.close()
        compose(p, names)


if __name__ == "__main__":
    main()
