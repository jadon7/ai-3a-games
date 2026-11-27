# ck_parts.py -- materials and reusable cockpit hardware (bezels, gauges, switches, vents ...).
# "Surface frame": a Pen whose local x = right, y = up (along the surface), z = out of the surface.
import bpy
from math import sin, cos, pi, radians, sqrt
from mathutils import Vector, Matrix
from ck_kit import *

FACE = RX(pi / 2)      # panel frame (x right, -y normal, z up) -> surface frame (x right, y up, z normal)

MATS = {
    # name: (base colour (linear), metallic, roughness, emission colour, emission strength)
    'lacquer_black': ((0.010, 0.010, 0.012), 0.0, 0.25, None, 0.0),
    'panel_satin': ((0.030, 0.032, 0.036), 0.0, 0.55, None, 0.0),
    'chrome': ((0.86, 0.87, 0.89), 1.0, 0.12, None, 0.0),
    'frame_brushed': ((0.36, 0.37, 0.39), 1.0, 0.40, None, 0.0),
    'bronze': ((0.33, 0.19, 0.075), 1.0, 0.42, None, 0.0),
    'leather_orange': ((0.90, 0.30, 0.015), 0.0, 0.60, None, 0.0),
    'rubber_black': ((0.016, 0.016, 0.017), 0.0, 0.85, None, 0.0),
    'glass_red': ((0.45, 0.012, 0.008), 0.0, 0.14, (1.0, 0.06, 0.02), 0.55),
    'glass_green': ((0.02, 0.30, 0.07), 0.0, 0.12, (0.12, 1.0, 0.28), 0.55),
    'dial_white': ((0.78, 0.78, 0.72), 0.0, 0.50, (1.0, 0.93, 0.78), 0.10),
    'dial_dark': ((0.020, 0.022, 0.026), 0.0, 0.45, (1.0, 0.45, 0.10), 0.06),   # black face, lit from behind
    'legend_glow': ((0.80, 0.62, 0.34), 0.0, 0.60, (1.0, 0.70, 0.30), 0.45),
    'screen_off': ((0.006, 0.020, 0.010), 0.0, 0.10, (0.03, 0.16, 0.06), 0.25),
    'lamp_lens': ((0.22, 0.22, 0.22), 0.0, 0.20, None, 0.0),
    'paint': ((1.0, 1.0, 1.0), 0.0, 0.70, None, 0.0),
    'struct_grey': ((0.070, 0.080, 0.095), 0.5, 0.55, None, 0.0),        # painted structure
    'tread_steel': ((0.30, 0.31, 0.33), 1.0, 0.50, None, 0.0),           # floor tread plate
    'shell_cream': ((0.56, 0.54, 0.46), 0.1, 0.42, None, 0.0),           # rounded instrument housings
    'gel_teal': ((0.10, 0.55, 0.52), 0.0, 0.12, (0.10, 0.95, 0.85), 0.6),  # translucent rim behind a housing
    'decal_labels': ((1.0, 1.0, 1.0), 0.0, 0.55, None, 0.0),             # printed matter: the label atlas
    'strip_light': ((1.0, 1.0, 1.0), 0.0, 0.30, (1.0, 0.94, 0.82), 2.0), # cabin light strips
    'needle_orange': ((0.90, 0.30, 0.04), 0.0, 0.50, (1.0, 0.35, 0.05), 0.4),
    'panel_bluegrey': ((0.115, 0.145, 0.185), 0.3, 0.55, None, 0.0),      # painted instrument faces
    'fabric_grey': ((0.30, 0.30, 0.29), 0.0, 0.92, None, 0.0),            # woven seat inserts
    'weld_steel': ((0.10, 0.11, 0.14), 1.0, 0.55, None, 0.0),             # weld beads
}

# vertex colours for the 'paint' material (linear)
RED = (0.60, 0.02, 0.012)
YEL = (0.85, 0.52, 0.02)
WHT = (0.80, 0.80, 0.76)
BLK = (0.012, 0.012, 0.012)
GRN = (0.05, 0.40, 0.08)
AMB = (0.90, 0.35, 0.02)
GRY = (0.22, 0.23, 0.24)
BLU = (0.03, 0.10, 0.35)


