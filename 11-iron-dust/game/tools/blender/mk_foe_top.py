# mk_foe_top.py -- upper-body parts of the enemy frames (torso, head, arms, pauldrons, backpack).
# Companion of mk_foe.py (toolkit, pelvis, legs). Same authoring space: +Z up, +Y front, +X = mech's right.
from math import radians as rad, sin, cos, pi, atan2, sqrt
from mathutils import Vector
from mk_geo import S, xf, I4
from mk_foe import (sfx, loft, skin_plate, arc_plate, sweep, cable, spike, shell_dome, band, lens, vent, ring_bolts, st_at, _sp,
                    inset, grid_plate, panel, shell, dome_f, lamp, groove_fill, seam, gtube)


# =============================================================================================
# TORSO
# =============================================================================================
def build_torso(R, P):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    zb, zt, shz = P['zb'], P['zt'], P['shz']
    R.joint('waist', 'pelvis', (0, 0, P['wz']))
    t = R.pen('waist')
    kind = P['chest']
    if kind == 'keel':
        # light EX frame: the waist drive stays partly exposed
        t.cyl('F', 1.15, 0.3, (0, 0, 0.12), n=14)
        t.cyl('B', 1.27, 0.1, (0, 0, 0.2), n=14)
        t.tube('F', [S(0.3, 0.72, 0.62, 0.2), S(zb + 0.2, 0.86, 0.72, 0.2)])
        for ix in (-1, 1):
            for iy in (-1, 1):
                t.piston((ix * 0.86, iy * 0.5, 0.42), (ix * 1.1, iy * 0.66, zb + 0.05), r=0.085)
        torso_ex(R, P, t)
    else:
        t.cyl('F', 0.9, 0.6, (0, 0, 0.3), n=10)
        (torso_cowl if kind == 'cowl' else torso_ef)(R, P, t)
    for ix in (-1, 1):
        t.cyl('F', 0.7, 1.1, (ix * (P['shx'] - 0.7), 0, shz), axis='X', n=12)
        t.cyl('B', 0.86, 0.2, (ix * (P['shx'] - 0.94), 0, shz), axis='X', n=12)
        t.box('T', (0.06, 1.2, 0.1), (ix * (P['shx'] - 0.83), 0, shz), bv=0)
    R.joint('head', 'waist', P.get('head_pos', (0, P.get('head_y', 0.25), zt + P.get('head_z', 0.3))))
    build_head(R, P)


def hard_points(R, P, sdx, my, z0, mz):
    """Back weapon pedestals + mount_back_L/R."""
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        m.tube('F', [S(z0, 0.42, 0.5, 0.12, sdx, my), S(mz - 0.14, 0.34, 0.4, 0.1, sdx, my)])
        m.cyl('F', 0.42, 0.14, (sdx, my, mz - 0.07), n=10)
        for i in range(4):
            a = pi / 4 + i * pi / 2
            m.bolt('B', (sdx + 0.3 * cos(a), my + 0.3 * sin(a), mz), (0, 0, 1), r=0.05, h=0.03)
        R.joint('mount_back_' + sfx(s), 'waist', (sdx, my, mz), mirror=s < 0)


def verniers(R, x, y, z, r=0.2):
    """Front braking nozzles + their housings."""
    for s in (1, -1):
        R.pen('waist', s < 0).box('B', (r * 3.0, 0.5, 0.4), (x, y - 0.16, z + 0.14), (rad(40), 0, 0), bv=0.05)
        R.nozzle('noz_front_' + sfx(s), 'waist', (x, y + 0.02, z - 0.06), (rad(40), 0, 0), r, r * 1.7, mirror=s < 0, n=8, collar=False)


def torso_ef(R, P, t):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    zb, zt, cz, shz = P['zb'], P['zt'], P['cz'], P['shz']
    big = P['chest'] == 'bulwark'
    E = 3.0
    tabh = [(0, 0), (0.16, 0), (0.32, 0.18), (0.68, 0.18), (0.84, 0), (1, 0)]
    tabp = [(0, -0.2), (0.5, -0.2), (0.7, 0), (1, 0)]
    tabq = [(0, 0), (0.3, 0), (0.5, -0.2), (1, -0.2)]
    # ---- armoured abdomen: plated block from the hip collar (on the pelvis) up into the chest
    wr = P['waist_r']
    ab = [(0.04, wr[0], wr[1], wr[2]), (zb * 0.5, wr[0] + 0.14, wr[1] + 0.16, wr[2] + 0.1), (zb + 0.3, wr[0] + 0.12, wr[1] + 0.12, wr[2] + 0.14)]
    loft(t, 'T', inset(ab, 0.09, 2.9), n=16, e=2.9)
    shell(t, ab, [0.08, zb * 0.52, zb + 0.28], [(64, 116, ('B', 'B'), tabh), (13, 59, ('A', 'A'), tabp), (121, 167, ('A', 'A'), tabq),
                                                (-52, 8, ('A', 'A'), None), (172, 232, ('A', 'A'), None), (237, 303, ('B', 'B'), None)], 2.9)
    for i in range(3):
        t.box('T', (0.5, 0.08, 0.07), (0, wr[1] + 0.13, zb * 0.52 + 0.3 + i * 0.16), bv=0)
    # ---- barrel cuirass: cut plates over a dark inner shell
    cs = [(zb, 0.33 * tw, 0.38 * td, 0.38 * td), (zb + 0.3 * thh, 0.47 * tw, 0.6 * td, 0.47 * td), (zb + 0.62 * thh, 0.5 * tw, 0.57 * td, 0.5 * td),
          (zt - 0.1, 0.46 * tw, 0.46 * td, 0.47 * td), (zt + 0.14, 0.34 * tw, 0.32 * td, 0.36 * td)]
    loft(t, 'T', inset(cs, 0.09, E), n=20, e=E)
    up = 'B' if big else 'A'
    shell(t, cs, [zb + 0.03, zb + 0.23 * thh, zb + 0.72 * thh, zt + 0.12],
          [(74, 106, ('B', 'B', 'C'), tabh), (27, 70, ('A', 'A', up), tabp), (110, 153, ('A', 'A', up), tabq),
           (-31, 22, ('A', 'A', 'A'), None), (158, 211, ('A', 'A', 'A'), None), (216, 324, ('B', 'B', 'B'), None)], E)
    loft(t, 'A', [(zt + 0.04, 0.38 * tw, 0.36 * td, 0.4 * td), (zt + 0.2, 0.31 * tw, 0.29 * td, 0.32 * td)], n=20, e=E, bv=0.04)

    def fy(z, x=0.0):
        return st_at(cs, z, 5, E) + st_at(cs, z, 2, E) * (1.0 - min(0.995, abs(x) / st_at(cs, z, 1, E)) ** E) ** (1.0 / E)
    zh = zb + 0.6 * thh
    t.box('T', (0.2 * tw, 0.1, 0.16), (0, fy(zh) + 0.01, zh), bv=0)
    t.handhold('F', (0, fy(zb + 0.36 * thh), zb + 0.36 * thh), (0, 0, 0), w=0.6, h=0.14)
    for ix in (-1, 1):
        zi, xi = zb + 0.47 * thh, 0.32 * tw
        t.louvre('B', (ix * xi, fy(zi, xi), zi), (rad(-4), 0, -ix * 0.4), 0.13 * tw, 0.34 * thh, n=5, d=0.12, frame='F')
        zl, xl = zb + 0.85 * thh, 0.3 * tw
        lamp(t, (ix * xl, fy(zl, xl), zl), (ix * 0.42, 1, 0.3), (0, 0, 1), 0.4, 0.12)
    # ---- gorget: collar ring with a notched front plate protects the neck
    cr, hy_ = P.get('collar_r', 1.25), P.get('head_y', 0.25)
    col = [(zt + 0.04, cr + 0.22, cr + 0.22, cr + 0.22, 0, hy_), (zt + 0.5, cr + 0.04, cr + 0.04, cr + 0.04, 0, hy_)]
    loft(t, 'B', col + [(zt + 0.58, cr - 0.1, cr - 0.1, cr - 0.1, 0, hy_)], n=16, e=2.2, bv=0.03)
    panel(t, 'A', col, 20, 160, zt + 0.1, zt + 0.5, e=2.2, lift=0.06, th=0.12, bot=[(0, 0), (0.36, 0), (0.44, -0.18), (0.56, -0.18), (0.64, 0), (1, 0)])
    panel(t, 'A', col, 200, 340, zt + 0.1, zt + 0.5, e=2.2, lift=0.06, th=0.12)
    t.box('B', (0.5 * tw, 0.3, 0.5 * thh), (0, -0.5 * td + 0.05, cz), bv=0.05)
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        # power cable: lower chest -> backpack
        cable(m, 'F', [(0.34 * tw, 0.4 * td, zb + 0.2 * thh), (0.5 * tw + 0.22, 0.12 * td, zb + 0.04 * thh), (0.5 * tw + 0.16, -0.28 * td, zb + 0.12 * thh),
                       (0.3 * tw, -0.5 * td - 0.1, zb + 0.34 * thh)], 0.17, n=8, sock='B')
        # shoulder yoke
        loft(m, 'B', [(0.34 * tw, 0.3 * td, 0.66, 0.66, 0, shz), (0.5 * tw + 0.16, 0.27 * td, 0.84, 0.74, 0, shz), (0.5 * tw + 0.42, 0.22 * td, 0.7, 0.62, 0, shz)],
             axis='X', n=12, e=3.0, bv=0.05)
        m.box('T', (0.5, 0.08, 0.07), (0.5 * tw + 0.2, 0.27 * td + 0.0, shz), bv=0)
    if big:
        for ix in (-0.26, 0.26):
            t.bolt('F', (ix * tw, fy(zt - 0.4, ix * tw) + 0.02, zt - 0.4), (0, 1, 0.3), r=0.1)
        q = t.at((0, hy_ - cr - 0.1, zt + 0.9), (0, 0, pi))
        arc_plate(q, 'A', [(0.0, -1.5, 1.5, 0.0), (-0.25, -1.75, 1.75, 0.02), (-1.0, -2.0, 2.0, 0.12)], 2.0, 0.8, th=0.26, m=6)
        arc_plate(q, 'B', [(-0.3, -1.1, 1.1, 0.1), (-0.8, -1.25, 1.25, 0.16)], 2.0, 0.8, th=0.12, m=4)
    verniers(R, 0.2 * tw, fy(zb + 0.1 * thh, 0.2 * tw), zb + 0.1 * thh)
    hard_points(R, P, tw / 2 - 0.35, -0.12 * td, shz + 0.4, zt + 0.5)


