#!/usr/bin/env python3
"""给一个角色做整套通用动作（受击、击飞倒地、起身、被击败……），写“只有骨架 + 动画”的 GLB 和时间表。

  python tools/generic/build_generic.py art/generic/<id>/config.json [--only hit_high,knockdown] [--sheet]

config.json（路径相对 FG 根目录）:
  id          角色 id
  rig         角色成品 GLB（骨骼名、层级、静止姿势以它为准；架势取它的 idle 第 0 帧）
  frame_ref   和 Tripo 预设同一坐标系的、Mixamo 命名的 Tripo 绑骨结果（v3 绑骨 GLB），用来求 Tripo 坐标 -> 成品坐标的变换
  sources     {"简称": "Tripo 预设动画 GLB"}，v1 / v3 都行（同一网格，骨骼按名字对应）
  out         输出 GLB；时间表写在同名 .json
  tune        可选，覆盖下面 RECIPES 里的参数：{"hit_high": {"gain": 0.6}}
每段动作的做法见 RECIPES 和各 make_* 函数；手摆的关键姿势（躺、坐起、跪、空中）在 poses.py。

给一个新角色跑一遍（<id> 换成角色名；Python 用 V2R/.venv/bin/python）：
  1. v1 绑骨（25 额度）：tools/generic/tripo_presets.py rig <图转模型 task_id> --tag <id>_v1rig --out art/generic/<id>/v1_rigged.glb
  2. 要预设（每个 10 额度，加 --no-geometry 文件小、不会下载截断）：
     tripo_presets.py anim <v1 绑骨 task_id> preset:biped:hit_to_head preset:biped:hit_to_body_01 preset:biped:hit_to_body_02 preset:biped:hit_to_side preset:biped:hit_to_stomach --no-geometry --tag <id>_v1a --out art/generic/<id>/v1_a.glb
     tripo_presets.py anim <v1 绑骨 task_id> preset:biped:defeat_03 preset:biped:dive --no-geometry --tag <id>_v1b --out art/generic/<id>/v1_b.glb
     tripo_presets.py anim <v1 绑骨 task_id> preset:biped:walk --no-geometry --tag <id>_v1e --out art/generic/<id>/v1_e.glb
  3. 写 art/generic/<id>/config.json（照 yanjin 的抄），然后 build_generic.py art/generic/<id>/config.json --no-merge
  4. 检查：check_match.py <成品.glb> <generic.glb>；render_set.sh 渲联系表（见脚本头），用眼睛看
角色成品里换了 idle（架势）以后，直接重跑第 3 步即可（不用再花额度）。
"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); FG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from glbio import GLB, write_skeleton_glb, qslerp, qmat, mat_q, qmul, qinv  # noqa: E402
from motion import *  # noqa: E402,F401
from poses import GETUP_KEYS, GETUP_TIMES, AIR_BASE  # noqa: E402

P_ = lambda p: p if os.path.isabs(p) else os.path.join(FG, p)

# 每段动作的配方。src 是 sources 里的简称；t0/t1 截取的秒数（原动捕时间）；speed 播放倍速；gain 差量的幅度；
# fade_out 结尾多少帧回到架势；mode world/local 差量叠加方式
RECIPES = {
    "hit_high":  {"src": "v1a", "clip": "hit_to_head",    "t0": 0.12, "t1": 1.0,  "speed": 1.6, "gain": 0.65, "fade_out": 6, "mode": "world"},
    "hit_high2": {"src": "v1a", "clip": "hit_to_body_01", "t0": 0.12, "t1": 1.15, "speed": 1.8, "gain": 0.8,  "fade_out": 6, "mode": "world"},
    "hit_mid":   {"src": "v1a", "clip": "hit_to_body_02", "t0": 0.18, "t1": 1.6,  "speed": 1.8, "gain": 0.85, "fade_out": 6, "mode": "world"},
    "hit_mid2":  {"src": "v1a", "clip": "hit_to_stomach", "t0": 0.12, "t1": 1.45, "speed": 1.7, "gain": 1.0,  "fade_out": 6, "mode": "world"},
    "hit_side":  {"src": "v1a", "clip": "hit_to_side",    "t0": 0.15, "t1": 1.2,  "speed": 1.5, "gain": 1.0,  "fade_out": 6, "mode": "world"},
    "hit_heavy": {"src": "v1a", "clip": "hit_to_head",    "t0": 0.12, "t1": 1.7, "speed": 1.45, "gain": 1.0,  "fade_out": 8, "mode": "world",
                  "walk": {"src": "v1e", "clip": "walk", "t0": 1.45, "t1": 0.22, "speed": -1.75, "start": 2, "fade": 6}},
    "hit_air":   {"src": "v1a", "clip": "hit_to_head",    "t0": 0.12, "t1": 1.0,  "speed": 1.5, "gain": 0.8,  "fade_out": 6},
    "ko":        {"src": "v1b", "clip": "defeat_03",      "t0": 1.2,  "t1": 4.6,  "speed": 1.15, "fade_in": 9},
    "knockdown": {"hit_src": "v1a", "hit_clip": "hit_to_head", "hit_t": 0.32, "arc": 0.32, "travel": -1.1},
}


class Builder:
    def __init__(self, cfg):
        self.cfg = cfg
        G0 = GLB(P_(cfg["rig"]))
        mats = [m.get("name", "") for m in G0.g.get("materials", [])]
        prims = [p for nd in G0.nodes if "mesh" in nd and "skin" in nd for p in G0.g["meshes"][nd["mesh"]]["primitives"] if "JOINTS_0" in p["attributes"]]
        body = [k for k, p in enumerate(prims) if not (mats and mats[p.get("material", 0)].startswith("weapon"))]
        self.rig = Rig(P_(cfg["rig"]), ground_prims=body)
        ref = GLB(P_(cfg["frame_ref"]))
        names = [n for n in self.rig.G.name if n.startswith(MX) and n in ref.idx and not any(k in n for k in ("Hand", "End", "Toe"))]
        self.A, s, res = similarity(ref, self.rig.G, names)
        print(f"FRAME tripo->rig scale {s:.4f} resid mean {res.mean():.4f} max {res.max():.4f}")
        self.src = {k: GLB(P_(v)) for k, v in cfg["sources"].items()}
        st = cfg.get("stance_clip") or ("idle" if "idle" in self.rig.G.anims else "idle_pose")
        self.stance = self.rig.from_clip(st, [0.0]); self.stance_name = st
        self.stance, _, _ = ground(self.rig, self.stance, smooth=0)
        self.wpn = load_weapon(P_(cfg["rig"]))
        if self.wpn:
            self.sd_dense = self.rig.G.skin_data(max_verts=12000, prims=body)
            print("WEAPON", self.wpn["bone"], "刀长", round(float(np.linalg.norm(np.subtract(self.wpn["tip"], self.wpn["base"]))), 3))
        self.recipes = json.loads(json.dumps(RECIPES))
        for k, v in cfg.get("tune", {}).items(): self.recipes.setdefault(k, {}).update(v)
        self.mapped_cache = {}

    def take(self, sk, clip, t0=0.0, t1=None, speed=1.0):
        P, mapped = retarget(self.src[sk], clip, self.rig, self.A, t0, t1, speed)
        self.mapped = mapped
        return P

    # ------------------------------------------------------------ 受击（差量叠在架势上）
    def make_hit(self, r, inplace=False):
        M = self.take(r["src"], r["clip"], r["t0"], r["t1"], r["speed"])
        trav = travel(self.rig, M)
        P = additive(self.rig, self.stance, M, self.mapped, r.get("mode", "world"), r.get("gain", 1.0))
        P = fade_ends(P, self.stance, 0, r.get("fade_out", 0))
        if inplace: P = remove_horizontal(self.rig, P)
        if r.get("lock_feet", True): P = lock_feet(self.rig, P, self.stance)      # 站着受击：两只脚钉在架势的位置上（不滑）
        P, off, mn = ground(self.rig, P)
        T = len(P); dur = (T - 1) / FPS
        info = {"dur": round(dur, 3), "impact": 0.0, "recover": round(max(dur - r.get("fade_out", 0) / FPS * 0.5, 0), 3),
                "travel": round(float(trav[-1, 1] if abs(trav[-1, 1]) > abs(trav[-1, 0]) else trav[-1, 0]), 3)}
        return P, info

    # ------------------------------------------------------------ 重击踉跄：上身 = hit_to_head 差量，腿 = 倒放的 walk（向后退两步）差量
    def make_heavy(self, r):
        rig = self.rig; S = self.stance; w = r["walk"]
        if w["src"] not in self.src: return self.make_hit(r, inplace=True)
        Mh = self.take(r["src"], r["clip"], r["t0"], r["t1"], r["speed"])
        Ph = additive(rig, S, Mh, self.mapped, "world", r.get("gain", 1.0))
        Ph = fade_ends(Ph, S, 0, r.get("fade_out", 0)); T = len(Ph)
        Mw = self.take(w["src"], w["clip"], w["t0"], w["t1"], w["speed"])      # 倒放的 walk，绝对姿势（自然的步幅）
        a = w.get("start", 0); Tw = len(Mw); f = w.get("fade", 0)
        Mw = concat(hold(Mw, a), Mw, hold(Mw.slice(Tw - 1, Tw), max(T - a - Tw, 0))).slice(0, T)
        legs = [i for i, nm in enumerate(rig.G.name) if any(x in nm for x in ("UpLeg", "Leg", "Foot", "Toe"))]
        Wh = rig.worlds(Ph); Ww = rig.worlds(Mw); Ws = rig.worlds(S)[0]
        k = np.ones(T); fi = w.get("fade_in", 4)
        k[:a + fi] = smoothstep((np.arange(a + fi) - a) / fi) if fi else (np.arange(a + fi) >= a)
        if f: k[T - f:] = np.minimum(k[T - f:], smoothstep(1 - np.arange(1, f + 1) / f))
        Rt = Wh[:, :, :3, :3].copy()
        for i in legs:                                                         # 腿：架势 ↔ walk 的世界朝向按 k 混合，不跟着上身的后仰转
            qa = mat_q(np.repeat(Ws[None, i, :3, :3], T, 0)); qb = mat_q(Ww[:, i, :3, :3])
            Rt[:, i] = qmat(qslerp(qa, qb, k))
        hp = Wh[:, rig.hips, :3, 3].copy()
        dh = Ww[:, rig.hips, :3, 3][:, [0, 2]] - Ww[0, rig.hips, :3, 3][[0, 2]]
        hp[:, [0, 2]] += dh                                                    # 胯的水平移动跟着 walk（退两步的距离）
        P = rig.pose_from_world_rot(Rt, hp, list(rig.bones), base_q=Ph.q)
        trav = travel(rig, P)
        P = remove_horizontal(rig, P)
        P, off, mn = ground(rig, P)
        dur = (T - 1) / FPS
        return P, {"dur": round(dur, 3), "impact": 0.0, "recover": round(dur - f / FPS * 0.5, 3), "travel": round(float(trav[-1, 1]), 3)}

    # ------------------------------------------------------------ 绝对姿势（被击败）
    def make_abs(self, r):
        M = self.take(r["src"], r["clip"], r["t0"], r["t1"], r["speed"])
        trav = travel(self.rig, M)
        P = fade_ends(M, self.stance, r.get("fade_in", 0), 0)
        P = remove_horizontal(self.rig, P)
        if self.wpn:                                                                             # 倒地以后刀平放，不竖着戳在地上
            hy = self.rig.worlds(P)[:, self.rig.hips, 1, 3]
            P = flatten_blade(self.rig, P, self.wpn, smoothstep((hy[0] * 0.75 - hy) / (hy[0] * 0.45)))
        P, off, mn = ground(self.rig, P)
        T = len(P); dur = (T - 1) / FPS
        W = self.rig.worlds(P); hy = W[:, self.rig.hips, 1, 3]
        g = int(np.argmax(hy < hy[0] * 0.35)) if (hy < hy[0] * 0.35).any() else T - 1
        d = float(np.hypot(*trav[-1]))
        return P, {"dur": round(dur, 3), "ground": round(g / FPS, 3), "travel": round(d * np.sign(trav[-1, 1] or 1), 3)}

    # ------------------------------------------------------------ 击飞倒地（关键姿势 + 抛物线，躺姿来自动捕）
    def lie_pose(self, r):
        """仰面躺平：从角色自己的静止姿势出发手摆（站着的坐标里摆好四肢，再整个人向后放倒 90 度），按网格最低点贴地。
        站着的坐标：+X 角色左手边，+Y 上，+Z 正前方；四肢的 z 分量放倒后变成离地高度。"""
        rig = self.rig; L = rig.rest_pose(1); lp = r.get("lie", {})
        for side, sx in (("Left", 1), ("Right", -1)):
            L = aim_bone(rig, L, side, "Shoulder", np.r_[sx, 0.05, -0.05], 0.3)
            ax, ay = lp.get("arm", (0.62, -0.78)); L = aim_bone(rig, L, side, "Arm", (sx * ax, ay, -0.05))
            fx, fy, fz = lp.get("forearm_" + side, (0.30, -0.9, 0.22)); L = aim_bone(rig, L, side, "ForeArm", (sx * fx, fy, fz))
        L = aim_bone(rig, L, "Left", "UpLeg", lp.get("thigh_Left", (0.16, -1, 0.05)))
        L = aim_bone(rig, L, "Left", "Leg", lp.get("shin_Left", (0.2, -1, -0.02)))
        L = aim_bone(rig, L, "Right", "UpLeg", lp.get("thigh_Right", (-0.12, -1, 0.42)))
        L = aim_bone(rig, L, "Right", "Leg", lp.get("shin_Right", (-0.16, -1, -0.32)))
        for side in ("Left", "Right"):
            L = rotate_bone(rig, L, side + "Foot", (0, 1, 0), 18 if side == "Left" else -18)      # 脚尖自然外撇
        L = rotate_bone(rig, L, "Head", (0, 1, 0), lp.get("head_turn", 28))
        L = rotate_bone(rig, L, "Neck", (1, 0, 0), lp.get("chin", 8))                            # 下巴稍微收一点（放倒后头不会仰着）
        if self.wpn:                                                                             # 刀顺着手臂往外下方放，放倒后平贴地面、稍微翘起
            L = aim_blade(rig, L, self.wpn, lp.get("blade", (-0.55, -0.75, 0.12)))
        L = rotate_whole(rig, L, (1, 0, 0), -90)                                                 # 向后放倒：头朝身后（-Z），胸口朝上
        L, _, _ = ground(rig, L, smooth=0)
        return L

    def make_knockdown(self, r):
        rig = self.rig; S = self.stance
        L = self.lie_pose(r)
        H = additive(rig, S, self.take(r["hit_src"], r["hit_clip"], r["hit_t"], r["hit_t"] + 0.001), self.mapped, "world", 1.0).slice(0, 1)
        # 空中姿势：手摆的后仰、四肢甩开（poses.AIR_BASE），落地弹一下时比躺姿多收一点腿
        Air = self.air_pose()
        Bn = blend(Air, L, np.array([0.8]))
        P = concat(keyframes(rig, [(0, S), (4, H), (13, Air), (22, L)], smooth=1.5, ease=0.0),
                   keyframes(rig, [(0, L), (5, Bn), (14, L)], smooth=1.5, ease=0.0).slice(1, None))
        T = len(P)
        P = remove_horizontal(rig, P)
        # 高度：每帧先贴地，再在空中段加抛物线
        arc = np.zeros(T); a0, a1 = 3, 22
        x = (np.arange(T) - a0) / (a1 - a0); m = (x > 0) & (x < 1); arc[m] = 4 * r["arc"] * x[m] * (1 - x[m])
        bounce = np.zeros(T); b0, b1 = 22, 29; xb = (np.arange(T) - b0) / (b1 - b0); mb = (xb > 0) & (xb < 1); bounce[mb] = 4 * 0.045 * xb[mb] * (1 - xb[mb])
        P, off, mn = ground(rig, P, smooth=0)
        W = rig.worlds(P); h = W[:, rig.hips, :3, 3].copy(); h[:, 1] += arc + bounce
        P = set_hips_world(rig, P, h)
        P = Pose(np.concatenate([P.q, np.repeat(P.q[-1:], 12, 0)]), np.concatenate([P.hips, np.repeat(P.hips[-1:], 12, 0)]))   # 躺平停一会儿
        dur = (len(P) - 1) / FPS
        return P, {"dur": round(dur, 3), "airborne": [round(a0 / FPS, 3), round(a1 / FPS, 3)], "ground": round(22 / FPS, 3),
                   "recover": round(36 / FPS, 3), "travel": r["travel"]}, L

    def air_pose(self):
        sp = dict(AIR_BASE, **self.recipes.get("air_pose", {}))
        return pose_from_spec(self.rig, sp)

    # ------------------------------------------------------------ 空中受击：差量叠在“空中后仰”姿势上，高度固定（游戏给空中高度）
    def make_hit_air(self, r):
        base = self.air_pose()
        M = self.take(r["src"], r["clip"], r["t0"], r["t1"], r["speed"])
        P = additive(self.rig, base, M, self.mapped, "world", r.get("gain", 1.0))
        P = fade_ends(P, base, 0, r.get("fade_out", 0))
        P = remove_horizontal(self.rig, P)
        W = self.rig.worlds(P); h = W[:, self.rig.hips, :3, 3].copy(); h[:, 1] = W[0, self.rig.hips, 1, 3]
        P = set_hips_world(self.rig, P, h)
        mn = self.rig.verts(P)[..., 1].min()                                   # 整段最低点放到 0（胯高度不随帧变）
        W = self.rig.worlds(P); h = W[:, self.rig.hips, :3, 3].copy(); h[:, 1] -= mn
        P = set_hips_world(self.rig, P, h)
        dur = (len(P) - 1) / FPS
        return P, {"dur": round(dur, 3), "impact": 0.0, "airborne": [0.0, round(dur, 3)], "recover": round(dur, 3), "travel": 0.0}

    # ------------------------------------------------------------ 起身：躺 → 坐起撑地 → 收腿 → 右膝跪地 → 半起 → 架势（手摆关键姿势，平滑插值）
    def make_getup(self, r):
        rig = self.rig; L = self.lie; S = self.stance; tm = dict(GETUP_TIMES, **r.get("times", {}))
        keys = [(tm["lie"], L)]
        for k in ("sit", "tuck", "kneel", "rise"):
            sp = dict(GETUP_KEYS[k], **r.get(k, {}))
            Pk = pose_from_spec(rig, sp)
            if sp.get("arms_from_stance"):
                w = sp["arms_from_stance"]
                for i, nm in enumerate(rig.G.name):
                    if any(x in nm for x in ("Shoulder", "Arm", "Hand")): Pk.q[:, i] = qslerp(Pk.q[:, i], S.q[:, i], w)
                Pk, _, _ = ground(rig, Pk, smooth=0)
            keys.append((tm[k], Pk))
        keys += [(tm["stance"], S), (tm["end"], S)]
        P = keyframes(rig, keys, smooth=2.0, ease=0.35)
        P, off, mn = ground(rig, P, smooth=1)
        P = remove_horizontal(rig, P)
        dur = (len(P) - 1) / FPS
        return P, {"dur": round(dur, 3), "recover": round(tm["stance"] / FPS, 3)}

    # ------------------------------------------------------------ 眩晕（循环）：架势上手垂下一点，上身画圈摇晃、头晃，胯不动（脚不滑）
    def make_dizzy(self, r):
        rig = self.rig; S = self.stance; T = int(round(r.get("dur", 2.0) * FPS)); amp = r.get("amp", 1.6)
        base = S.copy(); R0 = rig.rest_pose(1)
        for i, nm in enumerate(rig.G.name):
            if any(x in nm for x in ("Arm", "ForeArm", "Hand")) and "Shoulder" not in nm: base.q[:, i] = qslerp(base.q[:, i], R0.q[:, i], r.get("droop", 0.35))
        frames = []
        for t in range(T):
            ph = 2 * np.pi * t / T; P = base.copy()
            P = rotate_bone(rig, P, "Hips", (0, 0, 1), 2.0 * amp * np.sin(ph))
            for nm, k, lag in (("Spine", 3.0, 0.3), ("Spine1", 3.5, 0.6), ("Spine2", 3.5, 0.9), ("Neck", 5.0, 1.3), ("Head", 7.0, 1.7)):
                P = rotate_bone(rig, P, nm, (0, 0, 1), k * amp * np.sin(ph - lag))           # 左右晃
                P = rotate_bone(rig, P, nm, (1, 0, 0), 0.7 * k * amp * np.cos(ph - lag) + (3 if nm == "Head" else 0))   # 前后晃（画圈），头微低
            frames.append(P)
        P = concat(*frames, frames[0])                                         # 最后一帧等于第一帧，好循环
        P = lock_feet(rig, P, S)                                               # 胯侧倾时脚不跟着挪
        P, _, _ = ground(rig, P, smooth=0)
        return P, {"loop": True, "dur": round(T / FPS, 3)}

    # ------------------------------------------------------------
    def build(self, only=None):
        clips, info, notes = {}, {}, {}
        R = self.recipes
        want = lambda k: (only is None or k in only)
        for k in ("hit_high", "hit_high2", "hit_mid", "hit_mid2", "hit_side"):
            if want(k) and k in R:
                clips[k], info[k] = self.make_hit(R[k]); notes[k] = f"{R[k]['clip']} 差量({R[k].get('mode','world')})×{R[k].get('gain',1)}，{R[k]['t0']}–{R[k]['t1']}s ×{R[k]['speed']} 倍速"
        if want("hit_heavy"):
            clips["hit_heavy"], info["hit_heavy"] = self.make_heavy(R["hit_heavy"]); r = R["hit_heavy"]
            notes["hit_heavy"] = f"上身 {r['clip']} 差量×{r.get('gain',1)}（{r['t0']}–{r['t1']}s ×{r['speed']}）；腿和胯的水平移动取 walk 倒放（{r['walk']['t0']}→{r['walk']['t1']}s，×{abs(r['walk']['speed'])}）的差量，向后退两步；水平位移去掉（原地），travel 记退的距离"
        if want("knockdown") or want("getup"):
            P, inf, L = self.make_knockdown(R["knockdown"]); self.lie = L
            if want("knockdown"): clips["knockdown"], info["knockdown"] = P, inf; notes["knockdown"] = "关键姿势插值：架势→hit_to_head 后仰（差量）→空中后仰四肢甩开（手摆）→仰面躺（从静止姿势手摆）→弹一下→躺平；高度是贴地 + 抛物线，原地；travel 是建议的被打飞距离（不是动捕量出来的）"
        if want("getup"):
            clips["getup"], info["getup"] = self.make_getup(R.get("getup", {})); notes["getup"] = "手摆关键姿势：knockdown 最后一帧的躺姿 → 坐起双手撑地 → 收腿蹲坐 → 右膝跪地、左脚在前 → 半起 → 架势，平滑插值，按网格最低点贴地，原地"
        if want("hit_air") and "hit_air" in R:
            clips["hit_air"], info["hit_air"] = self.make_hit_air(R["hit_air"]); r = R["hit_air"]
            notes["hit_air"] = f"{r['clip']} 差量叠在手摆的“空中后仰”姿势上，×{r.get('gain',1)}，{r['t0']}–{r['t1']}s ×{r['speed']}；胯高度固定（网格最低点在 0，空中高度由游戏给）"
        if want("dizzy"):
            clips["dizzy"], info["dizzy"] = self.make_dizzy(R.get("dizzy", {})); notes["dizzy"] = "程序生成：架势上双手垂下一点，脊柱到头逐节有相位差地画圈摇晃，胯不动；2 秒循环，首尾帧相同"
        if want("ko"):
            clips["ko"], info["ko"] = self.make_abs(R["ko"]); r = R["ko"]
            notes["ko"] = f"{r['clip']} 绝对姿势，{r['t0']}–{r['t1']}s ×{r['speed']}，开头 {r.get('fade_in',0)} 帧从架势过渡，原地，向前扑倒"
        return clips, info, notes

    def finish_weapon(self, clips):
        if not self.wpn: return {}
        rep = {}
        for k in list(clips):
            clips[k], nfix = blade_clear(self.rig, clips[k], self.wpn, self.sd_dense)     # 刀贴进身体的帧：绕手腕把刀拉开
            clips[k] = blade_ground(self.rig, clips[k], self.wpn)
            if k == "dizzy": clips[k].q[-1] = clips[k].q[0]; clips[k].hips[-1] = clips[k].hips[0]   # 循环：首尾帧一致
            rep[k] = dict(blade_metrics(self.rig, clips[k], self.wpn, self.sd_dense), wrist_fixed_frames=nfix)
        return rep

    def write(self, clips, info, notes, merge=True):
        out = P_(self.cfg["out"]); js = os.path.splitext(out)[0] + ".json"
        rig = self.rig
        data = {}
        for k, P in clips.items():
            data[k] = {"rot": {i: P.q[:, i] for i in rig.bones}, "trans": {rig.hips: P.hips}, "fps": FPS}
        old_info = {}
        if merge and os.path.exists(js) and os.path.exists(out):     # 只重做了部分动作时，保留旧文件里的其它动作
            old = GLB(out); oj = json.load(open(js))
            for k in old.anims:
                if k in data: continue
                Tn = int(round(old.anim_duration(k) * FPS)) + 1; tt, qq, ss = old.sample(k, np.arange(Tn) / FPS)
                hips = old.idx[MX + "Hips"]
                data[k] = {"rot": {rig.G.idx[old.name[i]]: qq[:, i] for i in range(len(old.nodes)) if old.name[i] in rig.G.idx and old.name[i].startswith(MX)},
                           "trans": {rig.hips: tt[:, hips]}, "fps": FPS}
                old_info[k] = oj["clips"].get(k, {})
            notes = {**{k: v for k, v in (oj.get("clip_notes") or {}).items() if k not in clips}, **notes}
        order = ["hit_high", "hit_high2", "hit_mid", "hit_mid2", "hit_side", "hit_heavy", "hit_air", "knockdown", "getup", "ko", "dizzy", "dash_f", "dash_b"]
        data = {k: data[k] for k in sorted(data, key=lambda x: order.index(x) if x in order else 99)}
        size = write_skeleton_glb(rig.G, out, data, generator="fighting-game tools/generic/build_generic.py")
        allinfo = {**old_info, **info}
        meta = {"id": self.cfg["id"], "fps": FPS, "stance": f"{os.path.basename(self.cfg['rig'])} 的 {self.stance_name} 第 0 帧",
                "clips": {k: allinfo[k] for k in data if k in allinfo},
                "notes": self.cfg.get("notes", "") or "Tripo 预设（真人动捕）重定向到本角色骨架。受击类是差量叠在架势上（第 0 帧就是架势，结尾回到架势）；击飞、起身、被击败是绝对姿势（首尾向架势过渡）。水平位移已去掉（原地），travel 记原始位移（身高按 1，负数向后）。",
                "clip_notes": {k: notes[k] for k in data if k in notes}}
        json.dump(meta, open(js, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("WROTE", out, size, "bytes;", js, list(data))
        return out, js


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("config"); ap.add_argument("--only"); ap.add_argument("--no-merge", action="store_true")
    a = ap.parse_args()
    cfg = json.load(open(P_(a.config)))
    b = Builder(cfg); only = set(a.only.split(",")) if a.only else None
    clips, info, notes = b.build(only)
    for k, v in b.finish_weapon(clips).items(): print("BLADE", k, json.dumps(v, ensure_ascii=False))
    for k, P in clips.items():
        print("CLIP", k, json.dumps(info[k], ensure_ascii=False), "metrics", json.dumps({x: round(y, 3) for x, y in foot_metrics(b.rig, P).items()}))
    b.write(clips, info, notes, merge=not a.no_merge)


if __name__ == "__main__":
    main()
