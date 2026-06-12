#!/usr/bin/env python3
"""Add visible flag text to the Loki challenge image."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


DEFAULT_INPUT = Path("loki.webp")
DEFAULT_OUTPUT = Path("loki_flagged.webp")
DEFAULT_CHALLENGE = Path("challenge.yml")
DEFAULT_FLAG = "HZU18{l0k1_th3_m1scH3v10us}"
FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Overlay flag text on an image.")
    parser.add_argument("-i", "--input", default=DEFAULT_INPUT, type=Path, help="source image")
    parser.add_argument("-o", "--output", default=DEFAULT_OUTPUT, type=Path, help="output image")
    parser.add_argument(
        "-f",
        "--flag",
        help="flag text to draw; defaults to the first static flag in challenge.yml",
    )
    parser.add_argument(
        "--challenge",
        default=DEFAULT_CHALLENGE,
        type=Path,
        help="challenge.yml path used to discover the default flag",
    )
    parser.add_argument("--x", default=54, type=int, help="left position for the text box")
    parser.add_argument(
        "--y",
        type=int,
        help="top position for the text box; defaults near the lower-left corner",
    )
    parser.add_argument("--font-size", type=int, help="starting font size")
    parser.add_argument(
        "--max-width",
        type=int,
        help="maximum text width before the font is scaled down",
    )
    parser.add_argument(
        "--quality",
        default=95,
        type=int,
        help="output quality for lossy formats such as WebP and JPEG",
    )
    return parser.parse_args()


def flag_from_challenge(path: Path) -> str:
    if not path.exists():
        return DEFAULT_FLAG

    text = path.read_text(encoding="utf-8")
    match = re.search(r'content:\s*["\']([^"\']+)["\']', text)
    if match:
        return match.group(1)

    return DEFAULT_FLAG


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for font_path in FONT_CANDIDATES:
        candidate = Path(font_path)
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)

    return ImageFont.load_default(size=size)


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font, stroke_width=2)
    return right - left, bottom - top


def fitting_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    start_size: int,
    max_width: int,
) -> ImageFont.ImageFont:
    size = start_size
    while size > 10:
        font = load_font(size)
        width, _ = text_size(draw, text, font)
        if width <= max_width:
            return font
        size -= 2

    return load_font(size)


def draw_flag(
    image: Image.Image,
    flag: str,
    *,
    x: int,
    y: int | None,
    font_size: int | None,
    max_width: int | None,
) -> Image.Image:
    canvas = image.convert("RGBA")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    width, height = canvas.size
    box_padding_x = max(18, width // 60)
    box_padding_y = max(12, height // 60)
    target_width = max_width or int(width * 0.55)
    start_size = font_size or max(10, width // 90)
    font = fitting_font(draw, flag, start_size, target_width)
    text_width, text_height = text_size(draw, flag, font)

    box_width = text_width + (box_padding_x * 2)
    box_height = text_height + (box_padding_y * 2)
    box_x = min(max(0, x), max(0, width - box_width))
    box_y = y if y is not None else height - box_height - max(42, height // 14)
    box_y = min(max(0, box_y), max(0, height - box_height))

    box = (box_x, box_y, box_x + box_width, box_y + box_height)
    draw.rounded_rectangle(
        box,
        radius=8,
        fill=(22, 14, 55, 190),
        outline=(255, 209, 61, 230),
        width=max(2, width // 540),
    )
    draw.text(
        (box_x + box_padding_x, box_y + box_padding_y),
        flag,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=2,
        stroke_fill=(30, 20, 70, 255),
    )

    return Image.alpha_composite(canvas, overlay).convert(image.mode)


def main() -> int:
    args = parse_args()
    flag = args.flag or flag_from_challenge(args.challenge)

    with Image.open(args.input) as source:
        result = draw_flag(
            source,
            flag,
            x=args.x,
            y=args.y,
            font_size=args.font_size,
            max_width=args.max_width,
        )
        result.save(args.output, quality=args.quality)

    print(f"wrote {args.output} with flag text: {flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
