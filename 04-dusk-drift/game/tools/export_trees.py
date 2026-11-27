# 从 race_scene.blend 的 TreeSrc 源模型生成游戏用的树：
#   <name>.glb        减面树（减面树干 + 叶簇卡片，卡片贴图由原模型渲染而来）
#   <name>_card.png   整棵树的正交侧视公告板（另附 _card_b.png：转 90° 的视角）
#   <name>_leaves.png 叶簇图集（已嵌入 GLB，这里另存一份）
#   Blender -b race_scene.blend -P export_trees.py -- <输出目录> [jacaranda,fir,tree_small_02] [nobillboard]
import bpy, bmesh, sys, os, math, json, time
import numpy as np
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import treelib as T

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
ONLY = argv[1].split(',') if len(argv) > 1 else ['jacaranda', 'fir', 'tree_small_02']
NOBILL = len(argv) > 2 and argv[2] == 'nobillboard'
TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tmp', 'trees')
os.makedirs(TMP, exist_ok=True)
D = bpy.data
rng = np.random.default_rng(7)

SPEC = {
    'jacaranda': dict(obj='jacaranda_tree_LOD0', trunk=['jacaranda_tree_trunk'], branch=['jacaranda_tree_branches'],
                      leaf=['jacaranda_tree_leaves'], keep_diag=1.2, wood_tris=7500, r=0.9, ncards=3000, factor=7.0, conifer=False),
    'fir': dict(obj='fir_tree_01_a_LOD0', trunk=['fir_tree_01_trunk_a'], branch=['fir_tree_01_bark', 'fir_tree_01_dead_branches'],
                leaf=['fir_tree_01_twig'], keep_diag=1.0, wood_tris=3000, r=0.9, ncards=4500, factor=9.0, conifer=True, cutoff=0.22),
    'fir_b': dict(obj='fir_tree_01_b_LOD0', trunk=['fir_tree_01_trunk_b'], branch=['fir_tree_01_bark', 'fir_tree_01_dead_branches'],
                  leaf=['fir_tree_01_twig'], keep_diag=1.0, wood_tris=2800, r=0.85, ncards=4500, factor=9.0, conifer=True, cutoff=0.22),
    'tree_small_02': dict(obj='tree_small_02_LOD0', trunk=['tree_small_02_trunk'], branch=['tree_small_02_branches'],
                          leaf=['tree_small_02_leaves'], keep_diag=0.3, wood_tris=3500, r=0.26, ncards=3000, factor=5.0, conifer=False),
}
NT = 16; G = 4; TS = 256      # 叶簇图集：4x4 共 16 块，每块 256 像素
NPROF = 10                    # 针叶树：前 10 块是从切向看的枝条侧面轮廓，其余是从外向里看的正面


# ----------------------------------------------------------------------------- 基础工具
def submesh(name, A, face_mask, mats):
    co, lv, ls, lt, mi, uv, pl = A
    fsel = np.nonzero(face_mask)[0]
    lmask = face_mask[pl]
    lidx = np.nonzero(lmask)[0]
    uniq, inv = np.unique(lv[lidx], return_inverse=True)
    me = D.meshes.new(name)
    me.vertices.add(len(uniq)); me.vertices.foreach_set('co', co[uniq].astype(np.float32).ravel())
    me.loops.add(len(lidx)); me.loops.foreach_set('vertex_index', inv.astype(np.int32))
    nlt = lt[fsel]
    nls = np.zeros(len(fsel), np.int32); nls[1:] = np.cumsum(nlt)[:-1]
    me.polygons.add(len(fsel)); me.polygons.foreach_set('loop_start', nls)
    me.polygons.foreach_set('material_index', mi[fsel].astype(np.int32))
    uvl = me.uv_layers.new(name='UVMap'); uvl.data.foreach_set('uv', uv[lidx].astype(np.float32).ravel())
    me.update(calc_edges=True)
    me.polygons.foreach_set('use_smooth', np.ones(len(fsel), bool))
    for m in mats:
        me.materials.append(m)
    return me


