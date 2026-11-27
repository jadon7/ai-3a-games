"""给新的四足模型写 V2R 的映射文件（<name>_rigmap.json），只为了 prep_rig.py 摆正、导出骨架（creature_build.sh 要 <name>.blend）。
这次不训练、不读视频（动作是从旧模型套过来的），所以跟踪点只按骨骼的头和脚的尾巴自动生成，不做鼻尖、耳朵那些网格标记点；
活动范围（role_dofs、chains 的 dofs、sampling）照抄同一只怪的旧映射，只换骨骼名。
用法: python3.14 make_rigmap.py <art/style_b/<怪>/rigspec.json>
rigspec.json: {"name": "boar_b", "old": "boar", "forward": [0,-1,0], "target_length": 1.2, "root_bone_length": 0.12, "reparent": {},
               "bones": {"骨骼名": ["角色", 左右(1 左 / -1 右 / 0 中)], …}, "chains": [{"name": "spine", "bones": [...]}, …],
               "feet": ["左前脚末端骨骼", "右前…", "左后…", "右后…"], "_说明": "…"}
"""
import json, sys, os
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model"
spec = json.load(open(sys.argv[1], encoding="utf-8")); old = json.load(open(f"{V}/{spec['old']}_rigmap.json", encoding="utf-8"))
m = {"_说明": spec.get("_说明", ""), "_取舍": f"换画风 B（w-beast）自动生成（art/style_b/beasts/make_rigmap.py）：活动范围照抄 {spec['old']}_rigmap.json；跟踪点只是骨骼的头和脚的尾巴（不训练，只给 prep_rig 摆正用）",
     "kind": "quadruped", "forward": spec["forward"], "target_length": spec["target_length"], "root_bone_length": spec["root_bone_length"], "reparent": spec.get("reparent", {}),
     "role_dofs": old.get("role_dofs", {}), "role_speed": old.get("role_speed", {}), "bones": spec["bones"]}
oc = {c["name"]: c for c in old.get("chains", [])}
m["chains"] = [{"name": c["name"], "role": oc.get(c["name"], {}).get("role", c.get("role", "spine")), "bones": c["bones"], "dofs": c.get("dofs") or oc.get(c["name"], {}).get("dofs", [["pitch", -10, 10], ["yaw", -10, 10]])} for c in spec.get("chains", [])]
for c in m["chains"]:
    for b in c["bones"]: m["bones"].setdefault(b, [c["role"], 0])
J, torso, ground = [], [], []
side = {1: "L", -1: "R", 0: "M"}
for b, (role, s) in spec["bones"].items():
    nm = b.replace("tripo::", "").replace("_Limb_", "L")
    J.append({"name": nm, "bone": b, "group": side[s]})
    if role in ("root", "spine", "upper_f", "upper_h", "scapula"): torso.append(nm)
for i, f in enumerate(spec["feet"]):
    nm = f"Foot{i}"; J.append({"name": nm, "bone": f, "group": side[spec["bones"].get(f, ["", 0])[1]] if f in spec["bones"] else "M", "at": "tail"}); ground.append(nm)
m.update({"joints": J, "torso_joints": torso, "root_joint": next(j["name"] for j in J if spec["bones"][j["bone"]][0] == "root"), "ground_joints": ground, "joint_weight": {}, "sampling": old.get("sampling", {})})
out = f"{V}/{spec['name']}_rigmap.json"
txt = json.dumps(m, ensure_ascii=False, indent=1); open(out, "w", encoding="utf-8").write(txt); open(os.path.join(os.path.dirname(sys.argv[1]), f"{spec['name']}_rigmap.json"), "w", encoding="utf-8").write(txt)
print("写好了", out, "骨骼", len(m["bones"]), "跟踪点", len(J))
