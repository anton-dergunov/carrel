"""Propose papers for the bench, by the kind of page each has.

    uv run python experiments/crisp-pages/find_papers.py --library ~/papers [--per-kind 6] [--out FILE]

Opens every PDF in the library with PyMuPDF and looks at its first pages: who made it (the
producer and creator), which fonts it embeds and of what type, how much text and how much image
a page carries. From these it sorts papers into the bench's kinds:

- latex: modern LaTeX (pdfTeX/LuaTeX/XeTeX, 2015 or later), Computer Modern or Times;
- word: made by Microsoft Word (or Office), Calibri, Cambria or Times New Roman;
- type1: an older paper (2010 or before) set in Type 1 fonts, often thin;
- scanned: a page that is one page-sized image, with an OCR text layer or none;
- maths: LaTeX with maths fonts (CMMI/CMSY or the like) and a figure on the same page.

It prints candidates for each kind with the page that shows it best, as YAML to paste into
papers.yaml after choosing; nothing is written unless --out is given.

    uv run python experiments/crisp-pages/find_papers.py --library ~/papers --crops papers.yaml

fills in the `rect` of every crop in papers.yaml that has none: a window 46% of the page wide and
three quarters as tall, placed over the most text (the most maths and drawing, for maths), or
around the phrase in `near`. A crop that has its rect keeps it.
"""

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from carrel.engine import Library  # noqa: E402

PAGES = 4  # the first pages looked at
MATHS_FONT = re.compile(
    r"CMMI|CMSY|CMEX|MSBM|MSAM|STIXMath|LatinModernMath|NewCMMath|txsy|txmi", re.I
)
LATEX = re.compile(r"pdfTeX|LuaTeX|XeTeX|LaTeX|dvipdfm|TeX", re.I)
WORD = re.compile(r"Microsoft|Word|Office", re.I)
WORD_FONT = re.compile(r"Calibri|Cambria|TimesNewRoman|Times New Roman|Arial", re.I)


def describe(pdf: Path) -> dict | None:
    try:
        doc = pymupdf.open(pdf)
    except Exception:
        return None
    try:
        meta = doc.metadata or {}
        pages = []
        fonts: dict[str, str] = {}
        for index in range(min(PAGES, doc.page_count)):
            page = doc[index]
            area = abs(page.rect)
            text = page.get_text("text")
            images = 0.0
            for info in page.get_image_info():
                box = pymupdf.Rect(info["bbox"]) & page.rect
                images += abs(box)
            drawings = len(page.get_drawings()) if index < 2 else 0
            for xref, ext, kind, name, *_ in page.get_fonts():
                fonts[name.split("+")[-1]] = kind
            pages.append(
                {
                    "page": index + 1,
                    "chars": len(text.strip()),
                    "image": round(min(images / area, 1.0), 2) if area else 0,
                    "drawings": drawings,
                    "maths": sum(1 for f in page.get_fonts() if MATHS_FONT.search(f[3])),
                }
            )
        return {
            "producer": meta.get("producer") or "",
            "creator": meta.get("creator") or "",
            "fonts": fonts,
            "pages": pages,
            "count": doc.page_count,
        }
    finally:
        doc.close()


def kinds_of(info: dict, year: int | None) -> list[tuple[str, int, float]]:
    """The kinds a paper shows, each with the page that shows it best and a score."""
    made = f"{info['producer']} {info['creator']}"
    types = set(info["fonts"].values())
    names = " ".join(info["fonts"])
    pages = info["pages"]
    found = []
    scanned = [p for p in pages if p["image"] > 0.85]
    if scanned and len(scanned) >= len(pages) - 1:
        best = max(scanned, key=lambda p: p["image"])
        found.append(("scanned", best["page"], best["image"]))
    elif LATEX.search(made) and year and year >= 2015:
        body = max(pages, key=lambda p: p["chars"])
        found.append(("latex", body["page"], body["chars"] / 1000))
        maths = [p for p in pages if p["maths"] >= 2 and (p["image"] > 0.1 or p["drawings"] > 30)]
        if maths:
            best = max(maths, key=lambda p: p["maths"])
            found.append(("maths", best["page"], best["maths"]))
    if WORD.search(made) and WORD_FONT.search(names) and not scanned:
        body = max(pages, key=lambda p: p["chars"])
        found.append(("word", body["page"], body["chars"] / 1000))
    if year and year <= 2010 and "Type1" in types and not scanned:
        body = max(pages, key=lambda p: p["chars"])
        found.append(("type1", body["page"], body["chars"] / 1000))
    return found


CROP_WIDTH = 0.46  # of the page's width: two crops side by side at page width
CROP_ASPECT = 0.75  # height / width


