"""正式渲染（可断点续渲）：blender -b blend/shot.blend -P render_range.py -- <outdir> <frames: a-b[:step] 或 a,b,c> <pct> <spp>
输出线性 EXR（DWAA 压缩），已存在的帧跳过。
"""
import bpy, sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import enable_gpu
argv = sys.argv[sys.argv.index("--") + 1:]
out, spec, pct, spp = argv[0], argv[1], int(argv[2]), int(argv[3])
if "-" in spec:
    r, _, st = spec.partition(":")
    a, b = int(r.split("-")[0]), int(r.split("-")[1])
    frames = list(range(a, b + 1, int(st or 1))) if a <= b else list(range(a, b - 1, -int(st or 1)))
else:
    frames = [int(x) for x in spec.split(",")]
scn = bpy.context.scene
enable_gpu(scn)
scn.cycles.samples = spp
scn.render.resolution_percentage = pct
scn.render.use_motion_blur = True
im = scn.render.image_settings
im.file_format = "OPEN_EXR"; im.color_depth = "16"; im.exr_codec = "DWAA"; im.color_mode = "RGB"
NF = len(argv) > 4 and argv[4] == "nf"
if NF:   # 不带枪口火光的版本（用于合成卷帘快门条带）
    for o in bpy.data.objects:
        if o.name.startswith(("PFlash", "EFlash")):
            o.animation_data_clear(); o.hide_render = True
os.makedirs(out, exist_ok=True)
t0 = time.time(); done = 0
for f in frames:
    path = os.path.join(out, f"f_{f:04d}{'_nf' if NF else ''}.exr")
    if os.path.exists(path) and os.path.getsize(path) > 10000:
        continue
    t = time.time()
    scn.frame_set(f)
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    done += 1
    print(f"FRAME {f} {time.time() - t:.1f}s  total {time.time() - t0:.0f}s  ({done} done)", flush=True)
print("RENDER DONE", flush=True)
