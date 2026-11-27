#!/bin/zsh
# 在查看页里把六段动作各抽 12 帧（斜前方、正侧面两个机位），每段拼一张图到 sheets/anim_<动作>.jpg。重建以后跑这个逐段看。
# 用 shots.mjs 而不是 tools/anim_sheet.mjs：后者关浏览器时偶尔卡住不退出；六米的大个子用它自带的拼图脚本也缩得太小。
# 用法: zsh art/unit/troll/anim_sheets.sh
set -e
cd "$(dirname "$0")/../../.."
D=art/unit/troll
LIST=$(python3 -c '
d={"idle":4.5,"run":1.6,"attack1":1.8,"attack2":2.97,"roar":3.07,"death":3.2}; out=[]
for a,dur in d.items():
    for v in ("wide","wside"):
        for k in range(12): out.append("%s:%.3f:%s"%(a,min(dur*k/(12 if a in("idle","run") else 11),dur-0.001),v))
print(",".join(out))')
node $D/shots.mjs $D/sheets/frames 4.8 "$LIST" 560
python3 - <<'PY'
import glob
from PIL import Image, ImageDraw
d="art/unit/troll/sheets"
for a in ("idle","run","attack1","attack2","roar","death"):
    rows=[]
    for v in ("wide","wside"):
        fs=sorted(glob.glob(f"{d}/frames/{a}_*_{v}.jpg"), key=lambda f: float(f.split("/")[-1].split("_")[1])); ims=[]
        for f in fs:
            im=Image.open(f).convert("RGB"); w,h=im.size; im=im.crop((int(0.16*w),0,int(0.84*w),int(0.8*h))); ImageDraw.Draw(im).text((6,4),f"{a} {v} t={f.split('/')[-1].split('_')[1]}",fill=(255,80,80)); ims.append(im)
        for i in range(0,len(ims),6):
            r=Image.new("RGB",(ims[0].size[0]*6,ims[0].size[1])); x=0
            for im in ims[i:i+6]: r.paste(im,(x,0)); x+=im.size[0]
            rows.append(r)
    sh=Image.new("RGB",(rows[0].size[0],sum(r.size[1] for r in rows))); y=0
    for r in rows: sh.paste(r,(0,y)); y+=r.size[1]
    sh=sh.resize((2000,int(sh.size[1]*2000/sh.size[0]))); sh.save(f"{d}/anim_{a}.jpg",quality=88); print(f"{d}/anim_{a}.jpg")
PY
