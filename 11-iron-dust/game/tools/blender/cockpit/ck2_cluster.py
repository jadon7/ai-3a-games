# ck2_cluster.py -- v2 instrument cluster: one compact block floating on a single stalk.
# Radar tube in the middle, two arcs of three dials hugging it, two warning discs per side, the portrait
# status screen below with a five-LED strip on each side.  The housing is a trapezoid-cut block (0.612 m wide)
# with a glare hood along its top and shoulders; dark faces with lit markings, gunmetal bezels.
from ck_parts import *
from ck_cluster import tray

C2_POS = (0.0, 0.74, -0.60)
C2_TILT = radians(38.0)
RADAR_R = 0.092
DIAL_R = 0.024
WARN_R = 0.032
OUTLINE = [(0.065, -0.312), (0.085, -0.292), (0.085, -0.114), (0.222, -0.114), (0.272, -0.074), (0.272, 0.074),
           (0.222, 0.114), (-0.222, 0.114), (-0.272, 0.074), (-0.272, -0.074), (-0.222, -0.114), (-0.085, -0.114),
           (-0.085, -0.292), (-0.065, -0.312)]
STATUS_C = (0.0, -0.205)
STALK_TOP = Vector((0.0, 0.672, -0.812))
STALK_BOT = Vector((0.0, 0.640, -1.150))


