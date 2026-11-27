#!/bin/zsh
# 调站姿用：只跑 game 一步（不带 rig、不带动作），出五张检查图拼成一张 art/hero/seren/chk/stance.jpg
cd /Users/jadon7/Documents/SynologyDrive/code/moba
BL=/Applications/Blender.app/Contents/MacOS/Blender
$BL -b --factory-startup -P tools/blender/hero_build.py -- art/hero/seren/build.json game 2>&1 | grep -E "^(POSED|SAVED|Traceback|.*Error)"
$BL -b --factory-startup -P tools/blender/views.py -- art/hero/seren/game.glb art/hero/seren/chk/stance.png ${1:-520} "${2:-0:8,35:18,90:8,180:8,0:56}" 2>&1 | grep -E "Traceback|Error"
python3 -c "
from PIL import Image
import glob
fs=sorted(glob.glob('art/hero/seren/chk/stance_*.png'))
ims=[Image.open(f).convert('RGB') for f in fs]; w=ims[0].size[0]
s=Image.new('RGB',(w*len(ims),w)); [s.paste(im,(i*w,0)) for i,im in enumerate(ims)]; s.save('art/hero/seren/chk/stance.jpg',quality=88)"
