# 无界面渲染指定帧：
#   Blender -b scene.blend -P render_frames.py -- --frames 20,80,150 --pct 50 --samples 48 --out /path/dir [--fmt PNG|JPEG] [--noblur]
import bpy, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        return argv[argv.index(name) + 1]
    return default


frames_s = arg("--frames", "1")
if "-" in frames_s and "," not in frames_s:
    a, b = frames_s.split("-")
    step = int(arg("--step", "1"))
    frames = list(range(int(a), int(b) + 1, step))
else:
    frames = [int(x) for x in frames_s.split(",")]
pct = int(arg("--pct", "100"))
samples = int(arg("--samples", "64"))
out = arg("--out")
fmt = arg("--fmt", "PNG")
skip_existing = "--skip-existing" in argv
os.makedirs(out, exist_ok=True)

sc = bpy.context.scene
sc.render.resolution_percentage = pct
sc.cycles.samples = samples
if "--noblur" in argv:
    sc.render.use_motion_blur = False
thr = arg("--threshold")
if thr:
    sc.cycles.adaptive_threshold = float(thr)

# GPU
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices:
    d.use = (d.type == 'METAL')
sc.cycles.device = 'GPU'

sc.render.image_settings.file_format = fmt
if fmt == 'PNG':
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = arg("--depth", "8")
    sc.render.image_settings.compression = 30
elif fmt == 'JPEG':
    sc.render.image_settings.quality = 92

pyx = arg("--py")
if pyx:
    exec(pyx)
    print("applied override:", pyx, flush=True)

t_all = time.time()
for f in frames:
    path = os.path.join(out, f"f{f:04d}." + ("png" if fmt == 'PNG' else "jpg"))
    if skip_existing and os.path.exists(path) and os.path.getsize(path) > 1000:
        continue
    sc.frame_set(f)
    # 时间线标记绑定的机位
    cam = None
    for m in sorted(sc.timeline_markers, key=lambda m: m.frame):
        if m.frame <= f and m.camera:
            cam = m.camera
    if cam:
        sc.camera = cam
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED frame {f} in {time.time() - t0:.1f}s -> {path}", flush=True)
print(f"ALL_DONE {len(frames)} frames in {time.time() - t_all:.1f}s", flush=True)
