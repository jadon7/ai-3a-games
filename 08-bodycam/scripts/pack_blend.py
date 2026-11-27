import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("PACKED", out)
