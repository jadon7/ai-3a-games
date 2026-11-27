# 从 race_scene.blend 导出游戏用车辆 GLB（只读打开场景，不保存）
#   Blender -b race_scene.blend -P export_cars.py -- <输出目录> [E30,CAPRI,STRATOS]
#   导出后要再跑 glb_weld.py 合并重复顶点（文件约小一半）
#   新增的 10 台在 cars_work.blend 里：-- <输出目录> ESCORT,P917,L037,DELTA,GT40,MUSTANG,COUNTACH,Z280,S15,M190
# 约定：glTF +Y 向上、车头 +Z、左 = +X；顶层节点 body / wheel_FL / wheel_FR / wheel_RL / wheel_RR
#   body      -> body_mesh（整车合并网格）、brakelight_*（刹车灯网格，独立材质）
#   wheel_XX  -> wheel_XX_spin（轮胎/轮辋/刹车盘）、wheel_XX_fixed（卡钳/轮毂，可能没有）
import bpy, json, math, os, sys, struct
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
ONLY = argv[1].split(',') if len(argv) > 1 else ['E30', 'CAPRI', 'STRATOS']
D = bpy.data
CARS = {'E30': 'e30', 'CAPRI': 'capri', 'STRATOS': 'stratos',
        'ESCORT': 'escort', 'P917': 'p917', 'L037': 'l037', 'DELTA': 'delta', 'GT40': 'gt40',
        'MUSTANG': 'mustang', 'COUNTACH': 'countach', 'Z280': 'z280', 'S15': 's15', 'M190': 'm190'}
R4 = Matrix.Rotation(-math.pi / 2, 4, 'Z')        # 车头 +X -> Blender -Y（= glTF +Z）
WK = ('FL', 'FR', 'RL', 'RR')

BRAKE = {   # 源对象名 -> (导出名, 换成的材质名或 None)
    'E30': {'rear_lights_Taillight.003_0': ('brakelight_tail', None),
            'brake_lights_Taillight.002_0': ('brakelight_stop', 'Taillight.003')},
    'CAPRI': {'Object_54': ('brakelight_rear', 'LIGHTS>LIGHTS_brake')},
    'STRATOS': {},
}
for _t in CARS:
    BRAKE.setdefault(_t, {})
DROP_MATS = {'INT_VETRI_indicatori.001', 'DAMAGE_GLASS.002', 'EXT_LIGHT_GRADIENT.002', 'LAMPADA1'}
PAINT = {'E30': ['Skin1'], 'CAPRI': ['PAINT'], 'STRATOS': ['bodywork'],
         'ESCORT': ['Ford_EscortRSCosworthCossieV2_1994PaintA_Material'], 'P917': ['body'], 'L037': ['Meshpart3Mtl'],
         'DELTA': ['Paint'], 'GT40': ['Paint1Mtl'], 'MUSTANG': ['carpaint'], 'COUNTACH': ['Meshpart19Mtl.001'],
         'Z280': ['280z_CarPaint'], 'S15': ['Body'], 'M190': ['Car_body_color']}
NEW = {'ESCORT', 'P917', 'L037', 'DELTA', 'GT40', 'MUSTANG', 'COUNTACH', 'Z280', 'S15', 'M190'}
# 面数太高的车：导出前对大网格做塌陷减面（比例）
DECIMATE = {'MUSTANG': 0.27, 'P917': 0.62}
BIG_TEX_KEEP = ('Skin1', 'bodywork_baseColor', 'mechanical_baseColor', 'mechanical_normal', 'PAINT_', 'PaintA', 'Paint')


def desc(o):
    r = []; st = list(o.children)
    while st:
        c = st.pop(); r.append(c); st.extend(c.children)
    return r


def bsdf(m):
    if not m or not m.node_tree:
        return None
    return next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def setv(m, name, v):
    b = bsdf(m)
    if b and name in b.inputs and not b.inputs[name].is_linked:
        b.inputs[name].default_value = v


