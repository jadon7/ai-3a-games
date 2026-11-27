# ck_cluster.py -- instrument cluster: centre head (round CRT), status stalk (portrait CRT), two wings.
from ck_parts import *

C_POS = (0.0, 0.82, -0.565)
C_TILT = radians(30)
N_POS = (0.0, 0.733, -0.728)
N_TILT = radians(42)
W_TILT = radians(30)
W_YAW = radians(28)
W_ROLL = radians(18)
HEAD = [(-0.150, -0.085), (0.150, -0.085), (0.168, 0.0), (0.168, 0.120), (0.100, 0.200), (-0.100, 0.200),
        (-0.168, 0.120), (-0.168, 0.0)]


def wing_frame(s):
    return panel_frame((s * 0.335, 0.765, -0.545), yaw=-s * W_YAW, tilt=W_TILT, roll=s * W_ROLL)


def wing_outline(s):
    o = [(-0.250, 0.095), (0.090, 0.105), (0.215, 0.035), (0.205, -0.085), (0.030, -0.135), (-0.250, -0.115)]
    return [(s * a, b) for a, b in o]


def tray(p, outline, depth, rim_h=0.010, rim_w=0.010, ch=0.0025, mat='lacquer_black'):
    """Moulded housing in a panel frame: body runs back to y = depth, a rim stands rim_h proud of the fascia (y = 0)."""
    st = [(ch, depth), (0, depth - ch), (0, -rim_h + ch), (ch, -rim_h), (rim_w - ch, -rim_h), (rim_w, -rim_h + ch),
          (rim_w, 0.0)]
    p.steps(mat, outline, st, plane='XZ')


def brow(p, a, b, c, out=0.035, th=0.010, back=0.03, mat='lacquer_black', ext=0.0):
    """Glare-shield lip standing along the outline edge a-b (panel coords), on the side away from c."""
    a, b, c = Vector(a), Vector(b), Vector(c)
    d = b - a
    L = d.length
    d.normalize()
    nrm = Vector((-d.y, d.x))
    mid = (a + b) / 2
    if nrm.dot(mid - c) < 0:
        nrm = -nrm
    M = frame((mid.x, 0.0, mid.y), (d.x, 0, d.y), (0, 1, 0), Vector((d.x, 0, d.y)).cross(Vector((0, 1, 0))))
    q = p.mul(M)
    zs = 1.0 if (M.to_3x3() @ Vector((0, 0, 1))).dot(Vector((nrm.x, 0, nrm.y))) > 0 else -1.0
    q.box(mat, (L + ext, out + back, th), (0, (back - out) / 2, zs * (th / 2 - 0.002)), bv=0.0025)


