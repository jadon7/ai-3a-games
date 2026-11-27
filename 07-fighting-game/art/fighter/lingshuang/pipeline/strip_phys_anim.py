"""去掉 GLB 动画里打在 phys_* 骨骼上的通道（这些骨骼在各段动作里本来就是静止姿势；不留通道，游戏的弹簧模拟才不会被动画每帧覆盖）。
用法: python strip_phys_anim.py <输入.glb> <输出.glb>"""
import json, struct, sys
f = open(sys.argv[1], "rb").read(); jl = struct.unpack("<I", f[12:16])[0]; J = json.loads(f[20:20 + jl]); rest = f[20 + jl:]
ph = {i for i, n in enumerate(J["nodes"]) if (n.get("name") or "").startswith("phys_")}; cut = 0
for a in J["animations"]:
    keep = [c for c in a["channels"] if c["target"].get("node") not in ph]; cut += len(a["channels"]) - len(keep)
    used = sorted({c["sampler"] for c in keep}); remap = {o: i for i, o in enumerate(used)}
    a["samplers"] = [a["samplers"][o] for o in used]
    for c in keep: c["sampler"] = remap[c["sampler"]]
    a["channels"] = keep
js = json.dumps(J, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), 0x4E4F534A) + js + rest
open(sys.argv[2], "wb").write(out); print("去掉通道", cut)
