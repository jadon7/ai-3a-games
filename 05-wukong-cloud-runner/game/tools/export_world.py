"""把影片的写实山水环境导出成实时游戏用的资产（game/assets/world、game/assets/sky）。

运行（无界面 Blender；全机同时最多 2 个 -b 进程，先 pgrep 看一下）：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P game/tools/export_world.py -- [rocks] [trees] [sky] [tex]
不带参数 = 全部。依赖 ROOT/assets/env/build_env_real.py（石峰生成器）、assets/env/ph（扫描松）、assets/env/tripo（黄山松）、assets/tex。

产物：
  assets/world/rocks_lod123.glb     14 个石峰变体的中景 / 中远景 / 远景 LOD（最远一档合并了简化树冠）
  assets/world/rock_XX_lod0.glb     每个变体的近景 LOD
  assets/world/trees.glb            3 棵黄山松 × 2 档 LOD + 灌丛（松针是带透明通道的卡片）
  assets/world/tree_atlas.webp      树皮 ×3 + 松针图集
  assets/world/rock_*.jpg           岩石贴图（Poly Haven marble_cliff_04 / 05）
  assets/world/world.json           变体参数、碰撞用的“方位角–高度–半径”表、每个变体上的树 / 灌丛位置
  assets/sky/sky_2k.hdr             影片的物理天空（不带日轮），equirect，方位已对齐 three 的 EquirectangularMapping
坐标：导出时已从 Blender (x, y, z) 换到 three (x, z, -y)，米，Y 向上。
"""
import bpy, sys, os, math, json, struct, base64, time, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
ROOT = os.path.dirname(GAME)
ENVDIR = os.path.join(ROOT, 'assets', 'env')
OUTW = os.path.join(GAME, 'assets', 'world')
OUTS = os.path.join(GAME, 'assets', 'sky')
TMP = os.path.join(GAME, '.cache', 'export_tmp')
for d in (OUTW, OUTS, TMP):
    os.makedirs(d, exist_ok=True)
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DO = lambda k: (not [a for a in ARGS if a in ('rocks', 'trees', 'sky', 'tex')]) or k in ARGS
T0 = time.time()


def log(*a):
    print(f'[export {time.time() - T0:6.1f}s]', *a, flush=True)


# ---- 取影片的石峰生成器（只执行函数定义，不跑它的 main）
_src = open(os.path.join(ENVDIR, 'build_env_real.py')).read()
_argv = sys.argv
sys.argv = _argv[:1]
G = {'__file__': os.path.join(ENVDIR, 'build_env_real.py'), '__name__': 'envgen'}
exec(compile(_src[:_src.rindex('\ndef main():')], G['__file__'], 'exec'), G)
sys.argv = _argv
build_pillar, pick_tree_points, mesh_from_arrays = G['build_pillar'], G['pick_tree_points'], G['mesh_from_arrays']
sc = G['sc'] if 'sc' in G else None
CLOUD_Y = 96.0          # 与 game/src/common.js 的 CLOUD_TOP_Y 一致
CUT_Y = 38.0            # 石峰网格从这个高度往上（云海以下约 58 m）


def to_three(a):
    a = np.asarray(a, np.float64)
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)


# ----------------------------------------------------------------------------- 极简 GLB 写出
def write_glb(path, meshes, extras=None):
    """meshes: [{name, position(N,3), normal(N,3), data(N,4 uint8)?, uv(N,2)?, index(M,3)}]"""
    binb = bytearray()
    views, accs, gmeshes, nodes = [], [], [], []

    def view(raw, target=None, stride=None):
        while len(binb) % 4:
            binb.append(0)
        v = {'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(raw)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        binb.extend(raw)
        views.append(v)
        return len(views) - 1

    def acc(v, ctype, count, typ, normalized=False, mn=None, mx=None):
        a = {'bufferView': v, 'componentType': ctype, 'count': int(count), 'type': typ}
        if normalized:
            a['normalized'] = True
        if mn is not None:
            a['min'], a['max'] = mn, mx
        accs.append(a)
        return len(accs) - 1

    for m in meshes:
        P = np.ascontiguousarray(m['position'], np.float32)
        n = len(P)
        attrs = {'POSITION': acc(view(P.tobytes(), 34962), 5126, n, 'VEC3', mn=[float(v) for v in P.min(0)], mx=[float(v) for v in P.max(0)])}
        N = np.asarray(m['normal'], np.float64)
        N = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
        N8 = np.zeros((n, 4), np.int8)
        N8[:, :3] = np.clip(np.round(N * 127.0), -127, 127)
        attrs['NORMAL'] = acc(view(N8.tobytes(), 34962, 4), 5120, n, 'VEC3', True)
        if m.get('data') is not None:
            D = np.ascontiguousarray(m['data'], np.uint8)
            attrs['_DATA'] = acc(view(D.tobytes(), 34962), 5121, n, 'VEC4', True)
        if m.get('uv') is not None:
            U = np.ascontiguousarray(m['uv'], np.float32)
            attrs['TEXCOORD_0'] = acc(view(U.tobytes(), 34962), 5126, n, 'VEC2')
        I = np.asarray(m['index']).ravel()
        if n <= 65535:
            ia = acc(view(I.astype(np.uint16).tobytes(), 34963), 5123, len(I), 'SCALAR')
        else:
            ia = acc(view(I.astype(np.uint32).tobytes(), 34963), 5125, len(I), 'SCALAR')
        gmeshes.append({'name': m['name'], 'primitives': [{'attributes': attrs, 'indices': ia, 'mode': 4}]})
        nodes.append({'name': m['name'], 'mesh': len(gmeshes) - 1})
    while len(binb) % 4:
        binb.append(0)
    doc = {'asset': {'version': '2.0', 'generator': 'wukong export_world.py'}, 'scene': 0,
           'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gmeshes,
           'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(binb)}],
           'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization']}
    if extras:
        doc['scenes'][0]['extras'] = extras
    js = json.dumps(doc, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(binb)
    return os.path.getsize(path)


# ----------------------------------------------------------------------------- 网格小工具
def mesh_tris(me):
    """Blender 网格 → (顶点, 三角形索引)。四边形拆成两个三角形。"""
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    ls = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt)
    vi = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
    q = ls[lt == 4]; t = ls[lt == 3]
    tris = [np.stack([vi[t], vi[t + 1], vi[t + 2]], -1)]
    if len(q):
        tris += [np.stack([vi[q], vi[q + 1], vi[q + 2]], -1), np.stack([vi[q], vi[q + 2], vi[q + 3]], -1)]
    return co.reshape(-1, 3).astype(np.float64), np.concatenate(tris)


