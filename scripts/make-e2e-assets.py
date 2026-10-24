"""Generates local placeholder posters/backdrops for end-to-end UI verification.

These files live in .e2e-assets/ and are only served to a throwaway test profile
during automated checks. They are never bundled into the application.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".e2e-assets"
OUT.mkdir(exist_ok=True)

FILMS = [
    ("花样年华", "IN THE MOOD FOR LOVE", 2000, (28, 34, 48), (78, 52, 44)),
    ("银翼杀手", "BLADE RUNNER", 1982, (18, 22, 34), (86, 44, 40)),
    ("海边的曼彻斯特", "MANCHESTER BY THE SEA", 2016, (24, 36, 44), (44, 62, 74)),
    ("燃烧", "BURNING", 2018, (30, 28, 24), (72, 56, 38)),
    ("地久天长", "SO LONG, MY SON", 2019, (26, 30, 34), (58, 60, 52)),
    ("完美的日子", "PERFECT DAYS", 2023, (22, 28, 32), (60, 74, 70)),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = ["msyhbd.ttc", "msyh.ttc"] if bold else ["msyh.ttc", "msyhbd.ttc"]
    for name in names:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def gradient(size, top, bottom) -> Image.Image:
    width, height = size
    img = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / (height - 1)
        img.putpixel(
            (0, y),
            (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return img.resize((width, height))


def vignette(img: Image.Image) -> Image.Image:
    """Gently darkens the corners; keeps the centre readable as a photo."""
    width, height = img.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((-width * 0.2, -height * 0.3, width * 1.2, height * 1.1), fill=48)
    dark = Image.new("RGB", (width, height), (8, 10, 14))
    return Image.composite(dark, img, mask)


def poster(title: str, original: str, year: int, top, bottom, index: int) -> None:
    width, height = 600, 900
    img = vignette(gradient((width, height), top, bottom))
    draw = ImageDraw.Draw(img)

    draw.rectangle((28, 28, width - 28, height - 28), outline=(120, 132, 152), width=2)
    draw.text((52, 60), f"{index + 1:02d}", font=font(40, True), fill=(150, 162, 180))

    title_font = font(62, True)
    draw.text((52, height - 260), title, font=title_font, fill=(240, 243, 248))

    orig_font = font(26)
    draw.text((52, height - 186), original, font=orig_font, fill=(198, 206, 220))

    draw.text((52, height - 138), str(year), font=font(30, True), fill=(138, 180, 255))
    draw.line((52, height - 92, width - 52, height - 92), fill=(90, 100, 118), width=2)
    img.save(OUT / f"poster-{index + 1}.png", format="PNG")

    backdrop = gradient((1920, 1080), top, bottom)
    bd = ImageDraw.Draw(backdrop)
    # Warm light wash so the crop band used by the hero reads as an image
    # rather than a flat panel.
    light = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    ld = ImageDraw.Draw(light)
    ld.ellipse((-420, -680, 1500, 700), fill=(206, 186, 142, 82))
    ld.ellipse((900, -300, 2200, 700), fill=(122, 168, 214, 64))
    ld.ellipse((260, 520, 1500, 1400), fill=(20, 24, 30, 46))
    backdrop = Image.alpha_composite(backdrop.convert("RGBA"), light).convert("RGB")
    backdrop = ImageEnhance.Brightness(backdrop).enhance(1.22)
    # No baked-in text: real TMDB backdrops are photographic, and a title here
    # would double up with the UI's own headline in screenshots.
    backdrop = vignette(backdrop)
    backdrop.save(OUT / f"backdrop-{index + 1}.png", format="PNG")


def main() -> None:
    for index, (title, original, year, top, bottom) in enumerate(FILMS):
        poster(title, original, year, top, bottom, index)
    print(f"assets written to {OUT}: {len(FILMS)} posters + {len(FILMS)} backdrops")


if __name__ == "__main__":
    main()
