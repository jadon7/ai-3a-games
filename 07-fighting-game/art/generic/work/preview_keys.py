import sys, json; sys.path.insert(0, "/Users/jadon7/Documents/SynologyDrive/code/fighting-game/tools/generic")
from build_generic import *; from poses import *
cfg = json.load(open(P_(sys.argv[1]))); b = Builder(cfg); rig = b.rig
L = b.lie_pose(b.recipes["knockdown"])
poses = {"lie": L}
for k, sp in GETUP_KEYS.items(): poses[k] = pose_from_spec(rig, sp)
poses["air"] = pose_from_spec(rig, AIR_BASE); poses["stance"] = b.stance
data = {k: {"rot": {i: np.repeat(p.q, 2, 0)[:, i] for i in rig.bones}, "trans": {rig.hips: np.repeat(p.hips, 2, 0)}} for k, p in poses.items()}
write_skeleton_glb(rig.G, P_("art/generic/work/keys.glb"), data)
json.dump({"clips": {k: {"dur": 0.0} for k in poses}}, open(P_("art/generic/work/keys.json"), "w"))
