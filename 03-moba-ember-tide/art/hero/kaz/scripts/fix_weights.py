#!/usr/bin/env python3
"""卡兹的权重修补：肩甲（铁片和护肩）是硬的，不能跟着脖子弯、也不该被前腿的上臂扯变形。
Tripo 绑出来的肩甲：主体在 Spine_3~6 上（映射里 Spine_4~6 不受控，四根跟着 Spine_3 整块走，本来就是硬的），
但靠前的一圈（护肩前沿、最前面那片铁片的根）约四分之一在脖子的骨骼上（bone_31/32/33、Head_0），护肩两侧下沿在上臂上（0_*_Limb_1）。
做法（只改 GLB 里的 JOINTS_0 / WEIGHTS_0 两个数组，别的字节不动）：
  · 先认出“铁甲”：贴图的 ORM 里金属度高（沿网格邻接平滑两遍），在肩背这一段（x∈[-0.12,0.36]，z>0.12），而且不是头上的（面甲另算，它本来就在头的骨骼上）。
    金属度从 0.12 到 0.24 之间按比例过渡，铁甲和毛的交界不会出一道硬折痕。
  · 铁甲上脖子骨骼的权重 → Spine_6（全挪）。
  · 铁甲上上臂的权重 → Spine_5：护肩高处（z>0.40，肩关节以上）全挪，0.30~0.40 之间按比例，再往下（护肩下沿）留给上臂。
用法: python3 fix_weights.py <Tripo 原件.glb> <输出.glb>"""
import io, json, struct, sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1:3]
b = bytearray(open(src, "rb").read())
jl, = struct.unpack("<I", b[12:16]); js = json.loads(bytes(b[20:20 + jl])); bin0 = 20 + jl + 8
acc, bvs = js["accessors"], js["bufferViews"]
prim = js["meshes"][0]["primitives"][0]


def view(ai, dtype, ncomp):
    a = acc[ai]; bv = bvs[a["bufferView"]]; assert "byteStride" not in bv
    off = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype=dtype, count=a["count"] * ncomp, offset=off).reshape(a["count"], ncomp), off


pos, _ = view(prim["attributes"]["POSITION"], "<f4", 3)
uv, _ = view(prim["attributes"]["TEXCOORD_0"], "<f4", 2)
J, joff = view(prim["attributes"]["JOINTS_0"], np.uint8, 4)
Wt, woff = view(prim["attributes"]["WEIGHTS_0"], "<f4", 4)
idx, _ = view(prim["indices"], "<u2", 1); tris = idx.reshape(-1, 3).astype(int)
names = [js["nodes"][j]["name"].replace("tripo::", "") for j in js["skins"][0]["joints"]]
nb = len(names); nv = len(pos); bi = names.index
x, y, z = pos[:, 0], -pos[:, 2], pos[:, 1]                      # glTF（Y 朝上）→ Blender 坐标（Z 朝上，卡兹面朝 +X，左侧 +Y）
# 金属度：ORM 贴图的 B 通道
mr = js["materials"][0]["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]
img = js["images"][js["textures"][mr]["source"]]; ibv = bvs[img["bufferView"]]
orm = np.asarray(Image.open(io.BytesIO(bytes(b[bin0 + ibv.get("byteOffset", 0): bin0 + ibv.get("byteOffset", 0) + ibv["byteLength"]]))).convert("RGB"), dtype=np.float32) / 255
h, w = orm.shape[:2]
met = orm[np.clip((uv[:, 1] % 1) * h, 0, h - 1).astype(int), np.clip((uv[:, 0] % 1) * w, 0, w - 1).astype(int), 2]
# 沿网格邻接平滑两遍
nbr_sum = lambda v: np.bincount(tris[:, [0, 1, 2, 1, 2, 0]].ravel(), weights=v[tris[:, [1, 2, 0, 0, 1, 2]].ravel()], minlength=nv)
deg = nbr_sum(np.ones(nv))
m = met.copy()
for _ in range(2): m = (nbr_sum(m) + m) / (deg + 1)
# 稠密权重
D = np.zeros((nv, nb)); np.add.at(D, (np.repeat(np.arange(nv), 4), J.ravel().astype(int)), Wt.ravel())
head = D[:, [bi(n) for n in ("Head_1", "Head_2", "Head_3", "bone_36", "bone_37", "bone_38", "bone_39")]].sum(1)
region = (x > -0.12) & (x < 0.36) & (z > 0.12) & (head < 0.5)
a = np.clip((m - 0.12) / 0.12, 0, 1) * region
stat = {"铁甲顶点(a>0.5)": int((a > 0.5).sum())}
moved_neck = 0.0
for n in ("bone_31", "bone_32", "bone_33", "Head_0"):
    k = bi(n); mv = D[:, k] * a; D[:, k] -= mv; D[:, bi("Spine_6")] += mv; moved_neck += mv.sum()
ramp = np.clip((z - 0.30) / 0.10, 0, 1)
moved_arm = 0.0
for n in ("0_Left_Limb_1", "0_Right_Limb_1"):
    k = bi(n); mv = D[:, k] * a * ramp; D[:, k] -= mv; D[:, bi("Spine_5")] += mv; moved_arm += mv.sum()
stat["脖子→Spine_6(权重和)"] = round(float(moved_neck), 1); stat["上臂→Spine_5(权重和)"] = round(float(moved_arm), 1)
# 每个顶点留权重最大的 4 根，归一化
top = np.argsort(-D, axis=1)[:, :4]; tw = np.take_along_axis(D, top, 1); tw /= tw.sum(1, keepdims=True)
tw[tw < 1e-6] = 0; top[tw == 0] = 0
lost = 1 - np.take_along_axis(D, np.argsort(-D, axis=1)[:, :4], 1).sum(1) / D.sum(1)
stat["只留4根丢掉的权重(最大)"] = round(float(lost.max()), 4)
J2 = top.astype(np.uint8); W2 = tw.astype("<f4")
assert np.allclose(W2.sum(1), 1.0, atol=1e-4)
b[joff:joff + J2.nbytes] = J2.tobytes(); b[woff:woff + W2.nbytes] = W2.tobytes()
open(dst, "wb").write(b)
np.save("/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/kaz/armor_mask.npy", a.astype(np.float32))      # 看铁甲认得对不对用
print("改动统计:", json.dumps(stat, ensure_ascii=False))
print("写好了", dst, len(b), "字节")
