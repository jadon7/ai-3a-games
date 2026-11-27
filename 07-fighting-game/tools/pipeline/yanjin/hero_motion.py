#!/usr/bin/env python3
"""把动作管线（video2rig）从视频里读出来的运动，整理成游戏能直接用的动作。

管线给的是“一段 5 秒的视频里角色怎么动”，游戏要的是：
  · 循环动作（待机、跑步）首尾接得上：在整段里找一对最像的时刻当起点和终点，再把剩下的一点差别摊到整段里。
  · 原地动作：角色在游戏里往哪走由游戏说了算，所以把视频里的水平位移去掉（循环动作保留左右晃动，只去掉漂移）。
  · 一次性动作（普攻、技能、死亡）：截出要的那一段，起点对回原点；需要时让结尾回到原点，接待机时不跳。
  · 统一成每秒 30 帧，可以整体加速或放慢。

用法: python tools/hero_motion.py art/hero/lan/motions.json [只处理的动作名 ...]
产出: <out_dir>/<动作名>.npz（names 骨骼名、quats 每帧每根骨骼的旋转、loc 胯的位移、fps），给 tools/blender/hero_build.py 的 game 一步读
（四足等非人形角色是 tools/blender/creature_build.py 读，格式一样）。
"""
import json, os, sys
import numpy as np

ROOT = "/Users/jadon7/Documents/SynologyDrive/code/fighting-game"      # 阎烬用的拷贝
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)


def qmul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0); w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2, w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)
def qinv(a): return a * np.array([1, -1, -1, -1.0])
def qnorm(a): return a / np.linalg.norm(a, axis=-1, keepdims=True)
def qslerp(a, b, t):
    """a、b (...,4)，t 标量或 (...,1)。走短的那一边。"""
    d = np.sum(a * b, -1, keepdims=True); b = np.where(d < 0, -b, b); d = np.abs(d).clip(0, 1)
    th = np.arccos(d); s = np.sin(th); t = np.asarray(t, dtype=float)
    w1 = np.where(s < 1e-5, 1 - t, np.sin((1 - t) * th) / np.maximum(s, 1e-9)); w2 = np.where(s < 1e-5, t, np.sin(t * th) / np.maximum(s, 1e-9))
    return qnorm(a * w1 + b * w2)
def continuous(q):
    """相邻两帧的四元数取同号，插值和平滑才不会绕远路"""
    q = q.copy()
    for f in range(1, len(q)):
        flip = np.sum(q[f] * q[f - 1], -1) < 0; q[f][flip] *= -1
    return q
def smooth(q, sigma):
    """沿时间做高斯平滑（四元数直接加权平均再归一化，角度变化不大时够用）"""
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.concatenate([np.repeat(q[:1], r, 0), q, np.repeat(q[-1:], r, 0)]); out = np.zeros_like(q)
    for i, w in enumerate(k): out += w * pad[i:i + len(q)]
    return qnorm(out)


def find_loop(J, lo, hi, start=0, end=None, w_vel=4.0):
    """J (T,K,3) 关节位置（已经减掉胯的水平位置）。找 (a,b)：b-a 在 [lo,hi] 之间，两个时刻的姿势和速度最像。"""
    T = len(J); end = T - 2 if end is None else min(end, T - 2)
    V = np.zeros_like(J); V[1:-1] = (J[2:] - J[:-2]) / 2
    F = np.concatenate([J.reshape(T, -1), V.reshape(T, -1) * w_vel], 1); best = (1e9, 0, 0)
    for a in range(max(start, 1), end - lo + 1):
        for b in range(a + lo, min(a + hi, end) + 1):
            d = float(np.linalg.norm(F[a] - F[b])) / np.sqrt(J.shape[1])
            if d < best[0]: best = (d, a, b)
    return best


def close_loop(q, t):
    """让最后一帧等于第一帧：把首尾的差别按时间均匀摊到整段里"""
    N = len(q) - 1; w = (np.arange(N + 1) / N)[:, None, None]
    d = qmul(qinv(q[-1]), q[0])                                  # 最后一帧再转 d 就是第一帧
    ident = np.zeros_like(d); ident[..., 0] = 1
    q2 = qnorm(qmul(q, qslerp(np.broadcast_to(ident, q.shape), np.broadcast_to(d, q.shape), w)))
    t2 = t + (t[0] - t[-1])[None] * w[:, 0]
    return q2, t2


def resample(q, t, src_fps, dst_fps, speed=1.0):
    dur = (len(q) - 1) / src_fps / speed; n = max(2, int(round(dur * dst_fps)) + 1)
    x = np.linspace(0, len(q) - 1, n); i0 = np.floor(x).astype(int).clip(0, len(q) - 2); f = (x - i0)
    return qslerp(q[i0], q[i0 + 1], f[:, None, None]), t[i0] * (1 - f[:, None]) + t[i0 + 1] * f[:, None]