def torso_ex(R, P, t):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    zb, zt, cz, shz = P['zb'], P['zt'], P['cz'], P['shz']
    yF = td / 2
    # abdomen: stacked blades
    t.tube('B', [S(0.42, 1.0, 0.95, 0.3), S(0.82, 1.14, 1.05, 0.34), S(0.92, 1.02, 0.95, 0.3)])
    t.prism('A', [(0.6, zb), (1.2, zb - 0.1), (1.36, zb - 0.55), (1.0, 0.9), (0.6, 0.9)], 1.2, 'YZ', bv=0.05, far=0.5, near=0.5, c=(0.6, 1.0))
    t.box('B', (1.3, 0.4, zb - 0.6), (0, -0.82, (zb + 0.95) / 2), bv=0.05, tx=1.1)
    # core
    gtube(t, 'B', [S(zb, 0.32 * tw, 0.38 * td, 0.3), S(zb + 0.36 * thh, 0.46 * tw, 0.46 * td, 0.34), S(zt - 0.25, 0.46 * tw, 0.44 * td, 0.34),
                 S(zt, 0.38 * tw, 0.36 * td, 0.26)], grooves=[zb + 0.56 * thh])
    prow = P.get('prow', 1.0)
    cwid = 0.22 * tw
    cpts = [(yF - 0.3, zt + 0.14), (yF + 0.5 * prow, zt - 0.3), (yF + prow, cz + 0.12), (yF + prow - 0.2, zb + 0.5), (yF + 0.1, zb + 0.02), (yF - 0.3, zb + 0.02)]
    t.prism('A', cpts, cwid, 'YZ', bv=0.06, far=0.6, near=0.6)
    ang = atan2(cpts[1][1] - cpts[0][1], cpts[1][0] - cpts[0][0])
    my, mz_ = (cpts[0][0] + cpts[1][0]) / 2, (cpts[0][1] + cpts[1][1]) / 2
    t.box('C', (cwid * 0.5, 0.62, 0.08), (0, my + 0.02, mz_ + 0.04), (ang, 0, 0), bv=0.02)
    ny, nz = (cpts[2][0] + cpts[3][0]) / 2, (cpts[2][1] + cpts[3][1]) / 2
    t.box('T', (cwid * 0.36, 0.1, 0.4), (0, ny - 0.03, nz + 0.2), bv=0)
    t.box('G', (cwid * 0.2, 0.05, 0.12), (0, ny + 0.01, nz + 0.2), bv=0)
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        for i in range(2):
            m.prism('B', [(yF * 0.9, 0), (-yF * 0.45, 0.3), (-yF * 0.45, 0.0), (yF * 0.7, -0.3)], 0.2, 'YZ',
                    (0.3 * tw - i * 0.26, 0.0, zb - 0.02 - i * 0.44), (0, rad(-14), 0), bv=0.04)
        # swept pectoral plate
        ppts = [(yF - 0.35, zt + 0.06), (yF + 0.34, zt - 0.36), (yF + 0.56, cz + 0.05), (yF + 0.4, zb + 0.55), (yF - 0.1, zb + 0.2), (yF - 0.45, zb + 0.2)]
        x0, x1 = cwid / 2 + 0.06, 0.5 * tw + 0.1
        far, shf = 0.5, -0.55
        cc = (yF - 0.3, cz)
        m.prism('A', ppts, x1 - x0, 'YZ', ((x0 + x1) / 2, 0, 0), bv=0.06, far=far, near=1.0, shift=(shf, 0.0), c=cc)

        def outer(pt, k=1.0):
            return ((x0 + (x1 - x0) * k), pt[0] + ((cc[0] + (pt[0] - cc[0]) * far + shf) - pt[0]) * k, pt[1] + ((cc[1] + (pt[1] - cc[1]) * far) - pt[1]) * k)
        # trim piping along the upper edge, intake slots on the lower facet
        for i in range(3):
            k = 0.22 + i * 0.2
            b0, b1 = outer(ppts[2], k), outer(ppts[3], k)
            m.line('T', (b0[0], b0[1] - 0.0, b0[2] - 0.08), (b1[0], b1[1], b1[2] + 0.08), (0.45, 0.9, -0.1), w=0.12)
        m.bolts('F', [(x0 + 0.2, yF - 0.05, zt - 0.08), (x1 - 0.6, yF - 0.5, zt - 0.06)], (0, 0.52, 0.85), r=0.07)
        # collar fin + shoulder deck
        m.prism('B', [(-0.34 * td, zt - 0.1), (0.3 * td, zt - 0.1), (0.2 * td, zt + 0.4), (-0.42 * td, zt + 0.56)], 0.36, 'YZ', (1.42, 0, 0), bv=0.06,
                far=0.8, near=1.0, shift=(0, 0.0))
        m.box('B', (1.15, 0.74 * td, 0.34), (tw / 2 - 0.68, -0.02, zt + 0.1), bv=0.06, ty=0.9)
        m.cyl('F', 0.09, 0.3, (tw / 2 - 0.3, 0.2 * td, zt + 0.32), axis='Y', n=6)
        lamp(m, (tw / 2 - 0.6, -0.16 * td, zt + 0.27), (0, 0, 1), (0, 1, 0), 0.4, 0.12)
    t.box('B', (2.5, 0.36, 0.5), (0, -0.34 * td, zt + 0.2), bv=0.06)
    t.box('A', (0.56 * tw, 0.24, 0.5 * thh), (0, -0.47 * td, cz + 0.2), bv=0.05)
    verniers(R, 0.5 * (0.11 * tw + 0.5 * tw) - 0.1, yF + 0.1 + shf * 0.5, zb + 0.33)
    hard_points(R, P, tw / 2 - 0.35, -0.12 * td, zt + 0.17, zt + 0.75)