def build_cluster(kit):
    st = 'st_cluster'
    kit.mesh(st)
    info = {}
    P = panel_frame(C2_POS, 0.0, C2_TILT)
    p = kit.pen(st, P)
    tray(p, OUTLINE, 0.046, rim_h=0.006, rim_w=0.006, ch=0.002)
    f = p.mul(FACE)
    from ck2_dress import label, toggle
    f.screws('chrome', [(sx * 0.258, sy * 0.062, 0.0) for sx in (-1, 1) for sy in (-1, 1)] +
             [(sx * 0.070, -0.286, 0.0) for sx in (-1, 1)], (0, 0, 1), r=0.0028)
    # Housing: a flat-sided block cut to a trapezoid at the top and the bottom (no square corners), standing
    # out behind the panel all round. Along its top edge and down both shoulders runs a glare hood, deepest
    # over the middle and tapering down the sides, so the upper instruments sit in its shade.
    HX, HT, HB = 0.306, 0.150, -0.135
    body = [(-0.170, HT), (0.170, HT), (HX, 0.058), (HX, -0.072), (0.236, HB), (-0.236, HB), (-HX, -0.072), (-HX, 0.058)]
    f.prism('panel_satin', body, -0.060, -0.008, plane='XY', bv=0.004)
    f.prism('panel_satin', [(-0.113, -0.10), (0.113, -0.10), (0.113, -0.296), (0.080, -0.337), (-0.080, -0.337), (-0.113, -0.296)],
            -0.056, -0.012, plane='XY', bv=0.004)
    # the hood: outer line, and how far it stands out toward the pilot at each point
    line = [((-HX, -0.060), 0.010), ((-HX, 0.058), 0.030), ((-0.170, HT), 0.052), ((0.170, HT), 0.052), ((HX, 0.058), 0.030), ((HX, -0.060), 0.010)]
    inner = [(-HX + 0.011, -0.060), (-HX + 0.011, 0.053), (-0.165, HT - 0.011), (0.165, HT - 0.011), (HX - 0.011, 0.053), (HX - 0.011, -0.060)]
    hv, hf = [], []
    for i, ((x, y), d) in enumerate(line):
        qx, qy = inner[i]
        hv += [(x, y, -0.010), (x, y, d), (qx, qy, d - 0.004), (qx, qy, -0.010)]
        if i:
            a, b = (i - 1) * 4, i * 4
            hf += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3)]
    hf += [(0, 1, 2, 3), (len(hv) - 1, len(hv) - 2, len(hv) - 3, len(hv) - 4)]
    f.emit('panel_satin', hv, hf, sharp=40.0)
    f.screws('frame_brushed', [(sx * 0.238, 0.120, 0.0) for sx in (-1, 1)] + [(sx * 0.288, -0.02, -0.008) for sx in (-1, 1)], (0, 0, 1), r=0.0034)
    # name plate block on the middle of the hood
    f.box('shell_cream', (0.118, 0.026, 0.014), (0, HT - 0.016, 0.050), bv=0.003)
    label(f.at((0, HT - 0.016, 0.057)), 'h_main', 0.0, 0.0, 0.104, z=0.0006)
    # riveted face: a row of dome heads along every straight edge
    riv = [(x * 0.045, sy * 0.104, 0.0) for x in range(-4, 5) for sy in (-1, 1)] + [(sx * 0.262, y * 0.03, 0.0) for sx in (-1, 1) for y in (-1, 0, 1)]
    riv += [(sx * 0.076, -0.14 - i * 0.045, 0.0) for sx in (-1, 1) for i in range(3)]
    f.screws('frame_brushed', riv, (0, 0, 1), r=0.0036, h=0.0022)
    # flank panels beside the status screen: a caution placard and a guarded switch each
    for sx in (-1, 1):
        f.box('panel_bluegrey', (0.092, 0.070, 0.014), (sx * 0.136, -0.158, -0.009), bv=0.008, segs=2)
        f.box('frame_brushed', (0.020, 0.030, 0.010), (sx * 0.094, -0.158, -0.012), bv=0.003)
        g2 = f.at((sx * 0.136, -0.158, -0.002))
        label(g2, 'p_caut' if sx < 0 else 'p_warn', -sx * 0.014, 0.0, 0.052, z=0.0006)
        toggle(g2, sx * 0.030, 0.0, on=sx > 0, guard=True)

    # ---------------- radar tube ------------------------------------------------------------------
    R = RADAR_R
    g = p.mul(FACE)
    ro = 0.116
    g.steps('lacquer_black', circle(ro, 8, pi / 8), [(0, 0.0), (0, 0.0065), (0.0025, 0.0090), (ro * 0.9239 - R - 0.001, 0.0090)],
            plane='XY', cap0=False, cap1=False)
    g.screws('chrome', [(0.1045 * cos(pi / 8 + i * pi / 4), 0.1045 * sin(pi / 8 + i * pi / 4), 0.0090) for i in range(8)],
             (0, 0, 1), r=0.0030)
    round_bezel(g, R, 'frame_brushed', w=0.0115, h=0.010, z0=0.0090, n=48, fat=False, glass='glass_green', zs=0.0055)
    g.lathe('rubber_black', [(R + 0.004, 0.0090), (R + 0.0005, 0.0045)], 48)
    for i in range(36):
        a = 2 * pi * i / 36
        big = (i % 3 == 0)
        tick(g, 'legend_glow', a, 0.1058, 0.1058 + (0.0048 if big else 0.0026), 0.0015 if big else 0.0009, 0.0094)
    screen_disc(kit, 'scr_radar', P @ T(0, -0.0055, 0), R, 48)
    info['scr_radar'] = 2 * R

    # ---------------- two arcs of three dials ----------------------------------------------------------
    names = {-1: ('needle_speed', 'needle_thrust', 'needle_heat'), 1: ('needle_ap', 'needle_alt', 'needle_aux')}
    styles = {'needle_speed': 2, 'needle_thrust': 0, 'needle_heat': 0, 'needle_ap': 1, 'needle_alt': 2, 'needle_aux': 0}
    ra = 0.1465
    for s in (-1, 1):
        for k, ang in enumerate((30.0, 0.0, -30.0)):          # top, middle, bottom
            u, v = s * ra * cos(radians(ang)), ra * sin(radians(ang))
            nm = names[s][k]
            M = P @ T(u, 0.0, v)
            d = p.mul(T(u, 0, v) @ FACE)
            d.lathe('frame_brushed', [(DIAL_R + 0.0062, 0.0), (DIAL_R + 0.0095, 0.0), (DIAL_R + 0.0095, 0.0012), (DIAL_R + 0.0062, 0.0020)], 24)
            dial(kit, st, nm, M, R=DIAL_R, style=styles[nm], dark=True)
            info[nm] = M
        # ---------------- two warning discs ---------------------------------------------------------------
        for k, v in enumerate((0.056, -0.056)):
            u = s * 0.2155
            g = p.mul(T(u, 0, v) @ FACE)
            g.lathe('lacquer_black', [(WARN_R + 0.0125, 0.0), (WARN_R + 0.0125, 0.0022), (WARN_R + 0.0110, 0.0036), (WARN_R + 0.003, 0.0036)], 28)
            round_bezel(g, WARN_R, 'frame_brushed', w=0.0105, h=0.0115, z0=0.0036, n=28, fat=True, glass='glass_red', zs=0.0030)
            name = 'scr_warn_%d' % ((1 if s < 0 else 3) + k)
            screen_disc(kit, name, P @ T(u, -0.0030, v), WARN_R, 28)
            info[name] = 2 * WARN_R
        # tiny captions
        g = p.mul(FACE)
        legend(g, s * 0.2155, 0.0, 0.030, 0.0022)
        frect(g, 'legend_glow', s * 0.186, 0.103, 0.022, 0.0022)

    # ---------------- portrait status screen with an LED strip on each side -------------------------------
    sw, sh = 0.100, 0.150
    g = p.mul(T(STATUS_C[0], 0, STATUS_C[1]) @ FACE)
    rect_bezel(g, sw, sh, 'lacquer_black', bw=0.0090, bh=0.0095, c=0.011, z0=0.0, glass='glass_green', zs=0.0035)
    screen_rect(kit, 'scr_status', P @ T(STATUS_C[0], -0.0035, STATUS_C[1]), sw, sh)
    info['scr_status'] = (sw, sh)
    li = 1
    for s in (-1, 1):
        u = s * 0.0715
        ch = p.mul(T(u, 0, STATUS_C[1]) @ FACE)
        frect(ch, 'rubber_black', 0, 0, 0.0125, 0.132, 0.0004)
        for i in range(5):
            v = STATUS_C[1] + 0.052 - i * 0.026
            M = P @ T(u, -0.0006, v) @ FACE
            name = 'lamp_%d' % li
            kit.mesh(name, None, M)
            kit.pen(name, M).box('lamp_lens', (0.0092, 0.0190, 0.0024), (0, 0, 0.0012), tx=0.84, ty=0.92)
            info[name] = M @ Vector((0, 0, 0))
            li += 1
    g = p.mul(FACE)
    legend(g, 0.0, -0.298, 0.06, 0.0022)

    # ---------------- back of the housing (seen only from outside): ribs, service plate, connector --------------
    bk = p.mul(T(0, 0.046, 0) @ FACE @ RX(pi))            # surface frame on the back face, z away from the pilot
    for i in range(7):
        bk.box('panel_satin', (0.30, 0.008, 0.006), (0.0, -0.066 + i * 0.022, 0.003), bv=0.0015)
    for sx in (-1, 1):
        bk.at((sx * 0.215, 0.0, 0)).plate('frame_brushed', rrect(0.036, 0.060, 0.008), 0.0, 0.004, ch=0.0012, plane='XY', back=False)
        bk.screws('chrome', [(sx * 0.215 + a * 0.027, b * 0.051, 0.004) for a in (-1, 1) for b in (-1, 1)], (0, 0, 1), r=0.003)
    bk.lathe('frame_brushed', [(0.018, 0.0), (0.018, 0.010), (0.013, 0.014), (0.0, 0.014)], 12, pos=(0.045, 0.150, 0))
    bk.pipe('rubber_black', [(0.045, 0.150, 0.012), (0.045, 0.150, 0.030), (0.030, 0.215, 0.034), (0.012, 0.235, 0.030)], 0.0055, n=6, bend=0.02)

    # ---------------- the stalk (static): knuckle behind the status screen down to the foot-rest spine ----------
    w = kit.pen(st)
    back = P @ Vector((0.0, 0.046, -0.215))
    w.box('frame_brushed', (0.070, 0.050, 0.060), tuple(back + Vector((0, 0.012, -0.010))), (C2_TILT - pi / 2, 0, 0), bv=0.006)
    w.cyl('chrome', 0.017, 0.058, tuple(STALK_TOP), axis='X', n=14, ch=0.003)
    bar(w, STALK_TOP, STALK_BOT, 0.030, 0.022, 'frame_brushed', yhint=(1, 0, 0), bv=0.004)
    a, b = STALK_TOP + Vector((0, 0.020, -0.03)), STALK_BOT + Vector((0, 0.024, 0.05))
    w.rod('chrome', a, b, 0.0055, n=8)
    w.rod('frame_brushed', a + (b - a) * 0.52, b, 0.0085, n=10, ch=0.0015)
    w.pipe('rubber_black', [tuple(STALK_TOP + Vector((0.012, -0.016, 0.0))), tuple(STALK_TOP + Vector((0.012, -0.018, -0.10))),
                            tuple(STALK_BOT + Vector((0.012, -0.016, 0.06))), tuple(STALK_BOT + Vector((0.012, -0.012, 0.0)))], 0.0042, n=6, bend=0.03)
    for t in (0.3, 0.7):
        q = STALK_TOP + (STALK_BOT - STALK_TOP) * t
        w.box('frame_brushed', (0.040, 0.030, 0.010), tuple(q), bv=0.002)
    w.cyl('chrome', 0.016, 0.052, tuple(STALK_BOT), axis='X', n=14, ch=0.003)
    return info