def new_obj(name, me, coll):
    o = D.objects.new(name, me)
    coll.objects.link(o)
    return o


def setup_gpu(sc):
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        print('gpu setup failed', e)


def make_bake_scene():
    sc = D.scenes.new('bake')
    sc.render.engine = 'CYCLES'
    setup_gpu(sc)
    sc.cycles.samples = 96
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 3; sc.cycles.transparent_max_bounces = 64
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0; sc.view_settings.gamma = 1.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.resolution_percentage = 100
    w = D.worlds.new('bake_world'); w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (1, 1, 1, 1); bg.inputs['Strength'].default_value = 1.15
    sc.world = w
    cam = D.objects.new('bake_cam', D.cameras.new('bake_cam'))
    cam.data.type = 'ORTHO'; cam.data.clip_start = 0.01; cam.data.clip_end = 500
    sc.collection.objects.link(cam); sc.camera = cam
    return sc, cam


def render_ortho(sc, cam, center, view_dir, width, height, res_x, res_y, path):
    """正交渲染：center 为画面中心（世界），view_dir 为视线方向；画面覆盖 width x height 米"""
    vd = Vector(view_dir).normalized()
    cam.location = Vector(center) - vd * 200.0
    cam.rotation_euler = vd.to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x = res_x; sc.render.resolution_y = res_y
    fa = width / height
    ra = res_x / res_y
    sc.render.pixel_aspect_x = 1.0; sc.render.pixel_aspect_y = 1.0
    if fa / ra >= 1.0:
        sc.render.pixel_aspect_x = fa / ra
    else:
        sc.render.pixel_aspect_y = ra / fa
    cam.data.ortho_scale = max(width, height)
    sc.render.filepath = path
    bpy.ops.render.render(scene=sc.name, write_still=True)


def load_rgba(path):
    img = D.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    D.images.remove(img)
    return px.reshape(h, w, 4)


