#!/bin/zsh
# 增量把 4090 上渲好的 EXR 拉回本机 renders/final_exr/（只拉本机还没有、且写完超过 1 分钟的帧）
ROOT="${0:A:h:h}"
DST="$ROOT/renders/final_exr"
mkdir -p "$DST"
remote=$(ssh -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=15 jadon7-wsl 'cd /d/streetrace-remote/frames && find . -name "f*.exr" -mmin +1 -size +100k | sed "s|^\./||" | sort')
need=()
for f in ${(f)remote}; do
  [[ -s "$DST/$f" ]] || need+=("$f")
done
echo "remote ready: ${#${(f)remote}}  to pull: ${#need}"
if (( ${#need} > 0 )); then
  print -l $need | ssh -o BatchMode=yes -o LogLevel=ERROR jadon7-wsl 'cd /d/streetrace-remote/frames && tar cf - -T -' | tar xf - -C "$DST"
fi
echo "local now: $(ls "$DST" | wc -l | tr -d ' ')"
