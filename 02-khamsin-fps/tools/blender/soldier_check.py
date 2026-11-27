# 校验导出的 soldier.glb：关节名与顺序、权重归一、顶点数、属性类型（纯 Python，不需要 Blender）
import json, struct, sys, numpy as np
path = sys.argv[1]; d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; js = json.loads(d[20:20 + jl]); bn = d[20 + jl + 8:]
BONES = ['hips', 'spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'gun', 'footL', 'footR']
REST = {'hips': (0, 0.98, 0), 'spine': (0, 1.10, 0), 'head': (0, 1.56, 0), 'armL': (-0.21, 1.46, 0), 'foreL': (-0.23, 1.18, 0), 'armR': (0.21, 1.46, 0), 'foreR': (0.23, 1.18, 0), 'legL': (-0.1, 0.94, 0), 'shinL': (-0.1, 0.50, 0), 'legR': (0.1, 0.94, 0), 'shinR': (0.1, 0.50, 0), 'gun': (0.085, 1.365, -0.2), 'footL': (-0.1, 0.09, 0), 'footR': (0.1, 0.09, 0)}
CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]; f, sz = CT[a['componentType']]; nc = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(bn, dtype=np.dtype('<' + f), count=a['count'] * nc, offset=off).reshape(a['count'], nc).astype(np.float64)
    if a.get('normalized'): arr = arr / {5121: 255.0, 5123: 65535.0}[a['componentType']]
    return arr, a
sk = js['skins'][0]; names = [js['nodes'][j]['name'] for j in sk['joints']]
print('joints', names, 'OK' if names == BONES else 'MISMATCH')
ibm, _ = acc(sk['inverseBindMatrices'])
for n, m in zip(names, ibm):
    M = m.reshape(4, 4).T; pos = -M[:3, 3]; rot_ok = np.allclose(M[:3, :3], np.eye(3), atol=1e-4)
    if not (rot_ok and np.allclose(pos, REST[n], atol=1e-4)): print('  BAD bind', n, pos, rot_ok)
print('bind matrices: identity rotation + rest translation checked')
for nd in js['nodes']:
    if n := nd.get('name'):
        if nd.get('rotation') and not np.allclose(nd['rotation'], [0, 0, 0, 1], atol=1e-4): print('  node rotation', n, nd['rotation'])
tot = 0
for nd in js['nodes']:
    if 'mesh' not in nd: continue
    me = js['meshes'][nd['mesh']]; assert len(me['primitives']) == 1, 'multi-primitive'
    pr = me['primitives'][0]; A = pr['attributes']; P, _ = acc(A['POSITION']); Wt, wa = acc(A['WEIGHTS_0']); J, ja = acc(A['JOINTS_0']); C, ca = acc(A['COLOR_0']); idx, ia = acc(pr['indices']); U, ua = acc(A['TEXCOORD_0'])
    slots = np.floor(C[:, 0] * 16 + 1e-6).astype(int); tot += len(P)
    print('%-11s verts %6d tris %6d | attrs %s | color type %d norm %s | joints type %d max %d | weight sum %.4f..%.4f max infl %d | slots %s | G %.2f..%.2f | bbox y %.3f..%.3f z %.3f..%.3f | node T %s R %s skin %s' % (
        nd['name'], len(P), len(idx) // 3, sorted(A), ca['componentType'], ca.get('normalized'), ja['componentType'], int(J.max()), Wt.sum(1).min(), Wt.sum(1).max(), int((Wt > 0).sum(1).max()),
        sorted(set(slots.tolist())), C[:, 1].min(), C[:, 1].max(), P[:, 1].min(), P[:, 1].max(), P[:, 2].min(), P[:, 2].max(), nd.get('translation'), nd.get('rotation'), nd.get('skin')))
import os
print('total verts', tot, 'file %.2f MB' % (os.path.getsize(path) / 1048576), 'extensionsRequired', js.get('extensionsRequired'), 'materials', len(js.get('materials', [])), 'images', len(js.get('images', [])))
