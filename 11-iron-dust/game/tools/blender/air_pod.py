# orbital drop pod -- blunt capsule ~24 m tall, ~13 m diameter, origin at bottom centre.
# Blender: up +Z. petal_1 sits on the -Y side (Godot +Z); +100 deg about local X folds it outward/down.
from air_lib import *

PROF = [(3.5, 5.85), (7.0, 5.75), (12.0, 5.2), (16.5, 4.25), (20.0, 3.0), (22.5, 1.75), (23.7, 0.7), (24.0, 0.15)]
TH = 0.32


def rad(z):
    for (z0, r0), (z1, r1) in zip(PROF, PROF[1:]):
        if z0 <= z <= z1:
            return lerp(r0, r1, (z - z0) / (z1 - z0))
    return PROF[-1][1]


def dirv(a):
    return V((sin(a), -cos(a), 0))


def shell(prof, a0, a1, n, t):
    """closed sector solid. returns (outer faces geo, rest geo)"""
    k = len(prof)
    # inner profile: offset inward along the 2D profile normal
    inner = []
    for i, (z, r) in enumerate(prof):
        za, ra = prof[max(i - 1, 0)]
        zb, rb = prof[min(i + 1, k - 1)]
        tz, tr = zb - za, rb - ra
        l = sqrt(tz * tz + tr * tr)
        nz, nr = -tr / l, tz / l            # outward normal in (z, r)
        inner.append((z - nz * t, max(r - nr * t, 0.03)))
    vs = []
    for (z, r), (zi, ri) in zip(prof, inner):
        for j in range(n + 1):
            vs.append(dirv(lerp(a0, a1, j / n)) * r + V((0, 0, z)))
        for j in range(n + 1):
            vs.append(dirv(lerp(a0, a1, j / n)) * ri + V((0, 0, zi)))
    w = 2 * (n + 1)

    def O(i, j):
        return i * w + j

    def I(i, j):
        return i * w + n + 1 + j
    outer = []
    inner = []
    edge = []
    for i in range(k - 1):
        for j in range(n):
            outer.append((O(i, j), O(i, j + 1), O(i + 1, j + 1), O(i + 1, j)))
            inner.append((I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1)))
        edge.append((O(i, 0), O(i + 1, 0), I(i + 1, 0), I(i, 0)))
        edge.append((O(i, n), I(i, n), I(i + 1, n), O(i + 1, n)))
    for j in range(n):
        edge.append((O(0, j), I(0, j), I(0, j + 1), O(0, j + 1)))
        edge.append((O(k - 1, j), O(k - 1, j + 1), I(k - 1, j + 1), I(k - 1, j)))
    g = fix(Geo(vs, outer + inner + edge))
    return g, len(outer), len(inner)

def patch(z0, z1, a0, a1, t, n=2, off=0.0):
    """raised plate conforming to the shell"""
    zs = [z0] + [z for z, r in PROF if z0 < z < z1] + [z1]
    prof = [(z, rad(z) + t + off) for z in zs]
    g, no, ni = shell(prof, a0, a1, n, t + 0.06)
    return g.sub(list(range(no)) + list(range(no + ni, len(g.f))))


