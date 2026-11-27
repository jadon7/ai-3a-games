"""阶段 B：披风布料解算 → Alembic 缓存 → 挂回角色，输出 wukong_real_final.blend。
用法：Blender -b -P build_cape_real.py -- [preview]
"""
import bpy, sys, os, math, time
import numpy as np
from mathutils import Vector, Matrix
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'common'))
sys.path.insert(0, HERE)
import scene_common as sc
import char_lib as cl
import build_wukong_real as BW

SRC = os.path.join(HERE, 'wukong_real.blend')
OUT = os.path.join(HERE, 'wukong_real_final.blend')
ABC = os.path.join(HERE, 'cape_real.abc')
F0, F1 = -30, 300
B = BW.B

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
scene.render.fps = 24
scene.frame_start, scene.frame_end = F0, F1
col = bpy.data.collections['WUKONG']
root = bpy.data.objects['WK_ROOT']; arm = bpy.data.objects['WK_Armature']; body = bpy.data.objects['WK_Body']
scene.frame_set(F0)
bpy.context.view_layer.update()

# ---------------- 碰撞代理：减面后的身体，跟着骨骼动
proxy = body.copy(); proxy.data = body.data.copy(); proxy.name = 'WK_CollProxy'
col.objects.link(proxy)
for md in list(proxy.modifiers):
    if md.type == 'PARTICLE_SYSTEM':
        proxy.modifiers.remove(md)
dec = proxy.modifiers.new('Dec', 'DECIMATE'); dec.ratio = 0.035
bpy.context.view_layer.objects.active = proxy
with bpy.context.temp_override(object=proxy, active_object=proxy, selected_objects=[proxy]):
    while proxy.modifiers.find('Dec') > 0:
        bpy.ops.object.modifier_move_up(modifier='Dec')
    bpy.ops.object.modifier_apply(modifier='Dec')
print('PROXY faces', len(proxy.data.polygons), 'mods', [m.type for m in proxy.modifiers])
proxy.hide_render = True
cm = proxy.modifiers.new('Collision', 'COLLISION')
proxy.collision.thickness_outer = 0.014
proxy.collision.thickness_inner = 0.02
proxy.collision.cloth_friction = 6

# ---------------- 披风：从两肩后方垂出
def bw(n):
    b = arm.pose.bones[B + n]
    return arm.matrix_world @ b.head
sl, sr, neck, sp2 = bw('LeftArm'), bw('RightArm'), bw('Neck'), bw('Spine2')
across = (sr - sl); across.z = 0
fwd = Vector((0, 0, 1)).cross(across).normalized()       # across=左→右，fwd 应指向身体前方
if fwd.x < 0:
    fwd = -fwd
back = -fwd
att_l = sl + back * 0.085 + Vector((0, 0, 0.015)) + (sl - sr).normalized() * -0.03
att_r = sr + back * 0.085 + Vector((0, 0, 0.015)) + (sr - sl).normalized() * -0.03
drape = (back * 0.80 + Vector((0, 0, -0.60))).normalized()
cape = cl.make_cape(att_l, att_r, length=1.02, bottom_scale=2.3, nx=44, ny=72, drape_dir=tuple(drape), sag=0.06)
col.objects.link(cape)
cape.parent = root
mat = cl.cape_material()
mat.name = 'WK_CapeAged'
nt = mat.node_tree
for n in nt.nodes:
    if n.type == 'MIX_RGB' and abs(n.inputs['Color1'].default_value[0] - 0.33) < 0.01:
        n.inputs['Color1'].default_value = (0.115, 0.010, 0.012, 1)     # 旧化的深绛红
        n.inputs['Color2'].default_value = (0.235, 0.022, 0.020, 1)
    if n.type == 'MIX_RGB' and abs(n.inputs['Color2'].default_value[0] - 0.78) < 0.01:
        n.inputs['Color2'].default_value = (0.42, 0.27, 0.09, 1)        # 暗金滚边
    if n.type == 'BSDF_TRANSLUCENT':
        n.inputs['Color'].default_value = (0.55, 0.03, 0.025, 1)
