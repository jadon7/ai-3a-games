import bpy, sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import scene_common as sc
bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
sun = sc.setup_anime(s, res=(1920, 1080), samples=32)
print('ENGINE', s.render.engine, 'EEVEE props:', [p.identifier for p in s.eevee.bl_rna.properties if not p.is_readonly][:60])
bpy.ops.mesh.primitive_plane_add(size=60)
bpy.ops.mesh.primitive_monkey_add(location=(0, 0, 1.2))
m = bpy.data.materials.new('m'); m.use_nodes = True
bpy.context.object.data.materials.append(m)
cd = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cd); s.collection.objects.link(cam); s.camera = cam
cam.location = (5, -5, 3); cam.rotation_euler = (1.15, 0, 0.785)
s.render.filepath = os.path.join(sc.ROOT, 'tests', 'eevee_bg_test.png')
t = time.time(); bpy.ops.render.render(write_still=True); print('RENDER1 %.2fs' % (time.time() - t))
t = time.time(); bpy.ops.render.render(write_still=True); print('RENDER2 %.2fs' % (time.time() - t))
