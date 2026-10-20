"""WCAG contrast for brand colours: white text on the accent must reach 4.5:1."""

import re

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
MIN_RATIO = 4.5


def _channel(c: int) -> float:
    v = c / 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    r, g, b = (int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def ratio_with_white(hex_colour: str) -> float:
    return 1.05 / (luminance(hex_colour) + 0.05)


def is_hex(value: str) -> bool:
    return bool(_HEX.match(value))


def nearest_passing(hex_colour: str) -> str:
    """Darken the colour step by step until white text on it is readable."""
    r, g, b = (int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
    while ratio_with_white(f"#{r:02x}{g:02x}{b:02x}") < MIN_RATIO and (r or g or b):
        r, g, b = int(r * 0.95), int(g * 0.95), int(b * 0.95)
    return f"#{r:02x}{g:02x}{b:02x}"
