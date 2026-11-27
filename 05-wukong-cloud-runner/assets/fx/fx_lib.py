"""fx_lib —— 二次元风特效库（EEVEE，全部“无状态”）。

所有特效都是「出生帧 → 年龄 → 位置/大小/透明度」的解析计算：粒子的出生位置、初速度等在
创建时用 numpy 算好存成网格点属性，几何节点只根据当前帧（Scene Time）算年龄再摆位置。
所以任意帧单独渲染、乱序渲染、带运动模糊都正确；不依赖 handler、不需要顺序步进。

约定
----
- path_curve：密集折线曲线（POLY），悟空第 f 帧位于弧长 s = speed*(f - path_f0)/fps 处。
  path_f0 默认等于 f_start（即特效开始那一帧悟空在曲线起点）；如果特效只覆盖镜头的一段，
  请显式传 path_f0=镜头里 s=0 对应的帧。
- 所有函数返回创建的物体列表，物体放进集合 "FX"。
- 着色全部是自发光 + 色阶（不吃场景灯光），太阳方向取 scene_common.A_SUN_DIR。

用法
----
    import sys; sys.path.insert(0, ROOT + '/assets/fx'); import fx_lib
    fx_lib.add_cloud_trail(scene, path, speed=60, f_start=1, f_end=120)
"""
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))
if os.path.join(_ROOT, 'common') not in sys.path:
    sys.path.insert(0, os.path.join(_ROOT, 'common'))
try:
    import scene_common as sc
    SUN_DIR = tuple(sc.A_SUN_DIR)
except Exception:                                   # 兜底
    SUN_DIR = (0.31, 0.67, 0.67)


# ================================================================ 节点小工具
def _math(nt, op, a, b=None, c=None):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = float(v)
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _vmath(nt, op, a, b=None, scale=None):
    n = nt.nodes.new('ShaderNodeVectorMath')
    n.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (tuple, list, Vector)):
            n.inputs[i].default_value = tuple(v)
        else:
            nt.links.new(v, n.inputs[i])
    if scale is not None:
        s = n.inputs['Scale']
        if isinstance(scale, (int, float)):
            s.default_value = float(scale)
        else:
            nt.links.new(scale, s)
    return n


def _combine(nt, x, y, z):
    n = nt.nodes.new('ShaderNodeCombineXYZ')
    for i, v in enumerate((x, y, z)):
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = float(v)
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _sock_by_type(coll, name, typ):
    for s in coll:
        if s.name == name and s.type == typ:
            return s
    return next(s for s in coll if s.name == name)


def _attr_in(nt, name, dtype):
    n = nt.nodes.new('GeometryNodeInputNamedAttribute')
    n.data_type = dtype
    n.inputs['Name'].default_value = name
    return _sock_by_type(n.outputs, 'Attribute', {'FLOAT': 'VALUE', 'FLOAT_VECTOR': 'VECTOR'}[dtype])


def _store(nt, geo, name, value, dtype='FLOAT', domain='POINT'):
    n = nt.nodes.new('GeometryNodeStoreNamedAttribute')
    n.data_type = dtype
    n.domain = domain
    n.inputs['Name'].default_value = name
    nt.links.new(geo, n.inputs['Geometry'])
    nt.links.new(value, _sock_by_type(n.inputs, 'Value', {'FLOAT': 'VALUE', 'FLOAT_VECTOR': 'VECTOR'}[dtype]))
    return n.outputs['Geometry']


def _mix_color(nt, fac, a, b):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    fi = next(s for s in n.inputs if s.identifier == 'Factor_Float')
    ai = next(s for s in n.inputs if s.identifier == 'A_Color')
    bi = next(s for s in n.inputs if s.identifier == 'B_Color')
    for sock, v in ((fi, fac), (ai, a), (bi, b)):
        if isinstance(v, (int, float)):
            sock.default_value = float(v)
        elif isinstance(v, (tuple, list)):
            sock.default_value = (*v[:3], 1.0)
        else:
            nt.links.new(v, sock)
    return next(s for s in n.outputs if s.identifier == 'Result_Color')


def _set_blend(m, mode):
    """mode: 'DITHERED' | 'BLENDED'"""
    try:
        m.surface_render_method = mode
    except Exception:
        pass
    for prop, val in (('use_transparency_overlap', True), ('use_raytrace_refraction', False)):
        if hasattr(m, prop):
            try:
                setattr(m, prop, val)
            except Exception:
                pass


def fx_collection(scene, name='FX'):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
    if c.name not in [ch.name for ch in scene.collection.children_recursive]:
        scene.collection.children.link(c)
    return c


