# ck_tub.py -- the lower tub (walls, floor, back wall with hatch), canopy frame, overhead panel,
# dash shroud, side consoles.  Everything static except the lamps (their own nodes).
from ck_parts import *
import ck_cluster as CL

FLOOR = -1.25
TH = 0.05
PLAN = [(-0.40, 1.16), (0.40, 1.16), (0.70, 0.80), (0.70, -0.30), (0.46, -0.68), (-0.46, -0.68), (-0.70, -0.30),
        (-0.70, 0.80)]
ROOF = 0.66
RIM_SIDE = -0.21
RIM_MID = -0.325
RIM_FRONT = -0.365
CON_T = radians(11.31)
OH_C = Vector((0.0, 0.20, 0.585))
OH_N = Vector((0.0, -0.30, -0.954)).normalized()
STRUT_B = Vector((0.705, 0.52, -0.238))
STRUT_T = Vector((0.42, 0.06, 0.640))


def wall_frame(pa, pb):
    a, b = Vector((pa[0], pa[1], 0.0)), Vector((pb[0], pb[1], 0.0))
    x = (b - a).normalized()
    z = Vector((0, 0, 1))
    return frame((a + b) / 2, x, z.cross(x), z), (b - a).length


def console_frame(s):
    c = Vector((s * 0.55, 0.11, -0.50))
    if s > 0:
        xs, ys = Vector((0, -1, 0)), Vector((cos(CON_T), 0, sin(CON_T)))
    else:
        xs, ys = Vector((0, 1, 0)), Vector((-cos(CON_T), 0, sin(CON_T)))
    return frame(c, xs, ys, xs.cross(ys))


def overhead_frame():
    x = Vector((1, 0, 0))
    return frame(OH_C, x, OH_N.cross(x), OH_N)


def slab(p, L, tops, mat='panel_satin', th=TH, bottom=FLOOR - 0.04):
    """Wall slab in a wall frame: inner face at y = 0.  tops = [(x, z)] left -> right."""
    o = [(-L / 2, bottom), (L / 2, bottom)] + list(reversed(tops))
    p.steps(mat, o, [(0.0, th), (0.0, 0.004), (0.004, 0.0)], plane='XZ')


def rim_cap(p, a, b, th=TH, mat='lacquer_black', w=0.022, over=0.012):
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    ang = -atan2(d.y, d.x)
    q = p.mul(T((a.x + b.x) / 2, th / 2 - 0.006, (a.y + b.y) / 2) @ RY(ang))
    q.box(mat, (L + 0.03, th + over * 2, w), (0, 0, w / 2 - 0.006), bv=0.005)


def beam(p, a, b, w, h, mat, yhint=(0, 0, 1), bv=0.004, ext=0.0):
    a, b = Vector(a), Vector(b)
    q = p.mul(frame_x((a + b) / 2, b - a, yhint))
    q.box(mat, ((b - a).length + ext, w, h), bv=bv)
    return q


