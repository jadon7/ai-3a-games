# ck_scope.py -- articulated sight arm: scope_arm -> scope_fore -> scope_head (rest pose = stowed) and the
# three *_dep empties that hold the deployed local transforms.
from ck_parts import *
import ck_tub as TB

S = Vector((0.50, 0.30, 0.28))              # shoulder
H = Vector((0.07, 0.30, -0.01))             # deployed centre of the sight head
HO = Vector((-0.055, -0.020, -0.058))       # head box centre in the head frame
BOX = (0.118, 0.076, 0.088)
L1, L2 = 0.27, 0.25
FOLD = radians(155.0)                       # stowed elbow angle
TWIST = radians(-60.0)                      # stowed twist of the head about the fore arm
YO = 0.028                                  # the fore arm is offset along the elbow axis


def solve():
    W = H - HO
    d = W - S
    D = d.length
    nrm = d.cross(Vector((0, 0, 1))).normalized()
    if nrm.y > 0:
        nrm = -nrm
    perp = nrm.cross(d).normalized()
    if perp.z < 0:
        perp = -perp
    a = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
    h = sqrt(max(L1 * L1 - a * a, 0.0))
    E = S + d.normalized() * a + perp * h
    A_d = frame_x(S, E - S, nrm)
    F_d = frame_x(E, W - E, nrm)
    H_d = Matrix.Translation(W)
    # stowed: upper arm swung back (inboard of the canopy strut), fore arm folded up over it, the head twisted
    # about the fore arm axis so that it rides above the shoulder with its screen still turned to the pilot
    xs = Vector((-0.30, -0.95, 0.05)).normalized()
    A_s = frame_x(S, xs, (-1, 0, 0))
    F_s = A_s @ T(L1, 0, 0) @ RY(FOLD)
    Ws = F_s @ Vector((L2, 0, 0))
    rel_h = F_d.inverted() @ H_d
    H_s = F_s @ T(L2, 0, 0) @ RX(TWIST) @ rel_h.to_3x3().to_4x4()
    return dict(W=W, E=E, A_d=A_d, F_d=F_d, H_d=H_d, A_s=A_s, F_s=F_s, H_s=H_s, Ws=Ws)


