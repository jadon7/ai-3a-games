"""Build the shopping-mall environment. Run: Blender -b -P build_mall.py"""
import bpy, math, random, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from lib import *

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ------------------------------------------------------------------ dims
FL, UP, SOFF, CEIL_UP, SKY = 0.0, 5.0, 4.35, 9.4, 10.4
VX, SX, DX = 4.5, 11.0, 17.0
Y0, Y1 = -12.0, 62.0
BRIDGES = [(26.0, 29.5), (44.66, 48.2)]
ESC_Y0, ESC_Y1 = 36.0, 44.66
UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62]
COLS_Y = [0, 9, 18, 27, 36, 45, 54]

C_ARCH = coll("Arch")
C_STORE = coll("Stores")
C_PROP = coll("Props")
C_LIGHT = coll("Lights")

# ------------------------------------------------------------------ materials
M_FLOOR = pbr_tex("floor_marble", "marble_01", 1.5, tint=(1.0, 0.97, 0.93), rough_mul=0.35, rough_add=0.02,
                  coat=0.55, coat_rough=0.03, normal_strength=0.4, dirt=0.35)
M_PLASTER = pbr_tex("plaster_white", "white_plaster_02", 1.0, tint=(0.93, 0.92, 0.9), rough_mul=1.0, normal_strength=0.5, dirt=0.15)
M_PLASTER_W = pbr_tex("plaster_warm", "plaster_grey_04", 1.5, tint=(0.95, 0.92, 0.87), normal_strength=0.4)
M_STONE = pbr_tex("planter_stone", "plaster_grey_04", 1.2, tint=(0.55, 0.53, 0.5), normal_strength=0.8, dirt=0.3)
M_PANEL = principled("painted_panel", (0.82, 0.82, 0.8), rough=0.32, noise_rough=0.08)
M_STEEL = principled("stainless", (0.8, 0.8, 0.8), rough=0.22, metal=1.0, noise_rough=0.08, noise_scale=12)
M_BEAM = principled("beam_paint", (0.16, 0.17, 0.18), rough=0.45, metal=0.3, noise_rough=0.1)
M_ALU = principled("alu_dark", (0.07, 0.07, 0.075), rough=0.35, metal=0.9, noise_rough=0.05)
M_GLASS = thin_glass("glass_clean", (0.9, 0.96, 0.95), 0.0, dirt=0.06)
M_GLASS_SKY = thin_glass("glass_sky", (0.93, 0.96, 0.95), 0.02, dirt=0.15)
M_RUBBER = principled("rubber_black", (0.015, 0.015, 0.015), rough=0.55)
M_SOIL = principled("soil", (0.06, 0.045, 0.03), rough=0.95, noise_rough=0.05)
M_SHUTTER = principled("shutter_metal", (0.42, 0.43, 0.43), rough=0.5, metal=0.8, noise_rough=0.15, noise_scale=3)
M_DARK = principled("signband_dark", (0.03, 0.03, 0.032), rough=0.4)
M_EMIT_DL = emissive("downlight", (1.0, 0.92, 0.82), 25.0)
M_EMIT_PANEL = emissive("panel_light", (1.0, 0.97, 0.92), 8.0)

# shutter corrugation via bump
nt = M_SHUTTER.node_tree
b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tc = nt.nodes.new("ShaderNodeTexCoord"); wv = nt.nodes.new("ShaderNodeTexWave")
wv.wave_type = "BANDS"; wv.bands_direction = "Z"; wv.inputs["Scale"].default_value = 9.0
nt.links.new(tc.outputs["Object"], wv.inputs["Vector"])
bp = nt.nodes.new("ShaderNodeBump"); bp.inputs["Strength"].default_value = 0.6
nt.links.new(wv.outputs[1], bp.inputs["Height"]); nt.links.new(bp.outputs[0], b.inputs["Normal"])