def torso_cowl(R, P, t):
    """Domed cowl that merges head and torso; the sensor runs in a slit across the brow."""
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    zb, zt, cz, shz = P['zb'], P['zt'], P['cz'], P['shz']
    E = 2.3
    ze0 = zb + 0.6 * thh
    ze1 = ze0 + 0.56
    zm = (ze0 + ze1) / 2
    tabh = [(0, 0), (0.16, 0), (0.32, 0.2), (0.68, 0.2), (0.84, 0), (1, 0)]
    tabp = [(0, -0.22), (0.5, -0.22), (0.7, 0), (1, 0)]
    tabq = [(0, 0), (0.3, 0), (0.5, -0.22), (1, -0.22)]
    # armoured waist block (sits inside the hip collar)
    ab = [(0.06, 1.5, 1.45, 1.4), (zb + 0.14, 0.3 * tw, 0.32 * td, 0.3 * td)]
    loft(t, 'T', inset(ab, 0.09, 2.6), n=16, e=2.6)
    shell(t, ab, [0.1, zb + 0.12], [(62, 118, ('B',), None), (8, 57, ('A',), None), (123, 172, ('A',), None), (-60, 3, ('A',), None),
                                    (177, 240, ('A',), None), (245, 295, ('B',), None)], 2.6)
    cs = [(zb - 0.05, 0.3 * tw, 0.32 * td, 0.3 * td), (zb + 0.14 * thh, 0.43 * tw, 0.47 * td, 0.44 * td), (zb + 0.38 * thh, 0.5 * tw, 0.54 * td, 0.5 * td),
          (ze0, 0.5 * tw, 0.53 * td, 0.5 * td), (ze1, 0.48 * tw, 0.5 * td, 0.48 * td), (zb + 0.86 * thh, 0.38 * tw, 0.39 * td, 0.4 * td),
          (zb + 0.97 * thh, 0.23 * tw, 0.24 * td, 0.26 * td), (zt + 0.06, 0.07 * tw, 0.07 * td, 0.09 * td)]
    loft(t, 'T', inset(cs, 0.09, E), n=22, e=E)
    # lower body, rear band behind the slit, cap: the gap left at the front is the sensor slit
    shell(t, cs, [zb - 0.02, zb + 0.44 * thh, ze0 - 0.02],
          [(70, 110, ('B', 'A'), tabh), (24, 66, ('A', 'A'), tabp), (114, 156, ('A', 'A'), tabq), (-34, 19, ('A', 'A'), None),
           (161, 214, ('A', 'A'), None), (219, 321, ('B', 'B'), None)], E)
    shell(t, cs, [ze0 + 0.08, ze1 - 0.08], [(-34, 19, ('B',), None), (161, 214, ('B',), None), (219, 321, ('B',), None)], E)
    shell(t, cs, [ze1 + 0.02, zb + 0.87 * thh, zt + 0.02],
          [(70, 110, ('A', 'B'), tabh), (24, 66, ('A', 'A'), tabp), (114, 156, ('A', 'A'), tabq), (-34, 19, ('A', 'A'), None),
           (161, 214, ('A', 'A'), None), (219, 321, ('A', 'B'), None)], E)

    def fy(z, x=0.0):
        return st_at(cs, z, 5, E) + st_at(cs, z, 2, E) * (1.0 - min(0.995, abs(x) / st_at(cs, z, 1, E)) ** E) ** (1.0 / E)
    sx = 0.37 * tw
    skin_plate(t, 'B', cs, [(ze1 + 0.3, -sx - 0.1, sx + 0.1), (ze1 + 0.06, -sx - 0.3, sx + 0.3), (ze1 - 0.04, -sx - 0.3, sx + 0.3)], lift=0.13, e=E, th=0.24, m=12)
    skin_plate(t, 'B', cs, [(ze0 + 0.04, -sx - 0.3, sx + 0.3), (ze0 - 0.06, -sx - 0.3, sx + 0.3), (ze0 - 0.26, -sx - 0.1, sx + 0.1)], lift=0.13, e=E, th=0.24, m=12)
    hf, hw_ = st_at(cs, zm, 2, E), st_at(cs, zm, 1, E)
    xq = 0.5 * hw_
    dq = hf - fy(zm, xq)
    rc = (xq * xq + dq * dq) / (2 * dq)
    P['head_pos'] = (0, hf - rc, zm)
    P['eye_r'] = rc
    # belly: hand-hold, intakes, launch ports, lamps
    t.handhold('F', (0, fy(zb + 0.3 * thh), zb + 0.3 * thh), (0, 0, 0), w=0.5, h=0.14)
    for ix in (-1, 1):
        zi, xi = zb + 0.29 * thh, 0.27 * tw
        t.louvre('B', (ix * xi, fy(zi, xi) + 0.02, zi), (rad(8), 0, -ix * 0.5), 0.14 * tw, 0.2 * thh, n=4, d=0.12, frame='F')
        zl, xl = ze1 + 0.62, 0.27 * tw
        lamp(t, (ix * xl, fy(zl, xl), zl), (ix * 0.45, 1, 0.55), (0, 0, 1), 0.4, 0.12)
    for i in range(3):
        xi, zi = -0.2 * tw - i * 0.11 * tw, ze0 - 0.5 - i * 0.06
        a_ = atan2(xi, fy(zi, xi))
        t.cyl('F', 0.22, 0.16, (xi, fy(zi, xi), zi), axis='Y', rot=(0, 0, -a_ * 1.5), n=10)
        t.cyl('T', 0.16, 0.18, (xi, fy(zi, xi), zi), axis='Y', rot=(0, 0, -a_ * 1.5), n=10)
    lens(t, (0.26 * tw, fy(ze0 - 0.52, 0.26 * tw) - 0.02, ze0 - 0.52), 0.15, axis='Y', rot=(0, 0, -0.6))
    # shoulder sockets
    for s in (1, -1):
        m = R.pen('waist', s < 0)
        loft(m, 'B', [(0.36 * tw, 1.05, 1.05, 1.05, 0, shz), (P['shx'] - 0.85, 1.1, 1.1, 1.1, 0, shz), (P['shx'] - 0.6, 0.9, 0.9, 0.9, 0, shz)], axis='X', n=14, e=2.2, bv=0.05)
        cable(m, 'F', [(0.22 * tw, 0.4 * td, zb + 0.1 * thh), (0.42 * tw, 0.22 * td, zb + 0.02 * thh), (0.43 * tw, -0.2 * td, zb + 0.03 * thh),
                       (0.22 * tw, -0.44 * td, zb + 0.14 * thh)], 0.16, n=8, sock='B')
    # crown: dorsal ridge, periscope
    t.prism('B', [(0.26 * td, zt - 0.22), (0.1 * td, zt + 0.3), (-0.3 * td, zt + 0.22), (-0.44 * td, zt - 0.5), (-0.3 * td, zt - 0.6)], 0.3, 'YZ', bv=0.06)
    t.box('F', (0.3, 0.4, 0.5), (0.6, 0.0, zt + 0.02), bv=0.04)
    t.cyl('T', 0.11, 0.06, (0.6, 0.21, zt + 0.12), axis='Y', n=8)
    t.rod('F', (-0.7, -0.6, zt - 0.3), (-0.85, -1.0, zt + 1.5), 0.04, n=4, r2=0.015)
    verniers(R, 0.16 * tw, fy(zb + 0.04 * thh, 0.16 * tw) - 0.05, zb + 0.04 * thh, r=0.22)
    hard_points(R, P, 0.26 * tw, -0.2 * td, zb + 0.84 * thh, zt + 0.25)