def make():
    m = Model('pod', ao_dist=2.5, seed=31)
    m.dustfn = lambda p, n: (0.55 * max(-n.z, 0.0) + 0.25) * max(0.0, 1.0 - p.z / 3.4)

    # ---------------- heat shield (charred) + base ring + deck
    hs = [(0.0, 3.0), (0.35, 4.4), (1.0, 5.45), (1.9, 6.0), (2.6, 6.2), (3.1, 6.2)]
    HS = Loft([circ_ring('z', z, 0, 0, r, 24) for z, r in hs])
    m.add(HS.geo, 'T', fv=True)
    for i in range(12):                              # ablator segment seams / replaced tiles
        if i % 3 == 0:
            m.add(HS.slab(2, i * 2, 0.05, 0.95, 0.1, 0.9, 0.06), 'B')
    m.add(cyl((0, 0, 3.1), (0, 0, 3.5), 6.05, 6.0, n=24), 'B')
    m.add(cyl((0, 0, 3.3), (0, 0, 3.58), 5.5, 5.5, n=16), 'F')        # deck
    m.add(sweep_ring((0, 0, 3.6), (0, 0, 1), 4.6, 5.1, 0.1, 16), 'H')
    for s in (-1, 1):                                # foot locks
        m.add(obox((s * 1.9, 0.6, 3.75), (1.9, 3.2, 0.5), 0.2), 'F')
        m.add(box((s * 1.9, 0.6, 4.02), (1.1, 2.2, 0.08)), 'H')
    m.add(cyl((0, 0, -0.0), (0, 0, 0.02), 1.2, n=12), 'F')            # centre plug

    # ---------------- petals
    half = radians(43.6)
    for kpet in range(4):
        nm = 'petal_%d' % (kpet + 1)
        al = kpet * pi / 2
        hinge = dirv(al) * 5.9 + V((0, 0, 3.5))
        m.joint(nm, loc=hinge, rot=Quaternion((0, 0, 1), al), iso=nm)
        g, no, ni = shell(PROF, al - half, al + half, 8, TH)
        nband = 8
        outer = {'A': [], 'B': [], 'C': []}
        for fi in range(no):
            band = fi // nband
            outer['B' if band == 0 else ('C' if band >= 5 else 'A')].append(fi)
        for mat, idx in outer.items():
            m.add(g.sub(idx), mat, nm, fv=True)
        m.add(g.sub(range(no, len(g.f))), 'F', nm)
        # outer detail
        m.add(patch(8.0, 11.5, al - 0.3, al + 0.3, 0.1), 'B', nm)                 # access hatch
        m.add(patch(9.2, 10.3, al - 0.1, al + 0.1, 0.16), 'F', nm)
        m.add(patch(12.6, 13.3, al - 0.62, al + 0.62, 0.08, n=4), 'C', nm)        # marking band
        m.add(patch(3.7, 4.3, al - 0.7, al + 0.7, 0.07, n=4), 'H', nm)            # hazard skirt
        for sa in (-0.5, 0.5):
            m.add(patch(15.2, 17.6, al + sa - 0.1, al + sa + 0.1, 0.08, n=1), 'B', nm)
            m.add(patch(17.9, 18.5, al + sa - 0.06, al + sa + 0.06, 0.12, n=1), 'T', nm)   # RCS port
            m.add(patch(5.3, 5.8, al + sa - 0.05, al + sa + 0.05, 0.1, n=1), 'G', nm)      # warning light
        m.add(patch(19.2, 19.7, al - 0.09, al + 0.09, 0.1, n=1), 'G', nm)
        # hinge lugs + inner ribs
        for sa in (-0.45, 0.0, 0.45):
            c = dirv(al + sa) * 5.95 + V((0, 0, 3.6))
            m.add(obb(c, dirv(al + sa + pi / 2), dirv(al + sa), (0.7, 0.9, 0.7)), 'F', nm)
        for sa in (-0.38, 0.0, 0.38):
            pts = []
            for z in (4.2, 9.5, 15.0, 19.5):
                pts.append(dirv(al + sa) * (rad(z) - TH - 0.22) + V((0, 0, z)))
            m.add(pipe(pts, 0.2, n=4), 'F', nm)
        for z in (8.0, 14.0):
            ring = [dirv(al + lerp(-0.7, 0.7, j / 2)) * (rad(z) - TH - 0.2) + V((0, 0, z)) for j in range(3)]
            m.add(pipe(ring, 0.16, n=4), 'F', nm)

    # ---------------- static frame / cradle
    # back mast (in front of petal_1), two rails + rungs + clamp arms
    my = -3.7
    for s in (-1, 1):
        m.add(obox((s * 0.95, my, 9.0), (0.55, 0.6, 11.0), 0.12, 'z'), 'F')               # mast rails
        m.add(cyl((s * 0.95, my, 10.5), (s * 3.0, my + 0.7, 3.6), 0.2, n=5), 'F')          # side stays
        m.add(cyl((s * 0.95, my + 0.2, 8.0), (s * 0.95, my + 2.9, 3.6), 0.2, n=5), 'F')    # forward stays
        for z in (8.6, 12.8):                                                               # clamp arms
            m.add(bx(s * 0.7, s * 1.3, my, my + 1.8, z - 0.3, z + 0.3), 'F')
            m.add(obox((s * 1.0, my + 2.05, z), (0.9, 0.5, 1.2), 0.15), 'H')
            m.add(cyl((s * 1.0, my + 0.3, z - 1.6), (s * 1.0, my + 1.5, z - 0.3), 0.14, n=4), 'W')   # actuator
        m.add(obox((s * 2.6, my + 0.45, 4.3), (1.3, 1.5, 1.5), 0.25), 'B')                 # shock absorber housings
        m.add(cyl((s * 2.6, my + 0.45, 5.05), (s * 2.6, my + 0.45, 5.9), 0.3, n=6), 'W')
    for i, z in enumerate((4.6, 6.2, 7.8, 9.4, 11.0, 12.6, 14.2)):
        m.add(bx(-0.95, 0.95, my - 0.16, my + 0.16, z - 0.16, z + 0.16), 'F')
        if i < 6:
            sg = 1 if i % 2 else -1
            m.add(cyl((-0.9 * sg, my, z + 0.1), (0.9 * sg, my, z + 1.5), 0.1, n=4), 'F')   # lattice diagonals
    m.add(bx(-0.6, 0.6, my - 0.55, my - 0.15, 9.2, 11.8), 'B')                             # umbilical box
    m.add(pipe([(0.3, my - 0.35, 9.2), (0.3, my - 0.4, 6.0), (1.6, my - 0.2, 3.7)], 0.12, n=4), 'F')
    m.add(box((0, my + 0.3, 14.1), (0.6, 0.25, 0.35)), 'G')
    m.add(box((0, my + 0.3, 7.0), (0.5, 0.2, 0.3)), 'G')    # seam posts + retro thruster housings at the four seams
    for k in range(4):
        a = pi / 4 + k * pi / 2
        d = dirv(a)
        tg = dirv(a + pi / 2)
        m.add(cyl(d * 5.25 + V((0, 0, 3.5)), d * 5.0 + V((0, 0, 7.6)), 0.3, 0.22, n=6), 'F')
        m.add(cyl(d * 5.0 + V((0, 0, 7.4)), d * 3.6 + V((0, 0, 3.6)), 0.16, n=5), 'F')
        m.add(obb(d * 5.0 + V((0, 0, 7.7)), tg, d, (0.7, 0.5, 0.35)), 'G')
        # housing: tapered fairing straddling the seam
        r0 = [d * 5.75 - tg * 0.62, d * 5.75 + tg * 0.62, d * 6.95 + tg * 0.5, d * 6.95 - tg * 0.5]
        r1 = [d * 5.6 - tg * 0.5, d * 5.6 + tg * 0.5, d * 6.6 + tg * 0.4, d * 6.6 - tg * 0.4]
        r2 = [d * 5.5 - tg * 0.3, d * 5.5 + tg * 0.3, d * 5.9 + tg * 0.22, d * 5.9 - tg * 0.22]
        H = Loft([[p + V((0, 0, 2.3)) for p in r0], [p + V((0, 0, 5.2)) for p in r1], [p + V((0, 0, 7.4)) for p in r2]])
        m.add(H.geo, 'B', fv=True)
        m.add(H.slab(0, 2, 0.15, 0.85, 0.5, 0.9, 0.06), 'T')
        m.add(H.slab(0, 2, 0.1, 0.9, 0.08, 0.3, 0.06), 'H')
        e = d * 6.35 + V((0, 0, 1.35))
        nozzle(m, None, e, (0, 0, -1), 0.6, 0.42, 1.1, n=10)
        m.joint('noz_%d' % (k + 1), loc=e, soot=(3.2, 0.7))
    return m