# ------------------------------------------------------------------ floor + structure
arch = []
floor = box("Floor", -DX, DX, Y0, Y1, -0.3, 0.0, M_FLOOR, C_ARCH)
for s in (-1, 1):
    xa, xb = sorted((s * VX, s * DX))
    arch.append(box(f"Slab_{s}", xa, xb, Y0, Y1, SOFF, UP - 0.01, M_PLASTER, C_ARCH))
    plane(f"UpFloor_{s}", xa, xb, Y0, Y1, UP, M_FLOOR, C_ARCH)
    # fascia band at void edge
    fx0, fx1 = sorted((s * (VX - 0.04), s * (VX + 0.02)))
    box(f"Fascia_{s}", fx0, fx1, Y0, Y1, SOFF - 0.06, UP + 0.16, M_PANEL, C_ARCH, bevel=0.01)
    # upper ceiling + roof
    box(f"UpCeil_{s}", xa, xb, Y0, Y1, CEIL_UP, CEIL_UP + 0.8, M_PLASTER, C_ARCH)
    cx0, cx1 = sorted((s * (VX - 0.04), s * (VX + 0.4)))
    box(f"Clerestory_{s}", cx0, cx1, Y0, Y1, CEIL_UP - 0.06, SKY + 0.5, M_PANEL, C_ARCH)
# bridges
for (ya, yb) in BRIDGES:
    box(f"Bridge_{ya}", -VX, VX, ya, yb, SOFF, UP - 0.01, M_PLASTER, C_ARCH)
    plane(f"BridgeFloor_{ya}", -VX, VX, ya, yb, UP, M_FLOOR, C_ARCH)
    for yy in (ya, yb):
        box(f"BridgeFascia_{ya}_{yy}", -VX, VX, yy - 0.03, yy + 0.03, SOFF - 0.06, UP + 0.16, M_PANEL, C_ARCH, bevel=0.01)
# end walls
box("EndWallNear", -DX, DX, Y0 - 0.3, Y0, 0, SKY + 0.5, M_PLASTER_W, C_ARCH)
box("EndWallFarTop", -DX, DX, Y1, Y1 + 0.3, CEIL_UP, SKY + 0.5, M_PANEL, C_ARCH)
for s in (-1, 1):
    xa, xb = sorted((s * SX, s * DX))
    box(f"EndWallFarStore_{s}", xa, xb, Y1, Y1 + 0.3, 0, CEIL_UP, M_PLASTER_W, C_ARCH)

# columns
for y in COLS_Y:
    for s in (-1, 1):
        x = s * (VX + 0.65)
        cyl(f"Col_{s}_{y}", x, y, 0, SOFF, 0.38, M_PANEL, C_ARCH, seg=48)
        cyl(f"ColBase_{s}_{y}", x, y, 0, 0.12, 0.42, M_STEEL, C_ARCH, seg=48)
        cyl(f"ColUp_{s}_{y}", x, y, UP, CEIL_UP, 0.33, M_PANEL, C_ARCH, seg=48)

# ------------------------------------------------------------------ skylight
sky_parts = []
y = Y0
while y <= Y1 + 0.01:
    sky_parts.append(box(f"IB_web_{y}", -VX, VX, y - 0.008, y + 0.008, SKY, SKY + 0.34, M_BEAM))
    sky_parts.append(box(f"IB_fb_{y}", -VX, VX, y - 0.08, y + 0.08, SKY, SKY + 0.015, M_BEAM))
    sky_parts.append(box(f"IB_ft_{y}", -VX, VX, y - 0.08, y + 0.08, SKY + 0.325, SKY + 0.34, M_BEAM))
    y += 2.5
for x in (-2.25, 0, 2.25):
    sky_parts.append(box(f"LB_{x}", x - 0.05, x + 0.05, Y0, Y1, SKY + 0.2, SKY + 0.34, M_BEAM))
for o in sky_parts:
    link(o, C_ARCH)
join(sky_parts, "SkylightFrame")
plane("SkylightGlass", -VX - 0.4, VX + 0.4, Y0, Y1 + 0.3, SKY + 0.36, M_GLASS_SKY, C_ARCH)
# roof over galleries (blocks light)
for s in (-1, 1):
    xa, xb = sorted((s * (VX + 0.4), s * (DX + 0.3)))
    box(f"Roof_{s}", xa, xb, Y0 - 0.3, Y1 + 0.3, SKY + 0.36, SKY + 0.6, M_BEAM, C_ARCH)

