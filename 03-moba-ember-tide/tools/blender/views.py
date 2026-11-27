"""无界面渲染一个 GLB 的多角度检查图（正、侧、背、斜、游戏俯视），拼成一张。
用法: Blender -b --factory-startup -P tools/blender/views.py -- in.glb out.png [每格边长=640] [角度列表，如 0,90,180,35:56]
角度写成 “水平角[:俯角]”，水平角 0 是从 -Y 往 +Y 看（glTF 导入后角色通常面朝 -Y）。
"""
import bpy, sys, math, os
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
res = int(argv[2]) if len(argv) > 2 else 640
views = argv[3] if len(argv) > 3 else "0,90,180,35:20,0:56"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]      # 导入带骨骼的 glTF 时会自动生成一个当骨骼形状用的球，不算进画面范围
for o in sc.objects:
    if o.type == "MESH" and o.name.startswith("Icosphere"): o.hide_render = True
tris = 0; mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in meshes:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
size = mx - mn; center = (mn + mx) / 2
print("MESHES", [(o.name, len(o.data.loop_triangles), len(o.vertex_groups)) for o in meshes], "TRIS", tris)
print("SIZE", [round(v, 3) for v in size], "MIN", [round(v, 3) for v in mn], "MAX", [round(v, 3) for v in mx])
for o in meshes:
    for s in o.material_slots:
        m = s.material
        if m and m.node_tree:
            print("MAT", m.name, [(n.image.name, n.image.size[:]) for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image])
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b: print("  metallic", b.inputs["Metallic"].default_value, "linked", b.inputs["Metallic"].is_linked, "rough", b.inputs["Roughness"].default_value, "linked", b.inputs["Roughness"].is_linked)
for a in [o for o in sc.objects if o.type == "ARMATURE"]:
    print("ARMATURE", a.name, len(a.data.bones), "scale", [round(v, 3) for v in a.scale], "rot", [round(v, 3) for v in a.rotation_euler])
    for n in ("mixamorig:Hips", "mixamorig:Head", "mixamorig:LeftHand", "mixamorig:RightHand", "mixamorig:LeftFoot", "mixamorig:HeadTop_End"):
        b = a.data.bones.get(n)
        if b: print("  ", n, [round(v, 3) for v in (a.matrix_world @ b.head_local)])
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = max(size) * 1.12
files = []
for i, v in enumerate(views.split(",")):
    az, el = (v.split(":") + ["8"])[:2]; az = math.radians(float(az)); el = math.radians(float(el))
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = center + d * max(size) * 4
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    f = f"{os.path.splitext(out)[0]}_{i}.png"; sc.render.filepath = f; bpy.ops.render.render(write_still=True); files.append(f)
print("FILES", " ".join(files))
