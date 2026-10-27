# Plan: the library

The library tab becomes the reader's overview of what they have: one collection of 2,256 papers, several views of it, and one search box that narrows whichever view shows. Today it is a single list of titles and years under their topics; a row opens only from its title, and there is no way to see one area (LLM evaluation, say), read its review, or take in the whole library at a glance.

This plan is plan.md's step 6 and its feedback items 16 (notes and reviews), 17 (add and remove papers) and 18 (a better paper list). Notes belong to the paper's sheet, reviews to the library. How the built parts work is in [architecture.md](architecture.md); the rest of what is left is in [plan.md](plan.md).

## What the library holds

What the views can draw on, counted in the reader's library (2026-10-27):

- **The topic tree**: 112 folders in `catalog/topics.yaml`, each with a one-line scope. The top level has about twenty areas; `llm/` alone holds half the papers.
- **A paper's frontmatter**: `title`, `published` (2,151 papers), `authors` (1,978), `summary`, a one-line statement of what the paper does (2,214), `added`, `arxiv`, `source`.
- **The agent's note** (`notes/<stem>.md`, 1,819): its `type` (method 985, study 289, benchmark 188, system 144, survey 140, theory 37, position 36), `family`, `evidence`, and a digest.
- **The reader's overview notes**: 35, in the Obsidian folder `overview_dir` names.
- **Reviews**: 7, one per review scope (`reviews/search-and-ranking.md`, `reviews/llm/evaluation.md`, …), with a scope, a title and the date it was updated in their properties, an `[!abstract]` callout, mermaid diagrams, and 150–420 reference-style links each. A paper's link points at its text (`../../library/….txt`), and a cited page at its PDF (`http://pdf.invalid/….pdf?page=8`), which `links.js` already opens.
- **Carrel's own record**: which paper was open when each question was asked.

The engine already reads all of this (`paper_index`, `load_topics`, `load_reviews`, `review_links`, `note_path`, `paper_stem` in `paperlib.py`). Carrel reads it through them, never by parsing it again.

## What every view draws from

- **`GET /api/library`**: one JSON document for every view, replacing the HTML list the server renders now. It holds:
  - each paper's PDF and text paths, title, authors, published, added, summary, topic, type and arXiv id;
  - three marks for each paper: the reader has an overview of it, a review cites it (and which), and a carrel chat discussed it;
  - the topics (path, scope, count) and the reviews (scope, title, updated, the abstract's first paragraph, papers cited).
- **Size and freshness.** About 250 KB gzipped. The server keeps it in memory and builds it again when a paper's text file changes; an ETag spares the page a download it already has.
- **The page filters on the device.** Each paper gets one lower-case haystack, and rows use `content-visibility: auto`, so 2,256 rows stay quick on the iPad.
- **Highlights are not a mark yet.** Counting them means opening every PDF. They can come later, from the saves carrel makes itself.

## Phase 1: Areas, All, reviews, text search

**The switcher.** The top of the library tab holds the search box and the views: *Areas · All* (Desk, Timeline and Map join later). Each device remembers its view and its area in `localStorage`. An area has an address, `/area/<topic>`.

**Rows** are shared by every view.

```
Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena          2023
  Zheng, Chiang, Sheng … · benchmark                       ◉  R  💬
  GPT-4 as a judge agrees with people over 80%; position and verbosity bias.
```

- **The whole row is the link.**
- **Compact** shows the title and the year. **Rich** adds the authors, the type and the summary.
- **Marks**: ◉ the reader's overview, R cited in a review, 💬 discussed in a chat.
- **Sort** by topic, date added or date published.

**Areas** is where the library tab opens. On a wide screen, a tree of the topic folders, with their counts, sits beside the area's page. On a narrow one (portrait, the e-ink tablet) the tree is a drill-down with a breadcrumb.

```
┌─ Areas ───────────────┬─ llm › evaluation ──────────────────────────────┐
│ ▾ llm            1140 │ Evaluating LLMs.                       214 papers│
│   ▸ agents        160 │ ┌──────────────────────────────────────────────┐ │
│   ▾ evaluation    214 │ │ Review · updated 12 Oct · cites 150          │ │
│     benchmarks    120 │ │ "Benchmarks saturate within two years; LLM   │ │
│     methods        94 │ │  judges agree with people but favour…" Read →│ │
│   ▸ memory         78 │ └──────────────────────────────────────────────┘ │
│ ▸ search-and-r…   190 │  benchmarks 120 ▮▮▮▮▮▮   methods 94 ▮▮▮▮▮        │
│ ▸ recommender…    170 │  ▁▁▂▃▅█▇  2018 – 2026                            │
│ ▸ deep-learning   140 │ ── Papers ─────────────────────────────────────  │
│ …                     │  (rows)                                          │
└───────────────────────┴──────────────────────────────────────────────────┘
```

- **An area's page**, from top to bottom:
  - its scope line;
  - its review's card (title, date, the abstract's first lines, Read →), or "no review yet";
  - its subtopics as count bars;
  - a histogram of the years its papers were published;
  - its papers, as rows.
- **The root's page is a treemap** of the top-level areas, sized by their papers. A tap enters an area. It shows in one picture what the library holds.

```
┌──────────────── llm 1140 ─────────────────┬─ search 190 ─┬ recsys 170 ┐
│ post-training 210 │ evaluation 214│agents │              │            │
│                   │               │ 160   ├──────────────┼──────┬─────┤
├─────────┬─────────┼───────┬───────┤       │ deep-learning│ vis  │ …   │
│memory 78│pretrain │context│ …     │       │     140      │      │     │
└─────────┴─────────┴───────┴───────┴───────┴──────────────┴──────┴─────┘
```

