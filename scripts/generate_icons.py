"""One-off generator for placeholder solid-color PWA icons (no Pillow dependency)."""

import struct
import zlib
from pathlib import Path

ICONS_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "icons"


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


def write_solid_png(path: Path, size: int, rgba: tuple[int, int, int, int]) -> None:
    row = bytes(rgba) * size
    raw = b"".join(b"\x00" + row for _ in range(size))
    compressed = zlib.compress(raw, level=9)

    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", compressed)
    png += _chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    navy = (15, 23, 42, 255)
    write_solid_png(ICONS_DIR / "icon-192.png", 192, navy)
    write_solid_png(ICONS_DIR / "icon-512.png", 512, navy)
    write_solid_png(ICONS_DIR / "icon-maskable-512.png", 512, navy)


if __name__ == "__main__":
    main()
