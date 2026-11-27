#!/bin/zsh
# 只重做站姿（hero_build 的 game 一步，不带动作）并渲染五个角度，拼成 work/stance.jpg
D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/yanjin
BL=/Applications/Blender.app/Contents/MacOS/Blender; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
$BL -b --factory-startup -P /Users/jadon7/Documents/SynologyDrive/code/fighting-game/tools/pipeline/yanjin/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|SAVED|Traceback|.*Error)"
$BL -b --factory-startup -P /Users/jadon7/Documents/SynologyDrive/code/moba/tools/blender/views.py -- $D/game.glb $D/work/check.png 560 "0:8,35:18,90:8,180:8,270:8" 2>&1 | grep -E "Error"
$PY -c "
from PIL import Image
ims=[Image.open('$D/work/check_%d.png'%i).convert('RGB') for i in range(5)]
w,h=ims[0].size; out=Image.new('RGB',(w*5,h))
for i,im in enumerate(ims): out.paste(im,(i*w,0))
out.save('$D/work/stance.jpg',quality=88)"
