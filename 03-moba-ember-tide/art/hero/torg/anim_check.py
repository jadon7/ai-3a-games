"""托尔格装好动作以后的检查（只读 game.glb）：把每段动作逐帧过一遍，量
  · 时间点用的数：钟顶（武器上离手最远的那一头）的位置和速度、两只手和胯的高度、脚离地多高；
  · 穿模：武器的面和身体的面相交了多少（按身体的骨骼分，握着的手不算）、钟有没有扎进地里；
  · 左手离杆身多远（动作是从视频里读的，锤只跟右手，左手握不握得住要看这个数）。
每段动作写一张表 <输出目录>/anim_<动作>.tsv（一行一帧），屏幕上打印每段的小结。
用法: Blender -b --factory-startup -P art/hero/torg/anim_check.py -- <game.glb> <build.json> <输出目录> [隔几帧量一次穿模=2] [只看哪几段，逗号分隔]
"""
import bpy, sys, os, math, json
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--") + 1:]
glb, cfg, out = argv[0], json.load(open(argv[1], encoding="utf-8")), argv[2]
step = int(argv[3]) if len(argv) > 3 else 2; only = set(argv[4].split(",")) if len(argv) > 4 and argv[4] else None
here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(out, exist_ok=True)
MX = "mixamorig:"
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.context.scene.render.fps = 30      # 先把帧率设成 30 再导入：导入器按场景帧率把秒换成帧，默认 24 的话帧号就对不上成品动作了
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in list(sc.objects):
    if o.type == "MESH" and not len(o.vertex_groups): bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in sc.objects if o.type == "MESH")
B = arm.data.bones; PB = arm.pose.bones; MW = arm.matrix_world
import importlib.util
sp = importlib.util.spec_from_file_location("gear_torg", os.path.join(here, "gear.py")); gear = importlib.util.module_from_spec(sp); sp.loader.exec_module(gear)


def hand_frame(side):
    h = B[MX + side + "Hand"].head_local; fore = B[MX + side + "ForeArm"].head_local
    idx = B[MX + side + "HandIndex1"].head_local; pky = B[MX + side + "HandPinky1"].head_local; mid = B[MX + side + "HandMiddle1"].head_local
    L = (idx - pky).normalized(); d = (h - fore).normalized(); E = (d - L * d.dot(L)).normalized(); n = L.cross(d).normalized()
    return L, E, (n if side == "Right" else -n), h, mid      # 第三项是解剖学上的掌心（build.json 里 palm_by_hand 为 true 时 hero_build 也是这么取的）


def to_world(bone, p_rest): return MW @ (PB[bone].matrix @ (B[bone].matrix_local.inverted() @ p_rest))
def dir_world(bone, v_rest): return (MW.to_3x3() @ (PB[bone].matrix.to_3x3() @ (B[bone].matrix_local.to_3x3().inverted() @ v_rest))).normalized()


