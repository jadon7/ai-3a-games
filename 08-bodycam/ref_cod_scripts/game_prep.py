"""Prepare mall.blend for the real-time game: realize, split by material, tile UVs, cull hidden faces,
group into lightmap chunks, unwrap lightmap UVs.  Run: Blender -b blend/mall.blend -P scripts/game_prep.py"""
import bpy, bmesh, math, os, sys, random, json, time
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0 = time.time()
sc = bpy.context.scene
vl = bpy.context.view_layer
random.seed(3)


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


def select(objs, active=None):
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = active or (objs[0] if objs else None)


# ---------------------------------------------------------------- cleanup + realize
for n in ("Haze",):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])
for o in list(sc.objects):
    if o.type == "CAMERA":
        bpy.data.objects.remove(o)

lib = bpy.data.collections.get("_LIB")
lib_objs = set(lib.all_objects) if lib else set()
# make the library visible in the view layer so realize works, then drop it
def lc_find(lc, name):
    if lc.collection.name == name:
        return lc
    for ch in lc.children:
        r = lc_find(ch, name)
        if r:
            return r
lcl = lc_find(vl.layer_collection, "_LIB")
if lcl:
    lcl.exclude = False

inst = [o for o in sc.objects if o.type == "EMPTY" and o.instance_type == "COLLECTION" and o.instance_collection and o not in lib_objs]
log("instancers", len(inst))
before = set(sc.objects)
select(inst)
bpy.ops.object.duplicates_make_real(use_base_parent=False, use_hierarchy=False)
new = [o for o in sc.objects if o not in before]
for o in new:
    o["ph"] = 1
log("realized", len(new))
for o in inst:
    bpy.data.objects.remove(o)
for o in list(lib_objs):
    bpy.data.objects.remove(o)
if lib:
    for ch in list(lib.children_recursive):
        bpy.data.collections.remove(ch)
    bpy.data.collections.remove(lib)
for o in list(sc.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o)

# fonts -> meshes, apply modifiers + transforms
fonts = [o for o in sc.objects if o.type == "FONT"]
select(fonts)
bpy.ops.object.convert(target="MESH")
meshes = [o for o in sc.objects if o.type == "MESH"]
select(meshes)
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.ops.object.convert(target="MESH")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
log("meshes", len(meshes))

# decimate heavy Poly Haven props for real-time use
DECI = {"potted_plant_02_pot": 0.08, "potted_plant_01_pot": 0.12, "concrete_road_barrier": 0.2, "Bar Chair": 0.3,
        "cardboard_box_01": 0.25, "plastic_crate_01": 0.3, "security_camera_01": 0.25, "steel_frame_shelves_02": 0.6,
        "modular_street_seating_supports": 0.35, "modular_street_seating_connectors": 0.3, "wooden_display_shelves_01": 0.8,
        "outdoor_table_chair_set_01_chair": 0.5, "CashRegister_01": 0.5, "metal_trash_can": 0.6}
for o in [o for o in sc.objects if o.type == "MESH" and o.get("ph")]:
    mats = [m.name for m in o.data.materials if m]
    r = min([DECI.get(n, 1.0) for n in mats] + [1.0])
    if r < 1.0 and len(o.data.polygons) > 3000:
        md = o.modifiers.new("dec", "DECIMATE"); md.ratio = r; md.use_collapse_triangulate = True
        select([o]); bpy.ops.object.modifier_apply(modifier="dec")

# split multi-material objects
multi = [o for o in sc.objects if o.type == "MESH" and len([m for m in o.data.materials if m]) > 1]
if multi:
    select(multi)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
meshes = [o for o in sc.objects if o.type == "MESH" and len(o.data.polygons)]
for o in [o for o in sc.objects if o.type == "MESH" and not len(o.data.polygons)]:
    bpy.data.objects.remove(o)
log("after split", len(meshes))

# ---------------------------------------------------------------- classify
TILED = {"floor_marble": 1.5, "plaster_white": 1.0, "plaster_warm": 1.5, "planter_stone": 1.2, "pavement": 2.0}
GLASS = {"glass_clean", "glass_sky", "glass_shard", "CashRegister_01_glass", "korean_fire_extinguisher_01_glass",
         "security_camera_01_glass"}
ALPHA = {"potted_plant_01_leaves", "potted_plant_02_leaves", "korean_fire_extinguisher_01_paper"}


