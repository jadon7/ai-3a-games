# enemy orbital landing ship -- ~466 m long (Y), ~172 m wide (X), ~98 m tall (Z). origin = hull centre.
# Blender: bow +Y, up +Z.   engine_1 = front-left, 2 = front-right, 3 = rear-left, 4 = rear-right.
# bay_1..4 run bow -> stern; noz_1..6 = hover nozzles (L/R pairs, bow -> stern); pd_1..4 = FL, FR, RL, RR.
from air_lib import *

BAYS = [112, 38, -38, -112]           # bay centre Y
BAY_HX, BAY_HY = 15.0, 22.0
BELLY = -32.0                          # structural hull bottom
TILE = -35.5                           # heat-shield tile surface
HOVER = [(-38, 75), (38, 75), (-38, 0), (38, 0), (-38, -75), (38, -75)]
ENG = [(-63, 172), (63, 172), (-63, -172), (63, -172)]
PD = [(-1, 128), (1, 128), (-1, -128), (1, -128)]


def in_bay(y0, y1):
    for b in BAYS:
        if y0 >= b - BAY_HY - 0.1 and y1 <= b + BAY_HY + 0.1:
            return True
    return False


def engine(m, node, noz, cx, cy, sx):
    n = 12
    ph = pi / n
    D = Loft([circ_ring('z', z, cx, cy, r, n, ph) for z, r in ((-41.0, 20.0), (-39.5, 22.0), (-23.0, 22.0), (-19.0, 17.5))])
    m.add(D.geo, 'B', node, fv=True)
    for k in range(n):                                   # armour staves + recessed machinery panels
        if k % 2 == 0:
            m.add(D.slab(1, k, 0.08, 0.92, 0.06, 0.94, 0.9), 'A', node)
            m.add(D.slab(1, k, 0.3, 0.7, 0.55, 0.85, 1.3), 'T', node)
        else:
            m.add(D.slab(1, k, 0.15, 0.85, 0.1, 0.45, 0.5), 'F', node)
            m.add(D.slab(1, k, 0.2, 0.8, 0.62, 0.72, 0.6), 'H', node)
        m.add(D.slab(2, k, 0.1, 0.9, 0.15, 0.85, 0.5), 'F' if k % 3 else 'T', node)
    m.add(sweep_ring((cx, cy, -39.0), (0, 0, 1), 21.8, 23.0, 1.6, n, ph=ph), 'F', node)
    m.add(sweep_ring((cx, cy, -24.0), (0, 0, 1), 21.8, 22.8, 1.0, n, ph=ph), 'C', node)
    # heat skirt + bell
    m.add(loft([circ_ring('z', -41.0, cx, cy, 20.0, n, ph), circ_ring('z', -44.0, cx, cy, 15.5, n, ph)]), 'T', node, fv=True)
    nozzle(m, node, (cx, cy, -48.0), (0, 0, -1), 17.0, 11.5, 8.0, n=16, lip=0.07, depth=0.8)
    for k in range(8):                                   # bell stiffener ribs
        a = k * pi / 4 + pi / 8
        d = V((cos(a), sin(a), 0))
        m.add(cyl(V((cx, cy, -41.5)) + d * 18.5, V((cx, cy, -46.5)) + d * 16.6, 0.7, n=5), 'F', node)
    for k in range(4):
        a = k * pi / 2
        d = V((cos(a), sin(a), 0))
        t = V((-sin(a), cos(a), 0))
        m.add(obb(V((cx, cy, -42.5)) + d * 19.2, t, d, (5.0, 3.0, 3.6)), 'F', node)      # turbopump blocks
        m.add(obb(V((cx, cy, -45.0)) + d * 17.3, t, d, (2.2, 1.2, 1.0)), 'G', node)
    # outboard intake louvres + fuel lines
    m.add(obb((cx + sx * 21.6, cy, -30.5), (0, 1, 0), (0, 0, 1), (14, 9, 2.4)), 'B', node)
    m.add(tiles((V((cx + sx * 22.85, cy - 6, -34)), V((cx + sx * 22.85, cy + 6, -34)), V((cx + sx * 22.85, cy + 6, -27)),
                 V((cx + sx * 22.85, cy - 6, -27))), 1, 5, gu=0.1, gv=0.35, t=0.3, out=(sx, 0, 0)), 'T', node)
    for s in (-1, 1):
        m.add(pipe([(cx + s * 9, cy + 20.5, -22), (cx + s * 9, cy + 22.6, -30), (cx + s * 7, cy + 21.0, -41)], 1.0, n=5), 'F', node)
        m.add(pipe([(cx + s * 9, cy - 20.5, -22), (cx + s * 9, cy - 22.6, -30), (cx + s * 7, cy - 21.0, -41)], 1.0, n=5), 'F', node)
    m.joint(noz, parent=node, loc=(cx, cy, -48.0), soot=(34.0, 0.55))


