"""组装整段镜头并保存 blend/shot.blend，同时导出 out/events.json（音效用）。
blender -b --factory-startup -P shot_build.py
"""
import bpy, sys, os, math, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix, Quaternion
from common import *
import env, viewmodel, fx
import rigmath as RM
import timeline as TL

MODE = os.environ.get("GF_MODE", "day")      # day：阴天白昼；dusk：黄昏弱光，手电与枪口火光为主
K = 1.0 if MODE == "day" else 0.06           # 环境"日光"整体倍率
FLASH_K = 1.0
if MODE != "day":
    env.AMB = env.AMB * K
    env.WIN = 1.1
    env.TINT = (0.74, 0.90, 1.16)        # 暮色：环境光偏冷
    fx.PUFF_EMIT = 0.42 * K
    FLASH_K = 0.4                        # 暗环境里相机增益高，火光灯相应收一些
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.frame_start, scn.frame_end = 1, TL.F_END
env.setup_render(scn, spp=128)
try:
    scn.cycles.rolling_shutter_type = "TOP"
    scn.cycles.rolling_shutter_duration = 0.35
except Exception as e:
    print("rolling shutter n/a", e)

FLOOR = env.FLOOR_Z
GROUND_Z = FLOOR - 0.02
rng = random.Random(7)
events = []

# ------------------------------------------------------------ 环境
env_meshes = env.build_env()
CG = coll("CG"); RIG = coll("Rig"); FX = coll("FX"); EXT = coll("ExtRecv"); FLR = coll("FlashRecv"); WLR = coll("WLRecv")
for _o in env_meshes:
    FLR.objects.link(_o); WLR.objects.link(_o)
env.link_env_light(env_meshes, CG)
env.build_world(scn, cam_gain=7.0 * K, light_gain=1.6 * K)

# 先对纯环境做射线检测，确定弹着点
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()


ENV_NAMES = {o.name for o in env_meshes}


def ray(o, target):
    """只接受打在扫描环境上的命中点（跳过特效面片、角色等）。"""
    o = Vector(o); d = (Vector(target) - o).normalized()
    dgl = bpy.context.evaluated_depsgraph_get()
    for _ in range(40):
        hit, loc, nor, idx, ob, mat = scn.ray_cast(dgl, o, d, distance=60)
        if not hit:
            return None, None
        if ob.name in ENV_NAMES:
            if nor.dot(d) > 0:
                nor = -nor
            return loc.copy(), nor.copy()
        o = loc + d * 0.01
    return None, None


E_MUZ = Vector((17.0, 3.02, 1.80))
enemy_targets = {
    86: ((21.9, 0.20, 1.72), "wall"),
    89: ((20.7, 2.55, 0.40), "floor"),
    94: ((21.1, 5.40, 1.05), "wall"),
    97: ((21.75, 2.95, 0.40), "floor"),
    104: ((19.6, 0.15, 2.30), "wall"),
}
enemy_hits = {}
for f, (t, kind) in enemy_targets.items():
    loc, nor = ray(E_MUZ, t)
    print("EHIT", f, kind, [round(v, 2) for v in loc] if loc else None, [round(v, 2) for v in nor] if nor else None)
    if loc:
        if kind == "floor":
            nor = Vector((0, 0, 1))
        enemy_hits[f] = (loc, nor, kind)

