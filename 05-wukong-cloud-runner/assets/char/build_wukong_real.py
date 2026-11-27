"""写实悟空角色搭建（Tripo 生成并绑骨的模型 → 可渲染的电影角色）。
阶段 A：导入、归一尺寸朝向、骨骼微动、真毛发、金箍棒 → wukong_real.blend
用法：Blender -b -P build_wukong_real.py -- [preview]
约定：面朝 +X（飞行方向），脚底 z=0，根物体 WK_ROOT，集合 WUKONG。
"""
import bpy, sys, os, math, random, colorsys
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'common'))
sys.path.insert(0, HERE)
import scene_common as sc
import char_lib as cl

GLB = os.path.join(HERE, 'wukong_real_rig.glb')
OUT = os.path.join(HERE, 'wukong_real.blend')
TARGET_H = 1.50          # 蹲姿下头顶（含抬起的手）高度，米
YAW = math.radians(-20)  # 让视线/胸口朝 +X
FPS = 24
B = 'mixamorig:'


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.parent == arm)
    for o in list(bpy.context.scene.objects):
        if o not in (arm, body):
            bpy.data.objects.remove(o)
    arm.name = 'WK_Armature'
    body.name = 'WK_Body'
    col = bpy.data.collections.new('WUKONG')
    bpy.context.scene.collection.children.link(col)
    root = bpy.data.objects.new('WK_ROOT', None)
    root.empty_display_size = 0.3
    for o in (root, arm, body):
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    # 归一：缩放、偏航、脚底落地、重心放到原点
    co = np.empty(len(body.data.vertices) * 3, dtype=np.float32)
    body.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mw = np.array(body.matrix_world)
    wco = co @ mw[:3, :3].T + mw[:3, 3]
    zmin, zmax = float(wco[:, 2].min()), float(wco[:, 2].max())
    s = TARGET_H / (zmax - zmin)
    # 两脚中点作为水平原点
    feet = wco[wco[:, 2] < zmin + 0.08]
    cx, cy = float(feet[:, 0].mean()), float(feet[:, 1].mean())
    arm.parent = root
    R = Matrix.Rotation(YAW, 4, 'Z')
    M = R @ Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -zmin))
    arm.matrix_world = M @ arm.matrix_world
    bpy.context.view_layer.update()
    print('SCALE', round(s, 4), 'zrange', round(zmin, 3), round(zmax, 3), 'feet center', round(cx, 3), round(cy, 3))
    return col, root, arm, body, s


def bone_world(arm, name, tail=False):
    b = arm.data.bones[B + name]
    return arm.matrix_world @ (b.tail_local if tail else b.head_local)


def tune_material(body):
    mat = body.data.materials[0]
    mat.name = 'WK_BodyPBR'
    nt = mat.node_tree
    bsdf = cl.bsdf_of(mat)
    for n in nt.nodes:
        if n.type == 'NORMAL_MAP':
            n.inputs['Strength'].default_value = 1.25
    cl.set_in(bsdf, ['Specular IOR Level', 'Specular'], 0.45)
    cl.set_in(bsdf, ['Coat Weight'], 0.0)
    return mat