def build_tub(kit):
    st = 'st_tub'
    kit.mesh(st)
    p0 = kit.pen(st)
    info = {}

    # ---------------- floor --------------------------------------------------------------------
    p0.prism('panel_satin', offset_poly(PLAN, -0.03), FLOOR - 0.05, FLOOR, plane='XY')
    # tread strips and heel mats
    for s in (-1, 1):
        p0.box('rubber_black', (0.20, 0.34, 0.008), (s * 0.165, 0.60, FLOOR + 0.004), bv=0.002)
        for i in range(9):
            p0.box('rubber_black', (0.18, 0.012, 0.006), (s * 0.165, 0.46 + i * 0.035, FLOOR + 0.010))
        p0.box('frame_brushed', (0.012, 0.60, 0.006), (s * 0.385, 0.20, FLOOR + 0.003), bv=0.001)
    for i in range(6):
        p0.box('frame_brushed', (0.50, 0.008, 0.004), (0, 0.90 + i * 0.04, FLOOR + 0.002))

    # ---------------- walls ----------------------------------------------------------------------
    full = [(-1, ROOF + 0.04), (1, ROOF + 0.04)]
    walls = {}
    specs = [
        ('front', 0, 1, [(-1, RIM_FRONT), (1, RIM_FRONT)]),
        ('fr', 1, 2, [(-1, RIM_FRONT), (1, RIM_MID)]),
        ('right', 2, 3, None),
        ('br', 3, 4, full), ('back', 4, 5, full), ('bl', 5, 6, full),
        ('left', 6, 7, None),
        ('fl', 7, 0, [(-1, RIM_MID), (1, RIM_FRONT)]),
    ]
    for name, i, j, tops in specs:
        M, L = wall_frame(PLAN[i], PLAN[j])
        p = kit.pen(st, M)
        walls[name] = (M, L)
        if name == 'right':
            tp = [(-L / 2, RIM_MID), (-0.10, RIM_SIDE), (L / 2, RIM_SIDE)]
        elif name == 'left':
            tp = [(-L / 2, RIM_SIDE), (0.10, RIM_SIDE), (L / 2, RIM_MID)]
        else:
            tp = [(sx * L / 2, z) for sx, z in tops]
        slab(p, L, tp)
        if tops is not full:
            for k in range(len(tp) - 1):
                rim_cap(p, tp[k], tp[k + 1])
    # exterior: belt line and ribs so the unit also reads from outside
    for name, (M, L) in walls.items():
        p = kit.pen(st, M)
        top = ROOF if name in ('br', 'back', 'bl') else -0.42
        p.box('lacquer_black', (L + 0.02, 0.014, 0.06), (0, TH + 0.005, -0.80), bv=0.004)
        for x in (-L / 4, L / 4):
            p.box('panel_satin', (0.04, 0.012, top - FLOOR - 0.06), (x, TH + 0.004, (top + FLOOR) / 2), bv=0.003)
    # corner posts
    heights = [RIM_FRONT, RIM_FRONT, RIM_MID, ROOF + 0.04, ROOF + 0.04, ROOF + 0.04, ROOF + 0.04, RIM_MID]
    for (x, y), h in zip(PLAN, heights):
        tall = h > 0
        r = 0.040 if tall else 0.030
        top = h + (0.0 if tall else 0.024)
        p0.cyl('lacquer_black', r, top - FLOOR, (x * 1.012, y * 1.012, (top + FLOOR) / 2), n=8, ch=0.006, facet=True,
               ph=pi / 8)

    # ---------------- rear roof + canopy hoop ---------------------------------------------------
    roof = [PLAN[3], PLAN[4], PLAN[5], PLAN[6]]
    p0.prism('panel_satin', offset_poly(roof, -0.03), ROOF, ROOF + 0.045, plane='XY', bv=0.006)
    p0.box('lacquer_black', (1.46, 0.075, 0.075), (0, -0.30, ROOF + 0.005), bv=0.012)
    for s in (-1, 1):
        # gussets between the hoop beam and its pillars
        g = [(s * 0.672, ROOF - 0.03), (s * 0.672, ROOF - 0.20), (s * 0.50, ROOF - 0.03)]
        p0.prism('frame_brushed', g, -0.306, -0.294, plane='XZ', bv=0.002)
        p0.screws('chrome', [(s * 0.64, -0.3065, ROOF - 0.06), (s * 0.64, -0.3065, ROOF - 0.13), (s * 0.57, -0.3065, ROOF - 0.06)],
                  (0, 1, 0), r=0.005, h=0.003)
        # roof rails from the hoop to the overhead panel
        p0.pipe('chrome', [(s * 0.33, -0.30, ROOF), (s * 0.30, -0.03, 0.688)], 0.011, n=8)
        # slim A-struts down to the tub rim (the right one carries the sight arm)
        b, t = Vector((s * STRUT_B.x, STRUT_B.y, STRUT_B.z)), Vector((s * STRUT_T.x, STRUT_T.y, STRUT_T.z))
        beam(p0, b, t, 0.026, 0.036, 'frame_brushed', yhint=(s, 0.4, 0), bv=0.005)
        q = p0.mul(frame_x(b, t - b, (s, 0.4, 0)))
        q.box('lacquer_black', (0.07, 0.05, 0.06), (0.0, 0, 0), bv=0.008)
        q.cyl('chrome', 0.012, 0.064, (0.012, 0, 0), axis='Z', n=10, ch=0.002)
        q = p0.mul(frame_x(t, t - b, (s, 0.4, 0)))
        q.box('lacquer_black', (0.07, 0.045, 0.055), (-0.01, 0, 0), bv=0.008)
        q.cyl('chrome', 0.011, 0.060, (-0.02, 0, 0), axis='Z', n=10, ch=0.002)
    # canopy bow: cross tube through the overhead housing that carries the strut heads
    p0.pipe('chrome', [(-STRUT_T.x, STRUT_T.y, STRUT_T.z), (STRUT_T.x, STRUT_T.y, STRUT_T.z)], 0.013, n=10)
    for s in (-1, 1):
        b, t = Vector((s * STRUT_B.x, STRUT_B.y, STRUT_B.z)), Vector((s * STRUT_T.x, STRUT_T.y, STRUT_T.z))
        for u in (0.22, 0.80):
            q = p0.mul(frame_x(b + (t - b) * u, t - b, (s, 0.4, 0)))
            q.box('chrome', (0.030, 0.0300, 0.0400), bv=0.003)
            q.screws('frame_brushed', [(0.0, -0.015, 0.010), (0.0, -0.015, -0.010)], (0, -1, 0), r=0.003, h=0.0016)
    # cabin clock on the left strut, facing the pilot
    b, t = Vector((-STRUT_B.x, STRUT_B.y, STRUT_B.z)), Vector((-STRUT_T.x, STRUT_T.y, STRUT_T.z))
    cp = b + (t - b) * 0.30
    cc = cp + Vector((0.050, -0.012, 0.0))
    bar(p0, cp, cc, 0.014, 0.014, 'frame_brushed', yhint=(0, 0, 1), bv=0.003)
    ck = p0.mul(frame_z(cc, -cc, (1, 0, 0)))
    ck.lathe('lacquer_black', [(0.0, -0.030), (0.020, -0.030), (0.031, -0.016), (0.031, 0.004), (0.027, 0.004)], 20, sharp=40.0)
    round_bezel(ck, 0.0245, 'chrome', w=0.0075, h=0.007, z0=0.004, n=20, fat=False)
    ck.disc('dial_white', 0.027, (0, 0, 0.0052), n=20)
    for i in range(12):
        tick(ck, 'rubber_black', i * pi / 6, 0.0185, 0.0235, 0.0018 if i % 3 == 0 else 0.0010, 0.0057)
    tick(ck, 'rubber_black', 1.05, -0.004, 0.014, 0.0022, 0.0060)
    tick(ck, 'rubber_black', -2.2, -0.005, 0.020, 0.0015, 0.0062)
    tick(ck, 'glass_red', 0.35, -0.006, 0.021, 0.0008, 0.0064)
    ck.lathe('chrome', [(0.0028, 0.0052), (0.0028, 0.0075), (0.0, 0.0080)], 8)
    ck.lathe('chrome', [(0.005, 0.0), (0.005, 0.008), (0.0, 0.008)], 8, axis='Y', pos=(0, 0.032, -0.006))
    # hoop underside light strip + placard
    p0.box('dial_white', (0.30, 0.012, 0.004), (0, -0.30, ROOF - 0.034))
    p0.box('chrome', (0.32, 0.024, 0.004), (0, -0.30, ROOF - 0.0325), bv=0.001)

    build_overhead(kit, st, info)
    build_backwall(kit, st, walls, info)
    build_sidewalls(kit, st, walls, info)
    build_shroud(kit, st, info)
    build_consoles(kit, info)
    return info


