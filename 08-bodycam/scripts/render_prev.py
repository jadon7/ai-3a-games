"""低清预览：blender -b blend/shot.blend -P render_prev.py -- <outdir> <pct> <spp> <mblur 0/1> <frames: a,b,c 或 a-b:step>"""
import bpy, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import enable_gpu
argv = sys.argv[sys.argv.index("--") + 1:]
out, pct, spp, mb, spec = argv[0], int(argv[1]), int(argv[2]), argv[3] == "1", argv[4]
if "-" in spec:
    rng, _, st = spec.partition(":")
    a, b = rng.split("-"); frames = list(range(int(a), int(b) + 1, int(st or 1)))
else:
    frames = [int(x) for x in spec.split(",")]
scn = bpy.context.scene
enable_gpu(scn)
scn.cycles.samples = spp
scn.render.resolution_percentage = pct
scn.render.use_motion_blur = mb
scn.render.image_settings.file_format = "JPEG"; scn.render.image_settings.quality = 90
scn.view_settings.view_transform = "Standard"; scn.view_settings.exposure = float(argv[5]) if len(argv) > 5 else -0.9
os.makedirs(out, exist_ok=True)
import time
for f in frames:
    t = time.time()
    scn.frame_set(f)
    scn.render.filepath = os.path.join(out, f"p_{f:04d}.jpg")
    bpy.ops.render.render(write_still=True)
    print(f"FRAME {f} {time.time() - t:.1f}s")
