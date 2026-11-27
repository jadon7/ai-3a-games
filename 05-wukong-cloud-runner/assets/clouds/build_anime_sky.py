"""二次元天空 SKY + 筋斗云 JDY（EEVEE）。运行：Blender -b -P build_anime_sky.py
生成 assets/clouds/clouds.blend，集合 "SKY" 和 "JDY"。
世界：江沿 +X，x∈[-1500,1500]，水面 z=0。太阳方向 scene_common.A_SUN_DIR。
注意：天穹半径 20 km，相机 clip_end 需 ≥ 30000。
"""
import bpy, bmesh, sys, os, math, random
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
sys.path.insert(0, os.path.join(ROOT, 'assets', 'fx'))
import scene_common as sc
import fx_lib
from fx_lib import _math, _vmath, _mix_color, _set_blend

SUN = tuple(sc.A_SUN_DIR)
ZENITH = sc.A_SKY_ZENITH
HORIZON = sc.A_SKY_HORIZON


def coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


# ---------------------------------------------------------------- 天穹
def sky_material():
    m = bpy.data.materials.new('WK_SkyDome')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    geo = N.new('ShaderNodeNewGeometry')
    d = _vmath(nt, 'NORMALIZE', geo.outputs['Position']).outputs[0]
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(d, sep.inputs[0])
    z = sep.outputs['Z']
    t = _math(nt, 'POWER', _math(nt, 'MINIMUM', _math(nt, 'MAXIMUM', z, 0.0), 1.0), 0.36)
    col = _mix_color(nt, t, HORIZON, ZENITH)
    # 地平线附近一条发白的雾带（上下都有）
    band = _math(nt, 'MULTIPLY', _math(nt, 'EXPONENT', _math(nt, 'MULTIPLY', _math(nt, 'ABSOLUTE', z), -16.0)), 0.50)
    col = _mix_color(nt, band, col, (0.80, 0.91, 1.0))
    # 太阳光晕：小而亮的核 + 两层柔和的晕
    sd = _math(nt, 'MAXIMUM', _vmath(nt, 'DOT_PRODUCT', d, SUN).outputs['Value'], 0.0)
    g = _math(nt, 'ADD', _math(nt, 'MULTIPLY', _math(nt, 'POWER', sd, 900.0), 1.2),
              _math(nt, 'ADD', _math(nt, 'MULTIPLY', _math(nt, 'POWER', sd, 40.0), 0.30),
                    _math(nt, 'MULTIPLY', _math(nt, 'POWER', sd, 5.0), 0.10)))
    glow = _vmath(nt, 'SCALE', (1.0, 0.96, 0.82), scale=g).outputs[0]
    fin = _vmath(nt, 'ADD', col, glow).outputs[0]
    emi = N.new('ShaderNodeEmission')
    L.new(fin, emi.inputs['Color'])
    L.new(emi.outputs[0], out.inputs['Surface'])
    m.use_backface_culling = False
    return m


