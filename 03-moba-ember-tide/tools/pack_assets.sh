#!/bin/zsh
# 阶段 8：把游戏要下载的资源压小，并给手机做一档轻的。改了英雄或野怪的模型以后再跑一遍（在哪个目录跑都行）。
#   zsh tools/pack_assets.sh            全做
#   zsh tools/pack_assets.sh lite       只重做手机那一档的模型
# 做了什么：
#   1. 手机档的英雄和野怪：public/assets/hero/m/<名>.glb、public/assets/unit/m/<名>.glb。颜色贴图缩到 1024，法线和粗糙度贴图缩到 512
#      （2048 的贴图一张在显卡里占 22 MB，六个英雄加六种野怪全用 2048 要 800 MB，手机的浏览器撑不住）
#   2. 小野怪（狼、山魈、蟾、野猪）在电脑上也用不到 2048：原地缩到 1024。两只 Boss 和英雄在电脑上保持 2048
#   3. “哪里是草”的蒙版 ground_mask：4096 的 PNG（3.1 MB）换成 2048 的 WebP（原图留在 art/map/ground_mask.png）
#   4. 墙和石头的七张贴图 slice/tex：JPG 换成 WebP
# 建筑模型（public/assets/kit）的压缩在 tools/kit_collect.py 里，收模型的时候顺手做。
set -e
R=${0:A:h:h}; cd $R; P=public/assets; what=${1:-all}
T=$(mktemp -d); trap "rm -rf '$T'" EXIT      # 临时目录由 mktemp 给出，脚本结束自己清掉
size() { stat -f %z "$1" | awk '{printf "%.2f MB", $1/1e6}'; }
lite() {      # lite <原模型> <输出> <颜色贴图边长> <别的贴图边长>
  node tools/lite_glb.mjs "$1" "$T/a.glb" $3 $4 >/dev/null && mv "$T/a.glb" "$2"
  echo "  ${1:t}: $(size $1) → ${2#$P/} $(size $2)"
}
mkdir -p $P/hero/m $P/unit/m art/unit/full
if [ $what = all ]; then
  echo "小野怪缩到 1024（原件留在 art/unit/full/）"
  for n in wolf mandrill toad boar; do
    [ -f art/unit/full/$n.glb ] || cp $P/unit/$n.glb art/unit/full/$n.glb
    lite art/unit/full/$n.glb $P/unit/$n.glb 1024 1024
  done
fi
echo "手机档"
for f in $P/hero/*.glb; do lite $f $P/hero/m/${f:t} 1024 512; done
for n in wolf mandrill toad boar; do lite art/unit/full/$n.glb $P/unit/m/$n.glb 1024 512; done
for n in beast troll melee ranged; do lite $P/unit/$n.glb $P/unit/m/$n.glb 1024 512; done
if [ $what = all ]; then
  if [ -f $P/map/ground_mask.png ]; then mkdir -p art/map; mv $P/map/ground_mask.png art/map/ground_mask.png; fi
  magick art/map/ground_mask.png -resize 2048x2048 -quality 88 $P/map/ground_mask.webp; echo "草的蒙版: $(size art/map/ground_mask.png) → $(size $P/map/ground_mask.webp)"
  for f in $P/slice/tex/*.jpg(N); do cwebp -quiet -q 84 $f -o ${f:r}.webp; echo "  ${f:t}: $(size $f) → $(size ${f:r}.webp)"; mkdir -p art/tex_src/slice; mv $f art/tex_src/slice/${f:t}; done
fi
du -sh $P/hero $P/hero/m $P/unit $P/unit/m $P/kit $P/map $P/slice/tex