# =============================================================================================
# HEADS
# =============================================================================================
def build_head(R, P):
    hs = P.get('head_s', 1.15)
    h = R.pen('head').at(scale=hs)
    kind = P['head']
    if kind == 'sallet':
        # rounded helm with a wrap-round slit; low comb ridge
        h.cyl('F', 0.6, 0.4, (0, 0, 0.05), n=10)
        loft(h, 'B', [(0.12, 0.8, 0.96, 0.8), (0.42, 0.92, 1.1, 0.9), (0.6, 0.9, 1.06, 0.9)], n=16, e=2.8, bv=0.04)
        bd = [(0.55, 0.8, 0.94, 0.82), (0.98, 0.8, 0.94, 0.82)]
        loft(h, 'T', bd, n=16, e=2.4)
        sk = [(0.92, 0.98, 1.14, 0.96), (1.08, 1.0, 1.14, 0.98), (1.48, 0.88, 0.96, 0.9), (1.76, 0.6, 0.62, 0.66), (1.9, 0.26, 0.26, 0.3)]
        loft(h, 'A', sk, n=16, e=2.3, bv=0.05)
        skin_plate(h, 'A', bd, [(1.0, -0.74, 0.74), (0.5, -0.74, 0.74)], lift=0.16, th=0.24, side='B', e=2.4)
        for sd in ('X', 'N'):
            skin_plate(h, 'A', bd, [(1.0, -0.76, 0.42), (0.74, -0.76, 0.34), (0.5, -0.76, 0.1)], lift=0.16, th=0.24, side=sd, e=2.4, m=3)
        lens(h, (0.0, 0.93, 0.77), 0.16, axis='Y')
        h.prism('B', [(1.02, 1.22), (0.6, 1.9), (-0.45, 2.04), (-1.05, 1.56), (-0.98, 1.2)], 0.16, 'YZ', bv=0.04)
        for ix in (-1, 1):
            h.cyl('B', 0.3, 0.2, (ix * 1.0, -0.1, 0.78), axis='X', n=10)
            h.bolt('F', (ix * 1.1, -0.1, 0.78), (ix, 0, 0), r=0.12, h=0.05)
        h.box('B', (0.3, 0.5, 0.32), (0.62, 0.72, 1.42), (rad(-18), 0, 0), bv=0.04)
        h.box('T', (0.2, 0.05, 0.18), (0.62, 0.99, 1.36), (rad(-18), 0, 0), bv=0)
        h.box('F', (0.18, 0.22, 0.3), (-0.72, -0.62, 1.34), bv=0.03)
        h.rod('F', (-0.72, -0.62, 1.4), (-0.8, -0.9, 2.9), 0.035, n=4, r2=0.014)
        eye = (0.0, 1.02, 0.77)
    elif kind == 'pot':
        # low, wide pot helm sunk into the collar
        h.cyl('F', 1.0, 0.3, (0, 0, 0.05), n=12)
        loft(h, 'B', [(0.1, 1.16, 1.26, 1.12), (0.46, 1.3, 1.42, 1.22), (0.58, 1.26, 1.36, 1.2)], n=16, e=3.2, bv=0.04)
        bd = [(0.52, 1.12, 1.24, 1.1), (0.94, 1.12, 1.24, 1.1)]
        loft(h, 'T', bd, n=16, e=3.0)
        top = [(0.88, 1.32, 1.46, 1.26), (1.04, 1.32, 1.44, 1.26), (1.32, 1.1, 1.16, 1.08), (1.44, 0.7, 0.72, 0.72)]
        loft(h, 'A', top, n=16, e=3.2, bv=0.06)
        skin_plate(h, 'A', bd, [(0.96, -1.06, 1.06), (0.5, -1.06, 1.06)], lift=0.18, th=0.26, side='B', e=3.0)
        for sd in ('X', 'N'):
            skin_plate(h, 'A', bd, [(0.96, -1.06, 0.6), (0.74, -1.06, 0.5), (0.5, -1.06, 0.3)], lift=0.18, th=0.26, side=sd, e=3.0, m=3)
        # heavy brow
        h.prism('B', [(1.0, 1.1), (1.62, 0.98), (1.66, 0.86), (1.0, 0.9)], 2.3, 'YZ', bv=0.04, far=0.8, near=0.8)
        lens(h, (-0.36, 1.2, 0.73), 0.2, axis='Y')
        for i in range(4):
            h.rod('F', (0.22 + i * 0.2, 1.3, 0.54), (0.22 + i * 0.2, 1.3, 0.92), 0.035, n=4)
        h.cyl('B', 0.46, 0.14, (0.3, -0.2, 1.46), n=10)
        h.handhold('F', (0.3, -0.2, 1.5), (pi / 2, 0, 0), w=0.4, h=0.1)
        h.box('B', (0.18, 1.3, 0.24), (-0.5, -0.2, 1.48), bv=0.04, ty=0.7)
        for ix in (-1, 1):
            h.cyl('B', 0.34, 0.24, (ix * 1.3, -0.2, 0.74), axis='X', n=10)
            cable(h, 'F', [(ix * 0.5, -1.1, 0.8), (ix * 0.62, -1.6, 0.5), (ix * 0.6, -1.5, -0.2)], 0.12, n=6)
        h.box('F', (0.2, 0.24, 0.3), (0.95, -0.8, 1.3), bv=0.03)
        h.rod('F', (0.95, -0.8, 1.4), (1.0, -1.0, 2.7), 0.035, n=4, r2=0.014)
        eye = (-0.36, 1.3, 0.73)
    elif kind == 'crest':
        # faceted raven helm: slit visor, single blade crest
        h.cyl('F', 0.45, 0.4, (0, -0.1, 0.05), n=8)
        h.prism('A', [(1.3, 0.66), (1.02, 1.14), (0.25, 1.48), (-0.95, 1.38), (-1.3, 0.85), (-0.9, 0.34), (0.5, 0.34)], 1.34, 'YZ', bv=0.05,
                far=0.5, near=0.5, c=(0.9, 0.78))
        h.prism('B', [(1.22, 0.52), (1.42, 0.06), (0.7, -0.1), (0.2, 0.05), (0.3, 0.42)], 0.84, 'YZ', bv=0.04, far=0.36, near=0.36, c=(1.2, 0.2))
        h.box('T', (0.84, 0.7, 0.2), (0, 0.84, 0.56), bv=0)
        lens(h, (0.0, 1.14, 0.57), 0.13, axis='Y', d=0.14)
        h.prism('C', [(1.12, 1.0), (0.8, 1.52), (-0.5, 3.5), (-0.86, 3.44), (-0.2, 1.44)], 0.1, 'YZ', bv=0.02)
        h.prism('B', [(0.86, 1.36), (0.2, 1.62), (-0.7, 1.6), (-0.2, 1.36)], 0.24, 'YZ', bv=0.03)
        for ix in (-1, 1):
            h.prism('B', [(0.5, 0.92), (-1.95, 1.52), (-1.5, 1.0), (-0.6, 0.45)], 0.09, 'YZ', (ix * 0.64, 0, 0), (0, 0, ix * rad(-10)), bv=0.02)
            h.box('T', (0.1, 0.5, 0.2), (ix * 0.5, 0.15, 0.56), (0, 0, ix * 0.2), bv=0)
            h.prism('A', [(1.0, 0.5), (0.4, 0.44), (0.3, 0.06), (0.9, -0.02)], 0.1, 'YZ', (ix * 0.36, 0, 0), (0, 0, ix * rad(-14)), bv=0.02)
        h.rod('F', (0.45, -1.0, 1.1), (0.5, -1.5, 2.5), 0.03, n=4, r2=0.012)
        eye = (0.0, 1.26, 0.57)
    else:  # cowl: only the sensor carriage turns; it rides the slit of the torso cowl
        rc = P['eye_r'] / hs
        h.box('T', (0.5, 0.5, 0.36), (0, rc - 0.34, 0), bv=0.04)
        lens(h, (0.0, rc + 0.0, 0.0), 0.2, axis='Y', d=0.16)
        eye = (0.0, rc + 0.12, 0.0)
    R.joint('eye', 'head', tuple(c * hs for c in eye))


