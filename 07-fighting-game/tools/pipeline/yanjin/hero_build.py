"""英雄模型的整理和导出，分两步（配置里的 stage）：

  rig   把 Tripo 绑好骨的模型摆正、把武器清理好并合进身体的网格（蒙到手的骨骼上），
        导出一个静止姿势的 GLB。它既是动作管线（video2rig）的输入，也是下一步的输入。
  game  读上一步的 GLB，加上动作，压贴图，导出游戏用的 GLB。
        动作有两种来源：脚本自己摆的站姿（带呼吸，动作名 idle_pose）；管线从视频里读出来的动作（motion.npz）。

用法: Blender -b --factory-startup -P tools/blender/hero_build.py -- <配置.json> [stage]
配置见 art/hero/lan/build.json。

约定（和 video2rig 管线一致）：角色脚踩 z=0，面朝 -Y，左手边是 +X，身高约 1.0。游戏里再整体放大。
两步都从同一个 GLB 读骨架，所以骨骼的静止朝向和管线里完全一样，管线算出来的旋转可以直接用。
站姿不是手调骨骼角度，而是给出脚踝、手腕要到的位置和武器要指的方向，用两段骨骼的解析解算出来。
"""
import bpy, bmesh, sys, math, os, json
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
cfg = json.load(open(argv[0], encoding="utf-8"))
stage = argv[1] if len(argv) > 1 else cfg.get("stage", "game")
ROOT = "/Users/jadon7/Documents/SynologyDrive/code/fighting-game"      # 阎烬用的拷贝（FG/tools/pipeline/yanjin）：相对路径按 FG 算
P = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
MX = "mixamorig:"
FWD = Vector((0, -1, 0))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=P(cfg["raw"] if stage == "rig" else cfg["rigged"]))
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
for o in list(sc.objects):
    if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
body.name = "body"; arm.name = cfg["name"]
B = arm.data.bones
upd = bpy.context.view_layer.update


def hand_frame(side):
    """静止姿势下一只手的握持坐标：L 刀身方向（小指侧指向食指侧），E 刃口方向（顺着前臂往外），n 掌心朝向，p 握把中心"""
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized()
    n = L.cross(d).normalized()
    if cfg.get("palm_by_hand"):                                # 解剖学上的掌心：右手是 L×d，左手取反。不管静止姿势里手朝哪边都对
        if side == "Left": n = -n
    elif n.dot(FWD) < 0: n = -n                                # 老办法：假设静止时掌心朝前。岚和小兵是按这个调的，不动它们
    p = h + (mid - h) * 0.7 + n * cfg.get("weapon", {}).get("palm", 0.012)
    return L, E, n, p


def shrink_textures():
    for slot, size in zip(body.material_slots, [cfg.get("tex", 2048)] + [cfg.get("weapon_tex", cfg.get("weapon", {}).get("tex", 1024))] * 8):      # 第一个材质是身体，后面的都是武器
        for nd in slot.material.node_tree.nodes:
            if nd.type == "TEX_IMAGE" and nd.image and nd.image.size[0] > size: nd.image.scale(size, size)


def views(prefix, res=720, spec="0:8,35:18,90:8,180:8,0:56"):
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.view_settings.view_transform = "Standard"
    wd = bpy.data.worlds.new("w"); sc.world = wd; wd.use_nodes = True
    wd.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.45; c = Vector((0, 0, 0.52)); out = []
    for i, v in enumerate(spec.split(",")):
        az, el = [math.radians(float(x)) for x in v.split(":")]
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
        sc.render.filepath = f"{prefix}_{i}.png"; bpy.ops.render.render(write_still=True); out.append(sc.render.filepath)
    bpy.data.objects.remove(sun, do_unlink=True); bpy.data.objects.remove(cam, do_unlink=True)
    print("FILES", " ".join(out))


