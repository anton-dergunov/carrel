# Plan

Carrel puts a paper's PDF and a Claude Code chat side by side on a tablet. The chat runs on the laptop (later the NAS) through the Agent SDK, and the app is served over Tailscale. This file is only what is left: what to build, and what to check at the next sitting on the iPad. What is built is described in [architecture.md](architecture.md) as soon as it is built; the area map has its own plan, [plan-area-map.md](plan-area-map.md).

## For the next sitting

Built since the last sitting, and to be checked on the iPad (and the e-ink tablet, where it says so). What the sitting finds goes into the steps below, or into architecture.md when it settles something.

- **A citation's mark** (item 14, [architecture](architecture.md#a-citations-mark)): does it read well on the iPad, at a glance from the chat, and does a tap on the page clear it without getting in the way of the pen?
- **The library** (items 16–18, [architecture](architecture.md#the-library)):
  - the treemap's labels at a finger's reach;
  - the tree beside an area's page in landscape;
  - the review peek's placement near the screen's edges;
  - a review's place after trips to its papers;
  - Text search's snippets and find;
  - Desk's Continue after a few days;
  - adding a paper by pasting an arXiv link, and a PDF from Files.
- **Meaning search and similar papers**:
  - does a description find what the reader meant, and does the nearness meter help or distract?
  - are the sheet's similar papers worth their section?
- **The meaning map** ([architecture](architecture.md#the-library)):
  - do the region names read as the library's fields, and do the titles come in at the right zoom on the iPad?
  - does a pinch move the map smoothly, and does a double tap zoom without the peek getting in the way?
  - the peek's place in both orientations, and with the chat beside or below;
  - is lighting a search's papers useful, and does a paper added glide in?
- **The paper's sheet** (item 23, [architecture](architecture.md#the-overview-and-the-properties)):
  - do the folded sections' notes say enough to choose what to open?
  - is opened out, over the chat too, the right size on the iPad in both orientations?
  - and on the phone, the whole page at once.

## Feedback still open

From the reader's sittings on the iPad, numbered as the steps below cite them. Items 1–20 and 23 are built (14, 16–18 and 23 await their sitting, above); 21–22 are open.

**The chat**

21. **A resumed chat shows no output for a local command** such as `/context`: its transcript keeps it where the SDK does not read.
22. **A background task's notification in a VS Code chat** is drawn as a question.

## Steps

Each step ends with a sitting on the iPad, and its findings are added here. Steps 1–5 and most of 6 are built and described in [architecture.md](architecture.md).

6. **The library** (items 16–18). Left:
   - **The area map**: entering an area opens a map of its own subtopics, and more if the sitting asks ([plan-area-map.md](plan-area-map.md)).
   - **Highlights as a mark** on a paper's row: counting them means opening every PDF, so they would come from the saves carrel makes itself.
7. **The paper's highlights listed in its contents.**
8. **Lectern's comforts and the NAS** (the old parts 6–7). Themes, e-ink (no animation, page turns, the stream shown in a few large updates), start at login with launchd, and a Docker image for the NAS.

## Open questions

- Does the PDF fit above a chat on the e-ink tablet, or does e-ink want the chat as a sheet over the page? Step 2's layout choices should answer this.
