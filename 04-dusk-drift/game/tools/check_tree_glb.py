import sys, json
import numpy as np
sys.path.insert(0, '.')
import glb_weld as G
for path in sys.argv[1:]:
    g, b = G.read_glb(path)
    acc = g['accessors']; bvs = g['bufferViews']
    def arr(i):
        a = acc[i]; v = bvs[a['bufferView']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        return np.frombuffer(b, dtype=G.CT[a['componentType']], count=a['count'] * nc, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], nc)
    print('  scenes', g['scenes'], 'scene', g.get('scene'))
    roots = [g['nodes'][i]['name'] for i in g['scenes'][g.get('scene', 0)].get('nodes', [])]
    print(path.split('/')[-1], 'roots', roots, 'node t/r/s', [(n.get('translation'), n.get('rotation'), n.get('scale')) for n in g['nodes']])
    for m in g['meshes']:
        for p in m['primitives']:
            mat = g['materials'][p['material']]
            P = arr(p['attributes']['POSITION']); N = arr(p['attributes']['NORMAL']); I = arr(p['indices']).reshape(-1, 3); UV = arr(p['attributes']['TEXCOORD_0'])
            fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]); fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
            d = (fn * N[I[:, 0]]).sum(axis=1)
            ctr = np.array([0, P[:, 1].min() + 0.3 * (P[:, 1].max() - P[:, 1].min()), 0])
            out = P - ctr; out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)
            print('  ', mat['name'], mat.get('alphaMode', 'OPAQUE'), mat.get('alphaCutoff', ''), 'ds', mat.get('doubleSided'), 'verts', len(P), 'tris', len(I), 'Y range', round(float(P[:, 1].min()), 2), round(float(P[:, 1].max()), 2), 'XZ half', round(float(np.abs(P[:, [0, 2]]).max()), 2), 'face·N frac<0', round(float((d < 0).mean()), 3), 'N·outward mean', round(float((N * out).sum(axis=1).mean()), 3), 'uv', [round(float(x), 3) for x in (UV.min(), UV.max())])
    print('   images', [(im['name'], im['mimeType'], round(bvs[im['bufferView']]['byteLength'] / 1e6, 2)) for im in g.get('images', [])])
