"""量一段动作放在一个模型上的毛病：脚滑、陷地/飘、出手时刻、副手离握点、手和武器插进身体。都用真的蒙皮网格算。

单位都换成游戏里的：模型按包围盒高度放大到 kit.height（米），一次性动作按时间表里的 speed 倍率播。
  脚滑（米/秒）：踩着地的帧（脚底最低点离地 2% 身高以内，跑步放宽到 3.5%）里，上一帧和这一帧都贴地（比这一帧脚底最低点高不到 1.2% 身高）的脚底顶点在地面上走得多快（取中位数）。
               这样量的是“肉贴着地还在滑”，脚跟到脚尖滚过去不算滑。跑步量的是“最低那一片”的中心（原地跑的脚一直在往后扫）。
  跑步：游戏让角色以移速 v 前进、跑步动作按 v / runSpeed 的倍率播。贴地顶点往后走的速度 s 就是不打滑时 runSpeed 该填的数；
        填的数和 s 差多少，脚就按 v·(1 − s/runSpeed) 滑。另外报贴地那几帧里 s 最快和最慢差多少（一步内不匀，这部分改 runSpeed 也消不掉）。
  陷地 / 飘（厘米）：踩地的帧里脚底最低点在地面以下多深 / 以上多高。身体别处（膝盖、手）穿到地下也报。
  出手时刻：时间表里的 hit / release 前后 0.35 秒内，武器尖（没有武器就是手，四足是头）速度最大的时刻。
  插进身体：手和武器的顶点落进躯干、头的“胶囊”（按静止网格量的半径打八折）里的帧占多少。
"""
import numpy as np
import rig as R
from retarget import positions, skin_mats, skin, from_motion, foot_verts, clean_flag, segments, contact_motion


def capsules(rig, bone_names):
    """躯干、头的胶囊：骨骼头到尾的线段，半径取它管的顶点到线段距离的 70 分位"""
    dom = rig.dominant(); out = []
    for n in bone_names:
        b = rig.find(n)
        if b is None: continue
        v = rig.verts[(dom == b) & ~rig.weapon]
        if len(v) < 20: continue
        a, c = rig.head[b], rig.tail[b]; ab = c - a; t = np.clip(((v - a) @ ab) / (ab @ ab), 0, 1); d = np.linalg.norm(v - (a + t[:, None] * ab), axis=1)
        out.append((b, float(np.percentile(d, 70))))
    return out


def seg_dist(p, a, c):
    ab = c - a; t = np.clip(np.sum((p - a) * ab, -1) / np.maximum(np.sum(ab * ab, -1), 1e-12), 0, 1); return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1)


