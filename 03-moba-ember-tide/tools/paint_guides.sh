#!/bin/bash
# 导出整张地图的地表布局图：6×6 块，每块 64 米见方、2048 像素，相邻两块重叠 10 米。
# 这些图是手绘重绘的底图（见 tools/paint_jobs.py）。需要本地服务在运行。
set -e
cd "$(dirname "$0")/.."
mkdir -p art/paint/guide
for i in 0 1 2 3 4 5; do for j in 0 1 2 3 4 5; do
  x=$((-135 + i * 54)); z=$((-135 + j * 54))
  out="art/paint/guide/g_${i}_${j}.jpg"
  [ -f "$out" ] && continue
  node tools/shot.mjs "$out" "ortho=$x,$z,64&flat=1&post=0&nohud=1&t=3&hide=props,grass,structures,atmosphere,water&dpr=1" 2048 2048 900 > /dev/null
  echo "guide $i $j"
done; done
