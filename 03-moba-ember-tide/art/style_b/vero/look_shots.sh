#!/bin/zsh
# 薇萝 / 塞伦 B 的“显不显眼”和近镜头对照（w-vs）：三处地面（我方草地、我方水晶广场石板、对方红土）各拍一对 pop（tools/style_b/pop.mjs + pop.py），
# 草地和红土再各拍一张约 50 度俯视、7.5 米的近镜头。新旧两个模型同机位。
# 用法（worktree 根目录，测试服务器开着）: zsh art/style_b/vero/look_shots.sh <英雄 id> <新 glb 名> <旧 glb 名或 -> <输出目录> [额外网址参数，比如 &look=sat:1.9]
set -e
cd "$(dirname "$0")/../../.."
ID=$1; NEW=$2; OLD=$3; OUT=$4; X=${5:-}; U=${MOBA_URL:-http://localhost:5232/map.html}
P314=/opt/homebrew/opt/python@3.14/bin/python3.14
mkdir -p $OUT
for spot in "grass:-23,-9:0" "stone:-82,5:2.4" "red:23,9:0"; do      # 第三段是镜头看向的点的高度（水晶广场比兵线高约 2.4 米，不抬的话英雄跑到画面上方、pop.py 的取景框只框到一半）
  n=${spot%%:*}; r=${spot#*:}; p=${r%:*}; ch=${r##*:}
  for g in $NEW ${OLD:#-}; do      # 旧 glb 名写 - 就只拍新的（调 look 参数时用：额外参数只该给新模型）
    MOBA_URL=$U node tools/style_b/pop.mjs $OUT/pop_${n}_$g "h=$ID&play=0&glb=$g&hero=$p,10&cam=$p,27,0,$ch&nohud=1&nofog=1&t=3$X" >/dev/null
    echo "$n/$g\t$($P314 tools/style_b/pop.py $OUT/pop_${n}_${g}_hero.jpg $OUT/pop_${n}_${g}_none.jpg)" | tee -a $OUT/pop.txt
    if [ $n != stone ]; then MOBA_URL=$U node tools/shot.mjs $OUT/close_${n}_$g.jpg "h=$ID&play=0&glb=$g&hero=$p,20&cam=$p,7.5,50,1.6&nohud=1&nofog=1&t=3$X" 1200 1200 1500 >/dev/null; fi
  done
done
