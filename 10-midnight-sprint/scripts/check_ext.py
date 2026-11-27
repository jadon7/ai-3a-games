import bpy
ext = [(i.name, i.filepath) for i in bpy.data.images if i.source in {"FILE", "SEQUENCE", "MOVIE"} and not i.packed_file and i.filepath]
print("@@ images", len(bpy.data.images), "unpacked", len(ext))
for e in ext[:20]:
    print("@@  ", e)
print("@@ libraries", [l.filepath for l in bpy.data.libraries])
print("@@ fonts", [(f.name, f.filepath) for f in bpy.data.fonts if not f.packed_file])