def column_starts(page: pymupdf.Page) -> list[float]:
    """Where the page's columns begin: the x at which many long lines start."""
    starts: Counter[float] = Counter()
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            x0, _, x1, _ = line["bbox"]
            if x1 - x0 > page.rect.width * 0.25:
                starts[round(x0 / 3) * 3] += 1
    columns: list[float] = []
    for x, count in starts.most_common():
        if count < 4 or len(columns) == 2:
            break
        if all(abs(x - c) > 24 for c in columns):
            columns.append(float(x))
    return sorted(columns)


def crop_rect(page: pymupdf.Page, kind: str, near: str | None) -> list[float]:
    """A window over the part of the page that shows its kind best."""
    width = page.rect.width * CROP_WIDTH
    height = width * CROP_ASPECT
    words = page.get_text("words")
    left = min((w[0] for w in words), default=page.rect.width * 0.08)
    if near:
        hits = page.search_for(near)
        if hits:
            hit = hits[0]
            x0 = max(0.0, min(hit.x0 - 6, page.rect.width - width))
            y0 = max(0.0, min(hit.y0 - height * 0.5, page.rect.height - height))
            return [round(v, 1) for v in (x0, y0, x0 + width, y0 + height)]
    maths = []
    if kind == "maths":
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if MATHS_FONT.search(span["font"]):
                        maths.append(pymupdf.Rect(span["bbox"]))
        drawn = [pymupdf.Rect(d["rect"]) for d in page.get_drawings()]
    columns = column_starts(page) or [left]
    best, best_score = None, -1.0
    step = 12.0
    for x0 in columns:
        if x0 + width > page.rect.width:
            continue
        y = 36.0
        while y + height < page.rect.height - 36:
            window = pymupdf.Rect(x0 - 4, y, x0 - 4 + width, y + height)
            score = sum(len(w[4]) for w in words if pymupdf.Rect(w[:4]) in window)
            if kind == "maths":
                score = score * 0.1 + 20 * sum(1 for r in maths if r in window)
                score += sum(1 for r in drawn if r.intersects(window))
            if score > best_score:
                best, best_score = window, score
            y += step
    if best is None:  # no text: a scan without OCR
        x0, y0 = page.rect.width * 0.08, page.rect.height * 0.3
        best = pymupdf.Rect(x0, y0, x0 + width, y0 + height)
    return [round(v, 1) for v in best]


def fill_crops(library: Library, path: Path) -> None:
    text = path.read_text()
    header = "".join(line for line in text.splitlines(keepends=True) if line.startswith("#"))
    data = yaml.safe_load(text)
    for crop in data["crops"]:
        if crop.get("rect"):
            continue
        doc = pymupdf.open(library.resolve_pdf(crop["pdf"]))
        page = doc[crop["page"] - 1]
        crop["rect"] = crop_rect(page, crop["kind"], crop.get("near"))
        crop["size"] = [round(page.rect.width, 1), round(page.rect.height, 1)]
        print(f"{crop['id']}: page {crop['page']} {crop['rect']}", file=sys.stderr)
        doc.close()
    body = yaml.safe_dump(
        data, sort_keys=False, allow_unicode=True, width=200, default_flow_style=None
    )
    path.write_text(header + body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--library", default="~/papers")
    parser.add_argument("--per-kind", type=int, default=6)
    parser.add_argument("--out", help="write the candidates as YAML here too")
    parser.add_argument("--crops", help="fill in the missing rects of this papers.yaml instead")
    args = parser.parse_args()

    library = Library(args.library)
    if args.crops:
        fill_crops(library, Path(args.crops))
        return
    candidates = defaultdict(list)
    entries = library.entries()
    for done, (paper, _meta) in enumerate(entries, 1):
        if done % 200 == 0:
            print(f"  {done}/{len(entries)}", file=sys.stderr)
        info = describe(library.pdf_root / paper.pdf)
        if not info:
            continue
        year = int(paper.year) if paper.year.isdigit() else None
        for kind, page, score in kinds_of(info, year):
            candidates[kind].append(
                {
                    "title": paper.title,
                    "year": year,
                    "pdf": paper.pdf,
                    "page": page,
                    "pages": info["count"],
                    "producer": info["producer"][:60],
                    "fonts": sorted(info["fonts"])[:6],
                    "score": round(score, 2),
                }
            )
    chosen = {}
    for kind in ("latex", "word", "type1", "scanned", "maths"):
        found = sorted(candidates[kind], key=lambda c: -c["score"])
        # A spread, not the top few alone: the most text, the least, and between.
        step = max(1, len(found) // args.per_kind)
        chosen[kind] = found[::step][: args.per_kind]
        print(f"{kind}: {len(found)} found", file=sys.stderr)
    text = yaml.safe_dump(chosen, sort_keys=False, allow_unicode=True, width=120)
    print(text)
    if args.out:
        Path(args.out).write_text(text)


if __name__ == "__main__":
    main()