def mat_of(o):
    return o.data.materials[0] if o.data.materials else None


def kind(m):
    if m is None:
        return "opaque"
    n = m.name
    if n in GLASS:
        return "glass"
    if n in ALPHA:
        return "alpha"
    if n in ("downlight", "panel_light", "kiosk_sign") or n.startswith("sign_"):
        return "emit"
    return "opaque"


def coll_name(o):
    return o.users_collection[0].name if o.users_collection else ""


def zc(o):
    zs = [v.co.z for v in o.data.vertices]
    return (min(zs) + max(zs)) / 2


# tiled UVs (box projection in object = world space) + ensure UV layer names
for o in meshes:
    me = o.data
    m = mat_of(o)
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    me.uv_layers[0].name = "UVMap"
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    if m and m.name in TILED:
        s = TILED[m.name]
        bm = bmesh.new(); bm.from_mesh(me)
        uv = bm.loops.layers.uv[0]
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    u, v = c.y * (1 if n.x > 0 else -1), c.z
                elif ax == 1:
                    u, v = c.x * (-1 if n.y > 0 else 1), c.z
                else:
                    u, v = c.x, c.y * (1 if n.z > 0 else -1)
                l[uv].uv = (u / s, v / s)
        bm.to_mesh(me); bm.free()

# split the big floor box along store fronts / unit boundaries so culling can drop hidden parts
fl = bpy.data.objects["Floor"]
bm = bmesh.new(); bm.from_mesh(fl.data)
for x in (-11.0, 11.0):
    g = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=g, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
for y in (-3, 6, 15, 24, 33, 42, 51):
    g = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=g, plane_co=(0, y, 0), plane_no=(0, 1, 0))
bm.to_mesh(fl.data); bm.free()

# ---------------------------------------------------------------- chunk assignment
chunks = {}
for o in meshes:
    k = kind(mat_of(o))
    cn = coll_name(o)
    if k != "opaque":
        ch = {"glass": "glass", "alpha": "plants", "emit": "emit"}[k]
    elif o.name == "Outside":
        ch = "outside"
    elif o.name == "Floor":
        ch = "floor"
    elif o.get("ph"):
        ch = "props"
    elif o.name.startswith("Paper"):
        ch = "propbox"
    elif cn in ("Arch", "Lights"):
        ch = "arch"
    elif cn == "Stores":
        ch = "store0" if zc(o) < 4.6 else "store1"
    else:
        ch = "propbox"
    if k == "alpha":
        ch = "plants"
    chunks.setdefault(ch, []).append(o)
log({k: len(v) for k, v in chunks.items()})

# ---------------------------------------------------------------- hidden face culling (static architecture)
occ = [o for ch in ("floor", "arch", "store0", "store1", "outside") for o in chunks.get(ch, [])
       if not o.name.startswith("Paper")]
verts, polys = [], []
for o in occ:
    base = len(verts)
    verts += [v.co.copy() for v in o.data.vertices]
    polys += [[base + i for i in p.vertices] for p in o.data.polygons]
bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
log("occluder polys", len(polys))

SHUT = {(1, 0): (4, 7), (-1, 0): (0, 5), (1, 1): (0, 3, 6), (-1, 1): (1, 4, 7)}
UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62]
vps = []
def frange(a, b, s):
    x = a
    while x <= b + 1e-6:
        yield x; x += s
for x in frange(-10.5, 10.5, 1.5):
    for y in frange(-11.4, 61.5, 1.5):
        for z in (0.9, 1.7):
            vps.append(Vector((x, y, z)))
for s in (-1, 1):
    for x in frange(5.0, 10.5, 1.4):
        for y in frange(-11.4, 61.5, 1.5):
            vps.append(Vector((s * x, y, 6.7)))
    for lvl in (0, 1):
        for k in range(8):
            if k in SHUT[(s, lvl)]:
                continue
            for x in frange(11.6, 16.4, 1.2):
                for y in frange(UNIT_B[k] + 0.5, UNIT_B[k + 1] - 0.5, 1.5):
                    vps.append(Vector((s * x, y, 1.7 + 5.0 * lvl)))
for (ya, yb) in ((26.0, 29.5), (44.66, 48.2)):
    for x in frange(-4.0, 4.0, 1.0):
        for y in frange(ya + 0.4, yb - 0.4, 0.8):
            vps.append(Vector((x, y, 6.7)))
