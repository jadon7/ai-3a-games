#!/bin/zsh
# 狼的训练图渲染（远程 4090）：1600 组随机姿势（8 个进程；那台机器上同时有 20 个以上 Blender 时显存会撑满，谁都渲不动，要先看一眼 remote.sh check），
# 再补 400 组趴下、跪、坐（自己的脚本，在远程的 video2rig/wolf_extra/）。一步失败就停。日志: art/unit/wolf/remote_render.log
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== render 1600 $(date +%H:%M:%S)"; zsh tools/remote.sh render wolf wolf 1600 8300 0 8
echo "== 补渲 400 组趴下、跪、坐 $(date +%H:%M:%S)"
zsh tools/remote.sh run 'for k in 0 1 2 3; do "$BL" -b --factory-startup assets/model/wolf.blend -P wolf_extra/render_wolf_crouch.py -- wolf data/wolf/train 100 $((8500 + k)) $((1600 + k * 100)) > data/wolf/render_wolf_crouch_$k.log 2>&1 & done; wait; grep -h -E "^(DONE|STOP|Traceback)" data/wolf/render_wolf_crouch_*.log; ls data/wolf/train/front | wc -l; ls data/wolf/train | grep -c npz'
echo "== done $(date +%H:%M:%S)"
