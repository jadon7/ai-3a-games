"""第 1 步：导入 AI 生成的悟空 GLB，统一尺度与朝向，输出体检信息和多角度预览。
用法：Blender -b -P import_glb.py -- <glb> <out.blend> [height_m=1.45] [yaw_deg=0]
约定：脚底 z=0，面朝 +X（飞行方向），物体名 WK_Body，父物体 WK_ROOT。
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'common'))
import scene_common as sc

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out_blend = argv[0], argv[1]
height = float(argv[2]) if len(argv) > 2 else 1.45
yaw = float(argv[3]) if len(argv) > 3 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('IMPORTED meshes:', [(o.name, len(o.data.vertices), len(o.data.polygons)) for o in meshes])
# 合并成一个网格
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'WK_Body'
# 清父级并应用变换
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o != body:
        bpy.data.objects.remove(o)

co = np.empty(len(body.data.vertices) * 3, dtype=np.float32)
body.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
print('RAW bbox min', mn, 'max', mx, 'size', mx - mn)
s = height / (mx[2] - mn[2])
cx, cy = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
M = Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -mn[2]))
body.data.transform(M)
body.data.update()
co = np.empty(len(body.data.vertices) * 3, dtype=np.float32)
body.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3)
print('FINAL bbox min', co.min(0), 'max', co.max(0))
for p in body.data.polygons:
    p.use_smooth = True

root = bpy.data.objects.new('WK_ROOT', None)
bpy.context.scene.collection.objects.link(root)
body.parent = root
col = bpy.data.collections.new('WUKONG')
bpy.context.scene.collection.children.link(col)
for o in (root, body):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)

mat = body.data.materials[0] if body.data.materials else None
if mat:
    print('MATERIAL nodes:', [(n.type, n.name) for n in mat.node_tree.nodes])
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            print('  image', n.image.name, tuple(n.image.size), n.image.colorspace_settings.name,
                  '->', [l.to_socket.name for o_ in n.outputs for l in o_.links])
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=out_blend)

# 预览：4 个角度
scene = bpy.context.scene
sc.setup_render(scene, res=(720, 900), samples=48, motion_blur=False)
sc.setup_world(scene)
cam_d = bpy.data.cameras.new('c'); cam_d.lens = 70
cam = bpy.data.objects.new('c', cam_d); scene.collection.objects.link(cam); scene.camera = cam
target = Vector((0, 0, height * 0.52))
tests = os.path.join(sc.ROOT, 'tests')
tag = os.path.splitext(os.path.basename(out_blend))[0]
for name, ang in (('front', 0), ('side', 90), ('back', 180), ('q', 140)):
    a = math.radians(ang)
    pos = target + Vector((math.cos(a), -math.sin(a), 0.12)) * 4.2
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(tests, f'char_{tag}_{name}.png')
    bpy.ops.render.render(write_still=True)
print('DONE')
