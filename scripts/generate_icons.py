"""Render the Workout Logger favicon and launcher artwork as PNGs."""

import math
import struct
import zlib
from itertools import pairwise
from pathlib import Path

ICONS_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "icons"
CANVAS = 512
INK = (238, 247, 255)
TEAL = (112, 230, 216)
NAVY = (9, 13, 22)
BLUE = (31, 72, 145)

# The barbell and trend line both fit in Android's central maskable safe circle.
BARBELL = (
    (133, 227, 160, 300, 10),
    (168, 190, 203, 337, 11),
    (194, 251, 318, 276, 10),
    (309, 190, 344, 337, 11),
    (352, 227, 379, 300, 10),
)
TREND = ((169, 170), (217, 134), (253, 156), (324, 109))


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


def _rounded_rectangle(x: float, y: float, box: tuple[int, int, int, int, int]) -> float:
    left, top, right, bottom, radius = box
    dx = max(left + radius - x, x - right + radius)
    dy = max(top + radius - y, y - bottom + radius)
    return math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - radius


def _segment_distance(x: float, y: float, start: tuple[int, int], end: tuple[int, int]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    t = ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)
    t = min(1, max(0, t))
    return math.hypot(x - start[0] - t * dx, y - start[1] - t * dy)


def _coverage(distance: float, pixel: float) -> float:
    return min(1, max(0, 0.5 - distance / pixel))


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], fraction: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * fraction),
        round(a[1] + (b[1] - a[1]) * fraction),
        round(a[2] + (b[2] - a[2]) * fraction),
    )


def write_icon(path: Path, size: int, *, maskable: bool = False) -> None:
    pixel = CANVAS / size
    raw = bytearray()
    for row in range(size):
        raw.append(0)  # No PNG scanline filter.
        y = (row + 0.5) * pixel
        for column in range(size):
            x = (column + 0.5) * pixel
            alpha = (
                255
                if maskable
                else round(
                    255 * _coverage(_rounded_rectangle(x, y, (10, 10, 502, 502, 107)), pixel)
                )
            )
            glow = max(0, 1 - math.hypot(x - 100, y - 60) / CANVAS)
            color = _mix(NAVY, BLUE, glow)
            if 105 < x < 407 and 82 < y < 365:
                plate = min(_rounded_rectangle(x, y, box) for box in BARBELL)
                rise = (
                    min(_segment_distance(x, y, start, end) for start, end in pairwise(TREND)) - 9
                )
                color = _mix(color, INK, _coverage(plate, pixel))
                color = _mix(color, TEAL, _coverage(rise, pixel))
            raw.extend((*color, alpha))

    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, level=9))
    png += _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32):
        write_icon(ICONS_DIR / f"favicon-{size}.png", size)
    for size in (192, 512):
        write_icon(ICONS_DIR / f"icon-{size}.png", size)
    write_icon(ICONS_DIR / "icon-maskable-512.png", 512, maskable=True)


if __name__ == "__main__":
    main()
