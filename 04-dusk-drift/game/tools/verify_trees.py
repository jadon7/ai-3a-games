# 导入减面树 GLB + 公告板，用天空光渲染预览： Blender -b -P verify_trees.py -- <trees目录> <hdr> name[,name] <输出jpg前缀>
import bpy, sys, os, math, json
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
TD, HDR, NAMES, OUTP = argv[0], argv[1], argv[2].split(','), argv[3]
info = json.load(open(os.path.join(TD, 'trees.json')))
for nm in NAMES:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    I = info[nm]
    bpy.ops.import_scene.gltf(filepath=os.path.join(TD, nm + '.glb'))
    tree = [o for o in sc.objects if o.type == 'MESH'][0]
    print('TREE', nm, 'name', tree.name, 'dims', [round(v, 2) for v in tree.dimensions], 'loc', [round(v, 2) for v in tree.location], 'rot', [round(v, 3) for v in tree.rotation_euler], 'mats', [(m.name, m.use_backface_culling) for m in tree.data.materials], 'tris', sum(len(p.vertices) - 2 for p in tree.data.polygons))
    H = I['height']; Wd = I['cardWidthM']
    # 公告板放在右边对比
    gap = max(Wd, 2 * I['crownRadius']) * 1.15
    for k, (key, wkey) in enumerate((('card', 'cardWidthM'), ('cardB', 'cardBWidthM'))):
        bpy.ops.mesh.primitive_plane_add(size=1)
        pl = bpy.context.active_object
        pl.scale = (I[wkey], I['cardHeightM'], 1); pl.rotation_euler = (math.radians(90), 0, 0)
        pl.location = (gap * (k + 1), 0, I['cardHeightM'] / 2)
        m = bpy.data.materials.new('card'); m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(TD, I[key]))
        m.node_tree.links.new(t.outputs['Color'], b.inputs['Base Color']); m.node_tree.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
        b.inputs['Roughness'].default_value = 0.8
        pl.data.materials.append(m)
    ENG = argv[4] if len(argv) > 4 else 'CYCLES'
    if ENG == 'EEVEE':
        for e in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
            try:
                sc.render.engine = e; break
            except TypeError:
                pass
        print('engine', sc.render.engine)
        try:
            sc.eevee.taa_render_samples = 32
            sc.eevee.use_shadows = True
        except Exception as ex:
            print('eevee opt', ex)
    else:
        sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('gpu fail', e)
    sc.cycles.samples = 64; sc.cycles.use_denoising = True; sc.cycles.transparent_max_bounces = 32
    sc.render.resolution_x = 1500; sc.render.resolution_y = 700
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 85
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    nt = w.node_tree; bg = nt.nodes['Background']
    env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDR)
    nt.links.new(env.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.5
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.use_shadow = not (len(argv) > 5 and argv[5] == 'noshadow')
    sun.data.energy = 3.0; sun.data.color = (1, 0.8, 0.6); sun.rotation_euler = (math.radians(70), 0, math.radians(40))
    bpy.ops.mesh.primitive_plane_add(size=400)
    g = bpy.context.active_object
    gm = bpy.data.materials.new('g'); gm.use_nodes = True
    next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.09, 0.12, 0.05, 1)
    g.data.materials.append(gm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = gap * 3.2
    cx = gap
    cam.location = (cx, -80, H * 0.5 + 6); 
    tgt = Vector((cx, 0, H * 0.48))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = OUTP + nm + '.jpg'
    bpy.ops.render.render(write_still=True)
