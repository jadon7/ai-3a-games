# KHAMSIN 机甲「砂暴」K-07：Blender 无界面脚本化硬表面建模 → assets/models/mech.glb
# 用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build_mech.py -- [--preview]
# 坐标同 khlib：X = 右，F(Y) = 前，U(Z) = 上；导出后是游戏里的 (x, u, -f)。单位：米。
# 模型按“关节静止位”摆放（双腿伸直、各关节零旋转），每个关节一个空物体节点，零件挂在节点下、用节点局部坐标建；
# 游戏里 src/game/mechloader.js 按节点名把零件合并后装到 mech.js 原有的关节层级上（关节常量必须与 mech.js 一致）。
#   躯干下的活动件：hatch（座舱盖，绕顶部铰链上翻）、head（传感器头，可左右转）、lidA / lidB（火箭巢上下盖）
#   右臂下：barrel（三管炮管束，绕炮轴旋转）；左臂下：foreL（前臂）→ fistL（动力拳，沿前臂伸出）
#   cockpit：第一人称座舱内饰（视图空间：原点 = 眼睛，+F = 视线方向），由 src/ui/cockpit.js 挂到相机上
import bpy, bmesh, sys, os, math, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import importlib, khlib, glbpack
importlib.reload(khlib)
from khlib import *

