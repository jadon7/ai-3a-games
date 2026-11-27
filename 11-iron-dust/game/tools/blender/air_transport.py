# heavy VTOL assault transport -- ~62 m long, ~46 m span over the engine pods. Blender: nose +Y, up +Z.
# belly at z = -6, bay opening 38 x 10.5 m, four tilting engine pods.
from air_lib import *

BAY_HW = 5.25      # bay half width
BAY_Y = 19.0       # bay half length


def engine_pod(m, node, noz, c, out_sign, front):
    """turbine lift pod, thrust straight down at rest. c = pivot (pod centre)"""
    cx, cy, cz = c
    n = 12
    ph = pi / n
    prof = [(4.6, 3.0), (3.7, 3.35), (-1.4, 3.35), (-3.3, 2.55)]      # (z, r)
    # loft goes top->bottom; ring 0 (top) is the intake: build without top cap
    L = Loft([circ_ring('z', cz + z, cx, cy, r, n, ph) for z, r in reversed(prof)], cap0=True, cap1=False)
    m.add(L.geo, 'A', node, fv=True)
    hollow_end(m, node, L.rings[-1], (0, 0, 1), lip=0.1, depth=1.7, shrink=0.82, mo='B')
    m.add(cyl((cx, cy, cz + 2.9), (cx, cy, cz + 4.9), 1.0, 0.25, n=8), 'F', node)        # intake spinner
    for a in range(3):                                                                   # stator vanes
        ang = a * pi / 3
        m.add(obb((cx, cy, cz + 3.5), (cos(ang), sin(ang), 0), (-sin(ang), cos(ang), 0), (5.3, 0.14, 0.7)), 'F', node)
    nozzle(m, node, (cx, cy, cz - 5.8), (0, 0, -1), 2.55, 2.0, 2.7, n=12, ph=ph)
    m.add(cyl((cx, cy, cz - 3.5), (cx, cy, cz - 3.0), 2.75, 2.75, n=12, ph=ph), 'F', node)   # nozzle collar
    for a in (0, 1):                                                                     # exhaust vanes
        m.add(box((cx + (a - 0.5) * 1.6, cy, cz - 5.5), (0.12, 4.4, 0.7)), 'F', node)
    # bands, equipment fairings, lights
    m.add(sweep_ring((cx, cy, cz + 2.6), (0, 0, 1), 3.3, 3.5, 0.45, n, ph=ph), 'C', node)
    m.add(sweep_ring((cx, cy, cz - 1.0), (0, 0, 1), 3.3, 3.55, 0.5, n, ph=ph), 'F', node)
    m.add(sweep_ring((cx, cy, cz + 4.1), (0, 0, 1), 3.2, 3.42, 0.35, n, ph=ph), 'H', node)
    ox = cx + out_sign * 3.1
    m.add(obox((ox, cy, cz + 0.6), (1.5, 3.0, 2.6), 0.4, 'z'), 'B', node)                # outboard gearbox fairing
    m.add(box((cx + out_sign * 3.9, cy, cz + 0.9), (0.2, 0.9, 0.5)), 'G', node)          # running light
    m.add(obox((cx, cy + 3.0, cz + 0.4), (2.2, 1.3, 3.2), 0.35, 'z'), 'B', node)         # fore accessory pack
    m.add(obox((cx, cy - 3.0, cz + 0.2), (1.8, 1.2, 3.6), 0.35, 'z'), 'F', node)         # aft oil cooler
    m.add(box((cx, cy - 3.62, cz + 0.6), (1.3, 0.1, 2.0)), 'T', node)
    for s in (-1, 1):                                                                    # external fuel lines
        m.add(pipe([(cx + s * 2.2, cy + 2.6, cz + 2.0), (cx + s * 2.5, cy + 2.4, cz - 1.2), (cx + s * 1.9, cy + 1.9, cz - 3.2)], 0.14, n=5), 'F', node)
    ix = cx - out_sign * 3.1                                                            # pivot hub (inboard)
    m.add(cyl((ix - out_sign * 0.3, cy, cz), (ix + out_sign * 0.9, cy, cz), 1.9, n=10), 'F', node)
    m.joint(noz, parent=node, loc=(cx, cy, cz - 5.8), soot=(6.0, 0.6))