def _sample_maps(body):
    """按 UV 把基础色和 ORM（粗糙度=G，金属度=B）采样到顶点。"""
    me = body.data
    n = len(me.vertices)
    uvl = me.uv_layers.active.data; nl = len(me.loops)
    luv = np.empty(nl * 2, dtype=np.float32); uvl.foreach_get('uv', luv); luv = luv.reshape(-1, 2)
    lvi = np.empty(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', lvi)
    vuv = np.zeros((n, 2), dtype=np.float32); vuv[lvi] = luv

    def samp(img):
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
        x = np.clip((vuv[:, 0] % 1.0) * w, 0, w - 1).astype(np.int32)
        y = np.clip((vuv[:, 1] % 1.0) * h, 0, h - 1).astype(np.int32)
        return px[y, x, :3]
    col_img = next(i for i in bpy.data.images if i.name.startswith('Color'))
    orm_img = next(i for i in bpy.data.images if i.name.startswith('ORM'))
    return samp(col_img), samp(orm_img)


def classify_fur(body, arm):
    """按贴图（颜色/粗糙度/金属度）+ 骨骼分区给顶点打毛发权重。
    顶点组：fur_arm（前臂和手）、fur_tiger（虎皮裙和腰间毛边）、fur_head（头部）。"""
    rgb, orm = _sample_maps(body)
    n = len(rgb)
    rough, metal = orm[:, 1], orm[:, 2]
    r, g, b_ = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    mx = rgb.max(1); mn = rgb.min(1); d = np.maximum(mx - mn, 1e-6)
    val = mx
    sat = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0)
    hue = np.where(mx == r, ((g - b_) / d) % 6, np.where(mx == g, (b_ - r) / d + 2, (r - g) / d + 4)) * 60.0
    # 每个顶点的主导骨骼分区
    names = [vg.name.replace(B, '') for vg in body.vertex_groups]
    def region(nm):
        if nm in ('Neck', 'Head', 'HeadTop_End'):
            return 4
        if 'ForeArm' in nm or 'Hand' in nm:
            return 1
        if nm in ('LeftLeg', 'RightLeg') or 'Foot' in nm or 'Toe' in nm:
            return 2
        if nm in ('Hips', 'LeftUpLeg', 'RightUpLeg'):
            return 3
        return 0            # 躯干、上臂
    greg = np.array([region(nm) for nm in names], dtype=np.int8)
    reg = np.zeros(n, dtype=np.int8)
    for v in body.data.vertices:
        bw_, bi = 0.0, -1
        for ge in v.groups:
            if ge.weight > bw_:
                bw_, bi = ge.weight, ge.group
        if bi >= 0:
            reg[v.index] = greg[bi]
    co = np.empty(n * 3, dtype=np.float32); body.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    mw = np.array(body.matrix_world); wco = co @ mw[:3, :3].T + mw[:3, 3]
    furcol = (hue > 14) & (hue < 44) & (sat > 0.30) & (metal < 0.20)
    w_arm = (reg == 1) & furcol & (val > 0.30) & (sat > 0.38)
    white = (val > 0.55) & (sat < 0.32) & (metal < 0.25) & (rough > 0.6)
    w_tiger = ((reg == 3) | (reg == 0)) & (metal < 0.28) & (rough > 0.66) & ((furcol & (val > 0.26)) | white)
    # 头：正面裸脸（椭圆区域 + 偏亮的皮肤）不长毛
    hd = np.array(bone_world(arm, 'Head')); ht = np.array(bone_world(arm, 'HeadTop_End'))
    fwd = ht - hd; fwd[2] = 0; fwd /= np.linalg.norm(fwd)
    left = np.cross(np.array([0, 0, 1.0]), fwd)
    hc = hd * 0.55 + ht * 0.45
    rel = wco - hc
    f_ = rel @ fwd; l_ = rel @ left; u_ = rel[:, 2]
    face = (f_ > 0.035) & ((l_ / 0.068) ** 2 + ((u_ + 0.035) / 0.085) ** 2 < 1.0)
    w_head = (reg == 4) & (metal < 0.2) & (~face) & furcol & (rough > 0.55)
    res = {}
    for name, w in (('fur_arm', w_arm), ('fur_tiger', w_tiger), ('fur_head', w_head)):
        vg = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
        idx = np.nonzero(w)[0].tolist()
        if idx:
            vg.add(idx, 1.0, 'REPLACE')
        res[name] = int(w.sum())
    print('FUR verts', res, 'of', n)
    return res


def hair_material(body):
    src = body.data.materials[0]
    img = None
    b = cl.bsdf_of(src)
    l = b.inputs['Base Color'].links
    if l and l[0].from_node.type == 'TEX_IMAGE':
        img = l[0].from_node.image
    m = bpy.data.materials.new('WK_Fur')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hair = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    try:
        hair.parametrization = 'COLOR'
    except Exception:
        pass
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
    # 发色略提亮提饱和（发丝之间互相遮挡会变暗）
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Saturation'].default_value = 1.08
    hsv.inputs['Value'].default_value = 1.35
    nt.links.new(tex.outputs['Color'], hsv.inputs['Color'])
    nt.links.new(hsv.outputs['Color'], hair.inputs['Color'])
    for k, val in (('Roughness', 0.32), ('Radial Roughness', 0.45), ('Coat', 0.1), ('Random Color', 0.12), ('Random Roughness', 0.15)):
        if k in hair.inputs:
            hair.inputs[k].default_value = val
    nt.links.new(hair.outputs[0], out.inputs['Surface'])
    body.data.materials.append(m)
    return len(body.data.materials)          # 1 基的材质槽序号


