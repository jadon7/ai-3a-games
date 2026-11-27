"""把几套“模型 + 动作”摆在一起渲染：逐段动作抽帧出拼图的格子，或者整段渲成录像的帧。给套动作的结果做对比用。

不读出品的 GLB，直接拿 npz 动作摆骨骼（和 hero_build.py / creature_build.py 摆的完全一样，只是手指没换成握拳），所以没出品也能看。
每个角色按包围盒高度缩放到 1（游戏里也是按包围盒把模型放大到 kit.height），地面画米格（按 game_h 换算成游戏里的 1 米）。

用法: Blender -b --factory-startup -P tools/retarget/render.py -- <job.json>
job.json:
 {"actors": [{"model": "…/lan_rigged.glb 或 …/kaz.blend", "motions": {"idle": "…/idle.npz", …}, "root": "mixamorig:Hips", "label": "岚（原）", "hide_weapon": false}, …],
  "clips": ["idle", "run", …], "frames": 8, "views": [[方位角, 俯角], …], "cell": [260, 320], "ortho": 1.45, "zc": 0.5, "game_h": 3.3,
  "out": "输出目录",
  "video": {"clips": ["run", "attack1"], "size": [1280, 720], "spacing": 0.9, "view": [30, 12], "ortho": 1.6, "run_speed": {"run": [每个角色的速度（身高/秒）…]}}}
产出：sheet 模式 <out>/<clip>/<actor>_<view>_<帧>.png；video 模式 <out>/video/<clip>/<帧>.png
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Quaternion, Matrix

job = json.load(open(sys.argv[sys.argv.index("--") + 1:][0], encoding="utf-8"))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; upd = bpy.context.view_layer.update


def load_actor(i, a):
    before = set(bpy.data.objects)
    if a["model"].endswith(".blend"):
        with bpy.data.libraries.load(a["model"], link=False) as (src, dst): dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None and o.type in ("ARMATURE", "MESH", "EMPTY"): sc.collection.objects.link(o)
    else:
        bpy.ops.import_scene.gltf(filepath=a["model"])
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH" and len(o.vertex_groups) and any(m.type == "ARMATURE" for m in o.modifiers)]
    if not meshes: meshes = [o for o in new if o.type == "MESH" and len(o.vertex_groups)]
    body = meshes[0]
    for o in new:
        if o.type == "MESH" and o is not body: bpy.data.objects.remove(o, do_unlink=True)
        elif o.type == "EMPTY" and not any(c in (arm, body) or c.type in ("ARMATURE",) for c in o.children_recursive): bpy.data.objects.remove(o, do_unlink=True)
    if a.get("hide_weapon"):
        wm = {k for k, s_ in enumerate(body.material_slots) if s_.material and s_.material.name.startswith("weapon")}
        bm = bmesh.new(); bm.from_mesh(body.data); bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in wm], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS"); bm.to_mesh(body.data); bm.free()
    upd()
    tops = [o for o in (arm, body) if o.parent is None] + [o.parent for o in (arm, body) if o.parent is not None and o.parent.parent is None]
    holder = bpy.data.objects.new(f"actor{i}", None); sc.collection.objects.link(holder)
    for o in set(tops): o.parent = holder
    upd()
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]; h = max(zs) - min(zs); holder.scale = (1 / h,) * 3; holder.location.z = -min(zs) / h
    for pb in arm.pose.bones: pb.rotation_mode = "QUATERNION"
    mots = {}
    for clip, path in a.get("motions", {}).items():
        if os.path.exists(path):
            m = np.load(path, allow_pickle=True); mots[clip] = ([str(x) for x in m["names"]], m["quats"], m["loc"], float(m["fps"]))
    return {"arm": arm, "body": body, "holder": holder, "mots": mots, "root": a.get("root") or next(b.name for b in arm.data.bones if b.parent is None), "label": a.get("label", f"a{i}"), "h": h, "ortho": a.get("ortho")}


def pose(act, clip, f):
    if clip not in act["mots"]: return False
    names, q, loc, fps = act["mots"][clip]; f = min(f, len(q) - 1); PB = act["arm"].pose.bones
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for i, n in enumerate(names):
        pb = PB.get(n)
        if pb: pb.rotation_quaternion = Quaternion(q[f, i])
    PB[act["root"]].location = Vector(loc[f]); return True


actors = [load_actor(i, a) for i, a in enumerate(job["actors"])]
# ---- 灯光、地面、相机
sc.render.engine = "BLENDER_WORKBENCH"; sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "TEXTURE"; sh.show_shadows = True; sh.shadow_intensity = 0.55; sh.show_cavity = True; sh.cavity_type = "WORLD"
sc.display.light_direction = (0.45, -0.55, 0.75); sc.view_settings.view_transform = "Standard"; sc.view_settings.exposure = job.get("exposure", 1.3); sc.render.film_transparent = False
sh.background_type = "VIEWPORT"; sh.background_color = (0.78, 0.8, 0.82)
G = job.get("game_h", 3.3); N = 512; img = bpy.data.images.new("grid", N, N); px = np.ones((N, N, 4), np.float32); px[..., :3] = (0.62, 0.63, 0.6)
cells = 8; w = 3
for k in range(cells + 1):                                                           # 一格 = 游戏里 1 米
    c = min(N - w, int(k * N / cells)); px[c:c + w, :, :3] = 0.38; px[:, c:c + w, :3] = 0.38
img.pixels = px.ravel(); mat = bpy.data.materials.new("ground"); mat.use_nodes = True; nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.interpolation = "Closest"; bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"); nt.links.new(tex.outputs[0], bsdf.inputs[0])
size = cells / G; tiles = 16
bpy.ops.mesh.primitive_plane_add(size=size * tiles); ground = bpy.context.active_object; ground.data.materials.append(mat)
uv = ground.data.uv_layers.active.data
for lp in uv: lp.uv = lp.uv * tiles
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"


def aim(center, az, el, ortho, dist=6):
    a_, e_ = math.radians(az), math.radians(el); d = Vector((math.sin(a_) * math.cos(e_), -math.cos(a_) * math.cos(e_), math.sin(e_)))
    cam.location = center + d * dist; cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler(); cam.data.ortho_scale = ortho


out = job["out"]; os.makedirs(out, exist_ok=True)
if job.get("clips"):
    W_, H_ = job.get("cell", [260, 320]); sc.render.resolution_x = W_; sc.render.resolution_y = H_; nfr = job.get("frames", 8)
    for clip in job["clips"]:
        d = os.path.join(out, clip); os.makedirs(d, exist_ok=True)
        for ai, act in enumerate(actors):
            for c_ in actors: [setattr(x, "hide_render", c_ is not act) for x in (c_["arm"], c_["body"])]
            if clip not in act["mots"]: continue
            T = len(act["mots"][clip][1]); idx = [round(i * (T - 1) / max(1, nfr - 1)) for i in range(nfr)]
            for vi, (az, el) in enumerate(job.get("views", [[30, 12]])):
                for k, f in enumerate(idx):
                    pose(act, clip, f); upd()
                    hips = act["arm"].matrix_world @ act["arm"].pose.bones[act["root"]].head
                    aim(Vector((hips.x, hips.y, job.get("zc", 0.5))), az, el, act["ortho"] or job.get("ortho", 1.45))
                    sc.render.filepath = os.path.join(d, f"{ai}_{vi}_{k:02d}.png"); bpy.ops.render.render(write_still=True)
    print("SHEET", out)
V = job.get("video")
if V:
    # 录像：几个角色并排站着不动，每人脚下一条自己的地面。跑步时地面条按这个人“该有的速度”往后走（等于人往前跑、镜头跟着），
    # 脚踩实的话脚和格子一起走、看不出滑；滑的话脚在格子上溜。这样几个人速度不同也不会越跑越散。
    sc.render.resolution_x, sc.render.resolution_y = V.get("size", [1280, 640]); sp = V.get("spacing", 0.9)
    for c_ in actors: [setattr(x, "hide_render", False) for x in (c_["arm"], c_["body"])]
    ground.hide_render = True; strips = []; cell = 1 / G
    for i, act in enumerate(actors):
        act["x0"] = (i - (len(actors) - 1) / 2) * sp; act["holder"].location.x = act["x0"]
        bpy.ops.mesh.primitive_plane_add(size=1); st = bpy.context.active_object; st.data.materials.append(mat)
        st.scale = (sp * 0.985, 12, 1); st.location = (act["x0"], 0, 0); bpy.context.view_layer.update()
        for lp, li in zip(st.data.uv_layers.active.data, [l.vertex_index for l in st.data.loops]):
            co = st.matrix_world @ st.data.vertices[li].co; lp.uv = (co.x * G / cells, co.y * G / cells)      # 一格 = 游戏里 1 米，和人一起缩放过
        strips.append(st)
    for clip in V["clips"]:
        d = os.path.join(out, "video", clip); os.makedirs(d, exist_ok=True)
        T = max(len(a["mots"][clip][1]) for a in actors if clip in a["mots"]); reps = V.get("loops", {}).get(clip, 1); speeds = V.get("run_speed", {}).get(clip)
        fps = next(a["mots"][clip][3] for a in actors if clip in a["mots"]); n = 0
        for r_ in range(reps):
            for f in range(T if r_ == reps - 1 or clip not in V.get("loops", {}) else T - 1):
                for i, act in enumerate(actors):
                    pose(act, clip, f)
                    strips[i].location.y = ((speeds[i] * n / fps) % cell) if speeds else 0.0      # 地面往后（+Y）走，挪满一格就回绕，格子看起来一直在走
                upd()
                az, el = V.get("view", [30, 12]); aim(Vector((0, 0, V.get("zc", 0.5))), az, el, V.get("ortho", sp * (len(actors) + 0.4)), 12)
                sc.render.filepath = os.path.join(d, f"{n:04d}.png"); bpy.ops.render.render(write_still=True); n += 1
        print("VIDEO", clip, n, "frames")
