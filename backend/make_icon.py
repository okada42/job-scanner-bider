import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


w = h = 128
raw = b"".join(b"\x00" + b"\x3d\xd6\x8c\xff" * w for _ in range(h))
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw, 9))
    + chunk(b"IEND", b"")
)
path = Path(__file__).resolve().parents[1] / "extension" / "icons" / "icon128.png"
path.write_bytes(png)
print("wrote", path, len(png))