g = cfg["gear"][0]; L, E, palm, h, mid = hand_frame("Right")
Mg = Matrix.Translation(h + (mid - h) * 0.7 + palm * cfg.get("weapon", {}).get("palm", 0.012)) @ Matrix((L.cross(-E), L, -E)).transposed().to_4x4() @ Matrix.Translation(Vector(g.get("offset", (0, 0, 0)))) @ Euler([math.radians(a) for a in g.get("rot", (0, 0, 0))]).to_matrix().to_4x4()
grip_rest = Mg @ Vector((0, 0, 0)); axis_rest = Mg.to_3x3() @ Vector((0, 1, 0))
L2, E2, palm2, h2, mid2 = hand_frame("Left"); lpalm_rest = h2 + (mid2 - h2) * 0.7 + palm2 * 0.035
gname = {gp.index: gp.name.replace(MX, "") for gp in body.vertex_groups}
vbone = [gname[max(v.groups, key=lambda x: x.weight).group] if v.groups else "-" for v in body.data.vertices]
wm = {i for i, s_ in enumerate(body.material_slots) if s_.material.name.startswith("weapon")}
order = ["idle_pose", "idle", "run", "attack1", "q", "w", "r", "death"]
acts = sorted(bpy.data.actions, key=lambda a: order.index(a.name) if a.name in order else 99)
arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks): tr.mute = True
fps = 30.0
for act in acts:
    if only and act.name not in only: continue
    arm.animation_data.action = act
    try: arm.animation_data.action_slot = act.slots[0]
    except Exception: pass
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); rows = []; prev = None; clip_frames = 0; clip_by = {}; worst = (0, -1); lmax = 0.0; lsum = 0.0; wmin = 9.0; bmin = 9.0
    for f in range(f0, f1 + 1):
        sc.frame_set(f); bpy.context.view_layer.update()
        grip = to_world(MX + "RightHand", grip_rest); ax = dir_world(MX + "RightHand", axis_rest); top = grip + ax * (gear.LEN - gear.GRIP); butt = grip - ax * gear.GRIP
        lp = to_world(MX + "LeftHand", lpalm_rest); rel = lp - grip; ld = (rel - ax * rel.dot(ax)).length; ls = rel.dot(ax) + gear.GRIP
        hips = MW @ PB[MX + "Hips"].head; rh = MW @ PB[MX + "RightHand"].head; lh = MW @ PB[MX + "LeftHand"].head
        foot = min((MW @ PB[MX + s + "Foot"].head).z for s in ("Left", "Right")); toe = min((MW @ PB[MX + s + "ToeBase"].head).z for s in ("Left", "Right"))
        sp_ = (top - prev).length * fps if prev is not None else 0.0; prev = top.copy(); lmax = max(lmax, ld); lsum += ld
        n_clip = -1; bones = ""
        if (f - f0) % step == 0:
            dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles(); W = ev.matrix_world; co = [W @ v.co for v in me.vertices]
            tw = [tuple(t.vertices) for t in me.loop_triangles if t.material_index in wm]; tb = [tuple(t.vertices) for t in me.loop_triangles if t.material_index not in wm]
            hit = {}
            for iw, ib in BVHTree.FromPolygons(co, tw).overlap(BVHTree.FromPolygons(co, tb)):
                b = vbone[tb[ib][0]]
                if "Hand" not in b: hit[b] = hit.get(b, 0) + 1
            n_clip = sum(hit.values()); bones = " ".join(f"{k}:{v}" for k, v in sorted(hit.items(), key=lambda kv: -kv[1]))
            wz = min(co[i].z for t in tw for i in t); bz = min(co[i].z for t in tb for i in t); wmin = min(wmin, wz); bmin = min(bmin, bz)
            if n_clip > 0:
                clip_frames += 1
                for k, v in hit.items(): clip_by[k] = max(clip_by.get(k, 0), v)
                if n_clip > worst[0]: worst = (n_clip, f)
            ev.to_mesh_clear()
        rows.append((f, (f - f0) / fps, top.x, top.y, top.z, sp_, butt.z, rh.z, lh.z, hips.x, hips.y, hips.z, foot, toe, ld, ls, n_clip, bones))
    with open(os.path.join(out, f"anim_{act.name}.tsv"), "w", encoding="utf-8") as fo:
        fo.write("帧\t秒\t钟顶x\t钟顶y\t钟顶z\t钟顶速度\t柄尾z\t右手z\t左手z\t胯x\t胯y\t胯z\t脚踝最低\t脚尖最低\t左手离杆身\t左手在柄的哪段\t穿模面对数\t穿到哪\n")
        for r in rows: fo.write("\t".join(str(round(v, 3)) if isinstance(v, float) else str(v) for v in r) + "\n")
    n_s = len(range(f0, f1 + 1, step)); fast = max(rows, key=lambda r: r[5])
    print("ANIM %-9s %3d 帧 %.2f 秒 | 钟顶最快 %.1f/秒 在 %.2f 秒 | 钟顶最低 z=%.2f 在 %.2f 秒 | 武器最低 z=%.3f 身体最低 z=%.3f | 左手离杆身 平均 %.3f 最大 %.3f | 穿模 %d/%d 个取样帧，最重第 %d 帧（%d 对面）%s" % (
        act.name, f1 - f0 + 1, (f1 - f0) / fps, fast[5], fast[1], min(r[4] for r in rows), min(rows, key=lambda r: r[4])[1], wmin, bmin, lsum / len(rows), lmax, clip_frames, n_s, worst[1], worst[0],
        " ".join(f"{k}:{v}" for k, v in sorted(clip_by.items(), key=lambda kv: -kv[1])[:6])))