for t in frange(0, 1, 0.1):
    for xc in (-0.75, 0.75):
        vps.append(Vector((xc, 36 + 8.66 * t, 5 * t + 1.7)))
log("viewpoints", len(vps))


def visible(p, n):
    p = p + n * 0.004
    cand = [v for v in vps if (v - p).dot(n) > 0.0]
    random.shuffle(cand)
    for v in cand[:900]:
        d = v - p
        L = d.length
        hit = bvh.ray_cast(p, d / L, L)
        if hit[0] is None:
            return True
    return False


culled_total = 0
for ch in ("floor", "arch", "store0", "store1"):
    for o in chunks.get(ch, []):
        if o.name.startswith("Paper"):
            continue
        me = o.data
        bm = bmesh.new(); bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        dead = []
        for f in bm.faces:
            n = f.normal.copy()
            if n.length < 0.5:
                continue
            c = f.calc_center_median()
            pts = [c] + [c.lerp(v.co, 0.85) for v in f.verts[:4]]
            if not any(visible(p, n) for p in pts):
                dead.append(f)
        if dead:
            bmesh.ops.delete(bm, geom=dead, context="FACES")
            culled_total += len(dead)
        bm.to_mesh(me); bm.free()
    log("culled", ch, culled_total)
for ch in list(chunks):
    keep = []
    for o in chunks[ch]:
        if len(o.data.polygons) == 0:
            bpy.data.objects.remove(o)
        else:
            keep.append(o)
    chunks[ch] = keep

fl = bpy.data.objects.get("Floor")
if fl:
    select([fl])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    nsel = 0
    for p in fl.data.polygons:
        c = p.center
        p.select = not (abs(c.x) <= 11.0 and p.normal.z > 0.9)
        nsel += p.select
    log("floor non-concourse faces", nsel)
    bpy.ops.object.mode_set(mode="EDIT")
    if nsel:
        bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in vl.objects:
        if o.name.startswith("Floor.") and o.type == "MESH":
            chunks["arch"].append(o)

# ---------------------------------------------------------------- join chunks + lightmap UVs
DENS = {"arch": 22, "store0": 18, "store1": 9, "propbox": 45, "outside": 3}
VCOL = {"props", "plants"}
info = {}
for ch, objs in chunks.items():
    if not objs:
        continue
    select(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = vl.objects.active
    ob.name = "CH_" + ch
    me = ob.data
    me.name = "CH_" + ch
    area = sum(p.area for p in me.polygons)
    info[ch] = {"tris": sum(len(p.vertices) - 2 for p in me.polygons), "area": round(area, 1)}
    if ch == "floor":
        lm = me.uv_layers.new(name="LM")
        uvd = lm.data
        for p in me.polygons:
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvd[li].uv = ((co.x + 11.0) / 22.0, (co.y + 12.0) / 74.0)
        info[ch].update(res=[1280, 4096], texel_per_m=round(4096 / 74, 1))
    if ch in VCOL:
        me.color_attributes.new("LMV", "FLOAT_COLOR", "POINT")
        info[ch].update(vcol=True, verts=len(me.vertices))
    if ch in DENS:
        need = area * DENS[ch] ** 2 / 0.62
        res = 512
        while res * res < need and res < 4096:
            res *= 2
        lm = me.uv_layers.new(name="LM")
        me.uv_layers.active = lm
        me.uv_layers["UVMap"].active_render = True
        select([ob])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.pack_islands(rotate=True, margin_method="FRACTION", margin=5.0 / res, shape_method="CONCAVE")
        bpy.ops.object.mode_set(mode="OBJECT")
        # utilisation estimate
        uv = me.uv_layers["LM"].data
        uarea = 0.0
        for p in me.polygons:
            pts = [uv[i].uv for i in p.loop_indices]
            a = 0.0
            for i in range(len(pts)):
                x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % len(pts)]
                a += x0 * y1 - x1 * y0
            uarea += abs(a) / 2
        dens = math.sqrt(uarea * res * res / max(area, 1e-6))
        info[ch].update(res=res, uv_fill=round(uarea, 3), texel_per_m=round(dens, 1))
    log(ch, info[ch])

json.dump(info, open(os.path.join(ROOT, "logs", "game_prep_info.json"), "w"), indent=1, ensure_ascii=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blend", "game_prep.blend"), compress=True)
log("SAVED")
