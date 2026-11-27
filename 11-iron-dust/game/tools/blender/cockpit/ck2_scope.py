# ck2_scope.py -- v2 sight arm, mounted on the right of the seat's headrest structure.
# scope_arm -> scope_fore -> scope_head (rest = stowed behind the headrest) + the three *_dep empties.
# All of it hangs under `seat`.  Deployed: head box centred at Blender (0.02, 0.30, 0.085) = glTF (0.02, 0.085, -0.30),
# screen upright, facing the eye, just above the line of sight.
from ck_parts import *

S = Vector((0.205, -0.370, 0.100))          # shoulder (ball on the headrest bracket)
H = Vector((0.020, 0.300, 0.085))           # deployed centre of the sight head
HO = Vector((-0.055, -0.020, -0.058))       # head box centre in the head frame (wrist = head frame origin)
BOX = (0.118, 0.076, 0.088)
L1, L2 = 0.38, 0.36
YO = 0.028                                  # the fore arm is offset along the elbow axis
# stowed pose, picked with ck2_scope_search.py: direction of the upper arm (azimuth from +Y clockwise, elevation),
# elbow-axis hint, fold angle and head twist about the fore arm
STOW_AZ, STOW_EL = 160.0, 0.0
STOW_YH = (0, 0, -1)
STOW_FOLD = 150.0
STOW_TW = -150.0


def solve_deployed():
    W = H - HO
    d = W - S
    D = d.length
    dn = d.normalized()
    hint = Vector((1.0, 0.0, 0.3))
    perp = (hint - dn * hint.dot(dn)).normalized()          # the elbow bows outboard and a little up
    a = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
    h = sqrt(max(L1 * L1 - a * a, 0.0))
    E = S + dn * a + perp * h
    nrm = dn.cross(perp).normalized()
    if nrm.z < 0:
        nrm = -nrm
    A_d = frame_x(S, E - S, nrm)
    F_d = frame_x(E, W - E, nrm)
    H_d = Matrix.Translation(W)
    return dict(W=W, E=E, A_d=A_d, F_d=F_d, H_d=H_d)


def solve():
    k = solve_deployed()
    A_d, F_d, H_d = k['A_d'], k['F_d'], k['H_d']
    rel_f = A_d.inverted() @ F_d
    rel_h = F_d.inverted() @ H_d
    th_d = atan2(-rel_f[2][0], rel_f[0][0])
    a, e = radians(STOW_AZ), radians(STOW_EL)
    xs = Vector((sin(a) * cos(e), cos(a) * cos(e), sin(e)))
    A_s = frame_x(S, xs, STOW_YH)
    F_s = A_s @ T(L1, 0, 0) @ RY(radians(STOW_FOLD) * (1.0 if th_d > 0 else -1.0))
    H_s = F_s @ T(L2, 0, 0) @ RX(radians(STOW_TW)) @ rel_h.to_3x3().to_4x4()
    k.update(A_s=A_s, F_s=F_s, H_s=H_s, rel_f=rel_f, rel_h=rel_h)
    return k