# ------------------------------------------------------------------ glass balustrades
def balustrade(name, p0, p1, z0, gap_ranges=()):
    """Glass panels + stainless handrail between p0 and p1 (axis aligned)."""
    parts = []
    horiz = abs(p1[0] - p0[0]) > abs(p1[1] - p0[1])
    a0, a1 = (p0[0], p1[0]) if horiz else (p0[1], p1[1])
    a0, a1 = min(a0, a1), max(a0, a1)
    n = max(1, int((a1 - a0) / 1.6))
    w = (a1 - a0) / n
    for i in range(n):
        s0, s1 = a0 + i * w + 0.012, a0 + (i + 1) * w - 0.012
        mid = (s0 + s1) / 2
        if any(g0 <= mid <= g1 for g0, g1 in gap_ranges):
            continue
        if horiz:
            parts.append(box(f"{name}_g{i}", s0, s1, p0[1] - 0.006, p0[1] + 0.006, z0, z0 + 1.0, M_GLASS, C_ARCH))
        else:
            parts.append(box(f"{name}_g{i}", p0[0] - 0.006, p0[0] + 0.006, s0, s1, z0, z0 + 1.0, M_GLASS, C_ARCH))
    segs = [(a0, a1)]
    for g0, g1 in gap_ranges:
        new = []
        for s0, s1 in segs:
            if g1 <= s0 or g0 >= s1:
                new.append((s0, s1)); continue
            if g0 > s0: new.append((s0, g0))
            if g1 < s1: new.append((g1, s1))
        segs = new
    for k, (s0, s1) in enumerate(segs):
        if horiz:
            hr = cyl(f"{name}_rail{k}", p0[1], z0 + 1.03, s0, s1, 0.028, M_STEEL, C_ARCH, seg=16, axis="X")
        else:
            hr = cyl(f"{name}_rail{k}", p0[0], z0 + 1.03, s0, s1, 0.028, M_STEEL, C_ARCH, seg=16, axis="Y")
    return parts

for s in (-1, 1):
    gaps = [(b[0], b[1]) for b in BRIDGES]
    balustrade(f"Bal_{s}", (s * (VX + 0.12), Y0), (s * (VX + 0.12), Y1), UP + 0.16, gap_ranges=gaps)
for (ya, yb) in BRIDGES:
    balustrade(f"BalB_{ya}_a", (-VX, ya + 0.1), (VX, ya + 0.1), UP + 0.16,
               gap_ranges=[(-1.75, 1.75)] if abs(ya - ESC_Y1) < 0.01 else [])
    balustrade(f"BalB_{ya}_b", (-VX, yb - 0.1), (VX, yb - 0.1), UP + 0.16)

# ------------------------------------------------------------------ escalators (pair, rising +Y)
def escalator(xc, name):
    w = 1.0
    run = ESC_Y1 - ESC_Y0
    ang = math.atan2(UP, run)
    parts = []
    nsteps = 26
    for i in range(nsteps):
        t0, t1 = i / nsteps, (i + 1) / nsteps
        ya, yb = ESC_Y0 + run * t0, ESC_Y0 + run * t1
        z = UP * t1
        parts.append(box(f"{name}_st{i}", xc - w / 2, xc + w / 2, ya, yb, z - UP / nsteps, z, M_ALU))
    # flat landings
    parts.append(box(f"{name}_land0", xc - w / 2, xc + w / 2, ESC_Y0 - 1.2, ESC_Y0, -0.01, 0.02, M_STEEL))
    obj = join(parts, f"{name}_steps")
    link(obj, C_ARCH)
    # side skirts / truss cladding (sloped boxes)
    for sx in (-1, 1):
        x = xc + sx * (w / 2 + 0.08)
        sk = box(f"{name}_side{sx}", x - 0.06, x + 0.06, 0, run, -0.6, 1.1, M_GLASS, C_ARCH)
        sk.location = (0, ESC_Y0, 0)
        sk.rotation_euler = (ang, 0, 0)
        base = box(f"{name}_skirt{sx}", x - 0.07, x + 0.07, 0, run, -0.75, 0.12, M_STEEL, C_ARCH)
        base.location = (0, ESC_Y0, 0)
        base.rotation_euler = (ang, 0, 0)
        hr = box(f"{name}_hand{sx}", x - 0.05, x + 0.05, -0.6, run + 0.6, 1.1, 1.2, M_RUBBER, C_ARCH, bevel=0.03)
        hr.location = (0, ESC_Y0, 0)
        hr.rotation_euler = (ang, 0, 0)
    under = box(f"{name}_truss", xc - w / 2 - 0.15, xc + w / 2 + 0.15, 0, run, -0.9, -0.05, M_STEEL, C_ARCH)
    under.location = (0, ESC_Y0, 0)
    under.rotation_euler = (ang, 0, 0)

