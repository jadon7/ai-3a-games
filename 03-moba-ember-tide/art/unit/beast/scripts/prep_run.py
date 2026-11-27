"""走路：把读出来的 beast_run 整理成一个干净的、脚不打滑的循环。

读出来的毛病（回投偏差只有 0.8%，看不出来）：
  · 侧面机位里远侧（左边）的腿被近侧的腿挡住：左后腿往前迈的那几帧“卡住、再瞬移”；两条前腿交会的那四五帧互相串位置（迈着的脚被拉到地上停一下）。
  · 后脚踩地的时候整只脚飘着一厘米多（模型单位 0.01~0.018，游戏里 6~10 厘米）。
  · 身体平均朝一边偏了五六度。
这段视频的步子很规整：周期正好 40 帧，左右差半个周期，四只脚依次落地（左后、左前、右后、右前）。所以：
  1. 取两个周期平均，再做“左右差半个周期”的对称化：身体（根、脊柱、脖子、头、尾巴）和它自己的镜像取平均（偏的那几度、单帧的抖都没了）；
     左边两条腿直接用右边（近侧、看得清）两条腿半个周期前的动作。
  2. 四只脚的落点照步态重建：踩地的那段在地面上匀速直线往后走（游戏里就不打滑），迈步的那段走一条抬脚的弧线；
     落地、离地的时刻、步幅、抬脚高度都是从近侧脚的读数里量的（见 GAIT）。脚掌的俯仰在迈步时沿用读数。
  3. 带着“蒙皮以后的网格不许到地面以下”重解，最后整体上下挪到最低点正好贴地。
用法: PY scripts/prep_run.py [步幅放大=1.35]      产出 art/unit/beast/src/run.npz（41 帧，首尾同一帧；motions.json 里用 pick 取整段）
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import load, save, fk, resolve2, J, JN, DN, SKEL, TAIL, gauss, skin_z, mirror, rot_blend, smoothstep, part_lows, other

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P, H = 40, 20
K = float(sys.argv[1]) if len(sys.argv) > 1 else 1.35         # 步幅放大（1 = 视频里的步幅）。成品用 1.35：腿短、移速给得高，照原步幅游戏里要 2.8 倍速播，步子碎；放大到 1.35 是 2.1 倍速，脚还够得着（落点最多差 0.006）
# 步态（帧号是“视频帧号除以 40 的余数”；y 是前后位置，负的在前）。右边两只脚从读数里量的，左边 = 右边提前半个周期
GAIT = {"F": dict(down=33, stance=23, y_front=-0.412, y_back=-0.196, lift=0.036, toe="FToe", others=["FWrist"]),
        "H": dict(down=21, stance=30, y_front=-0.076, y_back=0.205, lift=0.036, toe="HToe", others=["HToeTip", "HAnkle"])}
V = np.mean([(g["y_back"] - g["y_front"]) / g["stance"] for g in GAIT.values()])      # 地面往后走的速度（模型单位/帧）；前后脚量出来差不到 1%，取平均

mo = load(f"{lib.V2R}/out/anim/beast_run/motion.npz")
# 1a. 两个周期平均（第 40~79 帧和第 80~119 帧；前 40 帧是从站姿起步，不用）
cyc = {"theta": (mo["theta"][P:2 * P] + mo["theta"][2 * P:3 * P]) / 2, "t": (mo["t"][P:2 * P] + mo["t"][2 * P:3 * P]) / 2,
       "A": np.stack([rot_blend(mo["A"][P + k], mo["A"][2 * P + k], 0.5) for k in range(P)]), "fps": mo["fps"]}
# 1b. 对称化
mir = mirror(cyc); sh = lambda X: np.roll(X, -H, axis=0)          # 镜像以后再挪半个周期
sym = {"theta": cyc["theta"].copy(), "fps": mo["fps"]}
for k in range(SKEL.D):
    side = SKEL.side[SKEL.dof_bone[k]]
    if side == 0: sym["theta"][:, k] = (cyc["theta"][:, k] + sh(mir["theta"])[:, k]) / 2
    elif side > 0: sym["theta"][:, k] = sh(mir["theta"])[:, k]      # 左腿 ← 右腿
sym["A"] = np.stack([rot_blend(cyc["A"][k], sh(mir["A"])[k], 0.5) for k in range(P)]); sym["t"] = (cyc["t"] + sh(mir["t"])) / 2
yaw = lambda A: np.degrees(np.arctan2(-A[:, 0, 1], A[:, 1, 1]))
print(f"身体朝向（偏航）: 读出来 {yaw(cyc['A']).min():+.1f}° ~ {yaw(cyc['A']).max():+.1f}°（平均 {yaw(cyc['A']).mean():+.1f}°）→ 对称化以后 {yaw(sym['A']).min():+.1f}° ~ {yaw(sym['A']).max():+.1f}°")
Js, _ = fk(sym); tgt = Js.copy(); W = np.ones((P, SKEL.K)); rest = SKEL.joint_rest
# 2. 重建四只脚
for leg, g in GAIT.items():
    span = (g["y_back"] - g["y_front"]) * K; mid = (g["y_back"] + g["y_front"]) / 2; yf, yb = mid - span / 2, mid + span / 2; v = span / g["stance"]; Tsw = P - g["stance"]
    xr = float(np.mean([Js[(g["down"] + i) % P, J("Right" + g["toe"]), 0] for i in range(g["stance"])]))      # 踩地时脚离中线多远（右脚读数的平均）
    for side, sgn, ph in (("Right", 1.0, 0), ("Left", -1.0, -H)):
        toe = J(side + g["toe"]); down = (g["down"] + ph) % P
        for k in range(P):
            i = (k - down) % P                                     # 落地以后第几帧
            if i <= g["stance"]:
                y, z, w_st = yf + v * i, 0.0, 1.0
            else:
                u = (i - g["stance"]) / Tsw; h00, h10, h01, h11 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
                y = h00 * yb + h10 * v * Tsw + h01 * yf + h11 * v * Tsw; z = g["lift"] * np.sin(np.pi * u) ** 1.6      # 离地、落地的那一刻脚和地面一样快（不刹车、不搓地）
                w_st = max(0.0, 1 - min(i - g["stance"], P - i) / 2.5)      # 刚离地、快落地的两帧：脚掌还是平的
            p_toe = np.array([sgn * xr, y, rest[toe, 2] + z]); tgt[k, toe] = p_toe; W[k, toe] = 4.0
            for o in g["others"]:
                j = J(side + o); off_rest = rest[j] - rest[toe]; off_read = Js[k, j] - Js[k, toe]
                if o == "HAnkle": w_o = w_st * float(smoothstep((g["stance"] * 0.75 - i) / (g["stance"] * 0.25))) if i <= g["stance"] else 0.0      # 后脚踩地的后四分之一，脚跟可以照读数抬起来蹬地
                else: w_o = w_st
                tgt[k, j] = p_toe + off_rest * w_o + off_read * (1 - w_o); W[k, j] = 4.0 if o != "HAnkle" else 2.0
for n in ("FElbow", "HKnee", "HHock"):                               # 腿中间的关节：读数只当参考（脚的位置变了，它们得跟着让）
    for side in ("Left", "Right"): W[:, J(side + n)] = 0.4
# 3. 重解：铺三个周期解，取中间那个，首尾才接得上
tile = lambda X: np.concatenate([X, X, X]); init = {"theta": tile(sym["theta"]), "A": tile(sym["A"]), "t": tile(sym["t"])}
out3 = resolve2(tile(tgt), mo["fps"], weight=tile(W), init=init, iters=600)
out3["theta"][:, TAIL] = gauss(out3["theta"][:, TAIL], 2.0)
g = skin_z(out3).min(1); low = gauss(g, 2.0); out3["t"][:, 2] -= low + np.minimum(g - low, 0)
out = {"theta": out3["theta"][P:2 * P + 1], "A": out3["A"][P:2 * P + 1], "t": out3["t"][P:2 * P + 1], "fps": mo["fps"]}
Jo = save(f"{HERE}/src/run.npz", out); pl = part_lows(out)
print(f"走路循环 {P} 帧（{P / mo['fps']:.2f} 秒），首尾差 {np.abs(Jo[0] - Jo[-1]).max():.4f}；地面速度 {V * K * mo['fps']:.4f} 模型单位/秒（步幅 ×{K}）；网格最低点 {g[P:2 * P].min():+.4f} ~ {g[P:2 * P].max():+.4f}（贴地前）")
for leg, gt in GAIT.items():
    for side, ph in (("Right", 0), ("Left", -H)):
        toe = J(side + gt["toe"]); down = (gt["down"] + ph) % P; st = [(down + i) % P for i in range(1, gt["stance"])]; foot = {"RightF": "前右脚", "LeftF": "前左脚", "RightH": "后右脚", "LeftH": "后左脚"}[side + leg]
        vy = np.diff(np.concatenate([Jo[:P, toe, 1], Jo[:1, toe, 1]])); err = np.abs(Jo[st, toe] - tgt[st, toe]).max()
        print(f"  {foot}: 踩地 {gt['stance']} 帧，踩地时这只脚的网格最低点 {pl[foot][st].min():+.4f} ~ {pl[foot][st].max():+.4f}，和目标落点最多差 {err:.4f}，迈步时最高抬到 {pl[foot][:P].max():.3f}")
th = np.degrees(out["theta"]); lim = [(DN[k], round(float(th[:, k].min()), 0), round(float(th[:, k].max()), 0)) for k in range(SKEL.D) if th[:, k].min() <= np.degrees(SKEL.dof_lo[k]) + 0.5 or th[:, k].max() >= np.degrees(SKEL.dof_hi[k]) - 0.5]
print("  顶到活动范围的关节:", lim or "没有")