def cirrus_material():
    m = bpy.data.materials.new('WK_Cirrus')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.8, 3.2, 1.0)           # 沿长边拉丝
    L.new(tc.outputs['Generated'], mp.inputs['Vector'])
    n1 = N.new('ShaderNodeTexNoise')
    n1.inputs['Scale'].default_value = 1.8
    n1.inputs['Detail'].default_value = 3.0
    n1.inputs['Distortion'].default_value = 0.6
    L.new(mp.outputs['Vector'], n1.inputs['Vector'])
    mr = N.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'
    mr.inputs[1].default_value = 0.40; mr.inputs[2].default_value = 0.82
    L.new(n1.outputs['Fac'], mr.inputs[0])
    sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Generated'], sep.inputs[0])
    u, v = sep.outputs['X'], sep.outputs['Y']
    fu = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', u, _math(nt, 'SUBTRACT', 1.0, u)), 4.0)
    fv = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', v, _math(nt, 'SUBTRACT', 1.0, v)), 4.0)
    edge = _math(nt, 'POWER', _math(nt, 'MULTIPLY', fu, fv), 1.3)
    a = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', mr.outputs[0], edge), 0.55)
    emi = N.new('ShaderNodeEmission'); emi.inputs['Color'].default_value = (0.96, 0.98, 1.0, 1)
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(a, mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(emi.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    _set_blend(m, 'BLENDED')
    m.use_backface_culling = False
    return m


def build_sky(SKY):
    rng = random.Random(5)
    # ---- 天穹
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=20000.0)
    me = bpy.data.meshes.new('Sky_Dome'); bm.to_mesh(me); bm.free(); me.shade_smooth()
    dome = bpy.data.objects.new('Sky_Dome', me); SKY.objects.link(dome)
    me.materials.append(sky_material())
    dome.visible_shadow = False

    # ---- 云网格库
    cum = [fx_lib.make_cloud_mesh('Cloud_Cumulus_%d' % i, seed=40 + i, kind='cumulus') for i in range(5)]
    bank = [fx_lib.make_cloud_mesh('Cloud_Bank_%d' % i, seed=60 + i, kind='bank', voxel=0.035, lumpy=0.035) for i in range(3)]
    puff = [fx_lib.make_cloud_mesh('Cloud_Puff_%d' % i, seed=80 + i, kind='puff') for i in range(2)]
    m_near = fx_lib.toon_cloud_material('WK_Cloud', lit=(0.95, 0.90, 0.79), mid=(0.68, 0.75, 0.96), shade=(0.42, 0.47, 0.84),
                                        soft=True, soft_width=0.20, noise_scale=3.2, rim_amt=0.25, thresholds=(0.46, 0.58, 0.71))
    m_far = fx_lib.toon_cloud_material('WK_Cloud_Far', lit=(0.93, 0.94, 0.95), mid=(0.62, 0.74, 0.96), shade=(0.40, 0.53, 0.88),
                                       soft=True, soft_width=0.16, noise_scale=3.0, rim_amt=0.15, normal_noise=0.7, top_bias=0.55, thresholds=(0.47, 0.60, 0.74))
    for me_ in cum + puff:
        me_.materials.append(m_near)
    for me_ in bank:
        me_.materials.append(m_far)
    # 远处用的积云副本（偏蓝、对比低）
    cum_far = []
    for me_ in cum[:3]:
        c = me_.copy(); c.name = me_.name + '_Far'; c.materials.clear(); c.materials.append(m_far); cum_far.append(c)

    def place(mesh, name, loc, width, hs=1.0, ds=1.0, rot=0.0):
        ob = bpy.data.objects.new(name, mesh)
        s = width / 2.0
        ob.location = loc
        ob.scale = (s, s * ds, s * hs)
        ob.rotation_euler = (0.0, 0.0, rot)
        ob.visible_shadow = False
        SKY.objects.link(ob)
        return ob

    # (b) 地平线一圈大云堤：两层，内圈低矮连绵，外圈高耸
    n = 26
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.06, 0.06)
        r = rng.uniform(12500, 15500)
        w = rng.uniform(4200, 6500)
        place(rng.choice(bank), 'Cloud_BankRing_%02d' % i, (r * math.cos(a), r * math.sin(a), rng.uniform(-350, 150)),
              w, hs=rng.uniform(0.95, 1.45), ds=1.2, rot=a + math.pi / 2 + rng.uniform(-0.2, 0.2))
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.2, 0.2)
        r = rng.uniform(9000, 11500)
        place(rng.choice(cum_far), 'Cloud_FarCumulus_%02d' % i, (r * math.cos(a), r * math.sin(a), rng.uniform(300, 1500)),
              rng.uniform(1800, 3200), hs=rng.uniform(0.9, 1.3), rot=a + math.pi / 2 + rng.uniform(-0.4, 0.4))
    # 中景漂浮积云
    for i in range(12):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(3200, 7500)
        place(rng.choice(cum), 'Cloud_Mid_%02d' % i, (r * math.cos(a), r * math.sin(a), rng.uniform(650, 1700)),
              rng.uniform(500, 1300), hs=rng.uniform(0.9, 1.25), rot=rng.uniform(0, 6.28))
    # (c) 起点区峰林之间的低云团
    for i in range(9):
        place(rng.choice(puff + cum), 'Cloud_StartLow_%02d' % i,
              (rng.uniform(-1500, -900), rng.uniform(-420, 420), rng.uniform(105, 160)),
              rng.uniform(70, 160), hs=rng.uniform(0.6, 0.9), rot=rng.uniform(0, 6.28))
    # (d) 终点上空的大积云；其中一朵正好在 (1330, 60, 420)，悟空垂直穿过
    w = 190.0
    place(cum[1], 'Cloud_PassThrough', (1330.0, 60.0, 420.0 - 0.47 * w / 2.0), w, hs=1.0, rot=0.6)
    for i, (x, y, z, w) in enumerate(((1190, -260, 300, 240), (1460, 330, 520, 300), (1250, 420, 640, 260),
                                      (1480, -180, 660, 320), (1100, 160, 560, 200), (1600, 60, 330, 280))):
        place(cum[(i + 2) % 5], 'Cloud_End_%02d' % i, (x, y, z), w, hs=rng.uniform(0.9, 1.2), rot=rng.uniform(0, 6.28))

    # 高空卷云（半透明面片）
    cm = cirrus_material()
    for i in range(7):
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
        me = bpy.data.meshes.new('Cirrus_%d' % i); bm.to_mesh(me); bm.free()
        me.materials.append(cm)
        ob = bpy.data.objects.new('Cirrus_%d' % i, me)
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(2500, 11000)
        ob.location = (r * math.cos(a), r * math.sin(a), rng.uniform(5200, 7500))
        ob.scale = (rng.uniform(7000, 12000), rng.uniform(1400, 2600), 1.0)
        ob.rotation_euler = (rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0.45 + rng.uniform(-0.3, 0.3))
        ob.visible_shadow = False
        SKY.objects.link(ob)


