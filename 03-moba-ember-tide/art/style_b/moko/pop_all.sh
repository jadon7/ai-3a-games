#!/bin/zsh
# 显不显眼（HERO_B.md 第 10 步）：草地、石板、对方红土三处，新旧模型各拍一对（有英雄 / 没英雄），pop.py 量亮度。w-mu 写的，摩珂、乌戈共用。
# 用法（worktree 根目录，测试服务器开着）: zsh art/style_b/moko/pop_all.sh <输出目录> <英雄 id> <look 参数，如 height:3.3,lift:1.15> <glb 名字…>
# 带上 h=<英雄 id>：play=0 时第一个英雄吃的是这个英雄 kit 里的 look（不写 h 就是岚的）
# 三处的位置（路向坐标）是这次挑的空地：草地 -33,-18（我方野区的空草地）、石板 -14,-4（我方外塔旁的石板路）、红土 33,18（对方野区的空红土，和草地那处对称）
set -e
cd "$(dirname "$0")/../../.."
O=$1; ID=$2; H=$3; shift 3; mkdir -p $O
: ${MOBA_URL:=http://localhost:5233/map.html}; export MOBA_URL
for g in "$@"; do
  for p in "grass:-33,-18" "stone:-14,-4" "red:33,18"; do
    n=${p%%:*}; uv=${p#*:}
    node tools/style_b/pop.mjs $O/${n}_$g "play=0&h=$ID&glb=$g&hero=$uv,10&look=$H&cam=$uv,27&nohud=1&nofog=1&t=3" > /dev/null
    /opt/homebrew/opt/python@3.14/bin/python3.14 tools/style_b/pop.py $O/${n}_${g}_hero.jpg $O/${n}_${g}_none.jpg $n/$g | tee -a $O/pop.txt
  done
done