# ------------------------------------------------------------ 门外地面
bpy.ops.mesh.primitive_plane_add(size=1)
ground = bpy.context.active_object; ground.name = "ExtGround"
move_to(ground, EXT)
ground.scale = (26, 26, 1); ground.location = (6.0, 2.0, GROUND_Z)
gm = bpy.data.materials.new("ExtGround"); gm.use_nodes = True
nt = gm.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
# 把 HDRI 的地面部分投影到这块平面上：门外地面就是全景照片本身，带视差
P0 = Vector((12.6, 2.0, GROUND_Z + 1.6))
geo = N("ShaderNodeNewGeometry")
sub = N("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"; L(geo.outputs["Position"], sub.inputs[0]); sub.inputs[1].default_value = P0
envt = N("ShaderNodeTexEnvironment"); envt.image = scn.world.node_tree.nodes["Environment Texture"].image
L(sub.outputs[0], envt.inputs["Vector"])
gt = N("ShaderNodeMix"); gt.data_type = "RGBA"; gt.blend_type = "MULTIPLY"; gt.inputs["Factor"].default_value = 1.0
L(envt.outputs["Color"], gt.inputs["A"]); gt.inputs["B"].default_value = (*env.TINT, 1)
em = N("ShaderNodeEmission"); em.inputs["Strength"].default_value = 1.5 * K; L(gt.outputs["Result"], em.inputs["Color"])
alb = N("ShaderNodeVectorMath"); alb.operation = "SCALE"; alb.inputs["Scale"].default_value = 1.8; L(envt.outputs["Color"], alb.inputs[0])
df = N("ShaderNodeBsdfDiffuse"); L(alb.outputs[0], df.inputs["Color"])
add = N("ShaderNodeAddShader"); L(em.outputs[0], add.inputs[0]); L(df.outputs[0], add.inputs[1])
dist = N("ShaderNodeVectorMath"); dist.operation = "DISTANCE"
L(geo.outputs["Position"], dist.inputs[0]); dist.inputs[1].default_value = (16.9, 2.0, GROUND_Z)
fade = N("ShaderNodeMapRange"); fade.inputs["From Min"].default_value = 7.0; fade.inputs["From Max"].default_value = 11.0
fade.inputs["To Min"].default_value = 1.0; fade.inputs["To Max"].default_value = 0.0
L(dist.outputs["Value"], fade.inputs["Value"])
tp = N("ShaderNodeBsdfTransparent")
mx = N("ShaderNodeMixShader"); L(fade.outputs[0], mx.inputs[0]); L(tp.outputs[0], mx.inputs[1]); L(add.outputs[0], mx.inputs[2])
out = N("ShaderNodeOutputMaterial"); L(mx.outputs[0], out.inputs["Surface"])
ground.data.materials.append(gm)

sd = bpy.data.lights.new("ExtSky", "SUN"); sd.energy = 7.5 * K; sd.angle = math.radians(75); sd.color = (0.95 * env.TINT[0], 0.98 * env.TINT[1], 1.0 * env.TINT[2])
so = bpy.data.objects.new("ExtSky", sd); RIG.objects.link(so)
so.rotation_euler = Vector((0.38, 0.12, -0.92)).to_track_quat("-Z", "Y").to_euler()
so.light_linking.receiver_collection = EXT

# ------------------------------------------------------------ 相机与持枪手臂
torso = empty("Torso", RIG)
cam = env.make_bodycam(scn, RIG); cam.parent = torso; cam.rotation_mode = "QUATERNION"
vm, info = viewmodel.build_viewmodel(CG, torso); vm.rotation_mode = "QUATERNION"
wlights = viewmodel.add_weapon_light(vm, info, RIG, hot=9000.0, spill=520.0)
for _o in info["objects"]:
    if _o.type == "MESH":
        FLR.objects.link(_o)
viewmodel.add_sleeve_caps(vm, info, CG)
for _l in wlights:
    _l.light_linking.receiver_collection = WLR
WLR.objects.link(ground)
bpy.context.view_layer.update()
sn = info["slide_node"]
base_loc = sn.location.copy(); base_mw = sn.matrix_world.copy()
sn.matrix_world = Matrix.Translation((0, -0.042, 0)) @ base_mw
bpy.context.view_layer.update()
back_loc = sn.location.copy(); sn.location = base_loc

pq_c = None; pq_v = None
for f in range(0, TL.F_END + 3):
    M = RM.torso_matrix(f)
    torso.location = M.translation; torso.rotation_euler = (0, 0, M.to_euler().z)
    torso.keyframe_insert("location", frame=f); torso.keyframe_insert("rotation_euler", frame=f)
    Mc = RM.cam_local_matrix(f); q = Mc.to_quaternion()
    if pq_c is not None and q.dot(pq_c) < 0:
        q.negate()
    pq_c = q.copy()
    cam.location = Mc.translation; cam.rotation_quaternion = q
    cam.keyframe_insert("location", frame=f); cam.keyframe_insert("rotation_quaternion", frame=f)
    Mv = RM.vm_local_matrix(f); q = Mv.to_quaternion()
    if pq_v is not None and q.dot(pq_v) < 0:
        q.negate()
    pq_v = q.copy()
    vm.location = Mv.translation; vm.rotation_quaternion = q
    vm.keyframe_insert("location", frame=f); vm.keyframe_insert("rotation_quaternion", frame=f)
    sn.location = base_loc.lerp(back_loc, float(RM.slide[f])); sn.keyframe_insert("location", frame=f)
for o in (torso, cam, vm, sn):
    set_interp(o, "LINEAR")

# ------------------------------------------------------------ 敌人
with bpy.data.libraries.load(os.path.join(ROOT, "blend", "enemy.blend"), link=False) as (src, dst):
    dst.collections = ["Enemy"]
ecoll = dst.collections[0]; scn.collection.children.link(ecoll)
eroot = bpy.data.objects["EnemyRoot"]; emz = bpy.data.objects["E_Muzzle"]
earm = next(o for o in ecoll.all_objects if o.type == "ARMATURE")
for o in ecoll.all_objects:
    if o.type == "MESH":
        CG.objects.link(o); EXT.objects.link(o); FLR.objects.link(o); WLR.objects.link(o)
EYAW = math.radians(90 - 6.0)
EX = RM.ENEMY_POS.x
CROUCH = 0.085
EY0, EY1 = 3.84, 3.12      # 门框后藏身位 → 探身射击位（半个身位贴着门框）
for f, y, lean, dz in ((1, EY0, 0, CROUCH), (TL.E_PEEK0, EY0, 0, CROUCH), (TL.E_PEEK0 + 5, EY0 - 0.30, -15, CROUCH), (TL.E_PEEK1, EY1, -9, CROUCH),
                       (TL.E_PEEK1 + 12, EY1, -6, CROUCH), (TL.E_FALL, EY1, -5, CROUCH), (TL.E_FALL + 7, EY1, 0, 0.0)):
    eroot.location = (EX, y, GROUND_Z - dz); eroot.rotation_euler = (0, math.radians(lean), EYAW)
    eroot.keyframe_insert("location", frame=f); eroot.keyframe_insert("rotation_euler", frame=f)
# 倒地后把身体压实到地面（动捕源角色更胖，直接套用会悬空），双脚用 IK 固定在落点
SINK = 0.11
for f, dz in ((TL.E_FALL + 38, 0.0), (TL.E_FALL + 50, SINK), (TL.F_END + 2, SINK)):
    eroot.location = (EX, EY1, GROUND_Z - dz); eroot.keyframe_insert("location", frame=f)
scn.frame_set(TL.E_FALL + 100)
bpy.context.view_layer.update()
for side in ("Left", "Right"):
    fb = next(b for b in earm.pose.bones if b.name.split(":")[-1].rsplit("_", 1)[0] == side + "Foot")
    p = (earm.matrix_world @ fb.matrix).translation.copy()
    t = bpy.data.objects.new(f"E_{side}FootT", None); ecoll.objects.link(t); t.empty_display_size = 0.05
    t.location = (p.x, p.y, GROUND_Z + 0.075)
    ik = fb.constraints.new("IK"); ik.name = "FootPlant"; ik.target = t; ik.chain_count = 2; ik.use_tail = False
    for f, v in ((1, 0.0), (TL.E_FALL + 58, 0.0), (TL.E_FALL + 70, 1.0)):
        ik.influence = v; ik.keyframe_insert("influence", frame=f)
scn.frame_set(1)

# 敌人枪口火光
for s in TL.E_SHOTS:
    r = bpy.data.objects.new(f"EFlash{s}", None); FX.objects.link(r)
    c1 = r.constraints.new("COPY_LOCATION"); c1.target = emz
    c2 = r.constraints.new("COPY_ROTATION"); c2.target = cam
    for k, (tex_n, sc, st) in enumerate(((rng.randrange(8), rng.uniform(0.42, 0.62), 110.0), (rng.randrange(8), rng.uniform(0.2, 0.3), 220.0))):
        q = bpy.data.objects.new(f"EFlash{s}_{k}", fx.quad_mesh()); FX.objects.link(q); q.parent = r
        q.active_material = fx.flash_material(f"flash_star_{tex_n}.png", st)
        q.rotation_euler = (0, 0, rng.uniform(0, 6.283)); q.scale = (sc, sc, sc)
        fx.key_vis(q, s, s + 1)
    lt = fx.point_flash(f"EFlashL{s}", FX, 650.0 * FLASH_K)
    lt.light_linking.receiver_collection = FLR
    c3 = lt.constraints.new("COPY_LOCATION"); c3.target = emz
    fx.key_vis(lt, s, s + 1)
    fx.burst(rng, cam, [CG, EXT], E_MUZ + Vector((0.15, 0, 0)), (1, 0, 0.15), s + 1, n=2, speed=2.5, spread=0.35,
             size0=0.08, size1=0.45, life=30, color=(0.7, 0.72, 0.75), alpha=0.16, rise=0.12, name="esmoke")
    cw = RM.cam_world(s).translation
    events.append({"f": s, "type": "eshot", "dist": round((E_MUZ - cw).length, 2)})

# 敌人子弹的弹着点
for f, (loc, nor, kind) in enemy_hits.items():
    cw = RM.cam_world(f).translation
    d = (loc - cw).length
    big = 1.35 if f == 97 else 1.0
    if kind == "wall":
        fx.burst(rng, cam, [CG, WLR], loc + nor * 0.03, nor, f, n=14, speed=5.5, spread=0.6, size0=0.10, size1=0.62 * big, life=95,
                 color=(1.0, 0.98, 0.95), alpha=0.30, rise=-0.05, name="wallpuff")
        fx.chips(rng, [CG, WLR], loc + nor * 0.02, nor, f, FLOOR, n=14, speed=4.5)
        fx.bullet_hole(rng, [CG], loc, nor, f, size=0.10)
    else:
        fx.burst(rng, cam, [CG, WLR], loc + nor * 0.03, nor + Vector((0.5, 0, 0)), f, n=int(13 * big), speed=4.6 * big, spread=0.6, size0=0.12,
                 size1=0.70 * big, life=110, color=(0.80, 0.74, 0.66), alpha=0.32, rise=-0.03, name="floorpuff")
        fx.chips(rng, [CG, WLR], loc + nor * 0.02, nor + Vector((0.6, 0, 0)), f, FLOOR, n=16, speed=4.0, color=(0.45, 0.4, 0.35))
        fx.bullet_hole(rng, [CG], loc, nor, f, size=0.07)
    events.append({"f": f, "type": "impact", "kind": kind, "dist": round(d, 2)})
for f in (91, 108):
    events.append({"f": f, "type": "impact", "kind": "wall", "dist": 3.5, "offscreen": True})
for s in TL.E_SHOTS:
    events.append({"f": s, "type": "snap"})

# ------------------------------------------------------------ 我方开火
muz = info["muzzle"]; ej = info["eject"]
show_flash = {100: True, 105: True, 110: False, 116: True, 121: True, 127: False}
for s in TL.P_SHOTS:
    if show_flash.get(s, True):
        root, objs = fx.flash_quads(f"PFlash{s}", FX, vm, muz + Vector((0, 0.004, 0)), rng, scale=rng.uniform(0.5, 0.72), strength=38.0)
        for o in objs:
            fx.key_vis(o, s, s + 1)
    lt = fx.point_flash(f"PFlashL{s}", FX, (260.0 if show_flash.get(s, True) else 130.0) * FLASH_K)
    lt.light_linking.receiver_collection = FLR
    lt.parent = vm; lt.location = muz + Vector((0, 0.06, 0.015))
    fx.key_vis(lt, s, s + 1)
    VW = RM.vm_world(s)
    mw = VW @ muz; fwd = (VW.to_3x3() @ Vector((0, 1, 0))).normalized()
    fx.burst(rng, cam, [CG], mw + fwd * 0.05, fwd + Vector((0, 0, 0.25)), s + 1, n=3, speed=2.2, spread=0.3, size0=0.05,
             size1=0.42, life=34, color=(0.78, 0.8, 0.84), alpha=0.055, rise=0.10, name="gunsmoke")
    R3 = VW.to_3x3()
    v = R3 @ Vector((rng.uniform(1.9, 2.7), rng.uniform(-0.9, -0.3), rng.uniform(1.2, 1.9)))
    sh, hits = fx.shell(rng, [CG], VW @ ej, v, s, FLOOR)
    events.append({"f": s, "type": "pshot"})
    for i, hf in enumerate(hits[:2]):
        events.append({"f": hf, "type": "casing", "n": i})

# 我方子弹的弹着
VW = RM.vm_world(100)
loc, nor = ray(VW @ muz, (16.98, 3.78, 1.70))
print("PHIT jamb", loc, nor)
if loc:
    fx.burst(rng, cam, [CG, EXT], loc + nor * 0.03, nor, 100, n=9, speed=3.8, spread=0.55, size0=0.07, size1=0.42, life=70,
             color=(1.0, 0.98, 0.95), alpha=0.30, name="jamb")
    fx.chips(rng, [CG, WLR], loc + nor * 0.02, nor, 100, FLOOR, n=8, speed=3.5)
    fx.bullet_hole(rng, [CG], loc, nor, 100, size=0.08)
    events.append({"f": 100, "type": "impact_far"})
sp2 = next(b.name for b in earm.pose.bones if "Spine2" in b.name)
for s in (110, 116):
    scn.frame_set(s)
    p = (earm.matrix_world @ earm.pose.bones[sp2].matrix).translation.copy()
    fx.burst(rng, cam, [CG, EXT], p + Vector((0.14, rng.uniform(-0.06, 0.06), rng.uniform(-0.05, 0.1))), (1, 0, 0.2), s, n=4, speed=1.6,
             spread=0.5, size0=0.05, size1=0.30, life=30, color=(0.52, 0.53, 0.48), alpha=0.38, name="vest")
    events.append({"f": s, "type": "hit"})
fx.burst(rng, cam, [CG, EXT], (14.9, 2.3, GROUND_Z + 0.03), (0.4, 0, 1), 127, n=6, speed=3.2, spread=0.5, size0=0.1, size1=0.6,
         life=80, color=(0.62, 0.58, 0.5), alpha=0.5, name="dirt")
events.append({"f": 127, "type": "impact_far"})
scn.frame_set(1)

# ------------------------------------------------------------ 室内浮尘（薄体积雾）：窗边光晕、枪灯光束
HAZE = float(os.environ.get("GF_HAZE", "0"))
if HAZE > 0:
    bpy.ops.mesh.primitive_cube_add(size=1)
    vol = bpy.context.active_object; vol.name = "RoomHaze"
    move_to(vol, CG); WLR.objects.link(vol); FLR.objects.link(vol)
    vol.scale = (8.3, 5.05, 4.35); vol.location = (21.17, 2.78, 2.63)
    vm_ = bpy.data.materials.new("Haze"); vm_.use_nodes = True
    nt_ = vm_.node_tree; nt_.nodes.clear()
    pv = nt_.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Density"].default_value = HAZE; pv.inputs["Anisotropy"].default_value = 0.35
    pv.inputs["Color"].default_value = (0.92, 0.91, 0.88, 1)
    ou = nt_.nodes.new("ShaderNodeOutputMaterial"); nt_.links.new(pv.outputs[0], ou.inputs["Volume"])
    vol.data.materials.append(vm_)
    vol.visible_shadow = False
    scn.cycles.volume_step_rate = 4.0
    scn.cycles.volume_max_steps = 64

# 其它事件
for s in RM.STEPS:
    if s <= TL.F_END:
        events.append({"f": s, "type": "step", "speed": round(float(RM.vel[s]), 2)})
events.append({"f": TL.C_FLINCH, "type": "flinch"})
events.append({"f": TL.E_FALL + 38, "type": "bodyfall"})
events.append({"f": TL.E_FALL + 44, "type": "rifle_drop"})
events.sort(key=lambda e: e["f"])
os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
if MODE == "day":
    json.dump(events, open(os.path.join(ROOT, "out", "events.json"), "w"), indent=1)

print("OBJECTS", len(bpy.data.objects), "EVENTS", len(events))
_tag = ("" if MODE == "day" else f"_{MODE}") + ("_haze" if HAZE > 0 else "")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blend", f"shot{_tag}.blend"))
print("SAVED shot.blend")