def compact(V, T, *attrs):
    used = np.unique(T)
    remap = np.full(len(V), -1, np.int64); remap[used] = np.arange(len(used))
    return (V[used], remap[T]) + tuple(a[used] for a in attrs)


def vertex_normals(V, T):
    n = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, T[:, k], n)
    return N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)


def decimate(V, T, target, uv=None):
    """Blender 的塌边减面。uv: (nt,3,2) 每个三角形角点的 UV。返回 V, T, N(顶点法线), uv(角点)。"""
    me = mesh_from_arrays('dec_tmp', V, None, T)
    if uv is not None:
        l = me.uv_layers.new(name='UVMap')
        l.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    ob = bpy.data.objects.new('dec_tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    md = ob.modifiers.new('d', 'DECIMATE')
    md.ratio = float(min(1.0, target / max(len(T), 1)))
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    me2.calc_loop_triangles()
    nt = len(me2.loop_triangles)
    tv = np.zeros(nt * 3, np.int32); me2.loop_triangles.foreach_get('vertices', tv); tv = tv.reshape(-1, 3)
    tl = np.zeros(nt * 3, np.int32); me2.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    co = np.zeros(len(me2.vertices) * 3, np.float32); me2.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
    uvo = None
    if uv is not None and me2.uv_layers:
        u = np.zeros(len(me2.loops) * 2, np.float32); me2.uv_layers[0].data.foreach_get('uv', u)
        uvo = u.reshape(-1, 2)[tl]
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me); bpy.data.meshes.remove(me2)
    return co, tv, vertex_normals(co, tv), uvo


def weld_uv(V, T, N, uvc):
    """角点 UV → 按 (顶点, UV) 拆分顶点，得到每顶点一个 UV 的索引网格。"""
    key = np.stack([T.ravel().astype(np.int64), np.round(uvc.reshape(-1, 2)[:, 0] * 4096).astype(np.int64), np.round(uvc.reshape(-1, 2)[:, 1] * 4096).astype(np.int64)], -1)
    uq, inv = np.unique(key, axis=0, return_inverse=True)
    first = np.zeros(len(uq), np.int64); first[inv.ravel()] = np.arange(len(key))
    vi = T.ravel()[first]
    return V[vi], inv.reshape(-1, 3), N[vi], uvc.reshape(-1, 2)[first]


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


# ----------------------------------------------------------------------------- 石峰
VARS = [
    dict(style='zjj', R=22, H=300, asp=1.3, sp=0), dict(style='zjj', R=16, H=250, asp=1.1, sp=0),
    dict(style='zjj', R=27, H=340, asp=1.8, sp=0), dict(style='zjj', R=19, H=390, asp=1.2, sp=3),
    dict(style='hs', R=62, H=330, asp=1.2, sp=0), dict(style='zjj', R=30, H=270, asp=2.4, sp=0),
    dict(style='zjj', R=14, H=220, asp=1.0, sp=0), dict(style='zjj', R=24, H=430, asp=1.4, sp=4),
    dict(style='zjj', R=20, H=205, asp=1.5, sp=0), dict(style='hs', R=75, H=380, asp=1.35, sp=0),
    dict(style='zjj', R=26, H=310, asp=1.1, sp=2), dict(style='zjj', R=17, H=280, asp=2.0, sp=0),
    dict(style='zjj', R=32, H=240, asp=1.6, sp=0), dict(style='zjj', R=21, H=460, asp=1.2, sp=5),
]
NA, DY = 96, 2.0        # 碰撞表：方位角格数、高度步长（米）


def pillar_arrays(seed, v, seg, sharp=True):
    ob, cand = build_pillar('exp_tmp', seed, v['R'], v['H'], seg, v['style'], v['asp'], None, sharp=sharp and v['style'] == 'zjj', extra_spires=v['sp'])
    me = ob.data
    V, T = mesh_tris(me)
    N, veg = cand['n'].astype(np.float64), cand['veg'].astype(np.float64)
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return V, T, N, veg, cand


def pick_seed(k, v):
    best = None
    for s in range(9000 + k * 40, 9000 + k * 40 + (8 if v['style'] == 'zjj' else 3)):
        ob, cand = build_pillar('exp_tmp', s, v['R'], v['H'], 6.0, v['style'], v['asp'], None, sharp=False, extra_spires=v['sp'])
        me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
        hs = np.array([l[3] for l in cand['lobes']])
        co = cand['co']
        rmax = float(np.hypot(co[:, 0], co[:, 1])[co[:, 2] > CLOUD_Y].max())
        score = min(len(hs), 5) + 5.0 * float(hs.std()) / v['H'] - max(0.0, rmax - 3.2 * v['R']) * 0.05
        if best is None or score > best[0]:
            best = (score, s)
    return best[1]


