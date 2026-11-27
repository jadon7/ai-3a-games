#!/usr/bin/env python3
"""奥森自己用的动作后处理：在管线解出来的 motion.npz 和共用的 tools/hero_motion.py 之间多做三件事，产出同样格式的 npz。

  1. 握杖手腕的校准。烛杖蒙在右手骨骼上，杖指向哪完全由手腕的朝向决定；手在 480p 的视频里只有十几个像素，
     而且训练集里手是张开的、视频里是握拳的，读出来的手腕朝向有固定的偏差：每段视频的第 0 帧就是站姿参考图，
     解出来的杖却比真实站姿多前倾 17° 左右。做法：拿第 0 帧解出来的右手旋转和站姿（stance.npz）里真正的右手旋转比，
     把差值当成手自己坐标系里的一个固定偏差，整段都补上。
  2. 杖的指向（aimkeys）。校准以后关键姿势里杖的方向仍然和视频差得多（比如普攻前送时视频里杖头指前，解出来指天），
     在配置里给一串“第几帧杖头指向哪”的关键帧，脚本在关键帧之间插值，把右手用最小的转动拧过去。方向是对着视频抽帧估的，不是量出来的。
  3. 变速（pieces）。技能要在出手后零点几秒就生效，而视频里蓄力很慢；把一段动作切成几块，各自给播放倍率（>1 加快，<1 放慢），
     再接起来。块和块在原视频里不相邻时（跳剪），接缝两边各几帧做平滑。marks 是“原视频的第几帧”，脚本打印它在成品里是第几秒。

用法: python art/hero/osen/compose.py art/hero/osen/compose.json [只处理的动作名 …]
配置: {"out_dir": …, "actions": {名字: {"src": motion.npz, "calib": true, "aimkeys": [[帧, [x,y,z] 或 "S"], …], "spin": [[起帧, 止帧, 起方位角, 止方位角, 上翘]], "pieces": [[a,b,倍率], …], "marks": {"release": 帧}}}}
      dir 是世界坐标：x 左为正，y 前方为负，z 向上。不写 pieces 就整段原速。
"""
import importlib.util, json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
from v2r import skeleton as sk
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from staffdir import L_REST, quat_to_mat, world_rot


def qmul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0); w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)
def qinv(a): return a * np.array([1, -1, -1, -1.0])
def qnorm(a): return a / np.linalg.norm(a, axis=-1, keepdims=True)
def qslerp(a, b, t):
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1)
    th = np.arccos(d); s = np.sin(th); t = np.asarray(t, dtype=float)
    w1 = np.where(s < 1e-5, 1 - t, np.sin((1 - t) * th) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, t, np.sin(t * th) / np.maximum(s, 1e-9))
    return qnorm(a * w1 + b * w2)
def continuous(q):
    q = q.copy()
    for f in range(1, len(q)):
        flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
    return q
def gsmooth(x, sigma, quat=False):
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(x[:1], r, 0), x, np.repeat(x[-1:], r, 0)]); out = np.zeros_like(x)
    for i, w in enumerate(k): out += w * pad[i:i + len(x)]
    return qnorm(out) if quat else out
def rot_between(a, b):
    """把单位向量 a 转到 b 的最小旋转（矩阵）"""
    v = np.cross(a, b); c = float(np.dot(a, b)); s = np.linalg.norm(v)
    if s < 1e-8: return np.eye(3)
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]) / s; ang = np.arctan2(s, c)
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * (K @ K)


LANTERN_REST = np.array([-0.902, 0.174, -0.396]); LANTERN_REST /= np.linalg.norm(LANTERN_REST)      # 静止姿势下吊炉在杖身的哪一侧（由 hand_frame 的握持坐标和 build.json 里 roll=-35 算出来）
STANCE_DIR = [-0.05, -0.09, 1.0]                               # 站姿里杖的方向（build.json 里右手的 blade），关键帧里写 "S" 就是它