# =====================================================================================
if stage == "rig":
    # ---- 摆正：Tripo 出来的角色面朝 +X，转成面朝 -Y；胯对准原点 ----
    toe = B[MX + "LeftToeBase"].head_local - B[MX + "LeftFoot"].head_local
    yaw = -math.pi / 2 - math.atan2(toe.y, toe.x)
    R = Matrix.Rotation(round(yaw / (math.pi / 2)) * (math.pi / 2), 4, "Z")
    arm.data.transform(R); body.data.transform(R); body.data.update(); upd()
    hp = B[MX + "Hips"].head_local; T = Matrix.Translation((-hp.x, -hp.y, 0))
    arm.data.transform(T); body.data.transform(T); body.data.update(); upd()
    print("FACING left hand x =", round(B[MX + "LeftHand"].head_local.x, 3), " toe y =", round(B[MX + "LeftToeBase"].head_local.y, 3))
    assert B[MX + "LeftHand"].head_local.x > 0 and B[MX + "LeftToeBase"].head_local.y < B[MX + "LeftFoot"].head_local.y
    body.material_slots[0].material.name = cfg.get("body_material", "hero")      # 换画风 B：卡通厚涂的新模型写 "hero_b"（武器材质也以 _b 结尾），游戏里 hero/hero.ts 认这个后缀换卡通的材质处理；老模型照旧是 "hero"

    # ---- 武器：去掉碎块，量出握把的位置，放到两只手里，再合进身体的网格 ----
    parts = []
if stage == "rig" and cfg.get("weapon", {}).get("src"):
    w = cfg["weapon"]; before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=P(w["src"]), merge_vertices=True)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "MESH")
    mw = src.matrix_world.copy(); src.parent = None; src.matrix_world = Matrix.Identity(4); src.data.transform(mw)
    for o in new:
        if o is not src: bpy.data.objects.remove(o, do_unlink=True)
    # 图转 3D 常在武器背面多生成一片贴着的碎块，而且和主体连在一起，按“连通”分不开。
    # 做法：刀身前半段只有主体，用它拟合出刀的中线（顺便得到刀尖的真实朝向），离中线太远的顶点删掉。
    la = w.get("long_axis", 1); ta = w.get("thin_axis", 0)
    bm = bmesh.new(); bm.from_mesh(src.data); bm.verts.ensure_lookup_table()
    ys = [v.co[la] for v in bm.verts]; y0 = min(ys); y1 = max(ys); cl = w.get("clean", {"from": 0.6, "keep": 0.046})
    far = [v for v in bm.verts if v.co[la] > y0 + (y1 - y0) * cl["from"]]
    my = sum(v.co[la] for v in far) / len(far); mt = sum(v.co[ta] for v in far) / len(far)
    slope = sum((v.co[la] - my) * (v.co[ta] - mt) for v in far) / sum((v.co[la] - my) ** 2 for v in far)
    line = lambda y: mt + slope * (y - my)
    drop = [v for v in bm.verts if abs(v.co[ta] - line(v.co[la])) > cl["keep"] * (y1 - y0)]
    print("BLADE verts", len(bm.verts), "drop", len(drop), "slope", round(slope, 3))
    bmesh.ops.delete(bm, geom=drop, context="VERTS"); bm.to_mesh(src.data); bm.free(); src.data.update()
    if (la, ta) == (1, 0): src.data.transform(Matrix.Rotation(math.atan(slope), 4, "Z")); src.data.update()      # 把刀身转正，对准长轴
    co = [v.co.copy() for v in src.data.vertices]
    mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)])
    length = mx[la] - mn[la]; g0, g1 = w["grip"]                # 握把在刀长上的范围（从柄尾算起的比例）
    seg = [c for c in co if mn[la] + g0 * length <= c[la] <= mn[la] + g1 * length]
    grip = sum(seg, Vector()) / len(seg); grip[la] = mn[la] + (g0 + g1) / 2 * length
    print("BLADE size", [round(v, 3) for v in (mx - mn)], "grip", [round(v, 3) for v in grip])
    tip = Vector(w["tip"]); spine = Vector(w["spine"]); Fb = Matrix((tip.cross(spine), tip, spine)).transposed()      # 武器自己的坐标：厚度、刀尖、刀背
    s = w["length"] / length; src.material_slots[0].material.name = "weapon"
    for side in ("Left", "Right"):
        L, E, n, p = hand_frame(side)
        Ft = Matrix((L.cross(-E), L, -E)).transposed()           # 刀尖对 L，刀背对 -E（刃口朝 E）
        o = bpy.data.objects.new("blade_" + side[0], src.data.copy()); sc.collection.objects.link(o)
        o.data.transform(Matrix.Translation(p) @ (Ft @ Fb.inverted()).to_4x4() @ Matrix.Scale(s, 4) @ Matrix.Translation(-grip)); o.data.update()
        o.vertex_groups.new(name=MX + side + "Hand").add(list(range(len(o.data.vertices))), 1.0, "REPLACE")      # 整把刀跟着手的骨骼
        parts.append(o)
    bpy.data.objects.remove(src, do_unlink=True)