# =============================================================================================
# ARMS + PAULDRONS
# =============================================================================================
def build_arm(R, P, s):
    X = sfx(s)
    mir = s < 0
    aw = P['arm_w'] * 1.1
    UA, FA = P['UA'], P['FA']
    sh, el, pa = 'sh_' + X, 'el_' + X, 'pauldron_' + X
    R.joint(pa, 'waist', (P['shx'], 0, P['shz']), mirror=mir)
    R.joint(sh, 'waist', (P['shx'], 0, P['shz']), mirror=mir)
    R.joint(el, sh, (0, 0, -UA))
    kind = P['arm']
    fs = P.get('fore_s', 1.0)
    a, e = R.pen(sh, mir), R.pen(el, mir)
    # ---- upper arm
    a.ball('F', 0.62 * aw, n=10, m=6)
    a.cyl('F', 0.5 * aw, 0.7, (-0.4, 0, 0), axis='X', n=10)
    a.tube('F', [S(-0.3, 0.4 * aw, 0.42 * aw, 0.13 * aw), S(-UA + 0.2, 0.36 * aw, 0.4 * aw, 0.12 * aw)])
    a.piston((0, -0.78 * aw - 0.1, -0.75), (0, -0.62 * aw, -UA + 0.15), r=0.08 * aw)
    if kind == 'angular':
        gtube(a, 'B', [S(-0.45, 0.5 * aw, 0.55 * aw, 0.16 * aw), S(-0.85, 0.66 * aw, 0.72 * aw, 0.2 * aw), S(-UA + 0.8, 0.62 * aw, 0.68 * aw, 0.2 * aw),
                     S(-UA + 0.5, 0.5 * aw, 0.55 * aw, 0.16 * aw)], grooves=[-UA * 0.52], bv=0.03)
        a.prism('A', [(-0.42 * aw, -0.7), (0.42 * aw, -0.7), (0.3 * aw, -UA + 0.9), (0.0, -UA + 0.5), (-0.3 * aw, -UA + 0.9)], 0.16, 'YZ', (0.66 * aw + 0.05, 0, 0), bv=0.04)
    elif kind == 'gauntlet':
        # segmented sleeve
        for i in range(4):
            z = -0.55 - i * (UA - 1.0) / 4
            loft(a, 'B' if i % 2 == 0 else 'A', [(z, 0.6 * aw, 0.64 * aw), (z - 0.12, 0.72 * aw, 0.78 * aw), (z - (UA - 1.0) / 4 + 0.1, 0.7 * aw, 0.76 * aw),
                                                 (z - (UA - 1.0) / 4 + 0.02, 0.6 * aw, 0.64 * aw)], n=12, e=2.2)
    else:
        us = [(-0.5, 0.5 * aw, 0.55 * aw), (-0.95, 0.7 * aw, 0.76 * aw), (-UA + 0.95, 0.68 * aw, 0.74 * aw), (-UA + 0.55, 0.52 * aw, 0.56 * aw)]
        loft(a, 'A', us, n=12, e=2.6, bv=0.04, grooves=[-UA * 0.52], gd=0.06, gw=0.1)
        groove_fill(a, us, -UA * 0.52, e=2.6, n=12, w=0.14)
        skin_plate(a, 'B', us, [(-1.05, -0.3 * aw, 0.3 * aw), (-UA * 0.52 + 0.08, -0.34 * aw, 0.34 * aw)], side='X', lift=0.05, e=2.6, th=0.14, m=2)
    # ---- elbow
    e.cyl('F', 0.5 * aw, 1.4 * aw, axis='X', n=10)
    for ix in (-1, 1):
        e.cyl('B', 0.4 * aw, 0.12, (ix * (0.7 * aw + 0.04), 0, 0), axis='X', n=10)
        e.box('T', (0.06, 0.66 * aw, 0.09), (ix * (0.7 * aw + 0.1), 0, 0), bv=0)
    # ---- forearm
    if kind == 'angular':
        e.prism('A', [(-0.45 * aw, 0.6), (-0.95 * aw, 0.3), (-1.3 * aw, -0.9), (-0.9 * aw, -1.3), (-0.62 * aw, -0.62)], 0.8 * aw, 'YZ', bv=0.04, far=0.5, near=0.5,
                c=(-0.7 * aw, -0.3))
        fa_ = [S(-0.45, 0.55 * aw, 0.62 * aw, 0.18 * aw), S(-1.0, 0.76 * aw, 0.86 * aw, 0.24 * aw), S(-FA + 0.5, 0.8 * aw, 0.9 * aw, 0.24 * aw),
               S(-FA + 0.15, 0.66 * aw, 0.74 * aw, 0.2 * aw)]
        gtube(e, 'A', fa_, grooves=[-FA * 0.62], bv=0.03)
        e.prism('C', [(-0.3 * aw, -0.8), (0.3 * aw, -0.8), (0.4 * aw, -1.3), (0.0, -FA + 0.3), (-0.4 * aw, -1.3)], 0.16, 'XZ', (0, 0.9 * aw + 0.03, 0), bv=0.04)
        e.box('A', (0.96 * aw, 0.2, 0.5), (0, 0.74 * aw, -FA + 0.02), (rad(-14), 0, 0), bv=0.04, bx=0.8)
        e.hatch((-0.8 * aw, 0, -FA * 0.55), (-1, 0, 0), (0, 0, 1), 0.9 * aw, 1.0)
        xo, yr = 0.8 * aw, -0.9 * aw
    else:
        r0 = fs
        if kind == 'gauntlet':
            fa_ = [(-0.4, 0.6 * aw, 0.64 * aw), (-0.9, 1.0 * aw * r0, 1.06 * aw * r0), (-FA + 1.2, 1.06 * aw * r0, 1.12 * aw * r0), (-FA + 0.15, 0.84 * aw * r0, 0.9 * aw * r0)]
            ee = 2.3
        else:
            fa_ = [(-0.45, 0.56 * aw, 0.62 * aw), (-1.05, 0.8 * aw * r0, 0.9 * aw * r0), (-FA + 0.75, 0.9 * aw * r0, 1.0 * aw * r0), (-FA + 0.22, 0.94 * aw * r0, 1.04 * aw * r0)]
            ee = 2.8
        loft(e, 'A', fa_, n=14, e=ee, bv=0.04, grooves=[-FA * 0.38], gd=0.06, gw=0.1, lip1=(0.1, 0.5))
        groove_fill(e, fa_, -FA * 0.38, e=ee, n=14, w=0.14)
        zc1 = fa_[-1][0]
        rw, rd = fa_[-1][1], fa_[-1][2]
        loft(e, 'B', [(zc1 + 0.5, rw + 0.02, rd + 0.02), (zc1 + 0.44, rw + 0.08, rd + 0.08), (zc1 + 0.2, rw + 0.09, rd + 0.09), (zc1 + 0.14, rw + 0.03, rd + 0.03)], n=14, e=ee)
        skin_plate(e, 'B', fa_, [(-FA * 0.38 - 0.1, -0.36 * aw, 0.36 * aw), (-FA + 1.0, -0.44 * aw, 0.44 * aw), (-FA + 0.8, -0.3 * aw, 0.3 * aw)], lift=0.05, e=ee, th=0.16, m=2)
        e.dome('A', 0.52 * aw, 0.34 * aw, (0, -0.42 * aw, 0.0), axis='Y', rot=(0, 0, pi), n=10, m=2, base=0.1)
        zh_ = -FA * 0.55
        xo = st_at(fa_, zh_, 1, ee)
        yr = -st_at(fa_, -FA + 0.75, 2, ee)
        if kind == 'heavy' or kind == 'gauntlet':
            # knuckle guard studs on the cuff
            for i in (-1, 0, 1):
                spike(e, 'B', (i * 0.5 * aw, rd * 0.86, zc1 + 0.3), (i * 0.3, 0.75, -0.6), 0.13 * aw, 0.5 * aw, n=6, collar='B')
    # hard-points (shield on the outside, blade on the back)
    zh_ = -FA * 0.55
    e.box('B', (0.16, 0.9 * aw, 1.3), (xo + 0.03, 0, zh_), bv=0.04)
    for yy in (-0.3 * aw, 0.3 * aw):
        for zz in (zh_ - 0.45, zh_ + 0.45):
            e.bolt('F', (xo + 0.11, yy, zz), (1, 0, 0), r=0.06)
    lamp(e, (xo - 0.05, 0, zh_ + 0.86), (1, 0, 0), (0, 0, 1), 0.34 * aw, 0.1)
    e.box('B', (0.72 * aw, 0.16, 1.0), (0, yr - 0.03, -FA + 0.75), bv=0.04)
    e.box('F', (0.3 * aw, 0.1, 0.5), (0, yr - 0.12, -FA + 0.75), bv=0.02)
    # wrist + fist
    e.cyl('F', 0.42 * aw, 0.36, (0, 0, -FA - 0.02), n=10)
    hz = -FA - 0.62
    e.box('F', (0.86 * aw, 0.92 * aw, 0.8), (0, 0, hz), bv=0.07)
    e.box('B', (0.16, 0.84 * aw, 0.62), (0.47 * aw, 0, hz + 0.06), bv=0.04)
    for i in range(3):
        yy = (-0.24 + i * 0.24) * aw
        e.line('T', (-0.4 * aw, yy, hz - 0.4), (0.3 * aw, yy, hz - 0.4), (0, 0, -1), w=0.04)
        e.line('T', (-0.43 * aw, yy, hz - 0.36), (-0.43 * aw, yy, hz + 0.2), (-1, 0, 0), w=0.04)
    e.box('F', (0.5 * aw, 0.24, 0.3), (-0.12 * aw, 0.5 * aw, hz + 0.16), bv=0.04)
    R.joint('mount_hand_' + X, el, (0, 0, hz), (rad(-90), 0, 0))
    R.joint('mount_arm_' + X, el, (xo + 0.12, 0, zh_), mirror=mir)
    R.joint('mount_blade_' + X, el, (0, yr - 0.17, -FA + 0.75))
    build_pauldron(R, P, X, mir, pa)


