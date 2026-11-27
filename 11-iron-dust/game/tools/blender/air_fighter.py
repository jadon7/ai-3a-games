# enemy strike fighter / gunship -- ~19 m long, ~14 m span. Blender space: nose +Y, up +Z.
# cranked forward-swept wing with drooped tip plates, twin canted fins, armoured slit-window cockpit, rotary chin gun.
from air_lib import *


def make():
    m = Model('fighter', ao_dist=1.6, seed=11)

    # ---------------- fuselage (drooped armoured nose, slab sides)
    secs = [(9.0, 0.6, 0.55, -0.4, 0.15), (7.7, 1.4, 1.25, -0.2, 0.34), (5.6, 2.0, 2.05, 0.08, 0.5),
            (2.5, 2.5, 2.4, 0.2, 0.6), (-2.0, 2.7, 2.3, 0.2, 0.6), (-5.5, 2.2, 1.7, 0.3, 0.5),
            (-7.7, 1.3, 0.9, 0.4, 0.3)]
    F = Loft([rect_ring('y', y, 0, cz, w, h, ch) for y, w, h, cz, ch in secs])
    m.add(F.geo, 'A', fv=True)
    m.add(frust('y', 9.0, 9.45, (0, -0.4, 0.55, 0.5), (0, -0.44, 0.18, 0.16), 0.1, 0.04), 'B')
    for k in (2, 6):
        m.add(F.slab(2, k, 0.1, 0.9, 0.08, 0.7, 0.07), 'B')       # appliqué armour
        m.add(F.slab(3, k, 0.15, 0.85, 0.3, 0.9, 0.06), 'B')
        m.add(F.slab(1, k, 0.3, 0.7, 0.35, 0.8, 0.04), 'C')       # small nose marking
        m.add(F.slab(4, k, 0.2, 0.8, 0.2, 0.8, 0.05), 'B')
    m.add(F.slab(3, 0, 0.1, 0.9, 0.1, 0.55, 0.04), 'B')           # gear doors
    m.add(F.slab(4, 0, 0.15, 0.85, 0.2, 0.8, 0.04), 'B')
    m.add(F.slab(3, 4, 0.2, 0.8, 0.55, 0.95, 0.05), 'T')          # dorsal vent
    m.add(box((0, 8.2, -0.76), (0.36, 0.6, 0.22)), 'G')          # chin sensor window
    m.add(cyl((0.27, 9.2, -0.32), (0.27, 10.0, -0.32), 0.03, n=4), 'F')   # pitot
    # lower chine armour skirts
    m.sym(frust('y', 7.0, -4.5, (1.05, -0.78, 0.5, 0.5), (1.45, -0.72, 0.5, 0.6), 0.14), 'B', fv=True)

    # ---------------- armoured cockpit with slit glazing + spine
    C = Loft([rect_ring('y', 7.0, 0, 0.5, 0.55, 0.32, 0.1), rect_ring('y', 5.9, 0, 1.0, 1.1, 0.85, 0.3),
              rect_ring('y', 4.5, 0, 1.22, 1.2, 0.95, 0.32), rect_ring('y', 3.3, 0, 1.24, 0.95, 0.6, 0.2)])
    m.add(C.geo, 'B', fv=True)
    for k in (3, 4, 5):
        m.add(C.slab(0, k, 0.1, 0.9, 0.25, 0.92, 0.04), 'G')      # windscreen facets
    for k in (2, 3, 5, 6):
        m.add(C.slab(1, k, 0.12, 0.88, 0.08, 0.6, 0.04), 'G')     # side slits
    m.add(C.slab(1, 4, 0.15, 0.85, 0.1, 0.9, 0.05), 'A')          # roof hatch
    m.add(frust('y', 3.5, -6.6, (0, 1.25, 1.0, 0.8), (0, 0.9, 0.5, 0.4), 0.2, 0.1), 'B')
    m.add(box((0, -0.5, 1.8), (0.06, 0.7, 0.55)), 'F')           # blade antennas
    m.add(box((0, -3.0, 1.58), (0.06, 0.5, 0.45)), 'F')
    m.add(box((0, 1.6, -1.15), (0.06, 0.6, 0.4)), 'F')

    # ---------------- engine nacelles (shoulder intakes) + nozzles
    nx = 2.0
    nsec = [(1.9, 1.3, 1.5, 0.58), (-1.0, 1.65, 1.7, 0.5), (-6.0, 1.55, 1.55, 0.5), (-7.9, 1.25, 1.25, 0.5)]
    for sgn, nozname in ((-1, 'noz_1'), (1, 'noz_2')):
        N = Loft([rect_ring('y', y, sgn * nx, cz, w, h, 0.32) for y, w, h, cz in nsec], cap0=False)
        m.add(N.geo, 'A', fv=True)
        hollow_end(m, None, N.rings[0], (0, 1, 0), lip=0.12, depth=1.4, shrink=0.7, mo='B')
        m.add(box((sgn * nx, 1.75, 0.58), (0.1, 0.5, 1.2)), 'F')      # intake splitter
        nozzle(m, None, (sgn * nx, -9.1, 0.5), (0, -1, 0), 0.7, 0.55, 1.35, n=10)
        m.add(cyl((sgn * nx, -8.05, 0.5), (sgn * nx, -7.6, 0.5), 0.76, 0.84, n=10), 'B')  # collar
        for a in range(5):                                            # nozzle actuator strakes
            ang = a * 2 * pi / 5 + 0.3
            m.add(cyl((sgn * nx + 0.72 * cos(ang), -7.9, 0.5 + 0.72 * sin(ang)), (sgn * nx + 0.68 * cos(ang), -8.9, 0.5 + 0.68 * sin(ang)), 0.07, n=4), 'W')
        m.joint(nozname, loc=(sgn * nx, -9.1, 0.5), aim=(0, -1, 0), soot=(2.4, 0.6))
        m.add(N.slab(1, 4, 0.2, 0.8, 0.15, 0.5, 0.05), 'T')      # top vents
        m.add(N.slab(1, 4, 0.2, 0.8, 0.6, 0.9, 0.05), 'B')
        m.add(N.slab(2, 4, 0.25, 0.75, 0.2, 0.8, 0.04), 'T')
        ko = 2 if sgn > 0 else 6
        m.add(N.slab(0, ko, 0.15, 0.85, 0.06, 0.2, 0.03), 'H')   # intake hazard band
        m.add(N.slab(1, ko, 0.2, 0.8, 0.3, 0.8, 0.05), 'B')
        m.add(N.slab(0, 0, 0.1, 0.9, 0.3, 0.9, 0.05), 'B')
        m.add(N.slab(1, 0, 0.15, 0.85, 0.1, 0.9, 0.05), 'F')
        # cheek cannon under the intake
        m.add(obox((sgn * 1.55, 3.0, -0.55), (0.5, 2.4, 0.5), 0.12), 'F')
        m.add(cyl((sgn * 1.55, 4.2, -0.55), (sgn * 1.55, 5.9, -0.55), 0.09, n=6), 'W')

    # ---------------- cranked forward-swept wings with drooped tip plates
    wsec = [((1.1, 1.8, 0.98), (1.1, -3.9, 0.98), 0.46), ((3.7, 1.0, 0.45), (3.7, -2.4, 0.45), 0.32),
            ((6.75, 3.3, 0.85), (6.75, 1.7, 0.85), 0.14)]
    W = Loft(wing(wsec))
    m.sym(W.geo, 'A', fv=True)
    for i, (a, b) in enumerate(((0.1, 0.9), (0.08, 0.92))):
        m.sym(W.slab(i, 1, 0.0, 1.0, a, b, 0.025), 'B')          # upper wing panel
        m.sym(W.slab(i, 2, 0.15, 0.85, 0.1, 0.9, 0.03), 'F')      # flap / control surface
        m.sym(W.slab(i, 4, 0.05, 0.95, 0.15, 0.85, 0.025), 'B')
    m.sym(W.slab(1, 1, 0.0, 1.0, 0.78, 0.9, 0.04), 'C')           # wing stripe
    m.sym(W.slab(1, 4, 0.0, 1.0, 0.78, 0.9, 0.04), 'C')
    m.sym(loft(wing([((6.75, 3.45, 0.87), (6.75, 1.55, 0.87), 0.16), ((7.1, 2.7, -0.25), (7.1, 1.5, -0.25), 0.06)])), 'B')   # tip plate
    m.sym(cyl((6.78, 1.2, 0.87), (6.78, 3.9, 0.87), 0.13, 0.07, n=6), 'F')
    m.sym(box((6.78, 3.9, 0.87), (0.14, 0.26, 0.14)), 'G')

    # ---------------- canted fins, ventral strakes, tailplanes
    fin = Loft(wing([((2.35, -4.3, 1.2), (2.35, -8.4, 1.2), 0.24), ((3.75, -7.2, 4.0), (3.75, -8.9, 4.0), 0.08)]))
    m.sym(fin.geo, 'A', fv=True)
    m.sym(fin.slab(0, 1, 0.0, 1.0, 0.7, 0.84, 0.03), 'C')
    m.sym(fin.slab(0, 4, 0.0, 1.0, 0.7, 0.84, 0.03), 'C')
    m.sym(fin.slab(0, 2, 0.1, 0.9, 0.05, 0.62, 0.03), 'F')
    m.sym(fin.slab(0, 1, 0.1, 0.9, 0.1, 0.55, 0.03), 'B')
    m.sym(box((3.75, -8.1, 4.02), (0.1, 0.3, 0.12)), 'G')
    m.sym(loft(wing([((2.3, -5.0, -0.15), (2.3, -8.2, -0.15), 0.16), ((3.05, -7.0, -1.25), (3.05, -8.4, -1.25), 0.06)])), 'B')
    tp = Loft(wing([((2.7, -5.7, 0.42), (2.7, -8.6, 0.42), 0.2), ((5.0, -7.8, 0.25), (5.0, -9.1, 0.25), 0.08)]))
    m.sym(tp.geo, 'A')
    m.sym(tp.slab(0, 2, 0.1, 0.9, 0.05, 0.95, 0.025), 'F')
    m.sym(loft(wing([((0.95, 6.7, 0.22), (1.0, 4.9, 0.32), 0.14), ((2.2, 5.4, 0.05), (2.2, 4.7, 0.08), 0.05)])), 'B')   # canard strakes

    # ---------------- rotary chin gun
    gz = -1.24
    m.add(obox((0, 6.2, -1.05), (1.05, 2.8, 0.8), 0.24), 'F')
    m.add(box((0.6, 5.5, -0.95), (0.4, 1.3, 0.55)), 'B')          # ammo feed fairing
    m.add(cyl((0, 6.9, gz), (0, 8.3, gz), 0.3, 0.26, n=8), 'W')
    for a in range(3):
        ang = a * 2 * pi / 3 + pi / 2
        ox, oz = 0.14 * cos(ang), 0.14 * sin(ang)
        m.add(cyl((ox, 8.3, gz + oz), (ox, 9.85, gz + oz), 0.065, n=5), 'W')
    m.add(cyl((0, 8.9, gz), (0, 9.1, gz), 0.24, n=8), 'F')
    m.add(cyl((0, 9.6, gz), (0, 9.8, gz), 0.24, n=8), 'F')
    m.joint('muzzle', loc=(0, 9.85, gz), soot=(1.5, 0.45))

    # ---------------- pylons, rocket pods, missiles
    px, py, pz = 3.7, 0.95, -0.55
    for sgn, nm in ((-1, 'pylon_L'), (1, 'pylon_R')):
        x = sgn * px
        m.add(frust('y', -1.5, 0.6, (x, -0.03, 0.18, 0.55), (x, 0.05, 0.14, 0.36)), 'F')
        m.add(cyl((x, -1.7, pz), (x, py, pz), 0.45, n=8), 'B', fv=True)
        m.add(cyl((x, -2.5, pz), (x, -1.7, pz), 0.18, 0.45, n=8), 'B')
        m.add(cyl((x, py - 0.25, pz), (x, py + 0.02, pz), 0.48, n=8), 'F')
        m.add(cyl((x, py, pz), (x, py + 0.04, pz), 0.38, n=8), 'T')
        m.add(sweep_ring((x, -0.6, pz), (0, 1, 0), 0.44, 0.48, 0.25, 8), 'H')
        m.joint(nm, loc=(x, py + 0.04, pz), soot=(1.1, 0.3))
        x2 = sgn * 5.3                                             # outboard missile
        m.add(box((x2, 1.0, 0.4), (0.1, 1.2, 0.32)), 'F')
        m.add(cyl((x2, -0.5, 0.18), (x2, 2.3, 0.18), 0.13, n=6), 'W')
        m.add(cyl((x2, 2.3, 0.18), (x2, 2.8, 0.18), 0.13, 0.03, n=6), 'C')
        m.add(box((x2, -0.3, 0.18), (0.6, 0.4, 0.03)), 'F')
        m.add(box((x2, -0.3, 0.18), (0.03, 0.4, 0.6)), 'F')
    # belly centreline sensor / jammer pod
    m.add(obox((0, -1.5, -1.2), (0.8, 3.4, 0.55), 0.18), 'B')
    m.add(box((0, 0.3, -1.2), (0.5, 0.25, 0.35)), 'G')
    return m
