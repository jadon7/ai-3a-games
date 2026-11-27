# KHAMSIN 武器与手臂：Blender 无界面脚本化硬表面建模 → assets/models/*.glb
# 用法：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build_weapons.py -- [rifle|shotgun|rail|arms|all] [--preview]
import bpy, bmesh, sys, os, math, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import importlib, khlib, glbpack
importlib.reload(khlib)
from khlib import *

ROOT = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(ROOT, 'assets', 'models'); PRE = os.path.join(HERE, 'preview')
os.makedirs(OUT, exist_ok=True); os.makedirs(PRE, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
WHAT = [a for a in argv if not a.startswith('--')] or ['all']
PREVIEW = '--preview' in argv
BORE = 0.026; RT = 0.0685   # 枪管轴线高度；机匣顶导轨的齿顶高度


class Kit:
    """一把枪的零件容器：body 为静态件，其余为活动件的空物体节点。"""
    def __init__(self, groups=('body',)):
        self.g = {n: empty(n) for n in groups}; self.objs = []

    def add(self, name, bm, mat, group='body', **kw):
        o = obj(name, bm, mat, self.g[group], **kw); self.objs.append(o); return o

    def anchor(self, name, x, f, u): empty(name, (x, f, u))

    def done(self, name, t0):
        finish(self.objs); bake_ao(self.objs)
        v, t = stats(self.objs); path = os.path.join(OUT, name + '.glb'); export_glb(path); glbpack.pack(path)
        print('[khamsin] %s: %d parts, %d verts, %d tris, %.2f MB, %.1fs' % (name, len(self.objs), v, t, os.path.getsize(path) / 1048576, time.time() - t0))


def pins(K, f, u, r, hx, mat='metalBare', group='body'):
    for s in (-1, 1): K.add('pin', tube((s * (hx - 0.001), f, u), (s * (hx + 0.0012), f, u), r, seg=12), mat, group, bevel=0.0003)


def grip_group(K, grip_mat='poly'):
    """握把、扳机护圈、扳机（三把枪共用同一握持位置）。"""
    T = Vector((0, -0.068, -0.047)); Bq = Vector((0, -0.101, -0.166)); ax = (Bq - T).normalized(); p = Vector((0, -ax.z, ax.y))
    secs = [rrect(T + (Bq - T) * t, X, p, b, a, 0.010) for t, a, b in ((0, 0.0220, 0.0160), (0.12, 0.0228, 0.0172), (0.45, 0.0240, 0.0186), (0.8, 0.0252, 0.0182), (1.0, 0.0240, 0.0172))]
    K.add('grip', loft(secs), grip_mat, bevel=0.0008)
    K.add('grip_cap', loft([rrect(Bq, X, p, 0.0178, 0.0248, 0.010), rrect(Bq + ax * 0.004, X, p, 0.0165, 0.0235, 0.010)]), 'dark', bevel=0.0006)
    K.add('beaver', prism([(-0.088, -0.048), (-0.127, -0.031), (-0.131, -0.037), (-0.112, -0.060), (-0.094, -0.068)], 0.024), grip_mat, bevel=0.0015)
    K.add('tguard', strip([(-0.047, -0.050), (-0.045, -0.080), (-0.016, -0.094), (0.016, -0.088), (0.027, -0.072)], 0.014, 0.0034), 'metal', bevel=0.0006)
    K.add('trigger', strip([(0.0040, -0.034), (0.0016, -0.044), (0.0008, -0.054), (0.0022, -0.063), (0.0062, -0.071), (0.0125, -0.0765)], 0.0062, 0.0044), 'metalBare', bevel=0.0006)
    for i in range(6):   # 握把后背防滑筋
        c = T + (Bq - T) * (0.22 + i * 0.12) - p * 0.0238
        K.add('grip_rib', box(0.024, 0.0022, 0.0045, (c.x, c.y, c.z), (math.atan2(ax.z, ax.y), 0, 0)), grip_mat, bevel=0.0006)


def sweep(pts, r, n=8):
    """沿任意空间折线扫出圆管（线缆、吊环）：用平行移动的标架，转弯处截面不会塌。"""
    P = [Vector(p) for p in pts]; secs = []; up = None
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized() if up is None else (up - d * up.dot(d)).normalized()
        b = d.cross(a); up = a
        secs.append([p + a * (r * math.cos(2 * math.pi * k / n)) + b * (r * math.sin(2 * math.pi * k / n)) for k in range(n)])
    return loft(secs)


def screws(K, pts, normal, r=0.0030, h=0.0014, mat='metalBare', group='body'):
    """内六角螺丝：圆头 + 深色六角孔。pts 为螺丝头底面中心。"""
    n = Vector(normal).normalized()
    for p in pts:
        p = Vector(p)
        K.add('screw', orient(cyl(h, r, seg=12), p, n), mat, group, bevel=0.0003, sharp=30)
        K.add('screw_hex', orient(hexp(0.0003, r * 0.52), p + n * (h - 0.0001), n), 'dark', group, bevel=0)


def knob(K, name, origin, direction, length, r, teeth=12, mat='metal', group='body', cap='metalBare'):
    """滚花旋钮：滚花圈 + 端面盖。"""
    d = Vector(direction).normalized(); o = Vector(origin)
    K.add(name, orient(gear(length, r, r * 0.9, teeth), o, d), mat, group, bevel=0.0002, sharp=30)
    K.add(name + '_cap', orient(cyl(0.0012, r * 0.86, seg=16), o + d * length, d), cap, group, bevel=0.0004, sharp=30)


def stock_m4(K, mat='tan'):
    """可折叠伸缩托：铰链座 + 托杆 + 托体（镂空）+ 贴腮板 + 带防滑纹的橡胶托底板。"""
    hb = K.add('hinge_block', loft([octs(-0.196, 0.0200, 0.002, 0.056, 0.008, 0.003), octs(-0.168, 0.0215, -0.001, 0.058, 0.009, 0.003)]), 'metal', bevel=0.0012, seg=2)
    g = bmesh.new()
    for f_ in (-0.1745, -0.1805, -0.1865): join(g, box(0.0240, 0.0014, 0.0030, (0, f_, 0.0572)))          # 顶面横向铣线
    for s_ in (-1, 1): join(g, box(0.0018, 0.0180, 0.0140, (s_ * 0.0208, -0.1850, 0.0290)))                # 两侧浅凹面
    cut(hb, g)
    knob(K, 'hinge_latch', (-0.0199, -0.1850, 0.0290), (-1, 0, 0), 0.0034, 0.0052, 9)
    K.add('hinge_pin', tube((0.0150, -0.186, -0.004), (0.0150, -0.186, 0.0575), 0.0042, seg=14), 'metalBare', bevel=0.0005)
    K.add('hinge_cap', orient(hexp(0.0016, 0.0058), (0.0150, -0.186, 0.0575), (0, 0, 1)), 'metalBare', bevel=0.0004, sharp=30)
    screws(K, [(-0.0212, -0.1735, 0.0140), (-0.0212, -0.1735, 0.0450)], (-1, 0, 0), r=0.0026)
    K.add('strut', loft([octs(-0.300, 0.0150, 0.010, 0.046, 0.006, 0.006), octs(-0.196, 0.0165, 0.006, 0.050, 0.007, 0.006)]), 'metal', bevel=0.001, seg=2)
    for i in range(5): K.add('strut_notch', box(0.0345, 0.005, 0.004, (0, -0.215 - i * 0.016, 0.0065)), 'metal', bevel=0.0008)
    st = K.add('stock', loft([octs(-0.232, 0.0196, 0.004, 0.0540, 0.009, 0.006), octs(-0.300, 0.0214, -0.014, 0.0560, 0.010, 0.007), octs(-0.362, 0.0226, -0.060, 0.0560, 0.010, 0.008), octs(-0.404, 0.0232, -0.094, 0.0510, 0.008, 0.008)]), mat, bevel=0.0014, seg=2)
    cut(st, prism([(-0.292, -0.004), (-0.384, -0.004), (-0.391, -0.068), (-0.346, -0.044)], 0.08))             # 镂空三角
    cut(st, box(0.08, 0.020, 0.0055, (0, -0.388, 0.0105)))                                                          # 背带槽
    for s_ in (-1, 1): cut(st, box(0.0016, 0.070, 0.022, (s_ * 0.0206, -0.262, 0.030)))                             # 两侧浅凹面
    K.add('cheek', loft([octs(-0.236, 0.0170, 0.050, 0.0605, 0.006, 0.0005), octs(-0.352, 0.0186, 0.050, 0.0615, 0.007, 0.0005)]), mat, bevel=0.0012, seg=2)
    for i in range(6): K.add('cheek_rib', box(0.0200, 0.0026, 0.0016, (0, -0.250 - i * 0.017, 0.0616)), mat, bevel=0.0006)
    pad = K.add('buttpad', loft([octs(-0.404, 0.0240, -0.096, 0.0525, 0.009, 0.009), octs(-0.419, 0.0232, -0.094, 0.0510, 0.011, 0.011)]), 'rubber', bevel=0.0014, seg=2)
    g = bmesh.new()
    for i in range(11): join(g, box(0.06, 0.004, 0.0034, (0, -0.4195, -0.082 + i * 0.0122)))
    cut(pad, g)
    K.add('stock_lever', prism([(-0.262, -0.006), (-0.320, -0.020), (-0.320, -0.027), (-0.262, -0.015)], 0.017), mat, bevel=0.001)
    for s_ in (-1, 1):
        K.add('stock_qd', orient(cyl(0.0018, 0.0066, seg=14), (s_ * 0.0222, -0.384, 0.006), (s_, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
        K.add('stock_qd_hole', orient(cyl(0.0003, 0.0040, seg=12), (s_ * 0.0240, -0.384, 0.006), (s_, 0, 0)), 'dark', bevel=0)
    screws(K, [(0.0, -0.330, 0.0562)], (0, 0, 1), r=0.0026)


def holo_sight(K, fc=-0.002):
    """全息瞄具：快拆底座 + 机身 + 带护翼的遮光罩 + 前镜片 + 滚花电池盖；窗口中心高度 = 0.100。"""
    K.add('holo_base', box(0.034, 0.078, 0.010, (0, fc, RT + 0.0050)), 'metal', bevel=0.0012, seg=2)
    K.add('holo_clamp', box(0.0065, 0.060, 0.013, (-0.0200, fc, RT + 0.0005)), 'metal', bevel=0.001)
    K.add('holo_jaw', box(0.0050, 0.060, 0.010, (0.0190, fc, RT - 0.0010)), 'metal', bevel=0.001)
    knob(K, 'holo_qd', (0.0215, fc + 0.004, RT + 0.0005), (1, 0, 0), 0.0075, 0.0068, 10)
    K.add('holo_lever', box(0.0040, 0.034, 0.0075, (-0.0245, fc - 0.010, RT + 0.0010), (0, 0, 0.06)), 'metalBare', bevel=0.0008)
    body = K.add('holo_body', loft([octs(fc - 0.036, 0.0205, RT + 0.009, RT + 0.0245, 0.004, 0.002), octs(fc + 0.030, 0.0205, RT + 0.009, RT + 0.0245, 0.004, 0.002)]), 'metal', bevel=0.001, seg=2)
    hood = K.add('holo_hood', loft([octs(fc - 0.026, 0.0238, RT + 0.020, 0.1215, 0.0075, 0.001), octs(fc + 0.024, 0.0238, RT + 0.020, 0.1215, 0.0075, 0.001)]), 'metal', bevel=0.0009, seg=2)
    win = loft([octs(fc - 0.05, 0.0198, 0.0840, 0.1172, 0.0052, 0.0016), octs(fc + 0.05, 0.0198, 0.0840, 0.1172, 0.0052, 0.0016)])
    cut(hood, win)
    for o in (body,): cut(o, loft([octs(fc - 0.05, 0.0198, 0.0840, 0.14, 0.0052, 0.0016), octs(fc + 0.05, 0.0198, 0.0840, 0.14, 0.0052, 0.0016)]))
    for s_ in (-1, 1):   # 护翼：遮光罩外侧的保护板，前缘斜切
        K.add('holo_wing', prism([(fc - 0.030, RT + 0.012), (fc + 0.030, RT + 0.012), (fc + 0.020, 0.1235), (fc - 0.022, 0.1235)], 0.0024, s_ * 0.0252), 'metal', bevel=0.0008)
        screws(K, [(s_ * 0.0264, fc + 0.014, RT + 0.020), (s_ * 0.0264, fc - 0.016, RT + 0.020)], (s_, 0, 0), r=0.0024, h=0.001)
    K.add('holo_glass', box(0.0392, 0.0012, 0.0330, (0, fc + 0.021, 0.1006)), 'glass', bevel=0)
    K.add('holo_batt', tube((-0.0215, fc + 0.040, RT + 0.0125), (0.0215, fc + 0.040, RT + 0.0125), 0.0092, seg=18), 'metal', bevel=0.0006)
    knob(K, 'holo_cap', (0.0215, fc + 0.040, RT + 0.0125), (1, 0, 0), 0.0065, 0.0102, 14)
    K.add('holo_batt_end', orient(cyl(0.002, 0.0096, seg=16), (-0.0215, fc + 0.040, RT + 0.0125), (-1, 0, 0)), 'metal', bevel=0.0006)
    for s_ in (-1, 1):
        K.add('holo_btn', orient(cyl(0.0022, 0.0040, seg=12), (s_ * 0.0085, fc - 0.036, RT + 0.0165), (0, -1, 0)), 'rubber', bevel=0.0005)
    K.add('holo_btn_plate', box(0.030, 0.0012, 0.011, (0, fc - 0.0362, RT + 0.0165)), 'dark', bevel=0)
    for u_, f_ in ((0.0925, fc + 0.004), (0.1050, fc - 0.012)):   # 风偏 / 高低调节螺丝（一字槽）
        K.add('holo_adj', orient(cyl(0.0016, 0.0036, seg=12), (0.0276, f_, u_), (1, 0, 0)), 'metalBare', bevel=0.0003, sharp=30)
        K.add('holo_adj_slot', box(0.0004, 0.0052, 0.0009, (0.0293, f_, u_)), 'dark', bevel=0)


def buis(K, f0, rear):
    """折叠机械瞄具（折倒状态）：导轨夹座 + 铰轴 + 折倒的照门 / 准星臂。"""
    nm = 'buis_r' if rear else 'buis_f'
    K.add(nm, box(0.0235, 0.030, 0.0075, (0, f0, RT + 0.0036)), 'metal', bevel=0.001)
    K.add(nm + '_jaw', box(0.0045, 0.030, 0.011, (-0.0118, f0, RT - 0.0010)), 'metal', bevel=0.0008)
    screws(K, [(-0.0140, f0, RT + 0.0005)], (-1, 0, 0), r=0.0026, h=0.0012)
    fp = f0 + (0.012 if rear else -0.012); d = -1 if rear else 1
    K.add(nm + '_pin', tube((-0.0105, fp, RT + 0.0090), (0.0105, fp, RT + 0.0090), 0.0024, seg=10), 'metalBare', bevel=0.0003)
    for s_ in (-1, 1): K.add(nm + '_ear', box(0.0030, 0.0085, 0.0085, (s_ * 0.0088, fp, RT + 0.0085)), 'metal', bevel=0.0008)
    K.add(nm + '_arm', box(0.0140, 0.040, 0.0052, (0, fp + d * 0.022, RT + 0.0098)), 'metal', bevel=0.001)
    if rear:
        ap = K.add(nm + '_ap', box(0.0150, 0.0080, 0.0062, (0, fp + d * 0.044, RT + 0.0100)), 'metal', bevel=0.0008)
        cut(ap, tube((0, fp + d * 0.044, RT), (0, fp + d * 0.044, RT + 0.03), 0.0030, seg=12))
        knob(K, nm + '_wind', (0.0076, fp + d * 0.044, RT + 0.0100), (1, 0, 0), 0.0040, 0.0045, 8)
    else:
        for s_ in (-1, 1): K.add(nm + '_wingf', box(0.0022, 0.0100, 0.0062, (s_ * 0.0062, fp + d * 0.043, RT + 0.0100)), 'metal', bevel=0.0006)
        K.add(nm + '_post', box(0.0020, 0.0100, 0.0040, (0, fp + d * 0.043, RT + 0.0098)), 'metalBare', bevel=0.0004)


# ============================ 突击步枪 ============================
def build_rifle():
    t0 = time.time(); K = Kit(('body', 'mag', 'bolt')); W = 0.0225
    # ---- 上机匣（八角截面）：右侧抛壳窗 / 防尘盖 / 抛壳挡板；左侧铣削凹面 + 拉机柄导槽
    up = K.add('upper', loft([octs(-0.168, 0.0205, 0.002, 0.054, 0.008, 0.002), octs(-0.150, W, -0.002, 0.060, 0.009, 0.002), octs(0.207, W, -0.002, 0.060, 0.009, 0.002)]), 'metal', bevel=0.0012, seg=2)
    cut(up, box(0.020, 0.066, 0.022, (W + 0.0035, 0.036, 0.029)))                 # 抛壳窗
    cut(up, box(0.0018, 0.150, 0.032, (-W, -0.060, 0.030)))                       # 左后：铭文凹面
    cut(up, box(0.0018, 0.160, 0.022, (-W, 0.112, 0.0150)))                       # 左前下：减重凹面
    cut(up, box(0.011, 0.170, 0.0074, (-W, 0.107, 0.0405)))                       # 左：拉机柄导槽
    cut(up, box(0.0018, 0.094, 0.030, (W, -0.092, 0.028)))                        # 右后：减重凹面
    cut(up, box(0.0018, 0.090, 0.016, (W, 0.146, 0.0120)))                        # 右前下
    g = bmesh.new()   # 机匣后段两侧上斜面的防反光切口
    for i in range(8):
        for s_ in (-1, 1): join(g, box(0.0020, 0.0100, 0.0100, (s_ * (W - 0.0042), -0.142 + i * 0.0165, 0.0558), (0, s_ * 0.785, 0)))
    cut(up, g)
    screws(K, [(-W + 0.0009, -0.1285, 0.0185), (-W + 0.0009, -0.1285, 0.0415)], (-1, 0, 0), r=0.0021, h=0.0009)
    screws(K, [(W - 0.0009, -0.132, 0.0170), (W - 0.0009, -0.052, 0.0170), (W - 0.0009, -0.132, 0.0390), (W - 0.0009, -0.052, 0.0390)], (1, 0, 0), r=0.0021, h=0.0009)
    K.add('ch_track', box(0.0020, 0.168, 0.0060, (-W + 0.0048, 0.107, 0.0405)), 'dark', bevel=0)
    K.add('chamber', box(0.012, 0.064, 0.020, (W - 0.0090, 0.036, 0.029)), 'dark', bevel=0)
    K.add('dustcover', box(0.0024, 0.068, 0.0225, (W + 0.0062, 0.036, 0.0072), (0, -0.52, 0)), 'metal', bevel=0.0005)
    K.add('dc_hinge', tube((W + 0.0012, 0.000, 0.0172), (W + 0.0012, 0.072, 0.0172), 0.0018, seg=8), 'metalBare', bevel=0)
    K.add('dc_latch', box(0.0030, 0.010, 0.006, (W + 0.0098, 0.036, -0.0030), (0, -0.52, 0)), 'metalBare', bevel=0.0005)
    tri = lambda u: [Vector((W, -0.038, u)), Vector((W, -0.002, u)), Vector((W + 0.0088, -0.006, u))]
    K.add('deflector', loft([tri(0.0165), tri(0.0435)]), 'metal', bevel=0.0007)
    for s_ in (-1, 1): screws(K, [(s_ * W, 0.199, 0.045), (s_ * W, 0.199, 0.0105 if s_ > 0 else 0.0335)], (s_, 0, 0), r=0.0030)
    K.add('rear_plate', box(0.036, 0.0050, 0.046, (0, -0.1705, 0.028)), 'metal', bevel=0.0012)
    # ---- 枪机 / 拉机柄（活动件）：抛壳窗里的机体、左侧拉机柄
    K.add('carrier', tube((0.0045, -0.012, 0.029), (0.0045, 0.074, 0.029), 0.0122, seg=20), 'metalBare', 'bolt', bevel=0.0004)
    for i in range(5): K.add('carrier_ser', box(0.0020, 0.0030, 0.016, (0.0166, 0.010 + i * 0.0062, 0.029)), 'metalBare', 'bolt', bevel=0.0003)
    K.add('extractor', box(0.0030, 0.020, 0.0060, (0.0158, 0.056, 0.031)), 'metalBare', 'bolt', bevel=0.0004)
    K.add('ch_stem', box(0.0100, 0.0125, 0.0058, (-W - 0.0012, 0.166, 0.0405)), 'metalBare', 'bolt', bevel=0.0006)
    K.add('ch_handle', orient(gear(0.0150, 0.0074, 0.0066, 9), (-W - 0.0050, 0.166, 0.0405), (-1, 0, 0)), 'metal', 'bolt', bevel=0.0002, sharp=30)
    K.add('ch_handle_cap', orient(cyl(0.0016, 0.0064, seg=14), (-W - 0.0200, 0.166, 0.0405), (-1, 0, 0)), 'metalBare', 'bolt', bevel=0.0005, sharp=30)
    # ---- 全长导轨
    K.add('rail', rail(-0.146, 0.470, (0, 0.060)), 'metal', bevel=0, sharp=30)
    # ---- 下机匣：弹匣井（外扩口 + 防滑纹）、销钉、快慢机、空仓挂机、弹匣卡笋
    LOW = [(-0.150, -0.002), (0.094, -0.002), (0.094, -0.066), (0.026, -0.078), (0.026, -0.040), (0.018, -0.034), (-0.040, -0.034), (-0.046, -0.046), (-0.090, -0.050), (-0.128, -0.030), (-0.150, -0.016)]
    low = K.add('lower', prism(LOW, 0.040), 'metal', bevel=0.0012, seg=2)
    mw = K.add('magwell', prism([(0.022, -0.050), (0.098, -0.038), (0.098, -0.069), (0.022, -0.082)], 0.0465), 'metal', bevel=0.0013, seg=2)
    lip = K.add('magwell_lip', prism([(0.0205, -0.0745), (0.0995, -0.0615), (0.0995, -0.0712), (0.0205, -0.0842)], 0.0505), 'metal', bevel=0.0012, seg=2)
    for o in (low, mw, lip): cut(o, box(0.0275, 0.054, 0.12, (0, 0.060, -0.052)))
    for s_ in (-1, 1): cut(low, box(0.0016, 0.060, 0.017, (s_ * 0.020, -0.098, -0.0165)))   # 握把上方的浅凹面
    for i in range(6): K.add('mw_ser', box(0.031, 0.0022, 0.0024, (0, 0.0982, -0.0080 - i * 0.0058)), 'metal', bevel=0.0005)
    for s_ in (-1, 1):
        K.add('mw_panel', prism([(0.034, -0.008), (0.088, -0.008), (0.088, -0.036), (0.034, -0.046)], 0.0014, s_ * 0.0236), 'metal', bevel=0.0010, ang=20)
        for i in range(4): K.add('mw_groove', box(0.0010, 0.040, 0.0016, (s_ * 0.0246, 0.062, -0.0135 - i * 0.0058)), 'metal', bevel=0.0004)
    pins(K, 0.074, 0.004, 0.0042, 0.020); pins(K, -0.070, 0.005, 0.0042, 0.020); pins(K, -0.006, -0.014, 0.0024, 0.020); pins(K, -0.030, -0.008, 0.0024, 0.020)
    for s_ in (-1, 1):   # 两侧快慢机：转轴 + 拨杆 + 限位凸点
        K.add('selector', orient(cyl(0.0030, 0.0058, seg=14), (s_ * 0.0195, -0.056, -0.012), (s_, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
        K.add('sel_lever', box(0.0030, 0.021, 0.0056, (s_ * 0.0238, -0.0465, -0.0105), (0.12, 0, 0)), 'metalBare', bevel=0.0006)
        K.add('sel_stop', orient(cyl(0.0010, 0.0016, seg=8), (s_ * 0.0200, -0.070, -0.0055), (s_, 0, 0)), 'metalBare', bevel=0)
    K.add('boltcatch', box(0.0045, 0.012, 0.026, (-0.0218, 0.014, 0.004)), 'metal', bevel=0.0006)
    K.add('boltcatch2', prism([(0.006, 0.010), (0.022, 0.010), (0.024, 0.024), (0.004, 0.024)], 0.0060, -0.0240), 'metal', bevel=0.0008)
    for i in range(3): K.add('bc_ser', box(0.0010, 0.016, 0.0016, (-0.0274, 0.014, 0.0135 + i * 0.0035)), 'metal', bevel=0.0003)
    K.add('magrel', orient(cyl(0.0042, 0.0056, seg=14), (0.0200, 0.018, -0.017), (1, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
    K.add('magrel_fence', prism([(0.006, -0.008), (0.030, -0.008), (0.030, -0.010), (0.006, -0.010)], 0.0050, 0.0222), 'metal', bevel=0.0006)
    K.add('magrel_f', box(0.0035, 0.024, 0.004, (0.0212, 0.018, -0.0250)), 'metal', bevel=0.0005)
    grip_group(K, 'poly')
    K.add('grip_screw', orient(hexp(0.0012, 0.0046), (0, -0.1022, -0.1702), (0, -0.29, -0.957)), 'metalBare', bevel=0.0003, sharp=30)
    # ---- 弹匣（活动件）：弧形弹匣体 + 侧筋 + 前后横筋 + 底板 + 顶部一发子弹
    mc = lambda t: Vector((0, 0.060 + 0.004 * t + 0.026 * t * t, -0.016 - 0.200 * t))
    mt = lambda t: Vector((0, 0.004 + 0.052 * t, -0.200)).normalized()
    mp = lambda t: Vector((0, -mt(t).z, mt(t).y))
    K.add('mag_body', loft([rrect(mc(t), X, mp(t), 0.0127, 0.0250, 0.005) for t in (0, 0.2, 0.4, 0.6, 0.8, 1.0)]), 'tan', 'mag', bevel=0.0007)
    K.add('mag_base', loft([rrect(mc(1.0), X, mp(1), 0.0150, 0.0288, 0.006), rrect(mc(1.0) + mt(1) * 0.0115, X, mp(1), 0.0150, 0.0288, 0.006)]), 'tan', 'mag', bevel=0.0013, seg=2)
    K.add('mag_base_tab', box(0.012, 0.010, 0.0030, tuple(mc(1.0) + mt(1) * 0.0125 + mp(1) * 0.012)), 'dark', 'mag', bevel=0.0008)
    for s_ in (-1, 1):
        for off in (-0.012, 0.0, 0.012):
            K.add('mag_rib', loft([rrect(mc(t) + X * (s_ * 0.0127) + mp(t) * off, X, mp(t), 0.0011, 0.0045, 0.001, n=1) for t in (0.34, 0.5, 0.66, 0.82, 0.96)]), 'tan', 'mag', bevel=0.0003)
        K.add('mag_window', loft([rrect(mc(t) + X * (s_ * 0.0127) - mp(t) * 0.0185, X, mp(t), 0.0004, 0.0022, 0.0003, n=1) for t in (0.36, 0.6, 0.9)]), 'dark', 'mag', bevel=0)
    for t in (0.42, 0.54, 0.66, 0.78, 0.90):
        for sg in (-1, 1):
            c = mc(t) + mp(t) * (sg * 0.0250)
            K.add('mag_bar', loft([rrect(c - mt(t) * 0.0022, X, mp(t), 0.0105, 0.0010, 0.0008, n=1), rrect(c + mt(t) * 0.0022, X, mp(t), 0.0105, 0.0010, 0.0008, n=1)]), 'tan', 'mag', bevel=0)
    K.add('round', tube((0, 0.040, -0.0120), (0, 0.076, -0.0105), 0.0045, seg=12), 'brass', 'mag', bevel=0)
    K.add('bullet', tube((0, 0.076, -0.0105), (0, 0.092, -0.0098), 0.0043, 0.0012, seg=12), 'brass', 'mag', bevel=0)
    # ---- 护木：薄壁八角壳体 + 侧 / 底 / 下斜面的 M-LOK 槽 + 上斜面的散热孔 + 前端斜切
    HW, HB, HT, HC = 0.0238, -0.0058, 0.0600, 0.0118; uc = (HB + HT) / 2; hh = (HT - HB) / 2
    hg = K.add('handguard', loft([octs(0.208, HW, HB, HT, HC, HC), octs(0.472, HW, HB, HT, HC, HC)]), 'tanMetal', bevel=0.0010, seg=2)
    cut(hg, loft([octs(0.19, HW - 0.0030, HB + 0.0030, HT - 0.0070, HC - 0.0016, HC - 0.0016), octs(0.49, HW - 0.0030, HB + 0.0030, HT - 0.0070, HC - 0.0016, HC - 0.0016)]))
    sl = bmesh.new(); q = 0.70711; dq = q * (HW + hh - HC)
    for i in range(5):
        f = 0.262 + i * 0.044
        for nx, nu, dist in ((1, 0, HW), (-1, 0, HW), (0, -1, hh), (q, -q, dq), (-q, -q, dq)):
            n = Vector((nx, 0, nu)); join(sl, stadium(Vector((0, f, uc)) + n * (dist - 0.002), n, F, 0.030, 0.0068, 0.012))
    for i in range(9):
        f = 0.248 + i * 0.0245
        for nx in (q, -q):
            n = Vector((nx, 0, q)); c = Vector((0, f, uc)) + n * dq; join(sl, tube(c - n * 0.006, c + n * 0.004, 0.0036, seg=12))
    cut(hg, sl)
    cut(hg, prism([(0.474, -0.02), (0.474, 0.0140), (0.4470, -0.02)], 0.08))    # 前端下缘斜切
    col = K.add('hg_collar', loft([octs(0.2050, HW + 0.0016, HB - 0.0016, HT, HC + 0.0008, HC + 0.0008), octs(0.2300, HW + 0.0016, HB - 0.0016, HT, HC + 0.0008, HC + 0.0008)]), 'tanMetal', bevel=0.0009, seg=2)
    cut(col, box(0.0016, 0.03, 0.020, (0, 0.2175, HB - 0.0016)))                 # 夹紧缝
    for s_ in (-1, 1): screws(K, [(s_ * (HW + 0.0016), 0.2175, 0.008), (s_ * (HW + 0.0016), 0.2175, 0.046)], (s_, 0, 0), r=0.0031)
    K.add('hg_qd', orient(cyl(0.0016, 0.0064, seg=14), (-HW, 0.452, 0.027), (-1, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
    K.add('hg_qd_hole', orient(cyl(0.0003, 0.0040, seg=12), (-HW - 0.0016, 0.452, 0.027), (-1, 0, 0)), 'dark', bevel=0)
    # ---- 枪管（带凹槽）、导气箍、导气管、枪口制退器
    brl = K.add('barrel', lathe([(0.150, 0.0115), (0.214, 0.0115), (0.220, 0.0100), (0.402, 0.0100), (0.406, 0.0090), (0.560, 0.0090), (0.562, 0.0078), (0.580, 0.0078)], seg=24, u=BORE), 'metalBare', bevel=0)
    fl = bmesh.new()
    for k in range(6):
        a = math.pi / 6 + k * math.pi / 3; join(fl, box(0.0050, 0.150, 0.0050, (0.0118 * math.cos(a), 0.312, BORE + 0.0118 * math.sin(a)), (0, -a + math.pi / 2, 0)))
    cut(brl, fl)
    K.add('gasblock', lathe([(0.404, 0.0128), (0.406, 0.0142), (0.438, 0.0142), (0.440, 0.0128)], seg=20, u=BORE), 'metal', bevel=0.0005)
    K.add('gasblock_top', box(0.0150, 0.034, 0.0120, (0, 0.422, 0.0385)), 'metal', bevel=0.0010)
    screws(K, [(0, 0.414, BORE - 0.0142), (0, 0.430, BORE - 0.0142)], (0, 0, -1), r=0.0024, h=0.0008)
    K.add('gastube', tube((0, 0.205, 0.0415), (0, 0.410, 0.0415), 0.0032, seg=10), 'metalBare', bevel=0)
    K.add('muzzle_washer', lathe([(0.556, 0.0105), (0.558, 0.0122), (0.561, 0.0122), (0.563, 0.0105)], seg=18, u=BORE), 'metalBare', bevel=0)
    K.add('muzzle_nut', orient(hexp(0.011, 0.0128), (0, 0.563, BORE), (0, 1, 0)), 'metal', bevel=0.0006, sharp=30)
    mz = K.add('muzzle_dev', lathe([(0.574, 0.0112), (0.580, 0.0146), (0.644, 0.0146), (0.652, 0.0136), (0.660, 0.0118)], seg=24, u=BORE), 'metal', bevel=0.0007)
    cut(mz, tube((0, 0.60, BORE), (0, 0.68, BORE), 0.0056, seg=16))
    g = bmesh.new()
    for f in (0.594, 0.611, 0.628): join(g, box(0.05, 0.0090, 0.0084, (0, f, BORE)))
    for f in (0.6025, 0.6195, 0.6365): join(g, tube((0, f, BORE), (0, f, BORE + 0.02), 0.0021, seg=8))
    for k in range(4):   # 口部冠状切口
        a = math.pi / 4 + k * math.pi / 2; join(g, box(0.0040, 0.008, 0.02, (0.0118 * math.cos(a), 0.660, BORE + 0.0118 * math.sin(a)), (0, -a + math.pi / 2, 0)))
    cut(mz, g)
    # ---- 精细件：护木铣线、线控开关与线缆、背带环、手挡
    g = bmesh.new()
    for f_ in (0.2380, 0.2412, 0.2444, 0.4585, 0.4617, 0.4649):
        for s_ in (-1, 1): join(g, box(0.0012, 0.0010, 0.034, (s_ * HW, f_, uc)))
    cut(hg, g)
    K.add('switch_base', box(0.0215, 0.046, 0.0040, (0, 0.296, RT + 0.0020)), 'poly', bevel=0.0010)
    K.add('switch_pad', box(0.0150, 0.034, 0.0030, (0, 0.296, RT + 0.0052)), 'rubber', bevel=0.0012, seg=2)
    for f_ in (0.279, 0.313): K.add('switch_band', box(0.0235, 0.0050, 0.0050, (0, f_, RT + 0.0016)), 'dark', bevel=0.0010)
    LXc = HW + 0.0232
    K.add('switch_cable', sweep(catmull([(0.006, 0.320, RT + 0.0030), (0.0130, 0.3320, RT + 0.0010), (HW + 0.0030, 0.3420, 0.0540), (HW + 0.0130, 0.3360, 0.0440), (LXc, 0.3285, 0.0330)], 6), 0.0019, 8), 'dark', bevel=0, sharp=180)
    K.add('sling_ring', sweep([Vector((-HW - 0.0036, 0.452 + 0.0088 * math.cos(2 * math.pi * k / 18), 0.0182 + 0.0088 * math.sin(2 * math.pi * k / 18))) for k in range(19)], 0.0013, 6), 'metalBare', bevel=0, sharp=180)
    K.add('handstop', prism([(0.396, HB + 0.0005), (0.434, HB + 0.0005), (0.4385, HB - 0.0150), (0.4270, HB - 0.0200), (0.4040, HB - 0.0060)], 0.0220), 'poly', bevel=0.0014, seg=2)
    for i in range(3): K.add('handstop_rib', box(0.0225, 0.0018, 0.0030, (0, 0.4385 + 0.0008 * i, HB - 0.0045 - i * 0.0042), (-0.26, 0, 0)), 'poly', bevel=0.0006)
    stock_m4(K, 'tan')
    holo_sight(K)
    K.add('holo_emitter', box(0.0100, 0.0120, 0.0034, (0, -0.026, RT + 0.0172)), 'dark', bevel=0.0008)   # 贴着窗口下沿，不挡准星
    K.add('holo_shade', box(0.0400, 0.0070, 0.0016, (0, 0.0255, 0.1224)), 'metal', bevel=0.0006)
    K.add('holo_liner', box(0.0392, 0.0660, 0.0008, (0, -0.005, 0.0844)), 'dark', bevel=0)   # 窗口内底面的消光衬板：不然它会以掠射角反射天空，在窗口下沿形成一条亮带
    buis(K, 0.430, False); buis(K, -0.126, True)
    # ---- 弹药计数屏座、前握把、激光指示器、战术灯
    K.add('ammo_house', box(0.038, 0.026, 0.008, (0, 0.1993, 0.0760), (0.351, 0, 0)), 'metal', bevel=0.0012)
    K.add('ammo_foot', box(0.030, 0.026, 0.007, (0, 0.203, RT + 0.003)), 'metal', bevel=0.001)
    fg = [rrect(Vector((0, 0.331 + df, HB - 0.006 - 0.074 * t)), X, F, hw, hd, 0.008) for t, hw, hd, df in ((0, 0.0165, 0.031, 0), (0.12, 0.0150, 0.026, 0.0), (0.5, 0.0152, 0.0235, -0.003), (0.9, 0.0148, 0.0215, -0.006), (1.0, 0.0135, 0.0195, -0.0065))]
    K.add('foregrip', loft(fg), 'poly', bevel=0.0008)
    for i in range(6):
        for sg in (-1, 1): K.add('fg_rib', box(0.0245, 0.0020, 0.0032, (0, 0.331 - 0.0035 * (i / 5) + sg * (0.0238 - 0.0012 * i), HB - 0.022 - i * 0.0092)), 'poly', bevel=0.0006)
    K.add('fg_cap', loft([rrect(Vector((0, 0.3245, HB - 0.080)), X, F, 0.0142, 0.0200, 0.008), rrect(Vector((0, 0.3245, HB - 0.0845)), X, F, 0.0125, 0.0180, 0.008)]), 'dark', bevel=0.0008)
    K.add('fg_mount', box(0.036, 0.074, 0.0070, (0, 0.331, HB - 0.0035)), 'poly', bevel=0.0012)
    screws(K, [(0, 0.306, HB - 0.0070), (0, 0.356, HB - 0.0070)], (0, 0, -1), r=0.0028, h=0.0010)
    K.add('peq_mount', box(0.0100, 0.060, 0.020, (-HW - 0.0050, 0.392, 0.030)), 'metal', bevel=0.001)
    K.add('peq', box(0.0200, 0.088, 0.036, (-HW - 0.0200, 0.392, 0.031)), 'tan', bevel=0.0016, seg=2)
    K.add('peq_top', box(0.0160, 0.050, 0.0060, (-HW - 0.0200, 0.385, 0.0515)), 'tan', bevel=0.0012)
    K.add('peq_door', box(0.0012, 0.040, 0.020, (-HW - 0.0304, 0.378, 0.031)), 'tan', bevel=0.0008)
    for u, r in ((0.040, 0.0058), (0.023, 0.0046)):
        K.add('peq_lens', tube((-HW - 0.0200, 0.434, u), (-HW - 0.0200, 0.444, u), r, seg=12), 'metal', bevel=0.0005)
        K.add('peq_glass', tube((-HW - 0.0200, 0.4442, u), (-HW - 0.0200, 0.4447, u), r * 0.72, seg=10), 'glow' if u < 0.03 else 'glass', bevel=0)
    knob(K, 'peq_batt', (-HW - 0.0200, 0.348, 0.036), (0, -1, 0), 0.0100, 0.0082, 12)
    for f in (0.372, 0.398): knob(K, 'peq_knob', (-HW - 0.0302, f, 0.040), (-1, 0, 0), 0.0030, 0.0046, 8)
    K.add('peq_btn', box(0.0035, 0.016, 0.010, (-HW - 0.0310, 0.418, 0.024)), 'rubber', bevel=0.001)
    screws(K, [(-HW - 0.0200, 0.362, 0.0545), (-HW - 0.0200, 0.408, 0.0545)], (0, 0, 1), r=0.0022, h=0.0008)
    LX = HW + 0.0232
    K.add('light_mount', box(0.0120, 0.050, 0.022, (HW + 0.0072, 0.392, 0.030)), 'metal', bevel=0.001)
    K.add('light_ring', lathe([(0.380, 0.0128), (0.404, 0.0128)], seg=20, x=LX, u=0.030), 'metal', bevel=0.0006)
    screws(K, [(LX, 0.392, 0.0430)], (0, 0, 1), r=0.0024, h=0.0010)
    K.add('light', lathe([(0.340, 0.0092), (0.344, 0.0112), (0.432, 0.0112), (0.438, 0.0140)], seg=20, x=LX, u=0.030), 'metal', bevel=0.0006)
    K.add('light_head', orient(gear(0.022, 0.0152, 0.0140, 12), (LX, 0.438, 0.030), (0, 1, 0)), 'metal', bevel=0.0003, sharp=30)
    K.add('light_tail', orient(gear(0.010, 0.0118, 0.0108, 10), (LX, 0.330, 0.030), (0, 1, 0)), 'metal', bevel=0.0003, sharp=30)
    K.add('light_btn', orient(cyl(0.003, 0.0070, seg=12), (LX, 0.327, 0.030), (0, 1, 0)), 'rubber', bevel=0.0008)
    K.add('light_lens', lathe([(0.4604, 0.0124), (0.4610, 0.0124)], seg=16, x=LX, u=0.030), 'glow', bevel=0)
    K.anchor('muzzle', 0, 0.70, BORE); K.anchor('eject', 0.03, 0.035, 0.03); K.anchor('gripL', 0, 0.331, HB - 0.004); K.anchor('sight', 0, 0.0, 0.100)
    K.done('rifle', t0)
    return K


# ============================ 霰弹枪 ============================
def build_shotgun():
    t0 = time.time(); K = Kit(('body', 'pump'))
    rc = K.add('receiver', loft([octs(-0.142, 0.0205, -0.018, 0.046, 0.009, 0.004), octs(-0.112, 0.0232, -0.030, 0.058, 0.011, 0.005), octs(0.030, 0.0232, -0.030, 0.058, 0.011, 0.005), octs(0.167, 0.0232, -0.012, 0.058, 0.011, 0.005)]), 'metal', bevel=0.0014, seg=2)
    cut(rc, box(0.02, 0.072, 0.022, (0.0275, 0.030, 0.028)))                      # 抛壳口
    cut(rc, box(0.004, 0.16, 0.024, (-0.0243, 0.010, 0.012)))                     # 左侧铣槽
    cut(rc, box(0.0018, 0.066, 0.030, (0.0232, -0.066, 0.022)))                    # 右后：减重凹面
    cut(rc, box(0.0018, 0.110, 0.012, (0.0232, 0.045, -0.006)))                    # 右下：减重凹面
    cut(rc, box(0.0018, 0.050, 0.030, (-0.0232, -0.084, 0.022)))                   # 左后：铭文凹面
    cut(rc, box(0.030, 0.086, 0.040, (0, 0.092, -0.024)))                          # 底部装弹口
    K.add('lifter', box(0.0270, 0.082, 0.0022, (0, 0.092, -0.0090), (0.09, 0, 0)), 'metalBare', bevel=0.0006)
    K.add('port_dark', box(0.012, 0.070, 0.020, (0.0150, 0.030, 0.028)), 'dark', bevel=0)
    K.add('bolt', tube((0.005, -0.008, 0.028), (0.005, 0.068, 0.028), 0.0125, seg=20), 'metalBare', bevel=0.0004)
    K.add('bolt_ext', box(0.0030, 0.022, 0.0060, (0.0170, 0.050, 0.030)), 'metalBare', bevel=0.0004)
    for i in range(5): K.add('bolt_ser', box(0.0020, 0.0030, 0.016, (0.0172, 0.004 + i * 0.0062, 0.028)), 'metalBare', bevel=0.0003)
    screws(K, [(0.0232, -0.100, 0.0445), (0.0232, 0.152, 0.0445), (0.0232, 0.152, 0.0060), (0.0232, -0.100, -0.0180)], (1, 0, 0), r=0.0030)
    screws(K, [(-0.0232, -0.100, 0.0445), (-0.0232, 0.152, 0.0445), (-0.0232, -0.100, -0.0180)], (-1, 0, 0), r=0.0030)
    K.add('act_release', prism([(0.040, -0.030), (0.058, -0.028), (0.058, -0.036), (0.042, -0.040)], 0.0050, -0.0195), 'metalBare', bevel=0.0008)
    K.add('trig_house', prism([(-0.092, -0.028), (0.034, -0.028), (0.024, -0.040), (-0.046, -0.047), (-0.092, -0.050)], 0.032), 'metal', bevel=0.0012)
    pins(K, -0.020, -0.012, 0.0030, 0.0236); pins(K, 0.060, -0.006, 0.0030, 0.0236)
    K.add('safety', tube((-0.0175, -0.060, -0.040), (0.0175, -0.060, -0.040), 0.0042, seg=12), 'metalBare', bevel=0.0004)
    K.add('safety_red', tube((-0.0195, -0.060, -0.040), (-0.0175, -0.060, -0.040), 0.0036, seg=10), 'red', bevel=0)
    grip_group(K, 'poly')
    # 枪管 + 管式弹仓 + 连接箍
    brl = K.add('barrel', lathe([(0.160, 0.0125), (0.600, 0.0125), (0.600, 0.0160), (0.632, 0.0160)], seg=22, u=0.040), 'metalBare', bevel=0.0006)
    cut(brl, tube((0, 0.56, 0.040), (0, 0.65, 0.040), 0.0100, seg=18))
    K.add('magtube', lathe([(0.160, 0.0125), (0.530, 0.0125), (0.530, 0.0142), (0.548, 0.0142), (0.548, 0.0090), (0.553, 0.0090)], seg=20, u=0.012), 'metal', bevel=0.0006)
    for f in (0.205, 0.505):
        K.add('clamp', loft([octs(f - 0.008, 0.0158, -0.004, 0.056, 0.007, 0.007), octs(f + 0.008, 0.0158, -0.004, 0.056, 0.007, 0.007)]), 'metal', bevel=0.001)
        for s_ in (-1, 1): screws(K, [(s_ * 0.0158, f, 0.026)], (s_, 0, 0), r=0.0030)
    K.add('magcap', orient(gear(0.016, 0.0152, 0.0140, 12), (0, 0.547, 0.012), (0, 1, 0)), 'metal', bevel=0.0003, sharp=30)
    K.add('magcap_end', orient(cyl(0.0030, 0.0118, seg=16, r1=0.0090), (0, 0.563, 0.012), (0, 1, 0)), 'metalBare', bevel=0.0006)
    K.add('sling_stud', tube((0, 0.555, -0.004), (0, 0.555, -0.012), 0.0030, seg=10), 'metalBare', bevel=0.0004)
    K.add('sling_ring', lathe([(-0.0016, 0.0062), (0.0016, 0.0062)], seg=14, x=0.0, u=-0.0165), 'metalBare', bevel=0.0005)
    K.add('bead_rib', box(0.0050, 0.110, 0.0030, (0, 0.545, 0.0535)), 'metal', bevel=0.0008)
    # 打孔散热护板（拱形壳体）
    hs = K.add('heatshield', loft([octs(0.190, 0.0172, 0.030, 0.0606, 0.0088, 0.0005), octs(0.480, 0.0172, 0.030, 0.0606, 0.0088, 0.0005)]), 'metal', bevel=0.0007)
    cut(hs, tube((0, 0.18, 0.040), (0, 0.49, 0.040), 0.0140, seg=22)); cut(hs, box(0.06, 0.4, 0.02, (0, 0.335, 0.028)))
    for nx, nu in ((0, 1), (0.7071, 0.7071), (-0.7071, 0.7071)):
        g = bmesh.new(); n = Vector((nx, 0, nu))
        for i in range(9): c = Vector((0, 0.207 + i * 0.032, 0.040)); join(g, tube(c + n * 0.010, c + n * 0.026, 0.0040, seg=10))
        cut(hs, g)
    for s_ in (-1, 1):
        screws(K, [(s_ * 0.0172, f, 0.0345) for f in (0.200, 0.335, 0.470)], (s_, 0, 0), r=0.0026, h=0.0010)
        K.add('hs_lip', box(0.0030, 0.286, 0.0030, (s_ * 0.0165, 0.335, 0.0302)), 'metal', bevel=0.0008)
    # 导轨、觇孔照门、带护翼准星
    K.add('rail', rail(-0.100, 0.120, (0, 0.058)), 'metal', bevel=0, sharp=30)
    ring = K.add('ghost', lathe([(-0.078, 0.0138), (-0.072, 0.0138)], seg=18, u=0.092), 'metal', bevel=0.0006)
    cut(ring, tube((0, -0.09, 0.092), (0, -0.06, 0.092), 0.0094, seg=18))
    K.add('ghost_base', box(0.024, 0.026, 0.0125, (0, -0.075, 0.0727)), 'metal', bevel=0.0012)
    for s_ in (-1, 1): K.add('ghost_wing', box(0.0028, 0.020, 0.020, (s_ * 0.0165, -0.075, 0.088), (0, s_ * 0.2, 0)), 'metal', bevel=0.0008)
    knob(K, 'ghost_knob', (0.0120, -0.075, 0.0727), (1, 0, 0), 0.0070, 0.0056, 10)
    screws(K, [(-0.0120, -0.075, 0.0727)], (-1, 0, 0), r=0.0026, h=0.0012)
    K.add('fs_base', box(0.022, 0.024, 0.012, (0, 0.590, 0.0585)), 'metal', bevel=0.001)
    K.add('fs_post', box(0.0032, 0.006, 0.030, (0, 0.590, 0.0775)), 'metal', bevel=0.0005)
    K.add('fs_dot', tube((0, 0.5865, 0.092), (0, 0.5935, 0.092), 0.0024, seg=8), 'red', bevel=0)
    for s_ in (-1, 1): K.add('fs_wing', box(0.0026, 0.016, 0.032, (s_ * 0.0098, 0.590, 0.080), (0, s_ * 0.2, 0)), 'metal', bevel=0.0007)
    # 侧挂弹夹板
    K.add('saddle', box(0.007, 0.152, 0.042, (-0.0268, 0.040, 0.016)), 'poly', bevel=0.0016)
    screws(K, [(-0.0303, -0.030, 0.0300), (-0.0303, 0.110, 0.0300)], (-1, 0, 0), r=0.0026, h=0.0010)
    for i in range(5):
        f = 0.095 - i * 0.027
        K.add('shell', tube((-0.0385, f, -0.011), (-0.0385, f, 0.035), 0.0095, seg=12), 'shell', bevel=0.0006)
        K.add('shell_brass', tube((-0.0385, f, 0.035), (-0.0385, f, 0.045), 0.0099, seg=12), 'brass', bevel=0.0006)
        K.add('shell_clip', box(0.014, 0.0235, 0.012, (-0.0375, f, 0.010)), 'poly', bevel=0.0012)
    # 固定枪托 + 托底板
    st = K.add('stock', loft([octs(-0.140, 0.0205, -0.018, 0.041, 0.009, 0.006), octs(-0.300, 0.0215, -0.040, 0.030, 0.010, 0.008), octs(-0.390, 0.0228, -0.098, 0.023, 0.010, 0.009), octs(-0.412, 0.0228, -0.094, 0.019, 0.009, 0.009)]), 'tan', bevel=0.0014, seg=2)
    cut(st, prism([(-0.300, -0.012), (-0.372, -0.018), (-0.378, -0.060), (-0.335, -0.040)], 0.08))
    for s_ in (-1, 1): cut(st, box(0.0016, 0.090, 0.022, (s_ * 0.0210, -0.215, 0.006)))                           # 两侧浅凹面
    K.add('cheek', loft([octs(-0.176, 0.0166, 0.034, 0.0465, 0.006, 0.0005), octs(-0.292, 0.0178, 0.024, 0.0375, 0.006, 0.0005)]), 'tan', bevel=0.0012, seg=2)
    K.add('stock_cap', loft([octs(-0.146, 0.0212, -0.0195, 0.0425, 0.009, 0.006), octs(-0.134, 0.0212, -0.0195, 0.0425, 0.009, 0.006)]), 'metal', bevel=0.0010)
    for s_ in (-1, 1):
        K.add('stock_qd', orient(cyl(0.0018, 0.0066, seg=14), (s_ * 0.0218, -0.372, -0.030), (s_, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
        K.add('stock_qd_hole', orient(cyl(0.0003, 0.0040, seg=12), (s_ * 0.0236, -0.372, -0.030), (s_, 0, 0)), 'dark', bevel=0)
    pad = K.add('buttpad', loft([octs(-0.412, 0.0234, -0.096, 0.021, 0.010, 0.010), octs(-0.427, 0.0226, -0.094, 0.019, 0.011, 0.011)]), 'rubber', bevel=0.0012)
    g = bmesh.new()
    for i in range(9): join(g, box(0.06, 0.004, 0.0035, (0, -0.4275, -0.084 + i * 0.012)))
    cut(pad, g)
    # 泵动护木（活动件）：防滑筋 + 竖握把 + 连杆
    K.add('pump_body', loft([octs(0.225, 0.0262, -0.034, 0.004, 0.006, 0.011), octs(0.405, 0.0262, -0.034, 0.004, 0.006, 0.011)]), 'tan', 'pump', bevel=0.0013, seg=2)
    for i in range(7): K.add('pump_rib', loft([octs(0.243 + i * 0.024 - 0.0045, 0.0278, -0.0355, 0.0055, 0.0065, 0.0115), octs(0.243 + i * 0.024 + 0.0045, 0.0278, -0.0355, 0.0055, 0.0065, 0.0115)]), 'tan', 'pump', bevel=0.0011)
    fg = [rrect(Vector((0, 0.331 + df, -0.034 - 0.074 * t)), X, F, hw, hd, 0.008) for t, hw, hd, df in ((0, 0.0165, 0.031, 0), (0.12, 0.015, 0.026, 0.0), (0.5, 0.0152, 0.0235, -0.003), (0.9, 0.0148, 0.0215, -0.006), (1.0, 0.0135, 0.0195, -0.0065))]
    K.add('pump_grip', loft(fg), 'poly', 'pump', bevel=0.0008)
    for s_ in (-1, 1):
        K.add('pump_bar', box(0.0035, 0.10, 0.008, (s_ * 0.0190, 0.185, 0.004)), 'metalBare', 'pump', bevel=0.0006)
        screws(K, [(s_ * 0.0262, 0.234, -0.012), (s_ * 0.0262, 0.396, -0.012)], (s_, 0, 0), r=0.0028, group='pump')
    for i in range(6):
        for sg in (-1, 1): K.add('pump_grip_rib', box(0.0245, 0.0020, 0.0032, (0, 0.331 - 0.0035 * (i / 5) + sg * (0.0238 - 0.0012 * i), -0.050 - i * 0.0092)), 'poly', 'pump', bevel=0.0006)
    K.add('pump_grip_cap', loft([rrect(Vector((0, 0.3245, -0.108)), X, F, 0.0142, 0.0200, 0.008), rrect(Vector((0, 0.3245, -0.1125)), X, F, 0.0125, 0.0180, 0.008)]), 'dark', 'pump', bevel=0.0008)
    K.anchor('muzzle', 0, 0.66, 0.040); K.anchor('eject', 0.03, 0.03, 0.028); K.anchor('gripL', 0, 0.331, -0.030); K.anchor('sight', 0, -0.075, 0.092)
    K.done('shotgun', t0)
    return K


# ============================ 轨道步枪 ============================
def build_rail():
    t0 = time.time(); K = Kit(('body', 'mag') + tuple('coil%d' % i for i in range(6)))
    rc = K.add('receiver', loft([octs(-0.160, 0.0215, -0.020, 0.050, 0.010, 0.005), octs(-0.125, 0.0262, -0.030, 0.066, 0.013, 0.006), octs(0.100, 0.0262, -0.030, 0.066, 0.013, 0.006), octs(0.222, 0.0262, -0.012, 0.066, 0.013, 0.006), octs(0.264, 0.0240, -0.010, 0.046, 0.012, 0.006)]), 'metal', bevel=0.0014, seg=2)
    for s_ in (-1, 1):
        cut(rc, box(0.004, 0.20, 0.022, (s_ * 0.0274, 0.000, 0.004)))                # 两侧铣槽
        g = bmesh.new()
        for i in range(5): join(g, stadium((s_ * 0.026, 0.150 + i * 0.016, 0.034), (s_, 0, 0), U, 0.020, 0.0052, 0.008))
        cut(rc, g)                                                                    # 散热缝
    for s_ in (-1, 1): screws(K, [(s_ * 0.0262, -0.112, 0.0500), (s_ * 0.0262, 0.092, 0.0500), (s_ * 0.0262, -0.112, -0.0200), (s_ * 0.0262, 0.092, -0.0210)], (s_, 0, 0), r=0.0032)
    cut(rc, box(0.0018, 0.110, 0.022, (-0.0262, -0.010, 0.034)))                     # 左上：铭文凹面
    # 右侧电容组 + 线缆
    for i, u in enumerate((0.040, 0.020, 0.000)):
        K.add('cap', tube((0.0345, -0.060, u), (0.0345, 0.060, u), 0.0088, seg=14), 'metalBare', bevel=0.0008)
        for f in (-0.045, 0.045): K.add('cap_ring', tube((0.0345, f - 0.004, u), (0.0345, f + 0.004, u), 0.0098, seg=14), 'glow' if f > 0 else 'metal', bevel=0)
        K.add('cap_end', orient(gear(0.0060, 0.0098, 0.0090, 10), (0.0345, 0.060, u), (0, 1, 0)), 'metal', bevel=0.0002, sharp=30)
        K.add('cap_end2', orient(hexp(0.0040, 0.0060), (0.0345, -0.064, u), (0, 1, 0)), 'metal', bevel=0.0004, sharp=30)
    K.add('cap_rack', box(0.010, 0.135, 0.062, (0.0285, 0.0, 0.020)), 'metal', bevel=0.0014)
    for s_, u in ((1, 0.040), (1, 0.000), (-1, 0.030)):
        K.add('cable', loft([ellipse(c, X, U, 0.0034, 0.0034, 8) for c in catmull([(s_ * 0.0345, 0.064, u), (s_ * 0.037, 0.12, u + 0.006), (s_ * 0.036, 0.20, u + 0.012), (s_ * 0.031, 0.25, 0.024)], 4)]), 'dark', bevel=0, sharp=180)
    grip_group(K, 'poly')
    # 护罩（镂空）
    sh = K.add('shroud', loft([octs(0.225, 0.0300, -0.014, 0.072, 0.015, 0.008), octs(0.440, 0.0300, -0.014, 0.072, 0.015, 0.008), octs(0.464, 0.0270, -0.010, 0.060, 0.013, 0.008)]), 'tan', bevel=0.0014, seg=2)
    cut(sh, box(0.046, 0.30, 0.064, (0, 0.35, 0.027)))
    g = bmesh.new()
    for i in range(4):
        for s_ in (-1, 1): join(g, stadium((s_ * 0.027, 0.262 + i * 0.047, 0.030), (s_, 0, 0), F, 0.034, 0.016, 0.012))
    cut(sh, g)
    for s_ in (-1, 1): screws(K, [(s_ * 0.0300, 0.238, 0.0620), (s_ * 0.0300, 0.428, 0.0620), (s_ * 0.0300, 0.238, -0.0030), (s_ * 0.0300, 0.428, -0.0030)], (s_, 0, 0), r=0.0030)
    g = bmesh.new()
    for i in range(7): join(g, tube((0, 0.250 + i * 0.028, 0.060), (0, 0.250 + i * 0.028, 0.080), 0.0040, seg=10))
    cut(sh, g)                                                                    # 顶部散热孔
    # 上下四根导轨、线圈肋框、枪口座
    for s_ in (-1, 1):
        K.add('railbar', prism([(0.26, 0.052), (0.845, 0.052), (0.862, 0.042), (0.862, 0.034), (0.26, 0.034)], 0.011, s_ * 0.0175), 'metal', bevel=0.0010)
        K.add('railbar', prism([(0.26, 0.012), (0.862, 0.012), (0.862, 0.004), (0.845, -0.006), (0.26, -0.006)], 0.011, s_ * 0.0175), 'metal', bevel=0.0010)
        screws(K, [(s_ * 0.0230, 0.478 + i * 0.058, u_) for i in range(7) for u_ in (0.043, 0.003)], (s_, 0, 0), r=0.0024, h=0.0010)
    for i in range(6):
        f = 0.500 + i * 0.058
        rib = K.add('rib', loft([octs(f - 0.0045, 0.0262, -0.011, 0.057, 0.008, 0.008), octs(f + 0.0045, 0.0262, -0.011, 0.057, 0.008, 0.008)]), 'tan', bevel=0.0010)
        cut(rib, box(0.0235, 0.03, 0.0215, (0, f, 0.023)))
        K.add('coil', lathe([(f + 0.018, 0.0060), (f + 0.018, 0.0098), (f + 0.040, 0.0098), (f + 0.040, 0.0060)], seg=14, u=0.023), 'coil', 'coil%d' % i, bevel=0)
        K.add('coil_core', tube((0, f + 0.006, 0.023), (0, f + 0.052, 0.023), 0.0045, seg=10), 'metalBare', bevel=0)
    mz = K.add('muzzle_blk', loft([octs(0.856, 0.0275, -0.012, 0.058, 0.009, 0.009), octs(0.880, 0.0262, -0.010, 0.056, 0.010, 0.010)]), 'metal', bevel=0.0012)
    cut(mz, box(0.0125, 0.06, 0.024, (0, 0.87, 0.023)))
    screws(K, [(sx * 0.0170, 0.880, u_) for sx in (-1, 1) for u_ in (0.046, 0.000)], (0, 1, 0), r=0.0030)
    # 瞄准镜
    sy = 0.108
    sc = K.add('scope', lathe([(-0.130, 0.0255), (-0.095, 0.0255), (-0.080, 0.0205), (0.140, 0.0205), (0.165, 0.0280), (0.200, 0.0280)], seg=24, u=sy), 'metal', bevel=0.0008)
    cut(sc, tube((0, 0.170, sy), (0, 0.21, sy), 0.0250, seg=24)); cut(sc, tube((0, -0.14, sy), (0, -0.118, sy), 0.0225, seg=24))
    K.add('scope_obj', tube((0, 0.1702, sy), (0, 0.1712, sy), 0.0250, seg=20), 'glow', bevel=0)
    K.add('scope_eye', tube((0, -0.1185, sy), (0, -0.1175, sy), 0.0225, seg=20), 'glass', bevel=0)
    K.add('scope_eye_in', tube((0, -0.1150, sy), (0, -0.1140, sy), 0.0200, seg=20), 'dark', bevel=0)
    K.add('turret_hub', lathe([(0.014, 0.0235), (0.046, 0.0235)], seg=20, u=sy), 'metal', bevel=0.0008)
    knob(K, 'turret_t', (0, 0.030, sy + 0.0200), (0, 0, 1), 0.0180, 0.0122, 16)
    knob(K, 'turret_s', (0.0200, 0.030, sy), (1, 0, 0), 0.0180, 0.0122, 16)
    knob(K, 'turret_l', (-0.0200, 0.030, sy), (-1, 0, 0), 0.0110, 0.0100, 14)
    K.add('zoom_ring', orient(gear(0.0150, 0.0218, 0.0213, 36), (0, -0.097, sy), (0, 1, 0)), 'metal', bevel=0, sharp=30)
    K.add('zoom_fin', box(0.0040, 0.010, 0.0060, (0, -0.090, sy + 0.0235)), 'metal', bevel=0.0010)
    K.add('eye_ring', orient(gear(0.0090, 0.0262, 0.0257, 44), (0, -0.1310, sy), (0, 1, 0)), 'rubber', bevel=0, sharp=30)
    cut(K.objs[-1], tube((0, -0.14, sy), (0, -0.10, sy), 0.0232, seg=24))
    K.add('obj_ring', orient(gear(0.0100, 0.0288, 0.0283, 48), (0, 0.192, sy), (0, 1, 0)), 'metal', bevel=0, sharp=30)
    cut(K.objs[-1], tube((0, 0.18, sy), (0, 0.21, sy), 0.0252, seg=24))
    for f in (-0.050, 0.085):
        K.add('sring', lathe([(f - 0.009, 0.0245), (f + 0.009, 0.0245)], seg=20, u=sy), 'metal', bevel=0.0008)
        K.add('sring_base', box(0.030, 0.018, 0.022, (0, f, sy - 0.030)), 'metal', bevel=0.0012)
        for s_ in (-1, 1):
            K.add('sring_ear', box(0.0080, 0.018, 0.0080, (s_ * 0.0262, f, sy - 0.0005)), 'metal', bevel=0.0010)
            screws(K, [(s_ * 0.0262, f - 0.0045, sy + 0.0035), (s_ * 0.0262, f + 0.0045, sy + 0.0035)], (0, 0, 1), r=0.0022, h=0.0010)
    K.add('rail', rail(-0.120, 0.200, (0, 0.066)), 'metal', bevel=0, sharp=30)
    # 拇指孔枪托 + 贴腮板 + 托底板
    st = K.add('stock', loft([octs(-0.160, 0.0210, -0.020, 0.050, 0.010, 0.006), octs(-0.300, 0.0225, -0.032, 0.050, 0.011, 0.008), octs(-0.400, 0.0232, -0.094, 0.050, 0.011, 0.009), octs(-0.440, 0.0232, -0.096, 0.032, 0.010, 0.009)]), 'tan', bevel=0.0014, seg=2)
    cut(st, prism([(-0.250, 0.022), (-0.360, 0.022), (-0.392, -0.022), (-0.300, -0.012)], 0.08))
    K.add('cheek', loft([octs(-0.365, 0.0185, 0.048, 0.066, 0.008, 0.002), octs(-0.235, 0.0185, 0.048, 0.066, 0.008, 0.002)]), 'tan', bevel=0.0012, seg=2)
    for s_ in (-1, 1): cut(st, box(0.0016, 0.070, 0.024, (s_ * 0.0222, -0.205, 0.016)))                            # 两侧浅凹面
    for f in (-0.335, -0.265):
        knob(K, 'cheek_knob', (0.0185, f, 0.0420), (1, 0, 0), 0.0060, 0.0068, 10)
        K.add('cheek_post', tube((0.0, f, 0.030), (0.0, f, 0.050), 0.0040, seg=10), 'metalBare', bevel=0)
    for s_ in (-1, 1):
        K.add('stock_qd', orient(cyl(0.0018, 0.0066, seg=14), (s_ * 0.0226, -0.410, -0.040), (s_, 0, 0)), 'metalBare', bevel=0.0004, sharp=30)
        K.add('stock_qd_hole', orient(cyl(0.0003, 0.0040, seg=12), (s_ * 0.0244, -0.410, -0.040), (s_, 0, 0)), 'dark', bevel=0)
    pad = K.add('buttpad', loft([octs(-0.440, 0.0238, -0.098, 0.034, 0.011, 0.010), octs(-0.455, 0.0230, -0.096, 0.032, 0.012, 0.011)]), 'rubber', bevel=0.0012)
    g = bmesh.new()
    for i in range(10): join(g, box(0.06, 0.004, 0.0035, (0, -0.4555, -0.086 + i * 0.012)))
    cut(pad, g)
    fg = [rrect(Vector((0, 0.331 + df, -0.014 - 0.078 * t)), X, F, hw, hd, 0.008) for t, hw, hd, df in ((0, 0.0165, 0.031, 0), (0.12, 0.015, 0.026, 0.0), (0.5, 0.0152, 0.0235, -0.003), (0.9, 0.0148, 0.0215, -0.006), (1.0, 0.0135, 0.0195, -0.0065))]
    K.add('foregrip', loft(fg), 'poly', bevel=0.0008)
    for i in range(6):
        for sg in (-1, 1): K.add('fg_rib', box(0.0245, 0.0020, 0.0032, (0, 0.331 - 0.0035 * (i / 5) + sg * (0.0238 - 0.0012 * i), -0.030 - i * 0.0092)), 'poly', bevel=0.0006)
    K.add('fg_cap', loft([rrect(Vector((0, 0.3245, -0.092)), X, F, 0.0142, 0.0200, 0.008), rrect(Vector((0, 0.3245, -0.0965)), X, F, 0.0125, 0.0180, 0.008)]), 'dark', bevel=0.0008)
    # 能量弹匣（活动件）
    K.add('cell', box(0.036, 0.100, 0.066, (0, 0.020, -0.058)), 'poly', 'mag', bevel=0.004, seg=2)
    K.add('cell_glow', box(0.0375, 0.066, 0.008, (0, 0.020, -0.070)), 'glow', 'mag', bevel=0)
    K.add('cell_base', box(0.031, 0.082, 0.012, (0, 0.020, -0.094)), 'metal', 'mag', bevel=0.0025)
    for f in (-0.012, 0.052): K.add('cell_fin', box(0.040, 0.006, 0.040, (0, f, -0.052)), 'metal', 'mag', bevel=0.0015)
    for s_ in (-1, 1): screws(K, [(s_ * 0.0180, -0.018, -0.045), (s_ * 0.0180, 0.058, -0.045)], (s_, 0, 0), r=0.0026, h=0.0010, group='mag')
    K.add('cell_latch', box(0.014, 0.008, 0.012, (0, 0.074, -0.040)), 'metalBare', 'mag', bevel=0.0012)
    K.anchor('muzzle', 0, 0.89, 0.023); K.anchor('eject', 0.03, 0.02, 0.03); K.anchor('gripL', 0, 0.331, -0.016); K.anchor('sight', 0, 0.0, sy)
    K.done('rail', t0)
    return K


# ============================ 手臂与战术手套（细节在 khhand.py） ============================
import khhand
importlib.reload(khhand)


def catmull(P, n=5):
    P = [Vector(p) for p in P]; Q = [P[0]] + P + [P[-1]]; pts = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(P[-1]); return pts

GRIP_T = Vector((0, -0.068, -0.047)); GRIP_AX = (Vector((0, -0.101, -0.166)) - GRIP_T).normalized()


def build_arms():
    t0 = time.time(); K = Kit(('armR', 'armL'))
    # ---- 右手：握住握把，食指伸直贴在机匣侧面（不扣扳机），拇指沿握把左侧向前
    o = GRIP_T + GRIP_AX * 0.0547
    MR = Matrix.Translation(o) @ Euler((-0.27, 0, 0)).to_matrix().to_4x4()
    poseR = {'index': {'flex': (8, 26, 18), 'yaw': 14.0},
             'thumb': {'cmc': (-0.020, 0.016, -0.010), 'dirs': [(-0.38, 0.06, -0.92), (-0.12, 0.90, -0.42), (-0.06, 0.985, -0.16)], 'nail': (-0.6, -0.5, -0.6)}}
    MT, _ = khhand.build_hand(K, 'armR', MR, (0.0180, 0.0238, 0.010, 0.060, -0.0150), poseR)
    R3 = MT.to_3x3()
    sl = khhand.Sleeve(MT @ Vector((0.001, -0.020, -0.002)), R3 @ Vector((0, -1, 0)), (0.255, -0.51, -0.36), R3 @ Vector((0, 0, 1)), seed=1.0)
    ends = lambda s_: max(1.0 - khhand.smooth01(0.026, 0.040, s_), khhand.smooth01(sl.L - 0.03, sl.L - 0.012, s_))
    K.add('sleeve', sl.simulate(lambda s_, th: ends(s_)) or sl.mesh(), 'sleeve', 'armR', bevel=0, sharp=180)
    khhand.sleeve_cuff(K, 'armR', sl, 1.9)
    # ---- 左手：握住垂直前握把，拇指向上贴在护木侧面；前臂上是钩索发射器
    ML = Matrix.Translation((0, -0.003, -0.036))
    poseL = {'thumb': {'cmc': (-0.020, 0.018, -0.008), 'dirs': [(-0.80, 0.48, 0.36), (-0.62, 0.78, 0.05), (-0.45, 0.89, -0.01)], 'nail': (0.1, -0.3, 1.0)}}
    MT, _ = khhand.build_hand(K, 'armL', ML, (0.0152, 0.0235, 0.008, 0.060, -0.0150), poseL, mirror=True)
    R3 = MT.to_3x3(); s0 = 0.152
    sl = khhand.Sleeve(MT @ Vector((0.001, -0.020, -0.002)), R3 @ Vector((0, -1, 0)), (-0.30, -0.56, -0.30), R3 @ Vector((0, 0, 1)), seed=2.3, straps=((s0 - 0.044, 0.020), (s0 + 0.046, 0.020)))
    hint = U * 0.9 + X * 0.2; th0 = sl.mount(s0, hint)[1]
    def pinL(s_, th):
        e = max(1.0 - khhand.smooth01(0.026, 0.040, s_), khhand.smooth01(sl.L - 0.03, sl.L - 0.012, s_))
        for sk, wk in sl.straps: e = max(e, 1.0 - khhand.smooth01(wk * 0.5 + 0.001, wk * 0.5 + 0.012, abs(s_ - sk)))
        dth = abs((th - th0 + math.pi) % (2 * math.pi) - math.pi)   # 发射器底托压住的那一片
        return max(e, (1.0 - khhand.smooth01(0.84, 1.05, dth)) * (1.0 - khhand.smooth01(0.0, 0.012, max(s0 - 0.068 - s_, s_ - (s0 + 0.092)))))
    K.add('sleeve', sl.simulate(pinL) or sl.mesh(), 'sleeve', 'armL', bevel=0, sharp=180)
    khhand.sleeve_cuff(K, 'armL', sl, 1.2)
    khhand.launcher(K, 'armL', sl, s0, hint)
    K.done('arms', t0)
    return K


def previews(name, views):
    eng = setup_render(os.path.join(ROOT, 'assets', 'sky.hdr'))
    for tag, loc, look, kw in views:
        shoot(os.path.join(PRE, '%s_%s.png' % (name, tag)), loc, look, **kw)
    print('[khamsin] previews done with', eng)


GUN_VIEWS = [
    ('fp', (-0.172, -0.47, 0.188), (-0.172, 1.0, 0.188), dict(fov=60)),
    ('left', (-1.2, 0.12, 0.0), (0, 0.12, 0.0), dict(ortho=1.2)),
    ('right34', (0.42, 0.62, 0.22), (0.0, 0.10, 0.02), dict(fov=38)),
    ('rear34', (-0.30, -0.42, 0.22), (0.0, 0.10, 0.03), dict(fov=40)),
]

BUILDERS = {'rifle': build_rifle, 'shotgun': build_shotgun, 'rail': build_rail, 'arms': build_arms}
for what in (list(BUILDERS) if 'all' in WHAT else WHAT):
    reset()
    K = BUILDERS[what]()
    if PREVIEW:
        if what == 'arms':   # 预览时把步枪一起摆上，左臂挪到前握把
            K.g['armL'].location = (0, 0.331, -0.0098)
            try:
                before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'rifle.glb'))
                for o in set(bpy.data.objects) - before:   # 导入的枪换回预览材质（否则会把顶点色里的 AO 数据当颜色显示）
                    if o.type == 'MESH':
                        for sl_ in o.material_slots: sl_.material = get_mat(sl_.material.name.split('.')[0])
            except Exception as e: print('import rifle failed', e)
            eye = (-0.172, -0.47, 0.188)
            previews(what, [('fp', eye, (-0.172, 1.0, 0.188), dict(fov=60)), ('fpzoomL', eye, (-0.02, 0.32, -0.03), dict(fov=13)), ('fpzoomG', eye, (-0.10, 0.20, -0.10), dict(fov=20)),
                            ('lefthand', (-0.22, 0.33, 0.16), (-0.02, 0.32, -0.04), dict(fov=40)), ('frontL', (0.17, 0.52, -0.12), (0.0, 0.34, -0.05), dict(fov=30)),
                            ('righthand', (-0.20, -0.20, 0.10), (0.02, -0.10, -0.09), dict(fov=42)), ('rightR', (0.34, 0.02, -0.02), (0.03, -0.10, -0.10), dict(fov=30)),
                            ('sleeveL', (-0.42, 0.02, 0.16), (-0.13, 0.15, -0.14), dict(fov=34))])
        else: previews(what, GUN_VIEWS)
