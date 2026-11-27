# 合并 GLB 里属性完全相同的重复顶点（纯数据操作，不改变着色）： python3 -I glb_weld.py in.glb out.glb
import json, struct, sys
import numpy as np
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
Q = {'POSITION': 1e5, 'NORMAL': 1e3, 'TANGENT': 1e3, 'TEXCOORD': 1e5, 'COLOR': 255.0}

def read_glb(path):
    with open(path, 'rb') as f:
        magic, ver, total = struct.unpack('<III', f.read(12))
        clen, ctype = struct.unpack('<II', f.read(8)); g = json.loads(f.read(clen))
        blen, btype = struct.unpack('<II', f.read(8)); b = f.read(blen)
    return g, b

def write_glb(path, g, b):
    js = json.dumps(g, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    b += b'\0' * ((4 - len(b) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(b)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)

def main(src, dst):
    g, b = read_glb(src)
    acc = g['accessors']; bvs = g['bufferViews']
    bv_users = {}
    for i, a in enumerate(acc):
        bv_users.setdefault(a['bufferView'], []).append(i)
    blobs = [b[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in bvs]

    def arr(i):
        a = acc[i]; v = bvs[a['bufferView']]
        assert 'sparse' not in a and 'byteStride' not in v and a.get('byteOffset', 0) == 0 and len(bv_users[a['bufferView']]) == 1
        nc = NC[a['type']]
        return np.frombuffer(blobs[a['bufferView']], dtype=CT[a['componentType']], count=a['count'] * nc).reshape(a['count'], nc)

    # 同一个网格里的多个图元可能共用同一组顶点属性（Blender 导出器会这样做）：
    # 必须按"属性组"一起焊接、用同一份映射改写所有图元的索引，否则后处理的图元会指向错乱的顶点
    # （E30 的轮胎就是这样整圈消失的）
    groups = {}
    for m in g['meshes']:
        for p in m['primitives']:
            if p.get('mode', 4) != 4 or 'targets' in p or 'indices' not in p:
                continue
            groups.setdefault(tuple(sorted(p['attributes'].items())), []).append(p)
    # 导出器还会让不同网格共用内容相同的访问器（四个车轮的索引一模一样）：
    # 一个访问器若被多个属性组用到，给后来的组各复制一份，避免被前一组改写后再被错用
    def clone(ai):
        a = dict(acc[ai]); bvs.append(dict(bvs[a['bufferView']])); blobs.append(bytes(blobs[a['bufferView']]))
        a['bufferView'] = len(bvs) - 1; acc.append(a); bv_users[a['bufferView']] = [len(acc) - 1]
        return len(acc) - 1
    owner = {}
    regrouped = {}
    for gk, prims in groups.items():
        attrs = dict(gk)
        for n, ai in list(attrs.items()):
            if owner.setdefault(ai, gk) != gk:
                attrs[n] = clone(ai)
        for p in prims:
            p['attributes'] = dict(attrs)
            if owner.setdefault(('i', p['indices']), gk) != gk:
                p['indices'] = clone(p['indices']); owner[('i', p['indices'])] = gk
        regrouped[tuple(sorted(attrs.items()))] = prims
    groups = regrouped
    v0 = v1 = 0
    for gk, prims in groups.items():
        attrs = dict(gk); names = list(attrs.keys())
        data = {n: arr(attrs[n]) for n in names}
        keys = []
        for n in names:
            q = next(v for k, v in Q.items() if n.startswith(k))
            keys.append(np.round(data[n].astype(np.float64) * q).astype(np.int64))
        key = np.ascontiguousarray(np.concatenate(keys, axis=1))
        kv = key.view(np.dtype((np.void, key.dtype.itemsize * key.shape[1]))).reshape(-1)
        u, first, inv = np.unique(kv, return_index=True, return_inverse=True)
        order = np.argsort(first); rank = np.empty(len(order), np.int64); rank[order] = np.arange(len(order))
        keep = first[order]; remap = rank[inv.reshape(-1)]
        n_old = len(kv); n_new = len(keep)
        v0 += n_old; v1 += n_new
        for n in names:
            a = acc[attrs[n]]
            nd = np.ascontiguousarray(data[n][keep])
            blobs[a['bufferView']] = nd.tobytes(); a['count'] = n_new
            if n == 'POSITION':
                a['min'] = [float(x) for x in nd.min(axis=0)]; a['max'] = [float(x) for x in nd.max(axis=0)]
            else:
                a.pop('min', None); a.pop('max', None)
        done = set()
        for p in prims:
            if p['indices'] in done:
                continue
            done.add(p['indices'])
            idx = arr(p['indices']).reshape(-1).astype(np.int64)
            nidx = remap[idx]
            ia = acc[p['indices']]
            if n_new <= 65535:
                ia['componentType'] = 5123; blobs[ia['bufferView']] = nidx.astype(np.uint16).tobytes()
            else:
                ia['componentType'] = 5125; blobs[ia['bufferView']] = nidx.astype(np.uint32).tobytes()
            ia.pop('min', None); ia.pop('max', None)
    out = bytearray()
    for i, v in enumerate(bvs):
        out += b'\0' * ((4 - len(out) % 4) % 4)
        v['byteOffset'] = len(out); v['byteLength'] = len(blobs[i])
        out += blobs[i]
    g['buffers'] = [{'byteLength': len(out) + (4 - len(out) % 4) % 4}]
    write_glb(dst, g, bytes(out))
    print('weld', src.split('/')[-1], 'verts', v0, '->', v1)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