def load_weapon(g, gi):
    """图转 3D 的武器（gear 里 type 是 file 的）：读进来，把最长的方向转成握持坐标的 +Y（杆身从拳眼伸出去的方向），缩放到指定长度，握的位置挪到原点。
    配置：src 文件；length 整件武器沿长轴的长度（角色身高是 1）；grip 手握在长轴上的位置（0 是底端，1 是顶端）；
    long_axis 不写就取最长的那个轴；flip 为 true 时把两头对调；roll 绕杆身转多少度；material 材质名（要以 weapon 开头，游戏靠它认武器）。"""
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=P(g["src"]), merge_vertices=True)
    new = [o for o in bpy.data.objects if o not in before]; src = next(o for o in new if o.type == "MESH")
    mw = src.matrix_world.copy(); src.parent = None; src.matrix_world = Matrix.Identity(4); me = src.data.copy(); me.transform(mw)
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    co = [v.co for v in me.vertices]; mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)]); size = mx - mn
    la = g.get("long_axis", max(range(3), key=lambda i: size[i])); o1, o2 = [a for a in range(3) if a != la]
    R = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0))); sg = -1 if g.get("flip") else 1
    R[1][la] = sg; R[0][o1] = 1; R[2][o2] = 1                    # 新的 Y 取原来的长轴，另外两个轴原样放到 X、Z
    if R.determinant() < 0: R[2][o2] = -1                        # 保持右手系，不然面会翻过来
    me.transform(R.to_4x4() @ Matrix.Translation(-(mn + mx) / 2)); me.transform(Matrix.Scale(g["length"] / size[la], 4))
    if g.get("roll"): me.transform(Matrix.Rotation(math.radians(g["roll"]), 4, "Y"))
    L_ = g["length"]; gy = (g.get("grip", 0.3) - 0.5) * L_; seg = [v.co for v in me.vertices if abs(v.co.y - gy) < 0.04 * L_] or [Vector((0, gy, 0))]
    c = sum(seg, Vector()) / len(seg); me.transform(Matrix.Translation((-c.x, -gy, -c.z))); me.update()
    for i_, m_ in enumerate(me.materials): m_.name = g.get("material", "weapon" + ("" if gi == 0 else str(gi + 1))) + ("" if i_ == 0 else f"_{i_}")
    print("WEAPON", g["src"], "verts", len(me.vertices), "size", [round(v, 3) for v in size], "long_axis", la, "materials", [m_.name for m_ in me.materials])
    return me


if stage == "rig" and cfg.get("gear"):
    # 拿在手里的东西。三种来源（type）：
    #   axe / shield / staff …  tools/blender/unit_gear.py 里代码建的（小兵用的）
    #   script                  英雄自己文件夹里的脚本建的：{"type":"script","path":"art/hero/x/gear.py","func":"make_hammer"}，函数返回一个网格
    #   file                    图转 3D 的模型，见上面的 load_weapon
    # 网格都按“握持坐标”建：原点是手握的位置，+Y 是杆身从拳眼（食指一侧）伸出去的方向，-Z 是顺着前臂往外。
    # mount 是 hand（默认，跟着手）或 forearm（盾，绑在前臂外侧）；offset（米，身高是 1）、rot（度，XYZ）、scale 用来微调。
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import unit_gear, importlib.util
    for gi, g in enumerate(cfg["gear"]):
        side = g["side"]; L, E, n, p = hand_frame(side); kind = g["type"]
        if kind == "file": me = load_weapon(g, gi)
        elif kind == "script":
            sp_ = importlib.util.spec_from_file_location("gear_" + cfg["name"], P(g["path"])); md_ = importlib.util.module_from_spec(sp_); sp_.loader.exec_module(md_); me = getattr(md_, g["func"])()
        else: me = getattr(unit_gear, "make_" + kind)()
        o = bpy.data.objects.new(g.get("name", kind + str(gi)), me); sc.collection.objects.link(o)
        adj = Matrix.Translation(Vector(g.get("offset", (0, 0, 0)))) @ Euler([math.radians(a) for a in g.get("rot", (0, 0, 0))]).to_matrix().to_4x4() @ Matrix.Scale(g.get("scale", 1.0), 4)
        if g.get("mount", "forearm" if kind == "shield" else "hand") == "forearm":
            fa = B[MX + side + "ForeArm"]; mid = (fa.head_local + fa.tail_local) / 2; out = -n; d = (fa.tail_local - fa.head_local).normalized(); out = (out - d * out.dot(d)).normalized()
            M = Matrix((d.cross(out), d, out)).transposed().to_4x4(); o.data.transform(Matrix.Translation(mid + out * 0.045) @ M @ adj); bone = MX + side + "ForeArm"
        else:
            Ft = Matrix((L.cross(-E), L, -E)).transposed().to_4x4(); o.data.transform(Matrix.Translation(p) @ Ft @ adj); bone = MX + side + "Hand"
        o.data.update(); o.vertex_groups.new(name=bone).add(list(range(len(o.data.vertices))), 1.0, "REPLACE"); parts.append(o)
