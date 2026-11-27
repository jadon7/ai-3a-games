# KHAMSIN 真人士兵：以 Blender 基金会 CC0 “Human Base Meshes”的写实男性身体为底，
# 重摆到游戏骨架的静止姿势 → 作战服 / 靴子 / 手套 / 装备 → 绑定到与 actors.js 的 BONES 同名同位的骨架 → assets/models/soldier.glb
# 用法：
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --disable-autoexec -P tools/blender/build_soldier.py -- \
#       tools/blender/vendor/human-base-meshes/human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend [--preview] [--stage body]
import bpy, bmesh, sys, os, math, time, random
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import importlib, soldier_lib
importlib.reload(soldier_lib)
from soldier_lib import *

ROOT = os.path.dirname(os.path.dirname(HERE)); OUT = os.path.join(ROOT, 'assets', 'models'); PRE = os.path.join(HERE, 'preview')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = next((a for a in argv if a.endswith('.blend')), None)
PREVIEW = '--preview' in argv
STAGE = argv[argv.index('--stage') + 1] if '--stage' in argv else 'all'
NOEXPORT = '--noexport' in argv
IKL2 = float(argv[argv.index('--ikl2') + 1]) if '--ikl2' in argv else 0.285
VARIANTS = [a for a in argv if a in ('friend', 'enemy', 'sniper')] or ['friend', 'enemy', 'sniper']
SHOTS = argv[argv.index('--shots') + 1].split(',') if '--shots' in argv else []
assert SRC and os.path.exists(SRC), '需要传入 human_base_meshes_bundle.blend 的路径'

S0 = 1.78 / 1.69 * 1.025      # 总缩放：裸身高 ≈ 1.82 m，肩、髋、膝的高度对上游戏骨架
WX = 1.07                     # 颈部以下加宽（肩关节间距对上骨架）
YS = -0.026                   # 前后平移：躯干中轴落在 y = 0


# ============================ 1. 取出人体并摆到游戏骨架的静止姿势 ============================
class Body:
    pass


def load_body():
    names = ['GEO-body_male_realistic']
    with bpy.data.libraries.load(SRC, link=False) as (src, dst): dst.objects = [n for n in names if n in src.objects]
    sc = bpy.context.scene; raw = dst.objects[0]; sc.collection.objects.link(raw)
    for m in raw.modifiers:
        if m.type == 'MULTIRES': m.levels = 0
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(raw.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    bpy.data.objects.remove(raw)
    fs = me.attributes['.sculpt_face_set']; fset = [fs.data[i].value for i in range(len(me.polygons))]
    xs = [v.co.x for v in me.vertices]; cx = (min(xs) + max(xs)) / 2
    for v in me.vertices:
        x = -(v.co.x - cx) * S0; y = -v.co.y * S0; z = v.co.z * S0
        v.co = (x * lerp(WX, 1.0, sstep(1.46, 1.54, z)), y + YS, max(z, 0.0))
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    # 面 → 部位
    SETS = {1: 'torso', 19: 'waist', 18: 'pelvis', 20: 'uarmR', 21: 'uarmL', 11: 'farmR', 12: 'farmL', 23: 'thighR', 24: 'thighL', 16: 'shinR', 15: 'shinL'}
    part = []; stray = {}
    for f in bm.faces:
        p = SETS.get(fset[f.index])
        if p is None:
            c = f.calc_center_median(); s = 'R' if c.x > 0 else 'L'
            p = 'foot' + s if c.z < 0.13 else 'hand' + s if (abs(c.x) > 0.36 and c.z < 1.05) else 'head' if c.z > 1.42 else 'pelvis' if c.z < 1.0 else 'torso'
            if p in ('pelvis', 'torso'): stray[fset[f.index]] = stray.get(fset[f.index], 0) + 1
        part.append(p)
    B = Body(); B.bm = bm; B.part = part; B.fset = fset
    if stray: print('[soldier] unlabeled face sets on the trunk:', stray)
    return B


def ring(B, a, b):
    """部位 a 与 b 的交界环上的顶点坐标。"""
    out = []
    for v in B.bm.verts:
        ps = {B.part[f.index] for f in v.link_faces}
        if a in ps and b in ps: out.append(v.co.copy())
    return out


def vert_onehot(B, mapping, n):
    """每个顶点按相邻面的部位取平均的 one-hot 权重。mapping(part, 面心) → 骨骼序号"""
    W = np.zeros((len(B.bm.verts), n))
    for v in B.bm.verts:
        for f in v.link_faces: W[v.index, mapping(B.part[f.index], f.calc_center_median())] += 1
    return W / W.sum(1, keepdims=True)


def repose(B):
    """用临时的 9 段权重把 A 字站姿线性混合蒙皮到游戏骨架的静止姿势（手臂垂直下垂、双腿竖直）。"""
    bm = B.bm; cen = lambda pts: sum(pts, Vector()) / len(pts)
    T = ['torso', 'uarmR', 'farmR', 'uarmL', 'farmL', 'thighR', 'shinR', 'thighL', 'shinL']; TI = {n: i for i, n in enumerate(T)}
    def seg(p, c):
        if p in TI: return TI[p]
        if p.startswith('hand'): return TI['farm' + p[-1]]
        if p.startswith('foot'): return TI['shin' + p[-1]]
        return 0
    W = smooth_w(vert_onehot(B, seg, len(T)), edges_np(bm), 7)
    co = np.array([v.co[:] for v in bm.verts]); acc = np.zeros_like(co); J = {}
    for s, sg in (('R', 1), ('L', -1)):
        r = ring(B, 'torso', 'uarm' + s); sh = Vector((sg * (max(abs(p.x) for p in r) - 0.024), cen(r).y, max(p.z for p in r) - 0.043))
        el = cen(ring(B, 'uarm' + s, 'farm' + s)); wr = cen(ring(B, 'farm' + s, 'hand' + s))
        r = ring(B, 'pelvis', 'thigh' + s); hp = Vector((cen(r).x, cen(r).y, max(p.z for p in r) + 0.035))
        kn = cen(ring(B, 'thigh' + s, 'shin' + s)) + Vector((0, 0, 0.012)); an = cen(ring(B, 'shin' + s, 'foot' + s)) + Vector((0, 0.012, 0.012))
        J[s] = dict(sh=sh, el=el, wr=wr, hp=hp, kn=kn, an=an)
        tsh = bone_pos('arm' + s); tel = bone_pos('fore' + s); twr = tel + (tel - tsh).normalized() * 0.0 + Vector((sg * 0.0055, 0, -0.225))
        thp = bone_pos('leg' + s); tkn = bone_pos('shin' + s); tan_ = Vector((sg * 0.1, 0, 0.09))
        for name, ha, ta, ht, tt in (('uarm', sh, el, tsh, tel), ('farm', el, wr, tel, twr), ('thigh', hp, kn, thp, tkn), ('shin', kn, an, tkn, tan_)):
            da = (ta - ha); dt = (tt - ht); k = dt.length / da.length; da.normalize(); dt.normalize()
            R = np.array(da.rotation_difference(dt).to_matrix()); d = np.array(da); Sm = np.eye(3) + (k - 1) * np.outer(d, d); M = R @ Sm
            w = W[:, TI[name + s]][:, None]; acc += w * ((co - np.array(ha)) @ M.T + np.array(ht))
    acc += W[:, 0][:, None] * co
    for v in bm.verts: v.co = acc[v.index]
    bm.normal_update(); B.J = J
    print('[soldier] A-pose joints (R):', {k: tuple(round(c, 3) for c in v) for k, v in J['R'].items()})


def game_weights(B, iters=7):
    def seg(p, c):
        s = p[-1]
        if p == 'torso': return BI['spine']
        if p == 'waist': return BI['hips'] if c.z < 1.10 else BI['spine']
        if p == 'pelvis': return BI['hips']
        if p == 'head': return BI['head'] if c.z > 1.555 else BI['spine']
        if p.startswith('uarm'): return BI['arm' + s]
        if p.startswith('farm') or p.startswith('hand'): return BI['fore' + s]
        if p.startswith('thigh'): return BI['leg' + s]
        if p.startswith('foot'): return BI['foot' + s]
        return BI['shin' + s]
    return prune4(smooth_w(vert_onehot(B, seg, len(BONES)), edges_np(B.bm), iters))


def body_object(B, name='body'):
    me = bpy.data.meshes.new(name); B.bm.to_mesh(me); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth = True
    return ob


# ============================ 调试渲染 ============================
def clay(ob, col=(0.6, 0.48, 0.4)):
    m = bpy.data.materials.new('clay'); m.use_nodes = True; b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*col, 1); b.inputs['Roughness'].default_value = 0.65; ob.data.materials.append(m)


