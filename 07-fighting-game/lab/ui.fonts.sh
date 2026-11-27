#!/bin/bash
# 把界面用到的字从开源字体里裁出来（OFL 字体：马善政毛笔楷书、思源宋体、Oswald），放到 public/assets/ui/fonts/。
# 改了界面文字后重跑：bash lab/ui.fonts.sh
set -e
ROOT="/Users/jadon7/Documents/SynologyDrive/code/fighting-game"
OUT="$ROOT/public/assets/ui/fonts"
BRUSH_SRC="/Users/jadon7/Documents/SynologyDrive/code/PPT Skill 高校版/output/kira-delivery/pkg/高校ppt封面及目录页_交付包/字体/MaShanZheng-Regular.ttf"
SERIF_SRC="$HOME/Library/Fonts/NotoSerifSC-VariableFont_wght.ttf"
NUM_SRC="$HOME/Library/Fonts/Oswald-VariableFont_wght.ttf"
TMP="$(mktemp -d)"
# 界面源码 + 角色数据里出现的所有字，再加常用标点和数字
cat "$ROOT"/src/ui/*.ts "$ROOT/src/app.ts" "$ROOT/src/data/fighters.ts" "$ROOT/docs/FIGHTERS.md" > "$TMP/all.txt"
echo "第一二三四五六七八九十回合决胜开战终结时间到平局完美破招弹反破防胜败印对决武斗烬霜阎凌焚天霜天绝技就绪暂停训练连伤害0123456789·：「」，。！？、" >> "$TMP/all.txt"
pyftsubset "$BRUSH_SRC" --text-file="$TMP/all.txt" --flavor=woff2 --output-file="$OUT/brush.woff2" --layout-features='*'
pyftsubset "$SERIF_SRC" --text-file="$TMP/all.txt" --flavor=woff2 --output-file="$OUT/serif.woff2" --layout-features='*'
pyftsubset "$NUM_SRC" --unicodes="U+0020-007E,U+00B7,U+00D7,U+221E" --flavor=woff2 --output-file="$OUT/num.woff2" --layout-features='*'
rm -r "$TMP"
ls -la "$OUT"
