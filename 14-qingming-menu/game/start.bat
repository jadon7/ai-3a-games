@echo off
rem 启动本地静态服务器并打开浏览器（需已安装 Python 3）
cd /d "%~dp0"
start "" http://localhost:8765/
python -m http.server 8765 --bind 127.0.0.1
