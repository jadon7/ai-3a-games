#!/bin/zsh
# 奥森 B（烛角鹿）的出品。用法（worktree 根目录）: zsh art/style_b/osen/rebuild.sh [名字=osen_b]   名字写 osen 就是覆盖正式的
cd "$(dirname "$0")/../../.." && zsh art/style_b/quad/rebuild.sh osen ${1:-osen_b} 3.4 3.4
