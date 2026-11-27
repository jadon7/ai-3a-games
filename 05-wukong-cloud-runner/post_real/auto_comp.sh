#!/bin/zsh
# 等某个镜头的最后一帧渲完就自动合成 + 质检：auto_comp.sh "<镜头> <最后一帧的文件名>" ...
ROOT="${0:A:h:h}"
PY="$1"; shift
for item in "$@"; do
  a=(${=item}); sh=$a[1]; last="$ROOT/renders_real/$sh/$a[2]"
  until [ -f "$last" ]; do sleep 10; done
  sleep 6
  "$PY" "$ROOT/post_real/comp.py" $sh --workers=4 | cut -c1-200
  "$PY" "$ROOT/tests/qc_real.py" $sh | cut -c1-200
  echo "AUTOCOMP $sh done $(date '+%T')"
done
