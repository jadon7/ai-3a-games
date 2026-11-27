"""本机从后往前渲（4090 从前往后），两边在中间会合，缩短总时间。
blender -b blend/race.blend -P render_local.py -- <本机输出目录> <从4090拉回的目录> <samples> <起始帧> <最小帧>
遇到已经从 4090 拉回的帧就停。每帧先写临时文件再改名，别的脚本不会读到写了一半的文件。"""
import bpy, sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shotlib import setup_exr

argv = sys.argv[sys.argv.index("--") + 1:]
outdir, pulled, samples, f_hi, f_lo = os.path.abspath(argv[0]), os.path.abspath(argv[1]), int(argv[2]), int(argv[3]), int(argv[4])
os.makedirs(outdir, exist_ok=True)
sc = bpy.context.scene
setup_exr(sc, "", samples=samples, pct=100)
sc.cycles.transparent_max_bounces = 24
marks = sorted((m.frame, m.camera) for m in sc.timeline_markers if m.camera)
t0 = time.time(); n = 0
for f in range(f_hi, f_lo - 1, -1):
    name = f"f{f:04d}.exr"
    dst = os.path.join(outdir, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        continue
    if os.path.exists(os.path.join(pulled, name)):
        print(f"@@ met 4090 at frame {f}, stop", flush=True)
        break
    sc.frame_set(f)
    cam = marks[0][1]
    for mf, c in marks:
        if f >= mf:
            cam = c
    sc.camera = cam
    tmp = os.path.join(outdir, f"tmp_{name}")
    sc.render.filepath = tmp
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    os.replace(tmp, dst)
    n += 1
    print(f"@@ frame {f} {time.time() - t1:.1f}s  (done {n}, avg {(time.time() - t0) / n:.1f}s)", flush=True)
print("@@ local done", n, flush=True)