def main():
    cfg = json.load(open(P(sys.argv[1]), encoding="utf-8")); only = set(sys.argv[2:]); skel = pl.load_skel("osen")
    names = [str(n) for n in skel.names]; hand = names.index("mixamorig:RightHand"); pa = int(skel.parent[hand])
    st = np.load(P(cfg["stance"]), allow_pickle=True); q_true = np.array(st["quats"][[str(n) for n in st["names"]].index("mixamorig:RightHand")], dtype=float)
    lhand = names.index("mixamorig:LeftHand"); ql_true = np.array(st["quats"][[str(n) for n in st["names"]].index("mixamorig:LeftHand")], dtype=float)
    os.makedirs(P(cfg["out_dir"]), exist_ok=True)
    for name, a in cfg["actions"].items():
        if only and name not in only: continue
        m = np.load(P(a["src"]), allow_pickle=True); q = continuous(m["quats"].astype(float)); t = m["t"].astype(float); J = m["joints"].astype(float); fps = float(m["fps"]); T = len(q); notes = []
        d0 = (world_rot(skel, q[:1])[0, hand] @ skel.R[hand].T @ L_REST)
        if a.get("calib", True):                                 # 1. 手腕校准：q' = q ⊗ c，第 0 帧正好等于站姿
            c = qmul(qinv(q[0, hand]), q_true if np.dot(q_true, q[0, hand]) >= 0 else -q_true); q[:, hand] = qnorm(qmul(q[:, hand], c[None]))
            cl = qmul(qinv(q[0, lhand]), ql_true if np.dot(ql_true, q[0, lhand]) >= 0 else -ql_true); q[:, lhand] = qnorm(qmul(q[:, lhand], cl[None]))      # 左手同样处理（左手不拿东西，只是让第 0 帧和站姿一致）
            d1 = (world_rot(skel, q[:1])[0, hand] @ skel.R[hand].T @ L_REST)
            notes.append(f"校准 {np.degrees(2 * np.arccos(min(1, abs(c[0])))):.0f}°（第 0 帧杖的仰角 {np.degrees(np.arcsin(d0[2])):.0f}° -> {np.degrees(np.arcsin(d1[2])):.0f}°）")
        keys = [[float(f_), d_] for f_, d_ in a.get("aimkeys", [])]                              # 2. 杖的指向：一串“第几帧杖头指向哪”的关键帧，中间沿大圆弧插值
        for f0_, f1_, az0, az1, phi in a.get("spin", []):                                        #    spin：杖在头顶抡圈，方位角 0 是指向左手边、90 指向身后、270 指向正前。
            ph = np.radians(phi)                                                                 #    圈所在的平面朝身体一侧抬高 phi 度（握杖的手在右肩上方，杖扫过头顶时要比手高，不然会削到头上的蜡烛）
            for f_ in np.arange(f0_, f1_ + 0.01, 2.0): az = np.radians(az0 + (az1 - az0) * (f_ - f0_) / max(f1_ - f0_, 1e-6)); keys.append([float(f_), [float(np.cos(az) * np.cos(ph)), float(np.sin(az)), float(np.cos(az) * np.sin(ph))]])
        if keys:
            keys.sort(key=lambda k_: k_[0]); KF = np.array([k_[0] for k_ in keys]); KD = np.array([STANCE_DIR if isinstance(k_[1], str) else k_[1] for k_ in keys], dtype=float); KD /= np.linalg.norm(KD, axis=1, keepdims=True)
            G = world_rot(skel, q)
            for f in range(int(np.ceil(KF[0])), min(T - 1, int(np.floor(KF[-1]))) + 1):
                j = int(np.clip(np.searchsorted(KF, f, side="right") - 1, 0, len(KF) - 2)); u = float(np.clip((f - KF[j]) / max(KF[j + 1] - KF[j], 1e-6), 0, 1)); u = u * u * (3 - 2 * u) if a.get("aim_ease", True) and not a.get("spin") else u
                a0, a1 = KD[j], KD[j + 1]; om = np.arccos(np.clip(np.dot(a0, a1), -1, 1)); D = a0 if om < 1e-5 else (np.sin((1 - u) * om) * a0 + np.sin(u * om) * a1) / np.sin(om)
                d = G[f, hand] @ skel.R[hand].T @ L_REST; base = G[f, pa] @ skel.Rrel[hand]; q[f, hand] = sk.mat_to_quat(base.T @ rot_between(d, D / np.linalg.norm(D)) @ G[f, hand])
            q = continuous(q); notes.append(f"杖的指向关键帧 {len(keys)} 个（第 {int(KF[0])} 到 {int(KF[-1])} 帧）")
        for rl in a.get("rolls", []):                            # 2b. 吊炉朝哪边：杖横过来的时候让吊炉那一侧朝下（像是垂着），趴在地上时朝上（不然吊炉陷进地里）。只绕杖身自己转，不改杖的指向
            lo, hi = rl["range"]; ease = rl.get("ease", 4); tgt = np.array(rl["to"], dtype=float); G = world_rot(skel, q)
            for f in range(max(0, lo - ease), min(T - 1, hi + ease) + 1):
                w = 1.0 if lo <= f <= hi else max(0.0, 1 - (lo - f if f < lo else f - hi) / (ease + 1)); w = w * w * (3 - 2 * w)
                d = G[f, hand] @ skel.R[hand].T @ L_REST; l = G[f, hand] @ skel.R[hand].T @ LANTERN_REST; lp = l - d * np.dot(l, d); tp = tgt - d * np.dot(tgt, d)
                if np.linalg.norm(lp) < 1e-4 or np.linalg.norm(tp) < 0.15: continue        # 杖几乎正对着目标方向时不转
                lp /= np.linalg.norm(lp); tp /= np.linalg.norm(tp); ang = np.arctan2(np.dot(np.cross(lp, tp), d), np.dot(lp, tp)) * w
                K = np.array([[0, -d[2], d[1]], [d[2], 0, -d[0]], [-d[1], d[0], 0]]); Rw = np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * (K @ K)
                base = G[f, pa] @ skel.Rrel[hand]; q[f, hand] = sk.mat_to_quat(base.T @ Rw @ G[f, hand])
            q = continuous(q); notes.append(f"吊炉朝向 第 {lo} 到 {hi} 帧")
        # 3. 变速
        pieces = a.get("pieces") or [[0, T - 1, 1.0]]; qs, ts, Js, xs, seams = [], [], [], [], []; prev_end = None
        for s_, e_, sp in pieces:
            e_ = min(e_, T - 1); n = max(2, int(round((e_ - s_) / sp)) + 1); x = np.linspace(s_, e_, n)
            if prev_end is not None and abs(prev_end - s_) < 1e-6: x = x[1:]                    # 和上一块相邻：不重复接缝那一帧
            elif prev_end is not None: seams.append(sum(len(v) for v in xs))
            xs.append(x); prev_end = e_
        # 相邻的块之间倍率突变，把“取原视频第几帧”这条曲线在每一段连续的范围内稍微抹平一点
        bounds = [0] + seams + [sum(len(v) for v in xs)]; X = np.concatenate(xs)
        for b0, b1 in zip(bounds[:-1], bounds[1:]):
            seg = X[b0:b1].copy()
            for _ in range(2):
                if len(seg) > 4: seg[1:-1] = 0.25 * seg[:-2] + 0.5 * seg[1:-1] + 0.25 * seg[2:]
            X[b0:b1] = seg
        i0 = np.floor(X).astype(int).clip(0, T - 2); f = X - i0
        Q = qslerp(q[i0], q[i0 + 1], f[:, None, None]); Tr = t[i0] * (1 - f[:, None]) + t[i0 + 1] * f[:, None]; Jn = J[i0] * (1 - f[:, None, None]) + J[i0 + 1] * f[:, None, None]
        for sm in seams:                                         # 跳剪的接缝：水平位移接上，两边各 5 帧平滑
            off = Tr[sm - 1] - Tr[sm]; off[2] = 0; Tr[sm:] += off; Jn[sm:] += off
            lo_, hi_ = max(0, sm - 5), min(len(Q), sm + 5); Q = continuous(Q); Q[lo_:hi_] = gsmooth(Q, 1.8, True)[lo_:hi_]; Tr[lo_:hi_] = gsmooth(Tr, 1.8)[lo_:hi_]; Jn[lo_:hi_] = gsmooth(Jn, 1.8)[lo_:hi_]
        Q = continuous(Q); marks = {}
        for k, fr in a.get("marks", {}).items():
            idx = np.where((X[:-1] <= fr) & (X[1:] >= fr))[0]
            if len(idx): j = idx[0]; marks[k] = round(float(j + (fr - X[j]) / max(X[j + 1] - X[j], 1e-9)) / fps, 3)
            else: marks[k] = None
        np.savez(os.path.join(P(cfg["out_dir"]), name + ".npz"), quats=Q, t=Tr, joints=Jn, fps=int(round(fps)), src_frame=X)
        print(name, json.dumps({"源": os.path.basename(os.path.dirname(P(a["src"]))), "帧数": f"{T} -> {len(Q)}（{(len(Q) - 1) / fps:.2f} 秒）", "处理": notes, "接缝": seams, "时间点(秒)": marks}, ensure_ascii=False))


if __name__ == "__main__":
    main()
