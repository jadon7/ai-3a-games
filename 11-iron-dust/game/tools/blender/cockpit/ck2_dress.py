# ck2_dress.py -- v2 dress: the cabin's instruments beyond the central cluster.  All static (mesh node st_dress).
# NASA-era content in rounded turn-of-the-millennium housings:
#   side pods      a tall pill-shaped pod at each edge of the view: three dials in chrome rings, lamps
#   header         an arch over the view: title strip, two light strips, and a switch wing each side
#   side consoles  a sloping console on each sill: title, a guarded row of toggles with legends, knobs,
#                  dials / read-out, placards, a note; the left one carries a radio handset on a coiled lead
#   canopy bows    one tube each side from the sill up through pod and wing to the header: what carries it all
# Housings are cream shells with a translucent teal gel rim behind them; printed matter comes from the label
# atlas (ck_labels.py -> labels.json), mapped by name.
import json
import os
from ck_parts import *

LBL = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'labels.json'), encoding='utf-8'))
SZ = float(LBL['_size'])
SHELL, GEL, DEC, K, R = 'shell_cream', 'panel_satin', 'decal_labels', 'lacquer_black', 'rubber_black'


def _uv(name):
    x0, y0, x1, y1 = LBL[name]
    return x0 / SZ, 1.0 - y1 / SZ, x1 / SZ, 1.0 - y0 / SZ          # u0, v0 (bottom), u1, v1 (top); the exporter flips v


def label(q, name, cx, cy, w, h=None, z=0.0034):          # the face plate's surface is at z = 0.002
    """printed plate on the face of a panel (local x right, y up, z toward the viewer)"""
    x0, y0, x1, y1 = LBL[name]
    if h is None:
        h = w * (y1 - y0) / float(x1 - x0)
    u0, v0, u1, v1 = _uv(name)
    q.raw(DEC, [(cx - w / 2, cy - h / 2, z), (cx + w / 2, cy - h / 2, z), (cx + w / 2, cy + h / 2, z), (cx - w / 2, cy + h / 2, z)],
          [(0, 1, 2, 3)], uvs=[[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])
    return h


def dial(q, name, cx, cy, r, needle=0.3, z=0.0048):
    """instrument: printed face, chrome ring, a needle at 'needle' of its sweep"""
    u0, v0, u1, v1 = _uv(name)
    n = 20
    vs = [(cx, cy, z)]
    uv = [((u0 + u1) / 2, (v0 + v1) / 2)]
    for i in range(n):
        a = 2 * pi * i / n
        vs.append((cx + r * cos(a), cy + r * sin(a), z))
        uv.append(((u0 + u1) / 2 + (u1 - u0) / 2 * cos(a), (v0 + v1) / 2 + (v1 - v0) / 2 * sin(a)))
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    q.raw(DEC, vs, faces, uvs=[[uv[j] for j in f] for f in faces])
    q.torus('chrome', r + 0.004, 0.0055, (cx, cy, z + 0.002), axis='Z', n=20, m=6)
    q.cyl(K, r + 0.010, 0.003, (cx, cy, 0.0030), axis='Z', n=20)
    a = radians(225.0 - 270.0 * needle)
    tip = (cx + cos(a) * r * 0.78, cy + sin(a) * r * 0.78, z + 0.004)
    q.rod('needle_orange', (cx - cos(a) * r * 0.18, cy - sin(a) * r * 0.18, z + 0.004), tip, 0.0022, n=5, r2=0.0008)
    q.cyl(K, r * 0.14, 0.006, (cx, cy, z + 0.004), axis='Z', n=10)


def toggle(q, x, y, on=True, guard=False):
    q.cyl('chrome', 0.0068, 0.004, (x, y, 0.002), axis='Z', n=8)
    q.rod('chrome', (x, y, 0.004), (x, y + (0.007 if on else -0.007), 0.024), 0.0026, n=6, r2=0.0040)
    if guard:
        for dx in (-0.011, 0.011):
            q.box('glass_red', (0.003, 0.026, 0.020), (x + dx, y, 0.010), bv=0.001)


def knob(q, x, y, r=0.012):
    q.cyl('chrome', r + 0.003, 0.003, (x, y, 0.0015), axis='Z', n=14)
    q.cyl(R, r, 0.014, (x, y, 0.009), axis='Z', n=14, ch=0.002)
    q.box('dial_white', (0.0022, r * 0.9, 0.001), (x, y + r * 0.5, 0.0165))


def lamp(q, x, y, mat):
    q.cyl('chrome', 0.0080, 0.003, (x, y, 0.0015), axis='Z', n=10)
    q.dome(mat, 0.0058, 0.0045, (x, y, 0.003), axis='Z', n=10)


def shell(q, w, h, d, gel=0.016):
    """a rounded housing whose face is the local z = 0 plane, with a glowing gel rim standing out behind it"""
    rr = min(w, h) * 0.24
    q.box(SHELL, (w, h, d), (0, 0, -d / 2), bv=rr, segs=4)
    q.box(GEL, (w + 2 * gel, h + 2 * gel, d * 0.5), (0, 0, -d * 0.62), bv=rr + gel, segs=4)
    q.box('panel_bluegrey', (w - 0.016, h - 0.016, 0.004), (0, 0, 0.0), bv=max(0.004, rr - 0.011), segs=3)      # painted face plate


def facing(c, s=1.0, roll=0.0):
    """frame at c whose z points at the eye, x to the right as the pilot sees it"""
    c = Vector(c)
    z = (-c).normalized()
    x = Vector((0, 0, 1)).cross(-z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0))
    x = x.normalized() * -1.0
    y = z.cross(x)
    m = frame(c, x, y, z)
    return m @ Matrix.Rotation(roll, 4, 'Z') if roll else m


