"""Generate extension icons: company card + ID search + risk scale."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
PRIMARY = (30, 90, 138)
PRIMARY_LIGHT = (43, 118, 176)
WHITE = (255, 255, 255)
LINE = (203, 213, 225)
GREEN = (34, 197, 94)
ORANGE = (245, 158, 11)
RED = (239, 68, 68)
SHADOW = (15, 45, 70, 70)


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def draw_gradient_rounded(draw: ImageDraw.ImageDraw, box: tuple, radius: int) -> None:
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for y in range(h):
        t = y / max(h - 1, 1)
        color = (
            lerp(PRIMARY[0], PRIMARY_LIGHT[0], t),
            lerp(PRIMARY[1], PRIMARY_LIGHT[1], t),
            lerp(PRIMARY[2], PRIMARY_LIGHT[2], t),
            255,
        )
        draw.rounded_rectangle(
            (x0, y0 + y, x1, y0 + y + 1),
            radius=radius,
            fill=color,
        )


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = max(1, round(size * 0.06))
    draw_gradient_rounded(draw, (pad, pad, size - pad, size - pad), round(size * 0.22))

    card_w = round(size * 0.56)
    card_h = round(size * 0.62)
    card_x = round(size * 0.18)
    card_y = round(size * 0.16)
    card_r = max(2, round(size * 0.07))

    shadow_off = max(1, round(size * 0.02))
    draw.rounded_rectangle(
        (
            card_x + shadow_off,
            card_y + shadow_off,
            card_x + card_w + shadow_off,
            card_y + card_h + shadow_off,
        ),
        radius=card_r,
        fill=SHADOW,
    )
    draw.rounded_rectangle(
        (card_x, card_y, card_x + card_w, card_y + card_h),
        radius=card_r,
        fill=WHITE,
    )

    line_h = max(1, round(size * 0.035))
    line_gap = max(2, round(size * 0.055))
    line_x0 = card_x + round(card_w * 0.14)
    line_x1 = card_x + card_w - round(card_w * 0.14)
    line_y = card_y + round(card_h * 0.22)
    for i, width_ratio in enumerate((1.0, 0.72, 0.52)):
        y = line_y + i * (line_h + line_gap)
        x1 = line_x0 + round((line_x1 - line_x0) * width_ratio)
        draw.rounded_rectangle((line_x0, y, x1, y + line_h), radius=line_h, fill=LINE)

    badge_r = max(2, round(size * 0.055))
    badge_cx = card_x + card_w - round(card_w * 0.18)
    badge_cy = card_y + round(card_h * 0.2)
    draw.ellipse(
        (
            badge_cx - badge_r,
            badge_cy - badge_r,
            badge_cx + badge_r,
            badge_cy + badge_r,
        ),
        fill=GREEN,
    )

    bar_y = card_y + card_h - round(card_h * 0.2)
    bar_h = max(2, round(size * 0.05))
    bar_x0 = line_x0
    bar_x1 = line_x1
    bar_w = bar_x1 - bar_x0
    seg = bar_w // 3
    for i, color in enumerate((GREEN, ORANGE, RED)):
        sx = bar_x0 + i * seg
        ex = bar_x0 + (i + 1) * seg - (1 if i < 2 else 0)
        draw.rounded_rectangle((sx, bar_y, ex, bar_y + bar_h), radius=1, fill=color)

    lens_r = round(size * 0.17)
    lens_cx = size - pad - lens_r
    lens_cy = size - pad - lens_r
    stroke = max(2, round(size * 0.05))
    draw.ellipse(
        (
            lens_cx - lens_r,
            lens_cy - lens_r,
            lens_cx + lens_r,
            lens_cy + lens_r,
        ),
        outline=WHITE,
        width=stroke,
    )
    handle_len = round(lens_r * 0.95)
    hx0 = lens_cx + round(lens_r * 0.65)
    hy0 = lens_cy + round(lens_r * 0.65)
    hx1 = hx0 + handle_len
    hy1 = hy0 + handle_len
    draw.line((hx0, hy0, hx1, hy1), fill=WHITE, width=stroke)
    draw.ellipse(
        (
            lens_cx - round(lens_r * 0.38),
            lens_cy - round(lens_r * 0.38),
            lens_cx + round(lens_r * 0.38),
            lens_cy + round(lens_r * 0.38),
        ),
        fill=PRIMARY_LIGHT + (230,),
    )

    hash_size = max(6, round(size * 0.11))
    hash_x = lens_cx - hash_size // 2
    hash_y = lens_cy - hash_size // 2
    sw = max(1, round(size * 0.018))
    for offset in (-hash_size * 0.18, hash_size * 0.18):
        ox = round(offset)
        draw.rounded_rectangle(
            (
                hash_x + round(hash_size * 0.2) + ox,
                hash_y,
                hash_x + round(hash_size * 0.45) + ox,
                hash_y + hash_size,
            ),
            radius=sw,
            fill=WHITE,
        )
        draw.rounded_rectangle(
            (
                hash_x + round(hash_size * 0.55) + ox,
                hash_y,
                hash_x + round(hash_size * 0.8) + ox,
                hash_y + hash_size,
            ),
            radius=sw,
            fill=WHITE,
        )
    mid_y = hash_y + hash_size // 2
    draw.rounded_rectangle(
        (hash_x, mid_y - sw, hash_x + hash_size, mid_y + sw),
        radius=sw,
        fill=WHITE,
    )

    return img


def save_icons() -> None:
    for size in (16, 48, 128):
        icon = draw_icon(size)
        out = ROOT / f"icon{size}.png"
        icon.save(out, format="PNG", optimize=True)
        print(f"Wrote {out}")


if __name__ == "__main__":
    save_icons()
