#!/bin/bash
# 把 art/models_src 里的原始模型压缩成引擎用的版本，输出到 public/assets/models。
# 建筑保留 1024 贴图和原面数；树、岩石、路边物件减面并用 512 贴图（它们会被成百上千地摆）。
set -e
cd "$(dirname "$0")/.."
OUT=public/assets/models; mkdir -p "$OUT"
opt() { # 名字 贴图尺寸 减面比例(1=不减)
  local simp="--simplify false"
  if [ "$3" != "1" ]; then simp="--simplify true --simplify-ratio $3 --simplify-error ${4:-0.01}"; fi
  npx --no-install gltf-transform optimize "art/models_src/$1_raw.glb" "$OUT/$1.glb" --texture-compress webp --texture-size "$2" --compress meshopt $simp --join false --flatten true --palette false > /dev/null 2>&1
  printf "%s %s\n" "$1" "$(du -k "$OUT/$1.glb" | cut -f1)KB"
}
for n in tower_cinder tower_moon base_cinder base_moon; do opt $n 1024 1; done
for n in tree_c1 tree_c2 tree_m1 tree_m2; do opt $n 512 0.16 0.04; done
for n in rock_c rock_m; do opt $n 512 0.25 0.03; done
for n in prop_c prop_m; do opt $n 512 0.4 0.02; done
for n in clutter_c clutter_m; do opt $n 512 0.2 0.03; done
