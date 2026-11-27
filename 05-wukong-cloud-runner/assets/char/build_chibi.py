"""Q 版悟空（二次元风）程序化建模 + 卡通着色 + 无状态的程序化动画。
用法：Blender -b -P build_chibi.py            （生成 assets/char/chibi.blend 和四视图预览）
约定：面朝 +X，脚底 z=0（站在筋斗云顶面），根物体 WK_ROOT，集合 WUKONG。
"""
import bpy, bmesh, sys, os, math, random
import numpy as np
from mathutils import Vector, Matrix, Euler
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'common'))
import scene_common as sc

random.seed(7)


def srgb(hexstr, a=1.0):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


PAL = dict(
    fur='#F5A742', fur_sh='#D9782E',
    skin='#FFE0C6', skin_sh='#F7BDA0',
    muzzle='#FFEBD8', muzzle_sh='#F7C9AC',
    blush='#FF9AA0',
    eye='#2A1408', iris='#F7A928', white='#FFFFFF',
    gold='#FFD552', gold_sh='#EBA52E',
    red='#EE3A30', red_sh='#B8242E',
    tiger='#F5A533', tiger_sh='#CF7A22', stripe='#4A2410',
    boot='#8A2424', boot_sh='#5A1414',
    staff='#D8281E', staff_sh='#9A1820',
    feather_w='#FFF4E6',
    outline='#3A1A12',
)

MATS = {}


