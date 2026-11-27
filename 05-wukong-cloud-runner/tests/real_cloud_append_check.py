"""验证：把 clouds_real.blend 的集合 append 到另一个目录下的 blend 后，VDB 相对路径仍然有效。"""
import bpy, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, '_append_check.blend'))
src = os.path.join(ROOT, 'assets', 'clouds', 'clouds_real.blend')
with bpy.data.libraries.load(src, link=False) as (a, b):
    b.collections = [c for c in a.collections if c in ('CLOUDSEA', 'HAZE', 'JDY')]
for c in b.collections:
    bpy.context.scene.collection.children.link(c)
    print('COLL', c.name, [o.name for o in c.objects])
bpy.context.scene.frame_set(7)
for v in bpy.data.volumes:
    ok = v.grids.load()
    print('VOL', v.name, v.filepath, 'loaded=%s grids=%d' % (ok, len(v.grids)), 'seq=%s' % v.is_sequence, os.path.basename(v.grids.frame_filepath))
