"""Scale assets/launcher-icon.png into the PWA and Android launcher sizes.

Does not redraw the artwork. Every output is that exact image, resized.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "launcher-icon.png"
PUBLIC = ROOT / "public" / "icons"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

LAUNCHER = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
FOREGROUND = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}


def resized(size: int) -> Image.Image:
    image = Image.open(SOURCE).convert("RGB")
    if image.size == (size, size):
        return image
    return image.resize((size, size), Image.Resampling.LANCZOS)


def write(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")


PUBLIC.mkdir(parents=True, exist_ok=True)
write(resized(192), PUBLIC / "icon-192.png")
write(resized(512), PUBLIC / "icon-512.png")
write(resized(180), PUBLIC / "apple-touch-icon.png")
write(resized(512), PUBLIC / "icon-maskable-512.png")
write(resized(512), ROOT / "app" / "icon.png")

for density, size in LAUNCHER.items():
    folder = RES / f"mipmap-{density}"
    image = resized(size)
    write(image, folder / "ic_launcher.png")
    write(image, folder / "ic_launcher_round.png")

for density, size in FOREGROUND.items():
    folder = RES / f"mipmap-{density}"
    write(resized(size), folder / "ic_launcher_foreground.png")

print(SOURCE)
