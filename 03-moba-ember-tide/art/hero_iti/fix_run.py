"""伊缇的跑步：把步幅收小，脚重新贴地（照 art/hero/hedda/fix_run.py 改：赫达那份还要用右腿镜像重建左腿，这里默认不镜像，MIRROR=1 才镜像）。
伊缇本来以为左右腿认反已经在 fix_legs.py 里纠正了，进游戏量（run_probe.mjs）左脚落地时还往前滑 1.8 米/秒、右脚不滑（反推原速左 6.7、右 9.5），
所以 rebuild.sh 里开了 MIRROR=1：左腿用右腿镜像，改完两只脚都落地 8–11 帧、往后蹬 10.4–10.5 米/秒，一样快。

毛病：即梦出的是全力冲刺，一步跨得极远（视频一秒两步、腾空很长）。在游戏里量（art/hero_iti/run_probe.mjs）落地脚不打滑要填 runSpeed 17 米/秒，
按移速 6 只能放到 0.35 倍，像慢动作（岚是 10.97，放 0.55 倍）。
  1. （MIRROR=1 时才做）左腿用右腿镜像、错开半个周期。
  2. 收步幅：两条腿的大腿（UpLeg）绕“一个周期里的平均姿势”摆的那部分乘 k（默认 0.6），小腿乘 kl（默认 0.85）。步频不变，落地脚往后蹬的速度跟着变小。
  3. 贴地：落地的那几帧把胯上下挪到最低的脚正好在地面上（FLOOR，伊缇站姿里最低的脚关节约 0.02），腾空的帧插值，腾空时最低的脚离地不超过 RUN_FLY（默认 0.05）。
用法: Blender -b --factory-startup -P art/hero_iti/fix_run.py -- <rigged.glb> <输入 run.npz> <输出 run.npz> [k=0.6] [kl=0.85] [游戏里 1 单位多少米=3.3]
"""
import bpy, sys, os
import numpy as np
from mathutils import Matrix, Quaternion, Vector
a = sys.argv[sys.argv.index("--") + 1:]
src, fin, fout = a[0], a[1], a[2]
k = float(a[3]) if len(a) > 3 else float(os.environ.get("RUN_K", 0.6)); kl = float(a[4]) if len(a) > 4 else 0.85; UNIT = float(a[5]) if len(a) > 5 else 3.3
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE"); PB = arm.pose.bones; B = arm.data.bones; MX = "mixamorig:"
for pb in PB: pb.rotation_mode = "QUATERNION"
upd = bpy.context.view_layer.update
m = np.load(fin, allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"].copy(); loc = m["loc"].copy(); fps = float(m["fps"])
T = len(q); P = T - 1                                             # 最后一帧是第一帧的重复
CH = ["UpLeg", "Leg", "Foot", "ToeBase"]
S = Matrix.Diagonal((-1, 1, 1))
C = {n: (B[MX + "Left" + n].matrix_local.to_3x3().transposed() @ (S @ B[MX + "Right" + n].matrix_local.to_3x3() @ S)).transposed() for n in CH}
FEET = {s: [MX + s + n for n in ("Foot", "ToeBase", "Toe_End")] for s in ("Left", "Right")}
REST_H = B[MX + "Hips"].matrix_local.to_3x3()


def pose(t, qq=None, ll=None):
    qq = q if qq is None else qq; ll = loc if ll is None else ll
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for i, nm in enumerate(names):
        pb = PB.get(nm)
        if pb is not None: pb.rotation_quaternion = Quaternion(qq[t, i])
    PB[MX + "Hips"].location = Vector(ll[t]); upd()


def feet_track(qq, ll):
    """每帧两只脚最低的关节高度和水平位置（骨架空间），以及胯的位置"""
    out = {s: [] for s in FEET}; hips = []
    for t in range(P):
        pose(t, qq, ll); hips.append(PB[MX + "Hips"].head.copy())
        for s, bs in FEET.items():
            low = min((PB[b].head for b in bs), key=lambda v: v.z); out[s].append(low.copy())
    return out, hips


def push_speed(tr, hips):
    """落地帧（离这只脚的最低点 2 厘米以内、连着两帧）相对胯往后退的速度，中位数，身高/秒"""
    res = {}
    for s, p in tr.items():
        lo = min(v.z for v in p); vs = []
        for i in range(P):
            j = (i + 1) % P
            if p[i].z < lo + 0.02 and p[j].z < lo + 0.02: vs.append(((p[j] - hips[j]) - (p[i] - hips[i])).y * fps)      # 面朝 -Y，往后是 +Y
        vs.sort(); res[s] = (len(vs), vs[len(vs) // 2] if vs else float("nan"), lo)
    return res


tr0, h0 = feet_track(q, loc); before = push_speed(tr0, h0)

# ---- 1. 左腿用右腿镜像、错开半个周期（伊缇默认不做）----
out = q.copy()
R = {n: [] for n in CH} if os.environ.get("MIRROR") else None
for t in range(P if R is not None else 0):
    pose(t)
    for n in CH: R[n].append(PB[MX + "Right" + n].matrix.to_3x3().to_quaternion())
for t in range(P if R is not None else 0):
    pose(t); s_ = (t + P / 2) % P; f0 = int(np.floor(s_)); f1 = (f0 + 1) % P; fr = s_ - f0
    for n in CH:
        rq = R[n][f0].slerp(R[n][f1], fr) if R[n][f0].dot(R[n][f1]) >= 0 else R[n][f0].slerp(-R[n][f1], fr)
        Rm = S @ rq.to_matrix() @ S @ C[n]
        pb = PB[MX + "Left" + n]; h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ Rm.to_4x4(); upd()
        out[t, names.index(MX + "Left" + n)] = list(pb.rotation_quaternion)
out[P] = out[0]

# ---- 2. 收步幅：大腿乘 k、小腿乘 kl，绕一个周期的平均姿势 ----
def qmean(Q):
    Q = Q.copy(); Q[np.sum(Q * Q[0], 1) < 0] *= -1; mq = Q.mean(0); return mq / np.linalg.norm(mq)
for side in ("Left", "Right"):
    for n, kk in (("UpLeg", k), ("Leg", kl)):
        i = names.index(MX + side + n); mq = Quaternion(qmean(out[:P, i]))
        for t in range(P):
            qt = Quaternion(out[t, i]); qt = qt if qt.dot(mq) >= 0 else -qt; out[t, i] = list(mq.slerp(qt, kk))
        out[P, i] = out[0, i]

# ---- 3. 贴地：落地帧把最低的脚放到地面，腾空帧插值 ----
pose(0);
st = None
FLOOR = float(os.environ.get("RUN_FLOOR", 0.02))                    # 站姿里最低的脚的关节离地多高（hero_motion 报的“脚最低”0.020–0.021）
tr, hp = feet_track(out, loc); low = [min(tr["Left"][t].z, tr["Right"][t].z) for t in range(P)]; gmin = min(low)
ground = [t for t in range(P) if low[t] < gmin + 0.03]
dz = np.zeros(P)
if ground:
    g = sorted(ground); val = {t: FLOOR - low[t] for t in g}
    for t in range(P):
        if t in val: dz[t] = val[t]; continue
        prv = max([x for x in g if x < t], default=g[-1] - P); nxt = min([x for x in g if x > t], default=g[0] + P)
        w = (t - prv) / (nxt - prv); dz[t] = val[prv % P] * (1 - w) + val[nxt % P] * w
FLY = float(os.environ.get("RUN_FLY", 0.05))                    # 腾空时最低的脚最多离地多高（身高是 1）：步幅收小以后腿收得更靠下，原来的腾空高度显得飘
dz = np.minimum(dz, FLOOR + FLY - np.array(low))
r_ = 2; kern = np.exp(-0.5 * (np.arange(-r_, r_ + 1) / 1.0) ** 2); kern /= kern.sum()
dz = sum(w * np.roll(dz, j) for j, w in zip(range(-r_, r_ + 1), kern))      # 循环地平滑一下，免得一帧一跳
loc2 = loc.copy(); off = REST_H.inverted()
for t in range(P): loc2[t] = list(Vector(loc[t]) + off @ Vector((0, 0, dz[t])))
loc2[P] = loc2[0]

tr2, h2 = feet_track(out, loc2); after = push_speed(tr2, h2)
np.savez(fout, **{**{kk_: m[kk_] for kk_ in m.files}, "quats": out, "loc": loc2})
print("RUN", fin, "->", fout, "frames", T, "k", k, "kl", kl, "贴地挪动", f"{dz.min():+.3f}..{dz.max():+.3f}")
for lab, r in (("改前", before), ("改后", after)):
    print("SPEED", lab, " ".join(f"{s}: 落地 {n} 帧 往后蹬 {v:.3f} 身高/秒 = {v * UNIT:.2f} 米/秒 最低 {lo:.3f}" for s, (n, v, lo) in r.items()))
