#!/bin/bash
# 一段动作逐帧细看：dense_sheet.sh <角色成品.glb> <generic.glb> <动作名> <起秒> <止秒> <输出.png> [视角 side|front|q] [ortho]
# 20 个时刻排两行
set -e
FG=/Users/jadon7/Documents/SynologyDrive/code/fighting-game; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
TMP=$FG/art/generic/work/dense_tmp_$$; mkdir -p "$TMP"
$PY -c "
import json,sys,numpy as np
rig,gen,clip,a,b,tmp,view,ortho=sys.argv[1:9]; ts=[round(x,3) for x in np.linspace(float(a),float(b),20)]
rows=[{'label':clip,'mesh':rig,'anim':gen,'clip':clip,'times':ts[:10],'views':[view]},{'label':clip,'mesh':rig,'anim':gen,'clip':clip,'times':ts[10:],'views':[view]}]
json.dump({'out_dir':tmp,'size':220,'ortho':float(ortho),'cz':0.45,'rows':rows},open(tmp+'/job.json','w'))" "$1" "$2" "$3" "$4" "$5" "$TMP" "${7:-side}" "${8:-1.5}"
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P $FG/tools/generic/bl_sheet.py -- "$TMP/job.json" 2>&1 | grep -E "Error|Traceback" | head -5 || true
$PY $FG/tools/generic/sheet.py "$TMP/job.json" "$6"
$PY -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "$TMP"
