"""悟空角色的部件库：金箍棒、披风（布料解算）、毛发、材质。"""
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector, Matrix


def bsdf_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def set_in(node, names, value):
    """按候选名字设置输入（不同版本 Principled 的插槽名不同）。"""
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


# ---------------------------------------------------------------- 金箍棒
def make_staff(length=1.95, radius=0.021):
    bm = bmesh.new()
    segs = 32
    # 沿 Z 的轮廓：(z, r, 材质槽)  0=铁身 1=金箍
    cap = 0.17
    prof = []
    z0, z1 = -length / 2, length / 2

    def ring_block(za, zb):
        """金箍：略粗，带三道环棱。"""
        n = 14
        out = []
        for i in range(n + 1):
            t = i / n
            z = za + (zb - za) * t
            bump = 0.0022 * (0.5 + 0.5 * math.cos(t * math.pi * 6)) + 0.0016
            out.append((z, radius + bump, 1))
        return out

    prof += ring_block(z0, z0 + cap)
    nbody = 24
    for i in range(1, nbody):
        t = i / nbody
        prof.append((z0 + cap + (z1 - z0 - 2 * cap) * t, radius, 0))
    prof += ring_block(z1 - cap, z1)
    rings = []
    for z, r, m in prof:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), z)) for k in range(segs)]
        rings.append((ring, m))
    for i in range(len(rings) - 1):
        a, ma = rings[i]
        b, mb = rings[i + 1]
        for k in range(segs):
            f = bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
            f.material_index = 1 if (ma == 1 and mb == 1) else 0
            f.smooth = True
    for ring, m in (rings[0], rings[-1]):
        f = bm.faces.new(ring if ring is rings[-1][0] else ring[::-1])
        f.material_index = 1
    me = bpy.data.meshes.new('WK_Staff')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('WK_Staff', me)

    iron = bpy.data.materials.new('WK_StaffIron'); iron.use_nodes = True
    b = bsdf_of(iron)
    b.inputs['Base Color'].default_value = (0.035, 0.022, 0.02, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.42
    nt = iron.node_tree
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 90; noise.inputs['Detail'].default_value = 8
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.25; bump.inputs['Distance'].default_value = 0.0006
    ramp = nt.nodes.new('ShaderNodeMapRange'); ramp.inputs['To Min'].default_value = 0.3; ramp.inputs['To Max'].default_value = 0.6
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], b.inputs['Roughness'])

    gold = bpy.data.materials.new('WK_StaffGold'); gold.use_nodes = True
    g = bsdf_of(gold)
    g.inputs['Base Color'].default_value = (0.83, 0.56, 0.19, 1)
    g.inputs['Metallic'].default_value = 1.0
    g.inputs['Roughness'].default_value = 0.3
    nt = gold.node_tree
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 140; noise.inputs['Detail'].default_value = 6
    ramp = nt.nodes.new('ShaderNodeMapRange'); ramp.inputs['To Min'].default_value = 0.2; ramp.inputs['To Max'].default_value = 0.48
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], g.inputs['Roughness'])
    me.materials.append(iron)
    me.materials.append(gold)
    return ob


def place_staff(ob, grip, direction, grip_t=0.42):
    """让棒子穿过 grip 点，沿 direction 方向；grip_t 是握点在棒长上的位置（0~1）。"""
    d = Vector(direction).normalized()
    length = ob.dimensions.z if ob.dimensions.z > 0 else 1.95
    rot = d.to_track_quat('Z', 'Y')
    ob.rotation_euler = rot.to_euler()
    ob.location = Vector(grip) + d * (0.5 - grip_t) * length


# ---------------------------------------------------------------- 披风
def make_cape(shoulder_l, shoulder_r, length=1.30, bottom_scale=2.1, nx=44, ny=70,
              drape_dir=(-0.86, 0, -0.5), sag=0.06):
    """在左右肩点之间建一块上窄下宽的布，初始形态朝后下方飘。返回物体，顶点组 'pin' 为领口一排。"""
    sl, sr = Vector(shoulder_l), Vector(shoulder_r)
    across = (sr - sl)
    width_top = across.length
    mid = (sl + sr) / 2
    a_dir = across.normalized()
    d = Vector(drape_dir).normalized()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    grid = []
    for j in range(ny + 1):
        v = j / ny
        w = width_top * (1 + (bottom_scale - 1) * (v ** 0.8))
        row = []
        for i in range(nx + 1):
            u = i / nx
            # 领口略微内凹成弧形，贴着后颈
            arc = sag * math.sin(u * math.pi) * (1 - v) ** 3
            p = mid + a_dir * (u - 0.5) * w + d * (v * length) + Vector((-arc, 0, -arc * 0.5))
            row.append(bm.verts.new(p))
        grid.append(row)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.smooth = True
            for loop, (uu, vv) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uv].uv = (uu / nx, 1 - vv / ny)
    me = bpy.data.meshes.new('WK_Cape')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('WK_Cape', me)
    vg = ob.vertex_groups.new(name='pin')
    idx = 0
    for j in range(ny + 1):
        for i in range(nx + 1):
            if j == 0:
                vg.add([idx], 1.0, 'REPLACE')
            elif j == 1:
                vg.add([idx], 0.6, 'REPLACE')
            idx += 1
    return ob


