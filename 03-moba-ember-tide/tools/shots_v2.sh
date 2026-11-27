#!/bin/bash
# 返工版的交付截图：原尺寸存 docs/phase2/shots_v2，缩小版存 docs/phase2/web/v2（验收页用）。
set -e
cd "$(dirname "$0")/.."
OUT=docs/phase2/shots_v2; mkdir -p "$OUT" docs/phase2/web/v2
shot() { node tools/shot.mjs "$OUT/$1.jpg" "$2&nohud=1&t=3" "${3:-1600}" "${4:-900}" 3000 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); i=d['info']; print('$1', round(i.get('fps',0)), 'fps', round(i.get('tris',0)/1e6,1), 'M', d['errors'][:2])"; }
shot mid_c "cam=-40,0,30"; shot mid_m "cam=40,0,30"; shot river "cam=0,2,32"; shot ramp_c "cam=-132,0,32"
shot base_c "cam=-172,0,36"; shot base_m "cam=172,0,36"; shot fountain_c "cam=-197,0,30"
shot top_c "cam=-46,-126,30"; shot bot_m "cam=46,126,30"
shot jungle_c "cam=-48,-52,30"; shot jungle_m "cam=50,50,30"
shot island1 "cam=0,-80,36"; shot island2 "cam=0,80,36"
shot night_base_c "cam=-172,0,36&night=1"
shot overview "cam=0,0,560,88&hide=atmosphere,mist" 1500 1500
python3 - <<'PY'
import glob, os
from PIL import Image
for f in glob.glob("docs/phase2/shots_v2/*.jpg"):
    im = Image.open(f).convert("RGB"); w, h = im.size
    im.resize((1280, round(h * 1280 / w)), Image.LANCZOS).save("docs/phase2/web/v2/" + os.path.basename(f), quality=84, optimize=True, progressive=True)
PY