def make_materials():
    out = {}
    for name, (c, metal, rough, emit, es) in MATS.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1.0)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        if emit:
            bsdf.inputs['Emission Color'].default_value = (emit[0], emit[1], emit[2], 1.0)
            bsdf.inputs['Emission Strength'].default_value = es
        if name == 'paint':
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.layer_name = 'Color'
            nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        m.diffuse_color = (c[0], c[1], c[2], 1.0)
        assert m.name == name
        out[name] = m
    return out


# ------------------------------------------------------------------------------------------
# flat marks on a surface
# ------------------------------------------------------------------------------------------
def flat(g, mat, pts, z=0.0005, col=None):
    """Single-sided polygon lying on the surface (faces +z)."""
    if poly_area(pts) < 0:
        pts = list(reversed(pts))
    g.quad(mat, [(a, b, z) for a, b in pts], col)


def frect(g, mat, x, y, w, h, z=0.0005, col=None, rot=0.0):
    c, s = cos(rot), sin(rot)
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    flat(g, mat, [(x + a * c - b * s, y + a * s + b * c) for a, b in pts], z, col)


_SEED = [7]


def _rnd():
    _SEED[0] = (_SEED[0] * 1103515245 + 12345) & 0x7fffffff
    return (_SEED[0] >> 8) / float(1 << 23)


def legend(g, x, y, w, h=0.0032, mat='legend_glow', z=0.0005, col=None, words=None):
    """Fake lettering: a row of small blocks of varying width (reads as a printed legend)."""
    n = words if words else max(1, int(w / 0.006))
    cx = x - w / 2
    unit = w / n
    for i in range(n):
        ww = unit * (0.55 + 0.35 * _rnd())
        frect(g, mat, cx + unit * i + ww / 2, y, ww, h, z, col)


def text_rows(g, x, y, w, rows, pitch=0.0055, h=0.0028, mat='legend_glow', z=0.0005, col=None):
    for r in range(rows):
        ww = w * (0.55 + 0.45 * _rnd())
        legend(g, x - (w - ww) / 2, y - r * pitch, ww, h, mat, z, col)


def arc_band(g, mat, r0, r1, a0, a1, n=8, z=0.0006, col=None):
    """Annular band; angles measured from +y, positive = counter-clockwise (needle convention)."""
    for i in range(n):
        ta, tb = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
        pts = [(-r0 * sin(ta), r0 * cos(ta)), (-r1 * sin(ta), r1 * cos(ta)),
               (-r1 * sin(tb), r1 * cos(tb)), (-r0 * sin(tb), r0 * cos(tb))]
        flat(g, mat, pts, z, col)


def tick(g, mat, ang, r0, r1, w, z=0.0006, col=None):
    d = Vector((-sin(ang), cos(ang)))
    t = Vector((cos(ang), sin(ang)))
    a, b = d * r0, d * r1
    flat(g, mat, [tuple(a - t * w / 2), tuple(a + t * w / 2), tuple(b + t * w / 2), tuple(b - t * w / 2)], z, col)


# ------------------------------------------------------------------------------------------
# switches, knobs, buttons, lamps
# ------------------------------------------------------------------------------------------
def toggle(g, ang=0.38, L=0.017, base='chrome', lever='chrome'):
    g.lathe(base, [(0.0062, 0.0), (0.0062, 0.0022), (0.0040, 0.0022), (0.0040, 0.0050), (0.0, 0.0050)], 6, facet=True)
    p1 = (0.0, sin(ang) * L, 0.004 + cos(ang) * L)
    g.rod(lever, (0, 0, 0.004), p1, 0.0015, n=6, r2=0.0024)
    g.ball(lever, 0.0026, p1, n=6, m=3)


