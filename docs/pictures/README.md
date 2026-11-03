# The pictures

The pictures in carrel's README and on the blog's Projects page: carrel on a real library (the author's, about 2,300 papers), captured as a reader sees it, then composed.

- `<name>.html` places the captures of one picture with its heading; a comment at its top says what it shows and where its facts come from. `style.css` is shared: carrel's light theme and its typefaces.
- `<name>.png` is the page rendered at 2x: 1920×1200, and the hero, `reading.png`, 2120×1120 on no background.
- `arrows.js` draws the arrows, with a tap or a click where they start, from the boxes `scripts/pictures.py` records with each capture (`captures/marks.js`).
- `captures/` holds the captures (not in git: `scripts/pictures.py` takes them again).
- `chats.json` names the two chats the pictures asked, so a retake draws them again instead of asking.

```sh
uv run --group shots python scripts/pictures.py                 # every capture, then every picture (needs a running carrel)
uv run --group shots python scripts/pictures.py map review      # those pictures only
uv run --group shots python scripts/pictures.py --compose       # only render the pages again
```

The tablet is WebKit at 600×860 (or 860×600) with touch, and the Mac app is Chromium at 1040×650, whose window frame is drawn by `style.css`, both at 2x: smaller than the real devices, so that a picture shows the text near the size it was drawn at. The hero and the pictures with an arrow raise carrel's text sizes and zoom the paper in further. `pngquant` makes each picture about a third of its size.

What the captures do to the library:

- They only read it, except for two questions. The highlights picture asks Opus about a highlight, and the review picture asks about a review; each costs a turn of the reader's plan. A chat may also write the agent's notes on its paper, as any chat does.
- Nothing is written to a PDF. The overview shown is one that was already written.

Before committing a new picture, look at it for what must not be published: the note about the reader (Settings → About me), the laptop's tailnet address, a login or an email.
