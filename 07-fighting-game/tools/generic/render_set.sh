#!/bin/bash
# 渲一个角色的通用动作联系表：render_set.sh <角色成品.glb> <generic.glb> <generic.json> <输出.png> [动作名,逗号分隔] [ortho]
# 每段动作一行正面一行侧面，10 个时刻；小图放在 art/generic/work/sheet_tmp（渲完删掉）
set -e
FG=/Users/jadon7/Documents/SynologyDrive/code/fighting-game; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
RIG=$1; GEN=$2; JS=$3; OUT=$4; ONLY=${5:-}; ORTHO=${6:-2.0}
TMP=$FG/art/generic/work/sheet_tmp_$$; mkdir -p "$TMP"
$PY - "$RIG" "$GEN" "$JS" "$TMP" "$ONLY" "$ORTHO" <<'PYEOF'
import json, sys, numpy as np
rig, gen, js, tmp, only, ortho = sys.argv[1:7]
meta = json.load(open(js)); rows = []
for k, v in meta["clips"].items():
    if only and k not in only.split(","): continue
    rows.append({"label": k, "mesh": rig, "anim": gen, "clip": k, "times": [round(x, 3) for x in np.linspace(0, v["dur"], 10)], "views": ["front", "side"]})
json.dump({"out_dir": tmp, "size": 180, "ortho": float(ortho), "rows": rows}, open(tmp + "/job.json", "w"))
PYEOF
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P $FG/tools/generic/bl_sheet.py -- "$TMP/job.json" 2>&1 | grep -E "Error|Traceback|SHEET_DONE" | head -5
$PY $FG/tools/generic/sheet.py "$TMP/job.json" "$OUT"
$PY -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$TMP"   # 小图看完就删
