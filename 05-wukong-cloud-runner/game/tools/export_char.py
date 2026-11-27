"""把影片里的写实悟空导出成游戏用的实时资产。
用法（在 wukong/ 下）：Blender -b -P game/tools/export_char.py -- [tex] [body]   （不写参数 = 贴图 + 身体都做；另有 cape = 导出影片的披风布料序列，已不再使用）

产出（game/assets/char/）：
  wukong.glb        骨架（65 根 mixamo 骨骼）+ 蒙皮身体（减面）+ 毛发壳层用的低模（只含毛发区域）+ 金箍棒（挂在右手骨骼上）
                    顶点自定义属性 _FUR = (手臂毛, 虎皮裙毛, 头部毛) 权重
  body_color_4k.jpg / body_color_2k.jpg / body_normal_4k.jpg / body_normal_2k.jpg / body_orm_2k.jpg
  cape_vat.bin      披风布料解算的"几何图"序列：float16 RGBA，[帧][沿长度 j][横向 i]，值 = Spine2 骨骼局部坐标（Blender 骨骼空间）
  meta.json         骨骼静止矩阵（three 坐标）、披风网格/帧信息、毛长、包围盒等
"""
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
ROOT = os.path.dirname(GAME)
SRC = os.path.join(ROOT, 'assets', 'char', 'wukong_real_final.blend')
OUT = os.path.join(GAME, 'assets', 'char')
B = 'mixamorig:'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DO = lambda k: (not argv) or (k in argv)

BODY_TRIS = 185000          # 身体目标三角形数
FUR_TRIS = 20000            # 毛发壳层低模的目标三角形数
CAPE_F0, CAPE_N, CAPE_K = 40, 120, 24     # 披风循环：从第 40 帧起取 120 帧（5 秒），末尾 24 帧与开头交叉淡化成无缝循环
FUR_LEN = {'arm': 0.026, 'tiger': 0.019, 'head': 0.032}      # 影片里三处毛的长度（米，世界单位）

# Blender (x, y, z) → three (x, z, -y)
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def col_major(m):
    return [round(float(m[r][c]), 7) for c in range(4) for r in range(4)]