# ---------------------------------------------------------------- 筋斗云
def build_jdy(JDY):
    rng = random.Random(21)
    bm = bmesh.new()

    def ball(x, y, z, r, sz=1.0):
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=r,
                                   matrix=Matrix.Translation((x, y, z)) @ Matrix.Diagonal((1.0, 1.0, sz, 1.0)))

    # 扁平的主体（顶面 z≈0，给悟空站/坐）
    ball(0.15, 0.0, -0.38, 0.58, 0.62)
    ball(-0.42, 0.0, -0.38, 0.50, 0.62)
    ball(0.62, 0.0, -0.38, 0.42, 0.68)
    # 外圈鼓包
    n = 11
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.12, 0.12)
        ball(0.10 + 1.00 * math.cos(a), 0.58 * math.sin(a), -0.30 + rng.uniform(-0.06, 0.04), rng.uniform(0.20, 0.28), 0.9)
    for i in range(6):
        ball(rng.uniform(-0.8, 0.8), rng.uniform(-0.38, 0.38), -0.60, rng.uniform(0.20, 0.27), 0.8)
    # 向后收细并上翘的尾巴
    for (x, y, z, r) in ((-1.02, 0.0, -0.36, 0.25), (-1.26, 0.02, -0.33, 0.19), (-1.44, 0.0, -0.27, 0.145),
                         (-1.56, -0.02, -0.19, 0.11), (-1.62, -0.03, -0.10, 0.08), (-1.61, -0.03, -0.03, 0.06)):
        ball(x, y, z, r)
    # 祥云卷：两侧各一个竖直面内的螺旋（由一串小球连成）
    for sy in (-1.0, 1.0):
        cx, cy, cz = 0.60, sy * 0.80, -0.36
        turns, nseg = 1.55, 46
        for j in range(nseg):
            t = j / (nseg - 1)
            ang = math.pi * 0.9 + t * turns * 2 * math.pi
            rad = 0.30 * (1.0 - 0.80 * t)
            ball(cx + rad * math.cos(ang), cy, cz + rad * math.sin(ang), 0.058 * (1.0 - 0.30 * t))
    me0 = bpy.data.meshes.new('JDY_src'); bm.to_mesh(me0); bm.free()
    me = fx_lib._remesh_fluffy('JDY_BodyMesh', me0, 0.02, 0.0, flat_z=None)
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(nv, 3)
    top = co[:, 2] > -0.04
    co[top, 2] = -0.04 + (co[top, 2] + 0.04) * 0.30           # 顶面压平，保留一点起伏
    me.vertices.foreach_set('co', co.ravel()); me.update()
    print('JDY bounds', co.min(0), co.max(0), 'verts', nv, flush=True)

    root = bpy.data.objects.new('JDY_ROOT', None); root.empty_display_size = 0.8; JDY.objects.link(root)
    body = bpy.data.objects.new('JDY_Body', me); JDY.objects.link(body); body.parent = root
    ctl = bpy.data.objects.new('JDY_NoiseCtl', None); ctl.empty_display_size = 0.2; JDY.objects.link(ctl); ctl.parent = root
    m_body = fx_lib.toon_cloud_material('WK_JDY', lit=(0.94, 0.85, 0.66), mid=(0.93, 0.68, 0.52), shade=(0.78, 0.47, 0.56),
                                        rim=(1.0, 0.93, 0.62), rim_amt=0.55, soft=False, noise_scale=2.6,
                                        normal_noise=0.55, top_bias=0.45, thresholds=(0.52, 0.70, 0.88))
    m_line = bpy.data.materials.new('WK_JDY_Outline'); m_line.use_nodes = True
    nt = m_line.node_tree; nt.nodes.clear()
    o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (0.80, 0.42, 0.34, 1.0)
    nt.links.new(e.outputs[0], o.inputs['Surface'])
    m_line.use_backface_culling = True
    me.materials.append(m_body); me.materials.append(m_line)
    # 团块翻滚：置换纹理的坐标跟着一个绕圈运动的空物体走（240 帧一圈，可循环）
    tex = bpy.data.textures.new('JDY_Noise', 'CLOUDS'); tex.noise_scale = 0.38; tex.noise_depth = 1
    dp = body.modifiers.new('Roll', 'DISPLACE')
    dp.texture = tex; dp.strength = 0.075; dp.mid_level = 0.5
    dp.texture_coords = 'OBJECT'; dp.texture_coords_object = ctl
    sol = body.modifiers.new('Outline', 'SOLIDIFY')
    sol.thickness = 0.014; sol.offset = 1.0; sol.use_flip_normals = True; sol.material_offset = 1
    sol.use_rim = False
    for f in range(1, 962, 6):
        ph = 2 * math.pi * (f - 1) / 240.0
        ctl.location = (0.30 * math.cos(ph), 0.30 * math.sin(ph), 0.14 * math.sin(2 * ph))
        ctl.keyframe_insert('location', frame=f)
    # 呼吸：60 帧一个周期（顶面 z=0 不动）
    for f in range(1, 962, 15):
        k = 0.5 - 0.5 * math.cos(2 * math.pi * (f - 1) / 60.0)
        body.scale = (1.0 + 0.030 * k, 1.0 + 0.030 * k, 1.0 - 0.055 * k)
        body.keyframe_insert('scale', frame=f)
    body.visible_shadow = True


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    sc.setup_anime(scene)
    scene.frame_start, scene.frame_end = 1, 240
    SKY = coll('SKY'); JDY = coll('JDY')
    build_sky(SKY)
    build_jdy(JDY)
    # 清掉 fx_lib 临时建的 FX 集合（云网格生成时不会建，这里只是保险）
    pt = bpy.data.objects['Cloud_PassThrough']
    bpy.context.view_layer.update()
    bb = [pt.matrix_world @ Vector(c) for c in pt.bound_box]
    lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    print('PassThrough bbox', tuple(round(v, 1) for v in lo), tuple(round(v, 1) for v in hi), 'center', tuple(round(v, 1) for v in (lo + hi) / 2), flush=True)
    out = os.path.join(HERE, 'clouds.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print('saved', out, flush=True)


if __name__ == '__main__':
    build()
