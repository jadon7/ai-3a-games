"""导入带骨骼/动画的 glTF，打印结构，并从多个角度渲染若干帧。
blender -b --factory-startup -P inspect_rig.py -- <gltf> <out_prefix> [frames=1,20,40] [views=front,back,left,top]
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
frames = [int(f) for f in argv[2].split(",")] if len(argv) > 2 else [1]
views = argv[3].split(",") if len(argv) > 3 else ["front", "back", "left", "top"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scn = bpy.context.scene

print("FPS", scn.render.fps, "RANGE", scn.frame_start, scn.frame_end)
for o in scn.objects:
    if o.type in ("ARMATURE", "CAMERA", "LIGHT"):
        print("OBJ", o.type, o.name, "parent", o.parent.name if o.parent else None, "loc", [round(v, 3) for v in o.matrix_world.translation], "bones", len(o.data.bones) if o.type == "ARMATURE" else "")
for o in scn.objects:
    if o.type == "MESH":
        print("MESH", o.name, "dims", [round(v, 3) for v in o.dimensions], "verts", len(o.data.vertices), "mats", [m.name for m in o.data.materials if m], "parent", o.parent.name if o.parent else None)
for a in bpy.data.actions:
    print("ACTION", a.name, [round(v, 1) for v in a.frame_range])
for o in scn.objects:
    if o.type == "ARMATURE":
        print("BONES", o.name, [b.name for b in o.data.bones][:120])
        ad = o.animation_data
        if ad:
            print("  active action", ad.action.name if ad.action else None, "nla", [(t.name, [s.name for s in t.strips]) for t in ad.nla_tracks])


def bbox(frame):
    scn.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in scn.objects:
        if o.type != "MESH" or o.name.startswith("Icosphere"):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        step = max(1, len(me.vertices) // 3000)
        for vi in range(0, len(me.vertices), step):
            v = me.vertices[vi]
            w = ev.matrix_world @ v.co
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
        ev.to_mesh_clear()
    return mn, mx


mn, mx = bbox(frames[0])
print("BBOX", [round(v, 3) for v in mn], [round(v, 3) for v in mx], "DIMS", [round(v, 3) for v in (mx - mn)])
cen = (mn + mx) / 2; rad = (mx - mn).length / 2

w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.85, 0.9, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scn.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))

scn.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"; prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == "METAL")
scn.cycles.device = "GPU"; scn.cycles.samples = 24; scn.cycles.use_denoising = True
scn.render.resolution_x = 640; scn.render.resolution_y = 640
scn.render.image_settings.file_format = "JPEG"
scn.view_settings.view_transform = "Standard"

cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scn.collection.objects.link(cam)
cd.lens = 50; cd.clip_start = 0.001; cd.clip_end = 10000
scn.camera = cam
dirs = {"front": (0, -1, 0.15), "back": (0, 1, 0.15), "left": (-1, 0, 0.15), "right": (1, 0, 0.15), "top": (0, -0.01, 1), "tq": (0.7, -0.7, 0.4)}
for f in frames:
    scn.frame_set(f)
    for v in views:
        d = Vector(dirs[v]).normalized()
        cam.location = cen + d * rad * 2.6
        cam.rotation_euler = (cen - cam.location).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = f"{out}_f{f}_{v}.jpg"
        bpy.ops.render.render(write_still=True)
print("DONE")
