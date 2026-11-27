"""公共工具：渲染设置、车辆加载、常用材质。"""
import bpy, os, math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = lambda *p: os.path.join(ROOT, "assets", *p)


# ---------------- 渲染设置 ----------------
def setup_cycles(sc, samples=96, res=(1920, 1080), pct=100, denoise=True):
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    dev = "CPU"
    for t in ("OPTIX", "METAL", "CUDA"):
        try:
            prefs.compute_device_type = t
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == t]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == t
            dev = t
            break
    c = sc.cycles
    c.device = "GPU" if dev != "CPU" else "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = denoise
    try:
        c.denoiser = "OPENIMAGEDENOISE"
        c.denoising_use_gpu = True
    except Exception:
        pass
    c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.max_bounces = 6
    c.diffuse_bounces = 2
    c.glossy_bounces = 4
    c.transmission_bounces = 4
    c.transparent_max_bounces = 12
    c.volume_bounces = 0
    c.sample_clamp_indirect = 4.0
    c.sample_clamp_direct = 0.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.use_light_tree = True
    c.blur_glossy = 0.5
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = pct
    sc.render.use_persistent_data = True
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    print("@@ cycles device", dev)
    return dev


# ---------------- 节点小工具 ----------------
def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def N(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k == "inputs":
            for ik, iv in v.items():
                n.inputs[ik].default_value = iv
        else:
            setattr(n, k, v)
    return n


def L(nt, a, b):
    nt.links.new(a, b)


def img(path, colorspace="sRGB"):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def emission_mat(name, color, strength, sample=False):
    m, nt, out = new_mat(name)
    e = N(nt, "ShaderNodeEmission", inputs={"Color": (*color, 1), "Strength": strength})
    L(nt, e.outputs[0], out.inputs["Surface"])
    try:
        m.cycles.emission_sampling = "AUTO" if sample else "NONE"
    except Exception:
        pass
    return m


# ---------------- 车辆 ----------------
QUADS = ("FL", "FR", "RL", "RR")


def load_car(name, inst=""):
    """把 blend/cars/<name>.blend 里的车追加进当前场景，返回各控制物体。inst 用来区分同一辆车的多个副本。"""
    path = os.path.join(ROOT, "blend", "cars", f"{name}.blend")
    cname = f"CAR_{name}"
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.collections = [cname]
    col = dst.collections[0]
    col.name = f"CAR_{name}{inst}"
    bpy.context.scene.collection.children.link(col)
    d = {"col": col, "spin": {}, "steer": {}, "name": name}
    for o in col.objects:
        base = o.name.split(".")[0]
        if base == f"{name}_root":
            d["root"] = o
        elif base == f"{name}_body":
            d["body"] = o
        for q in QUADS:
            if base == f"{name}_spin_{q}":
                d["spin"][q] = o
            if base == f"{name}_steer_{q}":
                d["steer"][q] = o
    for o in d["spin"].values():
        o.rotation_mode = "XYZ"
    return d


def add_headlights(car, power=900.0, color=(0.82, 0.90, 1.0), spread=70):
    """两盏前大灯聚光灯，挂在车身上。"""
    root = car["root"]
    hx, hy, hz = root["head_pos"]
    lamps = []
    for sgn in (1, -1):
        ld = bpy.data.lights.new(f"{root.name}_head", "SPOT")
        ld.energy = power
        ld.color = color
        ld.spot_size = math.radians(spread)
        ld.spot_blend = 0.6
        ld.shadow_soft_size = 0.06
        lo = bpy.data.objects.new(f"{root.name}_head_{'L' if sgn > 0 else 'R'}", ld)
        car["col"].objects.link(lo)
        lo.parent = car["body"]
        lo.location = (hx + 0.08, hy * sgn, hz)
        # 聚光灯默认朝 -Z：转到朝 +X 并略微下压
        lo.rotation_euler = (0, math.radians(-90 + 4.0), 0)
        lamps.append(lo)
    car["headlamps"] = lamps
    return lamps
