# Phase 1 of the library plan: Areas, All, reviews, text search

## Context

Today the library tab is one server-rendered list of titles and years under their topics (`server.py` `papers()`, `papers.js`). [docs/plan-library.md](../../projects/products/carrel/docs/plan-library.md) phase 1 turns it into a view of the whole collection (2,275 papers, 111 topics, 7 reviews):
- **Areas**: a topic tree beside each area's page, and a treemap at the root.
- **All**: rich rows with filter chips.
- **Reviews** in tabs of their own, with a peek at each cited paper.
- **Text search** over the papers' text layers.

The UI must be beautiful: polish is part of each step, not left to the end.

What was measured on the real library (2026-10-27):
- **Building the document** takes ≈0.8 s. `papers()` is 0.34 s (a PDF existence check per paper on the synced drive), the 1,819 notes' heads 0.36 s, reviews 0.06 s. Checking whether anything changed (a walk and stat) takes 12 ms.
- **Text search**: ripgrep takes 0.03–0.25 s and Python 1.25 s. Ripgrep needs `--no-ignore --hidden -a` to match Python's 90 files; without them it finds 87.
- **Type**: 1,819 papers have one, as the `type:` line in their agent note. Only 5 have it in their frontmatter, through `set-type`. The ≈456 papers without a note have none.
- **Chats**: 13 transcripts hold a `[Reading …]` line. Carrel's chats are tagged `carrel` (369 lines) or, the earliest, `sdk-py`.

## Decisions

- **The type is read through the engine.** A new engine function, `paperlib.note_fields(paper)`, reads it. Carrel takes the frontmatter `type` first and the note's otherwise.
- **An engine task backfills the type** for every paper and keeps it filled from then on (see "The engine").
- **Type icons**: a small, calm Lucide icon per type, in a left gutter of each row:

  | Type | Icon |
  |---|---|
  | method | `flask-conical` |
  | survey | `map` |
  | benchmark | `gauge` |
  | study | `microscope` |
  | system | `cpu` |
  | position | `megaphone` |
  | theory | `sigma` |

  They are 15 px, stroke 1.75, in `--muted`. The type's name is the icon's label and shows in rich rows. The Type chip's menu doubles as their legend.
- **"Discussed in a chat"** comes from the transcripts of carrel's own chats: the ids in `sessions.jsonl`, plus files tagged `carrel` or `sdk-py`. Their `[Reading …]` lines are read with `split_question`'s regex, and each file's result is cached by mtime and size. This needs no new log, and earlier chats count.
- **A question beside a review** carries the context line `[Reading the review reviews/llm/evaluation.md]`. `compose`, `split_question` and `history` change together.
- **Search runs ripgrep** from the PATH (Homebrew's `rg`). A clear 503 comes back if it's missing, and the later NAS image installs it.

## Decisions from the reader's review (2026-10-27): these override what follows

- **Only the `carrel` tag counts.** "Discussed in a chat" reads only transcripts tagged `carrel` (found with `rg -l '"entrypoint":"carrel"'`). `sdk-py` was for testing, and there is no backward support yet.
- **One home for the prompt format.** `context_line`, `selection_block`, `compose`, `split_question` and the regexes move from `session.py` to a new `src/carrel/prompt.py`. That module also gets a small helper, `paper_named(prompt)`, used by both `split_question` and `usage.discussed()`. When the format changes, only the current format is parsed.
- **Use the best tools.** Install whatever a task justifies (ripgrep is chosen), and say what was added and why.
- **Where the type lives is decided by an experiment in the engine**, `experiments/paper-type/`, in the format of `experiments/README.md`.
  - **The facts**: 1,819 papers have the type only as the `type:` line of the agent's note, which `paperlib read` writes with one model request per paper. 5 have it in the frontmatter (the overview skill's `set-type`). About 456 papers have no note, and so no type.
  - **The question**: can a cheap call at `paperlib add` time (Haiku, from the title, the summary and the abstract) find the type reliably? The gold data is the notes' 1,819 types, which were written by reading the whole paper. The experiment reports accuracy and a confusion matrix.
  - **Already there**: `scripts/paper-info.py` (vetting) already asks a model for a `type`, and can serve as a baseline.
  - **The outcome**: one place for the type (the frontmatter is likely), filled at filing, a backfill for every paper, and `check-library` requiring it.
  - **How it is written**: `docs/tasks/paper-types.md`, a task in the engine, holds this experiment plus the transition. Carrel reads the frontmatter first and `note_fields` otherwise until the transition lands.
