# GLB 瘦身：顶点色 uint16 → uint8，法线 float32 → 归一化 int16（KHR_mesh_quantization）。每个顶点省 8 字节，画面无可见差别。
# 用法：python3 tools/blender/glbpack.py assets/models/rifle.glb [...]；build_weapons.py 导出后也会自动调用。
import json, struct, sys, array, os


def pack(path):
    d = open(path, 'rb').read()
    jl = struct.unpack_from('<I', d, 12)[0]; js = json.loads(d[20:20 + jl]); bo = 20 + jl; bl = struct.unpack_from('<I', d, bo)[0]; binc = d[bo + 8:bo + 8 + bl]
    col = set(); nrm = set()
    for m in js.get('meshes', []):
        for p in m['primitives']:
            if 'COLOR_0' in p['attributes']: col.add(p['attributes']['COLOR_0'])
            if 'NORMAL' in p['attributes']: nrm.add(p['attributes']['NORMAL'])
    users = {}
    for i, a in enumerate(js['accessors']): users.setdefault(a.get('bufferView'), []).append(i)
    out = bytearray(); views = []; changed = 0
    for vi, bv in enumerate(js['bufferViews']):
        o = bv.get('byteOffset', 0); raw = binc[o:o + bv['byteLength']]; us = users.get(vi, []); bv = dict(bv)
        if len(us) == 1 and 'byteStride' not in bv and js['accessors'][us[0]].get('byteOffset', 0) == 0:
            i = us[0]; a = js['accessors'][i]
            if i in col and a['componentType'] == 5123 and a['type'] == 'VEC4':
                src = array.array('H'); src.frombytes(raw[:a['count'] * 8]); raw = bytes((v + 128) // 257 for v in src); a['componentType'] = 5121; changed += 1
            elif i in nrm and a['componentType'] == 5126 and a['type'] == 'VEC3':
                src = array.array('f'); src.frombytes(raw[:a['count'] * 12]); dst = array.array('h')
                for k in range(a['count']):
                    dst.extend((max(-32767, min(32767, round(src[k * 3] * 32767))), max(-32767, min(32767, round(src[k * 3 + 1] * 32767))), max(-32767, min(32767, round(src[k * 3 + 2] * 32767))), 0))
                raw = dst.tobytes(); a['componentType'] = 5122; a['normalized'] = True; bv['byteStride'] = 8; changed += 1
        while len(out) % 4: out.append(0)
        bv['byteOffset'] = len(out); bv['byteLength'] = len(raw); out += raw; views.append(bv)
    if not changed: return 0
    while len(out) % 4: out.append(0)
    js['bufferViews'] = views; js['buffers'][0]['byteLength'] = len(out)
    for k in ('extensionsUsed', 'extensionsRequired'):
        ext = js.setdefault(k, [])
        if 'KHR_mesh_quantization' not in ext: ext.append('KHR_mesh_quantization')
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8'); jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total)); f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb); f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)
    return len(d) - total


if __name__ == '__main__':
    for p in sys.argv[1:]:
        before = os.path.getsize(p); saved = pack(p); print('%s: %.2f MB → %.2f MB' % (os.path.basename(p), before / 1048576, (before - saved) / 1048576))