def main():
    cfg = json.load(open(P(sys.argv[1]), encoding="utf-8")); only = set(sys.argv[2:])
    sk = json.load(open(P(cfg["skeleton"]), encoding="utf-8")); bones = sk["bones"]; names = [b["name"] for b in bones]
    root = next(i for i, b in enumerate(bones) if b.get("role") == "root")
    M = np.array(bones[root]["matrix"], dtype=float)[:3, :3]; scale = float(np.linalg.norm(M[:, 0])); Rroot = M / scale
    # 两足（Mixamo 命名）：胯是 Hips，脚是名字里带 Foot / Toe 的。四足等别的骨架：骨架文件的 profile 里写着根关节和踩地的关节
    prof = sk.get("profile") or {}; jn = [j["name"] for j in sk["joints"]]; hips_j = jn.index(prof.get("root_joint", "Hips"))
    feet = [jn.index(n) for n in prof["ground_joints"]] if prof.get("ground_joints") else [k for k, n in enumerate(jn) if "Foot" in n or "Toe" in n]
    ankles = feet if prof.get("ground_joints") else [jn.index("LeftFoot"), jn.index("RightFoot")]
    os.makedirs(P(cfg["out_dir"]), exist_ok=True); dst_fps = cfg.get("fps", 30); report = {}
    for name, a in cfg["actions"].items():
        if only and name not in only: continue
        if not os.path.exists(P(a["src"])): print(f"{name}: 还没有 {a['src']}，跳过"); continue
        m = np.load(P(a["src"]), allow_pickle=True); q = continuous(m["quats"].astype(float)); t = m["t"].astype(float); J = m["joints"].astype(float); fps = float(m["fps"])
        T = len(q); info = {"源": f"{T} 帧 @ {fps:.0f}"}
        if "loop" in a:                                          # 循环动作
            lo, hi = a["loop"]; Jr = J - J[:, hips_j:hips_j + 1] * np.array([1, 1, 0.0])
            d, s, e = find_loop(Jr, lo, hi, a.get("from", 0), a.get("to")) if "pick" not in a else (0.0, *a["pick"])
            gap = float(np.sqrt(((Jr[s] - Jr[e]) ** 2).sum(-1).mean()))
            info["循环"] = f"第 {s} 到 {e} 帧（{(e - s) / fps:.2f} 秒），首尾各关节平均相差 {gap * 100:.1f}% 身高"
            q, t = close_loop(q[s:e + 1], t[s:e + 1]); J = J[s:e + 1]
            if a.get("stride"):                                  # 原地跑：踩在地上的那只脚往后蹬得多快，就是这个动作按原速播时对应的移速
                ank = ankles; yr = J[:, ank, 1] - J[:, hips_j:hips_j + 1, 1]; zr = J[:, ank, 2]
                vy = np.gradient(yr, axis=0) * fps; low = zr.argmin(1); on = zr.min(1) < np.percentile(zr.min(1), 60)
                sp = float(np.mean([vy[i, low[i]] for i in range(len(J)) if on[i]])); info["原速"] = round(sp, 3)
            t[:, :2] -= t[:, :2].mean(0) if a.get("inplace", "sway") == "sway" else t[:, :2]      # 留左右晃动、去掉偏移；pin 则完全钉住
        else:                                                    # 一次性动作
            # range 是一段；segments 是几段接起来（比如去掉中间摆着不动的那一截），接缝两边各几帧做平滑
            segs = a.get("segments") or [a.get("range", [0, T - 1])]; segs = [[s_, min(e_, T - 1)] for s_, e_ in segs]
            idx = np.concatenate([np.arange(s_, e_ + 1) for s_, e_ in segs]); q, t, J = q[idx], t[idx].copy(), J[idx]
            info["截取"] = "、".join(f"第 {s_} 到 {e_} 帧" for s_, e_ in segs) + f"（共 {(len(idx) - 1) / fps:.2f} 秒）"
            seam = 0
            for s_, e_ in segs[:-1]:
                seam += e_ - s_ + 1; lo_, hi_ = max(0, seam - 5), min(len(q), seam + 5); t[seam:] += t[seam - 1] - t[seam]      # 位移在接缝处接上
                q[lo_:hi_] = smooth(continuous(q), 1.6)[lo_:hi_]; q = continuous(q)
            t[:, :2] -= t[0, :2]                                 # 从原点开始
            if a.get("settle", True):                            # 结尾回到原点：把最后的偏移摊到后半段
                N = len(t) - 1; w = np.clip((np.arange(N + 1) / N - 0.5) * 2, 0, 1)[:, None]; t[:, :2] -= t[-1:, :2] * w
            if a.get("pin"): t[:, :2] = 0
        for pat, sig in a.get("smooth", cfg.get("smooth", {})).items():      # 给容易抖的骨骼（手腕）单独平滑
            for i, n in enumerate(names):
                if pat in n: q[:, i] = smooth(q[:, i], sig)
        q, t = resample(q, t, fps, dst_fps, a.get("speed", 1.0))
        if "loop" in a: q[-1], t[-1] = q[0], t[0]
        info["成品"] = f"{len(q)} 帧 @ {dst_fps}（{(len(q) - 1) / dst_fps:.2f} 秒）"; info["脚最低"] = f"{J[:, feet, 2].min():.3f}"
        info["水平位移范围"] = f"{np.abs(t[:, :2]).max():.3f}"
        np.savez(os.path.join(P(cfg["out_dir"]), name + ".npz"), names=np.array(names), quats=q, loc=(t @ Rroot) / scale, fps=dst_fps)      # 胯的位移换到骨骼自己的坐标系
        report[name] = info; print(name, json.dumps(info, ensure_ascii=False))
    json.dump(report, open(os.path.join(P(cfg["out_dir"]), "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