def build_pauldron(R, P, X, mir, pa):
    sw = P['sh_w']
    kind = P['sh_' + X]
    p = R.pen(pa, mir)
    if kind in ('spike', 'spike2', 'ball'):
        big, ball = kind == 'spike2', kind == 'ball'
        r = (0.64 if big else (0.54 if ball else 0.6)) * sw
        hh = (0.6 if big else 0.56) * sw
        base = (0.34 if big else 0.28) * sw
        cx = 0.5
        shell_dome(p, 'T', r - 0.09, hh - 0.09, th=0.1, base=base, pos=(cx, 0, 0.0), n=16, m=4, flare=0.1)
        df = dome_f(r, hh, base, 0.1, (cx, 0, 0.0))
        tabd = [(0, 0), (0.2, 0), (0.36, 7.0), (0.64, 7.0), (0.8, 0), (1, 0)]
        for a0, m0 in ((-42, 'A'), (48, 'A'), (138, 'A'), (228, 'B')):
            grid_plate(p, m0, df, a0, a0 + 84, -1.0, 34.0, bot=tabd, da=21, dt=12.0, tks=(0.0,))
            grid_plate(p, 'A', df, a0, a0 + 84, 40.0, 72.0, top=tabd, da=21, dt=11.0)
        p.dome('B', r * cos(rad(76)), hh * (1 - sin(rad(76))) + 0.03, (cx, 0, hh * sin(rad(76))), n=12, m=2)
        band(p, 'B', r + 0.08, -base + 0.08, -base + 0.3, t=0.07, pos=(cx, 0, 0), n=20)
        lamp(p, (cx, r * cos(rad(12)), hh * sin(rad(12))), (0, 1, 0.2), (0, 0, 1), 0.44, 0.12)
        sm = P.get('spike_m', 'B')
        if ball:
            spike(p, sm, (cx + 0.62 * r, 0, 0.62 * hh), (0.9, 0, 0.45), 0.17 * sw, 0.6 * sw, n=8, collar='B')
        else:
            spike(p, sm, (cx + 0.5 * r, 0, 0.8 * hh), (0.56, 0, 0.83), (0.22 if big else 0.2) * sw, (0.86 if big else 0.76) * sw, n=8, collar='B')
            for a_ in (-1, 1):
                spike(p, sm, (cx + 0.36 * r, a_ * 0.66 * r, 0.56 * hh), (0.36, a_ * 0.66, 0.66), 0.1 * sw, 0.3 * sw, n=6, collar='B')
            if big:
                spike(p, sm, (cx + 0.9 * r, 0, 0.3 * hh), (0.95, 0, 0.3), 0.1 * sw, 0.3 * sw, n=6, collar='B')
                # hanging outer plate
                q = p.at((cx + r + 0.12, 0, -base + 0.25), (rad(10), 0, -pi / 2))
                arc_plate(q, 'A', [(0.0, -0.44 * sw, 0.44 * sw, 0.0), (-0.2, -0.5 * sw, 0.5 * sw, 0.02), (-0.5 * sw, -0.5 * sw, 0.5 * sw, 0.06),
                                   (-0.62 * sw, -0.36 * sw, 0.36 * sw, 0.06)], 0.5 * sw, 0.12 * sw, th=0.2, m=6)
                arc_plate(q, 'B', [(-0.16 * sw, -0.3 * sw, 0.3 * sw, 0.1), (-0.48 * sw, -0.3 * sw, 0.3 * sw, 0.13)], 0.5 * sw, 0.12 * sw, th=0.12, m=4, ch=0.04)
        p.box('B', (0.36, 0.42 * sw, 0.3 * sw), (cx + r - 0.02, -0.3 * sw, -0.02 * sw), bv=0.05)
        R.nozzle('noz_sh_' + X, pa, (cx + r + 0.2, -0.3 * sw, -0.03 * sw), (0, rad(-75), 0), 0.13 * sw, 0.18 * sw, mirror=mir, n=8, collar=False)
    elif kind == 'slab':
        # small cap + big flat shoulder shield on a bracket
        cx = 0.3
        shell_dome(p, 'A', 0.46 * sw, 0.4 * sw, th=0.12, base=0.14 * sw, pos=(cx, 0, 0.06 * sw), n=14, m=3)
        band(p, 'B', 0.46 * sw, -0.1 * sw, -0.02 * sw, t=0.06, pos=(cx, 0, 0.06 * sw), n=14)
        xs = cx + 0.66 * sw
        p.cyl('F', 0.22 * sw, 0.4 * sw, (xs - 0.24 * sw, 0, 0.06 * sw), axis='X', n=10)
        p.box('F', (0.3, 0.6 * sw, 0.5 * sw), (xs - 0.1, 0, 0.06 * sw), bv=0.05)
        q = p.at((xs, 0, 0.82 * sw), (rad(8), 0, -pi / 2))
        rows = [(0.0, -0.4, 0.4, 0.0), (-0.14, -0.56, 0.56, 0.02), (-1.3, -0.6, 0.6, 0.07), (-1.58, -0.52, 0.52, 0.08), (-1.72, -0.38, 0.38, 0.05)]
        arc_plate(q, 'A', [(z * sw, a * sw, b * sw, yo) for z, a, b, yo in rows], 0.6 * sw, 0.12 * sw, th=0.22, m=6)
        rows2 = [(-0.3, -0.4, 0.4, 0.09), (-0.4, -0.46, 0.46, 0.09), (-1.2, -0.48, 0.48, 0.13), (-1.36, -0.36, 0.36, 0.13)]
        arc_plate(q, 'B', [(z * sw, a * sw, b * sw, yo) for z, a, b, yo in rows2], 0.6 * sw, 0.12 * sw, th=0.12, m=4, ch=0.04)
        arc_plate(q, 'C', [(-0.06 * sw, -0.42 * sw, 0.42 * sw, 0.06), (-0.2 * sw, -0.5 * sw, 0.5 * sw, 0.07)], 0.6 * sw, 0.12 * sw, th=0.1, m=4, ch=0.03)
        for yy in (-0.44, 0.44):
            for zz in (-0.24, -1.46):
                q.bolt('F', (yy * sw, 0.12 * sw * (1 - (yy / 0.6) ** 2) + 0.08, zz * sw), (0, 1, 0), r=0.08)
        q.handhold('F', (0, 0.12 * sw + 0.18, -0.8 * sw), (0, pi / 2, 0), w=0.6, h=0.12)
        seam(q, [(-0.36 * sw, 0.12 * sw * 0.64 + 0.2, -0.5 * sw), (-0.1 * sw, 0.12 * sw + 0.19, -0.5 * sw), (0.02 * sw, 0.12 * sw + 0.19, -0.62 * sw),
                 (0.36 * sw, 0.12 * sw * 0.64 + 0.2, -0.62 * sw)], (0, 1, 0), w=0.08)
        lamp(q, (0.36 * sw, 0.12 * sw * 0.64 + 0.1, -1.5 * sw), (0, 1, 0), (0, 0, 1), 0.1, 0.32)
        p.box('B', (0.34, 0.4 * sw, 0.28 * sw), (xs - 0.26, -0.34 * sw, -0.26 * sw), bv=0.05)
        R.nozzle('noz_sh_' + X, pa, (xs - 0.06, -0.34 * sw, -0.4 * sw), (0, rad(-62), 0), 0.12 * sw, 0.17 * sw, mirror=mir, n=8, collar=False)
    else:  # fin (EX): faceted pauldron, up-swept fin, hanging blade
        cx = 0.3
        pts = [(-0.3 * sw, -0.12 * sw), (-0.3 * sw, 0.3 * sw), (0.0, 0.52 * sw), (0.48 * sw, 0.44 * sw), (0.8 * sw, 0.0), (0.72 * sw, -0.4 * sw), (0.45 * sw, -0.2 * sw)]
        p.prism('A', [(x + cx, z) for x, z in pts], 0.96 * sw, 'XZ', bv=0.06, far=0.76, near=0.76)
        p.prism('B', [(x * 0.7 + cx + 0.14 * sw, z * 0.7 + 0.1 * sw) for x, z in pts[1:5]], 1.0 * sw, 'XZ', bv=0.03, far=0.6, near=0.6)
        p.tube('B', [S(-0.3 * sw, 0.3 * sw, 0.3 * sw, 0.1 * sw, 0.5, 0.1 * sw), S(-1.05 * sw, 0.26 * sw, 0.26 * sw, 0.1 * sw, 0.55, 0.14 * sw),
                     S(-1.2 * sw, 0.2 * sw, 0.2 * sw, 0.08 * sw, 0.55, 0.14 * sw)], axis='Y')
        p.cyl('T', 0.15 * sw, 0.06, (0.55, -1.2 * sw - 0.02, 0.14 * sw), axis='Y', n=8)
        p.prism('B', [(0.2 * sw, 0.44 * sw), (-0.5 * sw, 0.78 * sw), (-1.5 * sw, 1.0 * sw), (-0.7 * sw, 0.42 * sw)], 0.12, 'YZ',
                (cx + 0.2, 0, 0), (0, rad(10), 0), bv=0.03)
        bp = [(0.44 * sw, 0.26 * sw), (-0.44 * sw, 0.26 * sw), (-0.36 * sw, -0.55 * sw), (0.04 * sw, -1.5 * sw), (0.32 * sw, -0.55 * sw)]
        p.prism('A', bp, 0.16, 'YZ', (cx + 0.8 * sw + 0.1, 0, 0), (0, rad(-7), 0), bv=0.04)
        p.prism('C', [(y * 0.55, z * 0.62 - 0.1 * sw) for y, z in bp], 0.07, 'YZ', (cx + 0.8 * sw + 0.22, 0, 0), (0, rad(-7), 0), bv=0.02)
        p.box('F', (0.3, 0.3 * sw, 0.2 * sw), (cx + 0.7 * sw, 0, 0.05 * sw), bv=0.03)
        p.box('B', (0.26, 0.3 * sw, 0.24 * sw), (cx + 0.6 * sw, 0.3 * sw, -0.22 * sw), bv=0.03)
        R.nozzle('noz_sh_' + X, pa, (cx + 0.6 * sw + 0.16, 0.3 * sw, -0.24 * sw), (0, rad(-75), 0), 0.11 * sw, 0.16 * sw, mirror=mir, n=8, collar=False)
        vent(R, pa, (cx + 0.2 * sw, 0.2 * sw, 0.47 * sw + 0.02), (0.18, 0, 1), (0, -1, 0), 0.34 * sw, 0.36 * sw, mirror=mir, d=0.09)
        lamp(p, (cx + 0.8 * sw + 0.2, 0, -0.2 * sw), (1, 0, -0.12), (0, 0, 1), 0.3, 0.1)