def turret(m, c, fwd):
    """static main battery: octagonal barbette + gun house + twin barrels along fwd (+1/-1 in Y)"""
    cx, cy, cz = c
    m.add(cyl((cx, cy, cz), (cx, cy, cz + 3), 10, 9.5, n=8, ph=pi / 8), 'F')
    H = Loft([rect_ring('z', cz + 3, cx, cy, 15, 18, 3), rect_ring('z', cz + 7.5, cx, cy + fwd * -1, 12, 14, 3)])
    m.add(H.geo, 'A', fv=True)
    m.add(box((cx, cy + fwd * 8.5, cz + 5.2), (10, 2.4, 3.2)), 'B')
    for o in (-2.6, 2.6):
        m.add(cyl((cx + o, cy + fwd * 9, cz + 5.4), (cx + o, cy + fwd * 30, cz + 6.6), 1.0, 0.8, n=6), 'W')
        m.add(cyl((cx + o, cy + fwd * 28, cz + 6.45), (cx + o, cy + fwd * 31, cz + 6.65), 1.3, n=6), 'F')
    m.add(box((cx, cy - fwd * 3, cz + 8.2), (4, 4, 1.4)), 'B')
    m.add(box((cx, cy + fwd * 5.5, cz + 7.7), (2.0, 0.6, 0.8)), 'G')