def build_profile(V3):
    """V3: three 坐标的顶点。返回 (NA, NY) 的外包半径表（米），空格用同高度相邻方位填补。"""
    ny = int(math.ceil((V3[:, 1].max() + 6.0) / DY))
    th = np.arctan2(V3[:, 2], V3[:, 0])
    ia = np.floor((th + np.pi) / (2 * np.pi) * NA).astype(int) % NA
    iy = np.clip(np.floor(V3[:, 1] / DY).astype(int), 0, ny - 1)
    r = np.hypot(V3[:, 0], V3[:, 2])
    prof = np.zeros((NA, ny))
    np.maximum.at(prof, (ia, iy), r)
    for _ in range(6):              # 细尖顶处某些方位格没有顶点：同一高度上向两侧填补
        empty = prof <= 0
        nb = np.maximum(np.roll(prof, 1, 0), np.roll(prof, -1, 0))
        has = (prof > 0).any(0)[None, :]
        prof = np.where(empty & has, nb, prof)
    return prof


def crown_blob(p, s, rng, big=True):
    """合并进中 / 远景网格的简化树冠：一两层扁的多棱双锥（黄山松的平顶层状树冠）。返回顶点、三角形。"""
    Vs, Ts, off = [], [], 0
    lean = rng.normal(0, 0.5 * s, 2)
    layers = [(5.2, 7.2, 4.0, 3.0)] if not big else [(5.6, 7.3, 4.6, 2.5), (3.4, 4.6, 2.6, 3.1)]
    for li, (hm, ht, hb, rad) in enumerate(layers):
        if li == 1 and rng.random() < 0.35:
            continue
        n = 6 if big else 5
        a = np.linspace(0, 2 * np.pi, n, endpoint=False) + rng.random() * 6.28
        r = rad * s * (0.75 + 0.5 * rng.random(n))
        ox, oz = lean[0] * (1.0 if li == 0 else 0.3) + (rng.normal(0, 0.9 * s) if li else 0.0), lean[1] * (1.0 if li == 0 else 0.3) + (rng.normal(0, 0.9 * s) if li else 0.0)
        ring = np.stack([p[0] + ox + np.cos(a) * r, np.full(n, p[1] + hm * s) + rng.normal(0, 0.25 * s, n), p[2] + oz + np.sin(a) * r], -1)
        top = np.array([[p[0] + ox, p[1] + ht * s, p[2] + oz]])
        bot = np.array([[p[0] + ox * 0.6, p[1] + hb * s, p[2] + oz * 0.6]])
        Vs += [ring, top, bot]
        Ts.append(np.array([[i, n, (i + 1) % n] for i in range(n)] + [[(i + 1) % n, n + 1, i] for i in range(n)]) + off)
        off += n + 2
    return np.concatenate(Vs), np.concatenate(Ts)