# ==============================================================================================
def build_overhead(kit, st, info):
    O = overhead_frame()
    g = kit.pen(st, O)
    hw, hl = 0.33, 0.25
    o = rrect(hw, hl, 0.03)
    # housing: face at z = 0 (toward the pilot), body runs away from the pilot
    g.steps('lacquer_black', o, [(0.004, -0.055), (0.0, -0.051), (0.0, 0.004), (0.004, 0.008), (0.014, 0.008), (0.016, 0.0)],
            plane='XY')
    # three sub-panels
    plates = [(-0.105, 0.045, 0.195, 0.150), (0.205, 0.045, 0.095, 0.150), (0.0, -0.150, 0.300, 0.036)]
    for (cx, cy, px, py) in plates[:2]:
        g.at((cx, cy, 0)).plate('panel_satin', rrect(px, py, 0.012), 0.0, 0.0030, ch=0.0012, plane='XY', back=False)
        g.screws('chrome', [(cx + sx * (px - 0.010), cy + sy * (py - 0.010), 0.003) for sx in (-1, 1) for sy in (-1, 1)],
                 (0, 0, 1), r=0.003)
    # light bar along the forward edge
    lb = g.at((0.0, -0.195, 0.0))
    rect_bezel(lb, 0.46, 0.034, 'chrome', bw=0.008, bh=0.008, c=0.008)
    frect(lb, 'dial_white', 0, 0, 0.462, 0.036, 0.0035)
    for i in range(11):
        lb.box('chrome', (0.0016, 0.036, 0.003), (-0.21 + i * 0.042, 0, 0.005))
    info['light_bar'] = O @ Vector((0, -0.195, 0.0))
    # left sub-panel: toggles, breakers, knobs
    a = g.at((-0.105, 0.045, 0.003))
    toggle_row(a.at((0.0, 0.105, 0)), 12, 0.0245)
    toggle_row(a.at((-0.03, -0.105, 0)), 9, 0.0245)
    for i in range(14):                               # circuit breakers
        b = a.at((-0.16 + i * 0.0225, 0.045, 0))
        b.lathe('rubber_black', [(0.0062, 0.0), (0.0062, 0.003), (0.0042, 0.003), (0.0042, 0.009), (0.0, 0.009)], 8)
        b.lathe('dial_white', [(0.0044, 0.0065), (0.0044, 0.0078)], 8)
    legend(a, 0.0, 0.066, 0.30, 0.0026)
    for i, x in enumerate((-0.15, -0.10, -0.05)):
        k = a.at((x, -0.035, 0))
        knob(k, 0.0105, 0.014, ang=-0.8 + 0.7 * i)
        legend(k, 0, -0.024, 0.026, 0.0026)
    lamp(kit, st, 'lamp_9', O @ T(-0.105 + 0.03, 0.045 - 0.03, 0.003), r=0.0075)
    lamp(kit, st, 'lamp_10', O @ T(-0.105 + 0.07, 0.045 - 0.03, 0.003), r=0.0075)
    info['lamp_9'] = O @ Vector((-0.075, 0.015, 0.003))
    info['lamp_10'] = O @ Vector((-0.035, 0.015, 0.003))
    for x in (0.03, 0.07):
        legend(a, x, -0.049, 0.022, 0.0026)
    # small green read-out window
    w = a.at((0.135, -0.040, 0))
    rect_bezel(w, 0.060, 0.020, 'chrome', bw=0.005, bh=0.005, c=0.004)
    frect(w, 'glass_green', 0, 0, 0.061, 0.021, 0.0015)
    legend(w, 0, -0.020, 0.05, 0.0026)
    # right sub-panel: guarded switches, eyeball vent, knob
    b = g.at((0.205, 0.045, 0.003))
    for i in range(3):
        guarded_switch(b.at((-0.055 + i * 0.03 + 0.025, 0.095, 0)), RED if i < 2 else YEL)
    frect(b, 'paint', 0, 0.052, 0.16, 0.007, 0.0005, YEL)
    for i in range(8):
        frect(b, 'paint', -0.07 + i * 0.02, 0.052, 0.007, 0.0072, 0.0008, BLK, rot=0.6)
    # eyeball air vent
    e = b.at((0.0, -0.01, 0))
    e.lathe('chrome', [(0.030, 0.0), (0.040, 0.0), (0.040, 0.004), (0.034, 0.010), (0.029, 0.010), (0.027, 0.004)], 24, sharp=45.0)
    e.dome('rubber_black', 0.0275, 0.014, (0, 0, 0.003), n=16, m=3)
    for i in range(4):
        e.box('frame_brushed', (0.030 - abs(i - 1.5) * 0.006, 0.0022, 0.004), (0, -0.012 + i * 0.008, 0.016 - abs(i - 1.5) * 0.0012))
    knob(b.at((-0.045, -0.095, 0)), 0.012, 0.015, ang=0.4)
    knob(b.at((0.035, -0.095, 0)), 0.012, 0.015, ang=-1.0)
    legend(b, -0.005, -0.125, 0.12, 0.0026)
    # grab handles on both sides
    for s in (-1, 1):
        g.pipe('chrome', [(s * 0.318, -0.10, 0.004), (s * 0.318, -0.10, 0.045), (s * 0.318, 0.10, 0.045), (s * 0.318, 0.10, 0.004)],
               0.0075, n=8, bend=0.018)
        for y in (-0.10, 0.10):
            g.lathe('chrome', [(0.014, 0.0), (0.014, 0.004), (0.009, 0.008)], 10, pos=(s * 0.318, y, 0.004))
    # cable trunk from the housing back to the hoop
    top = kit.pen(st)
    top.pipe('rubber_black', [(0.05, 0.02, 0.660), (0.05, -0.12, 0.672), (0.05, -0.27, 0.672)], 0.012, n=8, bend=0.03)
    top.pipe('rubber_black', [(0.085, 0.02, 0.655), (0.085, -0.12, 0.668), (0.085, -0.27, 0.668)], 0.008, n=6, bend=0.03)