def make():
    m = Model('carrier', ao_dist=22.0, seed=47, rays=10)
    R = random.Random(5)

    # ================= lower hull (heat-scarred): two side keels + centre blocks between the drop bays
    side = [(BAY_HX, BELLY), (56, BELLY), (76, -19), (76, -8), (BAY_HX, -8)]
    ys = [190, 134, 90, 60, 16, -16, -60, -90, -134, -200]
    SR = Loft([[P('y', y, u, v) for u, v in side] for y in ys])
    m.sym(SR.geo, 'B', fv=True)
    for y0, y1 in ((190, 134), (90, 60), (16, -16), (-60, -90), (-134, -200)):
        m.add(bx(-BAY_HX, BAY_HX, y1, y0, BELLY, -8), 'B')
    # bow: twin mandible prongs flanking a recessed launch mouth
    m.add(bx(-22, 22, 190, 200, BELLY, -8), 'B')
    m.add(slab(yq(200, -20, 20, -30.5, -10), t=0.6, out=(0, 1, 0)), 'T')
    m.add(tiles(yq(200.6, -18, 18, -28, -25.5), 6, 1, gu=0.5, gv=0, t=0.3, out=(0, 1, 0)), 'G')
    m.add(tiles(yq(200.6, -18, 18, -15, -13.5), 9, 1, gu=0.6, gv=0, t=0.3, out=(0, 1, 0)), 'G')
    m.add(tiles(yq(200, -22, 22, -32, -30.5), 9, 1, gu=0.5, gv=0, t=0.9, out=(0, 1, 0)), 'H')
    m.add(bx(-21.3, 21.3, 190.7, 199.3, TILE + 0.4, BELLY + 0.3), 'T', dust=0.25)
    pr = [[(22, BELLY), (56, BELLY), (76, -19), (76, -8), (22, -8)], [(25, -28), (48, -28), (62, -18), (62, -8), (25, -8)],
          [(28, -21), (38, -21), (46, -15), (46, -8), (28, -8)]]
    PR = Loft([[P('y', y, u, v) for u, v in pr[i]] for i, y in enumerate((190, 214, 233))], cap0=False)
    m.sym(PR.geo, 'B', fv=True)
    for i in range(2):
        m.sym(PR.slab(i, 0, 0.04, 0.96, 0.04, 0.96, 1.6), 'T', dust=0.25)
        m.sym(PR.slab(i, 1, 0.05, 0.9, 0.05, 0.95, 1.4), 'T' if i == 0 else 'B', dust=0.2)
        m.sym(PR.slab(i, 2, 0.15, 0.85, 0.1, 0.9, 0.6), 'A')
        m.sym(PR.slab(i, 4, 0.1, 0.9, 0.1, 0.9, 0.5), 'F')
    m.sym(PR.slab(1, 2, 0.35, 0.65, 0.3, 0.8, 0.9), 'C')
    m.sym(box((37, 233.2, -14.5), (6, 0.8, 3)), 'G')
    m.sym(cyl((37, 223, -6.5), (37, 233.6, -6.5), 1.0, 0.5, n=5), 'F')       # bow sensor lances
    stern = [(-50, -29), (50, -29), (68, -18), (68, -8), (-68, -8), (-68, -18)]
    full = [(-56, BELLY), (56, BELLY), (76, -19), (76, -8), (-76, -8), (-76, -19)]
    ST = Loft([[P('y', -200, u, v) for u, v in full], [P('y', -226, u, v) for u, v in stern]], cap0=False)
    m.add(ST.geo, 'B', fv=True)

    # ---- belly heat-shield tiles (flat part), sloped side plating, cross ribs, service pipes
    xe = [-56, -36, -BAY_HX, BAY_HX, 36, 56]
    ye = [-200, -167, -134, -112, -90, -60, -38, -16, 16, 38, 60, 90, 112, 134, 162, 190]
    for j in range(len(ye) - 1):
        for i in range(5):
            if i == 2 and in_bay(ye[j], ye[j + 1]):
                continue
            g = 0.7
            z = TILE + R.uniform(0, 0.9)
            m.add(bx(xe[i] + g, xe[i + 1] - g, ye[j] + g, ye[j + 1] - g, z, BELLY + 0.3), 'T' if R.random() < 0.72 else 'B', dust=0.25)
        for s in (-1, 1):
            q = (V((s * 56, ye[j], BELLY)), V((s * 76, ye[j], -19)), V((s * 76, ye[j + 1], -19)), V((s * 56, ye[j + 1], BELLY)))
            m.add(slab(q, 0.03, R.uniform(0.6, 0.92), 0.03, 0.97, 2.4, inside=(0, 0, 0)), 'T' if R.random() < 0.6 else 'B', dust=0.2)
    for k in (0, 1, 5):
        m.add(ST.slab(0, k, 0.05, 0.95, 0.05, 0.9, 1.6), 'T' if k == 0 else 'B', dust=0.2)
    for y in (148, 75, 0, -75, -148):
        m.add(bx(-56, 56, y - 1.6, y + 1.6, -36.8, BELLY), 'F')
    for s in (-1, 1):
        m.add(pipe([(s * 36, -198, -34.2), (s * 36, 188, -34.2)], 1.0, n=5), 'F')
        m.add(tiles(xq(s * 76, -195, 185, -17.5, -9.5), 19, 1, gu=0.1, gv=0, t=0.7, out=(s, 0, 0),
                    skip=lambda i, j: 5 <= i <= 12), 'B', fv=True)
        for y in list(range(-185, -80, 21)) + list(range(88, 190, 21)):
            m.add(box((s * 76.9, y, -18.2), (0.6, 3.0, 1.0)), 'G')

    # ---- drop bays (deep recesses in the belly)
    for i, by in enumerate(BAYS):
        y0, y1 = by - BAY_HY, by + BAY_HY
        m.add(bx(-BAY_HX, BAY_HX, y0, y1, -12.5, -11), 'T')                           # ceiling
        m.add(bx(-BAY_HX - 0.2, -BAY_HX + 0.8, y0, y1, BELLY, -11), 'F')
        m.add(bx(BAY_HX - 0.8, BAY_HX + 0.2, y0, y1, BELLY, -11), 'F')
        m.add(bx(-BAY_HX, BAY_HX, y0 - 0.2, y0 + 0.8, BELLY, -11), 'F')
        m.add(bx(-BAY_HX, BAY_HX, y1 - 0.8, y1 + 0.2, BELLY, -11), 'F')
        for s in (-1, 1):
            m.add(bx(s * 6, s * 8, y0 + 1, y1 - 1, -15.5, -12.5), 'F')                # pod rails
            for yy in (by - 13, by, by + 13):
                m.add(bx(s * 3, s * 11, yy - 2.2, yy + 2.2, -19, -15.5), 'F')        # release clamps
                m.add(bx(s * 4.5, s * 9.5, yy - 1.2, yy + 1.2, -19.6, -19), 'H')
            m.add(tiles(xq(s * (BAY_HX - 0.8), y0 + 2, y1 - 2, -30, -27.5), 6, 1, gu=0.5, gv=0, t=0.3, out=(-s, 0, 0)), 'G')
            m.add(tiles(xq(s * (BAY_HX - 0.8), y0 + 2, y1 - 2, -20, -18.5), 4, 1, gu=0.6, gv=0, t=0.3, out=(-s, 0, 0)), 'G')
            m.add(tiles(zq(TILE - 0.5, s * (BAY_HX + 0.3), s * (BAY_HX + 3.3), y0, y1), 1, 7, gu=0, gv=0.5, t=0.3, out=(0, 0, -1), sink=1.5), 'H')
        for yy in (y0 - 3.3, y1 + 0.3):
            m.add(tiles(zq(TILE - 0.5, -BAY_HX, BAY_HX, yy, yy + 3.0), 5, 1, gu=0.5, gv=0, t=0.3, out=(0, 0, -1), sink=1.5), 'H')
        m.joint('bay_%d' % (i + 1), loc=(0, by, TILE))

    # ---- hover nozzles
    for i, (hx, hy) in enumerate(HOVER):
        m.add(cyl((hx, hy, BELLY), (hx, hy, -38.0), 11.5, 10.5, n=12, ph=pi / 12), 'F')
        m.add(sweep_ring((hx, hy, -36.6), (0, 0, 1), 10.8, 12.6, 1.0, 12, ph=pi / 12), 'B')
        nozzle(m, None, (hx, hy, -42.5), (0, 0, -1), 9.0, 6.5, 5.0, n=12, lip=0.08, ph=pi / 12)
        for k in range(4):
            a = k * pi / 2 + pi / 4
            d = V((cos(a), sin(a), 0))
            m.add(cyl(V((hx, hy, -37.5)) + d * 10.6, V((hx, hy, -41.5)) + d * 8.9, 0.5, n=4), 'F')
            m.add(obb(V((hx, hy, -36.3)) + d * 13.2, d, (-d.y, d.x, 0), (2.2, 1.6, 1.0)), 'G')
        m.joint('noz_%d' % (i + 1), loc=(hx, hy, -42.5), soot=(22.0, 0.5))

    # ================= mid hull: segmented blocks with trench gaps over a dark core
    midp = [(-60, -8), (60, -8), (64, -4), (64, 10), (58, 14), (-58, 14), (-64, 10), (-64, -4)]
    m.add(prism([(u * 0.93, lerp(3, v, 0.9)) for u, v in midp], 'y', -203, 173), 'F')      # core
    segs = [(175, 128), (123, 70), (65, 6), (1, -58), (-63, -128), (-133, -205)]
    for y0, y1 in segs:
        L = Loft([[P('y', y0, u, v) for u, v in midp], [P('y', y1, u, v) for u, v in midp]])
        m.add(L.geo, 'A', fv=True)
        ln = y0 - y1
        for k, s in ((2, 1), (6, -1)):                   # side walls
            m.add(slab(xq(s * 64, y1 + 1.5, y0 - 1.5, -2.5, 2.0), t=0.5, out=(s, 0, 0)), 'F')     # trench floor
            m.add(slab(xq(s * 64, y1 + 1, y0 - 1, 2.0, 3.2), t=2.2, out=(s, 0, 0)), 'A')         # trench lips
            m.add(slab(xq(s * 64, y1 + 1, y0 - 1, -3.7, -2.5), t=2.2, out=(s, 0, 0)), 'A')
            greebles(m, ['F', 'F', 'B', 'W'], (s * 64.5, y1 + 2 if s > 0 else y0 - 2, -2.3), (0, s * (ln - 4), 0), (0, 0, 4.1),
                     int(ln / 6), 1.2, 3.2, 0.8, 2.0, seed=int(y0 * 3 + s))
            m.add(pipe([(s * 65.3, y1 + 2, 0.9), (s * 65.3, y0 - 2, 0.9)], 0.45, n=4), 'W')
            nwin = int(ln / 6)
            m.add(tiles(xq(s * 64, y1 + 4, y0 - 4, 6.4, 7.4), nwin, 1, gu=0.65, gv=0, t=0.25, out=(s, 0, 0), flat=True,
                        skip=lambda i, j, r=random.Random(int(y0 + s)): r.random() < 0.3), 'G')
            m.add(tiles(xq(s * 64, y1 + 3, y0 - 3, 4.1, 4.9), nwin, 1, gu=0.72, gv=0, t=0.25, out=(s, 0, 0), flat=True,
                        skip=lambda i, j, r=random.Random(int(y0 - s)): r.random() < 0.5), 'G')
            m.add(slab(xq(s * 64, y1 + ln * 0.3, y1 + ln * 0.62, 8.2, 9.6), t=0.4, out=(s, 0, 0)), 'B')
            m.add(L.slab(0, 3 if s > 0 else 5, 0.2, 0.8, 0.1, 0.9, 0.4), 'B')
    # mid bow
    mb = Loft([[P('y', 175, u, v) for u, v in midp], rect_ring('y', 208, 0, -1.5, 66, 13, (3, 3)), ], cap0=False)
    m.add(mb.geo, 'A', fv=True)
    m.add(mb.slab(0, 4, 0.08, 0.92, 0.15, 0.85, 0.5), 'B')
    m.add(mb.slab(0, 4, 0.1, 0.9, 0.44, 0.5, 0.8), 'C')
    for k in (2, 6):
        m.add(mb.slab(0, k, 0.1, 0.9, 0.2, 0.8, 0.5), 'B')
        m.add(mb.slab(0, k, 0.2, 0.8, 0.44, 0.5, 0.8), 'C')
    m.add(bx(-24, 24, 207.5, 209, -5, 2), 'T')
    m.add(tiles(yq(209, -22, 22, -3.5, 0.5), 8, 2, gu=0.4, gv=0.4, t=0.25, out=(0, 1, 0), flat=True), 'G')   # bow sensor array
    # side ledges (z = -8) : machinery
    for s in (-1, 1):
        greebles(m, ['F', 'B', 'A', 'F'], (s * 65, -195 if s > 0 else 180, -8), (s * 10, 0, 0), (0, s * 375, 0), 52, 3, 7, 1.5, 5, seed=70 + s)
        m.add(pipe([(s * 73.5, -195, -6.8), (s * 73.5, 185, -6.8)], 1.1, n=5), 'F')
        m.add(pipe([(s * 71, -195, -7.2), (s * 71, 185, -7.2)], 0.6, n=4), 'W')

    # ================= hangar sponsons (side openings)
    pil = [(-70, -60.5), (-26.5, -17), (17, 26.5), (60.5, 70)]
    ope = [(-60.5, -26.5), (-17, 17), (26.5, 60.5)]
    for s in (-1, 1):
        m.add(bx(s * 70, s * 85, -70, 70, -9, -2), 'A', fv=True)
        m.add(frust('y', -70, 70, (s * 77.5, -24, 15, 4), (s * 77.5, -24, 15, 4)), 'A')
        m.add(prism([(s * 70, -26), (s * 85, -26), (s * 82, -31), (s * 70, -31)], 'y', -66, 66), 'B')
        for y0, y1 in pil:
            m.add(bx(s * 70, s * 85, y0, y1, -22, -9), 'A')
            m.add(tiles(xq(s * 85, y0 + 0.8, y1 - 0.8, -21.5, -9.5), 1, 6, gu=0, gv=0.5, t=0.3, out=(s, 0, 0)), 'H')
        m.add(bx(s * 70, s * 72, -70, 70, -22, -9), 'T')
        m.add(bx(s * 72, s * 84.6, -70, 70, -22.2, -21.8), 'F')
        for y0, y1 in ope:
            m.add(bx(s * 73, s * 84, y0 + 3, y0 + 4.5, -9.6, -9), 'G')
            m.add(bx(s * 73, s * 84, y1 - 4.5, y1 - 3, -9.6, -9), 'G')
            m.add(tiles(xq(s * 72, y0 + 3, y1 - 3, -14, -12.5), 5, 1, gu=0.6, gv=0, t=0.25, out=(s, 0, 0), flat=True), 'G')
            m.add(bx(s * 74, s * 80, y0 + 9, y0 + 20, -21.8, -18.5), 'F')              # parked craft silhouette
            m.add(bx(s * 73, s * 81, y0 + 12, y0 + 16, -20.5, -19.8), 'B')
        m.add(slab(xq(s * 85, -68, 68, -8.2, -3.5), t=0.4, out=(s, 0, 0)), 'B')
        for y0, y1 in ((-66, -58), (58, 66)):
            m.add(slab(xq(s * 85, y0, y1, -7.6, -4.1), t=0.7, out=(s, 0, 0)), 'C')
        m.add(tiles(xq(s * 85, -52, 52, -6.6, -5.2), 12, 1, gu=0.7, gv=0, t=0.6, out=(s, 0, 0), flat=True), 'G')
        greebles(m, ['F', 'B', 'F'], (s * 71 if s > 0 else s * 84, -68, -2), (13, 0, 0), (0, 136, 0), 16, 3, 7, 1, 3.5, seed=90 + s)

    # ---- point-defence mounts on the lower hull sides
    for i, (s, py) in enumerate(PD):
        m.add(prism([(s * 76, -18), (s * 82, -15.5), (s * 82, -13.5), (s * 76, -13.5)], 'y', py - 6, py + 6), 'F')
        m.add(cyl((s * 79.5, py, -13.5), (s * 79.5, py, -11.8), 2.6, 2.2, n=8), 'B')
        m.add(cyl((s * 79.5, py, -11.8), (s * 79.5, py, -10.6), 2.0, 1.2, n=8), 'W')
        for o in (-0.7, 0.7):
            m.add(cyl((s * 80.3, py + o, -11.2), (s * 84.6, py + o, -12.0), 0.28, n=5), 'W')
        m.add(tiles(xq(s * 76, py - 9, py + 9, -12.6, -9.2), 6, 1, gu=0.5, gv=0, t=0.9, out=(s, 0, 0)), 'H')
        m.joint('pd_%d' % (i + 1), loc=(s * 79.5, py, -11.5))

    # ================= upper hull / citadel
    U = Loft([rect_ring('y', y, 0, 20, 88, 12, (4, 4)) for y in (110, 40, -40, -120, -192)])
    m.add(U.geo, 'A', fv=True)
    FD = Loft([rect_ring('y', 110, 0, 18, 72, 8, 3), rect_ring('y', 164, 0, 17, 54, 6, 3)])
    m.add(FD.geo, 'A', fv=True)
    m.add(FD.slab(0, 2, 0.15, 0.85, 0.1, 0.9, 0.5), 'B')
    m.add(FD.slab(0, 6, 0.15, 0.85, 0.1, 0.9, 0.5), 'B')
    for i in range(4):
        for k, s in ((2, 1), (6, -1)):
            m.add(U.tiles(i, k, 1, 10, gu=0, gv=0.65, t=0.25, flat=True, u0=0.58, u1=0.74), 'G')
            m.add(U.slab(i, k, 0.1, 0.4, 0.2, 0.8, 0.5), 'T' if i % 2 else 'B')
            m.add(U.slab(i, 3 if s > 0 else 5, 0.15, 0.85, 0.1, 0.9, 0.5), 'B')
    for k in (2, 6):
        m.add(U.slab(1, k, 0.1, 0.9, 0.06, 0.1, 0.6), 'C')
        m.add(U.slab(1, k, 0.1, 0.9, 0.12, 0.14, 0.6), 'C')
    for s in (-1, 1):                                    # deck (z = 14) outboard of the citadel
        greebles(m, ['F', 'B', 'A'], (s * 46 if s > 0 else s * 57, -190, 14), (11, 0, 0), (0, 350, 0), 30, 3, 8, 1.5, 5, seed=110 + s)
        # dorsal spine blocks flanking a service trench
        Sp = Loft([rect_ring('y', y, s * 11, 28.5, 16, 5, 1.5) for y in (96, 30, -40, -96)])
        m.add(Sp.geo, 'B', fv=True)
        for i in range(3):
            m.add(Sp.slab(i, 4, 0.15, 0.85, 0.1, 0.9, 0.4), 'A')
            m.add(Sp.tiles(i, 2 if s > 0 else 6, 1, 6, gu=0, gv=0.6, t=0.25, flat=True, u0=0.35, u1=0.65), 'G')
    m.add(bx(-3.5, 3.5, -94, 94, 26, 27.2), 'F')
    greebles(m, ['F', 'W', 'B', 'F'], (-3, -92, 27.2), (6, 0, 0), (0, 184, 0), 24, 1.5, 4, 0.8, 2.4, seed=140)
    m.add(pipe([(1.8, -93, 28), (1.8, 93, 28)], 0.5, n=4), 'W')
    greebles(m, ['B', 'F', 'A', 'B'], (-42, -95, 26), (20, 0, 0), (0, 200, 0), 14, 4, 10, 1.5, 4, seed=130)
    greebles(m, ['B', 'F', 'A', 'B'], (22, -95, 26), (20, 0, 0), (0, 200, 0), 14, 4, 10, 1.5, 4, seed=131)
    # static main batteries
    turret(m, (0, 130, 21.5), 1)
    turret(m, (-22, -178, 26), -1)
    # bridge tower (offset to starboard), stepped
    tx = 14
    m.add(obox((tx, -135, 29.5), (46, 62, 7), 2.5, 'z'), 'A', fv=True)
    m.add(obox((tx, -135, 35.5), (32, 44, 5), 2.0, 'z'), 'B', fv=True)
    Bt = Loft([rect_ring('z', 38, tx, -129, 40, 22, 3), rect_ring('z', 41.5, tx, -127, 44, 26, 3)])
    m.add(Bt.geo, 'A')
    for k in range(8):
        m.add(Bt.tiles(0, k, 6 if k in (0, 4) else 2, 1, gu=0.25, gv=0, t=0.2, u0=0.05, u1=0.95, v0=0.3, v1=0.8), 'G')
    m.add(tiles(xq(tx + 23, -164, -106, 29, 30.5), 9, 1, gu=0.6, gv=0, t=0.25, out=(1, 0, 0), flat=True), 'G')
    m.add(tiles(xq(tx - 23, -164, -106, 29, 30.5), 9, 1, gu=0.6, gv=0, t=0.25, out=(-1, 0, 0), flat=True), 'G')
    m.add(tiles(yq(-104, tx - 20, tx + 20, 29, 30.5), 7, 1, gu=0.6, gv=0, t=0.25, out=(0, 1, 0), flat=True), 'G')
    # masts, dishes
    for (ax, ay, h, r) in ((tx - 8, -140, 49.5, 0.9), (tx + 10, -146, 47.5, 0.7), (tx + 2, -120, 46, 0.5), (-32, 60, 45, 0.8), (-32, 75, 41, 0.5)):
        m.add(cyl((ax, ay, 26), (ax, ay, h), r, r * 0.35, n=5), 'F')
        m.add(box((ax, ay, h - 4), (5, 0.4, 0.4)), 'F')
        m.add(box((ax, ay, h - 7), (0.4, 3.5, 0.4)), 'F')
        m.add(box((ax, ay, h), (0.9, 0.9, 0.9)), 'G')
    m.add(obox((-32, 67, 29), (16, 24, 6), 2.0, 'z'), 'B')
    m.add(cyl((-32, 67, 32), (-32, 67, 36), 2.0, n=6), 'F')
    m.add(cyl((-32, 68, 38.5), (-32, 62, 42.5), 9.0, 1.5, n=12), 'B')       # big dish
    m.add(cyl((tx + 12, -152, 38), (tx + 12, -152, 43), 5.5, 5.5, n=10), 'B')  # radome drum
    # dorsal radiator fins
    for y in (-60, -40, -20, 0, 20):
        for s in (-1, 1):
            m.add(obb((s * 33, y, 30), (1, 0, 0), (0, 1, 0), (14, 1.0, 8)), 'B')
    # ================= stern: main drive block
    for x, w in ((-44, 34), (0, 40), (44, 34)):
        Dn = Loft([rect_ring('y', -222, x, -15, w, 22, 3), rect_ring('y', -232, x, -15, w - 4, 19, 3)], cap1=False)
        m.add(Dn.geo, 'F')
        hollow_end(m, None, Dn.rings[-1], (0, -1, 0), lip=0.1, depth=7, shrink=0.75, mo='B')
    m.add(bx(-62, 62, -212, -205, -6, 12), 'B')
    m.add(tiles(yq(-212, -58, 58, 3, 5), 10, 1, gu=0.6, gv=0, t=0.25, out=(0, -1, 0), flat=True), 'G')

    # ================= descent engines (destroyable)
    for i, (ex, ey) in enumerate(ENG):
        nm = 'engine_%d' % (i + 1)
        m.add(cyl((ex, ey, -24), (ex, ey, -17), 15, 15, n=12), 'F')        # static mount stub
        m.joint(nm, loc=(ex, ey, -30))
        engine(m, nm, 'noz_engine_%d' % (i + 1), ex, ey, 1 if ex > 0 else -1)
    return m