- **Saved for a fresh session.** The work hasn't started. Begin at "Order of work", step 1.

## The engine (agentic-paper-library)

1. **`note_fields(paper)`** in `scripts/paperlib.py` returns `{type, family, evidence}` from the note's head (the lines above `## Digest`), or `{}` when the paper has no note. `reread_reason` and `flag_reread` share one private `_note_head()` helper with it. It gets a test in `tests/`, run with `paperlib test`.
2. **AGENTS.md**: the carrel rule's list of functions it uses gains `load_topics`, `load_reviews`, `review_links`, `note_fields` and `PAGE_MARK`.
3. **A new task, `docs/tasks/paper-types.md`**: every paper's type in its frontmatter, always filled. It covers:
   - the facts above;
   - the frontmatter as the one place for the type, written by `paperlib read` and the overview skill. Whether the note keeps its `type:` line is decided there.
   - **the backfill**: copy the type from the note where there is one (no model needed), and classify the others with one cheap request each, from the title, the summary and the abstract;
   - **the prompts**: the filing prompt (`paperlib add`) and the reading prompt always choose a type, nudged to pick the closest one even when it's unclear;
   - **the checks**: `check-library` requires `type`, and the guide says it's required;
   - **the measurement**: how often the classifier agrees with the 1,819 notes' types, which decides whether its types can be trusted;
   - **afterwards**: carrel's fallback to the note can go.

## Carrel's rules and memory

- **AGENTS.md**, a new rule: *"The engine and the other projects are ours. When a task needs a change in agentic-paper-library (or another project under `~/projects`), make it there, with its tests and docs, rather than working around it here. Clean design comes first, and a design may change as far as the task needs."* The "read through the engine" rule stays.
- **The layout table** gains the new modules.
- **Memories**: cross-repo changes are welcome, and a beautiful UI matters (polish each view, look at every view in WebKit in both themes).

## Server

**`src/carrel/engine.py`** gains thin reads:
- `topics()`, through `load_topics`;
- `reviews()`: each review's scope, title, updated date, path, the first paragraph of its `[!abstract]` callout, and the papers it cites, resolved by `review_links`;
- `review(scope)`: its markdown (all its files, without the frontmatter) and a map from each link target to `{pdf}` or `{review: scope}`, from `review_links`;
- `paper_type(text)`: the frontmatter's type, else `note_fields`;
- `overview_names()`: one listing of `overview_dir`.

**New `src/carrel/catalog.py`** builds the document for `GET /api/library`:
- **Each paper**: `pdf, text, title, authors, published, added, summary, topic, type, arxiv`, and the marks `overview`, `reviews: [scope]` and `chats: n`. Empty fields are left out.
- **The topics** (`path, scope, count, total`) and **the reviews**.
- **When it's built again**: when its signature changes. The signature is the count and latest mtime of the library folder, the notes, `overview_dir`, the reviews, `topics.yaml` and carrel's transcripts. The build runs in a thread, under a lock.
- **What's kept in memory**: the JSON and its gzip, with an ETag. A matching `If-None-Match` gets a 304; `gzip` in `Accept-Encoding` gets the compressed bytes. A global GZip middleware is not used, because it would break the PDFs' Range requests.

**`usage.py`** gains `discussed(library_root)`, which returns `{paper text: number of questions}`.

**New `src/carrel/search.py`** runs `GET /api/search?q=&topic=`:
- **The pattern**: the words escaped and joined by `\s+`, since layout text puts runs of spaces between words. Matching ignores case.
- **The pass**: `rg --count-matches -i --no-ignore --hidden -a`, over `*.txt`/`*.md` but not README, under the papers folder or the topic's subfolder.
- **Ranking**: by number of matches, up to 30 papers. Each gets up to 3 snippets, read in Python, with the page from the nearest `PAGE_MARK` above the match.
- **What comes back**: `{total, papers: [{pdf, title, topic, count, hits: [{page, before, match, after}]}]}`, as plain text, which the page puts into `<mark>`.
- **Limits**: 3–200 characters, otherwise a 400. Ripgrep is killed after 10 s. Papers without a PDF are left out.