def export_rocks():
    meta = {'cloudTop': CLOUD_Y, 'cutY': CUT_Y, 'profile': {'na': NA, 'dy': DY}, 'variants': []}
    lod12 = []
    for k, v in enumerate(VARS):
        seed = pick_seed(k, v)
        rng = np.random.default_rng(700 + k)
        # ---- LOD0（目标 ≤ 62k 顶点，索引可用 16 位）
        seg = 1.3
        for _ in range(4):
            V, T, N, veg, cand = pillar_arrays(seed, v, seg)
            keep = (V[T][:, :, 2] >= CUT_Y).any(1)
            nv = len(np.unique(T[keep]))
            if nv <= 62000:
                break
            seg *= math.sqrt(nv / 58000.0) * 1.02
        Vb = V.copy()
        V0, T0_, N0, veg0 = compact(V, T[keep], N, veg)
        P0 = to_three(V0); Nn0 = to_three(N0)
        prof = build_profile(P0)
        ny = prof.shape[1]
        # 凹处压暗（伪 AO）：顶点半径相对平滑后轮廓的进退
        ps = prof.copy()
        for _ in range(2):
            ps = (np.roll(ps, 1, 0) + ps + np.roll(ps, -1, 0)) / 3.0
        ps[:, 1:-1] = (ps[:, :-2] + ps[:, 1:-1] + ps[:, 2:]) / 3.0

        def cavity(P):
            th = np.arctan2(P[:, 2], P[:, 0])
            ia = np.floor((th + np.pi) / (2 * np.pi) * NA).astype(int) % NA
            iy = np.clip(np.floor(P[:, 1] / DY).astype(int), 0, ny - 1)
            return np.clip(0.5 + (np.hypot(P[:, 0], P[:, 2]) - ps[ia, iy]) / 6.0, 0, 1)

        def data_of(P, veg_, fol=None):
            D = np.zeros((len(P), 4), np.uint8)
            D[:, 0] = np.clip(veg_ * 255, 0, 255)
            D[:, 1] = 0 if fol is None else np.clip(fol * 255, 0, 255)
            D[:, 2] = np.clip(cavity(P) * 255, 0, 255)
            D[:, 3] = 255
            return D
        sz0 = write_glb(os.path.join(OUTW, f'rock_{k:02d}_lod0.glb'), [dict(name=f'rock_{k:02d}_lod0', position=P0, normal=Nn0, data=data_of(P0, veg0), index=T0_)])

        # ---- 树和灌丛的位置（在 LOD0 表面上，three 坐标）
        ci = pick_tree_points(cand, rng, 0.020, 0.012, CLOUD_Y + 8.0)
        if len(ci) > 120:
            ci = rng.choice(ci, 120, replace=False)
        tp = to_three(Vb[ci]) - np.array([0, 0.35, 0])
        trees = np.concatenate([tp, rng.uniform(0.75, 1.25, (len(ci), 1)), rng.random((len(ci), 1)) * 6.283, rng.integers(0, 3, (len(ci), 1))], 1)
        bi = pick_tree_points(cand, rng, 0.05, 0.07, CLOUD_Y + 2.0)
        if len(bi) > 300:
            bi = rng.choice(bi, 300, replace=False)
        bp = to_three(Vb[bi]) - np.array([0, 0.15, 0])
        bushes = np.concatenate([bp, rng.uniform(0.8, 1.9, (len(bi), 1)), rng.random((len(bi), 1)) * 6.283], 1)

        # ---- LOD1（树冠合并进网格）
        V, T, N, veg, _c = pillar_arrays(seed, v, 3.3 if v['style'] == 'zjj' else 5.2)
        keep = (V[T][:, :, 2] >= CUT_Y).any(1)
        V1, T1, N1, veg1 = compact(V, T[keep], N, veg)
        P1, Nn1 = to_three(V1), to_three(N1)
        Pm, Tm, Dm = P1, T1, data_of(P1, veg1)
        lod12.append(dict(name=f'rock_{k:02d}_lod1', position=Pm, normal=Nn1, data=Dm, index=Tm))
        n1 = len(Tm)

        # ---- LOD2（约 2~3 千个三角形，不带树：树用公告板实例）
        V, T, N, veg, _c = pillar_arrays(seed, v, 8.0 if v['style'] == 'zjj' else 11.0, sharp=False)
        keep = (V[T][:, :, 2] >= CUT_Y + 12).any(1)
        Vc, Tc, Nc_, vegc = compact(V, T[keep], N, veg)
        Pc = to_three(Vc)
        lod12.append(dict(name=f'rock_{k:02d}_lod2', position=Pc, normal=to_three(Nc_), data=data_of(Pc, vegc), index=Tc))
        n2 = len(Tc)

        # ---- LOD3（几百个三角形 + 少量合并的树冠）
        V2, T2, N2, _ = decimate(Vc, Tc, 420 if v['style'] == 'zjj' else 640)
        P2, Nn2 = to_three(V2), to_three(N2)
        veg2 = np.clip((Nn2[:, 1] - 0.45) / 0.35, 0, 1) * (P2[:, 1] > CLOUD_Y)
        cv, ct, off = [], [], len(P2)
        for row in trees[::4]:
            bv, bt = crown_blob(row[:3], row[3] * 1.35, rng, False)
            cv.append(bv); ct.append(bt + off); off += len(bv)
        CV = np.concatenate(cv) if cv else np.zeros((0, 3)); CT = np.concatenate(ct) if ct else np.zeros((0, 3), int)
        Pm2 = np.concatenate([P2, CV]); Tm2 = np.concatenate([T2, CT])
        Nc = vertex_normals(Pm2, Tm2)[len(P2):] + np.array([0, 0.25, 0])
        Dm2 = np.concatenate([data_of(P2, veg2), np.tile(np.array([[255, 255, 150, 255]], np.uint8), (len(CV), 1))])
        lod12.append(dict(name=f'rock_{k:02d}_lod3', position=Pm2, normal=np.concatenate([Nn2, Nc]), data=Dm2, index=Tm2))

        above = P0[:, 1] > CLOUD_Y
        rmax = float(np.hypot(P0[above, 0], P0[above, 2]).max())
        meta['variants'].append({
            'name': f'rock_{k:02d}', 'style': v['style'], 'R': v['R'], 'H': v['H'], 'seed': seed, 'gate': bool(v['H'] >= 390),
            'top': round(float(P0[:, 1].max()), 2), 'rmax': round(rmax, 2), 'rbase': round(float(prof[:, int(CLOUD_Y / DY)].max()), 2),
            'tris': [int(len(T0_)), int(n1), int(n2), int(len(Tm2))], 'ny': int(ny), 'profile': b64(np.round(prof * 10).astype(np.uint16)),
            'trees': [round(float(x), 2) for x in trees.ravel()], 'bushes': [round(float(x), 2) for x in bushes.ravel()]})
        log(f'rock {k:02d} {v["style"]} seed={seed} seg0={seg:.2f} lod0 {len(P0)}v/{len(T0_)}t ({sz0 / 1e6:.2f}MB)  lod1 {n1}t  lod2 {n2}t  lod3 {len(Tm2)}t  rmax={rmax:.0f} trees={len(trees)} bushes={len(bushes)}')
    sz = write_glb(os.path.join(OUTW, 'rocks_lod123.glb'), lod12)
    log(f'rocks_lod123.glb {sz / 1e6:.2f}MB')
    return meta


