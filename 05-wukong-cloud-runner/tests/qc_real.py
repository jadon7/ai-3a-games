"""写实版质检：每个镜头出一张拼图（均匀取 6 帧），并检查帧完整性和亮度突变。
用法：python qc_real.py [A B F E C D] [--kind=comp|elem|bg]
"""
import sys, os
import numpy as np
import cv2
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'post_real'))
import comp

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    kind = opts.get('kind', 'comp')
    for sh in (args or comp.ORDER):
        n = comp.SHOT[sh]['n']
        lum, miss = [], []
        for f in range(1, n + 1):
            p = os.path.join(comp.RR, sh, '%s_%04d.png' % (kind, f))
            if not os.path.exists(p) or os.path.getsize(p) < 5000:
                miss.append(f); lum.append(np.nan); continue
            im = cv2.imread(p, cv2.IMREAD_REDUCED_COLOR_4)
            lum.append(float(im.mean()) if im is not None else np.nan)
        lum = np.array(lum)
        d = np.abs(np.diff(lum))
        med = np.nanmedian(d) if len(d) else 0
        spikes = [int(i) + 2 for i in np.where(d > max(1.5, med * 6))[0]]
        print('QC %s %s frames=%d missing=%s lum %.1f..%.1f  median step %.2f  spikes at %s' % (
            sh, kind, n, miss[:8], np.nanmin(lum), np.nanmax(lum), med, spikes[:10]))
        picks = [int(round(x)) for x in np.linspace(1, n, 6)]
        tiles = []
        for f in picks:
            p = os.path.join(comp.RR, sh, '%s_%04d.png' % (kind, f))
            im = cv2.imread(p, cv2.IMREAD_UNCHANGED) if os.path.exists(p) else None
            if im is None:
                im = np.zeros((402, 960, 3), np.uint8)
            if im.dtype == np.uint16:
                im = (im / 257).astype(np.uint8)
            if im.shape[2] == 4:
                a = im[..., 3:4].astype(np.float32) / 255
                bgc = np.full_like(im[..., :3], 70); bgc[..., 0] = 100
                im = (im[..., :3] * a + bgc * (1 - a)).astype(np.uint8)
            im = cv2.resize(im, (960, 402), interpolation=cv2.INTER_AREA)
            cv2.putText(im, '%s %d' % (sh, f), (14, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            tiles.append(im)
        sheet = np.vstack([np.hstack(tiles[0:2]), np.hstack(tiles[2:4]), np.hstack(tiles[4:6])])
        dst = os.path.join(HERE, 'qc_%s_%s.jpg' % (sh, kind))
        cv2.imwrite(dst, sheet, [cv2.IMWRITE_JPEG_QUALITY, 86])
