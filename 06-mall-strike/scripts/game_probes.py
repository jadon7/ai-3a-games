"""Render equirect light probes of the mall with Cycles, write one EXR atlas + SH9 json.
Run: Blender -b blend/game_prep.blend -P scripts/game_probes.py -- [test]"""
import bpy, os, sys, math, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gpu_setup import enable_gpu

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEST = "test" in argv
GA = os.path.join(ROOT, "game", "assets")
TMP = os.path.join(ROOT, "logs", "probes")
os.makedirs(TMP, exist_ok=True)
sc = bpy.context.scene
enable_gpu()
sc.render.engine = "CYCLES"
sc.cycles.samples = 256
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.02
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
sc.cycles.sample_clamp_indirect = 8.0
sc.render.use_persistent_data = True
PW, PH_ = 256, 128
sc.render.resolution_x, sc.render.resolution_y = PW, PH_
sc.render.resolution_percentage = 100
st = sc.render.image_settings
st.file_format = "OPEN_EXR"; st.color_mode = "RGB"; st.color_depth = "32"; st.exr_codec = "ZIP"
sc.render.film_transparent = False
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.view_settings.exposure = 0
sun = bpy.data.objects["Sun"]
sun.visible_camera = False
sun.visible_glossy = False  # glossy reflections of the sun disc are handled in real time

cd = bpy.data.cameras.new("Probe")
cd.type = "PANO"
cd.panorama_type = "EQUIRECTANGULAR"
cam = bpy.data.objects.new("Probe", cd)
sc.collection.objects.link(cam)
sc.camera = cam
cam.rotation_euler = (math.pi / 2, 0, 0)   # image centre looks along +Y (Blender)

UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62]
GX = [-7.5, 0.0, 7.5]
GY = [-10, -2, 6, 14, 22, 30, 38, 46, 54, 60]
probes = []
for lvl, z in ((0, 1.5), (1, 6.6)):
    for y in GY:
        for x in GX:
            probes.append({"kind": "grid", "lvl": lvl, "x": x, "y": y, "z": z})
for lvl in (0, 1):
    for s in (-1, 1):
        for k in range(8):
            probes.append({"kind": "store", "lvl": lvl, "side": s, "k": k, "x": s * 14.0,
                           "y": (UNIT_B[k] + UNIT_B[k + 1]) / 2, "z": 1.5 + 5.0 * lvl})
if TEST:
    probes = probes[:1] + [{"kind": "test", "x": 0, "y": 20, "z": 1.5}]
    # coloured markers: red at +X, green at +Y, blue at +Z (Blender) around the test probe
    for col, off in (((1, 0, 0), (1.2, 0, 0)), ((0, 1, 0), (0, 1.2, 0)), ((0, 0, 1), (0, 0, 1.2))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(off[0], 20 + off[1], 1.5 + off[2]))
        o = bpy.context.active_object
        m = bpy.data.materials.new("mk"); m.use_nodes = True
        nt = m.node_tree; [nt.nodes.remove(n) for n in list(nt.nodes)]
        e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*col, 1); e.inputs[1].default_value = 50
        out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(e.outputs[0], out.inputs[0])
        o.data.materials.append(m)


def b2t(v):  # blender -> three coords
    return np.stack([v[..., 0], v[..., 2], -v[..., 1]], -1)


def load_exr(path):
    im = bpy.data.images.load(path)
    a = np.empty(PW * PH_ * 4, np.float32); im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(PH_, PW, 4)[::-1, :, :3].copy()  # row 0 = top


# direction for each pixel (assumed Cycles equirect: u -> longitude, v -> latitude), Blender world space
# (orientation verified with the test markers)
u = (np.arange(PW) + 0.5) / PW
v = (np.arange(PH_) + 0.5) / PH_
U, V = np.meshgrid(u, v)
lon = (0.5 - U) * 2 * math.pi        # centre (u=0.5) -> +Y forward
lat = (0.5 - V) * math.pi            # top row -> +Z
dirc = np.stack([np.cos(lat) * np.sin(-lon), np.cos(lat) * np.cos(lon), np.sin(lat)], -1)  # x,y,z blender
dw = (2 * math.pi / PW) * (math.pi / PH_) * np.cos(lat)  # solid angle per pixel
dt = b2t(dirc)
x, y, z = dt[..., 0], dt[..., 1], dt[..., 2]
BASIS = [0.282095 * np.ones_like(x), 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z,
         0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)]

atlas = []
T0 = time.time()
for i, p in enumerate(probes):
    cam.location = (p["x"], p["y"], p["z"])
    path = os.path.join(TMP, f"p{i:03d}.exr")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = load_exr(path)
    atlas.append(img)
    sh = [[float((img[..., c] * B * dw).sum()) for c in range(3)] for B in BASIS]
    p["sh"] = sh
    p["mean"] = [float(img[..., c].mean()) for c in range(3)]
    print(f"probe {i}/{len(probes)} {time.time() - T0:.0f}s mean {p['mean']}", flush=True)
    if TEST:
        # report where the markers appear
        for c, nm in ((0, "red+X"), (1, "green+Y"), (2, "blue+Z")):
            ch = img[..., c] - img[..., [k for k in range(3) if k != c]].max(-1)
            yy, xx = np.unravel_index(np.argmax(ch), ch.shape)
            print("MARKER", nm, "at u", (xx + 0.5) / PW, "v", (yy + 0.5) / PH_, "expected dir", dirc[yy, xx])

A = np.concatenate(atlas, 0)  # (PH*N, PW, 3) top-down
H = A.shape[0]
out = bpy.data.images.new("probes", PW, H, alpha=True, float_buffer=True)
px = np.ones((H, PW, 4), np.float32); px[..., :3] = A
out.pixels.foreach_set(px[::-1].ravel())
st.color_mode = "RGBA"; st.color_depth = "16"
dst = os.path.join(GA, "probes_test.exr" if TEST else "probes.exr")
out.save_render(dst, scene=sc)
meta = {"w": PW, "h": PH_, "count": len(probes), "gx": GX, "gy": GY, "unit_b": UNIT_B,
        "mapping": "row-major layers, top-down; u->lon centre=+Y(blender) = -Z(three)", "probes": probes}
json.dump(meta, open(os.path.join(GA, "probes_test.json" if TEST else "probes.json"), "w"))
print("DONE", dst, time.time() - T0)
