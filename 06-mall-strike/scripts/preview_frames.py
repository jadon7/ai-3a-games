import bpy, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(bpy.data.filepath), "..", "scripts"))
from gpu_setup import enable_gpu
enable_gpu()
argv = sys.argv[sys.argv.index("--") + 1:]
outdir, frames, pct, spp = argv[0], [int(x) for x in argv[1].split(",")], int(argv[2]), int(argv[3])
sc = bpy.context.scene
sc.render.resolution_percentage = pct; sc.cycles.samples = spp
sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 88
os.makedirs(outdir, exist_ok=True)
for f in frames:
    sc.frame_set(f); sc.render.filepath = os.path.join(outdir, f"p_{f:04d}.jpg")
    bpy.ops.render.render(write_still=True); print("PF", f, flush=True)
