"""Convert Sparta (LOD1) into the game's part-based frame GLB.

models/sparta.glb:
  * plain node hierarchy (empties, no armature, no skin)
  * joints: pelvis waist head hip_L/R knee_L/R ankle_L/R sh_L/R el_L/R
            skirt_FL/FR/SL/SR/BL/BR pauldron_L/R mount_* (weapon hard points)
  * meshes named <joint>_m<KEY>; KEY A = armour, B = joint hardware
  * 18 m tall, front -Z, right arm +X, no inherited scale (all node offsets in metres)
"""
import bpy, bmesh, os, math
RETOPO = False
LOWPOLY = False
QUAD = False
QUAD_FACES = 1100
from mathutils import Vector, Matrix

SRC = os.environ.get("SPARTA_SOURCE", "path/to/Sparta_hard6.blend")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "models", "sparta_lowpoly.glb" if LOWPOLY else "sparta.glb")
HEIGHT = 18.0
RETOPO_TARGET = 62000

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene

# --- rest pose --------------------------------------------------------------
arm = [o for o in scene.objects if o.type == 'ARMATURE'][0]
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

meshes = {o.name: o for o in scene.objects if o.type == 'MESH'}
for nm in list(meshes):
    if nm.endswith("_fist") or nm.endswith("_open"):
        bpy.data.objects.remove(meshes.pop(nm), do_unlink=True)

# --- unparent every mesh, keep its world transform ---------------------------
world = {}
for nm, o in meshes.items():
    w = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = w
    world[nm] = w
bpy.context.view_layer.update()

