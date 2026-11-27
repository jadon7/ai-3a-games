"""看图转 3D 的原始模型：六个角度 + 脸 + 手的特写，打印贴图信息。
用法: Blender -b --factory-startup -P look_raw.py -- <模型.glb> <输出前缀> [分辨率=720]"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; src, pre = argv[0], argv[1]; res = int(argv[2]) if len(argv) > 2 else 720
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
meshes = [o for o in sc.objects if o.type == "MESH"]
for o in meshes:
    me = o.data; me.calc_loop_triangles()
    print("MESH", o.name, "verts", len(me.vertices), "tris", len(me.loop_triangles), "mats", [m.name for m in me.materials])
for m in bpy.data.materials:
    if not m.node_tree: continue
    for nd in m.node_tree.nodes:
        if nd.type == "TEX_IMAGE" and nd.image:
            links = [l.to_socket.name + "@" + l.to_node.name for l in nd.outputs[0].links]
            print("TEX", m.name, nd.image.name, tuple(nd.image.size), links)
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
print("BBOX", [round(v, 3) for v in mn], [round(v, 3) for v in mx])
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1); wd.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3.0
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
c = (mn + mx) / 2; H = max(mx - mn)
# 上轴：Tripo 导入后 z 向上
up = 2
shots = [("front", 0, 0, c, H * 1.05), ("q45", 45, 10, c, H * 1.05), ("side", 90, 0, c, H * 1.05), ("back", 180, 0, c, H * 1.05), ("side_l", 270, 0, c, H * 1.05), ("top", 0, 60, c, H * 1.05)]
hz = mx.z - (mx.z - mn.z) * 0.1
shots.append(("face", 0, 5, Vector((c.x, c.y, hz)), H * 0.2))
shots.append(("face45", 40, 5, Vector((c.x, c.y, hz)), H * 0.2))
for name, az, el, ctr, osz in shots:
    az, el = math.radians(az), math.radians(el)
    # Tripo 原始模型面朝 +Y？两个方向都拍到了（front 和 back），看图判断
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.data.ortho_scale = osz; cam.location = ctr + d * 6; cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    sc.render.filepath = f"{pre}_{name}.png"; bpy.ops.render.render(write_still=True)
print("DONE")
