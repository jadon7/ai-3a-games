#!/bin/zsh
# 摩珂自己用：重跑构建（加 rig 就连武器一起重装），再渲染检查图并量数。用法: zsh art/hero/moko/run_check.sh [rig] 
cd /Users/jadon7/Documents/SynologyDrive/code/moba
BL=/Applications/Blender.app/Contents/MacOS/Blender
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
zsh tools/hero_build.sh art/hero/moko $1 2>&1 | tail -8
$BL -b --factory-startup -P art/hero/moko/check.py -- art/hero/moko/game.glb art/hero/moko/chk/c 600 2>&1 | grep -E "^(BODY|PART|JOINT|STAFF|INSIDE|  INSIDE|NEAR|SLOT|Traceback|.*Error|AssertionError)"
$PY art/hero/moko/sheet.py art/hero/moko/chk/c 6 art/hero/moko/chk/c_sheet.jpg 3
