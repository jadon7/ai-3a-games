#!/usr/bin/env python3
"""把建好的关键建筑模型从 lab/kit/*/out/ 收进 public/assets/kit/，并写清单 index.json（游戏按清单决定哪些用正式模型、哪些还摆占位）。
用法：python3 tools/kit_collect.py [--src lab/kit_b] [只收这些名字 ...]
--src 从哪个文件夹收（默认 lab/kit，2.7 的厚涂版；换画风 B 的那一版在 lab/kit_b）"""
import json, os, shutil, struct, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = {"tower_me": ["tower_me_1", "tower_me_2", "tower_me_3"], "tower_foe": ["tower_foe_1", "tower_foe_2", "tower_foe_3"], "core_me": ["core_me"], "core_foe": ["core_foe"], "spawn_me": ["spawn_me"], "spawn_foe": ["spawn_foe"]}
OUT = os.path.join(ROOT, "public/assets/kit"); os.makedirs(OUT, exist_ok=True)
args = sys.argv[1:]; src_dir = "lab/kit"
if args[:1] == ["--src"]: src_dir = args[1]; args = args[2:]
only = set(args)
def info(p):
    b = open(p, "rb").read(); n = struct.unpack("<I", b[12:16])[0]; j = json.loads(b[20:20 + n]); tris = 0
    for m in j.get("meshes", []):
        for pr in m["primitives"]:
            acc = j["accessors"][pr["indices"]] if "indices" in pr else j["accessors"][pr["attributes"]["POSITION"]]; tris += acc["count"] // 3
    return tris, sorted({m.get("name", "?") for m in j.get("materials", [])}), [n_.get("name") for n_ in j.get("nodes", []) if (n_.get("name") or "").lower().startswith(("crystal", "ring"))], len(j.get("images", []))
for folder, names in SRC.items():
    for n in names:
        src = os.path.join(ROOT, src_dir, folder, "out", n + ".glb")
        if not os.path.exists(src) or (only and n not in only): continue
        # 阶段 8：收进来的时候顺手压缩（网格用 meshopt，位置和法线量化）。十件一共 30.6 MB 压到 6.6 MB（CDN 再压一遍以后约 3 MB），画面上看不出差别
        if subprocess.run(["npx", "gltf-transform", "meshopt", src, os.path.join(OUT, n + ".glb"), "--level", "high"], cwd=ROOT, capture_output=True).returncode: shutil.copyfile(src, os.path.join(OUT, n + ".glb")); print(n, "压缩失败，先放了没压的")
        tris, mats, spin, imgs = info(src)
        print(f"{n}: {os.path.getsize(src) // 1024} KB，{tris} 个三角形，材质 {mats}，转动的节点 {spin}，贴图 {imgs} 张")
models = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith(".glb"))
json.dump({"models": models}, open(os.path.join(OUT, "index.json"), "w")); print("清单：", models)