def toggle_row(g, n, pitch=0.022, pattern=None, guard=True, leg=True, lever='chrome'):
    """Row of toggles along x, centred.  A chrome guard wire stands at both ends."""
    x0 = -(n - 1) * pitch / 2
    for i in range(n):
        up = pattern[i % len(pattern)] if pattern else (1 if _rnd() > 0.45 else -1)
        toggle(g.at((x0 + i * pitch, 0, 0)), 0.38 * up, lever=lever)
        if leg:
            legend(g, x0 + i * pitch, 0.0135, 0.012, 0.0026, words=2)
    if guard:
        for sx in (-1, 1):
            x = sx * ((n - 1) * pitch / 2 + pitch * 0.62)
            g.pipe('chrome', [(x, -0.011, 0.0), (x, -0.011, 0.018), (x, 0.011, 0.018), (x, 0.011, 0.0)], 0.0013, n=5,
                   bend=0.006, bseg=3, caps=False)


def guarded_switch(g, col=RED):
    """Toggle under a flip-up safety cover (cover drawn half open)."""
    g.box('frame_brushed', (0.022, 0.030, 0.003), (0, 0, 0.0015), bv=0.0008)
    toggle(g.at((0, -0.002, 0.003)), -0.3, L=0.013)
    c = g.at((0, 0.013, 0.006), (radians(-38), 0, 0))
    c.box('paint', (0.018, 0.030, 0.0022), (0, -0.015, 0.010), bv=0.0006, col=col)
    c.box('paint', (0.0022, 0.030, 0.011), (0.0079, -0.015, 0.0045), col=col)
    c.box('paint', (0.0022, 0.030, 0.011), (-0.0079, -0.015, 0.0045), col=col)
    g.rod('chrome', (-0.011, 0.013, 0.006), (0.011, 0.013, 0.006), 0.0016, n=6)


def knob(g, r=0.011, h=0.015, body='rubber_black', cap='chrome', ang=0.0, skirt=True):
    if skirt:
        g.lathe('panel_satin', [(r * 1.35, 0.0), (r * 1.35, 0.0015), (r * 1.1, 0.0035), (r * 0.9, 0.0035)], 14)
    g.lathe(body, [(r, 0.003), (r, h * 0.85), (r * 0.86, h), (0.0, h)], 12, facet=True, ph=ang)
    g.lathe(cap, [(r * 0.62, h), (r * 0.62, h + 0.0012), (0.0, h + 0.0012)], 10)
    d = (-sin(ang), cos(ang))
    frect(g, 'dial_white', d[0] * r * 0.62, d[1] * r * 0.62, 0.0016, r * 0.6, h + 0.0015, rot=ang)
    # index marks around the skirt
    if skirt:
        for i in range(7):
            tick(g, 'legend_glow', -1.9 + i * 3.8 / 6, r * 1.5, r * 1.75, 0.0012)


def keycap(g, w=0.014, d=0.014, h=0.006, mat='panel_satin', top='legend_glow', col=None, legend_w=0.5):
    g.box(mat, (w, d, h), (0, 0, h / 2), tx=0.82, ty=0.82, col=col)
    if top:
        frect(g, top, 0, 0, w * legend_w, d * 0.22, h + 0.0004)


def push_button(g, r=0.007, h=0.005, mat='glass_red', collar='chrome', n=10):
    g.ring(collar, r * 1.38, r * 1.02, 0.0, 0.0028, ch=0.0008, n=n)
    g.lathe(mat, [(r, 0.0), (r, h * 0.7), (r * 0.8, h), (0.0, h)], n, sharp=70.0)


def lamp(kit, st, name, M, r=0.0065, parent=None):
    """Indicator lamp: chrome collar in the static mesh `st`, lens as its own mesh node `name`.
    M = surface frame (world) at the lamp."""
    g = kit.pen(st, M)
    g.lathe('chrome', [(r * 1.0, 0.0), (r * 1.55, 0.0), (r * 1.55, 0.0022), (r * 1.3, 0.0040), (r * 1.02, 0.0040)], 12,
            sharp=50.0)
    kit.mesh(name, parent, M)
    kit.pen(name, M).lathe('lamp_lens', [(r, 0.0015), (r, 0.0040), (r * 0.80, 0.0064), (r * 0.42, 0.0078), (0.0, 0.0082)],
                           10, sharp=80.0)