escalator(-0.75, "EscL")
escalator(0.75, "EscR")
box("EscMid", -0.12, 0.12, ESC_Y0, ESC_Y1, 0, 0.1, M_STEEL, C_ARCH)

# ------------------------------------------------------------------ far glass curtain wall + exterior
cw = []
for i in range(int(2 * SX / 1.5) + 1):
    x = -SX + i * 1.5
    cw.append(box(f"CW_m{i}", x - 0.04, x + 0.04, Y1 - 0.1, Y1 + 0.08, 0, CEIL_UP, M_ALU))
for z in (0.0, 2.8, 5.0, 7.4, CEIL_UP - 0.1):
    cw.append(box(f"CW_t{z}", -SX, SX, Y1 - 0.08, Y1 + 0.06, z, z + 0.1, M_ALU))
link(join(cw, "CurtainWallFrame"), C_ARCH)
vplane("CurtainGlass", (-SX, Y1), (SX, Y1), 0, CEIL_UP, M_GLASS, C_ARCH)
M_PAVE = pbr_tex("pavement", "concrete_debris", 2.0, tint=(0.8, 0.8, 0.78), rough_mul=1.0)
box("Outside", -60, 60, Y1 + 0.3, Y1 + 120, -0.35, -0.05, M_PAVE, C_ARCH)

# ------------------------------------------------------------------ stores
FONT_EN = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"
FONT_CN = "/Library/Fonts/Arial Unicode.ttf"
STORES = {
    # (side, level): list per unit: (type, name, sign colour, interior tint)
    (1, 0): [("glass", "MERIDIAN", (1, 1, 1)), ("open", "茶舍 TEA HOUSE", (1.0, 0.85, 0.6)), ("glass", "NORTHWIND", (0.7, 0.85, 1.0)),
             ("open", "ATLAS SPORT", (1, 0.3, 0.2)), ("shutter", "", None), ("glass", "LUMEN 眼镜", (1, 1, 1)),
             ("glass", "KITE & CO.", (1.0, 0.9, 0.75)), ("shutter", "", None)],
    (-1, 0): [("shutter", "", None), ("glass", "ORBIT", (0.6, 0.9, 1.0)), ("open", "BLOOM 花艺", (1.0, 0.75, 0.8)),
              ("glass", "HALCYON", (1, 1, 1)), ("glass", "数码 DIGITAL", (0.5, 0.8, 1.0)), ("shutter", "", None),
              ("open", "CAFE NOIR", (1.0, 0.8, 0.55)), ("glass", "VERTEX", (1, 1, 1))],
    (1, 1): [("shutter", "", None), ("glass", "STRIDE", (1, 1, 1)), ("glass", "PORTO", (1, 0.85, 0.6)),
             ("shutter", "", None), ("glass", "MONO", (1, 1, 1)), ("glass", "童趣 KIDS", (1, 0.8, 0.3)),
             ("shutter", "", None), ("glass", "AURA", (0.9, 0.9, 1))],
    (-1, 1): [("glass", "SOLACE", (1, 1, 1)), ("shutter", "", None), ("glass", "TERRA", (1, 0.9, 0.7)),
              ("glass", "NOVA", (0.7, 0.9, 1)), ("shutter", "", None), ("glass", "书店 BOOKS", (1, 0.95, 0.85)),
              ("glass", "FJORD", (0.8, 0.95, 1)), ("shutter", "", None)],
}
INT_TINTS = [(0.92, 0.88, 0.82), (0.7, 0.72, 0.75), (0.85, 0.8, 0.72), (0.35, 0.36, 0.38), (0.9, 0.9, 0.9)]
M_WOODFLOOR = principled("store_floor_wood", (0.32, 0.22, 0.14), rough=0.4, noise_rough=0.1, noise_scale=8)


