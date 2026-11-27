"""导入一个 glb，打印层级/尺寸/材质，并渲染两张预览。
blender -b --factory-startup -P inspect_glb.py -- <glb> <out_prefix> [tree_depth]
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out = argv[0], argv[1]
depth_max = int(argv[2]) if len(argv) > 2 else 3

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene

meshes = [o for o in sc.objects if o.type == "MESH"]
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
size = mx - mn; ctr = (mx + mn) / 2
print(f"@@ objects={len(sc.objects)} meshes={len(meshes)} tris={sum(len(o.data.polygons) for o in meshes)}")
print(f"@@ bbox min={tuple(round(v,3) for v in mn)} max={tuple(round(v,3) for v in mx)} size={tuple(round(v,3) for v in size)}")
print(f"@@ materials={len(bpy.data.materials)} images={len(bpy.data.images)} anims={len(bpy.data.actions)}")


def tree(o, d=0):
    if d > depth_max:
        return
    dims = tuple(round(v, 2) for v in o.dimensions)
    loc = tuple(round(v, 2) for v in o.matrix_world.translation)
    mats = [s.material.name for s in o.material_slots if s.material][:4] if o.type == "MESH" else ""
    nv = len(o.data.vertices) if o.type == "MESH" else ""
    print("@@ " + "  " * d + f"{o.name} [{o.type}] loc={loc} dim={dims} v={nv} {mats} ch={len(o.children)}")
    for c in o.children[:60]:
        tree(c, d + 1)


for o in sc.objects:
    if o.parent is None:
        tree(o)
for m in bpy.data.materials:
    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.node_tree else None
    if b:
        tex = [n.image.name for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image][:3]
        bc = tuple(round(v, 2) for v in b.inputs["Base Color"].default_value[:3])
        print(f"@@ mat {m.name}: col={bc} metal={b.inputs['Metallic'].default_value:.2f} rough={b.inputs['Roughness'].default_value:.2f} tex={tex}")

# 预览渲染
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.35, 0.37, 0.42, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun)
sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
R = max(size) * 1.6
try:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 960, 540
sc.render.image_settings.file_format = "JPEG"
for i, (az, el) in enumerate([(35, 18), (215, 25)]):
    a, e = math.radians(az), math.radians(el)
    cam.location = ctr + Vector((R * math.cos(e) * math.cos(a), R * math.cos(e) * math.sin(a), R * math.sin(e)))
    d = ctr - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = R * 10; cam.data.clip_start = R / 500
    sc.render.filepath = f"{out}_{i}.jpg"
    bpy.ops.render.render(write_still=True)
