#!/bin/bash
# 双击运行：在本机起一个小服务器并用默认浏览器打开游戏。关掉这个终端窗口即停止。
cd "$(dirname "$0")" || exit 1
PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1])")
python3 serve.py "$PORT" &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
open "http://localhost:$PORT/"
echo ""
echo "游戏已在浏览器里打开：http://localhost:$PORT/"
echo "建议用 Chrome 或 Edge，并按 F11 / ⌃⌘F 全屏。玩完后关掉这个窗口即可。"
wait $SERVER
