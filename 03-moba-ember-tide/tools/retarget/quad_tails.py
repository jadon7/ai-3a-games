"""四足（换画风 B · w-quad 写的）：把读出来的骨架（dump_rig.py 的 npz）里指定骨骼的“尾巴”改成指向它的某个子骨骼的头，给 `dir` 模式搭标架用。

为什么：`dir` 模式按“骨骼方向”（尾 − 头）搭标架，让目标骨骼在世界里指向和源一样的方向。Tripo 的四足绑骨有不少骨骼的尾巴不指向下一节
（有两三个子骨骼时 Blender 导入随便取一个方向：旧卡兹的右大腿尾巴朝身体外侧，和左大腿差 50 多度；新卡兹的前爪掌有三根脚趾）。
两边都改成“指向同一个解剖位置的下一节”以后，方向才对得上。只改 npz 里的 tail，别的不动（rest 矩阵、网格、权重都不变，出品不受影响）。

用法: <V2R 的 python> tools/retarget/quad_tails.py <rig.npz> <tails.json> <输出.npz>
tails.json: {"骨骼名": "子骨骼名", …}（子骨骼不一定是直接的孩子，往下几节的也行，取它的头）
"""
import json, sys
import numpy as np

src, spec_path, dst = sys.argv[1:4]
spec = {k: v for k, v in json.load(open(spec_path, encoding="utf-8")).items() if not k.startswith("_")}
z = dict(np.load(src, allow_pickle=True)); names = [str(n) for n in z["names"]]; idx = {n: i for i, n in enumerate(names)}
tail = z["tail"].copy(); n = 0
for b, c in spec.items():
    if b not in idx or c not in idx: print("SKIP（这个骨架里没有）", b, "->", c); continue
    old = tail[idx[b]] - z["head"][idx[b]]; L = np.linalg.norm(old)
    d = z["head"][idx[c]] - z["head"][idx[b]]; tail[idx[b]] = z["head"][idx[b]] + d / np.linalg.norm(d) * L; n += 1
    ang = np.degrees(np.arccos(np.clip(np.dot(old / L, d / np.linalg.norm(d)), -1, 1)))
    if ang > 5: print(f"  {b}: 方向改了 {ang:.0f}°")
z["tail"] = tail; np.savez(dst, **z); print("TAILS", n, "根 ->", dst)