def tweak_materials(tag):
    notes = []
    for m in D.materials:
        b = bsdf(m)
        if not b:
            continue
        if 'Transmission Weight' in b.inputs and b.inputs['Transmission Weight'].default_value > 0:
            b.inputs['Transmission Weight'].default_value = 0.0
        sp = b.inputs.get('Specular IOR Level')
        if sp is not None and not sp.is_linked:
            sp.default_value = 0.5
        for nd in [n for n in m.node_tree.nodes if n.type == 'UVMAP']:
            m.node_tree.nodes.remove(nd)
    if tag == 'E30':
        m = D.materials['Skin1']
        setv(m, 'Roughness', 0.45); setv(m, 'Coat Weight', 1.0); setv(m, 'Coat Roughness', 0.05)
        m = D.materials['Carpaint.003']
        setv(m, 'Roughness', 0.5); setv(m, 'Coat Weight', 1.0); setv(m, 'Coat Roughness', 0.08)
        m = D.materials['Glass.002']
        setv(m, 'Base Color', (0.03, 0.035, 0.04, 1.0)); setv(m, 'Roughness', 0.06); setv(m, 'Alpha', 0.38)
        m = D.materials['INT_Glass.001']
        setv(m, 'Roughness', 0.1); setv(m, 'Alpha', 0.3)
        m = D.materials['Mirror.002']
        setv(m, 'Base Color', (0.75, 0.78, 0.8, 1.0)); setv(m, 'Metallic', 1.0); setv(m, 'Roughness', 0.05)
        m = D.materials['Headlight_Glass.002']
        setv(m, 'Roughness', 0.15)
        m = D.materials['Taillight.002']
        setv(m, 'Roughness', 0.2)
        # 仪表屏：原来是纯白强发光，改成用贴图自发光
        m = D.materials['INT_Display.001']
        b = bsdf(m)
        img = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
        if img:
            m.node_tree.links.new(img.outputs['Color'], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = 1.5
        notes.append('E30: 车漆 Skin1 加了清漆层(coat 1.0/0.05)、底层粗糙度 0.45；玻璃改为深色低粗糙度半透明；后视镜改为金属镜面')
    if tag in NEW:
        for name in PAINT[tag]:
            m = D.materials.get(name); b = bsdf(m)
            if not b:
                continue
            if not b.inputs['Metallic'].is_linked:
                b.inputs['Metallic'].default_value = min(b.inputs['Metallic'].default_value, 0.35)
            if not b.inputs['Roughness'].is_linked:
                b.inputs['Roughness'].default_value = min(max(b.inputs['Roughness'].default_value, 0.25), 0.45)
            setv(m, 'Coat Weight', 1.0); setv(m, 'Coat Roughness', 0.05)
        notes.append(f'{tag}: 车漆 {PAINT[tag]} 加清漆层(coat 1.0/0.05)，金属度上限 0.35')
        # 导入后车漆颜色不对的两台：按原作者展示图的颜色改回来
        if tag == 'L037':
            setv(D.materials['Meshpart3Mtl'], 'Base Color', (0.42, 0.012, 0.01, 1.0)); notes.append('L037: 车漆导入后偏粉，改回深红')
        if tag == 'MUSTANG':
            setv(D.materials['carpaint'], 'Base Color', (0.016, 0.065, 0.032, 1.0)); notes.append('MUSTANG: 车漆导入后是金色，改回原作的深绿')
    if tag == 'CAPRI':
        setv(D.materials['GAUGE_GLASS'], 'Alpha', 0.15)
        m = D.materials['PAINT_FLAT1_CPIT.001']     # 这块的清漆法线原本用另一套平铺 UV，合并 UV 后去掉
        b = bsdf(m)
        for l in list(b.inputs['Coat Normal'].links):
            m.node_tree.links.remove(l)
    return notes


def is_flat(m):
    b = bsdf(m)
    if not b:
        return None
    for k in ('Base Color', 'Metallic', 'Roughness', 'Alpha', 'Normal', 'Emission Color', 'Coat Weight'):
        if k in b.inputs and b.inputs[k].is_linked:
            return None
    if b.inputs['Alpha'].default_value < 0.999 or b.inputs['Metallic'].default_value > 0.1:
        return None
    if b.inputs['Coat Weight'].default_value > 0.01 or b.inputs['Emission Strength'].default_value > 0.0:
        return None
    if b.inputs['Roughness'].default_value < 0.5:
        return None
    return tuple(b.inputs['Base Color'].default_value)


def get_flat_vc():
    m = D.materials.get('flat_vc')
    if m:
        return m
    m = D.materials.new('flat_vc')
    m.use_nodes = True
    b = bsdf(m)
    ca = m.node_tree.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'Col'
    m.node_tree.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    b.inputs['Metallic'].default_value = 0.0
    return m


def merge_flat(me):
    mats = list(me.materials)
    flat = {i: is_flat(m) for i, m in enumerate(mats)}
    flat = {i: c for i, c in flat.items() if c is not None}
    if len(flat) < 2:
        return 0
    npoly = len(me.polygons)
    mi = np.empty(npoly, np.int32); me.polygons.foreach_get('material_index', mi)
    lt = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_total', lt)
    ls = np.empty(npoly, np.int32); me.polygons.foreach_get('loop_start', ls)
    assert np.all(np.diff(ls) > 0)
    pc = np.ones((npoly, 4), np.float32)
    for i, c in flat.items():
        pc[mi == i] = c
    cols = np.repeat(pc, lt, axis=0)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', cols.ravel())
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = me.color_attributes.find('Col')
    me.materials.append(get_flat_vc())
    mi[np.isin(mi, list(flat.keys()))] = len(mats)
    me.polygons.foreach_set('material_index', mi)
    me.update()
    return len(flat)


def tris_of(me):
    lt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt)
    return int((lt - 2).sum())