def build_scope(kit):
    k = solve()
    A_d, F_d, H_d, A_s, F_s, H_s = k['A_d'], k['F_d'], k['H_d'], k['A_s'], k['F_s'], k['H_s']
    info = {'scope': k}
    kit.empty('scope_arm', 'seat', A_s)
    kit.empty('scope_arm_dep', 'seat', A_d)
    kit.empty('scope_fore', 'scope_arm', F_s)
    kit.empty('scope_fore_dep', 'scope_arm', A_s @ k['rel_f'])
    kit.empty('scope_head', 'scope_fore', H_s)
    kit.empty('scope_head_dep', 'scope_fore', F_s @ k['rel_h'])
    kit.mesh('scope_arm_m', 'scope_arm')
    kit.mesh('scope_fore_m', 'scope_fore')
    kit.mesh('scope_head_m', 'scope_head')

    # ---- bracket from the headrest shell to the shoulder ball (part of the seat) -----------------
    st = kit.pen('seat_m')
    root = Vector((0.128, -0.392, 0.060))
    bar(st, root, S, 0.022, 0.026, 'frame_brushed', yhint=(0, 0, 1), bv=0.004, ext=0.01)
    st.box('lacquer_black', (0.050, 0.040, 0.085), (0.138, -0.392, 0.055), bv=0.006)
    st.screws('chrome', [(0.1635, -0.392, 0.030), (0.1635, -0.392, 0.082)], (1, 0, 0), r=0.004, h=0.002)
    st.ball('chrome', 0.021, tuple(S), n=16, m=8)

    # ---- upper arm: local x along the arm, y = elbow axis -----------------------------------------
    g = kit.pen('scope_arm_m', A_s)
    g.box('frame_brushed', (0.054, 0.038, 0.038), (0.006, 0, 0), bv=0.008)
    g.cyl('chrome', 0.0120, 0.044, (0.0, 0, 0), axis='Y', n=12, ch=0.002)
    g.box('chrome', (L1 - 0.030, 0.017, 0.026), (L1 / 2 + 0.012, 0, 0), bv=0.004)
    g.box('rubber_black', (L1 * 0.50, 0.0176, 0.009), (L1 / 2 + 0.01, 0, 0))
    for x in (0.062, L1 - 0.045):
        g.screws('frame_brushed', [(x, 0.0085, 0.0)], (0, 1, 0), r=0.0035, h=0.0018)
        g.screws('frame_brushed', [(x, -0.0085, 0.0)], (0, -1, 0), r=0.0035, h=0.0018)
    g.rod('chrome', (0.040, 0, 0.0200), (L1 - 0.050, 0, 0.0200), 0.0040, n=8)
    g.rod('frame_brushed', (0.040, 0, 0.0200), (0.135, 0, 0.0200), 0.0070, n=10, ch=0.0015)
    for x in (0.036, L1 - 0.046):
        g.box('frame_brushed', (0.012, 0.012, 0.015), (x, 0, 0.017), bv=0.002)
    g.cyl('chrome', 0.0195, 0.054, (L1, 0.014, 0), axis='Y', n=16, ch=0.003)
    g.screw('frame_brushed', (L1, -0.013, 0), (0, -1, 0), r=0.008, h=0.003)

    # ---- fore arm ---------------------------------------------------------------------------------
    g = kit.pen('scope_fore_m', F_s)
    g.box('frame_brushed', (0.048, 0.014, 0.036), (0.004, YO, 0), bv=0.005)
    g.box('chrome', (L2 - 0.035, 0.013, 0.021), (L2 / 2 + 0.008, YO, 0), bv=0.003)
    g.box('rubber_black', (L2 * 0.42, 0.0136, 0.008), (L2 / 2 + 0.01, YO, 0))
    g.pipe('rubber_black', [(0.03, YO, 0.0130), (0.09, YO, 0.0145), (L2 - 0.06, YO, 0.0145), (L2 - 0.02, YO - 0.01, 0.0125)], 0.0030, n=6, bend=0.02)
    for x in (0.07, L2 / 2, L2 - 0.07):
        g.box('frame_brushed', (0.008, 0.015, 0.006), (x, YO, 0.0130), bv=0.001)
    g.cyl('chrome', 0.0150, 0.044, (L2, 0.012, 0), axis='Y', n=14, ch=0.0025)
    g.screw('frame_brushed', (L2, 0.034, 0), (0, 1, 0), r=0.007, h=0.003)

    # ---- head: local axes = world axes when deployed (x right, y forward, z up) -----------------------
    g = kit.pen('scope_head_m', H_s)
    g.ball('chrome', 0.0135, (0, 0, 0), n=12, m=6)
    top = HO + Vector((0.030, 0.0, BOX[2] / 2))
    g.rod('chrome', (0, 0, 0), tuple(top + Vector((0, 0, 0.002))), 0.0075, n=10)
    g.mul(T(*top)).lathe('frame_brushed', [(0.016, 0.0), (0.016, 0.004), (0.010, 0.008)], 12)
    g.box('lacquer_black', BOX, tuple(HO), bv=0.007)
    F = T(HO.x, HO.y - BOX[1] / 2, HO.z)                 # panel frame on the viewer face (toward -y)
    f = g.mul(F @ FACE)
    sc = (-0.021, 0.003)
    SW = 0.060
    fs = f.at((sc[0], sc[1], 0))
    rect_bezel(fs, SW, SW, 'chrome', bw=0.0065, bh=0.0065, c=0.007, glass='glass_green', zs=0.002)
    M = H_s @ F @ T(sc[0], -0.002, sc[1])
    kit.mesh('scr_scope', 'scope_head', M)
    v = [(-SW / 2, 0, -SW / 2), (SW / 2, 0, -SW / 2), (SW / 2, 0, SW / 2), (-SW / 2, 0, SW / 2)]
    kit.pen('scr_scope', M).raw('screen_off', v, [(0, 1, 2, 3)], None, [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    info['scr_scope'] = SW
    ln = f.at((0.036, 0.016, 0))
    round_bezel(ln, 0.0105, 'chrome', w=0.0055, h=0.006, n=16, fat=False)
    ln.dome('glass_green', 0.0118, 0.0045, (0, 0, 0.0015), n=14, m=3)
    for i in range(2):
        keycap(f.at((0.036, -0.010 - i * 0.014, 0)), 0.016, 0.009, 0.003, 'panel_satin', 'legend_glow')
    legend(f, sc[0], -0.036, 0.04, 0.0022)
    o = g.mul(T(HO.x - 0.012, HO.y + BOX[1] / 2, HO.z + 0.004) @ RX(-pi / 2))
    o.lathe('chrome', [(0.031, 0.0), (0.031, 0.012), (0.028, 0.018), (0.024, 0.018), (0.022, 0.006)], 20, sharp=40.0)
    o.dome('glass_green', 0.0225, 0.008, (0, 0, 0.004), n=16, m=3)
    o.lathe('frame_brushed', [(0.008, 0.0), (0.008, 0.010), (0.0, 0.010)], 8, pos=(0.040, 0.020, 0))
    for i in range(6):
        g.box('frame_brushed', (0.006, BOX[1] * 0.70, 0.0045), (HO.x + BOX[0] / 2 + 0.002, HO.y, HO.z - 0.030 + i * 0.012), bv=0.001)
    g.box('frame_brushed', (0.004, BOX[1] * 0.8, 0.070), (HO.x - BOX[0] / 2 - 0.001, HO.y, HO.z), bv=0.001)
    g.screws('chrome', [(HO.x - BOX[0] / 2 - 0.003, HO.y + sy * 0.022, HO.z + sz * 0.026) for sy in (-1, 1) for sz in (-1, 1)], (-1, 0, 0), r=0.003, h=0.0016)
    return info