def toon_mat(name, base, shade, rim=0.35, edge=(0.74, 0.90), spec=0.0, attr_mix=None, emit_boost=1.0):
    """卡通材质：漫反射 -> ShaderToRGB -> 两段色阶；可选按顶点色属性在两套颜色间混合。
    attr_mix = (属性名, base2, shade2) 时，属性值=1 的区域用第二套颜色。"""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    dif.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = edge[0]
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = edge[1]
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(s2r.outputs['Color'], ramp.inputs['Fac'])

    def two(c_base, c_shade):
        mix = nt.nodes.new('ShaderNodeMixRGB')
        mix.inputs['Color1'].default_value = c_shade
        mix.inputs['Color2'].default_value = c_base
        nt.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
        return mix.outputs['Color']

    col = two(srgb(base), srgb(shade))
    if attr_mix:
        an = nt.nodes.new('ShaderNodeAttribute')
        an.attribute_name = attr_mix[0]
        col2 = two(srgb(attr_mix[1]), srgb(attr_mix[2]))
        sharp = nt.nodes.new('ShaderNodeMapRange')
        sharp.inputs['From Min'].default_value = 0.47
        sharp.inputs['From Max'].default_value = 0.53
        sharp.clamp = True
        nt.links.new(an.outputs['Fac'], sharp.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeMixRGB')
        nt.links.new(sharp.outputs['Result'], mx.inputs['Fac'])
        nt.links.new(col, mx.inputs['Color1'])
        nt.links.new(col2, mx.inputs['Color2'])
        col = mx.outputs['Color']
    # 边缘亮边
    if rim > 0:
        lw = nt.nodes.new('ShaderNodeLayerWeight')
        lw.inputs['Blend'].default_value = 0.22
        rr = nt.nodes.new('ShaderNodeMapRange')
        rr.inputs['From Min'].default_value = 0.55
        rr.inputs['From Max'].default_value = 0.75
        rr.inputs['To Max'].default_value = rim
        rr.clamp = True
        nt.links.new(lw.outputs['Facing'], rr.inputs['Value'])
        # 亮边只出现在受光侧
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        nt.links.new(rr.outputs['Result'], mul.inputs[0])
        nt.links.new(ramp.outputs['Color'], mul.inputs[1])
        add = nt.nodes.new('ShaderNodeMixRGB'); add.blend_type = 'ADD'
        add.inputs['Color2'].default_value = (1.0, 0.92, 0.75, 1)
        nt.links.new(mul.outputs[0], add.inputs['Fac'])
        nt.links.new(col, add.inputs['Color1'])
        col = add.outputs['Color']
    if spec > 0:
        gl = nt.nodes.new('ShaderNodeBsdfGlossy'); gl.inputs['Roughness'].default_value = 0.25
        s2 = nt.nodes.new('ShaderNodeShaderToRGB')
        nt.links.new(gl.outputs[0], s2.inputs[0])
        sr = nt.nodes.new('ShaderNodeMapRange')
        sr.inputs['From Min'].default_value = 0.6; sr.inputs['From Max'].default_value = 0.8
        sr.inputs['To Max'].default_value = spec; sr.clamp = True
        nt.links.new(s2.outputs['Color'], sr.inputs['Value'])
        add2 = nt.nodes.new('ShaderNodeMixRGB'); add2.blend_type = 'ADD'
        add2.inputs['Color2'].default_value = (1, 1, 0.9, 1)
        nt.links.new(sr.outputs['Result'], add2.inputs['Fac'])
        nt.links.new(col, add2.inputs['Color1'])
        col = add2.outputs['Color']
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = emit_boost
    nt.links.new(col, em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    MATS[name] = m
    return m


def flat_mat(name, color, strength=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = srgb(color)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    MATS[name] = m
    return m


def outline_mat():
    m = flat_mat('WK_Outline', PAL['outline'])
    m.use_backface_culling = True
    return m


COL = None
ALL = []


def new_obj(name, me, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = rot
    ALL.append(ob)
    return ob


def empty(name, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.08
    COL.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def finish(me, mat, outline=0.0, smooth=True):
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    return me


def add_outline(ob, thick=0.011):
    ob.data.materials.append(outline_mat())
    md = ob.modifiers.new('Outline', 'SOLIDIFY')
    md.thickness = thick
    md.offset = 1.0
    md.use_flip_normals = True
    md.use_rim = False
    md.material_offset = len(ob.data.materials) - 1
    md.use_quality_normals = True


def ellipsoid(name, radii, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), segs=40, rings=20, outline=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    finish(me, mat)
    ob = new_obj(name, me, parent, loc, rot)
    if outline:
        add_outline(ob, outline)
    return ob


def cone(name, r, h, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), segs=14, outline=0.0, bend=0.0):
    """圆润的毛簇：底在原点，尖朝 +Z。"""
    bm = bmesh.new()
    n = 8
    rings = []
    for i in range(n + 1):
        t = i / n
        rr = r * (1 - t) ** 0.75
        z = h * t
        bx = bend * h * t * t
        if i == n:
            rings.append([bm.verts.new((bx, 0, z))])
        else:
            rings.append([bm.verts.new((bx + rr * math.cos(2 * math.pi * k / segs), rr * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)])
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    a = rings[n - 1]; tip = rings[n][0]
    for k in range(segs):
        bm.faces.new((a[k], a[(k + 1) % segs], tip))
    bm.faces.new(rings[0][::-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    finish(me, mat)
    ob = new_obj(name, me, parent, loc, rot)
    if outline:
        add_outline(ob, outline)
    return ob


def torus(name, R, r, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), sM=48, sm=12, arc=1.0, outline=0.0, squash=1.0):
    bm = bmesh.new()
    rings = []
    nM = sM if arc >= 1.0 else int(sM * arc) + 1
    for i in range(nM):
        a = 2 * math.pi * arc * i / (sM * arc if arc < 1.0 else sM)
        ring = []
        for k in range(sm):
            b = 2 * math.pi * k / sm
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a) * squash
            z = r * math.sin(b)
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)
    cnt = nM if arc >= 1.0 else nM - 1
    for i in range(cnt):
        a, b = rings[i], rings[(i + 1) % nM]
        for k in range(sm):
            bm.faces.new((a[k], b[k], b[(k + 1) % sm], a[(k + 1) % sm]))
    if arc < 1.0:
        bm.faces.new(rings[0]); bm.faces.new(rings[-1][::-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    finish(me, mat)
    ob = new_obj(name, me, parent, loc, rot)
    if outline:
        add_outline(ob, outline)
    return ob


def tube(name, pts, radii, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), segs=12, outline=0.0, weight_group=None):
    """沿折线的圆管（末端收尖）。weight_group：按沿程 0→1 写入顶点组（给 Wave 修改器用）。"""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    up = Vector((0, 0, 1))
    wts = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(up)
        if side.length < 1e-4:
            side = t.cross(Vector((0, 1, 0)))
        side.normalize()
        up2 = side.cross(t).normalized()
        ring = [bm.verts.new(p + (side * math.cos(2 * math.pi * k / segs) + up2 * math.sin(2 * math.pi * k / segs)) * radii[i]) for k in range(segs)]
        rings.append(ring)
        wts.append(i / (len(pts) - 1))
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    finish(me, mat)
    ob = new_obj(name, me, parent, loc, rot)
    if weight_group:
        vg = ob.vertex_groups.new(name=weight_group)
        for i in range(len(rings)):
            vg.add(list(range(i * segs, (i + 1) * segs)), wts[i] ** 1.3, 'REPLACE')
    if outline:
        add_outline(ob, outline)
    return ob


def ribbon(name, length, w0, w1, mat, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), n=40, nw=4, arc=0.0, outline=0.0,
           split=0.0, thickness=0.006, droop=0.0):
    """沿 -X 延伸的飘带（平放在 XY 平面，法线 +Z）。arc：整体向上弯的弧度；split：尾端开叉比例。
    顶点组 'tip'：根部 0 → 末端 1。UV.x 沿长度。"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    grid = []
    for i in range(n + 1):
        t = i / n
        w = w0 + (w1 - w0) * t
        # 末端收尖
        w *= (1 - max(0.0, (t - 0.88) / 0.12) ** 2 * 0.85)
        ang = arc * t
        if abs(arc) > 1e-5:
            R = length / arc
            x = -R * math.sin(ang)
            z = R * (1 - math.cos(ang))
        else:
            x, z = -length * t, 0.0
        row = []
        for j in range(nw + 1):
            s = j / nw - 0.5
            y = s * w
            zz = z - droop * w * (2 * s) ** 2 * (0.35 + 0.65 * t)
            if split > 0 and t > 1 - split:
                # 开叉：中间收拢成 V 形缺口
                k = (t - (1 - split)) / split
                y = s * w + (0.25 * w * k) * (1 if s > 0 else -1 if s < 0 else 0)
            row.append(bm.verts.new((x, y, zz)))
        grid.append(row)
    for i in range(n):
        for j in range(nw):
            f = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uvl].uv = (ii / n, jj / nw)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    finish(me, mat)
    ob = new_obj(name, me, parent, loc, rot)
    vg = ob.vertex_groups.new(name='tip')
    idx = 0
    for i in range(n + 1):
        for j in range(nw + 1):
            vg.add([idx], (i / n) ** 1.4, 'REPLACE')
            idx += 1
    sd = ob.modifiers.new('Thick', 'SOLIDIFY'); sd.thickness = thickness; sd.offset = 0
    if outline:
        add_outline(ob, outline)
    return ob


def add_wave(ob, height, width, speed, narrow=None, offset=0.0, group='tip', name='Wave'):
    md = ob.modifiers.new(name, 'WAVE')
    md.use_x = True; md.use_y = False
    md.use_cyclic = True
    md.height = height
    md.width = width
    md.narrowness = narrow if narrow is not None else 2.0 / width
    md.speed = speed
    md.time_offset = offset
    md.vertex_group = group
    md.use_normal = True
    # 让 Wave 排在描边/加厚之前
    while ob.modifiers.find(md.name) > 0:
        bpy.context.view_layer.objects.active = ob
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_move_up(modifier=md.name)
    return md


def banded_mat(name, c1, c1s, c2, c2s, bands=7.0):
    """沿 UV.x 交替的条纹卡通材质（雉翎）。"""
    m = toon_mat(name, c1, c1s, rim=0.2)
    nt = m.node_tree
    em = next(n for n in nt.nodes if n.type == 'EMISSION')
    src = em.inputs['Color'].links[0].from_socket
    uv = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs[0])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = bands
    nt.links.new(sep.outputs['X'], mul.inputs[0])
    fr = nt.nodes.new('ShaderNodeMath'); fr.operation = 'FRACT'
    nt.links.new(mul.outputs[0], fr.inputs[0])
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.62
    nt.links.new(fr.outputs[0], gt.inputs[0])
    mx = nt.nodes.new('ShaderNodeMixRGB'); mx.inputs['Color2'].default_value = srgb(c2)
    nt.links.new(gt.outputs[0], mx.inputs['Fac'])
    nt.links.new(src, mx.inputs['Color1'])
    nt.links.new(mx.outputs[0], em.inputs['Color'])
    return m


def tiger_mat():
    m = toon_mat('WK_Tiger', PAL['tiger'], PAL['tiger_sh'], rim=0.25)
    nt = m.node_tree
    em = next(n for n in nt.nodes if n.type == 'EMISSION')
    src = em.inputs['Color'].links[0].from_socket
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 5.5
    wave.inputs['Distortion'].default_value = 5.0
    wave.inputs['Detail'].default_value = 1.5
    wave.inputs['Detail Scale'].default_value = 1.6
    nt.links.new(tc.outputs['Object'], wave.inputs['Vector'])
    gt = nt.nodes.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.72
    nt.links.new(wave.outputs['Fac'], gt.inputs[0])
    mx = nt.nodes.new('ShaderNodeMixRGB'); mx.inputs['Color2'].default_value = srgb(PAL['stripe'])
    nt.links.new(gt.outputs[0], mx.inputs['Fac'])
    nt.links.new(src, mx.inputs['Color1'])
    nt.links.new(mx.outputs[0], em.inputs['Color'])
    return m


def build(scale=1.0):
    global COL
    COL = bpy.data.collections.new('WUKONG')
    bpy.context.scene.collection.children.link(COL)
    OUT = 0.012

    fur = toon_mat('WK_Fur', PAL['fur'], PAL['fur_sh'])
    furface = toon_mat('WK_FurFace', PAL['fur'], PAL['fur_sh'], attr_mix=('face', PAL['skin'], PAL['skin_sh']))
    skin = toon_mat('WK_Skin', PAL['skin'], PAL['skin_sh'], rim=0.2)
    muzzle = toon_mat('WK_Muzzle', PAL['muzzle'], PAL['muzzle_sh'], rim=0.15)
    gold = toon_mat('WK_Gold', PAL['gold'], PAL['gold_sh'], rim=0.5, spec=0.6)
    red = toon_mat('WK_Red', PAL['red'], PAL['red_sh'], rim=0.25)
    boot = toon_mat('WK_Boot', PAL['boot'], PAL['boot_sh'], rim=0.25)
    staffm = toon_mat('WK_StaffRed', PAL['staff'], PAL['staff_sh'], rim=0.3, spec=0.3)
    eye_d = flat_mat('WK_EyeDark', PAL['eye'])
    eye_i = flat_mat('WK_EyeIris', PAL['iris'], 1.1)
    eye_w = flat_mat('WK_EyeWhite', PAL['white'], 1.3)
    blush = flat_mat('WK_Blush', PAL['blush'])
    pinkin = flat_mat('WK_EarIn', '#FFB7A8')
    mouth = flat_mat('WK_Mouth', '#7A2A20')

    root = empty('WK_ROOT')
    rig = empty('WK_Rig', root)                     # 整体姿态（前倾、晃动）
    hips = empty('WK_Hips', rig, (0, 0, 0.30))
    torso_p = empty('WK_TorsoPivot', hips, (0, 0, 0.0))

    # ---------------- 躯干
    body = ellipsoid('WK_Body', (0.135, 0.155, 0.175), gold, torso_p, (0.0, 0, 0.14), outline=OUT)
    # 胸前红色衣襟
    ellipsoid('WK_Chest', (0.06, 0.10, 0.11), red, torso_p, (0.09, 0, 0.16), outline=0)
    torus('WK_Sash', 0.142, 0.032, red, torso_p, (0, 0, 0.045), squash=1.12, outline=OUT * 0.8)
    # 腰带结 + 垂带
    ellipsoid('WK_Knot', (0.04, 0.05, 0.04), red, torso_p, (0.15, 0.03, 0.04), outline=OUT * 0.7)
    # 虎皮裙（上小下大的台体）
    bm = bmesh.new()
    segs = 40
    prof = [(0.150, 0.03), (0.185, -0.03), (0.215, -0.10), (0.225, -0.135)]
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * 1.1 * math.sin(2 * math.pi * k / segs),
                                    z + 0.012 * math.sin(k * 2 * math.pi / segs * 7) * (1 if z < -0.12 else 0))) for k in range(segs)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    me = bpy.data.meshes.new('WK_Skirt'); bm.to_mesh(me); bm.free()
    finish(me, tiger_mat())
    skirt = new_obj('WK_Skirt', me, torso_p, (0, 0, 0.02))
    sd = skirt.modifiers.new('Thick', 'SOLIDIFY'); sd.thickness = 0.012; sd.offset = 0
    add_outline(skirt, OUT)
    # 肩甲
    for s in (1, -1):
        ellipsoid(f'WK_Pauldron{"L" if s > 0 else "R"}', (0.065, 0.06, 0.045), gold, torso_p, (0.0, s * 0.155, 0.245),
                  rot=(s * 0.35, 0, 0), outline=OUT * 0.8)

    # ---------------- 头
    neck = empty('WK_Neck', torso_p, (0.01, 0, 0.30))
    HR = 0.27
    hc = Vector((0.02, 0, 0.245))        # 头心（相对 neck）
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=160, v_segments=80, radius=1.0)
    radii = (HR * 0.97, HR * 1.06, HR * 0.94)
    face_l = bm.verts.layers.float.new('face_tmp')
    vals = []
    for v in bm.verts:
        d = v.co.copy()
        # 脸部遮罩：两眼周围各一个圆 + 口鼻一个圆，组成桃心形
        y, z, x = d.y, d.z, d.x
        m = 0.0
        if x > 0.0:
            def circ(cy, cz, r):
                return (r - math.sqrt((y - cy) ** 2 + (z - cz) ** 2)) / r
            sd = max(circ(0.34, 0.12, 0.40), circ(-0.34, 0.12, 0.40), circ(0.0, -0.20, 0.50))
            # 额头中间的 V 形发际线
            v_cut = (z - 0.36) * 2.2 - abs(y) * 2.6 + 0.05
            sd = min(sd, -v_cut)
            m = min(1.0, max(0.0, 0.5 + sd * 2.5))
        vals.append(m)
        v.co = Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2]))
        # 两颊略鼓
        if d.z < 0.0:
            v.co.y *= 1.0 + 0.10 * math.sin(min(1.0, -d.z) * math.pi)
    me = bpy.data.meshes.new('WK_Head'); bm.to_mesh(me); bm.free()
    ca = me.color_attributes.new('face', 'FLOAT_COLOR', 'POINT')
    arr = np.array(vals, dtype=np.float32)
    ca.data.foreach_set('color', np.repeat(arr[:, None], 4, axis=1).ravel())
    finish(me, furface)
    head = new_obj('WK_Head', me, neck, hc)
    add_outline(head, OUT)

    def on_head(yaw, pitch, r=1.0):
        """头部局部坐标：yaw 绕 Z（左为正），pitch 向上为正，返回表面点。"""
        d = Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
        return Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * r, d

    def face_rot(d):
        return d.to_track_quat('X', 'Z').to_euler()

    # 口鼻部
    p, d = on_head(0, math.radians(-17), 0.93)
    ellipsoid('WK_Muzzle', (0.060, 0.105, 0.070), muzzle, head, p, face_rot(d), outline=0)
    p, d = on_head(0, math.radians(-10), 1.14)
    ellipsoid('WK_Nose', (0.012, 0.020, 0.013), mouth, head, p, face_rot(d))
    # 微笑：贴在口鼻部表面的一条上翘弧线
    mp, md_ = on_head(0, math.radians(-17), 0.93)
    pts = []
    for i in range(13):
        u = -1 + 2 * i / 12
        y = 0.046 * u
        z = -0.026 + 0.016 * (u * u)            # 中间低两端高 = 微笑
        xx = 0.060 * math.sqrt(max(0.05, 1 - (y / 0.105) ** 2 - (z / 0.070) ** 2)) + 0.003
        pts.append((xx, y, z))
    smile = tube('WK_Smile', pts, [0.0048 * (1 - 0.5 * abs(-1 + 2 * i / 12) ** 2) for i in range(13)], mouth, head, mp, face_rot(md_), segs=8)
    # 眼睛：深色椭圆 + 琥珀虹膜 + 瞳孔 + 高光
    for s in (1, -1):
        yaw = s * math.radians(24)
        p, d = on_head(yaw, math.radians(8), 0.985)
        e = ellipsoid(f'WK_Eye{s}', (0.018, 0.056, 0.074), eye_d, head, p, face_rot(d))
        ellipsoid(f'WK_Iris{s}', (0.010, 0.040, 0.050), eye_i, e, (0.012, 0, -0.016))
        ellipsoid(f'WK_Pupil{s}', (0.008, 0.024, 0.034), eye_d, e, (0.018, 0, -0.012))
        ellipsoid(f'WK_Hl{s}a', (0.006, 0.019, 0.021), eye_w, e, (0.022, 0.018, 0.034))
        ellipsoid(f'WK_Hl{s}b', (0.005, 0.009, 0.010), eye_w, e, (0.022, -0.020, -0.030))
        # 眉毛
        p2, d2 = on_head(yaw * 1.05, math.radians(27), 1.02)
        ellipsoid(f'WK_Brow{s}', (0.010, 0.046, 0.012), eye_d, head, p2,
                  (face_rot(d2).x + s * 0.30, face_rot(d2).y, face_rot(d2).z))
        # 腮红
        p3, d3 = on_head(s * math.radians(40), math.radians(-12), 1.005)
        ellipsoid(f'WK_Blush{s}', (0.006, 0.045, 0.028), blush, head, p3, face_rot(d3))
        # 耳朵
        ear = ellipsoid(f'WK_Ear{s}', (0.035, 0.09, 0.10), fur, head, (0.0, s * (radii[1] + 0.035), 0.02),
                        rot=(0, 0, s * 0.5), outline=OUT * 0.8)
        ellipsoid(f'WK_EarIn{s}', (0.014, 0.055, 0.065), pinkin, ear, (0.028, s * 0.012, 0.0))
        # 腮边蓬松毛簇
        for k, (py, pz, rz, ln) in enumerate(((0.93, -0.40, 2.0, 0.085), (0.99, -0.20, 1.75, 0.075), (0.82, -0.58, 2.3, 0.075))):
            cone(f'WK_Cheek{s}_{k}', 0.055, ln, fur, head, (0.03, s * py * radii[1], pz * radii[2]),
                 rot=(s * rz, 0, 0), outline=OUT * 0.7, bend=0.25)
    # 头顶毛簇
    for k, (px, py, rx, ry, ln, r) in enumerate(((0.06, 0.0, 0.0, 0.45, 0.12, 0.060), (0.0, 0.065, -0.5, 0.1, 0.10, 0.052),
                                                 (0.0, -0.065, 0.5, 0.1, 0.10, 0.052), (-0.07, 0.0, 0.0, -0.5, 0.10, 0.058))):
        cone(f'WK_Tuft{k}', r, ln, fur, head, (px, py, radii[2] * 0.95), rot=(rx, ry, 0), outline=OUT * 0.7, bend=0.35)
    # 后脑勺蓬毛
    for k, (pz, py, ln) in enumerate(((-0.62, 0.22, 0.09), (-0.62, -0.22, 0.09), (-0.70, 0.0, 0.10))):
        cone(f'WK_Back{k}', 0.07, ln, fur, head, (-radii[0] * 0.62, py * radii[1], pz * radii[2]),
             rot=(0, math.radians(-150), 0), outline=OUT * 0.7, bend=-0.2)
    # 金箍
    band = torus('WK_Band', HR * 0.985, 0.022, gold, head, (0.0, 0, 0.115), rot=(0, math.radians(-10), 0), squash=1.06, outline=OUT * 0.7)
    for s in (1, -1):
        torus(f'WK_BandCurl{s}', 0.028, 0.011, gold, head, (HR * 0.955, s * 0.034, 0.175),
              rot=(0, math.radians(90 - 10), 0), sM=24, sm=8, outline=OUT * 0.5)
    # 雉翎（两根长翎子）
    feat = banded_mat('WK_Feather', PAL['red'], PAL['red_sh'], PAL['feather_w'], PAL['feather_w'], bands=8.0)
    feathers = []
    for s in (1, -1):
        f = ribbon(f'WK_Feather{s}', 0.78, 0.058, 0.034, feat, head, (-0.01, s * 0.07, radii[2] * 0.86),
                   rot=(0, 0, 0), n=44, nw=2, arc=-2.05, outline=OUT * 0.6, thickness=0.008)
        f.rotation_mode = 'YXZ'
        f.rotation_euler = (s * -0.42, math.radians(90 - 6), 0)
        add_wave(f, 0.05, 0.60, 0.085, offset=s * 3.0, name='WaveA')
        add_wave(f, 0.025, 0.28, 0.060, offset=s * 7.0, name='WaveB')
        feathers.append(f)

    # ---------------- 披风/围巾
    torus('WK_Scarf', 0.105, 0.045, red, torso_p, (0.0, 0, 0.305), squash=1.15, outline=OUT * 0.8)
    cape = ribbon('WK_Cape', 0.60, 0.27, 0.46, red, torso_p, (-0.095, 0, 0.285), rot=(0, math.radians(-38), 0),
                  n=44, nw=10, arc=0.55, outline=OUT * 0.8, split=0.30, thickness=0.01, droop=0.22)
    add_wave(cape, 0.095, 0.52, 0.075, name='WaveA')
    add_wave(cape, 0.045, 0.24, 0.055, offset=5.0, name='WaveB')
    for s in (1, -1):
        st = ribbon(f'WK_ScarfTail{s}', 0.46, 0.07, 0.05, red, torso_p, (-0.08, s * 0.10, 0.31),
                    rot=(s * 0.9, math.radians(-4), s * -0.28), n=30, nw=2, arc=0.0, outline=OUT * 0.6)
        add_wave(st, 0.07, 0.42, 0.090, offset=s * 2.5, name='WaveA')

    # ---------------- 手臂
    arms = {}
    for s, nm in ((1, 'L'), (-1, 'R')):
        sh = empty(f'WK_Shoulder{nm}', torso_p, (0.0, s * 0.165, 0.225))
        ellipsoid(f'WK_UpperArm{nm}', (0.052, 0.052, 0.10), red, sh, (0, 0, -0.085), outline=OUT * 0.8)
        el = empty(f'WK_Elbow{nm}', sh, (0, 0, -0.16))
        ellipsoid(f'WK_ForeArm{nm}', (0.050, 0.050, 0.085), fur, el, (0, 0, -0.07), outline=OUT * 0.8)
        torus(f'WK_Bracer{nm}', 0.050, 0.02, gold, el, (0, 0, -0.085), outline=OUT * 0.5)
        hand = ellipsoid(f'WK_Hand{nm}', (0.062, 0.058, 0.062), fur, el, (0, 0, -0.17), outline=OUT * 0.8)
        arms[nm] = (sh, el, hand)

    # ---------------- 腿
    legs = {}
    for s, nm in ((1, 'L'), (-1, 'R')):
        hp = empty(f'WK_Hip{nm}', hips, (0.0, s * 0.085, 0.02))
        ellipsoid(f'WK_Thigh{nm}', (0.070, 0.070, 0.095), toon_mat('WK_Pants', '#3A3348', '#241E30', rim=0.2), hp, (0, 0, -0.08), outline=OUT * 0.8)
        kn = empty(f'WK_Knee{nm}', hp, (0, 0, -0.15))
        ellipsoid(f'WK_Shin{nm}', (0.062, 0.062, 0.075), boot, kn, (0, 0, -0.06), outline=OUT * 0.8)
        ft = ellipsoid(f'WK_Foot{nm}', (0.105, 0.070, 0.055), boot, kn, (0.045, 0, -0.125), outline=OUT * 0.8)
        torus(f'WK_BootTop{nm}', 0.062, 0.018, gold, kn, (0, 0, -0.015), outline=OUT * 0.5)
        legs[nm] = (hp, kn, ft)

    # ---------------- 尾巴
    pts, rad = [], []
    n = 44
    for i in range(n + 1):
        t = i / n
        if t < 0.55:
            u = t / 0.55
            x = -0.10 - 0.36 * u
            z = -0.06 + 0.16 * u * u
            y = 0.0
        else:
            u = (t - 0.55) / 0.45
            a = u * math.pi * 1.7
            rr = 0.10 * (1 - 0.45 * u)
            cx, cz = -0.46, 0.10 + 0.10
            x = cx - rr * math.sin(a) * 1.0
            z = cz - rr * math.cos(a)
            y = 0.03 * u
        pts.append((x, y, z))
        rad.append(0.042 * (1 - 0.5 * t))
    tail = tube('WK_Tail', pts, rad, fur, hips, (0, 0, 0.02), outline=OUT * 0.7, weight_group='tip')
    add_wave(tail, 0.05, 0.5, 0.05, name='WaveA')

    # ---------------- 金箍棒（握在右手）
    hand_r = arms['R'][2]
    staff_root = empty('WK_StaffPivot', hand_r, (0, 0, 0))
    L = 1.35
    bm = bmesh.new()
    segs = 20
    prof = []
    capl = 0.16
    for z, r, mi in ((-L / 2, 0.030, 1), (-L / 2 + 0.02, 0.036, 1), (-L / 2 + capl - 0.02, 0.036, 1), (-L / 2 + capl, 0.029, 1),
                     (-L / 2 + capl + 0.001, 0.027, 0), (L / 2 - capl - 0.001, 0.027, 0),
                     (L / 2 - capl, 0.029, 1), (L / 2 - capl + 0.02, 0.036, 1), (L / 2 - 0.02, 0.036, 1), (L / 2, 0.030, 1)):
        prof.append((z, r, mi))
    rings = [[bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)] for z, r, mi in prof]
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        mi = 1 if (prof[i][2] == 1 and prof[i + 1][2] == 1) else 0
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            f.material_index = mi
    f = bm.faces.new(rings[0][::-1]); f.material_index = 1
    f = bm.faces.new(rings[-1]); f.material_index = 1
    me = bpy.data.meshes.new('WK_Staff'); bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(staffm); me.materials.append(gold)
    staff = new_obj('WK_Staff', me, staff_root, (0, 0, 0))
    add_outline(staff, OUT * 0.7)

    if scale != 1.0:
        rig.scale = (scale, scale, scale)
    return dict(root=root, rig=rig, hips=hips, torso=torso_p, neck=neck, head=head, arms=arms, legs=legs,
                staff=staff_root, tail=tail, cape=cape, feathers=feathers)


def pose_surf(P):
    """冲浪式站姿：左脚在前，身体前倾，左臂前伸保持平衡，右手持棒向后下方。"""
    P['rig'].rotation_euler = (0, math.radians(14), 0)          # 整体前倾
    P['torso'].rotation_euler = (0, math.radians(10), math.radians(18))   # 上身略转向左前
    P['neck'].rotation_euler = (0, math.radians(-16), math.radians(-14))  # 抬头看前方
    shL, elL, hL = P['arms']['L']
    shR, elR, hR = P['arms']['R']
    shL.rotation_euler = (math.radians(-70), math.radians(-55), math.radians(0))   # 左臂前上伸
    elL.rotation_euler = (math.radians(0), math.radians(-30), 0)
    shR.rotation_euler = (math.radians(60), math.radians(40), math.radians(0))     # 右臂向后外
    elR.rotation_euler = (math.radians(0), math.radians(-20), 0)
    hpL, knL, ftL = P['legs']['L']
    hpR, knR, ftR = P['legs']['R']
    hpL.rotation_euler = (0, math.radians(-48), math.radians(8))
    knL.rotation_euler = (0, math.radians(52), 0)
    hpR.rotation_euler = (0, math.radians(30), math.radians(-12))
    knR.rotation_euler = (0, math.radians(38), 0)
    P['hips'].location.z = 0.265
    # 金箍棒：斜向后下
    P['staff'].rotation_euler = (math.radians(-35), math.radians(62), 0)
    P['staff'].location = (0, 0, 0)


def animate(P, f0=1, f1=420, fps=30, seed=3, blinks=(), head_turn=None):
    """无状态的小幅程序化动作（每 3 帧一个关键帧，贝塞尔插值）：身体起伏、头部张望、手臂摆动。
    blinks：眨眼的帧号列表；head_turn=(f_a, f_b, yaw_deg, hold)：在 f_a→f_b 把头转过 yaw_deg 度并保持 hold 帧再转回。"""
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, 6.28) for _ in range(16)]

    def key(ob, path, base, fn, idx=-1):
        for f in range(f0, f1 + 1, 3):
            t = (f - f0) / fps
            v = fn(t)
            cur = list(getattr(ob, path))
            if idx >= 0:
                cur[idx] = base[idx] + v
            setattr(ob, path, cur)
            ob.keyframe_insert(path, index=idx, frame=f)

    rig, torso, neck = P['rig'], P['torso'], P['neck']
    b = tuple(rig.rotation_euler)
    key(rig, 'rotation_euler', b, lambda t: math.radians(2.5) * math.sin(t * 2.1 + ph[0]) + math.radians(1.5) * math.sin(t * 5.3 + ph[1]), 1)
    key(rig, 'rotation_euler', b, lambda t: math.radians(3.0) * math.sin(t * 1.3 + ph[2]), 0)
    bl = tuple(rig.location)
    key(rig, 'location', bl, lambda t: 0.012 * math.sin(t * 3.4 + ph[3]) + 0.006 * math.sin(t * 7.9 + ph[4]), 2)
    b = tuple(torso.rotation_euler)
    key(torso, 'rotation_euler', b, lambda t: math.radians(4) * math.sin(t * 1.7 + ph[5]), 2)
    b = tuple(neck.rotation_euler)

    def turn(t):
        if not head_turn:
            return 0.0
        fa, fb, yaw, hold = head_turn
        f = f0 + t * fps
        def ss(x):
            x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)
        up = ss((f - fa) / max(1, fb - fa))
        dn = ss((f - (fb + hold)) / max(1, fb - fa))
        return math.radians(yaw) * (up - dn)
    amp = 0.35 if head_turn else 1.0
    key(neck, 'rotation_euler', b, lambda t: amp * (math.radians(9) * math.sin(t * 0.9 + ph[6]) + math.radians(3) * math.sin(t * 2.7 + ph[7])) + turn(t), 2)
    key(neck, 'rotation_euler', b, lambda t: math.radians(4) * math.sin(t * 1.4 + ph[8]) + 0.25 * turn(t), 1)
    # 眨眼
    for nm in ('WK_Eye1', 'WK_Eye-1'):
        e = bpy.data.objects.get(nm)
        if e is None:
            continue
        e.scale = (1, 1, 1); e.keyframe_insert('scale', frame=f0)
        for bf in blinks:
            for df, sz in ((-3, 1.0), (-1, 0.12), (1, 0.12), (4, 1.0)):
                e.scale = (1, 1, sz); e.keyframe_insert('scale', frame=bf + df)
    shL = P['arms']['L'][0]; shR = P['arms']['R'][0]
    b = tuple(shL.rotation_euler)
    key(shL, 'rotation_euler', b, lambda t: math.radians(7) * math.sin(t * 2.3 + ph[9]), 1)
    key(shL, 'rotation_euler', b, lambda t: math.radians(5) * math.sin(t * 1.9 + ph[10]), 0)
    b = tuple(shR.rotation_euler)
    key(shR, 'rotation_euler', b, lambda t: math.radians(5) * math.sin(t * 2.0 + ph[11]), 1)


if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    P = build(scale=1.0)
    pose_surf(P)
    animate(P)
    out = os.path.join(sc.ROOT, 'assets', 'char', 'chibi.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out)

    # 四视图预览
    sun = sc.setup_anime(scene, res=(640, 720), samples=24, motion_blur=False)
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.6, 0.95, 1)
    cd = bpy.data.cameras.new('c'); cd.lens = 60
    cam = bpy.data.objects.new('c', cd); scene.collection.objects.link(cam); scene.camera = cam
    tgt = Vector((0, 0, 0.62))
    scene.frame_set(20)
    for name, ang, elev in (('front', 15, 0.10), ('q', 55, 0.15), ('side', 90, 0.1), ('back', 160, 0.30), ('chase', 172, 0.42)):
        a = math.radians(ang)
        pos = tgt + Vector((math.cos(a), -math.sin(a), elev)).normalized() * 3.3
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(sc.ROOT, 'tests', f'chibi_{name}.png')
        bpy.ops.render.render(write_still=True)
    print('CHIBI DONE objects:', len(ALL))
