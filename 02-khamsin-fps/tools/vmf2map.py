# 把 Hammer 的 .vmf 灰盒地图转成游戏用的地形数据（只取几何，不取任何材质 / 模型）：
#   python3 -I tools/vmf2map.py <地图.vmf> assets/maps/<名字>.kmap [--preview 俯视图.png] [--stat]
#
# 取什么：
#   · 实心笔刷（world + func_detail + func_brush）的每个面 → 凸多边形。带可见贴图的面参与渲染，NODRAW 面只进碰撞
#   · 位移面（dispinfo）→ (2^power+1)² 的网格
#   · PLAYERCLIP / CLIP 笔刷 → 只挡人的隐形墙
#   · info_player_start、light / light_spot 的位置（灯位拿来挂我们自己的灯）
# 不取：SKIP / HINT / AREAPORTAL / TRIGGER / SKYBOX / BLOCKLIGHT 这些编辑器辅助面，以及被隐藏（hidden）且属于辅助分组的内容
#
# 坐标：Source 是 Z 朝上、1 单位 = 1 英寸（玩家 72 单位高）；这里换成 Y 朝上的米制：(x, y, z)src → (x, z, −y) × 0.0254，
#       再绕 Y 轴转 --yaw 度、平移 --center，让可玩区域落在原点附近、两队出生点沿 Z 轴分布（和其它地图的约定一致）。
#
# 输出 .kmap：'KMAP' + 版本(u32) + JSON 头长度(u32) + JSON 头 + 若干小端二进制段（段的偏移 / 长度写在 JSON 头里）
#   faces : 每个面 [n(u8) kind(u8) brush(u32)] + n×3 个 float32（kind：0 可见 1 仅碰撞 2 隐形墙）
#   disps : 每块 [power(u8)] + 面法线 3 个 float32 + (2^power+1)²×3 个 float32（行优先）
import sys, re, math, json, struct, argparse

S = 0.0254
EPS = 0.02          # 平面裁剪容差（Source 单位）
TOOL_SKIP = ('TOOLS/TOOLSSKIP', 'TOOLS/TOOLSHINT', 'TOOLS/TOOLSAREAPORTAL', 'TOOLS/TOOLSTRIGGER', 'TOOLS/TOOLSSKYBOX', 'TOOLS/TOOLSSKYBOX2D', 'TOOLS/TOOLSBLOCKLIGHT', 'TOOLS/TOOLSOCCLUDER', 'TOOLS/TOOLSINVISIBLE', 'TOOLS/TOOLSBLOCKBULLETS')
TOOL_CLIP = ('TOOLS/TOOLSPLAYERCLIP', 'TOOLS/TOOLSCLIP', 'TOOLS/TOOLSNPCCLIP')
TOOL_NODRAW = ('TOOLS/TOOLSNODRAW',)
SOLID_ENTS = ('func_detail', 'func_brush', 'func_wall', 'func_illusionary_not')


def parse(path):
    root = {'name': 'root', 'kv': {}, 'ch': []}; stack = [root]; pend = None
    kvre = re.compile(r'^\s*"([^"]*)"\s+"([^"]*)"\s*$')
    with open(path, encoding='utf8', errors='replace') as f:
        for line in f:
            s = line.strip()
            if not s: continue
            if s == '{': n = {'name': pend, 'kv': {}, 'ch': []}; stack[-1]['ch'].append(n); stack.append(n); pend = None
            elif s == '}': stack.pop()
            else:
                m = kvre.match(line)
                if m: stack[-1]['kv'][m.group(1)] = m.group(2)
                else: pend = s
    return root


def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a):
    l = math.sqrt(dot(a, a)); return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-12 else (0.0, 0.0, 0.0)


PL = re.compile(r'\(([-\d.eE+]+) ([-\d.eE+]+) ([-\d.eE+]+)\)')
def plane_of(side):
    p = [tuple(float(v) for v in m.groups()) for m in PL.finditer(side['kv']['plane'])]
    n = norm(cross(sub(p[2], p[0]), sub(p[1], p[0])))   # 三点从外面看是顺时针：法线朝外
    return n, dot(n, p[0]), p


