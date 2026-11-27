#!/usr/bin/env python3
"""只读：打印一个 GLB 里网格的各个部分（材质、三角形数、有几套贴图坐标）、贴图、动作。用法: python3 glb_info.py x.glb"""
import json, struct, sys
for p in sys.argv[1:]:
    f = open(p, "rb"); magic, ver, total = struct.unpack("<4sII", f.read(12)); n, kind = struct.unpack("<I4s", f.read(8)); g = json.loads(f.read(n))
    print(p, round(total / 1e6, 2), "MB", "扩展", g.get("extensionsUsed"))
    mats = [m.get("name") for m in g.get("materials", [])]
    for m in g.get("meshes", []):
        for pr in m["primitives"]:
            acc = g["accessors"]; cnt = acc[pr["indices"]]["count"] // 3 if "indices" in pr else acc[pr["attributes"]["POSITION"]]["count"] // 3
            print("  部分: 材质", mats[pr["material"]] if "material" in pr else None, " 三角形", cnt, " 顶点", acc[pr["attributes"]["POSITION"]]["count"], " 属性", sorted(pr["attributes"].keys()))
    for m in g.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {}); print("  材质", m.get("name"), "底色贴图" if "baseColorTexture" in pbr else "无底色贴图", "自发光", m.get("emissiveFactor"), "自发光贴图" if "emissiveTexture" in m else "", m.get("extensions", {}))
    print("  贴图", [(i.get("name"), i.get("mimeType")) for i in g.get("images", [])])
    print("  动作", [(a.get("name")) for a in g.get("animations", [])], " 骨骼数", len(g.get("skins", [{}])[0].get("joints", [])))
