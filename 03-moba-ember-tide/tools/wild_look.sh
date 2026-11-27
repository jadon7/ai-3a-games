#!/bin/zsh
# 在测试场里放一种野怪（或 Boss），让英雄去打，截五张：站着、普攻、重击预警、重击落下、死亡，拼成一张。
# 用法: zsh tools/wild_look.sh <野怪名> <输出目录> [英雄=gorran] [镜头距离=30]
cd "$(dirname "$0")/.."
mob=$1; out=$2; hero=${3:-gorran}; dist=${4:-30}; mkdir -p $out
steps=$(node -e 'const fs=require("fs");const st=JSON.parse(fs.readFileSync("tools/match_steps/wild_look.json","utf8"));const mob=process.argv[1];st.unshift({js:"window.__mob=\""+mob+"\";window.__heavy="+(["toad","boar","beast","troll"].includes(mob))});console.log(JSON.stringify(st))' $mob)
for i in 1 2 3; do MOBA_URL=${MOBA_URL:-http://localhost:5190/map.html} node tools/play_test.mjs $out "$steps" "arena=1&h=$hero&nofog=1&dist=$dist" 1280 720 > $out/log.txt 2>&1; grep -q "Shader Error" $out/log.txt || break; echo "显卡被抢，重试 $i"; done
grep -v Shader $out/log.txt | tail -3 | cut -c 1-300
python3 - $out <<'PY'
import sys
from PIL import Image
d = sys.argv[1]; ns = ['a_idle', 'b_attack', 'c_warn', 'd_slam', 'e_dead']
ims = [Image.open(f'{d}/{n}.jpg').convert('RGB').resize((853, 480)) for n in ns]
sh = Image.new('RGB', (853 * 3, 480 * 2))
for i, im in enumerate(ims): sh.paste(im, ((i % 3) * 853, (i // 3) * 480))
sh.save(f'{d}/sheet.jpg', quality=86)
PY