def store_unit(s, lvl, k, ya, yb, spec):
    typ, name, scol = spec[0], spec[1], spec[2]
    z0 = FL if lvl == 0 else UP
    H = (SOFF - z0) if lvl == 0 else (CEIL_UP - UP)
    xf = s * SX
    # pilasters at unit edges
    for yy in (ya, yb):
        x0, x1 = sorted((s * (SX - 0.12), s * (SX + 0.25)))
        box(f"Pil_{s}{lvl}{k}_{yy}", x0, x1, yy - 0.3, yy + 0.3, z0, z0 + H, M_PANEL, C_STORE, bevel=0.01)
    # sign band
    x0, x1 = sorted((s * (SX - 0.14), s * SX))
    band_z0 = z0 + 3.25
    box(f"Band_{s}{lvl}{k}", x0, x1, ya + 0.3, yb - 0.3, band_z0, z0 + H, M_DARK, C_STORE, bevel=0.005)
    if name:
        font = FONT_CN if any(ord(ch) > 127 for ch in name) else FONT_EN
        mt = emissive(f"sign_{name}", scol, 6.0)
        tz = (band_z0 + z0 + H) / 2
        text_obj(f"Sign_{name}", name, (s * (SX - 0.16), (ya + yb) / 2, tz), (math.pi / 2, 0, -s * math.pi / 2),
                 0.42 if lvl == 0 else 0.36, mt, C_STORE, extrude=0.015, font=font)
    if typ == "shutter":
        x0, x1 = sorted((s * (SX + 0.05), s * (SX + 0.1)))
        box(f"Shutter_{s}{lvl}{k}", x0, x1, ya + 0.3, yb - 0.3, z0, band_z0, M_SHUTTER, C_STORE)
        return
    # glazing with door opening in centre
    door = (yb + ya) / 2
    dw = 2.6 if typ == "glass" else 5.5
    mull = []
    n = int((yb - ya - 0.6) / 1.5)
    w = (yb - ya - 0.6) / n
    for i in range(n + 1):
        yy = ya + 0.3 + i * w
        x0, x1 = sorted((s * (SX - 0.05), s * (SX + 0.05)))
        if abs(yy - door) < dw / 2 - 0.05:
            continue
        mull.append(box(f"Mul_{s}{lvl}{k}{i}", x0, x1, yy - 0.03, yy + 0.03, z0, band_z0, M_ALU))
    x0, x1 = sorted((s * (SX - 0.05), s * (SX + 0.05)))
    mull.append(box(f"MulT_{s}{lvl}{k}", x0, x1, ya + 0.3, yb - 0.3, band_z0 - 0.08, band_z0, M_ALU))
    mull.append(box(f"MulB_{s}{lvl}{k}a", x0, x1, ya + 0.3, door - dw / 2, z0, z0 + 0.08, M_ALU))
    mull.append(box(f"MulB_{s}{lvl}{k}b", x0, x1, door + dw / 2, yb - 0.3, z0, z0 + 0.08, M_ALU))
    link(join(mull, f"Mullions_{s}{lvl}{k}"), C_STORE)
    for (g0, g1, nm) in ((ya + 0.3, door - dw / 2, "a"), (door + dw / 2, yb - 0.3, "b")):
        if g1 - g0 > 0.1:
            vplane(f"Glaz_{s}{lvl}{k}{nm}", (xf, g0), (xf, g1), z0 + 0.08, band_z0 - 0.08, M_GLASS, C_STORE)
    # interior box
    tint = random.choice(INT_TINTS)
    m_int = principled(f"int_wall_{k}_{lvl}_{s}", tint, rough=0.7)
    xb0, xb1 = sorted((s * (DX - 0.2), s * DX))
    box(f"IntBack_{s}{lvl}{k}", xb0, xb1, ya, yb, z0, z0 + H, m_int, C_STORE)
    for yy in (ya, yb):
        xs0, xs1 = sorted((s * SX, s * DX))
        box(f"IntSide_{s}{lvl}{k}_{yy}", xs0, xs1, yy - 0.1, yy + 0.1, z0, z0 + H, m_int, C_STORE)
    xs0, xs1 = sorted((s * (SX + 0.1), s * DX))
    box(f"IntCeil_{s}{lvl}{k}", xs0, xs1, ya, yb, z0 + 3.2, z0 + 3.3, M_PLASTER, C_STORE)
    if lvl == 0:
        box(f"IntFloor_{s}{lvl}{k}", xs0, xs1, ya + 0.1, yb - 0.1, 0.0, 0.01, M_WOODFLOOR, C_STORE)
    lit = random.random() > 0.25
    if lit:
        area_light(f"StoreL_{s}{lvl}{k}", (s * (SX + DX) / 2, (ya + yb) / 2, z0 + 3.15), 3.5, 450,
                   color=(1.0, 0.86, 0.7), shape="RECTANGLE", size_y=6.0, c=C_LIGHT)
        for j in range(3):
            plane(f"StoreP_{s}{lvl}{k}{j}", *sorted((s * (SX + 1.2), s * (DX - 1.2))), ya + 1.5 + j * 2.8, ya + 2.1 + j * 2.8,
                  z0 + 3.19, M_EMIT_PANEL, C_STORE)
    # contents
    mid_x = s * (SX + DX) / 2
    rotf = math.pi / 2 if s > 0 else -math.pi / 2
    for j, yy in enumerate((ya + 1.6, (ya + yb) / 2, yb - 1.6)):
        aid = random.choice(["steel_frame_shelves_02", "wooden_display_shelves_01"])
        instance(aid, (s * (DX - 0.6), yy, z0), rot_z=rotf + math.pi, c=C_PROP)
    if "CAFE" in name or "茶" in name:
        box(f"Counter_{s}{lvl}{k}", *sorted((s * (DX - 2.2), s * (DX - 1.4))), ya + 1.0, yb - 1.0, z0, z0 + 1.05, M_PANEL, C_STORE, bevel=0.01)
        for j in range(4):
            instance("bar_chair_round_01", (s * (DX - 2.7), ya + 1.8 + j * 1.6, z0), rot_z=random.uniform(0, 6), c=C_PROP)
        instance("CashRegister_01", (s * (DX - 1.8), ya + 1.6, z0 + 1.05), rot_z=rotf, c=C_PROP)
    else:
        for j in range(2):
            box(f"Disp_{s}{lvl}{k}{j}", *sorted((mid_x - 0.7, mid_x + 0.7)), ya + 2.2 + j * 3.6, ya + 3.4 + j * 3.6, z0, z0 + 0.85,
                M_PANEL, C_STORE, bevel=0.01)
            for q in range(5):
                c = (random.random() * 0.8, random.random() * 0.6, random.random() * 0.5)
                pm = principled(f"goods_{random.randint(0, 9)}", c, rough=0.6)
                x = mid_x + random.uniform(-0.5, 0.5)
                yq = ya + 2.4 + j * 3.6 + random.uniform(0, 0.8)
                box(f"Good_{s}{lvl}{k}{j}{q}", x - 0.12, x + 0.12, yq - 0.08, yq + 0.08, z0 + 0.85, z0 + 0.85 + random.uniform(0.06, 0.3), pm, C_STORE)