# ==============================================================================================
def build_backwall(kit, st, walls, info):
    M, L = walls['back']
    p = kit.pen(st, M)
    f = p.mul(FACE)                                   # surface frame of the back wall (z toward the cabin)
    # hatch: frame, door, porthole, lever, hinges
    hc = (0.0, -0.13)
    ho = move_poly(rrect(0.275, 0.575, 0.07, seg=3), hc[0], hc[1])
    f.steps('lacquer_black', ho, [(0.0, 0.0), (0.0, 0.010), (0.004, 0.014), (0.030, 0.014), (0.034, 0.008)], plane='XY',
            cap0=False, cap1=False)
    f.steps('panel_satin', ho, [(0.034, 0.008), (0.040, 0.016), (0.044, 0.018)], plane='XY', cap0=False)
    # hazard band over the door
    for i in range(13):
        frect(f, 'paint', -0.21 + i * 0.035, 0.475, 0.022, 0.016, 0.0008, YEL if i % 2 == 0 else BLK, rot=0.0)
    frect(f, 'paint', 0, 0.475, 0.47, 0.020, 0.0005, BLK)
    # porthole
    w = f.at((0.0, 0.25, 0.018))
    round_bezel(w, 0.062, 'chrome', w=0.020, h=0.012, n=28, fat=True)
    w.disc('screen_off', 0.066, (0, 0, 0.002), n=28)
    w.screws('frame_brushed', [(0.072 * cos(i * pi / 4), 0.072 * sin(i * pi / 4), 0.011) for i in range(8)], (0, 0, 1), r=0.003)
    # lever handle
    h = f.at((0.14, -0.02, 0.018))
    h.lathe('chrome', [(0.030, 0.0), (0.030, 0.004), (0.022, 0.010), (0.012, 0.010)], 16, sharp=45.0)
    h.cyl('chrome', 0.011, 0.03, (0, 0, 0.022), n=10)
    h.box('frame_brushed', (0.030, 0.17, 0.016), (0, -0.07, 0.032), bv=0.004)
    h.pillow('rubber_black', 0.017, 0.045, 0.012, rc=0.008, re=0.005, bulge=0.002, m=2, ne=2, npf=1, pos=(0, -0.115, 0.038))
    # hinges
    for z in (0.20, -0.42):
        hg = f.at((-0.245, hc[1] + z, 0.014))
        hg.cyl('frame_brushed', 0.011, 0.10, (0, 0, 0.008), axis='Y', n=10, ch=0.002)
        hg.box('frame_brushed', (0.07, 0.07, 0.005), (0.03, 0, 0.004), bv=0.0015)
        hg.screws('chrome', [(0.045, 0.02, 0.0065), (0.045, -0.02, 0.0065), (0.02, 0.02, 0.0065), (0.02, -0.02, 0.0065)], (0, 0, 1), r=0.0035)
    # door placard + latch dogs
    text_rows(f, 0.0, 0.11, 0.16, 3, mat='legend_glow', z=0.0185)
    for (x, y) in ((0.215, 0.33), (0.215, -0.52), (-0.215, -0.52), (0.215, -0.1)):
        f.box('frame_brushed', (0.05, 0.022, 0.010), (x * 1.05, hc[1] + y + 0.13, 0.016), bv=0.003)
    # exit sign above the door
    e = f.at((0.0, 0.535, 0.0))
    rect_bezel(e, 0.16, 0.034, 'chrome', bw=0.007, bh=0.007, c=0.006)
    frect(e, 'glass_green', 0, 0, 0.161, 0.035, 0.002)
    legend(e, 0, 0, 0.10, 0.012, mat='dial_white', z=0.0026, words=4)
    # vertical conduits beside the hatch
    for s in (-1, 1):
        for k in range(3):
            x = s * (0.335 + k * 0.032)
            p.pipe('chrome' if k == 1 else 'frame_brushed', [(x, -0.014, FLOOR + 0.02), (x, -0.014, 0.34), (x, -0.014, 0.44), (s * 0.30, -0.014, 0.56), (s * 0.30, -0.014, ROOF - 0.01)],
                   0.009 if k != 1 else 0.011, n=8, bend=0.04)
        for z in (-0.35, 0.05, 0.36):
            p.box('frame_brushed', (0.105, 0.012, 0.022), (s * 0.367, -0.020, z), bv=0.003)
            p.screws('chrome', [(s * 0.325, -0.026, z), (s * 0.409, -0.026, z)], (0, -1, 0), r=0.0035)

    # corner panels: ribbed vents and a shutter vent each; extinguisher right, first-aid box left
    for name, s in (('br', 1), ('bl', -1)):
        M, L = walls[name]
        f = kit.pen(st, M @ FACE)
        cx = -0.060 * s                               # toward the hoop pillar
        for z, hgt in ((0.20, 0.17), (-0.03, 0.17)):
            v = f.at((cx, z, 0.0))
            v.steps('lacquer_black', rrect(0.078, hgt / 2 + 0.030, 0.02), [(0.0, 0.0), (0.0, 0.004), (0.003, 0.007), (0.012, 0.007)], plane='XY', cap0=False, cap1=True)
            vent_rect(v.at((0, 0, 0.007)), 0.100, hgt, ribs=11)
        sv = f.at((cx, 0.44, 0.0))
        vent_shutter(sv, 0.058, blades=9)
        legend(f, cx, 0.355, 0.08, 0.003)
        ax = 0.135 * s
        if s > 0:
            extinguisher(f.at((ax, -0.26, 0.0)))
            placard(f, ax, 0.065, 0.05, 0.05, 'sign')
            text_rows(f, ax, 0.02, 0.06, 2, z=0.0006)
            placard(f, ax, -0.46, 0.10, 0.02, 'hazard')
        else:
            bx = f.at((ax, -0.24, 0.0))
            bx.box('frame_brushed', (0.15, 0.20, 0.05), (0, 0, 0.025), bv=0.006)
            bx.box('chrome', (0.04, 0.02, 0.008), (0, 0.085, 0.052), bv=0.002)
            frect(bx, 'paint', 0, -0.012, 0.09, 0.09, 0.0505, WHT)
            frect(bx, 'paint', 0, -0.012, 0.064, 0.020, 0.0510, RED)
            frect(bx, 'paint', 0, -0.012, 0.020, 0.064, 0.0510, RED)
            text_rows(f, ax, 0.02, 0.06, 3, z=0.0006)
        # speaker grille high up
        sp = f.at((ax, 0.40, 0.0))
        sp.lathe('lacquer_black', [(0.052, 0.0), (0.052, 0.004), (0.046, 0.009), (0.040, 0.009), (0.038, 0.003)], 20, sharp=40.0)
        sp.disc('rubber_black', 0.039, (0, 0, 0.003), n=20)
        for i in range(5):
            sp.box('frame_brushed', (0.072 - abs(i - 2) * 0.012, 0.004, 0.003), (0, -0.024 + i * 0.012, 0.005))
        # cable loom running up the corner
        loom = kit.pen(st, M)
        for k in range(4):
            x = s * (-0.170 - k * 0.012)
            loom.pipe('rubber_black', [(x, -0.010 - (k % 2) * 0.008, -0.60), (x, -0.010 - (k % 2) * 0.008, 0.30), (x - s * 0.01, -0.012, 0.52), (x - s * 0.01, -0.012, ROOF - 0.005)],
                      0.006, n=6, bend=0.03, caps=False)
        for z in (-0.5, -0.15, 0.2, 0.5):
            loom.box('frame_brushed', (0.062, 0.012, 0.016), (s * -0.188, -0.018, z), bv=0.003)


def extinguisher(f):
    """Bottle strapped to a wall; f = surface frame (y up, z out of the wall) at the bottle centre."""
    ex = f.at((0, 0, 0.058))
    ex.lathe('paint', [(0.0, -0.15), (0.040, -0.15), (0.046, -0.14), (0.046, 0.10), (0.040, 0.135), (0.020, 0.155), (0.014, 0.17), (0.0, 0.17)], 16,
             axis='Y', sharp=50.0, col=RED)
    ex.lathe('chrome', [(0.016, 0.165), (0.016, 0.185), (0.010, 0.195), (0.0, 0.195)], 10, axis='Y')
    ex.box('rubber_black', (0.012, 0.012, 0.07), (0, 0.20, 0.03), (-0.25, 0, 0), bv=0.003)
    ex.box('chrome', (0.010, 0.006, 0.06), (0, 0.182, 0.03), (0.1, 0, 0), bv=0.002)
    ex.pipe('rubber_black', [(0.016, 0.18, 0.0), (0.05, 0.17, 0.0), (0.055, 0.05, 0.0), (0.05, -0.05, 0.0)], 0.006, n=6, bend=0.02)
    ex.lathe('paint', [(0.0468, 0.0), (0.0468, 0.06)], 16, axis='Y', col=WHT)
    for y in (-0.08, 0.075):
        ex.ring('frame_brushed', 0.0495, 0.0462, y - 0.009, y + 0.009, axis='Y', n=16)
        ex.box('frame_brushed', (0.03, 0.018, 0.03), (0.0, y, -0.045), bv=0.003)
    ex.box('frame_brushed', (0.10, 0.008, 0.07), (0, -0.156, -0.03), bv=0.002)


