"""相邻帧差异统计：找出突然跳变的帧（闪烁、穿帮、物体突然出现）。用法：python flicker.py <帧目录>"""
import sys, glob, os
import numpy as np, cv2
d = sys.argv[1]
files = sorted(glob.glob(os.path.join(d, '*.png')) + glob.glob(os.path.join(d, '*.jpg')))
prev = None; diffs = []
for f in files:
    im = cv2.imread(f)
    sm = cv2.resize(im, (320, 180), interpolation=cv2.INTER_AREA).astype(np.float32)
    if prev is not None:
        diffs.append(float(np.mean(np.abs(sm - prev))))
    prev = sm
a = np.array(diffs)
med = np.median(a)
# 用局部中位数比较，避免把正常的快速运动当成异常
out = []
for i in range(len(a)):
    lo, hi = max(0, i - 6), min(len(a), i + 7)
    loc = np.median(a[lo:hi])
    if a[i] > loc * 1.8 + 2.0:
        out.append((i + 2, round(a[i], 1), round(float(loc), 1)))
print(os.path.basename(d), 'frames', len(files), 'median diff %.1f max %.1f' % (med, a.max()), 'spikes(frame,diff,local):', out[:15])
