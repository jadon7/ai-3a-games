"""把每个顶点按权重混出来的骨骼颜色渲染出来，看哪块肉归哪根骨骼（头、面具、肩上的小骨头和树枝有没有绑错）。
用法: Blender -b --factory-startup -P weight_view.py -- <glb> <输出前缀> [只看这根骨骼的权重（黑到白）]
产出: <前缀>_{front,side,back,q}.png。模型原始朝向 +X。
"""
import bpy, math, sys
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]; solo = argv[2] if len(argv) > 2 else None
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
mesh = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
for o in list(sc.objects):
    if o.type == "MESH" and o is not mesh: bpy.data.objects.remove(o, do_unlink=True)
COL = {"Hips": (0.55, 0.55, 0.55), "Spine": (1, 0.85, 0), "Spine1": (1, 0.5, 0), "Spine2": (0.9, 0.1, 0.1), "Neck": (1, 0, 1), "Head": (1, 1, 1), "HeadTop_End": (1, 1, 1),
       "Shoulder": (0, 0.9, 0.9), "Arm": (0.1, 0.3, 1), "ForeArm": (0.3, 1, 0.3), "Hand": (0.6, 0.2, 0.9), "UpLeg": (0.2, 0.6, 0.2), "Leg": (0.9, 0.6, 0.8), "Foot": (0.3, 0.2, 0.1), "ToeBase": (0.9, 0.9, 0.5)}


def color(name):
    s = name.split(":")[-1]; right = s.startswith("Right"); s = s.replace("Left", "").replace("Right", "")
    if s.startswith("Hand"): s = "Hand"
    c = np.array(COL.get(s, (0, 0, 0)), float)
    return c * (0.55 if right else 1.0)                           # 右边的同名骨骼暗一档


gname = {g.index: g.name for g in mesh.vertex_groups}; n = len(mesh.data.vertices); vc = np.zeros((n, 3))
for v in mesh.data.vertices:
    tot = sum(g.weight for g in v.groups) or 1.0
    for g in v.groups:
        nm = gname[g.group]
        if solo: vc[v.index] += (g.weight / tot) * (np.ones(3) if nm.split(":")[-1] == solo else np.zeros(3))
        else: vc[v.index] += (g.weight / tot) * color(nm)
attr = mesh.data.color_attributes.new("wcol", "FLOAT_COLOR", "POINT")
attr.data.foreach_set("color", np.concatenate([vc, np.ones((n, 1))], 1).ravel())
mat = bpy.data.materials.new("w"); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
o_ = nt.nodes.new("ShaderNodeOutputMaterial"); e_ = nt.nodes.new("ShaderNodeEmission"); a_ = nt.nodes.new("ShaderNodeVertexColor"); a_.layer_name = "wcol"
d_ = nt.nodes.new("ShaderNodeBsdfDiffuse"); mx = nt.nodes.new("ShaderNodeMixShader"); mx.inputs[0].default_value = 0.35
nt.links.new(a_.outputs[0], e_.inputs[0]); nt.links.new(a_.outputs[0], d_.inputs[0]); nt.links.new(e_.outputs[0], mx.inputs[1]); nt.links.new(d_.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], o_.inputs[0])
mesh.data.materials.clear(); mesh.data.materials.append(mat)
V = np.array([(mesh.matrix_world @ v.co)[:] for v in mesh.data.vertices]); c0 = (V.min(0) + V.max(0)) / 2; size = float((V.max(0) - V.min(0)).max()) * 1.1
sc.render.engine = "BLENDER_EEVEE"; w = bpy.data.worlds.new("w"); w.use_nodes = True
bg = next(x for x in w.node_tree.nodes if x.type == "BACKGROUND"); bg.inputs[0].default_value = (0.25, 0.25, 0.28, 1); sc.world = w
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(60)); sc.collection.objects.link(sun)
sc.render.resolution_x = sc.render.resolution_y = 900; sc.render.image_settings.file_format = "PNG"
try: sc.view_settings.view_transform = "Standard"
except TypeError: pass
for name, az, el in (("front", 0, 5), ("side", 90, 5), ("back", 180, 10), ("q", 40, 25), ("top", 0, 85)):
    a, e = math.radians(az), math.radians(el); d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))       # 机位在 +X 一侧（正面）
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); cam.data.type = "ORTHO"; cam.data.ortho_scale = size
    cam.location = Vector(c0) + d * 5; cam.rotation_euler = (-d).to_track_quat("-Z", "Z" if el < 80 else "X").to_euler(); sc.collection.objects.link(cam); sc.camera = cam
    sc.render.filepath = f"{out}_{name}.png"; bpy.ops.render.render(write_still=True)
print("RENDERED", out)
