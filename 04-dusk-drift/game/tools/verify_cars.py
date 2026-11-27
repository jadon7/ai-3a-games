# 新开空场景重新导入 GLB，核对节点/尺寸/朝向并渲染缩略图
#   Blender -b -P verify_cars.py -- <cars目录> <hdr路径> [id,id]
import bpy, sys, os, math, json
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
CARS_DIR, HDR = argv[0], argv[1]
IDS = argv[2].split(',') if len(argv) > 2 else ['e30', 'capri', 'stratos']
SUFFIX = argv[3] if len(argv) > 3 else ''
for cid in IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=os.path.join(CARS_DIR, cid + '.glb'))
    bpy.context.view_layer.update()
    tops = sorted(o.name for o in sc.objects if o.parent is None)
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in sc.objects:
        if o.type == 'MESH':
            for c in o.bound_box:
                v = o.matrix_world @ Vector(c)
                for i in range(3):
                    mn[i] = min(mn[i], v[i]); mx[i] = max(mx[i], v[i])
    W = {k: sc.objects['wheel_' + k].matrix_world.translation for k in ('FL', 'FR', 'RL', 'RR')}
    # Blender 坐标：glTF +Z(车头) = Blender -Y；glTF +X(左) = Blender +X
    ok_front = W['FL'].y < W['RL'].y and W['FR'].y < W['RR'].y
    ok_left = W['FL'].x > 0 > W['FR'].x and W['RL'].x > 0 > W['RR'].x
    rots = [o.name for o in sc.objects if o.parent is None and (abs(o.rotation_quaternion.w - 1) > 1e-5 if o.rotation_mode == 'QUATERNION' else any(abs(a) > 1e-5 for a in o.rotation_euler)) or any(abs(s - 1) > 1e-5 for s in o.scale)]
    print('VERIFY', cid, 'tops', tops, 'front+Z', ok_front, 'left+X', ok_left, 'bbox(m) X', round(mn.x, 3), round(mx.x, 3), 'len(-Y..Y)', round(mn.y, 3), round(mx.y, 3), 'Z', round(mn.z, 3), round(mx.z, 3), 'nonidentity', rots,
          'wheels', {k: [round(v, 3) for v in W[k]] for k in W})
    # 渲染
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('gpu fail', e)
    sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.render.resolution_x = 960; sc.render.resolution_y = 540
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; bg = nt.nodes['Background']
    env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDR)
    nt.links.new(env.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.6
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=60)
    g = bpy.context.active_object
    gm = bpy.data.materials.new('g'); gm.use_nodes = True
    b = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.08, 0.08, 0.085, 1); b.inputs['Roughness'].default_value = 0.35
    g.data.materials.append(gm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 55
    views = {'': Vector((3.6, -5.6, 1.5)), '_rear': Vector((-3.4, 5.8, 1.7)), '_side': Vector((7.5, 0.0, 0.9))}
    tgt = Vector((0, 0, 0.55))
    for suf, pos in views.items():
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(CARS_DIR, f'preview_{cid}{suf}{SUFFIX}.jpg')
        bpy.ops.render.render(write_still=True)
