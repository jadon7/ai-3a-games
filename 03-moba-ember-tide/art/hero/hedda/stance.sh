#!/bin/zsh
# 只重做站姿（hero_build 的 game 一步）并渲染五个角度的检查图，拼成 art/hero/hedda/work/stance.jpg。用法: zsh art/hero/hedda/stance.sh
cd "$(dirname "$0")/../../.."
BL=/Applications/Blender.app/Contents/MacOS/Blender
$BL -b --factory-startup -P tools/blender/hero_build.py -- art/hero/hedda/build.json game 2>&1 | grep -E "^(POSED|SAVED|Traceback|.*Error)"
$BL -b --factory-startup -P tools/blender/views.py -- art/hero/hedda/game.glb art/hero/hedda/check.png 560 "0:8,35:18,90:8,180:8,0:56" 2>&1 | grep -E "Error"
python3 -c "
from PIL import Image
ims=[Image.open(f'art/hero/hedda/check_{i}.png').convert('RGB') for i in range(5)]
w,h=ims[0].size; out=Image.new('RGB',(w*5,h))
for i,im in enumerate(ims): out.paste(im,(i*w,0))
out.save('art/hero/hedda/work/stance.jpg',quality=88)"