# ==============================================================================================
def build_sidewalls(kit, st, walls, info):
    p0 = kit.pen(st)
    # ---- right wall: round louvred vent, ribbed vent, three pipes, grab rail, extinguisher ----
    M, L = walls['right']                             # local x = -(world y - 0.25)
    f = kit.pen(st, M @ FACE)
    p = kit.pen(st, M)
    v = f.at((-0.03, -0.345, 0.0))
    v.steps('lacquer_black', circle(0.125, 8, pi / 8), [(0.0, 0.0), (0.0, 0.004), (0.004, 0.008)], plane='XY', cap0=False)
    vent_round(v.at((0, 0, 0.008)), 0.086, slats=10)
    v.screws('chrome', [(0.112 * cos(pi / 8 + i * pi / 4), 0.112 * sin(pi / 8 + i * pi / 4), 0.008) for i in range(8)], (0, 0, 1), r=0.004)
    v2 = f.at((0.31, -0.372, 0.0))
    v2.steps('lacquer_black', rrect(0.135, 0.078, 0.02), [(0.0, 0.0), (0.0, 0.004), (0.003, 0.007)], plane='XY', cap0=False)
    vent_rect(v2.at((0, 0, 0.007)), 0.215, 0.105, ribs=7)
    # junction block and three pipes
    jb = f.at((0.125, -0.262, 0.0))
    jb.box('frame_brushed', (0.05, 0.085, 0.034), (0, 0, 0.017), bv=0.005)
    jb.screws('chrome', [(sx * 0.017, sy * 0.034, 0.034) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0035)
    for k in range(3):
        z = -0.236 - k * 0.026
        p.pipe('chrome', [(0.15, -0.019, z), (0.44, -0.019, z), (0.49, -0.019, z - 0.05), (0.49, -0.019, -0.47)], 0.0085, n=8, bend=0.03)
    for x in (0.25, 0.40):
        p.box('frame_brushed', (0.016, 0.014, 0.085), (x, -0.024, -0.262), bv=0.003)
    # grab rail above the rim
    rz = RIM_SIDE + 0.050
    rail(p, [(-0.06, TH / 2 - 0.004, rz), (0.20, TH / 2 - 0.004, rz), (0.46, TH / 2 - 0.004, rz)], 0.009, stand=0.036, nrm=(0, 0, 1))
    # placards
    text_rows(f, -0.03, -0.228, 0.07, 1, z=0.0006)
    placard(f, 0.135, -0.405, 0.062, 0.046, 'data')
    placard(f, 0.135, -0.350, 0.062, 0.016, 'hazard')
    placard(f, -0.30, -0.42, 0.11, 0.018, 'hazard')
    placard(f, -0.30, -0.465, 0.08, 0.04, 'data')
    text_rows(f, 0.31, -0.282, 0.12, 1, z=0.0006)

    # ---- left wall: shutter vent, two portrait ribbed vents, cable loom, rail, document box ----
    M, L = walls['left']                              # local x = world y - 0.25
    f = kit.pen(st, M @ FACE)
    p = kit.pen(st, M)
    v = f.at((0.04, -0.345, 0.0))
    v.steps('lacquer_black', circle(0.118, 8, pi / 8), [(0.0, 0.0), (0.0, 0.004), (0.004, 0.008)], plane='XY', cap0=False)
    vent_shutter(v.at((0, 0, 0.008)), 0.074, blades=10)
    v.screws('chrome', [(0.106 * cos(pi / 8 + i * pi / 4), 0.106 * sin(pi / 8 + i * pi / 4), 0.008) for i in range(8)], (0, 0, 1), r=0.004)
    for x in (-0.20, -0.335):
        v2 = f.at((x, -0.358, 0.0))
        v2.steps('lacquer_black', rrect(0.060, 0.094, 0.018), [(0.0, 0.0), (0.0, 0.004), (0.003, 0.007)], plane='XY', cap0=False)
        vent_rect(v2.at((0, 0, 0.007)), 0.080, 0.145, ribs=10)
    # cable loom along the top with clamps, dropping behind the console
    for k in range(5):
        z = -0.232 - (k % 3) * 0.011
        y = -0.010 - (k // 3) * 0.011 - (k % 2) * 0.004
        p.pipe('rubber_black', [(-0.50, y, z), (-0.10, y, z), (0.165, y, z), (0.19, y, z - 0.04), (0.19, y, -0.47)], 0.0052, n=6, bend=0.025, caps=False)
    for x in (-0.45, -0.27, -0.10, 0.12):
        p.box('frame_brushed', (0.014, 0.030, 0.042), (x, -0.012, -0.243), bv=0.003)
        p.screw('chrome', (x, -0.027, -0.243), (0, -1, 0), r=0.0035)
    rz = RIM_SIDE + 0.050
    rail(p, [(-0.46, TH / 2 - 0.004, rz), (-0.20, TH / 2 - 0.004, rz), (0.06, TH / 2 - 0.004, rz)], 0.009, stand=0.036, nrm=(0, 0, 1))
    text_rows(f, 0.04, -0.235, 0.07, 1, z=0.0006)
    placard(f, 0.235, -0.385, 0.075, 0.05, 'data')
    placard(f, 0.235, -0.330, 0.075, 0.016, 'hazard')
    placard(f, -0.45, -0.37, 0.07, 0.05, 'data')
    # ---- lower walls in the foot well: kick panels with bolts -------------------------------------
    for name in ('fr', 'fl', 'front'):
        M, L = walls[name]
        f = kit.pen(st, M @ FACE)
        f.at((0, -0.80, 0)).plate('lacquer_black', rrect(L / 2 - 0.05, 0.30, 0.03), 0.0, 0.006, ch=0.002, plane='XY', back=False)
        f.screws('chrome', [(sx * (L / 2 - 0.075), -0.80 + sy * 0.27, 0.006) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.004)


# ==============================================================================================
def build_shroud(kit, st, info):
    """Dash top between the front walls and the cluster brows, plus the status-stalk pedestal."""
    p0 = kit.pen(st)

    def wpt(s, u, v, back=0.012):
        W = CL.wing_frame(s)
        return tuple(W @ Vector((s * u, back, v)))
    C = panel_frame(CL.C_POS, 0.0, CL.C_TILT)
    for s in (-1, 1):
        H0 = tuple(C @ Vector((s * 0.100, 0.015, 0.203)))
        Hm = tuple(C @ Vector((0.0, 0.015, 0.203)))
        W0 = wpt(s, -0.250, 0.098)
        W1 = wpt(s, 0.090, 0.108)
        W2 = wpt(s, 0.215, 0.037)
        W3 = wpt(s, 0.207, -0.085)
        F0 = (s * 0.41, 1.17, RIM_FRONT + 0.002)
        Fm = (0.0, 1.17, RIM_FRONT + 0.002)
        F1 = (s * 0.71, 0.805, RIM_MID + 0.004)
        F2 = (s * 0.71, 0.60, -0.272)
        G3 = (s * 0.71, 0.545, -0.66)
        V = [Hm, H0, W0, W1, W2, F2, F1, F0, Fm, W3, G3]
        F = [(0, 1, 7, 8), (1, 2, 7), (2, 3, 7), (3, 6, 7), (3, 4, 6), (4, 5, 6), (4, 9, 10, 5)]
        if s < 0:
            F = [tuple(reversed(f)) for f in F]
        p0.sheet('panel_satin', V, F, th=0.022)
        # end-cheek fresh-air vent facing the pilot
        a, b, c, d = Vector(W2), Vector(W3), Vector(G3), Vector(F2)
        cen = (a + b + c + d) / 4 + Vector((s * 0.02, 0, 0.03))
        nrm = (c - a).cross(d - b) * (1.0 if s > 0 else -1.0)
        nrm.normalize()
        if nrm.y > 0:
            nrm = -nrm
        g = p0.mul(frame_z(cen + nrm * 0.001, nrm, (1, 0, 0)))
        vent_round(g, 0.045, slats=6, n=24)
        # demister grille lying on the side facet
        a, b, c = Vector(W1), Vector(F1), Vector(F0)
        cen = a * 0.42 + b * 0.29 + c * 0.29
        nrm = (b - a).cross(c - a)
        if nrm.z < 0:
            nrm = -nrm
        dg = p0.mul(frame_z(cen + nrm.normalized() * 0.0005, nrm, c - b))
        vent_rect(dg, 0.17, 0.050, ribs=5, fw=0.009, fh=0.007, c=0.010)
        # harness from under the wing into the console step
        W = CL.wing_frame(s)
        for kk in range(3):
            a = W @ Vector((s * (0.05 + kk * 0.03), 0.10, -0.125))
            p0.pipe('rubber_black', [tuple(a), (a.x + s * 0.02, a.y - 0.04, a.z - 0.10 - kk * 0.012),
                                     (s * (0.470 + kk * 0.022), 0.60, -0.70 - kk * 0.008), (s * (0.470 + kk * 0.022), 0.585, -0.645)],
                    0.0055 - kk * 0.0008, n=6, bend=0.05, bseg=5, caps=False)
        p0.box('frame_brushed', (0.085, 0.030, 0.012), (s * 0.492, 0.585, -0.644), bv=0.003)
    # demister slots and a sensor bump on the dash top
    top = p0.at((0, 1.05, RIM_FRONT + 0.002))
    for s in (-1, 1):
        top.box('rubber_black', (0.20, 0.022, 0.004), (s * 0.20, 0.03, 0.001))
        for i in range(9):
            top.box('frame_brushed', (0.0025, 0.022, 0.005), (s * 0.20 - 0.08 + i * 0.02, 0.03, 0.002))
    top.dome('screen_off', 0.022, 0.012, (0, 0.03, 0.0), n=14, m=3)
    top.ring('chrome', 0.027, 0.021, 0.0, 0.004, ch=0.001, pos=(0, 0.03, 0.0), n=14)
    # head-up projector box behind the centre brow
    pj = top.at((0, -0.055, 0.0))
    pj.steps('lacquer_black', rrect(0.075, 0.034, 0.010), [(0.0, 0.0), (0.0, 0.012), (0.004, 0.016)], plane='XY', cap0=False)
    rect_bezel(pj.at((0, 0, 0.016)), 0.100, 0.030, 'chrome', bw=0.005, bh=0.004, c=0.005)
    frect(pj, 'screen_off', 0, 0, 0.101, 0.031, 0.0175)
    pj.screws('chrome', [(sx * 0.066, sy * 0.026, 0.016) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.003)
    # pedestal under the status stalk (side profile in the YZ plane)
    prof = [(0.655, -0.835), (0.775, -0.835), (0.850, FLOOR), (0.690, FLOOR)]
    p0.prism('panel_satin', prof, -0.052, 0.052, plane='YZ', bv=0.008)
    a, b = Vector((0.0, 0.655, -0.835)), Vector((0.0, 0.690, FLOOR))
    d = (b - a).normalized()
    nrm = Vector((0, -d.z, d.y))
    if nrm.y > 0:
        nrm = -nrm
    g = p0.mul(frame((a + b) / 2 + nrm * 0.006 + d * (-0.045), (1, 0, 0), nrm.cross(Vector((1, 0, 0))), nrm))
    g.drilled('bronze', 3, 8, 0.024, 0.0072, 0.004, margin=0.008)
    g.screws('chrome', [(sx * 0.040, sy * 0.100, 0.002) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0035)
    for s in (-1, 1):
        p0.pipe('chrome', [(s * 0.058, 0.70, -0.80), (s * 0.058, 0.735, -1.10), (s * 0.058, 0.80, -1.20), (s * 0.058, 0.95, -1.215)], 0.008, n=8, bend=0.05)
        p0.box('frame_brushed', (0.018, 0.03, 0.03), (s * 0.056, 0.722, -0.98), bv=0.004)
    # foot of the pedestal
    p0.box('frame_brushed', (0.16, 0.22, 0.012), (0, 0.775, FLOOR + 0.006), bv=0.003)
    p0.screws('chrome', [(sx * 0.068, 0.775 + sy * 0.095, FLOOR + 0.012) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.005, h=0.003)


# ==============================================================================================
def console_body(p0, s):
    pts = [(s * 0.40, FLOOR), (s * 0.72, FLOOR), (s * 0.72, -0.466), (s * 0.40, -0.530)]
    p0.prism('lacquer_black', pts, -0.30, 0.52, plane='XZ', bv=0.007)
    p0.box('lacquer_black', (0.30, 0.11, 0.60), (s * 0.565, 0.565, FLOOR + 0.30), bv=0.007)
    # inner side face: recessed satin panel, chrome trim
    if s > 0:
        I = frame((0.40, 0.11, -0.86), (0, -1, 0), (1, 0, 0), (0, 0, 1))
    else:
        I = frame((-0.40, 0.11, -0.86), (0, 1, 0), (-1, 0, 0), (0, 0, 1))
    f = p0.mul(I @ FACE)
    f.plate('panel_satin', rrect(0.36, 0.27, 0.03), 0.0, 0.004, ch=0.0015, plane='XY', back=False)
    f.box('chrome', (0.70, 0.010, 0.004), (0, 0.235, 0.006), bv=0.0015)
    f.screws('chrome', [(sx * 0.335, sy * 0.245, 0.004) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.004)
    return f


def console_rail(g, x0, x1):
    """Slim chrome rail along the inboard edge of a console top."""
    y, z = -0.139, 0.018
    xm = (x0 + x1) / 2
    rail(g, [(x0, y, z), (xm, y, z), (x1, y, z)], 0.005, stand=0.018, nrm=(0, 0, 1), n=8, bend=0.0)


def placard(f, x, y, w=0.07, h=0.045, kind='data', z=0.0006):
    """Printed plate on a wall: 'data' = white plate with text, 'hazard' = striped warning strip."""
    if kind == 'data':
        frect(f, 'paint', x, y, w, h, z, WHT)
        frect(f, 'paint', x, y + h * 0.30, w * 0.86, h * 0.20, z + 0.0003, BLK)
        rows = max(1, int(h * 0.5 / 0.0075))
        text_rows(f, x, y + h * 0.05, w * 0.8, rows, pitch=0.0075, h=0.0032, mat='rubber_black', z=z + 0.0003)
        f.screws('chrome', [(x + sx * (w / 2 - 0.004), y + sy * (h / 2 - 0.004), z) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0018, h=0.001, dark=None)
    elif kind == 'hazard':
        frect(f, 'paint', x, y, w, h, z, YEL)
        n = max(2, int(w / (h * 1.1)))
        for i in range(n):
            frect(f, 'paint', x - w / 2 + (i + 0.5) * w / n, y, h * 0.42, h * 1.02, z + 0.0003, BLK, rot=0.6)
    else:
        frect(f, 'paint', x, y, w, h, z, RED)
        frect(f, 'paint', x, y, w * 0.62, h * 0.20, z + 0.0003, WHT)
        frect(f, 'paint', x, y, w * 0.20, h * 0.62, z + 0.0003, WHT)


def build_consoles(kit, info):
    st = 'st_console'
    kit.mesh(st)
    p0 = kit.pen(st)
    # ================= left console: throttle quadrant, key switch, toggle rows =================
    f = console_body(p0, -1)
    text_rows(f, -0.18, 0.12, 0.12, 4, z=0.0045)
    # map pocket (leather) on the inner face
    f.pillow('leather_orange', 0.13, 0.085, 0.022, rc=0.02, re=0.010, bulge=0.004, m=3, ne=2, npf=2, pos=(0.14, -0.06, 0.004))
    f.box('frame_brushed', (0.27, 0.014, 0.006), (0.14, 0.03, 0.022), bv=0.002)
    Lf = console_frame(-1)                            # x = forward (+Y world), y = outboard
    g = kit.pen(st, Lf)
    info['console_L'] = Lf
    # top inlays
    g.at((0.055, 0.0, 0)).plate('panel_satin', rrect(0.355, 0.125, 0.02), 0.0, 0.003, ch=0.0012, plane='XY', back=False)
    g.screws('chrome', [(0.055 + sx * 0.342, sy * 0.112, 0.003) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0035)
    z0 = 0.003
    # throttle quadrant (the lever itself is built in ck_controls)
    tq = g.at((0.13, -0.035, z0))
    info['throttle_base'] = Lf @ Vector((0.13, -0.035, z0))
    for sy in (-1, 1):
        pts = [(-0.085, 0.0), (0.085, 0.0), (0.070, 0.024), (0.035, 0.036), (-0.035, 0.036), (-0.070, 0.024)]
        tq.prism('lacquer_black', pts, sy * 0.011, sy * 0.030, plane='XZ', bv=0.003)
        tq.prism('bronze', [(-0.066, 0.004), (0.066, 0.004), (0.052, 0.0235), (0.028, 0.031), (-0.028, 0.031), (-0.052, 0.0235)],
                 sy * 0.0300, sy * 0.0318, plane='XZ')
    tq.box('rubber_black', (0.15, 0.022, 0.004), (0, 0, 0.002))
    for i in range(9):                                # detent scale on the outboard cheek
        tq.box('legend_glow', (0.0016, 0.006 if i % 2 == 0 else 0.004, 0.0006), (-0.056 + i * 0.014, 0.040, 0.0003))
    legend(tq, 0.0, 0.050, 0.07, 0.0028)
    # key switch
    ks = g.at((0.325, 0.045, z0))
    ks.lathe('chrome', [(0.020, 0.0), (0.020, 0.003), (0.016, 0.008), (0.010, 0.009), (0.0, 0.009)], 18, sharp=40.0)
    ks.box('chrome', (0.0022, 0.012, 0.020), (0, 0, 0.018), (0, 0, 0.5))
    ks.box('rubber_black', (0.006, 0.024, 0.016), (0, 0, 0.034), (0, 0, 0.5), bv=0.002)
    ks.torus('chrome', 0.008, 0.0009, (0.004, -0.007, 0.040), axis='X', rot=(0, 0, 0.5), n=10, m=4)
    ks.box('leather_orange', (0.004, 0.016, 0.034), (0.010, -0.018, 0.030), (0.5, 0.0, 0.5), bv=0.0015)
    for i, a in enumerate((-0.9, 0.0, 0.9)):
        tick(ks, 'legend_glow', a, 0.024, 0.030, 0.0018)
    legend(ks, 0.0, -0.036, 0.04, 0.0028)
    lamp(kit, st, 'lamp_5', Lf @ T(0.325 - 0.045, 0.085, z0), r=0.0065)
    lamp(kit, st, 'lamp_6', Lf @ T(0.325 - 0.015, 0.085, z0), r=0.0065)
    info['lamp_5'] = Lf @ Vector((0.280, 0.085, z0))
    info['lamp_6'] = Lf @ Vector((0.310, 0.085, z0))
    legend(g, 0.295, 0.099, 0.05, 0.0026, z=z0 + 0.0005)
    # mode lever with a chrome ball (static) in a small gate
    ml = g.at((0.31, -0.070, z0))
    ml.box('frame_brushed', (0.06, 0.026, 0.004), (0, 0, 0.002), bv=0.001)
    ml.box('rubber_black', (0.044, 0.007, 0.0045), (0, 0, 0.0023))
    ml.rod('chrome', (0.008, 0, 0.002), (0.020, 0.0, 0.050), 0.0022, n=6)
    ml.ball('chrome', 0.0085, (0.021, 0.0, 0.054), n=12, m=6)
    # two rows of toggles
    tr = g.at((-0.105, 0.028, z0))
    toggle_row(tr, 6, 0.024)
    tr = g.at((-0.105, -0.027, z0))
    toggle_row(tr, 6, 0.024)
    # radio: frequency read-out and a key row
    ro = g.at((-0.105, 0.094, z0))
    rect_bezel(ro, 0.110, 0.019, 'chrome', bw=0.005, bh=0.005, c=0.004)
    frect(ro, 'glass_green', 0, 0, 0.111, 0.020, 0.0015)
    legend(ro, -0.012, 0, 0.075, 0.008, mat='dial_white', z=0.0019, words=7)
    for i in range(7):
        keycap(g.at((-0.105 - 0.057 + i * 0.019, 0.066, z0)), 0.015, 0.012, 0.0045, 'panel_satin', 'legend_glow' if i != 6 else 'glass_green')
    console_rail(g, -0.30, 0.40)
    # trim wheels (half sunk knurled wheels)
    for i, x in enumerate((-0.14, -0.075)):
        w = g.at((x, -0.075, z0))
        w.box('rubber_black', (0.040, 0.014, 0.003), (0, 0, 0.0015))
        w.lathe('frame_brushed', [(0.0, -0.005), (0.017, -0.005), (0.019, -0.003), (0.019, 0.003), (0.017, 0.005), (0.0, 0.005)], 16, axis='Y', facet=True)
        legend(w, 0, -0.016, 0.03, 0.0026)
    # rear: two knobs and a parking lever with a boot
    for i, x in enumerate((-0.235, -0.275)):
        k = g.at((x, 0.05, z0))
        knob(k, 0.0115, 0.016, ang=0.7 - i * 1.2)
    legend(g, -0.255, 0.022, 0.06, 0.0026, z=z0 + 0.0005)
    pl = g.at((-0.265, -0.05, z0))
    pl.lathe('rubber_black', [(0.026, 0.0), (0.026, 0.004), (0.020, 0.010), (0.022, 0.014), (0.015, 0.020), (0.017, 0.024), (0.010, 0.030), (0.0, 0.030)], 12,
             sharp=70.0, scale=(1.5, 1.0, 1.0))
    pl.rod('chrome', (0.0, 0, 0.026), (-0.060, 0, 0.060), 0.006, n=8)
    pl.rloft('rubber_black', [(-0.115, 0.010, 0.010), (-0.110, 0.0125, 0.0125), (-0.065, 0.0125, 0.0125), (-0.058, 0.009, 0.009)], n=10, axis='X',
             pos=(0, 0, 0.026), rot=(0, 0.515, 0))
    # ================= right console: keypad, guarded switches, selector, trackball =================
    f = console_body(p0, 1)
    # emergency pull handle on the inner face
    f.box('paint', (0.11, 0.05, 0.004), (-0.17, 0.14, 0.006), bv=0.001, col=YEL)
    for i in range(6):
        frect(f, 'paint', -0.215 + i * 0.018, 0.14, 0.008, 0.052, 0.0085, BLK, rot=0.5)
    f.pipe('paint', [(-0.205, 0.125, 0.008), (-0.205, 0.125, 0.034), (-0.135, 0.125, 0.034), (-0.135, 0.125, 0.008)], 0.006, n=8, bend=0.014, col=RED)
    text_rows(f, 0.12, 0.12, 0.14, 4, z=0.0045)
    f.at((0.15, -0.07, 0.004)).plate('lacquer_black', rrect(0.14, 0.08, 0.02), 0.0, 0.004, ch=0.0015, plane='XY', back=False)
    vent_rect(f.at((0.15, -0.07, 0.008)), 0.20, 0.09, ribs=6, fw=0.010, fh=0.007)
    Rf = console_frame(1)                             # x = aft (-Y world), y = outboard
    g = kit.pen(st, Rf)
    info['console_R'] = Rf
    g.at((-0.055, 0.0, 0)).plate('panel_satin', rrect(0.355, 0.125, 0.02), 0.0, 0.003, ch=0.0012, plane='XY', back=False)
    g.screws('chrome', [(-0.055 + sx * 0.342, sy * 0.112, 0.003) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0035)
    # keypad 4 x 4 with a read-out
    kp = g.at((-0.305, -0.022, z0))
    kp.plate('lacquer_black', rrect(0.054, 0.054, 0.008), 0.0, 0.003, ch=0.001, plane='XY', back=False)
    for iy in range(4):
        for ix in range(4):
            special = (ix == 3)
            k = kp.at((-0.0345 + ix * 0.023, -0.0345 + iy * 0.023, 0.003))
            keycap(k, 0.019, 0.019, 0.006, 'panel_satin' if not special else 'paint', 'legend_glow' if not special else None,
                   col=(AMB if iy > 1 else GRY) if special else None)
    ro = g.at((-0.305, 0.062, z0))
    rect_bezel(ro, 0.090, 0.022, 'chrome', bw=0.005, bh=0.005, c=0.004)
    frect(ro, 'glass_green', 0, 0, 0.091, 0.023, 0.0015)
    legend(ro, 0, 0, 0.07, 0.008, mat='dial_white', z=0.0019, words=6)
    # guarded switches on a hazard plate
    hz = g.at((-0.155, 0.045, z0))
    frect(hz, 'paint', 0, 0, 0.125, 0.052, 0.0004, YEL)
    for i in range(7):
        frect(hz, 'paint', -0.054 + i * 0.018, -0.0225, 0.007, 0.0075, 0.0007, BLK, rot=0.6)
        frect(hz, 'paint', -0.054 + i * 0.018, 0.0225, 0.007, 0.0075, 0.0007, BLK, rot=0.6)
    for i in range(3):
        guarded_switch(hz.at((-0.04 + i * 0.04, 0.0, 0.0007)), RED)
    toggle_row(g.at((-0.155, -0.045, z0)), 5, 0.024)
    lamp(kit, st, 'lamp_7', Rf @ T(-0.060, 0.070, z0), r=0.0065)
    lamp(kit, st, 'lamp_8', Rf @ T(-0.030, 0.070, z0), r=0.0065)
    info['lamp_7'] = Rf @ Vector((-0.060, 0.070, z0))
    info['lamp_8'] = Rf @ Vector((-0.030, 0.070, z0))
    legend(g, -0.045, 0.085, 0.05, 0.0026, z=z0 + 0.0005)
    # big selector
    sel = g.at((-0.045, 0.005, z0))
    knob(sel, 0.019, 0.020, ang=0.6)
    legend(sel, 0, -0.040, 0.05, 0.0028)
    # trackball in a chrome ring with two keys
    tb = g.at((0.075, 0.020, z0))
    tb.lathe('chrome', [(0.030, 0.0), (0.030, 0.004), (0.026, 0.009), (0.0215, 0.009), (0.021, 0.004)], 20, sharp=45.0)
    tb.ball('glass_red', 0.0205, (0, 0, 0.002), n=16, m=8)
    for sx in (-1, 1):
        keycap(tb.at((sx * 0.022, -0.050, 0)), 0.036, 0.020, 0.006, 'panel_satin', 'legend_glow')
    console_rail(g, -0.40, 0.30)
    # rear: slider bank
    sb = g.at((0.215, 0.0, z0))
    sb.plate('lacquer_black', rrect(0.062, 0.070, 0.008), 0.0, 0.003, ch=0.001, plane='XY', back=False)
    for i in range(5):
        x = -0.044 + i * 0.022
        sb.box('rubber_black', (0.004, 0.105, 0.001), (x, 0, 0.0035))
        yy = -0.035 + 0.07 * _rnd()
        sb.box('frame_brushed', (0.013, 0.020, 0.010), (x, yy, 0.008), bv=0.002)
        sb.box('legend_glow', (0.0135, 0.002, 0.0102), (x, yy, 0.008))
        for j in range(5):
            frect(sb, 'legend_glow', x + 0.0085, -0.045 + j * 0.0225, 0.004, 0.0012, 0.0033)
    legend(g, 0.215, 0.085, 0.10, 0.0028, z=z0 + 0.0005)
    return info


from ck_parts import _rnd