def add_fur(body, slot, name, group, count, length, child, clump, rough, radius, seed):
    md = body.modifiers.new(name, 'PARTICLE_SYSTEM')
    ps = md.particle_system
    ps.name = name
    st = ps.settings
    st.name = name + '_set'
    st.type = 'HAIR'
    st.count = count
    st.hair_step = 4
    st.emit_from = 'FACE'
    st.use_emit_random = True
    st.use_even_distribution = True
    st.material = slot
    ps.vertex_group_density = group
    ps.seed = seed
    # 注意：hair_length 和 normal_factor 是联动的（hair_length = normal_factor × 4），所以最后设长度
    st.hair_length = length
    nf = st.normal_factor
    st.object_align_factor = (-0.55 * nf, 0.0, -0.25 * nf)     # 被迎面风压向后下方
    st.factor_random = 0.15 * nf
    st.child_type = 'INTERPOLATED'
    for nm in ('child_percent', 'child_nbr'):
        if hasattr(st, nm):
            setattr(st, nm, child)
    st.rendered_child_count = child
    for nm, val in (('child_length', 1.0), ('child_radius', 0.012), ('clump_factor', clump), ('clump_shape', -0.2),
                    ('roughness_1', rough), ('roughness_1_size', 0.08), ('roughness_endpoint', rough * 0.8),
                    ('roughness_2', rough * 0.6), ('roughness_2_size', 0.02), ('length_random', 0.35),
                    ('root_radius', 1.0), ('tip_radius', 0.15), ('radius_scale', radius), ('shape', 0.3),
                    ('display_step', 2), ('render_step', 3)):
        try:
            setattr(st, nm, val)
        except Exception as e:
            print('PSET skip', nm, repr(e)[:60])
    return ps


def add_staff(arm, col, s):
    """金箍棒：穿过右拳。握点和方向由指节骨骼算出。"""
    k = [bone_world(arm, f'RightHand{f}1') for f in ('Index', 'Middle', 'Ring', 'Pinky')]
    j2 = [bone_world(arm, f'RightHand{f}2') for f in ('Index', 'Middle', 'Ring', 'Pinky')]
    j3 = [bone_world(arm, f'RightHand{f}3') for f in ('Index', 'Middle', 'Ring', 'Pinky')]
    axis = (k[0] - k[3]).normalized()                       # 小指 → 食指
    center = sum(k + j2 + j3, Vector()) / 12.0
    palm = bone_world(arm, 'RightHand')
    center = center * 0.8 + palm * 0.2
    staff = cl.make_staff(length=2.15 * s / 0.78, radius=0.024 * s / 0.78)
    col.objects.link(staff)
    # 前端略上扬
    d = (axis + Vector((0, 0, 0.10))).normalized()
    if d.x < 0:
        d = -d
    staff.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    L = staff.dimensions.z if staff.dimensions.z > 0 else 2.15
    staff.location = center + d * (0.5 - 0.42) * L
    bpy.context.view_layer.update()
    mw = staff.matrix_world.copy()
    staff.parent = arm
    staff.parent_type = 'BONE'
    staff.parent_bone = B + 'RightHand'
    staff.matrix_world = mw
    print('STAFF center', tuple(round(v, 3) for v in center), 'dir', tuple(round(v, 3) for v in d))
    return staff


def micro_anim(arm, f0=-24, f1=320, seed=5):
    """骨骼微动：呼吸、重心晃动、头部张望、手臂细微调整（每 4 帧一个关键帧，贝塞尔插值）。"""
    rnd = random.Random(seed)
    spec = {
        'Hips': dict(rot=(1.2, 1.0, 1.6), loc=(0.010, 0.012, 0.014), f=(0.55, 0.43, 0.61)),
        'Spine': dict(rot=(1.4, 0.8, 1.2), f=(0.47, 0.39, 0.52)),
        'Spine1': dict(rot=(1.2, 0.8, 1.2), f=(0.47, 0.39, 0.52)),
        'Spine2': dict(rot=(1.4, 1.0, 1.6), f=(0.61, 0.33, 0.45)),
        'Neck': dict(rot=(2.0, 2.5, 3.5), f=(0.36, 0.29, 0.31)),
        'Head': dict(rot=(2.5, 3.0, 5.5), f=(0.33, 0.27, 0.23)),
        'LeftArm': dict(rot=(1.6, 1.2, 1.8), f=(0.52, 0.44, 0.38)),
        'LeftForeArm': dict(rot=(1.5, 1.0, 1.2), f=(0.58, 0.41, 0.47)),
        'RightArm': dict(rot=(1.8, 1.2, 2.0), f=(0.49, 0.37, 0.42)),
        'RightForeArm': dict(rot=(1.4, 1.0, 1.4), f=(0.44, 0.52, 0.36)),
        'LeftUpLeg': dict(rot=(1.0, 0.6, 0.8), f=(0.55, 0.43, 0.61)),
        'RightUpLeg': dict(rot=(1.0, 0.6, 0.8), f=(0.55, 0.43, 0.61)),
    }
    bpy.context.view_layer.objects.active = arm
    for name, sp in spec.items():
        pb = arm.pose.bones.get(B + name)
        if pb is None:
            continue
        pb.rotation_mode = 'XYZ'
        ph = [rnd.uniform(0, 6.283) for _ in range(9)]
        for f in range(f0, f1 + 1, 4):
            t = f / FPS
            e = []
            for a in range(3):
                amp = math.radians(sp['rot'][a])
                e.append(amp * (0.7 * math.sin(2 * math.pi * sp['f'][a] * t + ph[a]) + 0.3 * math.sin(2 * math.pi * sp['f'][a] * 2.7 * t + ph[a + 3])))
            pb.rotation_euler = e
            pb.keyframe_insert('rotation_euler', frame=f)
            if 'loc' in sp:
                pb.location = [sp['loc'][a] * math.sin(2 * math.pi * sp['f'][a] * 0.8 * t + ph[a + 6]) for a in range(3)]
                pb.keyframe_insert('location', frame=f)


