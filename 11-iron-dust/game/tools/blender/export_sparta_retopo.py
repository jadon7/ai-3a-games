"""UV-preserving export of the Sparta frame for the game.

Why this exists: the model's PBR textures are bound to its ORIGINAL UVs. Every remesh /
planar dissolve / weld pass destroys them, so any "repaired" mesh samples the atlas
wrongly (camouflage blotches, zebra bands). This exporter therefore does NOT touch the
geometry: it only

  * applies the 180 deg yaw + 18 m scale to the vertex positions (UVs untouched)
  * builds the joint hierarchy the game expects (empties, hard points, soles)
  * adds an inset dark inner shell per part (no UVs needed) so seams never show sky
  * exports with materials (3 embedded PNGs)

Run: blender -b --factory-startup --python sparta_uv_export.py
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

SRC = os.environ.get("SPARTA_SOURCE", "path/to/Sparta_hard6.blend")
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "models", "sparta.glb")
HEIGHT = 18.0

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
meshes = {o.name: o for o in scene.objects if o.type == 'MESH'
          and not o.name.endswith(('_fist', '_open'))}
for o in meshes.values():
    o.parent = None
    o.matrix_world = Matrix.Translation(o.matrix_world.translation)
for o in list(scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)

S = HEIGHT / 1.0598
M = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(S, 4)

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
    "pauldron_L": "waist", "pauldron_R": "waist",
    "skirt_FL": "pelvis", "skirt_FR": "pelvis", "skirt_SL": "pelvis",
    "skirt_SR": "pelvis", "skirt_BL": "pelvis", "skirt_BR": "pelvis",
}
RIDE = {
    "pelvis": "pelvis", "chest_upper": "waist", "waist": "waist", "head": "head",
    "upper_arm_L": "sh_L", "elbow_L": "sh_L", "forearm_L": "el_L", "hand_L": "el_L",
    "upper_arm_R": "sh_R", "elbow_R": "sh_R", "forearm_R": "el_R", "hand_R": "el_R",
    "thigh_L": "hip_L", "knee_L": "knee_L", "shin_L": "knee_L", "ankle_L": "ankle_L", "foot_L": "ankle_L",
    "thigh_R": "hip_R", "knee_R": "knee_R", "shin_R": "knee_R", "ankle_R": "ankle_R", "foot_R": "ankle_R",
    "skirt_L": "skirt_SL", "skirt_R": "skirt_SR",
    "shoulder_pod_R": "pauldron_R", "shoulder_armor_L": "pauldron_L",
}

for o in meshes.values():
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

# mounts (stock-rig offsets, hand socket compensated for our lowered aim elbow)
def g2b(gx, gy, gz):
    return Vector((gx, -gz, gy))

MOUNTS = {
    "mount_hand_R":  ("el_R", (0.30, -3.04, -0.97), -60.0),
    "mount_hand_L":  ("el_L", (-0.30, -3.04, -0.97), -60.0),
    "mount_arm_R":   ("el_R", (0.90, -1.70, 0.0), 0.0),
    "mount_arm_L":   ("el_L", (-0.90, -1.70, 0.0), 0.0),
    "mount_blade_R": ("el_R", (0.0, -1.90, 0.90), 0.0),
    "mount_blade_L": ("el_L", (0.0, -1.90, 0.90), 0.0),
    "mount_back_R":  ("waist", (2.00, 4.00, 0.45), 0.0),
    "mount_back_L":  ("waist", (-2.00, 4.00, 0.45), 0.0),
}
for nm, (par, off, rot_x) in MOUNTS.items():
    e = bpy.data.objects.new(nm, None)
    scene.collection.objects.link(e)
    e.parent = empties[par]
    e.matrix_world = empties[par].matrix_world @ Matrix.Translation(g2b(*off))
    if abs(rot_x) > 0.01:
        e.rotation_mode = 'XYZ'
        e.rotation_euler = (math.radians(rot_x), 0.0, 0.0)
    empties[nm] = e

# soles (the game derives foot height from them)
FOOT_H = 0.110 * S
for sd in ("L", "R"):
    e = bpy.data.objects.new("sole_" + sd, None)
    scene.collection.objects.link(e)
    e.parent = empties["ankle_" + sd]
    e.matrix_world = empties["ankle_" + sd].matrix_world @ Matrix.Translation(Vector((0, 0, -FOOT_H)))

# attach the original meshes: positions changed, UVs untouched
inner = bpy.data.materials.new("SpartaInner")
inner.use_nodes = True
for nd in inner.node_tree.nodes:
    if nd.type == 'BSDF_PRINCIPLED':
        nd.inputs["Base Color"].default_value = (0.015, 0.015, 0.017, 1.0)
        nd.inputs["Roughness"].default_value = 0.85
        nd.inputs["Metallic"].default_value = 0.2

count = 0
for nm, o in meshes.items():
    ride = RIDE.get(nm)
    if ride is None:
        continue
    piv = o.matrix_world.translation.copy()
    o.data.transform(M)
    o.data.transform(Matrix.Translation(M @ piv))
    o.parent = empties[ride]
    o.matrix_world = Matrix.Identity(4)
    o.name = ride + "_mA"
    count += 1
    # inset dark inner shell (its own copy, no UV needed)
    me2 = o.data.copy()
    me2.name = o.name + "_inner"
    ob2 = bpy.data.objects.new(ride + "_mT", me2)
    scene.collection.objects.link(ob2)
    ob2.parent = empties[ride]
    ob2.matrix_world = Matrix.Identity(4)
    xs = [v.co.x for v in me2.vertices]
    ys = [v.co.y for v in me2.vertices]
    zs = [v.co.z for v in me2.vertices]
    c = Vector(((min(xs) + max(xs)) * .5, (min(ys) + max(ys)) * .5, (min(zs) + max(zs)) * .5))
    for v in me2.vertices:
        v.co = c + (v.co - c) * 0.93
    me2.update()
    me2.materials.clear()
    me2.materials.append(inner)

print("attached", count, "parts +", count, "inner shells")

bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = frame
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True, export_apply=False,
    export_yup=True, export_animations=False, export_materials='NONE',
)
print("exported", OUT, round(os.path.getsize(OUT) / 1024 / 1024, 2), "MB")


