"""量刀镡中心和刀尖在成品 GLB 里右手骨骼（mixamorig:RightHand）局部坐标里的位置（游戏用 bone.localToWorld 取刀镡/刀尖）。
做法：直接读 glb：weapon 网格的顶点（绑定姿势、网格空间）乘右手的 inverseBindMatrix。刀尖 = 两头里离手远的那头；
刀镡中心 = 刀镡外缘那一圈顶点的中心（离刀身中线最远的那些点，在柄尾→刀尖的 26.9% 附近）。
用法: python weapon_points.py <glb>（未压缩的 game.glb）"""
import sys, json, struct, numpy as np
f = open(sys.argv[1], 'rb').read(); jl = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + jl]); bin_ = f[20 + jl + 8:]
def acc(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride')
    if st and st != n * np.dtype(dt).itemsize:
        raw = np.frombuffer(bin_, np.uint8, count=st * a['count'], offset=off).reshape(a['count'], st)
        return raw[:, :n * np.dtype(dt).itemsize].copy().view(dt).reshape(a['count'], n)
    return np.frombuffer(bin_, dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
mi = next(i for i, m in enumerate(J['meshes']) if m['name'] == 'weapon'); node = next(n for n in J['nodes'] if n.get('mesh') == mi)
assert 'matrix' not in node and not node.get('translation') and not node.get('rotation'), node
V = acc(J['meshes'][mi]['primitives'][0]['attributes']['POSITION']).astype(float)
sk = J['skins'][node['skin']]; names = [J['nodes'][j]['name'] for j in sk['joints']]; k = names.index('mixamorig:RightHand')
IBM = acc(sk['inverseBindMatrices'])[k].reshape(4, 4).T.astype(float)        # glTF 列主序
L = (IBM @ np.c_[V, np.ones(len(V))].T).T[:, :3]
a_ = L[np.argmax(np.linalg.norm(L - L.mean(0), axis=1))]; b_ = L[np.argmax(np.linalg.norm(L - a_, axis=1))]
tip, pom = (a_, b_) if np.linalg.norm(a_) > np.linalg.norm(b_) else (b_, a_)      # 两头里离手（原点）远的是刀尖
ax = (tip - pom) / np.linalg.norm(tip - pom); t = (L - pom) @ ax; Lt = np.linalg.norm(tip - pom)
near = np.abs(t / Lt - 0.27) < 0.012; perp = np.linalg.norm((L - pom) - np.outer(t, ax), axis=1)
rim = near & (perp > np.percentile(perp[near], 80)); base = L[rim].mean(0)
print(json.dumps({"bone": "mixamorig:RightHand", "base": [round(x, 4) for x in base], "tip": [round(x, 4) for x in tip], "pommel": [round(x, 4) for x in pom], "len": round(float(Lt), 4), "blade": round(float(np.linalg.norm(tip - base)), 4)}))
