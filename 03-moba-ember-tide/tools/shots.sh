#!/bin/bash
# 一组固定机位的截图，用来前后对比。用法: tools/shots.sh <输出目录> [额外网址参数]
# 机位用路向坐标：u 沿中路（负=烬誓庭，正=沉月会），v 沿河道（负=左上，正=右下）。
set -e
cd "$(dirname "$0")/.."
OUT="$1"; EXTRA="${2:-}"; mkdir -p "$OUT"
shot() { node tools/shot.mjs "$OUT/$1.jpg" "cam=$2&nohud=1&t=3$EXTRA" 1600 900 1200 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); i=d['info']; print('$1', round(i.get('fps',0)), 'fps', round(i.get('tris',0)/1e6,1), 'M', d['errors'][:2])"; }
shot mid_c "-40,0,30"          # 烬誓庭中路外塔
shot mid_m "40,0,30"           # 沉月会中路外塔
shot river "0,2,32"            # 中路过河
shot ramp_c "-132,0,32"        # 烬誓庭中路高地坡道
shot base_c "-172,0,36"        # 烬誓庭水晶
shot base_m "172,0,36"         # 沉月会水晶
shot top_c "-46,-126,30"       # 烬誓庭上路外塔
shot bot_m "46,126,30"         # 沉月会下路外塔
shot jungle_c "-48,-52,30"     # 烬誓庭上野区营地
shot jungle_m "50,50,30"       # 沉月会下野区营地
shot island1 "0,-80,36"        # 上游河心岛
shot island2 "0,80,36"         # 下游河心岛
