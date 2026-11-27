"""量成品动作里网格到底陷没陷进地里、脚飘没飘（按蒙皮以后的网格顶点算，比看关节准）。
用法: BL -b --factory-startup V2R/assets/model/beast.blend -P scripts/mesh_floor.py -- <motions 目录> <输出.json> [动作,动作…]
每段动作逐帧记：全身最低点、四只脚各自的最低点、头、尾巴、躯干（肚子）的最低点。高度是摆正后的模型单位（乘 游戏身高/0.5561 是米）。
"""
import bpy, json, os, sys
import numpy as np
from mathutils import Quaternion, Vector
argv = sys.argv[sys.argv.index("--") + 1:]; mdir, outp = argv[0], argv[1]; only = argv[2].split(",") if len(argv) > 2 else None
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == "ARMATURE")
body = next(o for o in sc.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
sk = json.load(open("/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/beast_skeleton.json")); role = {b["name"]: (b.get("role"), b.get("side", 0)) for b in sk["bones"]}
root_bone = next(b["name"] for b in sk["bones"] if b.get("role") == "root")
PB = arm.pose.bones
for pb in PB: pb.rotation_mode = "QUATERNION"


def part_of(bone):
    b = arm.data.bones[bone]
    while b:
        r, s = role.get(b.name, (None, 0))
        if r == "paw_f": return "前左脚" if s > 0 else "前右脚"
        if r in ("foot_h", "toe_h"): return "后左脚" if s > 0 else "后右脚"
        if r == "tail": return "尾巴"
        if r in ("head", "neck"): return "头颈"
        if r in ("upper_f", "lower_f", "upper_h", "lower_h", "hock", "scapula"): return "腿"
        b = b.parent
    return "躯干"


me = body.data; nv = len(me.vertices); vg = {g.index: g.name for g in body.vertex_groups}; parts = []
for v in me.vertices:
    g = max(v.groups, key=lambda x: x.weight) if v.groups else None; parts.append(part_of(vg[g.group]) if g and vg[g.group] in arm.data.bones else "躯干")
parts = np.array(parts); names = sorted(set(parts)); masks = {n: parts == n for n in names}
dg = bpy.context.evaluated_depsgraph_get()


def heights():
    dg.update(); ev = body.evaluated_get(dg); m = ev.to_mesh(); co = np.zeros(nv * 3); m.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    M = np.array(ev.matrix_world); z = co @ M[2, :3] + M[2, 3]; ev.to_mesh_clear(); return z


for pb in PB: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update(); z0 = heights(); rest = {n: float(z0[masks[n]].min()) for n in names}
res = {"_rest": rest, "_verts": {n: int(masks[n].sum()) for n in names}}
for f in sorted(os.listdir(mdir)):
    if not f.endswith(".npz"): continue
    name = f[:-4]
    if only and name not in only: continue
    m = np.load(os.path.join(mdir, f), allow_pickle=True); bn = [str(x) for x in m["names"]]; q = m["quats"]; loc = m["loc"]; T = len(q); rows = {n: [] for n in names}; allmin = []; below = []
    for t in range(T):
        for i, nm in enumerate(bn):
            pb = PB.get(nm)
            if pb is not None: pb.rotation_quaternion = Quaternion(q[t, i])
        PB[root_bone].location = Vector(loc[t]); bpy.context.view_layer.update(); z = heights()
        allmin.append(float(z.min())); below.append(int((z < -0.006).sum()))
        for n in names: rows[n].append(float(z[masks[n]].min()))
    res[name] = {"frames": T, "min": allmin, "below": below, **rows}
    feet = np.array([rows[n] for n in names if n.endswith("脚")]); lowfoot = feet.min(0)
    print(f"FLOOR {name}: 全身最低 {min(allmin):+.4f}（第 {int(np.argmin(allmin))} 帧），陷进地里 6 毫米(模型单位 0.006)以上的顶点最多 {max(below)} 个；最低的脚 {lowfoot.min():+.4f} ~ {lowfoot.max():+.4f}；" + " ".join(f"{n} {min(rows[n]):+.3f}" for n in names))
json.dump(res, open(outp, "w"), ensure_ascii=False)
print("FLOOR rest", {k: round(v, 4) for k, v in rest.items()}, res["_verts"])
