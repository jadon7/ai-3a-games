#!/bin/zsh
# 双击启动《筋斗云驾驶模拟器》：在本机开一个小型文件服务并用默认浏览器打开（推荐 Chrome）。
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  exec node tools/serve.mjs --open
else
  echo "没找到 Node.js，改用 Python 启动。"
  (sleep 1; open "http://localhost:8765/") &
  exec python3 -m http.server 8765 --bind 127.0.0.1
fi