def clip(poly, n, d):
    """保留多边形在平面 n·x ≤ d 一侧的部分"""
    out = []; m = len(poly)
    for i in range(m):
        a, b = poly[i], poly[(i + 1) % m]; da, db = dot(n, a) - d, dot(n, b) - d
        if da <= EPS: out.append(a)
        if (da > EPS and db < -EPS) or (da < -EPS and db > EPS):
            t = da / (da - db); out.append(add(a, mul(sub(b, a), t)))
    return out


def brush_faces(solid):
    sides = [c for c in solid['ch'] if c['name'] == 'side']; planes = [plane_of(s) for s in sides]; res = []
    for i, (n, d, p) in enumerate(planes):
        u = norm(cross(n, (0, 0, 1) if abs(n[2]) < 0.9 else (1, 0, 0))); v = cross(n, u); o = mul(n, d); R = 131072.0
        poly = [add(o, add(mul(u, -R), mul(v, -R))), add(o, add(mul(u, R), mul(v, -R))), add(o, add(mul(u, R), mul(v, R))), add(o, add(mul(u, -R), mul(v, R)))]
        for j, (n2, d2, _) in enumerate(planes):
            if j != i:
                poly = clip(poly, n2, d2)
                if len(poly) < 3: break
        # 去掉重合点
        q = []
        for pt in poly:
            if not q or max(abs(pt[k] - q[-1][k]) for k in range(3)) > 0.05: q.append(pt)
        if len(q) > 1 and max(abs(q[0][k] - q[-1][k]) for k in range(3)) <= 0.05: q.pop()
        if len(q) < 3: continue
        # 绕序统一成从外面看逆时针（右手系下法线朝外）
        a = (0.0, 0.0, 0.0)
        for k in range(1, len(q) - 1): a = add(a, cross(sub(q[k], q[0]), sub(q[k + 1], q[0])))
        if dot(a, n) < 0: q.reverse()
        if math.sqrt(dot(a, a)) < 1.0: continue   # 面积不到半个平方单位
        res.append((sides[i], n, q))
    return res


def floats(s): return [float(v) for v in s.replace('[', ' ').replace(']', ' ').split()]