def screen_disc(kit, name, M, R, n=40, parent=None, mat='screen_off'):
    """Flat round screen: node frame = panel frame (x right, z up, -y normal); UV spans the bounding square."""
    kit.mesh(name, parent, M)
    v = [(R * cos(2 * pi * i / n), 0.0, R * sin(2 * pi * i / n)) for i in range(n)]
    uv = [(0.5 + 0.5 * cos(2 * pi * i / n), 0.5 + 0.5 * sin(2 * pi * i / n)) for i in range(n)]
    kit.pen(name, M).raw(mat, v, [tuple(range(n))], None, [uv])


def screen_rect(kit, name, M, w, h, parent=None, mat='screen_off'):
    kit.mesh(name, parent, M)
    v = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    kit.pen(name, M).raw(mat, v, [(0, 1, 2, 3)], None, [[(0, 0), (1, 0), (1, 1), (0, 1)]])


# ------------------------------------------------------------------------------------------
# bezels and gauges (surface frame at the gauge centre, z = toward the viewer)
# ------------------------------------------------------------------------------------------
def round_bezel(g, R, mat='chrome', w=0.016, h=0.014, z0=0.0, n=32, fat=True, glass=None, zs=0.003):
    """Ring bezel around a round screen of radius R.  `glass` = material of the inner cone down to the screen."""
    if fat:
        pr = [(R + 0.003, z0), (R + w, z0), (R + w, z0 + h * 0.45), (R + w * 0.80, z0 + h * 0.86),
              (R + w * 0.50, z0 + h), (R + w * 0.24, z0 + h * 0.88), (R + 0.003, z0 + h * 0.55)]
        g.lathe(mat, pr, n, closed=True, sharp=62.0)
    else:
        pr = [(R + 0.002, z0), (R + w, z0), (R + w, z0 + h * 0.6), (R + w - h * 0.4, z0 + h),
              (R + 0.004, z0 + h), (R + 0.002, z0 + h * 0.7)]
        g.lathe(mat, pr, n, closed=True, sharp=30.0)
    if glass:
        g.lathe(glass, [(R + 0.0035, z0 + h * 0.62), (R - 0.0005, zs - 0.0004)], n)


def dial(kit, st, name, M, R=0.027, zone=True, style=0, dark=False):
    """White analog dial.  M = panel frame (world) at the dial centre, un-rolled.
    Static parts go to mesh `st`; the needle is the node `name` (+ its mesh `name`_m)."""
    g = kit.pen(st, M @ FACE)
    # dark: a black face whose markings are lit from behind, in a dark anodised ring
    ink = 'legend_glow' if dark else 'rubber_black'
    round_bezel(g, R, 'lacquer_black' if dark else 'chrome', w=0.0065, h=0.0065, n=24, fat=False)
    g.disc('dial_dark' if dark else 'dial_white', R + 0.0025, (0, 0, 0.0012), n=24)
    # scale: 11 major + 10 minor ticks over +-2.2 rad
    for i in range(21):
        a = 2.2 - 4.4 * i / 20
        if i % 2 == 0:
            tick(g, ink, a, R * 0.70, R * 0.95, 0.0015, 0.0017)
        else:
            tick(g, ink, a, R * 0.82, R * 0.95, 0.0009, 0.0017)
    if zone:
        if style == 0:      # green / amber / red toward the maximum
            arc_band(g, 'paint', R * 0.60, R * 0.67, 0.6, -0.9, 6, 0.0017, GRN)
            arc_band(g, 'paint', R * 0.60, R * 0.67, -0.9, -1.55, 3, 0.0017, YEL)
            arc_band(g, 'paint', R * 0.60, R * 0.67, -1.55, -2.2, 3, 0.0017, RED)
        elif style == 1:    # red at the minimum (reserve gauge)
            arc_band(g, 'paint', R * 0.60, R * 0.67, 2.2, 1.45, 3, 0.0017, RED)
            arc_band(g, 'paint', R * 0.60, R * 0.67, 1.45, 0.8, 3, 0.0017, YEL)
            arc_band(g, 'paint', R * 0.60, R * 0.67, 0.8, -2.2, 10, 0.0017, GRN)
        else:               # plain black scale ring
            arc_band(g, ink, R * 0.63, R * 0.66, 2.2, -2.2, 14, 0.0017)
    # little printed legend block under the hub
    frect(g, ink, 0, -R * 0.50, R * 0.50, R * 0.13, 0.0017)
    frect(g, ink, 0, -R * 0.70, R * 0.30, R * 0.09, 0.0017)
    # needle node
    kit.empty(name, None, M)
    kit.mesh(name + '_m', name, M)
    p = kit.pen(name + '_m', M @ FACE)
    z0, z1 = 0.0030, 0.0040
    w0, w1 = 0.0030, 0.0009
    L, tail = R * 0.90, R * 0.26
    v = [(-w0 / 2, -tail, z0), (w0 / 2, -tail, z0), (w1 / 2, L, z0), (-w1 / 2, L, z0),
         (-w0 / 2, -tail, z1), (w0 / 2, -tail, z1), (w1 / 2, L, z1), (-w1 / 2, L, z1)]
    f = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    p.emit('needle_orange' if dark else 'glass_red', v, f, recalc=False)
    p.lathe('rubber_black', [(0.0052, 0.0018), (0.0052, 0.0046), (0.0040, 0.0058), (0.0, 0.0058)], 10)