**`server.py`**:
- `/area/{topic}` and `/review/{scope}` serve the shell, with `data-area` / `data-review` (404 when unknown);
- `/api/library`, `/api/review/{scope}` and `/api/search` are added;
- `papers()` and `$papers` go;
- the module docstring is updated. All of these are GETs, admitted as now.

**`session.py`**:
- `ask(..., review=None)`;
- `context_line` gains the review form; `split_question` returns `review` (the file named) and `history` passes it;
- the Question carries `{review: path, title}`;
- `_handle`/`handle` pass `message.get("review")`.

## The page

**Modules** (new unless marked):
- **`library.js`**: the data. It loads `/api/library` (`cache: 'no-cache'`, so the ETag revalidates). It also holds pure functions, tested: the haystack, `filterPapers(query, chips)` (every word must match, as today), sorting by topic, added or published, `topicTree` with totals, `yearCounts`, and `restoreLibrary(stored)` for the device's state (`carrel.library`: view, area, density, sort, chips, search depth).
- **`treemap.js`**: a pure squarified layout, two levels, tested.
- **`rows.js`**: one row, compact or rich, as the plan's mock-up shows. The whole row is the link. The type icon sits in the gutter; the marks are `notebook-text` (the overview), `book-open-text` (a review cites it) and `i-chat` (discussed), with their counts in the label.
- **`papers.js`** (rewritten): the library tab.
  - **Its header**: the search box, a *Titles · Text* segmented control, an *Areas · All* segmented control, and sort and density.
  - **All**: chips for Area, Type (with the icons), Years (from–to) and Touched. Each opens a small sheet.
- **`areas.js`**:
  - **The tree**: on a wide pane (a container query, ≥ 860 px), chevrons with counts beside the area's page. On a narrow one, a drill-down with a breadcrumb.
  - **The area's page**: its scope as a lede, then the review card. The card has the title, "updated 12 Oct · cites 150", a three-line clamp of the abstract and "Read →". For an area with no review of its own, it says "covered by the review of llm/evaluation" or "no review yet", and lists the reviews inside the area.
  - **Then**: subtopic count bars and a year histogram (a tap on a year narrows the rows), then the rows.
  - **The root**: a treemap.
  - **The search box**: it narrows the rows, and the tree's counts become counts of matches.
- **`text-search.js`**: the Text depth.
  - **When it searches**: a debounced fetch, the previous one aborted, within the area showing in Areas.
  - **Results**: grouped by paper, with "p. 4 …snippet…", and "+N" for more.
  - **A tap** calls `openTarget({file, page, search})`.
- **`review.js`**: the review tab.
  - **Drawing**: through `drawMarkdown`, with callouts and Mermaid; each review's tab keeps its scroll place.
  - **A paper's link** opens a peek, a popover with the title, year and summary, plus Open, and "Open at p. N" for the page links to the same paper in the same paragraph.
  - **Other links**: a link to another review opens its tab, `pdf.invalid` links open as now, and web links open a new tab.
