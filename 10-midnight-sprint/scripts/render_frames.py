"""逐帧渲染 EXR（已存在的帧跳过，可随时中断续渲）。
blender -b blend/race.blend -P render_frames.py -- <out_dir> <samples> <pct> <帧列表，如 1-100 或 30,150,500 或 1-1277:4>"""
import bpy, sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shotlib import setup_exr

argv = sys.argv[sys.argv.index("--") + 1:]
outdir, samples, pct, spec = argv[0], int(argv[1]), int(argv[2]), argv[3]
outdir = os.path.abspath(outdir)
os.makedirs(outdir, exist_ok=True)
fr = []
for part in spec.split(","):
    step = 1
    if ":" in part:
        part, st = part.split(":"); step = int(st)
    if "-" in part:
        a, b = part.split("-"); fr += list(range(int(a), int(b) + 1, step))
    else:
        fr.append(int(part))
sc = bpy.context.scene
setup_exr(sc, "", samples=samples, pct=pct)
sc.cycles.transparent_max_bounces = 24
marks = sorted((m.frame, m.camera) for m in sc.timeline_markers if m.camera)
t0 = time.time(); n = 0
for f in fr:
    dst = os.path.join(outdir, f"f{f:04d}.exr")
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        continue
    sc.frame_set(f)
    cam = marks[0][1]
    for mf, c in marks:
        if f >= mf:
            cam = c
    sc.camera = cam
    sc.render.filepath = dst
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    n += 1
    print(f"@@ frame {f} {time.time() - t1:.1f}s  (done {n}, avg {(time.time() - t0) / n:.1f}s)", flush=True)