if stage == "rig":
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts: o.select_set(True)
    body.select_set(True); bpy.context.view_layer.objects.active = body; bpy.ops.object.join(); upd()
    body.data.calc_loop_triangles(); print("JOINED tris", len(body.data.loop_triangles), "materials", [s_.material.name for s_ in body.material_slots])
    shrink_textures()
    out = P(cfg["rigged"]); os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=False, export_skins=True, export_yup=True, export_apply=False)
    print("SAVED", out, round(os.path.getsize(out) / 1e6, 2), "MB")
    sys.exit(0)

# =====================================================================================
# game：站姿、动作、导出
bpy.context.view_layer.objects.active = arm
PB = arm.pose.bones
for pb in PB: pb.rotation_mode = "QUATERNION"
REST = {b.name: b.matrix_local.copy() for b in B}
arm.animation_data_create()


def rot_about(pb, R3):
    """让一根骨骼绕自己的头（在骨架空间里）转 R3"""
    upd(); h = pb.head.copy(); pb.matrix = Matrix.Translation(h) @ R3.to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()
def aim(name, target):
    pb = PB[MX + name]; upd(); cur = (pb.tail - pb.head).normalized()
    rot_about(pb, cur.rotation_difference(Vector(target).normalized()).to_matrix())
def turn(name, axis, deg):
    rot_about(PB[MX + name], Matrix.Rotation(math.radians(deg), 3, Vector(axis)))
def ik(upper, lower, target, pole):
    """两段骨骼的解析解：upper 的头不动，让 lower 的尾（脚踝、手腕）到 target，膝盖或手肘朝 pole 那一侧"""
    pu = PB[MX + upper]; pl = PB[MX + lower]; upd()
    H = pu.head.copy(); l1 = pu.bone.length; l2 = pl.bone.length
    d = Vector(target) - H; dist = min(d.length, (l1 + l2) * 0.998); dn = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist); hgt = math.sqrt(max(l1 * l1 - a * a, 0))
    pv = Vector(pole); pv = (pv - dn * pv.dot(dn)).normalized()
    K = H + dn * a + pv * hgt
    aim(upper, K - H); aim(lower, H + dn * dist - K)
def cur_rot(name):
    """这根骨骼现在相对静止姿势转了多少（骨架空间）"""
    upd(); return PB[MX + name].matrix.to_3x3() @ REST[MX + name].to_3x3().inverted()
def frame(a, b):
    a = Vector(a).normalized(); b = Vector(b); b = (b - a * b.dot(a)).normalized()
    return Matrix((a, b, a.cross(b))).transposed()
def grip_quats(side, k=1.0):
    """握拳时各指节相对静止姿势的旋转（骨骼自己的坐标系）：四指绕指根连线往掌心卷，拇指从另一侧压到食指上"""
    L, E, n, p = hand_frame(side); h = B[MX + side + "Hand"].head_local; out = {}
    for f in ("Index", "Middle", "Ring", "Pinky"):
        fd = (B[MX + side + "Hand" + f + "1"].tail_local - B[MX + side + "Hand" + f + "1"].head_local).normalized()
        sgn = 1 if L.cross(fd).dot(n) > 0 else -1
        for j, deg in ((1, 62), (2, 88), (3, 55)):
            nm = MX + side + "Hand" + f + str(j); out[nm] = Quaternion(REST[nm].to_3x3().inverted() @ (L * sgn), math.radians(deg * k))
    d = (h - B[MX + side + "ForeArm"].head_local).normalized(); acc = Matrix.Identity(3)
    for j, (a_, b_, c_) in ((1, (0.35, 0.85, 0.0)), (2, (0.0, 0.75, 0.6)), (3, (-0.2, 0.4, 0.9))):
        nm = MX + side + "HandThumb" + str(j); td = (B[nm].tail_local - B[nm].head_local).normalized()
        q = td.rotation_difference(acc.inverted() @ (L * a_ + n * b_ + d * c_).normalized()).to_matrix()
        M = REST[nm].to_3x3(); out[nm] = (M.inverted() @ q @ M).to_quaternion(); acc = acc @ q
    return out
