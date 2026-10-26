"""Draw carrel's Home Screen icons: a page with a chat bubble beside it.

    uv run --with pillow python scripts/icons.py

Writes src/carrel/static/icons/. Our own drawing, under the repository's licence.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "carrel" / "static" / "icons"
SIZE = 1024
ACCENT = "#2a6f97"
PAGE = "#fdf6e3"
LINES = "#b9b09a"
BUBBLE = "#efe7d1"
INK = "#2b2b28"


def draw() -> Image.Image:
    # Full bleed and opaque: iOS rounds the corners itself and fills transparency with black.
    image = Image.new("RGB", (SIZE, SIZE), ACCENT)
    pen = ImageDraw.Draw(image)
    pen.rounded_rectangle((250, 170, 690, 790), radius=36, fill=PAGE)
    for i, y in enumerate(range(270, 640, 62)):
        pen.rounded_rectangle((320, y, 620 if i % 3 != 2 else 520, y + 22), radius=11, fill=LINES)
    pen.rounded_rectangle((500, 560, 850, 800), radius=60, fill=BUBBLE, outline=ACCENT, width=18)
    pen.polygon([(560, 790), (530, 880), (640, 795)], fill=BUBBLE)
    for x in (600, 675, 750):
        pen.ellipse((x - 22, 658, x + 22, 702), fill=INK)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = draw()
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        image.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(OUT / name)


if __name__ == "__main__":
    main()