- **`tabs.js`**:
  - tab entries become `{pdf…}` or `{review: scope, title, place}`, with the key `review:<scope>` (a topic path can't hold a colon). `restoreTabs` keeps the old state.
  - `openReview`, `isTab` and `itemInView` are added.
  - The addresses gain `/area/<topic>` and `/review/<scope>` (parse and write); tests are added.
- **`app.js`**: wires the review pane (`#review-pane`, `body[data-active="review"]`), the area address, popstate for the new paths, and `target.search` handed to `tools.find(term)`.
- **`paper-tools.js`**: `find(term)` opens find with the term. This also makes `search=` in paper links work.
- **`markdown.js`**: `drawCallouts(element)` turns `> [!kind] title` into a styled callout after sanitising, building it from the DOM's text only. `overview.js` uses it in place of the bold-title rewrite in `fromObsidian`, and its test is updated.
- **`chat.js`**: `currentReview()` is sent with the question, and the question's "about" line names the review and opens its tab.
- **`app.html`**: the library pane's skeleton, `#review-pane`, and the new Lucide 1.55.0 symbols. Those are the type icons, `book-open-text`, `chevron-right`, `chevron-left`, `list`, `layout-grid`, `arrow-up-down` and `sliders-horizontal`, taken from `lucide-static@1.55.0` and drawn as the others are, with the ISC note kept.

## Visual design (the bar to meet)

- **Tokens**: the existing palette stays. Added:
  - `--area-1…12`: muted, equal-lightness hues for the top-level areas, with dark variants, for the treemap, the bars and later the Timeline;
  - `--chip`, `--chip-on` and `--mark-on`;
  - `--row-pad`.
- **Type**:
  - **Titles** use the reading serif (`--reading`), 17 px.
  - **The rest**: meta in the UI sans, 13–14 px `--muted`; summaries 15 px with a two-line clamp.
  - **Numbers**: counts and years use `tabular-nums`.
- **Rows**: at least 44 px to tap, hairline separators, the year right-aligned, a quiet pressed state, and `content-visibility: auto` with an intrinsic size.
- **Controls**:
  - **Segmented controls**: iOS-like pills.
  - **Chips**: rounded and filled when on.
  - **Sheets**: the existing `.sheet` style.
- **Areas**:
  - **The tree**: the selected row on a soft accent background, counts right-aligned.
  - **The treemap**: 2 px gutters, a 6 px radius, low-saturation area hues, serif labels with counts. A label shows only when its tile can hold it, and sub-tiles show inside large tiles.
  - **The bars and histogram**: thin and rounded.
- **The review**:
  - **Its text** uses the reading serif at a comfortable measure (about 70ch), with the callouts as tinted boxes.
  - **The peek** is a small card with a shadow, anchored to the link and kept on screen.
- **Calm**: no animation beyond short fades, and `prefers-reduced-motion` respected. Every view is checked in light and dark.

## Tests

- **pytest**: `conftest.py` copies the engine's `examples/library`, as the plan asks. It then adds the current test papers (and declares `recsys`), a note with `type:`, and a review citing a paper with a page link. A few assertions that counted one paper are adjusted.
  - **New cases**: the document's fields and marks; topic totals; review entries; the ETag and 304; gzip; a rebuild after a paper's text changes; `/api/review` with its link map, and 404; `/api/search` with its pages, topic scope, short query and cap; the `/area` and `/review` shells; the review context line through `compose`, `split_question` and `history`; `discussed()`.
- **node**: `library.test.mjs` (filter, sort, tree totals, years, state restore), `treemap.test.mjs` (areas proportional, the rectangle filled), and additions to `tabs.test.mjs` (review tabs, the new addresses, restoring old state) and `markdown.test.mjs` (callouts).
- **Engine**: `note_fields` tests, with `paperlib test` passing.

## Verification

1. `uv run pytest && node --test tests/*.test.mjs`, `uv run ruff check . && uv run ruff format --check .`, and the engine's `paperlib test`.
2. `uv run carrel serve --library ~/papers`. The views only read, so the real library is fine.
3. **`scripts/shots.py`**:
   - **New flags**: `--size WxH` (or `--landscape`), `--dark`, `--view areas|all`, `--area TOPIC`, `--review SCOPE` (with `--peek`), `--search Q [--text]`.
   - **The shots**: Areas root (treemap), `llm/evaluation` (wide tree and portrait drill-down), All with chips (compact and rich), the review tab with a peek, and text search, with a tap that opens the PDF at the page with the term in find. Each at 820×1180, 1180×820 and in dark mode.
   - **Then**: I look at each shot and polish until it reads well.
4. **A chat question beside a review**: on Haiku, against a throwaway library, `shots.py --review … --ask`. Check the context line in the transcript.

## Order of work (you commit; I suggest a message after each)

1. **The engine**: `note_fields`, its test, the AGENTS.md rule and the task doc.
2. **Carrel's rules and memories.**
3. **The server's data and its tests**: the catalog, `/api/library`, the routes, the conftest.
4. **Rows, All and Areas**, with the treemap, styles and icons, then the shots and a polish pass.
5. **Reviews**: the API, the tab, the peek, callouts, and the chat's context line.
6. **Text search**: the API, the Text depth, and find with the term.
7. **Docs**:
   - **AGENTS.md's layout table**.
   - **plan-library.md**: phase 1 marked built, awaiting its sitting on the iPad. Its notes move to architecture.md after the sitting, as the convention says.
   - **architecture.md**: a "Library" section for what's settled, such as the API and its freshness, and why ripgrep.
