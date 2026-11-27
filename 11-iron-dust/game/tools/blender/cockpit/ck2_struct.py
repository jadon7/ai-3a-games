# ck2_struct.py -- v2 structure: what the slim seat unit stands in.  All static (mesh node st_struct).
#   floor frame: two box rails with cross-members, tread plates under the feet and under the seat, a toe board
#   seat stays:  a V of flat stays and a damper each side from the carriage down to the rails
#   side frames: an outrigger post, a raking brace and a sill rail each side at knee height, with a cable run
#   cluster brace: an A-frame from the front cross-member up to the instrument stalk
# Everything stays low and to the sides: nothing here rises into the view over the instrument cluster.
from ck_parts import *
from ck2_seat import PEDAL_Y, PEDAL_Z
from ck2_cluster import STALK_BOT, STALK_TOP

RX = 0.36                 # rails: half spacing
RZ = -1.305               # their centre height
Y0, Y1 = -0.34, 1.00      # their ends
G, S, K, R = 'struct_grey', 'frame_brushed', 'lacquer_black', 'rubber_black'


def _eye(p, c, r=0.02, w=0.03):
    """clevis eye of a stay or damper, pin along X"""
    p.cyl(S, r, w, tuple(c), axis='X', n=10)
    p.cyl('chrome', r * 0.45, w + 0.008, tuple(c), axis='X', n=8)


def weld(p, a, b, r=0.0048):
    """a weld bead from a to b: a string of overlapping flattened drops"""
    a, b = Vector(a), Vector(b)
    n = max(2, int((b - a).length / (r * 1.5)))
    for i in range(n + 1):
        c = a + (b - a) * (i / n)
        p.ball('weld_steel', r * (0.9 + 0.2 * ((i * 7) % 3) / 2.0), tuple(c), n=6, m=3)


