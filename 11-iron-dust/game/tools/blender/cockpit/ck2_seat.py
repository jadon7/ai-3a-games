# ck2_seat.py -- v2 "linear seat": a slim seat on one support arm that runs off backward-down, no floor.
#   st_frame (static): carriage, support arm, foot-rest spine with the pedal bar and heel rests
#   seat (shaken by the game): pan, narrow back, headrest, harness, arm rests with the stick pods,
#                              the two touch-panel arms and slabs, the throttle quadrant
from ck_parts import *
from ck2_cluster import STALK_BOT

SEAT_O = (0.0, 0.05, -0.80)
REC = radians(9.0)
STICK = (0.30, 0.45, -0.575)
ARM_A = Vector((0.0, 0.06, -0.992))          # support arm: under the carriage ...
ARM_B = Vector((0.0, -1.00, -1.690))         # ... to its cut-off end behind / below the seat
PEDAL_Y, PEDAL_Z = 0.745, -1.195
TOUCH_C = (0.53, 0.54, -0.47)                # centre of the right touch panel (x mirrored for the left)
TOUCH_W, TOUCH_H = 0.240, 0.160              # slab
TOUCH_SW, TOUCH_SH = 0.222, 0.148            # live screen face (3:2)
THR_HINGE = Vector((-0.3515, 0.245, -0.607))


def touch_frame(s):
    """Panel frame of a touch slab (x right, -y toward the viewer, z up), facing the eye."""
    c = Vector((s * TOUCH_C[0], TOUCH_C[1], TOUCH_C[2]))
    fwd = c.normalized()
    right = fwd.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(fwd)
    return frame(c, right, fwd, up)


