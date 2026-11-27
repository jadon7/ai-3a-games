# friendly twin-barrel AA gun emplacement -- ~12 m tall, origin at ground centre. Blender: barrels +Y, up +Z.
# aa (base) -> aa_yaw (0,0,3.4) -> aa_pitch (0,0.6,6.6) -> guns, drums, aa_muzzle_L / aa_muzzle_R
from air_lib import *


def make():
    m = Model('aa', ao_dist=1.6, ground=True, seed=67)
    m.dustfn = lambda p, n: 0.4 * max(0.0, 1.0 - p.z / 3.0) ** 1.5
    R = random.Random(3)
    # ---------------- base: pad, armoured parapet with a rear gap, sandbags, pedestal
    m.add(cyl((0, 0, 0), (0, 0, 0.45), 7.4, 7.1, n=8, ph=pi / 8), 'B')
    a0, a1 = radians(180 + 28), radians(540 - 28)
    m.add(sweep_ring((0, 0, 1.45), (0, 0, 1), 5.5, 6.2, 2.0, 7, a0=a0, a1=a1), 'B', fv=True)
    for i in range(7):
        am = lerp(a0, a1, (i + 0.5) / 7)
        d = V((0, 1, 0)) * cos(am) + V((-1, 0, 0)) * sin(am)      # frame((0,0,1)): x=+Y, y=-X
        t = V((-d.y, d.x, 0))
        rr = 5.85 * cos(radians(152 / 7))
        m.add(obb(d * (rr + 0.42) + V((0, 0, 1.5)), t, V((0, 0, 1)), (3.0, 1.4, 0.16)), 'F')        # armour plate
        for row in range(2):                                        # sandbags on top
            for j in range(3 - row):
                off = (j - (2 - row) / 2) * 1.55
                c = d * (rr + R.uniform(-0.08, 0.08)) + t * off + V((0, 0, 2.66 + row * 0.42))
                m.add(obb(c, t, d, (1.45, 0.72, 0.42)), 'B')
        if i in (1, 5):
            m.add(obb(d * (rr + 0.55) + V((0, 0, 1.4)), t, V((0, 0, 1)), (1.6, 0.5, 0.1)), 'H')
    m.add(cyl((0, 0, 0.45), (0, 0, 0.9), 3.3, 3.3, n=10), 'F')
    m.add(cyl((0, 0, 0.9), (0, 0, 3.4), 2.7, 2.2, n=10), 'F')
    for k in range(5):
        a = k * 2 * pi / 5 + 0.3
        d = V((cos(a), sin(a), 0))
        t = V((-d.y, d.x, 0)) * 0.18
        tri = [d * 2.25 + V((0, 0, 3.1)), d * 3.25 + V((0, 0, 0.9)), d * 2.25 + V((0, 0, 0.9))]
        m.add(loft([[q - t for q in tri], [q + t for q in tri]]), 'F')
    # ammo crates, generator, cable
    m.add(box((3.6, -3.0, 1.0), (1.6, 1.0, 1.1)), 'A')
    m.add(box((3.4, -3.1, 1.85), (1.2, 0.9, 0.6)), 'B')
    m.add(box((3.6, -3.52, 1.0), (1.0, 0.06, 0.4)), 'C')
    m.add(obox((-3.6, -2.6, 1.15), (1.6, 2.4, 1.4), 0.25), 'F')
    m.add(box((-3.6, -3.85, 1.2), (0.9, 0.1, 0.5)), 'G')
    m.add(pipe([(-3.0, -1.6, 0.6), (-1.8, -0.8, 0.6), (-1.5, -0.6, 1.4)], 0.12, n=4), 'F')

    # ---------------- yaw: turntable + armoured housing + radar
    m.joint('aa_yaw', loc=(0, 0, 3.4))
    Y = 'aa_yaw'
    m.add(cyl((0, 0, 3.4), (0, 0, 3.95), 3.0, 2.9, n=12), 'F', Y)
    m.add(sweep_ring((0, 0, 3.7), (0, 0, 1), 2.9, 3.1, 0.2, 12), 'H', Y)
    H = Loft([rect_ring('y', -3.4, 0, 5.6, 3.0, 3.0, 0.5), rect_ring('y', -2.4, 0, 5.85, 3.6, 3.8, 0.6),
              rect_ring('y', 1.4, 0, 5.95, 3.6, 4.0, 0.6), rect_ring('y', 3.0, 0, 5.5, 2.4, 2.2, 0.45)])
    m.add(H.geo, 'A', Y, fv=True)
    m.add(H.slab(2, 4, 0.15, 0.85, 0.15, 0.7, 0.06), 'B', Y)               # glacis plate
    m.add(H.slab(2, 3, 0.2, 0.8, 0.2, 0.7, 0.07), 'G', Y)                  # gunner optics
    m.add(H.slab(1, 4, 0.2, 0.8, 0.55, 0.9, 0.08), 'B', Y)                 # roof hatch
    m.add(H.slab(0, 4, 0.15, 0.85, 0.2, 0.8, 0.06), 'T', Y)                # rear radiator
    for k in (2, 6):
        m.add(H.slab(1, k, 0.5, 0.8, 0.08, 0.3, 0.05), 'C', Y)
        m.add(H.slab(1, k, 0.1, 0.42, 0.1, 0.45, 0.06), 'B', Y)
    m.add(cyl((-1.9, 0.6, 6.6), (1.9, 0.6, 6.6), 0.75, n=10), 'F', Y)       # trunnion collars (through the housing)
    m.add(box((0, 3.05, 5.5), (1.0, 0.25, 0.6)), 'F', Y)
    m.add(box((0, 3.2, 5.5), (0.6, 0.1, 0.35)), 'G', Y)
    # radar on a short mast (rear roof)
    m.add(cyl((0, -2.3, 7.7), (0, -2.3, 10.0), 0.2, 0.14, n=6), 'F', Y)
    m.add(box((0, -2.3, 8.1), (0.9, 0.9, 0.6)), 'B', Y)
    dd = V((0, 0.92, 0.39)).normalized()
    c = V((0, -2.3, 10.45))
    m.add(cyl(c - dd * 0.15, c + dd * 0.45, 0.35, 1.55, n=10, cap1=False), 'B', Y, recalc=False)
    dish_in = cyl(c + dd * 0.45, c - dd * 0.05, 1.55, 0.3, n=10, cap0=False)
    m.add(orient(dish_in, lambda fc: dd), 'F', Y)
    m.add(cyl(c, c + dd * 0.95, 0.07, n=4), 'F', Y)
    m.add(box(c + dd * 0.95, (0.22, 0.22, 0.22)), 'G', Y)
    m.add(cyl((0.9, -1.0, 7.8), (0.9, -1.0, 9.6), 0.04, n=4), 'F', Y)       # whip antenna

    # ---------------- pitch: twin guns, drums
    m.joint('aa_pitch', parent=Y, loc=(0, 0.6, 6.6))
    Pn = 'aa_pitch'
    m.add(cyl((-3.5, 0.6, 6.6), (3.5, 0.6, 6.6), 0.5, n=8), 'W', Pn)         # cross shaft
    for s, nm in ((-1, 'aa_muzzle_L'), (1, 'aa_muzzle_R')):
        x = s * 2.65
        m.add(obox((x, 0.5, 6.6), (1.3, 4.4, 1.5), 0.3), 'A', Pn, fv=True)   # cradle / receiver
        m.add(box((x, 0.2, 7.42), (0.9, 2.6, 0.2)), 'B', Pn)
        m.add(box((x + s * 0.67, 1.2, 6.6), (0.08, 1.6, 0.8)), 'C', Pn)
        m.add(cyl((x, 2.7, 6.6), (x, 5.6, 6.6), 0.36, 0.33, n=8), 'F', Pn)   # cooling jacket
        for j in range(4):
            m.add(sweep_ring((x, 3.2 + j * 0.6, 6.6), (0, 1, 0), 0.3, 0.46, 0.18, 8), 'W', Pn)
        m.add(cyl((x, 5.6, 6.6), (x, 9.6, 6.6), 0.2, 0.17, n=8), 'W', Pn)    # barrel
        m.add(cyl((x, 9.5, 6.6), (x, 10.2, 6.6), 0.3, 0.34, n=8), 'F', Pn)   # muzzle brake
        m.add(cyl((x, 10.2, 6.6), (x, 10.22, 6.6), 0.13, n=8), 'T', Pn)
        m.add(cyl((x, 2.7, 7.15), (x, 5.0, 7.15), 0.16, n=6), 'F', Pn)       # recuperator
        m.add(cyl((x, -1.7, 6.6), (x, -1.95, 6.6), 0.4, 0.28, n=8), 'F', Pn)  # buffer
        # ammo drum outboard
        m.add(cyl((x + s * 0.65, -0.3, 6.6), (x + s * 1.75, -0.3, 6.6), 1.25, n=10), 'B', Pn)
        m.add(cyl((x + s * 1.75, -0.3, 6.6), (x + s * 1.95, -0.3, 6.6), 0.8, 0.6, n=10), 'F', Pn)
        m.add(sweep_ring((x + s * 1.2, -0.3, 6.6), (1, 0, 0), 1.2, 1.33, 0.25, 10), 'C', Pn)
        m.add(obb((x + s * 0.9, 0.9, 7.2), (0, 0.8, 0.6), (1, 0, 0), (1.3, 0.5, 0.35)), 'F', Pn)   # feed chute
        m.joint(nm, parent=Pn, loc=(x, 10.22, 6.6), soot=(1.4, 0.45))
    return m
