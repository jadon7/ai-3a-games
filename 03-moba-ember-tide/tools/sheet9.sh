#!/bin/bash
# 九个固定机位各截一张，拼成一张总览图。用法: tools/sheet9.sh <输出目录> [额外网址参数]
cd "$(dirname "$0")/.."
OUT="$1"; EXTRA="$2"; mkdir -p "$OUT"
for s in "mid_c|cam=-40,0,30" "river|cam=0,2,32" "ramp_c|cam=-132,0,32" "base_c|cam=-172,0,36" "base_m|cam=172,0,36" "top_c|cam=-46,-126,30" "bot_m|cam=46,126,30" "island1|cam=0,-80,36" "fountain_c|cam=-197,0,30"; do
  n="${s%%|*}"; q="${s##*|}"
  node tools/shot.mjs "$OUT/$n.jpg" "$q&nohud=1&t=3$EXTRA" 1600 900 2500 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); i=d['info']; print('$n', round(i['fps']),'fps', round(i['tris']/1e6,2),'M', [e[:120] for e in d['errors'][:1]])"
done
python3 - "$OUT" <<'PY'
import sys
from PIL import Image, ImageDraw
out=sys.argv[1]
names=["mid_c","river","ramp_c","base_c","base_m","top_c","bot_m","island1","fountain_c"]
W,H=800,450
o=Image.new("RGB",(W*3,H*3))
for k,n in enumerate(names):
    im=Image.open(f"{out}/{n}.jpg").resize((W,H),Image.LANCZOS); ImageDraw.Draw(im).text((8,6),n,fill=(255,255,0)); o.paste(im,(k%3*W,k//3*H))
o.save(f"{out}/sheet.jpg",quality=86)
PY
