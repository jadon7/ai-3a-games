import bpy, sys, os, time
sys.path.insert(0, os.path.join(os.path.dirname(bpy.data.filepath), "..", "scripts"))
from gpu_setup import enable_gpu
enable_gpu()
argv = sys.argv[sys.argv.index("--") + 1:]
outdir, f0, f1, step, pct, spp, mb, fmt = argv[0], int(argv[1]), int(argv[2]), int(argv[3]), int(argv[4]), int(argv[5]), argv[6] == "1", argv[7]
sc = bpy.context.scene
sc.render.resolution_percentage = pct; sc.cycles.samples = spp; sc.render.use_motion_blur = mb
sc.render.use_persistent_data = True
if fmt == "jpg":
    sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 95
else:
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_depth = "8"; sc.render.image_settings.compression = 30
os.makedirs(outdir, exist_ok=True)
ext = "jpg" if fmt == "jpg" else "png"
for f in range(f0, f1 + 1, step):
    out = os.path.join(outdir, f"f_{f:04d}.{ext}")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        continue
    t = time.time()
    sc.frame_set(f); sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("RF", f, round(time.time() - t, 1), flush=True)
