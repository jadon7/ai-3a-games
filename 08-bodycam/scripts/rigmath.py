"""逐帧的相机/躯干/持枪手臂运动（纯数学，供搭建与特效共用）。
约定：躯干局部 +Y 为前，+Z 上，+X 右。角度 a 表示"从 -X 朝 -Y 偏转"的度数。
"""
import math
import numpy as np
from mathutils import Matrix, Vector
import timeline as TL

NF = TL.F_END + 6
FR = np.arange(NF + 1)
FLOOR_Z = 0.42
CAM_LOCAL = Vector((0.02, -0.50, 0.21))
PIVOT = Vector((0.0, -0.45, -0.02))       # 手臂绕肩部转动的支点
ENEMY_POS = Vector((16.25, 3.12, 0.40))
BODY_POS = Vector((16.25, 1.75, 0.55))


def lin(keys):
    return np.interp(FR, [k[0] for k in keys], [k[1] for k in keys])


def smooth(a, sigma):
    if sigma <= 0:
        return a
    r = int(sigma * 4) + 1
    x = np.arange(-r, r + 1)
    k = np.exp(-(x / sigma) ** 2 / 2); k /= k.sum()
    return np.convolve(np.pad(a, r, mode="edge"), k, mode="valid")


def noise(seed, freqs, amps):
    rng = np.random.default_rng(seed)
    t = FR / TL.FPS
    out = np.zeros(NF + 1)
    for f, a in zip(freqs, amps):
        out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi))
    return out


def impulse(frames_amps, decay):
    """在给定帧加冲击，按 decay 序列衰减。frames_amps: [(frame, amp)]"""
    out = np.zeros(NF + 1)
    for f, a in frames_amps:
        for i, d in enumerate(decay):
            if 0 <= f + i <= NF:
                out[f + i] += a * d
    return out


# ---------------- 位置
px = smooth(lin([(0, 24.47), (1, 24.45), (84, 22.75), (100, 22.72), (130, 22.86), (186, 22.84), (335, 19.0), (NF, 18.92)]), 5)
py = smooth(lin([(0, 3.05), (1, 3.05), (84, 2.72), (100, 2.66), (130, 2.50), (186, 2.48), (335, 2.35), (NF, 2.33)]), 5)
pz = smooth(lin([(0, 1.90), (87, 1.90), (91, 1.73), (135, 1.75), (190, 1.80), (335, 1.84), (NF, 1.86)]), 2.2)

vel = np.hypot(np.gradient(px), np.gradient(py)) * TL.FPS          # m/s
gate = np.clip((vel - 0.12) / 0.4, 0, 1)
step_rate = 1.55 + 0.5 * np.clip(vel, 0, 1.2)                        # 步/秒
phase = np.cumsum(gate * step_rate / TL.FPS)                         # 累计步数
bob_z = -0.028 * gate * (0.5 - 0.5 * np.cos(2 * np.pi * phase))
sway = 0.016 * gate * np.sin(np.pi * phase)
STEPS = [int(i) for i in range(1, NF) if int(phase[i]) != int(phase[i - 1])]

# ---------------- 朝向（度）
whip_g = smooth(lin([(0, 0), (TL.C_WHIP0 + 1, 0), (TL.C_WHIP1 + 1, -30.4), (NF, -30.4)]), 1.5)
slow_g = smooth(lin([(0, 40), (22, 50), (46, 36), (70, 27), (98, 27), (116, 27), (127, 28.5), (150, 32),
                     (186, 34.5), (335, 38.5), (NF, 38.5)]), 4.5)
yaw_g = slow_g + whip_g
whip_c = smooth(lin([(0, 0), (TL.C_FLINCH, 0), (TL.C_WHIP1 - 3, -30.4), (NF, -30.4)]), 1.4)
slow_c = smooth(lin([(0, 43), (19, 53), (43, 37), (67, 27.5), (98, 27), (116, 27), (127, 28.5), (150, 32),
                     (186, 34.5), (335, 38.5), (350, 38.5), (366, 2), (380, 0), (398, 37), (NF, 38.5)]), 4.0)
yaw_c = slow_c + whip_c
glance_g = smooth(lin([(0, 0), (352, 0), (370, -9), (384, -9), (402, 0), (NF, 0)]), 4)
yaw_g = yaw_g + glance_g

pitch_g = smooth(lin([(0, -3), (60, -2), (88, -2.5), (98, -1.6), (118, -1.8), (135, -6), (160, -10.5),
                      (186, -11), (335, -24), (NF, -24.5)]), 3.5)
pitch_c = smooth(lin([(0, -5), (60, -4), (87, -4), (90, -8), (98, -3), (118, -3), (140, -5), (186, -7),
                      (335, -17), (350, -17), (366, -7), (380, -7), (398, -18), (NF, -18)]), 2.2)