def build_dress(kit):
    st = 'st_dress'
    kit.mesh(st)
    p = kit.pen(st)

    # ---- side pods
    pods = {-1: [('d_alt', 0.42), ('d_spd', 0.55), ('d_thr', 0.3)], 1: [('d_prs', 0.7), ('d_oxy', 0.8), ('d_fuel', 0.62)]}
    for s in (-1, 1):
        c = Vector((s * 0.74, 0.66, -0.26))
        q = p.mul(facing(c))
        shell(q, 0.150, 0.372, 0.070)
        for i, (nm, nd) in enumerate(pods[s]):
            dial(q, nm, 0.0, 0.106 - i * 0.106, 0.045, nd)
        for i, mt in enumerate(('glass_green', 'glass_green', 'glass_red')):
            lamp(q, -0.030 + i * 0.030, 0.168, mt)
        q.screws('chrome', [(sx * 0.060, sy * 0.170, 0.002) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0045, h=0.002)

    # ---- header arch: centre piece and a switch wing each side
    hc = Vector((0.0, 0.98, 0.745))
    q = p.mul(facing(hc))
    shell(q, 0.86, 0.118, 0.060)
    label(q, 'h_main', 0.0, 0.020, 0.80)
    for sx in (-1, 1):
        q.box('strip_light', (0.34, 0.012, 0.004), (sx * 0.20, -0.040, 0.003), bv=0.002)
        q.box('chrome', (0.36, 0.022, 0.003), (sx * 0.20, -0.040, 0.0005), bv=0.003)
    wings = {-1: ('t_pwr', 'l_pwr'), 1: ('t_wpn', 'l_wpn')}
    for s in (-1, 1):
        c = Vector((s * 0.585, 0.90, 0.585))
        q = p.mul(facing(c, roll=-s * 0.50))
        shell(q, 0.330, 0.128, 0.056)
        label(q, wings[s][0], -0.030, 0.042, 0.200)
        for i in range(6):
            toggle(q, -0.125 + i * 0.050, 0.004, on=(i + (0 if s < 0 else 1)) % 3 != 0, guard=(s > 0 and i in (0, 5)))
        label(q, wings[s][1], 0.0, -0.036, 0.300)
        for i, mt in enumerate(('glass_green', 'glass_red')):
            lamp(q, 0.112 + i * 0.026, 0.043, mt)

    # ---- canopy bows: sill -> pod -> wing -> header, one tube each side, with clamps where things hang on it
    for s in (-1, 1):
        pts = [(s * 0.49, 0.56, -0.720), (s * 0.70, 0.72, -0.50), (s * 0.80, 0.74, -0.26), (s * 0.80, 0.80, 0.16),
               (s * 0.66, 0.96, 0.56), (s * 0.44, 1.03, 0.745)]
        p.pipe('struct_grey', pts, 0.017, n=10, bend=0.10, bseg=5)
        for c in ((s * 0.80, 0.745, -0.36), (s * 0.80, 0.745, -0.16), (s * 0.69, 0.94, 0.50), (s * 0.46, 1.025, 0.735)):
            p.box('frame_brushed', (0.050, 0.050, 0.030), c, bv=0.008)
        # second, thinner tube: the loom that feeds the pod and the wing
        p.pipe(R, [(s * 0.51, 0.585, -0.70), (s * 0.715, 0.745, -0.49), (s * 0.815, 0.765, -0.24), (s * 0.815, 0.825, 0.16),
                   (s * 0.675, 0.985, 0.55)], 0.008, n=6, bend=0.10, bseg=4)

    # ---- side consoles on the sills, sloping in toward the pilot
    for s in (-1, 1):
        c = Vector((s * 0.605, 0.19, -0.675))
        z = Vector((-s * 0.50, 0.0, 0.866))
        x = Vector((0.0, -s * 1.0, 0.0))
        y = z.cross(x)
        q = p.mul(frame(c, x, y, z))
        shell(q, 0.50, 0.200, 0.058)
        # legs down to the sill rail
        for lx in (-0.17, 0.17):
            q.box('struct_grey', (0.030, 0.050, 0.070), (lx, -0.050, -0.085), bv=0.006)
        label(q, 't_env' if s < 0 else 't_eng', -0.110, 0.074, 0.230)
        for i in range(6):
            toggle(q, -0.205 + i * 0.044, 0.030, on=i % 2 == 0)
        label(q, 'l_env' if s < 0 else 'l_com', -0.095, -0.004, 0.270)
        for i in range(3):
            knob(q, -0.200 + i * 0.052, -0.052)
        label(q, 'b_mode' if s < 0 else 'b_go', -0.020, -0.056, 0.130)
        for i, mt in enumerate(('glass_green', 'glass_green', 'glass_red', 'glass_red')):
            lamp(q, 0.060 + i * 0.024, 0.076, mt)
        if s > 0:
            dial(q, 'd_temp', 0.115, 0.012, 0.034, 0.45)
            dial(q, 'd_oil', 0.195, 0.012, 0.034, 0.6)
            label(q, 'r_met', 0.155, -0.058, 0.150)
        else:
            dial(q, 'd_volt', 0.105, 0.014, 0.034, 0.56)
            label(q, 'r_rng', 0.105, -0.058, 0.110)
            # radio handset in its cradle, coiled lead back to the console
            hq = q.at((0.200, -0.004, 0.0))
            hq.box(K, (0.060, 0.150, 0.012), (0, 0, 0.006), bv=0.006)
            hq.box(SHELL, (0.050, 0.130, 0.030), (0, 0.0, 0.027), bv=0.012, segs=3)
            hq.box(K, (0.036, 0.040, 0.004), (0, 0.036, 0.043), bv=0.003)
            for i in range(4):
                hq.box(K, (0.030, 0.003, 0.002), (0, -0.016 - i * 0.008, 0.0425))
            hq.rod(K, (0.016, 0.062, 0.030), (0.016, 0.125, 0.036), 0.0035, n=6, r2=0.0022)
            coil = [(0.0 + 0.010 * cos(i * 1.9), -0.070 - i * 0.006, 0.020 + 0.010 * sin(i * 1.9)) for i in range(14)]
            hq.pipe(R, coil + [(-0.02, -0.160, 0.004)], 0.0030, n=5)
        # placards on the sloping front edge, a note stuck beside them
        label(q, 'z_haz', 0.0, -0.092, 0.46, 0.012)
    # placards where the pilot's eye falls on them: on the pods' gel rims and the consoles' ends
    for s, nm in ((-1, 'p_caut'), (1, 'p_warn')):
        c = Vector((s * 0.74, 0.66, -0.26))
        q = p.mul(facing(c))
        label(q, nm, 0.0, -0.228, 0.120)
        q.box(K, (0.132, 0.078, 0.006), (0, -0.228, -0.003), bv=0.008)
    q = p.mul(facing(Vector((-0.585, 0.90, 0.585)), roll=0.50))
    label(q, 'n_hold', 0.215, -0.010, 0.085, z=0.004)
    q = p.mul(facing(Vector((0.585, 0.90, 0.585)), roll=-0.50))
    label(q, 'p_eject', -0.250, -0.004, 0.130, z=0.004)
    q.box(K, (0.140, 0.058, 0.006), (-0.250, -0.004, 0.0), bv=0.006)
    return {}