def markers():
    m = bpy.data.materials.new('mk'); m.use_nodes = True; b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value = (1, 0.05, 0.02, 1)
    b.inputs['Emission Color'].default_value = (1, 0.1, 0.05, 1); b.inputs['Emission Strength'].default_value = 3
    for bn in BONES:
        o = mesh_obj('mk_' + bn[0], sphere(bone_pos(bn[0]), 0.012, 0.012, 0.012, 8, 6)); o.data.materials.append(m)


def pose_game(rig, run=0.0, ph=0.0, cw=0.0, aim=0.0, target=True, twist=0.0, L2=0.285):
    """照搬 actors.js 的 pose()：检查蒙皮在游戏动作下的变形。"""
    BLADE = 0.3; pb = rig.pose.bones; s, c = math.sin(ph), math.cos(ph)
    def loc(name, x, y, z):   # 骨骼局部位移（游戏轴）相对静止位置的增量
        pb[name].location = (x, y, z)
    loc('hips', 0, -cw * 0.36 - 0.03 * run + 0.035 * run * math.cos(ph * 2), 0)
    q = {}
    q['hips'] = grot(-0.06 * run - cw * 0.1, 0, 0.04 * run * s)
    q['spine'] = grot(-0.2 * run + aim * 0.5 - cw * 0.15, twist - BLADE, 0)
    q['head'] = grot(aim * 0.3 + 0.1 * run, twist * 0.3 + BLADE, 0)
    q['gun'] = grot(aim * 0.5 - 0.05 - (0 if target else 0.22) * (1 - run * 0.5), BLADE, 0)
    gun_pos = Vector((0.085, 0.265 + 0.012 * run * math.sin(ph * 2 + 0.6), -0.2))     # 枪骨骼在脊柱局部（游戏轴）
    loc('gun', 0, gun_pos.y - 0.265, 0)
    def arm_ik(up, lo, lx, ly, lz, side):
        L1 = 0.281; sp = BONES[BI['spine']]; ub = BONES[BI[up]]; upos = Vector((ub[2] - sp[2], ub[3] - sp[3], ub[4] - sp[4]))
        t = q['gun'] @ Vector((lx, ly, lz)) + gun_pos; d = t - upos; dist = max(0.08, min(d.length, L1 + L2 - 0.004)); n = d.normalized()
        al = math.acos(max(-1, min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))))
        u = Vector((side * 0.6, -1, 0.3)); u = (u - n * u.dot(n)).normalized(); e = n * (math.cos(al) * L1) + u * (math.sin(al) * L1)
        down = Vector((0, -1, 0)); q[up] = down.rotation_difference(e.normalized())
        f = q[up].inverted() @ (n * dist - e).normalized(); q[lo] = down.rotation_difference(f)
    arm_ik('armR', 'foreR', 0.004, -0.092, -0.03, 1); arm_ik('armL', 'foreL', -0.004, -0.085, -0.30, -1)
    A = 0.85 * run; idle = (1 - min(1, run * 3)) * (1 - cw)
    legL = s * A + cw * 1.15 + 0.2 * idle; legR = -s * A + cw * 0.5 - 0.1 * idle
    q['legL'] = grot(legL, 0, -0.07 * idle - 0.03); q['legR'] = grot(legR, 0, 0.07 * idle + 0.03)
    q['shinL'] = grot(-(0.12 + 0.16 * idle + max(0, -c) * 1.15 * run + cw * 1.5), 0, 0); q['shinR'] = grot(-(0.12 + max(0, c) * 1.15 * run + cw * 1.9), 0, 0)
    for k, v in q.items(): pb[k].rotation_quaternion = v
    bpy.context.view_layer.update()


def rest_pose(rig):
    for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


# ============================ 2. 作战服（由身体外扩 + 平滑 + 细分 + 褶皱） ============================
OFF = {'torso': 0.017, 'waist': 0.021, 'pelvis': 0.021, 'uarm': 0.017, 'farm': 0.014, 'thigh': 0.029, 'shin': 0.027}


def vert_part(B):
    return [B.part[v.link_faces[0].index] for v in B.bm.verts]


def build_shell(B, W):
    src = []; vmap = {}; sb = bmesh.new(); vp = vert_part(B)
    for f in B.bm.faces:
        pt = B.part[f.index]; key = pt if pt in OFF else pt[:-1]
        if key not in OFF: continue
        if key == 'shin' and f.calc_center_median().z < 0.225: continue
        if key == 'farm' and f.calc_center_median().z < 0.985: continue
        vs = []
        for v in f.verts:
            if v.index not in vmap: vmap[v.index] = sb.verts.new(v.co); src.append(v.index)
            vs.append(vmap[v.index])
        sb.faces.new(vs)
    sb.verts.index_update(); sb.verts.ensure_lookup_table(); sb.normal_update()
    E = edges_np(sb); bnd = np.array([v.index for v in sb.verts if v.is_boundary], dtype=np.int64)
    P = smooth_f(np.array([v.co[:] for v in sb.verts]), E, 4, 0.5, bnd)
    limb = np.array([v.index for v in sb.verts if vp[src[v.index]] not in ('torso', 'waist', 'pelvis') or v.is_boundary], dtype=np.int64)
    P = smooth_f(P, E, 9, 0.5, limb)      # 躯干多平滑几遍：衬衣不会贴出胸肌腹肌的轮廓
    for v in sb.verts: v.co = P[v.index]
    sb.normal_update()
    off = np.array([[OFF.get(vp[i], OFF.get(vp[i][:-1], 0.012))] for i in src]); off = smooth_f(off, E, 4)[:, 0]
    for v in sb.verts:
        z = v.co.z; k = 1.0; pt = vp[src[v.index]]
        if pt.startswith('farm'): k = lerp(0.45, 1.0, sstep(0.955, 1.04, z))
        if pt.startswith('shin'): k = lerp(0.08, 1.0, sstep(0.275, 0.34, z))
        v.co += v.normal * (off[v.index] * k)
    bm_set_w(sb, W[src])
    # 立领：领口边界向上挤出
    neck = [e for e in sb.edges if e.is_boundary and e.verts[0].co.z > 1.40 and e.verts[1].co.z > 1.40]
    r = bmesh.ops.extrude_edge_only(sb, edges=neck)
    for v in [g for g in r['geom'] if isinstance(g, bmesh.types.BMVert)]:
        d = Vector((v.co.x, v.co.y - 0.01, 0)).normalized(); v.co += Vector((0, 0, 0.024)) + d * 0.002
    ob = skinned_obj('uniform', sb, 'cloth')
    m = ob.modifiers.new('ss', 'SUBSURF'); m.levels = 1; apply_mods(ob)
    return ob


def wrinkle(ob):
    """布料褶皱：肘、膝、裆、腰和靴口上方的堆褶 + 袖管裤管上的斜向长褶 + 低频起伏。沿法线位移。"""
    me = ob.data; W = get_groups(ob); sin, exp = math.sin, math.exp
    wa = {s: W[:, BI['arm' + s]] + W[:, BI['fore' + s]] for s in 'RL'}; wl = {s: W[:, BI['leg' + s]] + W[:, BI['shin' + s]] for s in 'RL'}
    disp = np.zeros(len(me.vertices))
    for v in me.vertices:
        p = v.co; i = v.index; z = p.z; nz = noise.noise(p * 9.0); h = 0.0024 * nz + 0.0012 * noise.noise(p * 21.0 + Vector((3.1, 1.7, 5.2))); wt = 1.0
        for s, sg in (('R', 1), ('L', -1)):
            a = wa[s][i]
            if a > 0.01:
                th = math.atan2(p.y, p.x - sg * 0.225); el = exp(-((z - 1.18) / 0.08) ** 2); cuff = exp(-((z - 1.01) / 0.04) ** 2)
                h += a * (0.0075 * el * sin(z * 120 + 2.2 * sin(2 * th + sg) + 7 * nz) + 0.0032 * (1 - el) * sin(z * 66 + 3.0 * th * sg + 5 * nz) + 0.003 * cuff * sin(z * 150 + 2 * th)) * sstep(0.975, 1.03, z); wt -= a
            l = wl[s][i]
            if l > 0.01:
                th = math.atan2(p.y, p.x - sg * 0.1); kn = exp(-((z - 0.50) / 0.11) ** 2); bl = exp(-((z - 0.355) / 0.045) ** 2); cr = sstep(0.76, 0.9, z)
                h += l * (0.0075 * kn * sin(z * 100 + 2.0 * sin(2 * th + sg) + 7 * nz) + 0.0045 * (1 - kn) * (1 - bl) * sin(z * 50 + 2.5 * th * sg + 6 * nz)
                          + 0.013 * bl + 0.006 * bl * sin(z * 125 + 3 * th) + 0.003 * cr * sin(th * 5 + z * 55)); wt -= l
        if wt > 0.01:
            th = math.atan2(p.y, p.x); wst = exp(-((z - 1.09) / 0.05) ** 2)
            h += wt * (0.006 * wst * sin(z * 130 + 2 * sin(3 * th) + 6 * nz) + 0.002 * sin(z * 52 + 4 * th + 5 * nz))
        disp[i] = h
    for v in me.vertices: v.co = v.co + v.normal * disp[v.index]
    me.update()


