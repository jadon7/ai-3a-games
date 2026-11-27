#!/bin/zsh
# 给英雄的模型绑骨（Tripo，Mixamo 骨骼命名，每个 25 额度），下载到 art/hero/<id>/tripo_rigged.glb。用法: zsh art/hero/rig_all.sh gorran vero …
cd "$(dirname "$0")/../.."
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
for id in "$@"; do
  out=art/hero/$id/tripo_rigged.glb
  [ -f $out ] && { echo "skip $id"; continue; }
  tid=$($PY -c "
import json
m = {}
for l in open('art/models_src/log.jsonl'):
    if l.strip():
        r = json.loads(l)
        if r.get('task_id'): m[r['name']] = r['task_id']
print(m['hero_$id'])")
  rt=$($PY tools/tripo.py rig $tid --rig-type biped --spec mixamo --out-format glb 2>&1 | grep -o "task_id: .*" | cut -d' ' -f2)
  echo "$id rig 已提交" | tee -a art/hero/rig.log; echo "$id $rt" >> art/hero/rig_tasks.txt
  $PY tools/tripo.py wait $rt --download $out 2>&1 | tail -1 | cut -c1-160 | tee -a art/hero/rig.log
done
$PY tools/tripo.py balance | tee -a art/hero/rig.log