def build_struct(kit):
    st = 'st_struct'
    kit.mesh(st)
    p = kit.pen(st)
    top = RZ + 0.045
    L = Y1 - Y0
    ym = (Y0 + Y1) / 2
    # ---- floor frame
    for s in (-1, 1):
        p.box(G, (0.07, L, 0.09), (s * RX, ym, RZ), bv=0.008)
        p.box(S, (0.094, L - 0.04, 0.008), (s * RX, ym, top + 0.004), bv=0.002)          # wear strip on top
        for i in range(5):
            p.box(R, (0.004, 0.13, 0.040), (s * (RX + 0.0355), Y0 + 0.17 + i * 0.25, RZ - 0.004))      # lightening slots
        p.screws('chrome', [(s * (RX + 0.036), Y0 + 0.045 + i * 0.25, RZ + 0.028) for i in range(6)], (s, 0, 0), r=0.0065, h=0.003)
        p.box(K, (0.086, 0.05, 0.10), (s * RX, Y1 + 0.012, RZ), bv=0.008)               # end caps
        p.box(K, (0.086, 0.05, 0.10), (s * RX, Y0 - 0.012, RZ), bv=0.008)
    for y in (Y0 + 0.06, 0.30, Y1 - 0.06):
        p.box(G, (2 * RX - 0.07, 0.06, 0.07), (0, y, RZ - 0.006), bv=0.008)
        for s in (-1, 1):
            # corner brackets where a cross-member meets a rail
            p.box(S, (0.05, 0.10, 0.012), (s * (RX - 0.058), y, top - 0.004), bv=0.002)
            p.screws('chrome', [(s * (RX - 0.058), y + dy, top + 0.002) for dy in (-0.032, 0.032)], (0, 0, 1), r=0.006, h=0.003)
    # welds: cross-members to rails, post feet to rails, end caps
    for y in (Y0 + 0.06, 0.30, Y1 - 0.06):
        for s in (-1, 1):
            for dy in (-0.032, 0.032):
                weld(p, (s * (RX - 0.036), y + dy, RZ - 0.036), (s * (RX - 0.036), y + dy, RZ + 0.026))
    for s in (-1, 1):
        for yy in (0.52, -0.20):
            for dy in (-0.046, 0.046):
                weld(p, (s * RX - 0.040, yy + dy, top + 0.011), (s * RX + 0.040, yy + dy, top + 0.011))
        for ye in (Y1 - 0.013, Y0 + 0.013):
            weld(p, (s * RX - 0.034, ye, RZ + 0.046), (s * RX + 0.034, ye, RZ + 0.046))
            weld(p, (s * (RX + 0.036), ye, RZ - 0.044), (s * (RX + 0.036), ye, RZ + 0.044))
    # tread plates: under the feet, under the seat
    p.box('tread_steel', (2 * RX - 0.075, 0.50, 0.010), (0, 0.69, top - 0.012), bv=0.002)
    p.box('tread_steel', (2 * RX - 0.075, 0.34, 0.010), (0, 0.02, top - 0.012), bv=0.002)
    for y in (0.46, 0.92, -0.13, 0.17):
        p.screws('chrome', [(x, y, top - 0.007) for x in (-0.27, -0.09, 0.09, 0.27)], (0, 0, 1), r=0.005, h=0.002)
    # toe board with a kick strip
    p.box(G, (2 * RX + 0.07, 0.018, 0.17), (0, Y1 + 0.03, RZ + 0.065), (-0.22, 0, 0), bv=0.004)
    p.box(R, (2 * RX - 0.06, 0.008, 0.05), (0, Y1 + 0.012, RZ + 0.075), (-0.22, 0, 0), bv=0.002)
    # ---- seat stays and dampers: the carriage is carried by the rails, not by the arm alone
    for s in (-1, 1):
        ca = Vector((s * 0.150, 0.03, -0.978))
        for dy, yy in ((-0.10, -0.24), (0.10, 0.22)):
            a = ca + Vector((0, dy, 0))
            b = Vector((s * (RX - 0.01), 0.03 + yy, top + 0.02))
            bar(p, a, b, 0.034, 0.012, G, yhint=(0, 1, 0), bv=0.003, ext=0.01)
            _eye(p, a, 0.018, 0.02)
            _eye(p, b, 0.02, 0.05)
            p.box(S, (0.06, 0.07, 0.014), (s * (RX - 0.01), 0.03 + yy, top + 0.006), bv=0.003)
        # damper: fat body up at the carriage, bright rod down to the rail
        a = Vector((s * 0.165, 0.03, -1.010))
        b = Vector((s * (RX - 0.03), 0.03, top + 0.03))
        u = (b - a).normalized()
        m = a + (b - a) * 0.58
        p.rod(K, a, m, 0.024, n=12, ch=0.004)
        p.rod(S, m - u * 0.012, m + u * 0.010, 0.028, n=12)
        p.rod('chrome', m, b, 0.011, n=10)
        p.rod(R, m + u * 0.012, m + u * 0.07, 0.016, n=10)                                # gaiter
        _eye(p, a, 0.02, 0.034)
        _eye(p, b, 0.02, 0.05)
    # ---- side frames at knee height
    for s in (-1, 1):
        foot = Vector((s * RX, 0.52, top))
        head = Vector((s * 0.49, 0.54, -0.725))
        heel = Vector((s * RX, 0.08, top))
        rear = Vector((s * 0.47, -0.16, -0.760))
        bar(p, foot, head, 0.05, 0.036, G, yhint=(0, 1, 0), bv=0.006, ext=0.005)            # outrigger post
        bar(p, heel, head + Vector((0, -0.05, -0.03)), 0.034, 0.014, G, yhint=(1, 0, 0), bv=0.003)    # raking brace
        bar(p, Vector((s * RX, -0.20, top)), rear, 0.042, 0.030, G, yhint=(0, 1, 0), bv=0.005, ext=0.005)   # rear post
        p.box(S, (0.09, 0.09, 0.012), tuple(foot + Vector((0, 0, 0.004))), bv=0.003)
        p.box(S, (0.09, 0.09, 0.012), (s * RX, -0.20, top + 0.004), bv=0.003)
        p.screws('chrome', [(s * RX + dx, 0.52 + dy, top + 0.011) for dx in (-0.03, 0.03) for dy in (-0.03, 0.03)], (0, 0, 1), r=0.006, h=0.003)
        # sill rail: a tube from the rear post to the outrigger head and on forward, with a rubber grip
        front = Vector((s * 0.47, 0.80, -0.80))
        p.pipe(S, [tuple(rear), tuple(head), tuple(front)], 0.017, n=10, bend=0.06, bseg=4)
        g0 = rear + (head - rear) * 0.30
        g1 = rear + (head - rear) * 0.72
        p.rod(R, g0, g1, 0.0215, n=10, ch=0.003)
        p.box(K, (0.05, 0.06, 0.05), tuple(head), bv=0.008)
        p.box(K, (0.044, 0.05, 0.044), tuple(rear), bv=0.007)
        bar(p, front, Vector((s * RX, Y1 - 0.06, top)), 0.034, 0.024, G, yhint=(0, 1, 0), bv=0.004)     # front drop
        # cable runs along the rail and up the post
        p.pipe(R, [(s * (RX - 0.05), Y0 + 0.02, top + 0.012), (s * (RX - 0.05), 0.44, top + 0.012), (s * (RX + 0.02), 0.50, top + 0.05),
                   tuple(head + Vector((-s * 0.03, -0.035, -0.06)))], 0.0095, n=6, bend=0.04, bseg=3)
        p.pipe(R, [(s * (RX - 0.072), Y0 + 0.02, top + 0.010), (s * (RX - 0.072), 0.78, top + 0.010), (s * 0.14, 0.86, top + 0.010)], 0.007, n=6, bend=0.05, bseg=3)
        for y in (-0.05, 0.25):
            p.box(S, (0.05, 0.016, 0.022), (s * (RX - 0.058), y, top + 0.012), bv=0.003)          # cable clamps
    # ---- cluster brace: an A-frame from the front cross-member to the stalk
    mid = STALK_BOT + (STALK_TOP - STALK_BOT) * 0.55
    for s in (-1, 1):
        a = Vector((s * 0.20, Y1 - 0.06, RZ + 0.03))
        b = mid + Vector((s * 0.034, 0.012, 0))
        bar(p, a, b, 0.030, 0.012, G, yhint=(1, 0, 0), bv=0.003, ext=0.008)
        p.box(S, (0.06, 0.05, 0.012), tuple(a + Vector((0, 0, 0.004))), bv=0.003)
    p.box(K, (0.10, 0.058, 0.05), tuple(mid + Vector((0, 0.006, 0))), bv=0.008)
    p.screws('chrome', [tuple(mid + Vector((x, -0.024, 0.0))) for x in (-0.034, 0.034)], (0, -1, 0), r=0.006, h=0.003)
    return {}
