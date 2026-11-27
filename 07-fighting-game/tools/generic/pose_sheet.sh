#!/bin/bash
# 静态姿势一览：pose_sheet.sh <角色成品.glb> <姿势.glb> <姿势名逗号分隔> <输出.png> [ortho]
# 列是姿势，行是正面 / 侧面 / 斜 45 度
set -e
FG=/Users/jadon7/Documents/SynologyDrive/code/fighting-game; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
TMP=$FG/art/generic/work/pose_tmp_$$; mkdir -p "$TMP"
$PY -c "
import json,sys
rig,gen,names,tmp,ortho=sys.argv[1:6]
rows=[{'label':n,'mesh':rig,'anim':gen,'clip':n,'times':[0.0],'views':['front','side','q']} for n in names.split(',')]
json.dump({'out_dir':tmp,'size':300,'ortho':float(ortho),'cz':0.4,'elev':12,'rows':rows},open(tmp+'/job.json','w'))" "$1" "$2" "$3" "$TMP" "${5:-1.6}"
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P $FG/tools/generic/bl_sheet.py -- "$TMP/job.json" 2>&1 | grep -E "Error|Traceback" | head -5 || true
$PY -c "
import json,sys,os
from PIL import Image,ImageDraw,ImageFont
tmp,out=sys.argv[1:3]; j=json.load(open(tmp+'/job.json')); S=300; n=len(j['rows'])
img=Image.new('RGB',(n*S,3*S+26),(30,30,34)); d=ImageDraw.Draw(img); f=ImageFont.load_default(size=18)
for c,r in enumerate(j['rows']):
    d.text((c*S+6,3),r['label'],fill=(255,220,120),font=f)
    for k,v in enumerate(['front','side','q']):
        p=f'{tmp}/r{c:02d}_{v}_00.png'
        if os.path.exists(p): img.paste(Image.open(p).convert('RGB'),(c*S,26+k*S))
img.save(out); print('POSES',out,img.size)
import shutil; shutil.rmtree(tmp)" "$TMP" "$4"
