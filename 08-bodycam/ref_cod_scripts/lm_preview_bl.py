import bpy, sys, numpy as np
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
crop = [int(v) for v in argv[2].split(",")] if len(argv) > 2 else None
im = bpy.data.images.load(src)
W, H = im.size
a = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(H, W, 4)[::-1]
print("SIZE", W, H, "rgb max", a[..., :3].max(), "mean", a[..., :3].mean(), "a max", a[..., 3].max())
if crop:
    x, y, w, h = crop; a = a[y:y + h, x:x + w]
rgb = a[..., :3] * 0.6; rgb = rgb / (1 + rgb)
s = np.clip(a[..., 3] / 8, 0, 1)
top = np.clip(rgb, 0, 1) ** (1 / 2.2)
bot = np.repeat((s ** (1 / 2.2))[..., None], 3, axis=2)
out = np.concatenate([top, bot], axis=1)
h, w = out.shape[:2]
step = max(1, int(np.ceil(w / 2400)))
out = out[::step, ::step]
h, w = out.shape[:2]
import zlib, struct
u8 = (np.clip(out, 0, 1) * 255).astype(np.uint8)
raw = b"".join(b"\x00" + u8[y].tobytes() for y in range(h))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
open(dst, "wb").write(png)