def align_wheel(sp, fx):
    """找出车轮的真实轮轴，让它绕自己的轴转：
    - 有的模型展示时前轮是打着方向的（280Z 前轮转了二十多度），直接绕车身横轴转会乱晃 → 去掉转向角（连卡钳一起转回来）
    - 外倾角保留：把它放进 wheel_XX_spin 节点自身的旋转里，网格改到节点的局部坐标，游戏里绕节点自身的 X 轴转
    返回 [转向角, 外倾角, 轮心偏移] 供核对"""
    me = sp.data
    co = np.empty(len(me.vertices) * 3, np.float64); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    if len(co) > 30000:
        co = co[np.random.default_rng(0).choice(len(co), 30000, replace=False)]

    def frame(a):
        u = np.cross(a, [0.0, 0.0, 1.0]); u /= np.linalg.norm(u); v = np.cross(a, u)
        t, p, q = co @ a, co @ u, co @ v
        cu, cv = (p.max() + p.min()) / 2, (q.max() + q.min()) / 2
        r = np.hypot(p - cu, q - cv); ph = np.arctan2(q - cv, p - cu)
        return t, r, ph, cu * u + cv * v

    def cost(a):
        # 轮轴找对时，轮子在垂直轴的平面上是正圆、每个方位的厚度也一样
        t, r, ph, _ = frame(a)
        sel = r > 0.7 * r.max(); sec = ((ph[sel] + np.pi) / (2 * np.pi) * 24).astype(int) % 24
        rs, ts = r[sel], t[sel]
        rm = np.full(24, np.nan); t0 = rm.copy(); t1 = rm.copy()
        for i in range(24):
            m = sec == i
            if m.any():
                rm[i] = rs[m].max(); t0[i] = ts[m].min(); t1[i] = ts[m].max()
        return np.nanstd(rm) + np.nanstd(t0) + np.nanstd(t1)

    def ax(toe, cam):
        return np.array([math.cos(cam) * math.cos(toe), math.cos(cam) * math.sin(toe), math.sin(cam)])
    best = (1e9, 0.0, 0.0)
    for toe in np.radians(np.arange(-40, 40.1, 2.0)):
        for cam in np.radians(np.arange(-15, 15.1, 1.5)):
            c_ = cost(ax(toe, cam))
            if c_ < best[0]:
                best = (c_, toe, cam)
    for step in (0.5, 0.125):
        _, t0_, c0_ = best
        for toe in t0_ + np.radians(np.arange(-4, 4.01, 1) * step):
            for cam in c0_ + np.radians(np.arange(-4, 4.01, 1) * step):
                c_ = cost(ax(toe, cam))
                if c_ < best[0]:
                    best = (c_, toe, cam)
    axis = ax(best[1], best[2])
    t, r, ph, cpl = frame(axis)
    sel = r > 0.7 * r.max()
    ctr = cpl + axis * (t[sel].max() + t[sel].min()) / 2
    toe = math.atan2(axis[1], axis[0])
    if abs(math.degrees(toe)) < 0.3 and np.linalg.norm(ctr) < 0.002 and abs(axis[2]) < 0.005:
        return [0.0, 0.0, 0.0]
    C = Vector(ctr.tolist())
    Rt = Matrix.Translation(C) @ Matrix.Rotation(-toe, 4, 'Z') @ Matrix.Translation(-C)
    a2 = Matrix.Rotation(-toe, 3, 'Z') @ Vector(axis.tolist())
    q = Vector((1, 0, 0)).rotation_difference(a2.normalized())          # 外倾：X 轴 → 真实轮轴
    Rc = q.to_matrix().to_4x4()
    # 自转部分：顶点改到「轮心 + 外倾」的局部坐标，节点带上这个变换
    me.transform(Rc.inverted() @ Matrix.Translation(-C) @ Rt)
    sp.matrix_basis = Matrix.Translation(C) @ Rc
    if fx is not None:
        fx.data.transform(Rt)
    me.update()
    return [round(math.degrees(toe), 2), round(math.degrees(math.asin(max(-1, min(1, a2.z)))), 2), round(float(np.linalg.norm(ctr)), 4)]


