#!/bin/zsh
# tools/wild_look.sh 的同款（测试场里放一种野怪，让英雄去打，截站着、普攻、重击预警、重击落下、死亡五张），拼图改用 python3.14（本机 python3 没有 Pillow）。
# 用法: MOBA_URL=… zsh art/style_b/beasts/wild_look.sh <野怪名> <输出目录> [英雄=gorran] [镜头距离=22]
cd "$(dirname "$0")/../../.."
mob=$1; out=$2; hero=${3:-gorran}; dist=${4:-22}; mkdir -p $out
steps=$(node -e 'const fs=require("fs");const st=JSON.parse(fs.readFileSync("tools/match_steps/wild_look.json","utf8"));const mob=process.argv[1];st.unshift({js:"window.__mob=\""+mob+"\";window.__heavy="+(["toad","boar","beast","troll"].includes(mob))});console.log(JSON.stringify(st))' $mob)
for i in 1 2 3; do MOBA_URL=${MOBA_URL:-http://localhost:5236/map.html} node tools/play_test.mjs $out "$steps" "arena=1&h=$hero&nofog=1&nohud=1&dist=$dist" 1280 720 > $out/log.txt 2>&1; grep -q "Shader Error" $out/log.txt || break; echo "显卡被抢，重试 $i"; done
grep -v Shader $out/log.txt | tail -2 | cut -c 1-300
/opt/homebrew/opt/python@3.14/bin/python3.14 - $out <<'PY'
import sys, os
from PIL import Image
d = sys.argv[1]; ns = [n for n in ['a_idle', 'b_attack', 'c_warn', 'd_slam', 'e_dead'] if os.path.exists(f'{d}/{n}.jpg')]
ims = [Image.open(f'{d}/{n}.jpg').convert('RGB').resize((853, 480)) for n in ns]
sh = Image.new('RGB', (853 * 3, 480 * 2))
for i, im in enumerate(ims): sh.paste(im, ((i % 3) * 853, (i // 3) * 480))
sh.save(f'{d}/sheet.jpg', quality=86)
PY
