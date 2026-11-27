#!/bin/zsh
# 把解出来的动作按管线的两个机位渲染出来，和视频并排比（cmp_sheet.py 拼图）。用法: zsh render_cmp.sh <tag> [文件名=motion_fix.npz]
# 产出: art/unit/wolf/cmp/<tag>/{front,side}/NNNN.jpg（和视频一样每半边 427×480）
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; W=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/wolf
for tag in "$@"; do
  f=motion_fix.npz; [[ "$tag" == *=* ]] && { f=${tag##*=}; tag=${tag%%=*}; }
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup $V/assets/model/wolf.blend -P $V/scripts/blender/render_motion.py -- wolf $V/out/anim/wolf_$tag/$f --frames $W/cmp/$tag --size 427 480 --shutter 0 --samples 8 2>&1 | grep -E "^(KEYED|RENDERED|Traceback)|Error"
done