def measure(rig, quats, loc, fps, root, legs, game_h, speed=1.0, run=None, events=None, tip=None, body_caps=None, follow=None):
    """legs: [(名字, 末端骨骼下标)]；run: {"runSpeed": 现在填的, "v": 移速}；events: [(名字, 时间)]；tip: 量出手用的点（('weapon', 手骨下标) 或 ('bone', 下标)）；
    follow: (副手骨骼, 主手骨骼) 量两手的距离"""
    D, Pr = from_motion(rig, quats, loc, root); Pp = positions(rig, D, Pr); S = skin_mats(rig, D, Pp); T = len(D); H = rig.height; g = rig.ground; m2g = game_h / H; out = {"帧数": T}
    thr = 0.012 * H
    for nm, e in legs:
        fv = foot_verts(rig, e); V = skin(rig, S, fv); z = V[..., 2].min(1) - g
        flag = clean_flag(z < (0.035 if run else 0.02) * H, min_len=2 if run else 3); on_frames = np.nonzero(flag)[0]
        loop_ = run is not None and np.allclose(quats[0], quats[-1], atol=1e-4)
        u = contact_motion(V, flag, thr, loop_, centroid=run is not None); sel = flag & (np.roll(flag, 1) if loop_ else np.concatenate([[False], flag[:-1]]))
        vel = u[sel] * fps * m2g
        r = {"踩地帧": int(flag.sum())}
        if run and len(vel):
            s = float(np.median(vel[:, 1]))                                          # 面朝 -Y，往后是 +Y
            rate = run["v"] / run["runSpeed"]; world = run["v"] - vel[:, 1] * rate      # 落地脚在世界里往前溜的速度
            r.update({"贴地往后速度": round(s, 2), "该填runSpeed": round(s, 2), "现填runSpeed时脚滑": round(float(np.median(np.abs(world))), 2),
                      "按该填的数播时脚滑": round(float(np.median(np.abs(run["v"] - vel[:, 1] * run["v"] / s))), 2) if s > 0.3 else None,
                      "一步内不匀": round(float(vel[:, 1].max() - vel[:, 1].min()), 2), "横向": round(float(np.median(np.abs(vel[:, 0]))), 2)})
        elif len(vel):
            sp = np.linalg.norm(vel, axis=1) * speed
            r.update({"脚滑": round(float(np.median(sp)), 3), "脚滑p90": round(float(np.percentile(sp, 90)), 3)})
        else: r["脚滑"] = None
        if len(on_frames):
            r["陷地cm"] = round(float(-min(0.0, z[flag].min())) * m2g * 100, 1); r["飘cm"] = round(float(np.median(np.maximum(z[flag], 0))) * m2g * 100, 1)
        out["脚:" + nm] = r
    # 身体别处穿到地下（膝盖、手、武器）：去掉两只脚
    feet = set();
    for nm, e in legs: feet |= set(rig.subtree(e))
    dom = rig.dominant(); others = np.array([i for i in range(len(dom)) if dom[i] not in feet and not rig.weapon[i]])[::7]
    Vo = skin(rig, S, others); out["身体最低cm"] = round(float(Vo[..., 2].min() - g) * m2g * 100, 1)
    if rig.weapon.any(): Vw = skin(rig, S, np.nonzero(rig.weapon)[0][::5]); out["武器最低cm"] = round(float(Vw[..., 2].min() - g) * m2g * 100, 1)
    # 出手时刻
    if events and tip:
        if tip[0] == "weapon":
            hb = tip[1]; wv = np.nonzero(rig.weapon & np.isin(rig.widx[:, 0], rig.subtree(hb)))[0]
            if len(wv):
                far = wv[np.argmax(np.linalg.norm(rig.verts[wv] - rig.head[hb], axis=1))]; P = skin(rig, S, np.array([far]))[:, 0]
            else: P = Pp[:, hb]
        else: P = Pp[:, tip[1]]
        v = np.linalg.norm(np.gradient(P, axis=0), axis=1) * fps * m2g
        t = np.arange(T) / fps; ev = {}
        for en, et in events:
            w = (t > et - 0.35) & (t < et + 0.35)
            if w.sum() < 2: continue
            i = np.nonzero(w)[0][np.argmax(v[w])]; f = min(int(round(et * fps)), T - 1)
            hand = Pp[f, tip[1]] if tip[0] == "weapon" else P[f]
            ev[en] = {"表上": et, "最快": round(float(t[i]), 3), "最快速度": round(float(v[i]), 1), "尖伸出": round(float(np.linalg.norm(P[f, :2] - Pp[f, root, :2])) / H, 3),
                      "手伸出": round(float(np.linalg.norm(hand[:2] - Pp[f, root, :2])) / H, 3), "尖高": round(float(P[f, 2] - g) / H, 3)}
        out["出手"] = ev; out["_v"] = [round(float(x), 3) for x in v]                  # 武器尖的速度曲线，run_case.py 拿它和源的比时刻差
    if follow:
        a, b = follow; dd = np.linalg.norm(Pp[:, a] - Pp[:, b], axis=1) / H; out["两手距离(身高%)"] = [round(float(np.percentile(dd, p)) * 100, 1) for p in (10, 50, 90)]
    if body_caps:
        hand_v = np.nonzero(np.isin(dom, [x for b in body_caps["hands"] for x in rig.subtree(b)]) & ~(rig.weapon if body_caps.get("no_weapon") else np.zeros(len(dom), bool)))[0][::3]
        Vh = skin(rig, S, hand_v); hits = np.zeros(T, int)
        for b, rad in body_caps["caps"]:
            ch = [c for c in rig.children[b]]; tail = Pp[:, ch[0]] if ch else Pp[:, b] + np.einsum("tij,j->ti", D[:, b], rig.tail[b] - rig.head[b])
            d = seg_dist(Vh, Pp[:, b, None], tail[:, None]); hits += (d < rad * 0.8).sum(1)
        out["手和武器插进身体的帧%"] = round(float((hits > 15).mean()) * 100, 1); out["插进去最多的顶点数"] = int(hits.max())
    return out


def events_of(timing, clip):
    """时间表（public/assets/hero/<id>.json）里这段动作的出手时刻和播放倍率"""
    evs, sp, hands = [], 1.0, None
    def walk(o, key=""):
        nonlocal sp, hands
        if isinstance(o, dict):
            if o.get("clip") == clip:
                sp = o.get("speed", sp); hands = o.get("hands", hands)
                for k_ in ("hit", "release", "start", "land", "second"):
                    if k_ in o: evs.append((f"{key}.{k_}", float(o[k_])))
            for k_, v_ in o.items():
                if k_ != "clip": walk(v_, k_)
        elif isinstance(o, list):
            for i, v_ in enumerate(o): walk(v_, f"{key}{i}")
    walk(timing); return evs, sp, hands
