"""The pictures in docs/pictures: carrel on a real library, captured, then composed.

    uv run --group shots python scripts/pictures.py [NAME ...] [--compose] [--server URL]

Each picture is docs/pictures/<name>.html, a page that places captures of carrel
(docs/pictures/captures/, not in git) with a heading. This script takes the captures from a
running carrel, the way a reader would see it: an iPad in WebKit (820x1180 or 1180x820, touch)
and the Mac app's page in Chromium (1440x900), both at 2x. Then it renders each page at 2x to
<name>.png (1920x1200; the hero 2400x1500 on no background) and makes it smaller with pngquant.
NAME retakes those pictures only; --compose only renders the pages again, with no server.

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
from shots import center, layout_script, look_script, wait_for_answer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PICTURES = ROOT / "docs" / "pictures"
CAPTURES = PICTURES / "captures"
CHATS = PICTURES / "chats.json"
TITLES = CAPTURES / "titles.json"

IPAD = (820, 1180)
IPAD_LANDSCAPE = (1180, 820)
MAC = (1440, 900)

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


class Shooter:
    """Opens carrel as a device, fresh each time: the iPad in WebKit, the Mac in Chromium."""

    def __init__(self, p, server: str):
        self.server = server
        self.webkit = p.webkit.launch()
        self.chromium = p.chromium.launch()

    def open(
        self,
        device: str,
        path: str = "/",
        *,
        theme: str = "carrel-light",
        layout: str | None = None,
        chat: str | None = None,
        library: str | None = None,
        size: tuple[int, int] | None = None,
        model: str = "opus",
    ):
        mac = device == "mac"
        width, height = size or (MAC if mac else IPAD)
        context = (self.chromium if mac else self.webkit).new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=2,
            has_touch=not mac,
            color_scheme="dark" if theme.endswith("dark") else "light",
        )
        page = context.new_page()
        page.on("pageerror", lambda e: print(f"  page error: {e}"))
        page.add_init_script(f"localStorage.setItem('carrel.model', {json.dumps(model)});")
        page.add_init_script(look_script(theme, False, None))
        if layout:
            page.add_init_script(layout_script(layout))
        if chat:
            page.add_init_script(f"localStorage.setItem('carrel.chat', {json.dumps(chat)});")
        if library:
            page.add_init_script(library)
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


def shot(page, name: str, **options) -> None:
    """A capture, and its page's title, which the Mac app shows in its title bar."""
    path = CAPTURES / f"{name}.png"
    page.screenshot(path=path, **options)
    titles = json.loads(TITLES.read_text()) if TITLES.exists() else {}
    titles[name] = page.title() or "Carrel"
    TITLES.write_text(json.dumps(dict(sorted(titles.items())), indent=2, ensure_ascii=False) + "\n")
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


def scroll_answer_to(page, selector: str, offset: int = 12, nth: int = -1) -> None:
    """Scrolls the chat so the `nth` `selector` in it (the last) is `offset` px below its top."""
    page.evaluate(
        """([selector, offset, nth]) => {
          const log = document.getElementById('log');
          const target = [...log.querySelectorAll(selector)].at(nth);
          if (!target) return;
          log.scrollTop += target.getBoundingClientRect().top - log.getBoundingClientRect().top - offset;
        }""",
        [selector, offset, nth],
    )
    page.wait_for_timeout(400)


# The scenes: each takes the captures of one picture.


def reading(s: Shooter) -> None:
    """The hero: a citation followed on the iPad, and the same reading on e-ink."""
    page = s.paper("ipad", PAGED, size=IPAD_LANDSCAPE, layout="right", chat=KV_CHAT)
    page.locator('.answer a[href*="page=3&rect=90,360"]').first.click()
    page.wait_for_timeout(2200)  # the page turns and the mark's ring settles
    print("  at:", page.inner_text("#page-badge"))
    scroll_answer_to(page, ".question", 8)
    shot(page, "reading-ipad")
    done(page)

    page = s.paper("ipad", ZEP, theme="eink", layout="bottom", chat=ZEP_CHAT)
    citation = page.locator('.answer a[href*="table.2"]').first
    citation.click()
    page.wait_for_timeout(1500)
    shot(page, "reading-eink")
    done(page)


def highlights(s: Shooter) -> None:
    """A highlight tapped, asked about, and listed in the paper's contents."""
    chat = chat_ids().get("highlights")
    page = s.paper("ipad", LONGMEMEVAL, size=IPAD_LANDSCAPE, layout="right", chat=chat)
    page.wait_for_selector(".annotationLayer .highlightAnnotation", timeout=30_000)
    page.wait_for_timeout(600)
    page.touchscreen.tap(*center(page, ".annotationLayer .highlightAnnotation"))
    page.wait_for_timeout(400)
    shot(page, "highlights-panel")
    if not chat:
        page.click("#mark-ask")
        page.wait_for_timeout(300)
        asked(page, "highlights", HIGHLIGHT_QUESTION)
    else:
        page.keyboard.press("Escape")
    scroll_answer_to(page, ".question", 8)
    shot(page, "highlights-answer")
    page.click("#page-badge")
    page.wait_for_selector("#paper-info:not([hidden])", timeout=10_000)
    page.wait_for_timeout(900)
    shot(page, "highlights-contents")
    done(page)


