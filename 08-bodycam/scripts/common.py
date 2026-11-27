"""通用工具：GPU、导入、材质、集合。"""
import bpy, os, math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def enable_gpu(scn):
    """按 OptiX → CUDA → Metal 的顺序启用 GPU 渲染（Windows 的 4090 走 OptiX，Mac 走 Metal）。"""
    scn.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    chosen = None
    for t in ("OPTIX", "CUDA", "METAL"):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                chosen = t
                break
        except Exception:
            continue
    for d in prefs.devices:
        d.use = (d.type == chosen)
    scn.cycles.device = "GPU"
    print("GPU", chosen, [d.name for d in prefs.devices if d.use], flush=True)


def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def move_to(obj, c):
    for uc in list(obj.users_collection):
        uc.objects.unlink(obj)
    c.objects.link(obj)


def import_gltf(path, c=None):
    before = set(bpy.data.objects)
    acts = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.name.startswith("Icosphere"):
            new.remove(o)
            bpy.data.objects.remove(o)
    if c is not None:
        for o in new:
            move_to(o, c)
    new_actions = [a for a in bpy.data.actions if a not in acts]
    return new, new_actions


def empty(name, c, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    c.objects.link(e)
    e.parent = parent
    e.location = loc
    e.rotation_mode = "XYZ"
    return e


def bsdf_of(mat):
    return next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def look_at_euler(src, dst):
    return (Vector(dst) - Vector(src)).to_track_quat("-Z", "Y").to_euler()


def set_interp(obj, interp="LINEAR"):
    """把物体所有 fcurve 的关键帧插值设为指定类型（兼容分层 action）。"""
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    for fc in iter_fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = interp


def iter_fcurves(action):
    if hasattr(action, "layers") and len(action.layers):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        yield fc
    elif hasattr(action, "fcurves"):
        for fc in action.fcurves:
            yield fc
