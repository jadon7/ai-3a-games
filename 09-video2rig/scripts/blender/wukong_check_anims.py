"""悟空专用：验证 wukong_anims.glb。按 glTF 的语义自己逐帧求值动画（只用旋转轨，和游戏里的加载器一样丢掉位移轨），
套到游戏模型 wukong.glb 的骨架上，每段取 4 帧渲染拼成一张图。

用法: Blender -b --factory-startup -P scripts/blender/wukong_check_anims.py -- <游戏 wukong.glb> <wukong_anims.glb> <输出目录> [片段名 ...]
产出: <输出目录>/anim_<片段名>.jpg（4 帧横排，宽 1600）
"""
import json
import math
import os
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
game_glb, anim_glb, out_dir = args[0], args[1], args[2]
only = set(args[3:])
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=game_glb)
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == "ARMATURE")
for o in list(scene.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)


# 游戏模型的贴图是代码里另外加载的：这里把同目录的 body_color_2k.jpg 接到身体材质上，截图才看得清
tex = os.path.join(os.path.dirname(game_glb), "body_color_2k.jpg")
for o in scene.objects:
    if o.type != "MESH" or not o.data.uv_layers or not os.path.exists(tex):
        continue
    for slot in o.material_slots:
        mat = slot.material
        if mat is None or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None or bsdf.inputs["Base Color"].is_linked:
            continue
        im = mat.node_tree.nodes.new("ShaderNodeTexImage")
        im.image = bpy.data.images.load(tex, check_existing=True)
        mat.node_tree.links.new(im.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7


# ---- 读动画 GLB
def read_glb(p):
    b = open(p, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    g = json.loads(b[20:20 + n])
    off = 20 + n
    m = struct.unpack("<I", b[off:off + 4])[0]
    return g, b[off + 8:off + 8 + m]


g, blob = read_glb(anim_glb)


def acc(i):
    a = g["accessors"][i]
    v = g["bufferViews"][a["bufferView"]]
    k = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    arr = np.frombuffer(blob, dtype=np.float32, count=a["count"] * k, offset=v.get("byteOffset", 0) + a.get("byteOffset", 0))
    return arr.reshape(a["count"], k) if k > 1 else arr


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


N = len(g["nodes"])
par = [-1] * N
for i, nd in enumerate(g["nodes"]):
    for c in nd.get("children", []):
        par[c] = i
order = []
seen = set()


def visit(i):
    if i in seen:
        return
    if par[i] >= 0:
        visit(par[i])
    seen.add(i)
    order.append(i)


for i in range(N):
    visit(i)
Y2Z = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1.0]])     # glTF(Y 上) -> Blender(Z 上)


def worlds(rot_override):
    W = [None] * N
    for i in order:
        nd = g["nodes"][i]
        M = np.eye(4)
        M[:3, :3] = qmat(rot_override.get(i, nd.get("rotation", [0, 0, 0, 1]))) @ np.diag(nd.get("scale", [1, 1, 1]))
        M[:3, 3] = nd.get("translation", [0, 0, 0])          # 位移轨不用：和游戏一致
        W[i] = M if par[i] < 0 else W[par[i]] @ M
    return {g["nodes"][i]["name"]: Y2Z @ W[i] for i in range(N)}


def ortho(M):
    M = np.array(M, dtype=float)
    for k in range(3):
        M[:3, k] /= np.linalg.norm(M[:3, k])
    return M


rest_w = worlds({})
bones = [b.name for b in arm.data.bones]          # 父在前
amw = np.array(arm.matrix_world)
offset = {}
for n in bones:
    bw = ortho(amw @ np.array(arm.data.bones[n].matrix_local))
    offset[n] = np.linalg.inv(ortho(rest_w[n])) @ bw


def pose_at(anim, t):
    rot = {}
    for ch in anim["channels"]:
        if ch["target"]["path"] != "rotation":
            continue
        s = anim["samplers"][ch["sampler"]]
        ts, qs = acc(s["input"]), acc(s["output"])
        f = np.clip(np.interp(t, ts, np.arange(len(ts))), 0, len(ts) - 1)
        i0 = int(min(np.floor(f), len(ts) - 2))
        u = f - i0
        q = (1 - u) * qs[i0] + u * (qs[i0 + 1] if np.dot(qs[i0], qs[i0 + 1]) >= 0 else -qs[i0 + 1])
        rot[ch["target"]["node"]] = q / np.linalg.norm(q)
    W = worlds(rot)
    inv = np.linalg.inv(amw)
    for n in bones:
        pb = arm.pose.bones[n]
        target = ortho(W[n]) @ offset[n]
        pb.matrix = Matrix((inv @ target).tolist())
        bpy.context.view_layer.update()


# ---- 棚和相机
world = bpy.data.worlds.new("w")
world.use_nodes = True
next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.22, 0.23, 0.25, 1)
scene.world = world
for nm, en, d in (("key", 3.0, (-0.5, 0.6, -0.8)), ("fill", 1.0, (0.6, -0.4, -0.5))):
    ob = bpy.data.objects.new(nm, bpy.data.lights.new(nm, "SUN"))
    ob.data.energy = en
    ob.rotation_euler = Vector(d).normalized().to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)
# 角色朝向：脚尖方向
bw = lambda n: Vector((amw @ np.array(arm.data.bones[n].matrix_local))[:3, 3])
fwd = (bw("mixamorig:LeftToeBase") - bw("mixamorig:LeftFoot")) + (bw("mixamorig:RightToeBase") - bw("mixamorig:RightFoot"))
fwd.z = 0
fwd.normalize()
side = fwd.cross(Vector((0, 0, 1)))
center = Vector((0, 0, 0.8))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.lens = 50
cam.location = center + fwd * 4.2 + side * 2.0 + Vector((0, 0, 0.5))
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = "BLENDER_EEVEE"
scene.eevee.taa_render_samples = 16
scene.render.resolution_x, scene.render.resolution_y = 400, 560
scene.render.image_settings.file_format = "PNG"

for anim in g["animations"]:
    name = anim["name"]
    if only and name not in only:
        continue
    tmax = max(float(acc(anim["samplers"][c["sampler"]]["input"])[-1]) for c in anim["channels"])
    tiles = []
    for k, t in enumerate(np.linspace(0, tmax, 4)):
        pose_at(anim, float(t))
        p = os.path.join(out_dir, f"_tmp_{name}_{k}.png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(p)
        tiles.append(np.array(im.pixels[:], dtype=np.float32).reshape(560, 400, 4))
        bpy.data.images.remove(im)
        os.remove(p)
    strip = np.concatenate(tiles, axis=1)
    out = bpy.data.images.new("strip", strip.shape[1], strip.shape[0])
    out.pixels = strip.ravel()
    out.filepath_raw = os.path.join(out_dir, f"anim_{name}.jpg")
    out.file_format = "JPEG"
    out.save()
    bpy.data.images.remove(out)
    print("SHOT", name, round(tmax, 2), flush=True)