cape.data.materials.append(mat)
# 领口跟着上背骨骼
vg = cape.vertex_groups.new(name=B + 'Spine2')
pin = cape.vertex_groups['pin']
nxp = 45
for i in range(nxp * 2):
    vg.add([i], 1.0, 'REPLACE')
amd = cape.modifiers.new('Armature', 'ARMATURE'); amd.object = arm
wind, turb = cl.add_cloth(cape, collider=None, wind_strength=6500.0, turb_strength=330.0, frames=(F0, F1))
cs = cape.modifiers['Cloth'].settings
cs.mass = 0.02
cs.quality = 12
cs.bending_stiffness = 0.35
cape.modifiers['Cloth'].collision_settings.collision_quality = 5
# 修改器顺序：Armature → Cloth → Subdiv
with bpy.context.temp_override(object=cape, active_object=cape, selected_objects=[cape]):
    while cape.modifiers.find('Armature') > 0:
        bpy.ops.object.modifier_move_up(modifier='Armature')
print('CAPE mods', [m.type for m in cape.modifiers], 'verts', len(cape.data.vertices))

# ---------------- 解算（逐帧推进）
t0 = time.time()
for f in range(F0, F1 + 1):
    scene.frame_set(f)
print('SIM %.0fs' % (time.time() - t0))
dg = bpy.context.evaluated_depsgraph_get()
ev = cape.evaluated_get(dg)
co = np.array([v.co[:] for v in ev.data.vertices])
print('CAPE bbox', co.min(0).round(2), co.max(0).round(2))

# ---------------- 导出 Alembic，再作为缓存读回来
bpy.ops.object.select_all(action='DESELECT')
cape.select_set(True)
bpy.context.view_layer.objects.active = cape
cape.parent = None
r = bpy.ops.wm.alembic_export(filepath=ABC, start=F0, end=F1, selected=True, flatten=True, uvs=True, normals=True,
                              apply_subdiv=True, export_hair=False, export_particles=False, as_background_job=False,
                              evaluation_mode='RENDER')
print('ABC export', r, os.path.getsize(ABC) if os.path.exists(ABC) else 'missing')
for o in (cape, wind, turb, proxy):
    bpy.data.objects.remove(o)
before = set(bpy.data.objects)
bpy.ops.wm.alembic_import(filepath=ABC, as_background_job=False, set_frame_range=False)
new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
capec = new[0]
capec.name = 'WK_Cape'
for c in list(capec.users_collection):
    c.objects.unlink(capec)
col.objects.link(capec)
capec.parent = root
capec.data.materials.clear(); capec.data.materials.append(mat)
for p in capec.data.polygons:
    p.use_smooth = True
print('CAPE cache mods', [m.type for m in capec.modifiers], 'cache files', [c.filepath for c in bpy.data.cache_files])
for cf in bpy.data.cache_files:
    cf.filepath = bpy.path.relpath(ABC, start=HERE) if False else ABC
scene.frame_start, scene.frame_end = 1, F1
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('SAVED', OUT)

if 'preview' in sys.argv:
    sc.setup_render(scene, res=(900, 1000), samples=64, motion_blur=False)
    sc.setup_world(scene)
    cd = bpy.data.cameras.new('pc'); cd.lens = 60
    cam = bpy.data.objects.new('pc', cd); scene.collection.objects.link(cam); scene.camera = cam
    for name, ang, elev, dist, f in (('side', 100, 0.12, 5.2, 60), ('rearq', 215, 0.25, 5.2, 96), ('frontq', 35, 0.12, 5.2, 140)):
        a = math.radians(ang)
        tgt = Vector((-0.35, 0, 0.75))
        pos = tgt + Vector((math.cos(a), math.sin(a), elev)).normalized() * dist
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        scene.frame_set(f)
        scene.render.filepath = os.path.join(sc.ROOT, 'tests', f'wkcape_{name}.png')
        bpy.ops.render.render(write_still=True)
    print('PREVIEW DONE')
