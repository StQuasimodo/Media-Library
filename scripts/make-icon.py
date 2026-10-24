"""Generates the My Cinema application icon (build/icon.ico + icon.png).

Design: a deep, near-black rounded square with a thin cold-blue frame and a
serif "MC" monogram — the same editorial mark used in the app's sidebar.
Run with: python scripts/make-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

SIZE = 1024
BG = (16, 18, 22, 255)
BG_TOP = (30, 37, 50, 255)
RING = (59, 74, 99, 255)
ACCENT = (138, 180, 255, 255)
SUBTLE = (146, 153, 166, 255)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def vertical_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        grad.putpixel(
            (0, y),
            (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return grad.resize((size, size))


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/georgiab.ttf"),
        Path("C:/Windows/Fonts/timesbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def build_icon() -> Image.Image:
    base = vertical_gradient(SIZE, BG_TOP, BG).convert("RGBA")
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(base, (0, 0), rounded_mask(SIZE, 224))

    draw = ImageDraw.Draw(canvas)

    # Thin inner frame, kept subtle so the icon reads as a poster plate.
    inset = 58
    draw.rounded_rectangle(
        (inset, inset, SIZE - inset, SIZE - inset),
        radius=176,
        outline=RING,
        width=10,
    )

    # Sprocket column on the left: a quiet nod to a film strip.
    hole_w, hole_h = 46, 68
    x = 132
    for index in range(5):
        y = 224 + index * 132
        draw.rounded_rectangle(
            (x, y, x + hole_w, y + hole_h),
            radius=14,
            fill=(45, 56, 76, 255),
        )

    font = load_font(430)
    text = "MC"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.text(
        (SIZE / 2 + 44 - text_w / 2 - bbox[0], SIZE / 2 - text_h / 2 - bbox[1] - 10),
        text,
        font=font,
        fill=ACCENT,
    )

    small = load_font(74)
    label = "CINEMA"
    label_bbox = draw.textbbox((0, 0), label, font=small)
    label_w = label_bbox[2] - label_bbox[0]
    draw.text(
        (SIZE / 2 + 44 - label_w / 2 - label_bbox[0], SIZE - 250),
        label,
        font=small,
        fill=SUBTLE,
    )

    return canvas


def main() -> None:
    icon = build_icon()
    icon.save(BUILD / "icon.png", format="PNG")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    icon.save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes])
    for s in sizes:
        icon.resize((s, s), Image.LANCZOS).save(BUILD / f"icon-{s}.png", format="PNG")
    print(f"icon written: {BUILD / 'icon.ico'} ({len(sizes)} sizes)")


if __name__ == "__main__":
    main()