# 手持抖动
yaw_c += noise(11, [0.31, 0.83, 2.3, 6.7], [0.9, 0.45, 0.2, 0.07])
pitch_c += noise(12, [0.27, 0.91, 2.7, 7.3], [0.7, 0.35, 0.18, 0.06])
roll_c = noise(13, [0.23, 0.71, 2.1, 5.9], [1.1, 0.5, 0.22, 0.06]) + 0.9 * gate * np.sin(np.pi * phase)
yaw_g += noise(21, [0.37, 1.1, 3.1], [0.5, 0.22, 0.08])
pitch_g += noise(22, [0.33, 1.3, 3.4], [0.45, 0.2, 0.08])
# 呼吸（交火后变重）
breath_amp = lin([(0, 0.25), (86, 0.3), (130, 1.0), (260, 0.8), (NF, 0.6)])
breath = np.sin(2 * np.pi * np.cumsum(lin([(0, 0.32), (86, 0.35), (130, 0.75), (300, 0.6), (NF, 0.5)]) / TL.FPS))
pitch_c += 0.5 * breath_amp * breath
pitch_g += 0.7 * breath_amp * breath
bob_z = bob_z + 0.004 * breath_amp * breath

# 脚步落地的小冲击
foot = impulse([(s, 1.0) for s in STEPS], [1.0, 0.45, 0.15])
pitch_c -= 0.55 * foot
roll_c += 0.3 * foot * np.sign(np.sin(np.pi * phase))

# 被袭惊吓
pitch_c += impulse([(TL.C_FLINCH, 1.0)], [-1.5, -2.5, -1.5, -0.5])
roll_c += impulse([(TL.C_FLINCH, 1.0)], [3.0, 5.5, 3.5, 1.5, 0.5])
# 近处弹着的震动（第 5 发打在脚前）
roll_c += impulse([(97, 1.0)], [1.5, -2.0, 1.0, -0.4])
pitch_c += impulse([(97, 1.0)], [-1.2, 1.5, -0.6])

# ---------------- 我方后坐力
rng = np.random.default_rng(5)
rec_pitch = np.zeros(NF + 1); rec_yaw = np.zeros(NF + 1); rec_back = np.zeros(NF + 1); slide = np.zeros(NF + 1)
for s in TL.P_SHOTS:
    k = rng.uniform(0.85, 1.2)
    rec_pitch += impulse([(s, k)], [2.2, 7.5, 4.2, 1.6, 0.4])
    rec_yaw += impulse([(s, rng.uniform(-1, 1))], [0.4, 1.6, 0.9, 0.3])
    rec_back += impulse([(s, k)], [0.006, 0.016, 0.008, 0.002])
    slide += impulse([(s, 1.0)], [1.0, 0.25])
    pitch_c += impulse([(s, k)], [0.5, 1.1, 0.4, -0.2])
    roll_c += impulse([(s, rng.uniform(-1, 1))], [0.3, 0.9, 0.4])
# 接敌前枪收在胸前（紧凑持枪），转向敌人时双臂前推
ready = smooth(lin([(0, 1.0), (TL.C_WHIP0 + 1, 1.0), (TL.C_WHIP1 + 2, 0.0), (NF, 0.0)]), 1.6)
ready += 0.12 * np.clip(noise(31, [0.21, 0.6], [1.0, 0.5]), -1, 1) * (ready > 0.5)


def _yaw_to_psi(a_deg):
    return math.radians(90.0 + a_deg)


def torso_matrix(f):
    f = int(f)
    z = pz[f] + bob_z[f]
    psi = _yaw_to_psi(yaw_g[f])
    # 侧向摆动沿躯干右方向
    right = Vector((math.cos(psi), math.sin(psi), 0))
    p = Vector((px[f], py[f], z)) + right * sway[f]
    return Matrix.Translation(p) @ Matrix.Rotation(psi, 4, "Z")


def cam_local_matrix(f):
    f = int(f)
    yaw = math.radians(yaw_c[f] - yaw_g[f])
    R = (Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.radians(pitch_c[f]), 4, "X")
         @ Matrix.Rotation(math.radians(roll_c[f]), 4, "Y") @ Matrix.Rotation(math.radians(90), 4, "X"))
    # 头部转动时相机绕颈部（相机后下方）转
    neck = Vector((0.0, -0.58, 0.05))
    off = CAM_LOCAL - neck
    rot_only = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.radians(pitch_c[f]) * 0.6, 4, "X")
    return Matrix.Translation(neck + rot_only @ off) @ R


def vm_local_matrix(f):
    f = int(f)
    rot = (Matrix.Rotation(math.radians(rec_yaw[f]), 4, "Z")
           @ Matrix.Rotation(math.radians(pitch_g[f] + rec_pitch[f]), 4, "X"))
    return (Matrix.Translation(PIVOT) @ rot @ Matrix.Translation(-PIVOT)
            @ Matrix.Translation(Vector((0, -rec_back[f] - 0.085 * ready[f], -0.035 * ready[f]))))


def vm_world(f):
    return torso_matrix(f) @ vm_local_matrix(f)


def cam_world(f):
    return torso_matrix(f) @ cam_local_matrix(f)
