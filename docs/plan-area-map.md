# Plan: the area map

The treemap at the root of Areas shows the whole library at once: each top-level area a tile sized by its papers, and its subtopics inside it. It is the library's most telling picture, and the reader wants more from it. This plan is what to try next, and how to judge it; [architecture.md](architecture.md#the-library) has how the map works now (every tile named with its count, the rest merged into "+N more").

## What is still short of it

Measured in WebKit on the real library (21 areas, 111 topics):

- **Portrait (820 px)**: 17 of 21 areas are named; "+4 more areas" holds 69 papers. Only llm shows its subtopics, 10 of 18, and its "+8 more" holds 187 papers, more than any area but llm. The other areas show no subtopics.
- **Landscape (1180 px, the tree beside it)**: the same 17 areas; llm, deep learning (1 of 6), ml foundations (2 of 4) and reinforcement learning (1 of 4) show subtopics.
- **The smallest label** is at 11 px ("+2 more 31"): readable on the iPad, not on the e-ink tablet.
- **An area's own page** shows its subtopics only as bars, so the map stops at the top level.

## Options

1. **A smaller font.** No: 11 px is the floor for the iPad at arm's length, and the e-ink tablet wants larger, not smaller.
2. **Zoom.**
   - **By entering an area (recommended).** An area's page opens with a map of its own subtopics, laid out with the same code, and their subtopics inside them. A tap on a tile goes one level down, and the breadcrumb goes back up. Nothing new to learn, every level gets the whole width, and the bars stay under the map for the full list. Cost: the area's page grows by one picture; its histogram and review card stay.
   - **Pinch.** No, or not first: the page's own pinch, and Safari's, already compete in the PDF (pinch.js has the story), and scaling a picture shows its labels only as large as they were drawn. A pinch that relays the map at each step is the expensive version of entering an area.
3. **Grouping.** Done, as "+N more". Open question for the sitting: should a tap on "+N more" open a small card over the map listing what it holds (each a link, with its count), as the review's peek does, rather than leaving for the area's page? It keeps the reader on the map and costs one card. Try it if the sitting finds the jump jarring.
4. **The information arranged otherwise.** Done in part: counts under names, headers that grow. Further, a tile could show a little more when it has room: its read share as a thin bar, or its newest paper's title. Only if a sitting asks for it: the map's strength is that it is calm.
5. **Another picture.**
   - **Bands (an icicle chart)**: each level a row of horizontal bands, as wide as their papers, labels always horizontal and along the band's length. It shows three levels legibly where the treemap shows two, at the cost of the treemap's at-a-glance areas. Worth trying as a switch on the map, "Map · Bands", and keeping only if it reads better at the sitting.
   - **A sunburst** puts labels on arcs, hard to read and to tap. **Circle packing** wastes a third of the space. Neither.
   - **The tree with bars**, an indented list with a bar per row, is what "Every area" and the tree beside the page already are.

## Order of work

1. **An area's page opens with its own map** (option 2, entering an area). `layoutTreemap` takes a root other than the library's, and the page draws it above the bars. Shots at 820, 1180 and 1366 px, in both themes; count the named tiles at each level, as above.
2. **The "+N more" card** (option 3), if the sitting asks for it.
3. **Bands** (option 5), as a switch, if the sitting wants three levels at once.

Each step ends with a sitting on the iPad and the e-ink tablet, and a line in architecture.md.