def build_scope(kit):
    k = solve()
    A_d, F_d, H_d, A_s, F_s, H_s = k['A_d'], k['F_d'], k['H_d'], k['A_s'], k['F_s'], k['H_s']
    info = {'scope': k}
    rel_f = A_d.inverted() @ F_d
    rel_h = F_d.inverted() @ H_d
    kit.empty('scope_arm', None, A_s)
    kit.empty('scope_arm_dep', None, A_d)
    kit.empty('scope_fore', 'scope_arm', F_s)
    kit.empty('scope_fore_dep', 'scope_arm', A_s @ rel_f)
    kit.empty('scope_head', 'scope_fore', H_s)
    kit.empty('scope_head_dep', 'scope_fore', F_s @ rel_h)
    kit.mesh('scope_arm_m', 'scope_arm')
    kit.mesh('scope_fore_m', 'scope_fore')
    kit.mesh('scope_head_m', 'scope_head')

    # ---- static bracket from the right canopy strut to the shoulder ball ------------------------
    st = kit.pen('st_tub')
    b, t = TB.STRUT_B, TB.STRUT_T
    u = (S.z - b.z) / (t.z - b.z)
    sp = b + (t - b) * u
    q = st.mul(frame_x(sp, t - b, (1, 0.4, 0)))
    q.box('lacquer_black', (0.075, 0.040, 0.052), bv=0.006)
    q.screws('chrome', [(sx * 0.026, -0.0205, sz * 0.016) for sx in (-1, 1) for sz in (-1, 1)], (0, -1, 0), r=0.004, h=0.002)
    bar(st, sp, S, 0.022, 0.022, 'frame_brushed', yhint=(0, 0, 1), bv=0.004)
    st.ball('chrome', 0.023, tuple(S), n=16, m=8)
    st.mul(frame_z(S + (sp - S).normalized() * 0.018, sp - S)).lathe('chrome', [(0.016, 0.0), (0.016, 0.006), (0.012, 0.010)], 12)

    # ---- upper arm: local x along the arm, y = elbow axis, z = "up" when deployed ----------------
    g = kit.pen('scope_arm_m', A_s)
    g.box('frame_brushed', (0.058, 0.040, 0.040), (0.008, 0, 0), bv=0.008)
    g.cyl('chrome', 0.0125, 0.046, (0.0, 0, 0), axis='Y', n=12, ch=0.002)
    g.box('chrome', (L1 - 0.030, 0.018, 0.028), (L1 / 2 + 0.012, 0, 0), bv=0.004)
    g.box('rubber_black', (L1 * 0.50, 0.0186, 0.010), (L1 / 2 + 0.01, 0, 0))
    for x in (0.062, L1 - 0.045):
        g.screws('frame_brushed', [(x, sy * 0.009, 0.0) for sy in (-1, 1)], (0, 1, 0), r=0.0035, h=0.0018)
        g.screw('frame_brushed', (x, -0.009, 0.0), (0, -1, 0), r=0.0035, h=0.0018)
    g.rod('chrome', (0.040, 0, 0.0215), (L1 - 0.050, 0, 0.0215), 0.0042, n=8)
    g.rod('frame_brushed', (0.040, 0, 0.0215), (0.115, 0, 0.0215), 0.0075, n=10, ch=0.0015)
    for x in (0.036, L1 - 0.046):
        g.box('frame_brushed', (0.012, 0.012, 0.016), (x, 0, 0.018), bv=0.002)
    g.cyl('chrome', 0.0205, 0.056, (L1, 0.014, 0), axis='Y', n=16, ch=0.003)
    g.screw('frame_brushed', (L1, -0.014, 0), (0, -1, 0), r=0.008, h=0.003)

    # ---- fore arm ---------------------------------------------------------------------------------
    g = kit.pen('scope_fore_m', F_s)
    g.box('frame_brushed', (0.050, 0.014, 0.038), (0.004, YO, 0), bv=0.005)
    g.box('chrome', (L2 - 0.035, 0.014, 0.022), (L2 / 2 + 0.008, YO, 0), bv=0.003, tx=1.0)
    g.box('rubber_black', (L2 * 0.42, 0.0146, 0.008), (L2 / 2 + 0.01, YO, 0))
    g.pipe('rubber_black', [(0.03, YO, 0.0135), (0.09, YO, 0.0150), (L2 - 0.06, YO, 0.0150), (L2 - 0.02, YO - 0.01, 0.0130)], 0.0032, n=6, bend=0.02)
    for x in (0.07, L2 - 0.07):
        g.box('frame_brushed', (0.008, 0.016, 0.006), (x, YO, 0.0135), bv=0.001)
    g.cyl('chrome', 0.0155, 0.044, (L2, 0.012, 0), axis='Y', n=14, ch=0.0025)
    g.screw('frame_brushed', (L2, 0.034, 0), (0, 1, 0), r=0.007, h=0.003)

    # ---- head: local axes = world axes when deployed (x right, y forward, z up) -----------------------
    g = kit.pen('scope_head_m', H_s)
    g.ball('chrome', 0.0135, (0, 0, 0), n=12, m=6)
    top = HO + Vector((0.030, 0.0, BOX[2] / 2))
    g.rod('chrome', (0, 0, 0), tuple(top + Vector((0, 0, 0.002))), 0.0075, n=10)
    g.mul(T(*top)).lathe('frame_brushed', [(0.016, 0.0), (0.016, 0.004), (0.010, 0.008)], 12)
    g.box('lacquer_black', BOX, tuple(HO), bv=0.007)
    # viewer face (toward -y)
    F = T(HO.x, HO.y - BOX[1] / 2, HO.z)                 # panel frame on that face
    f = g.mul(F @ FACE)
    sc = (-0.021, 0.003)
    SW = 0.060
    fs = f.at((sc[0], sc[1], 0))
    rect_bezel(fs, SW, SW, 'chrome', bw=0.0065, bh=0.0065, c=0.007, glass='glass_green', zs=0.002)
    kit.mesh('scr_scope', 'scope_head', H_s @ F @ T(sc[0], -0.002, sc[1]))
    v = [(-SW / 2, 0, -SW / 2), (SW / 2, 0, -SW / 2), (SW / 2, 0, SW / 2), (-SW / 2, 0, SW / 2)]
    kit.pen('scr_scope', H_s @ F @ T(sc[0], -0.002, sc[1])).raw('screen_off', v, [(0, 1, 2, 3)], None, [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    info['scr_scope'] = SW
    ln = f.at((0.036, 0.016, 0))
    round_bezel(ln, 0.0105, 'chrome', w=0.0055, h=0.006, n=16, fat=False)
    ln.dome('glass_green', 0.0118, 0.0045, (0, 0, 0.0015), n=14, m=3)
    for i in range(2):
        keycap(f.at((0.036, -0.010 - i * 0.014, 0)), 0.016, 0.009, 0.003, 'panel_satin', 'legend_glow')
    legend(f, sc[0], -0.036, 0.04, 0.0022)
    # objective on the far face
    o = g.mul(T(HO.x - 0.012, HO.y + BOX[1] / 2, HO.z + 0.004) @ RX(-pi / 2))
    o.lathe('chrome', [(0.031, 0.0), (0.031, 0.012), (0.028, 0.018), (0.024, 0.018), (0.022, 0.006)], 20, sharp=40.0)
    o.dome('glass_green', 0.0225, 0.008, (0, 0, 0.004), n=16, m=3)
    o.lathe('frame_brushed', [(0.008, 0.0), (0.008, 0.010), (0.0, 0.010)], 8, pos=(0.040, 0.020, 0))
    # cooling ribs on the outboard flank, grip rail on top
    for i in range(6):
        g.box('frame_brushed', (0.006, BOX[1] * 0.70, 0.0045), (HO.x + BOX[0] / 2 + 0.002, HO.y, HO.z - 0.030 + i * 0.012), bv=0.001)
    g.box('frame_brushed', (0.004, BOX[1] * 0.8, 0.070), (HO.x - BOX[0] / 2 - 0.001, HO.y, HO.z), bv=0.001)
    g.screws('chrome', [(HO.x - BOX[0] / 2 - 0.003, HO.y + sy * 0.022, HO.z + sz * 0.026) for sy in (-1, 1) for sz in (-1, 1)], (-1, 0, 0), r=0.003, h=0.0016)
    g.pipe('chrome', [(HO.x - 0.040, HO.y - 0.02, HO.z + BOX[2] / 2), (HO.x - 0.040, HO.y - 0.02, HO.z + BOX[2] / 2 + 0.012),
                      (HO.x - 0.040, HO.y + 0.02, HO.z + BOX[2] / 2 + 0.012), (HO.x - 0.040, HO.y + 0.02, HO.z + BOX[2] / 2)], 0.0028, n=6, bend=0.008, caps=False)
    return info