for (s, lvl), specs in STORES.items():
    for k in range(len(UNIT_B) - 1):
        store_unit(s, lvl, k, UNIT_B[k], UNIT_B[k + 1], specs[k])

# ------------------------------------------------------------------ ceiling downlights under galleries
for s in (-1, 1):
    for x in (s * 6.5, s * 9.2):
        y = Y0 + 1.5
        while y < Y1 - 0.5:
            on = random.random() > 0.12
            cyl(f"DL_{s}_{x}_{y}", x, y, SOFF - 0.012, SOFF - 0.002, 0.09,
                M_EMIT_DL if on else M_STEEL, C_LIGHT, seg=16)
            if on:
                area_light(f"DLa_{s}_{x}_{y}", (x, y, SOFF - 0.02), 0.16, 55, color=(1.0, 0.9, 0.78), c=C_LIGHT)
            y += 3.0
    # upper level ceiling light panels (emissive only)
    for x in (s * 6.8, s * 9.2):
        y = Y0 + 1.5
        while y < Y1 - 0.5:
            plane(f"UPL_{s}_{x}_{y}", x - 0.3, x + 0.3, y - 0.3, y + 0.3, CEIL_UP - 0.005, M_EMIT_PANEL, C_LIGHT)
            y += 4.5

# ------------------------------------------------------------------ atrium props
P = C_PROP
# planter + benches
box("Planter1", -2.2, 2.2, 1.6, 3.2, 0, 0.55, M_STONE, P, bevel=0.02)
plane("PlanterSoil1", -2.1, 2.1, 1.7, 3.1, 0.5, M_SOIL, P)
for i, x in enumerate((-1.4, 0.0, 1.4)):
    instance(random.choice(["potted_plant_01", "potted_plant_02"]), (x, 2.4, 0.45), rot_z=random.uniform(0, 6), scale=1.8, c=P)
