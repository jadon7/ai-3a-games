#!/bin/zsh
# 近看 game.glb 的某一块：zsh close.sh <输出名> "x,y,z,画面宽" ["方位:仰角,…"] [边长]
cd /Users/jadon7/Documents/SynologyDrive/code/moba
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/hero/seren/look.py -- ${GLB:-art/hero/seren/game.glb} art/hero/seren/chk/$1.png ${4:-480} "${3:-0:5,45:15,90:5,180:5}" "$2" 2>&1 | grep -E "Traceback|Error"
python3 -c "
from PIL import Image
import glob,re
fs=sorted(glob.glob('art/hero/seren/chk/$1_[0-9]*.png'),key=lambda f:int(re.findall(r'_(\d+)\.png',f)[0]))
ims=[Image.open(f).convert('RGB') for f in fs]; w=ims[0].size[0]
s=Image.new('RGB',(w*len(ims),w)); [s.paste(im,(i*w,0)) for i,im in enumerate(ims)]; s.save('art/hero/seren/chk/$1.jpg',quality=88)"