def export_car(tag):
    cid = CARS[tag]
    scene = bpy.context.scene
    root = D.objects[tag + '_ROOT']; body = D.objects[tag + '_BODY']
    objs = desc(root)
    for o in [root] + objs:
        o.animation_data_clear()
    root.location = (0, 0, 0); root.rotation_euler = (0, 0, 0)
    body.location = (0, 0, 0.30); body.rotation_euler = (0, 0, 0)
    steer = {k: D.objects[f'{tag}_W_{k}_STEER'] for k in WK}
    spin = {k: D.objects[f'{tag}_W_{k}_SPIN'] for k in WK}
    for k in WK:
        steer[k].rotation_euler = (0, 0, 0); spin[k].rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    notes = tweak_materials(tag)
    dg = bpy.context.evaluated_depsgraph_get()

    # 以轮胎真实最低点为地面（原绑定按包围盒估算，E30 轮胎离地约 1.5 cm）
    zmin = 1e9
    for k in WK:
        for o in desc(spin[k]):
            if o.type == 'MESH' and len(o.data.vertices):
                co = np.empty(len(o.data.vertices) * 3, np.float32); o.data.vertices.foreach_get('co', co)
                M = np.array(o.matrix_world)
                zmin = min(zmin, float((co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])[:, 2].min()))
    SH = Matrix.Translation((0, 0, -zmin))
    RS = R4 @ SH
    coll = D.collections.new('EXP_' + cid)
    scene.collection.children.link(coll)

    # 分组
    groups = {'body': []}
    for k in WK:
        groups['spin_' + k] = []; groups['fixed_' + k] = []
    brake_objs = {}
    spin_sets = {k: set(desc(spin[k])) for k in WK}
    steer_sets = {k: set(desc(steer[k])) for k in WK}
    dropped = []
    for o in objs:
        if o.type != 'MESH':
            continue
        if o.name in BRAKE[tag]:
            brake_objs[o.name] = o
            continue
        if o.hide_render:
            dropped.append(o.name); continue
        if any(s.material and s.material.name in DROP_MATS for s in o.material_slots):
            dropped.append(o.name); continue
        def _invisible(m):
            b = bsdf(m)
            return b is not None and not b.inputs['Alpha'].is_linked and b.inputs['Alpha'].default_value < 0.01
        if o.material_slots and all(sl.material and _invisible(sl.material) for sl in o.material_slots):
            dropped.append(o.name); continue
        g = 'body'
        for k in WK:
            if o in spin_sets[k]:
                g = 'spin_' + k; break
            if o in steer_sets[k]:
                g = 'fixed_' + k; break
        groups[g].append(o)

    def piece(o, name='tmp'):
        if o.modifiers:
            me = D.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        else:
            me = o.data.copy()
        ratio = DECIMATE.get(tag)
        if ratio and tris_of(me) > 3000:
            import bmesh
            tmp = D.objects.new('dec_tmp', me); coll.objects.link(tmp)
            md = tmp.modifiers.new('dec', 'DECIMATE'); md.ratio = ratio; md.use_collapse_triangulate = True
            dg2 = bpy.context.evaluated_depsgraph_get()
            me2 = D.meshes.new_from_object(tmp.evaluated_get(dg2), preserve_all_data_layers=True, depsgraph=dg2)
            D.objects.remove(tmp, do_unlink=True); me = me2
        while len(me.uv_layers) > 1:
            me.uv_layers.remove(me.uv_layers[len(me.uv_layers) - 1])
        if len(me.uv_layers) == 1:
            me.uv_layers[0].name = 'UVMap'
        n = D.objects.new('tmp', me)
        coll.objects.link(n)
        for i, s in enumerate(o.material_slots):
            if s.link == 'OBJECT' and i < len(me.materials):
                me.materials[i] = s.material
        n.matrix_world = RS @ o.matrix_world
        return n

    def join(pieces, name, origin):
        tgt = D.objects.new(name, D.meshes.new(name))
        coll.objects.link(tgt)
        tgt.matrix_world = Matrix.Translation(origin)
        bpy.context.view_layer.update()
        if pieces:
            with bpy.context.temp_override(active_object=tgt, object=tgt, selected_objects=pieces + [tgt],
                                           selected_editable_objects=pieces + [tgt]):
                bpy.ops.object.join()
        if len(tgt.data.uv_layers):
            tgt.data.uv_layers[0].active_render = True
            tgt.data.uv_layers.active_index = 0
        return tgt

    def node(name, loc):
        e = D.objects.new(name, None)
        coll.objects.link(e)
        e.location = loc
        return e

    def child(o, parent):
        o.parent = parent
        o.matrix_parent_inverse = Matrix.Identity(4)
        o.matrix_basis = Matrix.Identity(4)

    export_objs = []
    stats = {'prims': 0}
    n_body = node('body', (0, 0, 0)); export_objs.append(n_body)
    def all_flat(o):
        ms = [s_.material for s_ in o.material_slots if s_.material]
        return bool(ms) and all(is_flat(m_) is not None for m_ in ms)
    flat_src = [o for o in groups['body'] if all_flat(o)]
    tex_src = [o for o in groups['body'] if not all_flat(o)]
    bm = join([piece(o) for o in tex_src], 'body_mesh', Vector((0, 0, 0)))
    child(bm, n_body); export_objs.append(bm)
    nflat = 0
    if len(flat_src) >= 2:
        bf = join([piece(o) for o in flat_src], 'body_flat', Vector((0, 0, 0)))
        nflat = merge_flat(bf.data)
        child(bf, n_body); export_objs.append(bf)
    elif flat_src:
        bm2 = join([piece(o) for o in flat_src], 'body_flat', Vector((0, 0, 0)))
        child(bm2, n_body); export_objs.append(bm2)
    print('BODY joined polys', len(bm.data.polygons), 'mats', len(bm.data.materials), 'tex objs', len(tex_src), 'flat objs', len(flat_src), 'flat mats merged', nflat)
    brakenodes = []; brakemats = set()
    for src, (nm, mat) in BRAKE[tag].items():
        o = brake_objs.get(src)
        if o is None:
            notes.append(f'未找到刹车灯对象 {src}'); continue
        t = join([piece(o)], nm, Vector((0, 0, 0)))
        if mat:
            if '>' in mat:
                a, b = mat.split('>')
                newm = D.materials.get(b) or D.materials[a].copy()
                newm.name = b
            else:
                newm = D.materials[mat]
            for i in range(len(t.data.materials)):
                t.data.materials[i] = newm
        print('BRAKE', nm, 'polys', len(t.data.polygons), 'mats', [m_.name if m_ else None for m_ in t.data.materials], 'src mats', [(s_.material.name if s_.material else None, s_.link) for s_ in o.material_slots])
        for m_ in t.data.materials:
            if m_:
                brakemats.add(m_.name)
        child(t, n_body); export_objs.append(t); brakenodes.append(nm)

    centers = {}
    for k in WK:
        c_car = SH @ steer[k].matrix_world.translation.copy()
        centers[k] = c_car
        c = R4 @ c_car
        n = node('wheel_' + k, c); export_objs.append(n)
        sp = join([piece(o) for o in groups['spin_' + k]], f'wheel_{k}_spin', c)
        child(sp, n); export_objs.append(sp)
        fx = None
        if groups['fixed_' + k]:
            fx = join([piece(o) for o in groups['fixed_' + k]], f'wheel_{k}_fixed', c)
            child(fx, n); export_objs.append(fx)
        stats['wheel_' + k] = align_wheel(sp, fx)
    bpy.context.view_layer.update()

    # 贴图缩小
    used_imgs = set()
    for o in export_objs:
        if o.type == 'MESH':
            for m in o.data.materials:
                if m and m.node_tree:
                    for nd in m.node_tree.nodes:
                        if nd.type == 'TEX_IMAGE' and nd.image:
                            used_imgs.add(nd.image)
    for img in used_imgs:
        w, h = img.size
        lim = 2048 if any(s in img.name for s in BIG_TEX_KEEP) else 1024
        if max(w, h) > lim:
            f = lim / max(w, h)
            img.scale(max(1, int(w * f)), max(1, int(h * f)))

    # 尺寸（车辆坐标系：+X 前、+Y 左；导出坐标 = R4 * 车辆坐标）
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    total_tris = 0
    Rinv = R4.inverted()
    stats['groundShift'] = round(-zmin, 4)
    for o in export_objs:
        if o.type != 'MESH':
            continue
        total_tris += tris_of(o.data)
        nv = len(o.data.vertices)
        if nv == 0:
            continue
        co = np.empty(nv * 3, np.float32); o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        M = np.array(Rinv @ o.matrix_world)
        w = co @ M[:3, :3].T + M[:3, 3]
        for i in range(3):
            mn[i] = min(mn[i], float(w[:, i].min())); mx[i] = max(mx[i], float(w[:, i].max()))
    radius = {}
    for k in WK:
        o = D.objects[f'wheel_{k}_spin']
        co = np.empty(len(o.data.vertices) * 3, np.float32); o.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        radius[k] = float(max(np.abs(co[:, 1]).max(), np.abs(co[:, 2]).max()))
        stats['spin_center_err_' + k] = [round(float((co[:, i].max() + co[:, i].min()) / 2), 4) for i in range(3)]

    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in export_objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = n_body
    path = os.path.join(OUT, cid + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_apply=False, export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False, export_extras=False,
        export_image_format='JPEG', export_jpeg_quality=88,
        export_materials='EXPORT', export_vertex_color='MATERIAL',
        export_tangents=False, export_normals=True, export_texcoords=True)

    info = {
        'file': cid + '.glb',
        'wheelbase': round(centers['FL'].x - centers['RL'].x, 4),
        'trackFront': round(centers['FL'].y - centers['FR'].y, 4),
        'trackRear': round(centers['RL'].y - centers['RR'].y, 4),
        'wheelRadiusFront': round((radius['FL'] + radius['FR']) / 2, 4),
        'wheelRadiusRear': round((radius['RL'] + radius['RR']) / 2, 4),
        'wheelCenterHeightFront': round(centers['FL'].z, 4),
        'wheelCenterHeightRear': round(centers['RL'].z, 4),
        'length': round(mx.x - mn.x, 4), 'width': round(mx.y - mn.y, 4), 'height': round(mx.z, 4),
        'frontAxleToNose': round(mx.x - centers['FL'].x, 4),
        'rearAxleToTail': round(centers['RL'].x - mn.x, 4),
        'groundClearanceMin': round(mn.z, 4),
        'tris': total_tris,
        'sizeMB': round(os.path.getsize(path) / 1e6, 2),
        'bodyPaintMaterials': PAINT[tag],
        'brakelightNodes': brakenodes,
        'brakelightMaterials': sorted(brakemats),
        'flatMaterialsMerged': nflat,
        'droppedHidden': len(dropped),
        'notes': notes,
        '_debug': stats,
    }
    # 清理导出对象，避免下一台车重名
    for o in export_objs:
        D.objects.remove(o, do_unlink=True)
    return info


result = {}
for tag in ONLY:
    result[CARS[tag]] = export_car(tag)
    print('EXPORTED', tag, json.dumps(result[CARS[tag]], ensure_ascii=False))
with open(os.path.join(OUT, '_export_info.json'), 'w') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)
