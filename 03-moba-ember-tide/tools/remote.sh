#!/bin/zsh
# 把重活放到远程那台 Windows 机器（RTX 4090）上跑。机器、目录、坑都写在 tools/REMOTE.md。
# 用法（在哪个目录跑都行）:
#   zsh tools/remote.sh check                      连得上吗、显卡现在多忙、盘还剩多少
#   zsh tools/remote.sh sync                       把 video2rig 的代码（scripts、v2r）传过去；改了训练或渲染脚本以后跑一次
#   zsh tools/remote.sh push-data <数据集名>        把本机 data/<名>/train 传过去（本机渲染的训练图）
#   zsh tools/remote.sh push-model <模型名>         把 assets/model/<名>.blend 和 <名>_skeleton.json 传过去（远程渲染训练图要用）
#   zsh tools/remote.sh render <数据集名> <模型名> <张数> <种子> [起始编号=0] [进程数=4] [rear]
#                                                  远程渲染训练图，留在远程的 data/<数据集名>/train，接着 train 就行。最后加 rear：四足用，这一批以人立为主
#   zsh tools/remote.sh train <名> [轮数=4] [初始权重=runs/minion/jointnet.pt] [批大小=16] [读图进程数=6]
#                                                  远程训练 data/<名>/train，完了把 jointnet.pt 和日志拉回本机 runs/<名>/
#   zsh tools/remote.sh pull-data <数据集名>        把远程的 data/<名>/train 拉回本机（本机要看训练图或者做别的才需要）
#   zsh tools/remote.sh run '<命令>'               在远程的 video2rig 目录里跑一条命令（环境变量已经设好，python 用 $PY，Blender 用 $BL）
# 注意：远程的进程挂在这条 ssh 连接上，连接断了进程就没了。时间长的（训练、渲染）放后台任务里跑，别开着前台等。
set -e
H=jadon7-wsl                                        # ~/.ssh/config 里的别名：<用户名>@<4090 主机局域网 IP>，用 ~/.ssh/id_ed25519 登录
R=/d/moba-remote                                    # 远程的工作目录（Git Bash 的写法）
RW=D:/moba-remote                                   # 同一个目录，scp 要用这种写法
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
SSH=(ssh -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=10 -o ServerAliveInterval=20 $H)
SCP=(scp -q -o BatchMode=yes -o LogLevel=ERROR)
ENV="export PYTHONUTF8=1 HF_HUB_OFFLINE=1 V2R_BACKBONE_FILE=$RW/cache/dinov2_vits14_reg4.safetensors PATH=$R/bin:\$PATH PY=$R/venv/Scripts/python.exe BL=$R/blender-5.2.2-windows-x64/blender.exe"
cmd=$1; [ -n "$cmd" ] && shift
case "$cmd" in
  check)
    $SSH "hostname; nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader; df -h /d | tail -1; ls $R"
    ;;
  sync)
    cd $V; COPYFILE_DISABLE=1 tar cf - --exclude "__pycache__" --exclude ".DS_Store" scripts v2r | $SSH "mkdir -p $R/video2rig && tar xf - -C $R/video2rig"; echo "代码已同步"
    ;;
  push-data)
    n=$1; [ -d $V/data/$n/train ] || { echo "本机没有 data/$n/train"; exit 1; }
    cd $V; COPYFILE_DISABLE=1 tar cf - --exclude ".DS_Store" data/$n/train | $SSH "mkdir -p $R/video2rig && tar xf - -C $R/video2rig"
    $SSH "ls $R/video2rig/data/$n/train/front | wc -l"
    ;;
  pull-data)
    n=$1; mkdir -p $V/data/$n; $SSH "cd $R/video2rig && tar cf - data/$n/train" | tar xf - -C $V; ls $V/data/$n/train/front | wc -l
    ;;
  push-model)
    m=$1; $SSH "mkdir -p $R/video2rig/assets/model"
    $SCP $V/assets/model/$m.blend $V/assets/model/${m}_skeleton.json "$H:$RW/video2rig/assets/model/"; echo "$m 的模型已传"
    ;;
  render)
    ds=$1; m=$2; n=$3; seed=$4; st=${5:-0}; p=${6:-4}; mode=$7; per=$((n / p))
    # 渲染也排队（2026-11-19 四个任务同时各开 8 个 Blender，显存撑满，每分钟只出几组）。锁超过 20 分钟没放开就接手
    until $SSH "mkdir $R/render.lock 2>/dev/null"; do
      age=$($SSH "echo \$(( \$(date +%s) - \$(stat -c %Y $R/render.lock 2>/dev/null || date +%s) ))")
      if [ "${age:-0}" -gt 1200 ]; then $SSH "rmdir $R/render.lock 2>/dev/null || true"; else echo "别的渲染在跑（已经 ${age} 秒），等 30 秒再看"; sleep 30; fi
    done
    trap "$SSH 'rmdir $R/render.lock 2>/dev/null || true'" EXIT
    $SSH "cd $R/video2rig && $ENV && mkdir -p data/$ds/train && t0=\$(date +%s) && for k in \$(seq 0 $((p - 1))); do \"\$BL\" -b --factory-startup assets/model/$m.blend -P scripts/blender/render_dataset.py -- $m data/$ds/train $per \$(($seed + k)) \$(($st + k * $per)) $mode > data/$ds/render_${m}_${st}_\$k.log 2>&1 & done; wait; echo \"$m 渲染完，用时 \$((\$(date +%s) - t0)) 秒，目录里共 \$(ls data/$ds/train/front | wc -l) 张\"; grep -l -E 'Traceback|Error' data/$ds/render_${m}_${st}_*.log || true"
    ;;
  train)
    n=$1; ep=${2:-4}; init=${3:-runs/minion/jointnet.pt}; bs=${4:-16}; wk=${5:-6}      # 读图进程默认 6 个：train.py 有三个常驻的读图器，16 个时一次训练就占 24G 内存，两个训练同时跑会把那台机器的 32G 撑爆（2026-11-19 撞过）
    # 一次只让一个训练跑（几个任务同时要训练时自己排队）：占一个目录当锁，训练完放开。锁超过 30 分钟没放开，多半是上一个训练的连接断了，直接接手
    until $SSH "mkdir $R/train.lock 2>/dev/null"; do
      age=$($SSH "echo \$(( \$(date +%s) - \$(stat -c %Y $R/train.lock 2>/dev/null || date +%s) ))")
      if [ "${age:-0}" -gt 1800 ]; then $SSH "rmdir $R/train.lock 2>/dev/null || true"; else echo "别的训练在跑（已经 ${age} 秒），等 30 秒再看"; sleep 30; fi
    done
    trap "$SSH 'rmdir $R/train.lock 2>/dev/null || true'" EXIT
    if [ -n "$init" ] && [ -f $V/$init ]; then $SSH "mkdir -p $R/video2rig/$(dirname $init)"; $SCP $V/$init "$H:$RW/video2rig/$init"; fi
    $SSH "cd $R/video2rig && $ENV && \"\$PY\" scripts/train.py $n --epochs $ep --batch $bs --workers $wk ${init:+--init $init} > runs_$n.out 2>&1; grep -E 'EPOCH|DONE|Error|Traceback|^train ' runs_$n.out | cut -c 1-240"
    $SSH "grep -q '^DONE' $R/video2rig/runs_$n.out" || { echo "训练没有跑完（没看到 DONE），不拉权重。日志在远程的 video2rig/runs_$n.out"; exit 1; }
    mkdir -p $V/runs/$n
    $SCP "$H:$RW/video2rig/runs/$n/jointnet.pt" $V/runs/$n/jointnet.pt
    $SCP "$H:$RW/video2rig/runs/$n/train_log.txt" $V/runs/$n/train_log_remote.txt
    ls -la $V/runs/$n/jointnet.pt | awk '{printf "权重已拉回：%.1f MB  %s\n", $5/1e6, $9}'
    ;;
  run)
    $SSH "cd $R/video2rig && $ENV && $1"
    ;;
  *)
    sed -n 2,17p $0; exit 1
    ;;
esac
