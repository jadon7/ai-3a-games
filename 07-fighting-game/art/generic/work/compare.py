import sys, json; sys.path.insert(0, "/Users/jadon7/Documents/SynologyDrive/code/fighting-game/tools/generic")
from build_generic import *
b = Builder(json.load(open(P_(sys.argv[1])))); rig = b.rig; data = {}; meta = {}
for k in ("hit_high", "hit_mid"):
    r = b.recipes[k]
    P, inf = b.make_hit(dict(r, mode="world")); data[k + "_add_world"] = P
    P, inf2 = b.make_hit(dict(r, mode="local")); data[k + "_add_local"] = P
    M = b.take(r["src"], r["clip"], r["t0"], r["t1"], r["speed"]); A = fade_ends(M, b.stance, 3, r["fade_out"]); A, _, _ = ground(rig, A)
    data[k + "_absolute"] = A
out = {}
for k, P in data.items():
    out[k] = {"rot": {i: P.q[:, i] for i in rig.bones}, "trans": {rig.hips: P.hips}}; meta[k] = {"dur": (len(P) - 1) / 30}
write_skeleton_glb(rig.G, P_("art/generic/work/compare.glb"), out); json.dump({"clips": meta}, open(P_("art/generic/work/compare.json"), "w"))