# ----------------------------------------------------------------------------- 树（Tripo 黄山松 → 实时用：减面树干 + 深色叶芯 + 松针卡片）
def bake_needle_atlas():
    """把扫描松的 4 簇松针各正交渲染成一张带透明通道的小图，拼成 2×2 图集。返回图集路径。"""
    scene = bpy.context.scene
    coll = bpy.data.collections.new('twigs_tmp'); scene.collection.children.link(coll)
    n = G['load_twigs'](coll)
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    try:
        scene.view_settings.look = 'None'
    except TypeError:
        pass
    w = bpy.data.worlds.new('bake_w'); scene.world = w; w.use_nodes = True
    bgn = next(nd for nd in w.node_tree.nodes if nd.type == 'BACKGROUND')
    bgn.inputs['Color'].default_value = (1, 1, 1, 1)
    bgn.inputs['Strength'].default_value = 1.6
    cd = bpy.data.cameras.new('bake_c'); cd.type = 'ORTHO'
    cam = bpy.data.objects.new('bake_c', cd); scene.collection.objects.link(cam); scene.camera = cam
    objs = sorted(coll.objects, key=lambda o: -len(o.data.polygons))[:4]
    for o in coll.objects:
        o.hide_render = True
    tiles = []
    for i, o in enumerate(objs):
        o.hide_render = False
        co = np.array([v.co[:] for v in o.data.vertices])
        mn, mx = co.min(0), co.max(0)
        size = max(mx[0] - mn[0], mx[2] - mn[2]) * 1.04
        cd.ortho_scale = float(size)
        cam.location = ((mn[0] + mx[0]) / 2, mn[1] - 5.0, (mn[2] + mx[2]) / 2)
        cam.rotation_euler = (math.radians(90), 0, 0)
        scene.render.filepath = os.path.join(TMP, f'needle_{i}.png')
        bpy.ops.render.render(write_still=True)
        tiles.append((scene.render.filepath, float(size), float(mn[2]), float((mn[0] + mx[0]) / 2)))
        o.hide_render = True
    out = os.path.join(TMP, 'needles.png')
    subprocess.run(['magick', '(', tiles[0][0], tiles[1][0], '+append', ')', '(', tiles[2][0], tiles[3][0], '+append', ')', '-append', out], check=True)
    for o in coll.objects:
        o.hide_render = False
    scene.collection.children.unlink(coll)          # 留作实例源，不直接渲染
    log('needle atlas baked', [round(t[1], 2) for t in tiles])
    return out, coll, cam


def bake_impostors(twig_coll, cam, specs):
    """把影片级的黄山松（Tripo 树干 + 深色叶芯 + 扫描松针）正交渲染成带透明通道的公告板贴图：每棵两个互相垂直的视角。"""
    scene = bpy.context.scene
    cd = cam.data
    Gtw = G['make_instancer_group']('WK_Inst_Twigs_bake', twig_coll)
    n_twig = len(twig_coll.objects)
    lib = bpy.data.collections.new('imp_lib'); scene.collection.children.link(lib)
    trees = []
    for ti, (fn, th) in enumerate(specs):
        trees.append(G['load_tripo_tree'](fn, ti * 2, lib, Gtw, n_twig, th, 4000 + ti))
    scene.render.resolution_x = scene.render.resolution_y = 512
    tiles, info = [], []
    for ti, t in enumerate(trees):
        for c in lib.children:
            for o in c.objects:
                o.hide_render = (c != t['coll'])
        me = t['obj'].data
        co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        half = float(max(np.abs(co[:, :2]).max() + 0.9, (co[:, 2].max() + 0.9) / 2))
        cd.ortho_scale = 2 * half
        row = []
        for view in range(2):
            if view == 0:
                cam.location = (0, -40, half); cam.rotation_euler = (math.radians(90), 0, 0)
            else:
                cam.location = (40, 0, half); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
            scene.render.filepath = os.path.join(TMP, f'imp_{ti}_{view}.png')
            bpy.ops.render.render(write_still=True)
            row.append(scene.render.filepath)
        tiles.append(row)
        info.append({'half': round(half, 3)})
    out = os.path.join(OUTW, 'tree_impostors.webp')
    subprocess.run(['magick', '(', tiles[0][0], tiles[1][0], tiles[2][0], '+append', ')', '(', tiles[0][1], tiles[1][1], tiles[2][1], '+append', ')', '-append',
                    '-quality', '88', '-define', 'webp:alpha-quality=92', out], check=True)
    for c in list(lib.children):
        for o in list(c.objects):
            bpy.data.objects.remove(o)
    log('impostors baked', info, f'{os.path.getsize(out) / 1e6:.2f}MB')
    return info