# 每只手的手指（配置里的 grip）：不写就是握紧（1.0）；写一个数是握多紧（粗的杖松一点，0 是摊开不弯）；写 null 是不固定，跟着动作里读出来的手指走
def make_grip(spec):
    g = {}
    for _s in ("Left", "Right"):
        _k = spec.get(_s, 1.0)
        if _k is not None: g.update(grip_quats(_s, _k))
    return g
GRIP = make_grip(cfg.get("grip", {}))
# 阎烬加的：按动作分别控制手指。grip_actions: {"idle": {"Left": 0.1}}（没写的手照 grip）；stance_grip 是 idle_pose 用的
GRIP_ACT = {k: make_grip({**cfg.get("grip", {}), **v}) for k, v in cfg.get("grip_actions", {}).items()}
GRIP_POSE = make_grip({**cfg.get("grip", {}), **cfg.get("stance_grip", {})})

S = cfg["stance"]
def pose(ph):
    """摆整个站姿；ph 是呼吸的相位（弧度）"""
    for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    upd(); br = math.sin(ph); br2 = math.sin(ph - 0.7)
    hips = PB[MX + "Hips"]; h0 = REST[MX + "Hips"]              # 胯：下沉、转身、随呼吸起伏
    off = Vector(S["hips"]["offset"]) + Vector((0, 0, S["breath"]["hips"] * br))
    Rh = Matrix.Rotation(math.radians(S["hips"]["yaw"]), 3, "Z") @ Matrix.Rotation(math.radians(S["hips"]["lean"]), 3, "X") @ Matrix.Rotation(math.radians(S["hips"].get("roll", 0)), 3, "Y")
    hips.matrix = Matrix.Translation(h0.translation + off) @ (Rh @ h0.to_3x3()).to_4x4(); upd()
    for nm, lean, yw in (("Spine", *S["spine"][0]), ("Spine1", *S["spine"][1]), ("Spine2", *S["spine"][2])):      # 脊柱：前倾、扭转；胸口随呼吸起伏
        turn(nm, (0, 0, 1), yw); turn(nm, cur_rot(nm) @ Vector((1, 0, 0)), lean + (S["breath"]["chest"] * br if nm != "Spine" else 0))
    turn("Neck", (0, 0, 1), S["head"]["yaw"] * 0.4); turn("Head", (0, 0, 1), S["head"]["yaw"] * 0.6)
    turn("Head", cur_rot("Head") @ Vector((1, 0, 0)), S["head"]["pitch"] - S["breath"]["chest"] * 0.6 * br)
    for side, sx in (("Left", 1), ("Right", -1)):
        leg = S["legs"][side]
        ank = Vector(leg["ankle"]) if "ankle" in leg else REST[MX + side + "Foot"].translation + Vector(leg["offset"])
        ik(side + "UpLeg", side + "Leg", ank, leg["pole"])
        ft = PB[MX + side + "Foot"]; upd()                      # 脚掌保持水平，只按给定的外八角度转
        ft.matrix = Matrix.Translation(ft.head.copy()) @ (Matrix.Rotation(math.radians(leg["toe"]), 3, "Z") @ REST[MX + side + "Foot"].to_3x3()).to_4x4(); upd()
        a = S["arms"][side]
        turn(side + "Shoulder", (0, 1, 0), -sx * (a.get("shrug", 0) + S["breath"]["shoulder"] * br))
        upd(); arm_len = B[MX + side + "Arm"].length + B[MX + side + "ForeArm"].length
        wr = Vector(a["wrist"]) if "wrist" in a else PB[MX + side + "Arm"].head + Vector(a["dir"]).normalized() * arm_len * a.get("reach", 0.9)
        ik(side + "Arm", side + "ForeArm", wr + Vector((0, 0, S["breath"]["hand"] * br2)), a["pole"])
        # 手腕：让武器指向给定的方向。刃口默认顺着前臂（手腕不弯），所以前臂和刀身大致垂直时握法最自然
        L, E, n, p = hand_frame(side); Rc = cur_rot(side + "Hand")
        fore = (PB[MX + side + "Hand"].head - PB[MX + side + "ForeArm"].head).normalized()
        rot_about(PB[MX + side + "Hand"], frame(a["blade"], a.get("edge", fore)) @ frame(Rc @ L, Rc @ E).inverted())
    for nm, q in GRIP_POSE.items(): PB[nm].rotation_quaternion = q
    upd()


