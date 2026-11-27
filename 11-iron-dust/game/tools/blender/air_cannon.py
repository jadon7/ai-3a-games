# friendly anti-orbit rail cannon -- fixed emplacement. origin = ground centre. Blender: barrel +Y at rest, up +Z.
# cannon (plinth) -> cannon_yaw (0,0,12) -> cannon_pitch (0,0,29) -> barrel (y -11.7 .. 64), cannon_coils, cannon_muzzle
from air_lib import *

PZ = 29.0          # trunnion height
DECK = 15.0        # turret deck top


def octa(z, rflat, ph=pi / 8):
    return circ_ring('z', z, 0, 0, rflat / cos(pi / 8), 8, ph)


def make():
    m = Model('cannon', ao_dist=5.0, ground=True, seed=59)
    m.dustfn = lambda p, n: 0.45 * max(0.0, 1.0 - p.z / 9.0) ** 1.5

    # ================= static plinth
    T1 = Loft([octa(0, 23.0), octa(4.5, 22.2)])
    m.add(T1.geo, 'B', fv=True)
    T2 = Loft([octa(4.5, 16.0), octa(9.5, 15.3)])
    m.add(T2.geo, 'B', fv=True)
    m.add(cyl((0, 0, 9.5), (0, 0, 11.4), 13.6, 13.2, n=16), 'B')
    m.add(cyl((0, 0, 11.4), (0, 0, 12.0), 12.9, 12.9, n=16), 'F')              # roller path
    for k in range(8):
        a = k * pi / 4 + pi / 8                                                   # corner buttresses
        d = V((cos(a), sin(a), 0))
        t = V((-sin(a), cos(a), 0))
        c = d * (23.0 / cos(pi / 8) - 1.2)
        m.add(loft([[c - t * 1.6 - d * 2.0, c + t * 1.6 - d * 2.0, c + t * 1.6 + d * 1.6, c - t * 1.6 + d * 1.6],
                    [p + V((0, 0, 5.3)) for p in (c - t * 1.3 - d * 2.0, c + t * 1.3 - d * 2.0, c + t * 1.3 + d * 0.4, c - t * 1.3 + d * 0.4)]]), 'B')
        c2 = d * (16.0 / cos(pi / 8) - 0.6) + V((0, 0, 4.5))
        m.add(loft([[c2 - t * 1.1 - d * 1.5, c2 + t * 1.1 - d * 1.5, c2 + t * 1.1 + d * 2.6, c2 - t * 1.1 + d * 2.6],
                    [p + V((0, 0, 5.4)) for p in (c2 - t * 0.9 - d * 1.5, c2 + t * 0.9 - d * 1.5, c2 + t * 0.9 + d * 0.2, c2 - t * 0.9 + d * 0.2)]]), 'B')
        # face details on tier 1 / tier 2 flats (face k of the lofts)
        m.add(T1.slab(0, k, 0.12, 0.88, 0.72, 0.9, 0.15), 'F')                   # steel band
        if k in (1, 5):
            m.add(T1.slab(0, k, 0.38, 0.62, 0.0, 0.62, 0.25), 'T')               # blast door
            m.add(T1.slab(0, k, 0.34, 0.66, 0.62, 0.7, 0.4), 'H')
        else:
            m.add(T1.tiles(0, k, 3, 1, gu=0.3, gv=0, t=0.3, u0=0.15, u1=0.85, v0=0.12, v1=0.6), 'B')
        m.add(T2.slab(0, k, 0.1, 0.9, 0.1, 0.35, 0.2), 'F')
        m.add(T2.tiles(0, k, 4, 1, gu=0.5, gv=0, t=0.12, u0=0.15, u1=0.85, v0=0.62, v1=0.8), 'T')   # vents
    # power conduit ring around tier 2 + deck edge hazard
    ring = [V((cos(k * pi / 4 + pi / 8), sin(k * pi / 4 + pi / 8), 0)) * 17.9 + V((0, 0, 5.4)) for k in range(9)]
    m.add(pipe(ring, 0.6, n=6), 'F')
    m.add(sweep_ring((0, 0, 4.55), (0, 0, 1), 22.6 / cos(pi / 8), 23.4 / cos(pi / 8), 0.25, 8, ph=pi / 8), 'H')
    # capacitor banks on the lower deck (4 diagonals)
    for k in range(4):
        a = k * pi / 2 + pi / 4
        d = V((cos(a), sin(a), 0))
        t = V((-sin(a), cos(a), 0))
        base = d * 19.4 + V((0, 0, 4.5))
        m.add(obb(base + V((0, 0, 0.3)), t, d, (11.5, 4.6, 0.6)), 'F')
        for j in (-1, 0, 1):
            c = base + t * (j * 3.7)
            m.add(cyl(c + V((0, 0, 0.6)), c + V((0, 0, 5.8)), 1.65, n=8, ph=a + pi / 8), 'B')
            m.add(cyl(c + V((0, 0, 5.8)), c + V((0, 0, 6.4)), 1.25, 0.9, n=8, ph=a + pi / 8), 'F')
            m.add(cyl(c + V((0, 0, 6.4)), c + V((0, 0, 7.5)), 0.35, n=5), 'W')    # insulator
            m.add(obb(c + d * 1.62 + V((0, 0, 3.2)), t, V((0, 0, 1)), (0.7, 3.6, 0.3)), 'G')      # charge strip
            m.add(sweep_ring(c + V((0, 0, 1.6)), (0, 0, 1), 1.6, 1.85, 0.4, 8, ph=a + pi / 8), 'F')
            m.add(sweep_ring(c + V((0, 0, 4.9)), (0, 0, 1), 1.6, 1.85, 0.4, 8, ph=a + pi / 8), 'F')
            m.add(pipe([c + V((0, 0, 7.4)), c - d * 2.6 + V((0, 0, 7.4)), d * 15.0 + t * (j * 1.2) + V((0, 0, 8.6))], 0.32, n=5), 'F')
        m.add(pipe([d * 15.6 + V((0, 0, 8.6)) - t * 1.6, d * 15.6 + V((0, 0, 8.6)) + t * 1.6], 0.7, n=6), 'F')     # bus bar
        m.add(pipe([d * 15.0 + V((0, 0, 8.6)), d * 13.5 + V((0, 0, 10.6))], 0.6, n=6), 'F')
        m.add(obb(base - t * 6.6 + V((0, 0, 1.4)), t, d, (1.4, 2.6, 2.2)), 'B')     # switchgear cabinet
        m.add(obb(base - t * 6.6 + d * 1.32 + V((0, 0, 1.7)), t, V((0, 0, 1)), (0.8, 0.5, 0.1)), 'G')
    # stairs: ground -> deck 1 (on the +X and -X flats), deck 1 -> deck 2 (on the -Y flat side walls)
    for s in (-1, 1):
        for i in range(12):
            y = s * (-5.5 + i * 1.0)
            m.add(bx(s * 22.6, s * 24.6, y - 0.5 * s, y + 0.5 * s, 0, (i + 1) * 0.375), 'F')
        m.add(cyl((s * 24.6, s * -6, 1.2), (s * 24.6, s * 6.0, 5.7), 0.09, n=4), 'F')         # handrail
        for yy, zz in ((-6, 1.2), (0, 3.45), (6, 5.7)):
            m.add(cyl((s * 24.6, s * yy, zz - 1.2), (s * 24.6, s * yy, zz), 0.07, n=4), 'F')
        m.add(bx(s * 22.3, s * 24.6, s * 6.5, s * 9.0, 4.2, 4.5), 'F')                           # landing
        for i in range(13):
            x = s * (-6 + i * 1.0)
            m.add(bx(x - 0.5, x + 0.5, s * -15.6, s * -17.4, 4.5, 4.5 + (i + 1) * 0.385), 'F')
        m.add(cyl((s * -6.5, s * -17.4, 5.7), (s * 6.5, s * -17.4, 10.7), 0.09, n=4), 'F')
    # control bunker on the rear deck
    m.add(obox((0, -19.6, 6.3), (9, 4.4, 3.6), 0.6, 'y'), 'B')
    m.add(tiles(yq(-21.8, -3.6, 3.6, 6.6, 7.4), 4, 1, gu=0.3, gv=0, t=0.08, out=(0, -1, 0)), 'G')
    m.add(cyl((2.8, -19.6, 8.1), (2.8, -19.6, 11.5), 0.1, n=4), 'F')

    # ================= yaw: turret ring, deck, trunnion towers
    m.joint('cannon_yaw', loc=(0, 0, 12))
    Y = 'cannon_yaw'
    m.add(cyl((0, 0, 12.0), (0, 0, 13.5), 12.4, 12.4, n=16), 'F', Y)
    m.add(sweep_ring((0, 0, 12.7), (0, 0, 1), 12.3, 12.75, 0.5, 16), 'H', Y)
    dk = Loft([rect_ring('z', 13.5, 0, -1.5, 27, 31, 6), rect_ring('z', DECK, 0, -1.5, 26, 30, 6)])
    m.add(dk.geo, 'A', Y, fv=True)
    m.add(slab(zq(DECK, -5.6, 5.6, -14, 9), t=0.12, out=(0, 0, 1)), 'F', Y)                 # recoil pit grating
    for s in (-1, 1):
        m.add(tiles(zq(DECK, s * 5.0, s * 5.6, -14, 9), 1, 8, gu=0, gv=0.5, t=0.16, out=(0, 0, 1)), 'H', Y)
        tw = [(-10.5, DECK), (7.5, DECK), (3.6, 30.2), (2.3, 32.8), (-2.3, 32.8), (-3.8, 30.2)]
        Tw = Loft([[P('x', s * 6.0, u, v) for u, v in tw], [P('x', s * 9.2, u, v) for u, v in tw]])
        m.add(Tw.geo, 'A', Y, fv=True)
        xo = s * 9.2
        # tower outer face: ribs, access panels, ladder, lights
        m.add(prism([(-9.6, DECK), (-7.8, DECK), (-2.6, 29.0), (-3.6, 29.6)], 'x', xo, xo + s * 0.9), 'F', Y)
        m.add(prism([(6.8, DECK), (5.2, DECK), (2.4, 29.0), (3.4, 29.6)], 'x', xo, xo + s * 0.9), 'F', Y)
        m.add(bx(xo, xo + s * 0.5, -5.4, 3.4, 18.0, 23.5), 'B', Y)
        m.add(bx(xo, xo + s * 0.62, -4.4, 2.4, 19.0, 20.2), 'T', Y)
        m.add(bx(xo, xo + s * 0.62, -4.4, 2.4, 21.2, 22.4), 'T', Y)
        m.add(bx(xo, xo + s * 0.7, -0.6, 0.6, 23.6, 25.2), 'G', Y)
        m.add(cyl((s * 5.7, 0, PZ), (s * 9.9, 0, PZ), 3.4, n=12), 'F', Y)                   # bearing housing
        m.add(cyl((s * 9.9, 0, PZ), (s * 10.6, 0, PZ), 2.2, 1.9, n=12), 'W', Y)
        m.add(sweep_ring((s * 9.95, 0, PZ), (1, 0, 0), 2.6, 3.2, 0.3, 12), 'H', Y)
        # outboard equipment on the deck
        if s > 0:
            m.add(obox((11.3, -9.5, 17.6), (3.6, 8.5, 5.2), 0.6, 'y'), 'A', Y)              # fire-control cab
            m.add(tiles(yq(-5.25, 9.9, 12.7, 18.2, 19.4), 2, 1, gu=0.2, gv=0, t=0.1, out=(0, 1, 0)), 'G', Y)
            m.add(tiles(xq(13.1, -13, -6, 18.2, 19.4), 3, 1, gu=0.3, gv=0, t=0.1, out=(1, 0, 0)), 'G', Y)
            m.add(cyl((11.3, -12, 20.2), (11.3, -12, 23.5), 0.1, n=4), 'F', Y)
            m.add(cyl((11.3, -10, 20.2), (11.3, -10, 20.9), 1.0, 0.7, n=8), 'B', Y)
        else:
            m.add(obox((-11.3, -9.5, 16.9), (3.4, 8.0, 3.8), 0.5, 'y'), 'B', Y)             # hydraulic power pack
            m.add(tiles(xq(-13.0, -13, -6, 15.8, 18.0), 4, 1, gu=0.3, gv=0, t=0.1, out=(-1, 0, 0)), 'T', Y)
            m.add(pipe([(-11.3, -5.5, 17.5), (-11.3, -3.0, 17.5), (-9.9, -1.5, 22.0)], 0.3, n=5), 'F', Y)
        m.add(obox((s * 11.4, 6.5, 16.0), (3.0, 5.0, 2.0), 0.4, 'y'), 'F', Y)               # ammo / coolant tanks
        m.add(cyl((s * 11.4, 4.2, 17.6), (s * 11.4, 8.8, 17.6), 1.1, n=8), 'B', Y)
    m.add(bx(-6.0, 6.0, -12.5, -10.5, DECK, 17.2), 'A', Y)                                  # rear tie beam
    m.add(bx(-6.0, 6.0, 6.2, 7.8, DECK, 17.6), 'A', Y)                                      # front tie beam
    m.add(tiles(yq(7.8, -5, 5, 15.6, 17.0), 5, 1, gu=0.5, gv=0, t=0.08, out=(0, 1, 0)), 'H', Y)

    # ================= pitch: breech, cradle, barrel
    m.joint('cannon_pitch', parent=Y, loc=(0, 0, PZ))
    Pn = 'cannon_pitch'
    m.joint('cannon_coils', parent=Pn, loc=(0, 0, PZ))
    m.joint('cannon_muzzle', parent=Pn, loc=(0, 64.0, PZ))

    def Z(z):
        return PZ + z
    m.add(cyl((-5.75, 0, PZ), (5.75, 0, PZ), 2.5, n=12), 'W', Pn)                           # trunnion shaft
    Br = Loft([rect_ring('y', -11.0, 0, PZ, 7.6, 6.0, 1.2), rect_ring('y', -9.6, 0, PZ, 9.4, 7.2, 1.3),
               rect_ring('y', -2.0, 0, PZ, 9.4, 7.2, 1.3)])
    m.add(Br.geo, 'A', Pn, fv=True)
    m.add(obox((0, -11.35, PZ), (5.6, 0.9, 4.4), 0.8), 'F', Pn)                             # breech closure
    m.add(cyl((0, -11.8, PZ), (0, -12.2, PZ), 1.5, 1.2, n=8), 'W', Pn)
    for k in (2, 6):
        m.add(Br.slab(1, k, 0.15, 0.85, 0.08, 0.5, 0.25), 'B', Pn)
        m.add(Br.slab(1, k, 0.42, 0.58, 0.58, 0.92, 0.2), 'G', Pn)
        m.add(Br.slab(1, k, 0.1, 0.9, 0.0, 0.05, 0.3), 'H', Pn)
    m.add(Br.slab(1, 4, 0.1, 0.9, 0.1, 0.9, 0.2), 'B', Pn)
    m.add(Br.slab(1, 0, 0.1, 0.9, 0.1, 0.9, 0.2), 'B', Pn)
    Cr = Loft([rect_ring('y', -2.0, 0, PZ, 10.6, 6.6, 1.0), rect_ring('y', 7.0, 0, PZ, 10.6, 6.6, 1.0),
               rect_ring('y', 9.0, 0, PZ, 8.6, 5.6, 1.0)])
    m.add(Cr.geo, 'B', Pn, fv=True)
    for k in (2, 6):
        m.add(Cr.slab(0, k, 0.1, 0.9, 0.1, 0.9, 0.2), 'A', Pn)
        m.add(Cr.slab(0, k, 0.3, 0.7, 0.72, 0.84, 0.3), 'C', Pn)
    for i in range(9):                                                                       # heat-sink fins on the cradle
        y = -1.2 + i * 0.95
        m.add(bx(-4.4, 4.4, y, y + 0.32, Z(3.2), Z(5.0)), 'F', Pn)
        m.add(bx(-4.4, 4.4, y, y + 0.32, Z(-5.0), Z(-3.2)), 'F', Pn)
    # elevation quadrants
    for s in (-1, 1):
        m.add(sweep_ring((s * 5.55, 0, PZ), (1, 0, 0), 6.6, 8.6, 0.45, 10, a0=radians(100), a1=radians(260)), 'F', Pn)
        m.add(sweep_ring((s * 5.55, 0, PZ), (1, 0, 0), 2.4, 3.1, 0.5, 12), 'B', Pn)
        for a in (115, 180, 245):
            ar = radians(a)
            d, x, y = frame((1, 0, 0))
            dd = x * cos(ar) + y * sin(ar)
            m.add(cyl(V((s * 5.55, 0, PZ)) + dd * 2.6, V((s * 5.55, 0, PZ)) + dd * 6.8, 0.35, n=4), 'F', Pn)
    # recoil cylinders (4) : sleeves on the breech, rods to the first barrel frame
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * 3.3, Z(sz * 4.35)
            m.add(cyl((x, -9.8, z), (x, 5.5, z), 0.9, n=8), 'F', Pn)
            m.add(cyl((x, 5.5, z), (x, 6.3, z), 1.05, n=8), 'H', Pn)
            m.add(cyl((x, 6.3, z), (x, 15.6, Z(sz * 3.1)), 0.42, n=6), 'W', Pn)
            m.add(obox((x, -3.0, Z(sz * 3.75)), (1.5, 1.4, 1.3), 0.2), 'F', Pn)
            m.add(obox((x, 3.0, Z(sz * 3.75)), (1.5, 1.4, 1.3), 0.2), 'F', Pn)
    # rails (two pairs) around the bore
    yr = [8.5, 26, 44, 61.5]
    for i in range(3):
        y0, y1 = yr[i], yr[i + 1]
        for sz in (-1, 1):
            m.add(bx(-1.55, 1.55, y0, y1, Z(sz * 1.15), Z(sz * 2.2)), 'W', Pn)
        for sx in (-1, 1):
            m.add(bx(sx * 1.85, sx * 2.6, y0, y1, Z(-0.85), Z(0.85)), 'W', Pn)
    m.add(bx(-1.5, 1.5, 8.5, 63.6, Z(-1.1), Z(1.1)), 'T', Pn)                                # bore core
    # ring frames, coils, cooling fins
    frames = [9.5, 16.5, 23.5, 30.5, 37.5, 44.5, 51.5, 58.0]
    for i, y in enumerate(frames):
        m.add(sweep_ring((0, y, PZ), (0, 1, 0), 2.75, 4.15 - i * 0.07, 1.0, 8, ph=pi / 8), 'F', Pn)
        if i % 2 == 0:
            m.add(sweep_ring((0, y, PZ), (0, 1, 0), 4.0 - i * 0.07, 4.3 - i * 0.07, 0.4, 8, ph=pi / 8), 'H', Pn)
    for i in range(7):
        y = frames[i] + 3.5
        nm = 'cannon_coils_%d' % (i + 1)
        m.add(sweep_ring((0, y, PZ), (0, 1, 0), 2.8, 3.55, 1.5, 12), 'G', 'cannon_coils', obj=nm, origin=(0, y, PZ))
        for sy in (-1, 1):                                                                   # coil clamps
            m.add(sweep_ring((0, y + sy * 1.05, PZ), (0, 1, 0), 2.75, 3.75, 0.5, 8, ph=pi / 8), 'B', Pn)
        if i < 4:
            for sx in (-1, 1):
                for j in range(3):
                    yy = frames[i] + 0.9 + j * 0.42
                    m.add(bx(sx * 2.7, sx * 5.0, yy, yy + 0.16, Z(-2.4), Z(2.4)), 'B', Pn)
    # spine / keel beams and truss
    m.add(frust('y', 8.5, 60.5, (0, Z(4.5), 1.6, 1.3), (0, Z(3.9), 1.0, 0.9)), 'A', Pn, fv=True)
    m.add(frust('y', 8.5, 46.0, (0, Z(-5.4), 2.0, 1.5), (0, Z(-4.0), 1.2, 0.9)), 'A', Pn, fv=True)
    for i in range(5):
        ya, yb = frames[i], frames[i + 1]
        za = lerp(-5.4, -4.0, (ya - 8.5) / 37.5)
        m.add(cyl((0, ya, Z(za + 0.5)), (0, (ya + yb) / 2, Z(-3.4)), 0.28, n=4), 'F', Pn)
        m.add(cyl((0, (ya + yb) / 2, Z(-3.4)), (0, yb, Z(za + 0.9)), 0.28, n=4), 'F', Pn)
    for s in (-1, 1):                                                                        # side stay rods
        m.add(cyl((s * 5.0, 8.0, Z(1.5)), (s * 3.6, 30.5, Z(0)), 0.3, n=5), 'F', Pn)
        m.add(pipe([(s * 3.0, 9, Z(3.2)), (s * 3.0, 58, Z(2.75))], 0.25, n=4), 'F', Pn)      # coolant lines
    # muzzle
    Mz = Loft([circ_ring('y', 58.6, 0, PZ, 3.3, 8, pi / 8), circ_ring('y', 61.8, 0, PZ, 4.2, 8, pi / 8),
               circ_ring('y', 64.0, 0, PZ, 3.8, 8, pi / 8)], cap1=False)
    m.add(Mz.geo, 'A', Pn, fv=True)
    hollow_end(m, Pn, Mz.rings[-1], (0, 1, 0), lip=0.22, depth=3.0, shrink=0.8, mo='W', dust=0.3)
    m.add(sweep_ring((0, 61.8, PZ), (0, 1, 0), 4.1, 4.45, 0.9, 8, ph=pi / 8), 'H', Pn)
    for k in range(0, 8, 2):
        m.add(Mz.slab(0, k, 0.2, 0.8, 0.15, 0.85, 0.25), 'T', Pn)
    return m
