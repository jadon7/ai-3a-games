#!/bin/bash
# usage: game_shot.sh NAME "query-string"   (game server on 8766, capture server on 8799)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROF=$(mktemp -d /private/tmp/claude-501/chprof.XXXX)
rm -f "$ROOT/process/game/$1.jpg"
"$CH" --headless=new --use-angle=metal --enable-gpu --ignore-gpu-blocklist --window-size=1920,1080 --force-device-scale-factor=1 \
  --user-data-dir="$PROF" "http://localhost:8766/?shot=$1&$2" > "$ROOT/logs/chrome_shot.log" 2>&1 &
PID=$!
for i in $(seq 1 40); do sleep 1.5; [ -f "$ROOT/process/game/$1.jpg" ] && break; done
sleep 0.5; kill $PID 2>/dev/null; wait $PID 2>/dev/null
ls -la "$ROOT/process/game/$1.jpg"
