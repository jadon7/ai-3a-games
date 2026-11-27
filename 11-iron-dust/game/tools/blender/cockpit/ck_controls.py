# ck_controls.py -- moving controls: two sticks (+ trigger), two pedals, the throttle lever.
# Pivot empties keep world-aligned axes at rest, so the game can set Euler angles directly.
from ck_parts import *
from ck_seat import STICK, FLOOR


def build_stick(kit, s):
    name = 'stick_L' if s < 0 else 'stick_R'
    P = T(s * STICK[0], STICK[1], STICK[2])
    kit.empty(name, 'seat', P)
    kit.mesh(name + '_m', name)
    g = kit.pen(name + '_m', P)
    # ribbed ball
    r = 0.030
    prof = [(0.0, -r * 0.90)]
    K = 14
    for k in range(K + 1):
        phi = radians(-64.0 + 146.0 * k / K)
        rr = r * (1.0 if k % 2 == 0 else 0.925)
        prof.append((rr * cos(phi), rr * sin(phi)))
    g.lathe('chrome', prof, 20, sharp=14.0)
    g.lathe('chrome', [(0.0105, 0.027), (0.0105, 0.036), (0.0075, 0.040), (0.0075, 0.064), (0.013, 0.068), (0.0155, 0.074),
                       (0.0155, 0.078)], 12, sharp=40.0)

    # moulded grip, leaning slightly forward, three finger grooves on the front
    def cy(z):
        return (z - 0.075) * 0.12

    def groove(a, t):
        f = max(0.0, sin(a))
        if 0.086 < t < 0.150:
            return 1.0 - 0.075 * f * f * (0.5 - 0.5 * cos((t - 0.086) / 0.064 * 6 * pi))
        return 1.0
    st = []
    for (z, rx, ry) in ((0.076, 0.0150, 0.0170), (0.080, 0.0235, 0.0265), (0.086, 0.0200, 0.0230), (0.0967, 0.0190, 0.0225),
                        (0.1073, 0.0192, 0.0230), (0.118, 0.0192, 0.0232), (0.1287, 0.0190, 0.0230), (0.1393, 0.0188, 0.0228),
                        (0.150, 0.0195, 0.0236), (0.162, 0.0212, 0.0252), (0.172, 0.0205, 0.0240)):
        st.append((z, rx, ry, 0.0, cy(z)))
    g.rloft('frame_brushed', st, n=16, fn=groove, sharp=60.0)
    for z0 in (0.090, 0.116, 0.142):
        g.lathe('rubber_black', [(0.0196, z0), (0.0212, z0 + 0.002), (0.0212, z0 + 0.008), (0.0196, z0 + 0.010)], 16,
                pos=(0, cy(z0 + 0.005), 0), scale=(1.0, 1.16, 1.0))
    g.lathe('chrome', [(0.0205, 0.170), (0.0225, 0.172), (0.0225, 0.176), (0.0205, 0.178)], 16, pos=(0, cy(0.174), 0), scale=(1.0, 1.14, 1.0))
    # head, tilted toward the pilot
    q = g.at((0.0, 0.024, 0.190), (0.22, 0, 0))
    q.box('frame_brushed', (0.048, 0.048, 0.036), bv=0.008, segs=3, sharp=50.0)
    q.box('lacquer_black', (0.038, 0.038, 0.003), (0, 0, 0.0178), bv=0.004)
    from ck2_dress import label
    lf = q.mul(frame((0.0, -0.0246, -0.003), (1, 0, 0), (0, 0, 1), (0, -1, 0)))          # the face toward the pilot
    label(lf, 'k_move' if s < 0 else 'k_wpn', 0.0, 0.0, 0.040, z=0.0005)
    q.box('chrome', (0.0492, 0.036, 0.004), (0, 0, -0.012), bv=0.001)
    q.screws('chrome', [(s * 0.0242, -0.012, 0.004), (s * 0.0242, 0.012, 0.004)], (s, 0, 0), r=0.003, h=0.0016)
    if s > 0:
        # weapons stick: the fire button under a red guard, a lock key beside the thumb, a selector wheel
        push_button(q.at((-s * 0.0115, -0.006, 0.018)), 0.0072, 0.0055, 'glass_red')
        for dx in (-0.0095, 0.0095):
            q.box('glass_red', (0.0022, 0.022, 0.011), (-s * 0.0115 + dx, -0.006, 0.0235), bv=0.0008)
        q.box('glass_red', (0.021, 0.0022, 0.011), (-s * 0.0115, 0.0055, 0.0235), bv=0.0008)
        q.box('paint', (0.011, 0.011, 0.005), (s * 0.006, 0.014, 0.0205), bv=0.0015, col=AMB)
        q.cyl('rubber_black', 0.0125, 0.0075, (s * 0.0262, 0.004, 0.002), axis='X', n=16, ch=0.0015)
        q.cyl('chrome', 0.0060, 0.0090, (s * 0.0262, 0.004, 0.002), axis='X', n=10)
    else:
        # movement stick: a four-way hat under the thumb, a boost key, no trigger
        hb = q.at((-s * 0.0115, -0.006, 0.018))
        hb.lathe('chrome', [(0.0092, 0.0), (0.0092, 0.003), (0.0070, 0.0042)], 12)
        hb.box('rubber_black', (0.0170, 0.0052, 0.0050), (0, 0, 0.0062), bv=0.0012)
        hb.box('rubber_black', (0.0052, 0.0170, 0.0050), (0, 0, 0.0062), bv=0.0012)
        hb.dome('chrome', 0.0030, 0.0022, (0, 0, 0.0085), axis='Z', n=8)
        q.box('paint', (0.013, 0.009, 0.005), (s * 0.006, 0.015, 0.0205), bv=0.0015, col=AMB)
    h = q.at((s * 0.0115, -0.004, 0.018))
    h.lathe('chrome', [(0.0068, 0.0), (0.0068, 0.0025), (0.0050, 0.0035)], 10)
    h.lathe('rubber_black', [(0.0042, 0.003), (0.0030, 0.009), (0.0046, 0.011), (0.0, 0.0115)], 8, sharp=60.0)
    frect(q, 'legend_glow', 0, 0.013, 0.022, 0.0022, 0.0184)
    if s > 0:
        # trigger housing, guard and the trigger itself (own pivot)
        q.box('lacquer_black', (0.020, 0.016, 0.024), (0, 0.026, -0.014), bv=0.004, segs=2, sharp=50.0)
        g.pipe('chrome', [(0, 0.048, 0.178), (0, 0.068, 0.170), (0, 0.068, 0.128), (0, 0.030, 0.108)], 0.0022, n=6, bend=0.012, caps=False)
        TP = P @ T(0.0, 0.0445, 0.171)
        kit.empty('trigger_R', 'stick_R', TP)
        kit.mesh('trigger_R_m', 'trigger_R')
        t = kit.pen('trigger_R_m', TP)
        pts = [(-0.003, 0.003), (0.006, 0.003), (0.0085, -0.010), (0.0065, -0.026), (0.0025, -0.037), (-0.0025, -0.035),
               (0.0008, -0.022), (0.0018, -0.010), (-0.003, -0.004)]
        t.prism('paint', pts, -0.0045, 0.0045, plane='YZ', bv=0.0008, col=RED)
        t.cyl('chrome', 0.0032, 0.0115, (0, 0, 0), axis='X', n=8)
    else:
        # left stick: a rocker on the front of the head and an amber side key
        q.box('paint', (0.022, 0.006, 0.012), (0, 0.0255, 0.002), (0.25, 0, 0), bv=0.001, col=AMB)
        q.box('frame_brushed', (0.026, 0.004, 0.018), (0, 0.0245, 0.0), bv=0.001)
        g.box('chrome', (0.008, 0.012, 0.030), (0, 0.036, 0.142), (0.2, 0, 0), bv=0.002)
    return P