def paper(s: Shooter) -> None:
    """What the library knows of a paper, and its overview note."""
    page = s.paper("ipad", JUDGEBENCH, layout="bottom")
    page.click("#page-badge")
    page.wait_for_selector("#paper-info:not([hidden])", timeout=10_000)
    page.wait_for_timeout(1000)  # the similar papers and the outline come later
    for head in page.query_selector_all('#contents-sheet .fold-head[aria-expanded="false"]'):
        head.click()
    page.wait_for_timeout(400)
    if page.is_visible("#sheet-size"):
        page.click("#sheet-size")
        page.wait_for_timeout(400)
    shot(page, "paper-info")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.locator("#overview").click()
    page.wait_for_selector("#overview-sheet:not([hidden])")
    page.wait_for_timeout(800)
    shot(page, "paper-overview")
    done(page)


def library(s: Shooter) -> None:
    """Desk on the iPad, and Areas on the Mac: the whole library as a map of its topics."""
    page = s.paper("ipad", PAGED, layout="hidden", library=library_script("desk"))
    page.goto(read_url(s.server, ZEP))
    page.wait_for_selector(".pdfViewer .page canvas", timeout=30_000)
    page.click("#tab-papers")
    page.wait_for_timeout(1200)
    shot(page, "library-desk")
    done(page)

    page = s.open("mac", layout="hidden", library=library_script("areas"))
    page.wait_for_selector("#area-page .area-title", timeout=30_000)
    page.wait_for_timeout(1500)
    shot(page, "library-areas")
    done(page)


def browse(s: Shooter) -> None:
    """All, its rows rich and narrowed by chips, on the iPad; Timeline on the Mac."""
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
    shot(page, "browse-all")
    done(page)

    page = s.open("mac", layout="hidden", library=library_script("timeline"))
    page.wait_for_selector("#timeline-view :is(.year, .timeline-year, svg, canvas)", timeout=30_000)
    page.wait_for_timeout(1500)
    shot(page, "browse-timeline")
    done(page)


def map_scene(s: Shooter) -> None:
    """The meaning map whole, then lit by a meaning search."""
    page = s.open("mac", layout="hidden", library=library_script("map"))
    status = "#map-view .map-status"
    page.wait_for_selector(f"{status}:has-text('paper'):not(:has-text('Drawing'))", timeout=300_000)
    page.wait_for_timeout(3500)  # the map grows in
    shot(page, "map-whole")
    page.click('#depth [data-depth="meaning"]')
    page.type("#filter", "how far an LLM judge agrees with human raters", delay=20)
    page.wait_for_selector(f"{status}:has-text('“'):not(:has(.searching))", timeout=120_000)
    page.wait_for_timeout(600)
    if page.locator("#map-view .map-fit").count():
        page.click("#map-view .map-fit")
        page.wait_for_timeout(1200)
    print("  ", page.inner_text(status))
    shot(page, "map-search")
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
    page = s.open("mac", f"/review/{REVIEW}", layout="right", chat=chat)
    page.wait_for_selector(".review-body", timeout=30_000)
    page.wait_for_timeout(1500)
    if not chat:
        asked(page, "review", REVIEW_QUESTION)
    scroll_answer_to(page, ".question", 8)
    link = page.locator(
        '.review-body :is(p, li):has(a[data-kind="page"]) a[data-kind="paper"]'
    ).nth(2)
    link.scroll_into_view_if_needed()
    page.evaluate("document.getElementById('review-pane').scrollBy(0, -260)")
    page.wait_for_timeout(300)
    link.click()
    page.wait_for_selector("#peek:not([hidden])")
    page.wait_for_timeout(500)
    shot(page, "review")
    done(page)


def chat(s: Shooter) -> None:
    """The earlier chats, and the slash commands."""
    page = s.paper("ipad", PPI, layout="tab", chat=PPI_CHAT)
    page.click("#tab-chat")
    page.wait_for_timeout(1200)
    page.click("#chats")
    page.wait_for_selector("#chats-sheet:not([hidden])", timeout=10_000)
    page.wait_for_timeout(800)
    shot(page, "chat-earlier")
    done(page)

    page = s.paper("ipad", PPI, layout="tab", chat=PPI_CHAT)
    page.click("#tab-chat")
    page.wait_for_timeout(1200)
    scroll_answer_to(page, ".answer .maths.display", 200, 0)
    page.click("#question")
    page.type("#question", "/", delay=80)
    page.wait_for_selector("#commands:not([hidden])", timeout=30_000)
    page.wait_for_timeout(400)
    shot(page, "chat-commands")
    done(page)


def looks(s: Shooter) -> None:
    """One page in four looks, and the pages' settings."""
    for theme in ("carrel-light", "carrel-dark", "plain-light", "eink"):
        page = s.paper("ipad", PAGED, theme=theme, layout="bottom", chat=KV_CHAT)
        page.evaluate("document.getElementById('viewerContainer').scrollTop += 300")
        page.wait_for_timeout(800)
        shot(page, f"looks-{theme}")
        done(page)
    page = s.paper("ipad", PAGED, layout="bottom", chat=KV_CHAT)
    page.click("#settings-button")
    page.wait_for_selector("#settings-dialog[open]", timeout=10_000)
    page.wait_for_timeout(500)
    shot(page, "looks-settings")
    done(page)


def mac(s: Shooter) -> None:
    """The Mac app's window: a paper and its chat side by side, an equation cited and marked."""
    page = s.paper("mac", PPI, layout="right", chat=PPI_CHAT)
    page.locator('.answer a[href*="rect="]').first.click()
    page.wait_for_timeout(2200)
    scroll_answer_to(page, ".answer .maths.display", 380, 0)
    shot(page, "mac")
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
        page.goto(source.as_uri())
        page.wait_for_load_state("networkidle")
        size = page.evaluate("[document.body.offsetWidth, document.body.offsetHeight]")
        page.set_viewport_size({"width": size[0], "height": size[1]})
        out = PICTURES / f"{name}.png"
        page.screenshot(path=out, omit_background=True)
        page.close()
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
