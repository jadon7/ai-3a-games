"""量走路循环按原速播时脚下对应的移速（共用的 hero_motion.py 的“原速”对四足不准：它每帧只看最低的那个脚关节，而后趾尖天生最低）。
做法：四只脚各自找“踩在地上”的帧（这只脚的网格最低点离地不到 4 毫米模型单位），量那几帧趾关节往后走得多快，四只脚平均。
用法: PY scripts/stride.py <src/run.npz> <起帧> <止帧> [游戏里的身高=3.3]"""
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import load, fk, skin_z, vert_parts, J, cut
src, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); H = float(sys.argv[4]) if len(sys.argv) > 4 else 3.3
mo = cut(load(src), a, b); Jt, _ = fk(mo); z = skin_z(mo); parts = vert_parts(); fps = mo["fps"]; out = []
for foot, toe in (("前左脚", "LeftFToe"), ("前右脚", "RightFToe"), ("后左脚", "LeftHToe"), ("后右脚", "RightHToe")):
    low = z[:, parts == foot].min(1); on = low < 0.004; y = Jt[:, J(toe), 1]; vy = np.gradient(y) * fps
    on2 = on & np.roll(on, 1) & np.roll(on, -1)                                  # 落地、离地的那一帧不算
    v = float(vy[on2].mean()); out.append(v)
    print(f"{foot}: 着地 {int(on.sum())}/{len(on)} 帧，着地时往后 {v:.3f} 模型单位/秒（{vy[on2].min():.3f} ~ {vy[on2].max():.3f}），前后摆幅 {y.max() - y.min():.3f}，这只脚最低点 {low.min():+.4f} ~ {low.max():+.4f}")
m = float(np.mean(out)); print(f"原速 {m:.3f} 模型单位/秒（前脚 {np.mean(out[:2]):.3f}，后脚 {np.mean(out[2:]):.3f}）；游戏里身高 {H} 米 → runSpeed ≈ {m * H / 0.5561:.2f} 米/秒；周期 {(b - a) / fps:.2f} 秒")
