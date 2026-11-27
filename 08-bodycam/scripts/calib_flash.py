"""枪口火光亮度标定：影片的"有火光 / 无火光"成对 EXR，对比游戏里同一帧开/关火光的线性画面。
  .venv/bin/python scripts/calib_flash.py            # 需要先在浏览器里跑出 game/_shots/calib_game.txt
"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GX, GY = 16, 9
def grid(im):
    h, w = im.shape[:2]; out = np.zeros((GY, GX, 3))
    for j in range(GY):
        for i in range(GX):
            out[j, i] = im[j * h // GY:(j + 1) * h // GY, i * w // GX:(i + 1) * w // GX].reshape(-1, 3).mean(0)
    return out
game = json.load(open(os.path.join(ROOT, "game", "_shots", "calib_game.txt")))
lum = np.array([0.2126, 0.7152, 0.0722])
for f in sorted(int(k) for k in game):
    d = os.path.join(ROOT, "renders", "final_day")
    fl = grid(post.read_exr(post.frame_path(d, f))); nf = grid(post.read_exr(post.frame_path(d, f, nf=True)))
    g = game[str(f)]; gnf = np.array(g["nf"]).reshape(GY, GX, 3)[::-1]; gfl = np.array(g["fl"]).reshape(GY, GX, 3)[::-1]      # GL 的行是自下而上
    rf = ((fl - nf) @ lum) / np.maximum(nf @ lum, 1e-4); rg = ((gfl - gnf) @ lum) / np.maximum(gnf @ lum, 1e-4)
    base = (nf @ lum) / np.maximum(gnf @ lum, 1e-4)
    ok = (rf > 0.04) & (rg > 0.04) & (nf @ lum < 3.0)
    K = rf[ok] / rg[ok]
    col_f = ((fl - nf)[ok].sum(0)); col_g = ((gfl - gnf)[ok].sum(0))
    print(f"frame {f} ({g['kind']}): cells={ok.sum()}  K median={np.median(K):.3f}  p25={np.percentile(K,25):.3f} p75={np.percentile(K,75):.3f}   film/game 底图亮度比 median={np.median(base[ok]):.2f}   火光颜色 film={np.round(col_f/col_f.max(),2)} game={np.round(col_g/col_g.max(),2)}")
    np.set_printoptions(precision=2, suppress=True, linewidth=250)
    if "-v" in sys.argv:
        print(" film ratio\n", rf); print(" game ratio\n", rg)