def tripo_arrays(fname, tree_h):
    """导入 Tripo 松树：切掉岩石底座、原点放到树干根部、缩放到真实树高。返回树皮 / 叶团两部分的数组和贴图。"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ENVDIR, 'tripo', fname))
    new = [o for o in bpy.data.objects if o not in before]
    src = max([o for o in new if o.type == 'MESH'], key=lambda o: len(o.data.polygons))
    me = src.data
    M = np.array(src.matrix_world)
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    vi = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
    tri = vi.reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
    mat = me.materials[0]
    img = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node.image
    im = img.copy(); im.scale(1024, 1024)
    px = np.zeros(1024 * 1024 * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(1024, 1024, 4)
    bark_png = os.path.join(TMP, os.path.splitext(fname)[0] + '_bark.png')
    im.filepath_raw = bark_png; im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)
    cen = co[tri].mean(1)
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    zf = (cen[:, 2] - zmin) / (zmax - zmin)
    uvc = uv.mean(1)
    col = px[np.clip((uvc[:, 1] % 1.0) * 1024, 0, 1023).astype(int), np.clip((uvc[:, 0] % 1.0) * 1024, 0, 1023).astype(int), :3]
    r, g, b = col[:, 0], col[:, 1], col[:, 2]
    c3 = co[tri]
    area = np.linalg.norm(np.cross(c3[:, 1] - c3[:, 0], c3[:, 2] - c3[:, 0]), axis=1) * 0.5
    green = (g > r * 1.03) & (g > b * 1.05)
    nb = 50
    sl_a = np.bincount(np.clip((zf * nb).astype(int), 0, nb - 1), weights=area * ~green, minlength=nb)
    mid_med = np.median(sl_a[int(nb * 0.40):int(nb * 0.62)]) + 1e-9
    zcut = 0.0
    for j in range(int(nb * 0.5), -1, -1):
        if sl_a[j] > 3.2 * mid_med:
            zcut = (j + 1.25) / nb
            break
    keep = zf >= zcut
    fol = keep & green
    scale = tree_h / ((1.0 - zcut) * (zmax - zmin))
    sl = keep & (zf < zcut + 0.035)
    base = np.array([np.median(cen[sl, 0]), np.median(cen[sl, 1]), zmin + zcut * (zmax - zmin)])
    co2 = (co - base) * scale
    for o in new:
        d = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o)
        if d is not None and d.users == 0:
            bpy.data.meshes.remove(d)
    bark = keep & ~fol
    Vb, Tb = compact(co2, tri[bark])
    Vf, Tf = compact(co2, tri[fol])
    return dict(bark=(Vb, Tb, uv[bark]), fol=(Vf, Tf), bark_png=bark_png, scale=scale)


def components(nv, T):
    """按索引连通性给顶点分岛（标签传播 + 指针跳跃）。"""
    lab = np.arange(nv)
    for _ in range(400):
        m = lab[T].min(1)
        new = lab.copy()
        for k in range(3):
            np.minimum.at(new, T[:, k], m)
        new = new[new]
        if (new == lab).all():
            break
        lab = new
    return lab


def keep_big_islands(V, T, uvc, frac=0.9):
    """只留面积最大的若干个连通块（树干和主枝），丢掉细碎小枝：远景 LOD 用。"""
    lab = components(len(V), T)
    tl = lab[T[:, 0]]
    area = np.linalg.norm(np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]]), axis=1) * 0.5
    ids, inv = np.unique(tl, return_inverse=True)
    a = np.bincount(inv.ravel(), weights=area)
    order = np.argsort(-a)
    cum = np.cumsum(a[order]) / a.sum()
    keep_ids = order[:max(1, int(np.searchsorted(cum, frac)) + 1)]
    m = np.isin(inv.ravel(), keep_ids)
    V2, T2 = compact(V, T[m])
    return V2, T2, uvc[m]


def lump_blobs(Vf, Tf, min_size=0.45):
    """每个叶团（连通块）换成一个八面体：远景 LOD 的叶芯。"""
    lab = components(len(Vf), Tf)
    ids, inv = np.unique(lab, return_inverse=True)
    inv = inv.ravel()
    OV = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float)
    OT = np.array([[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]])
    V, T = [], []
    order = np.argsort(inv, kind='stable')
    bounds = np.searchsorted(inv[order], np.arange(len(ids) + 1))
    for i in range(len(ids)):
        pts = Vf[order[bounds[i]:bounds[i + 1]]]
        if len(pts) < 12:
            continue
        mn, mx = pts.min(0), pts.max(0)
        h = (mx - mn) * 0.5
        if h.max() < min_size:
            continue
        T.append(OT + len(V) * 6)
        V.append((mn + mx) * 0.5 + OV * np.maximum(h * 0.92, 0.12))
    return np.concatenate(V), np.concatenate(T)


def cards_on(Vf, Tf, n, size, rng, tiles=4):
    """在叶团表面撒松针卡片（两片交叉的四边形）。返回顶点、法线、UV（0..1 的卡片内坐标 + 图块号）、三角形。"""
    a, b, c = Vf[Tf[:, 0]], Vf[Tf[:, 1]], Vf[Tf[:, 2]]
    nrm = np.cross(b - a, c - a)
    area = np.linalg.norm(nrm, axis=1) * 0.5
    nrm /= (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12)
    pick = rng.choice(len(Tf), n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    fl = u + v > 1; u[fl], v[fl] = 1 - u[fl], 1 - v[fl]
    pts = a[pick] + (b[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]
    d = nrm[pick] * 0.6 + np.array([0, 0, 0.85]) + rng.normal(0, 0.3, (n, 3))       # Blender 坐标：Z 向上
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    V, N, U, T, tile = [], [], [], [], []
    for i in range(n):
        s = size * rng.uniform(0.75, 1.25)
        rnd = rng.normal(0, 1, 3)
        s1 = np.cross(d[i], rnd); s1 /= np.linalg.norm(s1) + 1e-9
        s2 = np.cross(d[i], s1)
        t_ = int(rng.integers(0, tiles))
        for side in (s1, s2):
            base = pts[i] - d[i] * s * 0.18
            q = np.array([base - side * s * 0.5, base + side * s * 0.5, base + side * s * 0.5 + d[i] * s, base - side * s * 0.5 + d[i] * s])
            k = len(V) * 4
            V.append(q)
            nn = d[i] * 0.55 + nrm[pick[i]] * 0.35 + np.array([0, 0, 0.45])
            N.append(np.tile(nn, (4, 1)))
            U.append(np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float))
            tile.append(np.full(4, t_))
            T.append(np.array([[k, k + 1, k + 2], [k, k + 2, k + 3]]))
    return np.concatenate(V), np.concatenate(N), np.concatenate(U), np.concatenate(tile), np.concatenate(T)


def export_trees():
    specs = [('pine_welcome.glb', 6.8), ('pine_var_a.glb', 6.2), ('pine_var_b.glb', 8.5)]
    needles, twig_coll, bake_cam = bake_needle_atlas()
    imp_info = bake_impostors(twig_coll, bake_cam, specs)
    meshes, barks, info = [], [], []
    for ti, (fn, th) in enumerate(specs):
        A = tripo_arrays(fn, th)
        barks.append(A['bark_png'])
        rng = np.random.default_rng(300 + ti)
        Vb, Tb, uvb = A['bark']; Vf, Tf = A['fol']
        ti_, tj_ = ti % 2, ti // 2
        for lod, (nb_, nf_, nc_, cs_) in enumerate(((3600, 1500, 260, 1.15), (700, 360, 64, 2.3))):
            # 先丢掉细碎的小枝（减面后会塌成又长又尖的碎片），再减面，最后再清一遍狭长三角形
            kV, kT, kuv = keep_big_islands(Vb, Tb, uvb, 0.95 if lod == 0 else 0.86)
            bV, bT, bN, buv = decimate(kV, kT, nb_, kuv)
            e = np.stack([np.linalg.norm(bV[bT[:, i]] - bV[bT[:, (i + 1) % 3]], axis=1) for i in range(3)], -1)
            ar = np.linalg.norm(np.cross(bV[bT[:, 1]] - bV[bT[:, 0]], bV[bT[:, 2]] - bV[bT[:, 0]]), axis=1) * 0.5
            sliver = (e.max(1) > (0.9 if lod == 0 else 1.6)) & (ar / (e.max(1) ** 2 + 1e-9) < 0.06)
            bT, buv = bT[~sliver], buv[~sliver]
            nbark = len(bT)
            bV, bT, bN, buv = weld_uv(bV, bT, bN, buv)
            buv = np.stack([(ti_ + np.clip(buv[:, 0], 0.002, 0.998)) / 2, (tj_ + 1.0 - np.clip(buv[:, 1], 0.002, 0.998)) / 2], -1)      # 图集左上 3 块；glTF 的 v 向下
            if lod == 0:
                fV, fT, fN, _ = decimate(Vf, Tf, nf_)
            else:
                fV, fT = lump_blobs(Vf, Tf)
                fN = vertex_normals(fV, fT)
            cV, cN, cU, ctile, cT = cards_on(Vf, Tf, nc_, cs_, rng)
            cu = 0.5 + ((ctile % 2) + np.clip(cU[:, 0], 0.02, 0.98)) / 4
            cv = 0.5 + ((ctile // 2) + 1.0 - np.clip(cU[:, 1], 0.02, 0.98)) / 4
            P = np.concatenate([bV, fV, cV]); Nn = np.concatenate([bN, fN, cN])
            UV = np.concatenate([buv, np.tile(np.array([[0.01, 0.01]]), (len(fV), 1)), np.stack([cu, cv], -1)])     # 叶芯的 UV 指向图集里不透明的一角（颜色由着色器给）
            T = np.concatenate([bT, fT + len(bV), cT + len(bV) + len(fV)])
            D = np.zeros((len(P), 4), np.uint8); D[:, 3] = 255
            D[len(bV):len(bV) + len(fV), 0] = 128          # 叶芯
            D[len(bV) + len(fV):, 0] = 255                 # 松针卡片
            hgt = P[:, 2] / max(P[:, 2].max(), 1e-3)
            D[:, 1] = np.clip(hgt * 255, 0, 255)           # 相对高度：给风摆和明暗用
            meshes.append(dict(name=f'tree_{ti}_lod{lod}', position=to_three(P), normal=to_three(Nn), uv=UV, data=D, index=T))
            info.append((f'tree_{ti}_lod{lod}', len(T)))
            log(f'   tree_{ti}_lod{lod}: bark {nbark}t, core {len(fT)}t, cards {len(cT)}t')
        log(f'tree {ti} {fn}: scale={A["scale"]:.2f} bark {len(Tb)}t fol {len(Tf)}t → lods {info[-2][1]}t / {info[-1][1]}t')
    # 灌丛：三片交叉的松针卡片
    rng = np.random.default_rng(55)
    V, N, U, T = [], [], [], []
    for i in range(3):
        a = i * math.pi / 3 + 0.2
        side = np.array([math.cos(a), math.sin(a), 0.0]); up = np.array([0.15 * math.cos(a + 1.3), 0.15 * math.sin(a + 1.3), 1.0])
        s = 1.7
        q = np.array([-side * s * 0.5, side * s * 0.5, side * s * 0.5 + up * s, -side * s * 0.5 + up * s]) - up * 0.15
        k = len(V) * 4
        V.append(q); N.append(np.tile(np.array([0, 0, 1.0]) + side * 0.0, (4, 1)))
        t_ = i % 4
        U.append(np.stack([0.5 + ((t_ % 2) + np.array([0.02, 0.98, 0.98, 0.02])) / 4, 0.5 + ((t_ // 2) + 1.0 - np.array([0.02, 0.02, 0.98, 0.98])) / 4], -1))
        T.append(np.array([[k, k + 1, k + 2], [k, k + 2, k + 3]]))
    P = np.concatenate(V); D = np.zeros((len(P), 4), np.uint8); D[:, 0] = 255; D[:, 1] = np.clip(P[:, 2] / 1.7 * 255, 0, 255); D[:, 3] = 255
    meshes.append(dict(name='bush', position=to_three(P), normal=to_three(np.concatenate(N)), uv=np.concatenate(U), data=D, index=np.concatenate(T)))
    sz = write_glb(os.path.join(OUTW, 'trees.glb'), meshes)
    atlas = os.path.join(OUTW, 'tree_atlas.webp')
    subprocess.run(['magick', '(', barks[0], barks[1], '+append', ')', '(', barks[2], '(', needles, '-resize', '1024x1024', ')', '+append', ')', '-append',
                    '-quality', '88', '-define', 'webp:alpha-quality=92', atlas], check=True)
    log(f'trees.glb {sz / 1e6:.2f}MB, atlas {os.path.getsize(atlas) / 1e6:.2f}MB')
    return {'trees': [{'name': f'tree_{i}', 'height': specs[i][1], 'impostorHalf': imp_info[i]['half']} for i in range(3)], 'treeTris': dict(info)}


# ----------------------------------------------------------------------------- 贴图
def export_textures():
    T = os.path.join(ROOT, 'assets', 'tex')
    jobs = [('marble_cliff_04/marble_cliff_04_Diffuse_2k.jpg', 'rock_a_color.jpg', 84), ('marble_cliff_04/marble_cliff_04_nor_gl_2k.jpg', 'rock_a_normal.jpg', 88),
            ('marble_cliff_05/marble_cliff_05_Diffuse_2k.jpg', 'rock_b_color.jpg', 84), ('marble_cliff_05/marble_cliff_05_nor_gl_2k.jpg', 'rock_b_normal.jpg', 88)]
    for src, dst, q in jobs:
        subprocess.run(['magick', os.path.join(T, src), '-resize', '2048x2048>', '-quality', str(q), os.path.join(OUTW, dst)], check=True)
        log('tex', dst, f'{os.path.getsize(os.path.join(OUTW, dst)) / 1e6:.2f}MB')
    # 可平铺的噪声（R/G/B/A 四个不同尺度的值噪声叠加），给宏观色差、水渍、苔藓遮罩用
    n = 512
    rng = np.random.default_rng(3)
    img = np.zeros((n, n, 4))
    yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing='ij')
    for ch in range(4):
        acc, amp, tot = 0.0, 1.0, 0.0
        for o in range(5):
            f = (4 << o) * (1 if ch < 3 else 2)
            g = rng.random((f, f))
            x, y = xx * f / n, yy * f / n
            x0, y0 = np.floor(x).astype(int) % f, np.floor(y).astype(int) % f
            x1, y1 = (x0 + 1) % f, (y0 + 1) % f
            fx, fy = x - np.floor(x), y - np.floor(y)
            fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
            acc = acc + amp * ((g[y0, x0] * (1 - fx) + g[y0, x1] * fx) * (1 - fy) + (g[y1, x0] * (1 - fx) + g[y1, x1] * fx) * fy)
            tot += amp; amp *= 0.5
        v = acc / tot
        img[..., ch] = np.clip((v - v.min()) / (v.max() - v.min()), 0, 1)
    im = bpy.data.images.new('noise_tmp', n, n, alpha=True)
    im.pixels.foreach_set(img[::-1].astype(np.float32).ravel())
    im.filepath_raw = os.path.join(OUTW, 'noise.png'); im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)
    log('tex noise.png')


# ----------------------------------------------------------------------------- 天空
def export_sky():
    from mathutils import Vector
    scene = bpy.context.scene
    sc_ = G['sc']
    sc_.setup_render(scene, res=(2048, 1024), samples=8, motion_blur=False, denoise=False)
    cd = bpy.data.cameras.new('pano'); cd.type = 'PANO'; cd.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new('pano', cd); scene.collection.objects.link(cam); scene.camera = cam
    # 朝 Blender +X、Z 向上：图像中心 = +X，向右转向 -Y —— 正好是 three 的 equirect 约定（u=0.5 → +X，u 增大转向 three 的 +Z = Blender 的 -Y）
    cam.rotation_euler = Vector((1, 0, 0)).to_track_quat('-Z', 'Y').to_euler()
    scene.view_settings.view_transform = 'Standard'

    def bake(path, disc, res):
        sc_.setup_world(scene, sun_disc=disc)
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.image_settings.file_format = 'HDR'
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(path, check_existing=False)
        w, h = im.size
        px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[..., :3]
        bpy.data.images.remove(im)
        return px

    # 方位校验：带日轮渲一张小图，最亮像素换算成 three 方向，和 SUN_DIR 比
    chk = bake(os.path.join(TMP, 'sky_check.hdr'), True, (1024, 512))
    lum = chk.sum(-1)
    iy, ix = np.unravel_index(np.argmax(lum), lum.shape)        # 行 0 在底部
    u, v = (ix + 0.5) / lum.shape[1], (iy + 0.5) / lum.shape[0]
    phi, lat = (u - 0.5) * 2 * math.pi, (v - 0.5) * math.pi
    d = np.array([math.cos(lat) * math.cos(phi), math.sin(lat), math.cos(lat) * math.sin(phi)])        # three 的 equirect：u = atan2(z, x)/2π + 0.5，v = asin(y)/π + 0.5
    el, az = math.radians(13.0), math.radians(25.0)
    sun = np.array([math.cos(el) * math.cos(az), math.sin(el), -math.cos(el) * math.sin(az)])
    ang = math.degrees(math.acos(float(np.clip(d @ sun, -1, 1))))
    log(f'sky orientation check: brightest dir(three)={d.round(3)} SUN_DIR={sun.round(3)} angle={ang:.2f}°')
    px = bake(os.path.join(OUTS, 'sky_2k.hdr'), False, (2048, 1024))
    h = px.shape[0]
    log('sky_2k.hdr', f'{os.path.getsize(os.path.join(OUTS, "sky_2k.hdr")) / 1e6:.2f}MB', 'zenith', px[h - 2].mean(0).round(3), 'horizon(sun side)', px[h // 2 + 6, int(0.4306 * px.shape[1])].round(3),
        'horizon(anti-sun)', px[h // 2 + 6, int(0.93 * px.shape[1])].round(3), 'below', px[h // 4].mean(0).round(3))
    return {'file': 'sky_2k.hdr', 'checkAngleDeg': round(ang, 2), 'strength': sc_.SKY_STRENGTH}


# ----------------------------------------------------------------------------- 主流程
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    meta_path = os.path.join(OUTW, 'world.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    if DO('tex'):
        export_textures()
    if DO('rocks'):
        meta.update(export_rocks())
    if DO('trees'):
        meta.update(export_trees())
    if DO('sky'):
        meta['sky'] = export_sky()
        json.dump(meta['sky'], open(os.path.join(OUTS, 'sky.json'), 'w'))
    json.dump(meta, open(meta_path, 'w'), separators=(',', ':'))
    tot = sum(os.path.getsize(os.path.join(OUTW, f)) for f in os.listdir(OUTW))
    log(f'assets/world total {tot / 1e6:.1f}MB')


main()
