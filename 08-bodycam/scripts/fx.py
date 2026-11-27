"""特效：烟尘团、枪口火光、弹孔、碎屑、弹壳。"""
import bpy, os, math, random
from mathutils import Vector, Matrix, Euler
from common import ASSETS, coll, bsdf_of
import timeline as TL

FXDIR = os.path.join(ASSETS, "fx")
PUFF_EMIT = 0.42
_img = {}
_mat = {}
_mesh = {}


def image(name):
    if name not in _img:
        _img[name] = bpy.data.images.load(os.path.join(FXDIR, name))
    return _img[name]


def quad_mesh():
    if "quad" not in _mesh:
        me = bpy.data.meshes.new("fx_quad")
        me.from_pydata([(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UVMap")
        for i, c in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
            uv.data[i].uv = c
        _mesh["quad"] = me
    return _mesh["quad"]


def puff_material(tex):
    key = "puff_" + tex
    if key in _mat:
        return _mat[key]
    m = bpy.data.materials.new(key); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    t = N("ShaderNodeTexImage"); t.image = image(tex); t.extension = "CLIP"
    oi = N("ShaderNodeObjectInfo")
    col = N("ShaderNodeMix"); col.data_type = "RGBA"; col.blend_type = "MULTIPLY"; col.inputs["Factor"].default_value = 1.0
    L(t.outputs["Color"], col.inputs["A"]); L(oi.outputs["Color"], col.inputs["B"])
    al = N("ShaderNodeMath"); al.operation = "MULTIPLY"; L(t.outputs["Alpha"], al.inputs[0]); L(oi.outputs["Alpha"], al.inputs[1])
    d = N("ShaderNodeBsdfDiffuse"); tr = N("ShaderNodeBsdfTranslucent")
    L(col.outputs["Result"], d.inputs["Color"]); L(col.outputs["Result"], tr.inputs["Color"])
    ms = N("ShaderNodeMixShader"); ms.inputs[0].default_value = 0.5; L(d.outputs[0], ms.inputs[1]); L(tr.outputs[0], ms.inputs[2])
    em = N("ShaderNodeEmission"); em.inputs["Strength"].default_value = PUFF_EMIT; L(col.outputs["Result"], em.inputs["Color"])
    ad = N("ShaderNodeAddShader"); L(ms.outputs[0], ad.inputs[0]); L(em.outputs[0], ad.inputs[1])
    tp = N("ShaderNodeBsdfTransparent")
    mx = N("ShaderNodeMixShader"); L(al.outputs[0], mx.inputs[0]); L(tp.outputs[0], mx.inputs[1]); L(ad.outputs[0], mx.inputs[2])
    out = N("ShaderNodeOutputMaterial"); L(mx.outputs[0], out.inputs["Surface"])
    _mat[key] = m
    return m


def flash_material(tex, strength):
    key = f"flash_{tex}_{strength}"
    if key in _mat:
        return _mat[key]
    m = bpy.data.materials.new(key); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    t = N("ShaderNodeTexImage"); t.image = image(tex); t.extension = "CLIP"
    em = N("ShaderNodeEmission"); em.inputs["Strength"].default_value = strength
    L(t.outputs["Color"], em.inputs["Color"])
    tp = N("ShaderNodeBsdfTransparent")
    mx = N("ShaderNodeMixShader"); L(t.outputs["Alpha"], mx.inputs[0]); L(tp.outputs[0], mx.inputs[1]); L(em.outputs[0], mx.inputs[2])
    out = N("ShaderNodeOutputMaterial"); L(mx.outputs[0], out.inputs["Surface"])
    _mat[key] = m
    return m


def decal_material(tex):
    key = "decal_" + tex
    if key in _mat:
        return _mat[key]
    m = bpy.data.materials.new(key); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    t = N("ShaderNodeTexImage"); t.image = image(tex); t.extension = "CLIP"
    d = N("ShaderNodeBsdfDiffuse"); L(t.outputs["Color"], d.inputs["Color"])
    em = N("ShaderNodeEmission"); em.inputs["Strength"].default_value = 0.55 * (PUFF_EMIT / 0.42); L(t.outputs["Color"], em.inputs["Color"])
    ad = N("ShaderNodeAddShader"); L(d.outputs[0], ad.inputs[0]); L(em.outputs[0], ad.inputs[1])
    tp = N("ShaderNodeBsdfTransparent")
    mx = N("ShaderNodeMixShader"); L(t.outputs["Alpha"], mx.inputs[0]); L(tp.outputs[0], mx.inputs[1]); L(ad.outputs[0], mx.inputs[2])
    out = N("ShaderNodeOutputMaterial"); L(mx.outputs[0], out.inputs["Surface"])
    _mat[key] = m
    return m


def simple_material(name, color, rough=0.8, metallic=0.0):
    if name in _mat:
        return _mat[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = bsdf_of(m); b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    _mat[name] = m
    return m


def key_vis(obj, on_frame, off_frame=None):
    obj.hide_render = True; obj.keyframe_insert("hide_render", frame=on_frame - 1)
    obj.hide_render = False; obj.keyframe_insert("hide_render", frame=on_frame)
    if off_frame is not None:
        obj.hide_render = True; obj.keyframe_insert("hide_render", frame=off_frame)
    obj.hide_viewport = False


PUFF_OFFS = [0, 1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 62, 80, 100, 125, 155, 190, 230, 280, 340]


def burst(rng, cam, colls, origin, normal, frame, n=7, speed=3.5, spread=0.55, size0=0.10, size1=0.7, life=70,
          color=(0.82, 0.8, 0.76), alpha=0.5, rise=-0.04, drag=0.13, grow=0.05, name="puff"):
    """一团由 n 个朝向相机的面片组成的烟尘。"""
    origin = Vector(origin); normal = Vector(normal).normalized()
    out = []
    for i in range(n):
        d = (normal + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * spread).normalized()
        v0 = d * speed * rng.uniform(0.35, 1.0)
        root = bpy.data.objects.new(f"{name}_r", None); root.empty_display_size = 0.02
        q = bpy.data.objects.new(name, quad_mesh())
        for c in colls:
            c.objects.link(q)
        colls[0].objects.link(root)
        q.parent = root
        q.rotation_euler = (0, 0, rng.uniform(0, 6.283))
        q.data = quad_mesh()
        q.active_material = puff_material(f"puff_{rng.randrange(8)}.png")
        cr = root.constraints.new("COPY_ROTATION"); cr.target = cam
        s0 = size0 * rng.uniform(0.7, 1.3); s1 = size1 * rng.uniform(0.6, 1.25)
        a0 = alpha * rng.uniform(0.6, 1.0)
        tint = rng.uniform(0.88, 1.08)
        born = frame + (0 if i < n // 2 else rng.choice([0, 0, 1]))
        lf = int(life * rng.uniform(0.7, 1.15))
        for off in PUFF_OFFS:
            if off > lf:
                break
            t = off / TL.FPS
            p = origin + v0 * drag * (1 - math.exp(-t / drag)) + Vector((0, 0, rise)) * t
            root.location = p; root.keyframe_insert("location", frame=born + off)
            sz = s0 + (s1 - s0) * (1 - math.exp(-t / 0.30)) + grow * t
            q.scale = (sz, sz, sz); q.keyframe_insert("scale", frame=born + off)
            a = a0 * min(1.0, (off + 0.6) / 1.6) * math.exp(-t / (lf / TL.FPS / 2.6))
            q.color = (color[0] * tint, color[1] * tint, color[2] * tint, a); q.keyframe_insert("color", frame=born + off)
        q.color = (color[0], color[1], color[2], 0.0); q.keyframe_insert("color", frame=born + lf + 2)
        key_vis(q, born, born + lf + 3)
        out.append(q)
    return out


def chips(rng, colls, origin, normal, frame, floor_z, n=12, speed=4.0, color=(0.74, 0.73, 0.69)):
    origin = Vector(origin); normal = Vector(normal).normalized()
    mat = simple_material("chip_plaster", color, 0.9)
    if "chip" not in _mesh:
        me = bpy.data.meshes.new("chip")
        import bmesh
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5); bm.to_mesh(me); bm.free()
        _mesh["chip"] = me
    for i in range(n):
        d = (normal + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 1))) * 0.8).normalized()
        v = d * speed * rng.uniform(0.3, 1.0)
        o = bpy.data.objects.new("chip", _mesh["chip"])
        for c in colls:
            c.objects.link(o)
        o.active_material = mat
        s = rng.uniform(0.006, 0.022)
        o.scale = (s, s * rng.uniform(0.4, 1.0), s * rng.uniform(0.3, 0.8))
        p = origin.copy(); rot = Vector((rng.uniform(0, 6), rng.uniform(0, 6), rng.uniform(0, 6)))
        spin = Vector((rng.uniform(-20, 20), rng.uniform(-20, 20), rng.uniform(-20, 20)))
        dt = 1.0 / TL.FPS
        key_vis(o, frame)
        rest = False
        for k in range(0, 46):
            o.location = p; o.rotation_euler = rot
            o.keyframe_insert("location", frame=frame + k); o.keyframe_insert("rotation_euler", frame=frame + k)
            if rest:
                break
            v.z -= 9.8 * dt
            p = p + v * dt; rot = rot + spin * dt
            if p.z <= floor_z + 0.004:
                p.z = floor_z + 0.004
                if abs(v.z) < 1.2:
                    rest = True
                v = Vector((v.x * 0.35, v.y * 0.35, -v.z * 0.25)); spin *= 0.3


def bullet_hole(rng, colls, pos, normal, frame, size=0.085):
    q = bpy.data.objects.new("hole", quad_mesh())
    for c in colls:
        c.objects.link(q)
    q.active_material = decal_material(f"hole_{rng.randrange(4)}.png")
    n = Vector(normal).normalized()
    q.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
    q.rotation_euler.rotate_axis("Z", rng.uniform(0, 6.283))
    q.location = Vector(pos) + n * 0.004
    q.scale = (size, size, size)
    key_vis(q, frame)
    return q


def shell(rng, colls, pos, vel, frame, floor_z):
    if "shell" not in _mesh:
        import bmesh
        me = bpy.data.meshes.new("shell"); bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.0052, radius2=0.0052, depth=0.0205)
        bm.to_mesh(me); bm.free(); _mesh["shell"] = me
    o = bpy.data.objects.new("shell", _mesh["shell"])
    for c in colls:
        c.objects.link(o)
    o.active_material = simple_material("brass", (0.83, 0.62, 0.24), 0.28, 1.0)
    p = Vector(pos); v = Vector(vel)
    rot = Vector((rng.uniform(0, 6), rng.uniform(0, 6), rng.uniform(0, 6)))
    spin = Vector((rng.uniform(-45, 45), rng.uniform(-45, 45), rng.uniform(-30, 30)))
    dt = 1.0 / TL.FPS / 2
    key_vis(o, frame)
    bounces = 0; hits = []
    for k in range(0, 120):
        if k % 2 == 0:
            o.location = p; o.rotation_euler = rot
            o.keyframe_insert("location", frame=frame + k // 2); o.keyframe_insert("rotation_euler", frame=frame + k // 2)
        if bounces >= 4:
            break
        v.z -= 9.8 * dt
        p = p + v * dt; rot = rot + spin * dt
        if p.z <= floor_z + 0.006:
            p.z = floor_z + 0.006
            hits.append(frame + k // 2)
            bounces += 1
            v = Vector((v.x * 0.45, v.y * 0.45, -v.z * 0.32)); spin *= 0.5
            if abs(v.z) < 0.5:
                bounces = 4
    return o, hits


def flash_quads(name, c, parent, pos_local, rng, scale=1.0, strength=70.0):
    """我方手枪枪口火光：两片沿枪管的喷焰 + 一片正对后方的星形。父级局部 +Y 为枪口方向。"""
    root = bpy.data.objects.new(name, None); c.objects.link(root); root.empty_display_size = 0.02
    root.parent = parent; root.location = pos_local
    objs = []
    for i, rz in enumerate((0.0, 90.0)):
        q = bpy.data.objects.new(name + "_s", quad_mesh()); c.objects.link(q); q.parent = root
        q.active_material = flash_material(f"flash_side_{rng.randrange(4)}.png", strength)
        # 面片 X 轴 -> 枪口方向(+Y)，面片绕枪轴转 rz
        q.rotation_mode = "ZYX"   # 先绕 Z 把面片 X 轴转到枪口方向，再绕枪轴(Y)滚转
        q.rotation_euler = (0.0, math.radians(rz + rng.uniform(-25, 25)), math.radians(90))
        L = 0.14 * scale * rng.uniform(0.8, 1.25)
        q.scale = (L, 0.075 * scale * rng.uniform(0.8, 1.2), 1)
        q.location = (0, L * 0.5 - 0.005, 0)
        objs.append(q)
    q = bpy.data.objects.new(name + "_f", quad_mesh()); c.objects.link(q); q.parent = root
    q.active_material = flash_material(f"flash_star_{rng.randrange(8)}.png", strength * 1.3)
    q.rotation_mode = "ZYX"   # 先在面内随机旋转，再立起来正对后方
    q.rotation_euler = (math.radians(90), 0, rng.uniform(0, 6.283))
    s = 0.15 * scale * rng.uniform(0.85, 1.25)
    q.scale = (s, s, s); q.location = (0, 0.012, 0)
    objs.append(q)
    return root, objs


def point_flash(name, c, energy, color=(1.0, 0.70, 0.40), radius=0.04):
    ld = bpy.data.lights.new(name, "POINT"); ld.energy = energy; ld.color = color; ld.shadow_soft_size = radius
    lo = bpy.data.objects.new(name, ld); c.objects.link(lo)
    return lo