def build_pedal(kit, s):
    name = 'pedal_L' if s < 0 else 'pedal_R'
    P = T(s * 0.14, 0.745, -1.195)
    kit.empty(name, None, P)
    kit.mesh(name + '_m', name)
    t = radians(20.0)
    S = P @ frame((0, 0, 0), (1, 0, 0), (0, sin(t), cos(t)), (0, -cos(t), sin(t)))   # x right, y along the pedal, z = tread normal
    g = kit.pen(name + '_m', S)
    g.cyl('chrome', 0.0105, 0.098, (0, 0, 0), axis='X', n=12, ch=0.002)
    for sx in (-1, 1):
        g.box('frame_brushed', (0.008, 0.115, 0.016), (sx * 0.036, 0.055, 0.001), bv=0.002)
    g.drilled('bronze', 4, 6, 0.022, 0.0068, 0.005, margin=0.007, pos=(0, 0.152, 0.010))
    g.box('bronze', (0.102, 0.008, 0.018), (0, 0.229, 0.014), bv=0.002)
    g.box('frame_brushed', (0.086, 0.012, 0.010), (0, 0.080, 0.004), bv=0.002)
    g.box('frame_brushed', (0.012, 0.150, 0.012), (0, 0.150, 0.0015), bv=0.002)
    for i in range(3):
        g.box('rubber_black', (0.094, 0.006, 0.003), (0, 0.108 + i * 0.044, 0.0135))
    # static base on the floor
    b = kit.pen('st_tub', T(s * 0.14, 0.745, FLOOR))
    b.box('frame_brushed', (0.135, 0.075, 0.010), (0, 0.005, 0.005), bv=0.002)
    for sx in (-1, 1):
        b.prism('frame_brushed', [(-0.028, 0.008), (0.028, 0.008), (0.012, 0.070), (-0.012, 0.070)], sx * 0.052, sx * 0.060, plane='YZ', bv=0.002)
        b.cyl('chrome', 0.0065, 0.004, (sx * 0.0615, 0.0, 0.055), axis='X', n=8)
    b.screws('chrome', [(sx * 0.055, 0.005 + sy * 0.027, 0.010) for sx in (-1, 1) for sy in (-1, 1)], (0, 0, 1), r=0.004, h=0.002)
    # return spring housing behind the pedal (static)
    b.rod('frame_brushed', (0.0, 0.085, 0.012), (0.0, 0.085, 0.060), 0.014, n=10, ch=0.002)
    b.rod('rubber_black', (0.0, 0.085, 0.060), (0.0, 0.085, 0.074), 0.010, n=10)
    return P


