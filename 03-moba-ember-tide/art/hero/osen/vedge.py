"""查一段双机位视频里角色（连武器）有没有碰到各自半边画面的边：逐帧算前景包围盒，列出贴边的帧段。
用法: python art/hero/osen/vedge.py <视频> [<视频> …]"""
import cv2, sys, numpy as np
def runs(ids):
    out = []; s = None; p = None
    for i in ids:
        if s is None: s = p = i
        elif i == p + 1: p = i
        else: out.append((s, p)); s = p = i
    if s is not None: out.append((s, p))
    return ",".join(f"{a}-{b}" if a != b else str(a) for a, b in out) or "无"
for src in sys.argv[1:]:
    cap = cv2.VideoCapture(src); fr = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fr.append(f)
    H, W = fr[0].shape[:2]; hw = W // 2; bg = np.median(fr[0][:16].reshape(-1, 3), axis=0); res = {}
    for name, x0, x1 in (("正面", 0, hw - 3), ("侧面", hw + 3, W)):
        hit = {"左": [], "右": [], "上": [], "下": []}; ext = [1e9, 1e9, -1, -1]
        for i, f in enumerate(fr):
            m = np.abs(f[:, x0:x1].astype(np.int16) - bg).sum(-1) > 70; ys, xs = np.where(m)
            if not len(xs): continue
            a, b, c, d = xs.min(), ys.min(), xs.max(), ys.max(); w = x1 - x0
            ext = [min(ext[0], a), min(ext[1], b), max(ext[2], c), max(ext[3], d)]
            if a <= 1: hit["左"].append(i)
            if c >= w - 2: hit["右"].append(i)
            if b <= 1: hit["上"].append(i)
            if d >= H - 2: hit["下"].append(i)
        res[name] = (ext, hit, x1 - x0)
    print("==", src.split("/")[-1], "帧数", len(fr))
    for name, (ext, hit, w) in res.items():
        print(f"  {name} 前景范围 x {ext[0]}..{ext[2]} / {w}  y {ext[1]}..{ext[3]} / {H}   贴边: " + "  ".join(f"{k}[{runs(v)}]" for k, v in hit.items()))
