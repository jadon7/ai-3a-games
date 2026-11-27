"""看 Tripo 出的模型：六个角度全身 + 脸、两只手、马尾的近景。用法: Blender -b --factory-startup -P model_views.py -- <glb> <输出前缀>"""
import bpy, sys, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]; src, pre = argv[:2]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src); sc = bpy.context.scene
ms = [o for o in sc.objects if o.type == "MESH"]
co = np.concatenate([np.array([o.matrix_world @ v.co for v in o.data.vertices]) for o in ms]); mn, mx = co.min(0), co.max(0)
print("BBOX", mn.round(3), mx.round(3), "verts", len(co), "objs", [o.name for o in ms], "mats", [s.material.name for o in ms for s in o.material_slots])
for o in ms:
    for s in o.material_slots:
        for n in s.material.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image: print("TEX", s.material.name, n.image.name, n.image.size[:], n.outputs[0].links[0].to_socket.name if n.outputs[0].links else "-")
up = int(np.argmax(mx - mn)) ; H = (mx - mn)[up]; c = Vector(((mn + mx) / 2).tolist())
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"
wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.2
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
UPV = Vector((0, 0, 1)) if up == 2 else Vector((0, 1, 0))
import os
fw = Vector([float(v) for v in os.environ.get("FW", "0,-1,0").split(",")])      # 面朝哪边（Tripo 原始模型是 +X，摆正后是 -Y）
side = fw.cross(UPV)
def shot(name, target, d, osz, rx, ry):
    cam.location = target + d.normalized() * 5; cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (d.normalized() + UPV * 0.8 + side * 0.4).to_track_quat("Z", "Y").to_euler()
    cam.data.ortho_scale = osz; sc.render.resolution_x = rx; sc.render.resolution_y = ry; sc.render.filepath = f"{pre}_{name}.png"; bpy.ops.render.render(write_still=True)
for i, az in enumerate((0, 45, 90, 135, 180, 270)):
    a = math.radians(az); d = fw * math.cos(a) + side * math.sin(a) + UPV * 0.1; shot(f"a{az}", c, d, H * 1.05, 600, 800)
top = c + UPV * (H * 0.43)
shot("face", top, fw + UPV * 0.05, H * 0.16, 700, 700)
shot("face_side", top, side + fw * 0.2, H * 0.22, 700, 700)
shot("ponytail", top - UPV * H * 0.05, -fw + side * 0.4, H * 0.32, 700, 700)
for s_, sg in (("handL", 1), ("handR", -1)):
    # 手的位置：A 字站姿，手在两侧胯的高度附近，找那一带最靠外的顶点
    sel = co[np.abs(co[:, up] - (mn[up] + H * 0.5)) < H * 0.1]; ax = np.dot(sel, np.array(side)) * sg; p = sel[np.argmax(ax)]
    shot(s_, Vector(p.tolist()) - side * sg * 0.03 * H, fw + UPV * 0.15, H * 0.14, 700, 700)
print("DONE")
