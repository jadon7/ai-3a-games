#!/bin/zsh
# 显不显眼（w-quad）：一个英雄的旧模型、卡通版在三处地面（我方草地、我方石板、对方红土）各拍“只有英雄 / 没有英雄”一对，用 tools/style_b/pop.py 量。
# 用法（worktree 根目录，测试服务器开着）: zsh art/style_b/quad/pop_all.sh <输出目录> <英雄 id> <旧 glb>:<旧身高[,别的 look]> <新 glb>:<新身高>
# 例: zsh art/style_b/quad/pop_all.sh docs/.../torg/pop torg "torg_v9:2.8,lift:1.4,sat:1.3" torg:2.8
# 英雄 id 一定要给（网址里的 h=）：play=0 时不给 h，模型虽然按 glb= 换了，用的却是默认英雄（岚）的 look，heroes/<id>.ts 里写的 lift、sat 不生效
set -e
cd "$(dirname "$0")/../../.."
OUT=$1; ID=$2; mkdir -p $OUT; shift 2
P314=/opt/homebrew/opt/python@3.14/bin/python3.14
: > $OUT/pop.txt
for spot in grass:-46,-17 stone:-53,-1 red:47,9; do
  n=${spot%%:*}; c=${spot#*:}
  for v in "$@"; do
    g=${v%%:*}; h=${v#*:}
    MOBA_URL=${MOBA_URL:-http://localhost:5234/map.html} node tools/style_b/pop.mjs $OUT/${n}_$g "play=0&h=$ID&glb=$g&hero=$c,10&look=height:$h&cam=$c,27&nohud=1&nofog=1&t=3" >/dev/null
    echo "$n/$g\t$($P314 art/style_b/quad/pop.py $OUT/${n}_${g}_hero.jpg $OUT/${n}_${g}_none.jpg | tail -1)" >> $OUT/pop.txt
  done
done
cat $OUT/pop.txt
