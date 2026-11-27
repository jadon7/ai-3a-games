#!/bin/zsh
# 只重做站姿（game 一步）并渲五个角度 + 刀和手的近景，拼成 work/stance.jpg
D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/lingshuang
BL=/Applications/Blender.app/Contents/MacOS/Blender
$BL -b --factory-startup -P $D/pipeline/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|SAVED|Traceback|.*Error)"
$BL -b --factory-startup -P /Users/jadon7/Documents/SynologyDrive/code/moba/tools/blender/views.py -- $D/game.glb $D/work/check.png 560 "0:8,40:12,90:6,180:8,270:6" 2>&1 | grep -E "Error"
/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python -c "
from PIL import Image
ims=[Image.open(f'$D/work/check_{i}.png').convert('RGB') for i in range(5)]
w,h=ims[0].size; out=Image.new('RGB',(w*5,h))
for i,im in enumerate(ims): out.paste(im,(i*w,0))
out.save('$D/work/stance.jpg',quality=88)"