def build_cluster(kit):
    st = 'st_cluster'
    kit.mesh(st)
    info = {}

    # ---------------- centre head: the large round CRT ------------------------------------
    C = panel_frame(C_POS, 0.0, C_TILT)
    p = kit.pen(st, C)
    tray(p, HEAD, 0.20, rim_h=0.012, rim_w=0.010)
    cen = (0.0, 0.06)
    for i in (3, 4, 5):
        brow(p, HEAD[i], HEAD[(i + 1) % 8], cen, out=0.040 if i == 4 else 0.030, ext=0.012)
    R = 0.105
    rc = (0.0, 0.062)
    g = p.mul(T(rc[0], 0, rc[1]) @ FACE)
    oct_o = circle(0.132, 8, pi / 8)
    g.steps('lacquer_black', oct_o, [(0, 0.0), (0, 0.0075), (0.003, 0.0105), (0.132 * 0.9239 - R - 0.001, 0.0105)], plane='XY', cap0=False, cap1=False)
    g.screws('chrome', [(0.119 * cos(pi / 8 + i * pi / 4), 0.119 * sin(pi / 8 + i * pi / 4), 0.0105) for i in range(8)],
             (0, 0, 1), r=0.0036)
    round_bezel(g, R, 'bronze', w=0.0125, h=0.011, z0=0.0105, n=48, fat=False, glass='glass_green', zs=0.006)
    g.lathe('rubber_black', [(R + 0.004, 0.0105), (R + 0.0005, 0.0050)], 48)
    # bearing ticks around the bezel
    for i in range(36):
        a = 2 * pi * i / 36
        big = (i % 3 == 0)
        tick(g, 'legend_glow', a, 0.1205, 0.1205 + (0.0055 if big else 0.003), 0.0016 if big else 0.001, 0.0110)
    screen_disc(kit, 'scr_radar', C @ T(rc[0], -0.006, rc[1]), R, 48)
    info['scr_radar'] = 2 * R
    # brightness / range knobs and legends in the lower corners
    for sx in (-1, 1):
        k = p.mul(T(sx * 0.137, 0, -0.058) @ FACE)
        knob(k, 0.0085, 0.013, ang=0.5 * sx)
        legend(k, 0, -0.019, 0.022, 0.0028)
        k2 = p.mul(T(sx * 0.150, 0, 0.012) @ FACE)
        legend(k2, 0, 0.0, 0.020, 0.0028)
    # serial plate above the tube
    top = p.mul(T(0, 0, 0.2025 - 0.012) @ FACE)

    # ---------------- status stalk: portrait CRT ---------------------------------------------
    N = panel_frame(N_POS, 0.0, N_TILT)
    pn = kit.pen(st, N)
    neck = rrect(0.086, 0.128, 0.020)
    tray(pn, neck, 0.075, rim_h=0.008, rim_w=0.008)
    sw, sh = 0.100, 0.150
    sc = (0.0, 0.014)
    g = pn.mul(T(sc[0], 0, sc[1]) @ FACE)
    rect_bezel(g, sw, sh, 'bronze', bw=0.0105, bh=0.011, c=0.013, z0=0.0, glass='glass_green', zs=0.004)
    screen_rect(kit, 'scr_status', N @ T(sc[0], -0.004, sc[1]), sw, sh)
    info['scr_status'] = (sw, sh)
    # four lamps beside the tube
    li = 1
    for sx in (-1, 1):
        for zz in (0.050, -0.022):
            lamp(kit, st, 'lamp_%d' % li, N @ T(sx * 0.0745, 0, zz) @ FACE, r=0.0052)
            lg = pn.mul(T(sx * 0.0745, 0, zz) @ FACE)
            frect(lg, 'legend_glow', 0, -0.0125, 0.010, 0.0024)
            li += 1
    # key row under the tube
    for i in range(5):
        kx = (i - 2) * 0.0235
        kg = pn.mul(T(kx, 0, -0.098) @ FACE)
        keycap(kg, 0.018, 0.016, 0.005, 'panel_satin', 'legend_glow' if i != 2 else 'glass_red')
    kg = pn.mul(T(0, 0, -0.1165) @ FACE)
    legend(kg, 0, 0, 0.11, 0.0024)

    # ---------------- wings ----------------------------------------------------------------------
    warn_i = {-1: (1, 2), 1: (3, 4)}
    needles = {-1: ('needle_speed', 'needle_thrust', 'needle_heat'), 1: ('needle_ap', 'needle_alt', 'needle_aux')}
    styles = {'needle_speed': 2, 'needle_thrust': 0, 'needle_heat': 0, 'needle_ap': 1, 'needle_alt': 2, 'needle_aux': 0}
    for s in (-1, 1):
        W = wing_frame(s)
        U = RY(-s * W_ROLL)
        pw = kit.pen(st, W)
        o = wing_outline(s)
        tray(pw, o, 0.17, rim_h=0.010, rim_w=0.010)
        cen = (s * 0.0, 0.0)
        brow(pw, o[0], o[1], cen, out=0.030, ext=0.02)
        brow(pw, o[1], o[2], cen, out=0.022, ext=0.004)
        # spectacle plate carrying the two red displays
        pw.at((s * -0.025, 0, 0.036)).plate('lacquer_black', rrect(0.142, 0.064, 0.030), 0.0, -0.004, ch=0.002, back=False)
        RW = 0.040
        us = (-0.095, 0.045)
        order = (us[1], us[0]) if s < 0 else us          # left wing: outer first so numbers run left -> right
        for k, u in enumerate(order):
            x, z = s * u, 0.036
            g = pw.mul(T(x, -0.004, z) @ FACE)
            g.lathe('lacquer_black', [(RW + 0.0235, 0.0), (RW + 0.0235, 0.0030), (RW + 0.0215, 0.0050), (RW + 0.003, 0.0050)], 32)
            round_bezel(g, RW, 'chrome', w=0.0185, h=0.0155, z0=0.0050, n=32, fat=True, glass='glass_red', zs=0.004)
            name = 'scr_warn_%d' % warn_i[s][k]
            screen_disc(kit, name, W @ T(x, -0.008, z) @ U, RW, 32)
            info[name] = 2 * RW
        # status dots between the displays
        g = pw.mul(T(s * -0.025, -0.004, 0.036) @ FACE)
        for j, m in enumerate(('glass_green', 'glass_red', 'legend_glow')):
            g.lathe(m, [(0.0026, 0.0), (0.0026, 0.0015), (0.0, 0.0022)], 6, pos=(0, 0.016 - j * 0.016, 0))
        # bronze sub-panel with three analog dials
        bc = (s * -0.030, -0.076)
        bo = rrect(0.136, 0.0365, 0.012)
        pw.at((bc[0], 0, bc[1])).plate('bronze', bo, 0.0, -0.0045, ch=0.0015, back=False)
        g = pw.mul(T(bc[0], -0.0045, bc[1]) @ FACE)
        g.screws('frame_brushed', [(sx * 0.129, sy * 0.0235, 0) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0028)
        du = (-0.115, -0.030, 0.055)
        dorder = tuple(reversed(du)) if s < 0 else du
        for k, u in enumerate(dorder):
            nm = needles[s][k]
            M = W @ T(s * u, -0.0045, -0.076) @ U
            dial(kit, st, nm, M, R=0.0265, style=styles[nm])
            info[nm] = M
        # outer end: selector knob, two toggles, legends
        g = pw.mul(T(s * 0.160, 0, -0.012) @ U @ FACE)
        knob(g, 0.0105, 0.015, ang=-0.6 * s)
        legend(g, 0, -0.024, 0.026, 0.0028)
        g = pw.mul(T(s * 0.150, 0, -0.062) @ U @ FACE)
        toggle_row(g, 2, 0.020, pattern=(1, -1), guard=False, leg=False)
        legend(g, 0, -0.014, 0.034, 0.0026)
        # inner top: placard
        g = pw.mul(T(s * -0.180, 0, 0.066) @ FACE)
        frect(g, 'legend_glow', 0, 0, 0.030, 0.0030)
        frect(g, 'legend_glow', -0.004 * s, -0.0065, 0.022, 0.0026)
        # corner screws of the fascia
        oi = offset_poly(o, 0.019)
        g = pw.mul(FACE)
        g.screws('chrome', [(a, b, 0.0) for a, b in oi], (0, 0, 1), r=0.003)
    return info