def save_rgba(arr, path):
    h, w = arr.shape[:2]
    img = D.images.new('tmp_save', w, h, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    img.filepath_raw = path; img.file_format = 'PNG'
    img.save()
    D.images.remove(img)


def dilate(rgba, iters=32):
    """把颜色向透明区域扩散，避免采样时出现黑边"""
    rgb = rgba[..., :3].copy(); a = rgba[..., 3]
    valid = a > 0.03
    if not valid.any():
        return rgba
    rgb[~valid] = 0
    for _ in range(iters):
        if valid.all():
            break
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            v = np.roll(valid, (dy, dx), (0, 1)); c = np.roll(rgb, (dy, dx), (0, 1))
            acc += c * v[..., None]; cnt += v
        newv = (~valid) & (cnt > 0)
        rgb[newv] = acc[newv] / cnt[newv][:, None]
        valid = valid | newv
    if not valid.all():
        rgb[~valid] = rgb[valid].mean(axis=0)
    out = rgba.copy(); out[..., :3] = rgb
    return out


def patch_glb(path, fn):
    import struct
    with open(path, 'rb') as f:
        f.read(12); clen, _ = struct.unpack('<II', f.read(8)); g = json.loads(f.read(clen))
        blen, _ = struct.unpack('<II', f.read(8)); b = f.read(blen)
    fn(g)
    js = json.dumps(g, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(b)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)
    return g


# ----------------------------------------------------------------------------- 主流程
def process(name, S, bake, cam):
    t0 = time.time()
    src = D.objects[S['obj']]
    me = src.data
    co, lv, ls, lt, mi = T.mesh_arrays(me)
    uvl_src = me.uv_layers.active or (me.uv_layers[0] if len(me.uv_layers) else None)
    uv = np.zeros(len(lv) * 2, np.float32)
    if uvl_src is not None:
        uvl_src.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    pl = T.poly_of_loop(ls, lt)
    A = (co, lv, ls, lt, mi, uv, pl)
    mats = [s.material for s in src.material_slots]
    mname = [m.name if m else None for m in mats]
    idx = lambda names: [i for i, n in enumerate(mname) if n in names]
    f_trunk = np.isin(mi, idx(S['trunk'])); f_branch = np.isin(mi, idx(S['branch'])); f_leaf = np.isin(mi, idx(S['leaf']))
    ea, eb = T.loop_edges(lv, ls, lt)
    pfirst = lv[ls]
    fcent = np.zeros((len(ls), 3), np.float64)
    np.add.at(fcent, pl, co[lv]); fcent /= lt[:, None]

    def islands(fmask):
        lsel = fmask[pl]
        vs = np.unique(lv[lsel])
        remap = -np.ones(len(co), np.int64); remap[vs] = np.arange(len(vs))
        lab = T.components(len(vs), remap[ea[lsel]], remap[eb[lsel]])
        u, inv = np.unique(lab, return_inverse=True)
        c = co[vs]
        mn_ = np.full((len(u), 3), 1e9); mx_ = np.full((len(u), 3), -1e9)
        np.minimum.at(mn_, inv, c); np.maximum.at(mx_, inv, c)
        flab = np.full(len(ls), -1, np.int64)
        flab[fmask] = inv[remap[pfirst[fmask]]]
        return flab, (mn_ + mx_) / 2, np.linalg.norm(mx_ - mn_, axis=1)

    # ---- 木质部分：树干与粗枝分开减面（一起减的话，带开口边界的小枝会把预算吃光，树干被压坏）
    b_lab, b_cent, b_diag = islands(f_branch)
    tv = np.unique(lv[f_trunk[pl]])
    low = co[tv][co[tv][:, 2] < 0.6]
    base = np.array([low[:, 0].mean(), low[:, 1].mean(), 0.0])
    co = co - base.astype(np.float32); fcent = fcent - base; b_cent = b_cent - base
    A = (co, lv, ls, lt, mi, uv, pl)

    def decimated(tag, fmask, target):
        m0 = submesh(f'{name}_{tag}_src', A, fmask, [])
        t_in = int((lt[fmask] - 2).sum())
        bm = bmesh.new(); bm.from_mesh(m0)
        be = [e for e in bm.edges if e.is_boundary]
        if be:
            bmesh.ops.holes_fill(bm, edges=be, sides=0)       # 封住枝条断口，否则边界会挡住减面
        bm.to_mesh(m0); bm.free()
        o = new_obj(f'{name}_{tag}_src', m0, bpy.context.scene.collection)
        mod = o.modifiers.new('dec', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'
        mod.ratio = min(1.0, target / max(1, t_in))
        dg = bpy.context.evaluated_depsgraph_get()
        lo = D.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        D.objects.remove(o, do_unlink=True); D.meshes.remove(m0)
        bm = bmesh.new(); bm.from_mesh(lo)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(lo); bm.free()
        lo.polygons.foreach_set('use_smooth', np.ones(len(lo.polygons), bool))
        return lo, t_in, sum(len(p.vertices) - 2 for p in lo.polygons)

    trunk_lo, trunk_in, trunk_tris = decimated('trunk', f_trunk, S['wood_tris'] * S.get('trunk_share', 0.55))
    order = np.argsort(-b_diag); candb = order[b_diag[order] >= S['keep_diag']]
    budget = S['wood_tris'] - trunk_tris
    K = max(1, min(len(candb), int(budget / 60)))
    while True:
        keep = np.zeros(len(b_diag), bool); keep[candb[:K]] = True
        fmb = f_branch & (b_lab >= 0) & keep[np.clip(b_lab, 0, None)]
        br_lo, br_in, br_tris = decimated('branch', fmb, budget)
        if br_tris <= budget * 1.2 or K <= 1:
            break
        D.meshes.remove(br_lo); K = max(1, int(K * 0.6))
    wood_tris0 = trunk_in + br_in; wood_tris = trunk_tris + br_tris
    print(f'[{name}] trunk {trunk_in}->{trunk_tris}, branches: {K} islands {br_in}->{br_tris}')

    # ---- 叶片岛
    l_lab, l_cent, l_diag = islands(f_leaf)      # 此时 co 已平移到树干底部为原点
    leaf_v = co[np.unique(lv[f_leaf[pl]])]
    height = float(co[:, 2].max())
    rad = np.hypot(leaf_v[:, 0], leaf_v[:, 1])
    crown_r = float(np.percentile(rad, 95))
    crown_z0 = float(np.percentile(leaf_v[:, 2], 1)); crown_z1 = float(leaf_v[:, 2].max())
    print(f'[{name}] wood {wood_tris0}->{wood_tris} tris, leaf islands {len(l_cent)}, height {height:.2f}, crown r95 {crown_r:.2f}, crown z {crown_z0:.2f}..{crown_z1:.2f}  ({time.time()-t0:.1f}s)')

    cpt = np.array([0, 0, crown_z0 + 0.3 * (crown_z1 - crown_z0)])
    atlas_path = os.path.join(OUT, f'{name}_leaves.png')
    if S['conifer']:
        # ---- 针叶树：8 片过树干的竖直"鳍片"，每片贴上对应 45° 扇区内枝叶的侧视图（细碎的叶簇卡片表现不了下垂的枝条）
        KF = 8; SW, SH = 128, 1024; NV = 6
        R = float(np.percentile(rad, 99.7)) * 1.04
        Htop = height * 1.01
        az = np.arctan2(fcent[:, 1], fcent[:, 0])
        f_fol = f_leaf | f_branch
        atlas = np.zeros((SH, SW * KF, 4), np.float32)
        fv = []; fuv = []; floops = []
        for k in range(KF):
            phi = 2 * math.pi * (k + 0.37) / KF
            rh = np.array([math.cos(phi), math.sin(phi), 0.0])
            dphi = np.abs((az - phi + math.pi) % (2 * math.pi) - math.pi)
            sm = submesh(f'{name}_fin{k}', A, f_fol & (dphi < math.pi / KF), mats)
            so = new_obj(f'{name}_fin{k}', sm, bake.collection)
            path = os.path.join(TMP, f'{name}_fin{k}.png')
            render_ortho(bake, cam, rh * (R / 2) + np.array([0, 0, Htop / 2]), np.cross([0.0, 0.0, 1.0], rh), R, Htop, SW, SH, path)
            D.objects.remove(so, do_unlink=True); D.meshes.remove(sm)
            t = dilate(load_rgba(path))
            atlas[:, k * SW:(k + 1) * SW] = t
            print(f'[{name}] fin {k}: coverage {float((t[..., 3] > 0.3).mean()):.2f}')
            ins = 1.5 / (SW * KF)
            for j in range(NV):
                va, vb = j / NV, (j + 1) / NV
                q = [(0.0, va), (1.0, va), (1.0, vb), (0.0, vb)]
                b0 = len(fv)
                for rep_ in range(2):                      # 正面 4 顶点 + 背面 4 顶点
                    for (uu, vv) in q:
                        fv.append(rh * (uu * R) + np.array([0, 0, vv * Htop]))
                        fuv.append(((k + uu) / KF + (ins if uu == 0 else -ins), vv))
                floops += [b0, b0 + 1, b0 + 2, b0 + 3, b0 + 4, b0 + 7, b0 + 6, b0 + 5]
        save_rgba(atlas, atlas_path)
        verts = np.array(fv); n = KF; win = R
        nq = len(floops) // 4
        cme = D.meshes.new(name + '_cards')
        cme.vertices.add(len(verts)); cme.vertices.foreach_set('co', verts.astype(np.float32).ravel())
        cme.loops.add(len(floops)); cme.loops.foreach_set('vertex_index', np.array(floops, np.int32))
        cme.polygons.add(nq); cme.polygons.foreach_set('loop_start', (np.arange(nq) * 4).astype(np.int32))
        uvl = cme.uv_layers.new(name='UVMap'); uvl.data.foreach_set('uv', np.array(fuv, np.float32)[np.array(floops)].ravel())
        cme.update(calc_edges=True)
        cme.polygons.foreach_set('use_smooth', np.ones(nq, bool))
    else:
        # ---- 叶簇图块：在树冠外层选 4 个种子，取球内的叶片岛 + 细枝渲染
        r = S['r']; win = 2.05 * r
        lr = np.hypot(l_cent[:, 0], l_cent[:, 1])
        zrel = (l_cent[:, 2] - crown_z0) / max(1e-6, crown_z1 - crown_z0)
        cand = np.nonzero((lr > 0.5 * crown_r) & (lr < 0.85 * crown_r) & (zrel > 0.25) & (zrel < 0.8))[0]
        cand = rng.choice(cand, size=min(600, len(cand)), replace=False)
        # 选叶片密度适中的候选（球内岛数接近中位数偏上），再做最远点采样
        dens = np.array([int((np.linalg.norm(l_cent - l_cent[c], axis=1) < r).sum()) for c in cand])
        okc = cand[(dens >= np.percentile(dens, 45)) & (dens <= np.percentile(dens, 92))]
        seeds = [okc[0]]
        while len(seeds) < NT:
            dmin = np.min([np.linalg.norm(l_cent[okc] - l_cent[s], axis=1) for s in seeds], axis=0)
            seeds.append(okc[int(np.argmax(dmin))])
        tiles = []; isl_counts = []
        for ti, sidx in enumerate(seeds):
            p = l_cent[sidx]
            dist = np.linalg.norm(l_cent - p, axis=1)
            soft = r * (0.72 + 0.28 * rng.random(len(l_cent)))
            isl_in = dist < soft
            fm = f_leaf & isl_in[np.clip(l_lab, 0, None)] & (l_lab >= 0)
            # 细枝：球内的枝干面（按面裁切）
            fm |= (f_branch | f_trunk) & (np.linalg.norm(fcent - p, axis=1) < 0.9 * r)
            sm = submesh(f'{name}_tile{ti}', A, fm, mats)
            so = new_obj(f'{name}_tile{ti}', sm, bake.collection)
            radial = np.array([p[0], p[1], 0.0]); radial /= max(1e-6, np.linalg.norm(radial))
            path = os.path.join(TMP, f'{name}_tile{ti}.png')
            vdir = np.cross([0.0, 0.0, 1.0], radial) if (S['conifer'] and ti < NPROF) else -radial
            render_ortho(bake, cam, p, vdir, win, win, TS, TS, path)
            D.objects.remove(so, do_unlink=True); D.meshes.remove(sm)
            t = dilate(load_rgba(path))
            tiles.append(t); isl_counts.append(int(isl_in.sum()))
            print(f'[{name}] tile {ti}: islands {int(isl_in.sum())} coverage {float((t[..., 3] > 0.5).mean()):.2f}')
        atlas = np.zeros((TS * G, TS * G, 4), np.float32)
        for ti, t in enumerate(tiles):
            col, row = ti % G, ti // G
            atlas[row * TS:(row + 1) * TS, col * TS:(col + 1) * TS] = t
        save_rgba(atlas, atlas_path)

        # ---- 卡片布置：对叶片岛中心做网格稀疏化
        n_target = int(min(S['ncards'], S['factor'] * len(l_cent) / max(1.0, float(np.mean(isl_counts)))))
        off = rng.random(3)
        def thin(d):
            cell = np.floor(l_cent / d + off).astype(np.int64)
            u, inv, cnt = np.unique(cell, axis=0, return_inverse=True, return_counts=True)
            good = cnt >= max(1.0, 0.3 * np.median(cnt))
            return u, inv.reshape(-1), cnt, good
        lo, hi = 0.15 * r, 5.0 * r
        for _ in range(28):
            d = 0.5 * (lo + hi)
            if thin(d)[3].sum() > n_target:
                lo = d
            else:
                hi = d
        u, inv, cnt, good = thin(hi)
        cc = np.zeros((len(u), 3)); np.add.at(cc, inv, l_cent); cc /= cnt[:, None]
        wsize = np.clip(np.sqrt(cnt / np.median(cnt[good])), 0.8, 1.15)[good]
        cc = cc[good]
        print(f'[{name}] cards: target {n_target} -> {len(cc)} (cell {hi:.2f} m, islands/tile {np.mean(isl_counts):.0f})')
        n = len(cc)
        radial = cc.copy(); radial[:, 2] = 0
        rl = np.linalg.norm(radial, axis=1, keepdims=True)
        rand_dir = rng.normal(size=(n, 3)); rand_dir[:, 2] = 0
        rand_dir /= np.linalg.norm(rand_dir, axis=1, keepdims=True)
        radial = np.where(rl > 0.25 * crown_r, radial / np.maximum(rl, 1e-6), rand_dir)
        tile = rng.integers(0, NT, n); mirror = rng.random(n) < 0.5
        basen = radial; yaw_rng = np.full(n, math.radians(60)); tilt_lo = np.full(n, math.radians(-8)); tilt_hi = np.full(n, math.radians(38))
        if S['conifer']:
            # 针叶树的枝条是放射状的：60% 的卡片做成"过树干的竖直面"（显示枝条侧面轮廓），其余朝外补中间
            prof = rng.random(n) < 0.6
            sgn = np.where(rng.random(n) < 0.5, 1.0, -1.0)
            tang = np.stack([-radial[:, 1], radial[:, 0], np.zeros(n)], axis=1)
            basen = np.where(prof[:, None], -tang * sgn[:, None], radial)
            yaw_rng = np.where(prof, math.radians(22), math.radians(60))
            tilt_lo = np.where(prof, math.radians(-8), tilt_lo); tilt_hi = np.where(prof, math.radians(8), tilt_hi)
            tile = np.where(prof, rng.integers(0, NPROF, n), rng.integers(NPROF, NT, n))
            mirror = np.where(prof, sgn < 0, mirror)      # 让枝梢始终朝外
        yaw = rng.uniform(-1.0, 1.0, n) * yaw_rng
        cy, sy = np.cos(yaw), np.sin(yaw)
        nrm = np.stack([basen[:, 0] * cy - basen[:, 1] * sy, basen[:, 0] * sy + basen[:, 1] * cy, np.zeros(n)], axis=1)
        tilt = tilt_lo + rng.random(n) * (tilt_hi - tilt_lo)
        nrm = nrm * np.cos(tilt)[:, None]; nrm[:, 2] = np.sin(tilt)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
        up = np.array([0, 0, 1.0]) - nrm * nrm[:, 2:3]
        up /= np.linalg.norm(up, axis=1, keepdims=True)
        right = np.cross(up, nrm)
        roll = rng.uniform(-1, 1, n) * math.radians(18)
        cr, sr = np.cos(roll)[:, None], np.sin(roll)[:, None]
        right, up = right * cr + up * sr, up * cr - right * sr
        h = ((win / 2) * rng.uniform(0.92, 1.1, n) * wsize)[:, None]
        v0 = cc - right * h - up * h; v1 = cc + right * h - up * h; v2 = cc + right * h + up * h; v3 = cc - right * h + up * h
        quad = np.stack([v0, v1, v2, v3], axis=1)                      # (n,4,3)
        verts = np.concatenate([quad, quad], axis=1).reshape(-1, 3)   # 每张卡 8 个顶点：正面 4 + 背面 4（位置相同、互不共用）
        inset = 2.0 / (TS * G)
        u0 = (tile % G) / G + inset; u1 = (tile % G + 1) / G - inset
        vv0 = (tile // G) / G + inset; vv1 = (tile // G + 1) / G - inset
        ua = np.where(mirror, u1, u0); ub = np.where(mirror, u0, u1)
        quv = np.stack([np.stack([ua, vv0], 1), np.stack([ub, vv0], 1), np.stack([ub, vv1], 1), np.stack([ua, vv1], 1)], axis=1)  # (n,4,2)
        base_i = (np.arange(n) * 8)[:, None]
        front = base_i + np.array([0, 1, 2, 3]); back = base_i + np.array([4, 7, 6, 5])
        loops = np.concatenate([front, back], axis=1).reshape(-1)
        luv = np.concatenate([quv, quv[:, [0, 3, 2, 1], :]], axis=1).reshape(-1, 2)
        cme = D.meshes.new(name + '_cards')
        cme.vertices.add(n * 8); cme.vertices.foreach_set('co', verts.astype(np.float32).ravel())
        cme.loops.add(n * 8); cme.loops.foreach_set('vertex_index', loops.astype(np.int32))
        cme.polygons.add(n * 2); cme.polygons.foreach_set('loop_start', (np.arange(n * 2) * 4).astype(np.int32))
        uvl = cme.uv_layers.new(name='UVMap'); uvl.data.foreach_set('uv', luv.astype(np.float32).ravel())
        cme.update(calc_edges=True)
        cme.polygons.foreach_set('use_smooth', np.ones(n * 2, bool))

    # ---- 材质
    wm = D.materials.new(f'{name}_bark'); wm.use_nodes = True; wm.use_backface_culling = True
    b = next(nd for nd in wm.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
    tsrc = D.materials[S['trunk'][0]]
    timg = next((nd.image for nd in tsrc.node_tree.nodes if nd.type == 'TEX_IMAGE' and nd.image and 'diff' in nd.image.name and ('trunk' in nd.image.name or nd.image.name.startswith('tree_small_02_diff'))), None)
    if timg is None:
        timg = next(nd.image for nd in tsrc.node_tree.nodes if nd.type == 'TEX_IMAGE' and nd.image and 'diff' in nd.image.name)
    timg = timg.copy(); timg.name = f'{name}_bark'
    if max(timg.size) > 512:
        timg.scale(512, 512)
    tn = wm.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = timg
    wm.node_tree.links.new(tn.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.9
    lm = D.materials.new(f'{name}_foliage'); lm.use_nodes = True; lm.use_backface_culling = True
    b = next(nd for nd in lm.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
    aimg = D.images.load(atlas_path, check_existing=False); aimg.name = f'{name}_leaves'
    an = lm.node_tree.nodes.new('ShaderNodeTexImage'); an.image = aimg
    lm.node_tree.links.new(an.outputs['Color'], b.inputs['Base Color'])
    lm.node_tree.links.new(an.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.85
    for wl in (trunk_lo, br_lo):
        wl.materials.clear(); wl.materials.append(wm)
        wl.polygons.foreach_set('material_index', np.zeros(len(wl.polygons), np.int32))
    cme.materials.append(lm)

    # ---- 合并导出（两个网格对象挂在同一父节点下会多一层，这里直接合并成一个网格、两个材质）
    scn = bpy.context.scene
    wobj = new_obj(name, trunk_lo, scn.collection)
    bobj = new_obj(name + '_branches', br_lo, scn.collection)
    cobj = new_obj(name + '_cards', cme, scn.collection)
    bpy.context.view_layer.update()
    with bpy.context.temp_override(active_object=wobj, object=wobj, selected_objects=[wobj, bobj, cobj], selected_editable_objects=[wobj, bobj, cobj]):
        bpy.ops.object.join()
    wobj.data.uv_layers[0].active_render = True
    # 合并后统一写入法线：木质部分保留自身的平滑法线，叶片用"从树冠中心向外"的球形法线（正反两面相同）
    jm = wobj.data
    nl = len(jm.loops)
    cn = np.empty(nl * 3, np.float32); jm.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
    jlv = np.empty(nl, np.int32); jm.loops.foreach_get('vertex_index', jlv)
    jco = np.empty(len(jm.vertices) * 3, np.float32); jm.vertices.foreach_get('co', jco); jco = jco.reshape(-1, 3)
    jmi = np.empty(len(jm.polygons), np.int32); jm.polygons.foreach_get('material_index', jmi)
    jlt = np.empty(len(jm.polygons), np.int32); jm.polygons.foreach_get('loop_total', jlt)
    leaf_slot = [i for i, m_ in enumerate(jm.materials) if m_ == lm][0]
    leaf_loop = np.repeat(jmi == leaf_slot, jlt)
    pos = jco[jlv[leaf_loop]].astype(np.float64)
    if S['conifer']:
        sn = pos.copy(); sn[:, 2] = 0
        ln_ = np.linalg.norm(sn, axis=1, keepdims=True)
        sn = sn / np.maximum(ln_, 1e-6) * np.clip(ln_ / 0.8, 0.0, 1.0)     # 贴近树干处法线偏向上
        sn[:, 2] = 0.6
    else:
        sn = pos - cpt
    sn /= np.maximum(np.linalg.norm(sn, axis=1, keepdims=True), 1e-6)
    cn[leaf_loop] = sn
    jm.normals_split_custom_set(cn.tolist())
    jm.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    wobj.select_set(True); bpy.context.view_layer.objects.active = wobj
    glb = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
                              export_lights=False, export_extras=False, export_image_format='JPEG', export_jpeg_quality=88,
                              export_materials='EXPORT', export_vertex_color='NONE', export_tangents=False)

    def fix(g):
        sc_i = g.get('scene', 0)
        keep_sc = [sc_ for sc_ in g['scenes'] if sc_.get('nodes')] or [g['scenes'][sc_i]]
        g['scenes'] = keep_sc[:1]; g['scene'] = 0        # 文件里多了一个烘焙用的空场景，去掉
        for m in g['materials']:
            m['doubleSided'] = False
            if m['name'].endswith('_foliage'):
                m['alphaMode'] = 'MASK'; m['alphaCutoff'] = S.get('cutoff', 0.45)
    g = patch_glb(glb, fix)
    acc = g['accessors']
    tris = sum(acc[p['indices']]['count'] // 3 for m in g['meshes'] for p in m['primitives'])
    D.objects.remove(wobj, do_unlink=True)

    info = {'file': name + '.glb', 'card': name + '_card.png', 'height': round(height, 2), 'crownRadius': round(crown_r, 2),
            'tris': tris, 'cardWidthM': None, 'cardHeightM': None,
            'cardB': name + '_card_b.png', 'cardBWidthM': None, 'leafAtlas': name + '_leaves.png',
            'crownBottom': round(crown_z0, 2), 'leafCards': int(n), 'leafCardSizeM': round(win, 2), 'woodTris': int(wood_tris),
            'sizeMB': round(os.path.getsize(glb) / 1e6, 2), 'sourceTris': int((lt - 2).sum())}

    # ---- 整树公告板（原始高模，正交侧视，平光）
    if not NOBILL:
        full = submesh(name + '_full', A, np.ones(len(ls), bool), mats)
        fo = new_obj(name + '_full', full, bake.collection)
        bake.cycles.samples = 128
        for suf, vd, ax in (('', (0, 1, 0), 0), ('_b', (-1, 0, 0), 1)):
            wdt = 2.0 * float(np.abs(co[:, ax]).max()) * 1.02
            hgt = height * 1.01
            path = os.path.join(OUT, f'{name}_card{suf}.png')
            render_ortho(bake, cam, (0, 0, hgt / 2), vd, wdt, hgt, 1024, 1024, path)
            save_rgba(dilate(load_rgba(path), 48), path)
            if suf == '':
                info['cardWidthM'] = round(wdt, 2); info['cardHeightM'] = round(hgt, 2)
            else:
                info['cardBWidthM'] = round(wdt, 2)
        bake.cycles.samples = 96
        D.objects.remove(fo, do_unlink=True); D.meshes.remove(full)
    if NOBILL and name in result:
        for k in ('cardWidthM', 'cardHeightM', 'cardBWidthM'):
            info[k] = result[name].get(k)
    print(f'[{name}] done {json.dumps(info)}  ({time.time()-t0:.1f}s)')
    return info


bake, cam = make_bake_scene()
res_path = os.path.join(OUT, '_trees_info.json')
result = json.load(open(res_path)) if os.path.exists(res_path) else {}
for nm in ONLY:
    result[nm] = process(nm, SPEC[nm], bake, cam)
    json.dump(result, open(res_path, 'w'), indent=1)
