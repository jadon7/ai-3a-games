#!/bin/bash
# 双击启动：开一个本地服务器并在默认浏览器里打开游戏（推荐 Chrome）
cd "$(dirname "$0")"
PORT=5173
(sleep 1; open "http://localhost:$PORT/") &
if command -v node >/dev/null 2>&1; then node tools/serve.mjs $PORT; else python3 -m http.server $PORT; fi