# ================================================================ 材质
def toon_cloud_material(name, lit=(1.0, 0.97, 0.93), mid=(0.80, 0.87, 1.0), shade=(0.55, 0.64, 0.93),
                        rim=(1.0, 1.0, 1.0), rim_amt=0.35, soft=True, soft_width=0.22, fade_attr=False,
                        alpha=1.0, noise_scale=3.0, normal_noise=0.9, top_bias=0.35, strength=1.0,
                        thresholds=(0.40, 0.53, 0.66)):
    """吉卜力式云：自发光三段色阶（背光淡蓝紫 → 中间 → 受光暖白），法线加噪声得到手绘感明暗边界，
    轮廓处柔和透明。fade_attr=True 时读取粒子属性 fx_fade（0=新生,1=消亡）做淡出。"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    geo = N.new('ShaderNodeNewGeometry')
    tc = N.new('ShaderNodeTexCoord')
    noise = N.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = noise_scale
    noise.inputs['Detail'].default_value = 3.0
    L.new(tc.outputs['Object'], noise.inputs['Vector'])
    sub = _vmath(nt, 'SUBTRACT', noise.outputs['Color'], (0.5, 0.5, 0.5)).outputs[0]
    scl = _vmath(nt, 'SCALE', sub, scale=normal_noise).outputs[0]
    nrm = _vmath(nt, 'NORMALIZE', _vmath(nt, 'ADD', geo.outputs['Normal'], scl).outputs[0]).outputs[0]
    ndl = _vmath(nt, 'DOT_PRODUCT', nrm, SUN_DIR).outputs['Value']
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(nrm, sep.inputs[0])
    fac = _math(nt, 'ADD', _math(nt, 'MULTIPLY', ndl, 1.0 - top_bias), _math(nt, 'MULTIPLY', sep.outputs['Z'], top_bias))
    fac = _math(nt, 'ADD', _math(nt, 'MULTIPLY', fac, 0.5), 0.5)
    ramp = N.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.interpolation = 'EASE'
    cr.elements[0].position = thresholds[0]
    cr.elements[0].color = (*shade, 1)
    cr.elements[1].position = thresholds[2]
    cr.elements[1].color = (*lit, 1)
    e = cr.elements.new(thresholds[1])
    e.color = (*mid, 1)
    L.new(fac, ramp.inputs['Fac'])
    lw = N.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    facing = lw.outputs['Facing']
    rimfac = _math(nt, 'MULTIPLY', _math(nt, 'POWER', facing, 3.0), rim_amt)
    col = _mix_color(nt, rimfac, ramp.outputs['Color'], rim)
    emi = N.new('ShaderNodeEmission')
    emi.inputs['Strength'].default_value = strength
    L.new(col, emi.inputs['Color'])
    a = None
    if soft:
        # 轮廓柔边：facing→1 处逐渐透明，加一点噪声让边缘不规则
        f2 = _math(nt, 'ADD', facing, _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', noise.outputs['Fac'], 0.5), 0.25))
        mr = N.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.inputs[1].default_value = 1.0 - soft_width
        mr.inputs[2].default_value = 0.98
        mr.inputs[3].default_value = 1.0
        mr.inputs[4].default_value = 0.0
        L.new(f2, mr.inputs[0])
        a = mr.outputs[0]
    if fade_attr:
        at = N.new('ShaderNodeAttribute')
        at.attribute_type = 'GEOMETRY'
        at.attribute_name = 'fx_fade'
        fo = _math(nt, 'SUBTRACT', 1.0, _math(nt, 'POWER', at.outputs['Fac'], 1.6))
        a = fo if a is None else _math(nt, 'MULTIPLY', a, fo)
    if alpha < 1.0:
        a = _math(nt, 'MULTIPLY', a, alpha) if a is not None else None
        if a is None:
            v = N.new('ShaderNodeValue')
            v.outputs[0].default_value = alpha
            a = v.outputs[0]
    if a is not None:
        tr = N.new('ShaderNodeBsdfTransparent')
        mx = N.new('ShaderNodeMixShader')
        L.new(a, mx.inputs[0])
        L.new(tr.outputs[0], mx.inputs[1])
        L.new(emi.outputs[0], mx.inputs[2])
        L.new(mx.outputs[0], out.inputs['Surface'])
        _set_blend(m, 'DITHERED')
    else:
        L.new(emi.outputs[0], out.inputs['Surface'])
    return m


def _flat_fx_material(name, color_a, color_b=None, fade_pow=1.5, strength=1.0, alpha=1.0, blend='DITHERED',
                      shade_amt=0.25):
    """粒子用的自发光材质：颜色按 fx_rand 在 a/b 间随机，按 fx_fade 淡出，带一点朝向明暗（翻转时闪烁）。"""
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    rnd = N.new('ShaderNodeAttribute'); rnd.attribute_type = 'GEOMETRY'; rnd.attribute_name = 'fx_rand'
    fade = N.new('ShaderNodeAttribute'); fade.attribute_type = 'GEOMETRY'; fade.attribute_name = 'fx_fade'
    col = _mix_color(nt, rnd.outputs['Fac'], color_a, color_b or color_a)
    geo = N.new('ShaderNodeNewGeometry')
    ndl = _vmath(nt, 'DOT_PRODUCT', geo.outputs['Normal'], SUN_DIR).outputs['Value']
    sh = _math(nt, 'ADD', 1.0 - shade_amt, _math(nt, 'MULTIPLY', _math(nt, 'ABSOLUTE', ndl), shade_amt))
    emi = N.new('ShaderNodeEmission')
    L.new(col, emi.inputs['Color'])
    L.new(_math(nt, 'MULTIPLY', sh, strength), emi.inputs['Strength'])
    a = _math(nt, 'MULTIPLY', _math(nt, 'SUBTRACT', 1.0, _math(nt, 'POWER', fade.outputs['Fac'], fade_pow)), alpha)
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(a, mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(emi.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    _set_blend(m, blend)
    m.use_backface_culling = False
    return m


def _foam_material(name='WK_FX_Foam'):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    fade = N.new('ShaderNodeAttribute'); fade.attribute_type = 'GEOMETRY'; fade.attribute_name = 'fx_fade'
    uv = N.new('ShaderNodeAttribute'); uv.attribute_type = 'GEOMETRY'; uv.attribute_name = 'fx_uv'
    noise = N.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1.6
    noise.inputs['Detail'].default_value = 5.0
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.45, 3.2, 1.0)      # 沿路径拉长的泡沫条纹
    L.new(uv.outputs['Vector'], mp.inputs['Vector'])
    L.new(mp.outputs['Vector'], noise.inputs['Vector'])
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(uv.outputs['Vector'], sep.inputs[0])
    v = sep.outputs['Y']                                      # 0..1 横向
    edge = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', v, _math(nt, 'SUBTRACT', 1.0, v)), 4.0)   # 中间 1，两边 0
    age = fade.outputs['Fac']
    # 泡沫随年龄被“吃掉”：阈值随年龄升高
    thr = _math(nt, 'ADD', 0.30, _math(nt, 'MULTIPLY', age, 0.50))
    mr = N.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'
    L.new(_math(nt, 'ADD', _math(nt, 'MULTIPLY', noise.outputs['Fac'], _math(nt, 'ADD', 0.20, _math(nt, 'MULTIPLY', edge, 1.0))),
                _math(nt, 'MULTIPLY', edge, 0.12)), mr.inputs[0])
    L.new(thr, mr.inputs[1])
    L.new(_math(nt, 'ADD', thr, 0.08), mr.inputs[2])
    a = _math(nt, 'MULTIPLY', mr.outputs[0], _math(nt, 'SUBTRACT', 1.0, _math(nt, 'POWER', age, 2.0)))
    a = _math(nt, 'MULTIPLY', a, 0.95)
    emi = N.new('ShaderNodeEmission'); emi.inputs['Color'].default_value = (0.96, 0.99, 1.0, 1); emi.inputs['Strength'].default_value = 1.05
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(a, mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(emi.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    _set_blend(m, 'BLENDED')
    m.use_backface_culling = False
    return m


def _line_material(name='WK_FX_SpeedLine'):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    fade = N.new('ShaderNodeAttribute'); fade.attribute_type = 'GEOMETRY'; fade.attribute_name = 'fx_fade'
    f = fade.outputs['Fac']
    a = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', f, _math(nt, 'SUBTRACT', 1.0, f)), 4.0), 0.75)
    emi = N.new('ShaderNodeEmission'); emi.inputs['Color'].default_value = (1, 1, 1, 1); emi.inputs['Strength'].default_value = 1.3
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(a, mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(emi.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    _set_blend(m, 'BLENDED')
    m.use_backface_culling = False
    return m


# ================================================================ 网格素材
def make_cloud_mesh(name, seed=0, kind='cumulus', voxel=0.045, lumpy=0.05):
    """生成一个单位尺寸（宽约 2、高约 1）的蓬松积云网格：若干球体并集 → 体素重构 → 噪声置换 → 压平底部。"""
    rng = random.Random(seed)
    bm = bmesh.new()
    blobs = []
    if kind == 'cumulus':
        nb = rng.randint(5, 7)
        for i in range(nb):
            x = (i / (nb - 1) - 0.5) * 1.7 + rng.uniform(-0.06, 0.06)
            r = rng.uniform(0.30, 0.42) * (1.0 - 0.35 * abs(x))
            blobs.append((x, rng.uniform(-0.2, 0.2), r * 0.7, r))
        for i in range(rng.randint(4, 6)):
            x = rng.uniform(-0.55, 0.55)
            r = rng.uniform(0.26, 0.40)
            blobs.append((x, rng.uniform(-0.15, 0.15), rng.uniform(0.40, 0.72) * (1.0 - 0.5 * abs(x)) + 0.1, r))
        for i in range(rng.randint(7, 11)):
            a = rng.uniform(0, 2 * math.pi)
            x = 0.8 * math.cos(a) * rng.uniform(0.6, 1.0)
            blobs.append((x, 0.3 * math.sin(a), rng.uniform(0.2, 0.75) * (1.0 - 0.4 * abs(x)), rng.uniform(0.12, 0.22)))
    elif kind == 'bank':            # 云堤：更长更矮，顶部起伏
        nb = rng.randint(8, 11)
        for i in range(nb):
            x = (i / (nb - 1) - 0.5) * 1.9
            r = rng.uniform(0.20, 0.34)
            blobs.append((x, rng.uniform(-0.1, 0.1), r * 0.7, r))
            if rng.random() < 0.75:
                r2 = rng.uniform(0.16, 0.30)
                blobs.append((x + rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), r * 0.9 + r2 * rng.uniform(0.5, 1.3), r2))
            if rng.random() < 0.35:
                r3 = rng.uniform(0.14, 0.24)
                blobs.append((x + rng.uniform(-0.05, 0.05), 0.0, r * 1.2 + r3 * 2.4, r3))
    else:                           # puff：小云团
        for i in range(rng.randint(5, 8)):
            a = rng.uniform(0, 2 * math.pi)
            blobs.append((0.45 * math.cos(a) * rng.uniform(0.3, 1), 0.35 * math.sin(a) * rng.uniform(0.3, 1),
                          rng.uniform(0.25, 0.5), rng.uniform(0.25, 0.4)))
    for (x, y, z, r) in blobs:
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r, matrix=Matrix.Translation((x, y, z)))
    me0 = bpy.data.meshes.new(name + '_src')
    bm.to_mesh(me0)
    bm.free()
    return _remesh_fluffy(name, me0, voxel, lumpy, flat_z=0.12)


def _remesh_fluffy(name, me0, voxel, lumpy, flat_z=None, noise_size=0.28):
    ob = bpy.data.objects.new(name + '_tmp', me0)
    bpy.context.scene.collection.objects.link(ob)
    rm = ob.modifiers.new('rm', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.use_smooth_shade = True
    if lumpy > 0:
        tex = bpy.data.textures.new(name + '_tex', 'CLOUDS')
        tex.noise_scale = noise_size
        tex.noise_depth = 2
        dp = ob.modifiers.new('dp', 'DISPLACE')
        dp.texture = tex
        dp.strength = lumpy
        dp.mid_level = 0.5
        dp.texture_coords = 'LOCAL'
    sm = ob.modifiers.new('sm', 'SMOOTH')
    sm.factor = 0.5
    sm.iterations = 2
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me.name = name
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me0)
    if flat_z is not None:
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(n, 3)
        low = co[:, 2] < flat_z
        co[low, 2] = flat_z + (co[low, 2] - flat_z) * 0.18
        co[:, 2] -= co[:, 2].min()
        me.vertices.foreach_set('co', co.ravel())
    me.shade_smooth()
    me.update()
    return me


def _asset_obj(scene, name, mesh):
    """隐藏的实例源物体。"""
    ob = bpy.data.objects.get(name)
    if ob is None:
        ob = bpy.data.objects.new(name, mesh)
    coll = fx_collection(scene)
    if ob.name not in coll.objects:
        coll.objects.link(ob)
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def _puff_mesh(name='WK_FX_PuffMesh', seed=3, subdiv=3):
    me = bpy.data.meshes.get(name)
    if me is not None:
        return me
    rng = np.random.default_rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=0.5)
    dirs = rng.standard_normal((9, 3))
    dirs /= np.linalg.norm(dirs, axis=1)[:, None]
    for v in bm.verts:
        nrm = np.array(v.co.normalized())
        bump = sum(0.20 * max(0.0, float(nrm @ d)) ** 4 for d in dirs)
        v.co = v.co * (0.82 + bump)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


def _chunk_mesh(name='WK_FX_ChunkMesh', seed=9):
    """碎云团块：几颗球并集后重构，比单个圆球更像云。直径约 1，中心在原点。"""
    me = bpy.data.meshes.get(name)
    if me is not None:
        return me
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.34)
    for i in range(6):
        d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.7, 0.7))).normalized()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rng.uniform(0.17, 0.27),
                                   matrix=Matrix.Translation(d * rng.uniform(0.20, 0.30)))
    me0 = bpy.data.meshes.new(name + '_src')
    bm.to_mesh(me0)
    bm.free()
    return _remesh_fluffy(name, me0, 0.05, 0.05, flat_z=None, noise_size=0.22)


def _petal_mesh(name='WK_FX_PetalMesh'):
    me = bpy.data.meshes.get(name)
    if me is not None:
        return me
    # 花瓣：长 1、最宽 0.62，根部收窄、尖端圆，沿长度和宽度都微微弯曲
    rows = [(0.0, 0.10), (0.25, 0.42), (0.55, 0.62), (0.85, 0.50), (1.0, 0.16)]
    verts, faces = [], []
    for (y, w) in rows:
        for sx in (-1.0, 0.0, 1.0):
            x = sx * w * 0.5
            z = 0.22 * (y - 0.5) ** 2 + 0.10 * abs(sx) - 0.05
            verts.append((x, y - 0.5, z))
    for r in range(len(rows) - 1):
        for c in range(2):
            a = r * 3 + c
            faces.append((a, a + 1, a + 4, a + 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    return me


def _drop_mesh(name='WK_FX_DropMesh'):
    me = bpy.data.meshes.get(name)
    if me is not None:
        return me
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


def _line_mesh(name='WK_FX_LineMesh', w=0.0016):
    me = bpy.data.meshes.get(name)
    if me is not None:
        return me
    verts = [(0, 0, 0), (w, 0, 0.5), (0, 0, 1.0), (-w, 0, 0.5), (0, w, 0.5), (0, -w, 0.5)]
    faces = [(0, 1, 2, 3), (0, 4, 2, 5)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    return me


# ================================================================ 几何节点组
def _particle_group():
    name = 'WK_FX_Particles'
    ng = bpy.data.node_groups.get(name)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    itf = ng.interface
    itf.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    for nm, st, dv in (('Instance', 'NodeSocketObject', None), ('Material', 'NodeSocketMaterial', None),
                       ('FPS', 'NodeSocketFloat', 30.0), ('Gravity', 'NodeSocketFloat', 0.0),
                       ('Drag', 'NodeSocketFloat', 0.5), ('Fade In', 'NodeSocketFloat', 0.08),
                       ('Fade Out', 'NodeSocketFloat', 0.6), ('Grow', 'NodeSocketFloat', 0.0),
                       ('Size Mul', 'NodeSocketFloat', 1.0), ('Cull Dead', 'NodeSocketFloat', 1.0)):
        s = itf.new_socket(nm, in_out='INPUT', socket_type=st)
        if dv is not None:
            s.default_value = dv
            if hasattr(s, 'min_value'):
                s.min_value = -1e6
                s.max_value = 1e6
    itf.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nt = ng
    N, L = ng.nodes, ng.links
    gi = N.new('NodeGroupInput')
    go = N.new('NodeGroupOutput')
    time = N.new('GeometryNodeInputSceneTime')
    born = _attr_in(nt, 'fx_born', 'FLOAT')
    life = _attr_in(nt, 'fx_life', 'FLOAT')
    size = _attr_in(nt, 'fx_size', 'FLOAT')
    spin = _attr_in(nt, 'fx_spin', 'FLOAT')
    rnd = _attr_in(nt, 'fx_rand', 'FLOAT')
    vel = _attr_in(nt, 'fx_vel', 'FLOAT_VECTOR')
    axis = _attr_in(nt, 'fx_axis', 'FLOAT_VECTOR')
    swirl = _attr_in(nt, 'fx_swirl', 'FLOAT_VECTOR')

    age = _math(nt, 'DIVIDE', _math(nt, 'SUBTRACT', time.outputs['Frame'], born), gi.outputs['FPS'])
    u = _math(nt, 'DIVIDE', age, life)
    alive = _math(nt, 'MULTIPLY', _math(nt, 'GREATER_THAN', u, 0.0), _math(nt, 'LESS_THAN', u, 1.0))
    a = _math(nt, 'MAXIMUM', age, 0.0)
    k = _math(nt, 'MAXIMUM', gi.outputs['Drag'], 0.01)
    E = _math(nt, 'EXPONENT', _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', k, a), -1.0))
    D = _math(nt, 'DIVIDE', _math(nt, 'SUBTRACT', 1.0, E), k)
    dv = _vmath(nt, 'SCALE', vel, scale=D).outputs[0]
    gz = _math(nt, 'MULTIPLY', _math(nt, 'DIVIDE', _math(nt, 'SUBTRACT', a, D), k),
               _math(nt, 'MULTIPLY', gi.outputs['Gravity'], -1.0))
    sp = N.new('ShaderNodeSeparateXYZ')
    L.new(swirl, sp.inputs[0])
    amp, freq, phase = sp.outputs[0], sp.outputs[1], sp.outputs[2]
    rampin = _math(nt, 'MINIMUM', _math(nt, 'MULTIPLY', a, 3.0), 1.0)
    ampr = _math(nt, 'MULTIPLY', amp, rampin)
    fa = _math(nt, 'MULTIPLY', freq, a)
    sx = _math(nt, 'MULTIPLY', ampr, _math(nt, 'SINE', _math(nt, 'ADD', fa, phase)))
    sy = _math(nt, 'MULTIPLY', ampr, _math(nt, 'COSINE', _math(nt, 'ADD', _math(nt, 'MULTIPLY', fa, 1.3), _math(nt, 'MULTIPLY', phase, 2.0))))
    sz = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', ampr, 0.5),
               _math(nt, 'SINE', _math(nt, 'ADD', _math(nt, 'MULTIPLY', fa, 0.7), _math(nt, 'MULTIPLY', phase, 3.0))))
    off = _combine(nt, sx, sy, _math(nt, 'ADD', sz, gz))
    total = _vmath(nt, 'ADD', dv, off).outputs[0]
    sp_n = N.new('GeometryNodeSetPosition')
    L.new(gi.outputs['Geometry'], sp_n.inputs['Geometry'])
    L.new(total, sp_n.inputs['Offset'])
    geo = _store(nt, sp_n.outputs['Geometry'], 'fx_fade', _math(nt, 'MINIMUM', _math(nt, 'MAXIMUM', u, 0.0), 1.0))

    env_in = _math(nt, 'MINIMUM', _math(nt, 'DIVIDE', _math(nt, 'MAXIMUM', u, 0.0), _math(nt, 'MAXIMUM', gi.outputs['Fade In'], 0.001)), 1.0)
    mr = N.new('ShaderNodeMapRange')
    mr.interpolation_type = 'SMOOTHSTEP'
    L.new(u, mr.inputs[0])
    L.new(gi.outputs['Fade Out'], mr.inputs[1])
    mr.inputs[2].default_value = 1.0
    mr.inputs[3].default_value = 1.0
    mr.inputs[4].default_value = 0.0
    grow = _math(nt, 'MAXIMUM', _math(nt, 'ADD', 1.0, _math(nt, 'MULTIPLY', gi.outputs['Grow'], u)), 0.0)
    scale = _math(nt, 'MULTIPLY', size, grow)
    scale = _math(nt, 'MULTIPLY', scale, env_in)
    scale = _math(nt, 'MULTIPLY', scale, mr.outputs[0])
    scale = _math(nt, 'MULTIPLY', scale, alive)
    scale = _math(nt, 'MULTIPLY', scale, gi.outputs['Size Mul'])
    rot = N.new('FunctionNodeAxisAngleToRotation')
    L.new(axis, rot.inputs['Axis'])
    L.new(_math(nt, 'ADD', _math(nt, 'MULTIPLY', spin, a), _math(nt, 'MULTIPLY', rnd, 6.2832)), rot.inputs['Angle'])
    oi = N.new('GeometryNodeObjectInfo')
    L.new(gi.outputs['Instance'], oi.inputs['Object'])
    sm = N.new('GeometryNodeSetMaterial')
    L.new(oi.outputs['Geometry'], sm.inputs['Geometry'])
    L.new(gi.outputs['Material'], sm.inputs['Material'])
    iop = N.new('GeometryNodeInstanceOnPoints')
    L.new(geo, iop.inputs['Points'])
    # Cull Dead=1：只在活着的点上生成实例（省几何；代价是粒子自身的形变运动模糊失效，相机运动模糊仍在）
    L.new(_math(nt, 'MAXIMUM', alive, _math(nt, 'SUBTRACT', 1.0, gi.outputs['Cull Dead'])), iop.inputs['Selection'])
    L.new(sm.outputs['Geometry'], iop.inputs['Instance'])
    L.new(rot.outputs['Rotation'], iop.inputs['Rotation'])
    L.new(scale, iop.inputs['Scale'])
    real = N.new('GeometryNodeRealizeInstances')
    L.new(iop.outputs['Instances'], real.inputs['Geometry'])
    L.new(real.outputs['Geometry'], go.inputs['Geometry'])
    return ng


def _ribbon_group():
    name = 'WK_FX_Ribbon'
    ng = bpy.data.node_groups.get(name)
    if ng is not None:
        return ng
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    itf = ng.interface
    itf.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    for nm, st, dv in (('Material', 'NodeSocketMaterial', None), ('FPS', 'NodeSocketFloat', 30.0),
                       ('Life', 'NodeSocketFloat', 2.5), ('Width', 'NodeSocketFloat', 0.6),
                       ('Width Rate', 'NodeSocketFloat', 1.6)):
        s = itf.new_socket(nm, in_out='INPUT', socket_type=st)
        if dv is not None:
            s.default_value = dv
    itf.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    nt = ng
    N, L = ng.nodes, ng.links
    gi = N.new('NodeGroupInput')
    go = N.new('NodeGroupOutput')
    time = N.new('GeometryNodeInputSceneTime')
    born = _attr_in(nt, 'fx_born', 'FLOAT')
    side = _attr_in(nt, 'fx_side', 'FLOAT_VECTOR')
    age = _math(nt, 'DIVIDE', _math(nt, 'SUBTRACT', time.outputs['Frame'], born), gi.outputs['FPS'])
    u = _math(nt, 'DIVIDE', age, gi.outputs['Life'])
    alive = _math(nt, 'MULTIPLY', _math(nt, 'GREATER_THAN', u, 0.0), _math(nt, 'LESS_THAN', u, 1.0))
    a = _math(nt, 'MAXIMUM', age, 0.0)
    w = _math(nt, 'ADD', gi.outputs['Width'], _math(nt, 'MULTIPLY', gi.outputs['Width Rate'], a))
    w = _math(nt, 'MULTIPLY', w, _math(nt, 'MINIMUM', _math(nt, 'MULTIPLY', a, 5.0), 1.0))
    w = _math(nt, 'MULTIPLY', w, alive)
    sp_n = N.new('GeometryNodeSetPosition')
    L.new(gi.outputs['Geometry'], sp_n.inputs['Geometry'])
    L.new(_vmath(nt, 'SCALE', side, scale=w).outputs[0], sp_n.inputs['Offset'])
    geo = _store(nt, sp_n.outputs['Geometry'], 'fx_fade', _math(nt, 'MINIMUM', _math(nt, 'MAXIMUM', u, 0.0), 1.0))
    sm = N.new('GeometryNodeSetMaterial')
    L.new(geo, sm.inputs['Geometry'])
    L.new(gi.outputs['Material'], sm.inputs['Material'])
    L.new(sm.outputs['Geometry'], go.inputs['Geometry'])
    return ng


def _set_mod_input(mod, ident, value):
    """Blender 5.x：mod.properties.inputs.<id>.value；旧版本：mod[<id>]。"""
    props = getattr(mod, 'properties', None)
    if props is not None and hasattr(props, 'inputs'):
        getattr(props.inputs, ident).value = value
    else:
        mod[ident] = value


def _set_mod_inputs(mod, **kw):
    for item in mod.node_group.interface.items_tree:
        if getattr(item, 'in_out', None) == 'INPUT' and item.name in kw:
            _set_mod_input(mod, item.identifier, kw[item.name])


def _mod_input_ident(mod, name):
    for item in mod.node_group.interface.items_tree:
        if getattr(item, 'in_out', None) == 'INPUT' and item.name == name:
            return item.identifier
    raise KeyError(name)


def _mod_input_path(mod, name):
    ident = _mod_input_ident(mod, name)
    props = getattr(mod, 'properties', None)
    if props is not None and hasattr(props, 'inputs'):
        return 'modifiers["%s"].properties.inputs.%s.value' % (mod.name, ident)
    return 'modifiers["%s"]["%s"]' % (mod.name, ident)


# ================================================================ 路径采样
def path_points(path_curve):
    """折线的世界坐标点和累计弧长。"""
    spl = path_curve.data.splines[0]
    mw = path_curve.matrix_world
    if len(spl.points):
        P = np.array([tuple(mw @ Vector(p.co[:3])) for p in spl.points], dtype=np.float64)
    else:
        P = np.array([tuple(mw @ p.co) for p in spl.bezier_points], dtype=np.float64)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    S = np.concatenate([[0.0], np.cumsum(seg)])
    return P, S


def sample_path(P, S, s):
    """按弧长取位置、切向、水平侧向（左手边）。s 可为数组。"""
    s = np.clip(np.asarray(s, dtype=np.float64), 0.0, S[-1] - 1e-6)
    idx = np.clip(np.searchsorted(S, s, side='right') - 1, 0, len(P) - 2)
    seg = np.maximum(S[idx + 1] - S[idx], 1e-9)
    t = ((s - S[idx]) / seg)[:, None]
    pos = P[idx] + (P[idx + 1] - P[idx]) * t
    # 切向做一点平滑（前后各看 2 段）
    i0 = np.clip(idx - 2, 0, len(P) - 1)
    i1 = np.clip(idx + 3, 0, len(P) - 1)
    tan = P[i1] - P[i0]
    tan /= np.maximum(np.linalg.norm(tan, axis=1), 1e-9)[:, None]
    side = np.stack([-tan[:, 1], tan[:, 0], np.zeros(len(tan))], -1)
    side /= np.maximum(np.linalg.norm(side, axis=1), 1e-9)[:, None]
    return pos, tan, side


def _emit_frames(f_start, f_end, rate, fps, rng):
    n = max(1, int(round(rate * (f_end - f_start) / fps)))
    return np.sort(rng.uniform(f_start, f_end, n))


def _make_particles(scene, name, pos, vel, born, life, size, instance_mesh, material, axis=None, spin=None,
                    swirl=None, rnd=None, gravity=0.0, drag=0.5, fade_in=0.08, fade_out=0.6, grow=0.0, fps=None,
                    seed=0):
    rng = np.random.default_rng(seed + 1000)
    n = len(pos)
    fps = fps or scene.render.fps
    me = bpy.data.meshes.new(name)
    me.vertices.add(n)
    me.vertices.foreach_set('co', np.asarray(pos, dtype=np.float32).ravel())
    if axis is None:
        axis = rng.standard_normal((n, 3))
        axis /= np.linalg.norm(axis, axis=1)[:, None]
    if spin is None:
        spin = np.zeros(n)
    if swirl is None:
        swirl = np.zeros((n, 3))
    if rnd is None:
        rnd = rng.random(n)

    def fattr(nm, arr):
        at = me.attributes.new(nm, 'FLOAT', 'POINT')
        at.data.foreach_set('value', np.broadcast_to(np.asarray(arr, dtype=np.float32), (n,)).copy())

    def vattr(nm, arr):
        at = me.attributes.new(nm, 'FLOAT_VECTOR', 'POINT')
        at.data.foreach_set('vector', np.asarray(arr, dtype=np.float32).reshape(n, 3).ravel())

    fattr('fx_born', born); fattr('fx_life', life); fattr('fx_size', size); fattr('fx_spin', spin); fattr('fx_rand', rnd)
    vattr('fx_vel', vel); vattr('fx_axis', axis); vattr('fx_swirl', swirl)
    me.update()
    ob = bpy.data.objects.new(name, me)
    fx_collection(scene).objects.link(ob)
    inst = _asset_obj(scene, instance_mesh.name + '_Obj', instance_mesh)
    mod = ob.modifiers.new('FX_Particles', 'NODES')
    mod.node_group = _particle_group()
    _set_mod_inputs(mod, **{'Instance': inst, 'Material': material, 'FPS': float(fps), 'Gravity': float(gravity),
                            'Drag': float(drag), 'Fade In': float(fade_in), 'Fade Out': float(fade_out),
                            'Grow': float(grow), 'Size Mul': 1.0})
    ob.visible_shadow = False
    return ob


# ================================================================ 特效函数
def add_cloud_trail(scene, path_curve, speed, f_start, f_end, fps=None, path_f0=None, rate=None, spacing=0.6,
                    life=(1.0, 1.5), size=(0.75, 1.15), offset=(-0.9, 0.0, -0.35), seed=1, name='FX_CloudTrail'):
    """筋斗云身后的云团尾迹：云团出生在悟空身后（offset 为相对飞行方向的 前/左/上 偏移），留在世界空间原地，
    1.0~1.5 s 内逐渐变小变淡。"""
    fps = fps or scene.render.fps
    path_f0 = f_start if path_f0 is None else path_f0
    rng = np.random.default_rng(seed)
    P, S = path_points(path_curve)
    if rate is None:
        rate = max(8.0, speed / spacing)          # 按间距（米）换算出生率，速度越快出得越密
    born = _emit_frames(f_start, f_end, rate, fps, rng)
    n = len(born)
    pos, tan, side = sample_path(P, S, speed * (born - path_f0) / fps)
    up = np.array([0.0, 0.0, 1.0])
    pos = pos + tan * offset[0] + side * offset[1] + up * offset[2] + rng.normal(0, 0.16, (n, 3))
    vel = tan * speed * 0.10 + rng.normal(0, 0.55, (n, 3)) + up * 0.35
    lf = rng.uniform(life[0], life[1], n)
    sz = rng.uniform(size[0], size[1], n)
    mat = toon_cloud_material('WK_FX_TrailCloud', lit=(1.0, 0.98, 0.95), mid=(0.93, 0.92, 1.0), shade=(0.74, 0.78, 0.98),
                              soft=True, soft_width=0.30, fade_attr=True, noise_scale=2.2, rim_amt=0.2)
    ob = _make_particles(scene, name, pos, vel, born, lf, sz, _chunk_mesh(), mat, spin=rng.uniform(-0.8, 0.8, n),
                         gravity=-0.25, drag=2.2, fade_in=0.06, fade_out=0.25, grow=-0.70, fps=fps, seed=seed)
    return [ob]


def add_petals(scene, path_curve, speed, f_start, f_end, fps=None, path_f0=None, rate=1200.0, spread=5.0,
               ground_offset=-1.2, big_fraction=0.06, follow_fraction=0.30, colors=((1.0, 0.22, 0.46), (1.0, 0.66, 0.78)),
               seed=2, name='FX_Petals'):
    """贴花田飞行：路径两侧和身后被气流卷起的花瓣。rate=每秒出生数量；spread=横向散布半宽(m)；
    ground_offset=花田表面相对路径的高度（花瓣从这里被卷起）；big_fraction=掠过镜头的大花瓣比例。"""
    fps = fps or scene.render.fps
    path_f0 = f_start if path_f0 is None else path_f0
    rng = np.random.default_rng(seed)
    P, S = path_points(path_curve)
    born = _emit_frames(f_start, f_end, rate, fps, rng)
    n = len(born)
    pos, tan, side = sample_path(P, S, speed * (born - path_f0) / fps)
    up = np.array([0.0, 0.0, 1.0])
    lat = rng.normal(0, spread * 0.42, n)
    pos = pos + side * lat[:, None] + up * (ground_offset * rng.uniform(0.1, 1.0, n))[:, None] + tan * rng.uniform(-1.5, 3.5, n)[:, None]
    # 初速度：被尾流带着往前冲 + 向外翻 + 上扬
    fwd = speed * rng.uniform(0.70, 1.05, n)
    outw = np.sign(lat + 1e-6) * rng.uniform(0.5, 6.0, n)
    upv = rng.uniform(1.0, 6.5, n)
    vel = tan * fwd[:, None] + side * outw[:, None] + up * upv[:, None]
    lf = rng.uniform(1.5, 3.0, n)
    sz = rng.uniform(0.10, 0.20, n)
    big = rng.random(n) < big_fraction
    sz[big] = rng.uniform(0.30, 0.50, big.sum())
    swirl = np.stack([rng.uniform(0.35, 1.2, n), rng.uniform(5.0, 12.0, n), rng.uniform(0, 6.28, n)], -1)
    mat = _flat_fx_material('WK_FX_Petal', colors[0], colors[1], fade_pow=4.0, strength=1.12, shade_amt=0.22)
    ob = _make_particles(scene, name, pos, vel, born, lf, sz, _petal_mesh(), mat, spin=rng.uniform(3.0, 11.0, n) * rng.choice([-1, 1], n),
                         swirl=swirl, gravity=1.6, drag=0.9, fade_in=0.04, fade_out=0.8, grow=0.0, fps=fps, seed=seed)
    # 第二层：跟飞花瓣。几乎和悟空同速、阻力小，围着角色翻飞一阵再慢慢落到身后（镜头里能看清的那批）
    born2 = _emit_frames(f_start, f_end, rate * follow_fraction, fps, rng)
    n2 = len(born2)
    pos2, tan2, side2 = sample_path(P, S, speed * (born2 - path_f0) / fps)
    lat2 = rng.normal(0, spread * 0.30, n2)
    pos2 = pos2 + side2 * lat2[:, None] + up * (ground_offset * rng.uniform(0.0, 1.0, n2))[:, None] + tan2 * rng.uniform(-1.0, 5.0, n2)[:, None]
    vel2 = tan2 * (speed * rng.uniform(0.90, 1.06, n2))[:, None] + side2 * (np.sign(lat2 + 1e-6) * rng.uniform(0.2, 3.5, n2))[:, None] \
        + up * rng.uniform(0.8, 4.5, n2)[:, None]
    sz2 = rng.uniform(0.11, 0.22, n2)
    big2 = rng.random(n2) < big_fraction * 1.5
    sz2[big2] = rng.uniform(0.30, 0.52, big2.sum())
    swirl2 = np.stack([rng.uniform(0.5, 1.5, n2), rng.uniform(4.0, 9.0, n2), rng.uniform(0, 6.28, n2)], -1)
    ob2 = _make_particles(scene, name + '_Follow', pos2, vel2, born2, rng.uniform(1.4, 2.6, n2), sz2, _petal_mesh(), mat,
                          spin=rng.uniform(2.5, 8.0, n2) * rng.choice([-1, 1], n2), swirl=swirl2, gravity=0.9, drag=0.28,
                          fade_in=0.05, fade_out=0.8, grow=0.0, fps=fps, seed=seed + 7)
    return [ob, ob2]


def add_water_spray(scene, path_curve, speed, f_start, f_end, fps=None, path_f0=None, water_z=0.0,
                    rate=700.0, foam_life=2.6, foam_width=0.5, foam_rate=1.5, seed=3, name='FX_Water'):
    """贴水飞行：身后两道 V 形水花帘 + 飞溅水珠 + 水雾 + 水面泡沫尾迹（贴在 water_z+0.02）。"""
    fps = fps or scene.render.fps
    path_f0 = f_start if path_f0 is None else path_f0
    rng = np.random.default_rng(seed)
    P, S = path_points(path_curve)
    up = np.array([0.0, 0.0, 1.0])
    objs = []

    def wpos(b):
        pos, tan, side = sample_path(P, S, speed * (b - path_f0) / fps)
        pos = pos.copy()
        pos[:, 2] = water_z + 0.05
        tan = tan.copy(); tan[:, 2] = 0
        tan /= np.maximum(np.linalg.norm(tan, axis=1), 1e-9)[:, None]
        return pos, tan, side

    # 1) 两道水花帘（密集白色水团，V 形向两侧上方抛出）
    born = _emit_frames(f_start, f_end, rate, fps, rng)
    n = len(born)
    pos, tan, side = wpos(born)
    sgn = rng.choice([-1.0, 1.0], n)
    pos = pos + side * (sgn * rng.uniform(0.15, 0.55, n))[:, None] + tan * rng.uniform(-0.6, 0.2, n)[:, None]
    vel = tan * (speed * rng.uniform(0.25, 0.45, n))[:, None] + side * (sgn * rng.uniform(2.2, 6.0, n))[:, None] + up * rng.uniform(4.5, 10.5, n)[:, None]
    mat_w = _flat_fx_material('WK_FX_Water', (0.90, 0.97, 1.0), (1.0, 1.0, 1.0), fade_pow=2.0, strength=1.05, shade_amt=0.12)
    objs.append(_make_particles(scene, name + '_Curtain', pos, vel, born, rng.uniform(0.6, 1.05, n), rng.uniform(0.14, 0.40, n),
                                _puff_mesh('WK_FX_PuffMeshLo', subdiv=2), mat_w, spin=rng.uniform(-3, 3, n), gravity=17.0, drag=0.7,
                                fade_in=0.05, fade_out=0.40, grow=0.9, fps=fps, seed=seed))
    # 2) 飞溅水珠（小、散得开）
    born = _emit_frames(f_start, f_end, rate * 0.5, fps, rng)
    n = len(born)
    pos, tan, side = wpos(born)
    sgn = rng.choice([-1.0, 1.0], n)
    pos = pos + side * (sgn * rng.uniform(0.1, 0.8, n))[:, None]
    vel = tan * (speed * rng.uniform(0.15, 0.55, n))[:, None] + side * (sgn * rng.uniform(1.0, 10.0, n))[:, None] + up * rng.uniform(4.0, 14.0, n)[:, None]
    objs.append(_make_particles(scene, name + '_Drops', pos, vel, born, rng.uniform(0.6, 1.3, n), rng.uniform(0.05, 0.14, n),
                                _drop_mesh(), mat_w, gravity=17.0, drag=0.5, fade_in=0.02, fade_out=0.7, grow=0.0,
                                fps=fps, seed=seed + 1))
    # 3) 水雾（大而淡）
    born = _emit_frames(f_start, f_end, 34.0, fps, rng)
    n = len(born)
    pos, tan, side = wpos(born)
    pos = pos + side * rng.normal(0, 0.5, n)[:, None] + up * 0.3
    vel = tan * (speed * rng.uniform(0.10, 0.22, n))[:, None] + side * rng.normal(0, 1.2, n)[:, None] + up * rng.uniform(0.8, 2.6, n)[:, None]
    mat_m = toon_cloud_material('WK_FX_Mist', lit=(1.0, 1.0, 1.0), mid=(0.90, 0.96, 1.0), shade=(0.78, 0.88, 1.0),
                                soft=True, soft_width=0.55, fade_attr=True, alpha=0.32, noise_scale=2.0, rim_amt=0.1)
    objs.append(_make_particles(scene, name + '_Mist', pos, vel, born, rng.uniform(0.9, 1.5, n), rng.uniform(0.9, 1.7, n),
                                _puff_mesh(), mat_m, spin=rng.uniform(-0.6, 0.6, n), gravity=0.0, drag=1.8,
                                fade_in=0.10, fade_out=0.2, grow=0.8, fps=fps, seed=seed + 2))
    # 4) 泡沫尾迹：沿路径的带状网格，宽度随年龄变宽，材质随年龄被“吃掉”
    s0 = max(0.0, speed * (f_start - path_f0) / fps)
    s1 = min(S[-1], speed * (f_end - path_f0) / fps)
    ns = max(2, int((s1 - s0) / 1.0) + 1)
    ss = np.linspace(s0, s1, ns)
    pos, tan, side = sample_path(P, S, ss)
    pos = pos.copy(); pos[:, 2] = water_z + 0.02
    bornf = path_f0 + ss / speed * fps
    verts = np.concatenate([pos, pos, pos], 0)                 # 左、中、右三排（初始都在中线上，由节点撑开）
    sidev = np.concatenate([side, np.zeros_like(side), -side], 0)
    uv = np.concatenate([np.stack([ss, np.full(ns, v), np.zeros(ns)], -1) for v in (0.0, 0.5, 1.0)], 0)
    faces = []
    for r in range(2):
        for i in range(ns - 1):
            a = r * ns + i
            faces.append((a, a + 1, a + ns + 1, a + ns))
    me = bpy.data.meshes.new(name + '_Foam')
    me.from_pydata([tuple(v) for v in verts], [], faces)
    at = me.attributes.new('fx_born', 'FLOAT', 'POINT'); at.data.foreach_set('value', np.tile(bornf, 3).astype(np.float32))
    at = me.attributes.new('fx_side', 'FLOAT_VECTOR', 'POINT'); at.data.foreach_set('vector', sidev.astype(np.float32).ravel())
    at = me.attributes.new('fx_uv', 'FLOAT_VECTOR', 'POINT'); at.data.foreach_set('vector', uv.astype(np.float32).ravel())
    foam = bpy.data.objects.new(name + '_Foam', me)
    fx_collection(scene).objects.link(foam)
    mod = foam.modifiers.new('FX_Ribbon', 'NODES')
    mod.node_group = _ribbon_group()
    _set_mod_inputs(mod, **{'Material': _foam_material(), 'FPS': float(fps), 'Life': float(foam_life),
                            'Width': float(foam_width), 'Width Rate': float(foam_rate)})
    foam.visible_shadow = False
    objs.append(foam)
    return objs


def add_speed_lines(scene, camera, f_start, f_end, intensity=1.0, fps=None, rate=110.0, toward_center=True,
                    seed=4, name='FX_SpeedLines'):
    """挂在相机上的白色速度线。intensity 可以是数字，也可以是 [(帧, 强度), ...] 关键帧列表（0=无，1=正常，>1 更粗更长）。
    toward_center=True：线从画面四周向画面中心方向掠去；False：从中心向四周掠出。"""
    fps = fps or scene.render.fps
    rng = np.random.default_rng(seed)
    born = _emit_frames(f_start - 10, f_end, rate, fps, rng)
    n = len(born)
    ang = rng.uniform(0, 2 * math.pi, n)
    rad = rng.uniform(1.3, 4.2, n)
    x = np.cos(ang) * rad * 1.55
    y = np.sin(ang) * rad
    spd = rng.uniform(95.0, 170.0, n)
    lf = rng.uniform(0.22, 0.42, n)
    if toward_center:
        z = -rng.uniform(1.5, 5.0, n)
        vel = np.stack([np.zeros(n), np.zeros(n), -spd], -1)
    else:
        z = -rng.uniform(1.5, 5.0, n) - spd * lf
        vel = np.stack([np.zeros(n), np.zeros(n), spd], -1)
    pos = np.stack([x, y, z], -1)
    sz = rng.uniform(5.0, 11.0, n)
    axis = np.tile(np.array([[0.0, 0.0, 1.0]]), (n, 1))
    ob = _make_particles(scene, name, pos, vel, born, lf, sz, _line_mesh(), _line_material(), axis=axis,
                         gravity=0.0, drag=0.01, fade_in=0.05, fade_out=0.9, grow=0.0, fps=fps, seed=seed)
    # 线的网格沿 +Z 长 1；向 -Z 飞时让“尾巴”留在相机一侧
    ob.parent = camera
    ob.matrix_parent_inverse = Matrix.Identity(4)
    mod = ob.modifiers['FX_Particles']
    dp = _mod_input_path(mod, 'Size Mul')
    ident = _mod_input_ident(mod, 'Size Mul')
    if isinstance(intensity, (int, float)):
        _set_mod_input(mod, ident, float(intensity))
    else:
        for (f, v) in intensity:
            _set_mod_input(mod, ident, float(v))
            ob.keyframe_insert(data_path=dp, frame=f)
    return [ob]


def add_cloud_burst(scene, position, frame, direction=(0.0, 0.0, 1.0), radius=28.0, count=60, chunk=(3.0, 10.0),
                    fps=None, seed=5, name='FX_CloudBurst'):
    """穿云瞬间：云团被冲开，一圈碎云沿垂直于 direction 的平面向外炸开并很快变小消散。
    position=穿出点；frame=穿出帧；radius=碎云最终散开的大致半径(m)；chunk=碎云尺寸范围(m)。"""
    fps = fps or scene.render.fps
    rng = np.random.default_rng(seed)
    d = np.array(direction, dtype=np.float64)
    d /= np.linalg.norm(d)
    ref = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(d, ref); e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    n = count
    ang = rng.uniform(0, 2 * math.pi, n)
    radial = np.cos(ang)[:, None] * e1 + np.sin(ang)[:, None] * e2
    drag = 2.6
    pos = np.array(position)[None, :] + radial * rng.uniform(0.5, radius * 0.18, n)[:, None] + d[None, :] * rng.uniform(-2.0, 2.0, n)[:, None]
    vel = radial * (drag * radius * rng.uniform(0.55, 1.25, n))[:, None] + d[None, :] * (drag * radius * rng.uniform(-0.1, 0.55, n))[:, None]
    born = frame + rng.uniform(-1.0, 2.0, n)
    mat = toon_cloud_material('WK_FX_BurstCloud', soft=True, soft_width=0.28, fade_attr=True, noise_scale=1.2, rim_amt=0.25)
    ob = _make_particles(scene, name, pos, vel, born, rng.uniform(0.9, 1.6, n), rng.uniform(chunk[0], chunk[1], n),
                         _chunk_mesh(), mat, spin=rng.uniform(-1.5, 1.5, n), gravity=0.0, drag=drag,
                         fade_in=0.04, fade_out=0.35, grow=-0.5, fps=fps, seed=seed)
    return [ob]
