"""四足（换画风 B · w-quad 写的）：把 Tripo 新绑的骨架按“骨骼角色”改成旧骨架的骨骼名，只改 GLB 里节点的名字，别的字节不动。

为什么：Tripo 的四足绑骨每次骨骼名都不一样（同一个角色重绑一次，左前腿可能从 0_Left_Limb_* 变成 bone_12…）。
旧名字不只是套动作要用，游戏里也认：时间表的 points（技能出手点、胸口、头像对准的头）、英雄代码里写死的骨骼（卡兹的前爪 tripo0_Left_Limb_5）。
所以新骨架先改成旧名字：之后 case.json 写 "map": "same"，时间表、英雄代码都不用动。
没有对应的新骨骼（新骨架多出来的碎骨头）改成 "x::<原名>"，免得和旧名字撞上。

用法: <V2R 的 python> tools/retarget/quad_rename.py <新绑的.glb> <rename.json> <输出.glb> [旧骨架: V2R/assets/model/<旧名>_skeleton.json]
     给了旧骨架：没写进 rename.json 的新骨骼，名字只要和旧骨架里任何一根撞上就改成 x::<原名>（不然 "map": "same" 会把旧骨架里那根不相干的骨骼的动作给它）。
rename.json: {"新骨骼名": "旧骨骼名", …}   （只写有对应的；没写的新骨骼如果名字恰好和某个旧名字一样，会被改成 x::<原名>）
             可以多一项 "_keep": ["新骨骼名", …]：这些名字原样保留（新旧本来就一样、角色也一样的）。
"""
import json, struct, sys

src, mp_path, dst = sys.argv[1:4]; old_all = {b["name"] for b in json.load(open(sys.argv[4], encoding="utf-8"))["bones"]} if len(sys.argv) > 4 else set()
mp = json.load(open(mp_path, encoding="utf-8")); keep = set(mp.pop("_keep", [])); mp = {k: v for k, v in mp.items() if not k.startswith("_")}
b = open(src, "rb").read()
magic, ver, total = struct.unpack("<III", b[:12]); jl, jt = struct.unpack("<II", b[12:20]); assert magic == 0x46546C67 and jt == 0x4E4F534A
js = json.loads(b[20:20 + jl]); rest = b[20 + jl:]
joints = set()
for s in js.get("skins", []): joints |= set(s["joints"])
names = {i: js["nodes"][i].get("name", f"node{i}") for i in joints}
olds = set(mp.values()) | keep | old_all
missing = [k for k in mp if k not in names.values()]
assert not missing, f"rename.json 里这些新骨骼在模型里找不到: {missing}"
dup = [v for v in mp.values() if list(mp.values()).count(v) > 1]
assert not dup, f"两根新骨骼改成了同一个旧名字: {set(dup)}"
n_ren = n_x = 0
for i, n in names.items():
    if n in mp: js["nodes"][i]["name"] = mp[n]; n_ren += 1
    elif n in keep: pass
    elif n in olds: js["nodes"][i]["name"] = "x::" + n; n_x += 1
missing_old = sorted(old_all - {js["nodes"][i]["name"] for i in names})
new = json.dumps(js, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
new += b" " * ((4 - len(new) % 4) % 4)
out = struct.pack("<III", magic, ver, 12 + 8 + len(new) + len(rest)) + struct.pack("<II", len(new), jt) + new + rest
open(dst, "wb").write(out)
print("旧骨架里没有对应新骨骼的:", missing_old) if old_all else None
print(f"RENAMED {n_ren} 根改成旧名字，{n_x} 根撞名的改成 x::，{len(names) - n_ren - n_x} 根原样；写到 {dst}")
