#!/bin/zsh
# 卡兹 B 的出品。用法（worktree 根目录）: zsh art/style_b/kaz/rebuild.sh [名字=kaz_b]   名字写 kaz 就是覆盖正式的（再出手机档 m/kaz.glb）
# 身高：heroes/kaz.ts 的 look.height 3.1（case.json 的 game_h 2.8）。runSpeed 定 10.5：run_case 按量出来的比例算是 9.38，
# 但它的跑步贴地速度在源里就很乱（左前脚 15 帧里 12 帧算着地）；按腿长（新的胯高是旧的 1.075 倍）算是 9.8×1.075≈10.5，游戏里量后脚滑得和旧的差不多（右后 −1.05、左后 −2.5 米/秒；旧的四只都是 −1 上下）
cd "$(dirname "$0")/../../.." && zsh art/style_b/quad/rebuild.sh kaz ${1:-kaz_b} 3.1 2.8 10.5
