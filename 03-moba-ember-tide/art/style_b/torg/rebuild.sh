#!/bin/zsh
# 托尔格 B（钟龟）的出品。用法（worktree 根目录）: zsh art/style_b/torg/rebuild.sh [名字=torg_b]   名字写 torg 就是覆盖正式的
cd "$(dirname "$0")/../../.." && zsh art/style_b/quad/rebuild.sh torg ${1:-torg_b} 2.8 2.8