# =============================================================================================
# BACKPACK
# =============================================================================================
def build_back(R, P):
    tw, thh, td = P['torso_w'], P['torso_h'], P['torso_d']
    kind = P['back']
    if kind == 'hump':
        R.joint('back', 'waist', (0, -0.46 * td, P['zb'] + 0.5 * thh))
    else:
        R.joint('back', 'waist', (0, -td / 2, P['cz']))
    b = R.pen('back')
    if kind in ('pack', 'heavy'):
        hv = kind == 'heavy'
        dp = 1.7 if hv else 1.25
        loft(b, 'B', [(0.15, 0.3 * tw, 0.44 * thh, 0.4 * thh, 0, 0.1), (-dp + 0.4, 0.3 * tw, 0.46 * thh, 0.42 * thh, 0, 0.1),
                      (-dp, 0.22 * tw, 0.34 * thh, 0.3 * thh, 0, 0.12)], axis='Y', n=16, e=3.4, bv=0.06, grooves=[-dp * 0.4])
        b.box('A', (0.3 * tw, 0.14, 0.46 * thh), (0, -dp - 0.02, 0.12), bv=0.05, tx=0.8)
        b.handhold('F', (0, -dp - 0.1, 0.3), (0, 0, pi), w=0.6, h=0.12)
        b.louvre('B', (0, -dp - 0.1, -0.12 * thh), (0, 0, pi), 0.2 * tw, 0.14 * thh, n=3, d=0.08)
        seam(b, [(-0.13 * tw, -dp - 0.09, 0.12 + 0.17 * thh), (-0.04 * tw, -dp - 0.09, 0.12 + 0.17 * thh), (0.02 * tw, -dp - 0.09, 0.12 + 0.11 * thh),
                 (0.13 * tw, -dp - 0.09, 0.12 + 0.11 * thh)], (0, -1, 0))
        for ix in (-1, 1):
            lamp(b, (ix * 0.185 * tw, -dp - 0.0, 0.12 + 0.16 * thh), (0, -1, 0), (0, 0, 1), 0.1, 0.34)
        px = 0.3 * tw + (0.5 if hv else 0.3)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            # thruster nacelle
            py = -dp * 0.62
            ns = [(0.4 * thh, 0.36, 0.36, 0.36, px, py), (0.26 * thh, 0.6, 0.6, 0.62, px, py), (-0.3 * thh, 0.66, 0.66, 0.74, px, py - 0.04),
                  (-0.5 * thh, 0.56, 0.56, 0.66, px, py - 0.1)]
            loft(m, 'A', ns, n=14, e=2.4, bv=0.05)
            for zz in (0.14 * thh, -0.2 * thh):
                loft(m, 'B', [(zz + 0.07, 0.66, 0.66, 0.72, px, py - 0.02), (zz - 0.07, 0.68, 0.68, 0.74, px, py - 0.02)], n=14, e=2.4, bv=0.02)
            m.cyl('F', 0.2, 0.14, (px, py, 0.4 * thh + 0.05), n=8)
            lamp(m, (px + 0.65, py - 0.02, 0.0), (1, 0, 0), (0, 0, 1), 0.1, 0.32)
            m.prism('C', [(py - 0.6, 0.1 * thh), (py - 1.5, 0.52 * thh), (py - 1.7, 0.46 * thh), (py - 0.75, -0.3 * thh)], 0.1, 'YZ', (px + 0.5, 0, 0), (0, 0, rad(-14)), bv=0.02)
            R.nozzle('noz_back_' + X, 'back', (px, py - 0.5, -0.5 * thh - 0.42), (rad(-50), 0, 0), 0.62 if not hv else 0.6, 1.1, mirror=s < 0, n=12)
            if hv:
                R.nozzle('noz_back_2' + X, 'back', (0.13 * tw, -dp - 0.3, -0.42 * thh - 0.4), (rad(-50), 0, 0), 0.66, 1.15, mirror=s < 0, n=12)
                m.box('B', (0.9, 0.7, 0.6), (0.13 * tw, -dp + 0.05, -0.38 * thh), (rad(-40), 0, 0), bv=0.06)
                # propellant drum
                m.lathe('A', [(0.0, -0.3 * thh), (0.4, -0.3 * thh), (0.5, -0.24 * thh), (0.5, 0.5 * thh), (0.36, 0.6 * thh), (0.0, 0.62 * thh)], (0.13 * tw, -dp - 0.36, 0.1), n=12)
                for zz in (0.0, 0.36 * thh):
                    band(m, 'B', 0.5, zz, zz + 0.12, t=0.05, pos=(0.13 * tw, -dp - 0.36, 0.1), n=12)
            vent(R, 'back', (0.15 * tw, -dp * 0.45, 0.1 + 0.44 * thh - 0.02), (0, 0, 1), (0, -1, 0), 0.24 * tw, 0.5, mirror=s < 0, flap='B')
        b.box('F', (0.3, 0.3, 0.3), (-0.2 * tw, -dp + 0.2, 0.46 * thh + 0.12), bv=0.03)
        b.rod('F', (-0.2 * tw, -dp + 0.2, 0.46 * thh + 0.2), (-0.22 * tw, -dp - 0.2, 0.46 * thh + 2.3), 0.035, n=4, r2=0.014)
    elif kind == 'hump':
        loft(b, 'A', [(0.3, 0.34 * tw, 0.4 * thh, 0.3 * thh, 0, 0.2), (-0.9, 0.3 * tw, 0.36 * thh, 0.28 * thh, 0, 0.25), (-1.5, 0.18 * tw, 0.22 * thh, 0.18 * thh, 0, 0.2)],
             axis='Y', n=16, e=2.6, bv=0.06, grooves=[-0.5])
        b.prism('B', [(0.2, 0.52 * thh), (-0.6, 0.66 * thh), (-1.7, 0.4 * thh), (-1.5, 0.1 * thh), (0.2, 0.3 * thh)], 0.24, 'YZ', bv=0.05)
        b.louvre('B', (0, -1.52, 0.2), (0, 0, pi), 0.2 * tw, 0.2 * thh, n=4, d=0.08)
        groove_fill(b, [(0.3, 0.34 * tw, 0.4 * thh, 0.3 * thh, 0, 0.2), (-0.9, 0.3 * tw, 0.36 * thh, 0.28 * thh, 0, 0.25)], -0.5, e=2.6, n=16, d=0.02)
        for ix in (-1, 1):
            lamp(b, (ix * 0.13 * tw, -1.5, 0.2 + 0.15 * thh), (0, -1, 0.15), (0, 0, 1), 0.3, 0.1)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            px = 0.22 * tw
            loft(m, 'B', [(0.1 * thh, 0.5, 0.5, 0.5, px, -1.1), (-0.2 * thh, 0.64, 0.64, 0.7, px, -1.15), (-0.34 * thh, 0.56, 0.56, 0.64, px, -1.2)], n=12, e=2.4, bv=0.05)
            R.nozzle('noz_back_' + X, 'back', (px, -1.62, -0.34 * thh - 0.4), (rad(-50), 0, 0), 0.6, 1.05, mirror=s < 0, n=12)
            # snorkel stacks
            m.cyl('F', 0.2, 0.9, (0.3 * tw, -0.5, 0.4 * thh + 0.2), n=8)
            m.cyl('B', 0.25, 0.16, (0.3 * tw, -0.5, 0.4 * thh + 0.62), n=8)
            vent(R, 'back', (0.14 * tw, -0.75, 0.2 + 0.37 * thh), (0, -0.25, 1), (0, -1, 0), 0.5, 0.5, mirror=s < 0, flap='B')
    else:  # wing: twin-blade binders (EX)
        b.tube('B', [S(-1.2, 0.2 * tw, 0.3 * thh, 0.2, cv=0.1), S(-0.8, 0.26 * tw, 0.4 * thh, 0.25, cv=0.05), S(0.0, 0.27 * tw, 0.42 * thh, 0.25, cv=0.05)],
               axis='Y', grooves=[-0.4])
        b.box('A', (0.36 * tw, 0.12, 0.44 * thh), (0, -1.22, 0.12), bv=0.04, tx=0.8)
        b.prism('C', [(-1.25, 0.3 * thh), (-1.9, 0.1), (-1.25, -0.2 * thh)], 0.12, 'YZ', bv=0.02)
        for ix in (-1, 1):
            lamp(b, (ix * 0.13 * tw, -1.28, 0.12 + 0.1 * thh), (0, -1, 0), (0, 0, 1), 0.1, 0.3)
        for i in range(4):
            b.box('B', (0.07, 0.7, 0.24), (-0.3 + i * 0.2, -0.5, 0.42 * thh + 0.15), bv=0.0)
        b.box('F', (0.9, 0.8, 0.08), (0, -0.5, 0.42 * thh + 0.06), bv=0.0)
        for s in (1, -1):
            m = R.pen('back', s < 0)
            X = sfx(s)
            mir = s < 0
            m.tube('A', [S(-1.75, 0.34, 0.2 * thh, 0.12, 0.95, -0.2 * thh), S(-1.4, 0.46, 0.27 * thh, 0.16, 0.95, -0.18 * thh),
                         S(-0.6, 0.5, 0.3 * thh, 0.16, 0.95, -0.14 * thh)], axis='Y', bv=0.03)
            R.nozzle('noz_back_' + X, 'back', (0.95, -1.62, -0.44 * thh - 0.3), (rad(-50), 0, 0), 0.5, 0.9, mirror=mir, n=12)
            vent(R, 'back', (0.6, -0.95, 0.05 + 0.36 * thh + 0.02), (0, -0.2, 1), (0, -1, 0), 0.5, 0.45, mirror=mir)
            hx = 0.27 * tw + 0.8
            hy_, hzz = -0.8, 0.3 * thh
            m.cyl('F', 0.3, hx - 0.27 * tw + 0.2, ((hx + 0.27 * tw) / 2 - 0.1, hy_, hzz), axis='X', n=10)
            m.box('B', (0.4, 0.8, 0.7), (0.27 * tw + 0.1, hy_ + 0.1, hzz), bv=0.05)
            bn = 'binder_' + X
            R.joint(bn, 'back', (hx, hy_, hzz), mirror=mir)
            w = R.pen(bn, mir).at(rot=(rad(20), rad(16), 0))
            w.cyl('F', 0.36, 0.5, (0, 0, 0), axis='X', n=10)
            w.box('F', (0.44, 0.7, 0.9), (0, -0.1, 0.4), bv=0.05)
            # upper blade
            up = [(0.3, 0.3), (0.5, 2.0), (0.2, 4.2), (-0.62, 6.1), (-0.86, 4.3), (-0.7, 3.9), (-1.3, 2.3), (-1.0, 2.0), (-1.3, 0.5), (-0.5, -0.2)]
            w.prism('A', up, 0.36, 'YZ', bv=0.05, far=0.5, near=0.5, c=(-0.3, 2.2))
            w.prism('C', [(0.4, 1.3), (0.56, 2.0), (0.27, 4.1), (-0.4, 5.6), (0.02, 3.9), (0.3, 2.1)], 0.42, 'YZ', bv=0.03, far=0.55, near=0.55, c=(0.2, 3.2))
            # lower blade
            lo = [(-0.3, 0.0), (-1.3, -0.1), (-2.5, -1.6), (-3.2, -3.6), (-1.9, -2.3), (-0.9, -1.4)]
            w.prism('A', lo, 0.3, 'YZ', bv=0.05, far=0.5, near=0.5, c=(-1.6, -1.2))
            w.prism('C', [(-1.25, -0.3), (-2.4, -1.7), (-3.0, -3.3), (-2.1, -1.9)], 0.34, 'YZ', bv=0.03, far=0.5, near=0.5, c=(-2.1, -1.6))
            w.tube('B', [S(0.5, 0.26, 0.3, 0.1, cv=-0.2), S(3.2, 0.22, 0.24, 0.08, cv=-0.2)], grooves=[1.5, 2.4], gd=0.03)
            w.tube('B', [S(-0.3, 0.3, 0.4, 0.12, cv=-1.0), S(0.5, 0.36, 0.48, 0.14, cv=-1.1), S(1.4, 0.3, 0.36, 0.12, cv=-1.2)])
            M = w.M @ xf((0, -1.05, -0.35), (rad(-60), 0, 0))
            nn = 'noz_binder_' + X
            R.joint(nn, bn, M=M, mirror=mir)
            npn = R.pen(nn, mir)
            r_, L_ = 0.3, 0.55
            npn.lathe('F', [(0.84 * r_, 0.0), (r_, 0.0), (0.97 * r_, 0.22 * L_), (0.66 * r_, 0.78 * L_), (0.6 * r_, L_), (0.0, L_)], n=10)
            npn.lathe('T', [(0.0, 0.62 * L_), (0.4 * r_, 0.62 * L_), (0.84 * r_, 0.0)], n=10)