def build_frame(kit):
    st = 'st_frame'
    kit.mesh(st)
    p = kit.pen(st)
    # carriage under the pan and the short suspension boot
    p.box('lacquer_black', (0.26, 0.34, 0.058), (0, 0.03, -0.951), bv=0.012)
    for s in (-1, 1):
        p.box('frame_brushed', (0.026, 0.30, 0.050), (s * 0.128, 0.03, -0.972), bv=0.005)
        p.screws('chrome', [(s * 0.1415, 0.03 + y, -0.972) for y in (-0.11, 0.0, 0.11)], (s, 0, 0), r=0.0045, h=0.0022)
    prof = [(0.062, -0.924)]
    for i in range(2):
        z = -0.924 + 0.036 * (i + 0.5) / 2
        prof += [(0.084, z - 0.004), (0.084, z + 0.004), (0.064, z + 0.009)]
    p.lathe('rubber_black', prof, 18, pos=(0, 0.03, 0), sharp=75.0)
    # the support arm: a boxed linear rail that leaves backward-down
    L = (ARM_B - ARM_A).length
    q = p.mul(frame_x((ARM_A + ARM_B) / 2, ARM_B - ARM_A, (1, 0, 0)))      # x along the arm, y = +X world, z = its top
    q.box('lacquer_black', (L, 0.096, 0.118), bv=0.012)
    for sy in (-1, 1):
        q.rod('chrome', (-L / 2 + 0.02, sy * 0.034, 0.064), (L / 2 - 0.06, sy * 0.034, 0.064), 0.0075, n=8)
        q.box('panel_satin', (L * 0.86, 0.004, 0.060), (0.0, sy * 0.050, 0.0), bv=0.0015)
        q.screws('chrome', [(-L * 0.38 + i * L * 0.19, sy * 0.052, 0.018) for i in range(5)], (0, sy, 0), r=0.004, h=0.002)
        q.pipe('rubber_black', [(-L / 2 + 0.05, sy * 0.022, -0.066), (L / 2 - 0.02, sy * 0.022, -0.066)], 0.0075, n=6)
    for i in range(int((L - 0.14) / 0.032)):
        q.box('frame_brushed', (0.014, 0.030, 0.006), (-L / 2 + 0.05 + i * 0.032, 0, 0.061))
    for x in (-L * 0.25, L * 0.12):
        q.box('frame_brushed', (0.030, 0.108, 0.020), (x, 0, -0.064), bv=0.004)
    e = q.at((L / 2, 0, 0))
    e.box('frame_brushed', (0.070, 0.118, 0.140), (-0.035, 0, 0), bv=0.010)
    e.lathe('chrome', [(0.036, 0.0), (0.046, 0.0), (0.046, 0.012), (0.040, 0.020), (0.030, 0.020)], 18, axis='X', sharp=45.0)
    e.disc('rubber_black', 0.031, (0.018, 0, 0), axis='X', n=18)
    # foot-rest spine from the carriage to the pedal bar
    a, b = Vector((0, 0.19, -0.968)), Vector((0, PEDAL_Y - 0.02, PEDAL_Z + 0.010))
    bar(p, a, b, 0.040, 0.028, 'frame_brushed', yhint=(1, 0, 0), bv=0.005, ext=0.02)
    p.rod('chrome', a + Vector((0, 0.03, -0.034)), b + Vector((0, -0.08, 0.012)), 0.0065, n=8)
    p.rod('frame_brushed', a + Vector((0, 0.03, -0.034)), a + (b - a) * 0.45 + Vector((0, 0.0, -0.030)), 0.0105, n=10, ch=0.002)
    p.box('lacquer_black', (0.066, 0.060, 0.050), (0, PEDAL_Y - 0.004, PEDAL_Z + 0.004), bv=0.008)
    p.rod('chrome', (-0.205, PEDAL_Y, PEDAL_Z), (0.205, PEDAL_Y, PEDAL_Z), 0.0062, n=8)
    for s in (-1, 1):
        p.lathe('frame_brushed', [(0.0, -0.006), (0.012, -0.006), (0.012, 0.004), (0.008, 0.008), (0.0, 0.008)], 10, axis='X',
                pos=(s * 0.207, PEDAL_Y, PEDAL_Z), rot=(0, 0, 0 if s > 0 else pi))
        # heel rest: small drilled plate on two stays
        hc = Vector((s * 0.14, PEDAL_Y - 0.092, PEDAL_Z - 0.030))
        hp = p.at(tuple(hc), (0.30, 0, 0))
        hp.drilled('frame_brushed', 3, 2, 0.026, 0.0082, 0.004, margin=0.006)
        bar(p, (s * 0.030, PEDAL_Y - 0.020, PEDAL_Z - 0.010), hc + Vector((-s * 0.040, 0.012, -0.002)), 0.012, 0.007, 'frame_brushed', yhint=(0, 0, 1), bv=0.002)
        bar(p, (s * 0.200, PEDAL_Y, PEDAL_Z), hc + Vector((s * 0.044, 0.016, 0.0)), 0.010, 0.007, 'frame_brushed', yhint=(0, 0, 1), bv=0.002)
        # pedal stop
        p.rod('rubber_black', (s * 0.14, PEDAL_Y + 0.050, PEDAL_Z - 0.012), (s * 0.14, PEDAL_Y + 0.062, PEDAL_Z + 0.004), 0.008, n=8)
        bar(p, (s * 0.030, PEDAL_Y + 0.010, PEDAL_Z - 0.010), (s * 0.14, PEDAL_Y + 0.050, PEDAL_Z - 0.014), 0.010, 0.007, 'frame_brushed', yhint=(0, 0, 1), bv=0.002)
    # socket for the cluster stalk on the spine
    p.box('lacquer_black', (0.052, 0.050, 0.046), tuple(STALK_BOT + Vector((0, 0.0, -0.012))), bv=0.007)
    return {}


