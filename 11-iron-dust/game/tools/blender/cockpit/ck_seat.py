# ck_seat.py -- the seat unit: pan, back, headrest, suspension base, folding foot rest, arm rests with the
# stick pods.  Everything hangs under the `seat` empty (the game shakes it); the sticks are its children.
from ck_parts import *

FLOOR = -1.25
SEAT_O = (0.0, 0.05, -0.80)
REC = radians(9.0)
STICK = (0.30, 0.45, -0.575)        # ball centre of the right stick (x mirrored for the left)


def build_seat(kit):
    kit.empty('seat', None, T(*SEAT_O))
    kit.mesh('seat_m', 'seat')
    p = kit.pen('seat_m')
    info = {'seat': Vector(SEAT_O)}

    # ---------------- pan ------------------------------------------------------------------------
    p.box('frame_brushed', (0.50, 0.56, 0.030), (0, 0.05, -0.870), bv=0.006)
    p.box('lacquer_black', (0.44, 0.05, 0.05), (0, 0.325, -0.862), bv=0.008)
    for s in (-1, 1):
        p.box('lacquer_black', (0.028, 0.52, 0.085), (s * 0.254, 0.05, -0.842), bv=0.007)
        p.screws('chrome', [(s * 0.2685, y, -0.842) for y in (-0.16, 0.05, 0.26)], (s, 0, 0), r=0.0045, h=0.0025)
    g = p.at((0, 0, -0.855))
    for s in (-1, 1):
        pad(g, 0.104, 0.086, 0.064, (s * 0.113, -0.118, 0), bulge=0.008)
        pad(g, 0.104, 0.090, 0.066, (s * 0.113, 0.064, 0), bulge=0.008)
        pad(g, 0.104, 0.074, 0.058, (s * 0.113, 0.234, 0), bulge=0.013, re=0.022, rc=0.03)
        pad(g, 0.021, 0.215, 0.046, (s * 0.236, 0.05, 0.016), (0, -s * 0.5, 0), rc=0.018, re=0.010, bulge=0.004)

    # emergency loop handle between the knees (hazard striped) and a recline lever on the right skirt
    hb = p.at((0, 0.318, -0.838))
    hb.box('frame_brushed', (0.10, 0.030, 0.008), (0, 0, 0.0), bv=0.002)
    loop = [(-0.034, 0, 0.0), (-0.034, 0, 0.040), (-0.022, 0, 0.060), (0.022, 0, 0.060), (0.034, 0, 0.040), (0.034, 0, 0.0)]
    import mathutils
    pts = []
    for i in range(len(loop) - 1):
        a, b = Vector(loop[i]), Vector(loop[i + 1])
        nseg = 3 if i in (0, 4) else (2 if i in (1, 3) else 4)
        for k in range(nseg):
            pts.append((a + (b - a) * (k / nseg), a + (b - a) * ((k + 1) / nseg)))
    for i, (a, b) in enumerate(pts):
        hb.rod('paint', a, b, 0.0058, n=8, caps=False, col=YEL if i % 2 == 0 else BLK)
    for a in loop[1:-1]:
        hb.ball('paint', 0.0058, a, n=8, m=4, col=BLK)
    p.rod('chrome', (0.270, 0.10, -0.846), (0.288, 0.235, -0.800), 0.0048, n=8)
    p.rloft('rubber_black', [(0.0, 0.006, 0.006), (0.004, 0.0085, 0.0085), (0.040, 0.0085, 0.0085), (0.045, 0.006, 0.006)], n=10, axis='Y',
            pos=(0.2885, 0.232, -0.800), rot=(0.33, 0, -0.13), sharp=60.0)
    p.cyl('chrome', 0.011, 0.012, (0.270, 0.10, -0.846), axis='X', n=10, ch=0.002)

    # ---------------- back -------------------------------------------------------------------------
    B = frame((0.0, -0.235, -0.80), (-1, 0, 0), (0, -sin(REC), cos(REC)), (0, cos(REC), sin(REC)))
    g = p.mul(B)
    bo = [(-0.215, 0.0), (0.215, 0.0), (0.228, 0.30), (0.205, 0.61), (0.125, 0.665), (-0.125, 0.665), (-0.205, 0.61),
          (-0.228, 0.30)]
    g.prism('frame_brushed', bo, -0.036, 0.0, plane='XY', bv=0.007)
    g.at((0, 0.33, -0.036)).plate('lacquer_black', rrect(0.17, 0.26, 0.04), 0.0, -0.012, ch=0.004, plane='XY', back=False)
    for sx in (-1, 1):
        pad(g, 0.052, 0.140, 0.060, (sx * 0.162, 0.168, 0), (0, -sx * 0.30, 0), bulge=0.008)
        pad(g, 0.050, 0.136, 0.056, (sx * 0.158, 0.456, 0), (0, -sx * 0.30, 0), bulge=0.008)
    pad(g, 0.098, 0.106, 0.044, (0, 0.134, 0), bulge=0.008)
    # centre plate with emblem and harness slots
    c = g.at((0, 0.425, 0))
    c.plate('frame_brushed', rrect(0.098, 0.168, 0.022), 0.0, 0.036, ch=0.004, plane='XY', back=False)
    c.steps('lacquer_black', rrect(0.021, 0.021, 0.005), [(0.0, 0.036), (0.0, 0.0395), (0.004, 0.0395), (0.006, 0.0365)],
            plane='XY', cap0=False, cap1=True)
    c.screws('chrome', [(sx * 0.082, sy * 0.150, 0.036) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0042, h=0.0022)
    for sx in (-1, 1):
        c.box('rubber_black', (0.052, 0.013, 0.004), (sx * 0.045, 0.128, 0.0345))
    text_rows(c, 0, -0.10, 0.07, 2, mat='rubber_black', z=0.0365)
    g.box('frame_brushed', (0.31, 0.055, 0.055), (0, 0.628, 0.0), bv=0.010)
    # shoulder straps hanging down the back, lap straps and buckle
    for sx in (-1, 1):
        strap(g, [(sx * 0.045, 0.553, 0.037), (sx * 0.045, 0.30, 0.040), (sx * 0.045, 0.245, 0.050), (sx * 0.040, 0.10, 0.056),
                  (sx * 0.035, 0.035, 0.050)], 0.042, 0.003)
        g.box('chrome', (0.050, 0.030, 0.006), (sx * 0.045, 0.335, 0.042), bv=0.002)
        g.box('rubber_black', (0.030, 0.012, 0.0065), (sx * 0.045, 0.335, 0.042))
        g.box('chrome', (0.046, 0.022, 0.007), (sx * 0.036, 0.040, 0.052), bv=0.002)
    for s in (-1, 1):
        strap(p, [(s * 0.238, -0.150, -0.815), (s * 0.218, -0.140, -0.790), (s * 0.12, -0.085, -0.7785), (s * 0.03, -0.030, -0.7795)],
              0.044, 0.003, across=(0, 1, 0))
    bk = p.at((0, -0.02, -0.781))
    bk.lathe('chrome', [(0.030, 0.0), (0.033, 0.003), (0.033, 0.009), (0.028, 0.013), (0.0, 0.013)], 20, sharp=40.0)
    bk.lathe('glass_red', [(0.012, 0.013), (0.012, 0.0155), (0.0, 0.0165)], 12, sharp=60.0)
    # chrome cylinders beside the lower back
    for sx in (-1, 1):
        cy = g.at((sx * 0.268, 0.170, -0.004))
        cy.lathe('chrome', [(0.0, -0.125), (0.022, -0.125), (0.032, -0.108), (0.032, 0.105), (0.024, 0.122), (0.011, 0.128),
                            (0.011, 0.140), (0.0, 0.140)], 18, axis='Y', sharp=50.0)
        cy.lathe('rubber_black', [(0.014, 0.140), (0.014, 0.150), (0.008, 0.154), (0.0, 0.154)], 10, axis='Y')
        for y in (-0.07, 0.06):
            cy.ring('frame_brushed', 0.0345, 0.0322, y - 0.008, y + 0.008, axis='Y', n=18)
            cy.box('frame_brushed', (0.03, 0.016, 0.03), (-sx * 0.03, y, -0.012), bv=0.003)

    # ---------------- headrest ---------------------------------------------------------------------
    Hd = frame((0.0, -0.355, -0.005), (-1, 0, 0), (0, 0, 1), (0, 1, 0))
    g = p.mul(Hd)
    g.prism('frame_brushed', rrect(0.168, 0.138, 0.045), -0.046, 0.0, plane='XY', bv=0.007)
    g.at((0, 0, -0.046)).plate('lacquer_black', rrect(0.11, 0.09, 0.03), 0.0, -0.010, ch=0.004, plane='XY', back=False)
    pad(g, 0.066, 0.088, 0.038, (0, -0.012, 0), bulge=0.006)
    for sx in (-1, 1):
        pad(g, 0.050, 0.112, 0.050, (sx * 0.110, 0.0, 0), (0, -sx * 0.22, 0), bulge=0.008)
        g.box('frame_brushed', (0.018, 0.21, 0.07), (sx * 0.172, 0, 0.012), (0, -sx * 0.35, 0), bv=0.005)
    for sx in (-1, 1):
        a = B @ Vector((sx * 0.075, 0.64, -0.012))
        b = Hd @ Vector((sx * 0.075, -0.125, -0.022))
        p.rod('chrome', a, b, 0.009, n=10)

    # ---------------- suspension base ------------------------------------------------------------------
    p.box('lacquer_black', (0.36, 0.40, 0.085), (0, 0.04, -0.927), bv=0.012)
    prof = [(0.070, -1.225)]
    for i in range(7):
        z = -1.225 + 0.255 * (i + 0.5) / 7
        prof += [(0.094, z - 0.006), (0.094, z + 0.006), (0.072, z + 0.018)]
    p.lathe('rubber_black', prof, 18, pos=(0, 0.04, 0), sharp=75.0)
    p.box('frame_brushed', (0.46, 0.60, 0.018), (0, 0.04, FLOOR + 0.009), bv=0.004)
    p.screws('chrome', [(sx * 0.21, 0.04 + sy * 0.28, FLOOR + 0.018) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1),
             r=0.006, h=0.003)
    for s in (-1, 1):
        p.rod('chrome', (s * 0.185, -0.24, -1.212), (s * 0.185, 0.32, -1.212), 0.012, n=10)
        for y in (-0.245, 0.325):
            p.box('frame_brushed', (0.04, 0.03, 0.04), (s * 0.185, y, -1.214), bv=0.005)
        # scissor links
        for (y0, y1) in ((-0.17, 0.25), (0.25, -0.17)):
            bar(p, (s * 0.222, y0, -1.19), (s * 0.222, y1, -0.905), 0.010, 0.028, 'frame_brushed', bv=0.003)
        p.cyl('chrome', 0.014, 0.030, (s * 0.222, 0.04, -1.0475), axis='X', n=12, ch=0.002)
        for (y, z) in ((-0.17, -1.19), (0.25, -1.19), (-0.17, -0.905), (0.25, -0.905)):
            p.cyl('chrome', 0.011, 0.026, (s * 0.222, y, z), axis='X', n=10, ch=0.002)
        # damper
        a, b = Vector((s * 0.150, -0.18, -1.195)), Vector((s * 0.150, 0.13, -0.915))
        m = a + (b - a) * 0.58
        p.rod('chrome', a, m, 0.017, n=12, ch=0.003)
        p.rod('frame_brushed', m, b, 0.008, n=8)
        p.rod('lacquer_black', a + (b - a) * 0.50, a + (b - a) * 0.60, 0.020, n=12, ch=0.003)

    # ---------------- folding foot rest ------------------------------------------------------------------
    for s in (-1, 1):
        a, b, c = Vector((s * 0.205, 0.335, -0.885)), Vector((s * 0.205, 0.585, -1.150)), Vector((s * 0.205, 0.66, -1.215))
        bar(p, a, b, 0.011, 0.030, 'frame_brushed', bv=0.003)
        bar(p, b, c, 0.011, 0.024, 'frame_brushed', bv=0.003)
        bar(p, (s * 0.218, 0.47, -1.028), (s * 0.218, 0.33, -1.19), 0.009, 0.022, 'frame_brushed', bv=0.003)
        for q in (a, b, c, Vector((s * 0.212, 0.47, -1.028))):
            p.cyl('chrome', 0.0125, 0.028, tuple(q), axis='X', n=12, ch=0.002)
        p.box('rubber_black', (0.03, 0.05, 0.012), (s * 0.205, 0.665, -1.240), bv=0.003)
    p.rod('chrome', (-0.205, 0.585, -1.150), (0.205, 0.585, -1.150), 0.009, n=10)
    hp = p.at((0, 0.618, -1.170), (0.42, 0, 0))
    hp.drilled('frame_brushed', 10, 2, 0.030, 0.0092, 0.005, margin=0.008)
    hp.box('frame_brushed', (0.316, 0.010, 0.018), (0, -0.036, 0.006), bv=0.002)

    # ---------------- arm rests and stick pods ------------------------------------------------------
    for s in (-1, 1):
        x = s * STICK[0]
        p.box('frame_brushed', (0.030, 0.056, 0.265), (x, -0.045, -0.742), bv=0.006)
        p.rod('frame_brushed', (x, 0.03, -0.868), (x, 0.15, -0.753), 0.0155, n=12, ch=0.003)
        p.rod('chrome', (x, 0.15, -0.753), (x, 0.275, -0.634), 0.0095, n=10)
        p.box('frame_brushed', (0.062, 0.61, 0.034), (x, 0.075, -0.612), bv=0.007)
        p.cyl('chrome', 0.029, 0.078, (x, -0.215, -0.612), axis='X', n=18, ch=0.004)
        p.screw('frame_brushed', (x - s * 0.039, -0.215, -0.612), (-s, 0, 0), r=0.009, h=0.004)
        pad(p, 0.034, 0.150, 0.026, (x, -0.015, -0.595), rc=0.022, re=0.010, bulge=0.005)
        # pod (side profile in the YZ plane)
        pts = [(0.335, -0.642), (0.566, -0.642), (0.588, -0.606), (0.562, -0.5785), (0.356, -0.5785), (0.335, -0.602)]
        p.prism('lacquer_black', pts, x - 0.056, x + 0.056, plane='YZ', bv=0.006)
        top = p.at((x, STICK[1], -0.5785))
        top.lathe('chrome', [(0.048, 0.0), (0.048, 0.004), (0.042, 0.0095), (0.0345, 0.0095), (0.0335, 0.002)], 24, sharp=40.0)
        top.disc('rubber_black', 0.034, (0, 0, 0.0012), n=24)
        # wrist pad behind the ball, keys and legend in front of it
        top.pillow('rubber_black', 0.042, 0.020, 0.007, rc=0.012, re=0.004, bulge=0.002, m=3, ne=2, npf=1, pos=(0, -0.067, 0))
        for i in (-1, 1):
            keycap(top.at((i * 0.022, 0.078, 0)), 0.030, 0.016, 0.005, 'panel_satin', 'legend_glow' if i * s < 0 else 'glass_red')
        legend(top, 0, 0.062, 0.05, 0.0024)
        toggle(top.at((s * 0.040, 0.030, 0)), 0.38 * s)
        # chrome trim on the pod flank + screws
        p.box('chrome', (0.003, 0.20, 0.006), (x - s * 0.0565, 0.455, -0.612), bv=0.001)
        p.screws('chrome', [(x - s * 0.056, y, -0.626) for y in (0.37, 0.54)], (-s, 0, 0), r=0.004, h=0.002)
    return info