khlib.FINE = 1   # 机甲是大件：圆柱分段不加倍
ROOT = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(ROOT, 'assets', 'models'); PRE = os.path.join(HERE, 'preview')
os.makedirs(OUT, exist_ok=True); os.makedirs(PRE, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW_ON = '--preview' in argv
CK_PREVIEW = '--ckpreview' in argv   # 只渲染座舱内饰的预览（改仪表台时用，快）

khlib.PREVIEW.update({
    'main': ((0.46, 0.30, 0.085), 0.55, 0.50, None), 'sec': ((0.070, 0.070, 0.066), 0.6, 0.52, None), 'joint': ((0.30, 0.30, 0.31), 1.0, 0.34, None),
    'dark': ((0.006, 0.006, 0.007), 0.3, 0.6, None), 'accent': ((0.014, 0.19, 0.23), 0.5, 0.45, None), 'warn': ((0.62, 0.38, 0.02), 0.3, 0.5, None),
    'glass': ((0.012, 0.03, 0.04), 0.9, 0.06, None), 'eye': ((0.1, 0.6, 0.8), 0.0, 0.5, (0.4, 2.4, 3.2)), 'glow': ((0.1, 0.6, 0.8), 0.0, 0.5, (0.4, 2.4, 3.2)),
    'core': ((0.8, 0.3, 0.1), 0.0, 0.5, (3.2, 1.2, 0.3)), 'vent': ((0.8, 0.3, 0.1), 0.0, 0.5, (3.0, 1.1, 0.25)), 'heat': ((0.16, 0.16, 0.17), 1.0, 0.4, None),
    'ckDark': ((0.012, 0.013, 0.015), 0.0, 0.75, None), 'ckFrame': ((0.05, 0.052, 0.05), 0.5, 0.5, None), 'ckTrim': ((0.26, 0.26, 0.27), 1.0, 0.35, None),
    'ckLampA': ((0.8, 0.5, 0.1), 0.0, 0.5, (3.0, 1.6, 0.3)), 'ckLampC': ((0.1, 0.6, 0.8), 0.0, 0.5, (0.4, 2.4, 3.2)), 'ckLampR': ((0.8, 0.1, 0.05), 0.0, 0.5, (3.2, 0.4, 0.2)),
    'ckLampG': ((0.1, 0.7, 0.2), 0.0, 0.5, (0.4, 2.6, 0.8)), 'ckLampW': ((0.5, 0.06, 0.04), 0.0, 0.5, (1.2, 0.15, 0.08)), 'ckRed': ((0.5, 0.03, 0.02), 0.1, 0.5, None),
})
khlib.WEAR.update({'main': 1.0, 'sec': 0.8, 'joint': 0.45, 'accent': 0.9, 'warn': 0.9, 'heat': 0.3, 'ckFrame': 0.7, 'ckTrim': 0.3, 'ckDark': 0.25, 'ckRed': 0.6})

HIP = 2.86            # 髋高 = THIGH + SHIN + FOOT
THIGH = 1.25; SHIN = 1.25; FOOT = 0.36
TOR = HIP + 0.4       # 躯干节点高度
V = Vector


class MK:
    """零件容器：节点（空物体）在世界静止位，零件用节点局部坐标。"""
    def __init__(self): self.g = {}; self.objs = []

    def node(self, name, loc): self.g[name] = empty(name, loc); return self.g[name]

    def add(self, name, bm, mat, grp, bevel=0.012, seg=1, **kw):
        o = obj(name, bm, mat, self.g[grp], bevel=bevel, seg=seg, **kw); self.objs.append(o); return o


# ---------------- 机甲尺度的基本体 ----------------
def octu(u, w, f0, f1, c, x=0.0):
    """俯视八角截面（位于高度 u 的 X-F 平面）。"""
    return [V((x - w + c, f0, u)), V((x + w - c, f0, u)), V((x + w, f0 + c, u)), V((x + w, f1 - c, u)), V((x + w - c, f1, u)), V((x - w + c, f1, u)), V((x - w, f1 - c, u)), V((x - w, f0 + c, u))]


def prismX(pts_fu, x0, x1): return prism(pts_fu, abs(x1 - x0), (x0 + x1) / 2)


def prismF(pts_xu, f0, f1):
    bm = bmesh.new(); a = [bm.verts.new((x, f0, u)) for x, u in pts_xu]; b = [bm.verts.new((x, f1, u)) for x, u in pts_xu]; n = len(a)
    bm.faces.new(a); bm.faces.new(b[::-1])
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((a[i], b[i], b[j], a[j]))
    return bm


def tx(x0, x1, f, u, r, seg=16, r1=None): return tube((x0, f, u), (x1, f, u), r, r1, seg=seg)
def tf(f0, f1, x, u, r, seg=16, r1=None): return tube((x, f0, u), (x, f1, u), r, r1, seg=seg)
def tu(u0, u1, x, f, r, seg=16, r1=None): return tube((x, f, u0), (x, f, u1), r, r1, seg=seg)


def sweep(pts, r, n=6):
    P = [V(p) for p in pts]; secs = []; up = None
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized() if up is None else (up - d * up.dot(d)).normalized()
        b = d.cross(a); up = a
        secs.append([p + a * (r * math.cos(2 * math.pi * k / n)) + b * (r * math.sin(2 * math.pi * k / n)) for k in range(n)])
    return loft(secs)


def bolts(K, grp, pts, nrm, r=0.028, h=0.02, mat='joint'):
    n = V(nrm).normalized()
    for p in pts: K.add('bolt', orient(cyl(h, r, seg=6), V(p) - n * 0.004, n), mat, grp, bevel=0)


def hazard(K, grp, o, ax, up, length, height, n=6, th=0.012):
    """警示斜纹：黄底板 + n 条黑色斜条。o 为左下角，ax / up 为长 / 高方向（单位向量），法线 = ax × up。"""
    o = V(o); ax = V(ax).normalized(); up = V(up).normalized(); nr = ax.cross(up).normalized()
    P = lambda s, t, d: o + ax * s + up * t + nr * d
    K.add('hz_base', loft([[P(0, 0, 0), P(length, 0, 0), P(length, height, 0), P(0, height, 0)], [P(0, 0, th), P(length, 0, th), P(length, height, th), P(0, height, th)]]), 'warn', grp, bevel=0)
    pitch = (length - height * 0.8) / n; w = pitch * 0.5; sl = height * 0.8
    for i in range(n):
        a = i * pitch + pitch * 0.25
        q = [(a, 0), (a + w, 0), (a + w + sl, height), (a + sl, height)]
        K.add('hz_bar', loft([[P(s, t, th - 0.002) for s, t in q], [P(s, t, th + 0.004) for s, t in q]]), 'dark', grp, bevel=0)


def piston(K, grp, a, b, r=0.07, split=0.55, mat='joint'):
    """液压杆：粗缸筒 + 细活塞杆 + 两端耳环。"""
    a = V(a); b = V(b); m = a + (b - a) * split
    K.add('pist_cyl', tube(a, m, r, seg=10), 'sec', grp, bevel=0.008)
    K.add('pist_rod', tube(m, b, r * 0.5, seg=8), mat, grp, bevel=0)
    K.add('pist_col', tube(m - (b - a).normalized() * 0.04, m + (b - a).normalized() * 0.015, r * 1.18, seg=10), mat, grp, bevel=0.006)
    for p in (a, b): K.add('pist_eye', tube(p - X * (r * 0.9), p + X * (r * 0.9), r * 0.9, seg=8), mat, grp, bevel=0.006)


# ---------------- 腿 ----------------
def leg(K, s, n):
    th, sh, ft = 'thigh' + n, 'shin' + n, 'foot' + n
    # 大腿（原点 = 髋轴）
    K.add('hip', tx(-0.24 * s, 0.30 * s, 0, 0, 0.42, 20), 'joint', th, bevel=0.02)
    K.add('hip_cap', tx(0.30 * s, 0.37 * s, 0, 0, 0.32, 16), 'main', th, bevel=0.02)
    bolts(K, th, [(0.37 * s, 0.22 * math.cos(a), 0.22 * math.sin(a)) for a in [k * math.pi / 3 for k in range(6)]], (s, 0, 0), r=0.032)
    K.add('th_core', loft([octu(-0.05, 0.26, -0.32, 0.30, 0.07), octu(-0.7, 0.26, -0.34, 0.28, 0.07), octu(-1.15, 0.24, -0.28, 0.24, 0.07)]), 'sec', th, bevel=0.015)
    K.add('th_front', prismX([(0.27, -0.02), (0.50, -0.10), (0.60, -0.50), (0.54, -0.94), (0.34, -1.0), (0.27, -0.6)], -0.36, 0.36), 'main', th, bevel=0.03, seg=2)
    K.add('th_guard', prismX([(0.49, -0.05), (0.56, -0.09), (0.655, -0.42), (0.60, -0.46), (0.52, -0.16)], -0.30, 0.30), 'main', th, bevel=0.02, seg=2)
    K.add('th_stripe', prismX([(0.585, -0.2), (0.605, -0.195), (0.64, -0.33), (0.62, -0.335)], -0.302, 0.302), 'accent', th, bevel=0.004)
    K.add('th_outer', prismX([(-0.36, -0.18), (0.26, -0.18), (0.34, -0.6), (0.22, -1.02), (-0.28, -1.02), (-0.40, -0.6)], 0.26 * s, 0.40 * s), 'main', th, bevel=0.025, seg=2)
    K.add('th_inner', prismX([(-0.3, -0.3), (0.22, -0.3), (0.22, -0.97), (-0.28, -0.97)], -0.26 * s, -0.31 * s), 'sec', th, bevel=0.012)
    K.add('th_back', prismX([(-0.30, -0.1), (-0.46, -0.3), (-0.44, -0.85), (-0.28, -1.0)], -0.2, 0.2), 'sec', th, bevel=0.02)
    bolts(K, th, [(0.40 * s, f, u) for f, u in ((-0.26, -0.3), (0.18, -0.3), (0.14, -0.94), (-0.2, -0.94))], (s, 0, 0), r=0.032)
    piston(K, th, (0, -0.5, -0.22), (0, -0.44, -1.12), r=0.085)
    K.add('knee', tx(-0.40 * s, 0.40 * s, 0, -THIGH, 0.35, 20), 'joint', th, bevel=0.02)
    for q in (-1, 1):
        K.add('knee_cap', tx(q * 0.40, q * 0.44, 0, -THIGH, 0.24, 14), 'sec', th, bevel=0.012)
        bolts(K, th, [(q * 0.44, 0.15 * math.cos(a), -THIGH + 0.15 * math.sin(a)) for a in [k * math.pi / 2 + 0.4 for k in range(4)]], (q, 0, 0), r=0.026)
    # 小腿（原点 = 膝轴）
    K.add('sh_core', loft([octu(-0.1, 0.24, -0.30, 0.22, 0.06), octu(-0.7, 0.23, -0.34, 0.18, 0.06), octu(-1.15, 0.2, -0.25, 0.16, 0.06)]), 'sec', sh, bevel=0.015)
    g = K.add('sh_greave', prismX([(0.24, 0.18), (0.52, 0.15), (0.66, -0.08), (0.52, -0.55), (0.36, -1.06), (0.17, -1.08), (0.19, -0.45), (0.25, -0.05)], -0.37, 0.37), 'main', sh, bevel=0.03, seg=2)
    for i in range(3): cut(g, box(0.42, 0.12, 0.04, (0, 0.575 - i * 0.03, -0.20 - i * 0.1), (0.28, 0, 0)))
    K.add('sh_knee', prismX([(0.50, 0.17), (0.68, 0.07), (0.72, -0.12), (0.665, -0.12), (0.63, 0.03), (0.50, 0.11)], -0.25, 0.25), 'sec', sh, bevel=0.015)
    K.add('sh_outer', prismX([(-0.38, -0.12), (0.17, -0.12), (0.24, -0.6), (0.14, -1.02), (-0.28, -1.02), (-0.44, -0.5)], 0.24 * s, 0.37 * s), 'main', sh, bevel=0.025, seg=2)
    K.add('sh_inner', prismX([(-0.32, -0.16), (0.14, -0.16), (0.16, -0.98), (-0.26, -0.98)], -0.24 * s, -0.29 * s), 'sec', sh, bevel=0.012)
    hazard(K, sh, (0.372 * s, -0.24 if s > 0 else 0.12, -1.0), (0, s, 0), (0, 0, 1), 0.36, 0.1, n=4)
    bolts(K, sh, [(0.37 * s, f, u) for f, u in ((-0.3, -0.2), (0.1, -0.2), (-0.34, -0.55), (0.16, -0.62))], (s, 0, 0), r=0.03)
    K.add('sh_calf', prismX([(-0.30, -0.02), (-0.54, -0.2), (-0.60, -0.62), (-0.42, -0.86), (-0.28, -0.6)], -0.2, 0.2), 'sec', sh, bevel=0.02)
    K.add('sh_calfp', prismX([(-0.545, -0.2), (-0.60, -0.185), (-0.665, -0.6), (-0.61, -0.635)], -0.17, 0.17), 'main', sh, bevel=0.015)
    for q in (-1, 1): piston(K, sh, (q * 0.11, -0.44, -0.74), (q * 0.11, -0.36, -1.2), r=0.05, split=0.5)
    K.add('sh_cable', sweep([(-0.25 * s, 0.1, -0.06), (-0.31 * s, 0.06, -0.4), (-0.30 * s, -0.02, -0.8), (-0.25 * s, -0.06, -1.1)], 0.03), 'dark', sh, bevel=0)
    K.add('ankle', tx(-0.37 * s, 0.37 * s, 0, -SHIN, 0.29, 18), 'joint', sh, bevel=0.02)
    # 脚（原点 = 踝轴，地面在 u = -FOOT）
    K.add('ft_body', prismX([(-0.56, -0.335), (-0.60, -0.16), (-0.32, 0.05), (0.26, 0.05), (0.80, -0.12), (0.88, -0.335)], -0.5, 0.5), 'main', ft, bevel=0.03, seg=2)
    for q in (-1, 1):
        K.add('ft_cheek', prismX([(-0.34, -0.1), (-0.22, 0.25), (0.18, 0.25), (0.34, -0.06)], q * 0.40, q * 0.5), 'sec', ft, bevel=0.015)
        K.add('ft_toe', prismX([(0.78, -0.335), (0.80, -0.09), (1.12, -0.14), (1.32, -0.27), (1.34, -0.335)], q * 0.27 - 0.2, q * 0.27 + 0.2), 'sec', ft, bevel=0.025, seg=2)
        K.add('ft_claw', prismX([(1.27, -0.335), (1.28, -0.2), (1.37, -0.245), (1.46, -0.335)], q * 0.27 - 0.15, q * 0.27 + 0.15), 'joint', ft, bevel=0.012)
        piston(K, ft, (q * 0.27, 0.3, 0.02), (q * 0.27, 0.95, -0.14), r=0.045, split=0.5)
        bolts(K, ft, [(q * 0.5, -0.18, 0.1), (q * 0.5, 0.12, 0.1), (q * 0.5, -0.4, -0.2), (q * 0.5, 0.5, -0.2)], (q, 0, 0), r=0.03)
    K.add('ft_heel', prismX([(-0.54, -0.335), (-0.56, -0.08), (-0.84, -0.18), (-1.0, -0.335)], -0.26, 0.26), 'joint', ft, bevel=0.015)
    K.add('ft_sole', box(0.92, 1.4, 0.03, (0, 0.15, -0.347)), 'dark', ft, bevel=0.008)
    K.add('ft_stripe', prismX([(0.34, 0.03), (0.62, -0.058), (0.625, -0.04), (0.345, 0.048)], -0.502, 0.502), 'accent', ft, bevel=0.004)


# ---------------- 机体 ----------------
def build_mech(K):
    K.node('pelvis', (0, 0, HIP)); K.node('torso', (0, 0, TOR))
    for s, n in ((-1, 'L'), (1, 'R')):
        K.node('thigh' + n, (s * 0.95, 0, HIP)); K.node('shin' + n, (s * 0.95, 0, HIP - THIGH)); K.node('foot' + n, (s * 0.95, 0, HIP - THIGH - SHIN))
        leg(K, s, n)
    K.node('armR', (1.5, 0, TOR + 1.75)); K.node('armL', (-1.5, 0, TOR + 1.75))
    K.node('barrel', (1.9, 0, TOR + 0.75)); K.node('foreL', (-1.88, 0, TOR + 0.75)); K.node('fistL', (-1.88, 0, TOR + 0.75))
    K.node('hatch', (0, 0.74, TOR + 2.10)); K.node('head', (0.42, 0.22, TOR + 2.2))
    K.node('lidA', (-1.5, 0.575, TOR + 3.05)); K.node('lidB', (-1.5, 0.575, TOR + 2.43))
    for nm, p in (('muzzle', (1.9, 3.65, TOR + 0.75)), ('pod', (-1.5, 0.6, TOR + 2.72)), ('eye', (0, 1.36, TOR + 1.75)), ('core', (0, 1.47, TOR + 1.0)), ('eject', (2.31, 0.32, TOR + 0.86)),
                  ('jetL', (-0.56, -1.4, TOR + 0.35)), ('jetR', (0.56, -1.4, TOR + 0.35)), ('exhL', (-0.52, -1.18, TOR + 2.66)), ('exhR', (0.52, -1.18, TOR + 2.66)), ('fist', (-1.88, 2.1, TOR + 0.75)),
                  ('decalA', (2.224, 0.0, TOR + 2.13)), ('decalB', (-2.0305, -0.14, TOR + 2.74))):
        empty(nm, p)

    # ---- 骨盆 ----
    P = 'pelvis'
    K.add('pel_core', loft([octs(-0.55, 0.50, -0.28, 0.22, 0.08), octs(-0.2, 0.60, -0.36, 0.30, 0.1), octs(0.3, 0.60, -0.36, 0.30, 0.1), octs(0.6, 0.48, -0.30, 0.2, 0.08)]), 'sec', P, bevel=0.02, seg=2)
    for s in (-1, 1):
        K.add('pel_hip', tx(0.5 * s, 0.75 * s, 0, 0, 0.45, 20), 'joint', P, bevel=0.02)
        K.add('pel_skirt', box(0.30, 0.07, 0.56, (s * 0.52, 0.66, -0.06), (0.1, 0, -s * 0.5)), 'main', P, bevel=0.02, seg=2)
        piston(K, P, (s * 0.42, -0.5, 0.1), (s * 0.62, -0.42, -0.3), r=0.05)
    K.add('pel_front', prismX([(0.52, 0.30), (0.79, 0.18), (0.87, -0.25), (0.70, -0.64), (0.50, -0.56), (0.56, -0.2)], -0.33, 0.33), 'main', P, bevel=0.03, seg=2)
    K.add('pel_fstripe', prismX([(0.80, 0.12), (0.82, 0.12), (0.875, -0.16), (0.855, -0.16)], -0.332, 0.332), 'accent', P, bevel=0.004)
    K.add('pel_rear', prismX([(-0.5, 0.26), (-0.78, 0.12), (-0.83, -0.3), (-0.6, -0.52), (-0.5, -0.3)], -0.34, 0.34), 'sec', P, bevel=0.02, seg=2)
    K.add('waist', tu(0.2, 0.40, 0, 0, 0.68, 24), 'joint', P, bevel=0.02)
    K.add('waist_seal', tu(0.40, 0.47, 0, 0, 0.56, 20), 'dark', P, bevel=0.01)
    bolts(K, P, [(0.6 * math.cos(a), 0.6 * math.sin(a), 0.40) for a in [k * math.pi / 8 for k in range(16)]], (0, 0, 1), r=0.03)

    # ---- 躯干 ----
    T = 'torso'
    K.add('hull', loft([octs(-1.0, 0.92, 0.55, 1.95, 0.22, 0.2), octs(-0.6, 1.12, 0.32, 2.2, 0.22, 0.22), octs(0.45, 1.12, 0.30, 2.2, 0.22, 0.25), octs(0.82, 0.96, 0.36, 2.06, 0.3, 0.3)]), 'main', T, bevel=0.03, seg=2)
    K.add('collar', tu(0.05, 0.33, 0, 0, 0.62, 22), 'joint', T, bevel=0.02)
    K.add('chin', loft([octs(0.80, 0.78, 0.40, 1.30, 0.12, 0.22), octs(1.18, 0.62, 0.62, 1.27, 0.10, 0.2), octs(1.36, 0.46, 0.78, 1.22, 0.08, 0.14)]), 'main', T, bevel=0.025, seg=2)
    K.add('core_ring', tf(1.34, 1.44, 0, 1.0, 0.205, 18), 'joint', T, bevel=0.012)
    K.add('core_lens', tf(1.40, 1.458, 0, 1.0, 0.15, 18), 'core', T, bevel=0.01)
    for a in range(4):
        an = math.pi / 4 + a * math.pi / 2
        K.add('core_clamp', box(0.07, 0.1, 0.11, (0.2 * math.cos(an), 1.40, 1.0 + 0.2 * math.sin(an)), (0, an - math.pi / 2, 0)), 'sec', T, bevel=0.008)
    # 座舱内部（开盖时可见）
    K.add('ck_tub', loft([octs(0.84, 0.6, 1.30, 2.0, 0.2, 0.04), octs(0.9, 0.58, 1.30, 1.98, 0.2, 0.04)]), 'dark', T, bevel=0)
    K.add('ck_seat', box(0.5, 0.1, 0.62, (0, 0.96, 1.66), (-0.12, 0, 0)), 'dark', T, bevel=0.02)
    K.add('ck_seatb', box(0.5, 0.4, 0.1, (0, 1.12, 1.38)), 'dark', T, bevel=0.02)
    K.add('ck_head', box(0.26, 0.1, 0.18, (0, 0.93, 2.0)), 'sec', T, bevel=0.02)
    for s in (-1, 1):
        K.add('ck_cons', box(0.16, 0.3, 0.14, (s * 0.42, 1.14, 1.4)), 'sec', T, bevel=0.012)
        K.add('ck_scr', box(0.12, 0.012, 0.09, (s * 0.42, 1.2, 1.51), (0.5, 0, 0)), 'glow', T, bevel=0)
    # 肩座与肩甲
    for s in (-1, 1):
        K.add('sh_mount', tx(1.08 * s, 1.31 * s, 0, 1.75, 0.44, 20), 'joint', T, bevel=0.02)
        K.add('pauldron', prismF([(1.0 * s, 2.24), (1.9 * s, 2.46), (2.22 * s, 2.24), (2.22 * s, 1.88), (2.1 * s, 1.84), (2.08 * s, 2.16), (1.88 * s, 2.28), (1.0 * s, 2.1)], -0.7, 0.7), 'main', T, bevel=0.03, seg=2)
        K.add('pd_rim', prismF([(2.225 * s, 2.0), (2.25 * s, 2.0), (2.25 * s, 1.9), (2.225 * s, 1.9)], -0.6, 0.6), 'sec', T, bevel=0.006)
        K.add('pd_stripe', prismF([(1.5 * s, 2.352), (1.76 * s, 2.416), (1.76 * s, 2.446), (1.5 * s, 2.382)], -0.712, 0.712), 'accent', T, bevel=0.004)
        K.add('pd_brace', box(0.5, 0.5, 0.12, (1.2 * s, 0, 2.13)), 'sec', T, bevel=0.015)
        bolts(K, T, [(s * x, f, 2.24 + (x - 1.0) * 0.2444 + 0.006) for x in (1.12, 1.38) for f in (-0.6, 0.6)], (-0.24 * s, 0, 1), r=0.034)
        bolts(K, T, [(s * 2.22, f, 2.1) for f in (-0.56, 0, 0.56)], (s, 0, 0), r=0.034)
        # 进气口（座舱两侧）
        K.add('intake', box(0.26, 0.32, 0.56, (s * 0.93, 0.84, 0.86)), 'sec', T, bevel=0.02)
        for i in range(4): K.add('intake_s', box(0.2, 0.05, 0.04, (s * 0.93, 0.99, 0.69 + i * 0.11), (0.5, 0, 0)), 'dark', T, bevel=0)
        # 侧面检修板、百叶、色带
        K.add('side_panel', box(0.05, 0.92, 0.72, (s * 1.122, -0.07, 1.02)), 'sec', T, bevel=0.012)
        bolts(K, T, [(s * 1.147, -0.07 + a * 0.4, 1.02 + b * 0.3) for a in (-1, 1) for b in (-1, 1)], (s, 0, 0))
        for i in range(4): K.add('louver', box(0.03, 0.56, 0.05, (s * 1.15, -0.07, 0.86 + i * 0.105), (0, s * 0.5, 0)), 'dark', T, bevel=0)
        # 跳跃推进器
        a = V((s * 0.56, -0.98, 0.64)); b = V((s * 0.56, -1.38, 0.36)); d = (b - a).normalized()
        K.add('jet', tube(a, b, 0.15, 0.24, seg=14), 'joint', T, bevel=0.012)
        K.add('jet_glow', tube(b - d * 0.02, b + d * 0.006, 0.2, seg=14), 'vent', T, bevel=0)
        # 排气管
        K.add('stack', tu(1.8, 2.62, s * 0.52, -1.18, 0.14, 14), 'joint', T, bevel=0.012)
        K.add('stack_in', tu(2.6, 2.628, s * 0.52, -1.18, 0.105, 12), 'dark', T, bevel=0)
        K.add('stack_wrap', tu(2.0, 2.42, s * 0.52, -1.18, 0.165, 14), 'sec', T, bevel=0.01)
        # 散热格栅
        sx = s * 0.34
        K.add('rad_glow', box(0.5, 0.02, 0.72, (sx, -1.468, 1.24)), 'vent', T, bevel=0)
        for i in range(8): K.add('rad_slat', box(0.54, 0.075, 0.03, (sx, -1.5, 0.925 + i * 0.09), (0.6, 0, 0)), 'dark', T, bevel=0)
        for u in (0.865, 1.615): K.add('rad_fr', box(0.6, 0.08, 0.04, (sx, -1.49, u)), 'joint', T, bevel=0.006)
        for q in (-1, 1): K.add('rad_fr', box(0.04, 0.08, 0.79, (sx + q * 0.29, -1.49, 1.24)), 'joint', T, bevel=0.006)
    K.add('engine', loft([octs(-1.0, 0.78, 0.62, 1.86, 0.15), octs(-1.46, 0.66, 0.72, 1.76, 0.15)]), 'sec', T, bevel=0.02, seg=2)
    K.add('eng_top', box(0.9, 0.36, 0.08, (0, -1.2, 1.87), (0.2, 0, 0)), 'main', T, bevel=0.015)
    for i in range(6): K.add('fin', box(0.028, 0.46, 0.14, (-0.62 + i * 0.1, -0.52, 2.26)), 'joint', T, bevel=0.004)
    K.add('fin_base', box(0.62, 0.5, 0.03, (-0.37, -0.52, 2.205)), 'sec', T, bevel=0.008)
    K.add('roof_hatch', box(0.56, 0.5, 0.035, (-0.36, 0.12, 2.208)), 'sec', T, bevel=0.01)
    bolts(K, T, [(-0.36 + a * 0.23, 0.12 + b * 0.2, 2.226) for a in (-1, 1) for b in (-1, 1)], (0, 0, 1))
    K.add('roof_handle', box(0.2, 0.03, 0.03, (-0.36, 0.12, 2.25)), 'joint', T, bevel=0.006)
    for s in (-1, 1): K.add('pipe', sweep([(s * 0.9, 0.72, 0.5), (s * 1.0, 0.3, 0.42), (s * 1.0, -0.5, 0.42), (s * 0.84, -0.95, 0.56)], 0.035), 'dark', T, bevel=0)
    # 火箭巢（左肩上方）
    px = -1.5
    K.add('pod_body', loft([octs(-0.78, 0.5, 2.47, 3.01, 0.1, 0.1, x=px), octs(0.5, 0.5, 2.44, 3.04, 0.08, 0.08, x=px)]), 'sec', T, bevel=0.02, seg=2)
    K.add('pod_face', box(0.9, 0.03, 0.5, (px, 0.505, 2.74)), 'dark', T, bevel=0)
    for i in range(4):
        for j in (-1, 1):
            x = px + (i - 1.5) * 0.225; u = 2.74 + j * 0.135
            K.add('pod_rim', tf(0.50, 0.545, x, u, 0.1, 12), 'joint', T, bevel=0.006)
            K.add('pod_tube', tf(0.53, 0.549, x, u, 0.078, 12), 'dark', T, bevel=0)
            K.add('pod_tip', tf(0.5, 0.556, x, u, 0.055, 8, r1=0.012), 'warn', T, bevel=0)
    for q in (-1, 1): K.add('pod_side', box(0.035, 1.02, 0.44, (px + q * 0.512, -0.14, 2.74)), 'main', T, bevel=0.012)
    K.add('pod_top', box(0.8, 1.02, 0.03, (px, -0.14, 3.05)), 'main', T, bevel=0.01)
    K.add('pod_rear', box(0.8, 0.03, 0.4, (px, -0.785, 2.74)), 'dark', T, bevel=0)
    for i in range(3): K.add('pod_bar', box(0.84, 0.04, 0.04, (px, -0.8, 2.6 + i * 0.14)), 'joint', T, bevel=0.006)
    K.add('pod_pylon', box(0.5, 0.74, 0.22, (px, -0.1, 2.365)), 'joint', T, bevel=0.02)
    bolts(K, T, [(px + q * 0.532, -0.14 + a * 0.44, 2.74 + b * 0.17) for q in (-1, 1) for a in (-1, 1) for b in (-1, 1)], (1, 0, 0))
    # 火箭巢盖
    for nm, sg in (('lidA', -1), ('lidB', 1)):
        K.add('lid', box(0.98, 0.035, 0.30, (0, 0, sg * 0.155)), 'main', nm, bevel=0.01)
        K.add('lid_hinge', tx(-0.5, 0.5, 0, 0, 0.028, 8), 'joint', nm, bevel=0)
        hazard(K, nm, (0.45, 0.0175, sg * 0.155 - 0.05), (-1, 0, 0), (0, 0, 1), 0.9, 0.1, n=7)

    # ---- 传感器头 ----
    H = 'head'
    K.add('neck', tu(0.0, 0.075, 0, 0, 0.27, 16), 'joint', H, bevel=0.012)
    K.add('hd_shell', loft([octs(-0.42, 0.28, 0.075, 0.42, 0.1, 0.06), octs(0.2, 0.34, 0.075, 0.5, 0.12, 0.06), octs(0.5, 0.27, 0.12, 0.42, 0.1, 0.06)]), 'main', H, bevel=0.02, seg=2)
    K.add('hd_visor', box(0.44, 0.03, 0.085, (0, 0.502, 0.285)), 'eye', H, bevel=0)
    K.add('hd_brow', box(0.52, 0.12, 0.035, (0, 0.49, 0.36), (-0.25, 0, 0)), 'sec', H, bevel=0.008)
    K.add('hd_jaw', box(0.4, 0.08, 0.05, (0, 0.5, 0.2)), 'sec', H, bevel=0.008)
    for s in (-1, 1): K.add('hd_cheek', box(0.05, 0.3, 0.2, (s * 0.345, 0.26, 0.27)), 'sec', H, bevel=0.012)
    K.add('hd_cam', tf(0.08, 0.47, 0.45, 0.25, 0.09, 12), 'sec', H, bevel=0.01)
    K.add('hd_lens', tf(0.455, 0.482, 0.45, 0.25, 0.062, 12), 'eye', H, bevel=0)
    K.add('hd_rf', box(0.1, 0.42, 0.12, (-0.43, 0.2, 0.3)), 'sec', H, bevel=0.012)
    K.add('hd_rfl', box(0.06, 0.01, 0.07, (-0.43, 0.412, 0.3)), 'dark', H, bevel=0)
    K.add('hd_rear', box(0.4, 0.16, 0.22, (0, -0.46, 0.24)), 'sec', H, bevel=0.015)
    K.add('ant1', tube((-0.18, -0.36, 0.4), (-0.18, -0.52, 1.3), 0.016, 0.007, seg=6), 'joint', H, bevel=0)
    K.add('ant2', tube((0.2, -0.38, 0.4), (0.2, -0.46, 0.92), 0.013, 0.006, seg=6), 'joint', H, bevel=0)
    for x in (-0.18, 0.2): K.add('ant_b', box(0.06, 0.06, 0.08, (x, -0.37, 0.4)), 'sec', H, bevel=0.006)

    # ---- 座舱盖（节点原点 = 顶部铰链）----
    C = 'hatch'; o = V((0, -0.74, -2.10))
    sh = lambda secs: [[p + o for p in sec] for sec in secs]
    K.add('cn_glass', loft(sh([octs(0.76, 0.69, 1.385, 2.07, 0.27, 0.05), octs(1.03, 0.62, 1.385, 1.96, 0.3, 0.05), octs(1.31, 0.44, 1.39, 1.70, 0.2, 0.05)])), 'glass', C, bevel=0.012)
    K.add('cn_sill', loft(sh([octs(0.74, 0.77, 1.30, 1.40, 0.03), octs(1.05, 0.68, 1.29, 1.40, 0.03), octs(1.35, 0.50, 1.27, 1.40, 0.03)])), 'main', C, bevel=0.012)
    K.add('cn_hoop0', loft(sh([octs(0.72, 0.715, 1.36, 2.10, 0.27, 0.05), octs(0.80, 0.70, 1.36, 2.075, 0.28, 0.05)])), 'main', C, bevel=0.012)
    K.add('cn_hoop1', loft(sh([octs(1.0, 0.645, 1.37, 1.99, 0.3, 0.05), octs(1.06, 0.63, 1.37, 1.97, 0.3, 0.05)])), 'main', C, bevel=0.01)
    K.add('cn_nose', loft(sh([octs(1.28, 0.475, 1.38, 1.5, 0.05), octs(1.35, 0.44, 1.38, 1.47, 0.05)])), 'main', C, bevel=0.012)
    K.add('cn_spine', xform(prismX([(0.72, 2.07), (0.72, 2.13), (1.04, 2.01), (1.31, 1.75), (1.28, 1.71), (1.02, 1.955)], -0.06, 0.06), Matrix.Translation(o)), 'main', C, bevel=0.012)
    K.add('cn_hinge', tx(-0.4, 0.4, 0, 0.02, 0.05, 10), 'joint', C, bevel=0.006)
    for s in (-1, 1): K.add('cn_grip', box(0.03, 0.2, 0.03, V((s * 0.6, 1.2, 1.44)) + o), 'joint', C, bevel=0.006)

    # ---- 右臂：三管机炮 ----
    A = 'armR'; gx = 0.4; gu = -1.0
    K.add('sh_r', tx(-0.19, 0.16, 0, 0, 0.36, 20), 'joint', A, bevel=0.02)
    K.add('ua_r', loft([octu(0.02, 0.24, -0.30, 0.30, 0.07, x=0.38), octu(-0.85, 0.22, -0.26, 0.26, 0.07, x=0.38)]), 'sec', A, bevel=0.02, seg=2)
    K.add('ua_r_plate', prismX([(-0.34, 0.08), (0.34, 0.08), (0.30, -0.72), (-0.30, -0.72)], 0.60, 0.69), 'main', A, bevel=0.02, seg=2)
    bolts(K, A, [(0.69, a * 0.24, b) for a in (-1, 1) for b in (-0.02, -0.62)], (1, 0, 0))
    K.add('el_r', tx(0.04, 0.76, 0, gu, 0.30, 18), 'joint', A, bevel=0.02)
    K.add('gun_body', loft([octs(-1.05, 0.30, gu - 0.30, gu + 0.28, 0.1, x=gx), octs(-0.5, 0.36, gu - 0.36, gu + 0.34, 0.1, x=gx), octs(1.0, 0.36, gu - 0.36, gu + 0.34, 0.1, x=gx), octs(1.25, 0.30, gu - 0.30, gu + 0.30, 0.1, x=gx)]), 'sec', A, bevel=0.02, seg=2)
    K.add('gun_top', loft([octs(-0.62, 0.33, gu + 0.335, gu + 0.42, 0.05, x=gx), octs(0.96, 0.33, gu + 0.335, gu + 0.42, 0.05, x=gx)]), 'main', A, bevel=0.015, seg=2)
    K.add('gun_stripe', box(0.672, 0.16, 0.03, (gx, 0.6, gu + 0.412)), 'accent', A, bevel=0.004)
    K.add('gun_port', box(0.02, 0.34, 0.16, (gx + 0.362, 0.32, gu + 0.12)), 'dark', A, bevel=0)
    K.add('gun_defl', box(0.1, 0.06, 0.2, (gx + 0.4, 0.1, gu + 0.12), (0, 0, 0.5)), 'joint', A, bevel=0.008)
    K.add('gun_sight', box(0.16, 0.3, 0.14, (gx - 0.12, 0.5, gu + 0.49)), 'sec', A, bevel=0.012)
    K.add('gun_sight_l', box(0.1, 0.012, 0.08, (gx - 0.12, 0.654, gu + 0.49)), 'eye', A, bevel=0)
    for f in (-0.3, 0.3, 0.9): bolts(K, A, [(gx + 0.362, f, gu - 0.2), (gx - 0.362, f, gu - 0.2)], (1, 0, 0))
    # 弹鼓与供弹槽
    K.add('drum', tx(0.06, 0.74, 0.22, gu - 0.68, 0.38, 20), 'sec', A, bevel=0.02)
    for x in (0.1, 0.4, 0.7): K.add('drum_band', tx(x - 0.03, x + 0.03, 0.22, gu - 0.68, 0.395, 20), 'joint', A, bevel=0.006)
    K.add('drum_cap', tx(0.74, 0.78, 0.22, gu - 0.68, 0.2, 12), 'warn', A, bevel=0.008)
    path = [(gx, -0.12, gu - 0.84), (gx, -0.45, gu - 0.86), (gx, -0.78, gu - 0.7), (gx, -0.92, gu - 0.42)]
    for i in range(7):
        t = i / 6 * (len(path) - 1); k = min(int(t), len(path) - 2); p = V(path[k]).lerp(V(path[k + 1]), t - k); d = V(path[k + 1]) - V(path[k])
        K.add('chute', box(0.3, 0.13, 0.2, p, (math.atan2(d.z, d.y), 0, 0)), 'joint', A, bevel=0.01)
    # 炮管护罩（开放式框架）+ 后坐缓冲
    K.add('shroud0', tf(1.22, 1.46, gx, gu, 0.31, 12), 'joint', A, bevel=0.012)
    K.add('shroud1', tf(2.18, 2.34, gx, gu, 0.30, 12), 'joint', A, bevel=0.012)
    for a in range(4):
        an = math.pi / 4 + a * math.pi / 2
        K.add('shroud_bar', box(0.07, 0.78, 0.05, (gx + 0.275 * math.cos(an), 1.82, gu + 0.275 * math.sin(an)), (0, an - math.pi / 2, 0)), 'joint', A, bevel=0.008)
    K.add('shroud_top', loft([octs(1.3, 0.2, gu + 0.3, gu + 0.37, 0.04, x=gx), octs(2.3, 0.16, gu + 0.29, gu + 0.35, 0.04, x=gx)]), 'main', A, bevel=0.012)
    for s in (-1, 1): piston(K, A, (gx + s * 0.3, 0.2, gu - 0.3), (gx + s * 0.3, 1.36, gu - 0.24), r=0.05, split=0.6)
    piston(K, A, (0.38, -0.34, -0.25), (0.4, -0.8, gu + 0.2), r=0.06)
    # 炮管束（节点原点在炮轴上）
    B = 'barrel'
    K.add('spindle', tf(1.2, 3.3, 0, 0, 0.055, 8), 'joint', B, bevel=0)
    for k in range(3):
        an = math.pi / 2 + k * 2 * math.pi / 3; x = 0.15 * math.cos(an); u = 0.15 * math.sin(an)
        K.add('tube', tf(1.2, 3.5, x, u, 0.078, 12), 'joint', B, bevel=0.006)
        K.add('tube_tip', tf(3.46, 3.64, x, u, 0.097, 12), 'heat', B, bevel=0.008)
        K.add('tube_bore', tf(3.63, 3.645, x, u, 0.05, 10), 'dark', B, bevel=0)
    for f0, f1, r in ((2.5, 2.58, 0.265), (3.28, 3.36, 0.255), (1.5, 1.56, 0.265)): K.add('clamp', tf(f0, f1, 0, 0, r, 12), 'heat' if f0 > 3 else 'joint', B, bevel=0.008)

    # ---- 左臂：动力拳 ----
    L = 'armL'
    K.add('sh_l', tx(-0.16, 0.19, 0, 0, 0.36, 20), 'joint', L, bevel=0.02)
    K.add('ua_l', loft([octu(0.02, 0.24, -0.30, 0.30, 0.07, x=-0.38), octu(-0.85, 0.22, -0.26, 0.26, 0.07, x=-0.38)]), 'sec', L, bevel=0.02, seg=2)
    K.add('ua_l_plate', prismX([(-0.34, 0.08), (0.34, 0.08), (0.30, -0.72), (-0.30, -0.72)], -0.69, -0.60), 'main', L, bevel=0.02, seg=2)
    bolts(K, L, [(-0.69, a * 0.24, b) for a in (-1, 1) for b in (-0.02, -0.62)], (-1, 0, 0))
    K.add('el_l', tx(-0.76, -0.04, 0, -1.0, 0.30, 18), 'joint', L, bevel=0.02)
    piston(K, L, (-0.38, -0.34, -0.25), (-0.38, -0.5, -0.9), r=0.06)
    Fo = 'foreL'
    K.add('fa', loft([octs(-0.3, 0.24, -0.26, 0.26, 0.09), octs(0.2, 0.30, -0.32, 0.32, 0.1), octs(1.12, 0.28, -0.30, 0.30, 0.1)]), 'main', Fo, bevel=0.025, seg=2)
    K.add('fa_stripe', box(0.604, 0.14, 0.4, (0, 0.5, 0.125)), 'accent', Fo, bevel=0.004)
    K.add('fa_sleeve', tf(1.12, 1.3, 0, 0, 0.215, 14), 'joint', Fo, bevel=0.012)
    K.add('fa_shield', prismX([(-0.32, 0.44), (0.95, 0.52), (1.22, 0.22), (1.22, -0.3), (0.9, -0.5), (-0.32, -0.44)], -0.40, -0.33), 'sec', Fo, bevel=0.02, seg=2)
    K.add('fa_glow', box(0.02, 0.62, 0.05, (-0.405, 0.42, 0.02)), 'glow', Fo, bevel=0)
    hazard(K, Fo, (-0.402, 0.85, -0.42), (0, -1, 0), (0, 0, 1), 0.8, 0.1, n=6)
    bolts(K, Fo, [(-0.4, f, u) for f, u in ((-0.2, 0.34), (0.9, 0.4), (-0.2, -0.34), (0.86, -0.4))], (-1, 0, 0))
    for s in (-1, 1): piston(K, Fo, (0.31 * s if s > 0 else 0.0, 0.0, 0.33 if s < 0 else 0.0), (0.31 * s if s > 0 else 0.0, 1.0, 0.31 if s < 0 else 0.0), r=0.045, split=0.6)
    Fi = 'fistL'
    K.add('ram', tf(0.2, 1.42, 0, 0, 0.12, 12), 'joint', Fi, bevel=0.006)
    K.add('wrist', tf(1.3, 1.42, 0, 0, 0.25, 14), 'joint', Fi, bevel=0.012)
    K.add('palm', loft([octs(1.40, 0.27, -0.27, 0.27, 0.08), octs(1.74, 0.31, -0.31, 0.31, 0.09)]), 'sec', Fi, bevel=0.02, seg=2)
    K.add('knuckle', box(0.66, 0.1, 0.3, (0, 1.78, 0.14)), 'joint', Fi, bevel=0.02)
    for i in range(3):
        x = (i - 1) * 0.215
        K.add('finger', box(0.18, 0.3, 0.19, (x, 1.93, 0.16)), 'sec', Fi, bevel=0.02)
        K.add('finger2', box(0.18, 0.17, 0.3, (x, 2.02, -0.04)), 'sec', Fi, bevel=0.02)
        K.add('stud', tf(2.08, 2.14, x, 0.17, 0.06, 8), 'joint', Fi, bevel=0.008)
    K.add('thumb', box(0.15, 0.34, 0.17, (0.3, 1.86, -0.17), (0, 0, -0.3)), 'sec', Fi, bevel=0.02)


# ---------------- 第一人称座舱（视图空间）----------------
# 眼睛在原点，视线朝 +F，垂直视野 82°（下沿约 41°）。仪表面都垂直于视线摆放，屏幕不变形；
# 中央面板抬高成遮光罩下的主仪表；两块翼面板绕立轴向驾驶员内收 PSI，同时外侧抬高（斜率 ROLL）——离眼睛越近的东西在画面上越靠下，
# 不抬的话翼屏的外半边会掉到视野下沿之外。翼面板是梯形，上沿向外降低，把两侧下角让给窗外的机炮和动力拳。
# 屏幕 / 告警条 / 面板刻字是 src/ui/cockpit.js 里的画布贴图，按同一组常数摆放：改这里要同步改那边。
PSI = math.radians(10); ROLL = 0.16
HC = 0.205; HW = 0.185; WT = 0.155; WW = 0.36     # 中央面高、翼面内侧高、翼面外侧高、翼面宽
FC_O = (0.0, 0.50, -0.46)             # 中央面板下沿中点；面内“上”方向 = (0, 0.6, 0.8)


class Face:
    """一块仪表面：原点 o，右 ax、上 ay，n = 朝驾驶员的法线。P(s, t, d) = o + ax·s + ay·t + n·d"""
    def __init__(self, K, grp, o, ax, ay):
        self.K = K; self.grp = grp; self.o = V(o); self.ax = V(ax).normalized(); self.ay = V(ay).normalized(); self.n = self.ax.cross(self.ay).normalized()

    def P(self, s, t, d=0.0): return self.o + self.ax * s + self.ay * t + self.n * d

    def slab(self, name, s0, t0, s1, t1, d0, d1, mat, bevel=0.0):
        q = lambda d: [self.P(s0, t0, d), self.P(s1, t0, d), self.P(s1, t1, d), self.P(s0, t1, d)]
        return self.K.add(name, loft([q(d0), q(d1)]), mat, self.grp, bevel=bevel)

    def rr(self, name, sc, tc, hw, hh, r, d0, d1, mat, bevel=0.0):
        return self.K.add(name, loft([rrect(self.P(sc, tc, d0), self.ax, self.ay, hw, hh, r), rrect(self.P(sc, tc, d1), self.ax, self.ay, hw, hh, r)]), mat, self.grp, bevel=bevel)

    def poly(self, name, pts, d0, d1, mat, bevel=0.0):
        return self.K.add(name, loft([[self.P(a, b, d) for a, b in pts] for d in (d0, d1)]), mat, self.grp, bevel=bevel)

    def rod(self, name, s, t, d0, d1, r, mat, r1=None, seg=8, ds=0.0, dt=0.0):
        return self.K.add(name, tube(self.P(s, t, d0), self.P(s + ds, t + dt, d1), r, r1, seg=seg), mat, self.grp, bevel=0)

    def mfd(self, sc, tc, hw, hh, keys=5):
        """多功能显示器：厚边框 + 屏幕底板 + 两侧的边框按键（屏幕本身是游戏里的画布贴图，贴在 d = 0.0125）。"""
        self.rr('bezel', sc, tc, hw, hh, 0.012, 0.0, 0.011, 'ckFrame', bevel=0.002)
        self.slab('scr_back', sc - hw + 0.022, tc - hh + 0.011, sc + hw - 0.022, tc + hh - 0.011, 0.011, 0.0118, 'dark')
        for sd in (-1, 1):
            for i in range(keys):
                t = tc + (i - (keys - 1) / 2) * (2 * hh - 0.04) / (keys - 1); s = sc + sd * (hw - 0.011)
                self.slab('key', s - 0.0055, t - 0.0065, s + 0.0055, t + 0.0065, 0.011, 0.0146, 'ckTrim')
        for a in (-1, 1):
            for b in (-1, 1): self.rod('bz_screw', sc + a * (hw - 0.011), tc + b * (hh - 0.0055), 0.011, 0.0124, 0.0028, 'ckTrim', seg=6)

    def knob(self, s, t, r=0.011, h=0.015, ang=0.0):
        self.rod('knob_skirt', s, t, 0.0, 0.003, r * 1.3, 'ckTrim', seg=12)
        self.rod('knob', s, t, 0.003, h, r, 'ckFrame', r1=r * 0.86, seg=12)
        ca, sa = math.cos(ang), math.sin(ang); q = ((-0.0013, 0.0), (0.0013, 0.0), (0.0013, r * 0.8), (-0.0013, r * 0.8))
        self.K.add('knob_mark', loft([[self.P(s + ca * a - sa * b, t + sa * a + ca * b, d) for a, b in q] for d in (h - 0.0004, h + 0.0007)]), 'ckLampC', self.grp, bevel=0)

    def toggle(self, s, t, up=1):
        self.rod('tog_nut', s, t, 0.0, 0.004, 0.0065, 'ckTrim', seg=6)
        self.rod('tog', s, t, 0.004, 0.025, 0.0026, 'ckTrim', r1=0.0037, seg=6, dt=up * 0.009)

    def lamp(self, s, t, w, h, mat): self.slab('lamp', s - w / 2, t - h / 2, s + w / 2, t + h / 2, 0.0, 0.004, mat)


def beam(a, b, w, h, up=(0, -1, 0)):
    """矩形截面的梁：a → b，截面宽 w（垂直于 up）高 h。"""
    a = V(a); b = V(b); d = (b - a).normalized(); e1 = d.cross(V(up)).normalized(); e2 = e1.cross(d).normalized()
    sec = lambda c: [c + e1 * (w / 2) + e2 * (h / 2), c - e1 * (w / 2) + e2 * (h / 2), c - e1 * (w / 2) - e2 * (h / 2), c + e1 * (w / 2) - e2 * (h / 2)]
    return loft([sec(a), sec(b)])


def stick(K, name, x):
    """操纵杆（节点原点 = 底座球铰，游戏里按输入倾斜）：防尘套 + 杆 + 握把 + 杆头的帽形开关和红色按钮 + 扳机。"""
    s = 1 if x > 0 else -1
    K.node(name, (x, 0.44, 20 - 0.455))
    K.add('st_boot', loft([[V((0.034 * math.cos(a), 0.034 * math.sin(a), 0.0)) for a in [k * math.pi / 4 for k in range(8)]], [V((0.022 * math.cos(a), 0.022 * math.sin(a), 0.03)) for a in [k * math.pi / 4 for k in range(8)]],
                         [V((0.013 * math.cos(a), 0.013 * math.sin(a), 0.055)) for a in [k * math.pi / 4 for k in range(8)]]]), 'ckDark', name, bevel=0)
    K.add('st_shaft', tube((0, 0, 0.05), (0, 0.006, 0.105), 0.008, seg=8), 'ckTrim', name, bevel=0)
    K.add('st_grip', loft([[V((0.017 * math.cos(a), 0.004 + 0.02 * math.sin(a), 0.10)) for a in [k * math.pi / 4 for k in range(8)]], [V((0.019 * math.cos(a), 0.010 + 0.023 * math.sin(a), 0.15)) for a in [k * math.pi / 4 for k in range(8)]],
                         [V((0.018 * math.cos(a), 0.018 + 0.021 * math.sin(a), 0.195)) for a in [k * math.pi / 4 for k in range(8)]]]), 'ckDark', name, bevel=0)
    K.add('st_head', box(0.046, 0.05, 0.03, (0, 0.022, 0.208), (-0.25, 0, 0)), 'ckFrame', name, bevel=0.004)
    K.add('st_hat', tube((-0.01 * s, 0.012, 0.222), (-0.01 * s, 0.008, 0.234), 0.006, 0.0045, seg=8), 'ckTrim', name, bevel=0)
    K.add('st_btn', tube((0.011 * s, 0.012, 0.222), (0.011 * s, 0.009, 0.229), 0.0055, seg=8), 'ckLampR', name, bevel=0)
    K.add('st_trig', box(0.008, 0.012, 0.03, (0, 0.036, 0.165), (0.3, 0, 0)), 'ckLampR' if s > 0 else 'ckTrim', name, bevel=0)
    K.add('st_rest', box(0.05, 0.03, 0.008, (0, -0.012, 0.106), (0.15, 0, 0)), 'ckFrame', name, bevel=0.002)


def build_cockpit(K):
    K.node('cockpit', (0, 0, 20)); C = 'cockpit'
    cs, sn = math.cos(PSI), math.sin(PSI)
    FC = Face(K, C, FC_O, (1, 0, 0), (0, 0.6, 0.8))

    def wing(sg):   # s 始终朝 +x：右翼 s ∈ [0, WW]，左翼 s ∈ [-WW, 0]
        ax = V((cs, -sg * sn, sg * ROLL)).normalized(); ay0 = V((sg * 0.6 * sn, 0.6 * cs, 0.8)); ay = (ay0 - ax * ay0.dot(ax)).normalized()
        return Face(K, C, (sg * 0.26, 0.50, -0.46), ax, ay)
    FR = wing(1); FL = wing(-1)

    # ---- 中央面板：主屏 + 告警条 + 主警告 / 主注意灯 + 两列旋钮 ----
    FC.slab('pan_c', -0.262, -0.07, 0.262, HC, -0.06, 0.0, 'ckDark', bevel=0.003)
    FC.mfd(0, 0.082, 0.20, 0.078)
    FC.rr('ann_frame', 0, 0.182, 0.176, 0.0165, 0.004, 0.0, 0.007, 'ckFrame', bevel=0.0015)
    FC.slab('ann_back', -0.168, 0.169, 0.168, 0.195, 0.007, 0.0076, 'dark')
    FC.rr('mw_frame', -0.222, 0.182, 0.027, 0.018, 0.004, 0.0, 0.005, 'ckFrame', bevel=0.001); FC.rr('mw', -0.222, 0.182, 0.022, 0.013, 0.003, 0.005, 0.009, 'ckLampW', bevel=0.001)
    FC.rr('mc_frame', 0.222, 0.182, 0.027, 0.018, 0.004, 0.0, 0.005, 'ckFrame', bevel=0.001); FC.rr('mc', 0.222, 0.182, 0.022, 0.013, 0.003, 0.005, 0.009, 'ckLampA', bevel=0.001)
    for sd in (-1, 1):
        for j, t in enumerate((0.030, 0.078, 0.126)): FC.knob(sd * 0.232, t, ang=(j - 1) * 0.9 * sd)
    FC.slab('lip_c', -0.275, HC, 0.275, HC + 0.008, -0.06, 0.034, 'ckDark', bevel=0.002)   # 遮光檐
    FC.slab('lip_trim', -0.275, HC + 0.008, 0.275, HC + 0.0095, 0.024, 0.0345, 'ckFrame')

    # ---- 两块翼面板：右 = 武器，左 = 雷达 ----
    for Fw, sg in ((FR, 1), (FL, -1)):
        so = sg * WW
        Fw.poly('pan_w', [(-sg * 0.002, -0.07), (so + sg * 0.002, -0.07), (so + sg * 0.002, WT), (-sg * 0.002, HW)], -0.06, 0.0, 'ckDark', bevel=0.003)
        Fw.poly('lip_w', [(-sg * 0.004, HW), (so + sg * 0.004, WT), (so + sg * 0.004, WT + 0.007), (-sg * 0.004, HW + 0.007)], -0.06, 0.028, 'ckDark', bevel=0.002)
        Fw.mfd(sg * 0.158, 0.078, 0.146, 0.074, keys=4)
        for i in range(4): Fw.lamp(sg * (0.034 + i * 0.031), 0.1655, 0.022, 0.008, ('ckLampC', 'ckLampA', 'ckLampG')[i % 3])
        Fw.slab('col_plate', sg * 0.335 - 0.021, 0.008, sg * 0.335 + 0.021, 0.150, 0.0, 0.0025, 'ckFrame', bevel=0.001)
        for a in (-1, 1):
            for t in (0.013, 0.145): Fw.rod('col_screw', sg * 0.335 + a * 0.016, t, 0.0025, 0.004, 0.0026, 'ckTrim', seg=6)
    for i, t in enumerate((0.028, 0.056, 0.084)): FR.toggle(0.335, t, up=1 if i != 1 else -1)
    FR.slab('arm_base', 0.335 - 0.014, 0.104, 0.335 + 0.014, 0.140, 0.0025, 0.006, 'ckRed')          # 总保险：红色护盖翻起
    FR.slab('arm_cover', 0.335 - 0.014, 0.136, 0.335 + 0.014, 0.141, 0.006, 0.034, 'ckRed', bevel=0.001)
    FR.toggle(0.335, 0.120, up=1)
    FL.knob(-0.335, 0.034, r=0.013, ang=0.6); FL.knob(-0.335, 0.076, r=0.013, ang=-0.8)
    for i, t in enumerate((0.110, 0.134)): FL.toggle(-0.335, t, up=1 if i else -1)

    # ---- 仪表台顶面（遮光罩后面一直到风挡下沿）：中间高、两侧低 ----
    secs = []
    for x, fn, un, uw in ((-1.10, 0.42, -0.42, -0.50), (-0.66, 0.55, -0.33, -0.46), (-0.34, 0.62, -0.33, -0.42), (-0.30, 0.64, -0.30, -0.40), (0.30, 0.64, -0.30, -0.40), (0.34, 0.62, -0.33, -0.42), (0.66, 0.55, -0.33, -0.46), (1.10, 0.42, -0.42, -0.50)):
        secs.append([V((x, fn, un)), V((x, fn + 0.05, un + 0.012)), V((x, 0.93, uw)), V((x, 0.93, -0.76)), V((x, fn, -0.76))])
    K.add('deck', loft(secs), 'ckDark', C, bevel=0.004, seg=2)
    K.add('cowl', sweep([(-1.10, 0.93, -0.497), (-0.66, 0.93, -0.457), (-0.34, 0.93, -0.417), (-0.30, 0.93, -0.397), (0.30, 0.93, -0.397), (0.34, 0.93, -0.417), (0.66, 0.93, -0.457), (1.10, 0.93, -0.497)], 0.009, n=6), 'ckFrame', C, bevel=0)
    # 顶面上的东西：平视显示器的投影组件、除雾格栅、备用磁罗盘
    K.add('proj', box(0.11, 0.07, 0.02, (0, 0.76, -0.31), (-0.42, 0, 0)), 'ckFrame', C, bevel=0.003)
    K.add('proj_lens', box(0.07, 0.04, 0.004, (0, 0.752, -0.297), (-0.42, 0, 0)), 'ckLampC', C, bevel=0)
    for s in (-1, 1):
        for i in range(5): K.add('vent', box(0.11, 0.008, 0.004, (s * 0.165, 0.71 + i * 0.016, -0.2875 - i * 0.0072), (-0.42, 0, 0)), 'dark', C, bevel=0)
        K.add('vent_fr', box(0.13, 0.09, 0.004, (s * 0.165, 0.742, -0.3045), (-0.42, 0, 0)), 'ckFrame', C, bevel=0.001)
    K.add('compass', tube((0.245, 0.70, -0.292), (0.245, 0.70, -0.262), 0.021, 0.019, seg=12), 'ckFrame', C, bevel=0.002)
    K.add('compass_face', tube((0.245, 0.679, -0.277), (0.245, 0.6805, -0.277), 0.015, seg=12), 'ckLampA', C, bevel=0)

    # ---- 风挡立柱：加粗的箱梁 + 朝驾驶员一面的铆钉 + 沿柱走的线束 + 把手 ----
    for s in (-1, 1):
        a = V((s * 1.06, 0.93, -0.50)); b = V((s * 0.70, 0.72, 0.62)); d = (b - a).normalized()
        K.add('pillar', beam(a, b, 0.062, 0.046), 'ckFrame', C, bevel=0.006)
        K.add('pillar_in', beam(a + V((-s * 0.012, -0.024, 0)), b + V((-s * 0.012, -0.024, 0)), 0.03, 0.006), 'ckDark', C, bevel=0)
        bolts(K, C, [a + d * (0.18 + i * 0.19) + V((-s * 0.012, -0.028, 0)) for i in range(5)], (0, -1, 0), r=0.006, h=0.005, mat='ckTrim')
        K.add('pillar_foot', box(0.13, 0.09, 0.07, (s * 1.05, 0.915, -0.475)), 'ckFrame', C, bevel=0.01)
        K.add('gusset', box(0.14, 0.08, 0.09, (s * 0.71, 0.725, 0.59)), 'ckFrame', C, bevel=0.012)
        K.add('loom', sweep([a + V((s * 0.036, -0.01, 0.06)), a + d * 0.4 + V((s * 0.04, -0.004, 0)), a + d * 0.8 + V((s * 0.038, 0, 0)), b + V((s * 0.03, 0.0, -0.05))], 0.0075, n=6), 'dark', C, bevel=0)
        for q in (0.3, 0.62): K.add('loom_clip', box(0.03, 0.012, 0.014, a + d * (1.19 * q) + V((s * 0.036, -0.004, 0)), (0, 0, 0)), 'ckTrim', C, bevel=0)
        K.add('grab', sweep([V((s * 0.79, 0.735, 0.50)), V((s * 0.79, 0.70, 0.49)), V((s * 0.805, 0.70, 0.40)), V((s * 0.805, 0.745, 0.39))], 0.008, n=6), 'ckTrim', C, bevel=0)
        # 两侧的扶手台（平时在视野下沿之外，冲刺拉大视野或受击抖动时才露出来）
        K.add('side', prismX([(0.10, -0.76), (0.14, -0.475), (0.47, -0.43), (0.50, -0.76)], s * 0.66, s * 1.10), 'ckDark', C, bevel=0.008)

    # ---- 顶部仪表条：两排拨杆 / 指示灯、警示条、弹射拉环、阅读灯 ----
    K.add('header', prismX([(0.48, 0.74), (0.52, 0.61), (0.74, 0.545), (0.82, 0.60), (0.82, 0.74)], -0.82, 0.82), 'ckDark', C, bevel=0.012, seg=2)
    hd = V((0, 0.22, -0.065)).normalized(); hn = V((0, -0.065, -0.22)).normalized(); ang = math.atan2(-0.065, 0.22)
    K.add('header_pan', box(1.16, 0.17, 0.012, V((0, 0.64, 0.574)) + hn * 0.004, (ang, 0, 0)), 'ckFrame', C, bevel=0.004)
    for i in range(14):
        x = -0.565 + i * 0.087; base = V((x, 0.674, 0.5645)) + hn * 0.012
        if i % 5 == 2: K.add('h_lamp', box(0.034, 0.022, 0.008, base, (ang, 0, 0)), 'ckLampC' if i != 7 else 'ckLampA', C, bevel=0)
        else: K.add('h_tog', tube(base, base + hn * 0.024 + hd * (0.009 if i % 2 else -0.009), 0.0052, 0.0068, seg=6), 'ckTrim', C, bevel=0); K.add('h_nut', tube(base - hn * 0.002, base + hn * 0.004, 0.01, seg=6), 'ckTrim', C, bevel=0)
    for i in range(9):   # 第二排：断路器
        x = -0.35 + i * 0.0875; base = V((x, 0.628, 0.578)) + hn * 0.012
        K.add('h_brk', tube(base - hn * 0.002, base + hn * 0.012, 0.0085, seg=8), 'dark', C, bevel=0); K.add('h_brk_r', tube(base + hn * 0.012, base + hn * 0.0135, 0.006, seg=8), 'ckTrim', C, bevel=0)
    hazard(K, C, V((-0.56, 0.735, 0.5475)) + hn * 0.002, (1, 0, 0), -hd, 1.12, 0.022, n=16, th=0.003)
    # 弹射拉环（右上）：黄黑相间的 D 形环
    ring = [V((0.56, 0.70, 0.535)), V((0.535, 0.70, 0.50)), V((0.535, 0.70, 0.455)), V((0.56, 0.70, 0.435)), V((0.585, 0.70, 0.455)), V((0.585, 0.70, 0.50)), V((0.56, 0.70, 0.535))]
    K.add('eject_ring', sweep(ring, 0.0095, n=6), 'warn', C, bevel=0)
    for q in (1, 3, 5): K.add('eject_band', tube(ring[q] - (ring[q + 1] - ring[q - 1]).normalized() * 0.008, ring[q] + (ring[q + 1] - ring[q - 1]).normalized() * 0.008, 0.0105, seg=6), 'dark', C, bevel=0)
    K.add('eject_base', box(0.07, 0.03, 0.03, (0.56, 0.70, 0.548)), 'ckRed', C, bevel=0.003)
    # 阅读灯（左上）
    K.add('rlamp_arm', sweep([V((-0.56, 0.72, 0.555)), V((-0.56, 0.705, 0.52)), V((-0.545, 0.69, 0.492))], 0.006, n=6), 'ckTrim', C, bevel=0)
    K.add('rlamp', tube((-0.545, 0.69, 0.492), (-0.532, 0.672, 0.47), 0.014, 0.02, seg=10), 'ckFrame', C, bevel=0.001)
    K.add('rlamp_l', tube((-0.5325, 0.6725, 0.4705), (-0.5318, 0.6715, 0.4693), 0.016, seg=10), 'ckLampA', C, bevel=0)

    # ---- 操纵杆（独立节点，游戏里会动）----
    stick(K, 'ckStickR', 0.735); stick(K, 'ckStickL', -0.735)


def previews(tag, views, res=(1100, 620)):
    eng = setup_render(os.path.join(ROOT, 'assets', 'sky.hdr'), res=res)
    for nm, loc, look, kw in views: shoot(os.path.join(PRE, 'mech_%s.png' % nm), loc, look, **kw)
    print('[khamsin] previews done with', eng)


t0 = time.time(); reset(); K = MK()
build_mech(K); build_cockpit(K)
finish(K.objs, long=0.5, iters=2, wide=False); bake_ao(K.objs, dist=0.6, rays=24, off=0.004)
ck = [o for o in K.objs if o.parent and o.parent.name in ('cockpit', 'ckStickL', 'ckStickR')]; mo = [o for o in K.objs if o not in ck]
path = os.path.join(OUT, 'mech.glb'); export_glb(path); glbpack.pack(path)
print('[khamsin] mech: %d parts, %d verts, %d tris (cockpit %d parts, %d tris), %.2f MB, %.1fs' % (len(mo), *stats(mo), len(ck), stats(ck)[1], os.path.getsize(path) / 1048576, time.time() - t0))

if PREVIEW_ON:
    me = bpy.data.meshes.new('ground'); bm = box(60, 60, 0.02, (0, 0, -0.01)); bm.to_mesh(me); bm.free(); gr = bpy.data.objects.new('ground', me); bpy.context.scene.collection.objects.link(gr)
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.34, 0.24, 1); gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9; me.materials.append(gm)
    c = 3.2
    previews('all', [
        ('front', (0, 16, 3.4), (0, 0, c), dict(fov=27)), ('side', (16, 0, 3.4), (0, 0.3, c), dict(fov=27)), ('back', (0, -16, 3.6), (0, 0, c), dict(fov=27)),
        ('q34', (9.5, 11.5, 5.2), (0, 0.2, 3.1), dict(fov=30)), ('q34b', (-10, -10, 6.0), (0, 0, 3.2), dict(fov=30)),
        ('cannon', (5.2, 4.6, 4.6), (1.9, 1.3, 4.0), dict(fov=36)), ('pod', (-3.6, 4.4, 7.0), (-1.4, 0.2, 6.0), dict(fov=36)),
        ('head', (1.9, 3.6, 6.4), (0.2, 0.6, 5.2), dict(fov=36)), ('legs', (4.2, 4.6, 1.5), (0.3, 0, 1.3), dict(fov=40)), ('fist', (-4.6, 4.2, 4.6), (-1.9, 1.2, 4.0), dict(fov=36)),
    ])
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    shoot(os.path.join(PRE, 'mech_cockpit.png'), (0, 0, 20), (0, 1, 20), fov=82)
elif CK_PREVIEW:
    previews('cockpit', [('cockpit', (0, 0, 20), (0, 1, 20), dict(fov=82)), ('cockpit_dash', (0, 0.02, 20), (0, 0.6, 19.62), dict(fov=46)), ('cockpit_r', (0, 0, 20), (0.5, 0.62, 19.66), dict(fov=40)), ('cockpit_up', (0, 0, 20), (0.2, 0.7, 20.5), dict(fov=50))], res=(1280, 720))
