#!/bin/zsh
# 排队用即梦出图（第九轮起）：几个任务并行时，同一时间只让一个往画布上写（两个批次同时写，草稿版本会冲突）。
# 用法（在哪个目录跑都行，出图记录和 jobs 里的相对路径都按主目录算）:
#   zsh /Users/jadon7/Documents/SynologyDrive/code/moba/tools/jimeng_lock.sh <jobs.json 的绝对路径>
# jobs.json 的格式见 tools/jimeng_gen.py 开头；出图前先看一眼余额：dreamina-canvas auth account --format json 里的 availableCredits。
# 占一个目录当锁，跑完放开。锁超过 40 分钟没放开，多半是上一个任务断了，直接接手。
L=/private/tmp/moba-jimeng.lock
until mkdir $L 2>/dev/null; do
  age=$(( $(date +%s) - $(stat -f %m $L 2>/dev/null || date +%s) ))
  if [ $age -gt 2400 ]; then rmdir $L 2>/dev/null; else echo "别的任务在用即梦（已经 ${age} 秒），等 20 秒再看"; sleep 20; fi
done
trap "rmdir $L 2>/dev/null" EXIT
cd /Users/jadon7/Documents/SynologyDrive/code/moba && python3 tools/jimeng_gen.py "$@"