SHELL_RATIO = 0.4      # 作战服细分 + 褶皱后再按曲率自适应减面：平坦处合并，褶皱和轮廓保留（游戏里十几个兵同屏，面数要省）


def decimate(ob, ratio):
    m = ob.modifiers.new('dec', 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio; m.use_collapse_triangulate = True; apply_mods(ob)
    for p in ob.data.polygons: p.use_smooth = True


def rim(ob, t=0.009):
    m = ob.modifiers.new('sol', 'SOLIDIFY'); m.thickness = t; m.offset = -1.0; m.use_rim = True; m.use_rim_only = True; apply_mods(ob)


# ============================ 3. 头（皮肤、眼睛、眉毛与短发的明暗） ============================
def build_head(B, W):
    src = []; vmap = {}; hb = bmesh.new()
    for f in B.bm.faces:
        c = f.calc_center_median(); pt = B.part[f.index]
        if not (pt == 'head' or (pt == 'torso' and c.z > 1.44 and abs(c.x) < 0.15)): continue
        vs = []
        for v in f.verts:
            if v.index not in vmap: vmap[v.index] = hb.verts.new(v.co); src.append(v.index)
            vs.append(vmap[v.index])
        hb.faces.new(vs)
    hb.verts.index_update(); bm_set_w(hb, W[src]); ob = skinned_obj('skin', hb, 'skin', recalc=False)
    # 眼球：眼眶面组（2 / 3）与脸的交界环定位
    eyes = []
    for fsid in (2, 3):
        pts = [v.co.copy() for v in B.bm.verts if {B.fset[f.index] for f in v.link_faces} >= {fsid, 17}]
        c = sum(pts, Vector()) / len(pts); sg = 1 if c.x > 0 else -1; k = S0 / (1.78 / 1.69)
        ec = c + Vector((-sg * 0.0022, -0.0035, 0.0015)) * k; r = 0.0126 * k
        bm = sphere((0, 0, 0), r, r, r, 12, 8); xform(bm, Matrix.Translation(ec) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
        e = mesh_obj('eye', bm); rigid(e, 'head'); sl = []
        for v in e.data.vertices:
            cs = (v.co - ec).normalized().y; sl.append(SI['dark'] if cs > 0.97 else SI['iris'] if cs > 0.86 else SI['eye'])
        set_attr(e, 'slot', sl, 'INT'); eyes.append(e); B.eye = getattr(B, 'eye', []) + [ec]
    ez = B.eye[0].z; sh = []
    for v in ob.data.vertices:
        p = v.co; bx = abs(p.x)
        line = lerp(ez + 0.066, ez - 0.07, sstep(0.085, -0.03, p.y)); hair = sstep(line - 0.006, line + 0.012, p.z) * sstep(1.60, 1.66, p.z)
        bz = ez + 0.0235 + 0.0035 * math.cos((bx - 0.034) / 0.03 * 1.4)
        brow = math.exp(-((p.z - bz) / 0.0048) ** 2) * sstep(0.007, 0.016, bx) * sstep(0.068, 0.054, bx) * sstep(0.065, 0.09, p.y)
        stub = sstep(ez - 0.05, ez - 0.085, p.z) * sstep(0.0, 0.05, p.y) * sstep(1.50, 1.56, p.z)
        lips = math.exp(-((p.z - (ez - 0.079)) / 0.006) ** 2) * sstep(0.03, 0.018, bx) * sstep(0.10, 0.12, p.y)
        sh.append(max(0.2, 1 - 0.66 * hair - 0.5 * brow - 0.16 * stub - 0.2 * lips))
    set_attr(ob, 'shade', sh)
    return [ob] + eyes


# ============================ 4. 靴子、手套 ============================
SH = ((0.11, 0.046, 0.058, -0.006), (0.16, 0.047, 0.058, -0.007), (0.21, 0.052, 0.062, -0.010), (0.258, 0.058, 0.067, -0.013), (0.276, 0.062, 0.071, -0.013), (0.288, 0.056, 0.065, -0.013))   # 靴筒截面：z, rx, ry, 中心 y
CUFF = (0.044, 0.047)   # 手套口半径（x, y）


def tuck(ob):
    """把裤脚收进靴筒、袖口收进手套口：这两段的顶点限制在靴筒 / 手套口截面以内。"""
    zs = [r[0] for r in SH]; W = get_groups(ob); leg = W[:, BI['shinR']] + W[:, BI['shinL']] + W[:, BI['footR']] + W[:, BI['footL']]; arm = W[:, BI['foreR']] + W[:, BI['foreL']]
    for v in ob.data.vertices:
        p = v.co
        if p.z < 0.30 and leg[v.index] > 0.5:
            sg = 1 if p.x > 0 else -1; rx = np.interp(p.z, zs, [r[1] for r in SH]); ry = np.interp(p.z, zs, [r[2] for r in SH]); cy = np.interp(p.z, zs, [r[3] for r in SH])
            k = lerp(0.84, 1.3, sstep(0.27, 0.30, p.z)); dx = (p.x - sg * 0.1) / (rx * k); dy = (p.y - cy) / (ry * k); r = math.hypot(dx, dy)
            if r > 1: v.co = Vector((sg * 0.1 + (p.x - sg * 0.1) / r, cy + (p.y - cy) / r, p.z))
        elif 0.9 < p.z < 1.035 and arm[v.index] > 0.5:
            sg = 1 if p.x > 0 else -1; k = lerp(0.82, 1.4, sstep(1.0, 1.035, p.z)); dx = (p.x - sg * 0.2355) / (CUFF[0] * k); dy = (p.y - 0.002) / (CUFF[1] * k); r = math.hypot(dx, dy)
            if r > 1: v.co = Vector((sg * 0.2355 + (p.x - sg * 0.2355) / r, 0.002 + (p.y - 0.002) / r, p.z))
    ob.data.update()


def build_boot(sg):
    ax = sg * 0.1; out = []; bone = None   # 权重在最后按位置统一设置：鞋面 / 鞋底跟脚，靴筒跟小腿，脚踝一圈过渡
    def outline(z, k=1.0):
        pts = ellipse((ax, 0.058, z), X, F, 0.053 * k, 0.148 * k, 22, 2.7)
        return [Vector((ax + (q.x - ax) * lerp(0.80, 1.0, sstep(-0.09, 0.05, q.y)) * lerp(0.84, 1.0, sstep(0.21, 0.14, q.y)), q.y, q.z)) for q in pts]
    out.append(part('sole', loft([outline(0.0, 0.985), outline(0.008), outline(0.026), outline(0.03, 0.97)]), 'dark', bone))
    secs = []
    for y, hw, zt in ((-0.079, 0.031, 0.10), (-0.064, 0.041, 0.125), (-0.032, 0.047, 0.142), (0.0, 0.049, 0.142), (0.036, 0.049, 0.118), (0.072, 0.050, 0.093), (0.112, 0.050, 0.075), (0.152, 0.048, 0.065), (0.186, 0.041, 0.058), (0.203, 0.027, 0.05)):
        zb = 0.024; hh = (zt - zb) / 2; secs.append(rrect((ax, y, (zt + zb) / 2), X, U, hw, hh, min(hw, hh) * 0.8, 3))
    out.append(part('vamp', loft(secs), 'boot', bone))
    rings = []
    for z, rx, ry, dy, in SH: rings.append(ellipse((ax, dy, z), X, F, rx, ry, 14, 2.2))
    out.append(part('shaft', loft(rings), 'boot', bone))
    for y, z in ((0.094, 0.090), (0.07, 0.103), (0.052, 0.119)): out.append(part('lace', box(0.046, 0.007, 0.007, (ax, y, z), (rad(-28), 0, 0)), 'dark', bone, bevel=0.0015))
    for z in (0.15, 0.185, 0.22, 0.252):
        ry = np.interp(z, [r[0] for r in SH], [r[2] for r in SH]); dy = np.interp(z, [r[0] for r in SH], [r[3] for r in SH])
        out.append(part('lace', box(0.044, 0.007, 0.007, (ax, dy + ry + 0.001, z)), 'dark', bone, bevel=0.0015))
    out.append(part('toecap', loft([rrect((ax, y, 0.05), X, U, hw, 0.026, 0.02, 3) for y, hw in ((0.165, 0.049), (0.19, 0.043), (0.207, 0.03))]), 'dark', bone))
    # 脚踝关节在 (ax, 0, 0.09)。脚的权重：脚背前段和鞋底整体跟脚；后跟上方到靴筒下沿（z 0.085 → 0.17）平滑过渡到小腿，
    # 这样踮脚 / 勾脚时靴筒下沿像皮革一样折，而不是和鞋面裂开一道缝
    fb, sb = ('footR', 'shinR') if sg > 0 else ('footL', 'shinL')
    for ob in out:
        W = np.zeros((len(ob.data.vertices), len(BONES)))
        for v in ob.data.vertices:
            p = v.co; up = sstep(0.085, 0.17, p.z) * sstep(0.085, 0.03, p.y)   # 越靠前越不受小腿影响
            W[v.index, BI[fb]] = 1 - up; W[v.index, BI[sb]] = up
        set_groups(ob, W)
    return out


def build_glove(sg):
    x0 = sg * 0.2355; out = []; bone = 'foreR' if sg > 0 else 'foreL'; XS = X * sg
    secs = []
    for z, dx, hx, hy, yc in ((1.012, 0, 0.044, 0.047, 0.002), (0.980, 0, 0.041, 0.045, 0.002), (0.955, 0.001, 0.027, 0.036, 0.002), (0.930, 0.002, 0.020, 0.042, 0.004), (0.900, 0.003, 0.0175, 0.046, 0.002), (0.874, 0.004, 0.015, 0.044, 0.0), (0.862, 0.003, 0.0105, 0.040, 0.0)):
        secs.append(rrect((x0 + sg * dx, yc, z), XS, F, hx, hy, min(hx, hy) * 0.85, 3))
    out.append(part('palm', loft(secs), 'glove', bone))
    for k, (y, L, r) in enumerate(((0.0325, 0.95, 0.0114), (0.0108, 1.0, 0.0118), (-0.0108, 0.96, 0.0113), (-0.0312, 0.84, 0.0102))):
        path = [(x0 + sg * 0.005, y, 0.880), (x0 + sg * 0.006, y, 0.880 - 0.034 * L), (x0 - sg * 0.002 * L, y, 0.880 - 0.058 * L), (x0 - sg * 0.024 * L, y, 0.880 - 0.068 * L), (x0 - sg * 0.042 * L, y, 0.880 - 0.054 * L), (x0 - sg * 0.045 * L, y, 0.880 - 0.030 * L)]
        out.append(part('finger', sweep(path, r, r * 0.97, F, 8, 0.93), 'glove', bone))
    out.append(part('thumb', sweep([(x0 - sg * 0.004, 0.038, 0.928), (x0 - sg * 0.018, 0.050, 0.902), (x0 - sg * 0.034, 0.042, 0.882), (x0 - sg * 0.046, 0.024, 0.872)], 0.0118, 0.0108, U, 8, 0.85), 'glove', bone))
    out.append(part('knuckle', box(0.009, 0.086, 0.022, (x0 + sg * 0.0205, 0.0, 0.874)), 'pad', bone, bevel=0.003, seg=2))
    out.append(part('backplate', box(0.006, 0.052, 0.036, (x0 + sg * 0.0215, 0.002, 0.918)), 'pad', bone, bevel=0.0025))
    out.append(part('wstrap', loft([rrect((x0, 0.002, z), XS, F, 0.0425 + e, 0.046 + e, 0.034, 3) for z, e in ((1.002, -0.003), (1.0, 0.0015), (0.979, 0.0015), (0.977, -0.003))]), 'dark', bone))
    return out


# ============================ 5. 通用装备：腰带、腿挂枪套、护膝、裤兜、臂章 ============================
def torso_surf(ob):
    W = get_groups(ob); t = W[:, BI['hips']] + W[:, BI['spine']] + W[:, BI['head']]
    return Surf(ob, lambda p: t[p.vertices[0]] > 0.5)
def limb_surf(ob, names):
    W = get_groups(ob); t = sum(W[:, BI[n]] for n in names)
    return Surf(ob, lambda p: t[p.vertices[0]] > 0.5)


def ring_rows(S, cx, cy, zs, n, off, a0=0.0, a1=2 * math.pi, bulge=None):
    rows = []; closed = abs(a1 - a0 - 2 * math.pi) < 1e-6
    for z in zs:
        row = []
        for k in range(n if closed else n + 1):
            a = a0 + (a1 - a0) * k / n; h, nr = S.radial(cx, cy, z, a)
            if h is None: h = Vector((cx, cy, z))
            d = Vector((math.cos(a), math.sin(a), 0)); row.append(h + d * (off + (bulge(a, z) if bulge else 0)))
        rows.append(row)
    return rows


def radial_box(S, cx, cy, ang, z, w, d, h, out=0.0, tilt=0.0):
    """在躯干 / 肢体表面按径向摆一个盒子：宽 w（切向）× 厚 d（径向）× 高 h。"""
    hit, nr = S.radial(cx, cy, z, ang); dv = Vector((math.cos(ang), math.sin(ang), 0)); c = hit + dv * (d / 2 + out)
    return box(w, d, h, c, (tilt, 0, ang - math.pi / 2))


def build_common(shell):
    T = torso_surf(shell); out = []
    # 腰带 + 带扣
    out.append(rigid(sheet('belt', ring_rows(T, 0, 0, (1.012, 1.060), 30, 0.007), 'dark', out_from(0, 0), 0.0055, close=True), 'hips'))
    out.append(part('buckle', radial_box(T, 0, 0, math.pi / 2, 1.036, 0.052, 0.008, 0.042, 0.011), 'pad', 'hips', bevel=0.002))
    for ang, z, w, d, h, slot in ((rad(197), 0.985, 0.095, 0.046, 0.115, 'pouch'), (rad(318), 0.992, 0.072, 0.04, 0.095, 'pouch'), (rad(270), 0.985, 0.135, 0.05, 0.10, 'pouch'), (rad(52), 1.0, 0.05, 0.028, 0.085, 'pouch'), (rad(128), 1.0, 0.05, 0.028, 0.085, 'pouch')):
        out.append(part('beltpouch', radial_box(T, 0, 0, ang, z, w, d, h, 0.004), slot, 'hips', bevel=0.006, seg=2))
        out.append(part('flap', radial_box(T, 0, 0, ang, z + h * 0.34, w * 1.04, d * 1.06, h * 0.34, 0.004), slot, 'hips', bevel=0.004))
    # 右腿：腿挂枪套（手枪握把露在外面）
    LR = limb_surf(shell, ('legR', 'shinR')); hit, _ = LR.side(1, 0.0, 0.775); hx = hit.x
    out.append(part('holster', box(0.032, 0.085, 0.165, (hx + 0.02, 0.012, 0.765), (0.12, 0, 0)), 'dark', 'legR', bevel=0.006, seg=2))
    out.append(part('pgrip', box(0.026, 0.036, 0.085, (hx + 0.02, -0.022, 0.875), (0.42, 0, 0)), 'dark', 'legR', bevel=0.006, seg=2))
    out.append(part('pslide', box(0.024, 0.11, 0.03, (hx + 0.02, 0.012, 0.842), (0.12, 0, 0)), 'pad', 'legR', bevel=0.004))
    out.append(part('hplate', box(0.012, 0.11, 0.13, (hx + 0.006, 0.006, 0.78)), 'dark', 'legR', bevel=0.004))
    for z in (0.815, 0.725): out.append(rigid(sheet('hstrap', ring_rows(LR, 0.1, 0, (z - 0.014, z + 0.014), 20, 0.005), 'dark', out_from(0.1, 0), 0.004, close=True), 'legR'))
    out.append(part('hdrop', box(0.008, 0.04, 0.17, (hx + 0.004, 0.0, 0.93)), 'dark', 'hips', bevel=0.002))
    for sg, s_ in ((1, 'R'), (-1, 'L')):
        L = limb_surf(shell, ('leg' + s_, 'shin' + s_)); ax = sg * 0.1
        # 护膝：前向投影的壳 + 两条绑带
        rows = []
        for i in range(6):
            v = i / 5; z = lerp(0.435, 0.572, v); row = []
            for j in range(6):
                u = j / 5; hw = 0.056 * (1 - 0.35 * abs(2 * v - 1) ** 2.5); x = ax + lerp(-hw, hw, u); hit, _ = L.front(x, z)
                if hit is None: hit = Vector((x, 0.03, z))
                row.append(hit + Vector((0, 0.008 + 0.016 * (1 - (2 * u - 1) ** 2) * (1 - 0.7 * (2 * v - 1) ** 2), 0)))
            rows.append(row)
        out.append(rigid(sheet('kneepad', rows, 'pad', lambda c: F, 0.012, bevel=0.004, seg=2), 'shin' + s_))
        for z in (0.425, 0.468): out.append(rigid(sheet('kstrap', ring_rows(L, ax, 0, (z - 0.011, z + 0.011), 18, 0.004), 'dark', out_from(ax, 0), 0.003, close=True), 'shin' + s_))
        # 大腿侧兜 + 兜盖（绕腿轴径向投影，贴着裤管）
        mid = 0.0 if sg > 0 else math.pi
        for z0, z1, o, t, nz_ in ((0.60, 0.77, 0.003, 0.012, 5), (0.74, 0.787, 0.016, 0.005, 3)):
            out.append(rigid(sheet('cargo', ring_rows(L, ax, 0, np.linspace(z0, z1, nz_), 7, o, mid - rad(52), mid + rad(52)), 'cloth', out_from(ax, 0), t, bevel=0.003), 'leg' + s_))
        # 上臂识别臂章
        A = limb_surf(shell, ('arm' + s_, 'fore' + s_))
        out.append(rigid(sheet('armband', ring_rows(A, sg * 0.222, 0, (1.33, 1.375), 16, 0.004), 'accent', out_from(sg * 0.222, 0), 0.003, close=True), 'arm' + s_))
        out.append(rigid(sheet('elbowpad', ring_rows(A, sg * 0.229, 0, np.linspace(1.098, 1.186, 4), 6, 0.005, rad(222), rad(318), lambda a, z: 0.007 * (1 - ((z - 1.142) / 0.05) ** 2)), 'pad', out_from(sg * 0.229, 0), 0.007, bevel=0.003), 'fore' + s_))
    return out


# ============================ 6. 阵营装备 ============================
class Ctx:
    pass


def make_ctx(shell, head, B):
    C = Ctx(); C.T = torso_surf(shell); C.SF = Surf(shell); C.shell_co = [v.co.copy() for v in shell.data.vertices]; C.shell_W = get_groups(shell); C.H = Surf(head); C.ez = B.eye[0].z; ez = C.ez
    C.top = C.H.down(0, 0.02)[0].z; C.yb = C.H.back(0, ez + 0.03)[0].y; C.yf = C.H.front(0, ez + 0.05)[0].y; C.xs = C.H.side(1, 0.02, ez + 0.05)[0].x; C.yc = (C.yb + C.yf) / 2
    print('[soldier] head: eyeZ %.3f top %.3f front %.3f back %.3f side %.3f' % (ez, C.top, C.yf, C.yb, C.xs))
    return C


def panel_rows(T, zs, hw_fn, off, nx=7, back=False, flat=0.5):
    """躯干前 / 后的贴身面板：沿 Y 投影到衣服上，再向中线深度拉平一部分（插板是硬的）。"""
    f = T.back if back else T.front; rows = []
    for z in zs:
        hc = f(0.0, z)[0]; hw = hw_fn(z); row = []
        for j in range(nx):
            x = lerp(-hw, hw, j / (nx - 1)); h = f(x, z)[0]
            if h is None: h = Vector((x, hc.y, z))
            row.append(Vector((x, h.y + (hc.y - h.y) * flat + (-off if back else off), z)))
        rows.append(row)
    return rows
def panel_y(T, x, z, off, back=False, flat=0.5):
    f = T.back if back else T.front; hc = f(0.0, z)[0]; h = f(x, z)[0]
    if h is None: h = hc
    return h.y + (hc.y - h.y) * flat + (-off if back else off)


def over_shoulder(SF, x0, x1, a0, a1, off, n=9, cy=0.0, cz=1.40, bow=0.042):
    """从胸前翻过肩膀到背后的带子：在 Y-Z 平面里绕 (cy, cz) 做径向投影。越过肩顶时向外让开领口（bow），
    射线若穿进领口打到下半身（z 过低）就丢弃，用相邻的有效点补上。"""
    rows = []
    for xb in (x0, x1):
        row = []
        for k in range(n + 1):
            a = lerp(a0, a1, k / n); x = math.copysign(abs(xb) + bow * max(0.0, 1 - ((a - math.pi / 2) / rad(52)) ** 2), xb)
            d = Vector((0, math.cos(a), math.sin(a))); h, _ = SF.ray(Vector((x, cy, cz)) + d * 1.0, -d)
            row.append(h + d * off if (h is not None and h.z > 1.30) else None)
        ok = [i for i, q in enumerate(row) if q is not None]
        for i, q in enumerate(row):
            if q is None: j = min(ok, key=lambda t: abs(t - i)); row[i] = row[j] + Vector((0, 0.004 * (j - i), 0))
        rows.append(row)
    return rows


def helmet_parts(C):
    ez = C.ez; zc = ez + 0.03; t = 0.009; a = C.xs + 0.027; b = (C.yf - C.yb) / 2 + 0.025; c = C.top - zc + 0.023; yc = C.yc; out = []
    zf, zs, zb = ez + 0.047, ez + 0.034, ez - 0.03
    def rimz(deg):
        d = abs(deg)
        return zf if d <= 48 else lerp(zf, zs, sstep(48, 78, d)) if d <= 104 else lerp(zs, zb, sstep(104, 142, d))
    def EP(deg, z, e=0.0):
        ph = rad(deg); r = math.sqrt(max(0.0, 1 - ((z - zc) / (c + e)) ** 2)); return Vector(((a + e) * r * math.sin(ph), yc + (b + e) * r * math.cos(ph), z))
    n = 28; m = 7; rows = []
    for j in range(m + 1):
        row = []
        for k in range(n):
            deg = 360.0 * k / n; deg = deg - 360 if deg > 180 else deg; al = math.acos(max(-1, min(1, (rimz(deg) - zc) / (c - t)))) * j / m; ph = rad(deg)
            row.append(Vector(((a - t) * math.sin(al) * math.sin(ph), yc + (b - t) * math.sin(al) * math.cos(ph), zc + (c - t) * math.cos(al))))
        rows.append(row)
    ctr = Vector((0, yc, zc)); outf = lambda q: q - ctr
    out.append(sheet('helmet', rows, 'helmet', outf, t, bevel=0.002, close=True))
    ring = lambda z0, z1, e, d0=-180, d1=180, nn=28: [[EP(lerp(d0, d1, k / nn), z, e) for k in range(nn + (0 if d1 - d0 >= 360 else 1))] for z in (z0, z1)]
    out.append(sheet('gstrap', ring(zf + 0.024, zf + 0.046, 0.002), 'strap', outf, 0.003, close=True))
    out.append(sheet('goggle', [[EP(lerp(-31, 31, k / 8), z, 0.004) for k in range(9)] for z in np.linspace(zf + 0.016, zf + 0.056, 4)], 'dark', outf, 0.012, bevel=0.004, seg=2))
    out.append(sheet('lens', [[EP(lerp(-25, 25, k / 8), z, 0.0165) for k in range(9)] for z in np.linspace(zf + 0.023, zf + 0.049, 3)], 'lens', outf, 0.0012))
    q = EP(0, zf + 0.004, 0.004); out.append(part('shroud', box(0.036, 0.008, 0.022, q + Vector((0, 0, 0.004))), 'dark', bevel=0.002))
    for sg in (1, -1):
        out.append(part('rail', box(0.008, 0.11, 0.017, EP(sg * 90, zs + 0.024, 0.003) + Vector((0, 0.004, 0))), 'dark', bevel=0.002))
        out.append(part('cup', box(0.032, 0.068, 0.088, (sg * (C.xs + 0.034), 0.012, ez - 0.026)), 'dark', bevel=0.013, seg=2))
        out.append(part('cuparm', box(0.007, 0.016, 0.06, (sg * (C.xs + 0.04), 0.012, ez + 0.032)), 'dark', bevel=0.002))
    out.append(part('battery', box(0.075, 0.022, 0.048, EP(180, ez + 0.022, 0.009), (rad(8), 0, 0)), 'pouch', bevel=0.006, seg=2))
    out.append(part('strobe', box(0.03, 0.03, 0.014, EP(180, zc + c * 0.86, 0.004), (rad(-28), 0, 0)), 'accent', bevel=0.004))
    xm = -(C.xs + 0.036)
    out.append(part('mic', sweep([(xm, 0.04, ez - 0.05), (xm + 0.012, 0.085, ez - 0.07), (xm + 0.045, 0.125, ez - 0.082), (-0.022, 0.142, ez - 0.086)], 0.0035, 0.0035, U, 6, 1.0, 2.0, False, 3), 'dark'))
    out.append(part('mictip', sphere((-0.018, 0.143, ez - 0.086), 0.009, 0.007, 0.008, 8, 6), 'dark'))
    # 下巴带：冠状面里的 U 形，贴着脸颊和下巴
    dn = Vector((0, 0.075, -0.15)).normalized(); rows = []
    for w in (-0.009, 0.009):
        row = []; o = Vector((0, 0.03, ez)) + Vector((0, dn.z, -dn.y)) * w
        for k in range(17):
            th = lerp(rad(-32), rad(212), k / 16); d = X * math.cos(th) + dn * math.sin(th); h, _ = C.H.ray(o + d * 0.24, -d, 0.3)
            if h is None: h = o + d * 0.09
            row.append(h + d * 0.004)
        rows.append(row)
    out.append(sheet('chin', rows, 'strap', lambda q: q - Vector((0, 0.05, ez - 0.04)), 0.003))
    for o in out: rigid(o, 'head')
    return out


def carrier_parts(C, heavy=True):
    """插板背心（友军）：前后插板、腰封、肩带、弹匣包、杂物包、电台、背囊。"""
    T = C.T; out = []; off = 0.012; th = 0.027
    hw = lambda z: lerp(0.138, 0.092, sstep(1.37, 1.47, z)) * lerp(0.9, 1.0, sstep(1.16, 1.2, z))
    out.append(sheet('plateF', panel_rows(T, np.linspace(1.165, 1.475, 7), hw, off), 'vest', lambda q: F, th, bevel=0.007, seg=2))
    out.append(sheet('plateB', panel_rows(T, np.linspace(1.165, 1.49, 7), lambda z: hw(z) * 1.03, off, back=True), 'vest', lambda q: -F, th + 0.003, bevel=0.007, seg=2))
    out.append(sheet('cummer', ring_rows(T, 0, 0, (1.165, 1.22, 1.275), 30, 0.011), 'vest', out_from(0, 0), 0.011, bevel=0.003, close=True))
    for sg in (1, -1):
        out.append(sheet('sstrap', over_shoulder(C.SF, sg * 0.062, sg * 0.118, rad(38), rad(150), 0.010), 'vest', lambda q: q - Vector((q.x, 0, 1.40)), 0.012, bevel=0.003))
        out.append(sheet('spad', over_shoulder(C.SF, sg * 0.055, sg * 0.125, rad(70), rad(112), 0.0225, 4), 'pouch', lambda q: q - Vector((q.x, 0, 1.40)), 0.008, bevel=0.003))
    py = lambda x, z: panel_y(T, x, z, off) + th
    for x in (-0.092, 0.0, 0.092):
        y = py(x, 1.24); out.append(part('mag', box(0.076, 0.036, 0.132, (x, y + 0.016, 1.238)), 'pouch', bevel=0.006, seg=2))
        out.append(part('magtop', box(0.052, 0.021, 0.04, (x, y + 0.017, 1.315)), 'dark', bevel=0.004))
        out.append(part('magtab', box(0.014, 0.005, 0.085, (x, y + 0.036, 1.262)), 'vest', bevel=0.0015))
    y = py(0, 1.412); out.append(part('admin', box(0.165, 0.024, 0.072, (0, y + 0.010, 1.414)), 'pouch', bevel=0.007, seg=2))
    out.append(part('iff', box(0.062, 0.004, 0.038, (0.042, y + 0.0225, 1.416)), 'accent', bevel=0.001))
    out.append(part('flag', box(0.05, 0.004, 0.032, (-0.046, y + 0.0225, 1.416)), 'pad', bevel=0.001))
    out.append(part('radio', radial_box(T, 0, 0, rad(163), 1.25, 0.056, 0.036, 0.125, 0.022), 'pouch', bevel=0.006, seg=2))
    h, _ = T.radial(0, 0, 1.25, rad(163)); q = h + Vector((math.cos(rad(163)), math.sin(rad(163)), 0)) * 0.04
    out.append(part('antenna', tube(q + Vector((0, 0, 0.06)), q + Vector((-0.012, -0.03, 0.36)), 0.0045, 0.003, 6), 'dark'))
    out.append(part('sidepouch', radial_box(T, 0, 0, rad(14), 1.228, 0.062, 0.036, 0.105, 0.022), 'pouch', bevel=0.006, seg=2))
    if heavy:
        yb = panel_y(T, 0, 1.335, off, back=True) - th - 0.003
        out.append(part('pack', box(0.215, 0.075, 0.31, (0, yb - 0.036, 1.338)), 'pouch', bevel=0.024, seg=3))
        out.append(part('packpocket', box(0.15, 0.03, 0.13, (0, yb - 0.085, 1.275)), 'vest', bevel=0.012, seg=2))
        for x in (-0.062, 0.062): out.append(part('packstrap', box(0.022, 0.006, 0.30, (x, yb - 0.076, 1.34)), 'dark', bevel=0.0015))
        out.append(part('roll', tube((-0.105, yb - 0.05, 1.502), (0.105, yb - 0.05, 1.502), 0.034, 0.034, 10), 'cloth'))
    for o in out: rigid(o, 'spine')
    return out


def wrap_rows(H, ctr, zs_fn, n, m, off, fold, a0=-180.0, a1=180.0):
    """包在头上的布：以 ctr 为中心的经纬网格投影到头皮上再外扩。zs_fn(deg) → (上沿极角, 下沿高度)。"""
    rows = []; closed = (a1 - a0) >= 360
    for j in range(m + 1):
        row = []
        for k in range(n if closed else n + 1):
            deg = lerp(a0, a1, k / n); ph = rad(deg); z_low = zs_fn(deg)
            # 第 j 圈：从头顶（j = 0）往下到 z_low
            tt = j / m; d0 = Vector((math.sin(ph), math.cos(ph), 0))
            if tt < 0.45:
                al = (tt / 0.45) * (math.pi / 2); d = Vector((d0.x * math.sin(al), d0.y * math.sin(al), math.cos(al))); o = ctr
            else:
                d = d0; o = Vector((ctr.x, ctr.y, lerp(ctr.z, z_low, (tt - 0.45) / 0.55)))
            h, _ = H.ray(o + d * 0.6, -d)
            if h is None: h = o + d * 0.07
            row.append(h + d * (off + fold(deg, h.z, tt)))
        rows.append(row)
    return rows


def veil_rows(H, ctr_y, z_top, z_bot, a, n, m, off, fold):
    """面巾：从鼻梁往下垂到领口，绕竖直轴做径向投影；下巴以下不再贴着脖子，只允许缓慢内收。"""
    rows = []; prev = None
    for j in range(m + 1):
        z = lerp(z_top, z_bot, j / m); row = []; rr = []
        for k in range(n + 1):
            deg = lerp(-a, a, k / n); ph = rad(deg); d = Vector((math.sin(ph), math.cos(ph), 0)); o = Vector((0, ctr_y, z)); h, _ = H.ray(o + d * 0.6, -d)
            rr.append((h - o).length if h is not None else 0.05)
        rr = [max(rr[max(0, k - 1)], rr[k], rr[min(n, k + 1)]) for k in range(n + 1)]
        if prev is not None: rr = [max(r, pr - 0.007) for r, pr in zip(rr, prev)]
        for k in range(n + 1):
            deg = lerp(-a, a, k / n); ph = rad(deg); d = Vector((math.sin(ph), math.cos(ph), 0)); row.append(Vector((0, ctr_y, z)) + d * (rr[k] + off + fold(deg, z, j / m)))
        prev = rr; rows.append(row)
    return rows


def scarf_ring(ctr, rx, ry, tr, n=22, seed=1.0, slot='face', squash=0.8):
    secs = []
    for k in range(n):
        a = 2 * math.pi * k / n; c = Vector((ctr.x + rx * math.cos(a), ctr.y + ry * math.sin(a), ctr.z + 0.012 * math.sin(a * 2 + seed) - 0.02 * math.sin(a))); rad_ = Vector((math.cos(a), math.sin(a), 0))
        r = tr * (1 + 0.22 * math.sin(a * 5 + seed) + 0.12 * math.sin(a * 9 + 2 * seed)); secs.append(ellipse(c, rad_, U, r, r * squash, 8, 2.0, a0=seed + a * 0.7))
    return part('scarf', loft(secs, cap=False, close=True), slot)


def rig_parts(C, n_mag=4, slot_v='vest'):
    """胸挂（敌军 / 狙击手）：胸前一排弹匣袋 + H 形背带 + 腰侧系带。"""
    T = C.T; out = []; off = 0.010; th = 0.014
    out.append(sheet('rigF', panel_rows(T, np.linspace(1.185, 1.365, 5), lambda z: 0.158, off, 9, flat=0.25), slot_v, lambda q: F, th, bevel=0.004))
    xs = np.linspace(-0.112, 0.112, n_mag)
    for x in xs:
        y = panel_y(T, x, 1.27, off, flat=0.25) + th; ry = math.atan2(panel_y(T, x + 0.02, 1.27, off, flat=0.25) - panel_y(T, x - 0.02, 1.27, off, flat=0.25), 0.04)
        out.append(part('rmag', box(0.064, 0.032, 0.152, (x, y + 0.014, 1.268), (0, 0, ry)), 'pouch', bevel=0.006, seg=2))
        out.append(part('rflap', box(0.068, 0.036, 0.05, (x, y + 0.015, 1.325), (0, 0, ry)), slot_v, bevel=0.006, seg=2))
        out.append(part('rtab', box(0.016, 0.005, 0.03, (x, y + 0.034, 1.3), (0, 0, ry)), 'dark', bevel=0.0015))
    for sg in (1, -1):
        out.append(sheet('hstrapS', over_shoulder(C.SF, sg * 0.072, sg * 0.108, rad(24), rad(158), 0.006), 'strap', lambda q: q - Vector((q.x, 0, 1.40)), 0.005, bevel=0.0015))
    out.append(sheet('rigbelt', ring_rows(T, 0, 0, (1.235, 1.272), 26, 0.006, rad(-40), rad(220)), 'strap', out_from(0, 0), 0.004))
    yb = panel_y(T, 0, 1.33, 0.006, back=True)
    out.append(part('yoke', box(0.19, 0.008, 0.045, (0, yb - 0.004, 1.335)), 'strap', bevel=0.002))
    for o in out: rigid(o, 'spine')
    return out


def kit_friend(C):
    return helmet_parts(C) + carrier_parts(C)


def kit_enemy(C):
    ez = C.ez; out = []; ctr = Vector((0, C.yc, ez + 0.02))
    def low(deg): d = abs(deg); return lerp(ez + 0.03, ez - 0.14, sstep(40, 95, d))                    # 前额只压到眉上，两侧和后脑一直包到脖子
    def fold(deg, z, tt): return 0.0035 * math.sin(z * 105 + 2.2 * math.sin(rad(deg) * 2)) + 0.012 * math.exp(-((z - (ez + 0.058)) / 0.022) ** 2) * (1 + 0.25 * math.sin(rad(deg) * 3)) + 0.0025 * math.sin(rad(deg) * 5 + z * 30)
    wrap = sheet('wrap', wrap_rows(C.H, ctr, low, 34, 14, 0.012, fold), 'face', lambda q: q - ctr, 0.0, close=True)
    rim(wrap, 0.008); out.append(wrap)
    vf = lambda deg, z, tt: 0.003 * math.sin(z * 110 + 2 * math.sin(rad(deg) * 3)) + 0.005 * tt
    veil = sheet('veil', veil_rows(C.H, 0.015, ez - 0.019, ez - 0.185, 118, 22, 11, 0.011, vf), 'face', out_from(0, 0.015), 0.0)
    rim(veil, 0.006); out.append(veil)
    out.append(scarf_ring(Vector((0, 0.012, ez - 0.185)), 0.088, 0.098, 0.03, seed=1.3))
    # 垂在胸前的巾角
    rows = []
    for j in range(6):
        v = j / 5; z = lerp(ez - 0.19, ez - 0.36, v); row = []
        for k in range(5):
            u = k / 4; x = lerp(0.015, 0.105, u) - 0.02 * v; y = (C.T.front(x, z)[0] or Vector((x, 0.12, z))).y; row.append(Vector((x, y + 0.03 + 0.006 * math.sin(u * 9 + v * 4) - 0.012 * v, z + 0.012 * math.sin(u * 3.1))))
        rows.append(row)
    tail = sheet('tail', rows, 'face', lambda q: F, 0.0); rim(tail, 0.006); out.append(tail)
    for o in out: rigid(o, 'head')
    rigid(tail, 'spine')
    return out + rig_parts(C, 4)


def kit_sniper(C):
    ez = C.ez; out = []; ctr = Vector((0, C.yc - 0.004, ez + 0.02)); rnd = random.Random(11)
    def low(deg): d = abs(deg); return lerp(ez + 0.036, ez - 0.16, sstep(35, 90, d))
    def fold(deg, z, tt):
        d = abs(deg); peak = 0.026 * math.exp(-(d / 34.0) ** 2) * math.exp(-((z - (ez + 0.05)) / 0.03) ** 2)        # 帽檐前探
        return 0.010 + peak + 0.004 * math.sin(z * 80 + 2 * math.sin(rad(deg) * 2)) + 0.012 * sstep(120, 180, d) * sstep(ez + 0.05, ez - 0.1, z)
    hood = sheet('hood', wrap_rows(C.H, ctr, low, 34, 14, 0.012, fold), 'helmet', lambda q: q - ctr, 0.0, close=True); rim(hood, 0.01); out.append(hood)
    vf = lambda deg, z, tt: 0.003 * math.sin(z * 100 + 2 * math.sin(rad(deg) * 3)) + 0.006 * tt
    veil = sheet('veil', veil_rows(C.H, 0.015, ez - 0.022, ez - 0.2, 112, 22, 11, 0.012, vf), 'face', out_from(0, 0.015), 0.0); rim(veil, 0.006); out.append(veil)
    for o in out: rigid(o, 'head')
    # 披肩：从领口向外向下铺在肩背上，边缘参差
    n = 30; cols = []
    for k in range(n):
        a = 2 * math.pi * k / n; col = []; hang = None
        for i in range(8):
            rho = 0.085 + 0.034 * i
            if hang is None:
                x = 1.22 * rho * math.cos(a); y = 0.012 + (0.78 if math.sin(a) > 0 else 1.0) * rho * math.sin(a); h, _ = C.SF.down(x, y)
                if h is not None and h.z > 1.36 and (not col or h.z > col[-1].z - 0.05): col.append(Vector((x, y, h.z + 0.02))); continue
                hang = col[-1].copy() if col else Vector((x, y, 1.5))
            hang = hang + Vector((math.cos(a) * 0.013, math.sin(a) * 0.013, -0.04 - 0.016 * rnd.random())); col.append(hang.copy())
        cols.append(col)
    rows = [[cols[k][i] for k in range(n)] for i in range(8)]
    cape = sheet('cape', rows, 'vest', lambda q: U, 0.0, close=True, subd=1); rim(cape, 0.008); out.append(bind_from(cape, C.shell_co, C.shell_W))
    # 伪装布条：挂在兜帽和披肩上
    def strip(base, down, w, L, slot, bone):
        d = Vector(down).normalized(); sd = d.cross(Vector((base[0], base[1] - 0.01, 0)).normalized()).normalized(); nr = sd.cross(d)
        secs = [[c + sd * (w * k) + nr * 0.002, c + nr * 0.007, c - sd * (w * k) + nr * 0.002, c - nr * 0.002] for c, k in ((Vector(base) + d * (L * t) + nr * (0.01 * math.sin(t * 5 + base[0] * 40)), kk) for t, kk in ((0, 0.7), (0.35, 1.0), (0.7, 0.85), (1.0, 0.25)))]
        return rigid(part('rag', loft(secs), slot), bone)
    for i in range(64):
        a = rnd.uniform(0, 2 * math.pi); rho = rnd.uniform(0.11, 0.30); x = 1.22 * rho * math.cos(a); y = 0.012 + (0.78 if math.sin(a) > 0 else 1.0) * rho * math.sin(a); h, _ = C.SF.down(x, y)
        if h is None or h.z < 1.2: continue
        out.append(strip((x, y, h.z + 0.02), (x * 0.5, (y - 0.01) * 0.5, -1), rnd.uniform(0.013, 0.022), rnd.uniform(0.08, 0.16), rnd.choice(('cloth', 'helmet', 'vest')), 'spine'))
    for i in range(26):
        deg = rnd.uniform(-180, 180); z = rnd.uniform(ez - 0.06, ez + 0.1); ph = rad(deg); d = Vector((math.sin(ph), math.cos(ph), 0)); o = Vector((0, C.yc, z)); h, _ = C.H.ray(o + d * 0.6, -d)
        if h is None or abs(deg) < 78: continue
        out.append(strip(tuple(h + d * 0.028), (d.x * 0.35, d.y * 0.35, -1), rnd.uniform(0.01, 0.017), rnd.uniform(0.06, 0.11), rnd.choice(('cloth', 'helmet', 'face')), 'head'))
    return out + rig_parts(C, 3)


# ============================ 收尾与预览 ============================
def finalize(ob, others=()):
    ao = bake_ao([ob] + list(others), targets=[ob])[ob.name]; box_uv(ob); write_col(ob, ao)
    return ob


def variant_show(groups, variant):
    """只显示某个阵营的网格，并把预览色写成该阵营的调色板。"""
    for name, ob in groups.items():
        vis = name in ('base', 'head') or name == 'kit_' + variant
        ob.hide_render = not vis
        if vis: write_prev(ob, variant)


def proxy_gun(rig):
    gx, gy = 0.085, 1.37; Z = lambda z: z + 0.05; bm = bmesh.new()
    for sx, sy, sz, x, y, z, rx in ((0.036, 0.022, 0.092, gx, gy - 0.02, Z(-0.045), 0), (0.034, 0.17, 0.072, gx, gy - 0.016, Z(-0.14), 0), (0.044, 0.27, 0.076, gx, gy - 0.004, Z(-0.37), 0), (0.03, 0.058, 0.155, gx, gy - 0.1, Z(-0.44), -0.2),
                                    (0.03, 0.042, 0.1, gx, gy - 0.08, Z(-0.285), 0.35), (0.046, 0.27, 0.058, gx, gy, Z(-0.635), 0), (0.02, 0.2, 0.02, gx, gy, Z(-0.86), 0), (0.036, 0.07, 0.048, gx, gy + 0.07, Z(-0.4), 0)):
        join(bm, box(sx, sy, sz, g2b(x, y, z), (-rx, 0, 0)))
    ob = mesh_obj('proxygun', bm, False); rigid(ob, 'gun'); skin_to(ob, rig); m = bpy.data.materials.new('gun'); m.use_nodes = True
    next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.02, 0.02, 0.022, 1); ob.data.materials.append(m); ob.hide_render = True
    return ob


VIEWS = [('front', (0, 4.2, 1.0), (0, 0, 0.95), dict(fov=27)), ('q34', (2.6, 3.2, 1.45), (0, 0, 0.98), dict(fov=27)), ('back', (-1.2, -4.0, 1.3), (0, 0, 0.95), dict(fov=27)),
         ('face', (0.2, 0.62, 1.72), (0, 0.02, 1.685), dict(fov=30)), ('upper', (0.75, 1.35, 1.55), (0, 0, 1.38), dict(fov=34)), ('legs', (1.3, 1.5, 0.75), (0.05, 0, 0.55), dict(fov=34)), ('hand', (0.75, 0.55, 1.0), (0.22, 0, 0.9), dict(fov=20)), ('boot', (0.75, 0.75, 0.42), (0.1, 0, 0.2), dict(fov=24))]


# ============================ 主流程 ============================
t0 = time.time(); reset()
B = load_body(); repose(B); W = game_weights(B)
if STAGE == 'body':
    ob = body_object(B); clay(ob); rig = make_rig(); set_groups(ob, W); skin_to(ob, rig); markers()
    setup_render(None, res=(900, 1100), samples=16)
    shoot(os.path.join(PRE, 'soldier_dbg_body_front.png'), (0, 5, 0.92), (0, 0, 0.92), ortho=1.95)
    shoot(os.path.join(PRE, 'soldier_dbg_body_side.png'), (5, 0, 0.92), (0, 0, 0.92), ortho=1.95)
    sys.exit(0)

shell = build_shell(B, W)
head_parts = build_head(B, W); C = make_ctx(shell, head_parts[0], B)
common = build_common(shell)
kits = {'friend': kit_friend(C), 'enemy': kit_enemy(C), 'sniper': kit_sniper(C)}
if '--stretch' in argv:
    for k, objs in kits.items():
        for o in objs:
            zs_ = [v.co.z for v in o.data.vertices]
            if min(zs_) < 1.1: print('[low]', k, o.name, 'z %.3f..%.3f' % (min(zs_), max(zs_)), len(zs_))
wrinkle(shell); tuck(shell); decimate(shell, SHELL_RATIO); rim(shell)
base = join_objs([shell] + common + build_boot(1) + build_boot(-1) + build_glove(1) + build_glove(-1), 'base')
head = join_objs(head_parts, 'head')
groups = {'base': base, 'head': head}
for k, objs in kits.items(): groups['kit_' + k] = join_objs(objs, 'kit_' + k)
finalize(base, [head]); finalize(head, [base])
for k in kits: finalize(groups['kit_' + k], [base, head])
rig = make_rig()
for ob in groups.values(): skin_to(ob, rig)
for name, ob in groups.items(): print('[soldier] %-11s %6d verts %6d tris' % (name, len(ob.data.vertices), sum(len(p.vertices) - 2 for p in ob.data.polygons)))
if not NOEXPORT:
    path = os.path.join(OUT, 'soldier.glb'); export_glb(path, [rig] + list(groups.values()))
    try:
        import glbpack; glbpack.pack(path)      # 顶点色压成 uint8、法线压成 int16
    except Exception as e: print('[soldier] glbpack skipped:', e)
    print('[soldier] exported %s %.2f MB' % (path, os.path.getsize(path) / 1048576))
if '--stretch' in argv:
    # 调试：摆出瞄准姿势后找被拉长的边（权重有问题的顶点）
    pose_game(rig, run=0.0, target=True); dg = bpy.context.evaluated_depsgraph_get()
    for name, ob in groups.items():
        ev = ob.evaluated_get(dg); me2 = ev.to_mesh(); me = ob.data; slot = get_attr(ob, 'slot', 0); Wd = get_groups(ob); bad = {}
        for e in me.edges:
            a_, b_ = e.vertices; r0 = (me.vertices[a_].co - me.vertices[b_].co).length; r1 = (me2.vertices[a_].co - me2.vertices[b_].co).length
            if r1 > 0.06 and r1 > 3 * r0:
                for i in (a_, b_):
                    key = (SLOTS[int(slot[i])], tuple(BONES[j][0] for j in np.nonzero(Wd[i] > 0.01)[0])); bad.setdefault(key, []).append(tuple(round(c, 3) for c in me.vertices[i].co))
        for k, v in bad.items(): print('[stretch]', name, k, len(v), v[:6])
        reg = {}
        for v in me2.vertices:
            if abs(v.co.x - 0.02) < 0.05 and 0.42 < v.co.z < 0.7:
                key = (SLOTS[int(slot[v.index])], tuple(BONES[j][0] for j in np.nonzero(Wd[v.index] > 0.01)[0])); reg.setdefault(key, []).append((tuple(round(c, 3) for c in me.vertices[v.index].co), tuple(round(c, 3) for c in v.co)))
        for k, v in reg.items(): print('[between]', name, k, len(v), v[:4])
        ev.to_mesh_clear()
    rest_pose(rig)
if PREVIEW:
    setup_render(os.path.join(ROOT, 'assets', 'sky.hdr'), res=(820, 1100), samples=24); gun = proxy_gun(rig)
    for variant in VARIANTS:
        variant_show(groups, variant); rest_pose(rig)
        for tag, loc, look, kw in VIEWS:
            if tag in SHOTS or not SHOTS: shoot(os.path.join(PRE, 'soldier_%s_%s.png' % (variant, tag)), loc, look, **kw)
        if not SHOTS or 'pose' in SHOTS:
            gun.hide_render = False
            pose_game(rig, run=0.0, target=True, L2=IKL2); shoot(os.path.join(PRE, 'soldier_%s_aim.png' % variant), (1.7, 2.7, 1.55), (0, 0, 1.02), fov=27)
            pose_game(rig, run=1.0, ph=1.3, target=False, L2=IKL2); shoot(os.path.join(PRE, 'soldier_%s_run.png' % variant), (3.0, 1.6, 1.25), (0, 0.1, 0.95), fov=27)
            pose_game(rig, cw=1.0, target=True, aim=0.1, L2=IKL2); shoot(os.path.join(PRE, 'soldier_%s_crouch.png' % variant), (2.3, 2.3, 1.0), (0, 0, 0.72), fov=27)
            gun.hide_render = True
print('[soldier] done %.1fs' % (time.time() - t0))