def stash(act, name):
    """把一段动作放进自己的 NLA 轨道：导出时每条轨道是一段 glTF 动画"""
    act.name = name; tr = arm.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, int(act.frame_range[0]), act); arm.animation_data.action = None


fps = 30; sc.render.fps = fps; n = S["breath"]["frames"]; steps = 12
arm.animation_data.action = bpy.data.actions.new("idle_pose")
for i in range(steps + 1):
    f = round(n * i / steps); pose(2 * math.pi * i / steps)
    for pb in PB:
        pb.keyframe_insert("rotation_quaternion", frame=f)
        if pb.name == MX + "Hips": pb.keyframe_insert("location", frame=f)
pose(0)
print("POSED feet z", [round(PB[MX + s_ + "Foot"].head.z, 3) for s_ in ("Left", "Right")], "hands", [[round(v, 3) for v in PB[MX + s_ + "Hand"].head] for s_ in ("Left", "Right")])
if cfg.get("pose_out"):                                        # 站姿存一份（按骨骼名），给管线渲染双机位参考图用
    np.savez(P(cfg["pose_out"]), names=np.array([pb.name for pb in PB]), quats=np.array([list(pb.rotation_quaternion) for pb in PB]), loc=np.array(list(PB[MX + "Hips"].location)))
    print("POSE", cfg["pose_out"])
if cfg.get("views"):
    os.makedirs(os.path.dirname(P(cfg["views"])), exist_ok=True); views(P(cfg["views"]))
stash(arm.animation_data.action, "idle_pose"); frames_max = n

# ---- 管线读出来的动作（见 tools/hero_motion.py 的后处理：循环、原地、握拳） ----
for name, path in cfg.get("motions", {}).items():
    if not os.path.exists(P(path)): print("SKIP", name, "还没有动作数据"); continue
    m = np.load(P(path), allow_pickle=True); names = [str(x) for x in m["names"]]; q = m["quats"]; loc = m["loc"]; T = q.shape[0]
    G_ = GRIP_ACT.get(name, GRIP)
    arm.animation_data.action = bpy.data.actions.new(name)
    for f in range(T):
        for i, nm in enumerate(names):
            pb = PB.get(nm)
            if pb is None: continue
            pb.rotation_quaternion = G_[nm] if nm in G_ else Quaternion(q[f, i]); pb.keyframe_insert("rotation_quaternion", frame=f)
        hp = PB[MX + "Hips"]; hp.location = Vector(loc[f]); hp.keyframe_insert("location", frame=f)
    act = arm.animation_data.action; fcs = []                # 新版 Blender 的动作分层存曲线，老版直接挂在动作上
    if hasattr(act, "layers") and len(act.layers):
        for layer in act.layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []): fcs.extend(bag.fcurves)
    elif hasattr(act, "fcurves"): fcs = list(act.fcurves)
    for fc in fcs:
        for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
    stash(arm.animation_data.action, name); frames_max = max(frames_max, T - 1); print("ACTION", name, T, "frames")
for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
sc.frame_start = 0; sc.frame_end = frames_max; sc.frame_set(0); upd()

shrink_textures()
out = P(cfg["out"]); os.makedirs(os.path.dirname(out), exist_ok=True)
kw = dict(filepath=out, export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS", export_skins=True, export_yup=True, export_force_sampling=True, export_apply=False)
try: bpy.ops.export_scene.gltf(**kw, export_image_format="WEBP", export_image_quality=88)
except TypeError: bpy.ops.export_scene.gltf(**kw, export_image_format="JPEG", export_jpeg_quality=88)
print("SAVED", out, round(os.path.getsize(out) / 1e6, 2), "MB")