def rect_bezel(g, w, h, mat='bronze', bw=0.011, bh=0.012, c=0.012, z0=0.0, glass=None, zs=0.003):
    """Chamfered rectangular bezel around a w x h screen."""
    o = rrect(w / 2 + bw, h / 2 + bw, c)
    st = [(0.0, z0), (0.0, z0 + bh * 0.55), (bh * 0.45, z0 + bh), (bw * 0.62, z0 + bh), (bw - 0.001, z0 + bh * 0.55)]
    g.steps(mat, o, st, plane='XY', cap0=False, cap1=False)
    if glass:
        g.steps(glass, o, [(bw - 0.001, z0 + bh * 0.55), (bw + 0.0005, zs - 0.0004)], plane='XY', cap0=False, cap1=False)


# ------------------------------------------------------------------------------------------
# vents, rails, pipes
# ------------------------------------------------------------------------------------------
def vent_round(g, R=0.10, slats=9, ring='chrome', slat='frame_brushed', depth=0.0, tilt=0.6, hub=False, n=36):
    """Round louvred vent standing on the surface: fat ring, dark well, tilted slats cut to the circle."""
    w = R * 0.20
    pr = [(R, 0.0), (R + w, 0.0), (R + w, 0.006), (R + w * 0.78, 0.014), (R + w * 0.3, 0.016), (R, 0.011), (R - 0.001, 0.001)]
    g.lathe(ring, pr, n, sharp=50.0)
    g.disc('rubber_black', R, (0, 0, 0.001), n=n)
    pitch = 2 * R / slats
    ws = min(pitch * 0.95, 0.0085 / sin(tilt))
    for i in range(slats):
        y = -R + pitch * (i + 0.5)
        half = sqrt(max(R * R - (abs(y) + ws * 0.4) ** 2, 0.0)) - 0.001
        if half < 0.008:
            continue
        g.box(slat, (2 * half, ws, 0.0020), (0, y, 0.0062), (tilt, 0, 0), bv=0.0005)
    if hub:
        g.box(ring, (0.012, 2 * R - 0.004, 0.004), (0, 0, 0.011), bv=0.001)


def vent_shutter(g, R=0.085, blades=10, ring='chrome', blade='frame_brushed', n=32):
    """Round vent with a radial iris shutter and a centre boss."""
    w = R * 0.26
    pr = [(R, 0.0), (R + w, 0.0), (R + w, 0.004), (R + w * 0.7, 0.013), (R + w * 0.2, 0.013), (R, 0.008), (R, 0.001)]
    g.lathe(ring, pr, n, sharp=40.0)
    g.disc('rubber_black', R, (0, 0, 0.001), n=n)
    for i in range(blades):
        a = 2 * pi * i / blades
        b = g.at((0, 0, 0.0058), (0, 0, a))
        b.box(blade, (R * 0.80, R * 0.50, 0.0015), (R * 0.56, 0, 0), (0.24, 0, 0), bv=0.0004)
    g.lathe(ring, [(R * 0.27, 0.001), (R * 0.27, 0.009), (R * 0.2, 0.014), (0.0, 0.014)], 16, sharp=40.0)
    g.screw('frame_brushed', (0, 0, 0.014), (0, 0, 1), r=R * 0.07, h=0.003)