# --- delete everything that is not a mesh (cams, empties, armature) ---------
for o in list(scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()

S = HEIGHT / 1.0598
M = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(S, 4)

# --- joint skeleton (blender world, metres before M) ------------------------
J = {
    "pelvis":  (0.000, 0.000, 0.545),
    "waist":   (0.000, 0.000, 0.662),
    "head":    (0.000, 0.005, 0.890),
    "sh_L":    (0.165, 0.015, 0.805), "sh_R": (-0.165, 0.015, 0.805),
    "el_L":    (0.190, 0.020, 0.704), "el_R": (-0.190, 0.020, 0.704),
    "hip_L":   (0.085, 0.000, 0.545), "hip_R": (-0.085, 0.000, 0.545),
    "knee_L":  (0.095, 0.000, 0.377), "knee_R": (-0.095, 0.000, 0.377),
    "ankle_L": (0.125, -0.020, 0.110), "ankle_R": (-0.125, -0.020, 0.110),
    "skirt_FL": (0.060, -0.085, 0.648), "skirt_FR": (-0.060, -0.085, 0.648),
    "skirt_SL": (0.120, -0.010, 0.648), "skirt_SR": (-0.120, -0.010, 0.648),
    "skirt_BL": (0.060, 0.040, 0.648), "skirt_BR": (-0.060, 0.040, 0.648),
    "pauldron_L": (0.150, 0.010, 0.870), "pauldron_R": (-0.150, 0.010, 0.870),

}
PARENT = {
    "pelvis": None, "waist": "pelvis", "head": "waist",
    "sh_L": "waist", "sh_R": "waist", "el_L": "sh_L", "el_R": "sh_R",
    "hip_L": "pelvis", "hip_R": "pelvis", "knee_L": "hip_L", "knee_R": "hip_R",
    "ankle_L": "knee_L", "ankle_R": "knee_R",
    "skirt_FL": "pelvis", "skirt_FR": "pelvis", "skirt_SL": "pelvis",
    "skirt_SR": "pelvis", "skirt_BL": "pelvis", "skirt_BR": "pelvis",
    "pauldron_L": "waist", "pauldron_R": "waist",
}
RIDE = {
    "pelvis": "pelvis",
    "chest_upper": "waist", "waist": "waist", "head": "head",
    "upper_arm_L": "sh_L", "elbow_L": "sh_L", "forearm_L": "el_L", "hand_L": "el_L",
    "upper_arm_R": "sh_R", "elbow_R": "sh_R", "forearm_R": "el_R", "hand_R": "el_R",
    "thigh_L": "hip_L", "knee_L": "knee_L", "shin_L": "knee_L",
    "ankle_L": "ankle_L", "foot_L": "ankle_L",
    "thigh_R": "hip_R", "knee_R": "knee_R", "shin_R": "knee_R",
    "ankle_R": "ankle_R", "foot_R": "ankle_R",
    "skirt_L": "skirt_SL", "skirt_R": "skirt_SR",
    "shoulder_pod_R": "pauldron_R", "shoulder_armor_L": "pauldron_L",
}


# --- helpers ----------------------------------------------------------------

def drop_small_islands(o, min_faces=60):
    """game side: kill the mm-scale decal/panel flakes; the armour shader draws its own seams"""
    import bmesh as _bm
    bm = _bm.new()
    bm.from_mesh(o.data)
    seen = set()
    removed = 0
    for f in bm.faces:
        if f in seen:
            continue
        stack = [f]; seen.add(f); comp = []
        while stack:
            cf = stack.pop(); comp.append(cf)
            for e in cf.edges:
                for nf in e.link_faces:
                    if nf not in seen:
                        seen.add(nf); stack.append(nf)
        if len(comp) < min_faces:
            _bm.ops.delete(bm, geom=comp, context='FACES')
            removed += len(comp)
    if removed:
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            _bm.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return removed
def split_by_material(o):
    if len(o.data.materials) < 2:
        return [(o, 0)]
    idxs = sorted({p.material_index for p in o.data.polygons})
    out = []
    for k, mi in enumerate(idxs):
        piece = o if k == 0 else o.copy()
        if k > 0:
            piece.data = o.data.copy()
            scene.collection.objects.link(piece)
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        bm.faces.ensure_lookup_table()
        bad = [f for f in bm.faces if f.material_index != mi]
        if bad:
            bmesh.ops.delete(bm, geom=bad, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(piece.data)
        bm.free()
        piece.data.update()
        out.append((piece, mi))
    return out


def split_x(o, side):
    mw = o.matrix_world.copy()
    piece = o.copy()
    piece.data = o.data.copy()
    scene.collection.objects.link(piece)
    bm = bmesh.new()
    bm.from_mesh(piece.data)
    bm.faces.ensure_lookup_table()
    bad = [f for f in bm.faces if ((mw @ f.calc_center_median()).x > 0) != (side > 0)]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(piece.data)
    bm.free()
    piece.data.update()
    piece.matrix_world = mw
    return piece


# --- make the mesh pieces ---------------------------------------------------
work = []
for nm, o in meshes.items():
    if nm == "skirt_front":
        other = split_x(o, -1)
        for side, piece in ((1, o), (-1, other)):
            for p, mi in split_by_material(piece):
                work.append((p, "skirt_FL" if side > 0 else "skirt_FR", "A" if mi == 0 else "B"))
    elif nm == "skirt_back":
        other = split_x(o, -1)
        for side, piece in ((1, o), (-1, other)):
            for p, mi in split_by_material(piece):
                work.append((p, "skirt_BL" if side > 0 else "skirt_BR", "A" if mi == 0 else "B"))
    else:
        ride = RIDE.get(nm, "waist")
        for p, mi in split_by_material(o):
            work.append((p, ride, "A" if mi == 0 else "B"))
print("pieces:", len(work))
if not RETOPO:
    _removed = 0
    for _o, _ride, _key in work:
        _removed += drop_small_islands(_o, 12)
    print("dropped micro-shell faces:", _removed)

# --- bake M into the mesh data, park the object on its joint -----------------
# free up the joint names (source meshes still hold them)
for o in [x for x in scene.objects if x.type == 'MESH']:
    o.name = "src_" + o.name

frame = bpy.data.objects.new("sparta_frame", None)
scene.collection.objects.link(frame)
frame.matrix_world = Matrix.Identity(4)
empties = {}
for name in J:
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    empties[name] = e
for name, par in PARENT.items():
    empties[name].parent = empties[par] if par else frame
    empties[name].matrix_world = Matrix.Translation(M @ Vector(J[name]))

# --- weapon hard points: offsets copied from the stock frame's rig ----------
def g2b(gx, gy, gz):
    return Vector((gx, -gz, gy))

MOUNTS = {
    "mount_hand_R":  ("el_R",  (0.30, -3.04, -0.97), -60.0),
    "mount_hand_L":  ("el_L",  (-0.30, -3.04, -0.97), -60.0),
    "mount_arm_R":   ("el_R",  (0.90, -1.70, 0.0), 0.0),
    "mount_arm_L":   ("el_L",  (-0.90, -1.70, 0.0), 0.0),
    "mount_blade_R": ("el_R",  (0.0, -1.90, 0.90), 0.0),
    "mount_blade_L": ("el_L",  (0.0, -1.90, 0.90), 0.0),
    "mount_back_R":  ("waist", (2.00, 4.00, 0.45), 0.0),
    "mount_back_L":  ("waist", (-2.00, 4.00, 0.45), 0.0),
}
for nm, (par, off, rot_x) in MOUNTS.items():
    e = bpy.data.objects.new(nm, None)
    scene.collection.objects.link(e)
    e.parent = empties[par]
    base = Matrix.Translation(M @ Vector(J[par]))
    e.matrix_world = base @ Matrix.Translation(g2b(*off))
    if abs(rot_x) > 0.01:
        e.rotation_mode = 'XYZ'
        e.rotation_euler = (math.radians(rot_x), 0.0, 0.0)
    empties[nm] = e
print("mounts:", len(MOUNTS))
# --- sole nodes: the game derives foot height from them (ankle -> sole) -----
FOOT_H = 0.110 * S          # our ankle joint sits this high above the ground
for sd in ("L", "R"):
    e = bpy.data.objects.new("sole_" + sd, None)
    scene.collection.objects.link(e)
    e.parent = empties["ankle_" + sd]
    e.matrix_world = empties["ankle_" + sd].matrix_world @ Matrix.Translation(Vector((0, 0, -FOOT_H)))
    empties["sole_" + sd] = e
print("sole nodes at", round(FOOT_H, 2), "m below the ankle")
# --- joint overlap: stretch thin connector shells so bent joints never show a gap
for o, ride, key in work:
    if ride.split("_")[0] not in ("knee", "elbow", "ankle", "el"):
        continue
    bb = [Vector(c) for c in o.bound_box]
    zmin = min(v.z for v in bb)
    zmax = max(v.z for v in bb)
    if (zmax - zmin) < 0.075:                     # short piece = the joint collar (blender units)
        c = (zmin + zmax) * 0.5
        o.data.transform(Matrix.Translation(Vector((0, 0, c))) @
                         Matrix.Diagonal(Vector((1.02, 1.02, 1.35, 1.0))) @
                         Matrix.Translation(Vector((0, 0, -c))))
        print("   overlap", o.name, round(zmax - zmin, 2), "->", )

for o, ride, key in work:
    piv = o.matrix_world.translation.copy()
    o.data.transform(M)                            # rotate 180 about Z + scale
    o.data.transform(Matrix.Translation(M @ piv))  # vertices stay in MODEL space
    o.parent = empties[ride]
    o.matrix_world = Matrix.Identity(4)            # node offset compensates
    o.name = f"{ride}_m{key}"

print("meshes done:", len(work))
# --- WAIST_STRETCH: pull the waist shell down so it overlaps the skirt -------
WAIST_STRETCH = 1.22
for o, ride, key in work:
    if ride != "waist":
        continue
    me = o.data
    zs = [v.co.z for v in me.vertices]
    if not zs:
        continue
    zmin, zmax = min(zs), max(zs)
    if zmax - zmin < 0.2:
        continue
    for v in me.vertices:
        v.co.z = zmax - (zmax - v.co.z) * WAIST_STRETCH
    me.update()
    print("WAIST_STRETCH", o.name, round(zmin,2), "->", round(zmax - (zmax - zmin) * WAIST_STRETCH, 2))
# --- QUAD retopo: voxel seal -> QuadriFlow quad remesh ----------------------
if QUAD:
    bpy.ops.object.select_all(action='DESELECT')
    for o, _ride, _key in work:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.data.remesh_voxel_size = 0.055
        o.data.remesh_voxel_adaptivity = 0.0
        o.data.use_remesh_fix_poles = True
        try:
            bpy.ops.object.voxel_remesh()
        except Exception as e:
            print("voxel failed", o.name, e)
        try:
            bpy.ops.object.quadriflow_remesh(
                use_mesh_symmetry=False,
                use_preserve_sharp=True,
                use_preserve_boundary=False,
                smooth_normals=True,
                mode='FACES',
                target_faces=QUAD_FACES,
                seed=0,
            )
        except Exception as e:
            print("quadriflow failed", o.name, e)
        o.data.validate(verbose=False)
        o.select_set(False)
    print("quad tris:", sum(len(o.data.polygons) for o, _, _ in work))
# --- LOWPOLY: rebuild every part as a clean lofted hard-surface box ----------
if LOWPOLY:
    import collections
    groups = collections.defaultdict(list)
    for _o, _ride, _key in work:
        groups[_ride].append(_o)
    for ride, pieces in list(groups.items()):
        pts = []
        for pcs in pieces:
            mw = pcs.matrix_world
            for v in pcs.data.vertices:
                pts.append(mw @ v.co)
        zs = [p.z for p in pts]
        z0, z1 = min(zs), max(zs)
        if z1 - z0 < 1e-5:
            continue
        N = 4
        rings = []
        for i in range(N):
            zt = z0 + (z1 - z0) * (i / (N - 1.0))
            band = [p for p in pts if abs(p.z - zt) <= (z1 - z0) * 0.16 + 1e-6]
            if not band:
                band = pts
            cx = (min(p.x for p in band) + max(p.x for p in band)) * 0.5
            cy = (min(p.y for p in band) + max(p.y for p in band)) * 0.5
            hx = max(1e-3, (max(p.x for p in band) - min(p.x for p in band)) * 0.5)
            hy = max(1e-3, (max(p.y for p in band) - min(p.y for p in band)) * 0.5)
            rings.append((zt, cx, cy, hx, hy))
        me = bpy.data.meshes.new("loft_" + ride)
        bm = bmesh.new()
        vs = []
        for (zt, cx, cy, hx, hy) in rings:
            quad = [bm.verts.new((cx - hx, cy - hy, zt)),
                    bm.verts.new((cx + hx, cy - hy, zt)),
                    bm.verts.new((cx + hx, cy + hy, zt)),
                    bm.verts.new((cx - hx, cy + hy, zt))]
            vs.append(quad)
        for i in range(len(vs) - 1):
            a, b = vs[i], vs[i + 1]
            for k in range(4):
                bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
        bm.faces.new(vs[0][::-1])
        bm.faces.new(vs[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
        obj = bpy.data.objects.new(ride + "_mA", me)
        scene.collection.objects.link(obj)
        obj.matrix_world = Matrix.Identity(4)
        bev = obj.modifiers.new("bev", 'BEVEL')
        bev.width = 0.012
        bev.segments = 2
        bev.limit_method = 'ANGLE'
        bev.angle_limit = math.radians(35)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=bev.name)
        except Exception as e:
            print("bevel failed", ride, e)
        obj.select_set(False)
        # replace the scan pieces
        for pcs in pieces:
            bpy.data.objects.remove(pcs, do_unlink=True)
        groups[ride] = [(obj, ride, "A")]
    work = [item for ride in groups for item in groups[ride]]
    print("lowpoly parts:", len(work), "tris:", sum(len(o.data.polygons) for o, _, _ in work))
# --- retopo: per-part voxel remesh -> watertight closed shells ---------------
if RETOPO:
    bpy.ops.object.select_all(action='DESELECT')
    for o, _ride, _key in work:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.data.remesh_voxel_size = 0.140
        o.data.remesh_voxel_adaptivity = 0.0
        o.data.use_remesh_fix_poles = True
        try:
            bpy.ops.object.voxel_remesh()
        except Exception as e:
            print("remesh failed", o.name, e)
        o.select_set(False)
    tb = bmesh.new()
    for o, _ride, _key in work:
        tb.from_mesh(o.data)
        bmesh.ops.triangulate(tb, faces=tb.faces[:])
        tb.to_mesh(o.data)
        tb.clear()
        o.data.update()
    tb.free()
    tot = sum(len(o.data.polygons) for o, _, _ in work)
    ratio = 1.0
    print("remeshed tris:", tot, "-> decimate ratio", round(ratio, 4))
    for o, _ride, _key in work:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new("dec", 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=m.name)
        o.select_set(False)
    for o, _ride, _key in work:
        o.data.validate(verbose=False)
        o.data.update()
    tot2 = sum(len(o.data.polygons) for o, _, _ in work)
    print("retopo tris:", tot2)
# --- weld the shredded micro-patches into continuous shells (kills ink noise) --
_weld_total = 0
for o, _ride, _key in work:
    bmw = bmesh.new()
    bmw.from_mesh(o.data)
    n0 = len(bmw.verts)
    bmesh.ops.remove_doubles(bmw, verts=bmw.verts[:], dist=0.0012)
    n1 = len(bmw.verts)
    bmw.to_mesh(o.data)
    bmw.free()
    o.data.update()
    _weld_total += (n0 - n1)
print("welded verts:", _weld_total)
def cap_holes(o):
    bmh = bmesh.new()
    bmh.from_mesh(o.data)
    bnd = [e for e in bmh.edges if len(e.link_faces) == 1]
    if not bnd:
        bmh.free()
        return 0
    try:
        bmesh.ops.holes_fill(bmh, edges=bnd, sides=0)
    except Exception:
        pass
    bmesh.ops.recalc_face_normals(bmh, faces=bmh.faces[:])
    left = [e for e in bmh.edges if len(e.link_faces) == 1]
    bmh.to_mesh(o.data)
    bmh.free()
    o.data.update()
    return len(bnd) - len(left)

_capped = 0
for o, _ride, _key in work:
    _capped += cap_holes(o)
print("capped holes (boundary edges):", _capped)

# --- close every remaining boundary: fan fill, then Blender's fill_holes ----
def fill_loops_fan(o):
    """close every boundary: holes_fill -> triangle_fill (surface conforming) -> fan."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    made = 0
    for _round in range(3):
        bnd = [e for e in bm.edges if len(e.link_faces) == 1]
        if not bnd:
            break
        before = len(bm.faces)
        try:
            bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
        except Exception:
            pass
        bnd = [e for e in bm.edges if len(e.link_faces) == 1]
        if bnd:
            try:
                bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=bnd)
            except Exception:
                pass
        bnd = [e for e in bm.edges if len(e.link_faces) == 1]
        if bnd:
            bset = set(bnd)
            while bset:
                e0 = next(iter(bset))
                verts = [e0.verts[0], e0.verts[1]]
                bset.discard(e0)
                while True:
                    tail = verts[-1]
                    nxt = None
                    for e in list(bset):
                        if tail in e.verts:
                            nxt = e
                            break
                    if nxt is None:
                        break
                    bset.discard(nxt)
                    other = nxt.other_vert(tail)
                    if other == verts[0]:
                        break
                    verts.append(other)
                if len(verts) >= 3:
                    c = Vector((0, 0, 0))
                    for v in verts:
                        c += v.co
                    c /= len(verts)
                    cv = bm.verts.new(c)
                    n = len(verts)
                    for k in range(n):
                        try:
                            bm.faces.new((verts[k], verts[(k + 1) % n], cv))
                        except ValueError:
                            pass
        made += max(0, len(bm.faces) - before)
        if len(bm.faces) == before:
            break
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return made


def orient_islands(o):
    """flip islands whose faces point inward (the scan has inconsistent normals)"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    flipped = 0
    for f in bm.faces:
        if f.index in seen:
            continue
        stack = [f]
        comp = []
        seen.add(f.index)
        while stack:
            cf = stack.pop()
            comp.append(cf)
            for e in cf.edges:
                for nf in e.link_faces:
                    if nf.index not in seen:
                        seen.add(nf.index)
                        stack.append(nf)
        vol = 0.0
        for cf in comp:
            vol += cf.normal.dot(cf.calc_center_median()) * cf.calc_area() / 3.0
        if vol < 0.0:
            for cf in comp:
                cf.normal_flip()
            flipped += len(comp)
    if flipped:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return flipped


_flip_total = 0
for o, _ride, _key in work:
    _bw = bmesh.new()
    _bw.from_mesh(o.data)
    bmesh.ops.remove_doubles(_bw, verts=_bw.verts[:], dist=0.004)
    _bw.to_mesh(o.data)
    _bw.free()
    o.data.update()
    fill_loops_fan(o)
    _flip_total += orient_islands(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o],
                                   selected_editable_objects=[o], mode='OBJECT'):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.fill_holes(sides=0)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    o.select_set(False)

_open_total = 0
for o, _ride, _key in work:
    _b = bmesh.new()
    _b.from_mesh(o.data)
    _open_total += sum(1 for e in _b.edges if len(e.link_faces) == 1)
    _b.free()
print("closure done | flipped inward faces:", _flip_total, "| open edges left:", _open_total)
# --- no filler volumes: gaps are closed by stretching the shells themselves ---
# --- joint sleeves: closed cylinders so a bent joint never shows the open shell
SLEEVES = [
    ("knee_L", 0.62, 1.70), ("knee_R", 0.62, 1.70),
    ("el_L", 0.52, 1.60), ("el_R", 0.52, 1.60),
    ("ankle_L", 0.50, 1.50), ("ankle_R", 0.50, 1.50),
]
SLEEVE_NAMES = []
for jn, rad, dep in SLEEVES:
    me_s = bpy.data.meshes.new("sleeve_" + jn)
    bms = bmesh.new()
    bmesh.ops.create_cone(bms, cap_ends=True, cap_tris=True, segments=18,
                          radius1=rad, radius2=rad, depth=dep,
                          matrix=Matrix.Rotation(math.radians(90), 4, 'Y'))
    bms.to_mesh(me_s)
    bms.free()
    so = bpy.data.objects.new(jn + "_mA", me_s)
    scene.collection.objects.link(so)
    so.parent = empties[jn]
    so.matrix_world = Matrix.Translation(empties[jn].matrix_world.translation)
    SLEEVE_NAMES.append(so.name)
    print("sleeve", so.name, rad, dep)
# --- inner shells: one dark inset copy per part (gaps show a dark interior) --
_inner_mat = bpy.data.materials.new("SpartaInner")
_inner_mat.use_nodes = True
for _n in _inner_mat.node_tree.nodes:
    if _n.type == 'BSDF_PRINCIPLED':
        _n.inputs["Base Color"].default_value = (0.015, 0.015, 0.017, 1.0)
        _n.inputs["Roughness"].default_value = 0.85
        _n.inputs["Metallic"].default_value = 0.2
for _nm in SLEEVE_NAMES:
    _ob = bpy.data.objects.get(_nm)
    if _ob is not None:
        _ob.data.materials.clear()
        _ob.data.materials.append(_inner_mat)
_inner_count = 0
for _o, _ride, _key in list(work):
    if _key != "A" or _ride.startswith("skirt"):
        continue
    _me2 = _o.data.copy()
    _me2.name = _o.name + "_inner"
    _ob2 = bpy.data.objects.new(_ride + "_mT", _me2)
    scene.collection.objects.link(_ob2)
    _ob2.parent = empties[_ride]
    _ob2.matrix_world = Matrix.Identity(4)
    # inset about this part's own centre
    if _me2.vertices:
        _xs = [v.co.x for v in _me2.vertices]
        _ys = [v.co.y for v in _me2.vertices]
        _zs = [v.co.z for v in _me2.vertices]
        _c = Vector(((min(_xs) + max(_xs)) * 0.5,
                     (min(_ys) + max(_ys)) * 0.5,
                     (min(_zs) + max(_zs)) * 0.5))
        _k3 = 0.82
        for _v in _me2.vertices:
            _v.co = _c + (_v.co - _c) * _k3
        _me2.update()
    if len(_me2.polygons) < 400:
        bpy.data.objects.remove(_ob2, do_unlink=True)
        continue
    _me2.materials.clear()
    _me2.materials.append(_inner_mat)
    _inner_count += 1
print("inner shells:", _inner_count)


# --- shading + vertex colours (R shade, G dust, B edge-wear) ----------------
import numpy as _np
for o, ride, key in work:
    me = o.data
    if not me.color_attributes:
        ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
        me.color_attributes.active_color = ca
    ca = me.color_attributes[0]
    n = len(me.vertices)
    nr = _np.empty(n * 3, dtype=_np.float32)
    me.vertices.foreach_get("normal", nr)
    nr = nr.reshape(n, 3)
    up = _np.clip(nr[:, 2], -1.0, 1.0)
    cols = _np.zeros((n, 4), dtype=_np.float32)
    cols[:, 0] = 0.55 + 0.35 * (up * 0.5 + 0.5)
    cols[:, 1] = 0.16 + 0.30 * _np.clip(up, 0.0, 1.0)
    cols[:, 2] = 0.12
    cols[:, 3] = 1.0
    ca.data.foreach_set("color", cols.ravel())
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(70))
    except Exception:
        bpy.ops.object.shade_smooth()
print("shading + vertex colours done")
# --- laplacian smoothing: the scan's facet noise drives the game's ink lines --
for o, _ride, _key in work:
    bml = bmesh.new()
    bml.from_mesh(o.data)
    bmesh.ops.smooth_vert(bml, verts=bml.verts[:], factor=0.42, use_axis_x=True,
                          use_axis_y=True, use_axis_z=True)
    bml.to_mesh(o.data)
    bml.free()
    o.data.update()
print("laplacian smoothing applied")
# --- visor card removed: the model texture already paints the visor ---------

# --- export -----------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = frame
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_apply=False, export_yup=True,
    export_animations=False, export_materials='EXPORT',
)
print("exported", OUT, round(os.path.getsize(OUT) / 1024 / 1024, 2), "MB")
print("joints:", len(J), "SPARTA EXPORT DONE")
















































