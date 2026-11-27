#!/bin/bash
# 双击运行：启动本地服务器并用默认浏览器打开游戏（推荐 Chrome）。关闭这个终端窗口即停止。
cd "$(dirname "$0")"
PORT=8765
while lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
python3 serve.py $PORT &
PID=$!
sleep 1
open "http://localhost:$PORT/"
echo ""
echo "  商场突袭 已启动：http://localhost:$PORT/"
echo "  关闭这个窗口即停止游戏服务器。"
echo ""
wait $PID
