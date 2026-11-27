"""制作拆解图：Cycles 剖视（房间外墙背面透明，可以看进内部）。blender -b blend/shot.blend -P breakdown.py -- <outdir>"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import look_at_euler, enable_gpu
out = sys.argv[sys.argv.index("--") + 1]; os.makedirs(out, exist_ok=True)
scn = bpy.context.scene
enable_gpu(scn)
scn.cycles.samples = 96
scn.render.resolution_x, scn.render.resolution_y, scn.render.resolution_percentage = 1920, 1080, 100
scn.render.use_motion_blur = False
scn.render.image_settings.file_format = "JPEG"; scn.render.image_settings.quality = 93
scn.view_settings.view_transform = "Standard"; scn.view_settings.exposure = 0.2
# 扫描房间：从外面看到的背面改成透明
for m in bpy.data.materials:
    if m.get("env_emission_node") and m.use_nodes:
        nt = m.node_tree
        outn = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        src = outn.inputs["Surface"].links[0].from_socket
        geo = nt.nodes.new("ShaderNodeNewGeometry"); tp = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(geo.outputs["Backfacing"], mx.inputs[0]); nt.links.new(src, mx.inputs[1]); nt.links.new(tp.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], outn.inputs["Surface"])
# 背景换成中性灰
w = scn.world; nt = w.node_tree
bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
for l in list(bg.inputs["Color"].links): nt.links.remove(l)
for l in list(bg.inputs["Strength"].links): nt.links.remove(l)
bg.inputs["Color"].default_value = (0.16, 0.17, 0.19, 1); bg.inputs["Strength"].default_value = 1.0
for o in bpy.data.objects:
    if o.name.startswith(("ExtGround",)):
        o.hide_render = True
cd = bpy.data.cameras.new("bd"); cam = bpy.data.objects.new("bd", cd); scn.collection.objects.link(cam); scn.camera = cam
cd.lens = 32; cd.clip_start = 0.1; cd.clip_end = 300
for name, f, pos, tgt in (("layout_a", 97, (29.0, -6.5, 10.5), (20.0, 2.6, 1.0)), ("layout_b", 150, (11.5, -4.5, 6.5), (19.5, 2.8, 0.9)), ("top", 97, (20.6, 2.75, 15.5), (20.6, 2.8, 0.0))):
    scn.frame_set(f)
    cam.location = pos; cam.rotation_euler = look_at_euler(pos, tgt)
    scn.render.filepath = os.path.join(out, name + ".jpg")
    bpy.ops.render.render(write_still=True)
print("BREAKDOWN DONE")
