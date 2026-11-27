"""Bake Cycles lighting for the game chunks.
Atlas chunks -> game/assets/lm/<chunk>.exr  (RGB = diffuse irradiance (direct+indirect, no albedo), A = sun-direct scalar)
Vertex chunks -> colour attribute LMV on the mesh (same encoding), saved back into blend/game_baked.blend.
Run: Blender -b blend/game_prep.blend -P scripts/game_bake.py -- <samples> <chunk> [<chunk> ...]"""
import bpy, os, sys, time, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gpu_setup import enable_gpu

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv[sys.argv.index("--") + 1:]
SAMPLES = int(argv[0])
WANT = argv[1:]
OUT = os.path.join(ROOT, "game", "assets", "lm")
os.makedirs(OUT, exist_ok=True)
INFO = json.load(open(os.path.join(ROOT, "logs", "game_prep_info.json")))
T0 = time.time()
sc = bpy.context.scene
vl = bpy.context.view_layer
enable_gpu()
sc.render.engine = "CYCLES"
sc.cycles.device = "GPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_adaptive_sampling = False
sc.cycles.use_denoising = False
sc.cycles.max_bounces = 8
sc.cycles.diffuse_bounces = 4
sc.cycles.glossy_bounces = 3
sc.cycles.transmission_bounces = 6
sc.cycles.transparent_max_bounces = 16
sc.cycles.sample_clamp_indirect = 8.0
sc.render.bake.margin = 6
sc.render.bake.margin_type = "EXTEND"
sc.render.bake.use_clear = True
SUN = bpy.data.objects["Sun"]
SUN_COL = np.array(SUN.data.color[:3])
LUMW = np.array([0.2126, 0.7152, 0.0722])
SUN_LUM = float(SUN_COL @ LUMW)


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


def select(objs):
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    vl.objects.active = objs[0]


lights = [o for o in sc.objects if o.type == "LIGHT" and o.name != "Sun"]
world_bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
WORLD_STRENGTH = world_bg.inputs[1].default_value
emit_nodes = []
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    for n in m.node_tree.nodes:
        if n.type == "EMISSION":
            emit_nodes.append((n, n.inputs[1].default_value))
        elif n.type == "BSDF_PRINCIPLED":
            emit_nodes.append((n, None))


def sun_only(on):
    for l in lights:
        l.hide_render = on
    world_bg.inputs[1].default_value = 0.0 if on else WORLD_STRENGTH
    for n, v in emit_nodes:
        if v is None:  # principled: emission strength input
            inp = n.inputs.get("Emission Strength")
            if inp is not None:
                if on:
                    n["_es"] = inp.default_value; inp.default_value = 0.0
                elif "_es" in n:
                    inp.default_value = n["_es"]
        else:
            n.inputs[1].default_value = 0.0 if on else v


def bake_atlas(ch):
    ob = bpy.data.objects["CH_" + ch]
    res = INFO[ch]["res"]
    W, H = (res, res) if isinstance(res, int) else res
    imgs = {}
    for tag in ("all", "sun"):
        imgs[tag] = bpy.data.images.new(f"LM_{ch}_{tag}", W, H, alpha=True, float_buffer=True)
    nodes = []
    for m in ob.data.materials:
        nt = m.node_tree
        n = nt.nodes.get("LMBAKE") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "LMBAKE"
        nodes.append((nt, n))
    select([ob])
    for tag, passes in (("all", {"DIRECT", "INDIRECT"}), ("sun", {"DIRECT"})):
        for nt, n in nodes:
            n.image = imgs[tag]
            nt.nodes.active = n
        sun_only(tag == "sun")
        sc.cycles.samples = SAMPLES if tag == "all" else max(32, SAMPLES // 4)
        t = time.time()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter=passes, uv_layer="LM", target="IMAGE_TEXTURES",
                            margin=6, margin_type="EXTEND", use_clear=True)
        log(ch, tag, f"{W}x{H}", f"{time.time() - t:.1f}s")
    sun_only(False)
    a = np.empty(W * H * 4, np.float32); imgs["all"].pixels.foreach_get(a); a = a.reshape(H, W, 4)
    s = np.empty(W * H * 4, np.float32); imgs["sun"].pixels.foreach_get(s); s = s.reshape(H, W, 4)
    a[..., 3] = np.clip((s[..., :3] @ LUMW) / SUN_LUM, 0, 64)
    out = bpy.data.images.new(f"LMOUT_{ch}", W, H, alpha=True, float_buffer=True)
    out.pixels.foreach_set(a.ravel())
    st = sc.render.image_settings
    st.file_format = "OPEN_EXR"
    st.color_mode = "RGBA"
    st.color_depth = "16"
    st.exr_codec = "ZIP"
    path = os.path.join(OUT, ch + ".exr")
    out.save_render(path, scene=sc)
    log("saved", path, "max", float(a[..., :3].max()), "mean", float(a[..., :3].mean()), "sun max", float(a[..., 3].max()))
    for n in nodes:
        n[0].nodes.remove(n[1])


def bake_vcol(ch):
    ob = bpy.data.objects["CH_" + ch]
    me = ob.data
    ca = me.color_attributes
    for nm in ("LMV", "LMS"):
        if nm not in ca:
            ca.new(nm, "FLOAT_COLOR", "POINT")
    select([ob])
    for tag, passes, nm in (("all", {"DIRECT", "INDIRECT"}, "LMV"), ("sun", {"DIRECT"}, "LMS")):
        ca.active_color = ca[nm]
        sun_only(tag == "sun")
        sc.cycles.samples = SAMPLES if tag == "all" else max(32, SAMPLES // 4)
        t = time.time()
        bpy.ops.object.bake(type="DIFFUSE", pass_filter=passes, target="VERTEX_COLORS", use_clear=True)
        log(ch, tag, "vcol", len(me.vertices), f"{time.time() - t:.1f}s")
    sun_only(False)
    n = len(me.vertices)
    a = np.empty(n * 4, np.float32); ca["LMV"].data.foreach_get("color", a); a = a.reshape(n, 4)
    s = np.empty(n * 4, np.float32); ca["LMS"].data.foreach_get("color", s); s = s.reshape(n, 4)
    a[:, 3] = np.clip((s[:, :3] @ LUMW) / SUN_LUM, 0, 64)
    ca["LMV"].data.foreach_set("color", a.ravel())
    ca.remove(ca["LMS"])
    ca.active_color = ca["LMV"]
    log("vcol", ch, "max", float(a[:, :3].max()), "mean", float(a[:, :3].mean()))


for ch in WANT:
    if INFO[ch].get("vcol"):
        bake_vcol(ch)
    else:
        bake_atlas(ch)
if any(INFO[c].get("vcol") for c in WANT):
    dst = os.path.join(ROOT, "blend", "game_baked.blend")
    bpy.ops.wm.save_as_mainfile(filepath=dst, compress=True)
    log("saved blend", dst)
log("DONE")
