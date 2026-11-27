"""检查渲染帧是否齐全、文件是否完整（JPEG 以 FFD9 结尾 / PNG 以 IEND 结尾）。用法：python check_frames.py <渲染根目录>"""
import sys, os
root = sys.argv[1]
EDIT = [('S1', 120), ('S3', 120), ('S2', 180), ('S4', 120), ('S5', 120), ('S5B', 60), ('S6', 150)]
bad = []
for shot, n in EDIT:
    miss, trunc, sizes = [], [], []
    for f in range(1, n + 1):
        p = None
        for ext in ('jpg', 'png'):
            q = os.path.join(root, shot, f'{shot}_{f:04d}.{ext}')
            if os.path.exists(q):
                p = q; break
        if p is None:
            miss.append(f); continue
        sz = os.path.getsize(p); sizes.append(sz)
        with open(p, 'rb') as fh:
            fh.seek(-12, 2); tail = fh.read()
        ok = tail.endswith(b'\xff\xd9') if p.endswith('.jpg') else (b'IEND' in tail)
        if not ok or sz < 20000:
            trunc.append(f)
    med = sorted(sizes)[len(sizes) // 2] if sizes else 0
    small = []
    print(shot, 'have', len(sizes), '/', n, 'missing', miss[:12], 'truncated', trunc, 'median KB', med // 1024)
    bad += [(shot, f) for f in miss + trunc]
print('TOTAL BAD', len(bad), bad[:30])
