#!/bin/zsh
# 五个新英雄共用一个关节识别网络。这个脚本一直挂着：
#   哪个英雄的 art/hero/<id>/RIG_READY 出现了，就渲染它的 1600 张训练图（两个进程各 800），一次只渲染一个英雄；
#   五个都渲染完，合在一起训练 4 轮；第 2 轮结束时先把权重发给各英雄并考试（写 WEIGHTS_READY），训练完再发一次（写 WEIGHTS_FINAL）。
# 进度记在 art/hero/train_queue.log。
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba
BL=/Applications/Blender.app/Contents/MacOS/Blender; PY=$V/.venv/bin/python; LOG=$M/art/hero/train_queue.log
ids=(gorran vero osen moko torg); typeset -A done_; cd $V; mkdir -p data/heroes5/train runs/heroes5
say() { echo "$(date +%H:%M:%S) $*" >> $LOG }
give() { for id in $ids; do mkdir -p runs/$id; cp runs/heroes5/jointnet.pt runs/$id/jointnet.pt; r=$($PY scripts/pipeline.py exam $id --seed 1 2>&1 | grep -E "关节位置|骨骼朝向|结论" | tr '\n' ' '); say "考试 $id（$1）：$r"; done }
n=0
while [ $n -lt 5 ]; do
  for k in {1..5}; do id=$ids[$k]
    if [ -z "$done_[$id]" ] && [ -f $M/art/hero/$id/RIG_READY ] && [ -f assets/model/$id.blend ]; then
      st=$(( (k - 1) * 1600 )); say "开始渲染 $id（第 $st 张起）"
      $BL -b --factory-startup assets/model/$id.blend -P scripts/blender/render_dataset.py -- $id data/heroes5/train 800 $((5100 + k * 10)) $st > data/heroes5/render_${id}_a.log 2>&1 &
      p1=$!
      $BL -b --factory-startup assets/model/$id.blend -P scripts/blender/render_dataset.py -- $id data/heroes5/train 800 $((5105 + k * 10)) $((st + 800)) > data/heroes5/render_${id}_b.log 2>&1 &
      p2=$!
      wait $p1 $p2; done_[$id]=1; n=$((n + 1)); say "$id 渲染完，目录里共 $(ls data/heroes5/train/front 2>/dev/null | wc -l | tr -d ' ') 张"
    fi
  done
  [ $n -lt 5 ] && sleep 20
done
say "开始训练（8000 张，4 轮）"
$PY scripts/train.py heroes5 --epochs 4 --batch 16 --workers 4 --init runs/minion/jointnet.pt > runs/heroes5/train_stdout.log 2>&1 &
tp=$!
until grep -q "EPOCH 2/4" runs/heroes5/train_log.txt 2>/dev/null || ! kill -0 $tp 2>/dev/null; do sleep 30; done
say "$(grep EPOCH runs/heroes5/train_log.txt | tail -1 | cut -c1-150)"; give "第 2 轮"; touch $M/art/hero/WEIGHTS_READY
wait $tp
say "训练结束：$(grep -E 'EPOCH|DONE' runs/heroes5/train_log.txt | tail -2 | cut -c1-150 | tr '\n' ' ')"; give "最终"; touch $M/art/hero/WEIGHTS_FINAL