instance("modular_street_seating", (0, 0.9, 0), rot_z=0, c=P)
instance("modular_street_seating", (0, 3.9, 0), rot_z=math.pi, c=P)
# cafe seating (some knocked over)
for (x, y, r) in ((-2.6, 9.6, 0.3), (2.0, 11.2, 1.1), (-0.4, 13.6, 2.2)):
    instance("outdoor_table_chair_set_01", (x, y, 0), rot_z=r, c=P)
for (x, y, rot) in ((0.8, 8.4, (1.5, 0, 0.7)), (-3.4, 12.6, (0, 1.57, 2.0)), (3.2, 14.6, (1.55, 0.2, -1.0))):
    instance("plastic_monobloc_chair_01", (x, y, 0.22), rot=rot, c=P)
instance("CoffeeCart_01", (3.0, 7.0, 0), rot_z=-0.4, c=P)
# kiosk at y=20 (enemy cover)
M_KIOSK = principled("kiosk_white", (0.85, 0.85, 0.83), rough=0.25, coat=0.3)
box("KioskBody", -1.7, 1.7, 19.3, 20.7, 0, 1.05, M_KIOSK, P, bevel=0.02)
box("KioskTop", -1.8, 1.8, 19.2, 20.8, 1.05, 1.1, M_ALU, P, bevel=0.005)
box("KioskGlass", -1.6, 1.6, 19.35, 19.45, 1.1, 1.45, M_GLASS, P)
cyl("KioskPost", 0, 20.0, 1.1, 2.7, 0.06, M_STEEL, P)
box("KioskSign", -1.2, 1.2, 19.95, 20.05, 2.5, 3.0, M_DARK, P, bevel=0.01)
text_obj("KioskTxt", "配件 ACCESSORIES", (0, 19.93, 2.75), (math.pi / 2, 0, 0), 0.22, emissive("kiosk_sign", (1, 1, 1), 5), P,
         font=FONT_CN)
# barricade at y=31
instance("concrete_road_barrier", (-2.4, 31.0, 0), rot_z=0.15, c=P)
instance("concrete_road_barrier", (0.9, 31.4, 0), rot_z=-0.1, c=P)
for (x, y, z, r) in ((2.9, 31.2, 0, 0.3), (2.9, 31.2, 0.3, 0.1), (3.5, 30.6, 0, 1.0), (-4.0, 30.8, 0, 0.5)):
    instance("plastic_crate_01", (x, y, z), rot_z=r, c=P)
for (x, y, r) in ((-3.6, 31.9, 0.4), (1.9, 32.2, 1.2), (-1.2, 30.2, 2.5), (6.5, 22.5, 0.2), (-7.5, 15.0, 1.4)):
    instance("cardboard_box_01", (x, y, 0), rot_z=r, c=P)
# misc around columns / stores
for (x, y, aid, r) in ((5.8, 0.8, "metal_trash_can", 0), (-5.8, 9.8, "metal_trash_can", 0), (5.8, 27.8, "metal_trash_can", 0),
                       (-5.7, 18.6, "korean_fire_extinguisher_01", 1.57), (3.2, 5.0, "WetFloorSign_01", 0.6),
                       (9.6, 3.0, "trashbag", 0.2), (9.8, 3.6, "trashbag", 1.9), (-9.7, 25.0, "trashbag", 0.6),
                       (-8.0, 3.0, "modular_street_seating", 1.57), (8.0, 36.0, "modular_street_seating", -1.57),
                       (8.2, 10.5, "sofa_02", -1.2), (-8.4, 40.0, "modern_arm_chair_01", 2.2)):
    instance(aid, (x, y, 0), rot_z=r, c=P)
for (x, y) in ((6.0, 0.0), (-6.0, 27.0), (6.0, 45.0)):
    instance("security_camera_01", (x, y, SOFF - 0.05), rot=(math.pi, 0, random.uniform(0, 6)), c=P)
for (x, y) in ((-2.0, 52.0), (2.0, 52.0), (7.5, 50.0), (-7.5, 52.0)):
    box(f"PlanterB_{x}_{y}", x - 0.6, x + 0.6, y - 0.6, y + 0.6, 0, 0.7, M_STONE, P, bevel=0.02)
    instance("potted_plant_02", (x, y, 0.62), rot_z=random.uniform(0, 6), scale=2.2, c=P)

