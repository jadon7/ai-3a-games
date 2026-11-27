# 读取 GLB 的 JSON 块并打印结构统计： python3 -I glbinfo.py file.glb [-v]
import json, struct, sys
def load(path):
    with open(path, 'rb') as f:
        magic, ver, total = struct.unpack('<III', f.read(12))
        clen, ctype = struct.unpack('<II', f.read(8))
        js = json.loads(f.read(clen))
    return js
def info(path, verbose=False):
    g = load(path)
    nodes = g.get('nodes', [])
    roots = [nodes[i]['name'] for i in g['scenes'][g.get('scene', 0)]['nodes']]
    tris = 0; prims = 0
    acc = g['accessors']
    for m in g.get('meshes', []):
        for p in m['primitives']:
            prims += 1
            tris += (acc[p['indices']]['count'] if 'indices' in p else acc[p['attributes']['POSITION']['count']]) // 3
    print(path.split('/')[-1], 'roots', roots, 'nodes', len(nodes), 'meshes', len(g.get('meshes', [])), 'prims', prims, 'tris', tris, 'materials', len(g.get('materials', [])), 'images', len(g.get('images', [])), 'ext', g.get('extensionsUsed'))
    def show(i, d):
        n = nodes[i]
        mp = ''
        if 'mesh' in n:
            m = g['meshes'][n['mesh']]
            mp = f" mesh prims={len(m['primitives'])}"
        print('  ' * d + f"- {n.get('name')} t={[round(v,3) for v in n.get('translation',[0,0,0])]} r={n.get('rotation')} s={n.get('scale')}{mp}")
        for c in n.get('children', []): show(c, d + 1)
    for i in g['scenes'][g.get('scene', 0)]['nodes']: show(i, 1)
    if verbose:
        for m in g.get('materials', []):
            pbr = m.get('pbrMetallicRoughness', {})
            print('   mat', m.get('name'), 'alpha', m.get('alphaMode', 'OPAQUE'), m.get('alphaCutoff', ''), 'ds', m.get('doubleSided', False), 'bcf', [round(v, 2) for v in pbr.get('baseColorFactor', [1, 1, 1, 1])], 'tex' if 'baseColorTexture' in pbr else '', 'mr', pbr.get('metallicFactor', 1), round(pbr.get('roughnessFactor', 1), 2), 'ext', list(m.get('extensions', {}).keys()), 'em', m.get('emissiveFactor'))
        bv = g['bufferViews']
        for im in g.get('images', []):
            print('   img', im.get('name'), im.get('mimeType'), round(bv[im['bufferView']]['byteLength'] / 1e6, 2), 'MB')
if __name__ == '__main__':
    v = '-v' in sys.argv
    for p in sys.argv[1:]:
        if p != '-v': info(p, v)