def cape_material():
    m = bpy.data.materials.new('WK_CapeRed'); m.use_nodes = True
    nt = m.node_tree
    b = bsdf_of(m)
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    uvn = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uvn.outputs['UV'], sep.inputs[0])
    # 金色滚边遮罩：靠近 u=0/1 或 v=0（下摆）
    def edge(sock, lo, hi):
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value = lo; mr.inputs['From Max'].default_value = hi
        mr.clamp = True
        nt.links.new(sock, mr.inputs['Value'])
        return mr.outputs['Result']
    absu = nt.nodes.new('ShaderNodeMath'); absu.operation = 'SUBTRACT'; absu.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs['X'], absu.inputs[0])
    absu2 = nt.nodes.new('ShaderNodeMath'); absu2.operation = 'ABSOLUTE'
    nt.links.new(absu.outputs[0], absu2.inputs[0])
    side = nt.nodes.new('ShaderNodeMath'); side.operation = 'GREATER_THAN'; side.inputs[1].default_value = 0.478
    nt.links.new(absu2.outputs[0], side.inputs[0])
    hem = nt.nodes.new('ShaderNodeMath'); hem.operation = 'LESS_THAN'; hem.inputs[1].default_value = 0.022
    nt.links.new(sep.outputs['Y'], hem.inputs[0])
    trim = nt.nodes.new('ShaderNodeMath'); trim.operation = 'MAXIMUM'
    nt.links.new(side.outputs[0], trim.inputs[0]); nt.links.new(hem.outputs[0], trim.inputs[1])
    # 布纹
    wave = nt.nodes.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 900; wave.inputs['Distortion'].default_value = 0.6
    wave2 = nt.nodes.new('ShaderNodeTexWave'); wave2.inputs['Scale'].default_value = 900; wave2.bands_direction = 'Y'
    nt.links.new(uvn.outputs['UV'], wave.inputs['Vector']); nt.links.new(uvn.outputs['UV'], wave2.inputs['Vector'])
    addw = nt.nodes.new('ShaderNodeMath'); addw.operation = 'ADD'
    nt.links.new(wave.outputs['Fac'], addw.inputs[0]); nt.links.new(wave2.outputs['Fac'], addw.inputs[1])
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 6; noise.inputs['Detail'].default_value = 6
    nt.links.new(uvn.outputs['UV'], noise.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.0004
    nt.links.new(addw.outputs[0], bump.inputs['Height'])
    # 颜色：深红带轻微明暗变化 -> 滚边金色
    red = nt.nodes.new('ShaderNodeMixRGB'); red.inputs['Color1'].default_value = (0.33, 0.012, 0.016, 1); red.inputs['Color2'].default_value = (0.52, 0.03, 0.025, 1)
    nt.links.new(noise.outputs['Fac'], red.inputs['Fac'])
    col = nt.nodes.new('ShaderNodeMixRGB'); col.inputs['Color2'].default_value = (0.78, 0.5, 0.16, 1)
    nt.links.new(trim.outputs[0], col.inputs['Fac']); nt.links.new(red.outputs[0], col.inputs['Color1'])
    nt.links.new(col.outputs[0], b.inputs['Base Color'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(trim.outputs[0], b.inputs['Metallic'])
    rough = nt.nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = 0.62; rough.inputs['To Max'].default_value = 0.34
    nt.links.new(trim.outputs[0], rough.inputs['Value']); nt.links.new(rough.outputs['Result'], b.inputs['Roughness'])
    set_in(b, ['Sheen Weight', 'Sheen'], 0.6)
    set_in(b, ['Sheen Roughness'], 0.4)
    # 逆光透光：与半透明 BSDF 混合
    tr = nt.nodes.new('ShaderNodeBsdfTranslucent'); tr.inputs['Color'].default_value = (0.75, 0.035, 0.03, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    fac = nt.nodes.new('ShaderNodeMapRange'); fac.inputs['To Min'].default_value = 0.30; fac.inputs['To Max'].default_value = 0.0
    nt.links.new(trim.outputs[0], fac.inputs['Value'])
    nt.links.new(fac.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(b.outputs[0], mix.inputs[1]); nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def add_cloth(cape, collider=None, wind_strength=900.0, turb_strength=45.0, frames=(1, 280)):
    """给披风加布料解算和风场。风场朝 -X。返回 (wind, turb)。"""
    scene = bpy.context.scene
    md = cape.modifiers.new('Cloth', 'CLOTH')
    cs = md.settings
    cs.quality = 10
    cs.mass = 0.18
    cs.tension_stiffness = 18; cs.compression_stiffness = 18; cs.shear_stiffness = 6
    cs.bending_stiffness = 0.25
    cs.tension_damping = 6; cs.compression_damping = 6; cs.shear_damping = 5; cs.bending_damping = 0.6
    cs.air_damping = 1.2
    cs.vertex_group_mass = 'pin'
    cs.pin_stiffness = 1.0
    cc = md.collision_settings
    cc.use_collision = True; cc.distance_min = 0.012; cc.collision_quality = 4
    cc.use_self_collision = True; cc.self_distance_min = 0.006; cc.self_friction = 4
    md.point_cache.frame_start = frames[0]; md.point_cache.frame_end = frames[1]
    sub = cape.modifiers.new('Subdiv', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
    if collider is not None:
        cm = collider.modifiers.new('Collision', 'COLLISION')
        collider.collision.thickness_outer = 0.012
        collider.collision.cloth_friction = 8
    bpy.ops.object.effector_add(type='WIND')
    wind = bpy.context.object
    wind.name = 'WK_Wind'
    wind.field.strength = wind_strength
    wind.field.noise = 2.5
    wind.field.flow = 0.6
    wind.location = (3.0, 0, 1.0)
    wind.rotation_euler = (0, math.radians(-90), 0)   # 空物体 +Z 指向 -X
    bpy.ops.object.effector_add(type='TURBULENCE')
    turb = bpy.context.object
    turb.name = 'WK_Turb'
    turb.field.strength = turb_strength
    turb.field.size = 0.45
    turb.field.flow = 2.0
    turb.field.noise = 1.0
    turb.location = (0, 0, 1.0)
    # 让湍流场沿 -X 流动，产生行进的波纹
    turb.keyframe_insert('location', frame=frames[0])
    turb.location = (-0.11 * (frames[1] - frames[0]), 0.3, 1.0)
    turb.keyframe_insert('location', frame=frames[1])
    if turb.animation_data and turb.animation_data.action:
        for fc in _fcurves(turb.animation_data.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    return wind, turb


def _fcurves(action):
    """兼容分层动作（5.x）和旧式 fcurves。"""
    if hasattr(action, 'fcurves') and len(getattr(action, 'fcurves', [])):
        return list(action.fcurves)
    out = []
    for layer in getattr(action, 'layers', []):
        for strip in layer.strips:
            for cb in getattr(strip, 'channelbags', []):
                out.extend(cb.fcurves)
    return out


# ---------------------------------------------------------------- 毛发
def sample_basecolor_to_vertices(ob):
    """把基础色贴图按 UV 采样到每个顶点，返回 (N,3) 线性 RGB 以及金属度 (N,) 或 None。"""
    me = ob.data
    mat = me.materials[0]
    b = bsdf_of(mat)

    def img_of(sock_name):
        s = b.inputs.get(sock_name)
        if not s or not s.links:
            return None, None
        n = s.links[0].from_node
        chan = None
        if n.type == 'SEPARATE_COLOR' or n.type == 'SEPRGB':
            chan = {'Red': 0, 'Green': 1, 'Blue': 2, 'R': 0, 'G': 1, 'B': 2}.get(s.links[0].from_socket.name, 0)
            n = n.inputs[0].links[0].from_node if n.inputs[0].links else None
        if n is not None and n.type == 'TEX_IMAGE':
            return n.image, chan
        return None, None

    uvl = me.uv_layers.active.data
    nl = len(me.loops)
    luv = np.empty(nl * 2, dtype=np.float32); uvl.foreach_get('uv', luv); luv = luv.reshape(-1, 2)
    lvi = np.empty(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', lvi)
    nv = len(me.vertices)
    vuv = np.zeros((nv, 2), dtype=np.float32)
    vuv[lvi] = luv

    def sample(img):
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
        x = np.clip((vuv[:, 0] % 1.0) * w, 0, w - 1).astype(np.int32)
        y = np.clip((vuv[:, 1] % 1.0) * h, 0, h - 1).astype(np.int32)
        return px[y, x, :]

    col_img, _ = img_of('Base Color')
    rgb = sample(col_img)[:, :3] if col_img else np.full((nv, 3), 0.5, dtype=np.float32)
    met = None
    met_img, ch = img_of('Metallic')
    if met_img is not None:
        met = sample(met_img)[:, ch if ch is not None else 0]
    return rgb, met