# paper debris
paper_mats = [principled(f"paper_{i}", c, rough=0.7) for i, c in enumerate(((0.82, 0.81, 0.78), (0.8, 0.78, 0.7), (0.75, 0.8, 0.85), (0.85, 0.7, 0.6)))]
papers = []
for i in range(260):
    x = random.uniform(-10.5, 10.5)
    y = random.uniform(-8, 46)
    if -2.2 < x < 2.2 and 1.6 < y < 3.2:
        continue
    w, h = random.choice(((0.21, 0.297), (0.15, 0.1), (0.3, 0.2), (0.09, 0.09)))
    p = plane(f"Paper{i}", -w / 2, w / 2, -h / 2, h / 2, 0, random.choice(paper_mats), P)
    p.location = (x, y, 0.002 + random.random() * 0.003)
    p.rotation_euler = (random.uniform(-0.04, 0.04), random.uniform(-0.04, 0.04), random.uniform(0, 6.28))
    papers.append(p)
# broken glass near the sport store (enemy exit)
M_SHARD = thin_glass("glass_shard", (0.85, 0.95, 0.9), 0.02)
for i in range(70):
    x = random.uniform(8.0, 10.9)
    y = random.uniform(16.0, 23.0)
    sz = random.uniform(0.02, 0.09)
    p = plane(f"Shard{i}", -sz, sz, -sz * 0.6, sz * 0.7, 0, M_SHARD, P)
    p.location = (x, y, 0.003)
    p.rotation_euler = (random.uniform(-0.1, 0.1), random.uniform(-0.1, 0.1), random.uniform(0, 6.28))

# ------------------------------------------------------------------ sun, world, atmosphere
sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 7.5
sun_d.angle = math.radians(0.6)
sun_d.color = (1.0, 0.95, 0.88)
sun = bpy.data.objects.new("Sun", sun_d)
sc.collection.objects.link(sun)
d = Vector((-0.42, 0.30, -0.86)).normalized()
sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("World")
sc.world = world
world.use_nodes = True
wn = world.node_tree
for n in list(wn.nodes):
    wn.nodes.remove(n)
wo = wn.nodes.new("ShaderNodeOutputWorld")
bg = wn.nodes.new("ShaderNodeBackground")
env = wn.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(os.path.join(PH, "hdri", "modern_buildings_2_2k.hdr"))
wtc = wn.nodes.new("ShaderNodeTexCoord")
wmp = wn.nodes.new("ShaderNodeMapping")
wmp.inputs["Rotation"].default_value = (0, 0, math.radians(110))
wn.links.new(wtc.outputs["Generated"], wmp.inputs["Vector"])
wn.links.new(wmp.outputs[0], env.inputs[0])
wn.links.new(env.outputs[0], bg.inputs[0])
bg.inputs[1].default_value = 1.2
wn.links.new(bg.outputs[0], wo.inputs[0])

# volumetric haze (dust) in concourse
M_HAZE = bpy.data.materials.new("haze")
M_HAZE.use_nodes = True
hn = M_HAZE.node_tree
for n in list(hn.nodes):
    hn.nodes.remove(n)
ho = hn.nodes.new("ShaderNodeOutputMaterial")
pv = hn.nodes.new("ShaderNodeVolumePrincipled")
pv.inputs["Density"].default_value = 0.0035
pv.inputs["Anisotropy"].default_value = 0.55
pv.inputs["Color"].default_value = (0.95, 0.93, 0.9, 1)
hn.links.new(pv.outputs[0], ho.inputs["Volume"])
haze = box("Haze", -SX + 0.2, SX - 0.2, Y0 + 0.4, Y1 - 0.4, 0.02, SKY - 0.05, M_HAZE, C_ARCH)
haze.visible_shadow = False

# ------------------------------------------------------------------ render settings
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = True
except Exception as ex:
    print("device", ex)
sc.cycles.device = "GPU"
sc.cycles.samples = 96
sc.cycles.adaptive_threshold = 0.03
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 6
sc.cycles.transparent_max_bounces = 12
sc.cycles.volume_bounces = 0
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.cycles.sample_clamp_indirect = 6.0
sc.cycles.volume_step_rate = 4.0
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.fps = 30
try:
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
except Exception as ex:
    print("cm", ex)
sc.view_settings.exposure = 0.0

out = os.path.join(ROOT, "blend", "mall.blend")
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("SAVED", out, len(bpy.data.objects), "objects")