def build_throttle(kit, info):
    Lf = info['console_L']
    R3 = Lf.to_3x3()
    nrm = R3 @ Vector((0, 0, 1))
    hinge = info['throttle_base'] - nrm * 0.010
    P = Matrix.Translation(hinge)
    kit.empty('throttle', None, P)
    kit.mesh('throttle_m', 'throttle')
    g = kit.pen('throttle_m', P @ R3.to_4x4())       # x fore (+Y world), y outboard, z = console normal
    g.cyl('frame_brushed', 0.010, 0.020, (0, 0, 0), axis='Y', n=10)
    g.box('chrome', (0.015, 0.006, 0.104), (0, 0, 0.054), bv=0.0015)
    g.box('rubber_black', (0.0152, 0.0062, 0.030), (0, 0, 0.040))
    hd = g.at((0, 0, 0.114))
    hd.rloft('rubber_black', [(-0.031, 0.0105, 0.0105), (-0.027, 0.0135, 0.0135), (-0.009, 0.0125, 0.0125), (0.009, 0.0125, 0.0125),
                              (0.027, 0.0135, 0.0135), (0.031, 0.0105, 0.0105)], n=12, axis='Y', sharp=60.0)
    for sy in (-1, 1):
        hd.cyl('chrome', 0.0112, 0.004, (0, sy * 0.033, 0), axis='Y', n=12)
    hd.lathe('glass_red', [(0.0065, 0.035), (0.0065, 0.039), (0.0, 0.040)], 10, axis='Y', rot=(0, 0, pi))
    g.box('chrome', (0.006, 0.022, 0.012), (0.0105, 0, 0.092), bv=0.0015)
    return hinge


def build_controls(kit):
    info = {}
    for s in (-1, 1):
        build_stick(kit, s)
        build_pedal(kit, s)
    build_throttle(kit, kit.info)
    return info