def build_seat(kit):
    info = build_frame(kit)
    kit.empty('seat', None, T(*SEAT_O))
    kit.mesh('seat_m', 'seat')
    p = kit.pen('seat_m')
    info['seat'] = Vector(SEAT_O)

    # ---------------- pan ------------------------------------------------------------------------
    p.box('frame_brushed', (0.47, 0.55, 0.028), (0, 0.05, -0.870), bv=0.006)
    p.box('lacquer_black', (0.42, 0.045, 0.045), (0, 0.322, -0.862), bv=0.008)
    for s in (-1, 1):
        p.box('lacquer_black', (0.024, 0.50, 0.070), (s * 0.238, 0.05, -0.848), bv=0.006)
        p.screws('chrome', [(s * 0.2505, y, -0.848) for y in (-0.16, 0.05, 0.26)], (s, 0, 0), r=0.0045, h=0.0025)
    g = p.at((0, 0, -0.855))
    for s in (-1, 1):
        pad(g, 0.104, 0.086, 0.064, (s * 0.113, -0.118, 0), bulge=0.008)
        pad(g, 0.104, 0.090, 0.066, (s * 0.113, 0.064, 0), bulge=0.008)
        pad(g, 0.104, 0.074, 0.058, (s * 0.113, 0.234, 0), bulge=0.013, re=0.022, rc=0.03)
        for yy, hy, hh in ((-0.118, 0.086, 0.064), (0.064, 0.090, 0.066)):
            g.box('fabric_grey', (0.136, hy * 1.3, 0.016), (s * 0.113, yy, hh + 0.011), bv=0.024, segs=3)       # woven insert
    # emergency loop handle between the knees
    hb = p.at((0, 0.318, -0.838))
    hb.box('frame_brushed', (0.10, 0.030, 0.008), (0, 0, 0.0), bv=0.002)
    loop = [(-0.034, 0, 0.0), (-0.034, 0, 0.040), (-0.022, 0, 0.060), (0.022, 0, 0.060), (0.034, 0, 0.040), (0.034, 0, 0.0)]
    segs = []
    for i in range(len(loop) - 1):
        a, b = Vector(loop[i]), Vector(loop[i + 1])
        n = 3 if i in (0, 4) else (2 if i in (1, 3) else 4)
        for k in range(n):
            segs.append((a + (b - a) * (k / n), a + (b - a) * ((k + 1) / n)))
    for i, (a, b) in enumerate(segs):
        hb.rod('paint', a, b, 0.0058, n=8, caps=False, col=YEL if i % 2 == 0 else BLK)
    for a in loop[1:-1]:
        hb.ball('paint', 0.0058, a, n=8, m=4, col=BLK)

    # ---------------- narrow back -------------------------------------------------------------------
    B = frame((0.0, -0.235, -0.80), (-1, 0, 0), (0, -sin(REC), cos(REC)), (0, cos(REC), sin(REC)))
    g = p.mul(B)
    bo = [(-0.180, 0.0), (0.180, 0.0), (0.186, 0.30), (0.160, 0.61), (0.105, 0.665), (-0.105, 0.665), (-0.160, 0.61), (-0.186, 0.30)]
    g.prism('frame_brushed', bo, -0.034, 0.0, plane='XY', bv=0.007)
    g.at((0, 0.33, -0.034)).plate('lacquer_black', rrect(0.13, 0.26, 0.04), 0.0, -0.012, ch=0.004, plane='XY', back=False)
    for sx in (-1, 1):
        pad(g, 0.042, 0.140, 0.056, (sx * 0.132, 0.168, 0), (0, -sx * 0.28, 0), bulge=0.007, rc=0.02)
        pad(g, 0.040, 0.136, 0.052, (sx * 0.128, 0.456, 0), (0, -sx * 0.28, 0), bulge=0.007, rc=0.02)
    pad(g, 0.080, 0.106, 0.042, (0, 0.134, 0), bulge=0.007)
    c = g.at((0, 0.425, 0))
    c.plate('frame_brushed', rrect(0.080, 0.168, 0.020), 0.0, 0.034, ch=0.004, plane='XY', back=False)
    c.steps('lacquer_black', rrect(0.019, 0.019, 0.005), [(0.0, 0.034), (0.0, 0.0375), (0.004, 0.0375), (0.006, 0.0345)],
            plane='XY', cap0=False, cap1=True)
    c.screws('chrome', [(sx * 0.066, sy * 0.150, 0.034) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0040, h=0.0022)
    for sx in (-1, 1):
        c.box('rubber_black', (0.044, 0.013, 0.004), (sx * 0.038, 0.128, 0.0325))
    text_rows(c, 0, -0.10, 0.06, 2, mat='rubber_black', z=0.0345)
    g.box('frame_brushed', (0.25, 0.050, 0.050), (0, 0.628, 0.0), bv=0.010)
    for sx in (-1, 1):
        strap(g, [(sx * 0.038, 0.553, 0.035), (sx * 0.038, 0.30, 0.038), (sx * 0.038, 0.245, 0.048), (sx * 0.036, 0.10, 0.054),
                  (sx * 0.032, 0.035, 0.048)], 0.038, 0.003)
        g.box('chrome', (0.046, 0.030, 0.006), (sx * 0.038, 0.335, 0.040), bv=0.002)
        g.box('rubber_black', (0.028, 0.012, 0.0065), (sx * 0.038, 0.335, 0.040))
        g.box('chrome', (0.042, 0.022, 0.007), (sx * 0.033, 0.040, 0.050), bv=0.002)
    for s in (-1, 1):
        strap(p, [(s * 0.224, -0.150, -0.815), (s * 0.210, -0.140, -0.790), (s * 0.12, -0.085, -0.7785), (s * 0.03, -0.030, -0.7795)],
              0.044, 0.003, across=(0, 1, 0))
    bk = p.at((0, -0.02, -0.781))
    bk.lathe('chrome', [(0.030, 0.0), (0.033, 0.003), (0.033, 0.009), (0.028, 0.013), (0.0, 0.013)], 20, sharp=40.0)
    bk.lathe('glass_red', [(0.012, 0.013), (0.012, 0.0155), (0.0, 0.0165)], 12, sharp=60.0)
    # slim chrome cylinders beside the lower back
    for sx in (-1, 1):
        cy = g.at((sx * 0.216, 0.150, -0.010))
        cy.lathe('chrome', [(0.0, -0.110), (0.018, -0.110), (0.026, -0.096), (0.026, 0.092), (0.019, 0.106), (0.009, 0.111),
                            (0.009, 0.122), (0.0, 0.122)], 16, axis='Y', sharp=50.0)
        cy.lathe('rubber_black', [(0.012, 0.122), (0.012, 0.131), (0.007, 0.135), (0.0, 0.135)], 10, axis='Y')
        for y in (-0.06, 0.05):
            cy.ring('frame_brushed', 0.0282, 0.0262, y - 0.007, y + 0.007, axis='Y', n=16)
            cy.box('frame_brushed', (0.026, 0.014, 0.026), (-sx * 0.024, y, -0.010), bv=0.003)

    # ---------------- slim headrest -------------------------------------------------------------------
    Hd = frame((0.0, -0.355, -0.005), (-1, 0, 0), (0, 0, 1), (0, 1, 0))
    g = p.mul(Hd)
    g.prism('frame_brushed', rrect(0.142, 0.128, 0.042), -0.044, 0.0, plane='XY', bv=0.007)
    g.at((0, 0, -0.044)).plate('lacquer_black', rrect(0.095, 0.085, 0.03), 0.0, -0.010, ch=0.004, plane='XY', back=False)
    pad(g, 0.058, 0.084, 0.036, (0, -0.012, 0), bulge=0.006)
    for sx in (-1, 1):
        pad(g, 0.040, 0.106, 0.046, (sx * 0.096, 0.0, 0), (0, -sx * 0.22, 0), bulge=0.007, rc=0.02)
    for sx in (-1, 1):
        a = B @ Vector((sx * 0.065, 0.64, -0.012))
        b = Hd @ Vector((sx * 0.065, -0.118, -0.022))
        p.rod('chrome', a, b, 0.009, n=10)

    # ---------------- arm rests, stick pods, touch panels ------------------------------------------------
    for s in (-1, 1):
        x = s * STICK[0]
        p.box('frame_brushed', (0.028, 0.050, 0.255), (x - s * 0.012, -0.045, -0.742), bv=0.006)
        p.box('frame_brushed', (0.060, 0.050, 0.030), (s * 0.262, -0.045, -0.862), bv=0.005)
        p.cyl('chrome', 0.022, 0.066, (x, -0.045, -0.612), axis='X', n=16, ch=0.003)
        p.rod('frame_brushed', (x, 0.03, -0.866), (x, 0.15, -0.753), 0.0140, n=12, ch=0.003)
        p.rod('chrome', (x, 0.15, -0.753), (x, 0.275, -0.634), 0.0085, n=10)
        p.box('frame_brushed', (0.056, 0.56, 0.030), (x, 0.100, -0.612), bv=0.006)
        # riveted flanks and bolted top of the arm rest rail
        for sd in (-1, 1):
            p.screws('chrome', [(x + sd * 0.0282, -0.16 + i * 0.062, -0.612) for i in range(9)], (sd, 0, 0), r=0.0042, h=0.0024)
        p.screws('chrome', [(x + sd * 0.017, yy, -0.5968) for sd in (-1, 1) for yy in (0.165, 0.235, 0.305)], (0, 0, 1), r=0.0046, h=0.0026)
        pad(p, 0.033, 0.150, 0.026, (x, -0.015, -0.597), rc=0.022, re=0.010, bulge=0.005)
        pts = [(0.340, -0.640), (0.566, -0.640), (0.586, -0.606), (0.562, -0.5785), (0.360, -0.5785), (0.340, -0.602)]
        p.prism('lacquer_black', pts, x - 0.054, x + 0.054, plane='YZ', bv=0.006)
        p.box('shell_cream', (0.136, 0.280, 0.062), (x, 0.463, -0.6165), bv=0.028, segs=4)          # enamelled cover round the pod
        p.box('chrome', (0.118, 0.006, 0.012), (x, 0.332, -0.600), bv=0.002)
        top = p.at((x, STICK[1], -0.5785))
        top.lathe('chrome', [(0.048, 0.0), (0.048, 0.004), (0.042, 0.0095), (0.0345, 0.0095), (0.0335, 0.002)], 24, sharp=40.0)
        top.disc('rubber_black', 0.034, (0, 0, 0.0012), n=24)
        top.pillow('rubber_black', 0.040, 0.018, 0.007, rc=0.012, re=0.004, bulge=0.002, m=3, ne=2, npf=1, pos=(0, -0.066, 0))
        keycap(top.at((0, 0.080, 0)), 0.034, 0.016, 0.005, 'panel_satin', 'legend_glow' if s < 0 else 'glass_red')
        legend(top, 0, 0.063, 0.04, 0.0024)
        p.box('chrome', (0.003, 0.20, 0.006), (x - s * 0.0545, 0.455, -0.612), bv=0.001)
        p.screws('chrome', [(x - s * 0.054, y, -0.626) for y in (0.37, 0.54)], (-s, 0, 0), r=0.004, h=0.002)

        # ---- touch panel: thin glass slab on a short two-link arm from the pod's outboard flank ----
        PF = touch_frame(s)
        f = p.mul(PF @ FACE)                               # z toward the viewer
        o = rrect(TOUCH_W / 2, TOUCH_H / 2, 0.008, seg=2)
        f.steps('lacquer_black', o, [(0.0016, -0.0080), (0.0, -0.0064), (0.0, -0.0008), (0.0008, 0.0)], plane='XY')
        f.steps('chrome', o, [(0.0, -0.0056), (-0.0007, -0.0051), (-0.0007, -0.0027), (0.0, -0.0022)], plane='XY', cap0=False, cap1=False)
        f.lathe('chrome', [(0.0040, 0.0), (0.0040, 0.0010), (0.0030, 0.0014)], 10, pos=(0, -TOUCH_H / 2 + 0.0045, 0))
        f.lathe('dial_white', [(0.0028, 0.0008), (0.0028, 0.0016), (0.0, 0.0018)], 8, pos=(0, -TOUCH_H / 2 + 0.0045, 0))
        # Enamelled frame round the slab: one cream ring with cut corners (no square ones), bolted through at the
        # corners and along the bars, on a dark back shell. Orange tags are fixed over it.
        fw = 0.024
        fo = rrect(TOUCH_W / 2 + fw - 0.002, TOUCH_H / 2 + fw - 0.002, 0.020)
        f.steps('shell_cream', fo, [(0.0, -0.016), (0.0, 0.0045), (0.003, 0.0075), (fw - 0.004, 0.0075), (fw - 0.001, 0.0045),
                                    (fw - 0.001, -0.003)], plane='XY', cap0=False, cap1=False)
        f.prism('panel_satin', offset_poly(fo, 0.003), -0.024, -0.008, plane='XY', bv=0.003)                 # back shell
        bw, bh = TOUCH_W / 2 + fw / 2 - 0.002, TOUCH_H / 2 + fw / 2 - 0.002
        f.screws('chrome', [(sx * (bw - 0.002), sy * (bh - 0.002), 0.0075) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.0042, h=0.0020)
        f.screws('chrome', [(sx * 0.008, sy * bh, 0.0075) for sx in (-1, 1) for sy in (-1, 1)] +
                 [(sx * bw, -0.045, 0.0075) for sx in (-1, 1)], (0, 0, 1), r=0.0030, h=0.0015)
        from ck2_dress import label
        for nm, tx, ty, rz, w in (('g_ctrl', -s * 0.062, -bh, 0.0, 0.060), ('g_unit', -s * 0.080, bh, 0.0, 0.046),
                                  ('g_caut', s * bw, 0.018, s * pi / 2, 0.060)):
            tg = f.at((tx, ty, 0.0075), (0, 0, rz))
            tg.box('paint', (w + 0.006, w / 4 + 0.005, 0.003), (0, 0, 0.0015), bv=0.001, col=AMB)
            label(tg, nm, 0.0, 0.0, w, z=0.0036)
        name = 'scr_touch_L' if s < 0 else 'scr_touch_R'
        screen_rect(kit, name, PF @ T(0, -0.0004, 0), TOUCH_SW, TOUCH_SH, parent='seat')
        info[name] = (TOUCH_SW, TOUCH_SH)
        gb = p.mul(PF @ FACE @ RX(pi))                     # z away from the viewer
        gb.lathe('frame_brushed', [(0.030, 0.008), (0.030, 0.011), (0.018, 0.017), (0.0, 0.017)], 16, sharp=40.0)
        gb.screws('chrome', [(0.022 * cos(a), 0.022 * sin(a), 0.011) for a in (0.8, 2.4, 3.9, 5.5)], (0, 0, 1), r=0.0028, h=0.0015)
        fwd = PF.to_3x3() @ Vector((0, 1, 0))
        pb = PF.to_translation() + fwd * 0.028
        b0 = Vector((x + s * 0.060, 0.500, -0.607))
        e0 = Vector((s * 0.455, 0.580, -0.590))
        p.cyl('frame_brushed', 0.016, 0.012, (x + s * 0.057, 0.500, -0.607), axis='X', n=12, ch=0.002)
        for a, b in ((b0, e0), (e0, pb)):
            p.rod('chrome', a, b, 0.0060, n=8)
            p.rod('frame_brushed', a + (b - a) * 0.30, a + (b - a) * 0.70, 0.0082, n=8, ch=0.0015)
        for q in (b0, e0, pb):
            p.ball('chrome', 0.0115, tuple(q), n=12, m=6)

    # ---------------- throttle quadrant on the outboard flank of the left arm rest ----------------------
    t = p.at(tuple(THR_HINGE))
    prof = [(-0.050, -0.014), (0.050, -0.014), (0.047, 0.012), (0.034, 0.030), (0.014, 0.040), (-0.014, 0.040), (-0.034, 0.030),
            (-0.047, 0.012)]
    t.prism('bronze', prof, 0.0100, 0.0145, plane='YZ', bv=0.0012)
    t.prism('lacquer_black', prof, -0.0145, -0.0100, plane='YZ', bv=0.0012)
    for y in (-0.043, 0.043):
        t.box('frame_brushed', (0.030, 0.010, 0.012), (0, y, -0.006), bv=0.002)
    t.box('frame_brushed', (0.012, 0.070, 0.016), (0.0185, 0.0, -0.004), bv=0.002)
    for i in range(7):
        a = radians(-48 + i * 16)
        t.box('legend_glow', (0.0050, 0.0014, 0.0050), (-0.0125, sin(a) * 0.041, cos(a) * 0.041 - 0.001), (-a, 0, 0))
    info['throttle_hinge'] = THR_HINGE.copy()
    return info