**All** is today's list, with rich rows and filter chips: area, type, a year range, and only the papers the reader has touched (an overview, a review's citation or a chat).

**A review opens in a tab of its own**, like a paper. Reading one is long work, with many trips to a cited paper and back; a tab keeps its place, and the chat beside it can be asked about it.

```
┌ ☰ │ Judging LLM-as… × │ Review: LLM evaluation × │ ──────────── chat ┐
│ # LLM evaluation                                 │                   │
│ > [!abstract] Benchmarks saturate…               │                   │
│ … as GSM1k showed [Careful Examination] …        │                   │
│        ┌───────────────────────────────┐         │                   │
│        │ A Careful Examination of… 2024│         │                   │
│        │ GSM1k shows up to 13% drops…  │         │                   │
│        │ [Open]   [Open at p. 8]       │         │                   │
│        └───────────────────────────────┘         │                   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Its address** is `/review/<scope>`. `GET /api/review/<scope>` returns its markdown, and `markdown.js` draws it, with its callouts, maths and diagrams.
- **A paper's link** opens a peek: title, year, summary, Open, and Open at p. N when the citation names a page. The link points at the paper's text, so it is resolved against the review's own path, and the peek opens the PDF, not the text. A `pdf.invalid` link opens the page as it does today.
- **A question asked beside a review** carries a context line that names the review's file. This changes `compose` and `split_question` together.

**Text search** is a second depth of the search box: *Titles* searches what the page holds (title, authors, summary, topic); *Text* searches the papers' text on the server.

```
[ "position bias"                 ]   Titles · Text
── Text: 23 papers ──────────────────────────────────────────
Judging LLM-as-a-Judge…  2023
   p. 4  …we observe a strong position bias: GPT-4 favours the first…
   p. 7  …swapping positions mitigates position bias in…        +3
```

- **`GET /api/search?q=`** greps the 2,256 text layers. Measure first whether ripgrep or Python is quicker, and use the quicker one.
- **Results** are grouped by paper: up to three snippets each, with the page (the nearest `[page N]` line above the match), and a cap on the number of papers.
- **A tap** opens the PDF at that page, with the term in find.
- **Admission.** It is a GET, admitted like every other request.

**Checked** in WebKit at the iPad's size with `shots.py`: the views on the real library (they only read), and anything that writes on a throwaway one. The API has pytest cases on the engine's example library.

## Phase 2: Desk, Timeline, the paper's notes

**Desk** gives the reader a reason to open the app.

```
┌ Continue ───────────────────────────────────────────────────┐
│ ▣ Judging LLM-as-a-Judge  p. 7/24 · chat yesterday          │
│ ▣ Review: LLM evaluation                                    │
├ Recently added (this week: 12) ─────────────────────────────┤
│ • τ²-Bench…  agents · benchmark       • OLMo 2…  foundation │
├ Reviews ────────────────────────────────────────────────────┤
│ Pilot ✓ memory    Primary ▮▮▮▮▯▯ 4/6    Systems ▯▯▯ 0/15    │
└─────────────────────────────────────────────────────────────┘
```

- **Continue**: the papers and reviews the reader had open recently, from the device's tabs and the chats.
- **Recently added.**
- **The reviews' progress** by scope, from `review_scopes`, as `paperlib reading` shows it.

**Timeline** shows the years published, as rows of dots coloured by top-level area. Switched to the dates added, it becomes a diary of what the reader collected. A tap on a year filters the list.

```
2026 ┃ ●●●●●●●●●●●●     llm ███████  search ██  recsys █
2025 ┃ ●●●●●●●●●●●●●●●●●●●●●
2024 ┃ ●●●●●●●●●●●●●●
 …   ┃ ●●
2017 ┃ ●  Attention Is All You Need
```

**The agent's note** goes in the page badge's sheet, under the paper's properties: type, family, evidence and the digest.

## Phase 3: add and remove papers (item 17)

- **Add.** "+ Add" in the library takes an arXiv id, a URL or a PDF. `paperlib add` files it and picks its topic, and its output streams into a sheet.
- **Remove.** Remove, in the paper's sheet, runs `paperlib remove` once the reader confirms.
- **The index.** Both rebuild the library's index, and the list follows.

## Separate task: meaning search

Search by what a paper is about, not by the words it uses: a third depth, *Meaning*, in the search box.

- **What is embedded.** Each paper's title, summary and abstract. The whole body only if a measurement shows it is worth the cost.
- **Where.** On the laptop (later the NAS), not the tablet.
- **The cache.** Content-addressed, each vector keyed by the model and the text. This is Acervo's pattern, so a changed summary is embedded again and nothing else is.
- **The encoder is chosen by a measurement on this library**: how often a paper's ten nearest neighbours share its topic folder, against random neighbours. Acervo measured its encoder the same way, by topic agreement at 10.

## Separate task: the map

Acervo's meaning map (`acervo-llm-dictionary`, `docs/features/meaning-map.md`), drawn from the papers. It needs meaning search's embeddings.

- **The look.** Related papers sit together. Zoomed out, the map names its regions; zoomed in, it shows titles. A tap peeks at a paper.
- **The layout.** UMAP with the cosine metric. Each new layout starts from the previous one and is aligned onto it (Procrustes), so the map moves as little as it can when papers are added.
- **Regions** come from Ward clustering on the 2-D layout, at two levels, so a label sits over its points.
- **Names** are written by a model, off the path that draws the map.
- **Colour.** Papers are coloured by top-level area, so the map shows where the meaning cuts across the folders.