def preview(scene, tag, frame=40, views=None):
    sc.setup_render(scene, res=(900, 1000), samples=64, motion_blur=False)
    sc.setup_world(scene)
    cd = bpy.data.cameras.new('pc'); cd.lens = 70
    cam = bpy.data.objects.new('pc', cd); scene.collection.objects.link(cam); scene.camera = cam
    tgt = Vector((0, 0, 0.78))
    scene.frame_set(frame)
    views = views or (('front', 25, 0.10, 4.6), ('rear', 205, 0.22, 4.6), ('face', 15, 0.05, 1.9))
    for name, ang, elev, dist in views:
        a = math.radians(ang)
        t2 = tgt if name != 'face' else Vector((0.12, 0.05, 1.22))
        pos = t2 + Vector((math.cos(a), math.sin(a), elev)).normalized() * dist
        cam.location = pos
        cam.rotation_euler = (t2 - pos).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(sc.ROOT, 'tests', f'wkreal_{tag}_{name}.png')
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    col, root, arm, body, s = load()
    scene = bpy.context.scene
    scene.render.fps = FPS
    tune_material(body)
    classify_fur(body, arm)
    slot = hair_material(body)
    add_fur(body, slot, 'WK_FurArm', 'fur_arm', 40000, 0.026, 5, 0.40, 0.004, 0.00045, 11)
    add_fur(body, slot, 'WK_FurTiger', 'fur_tiger', 45000, 0.019, 5, 0.30, 0.003, 0.00045, 13)
    add_fur(body, slot, 'WK_FurHead', 'fur_head', 50000, 0.032, 5, 0.45, 0.005, 0.00045, 12)
    staff = add_staff(arm, col, s)
    micro_anim(arm)
    for n in ('Head', 'HeadTop_End', 'LeftArm', 'RightArm', 'Neck', 'Spine2', 'RightHand', 'Hips'):
        print('BONE', n, tuple(round(v, 3) for v in bone_world(arm, n)))
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print('SAVED', OUT)
    if 'mask' in argv:
        me = body.data
        ca = me.color_attributes.new('furdbg', 'FLOAT_COLOR', 'POINT')
        nv = len(me.vertices)
        col_ = np.zeros((nv, 4), dtype=np.float32); col_[:, 3] = 1; col_[:, :3] = 0.08
        for gname, c in (('fur_arm', (0.1, 0.9, 0.1)), ('fur_tiger', (0.95, 0.75, 0.1)), ('fur_head', (0.9, 0.2, 0.9))):
            gi = body.vertex_groups[gname].index
            for v_ in me.vertices:
                for g_ in v_.groups:
                    if g_.group == gi and g_.weight > 0.5:
                        col_[v_.index, :3] = c
        ca.data.foreach_set('color', col_.ravel())
        dm = bpy.data.materials.new('dbg'); dm.use_nodes = True
        nt = dm.node_tree; nt.nodes.clear()
        o_ = nt.nodes.new('ShaderNodeOutputMaterial'); e_ = nt.nodes.new('ShaderNodeEmission'); a_ = nt.nodes.new('ShaderNodeAttribute')
        a_.attribute_name = 'furdbg'; nt.links.new(a_.outputs['Color'], e_.inputs['Color']); nt.links.new(e_.outputs[0], o_.inputs['Surface'])
        keep = list(body.data.materials)
        body.data.materials.clear(); body.data.materials.append(dm)
        for md_ in body.modifiers:
            if md_.type == 'PARTICLE_SYSTEM':
                md_.show_render = False
        preview(scene, 'mask', views=(('front', 25, 0.10, 4.6), ('rear', 205, 0.22, 4.6)))
        raise SystemExit
    if 'preview' in argv:
        preview(scene, 'a')
        print('PREVIEW DONE')