def vent_rect(g, w=0.10, h=0.16, ribs=9, frame_m='chrome', rib='frame_brushed', fw=0.012, fh=0.010, c=0.014,
              horizontal=True):
    """Rectangular ribbed vent in a chamfered frame, standing on the surface."""
    o = rrect(w / 2 + fw, h / 2 + fw, c)
    g.steps(frame_m, o, [(0.0, 0.0), (0.0, fh * 0.55), (fh * 0.45, fh), (fw * 0.6, fh), (fw, fh * 0.45), (fw, 0.0006)],
            plane='XY', cap0=False, cap1=False)
    flat(g, 'rubber_black', rrect(w / 2 + 0.001, h / 2 + 0.001, max(c - fw, 0.002)), 0.0008)
    for i in range(ribs):
        if horizontal:
            pitch = h / ribs
            y = -h / 2 + pitch * (i + 0.5)
            g.box(rib, (w, min(pitch * 0.62, 0.010), 0.0022), (0, y, fh * 0.45), (0.5, 0, 0))
        else:
            pitch = w / ribs
            x = -w / 2 + pitch * (i + 0.5)
            g.box(rib, (min(pitch * 0.62, 0.010), h, 0.0022), (x, 0, fh * 0.45), (0, 0.5, 0))


def rail(p, pts, r=0.008, mat='chrome', stand=0.03, nrm=(0, 0, 1), n=8, posts=None, bend=0.02):
    """Grab rail: tube through pts (already stood off) with posts back to the surface along -nrm."""
    p.pipe(mat, pts, r, n=n, bend=bend, bseg=4)
    nv = Vector(nrm).normalized()
    idx = posts if posts is not None else range(len(pts))
    for i in idx:
        a = Vector(pts[i])
        b = a - nv * stand
        p.rod(mat, b, a, r * 0.8, n=6, caps=False)
        p.mul(frame_z(b, nv)).lathe(mat, [(r * 2.0, 0.0), (r * 2.0, 0.003), (r * 1.2, 0.006)], 8)


def bar(p, a, b, w, h, mat, yhint=(1, 0, 0), bv=0.003, ext=0.0):
    """Flat bar from a to b: w across (along yhint), h in the third direction."""
    a, b = Vector(a), Vector(b)
    q = p.mul(frame_x((a + b) / 2, b - a, yhint))
    q.box(mat, ((b - a).length + ext, w, h), bv=bv)
    return q


def strap(p, pts, w=0.044, th=0.003, mat='rubber_black', across=(1, 0, 0)):
    """Flat webbing through a list of points."""
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        q = p.mul(frame_x((a + b) / 2, b - a, across))
        q.box(mat, ((b - a).length + th, w, th))


def pad(g, hx, hy, h, pos=(0, 0, 0), rot=(0, 0, 0), rc=0.022, re=0.013, bulge=0.007, piping=True, m=5,
        mat='leather_orange', **kw):
    """Leather cushion with dark piping around its base."""
    q = g.at(pos, rot)
    q.pillow(mat, hx, hy, h, rc=rc, re=re, bulge=bulge, m=m, **kw)
    if piping:
        pts = [(a, b, 0.0045) for a, b in rrect(hx + 0.0008, hy + 0.0008, rc, seg=4)]
        q.pipe('rubber_black', pts, 0.0034, n=5, closed=True)


def pipe_clamp(p, pos, axis_dir, r, nrm, mat='frame_brushed'):
    """P-clip around a pipe of radius r, bolted to the surface (normal nrm)."""
    q = p.mul(frame_x(pos, axis_dir, nrm))
    q.box(mat, (0.012, 2 * r + 0.006, 2 * r + 0.004), (0, 0, 0), bv=0.0015)
