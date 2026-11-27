# ck2_scope_search.py -- one-off design aid for the v2 sight arm (run in Blender for mathutils):
#   blender -b --factory-startup -P ck2_scope_search.py
# Scans stowed poses (upper-arm direction, elbow axis, fold, head twist) and keeps those that stay behind the
# pilot (y < 0), clear the seat, hide best behind the headrest, and unfold to the deployed pose without
# sweeping through the pilot's head or the seat.  The winner is hard-coded in ck2_scope.py.
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mathutils import Vector, Matrix
from ck_kit import frame_x, T, RX, RY
import ck2_scope as SC

BOXES = [  # seat volumes (min, max) in Blender coordinates
    (Vector((-0.165, -0.415, -0.15)), Vector((0.165, -0.285, 0.14))),      # headrest
    (Vector((-0.20, -0.44, -0.88)), Vector((0.20, -0.19, -0.14))),         # back
]


def box_dist(p, b):
    d = Vector((max(b[0].x - p.x, 0, p.x - b[1].x), max(b[0].y - p.y, 0, p.y - b[1].y), max(b[0].z - p.z, 0, p.z - b[1].z)))
    return d.length


def hidden(p):
    """True when the segment eye -> p passes through a seat volume."""
    for b in BOXES:
        t0, t1 = 0.0, 1.0
        ok = True
        for k in range(3):
            if abs(p[k]) < 1e-9:
                if not (b[0][k] <= 0 <= b[1][k]):
                    ok = False
                    break
                continue
            a, c = b[0][k] / p[k], b[1][k] / p[k]
            lo, hi = min(a, c), max(a, c)
            t0, t1 = max(t0, lo), min(t1, hi)
            if t0 > t1:
                ok = False
                break
        if ok:
            return True
    return False


def samples(A, F, Hm):
    """World sample points: (arm points, fore points, head box points)."""
    arm = [A @ Vector((SC.L1 * k / 8, 0, 0)) for k in range(9)]
    fore = [F @ Vector((SC.L2 * k / 8, SC.YO, 0)) for k in range(9)]
    hx, hy, hz = SC.BOX[0] / 2, SC.BOX[1] / 2, SC.BOX[2] / 2
    head = [Hm @ (SC.HO + Vector((sx * hx, sy * hy, sz * hz))) for sx in (-1, 0, 1) for sy in (-1, 0, 1) for sz in (-1, 0, 1)]
    return arm, fore, head


def seg_pt(p, a, b):
    d = b - a
    t = max(0.0, min(1.0, (p - a).dot(d) / d.dot(d)))
    return (p - (a + d * t)).length


def main():
    k = SC.solve_deployed()
    A_d, F_d, H_d = k['A_d'], k['F_d'], k['H_d']
    rel_f = A_d.inverted() @ F_d
    rel_h = F_d.inverted() @ H_d
    th_d = math.atan2(-rel_f[2][0], rel_f[0][0])
    print('SEARCH deployed elbow angle %.1f deg, E %s' % (math.degrees(th_d), tuple(round(c, 3) for c in k['E'])))
    arm, fore, head = samples(A_d, F_d, H_d)
    print('SEARCH deployed: min eye distance arm %.3f fore %.3f head %.3f' % (min(p.length for p in arm), min(p.length for p in fore), min(p.length for p in head)))
    sgn = 1.0 if th_d > 0 else -1.0
    res = []
    for az in range(100, 261, 20):                 # direction of the stowed upper arm: azimuth from +Y, clockwise
        for el in (-80, -60, -40, -20, 0, 20, 40):
            a, e = math.radians(az), math.radians(el)
            xs = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
            for yh in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)):
                if abs(xs.dot(Vector(yh))) > 0.9:
                    continue
                A_s = frame_x(SC.S, xs, yh)
                for fold in (110, 130, 150, 165):
                    fo = sgn * math.radians(fold)
                    if abs(fo - th_d) > math.radians(172):
                        continue
                    F_s = A_s @ T(SC.L1, 0, 0) @ RY(fo)
                    for tw in range(-180, 180, 30):
                        H_s = F_s @ T(SC.L2, 0, 0) @ RX(math.radians(tw)) @ rel_h.to_3x3().to_4x4()
                        arm, fore, head = samples(A_s, F_s, H_s)
                        pts = arm + fore + head
                        if max(p.y for p in pts) > -0.03:
                            continue
                        if min(p.length for p in pts) < 0.27:
                            continue
                        if min(box_dist(p, b) for p in arm[2:] + fore for b in BOXES) < 0.03:
                            continue
                        if min(box_dist(p, b) for p in head for b in BOXES) < 0.02:
                            continue
                        if min(seg_pt(p, arm[0], arm[-1]) for p in head) < 0.03:
                            continue
                        if min(seg_pt(p, fore[0], fore[-1]) for p in head if (p - fore[-1]).length > 0.05) < 0.016:
                            continue
                        vis = sum(0 if hidden(p) else 1 for p in pts)
                        spread = max((p - SC.S).length for p in pts)
                        res.append((vis + spread * 20.0, vis, spread, az, el, yh, fold, tw, A_s, F_s, H_s))
    res.sort(key=lambda r: r[0])
    print('SEARCH candidates', len(res))
    shown = 0
    for r in res:
        score, vis, spread, az, el, yh, fold, tw, A_s, F_s, H_s = r
        # path check: interpolate the three local transforms like Transform3D.interpolate_with
        la = (A_s, A_d)
        lf = (A_s.inverted() @ F_s, rel_f)
        lh = (F_s.inverted() @ H_s, rel_h)
        ok = True
        worst = 9.0
        for i in range(1, 20):
            t = i / 20.0
            def mix(m0, m1):
                p0, q0, _ = m0.decompose()
                p1, q1, _ = m1.decompose()
                return Matrix.Translation(p0.lerp(p1, t)) @ q0.slerp(q1, t).to_matrix().to_4x4()
            A = mix(*la)
            F = A @ mix(*lf)
            Hm = F @ mix(*lh)
            arm, fore, head = samples(A, F, Hm)
            dmin = min(p.length for p in arm + fore + head)
            lim = 0.22 if t < 0.85 else 0.20
            worst = min(worst, dmin)
            if dmin < lim:
                ok = False
                break
            if min(box_dist(p, b) for p in arm[2:] + fore + head for b in BOXES) < 0.012:
                ok = False
                break
        if not ok:
            continue
        hc = H_s @ SC.HO
        print('SEARCH ok score %.2f visible %d spread %.2f  az %d el %d yh %s fold %d tw %d  head %s  path min eye dist %.3f' % (
            score, vis, spread, az, el, yh, sgn * fold, tw, tuple(round(c, 3) for c in hc), worst))
        shown += 1
        if shown >= 12:
            break


main()
