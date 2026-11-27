#!/bin/zsh
# 双击启动：在本机开一个静态服务器并用默认浏览器打开游戏
cd "$(dirname "$0")"
exec python3 serve.py 8320 --open