def displacement(side, n, poly, flip):
    di = next(c for c in side['ch'] if c['name'] == 'dispinfo'); power = int(di['kv']['power']); size = (1 << power) + 1
    if len(poly) != 4: return None
    sp = floats(di['kv']['startposition']); elev = float(di['kv'].get('elevation', 0))
    q = list(poly)
    if flip: q.reverse()
    s = min(range(4), key=lambda k: sum((q[k][c] - sp[c]) ** 2 for c in range(3))); q = q[s:] + q[:s]
    rows = lambda name, w: [floats(next(c for c in di['ch'] if c['name'] == name)['kv']['row%d' % r]) for r in range(size)] if any(c['name'] == name for c in di['ch']) else [[0.0] * (size * w)] * size
    nr, ds, of = rows('normals', 3), rows('distances', 1), rows('offsets', 3)
    grid = []
    for i in range(size):
        t1 = i / (size - 1); L = add(q[0], mul(sub(q[1], q[0]), t1)); Rr = add(q[3], mul(sub(q[2], q[3]), t1))
        for j in range(size):
            t2 = j / (size - 1); b = add(L, mul(sub(Rr, L), t2))
            dn = (nr[i][j * 3], nr[i][j * 3 + 1], nr[i][j * 3 + 2]); dist = ds[i][j]
            grid.append(add(add(add(b, mul(dn, dist)), (of[i][j * 3], of[i][j * 3 + 1], of[i][j * 3 + 2])), mul(n, elev)))
    return power, grid, n


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('vmf'); ap.add_argument('out', nargs='?'); ap.add_argument('--preview'); ap.add_argument('--stat', action='store_true')
    ap.add_argument('--yaw', type=float, default=0.0); ap.add_argument('--center', default=''); ap.add_argument('--hidden', default='clip', help='隐藏内容怎么处理：none 全不要 / clip 只要隐形墙 / all 全要')
    A = ap.parse_args()
    root = parse(A.vmf); world = next(c for c in root['ch'] if c['name'] == 'world')
    ents = [c for c in root['ch'] if c['name'] == 'entity']
    hidden_ents = [e for h in root['ch'] if h['name'] == 'hidden' for e in h['ch'] if e['name'] == 'entity']

    def solids_of(node):
        out = []
        for c in node['ch']:
            if c['name'] == 'solid': out.append((c, False))
            elif c['name'] == 'hidden': out += [(s, True) for s in c['ch'] if s['name'] == 'solid']
        return out

    groups = [('world', world, False)] + [(e['kv'].get('classname', '?'), e, False) for e in ents] + [(e['kv'].get('classname', '?'), e, True) for e in hidden_ents]
    faces = []; disps = []; stat = {}; bid = 0; flips = {}
    raw_disp = []
    for cls, node, ent_hidden in groups:
        if cls != 'world' and cls not in SOLID_ENTS: continue
        for solid, hid in solids_of(node):
            hid = hid or ent_hidden; bid += 1; fs = brush_faces(solid)
            mats = [s['kv'].get('material', '').upper() for s, _, _ in fs]
            has_disp = any(any(c['name'] == 'dispinfo' for c in s['ch']) for s, _, _ in fs)
            is_clip = bool(mats) and all(m in TOOL_CLIP or m in TOOL_NODRAW for m in mats) and any(m in TOOL_CLIP for m in mats)
            is_tool = bool(mats) and all(m in TOOL_SKIP or m in TOOL_NODRAW for m in mats) and any(m in TOOL_SKIP for m in mats)
            key = ('hidden ' if hid else '') + cls + (' disp' if has_disp else ' clip' if is_clip else ' tool' if is_tool else ' solid'); stat[key] = stat.get(key, 0) + 1
            if is_tool: continue
            if hid and (A.hidden == 'none' or (A.hidden == 'clip' and not is_clip)): continue
            for (side, n, poly), m in zip(fs, mats):
                if has_disp:
                    if any(c['name'] == 'dispinfo' for c in side['ch']): raw_disp.append((side, n, poly))
                    continue   # 带位移的笔刷：只有位移面存在，其余面丢弃
                if m in TOOL_SKIP: continue
                kind = 2 if is_clip else (1 if (m in TOOL_NODRAW or m in TOOL_CLIP) else 0)
                faces.append((kind, bid, poly, n))

    # 位移网格的行列方向：两种取法里选接缝对得上的那一种
    def build(flip):
        out = []
        for side, n, poly in raw_disp:
            d = displacement(side, n, poly, flip)
            if d: out.append(d)
        return out
    def seam_err(ds):
        # 相邻位移块的边界顶点应该两两重合：统计「在别的块里找不到重合点」的边界顶点数，越少越对
        seen = {}; n = 0
        for di, (power, g, _) in enumerate(ds):
            size = (1 << power) + 1
            for i in range(size):
                for j in range(size):
                    if i in (0, size - 1) or j in (0, size - 1):
                        p = g[i * size + j]; n += 1; seen.setdefault((round(p[0] / 2), round(p[1] / 2), round(p[2] / 2)), set()).add(di)
        lone = sum(1 for v in seen.values() if len(v) == 1)
        return lone, n
    cand = [(seam_err(build(f)), f) for f in (False, True)]; cand.sort(key=lambda c: c[0][0]); disps = build(cand[0][1])
    print('位移块', len(disps), '接缝错位（两种行列方向）', [(c[0], c[1]) for c in cand], file=sys.stderr)

    # 坐标换算
    yaw = math.radians(A.yaw); cy, sy = math.cos(yaw), math.sin(yaw)
    cen = [float(v) for v in A.center.split(',')] if A.center else [0.0, 0.0, 0.0]
    def T(p):
        x, y, z = p[0] * S, p[2] * S, -p[1] * S; x -= cen[0]; y -= cen[1]; z -= cen[2]
        return (x * cy + z * sy, y, -x * sy + z * cy)
    def Tdir(p):
        x, y, z = p[0], p[2], -p[1]; return (x * cy + z * sy, y, -x * sy + z * cy)

    pts_all = [T(p) for _, _, poly, _ in faces for p in poly] + [T(p) for _, g, _ in disps for p in g]
    lo = [min(p[k] for p in pts_all) for k in range(3)]; hi = [max(p[k] for p in pts_all) for k in range(3)]
    all_ents = [(e, False) for e in ents] + [(e, True) for e in hidden_ents]
    def org(e): return T(floats(e['kv'].get('origin', '0 0 0')))
    spawns = [{'p': [round(v, 3) for v in org(e)], 'yaw': float((e['kv'].get('angles', '0 0 0').split() + ['0', '0'])[1])} for e, h in all_ents if e['kv'].get('classname', '').startswith('info_player')]
    lights = []
    for e, h in all_ents:
        c = e['kv'].get('classname', '')
        if c in ('light', 'light_spot'):
            col = floats(e['kv'].get('_light', '255 255 255 200')); lights.append({'p': [round(v, 3) for v in org(e)], 'c': [round(v / 255, 3) for v in col[:3]], 'b': col[3] if len(col) > 3 else 200, 'spot': c == 'light_spot', 'hidden': h})
    env = next((e for e, h in all_ents if e['kv'].get('classname') == 'light_environment'), None)
    kinds = [0, 0, 0]
    for k, _, _, _ in faces: kinds[k] += 1
    head = {'name': A.vmf.split('/')[-1], 'scale': S, 'yaw': A.yaw, 'center': cen, 'min': [round(v, 3) for v in lo], 'max': [round(v, 3) for v in hi], 'faces': len(faces), 'faceKinds': kinds, 'disps': len(disps), 'spawns': spawns, 'lights': lights,
            'sun': {'angles': env['kv'].get('angles'), 'pitch': env['kv'].get('pitch')} if env else None}
    print(json.dumps({k: v for k, v in head.items() if k not in ('lights',)}, ensure_ascii=False), file=sys.stderr)
    print('笔刷分类', json.dumps(stat, ensure_ascii=False), file=sys.stderr)
    if A.stat:
        pw = {}
        for p, _, _ in disps: pw[p] = pw.get(p, 0) + 1
        print('位移 power 分布', pw, '灯', len(lights), file=sys.stderr)
        # 朝上表面按高度的面积分布（1 米一档）：用来定地面高度
        hist = {}
        def tri_area(a, b, c): return 0.5 * math.sqrt(dot(cross(sub(b, a), sub(c, a)), cross(sub(b, a), sub(c, a))))
        for kind, _, poly, n in faces:
            if kind != 0 or Tdir(n)[1] < 0.7: continue
            pp = [T(q) for q in poly]; ar = sum(tri_area(pp[0], pp[k], pp[k + 1]) for k in range(1, len(pp) - 1)); h = math.floor(sum(q[1] for q in pp) / len(pp)); hist[h] = hist.get(h, [0, 0]); hist[h][0] += ar
        for power, g, _ in disps:
            size = (1 << power) + 1; gg = [T(q) for q in g]
            for i in range(size - 1):
                for j in range(size - 1):
                    q = [gg[i * size + j], gg[i * size + j + 1], gg[(i + 1) * size + j + 1], gg[(i + 1) * size + j]]; ar = tri_area(q[0], q[1], q[2]) + tri_area(q[0], q[2], q[3]); h = math.floor(sum(v[1] for v in q) / 4); hist[h] = hist.get(h, [0, 0]); hist[h][1] += ar
        print('高度(m): 笔刷顶面面积 / 位移地形面积', file=sys.stderr)
        for h in sorted(hist): print('  %4d  %7.0f  %7.0f' % (h, hist[h][0], hist[h][1]), file=sys.stderr)
        cl = [(min(T(q)[1] for q in poly), max(T(q)[1] for q in poly)) for kind, _, poly, n in faces if kind == 2]
        print('隐形墙面数', len(cl), '高度范围', round(min(c[0] for c in cl), 1), round(max(c[1] for c in cl), 1), file=sys.stderr)
        print('灯', [(l['p'], l['c'], l['b'], l['spot']) for l in lights][:30], file=sys.stderr)

    if A.out:
        fb = bytearray()
        for kind, b, poly, n in faces:
            fb += struct.pack('<BBI', len(poly), kind, b)
            for p in poly: fb += struct.pack('<3f', *T(p))
        db = bytearray()
        for power, g, n in disps:
            db += struct.pack('<B', power) + struct.pack('<3f', *Tdir(n))
            for p in g: db += struct.pack('<3f', *T(p))
        head['seg'] = {'faces': [0, len(fb)], 'disps': [len(fb), len(db)]}
        hj = json.dumps(head, ensure_ascii=False, separators=(',', ':')).encode('utf8')
        with open(A.out, 'wb') as f: f.write(b'KMAP' + struct.pack('<II', 2, len(hj)) + hj + bytes(fb) + bytes(db))
        print('写出', A.out, round((12 + len(hj) + len(fb) + len(db)) / 1048576, 2), 'MB', file=sys.stderr)

    if A.preview:
        from PIL import Image, ImageDraw
        W = 2000; sx = W / (hi[0] - lo[0]); H = int((hi[2] - lo[2]) * sx) + 1; im = Image.new('RGB', (W, H), (18, 20, 24)); dr = ImageDraw.Draw(im)
        px = lambda p: ((p[0] - lo[0]) * sx, (p[2] - lo[2]) * sx)
        items = []
        for kind, b, poly, n in faces:
            if kind != 0: continue
            nn = Tdir(n)
            if nn[1] < 0.3: continue
            pp = [T(p) for p in poly]; items.append((sum(p[1] for p in pp) / len(pp), [px(p) for p in pp], None))
        for power, g, _ in disps:
            size = (1 << power) + 1; gg = [T(p) for p in g]
            for i in range(size - 1):
                for j in range(size - 1):
                    q = [gg[i * size + j], gg[i * size + j + 1], gg[(i + 1) * size + j + 1], gg[(i + 1) * size + j]]; items.append((sum(p[1] for p in q) / 4, [px(p) for p in q], 'd'))
        items.sort(key=lambda it: it[0])
        for h, pp, tag in items:
            t = max(0.0, min(1.0, (h - lo[1]) / max(1e-6, (hi[1] - lo[1])))); c = int(40 + 215 * t)
            dr.polygon(pp, fill=(int(c * 0.75), c, int(c * 0.7)) if tag else (c, c, int(c * 0.92)))
        for kind, b, poly, n in faces:
            if kind == 2 and Tdir(n)[1] > 0.3: dr.polygon([px(T(p)) for p in poly], outline=(255, 80, 60))
        for s in spawns: x, y = px(s['p']); dr.ellipse([x - 9, y - 9, x + 9, y + 9], outline=(60, 220, 255), width=3)
        for l in lights: x, y = px(l['p']); dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 190, 70))
        for gx in range(int(lo[0] // 20) * 20, int(hi[0]) + 1, 20): dr.line([px((gx, 0, lo[2])), px((gx, 0, hi[2]))], fill=(70, 80, 110) if gx else (200, 90, 90))
        for gz in range(int(lo[2] // 20) * 20, int(hi[2]) + 1, 20): dr.line([px((lo[0], 0, gz)), px((hi[0], 0, gz))], fill=(70, 80, 110) if gz else (200, 90, 90))
        im.save(A.preview); print('俯视图', A.preview, im.size, file=sys.stderr)


main()
