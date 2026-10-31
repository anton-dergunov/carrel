"""Draw carrel's icons, a page with a chat bubble beside it: the Home Screen's and the Mac app's.

    uv run --with pillow python scripts/icons.py

Writes src/carrel/static/icons/ and macos/Resources/Assets.xcassets/AppIcon.appiconset/. Our own
drawing, under the repository's licence.
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "carrel" / "static" / "icons"
MAC = ROOT / "macos" / "Resources" / "Assets.xcassets" / "AppIcon.appiconset"
# Apple's grid for a Mac icon: the body 824 of 1024 wide, with these rounded corners.
MAC_BODY = 824
MAC_RADIUS = 185
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


def mac(image: Image.Image) -> Image.Image:
    """The drawing as a Mac icon: macOS rounds no corners, so the icon carries its own, inset in
    a transparent margin."""
    body = image.resize((MAC_BODY, MAC_BODY), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (MAC_BODY, MAC_BODY), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, MAC_BODY - 1, MAC_BODY - 1), radius=MAC_RADIUS, fill=255
    )
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    margin = (SIZE - MAC_BODY) // 2
    icon.paste(body, (margin, margin), mask)
    return icon


def write_mac(image: Image.Image) -> None:
    MAC.mkdir(parents=True, exist_ok=True)
    icon = mac(image)
    entries = []
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            name = f"icon_{points}x{points}{'@2x' if scale == 2 else ''}.png"
            icon.resize((points * scale,) * 2, Image.LANCZOS).save(MAC / name, optimize=True)
            entries.append(
                {
                    "idiom": "mac",
                    "size": f"{points}x{points}",
                    "scale": f"{scale}x",
                    "filename": name,
                }
            )
    contents = {"images": entries, "info": {"author": "xcode", "version": 1}}
    (MAC / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")
    (MAC.parent / "Contents.json").write_text(
        json.dumps({"info": contents["info"]}, indent=2) + "\n"
    )
    print(MAC)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    image = draw()
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        image.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(OUT / name)
    write_mac(image)


if __name__ == "__main__":
    main()
