import bpy, sys, os, math
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
for p in (os.path.join(ROOT, 'common'), os.path.join(ROOT, 'assets', 'char')):
    sys.path.insert(0, p)
import scene_common as sc, build_chibi as BC, cranes as CR
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
sc.setup_anime(scene, res=(960, 540), samples=16, motion_blur=False)
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.25, 0.5, 0.95, 1)
BC.MATS.clear()
CR.add_cranes(BC, scene, (0, 0, 0), (1, 0, 0), 12.0, 1, 40, 30, count=5, seed=1)
cd = bpy.data.cameras.new('c'); cd.lens = 35; cam = bpy.data.objects.new('c', cd); scene.collection.objects.link(cam); scene.camera = cam
for i, f in enumerate((1, 6, 12)):
    scene.frame_set(f)
    t = (f - 1) / 30
    tgt = Vector((12 * t - 2.5, 0, 0)); pos = tgt + Vector((7, -7, 2.5))
    cam.location = pos; cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(ROOT, 'tests', f'crane_{i}.png')
    bpy.ops.render.render(write_still=True)
print('CRANE OK')