os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
arm = bpy.data.objects['WK_Armature']
body = bpy.data.objects['WK_Body']
cape = bpy.data.objects['WK_Cape']
staff = bpy.data.objects['WK_Staff']
meta_path = os.path.join(OUT, 'meta.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}

# ------------------------------------------------------------------ 披风：布料解算 → 几何图序列
if 'cape' in argv:          # 第一版披风用的布料序列；现在披风是游戏里实时解算的，默认不再导出
    t0 = time.time()
    me = cape.data
    nv = len(me.vertices)
    uv = np.zeros((nv, 2))
    uvl = me.uv_layers[0].data
    for lp in me.loops:
        uv[lp.vertex_index] = uvl[lp.index].uv
    frames = list(range(CAPE_F0, CAPE_F0 + CAPE_N + CAPE_K))
    P = np.zeros((len(frames), nv, 3), dtype=np.float64)
    pb = arm.pose.bones[B + 'Spine2']
    for fi, f in enumerate(frames):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = cape.evaluated_get(dg)
        co = np.empty(nv * 3)
        ev.data.vertices.foreach_get('co', co)
        co = co.reshape(nv, 3)
        mw = np.array(ev.matrix_world)
        wco = co @ mw[:3, :3].T + mw[:3, 3]
        bw = np.array((arm.evaluated_get(dg).matrix_world @ arm.evaluated_get(dg).pose.bones[B + 'Spine2'].matrix).inverted())
        P[fi] = wco @ bw[:3, :3].T + bw[:3, 3]
    # 网格拓扑：UV 是规则格子。找出两个方向的格点数
    uu = np.unique(np.round(uv[:, 0], 4)); vv = np.unique(np.round(uv[:, 1], 4))
    print('CAPE verts', nv, 'unique u', len(uu), 'unique v', len(vv), 'uv range', uv.min(0).round(3), uv.max(0).round(3), flush=True)
    # 哪个 UV 方向是"沿长度"、哪一端是领口：领口那排在骨骼空间里几乎不动
    var = P.std(axis=0).sum(axis=1)
    def end_var(axis, hi):
        sel = uv[:, axis] > uv[:, axis].max() - 0.02 if hi else uv[:, axis] < uv[:, axis].min() + 0.02
        return var[sel].mean()
    cand = {(a, h): end_var(a, h) for a in (0, 1) for h in (False, True)}
    (la, pinned_hi), _ = min(cand.items(), key=lambda kv: kv[1])
    ca = 1 - la
    print('CAPE length axis = uv[%d], collar at %s end; end variances' % (la, 'high' if pinned_hi else 'low'), {k: round(v, 4) for k, v in cand.items()}, flush=True)
    n_len = (len(vv) if la == 1 else len(uu)); n_cross = (len(uu) if la == 1 else len(vv))
    GY = (n_len - 1) // 2 + 1; GX = (n_cross - 1) // 2 + 1         # 取隔点（解算时的原始格子）
    kd = KDTree(nv)
    for i in range(nv):
        kd.insert((uv[i, 0], uv[i, 1], 0.0), i)
    kd.balance()
    lo, hi = uv.min(0), uv.max(0)
    idx = np.zeros((GY, GX), dtype=np.int64); err = 0.0
    for j in range(GY):
        tl = j / (GY - 1)
        if pinned_hi:
            tl = 1 - tl
        for i in range(GX):
            tc = i / (GX - 1)
            q = [0.0, 0.0, 0.0]
            q[la] = lo[la] + (hi[la] - lo[la]) * tl
            q[ca] = lo[ca] + (hi[ca] - lo[ca]) * tc
            co_, k, d = kd.find(q)
            idx[j, i] = k; err = max(err, d)
    G = P[:, idx, :]                                               # [帧, GY, GX, 3]
    # 横向方向统一成"角色的左 → 右"：看第一排的世界 y（Blender +Y 是角色左侧）
    scene.frame_set(frames[0])
    dg = bpy.context.evaluated_depsgraph_get()
    bwm = arm.evaluated_get(dg).matrix_world @ arm.evaluated_get(dg).pose.bones[B + 'Spine2'].matrix
    y0 = (bwm @ Vector(G[0, 0, 0])).y; y1 = (bwm @ Vector(G[0, 0, -1])).y
    if y0 < y1:
        G = G[:, :, ::-1, :]
    # 无缝循环：开头 K 帧与循环末尾之后的 K 帧交叉淡化
    L = np.empty((CAPE_N, GY, GX, 3))
    L[:] = G[:CAPE_N]
    for i in range(CAPE_K):
        t = i / CAPE_K
        t = t * t * (3 - 2 * t)
        L[i] = G[CAPE_N + i] * (1 - t) + G[i] * t
    seam = np.abs(L[0] - G[CAPE_N - 1 + 1]).max() if True else 0
    step = np.abs(np.diff(L, axis=0)).max()
    out = np.ones((CAPE_N, GY, GX, 4), dtype=np.float16)
    out[..., :3] = L.astype(np.float16)
    out.tofile(os.path.join(OUT, 'cape_vat.bin'))
    collar = L[:, 0].mean(axis=(0, 1)); hem = L[:, -1].mean(axis=(0, 1))
    meta['cape'] = dict(file='cape_vat.bin', frames=CAPE_N, gx=int(GX), gy=int(GY), fps=24, bone='Spine2',
                        length=round(float(np.linalg.norm(np.diff(L[0, :, GX // 2], axis=0), axis=1).sum()), 4),
                        collar=[round(float(v), 4) for v in collar], hem=[round(float(v), 4) for v in hem])
    json.dump(meta, open(meta_path, 'w'), indent=1)
    print('CAPE grid %dx%d frames %d  uv match err %.5f  max frame step %.4f  bbox' % (GX, GY, CAPE_N, err, step), L.min(axis=(0, 1, 2)).round(3), L.max(axis=(0, 1, 2)).round(3), '%.1fs' % (time.time() - t0), flush=True)

# ------------------------------------------------------------------ 贴图
if DO('tex'):
    imgs = {}
    for n in body.material_slots[0].material.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            nm = n.image.name
            key = 'color' if nm.startswith('Color') else 'orm' if nm.startswith('ORM') else 'normal' if nm.startswith('Normal') else None
            if key:
                imgs[key] = n.image
    for key, img in imgs.items():
        img = img.copy()
        img.file_format = 'JPEG'
        for size, q in ((4096, 90), (2048, 90)):
            if key == 'orm' and size == 4096:
                continue
            if img.size[0] != size:
                img.scale(size, size)
            fp = os.path.join(OUT, 'body_%s_%dk.jpg' % (key, size // 1024))
            img.filepath_raw = fp
            img.save(filepath=fp, quality=q)
            print('TEX', os.path.basename(fp), os.path.getsize(fp) // 1024, 'KB', flush=True)

# ------------------------------------------------------------------ 身体减面 + 毛发低模 + GLB
if DO('body'):
    t0 = time.time()
    scene.frame_set(1)
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()

    def bone_rest_world(name):
        return arm.matrix_world @ arm.data.bones[B + name].matrix_local

    # 静止姿态下的关键矩阵（three 坐标，列主序），给 JS 里挂披风/对齐用
    meta['bones_rest'] = {n: col_major(C @ bone_rest_world(n)) for n in ('Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightHand', 'LeftHand')}
    meta['staff_world'] = col_major(C @ staff.matrix_world)
    hb = arm.data.bones[B + 'Head']
    meta['head_center'] = [round(v, 4) for v in (C @ (arm.matrix_world @ ((hb.head_local + hb.tail_local) * 0.5)).to_4d()).to_3d()]
    meta['armature_scale'] = round(arm.matrix_world.to_scale().x, 5)
    meta['fur_len'] = FUR_LEN

    for md in list(body.modifiers):
        if md.type == 'PARTICLE_SYSTEM':
            body.modifiers.remove(md)
    me = body.data
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    for p in me.polygons:
        p.material_index = 0
    while len(body.material_slots) > 1:
        body.active_material_index = len(body.material_slots) - 1
        with bpy.context.temp_override(object=body, active_object=body, selected_objects=[body]):
            bpy.ops.object.material_slot_remove()

    bm = bmesh.new(); bm.from_mesh(me)
    nv0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me); bm.free(); me.update()
    print('BODY weld %d -> %d verts' % (nv0, len(me.vertices)), flush=True)

    # 减面权重：脸、手少减一些
    nv = len(me.vertices)
    keep_bones = {g.index for g in body.vertex_groups if any(k in g.name for k in ('Head', 'Neck', 'Hand'))}
    wdec = body.vertex_groups.new(name='dec_w')
    kv = []
    for v in me.vertices:
        s = sum(g.weight for g in v.groups if g.group in keep_bones)
        kv.append(s)
    kv = np.array(kv)
    wdec.add([i for i in range(nv) if kv[i] <= 0.5], 1.0, 'REPLACE')
    wdec.add([i for i in range(nv) if kv[i] > 0.5], 0.4, 'REPLACE')
    print('BODY keep-region verts %d / %d' % (int((kv > 0.5).sum()), nv), flush=True)

    def decimate(ob, target, vg=None):
        nf = len(ob.data.polygons)
        md = ob.modifiers.new('Dec', 'DECIMATE')
        md.ratio = min(1.0, target / nf)
        if vg:
            md.vertex_group = vg; md.vertex_group_factor = 1.0
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            while ob.modifiers.find('Dec') > 0:
                bpy.ops.object.modifier_move_up(modifier='Dec')
            bpy.ops.object.modifier_apply(modifier='Dec')
        ob.data.calc_loop_triangles()
        return len(ob.data.loop_triangles)

    bpy.context.view_layer.objects.active = body
    nt = decimate(body, BODY_TRIS, 'dec_w')
    if nt > BODY_TRIS * 1.15:                                       # 带权重时实际面数会偏多，再补一刀
        nt = decimate(body, BODY_TRIS, None)
    body.vertex_groups.remove(body.vertex_groups['dec_w'])
    for p in body.data.polygons:
        p.use_smooth = True
    print('BODY tris', nt, 'verts', len(body.data.vertices), '%.1fs' % (time.time() - t0), flush=True)

    # 左手掌和额头的网格粘在一起、权重互相掺着：手一离开额头就拉出一张膜。
    # 做法照 video2rig 的 wukong_build_rig.py：同时带"左手系"和"头/脖子"权重的顶点按多的一方归属；
    # 再把左臂摆几个远离额头的测试姿势，删掉手和头之间被拉长的面。
    def fix_head_hand_weights():
        me = body.data
        gname = {g.index: g.name for g in body.vertex_groups}
        hand = {i for i, nm in gname.items() if nm.startswith(B + 'LeftHand')}
        headg = {i for i, nm in gname.items() if nm.split(':')[-1] in ('Head', 'Neck', 'HeadTop_End')}
        hg = body.vertex_groups[B + 'Head']
        nfix = 0
        for v in me.vertices:
            hw = {g.group: g.weight for g in v.groups if g.group in hand}
            dw = {g.group: g.weight for g in v.groups if g.group in headg}
            if not hw or not dw:
                continue
            nfix += 1
            if sum(dw.values()) >= sum(hw.values()):
                for gi in hw:
                    body.vertex_groups[gi].remove([v.index])
                hg.add([v.index], sum(hw.values()), 'ADD')
            else:
                best = max(hw, key=hw.get)
                for gi in dw:
                    body.vertex_groups[gi].remove([v.index])
                body.vertex_groups[best].add([v.index], sum(dw.values()), 'ADD')
        n = len(me.vertices)
        rest_co = np.empty(n * 3); me.vertices.foreach_get('co', rest_co); rest_co = rest_co.reshape(n, 3)
        touch = np.zeros(n, bool)
        for v in me.vertices:
            if any((g.group in hand or g.group in headg) and g.weight > 0 for g in v.groups):
                touch[v.index] = True
        bm_ = bmesh.new(); bm_.from_mesh(me); bm_.verts.ensure_lookup_table()
        faces = [(f, [vv.index for vv in f.verts]) for f in bm_.faces]
        faces = [(f, ids) for f, ids in faces if touch[ids].any()]
        kill = set()
        pa, pf = arm.pose.bones[B + 'LeftArm'], arm.pose.bones[B + 'LeftForeArm']
        poses = [(ax, s * ang) for ax in ('X', 'Y', 'Z') for s in (-1, 1) for ang in (math.radians(45), math.radians(80))]
        for ax, ang in poses:
            pa.matrix_basis = Matrix.Rotation(ang, 4, ax)
            pf.matrix_basis = Matrix.Rotation(-ang * 0.6, 4, ax)
            bpy.context.view_layer.update()
            dg_ = bpy.context.evaluated_depsgraph_get()
            ev = body.evaluated_get(dg_).data
            posed = np.empty(n * 3); ev.vertices.foreach_get('co', posed); posed = posed.reshape(n, 3)
            for f, ids in faces:
                if f in kill:
                    continue
                for k in range(len(ids)):
                    a_, b_ = ids[k], ids[(k + 1) % len(ids)]
                    if np.linalg.norm(posed[a_] - posed[b_]) > 2.5 * np.linalg.norm(rest_co[a_] - rest_co[b_]) + 2e-3:
                        kill.add(f); break
        pa.matrix_basis.identity(); pf.matrix_basis.identity()
        bmesh.ops.delete(bm_, geom=list(kill), context='FACES_ONLY')
        bm_.to_mesh(me); bm_.free(); me.update()
        bpy.context.view_layer.update()
        print('WEIGHTFIX mixed verts', nfix, 'faces deleted', len(kill), flush=True)

    fix_head_hand_weights()

    def fur_attr(ob):
        m = ob.data
        gi = {ob.vertex_groups[n].index: k for k, n in enumerate(('fur_arm', 'fur_tiger', 'fur_head')) if n in ob.vertex_groups}
        arr = np.zeros((len(m.vertices), 3), dtype=np.float32)
        hand_groups = {g.index for g in ob.vertex_groups if 'Hand' in g.name}
        for v in m.vertices:
            hw = 0.0
            for g in v.groups:
                k = gi.get(g.group)
                if k is not None:
                    arr[v.index, k] = g.weight
                elif g.group in hand_groups:
                    hw += g.weight
            if hw > 0.15:                                           # 手背、手指上的毛要短很多，否则壳层会把手指糊成一团
                t = min(1.0, (hw - 0.15) / 0.5)
                arr[v.index] *= 1.0 - 0.8 * t * t * (3 - 2 * t)
        if '_FUR' in m.attributes:
            m.attributes.remove(m.attributes['_FUR'])
        a = m.attributes.new('_FUR', 'FLOAT_VECTOR', 'POINT')
        a.data.foreach_set('vector', arr.ravel())
        return arr

    fa = fur_attr(body)
    print('BODY fur verts', int((fa.max(1) > 0.05).sum()), flush=True)

    # 毛发壳层用的低模：只留毛发区域，再减面
    fur = body.copy(); fur.data = body.data.copy(); fur.name = 'WK_FurBase'; fur.data.name = 'WK_FurBase'
    for c in body.users_collection:
        c.objects.link(fur)
    fur.parent = body.parent; fur.matrix_parent_inverse = body.matrix_parent_inverse.copy()
    bm = bmesh.new(); bm.from_mesh(fur.data)
    fw = fa.max(1)
    dead = [f for f in bm.faces if max(fw[v.index] for v in f.verts) < 0.04]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(fur.data); bm.free()
    fur.data.update()
    nft = decimate(fur, FUR_TRIS)
    for p in fur.data.polygons:
        p.use_smooth = True
    fur_attr(fur)
    print('FUR base tris', nft, 'verts', len(fur.data.vertices), flush=True)

    # 骨骼权重组以外的组不需要带出去
    for ob in (body, fur):
        for n in ('fur_arm', 'fur_tiger', 'fur_head'):
            if n in ob.vertex_groups:
                ob.vertex_groups.remove(ob.vertex_groups[n])

    # 包围盒（three 坐标）
    co = np.array([(C @ (body.matrix_world @ body.data.vertices[i].co).to_4d()).to_3d() for i in range(0, len(body.data.vertices), 7)])
    meta['bbox'] = [[round(float(v), 4) for v in co.min(0)], [round(float(v), 4) for v in co.max(0)]]

    bpy.ops.object.select_all(action='DESELECT')
    for ob in (arm, body, fur, staff):
        ob.hide_set(False); ob.hide_viewport = False
        ob.select_set(True)
    bpy.context.view_layer.objects.active = arm
    fp = os.path.join(OUT, 'wukong.glb')
    kw = dict(filepath=fp, export_format='GLB', use_selection=True, export_apply=False, export_skins=True, export_animations=False,
              export_materials='PLACEHOLDER', export_attributes=True, export_normals=True, export_tangents=False, export_texcoords=True,
              export_morph=False, export_yup=True, export_cameras=False, export_lights=False, export_extras=False)
    try:
        r = bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        print('GLB kw retry:', str(e)[:200], flush=True)
        for k in ('export_attributes', 'export_extras', 'export_tangents'):
            kw.pop(k, None)
        r = bpy.ops.export_scene.gltf(**kw)
    print('GLB', r, os.path.getsize(fp) // 1024, 'KB', '%.1fs' % (time.time() - t0), flush=True)

json.dump(meta, open(meta_path, 'w'), indent=1)
print('META keys', sorted(meta.keys()), flush=True)
