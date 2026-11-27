"""把双机位视频按帧号抽出来，每帧把正面、侧面两个机位并排（裁掉多余的灰底），排成一张大图，帧号写在左上角。
用法: python3 vgrid.py <视频> <输出.jpg> <起:止:步长 或 逗号分隔的帧号> [每行几帧=6] [裁剪 x0,y0,x1,y1（单个机位里，854×480 的视频）=50,20,377,475]"""
import sys, subprocess, numpy as np
from PIL import Image, ImageDraw
src, out, spec = sys.argv[1:4]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
box = [int(v) for v in (sys.argv[5] if len(sys.argv) > 5 else "50,20,377,475").split(",")]
cams = sys.argv[6] if len(sys.argv) > 6 else "fs"                 # f 只要正面、s 只要侧面、fs 两个都要
if ":" in spec: a, b, s = [int(v) for v in spec.split(":")]; frames = list(range(a, b + 1, s))
else: frames = [int(v) for v in spec.split(",")]
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
W, H = 854, 480; n = len(raw) // (W * H * 3); V = np.frombuffer(raw, np.uint8)[: n * W * H * 3].reshape(n, H, W, 3)
cw = (box[2] - box[0]) * len(cams) + 6 * (len(cams) - 1) + 8; ch = box[3] - box[1]; rows = (len(frames) + cols - 1) // cols
sheet = Image.new("RGB", (cw * cols, ch * rows), (40, 40, 40)); dr = ImageDraw.Draw(sheet)
for i, f in enumerate(frames):
    if f >= n: continue
    im = Image.fromarray(V[f]); x0 = (i % cols) * cw; y0 = (i // cols) * ch
    for k, cm in enumerate(cams):
        ox = 0 if cm == "f" else 427; sheet.paste(im.crop((ox + box[0], box[1], ox + box[2], box[3])), (x0 + k * (box[2] - box[0] + 6), y0))
    dr.rectangle((x0, y0, x0 + 34, y0 + 16), fill=(255, 255, 255)); dr.text((x0 + 3, y0 + 2), str(f), fill=(200, 0, 0))
sheet.save(out, quality=85); print(out, n, "frames")
