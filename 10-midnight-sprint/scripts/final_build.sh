#!/bin/zsh
# 最后一步：从 4090 增量拉回渲染帧（本机从后往前渲的帧也并进来）→ 调色 + 涂鸦层 + HUD → 配音编码。
# 可以重复运行（已拉回 / 已合成的帧会跳过；加 --force 重新合成全部帧）。
ROOT="${0:A:h:h}"
EXR="$ROOT/renders/final_exr_v5"
LOC="$ROOT/renders/local_exr_v5"
PNG="$ROOT/renders/final_png_v5"
NFR=1272
mkdir -p "$EXR" "$PNG" "$LOC"
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=15 jadon7-wsl)
all_remote=$($SSH 'cd /d/streetrace-remote/frames_v5 && ls | grep "^f.*exr$"')
# 本机渲好的帧：传一份到 4090 的输出目录（它遇到已有的帧会跳过），再并入本地 EXR 目录
up=()
for p in "$LOC"/f*.exr(N); do
  f=${p:t}
  [[ -s "$EXR/$f" ]] || cp -n "$p" "$EXR/$f"
  [[ ${all_remote} == *"$f"* ]] || up+=("$f")
done
if (( ${#up} > 0 )); then
  tar cf - -C "$LOC" $up | $SSH 'tar xf - -C /d/streetrace-remote/frames_v5' && echo "uploaded local frames: ${#up}"
fi
remote=$($SSH 'cd /d/streetrace-remote/frames_v5 && find . -name "f*.exr" -mmin +1 -size +100k | sed "s|^\./||" | sort')
need=()
for f in ${(f)remote}; do
  [[ -s "$EXR/$f" ]] || need+=("$f")
done
echo "4090 ready: ${#${(f)remote}}   to pull: ${#need}"
if (( ${#need} > 0 )); then
  print -l $need | $SSH 'cd /d/streetrace-remote/frames_v5 && tar cf - -T -' | tar xf - -C "$EXR"
fi
echo "local exr total: $(ls "$EXR" | grep -c exr)"
cd "$ROOT/scripts"
uv run -q --with opencv-python-headless --with openexr --with numpy --with pillow --with skia-python python finish.py "$EXR" "$PNG" "$@" | tail -1
n=$(ls "$PNG" | grep -c png)
echo "final png: $n / $NFR"
if (( n == NFR )); then
  OUT="$ROOT/out/midnight_sprint_1080p.mp4"
  ffmpeg -v error -y -framerate 30 -start_number 1 -i "$PNG/%04d.png" -i "$ROOT/out/audio.wav" \
    -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
    -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT" && ls -la "$OUT"
fi
