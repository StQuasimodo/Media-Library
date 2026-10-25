"""Convert the user-approved square artwork into reproducible desktop icon assets.

No redrawing or cropping. Requires Pillow; run: python scripts/make-icon.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def main() -> None:
    with Image.open(BUILD / "icon-source.png") as source:
        if source.width != source.height:
            raise ValueError("The approved icon source must be square; do not distort or crop it.")
        icon = source.convert("RGBA").resize((1024, 1024), Image.Resampling.LANCZOS)
    icon.save(BUILD / "icon.png", format="PNG")
    icon.save(BUILD / "icon.ico", format="ICO", sizes=[(size, size) for size in SIZES])
    for size in SIZES:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(BUILD / f"icon-{size}.png", format="PNG")
    print(f"Approved artwork converted: {len(SIZES)} ICO sizes and 1024px PNG.")


if __name__ == "__main__":
    main()
