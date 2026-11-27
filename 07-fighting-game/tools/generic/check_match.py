#!/usr/bin/env python3
"""检查交付的 generic GLB 和角色成品 GLB 的骨骼名、层级、静止姿势是否完全一致，并列出动画。
  python tools/generic/check_match.py <角色成品.glb> <generic.glb>"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import GLB
b, a = GLB(sys.argv[1]), GLB(sys.argv[2])
nb = {n: i for i, n in enumerate(b.name)}
pn = lambda G, i: G.name[G.parent[i]] if G.parent[i] >= 0 else None
miss = [n for n in a.name if n not in nb]
rest = [n for i, n in enumerate(a.name) if n in nb and not (np.allclose(a.rest_t[i], b.rest_t[nb[n]], atol=1e-6) and np.allclose(a.rest_q[i], b.rest_q[nb[n]], atol=1e-6) and np.allclose(a.rest_s[i], b.rest_s[nb[n]], atol=1e-6))]
par = [n for i, n in enumerate(a.name) if n in nb and pn(a, i) != pn(b, nb[n])]
bones_b = [n for n in b.name if n.startswith("mixamorig:")]; lacking = [n for n in bones_b if n not in a.name]
fps = {k: round(1 / np.diff(a.accessor(an["samplers"][0]["input"]))[:5].mean(), 2) for k, an in a.anims.items()}
ok = not (miss or rest or par or lacking)
print(json.dumps({"ok": ok, "nodes": len(a.nodes), "missing_in_rig": miss, "rest_mismatch": rest, "parent_mismatch": par, "rig_bones_not_in_generic": lacking,
                  "anims": {k: round(a.anim_duration(k), 3) for k in a.anims}, "fps": sorted(set(fps.values()))}, ensure_ascii=False))
