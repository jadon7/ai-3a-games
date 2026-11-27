import bpy, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index('--') + 1])
for o in bpy.context.scene.objects:
    print('OBJ', o.type, o.name, 'parent', o.parent.name if o.parent else None, 'loc', tuple(round(v, 3) for v in o.location), 'rot', tuple(round(v, 2) for v in o.rotation_euler), 'scale', tuple(round(v, 3) for v in o.scale), 'dim', tuple(round(v, 2) for v in o.dimensions))
    if o.type == 'MESH':
        print('   verts', len(o.data.vertices), 'faces', len(o.data.polygons), 'vgroups', len(o.vertex_groups), 'mods', [m.type for m in o.modifiers], 'mats', [m.name for m in o.data.materials])
    if o.type == 'ARMATURE':
        bs = o.data.bones
        print('   bones', len(bs))
        for b in bs:
            h = o.matrix_world @ b.head_local; t = o.matrix_world @ b.tail_local
            print('   B', b.name, '| parent', b.parent.name if b.parent else None, '| head', tuple(round(v, 3) for v in h), 'tail', tuple(round(v, 3) for v in t))
print('ACTIONS', [a.name for a in bpy.data.actions])
