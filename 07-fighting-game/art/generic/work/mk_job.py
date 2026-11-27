import json, sys, numpy as np
# 用法: mk_job.py out.json out_dir ortho  label|mesh|anim|clip|dur  ...
out, od, ortho = sys.argv[1], sys.argv[2], float(sys.argv[3]); rows = []
for spec in sys.argv[4:]:
    label, mesh, anim, clip, dur = spec.split("|")
    rows.append({"label": label, "mesh": mesh, "anim": anim or None, "clip": clip, "times": [round(x, 3) for x in np.linspace(0, float(dur), 10)], "views": ["front", "side"]})
json.dump({"out_dir": od, "size": 180, "ortho": ortho, "rows": rows}, open(out, "w"))
