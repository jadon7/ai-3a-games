"""导入导出的 GLB，确认里面带骨架动画。用法: Blender -b --factory-startup -P scripts/blender/check_glb.py -- <file.glb>"""
import sys
import bpy
path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
acts = [(a.name, tuple(round(v) for v in a.frame_range)) for a in bpy.data.actions]
print("GLB_CHECK", path.split("/")[-1], "| bones", len(arm.data.bones), "| actions", acts,
      "| meshes", sum(1 for o in bpy.context.scene.objects if o.type == "MESH"))