def make():
    m = Model('transport', ao_dist=4.0, seed=23)
    # ---------------- nose
    nsec = [(19, 14, 12.5, 0.25, (1.5, 2.0)), (24, 12.8, 10.6, -0.3, (1.5, 1.9)), (28.2, 9.2, 6.6, -1.6, (1.2, 1.5)),
            (31, 4.8, 2.8, -2.7, (0.6, 0.7))]
    N = Loft([rect_ring('y', y, 0, cz, w, h, ch) for y, w, h, cz, ch in nsec])
    m.add(N.geo, 'A', fv=True)
    # cockpit glazing: top + upper chamfers of the sloped nose segment
    m.add(N.slab(1, 4, 0.06, 0.94, 0.12, 0.72, 0.12), 'G')
    m.add(N.slab(1, 3, 0.1, 0.9, 0.12, 0.72, 0.12), 'G')
    m.add(N.slab(1, 5, 0.1, 0.9, 0.12, 0.72, 0.12), 'G')
    m.add(N.slab(1, 4, 0.47, 0.53, 0.05, 0.8, 0.2), 'F')          # windshield centre post
    m.add(N.slab(1, 4, 0.0, 1.0, 0.72, 0.8, 0.2), 'F')            # brow
    m.add(N.slab(2, 4, 0.2, 0.8, 0.2, 0.8, 0.1), 'B')             # nose avionics hatch
    for k in (2, 6):
        m.add(N.slab(0, k, 0.15, 0.7, 0.3, 0.7, 0.1), 'B')      # crew door
        m.add(N.tiles(0, k, 1, 3, gu=0.0, gv=0.6, t=0.06, flat=True, u0=0.8, u1=0.86, v0=0.72, v1=0.98), 'G')  # side windows
        m.add(N.slab(1, k, 0.15, 0.85, 0.2, 0.8, 0.08), 'B')
        m.add(N.slab(1, k, 0.3, 0.7, 0.62, 0.74, 0.12), 'C')
        m.add(N.slab(2, k, 0.25, 0.75, 0.2, 0.8, 0.06), 'B')
    m.add(N.slab(2, 0, 0.15, 0.85, 0.5, 0.9, 0.08), 'B')
    for s in (-1, 1):                                               # landing lights
        m.add(box((s * 1.6, 30.6, -3.3), (0.6, 0.4, 0.4)), 'G')
    # chin turret
    m.add(cyl((0, 26.4, -5.2), (0, 26.4, -6.1), 1.25, 1.0, n=10), 'F')
    m.add(obox((0, 27.0, -5.85), (1.5, 2.2, 0.8), 0.2), 'B')
    for s in (-1, 1):
        m.add(cyl((s * 0.38, 27.6, -5.9), (s * 0.38, 31.2, -5.9), 0.15, n=6), 'W')
        m.add(cyl((s * 0.38, 30.7, -5.9), (s * 0.38, 31.2, -5.9), 0.23, n=6), 'F')

    # ---------------- mid section: U profile around the bay
    prof = [(-5.5, -6), (-7, -4.5), (-7, 4.5), (-5, 6.5), (5, 6.5), (7, 4.5), (7, -4.5), (5.5, -6),
            (BAY_HW, -6), (BAY_HW, 3.5), (-BAY_HW, 3.5), (-BAY_HW, -6)]
    ys = [19, 11.4, 3.8, -3.8, -11.4, -19]
    for i in range(5):
        m.add(prism(prof, 'y', ys[i], ys[i + 1], cap0=False, cap1=False), 'A', fv=True)
    # bay lining, ribs, rails, clamps, lights
    for s in (-1, 1):
        m.add(bx(s * (BAY_HW - 0.22), s * (BAY_HW + 0.05), -18.9, 18.9, -5.6, 3.45), 'F')
        m.add(bx(s * 2.3, s * 2.9, -18.5, 18.5, 2.5, 2.95), 'F')                       # overhead rails
        for y in (-15, -9, -3, 3, 9, 15):
            m.add(box((s * (BAY_HW - 0.3), y, 0.5), (0.25, 0.9, 0.5)), 'G')
        for y in (-12.5, 0, 12.5):                                                       # mech clamps
            m.add(bx(s * 2.0, s * 3.2, y - 0.9, y + 0.9, 0.3, 2.5), 'F')
            m.add(bx(s * 1.2, s * 3.2, y - 0.6, y + 0.6, -0.3, 0.5), 'H')
    m.add(bx(-BAY_HW, BAY_HW, -18.9, 18.9, 3.3, 3.52), 'T')
    for y in (-15.2, -7.6, 0, 7.6, 15.2):
        m.add(bx(-BAY_HW, BAY_HW, y - 0.3, y + 0.3, 2.75, 3.4), 'F')
    for y in (-18.95, 18.95):
        m.add(box((0, y, -1.2), (10.4, 0.25, 9.3)), 'F')
    m.joint('bay', loc=(0, 0, -6))

    # ---------------- belly doors (hinged along the bay's long edges)
    for s, nm in ((-1, 'door_L'), (1, 'door_R')):
        m.joint(nm, loc=(s * BAY_HW, 0, -5.8), iso=nm)
        m.add(bx(s * 0.04, s * (BAY_HW - 0.03), -18.92, 18.92, -6.0, -5.62), 'B', nm, fv=True)
        for y in (-16, -8, 0, 8, 16):
            m.add(bx(s * 0.4, s * (BAY_HW - 0.4), y - 0.25, y + 0.25, -5.62, -5.25), 'F', nm)
        m.add(bx(s * 0.3, s * 0.7, -18.4, 18.4, -5.62, -5.3), 'F', nm)
        m.add(tiles(zq(-6.0, s * 0.15, s * 1.0, -18.6, 18.6), 1, 9, gu=0, gv=0.5, t=0.04, out=(0, 0, -1)), 'H', nm)
        m.add(tiles(zq(-6.0, s * 1.6, s * 4.8, -18.2, 18.2), 1, 4, gu=0, gv=0.08, t=0.05, out=(0, 0, -1)), 'A', nm, fv=True)

    # ---------------- tail (upswept, ramp on the sloping belly)
    tsec = [(-19, 14, 12.5, 0.25, (1.5, 2.0)), (-25.5, 12, 9.2, 1.9, (1.4, 1.9)), (-31, 6.6, 4.4, 4.3, (0.8, 1.0))]
    T = Loft([rect_ring('y', y, 0, cz, w, h, ch) for y, w, h, cz, ch in tsec])
    m.add(T.geo, 'A', fv=True)
    m.add(T.slab(0, 0, 0.08, 0.92, 0.1, 0.95, 0.15), 'B')          # tail ramp
    m.add(T.slab(0, 0, 0.08, 0.16, 0.1, 0.95, 0.2), 'H')
    m.add(T.slab(0, 0, 0.84, 0.92, 0.1, 0.95, 0.2), 'H')
    m.add(T.tiles(0, 0, 1, 5, gu=0, gv=0.3, t=0.22, u0=0.2, u1=0.8, v0=0.12, v1=0.93), 'F')    # ramp treads
    m.add(T.slab(1, 0, 0.15, 0.85, 0.1, 0.8, 0.1), 'B')
    for k in (2, 6):
        m.add(T.slab(0, k, 0.2, 0.8, 0.15, 0.6, 0.08), 'B')
        m.add(T.slab(0, k, 0.3, 0.7, 0.3, 0.42, 0.12), 'C')
        m.add(T.slab(1, k, 0.2, 0.8, 0.2, 0.8, 0.08), 'B')
        m.add(T.slab(0, k, 0.3, 0.7, 0.68, 0.92, 0.08), 'T')
    m.add(box((0, -31.1, 4.4), (1.0, 0.3, 0.5)), 'G')
    # twin canted fins + bridging tailplane
    fin = Loft(wing([((2.7, -22.5, 6.3), (2.7, -30.8, 6.3), 0.8), ((6.2, -27.6, 13.2), (6.2, -31.6, 13.2), 0.4)]))
    m.sym(fin.geo, 'A', fv=True)
    m.sym(fin.slab(0, 1, 0, 1, 0.66, 0.78, 0.08), 'C')
    m.sym(fin.slab(0, 4, 0, 1, 0.66, 0.78, 0.08), 'C')
    m.sym(fin.slab(0, 2, 0.1, 0.9, 0.05, 0.95, 0.06), 'F')
    m.add(loft(wing([((-8.8, -28.0, 13.2), (-8.8, -31.4, 13.2), 0.3), ((8.8, -28.0, 13.2), (8.8, -31.4, 13.2), 0.3)])), 'B')
    m.sym(box((8.85, -29.6, 13.2), (0.25, 1.0, 0.3)), 'G')

    # ---------------- dorsal spine, sensors
    m.add(obox((0, -1, 7.0), (4.6, 37, 1.5), 0.55), 'B', fv=True)
    m.add(frust('y', 17.5, 22.5, (0, 7.0, 4.6, 1.5), (0, 5.6, 3.0, 0.6), 0.5, 0.2), 'B')
    m.add(cyl((0, 9, 7.6), (0, 9, 8.5), 2.3, 1.9, n=12), 'F')
    m.add(cyl((0, 9, 8.5), (0, 9, 8.9), 2.6, 2.6, n=12), 'B')      # rotodome
    for y in (2, -6, -14):
        m.add(box((0, y, 7.8), (2.6, 3.0, 0.25)), 'T')             # top exhaust grilles
    m.add(cyl((1.5, -17, 7.6), (1.5, -17, 10.6), 0.1, 0.05, n=4), 'F')
    m.add(cyl((-1.5, 14, 7.6), (-1.5, 14, 9.8), 0.1, 0.05, n=4), 'F')
    m.add(box((0, -18.5, 7.95), (0.6, 0.6, 0.4)), 'G')

    # ---------------- side sponsons
    sp = [(7, -4.4), (8.5, -3.5), (8.5, -0.9), (7, 0.3)]
    S = Loft([[P('y', y, u, v) for u, v in sp] for y in (13.5, 5, -5, -17.5)])
    m.sym(S.geo, 'B', fv=True)
    m.sym(frust('y', 13.5, 16.5, (7.75, -2.05, 1.5, 4.7), (7.1, -2.05, 0.2, 3.0)), 'B')
    m.sym(frust('y', -17.5, -20.5, (7.75, -2.05, 1.5, 4.7), (7.1, -2.05, 0.2, 3.0)), 'B')
    for i in range(3):
        m.sym(S.slab(i, 1, 0.15, 0.85, 0.2, 0.8, 0.07), 'T' if i == 1 else 'F')
    m.sym(pipe([(8.0, 13, -0.4), (8.0, -17, -0.4)], 0.22, n=5), 'F')
    m.sym(tiles(xq(7.0, 10, 18, 2.9, 3.4), 4, 1, gu=0.6, gv=0, t=0.05, out=(1, 0, 0), flat=True), 'G')
    for y in (11.4, 3.8, -3.8, -11.4):                              # frame ribs + upper side plates
        m.sym(bx(7.0, 7.28, y - 0.3, y + 0.3, 0.3, 4.5), 'F')
        m.sym(slab(xq(7.0, y - 6.6, y - 1.0, 0.9, 3.9), t=0.08, out=(1, 0, 0)), 'B')
    for y in (7.6, -7.6):
        m.sym(slab(xq(7.0, y - 1.6, y + 1.6, 1.3, 2.3), t=0.14, out=(1, 0, 0)), 'T')
    m.sym(slab(xq(7.0, -18.4, -17.4, 0.6, 4.3), t=0.1, out=(1, 0, 0)), 'C')
    m.sym(slab(xq(7.0, 15.2, 16.4, 0.8, 4.2), t=0.07, out=(1, 0, 0)), 'H')

    # ---------------- engine pylons + pods
    pods = [('engine_FL', 'noz_FL', -1, 15.0, 3.2, 3.6, True), ('engine_FR', 'noz_FR', 1, 15.0, 3.2, 3.6, True),
            ('engine_BL', 'noz_BL', -1, -17.5, 5.0, 7.0, False), ('engine_BR', 'noz_BR', 1, -17.5, 5.0, 7.0, False)]
    for nm, nz, s, y, zr, zt, front in pods:
        px = s * 19.2
        rx = 6.3 if front else 5.6
        pw = Loft(wing([((s * rx, y + 4.6, zr), (s * rx, y - 4.6, zr), 2.1), ((s * 15.6, y + 2.7, zt), (s * 15.6, y - 2.7, zt), 1.5)]))
        m.add(pw.geo, 'A', fv=True)
        m.add(pw.slab(0, 1, 0.05, 0.95, 0.1, 0.5, 0.08), 'B')
        m.add(pw.slab(0, 1, 0.2, 0.8, 0.6, 0.9, 0.08), 'T')
        m.add(pw.slab(0, 4, 0.1, 0.9, 0.15, 0.85, 0.08), 'B')
        m.add(pw.slab(0, 2, 0.1, 0.9, 0.05, 0.95, 0.06), 'F')
        m.add(cyl((s * 6.9, y - 1.5, -2.2), (s * 13.0, y - 0.5, lerp(zr, zt, 0.7) - 0.7), 0.32, n=6), 'F')   # brace struts
        m.add(cyl((s * 6.9, y + 2.0, -2.2), (s * 13.0, y + 0.5, lerp(zr, zt, 0.7) - 0.7), 0.32, n=6), 'F')
        m.add(cyl((s * 15.2, y, zt), (s * 16.3, y, zt), 1.5, n=10), 'F')                # pivot stub
        m.joint(nm, loc=(px, y, zt))
        engine_pod(m, nm, nz, (px, y, zt), s, front)

    # ---------------- landing skids
    for s in (-1, 1):
        m.add(bx(s * 7.5, s * 8.4, -16, 16, -9.0, -8.55), 'F')
        m.add(frust('y', 16, 18.5, (s * 7.95, -8.78, 0.9, 0.45), (s * 7.95, -8.0, 0.7, 0.35)), 'F')
        m.add(frust('y', -16, -18.5, (s * 7.95, -8.78, 0.9, 0.45), (s * 7.95, -8.0, 0.7, 0.35)), 'F')
        for y in (-13, -4.5, 4.5, 13):
            m.add(cyl((s * 6.3, y, -5.1), (s * 7.9, y, -8.6), 0.34, n=6), 'F')
            m.add(cyl((s * 6.7, y, -4.4), (s * 7.4, y, -6.6), 0.5, n=6), 'W')           # oleo sleeve
        for y0, y1 in ((-13, -4.5), (4.5, 13)):
            m.add(cyl((s * 6.3, y0, -5.1), (s * 7.9, y1, -8.6), 0.2, n=5), 'F')
        m.add(tiles(zq(-9.0, s * 7.5, s * 8.4, -15.5, 15.5), 1, 6, gu=0, gv=0.7, t=0.03, out=(0, 0, -1)), 'H')
    # belly strobes / antennas
    for y in (21.5, -21.5):
        m.add(box((0, y, -5.9 if y > 0 else -3.9), (0.5, 0.5, 0.35)), 'G')
    m.add(box((3.0, 22, -5.9), (0.08, 1.2, 0.9)), 'F')
    m.add(box((-3.0, 22, -5.9), (0.08, 1.2, 0.9)), 'F')
    return m
