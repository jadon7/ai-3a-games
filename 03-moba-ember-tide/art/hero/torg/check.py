"""托尔格的站姿检查（只读 game.glb，不改任何模型）：
  1. 量：武器和身体哪里穿了（按身体的骨骼、按武器上的位置分组）；左手握的地方离杆身多远、落在柄的哪一段。
  2. 看：整身五个角度一张（正、右前斜、右侧、背、游戏俯视），两只手的近景一张。
用法: Blender -b --factory-startup -P art/hero/torg/check.py -- <game.glb> <输出前缀> <build.json> [动作名=idle_pose] [帧=0]
tools/blender/views.py 取景时把导入器自己生成的骨骼形状（一个半径 1 的 Icosphere）也算进去了，角色只占画面的一小块，所以这里自己取景。
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
glb, prefix, cfg = argv[0], argv[1], json.load(open(argv[2], encoding="utf-8"))
act_name = argv[3] if len(argv) > 3 else "idle_pose"; frame = int(argv[4]) if len(argv) > 4 else 0
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
MX = "mixamorig:"; FWD = Vector((0, -1, 0))
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(sc.objects):
    if o.type == "MESH" and not len(o.vertex_groups): bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH")
act = bpy.data.actions.get(act_name)
if act:
    arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks): tr.mute = True
    arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
sc.frame_set(frame); bpy.context.view_layer.update()
B = arm.data.bones; PB = arm.pose.bones; MW = arm.matrix_world


def hand_frame(side, true_palm=True):
    """和 hero_build.py 的 hand_frame 一样，只是 n 可以取解剖学上真正的掌心（右手 L×d，左手 d×L）"""
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized(); n = L.cross(d).normalized()
    nb = n.copy() if n.dot(FWD) >= 0 else -n                    # hero_build.py 取的 n（假设掌心朝前）
    palm = n if side == "Right" else -n
    return L, E, (palm if true_palm else nb), nb, h, mid


def to_world(bone, p_rest): return MW @ (PB[bone].matrix @ (B[bone].matrix_local.inverted() @ p_rest))
def dir_world(bone, v_rest): return (MW.to_3x3() @ (PB[bone].matrix.to_3x3() @ (B[bone].matrix_local.to_3x3().inverted() @ v_rest))).normalized()


# ---- 杆身在世界里的位置：握点（hero_build 放武器的那个点，含 gear 的 offset）和方向 ----
g = cfg["gear"][0]; L, E, palm, nb, h, mid = hand_frame("Right")
p_rest = h + (mid - h) * 0.7 + (nb if os.environ.get("SHARED_N") else palm) * cfg.get("weapon", {}).get("palm", 0.012)      # build.sh 的补丁版用真正的掌心；要对照共用脚本的结果就设 SHARED_N=1
Ft = Matrix((L.cross(-E), L, -E)).transposed().to_4x4()
adj = Matrix.Translation(Vector(g.get("offset", (0, 0, 0)))) @ Euler([math.radians(a) for a in g.get("rot", (0, 0, 0))]).to_matrix().to_4x4() @ Matrix.Scale(g.get("scale", 1.0), 4)
Mg = Matrix.Translation(p_rest) @ Ft @ adj                      # 握持坐标 → 静止姿势下的骨架坐标
grip_w = to_world(MX + "RightHand", Mg @ Vector((0, 0, 0))); axis_w = dir_world(MX + "RightHand", (Mg.to_3x3() @ Vector((0, 1, 0))))
import importlib.util
sp = importlib.util.spec_from_file_location("gear_torg", os.path.join(here, "gear.py")); gear = importlib.util.module_from_spec(sp); sp.loader.exec_module(gear)
S = lambda p: (p - grip_w).dot(axis_w) + gear.GRIP              # 世界里一个点落在武器的哪一段（离铁环底的距离）
print("SHAFT 握点", [round(v, 3) for v in grip_w], "方向(朝钟)", [round(v, 3) for v in axis_w], "仰角", round(math.degrees(math.asin(axis_w.z)), 1),
      "钟顶", [round(v, 3) for v in grip_w + axis_w * (gear.LEN - gear.GRIP)], "环底", [round(v, 3) for v in grip_w - axis_w * gear.GRIP])
for side in ("Right", "Left"):
    L2, E2, palm2, nb2, h2, mid2 = hand_frame(side)
    pc = to_world(MX + side + "Hand", h2 + (mid2 - h2) * 0.7 + palm2 * 0.035); Lw = dir_world(MX + side + "Hand", L2); pw = dir_world(MX + side + "Hand", palm2)
    wr = MW @ PB[MX + side + "Hand"].head; rel = pc - grip_w; off = rel - axis_w * rel.dot(axis_w)
    sh = MW @ PB[MX + side + "Arm"].head; el = MW @ PB[MX + side + "ForeArm"].head
    a1 = (el - sh).normalized(); a2 = (wr - el).normalized()
    print("HAND %-5s 手腕 %s 掌心前 3.5cm 处 %s  离杆身 %.3f  落在柄的 s=%.3f  拳眼方向和杆身夹角 %.0f°  掌心朝 %s  肘弯 %.0f°  肩到腕 %.3f/%.3f" % (
        side, [round(v, 3) for v in wr], [round(v, 3) for v in pc], off.length, S(pc), math.degrees(math.acos(max(-1, min(1, Lw.dot(axis_w))))), [round(v, 2) for v in pw],
        math.degrees(math.acos(max(-1, min(1, a1.dot(a2))))), (wr - sh).length, B[MX + side + "Arm"].length + B[MX + side + "ForeArm"].length))
    print("SHOULDER %-5s 肩头 %s  肘 %s" % (side, [round(v, 3) for v in sh], [round(v, 3) for v in el]))
    goal = cfg["stance"]["arms"][side]
    if side == "Right" and "_grip" in goal: print("FIT Right %.5f %.5f %.5f" % tuple(Vector(goal["_grip"]) - grip_w))      # 想让武器的握点在 _grip：右手腕要挪多少
    if side == "Left" and "_s" in goal:                                                                                  # 想让左手握在柄的 s=_s 处：左手腕要挪多少
        print("FIT Left %.5f %.5f %.5f" % tuple(grip_w + axis_w * (goal["_s"] - gear.GRIP) - pc)); print("FIT Axis %.5f %.5f %.5f" % tuple(axis_w))

# ---- 穿模：摆好姿势以后的网格，武器的面和身体的面做相交 ----
dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
W = ev.matrix_world; co = [W @ v.co for v in me.vertices]
gname = {gp.index: gp.name.replace(MX, "") for gp in body.vertex_groups}
vbone = [gname[max(v.groups, key=lambda x: x.weight).group] if v.groups else "-" for v in body.data.vertices]
wm = {i for i, s_ in enumerate(body.material_slots) if s_.material.name.startswith("weapon")}
tw = [tuple(t.vertices) for t in me.loop_triangles if t.material_index in wm]; tb = [tuple(t.vertices) for t in me.loop_triangles if t.material_index not in wm]
pairs = BVHTree.FromPolygons(co, tw).overlap(BVHTree.FromPolygons(co, tb))
hits = {}
for iw, ib in pairs:
    bone = vbone[tb[ib][0]]; c = sum((co[i] for i in tw[iw]), Vector()) / 3; hits.setdefault(bone, []).append(S(c))
zmin = min(c.z for c in co); wz = [co[i].z for t in tw for i in t]
print("GROUND 全身最低 z=%.3f  武器最低 z=%.3f 最高 z=%.3f  画面范围 x[%.2f, %.2f] y[%.2f, %.2f]（管线的画面是 ±0.8、z 到 1.66）" % (zmin, min(wz), max(wz), min(c.x for c in co), max(c.x for c in co), min(c.y for c in co), max(c.y for c in co)))
if not hits: print("CLIP 武器和身体没有相交的面")
for bone, ss in sorted(hits.items(), key=lambda kv: -len(kv[1])):
    kind = "（握着的手，正常）" if "Hand" in bone else ""
    print("CLIP %-16s %4d 对面相交  武器上 s=%.2f~%.2f %s" % (bone, len(ss), min(ss), max(ss), kind))
bad = sum(len(v) for k, v in hits.items() if "Hand" not in k); print("CLIP_TOTAL 不算手：", bad)
from mathutils.kdtree import KDTree
bv = sorted({i for t in tb for i in t if "Hand" not in vbone[i]}); kd = KDTree(len(bv))
for k, i in enumerate(bv): kd.insert(co[i], k)
kd.balance()
def radius(s_):      # 武器在 s 处有多粗（和 gear.py 的尺寸对应）
    if s_ < 0.09: return 0.042
    if s_ < 0.762: return 0.029
    if s_ < 0.846: return 0.045
    if s_ < 0.893: return 0.060
    if s_ < 0.940: return 0.124
    if s_ < 1.110: return 0.106 - (s_ - 0.94) * 0.16
    return 0.035
line = []
for k in range(0, 29):
    s_ = 0.02 + k * 0.04; pt = grip_w + axis_w * (s_ - gear.GRIP); c_, i_, d_ = kd.find(pt); line.append("%.2f:%+.3f(%s)" % (s_, d_ - radius(s_), vbone[bv[i_]][:9]))
print("GAP 沿武器每 4cm 一个点，离身体表面还有多远（负的是穿进去了）:\n   " + "  ".join(line[:10]) + "\n   " + "  ".join(line[10:20]) + "\n   " + "  ".join(line[20:]))

# ---- 渲染 ----（NORENDER=1 时只量不渲染）
if os.environ.get("NORENDER"): sys.exit(0)
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.43, 0.45, 1)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 2.5
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = "ORTHO"
mn = Vector([min(c[i] for c in co) for i in range(3)]); mx = Vector([max(c[i] for c in co) for i in range(3)]); ctr = (mn + mx) / 2; span = max(mx - mn) * 1.1
res = int(os.environ.get("RES", "560"))
lw = MW @ PB[MX + "LeftHand"].head


def shot(name, az, el, c, scale):
    az = math.radians(az); el = math.radians(el); d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.data.ortho_scale = scale; cam.location = c + d * 6; cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    sun.rotation_euler = (Vector((0.35, -0.5, 0.8)) + d * 0.6).to_track_quat("Z", "Y").to_euler()
    sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.filepath = f"{prefix}_{name}.png"; bpy.ops.render.render(write_still=True); return sc.render.filepath


files = [shot(f"v{i}", az, el, ctr, span) for i, (az, el) in enumerate(((0, 8), (-35, 18), (-90, 8), (180, 8), (90, 8), (0, 56)))]
files += [shot(f"h{i}", az, el, c, 0.36) for i, (az, el, c) in enumerate(((0, 12, grip_w), (-90, 12, grip_w), (180, 12, grip_w), (-45, 60, grip_w), (0, 12, lw), (90, 12, lw), (180, 12, lw), (45, 60, lw)))]
print("FILES", " ".join(files))
