# 4090 机器使用说明（给 Agent）

用户有一台 Windows + RTX 4090 的机器，训练、Blender 渲染、只能跑 CUDA 的模型都可以放上去。
它是共用的：用户自己的服务也在上面跑。**只在自己的目录里干活，不动别人的进程和文件。**

最后核对：2026-11-26（连上去实测；同一天加进了 Tailscale 并测了速）。第 0、4 节的命令、`scp` 写法和测速脚本都原样跑通过，包括强制走 Tailscale 的情况。标注“11-19 记录”的条目沿用更早的实测，这次没有重跑。

## 0. 先选别名（每次开工先跑这一行）

```bash
H=$(nc -z -G 2 <4090 主机局域网 IP> 22 >/dev/null 2>&1 && echo jadon7-wsl || echo jadon7-ts); echo "用 $H"
```

- `jadon7-wsl`：家里局域网（`<4090 主机局域网 IP>`）。这台 Mac 在家时用它，最快。
- `jadon7-ts`：经 Tailscale（`<4090 主机 Tailscale IP>`，设备名 `jadon7-4090`）。这台 Mac 不在家时用它；在家也能用，只是慢一半。
- 两个别名是同一台机器、同一个用户（`<用户名>`）、同一把密钥，都免密。下文命令里一律写 `$H`。

## 1. 机器和登录

- 别名和密钥只配在 jadon7 的这台 Mac 上（`~/.ssh/config`），所以**只有在这台 Mac 上运行的 Agent 能直接连**。那台机器只认密钥、不认密码；别的设备要连，得先让用户把那台设备的公钥加上去。
- 进去是 Windows 的 Git Bash（MINGW64），不是 Linux，也不是 WSL（别名里的 wsl 只是名字）。主机名 `Jadon7`。
- 硬件：RTX 4090 24G 显存，32 线程，32G 内存。
- 现状（11-26）：显存常年被占约 6G，内存空闲约 14G；C 盘只剩 25 到 31G，D 盘剩 120G 左右。**东西都放 D 盘。**显卡有时被用户自己的服务占着（当天下午见过 40% 占用），以第 4 节的检查命令为准。

### Tailscale 这条路

- 前提：这台 Mac 上的 Tailscale 开着，`tailscale status` 里能看到 `jadon7-4090`。两台都在 `<你的 Tailscale 账号>` 这个网络里。
- **连的时候写 IP（别名里已经写好），不要写设备名**：这台 Mac 的代理会把 `jadon7-4090` 解析成 198.18.x.x 的假地址，连不上。
- Windows 上 Tailscale 是无人值守模式、服务开机自启，没人登录桌面也在线。设备密钥 2027-05-26 到期，到期后要用户重新登录一次。
- 测速脚本（只读，不在远程留文件）：`python3 /Users/jadon7/Documents/SynologyDrive/code/video2rig/scripts/remote4090_test.py [别名] [数据量MB]`，不给别名时自动选。

| 场景（11-26 实测） | 延迟 | ssh 登录一次 | 上传 | 下载 |
|---|---|---|---|---|
| 在家，`jadon7-wsl`（局域网） | 3–9 毫秒 | 0.4 秒 | 125 Mbps | 84 Mbps |
| 在家，`jadon7-ts`（Tailscale 直连） | 5–9 毫秒 | 0.6 秒 | 62 Mbps | 38 Mbps |
| 在外面，`jadon7-ts` | 还没测 | | | |

- 在外面的情况还没有实测。两边的网络自检都显示能打洞（UDP 通、端口映射不随目标变），所以大概率是直连，速度取决于家里宽带的上行。打不通时会走 Tailscale 的中继：两边最近的中继都在美国西海岸（Mac 到西雅图 175 毫秒，Windows 到旧金山 160 毫秒），来回延迟会在 300 毫秒以上，跑命令还行，传大文件会很慢。
- 在外面时第一件事：跑一次上面的测速脚本，看 `tailscale ping` 那行是 `via <IP>`（直连）还是 `via DERP(xxx)`（中继），再决定要不要传大文件。

## 2. 共用机器的规矩

- 机器上常驻着用户自己的服务，例如 `D:\AI\CosyVoice3-Studio-win`（语音合成）和 `D:\AI\LTX-IDLoRA`（`ltx_server.py`、`facade_server.py`），都是 `python.exe`。**不要结束它们。**
- 结束进程只按确切的进程号（见第 5 节），绝不按名字批量结束：`python.exe`、`blender.exe` 可能是别人的。
- 每个项目在 D 盘建自己的目录（例如 `D:\<项目名>-remote`），自己建虚拟环境。不要往别人的环境里装包，不要改系统设置，不装系统级的东西。
- D 盘上已有的目录（`D:\moba-remote`、`D:\ai-remote`、`D:\AI` 等）属于别的任务，只读可以，不要改、不要删。
- Tailscale 是用户让装的（`C:\Program Files\Tailscale`），不要退出登录、不要改它的设置。
- 可用显存按 18G 以内算；内存按 14G 以内算。跑之前先看一眼占用，跑完把大的中间文件删掉。

## 3. 现成可用的东西

机器上已有：`git`、`tar`、`scp`、`curl`、`ffmpeg`、Python 启动器 `py`（有 3.12 和 3.10）。

`D:\moba-remote`（Git Bash 里写 `/d/moba-remote`）是 video2rig / MOBA 项目搭好的环境，约 8.5G：

| 路径 | 内容 |
|---|---|
| `venv` | Python 3.12.10，torch 2.14.1+cu126、torchvision 0.29.1+cu126、timm、opencv、numpy、scipy。CUDA 可用 |
| `blender-5.2.2-windows-x64` | 免安装版 Blender 5.2.2 |
| `bin/ffmpeg.exe` | ffmpeg |
| `cache/dinov2_vits14_reg4.safetensors` | DINOv2 骨干权重 |
| `video2rig` | video2rig 代码、训练数据、权重的远程副本 |

做 video2rig 相关的活直接用这套环境（见第 6 节）。做别的活请另建目录和环境。

## 4. 通用用法

下面的 `$H` 来自第 0 节那一行。

先看机器忙不忙：

```bash
ssh -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=10 $H 'hostname; nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader; df -h /c /d | tail -2'
```

跑多行脚本（引号最省心的写法）：

```bash
ssh -o BatchMode=yes -o LogLevel=ERROR -o ServerAliveInterval=20 $H 'bash -s' <<'EOF'
cd /d/<你的目录>
export PYTHONUTF8=1
./venv/Scripts/python.exe your_script.py
EOF
```

传文件：

```bash
# 整个目录传过去（比 scp -r 快）
COPYFILE_DISABLE=1 tar cf - --exclude .DS_Store <本机目录> | ssh $H 'mkdir -p /d/<你的目录> && tar xf - -C /d/<你的目录>'
# 单个文件；scp 的远程路径必须写 D:/…，写 /d/… 会报找不到
scp <本机文件> "$H:D:/<你的目录>/"
scp "$H:D:/<你的目录>/result.bin" ./
```

新建自己的环境（11-19 记录的装法，版本号取自现有环境，这次没有重装）：

```bash
ssh -o BatchMode=yes -o LogLevel=ERROR $H 'bash -s' <<'EOF'
mkdir -p /d/<你的目录> && cd /d/<你的目录>
py -3.12 -m venv venv
./venv/Scripts/python.exe -m pip install "torch==2.14.1+cu126" "torchvision==0.29.1+cu126" \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
  --find-links https://mirrors.aliyun.com/pytorch-wheels/cu126/
EOF
```

## 5. 长任务和进程

- 时间长的任务（训练、渲染）在本机用后台任务跑那条 ssh 命令，不要开着前台干等。
- 不要指望“断开连接远程就停”或“断开连接远程还在”：两种情况都出现过（11-19 记录：本机任务停了，远程 8 个 Blender 还在跑）。本机停掉任务后，一定上去查一遍自己的进程。在外面走 Tailscale 时网络更容易断，这一条更要紧。
- 查进程和命令行（`wmic` 在这台机器上已经没有了，用 PowerShell）：

```bash
ssh -o BatchMode=yes -o LogLevel=ERROR $H 'bash -s' <<'EOF'
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='python.exe' or name='blender.exe'\" | ForEach-Object { '{0}  {1}' -f \$_.ProcessId, \$_.CommandLine }" | iconv -f GBK -t UTF-8
EOF
```

- 从命令行认出自己的进程（路径里带自己的目录），再按进程号结束（11-19 记录）：`ssh $H 'taskkill //PID <进程号> //F'`。

## 6. video2rig 的活：用现成脚本

入口是 `/Users/jadon7/Documents/SynologyDrive/code/moba/tools/remote.sh`，细节在同目录的 `REMOTE.md`（那份是 11-19 写的，和本文不一致的地方以本文为准）。

```bash
R=/Users/jadon7/Documents/SynologyDrive/code/moba/tools/remote.sh
zsh $R check                              # 连得上吗、显卡多忙、盘还剩多少
zsh $R sync                               # 把本机 video2rig 的 scripts、v2r 同步过去（改了脚本后跑一次）
zsh $R push-model <模型名>                 # 传 assets/model/<名>.blend 和骨架 JSON
zsh $R render <数据集名> <模型名> <张数> <种子> [起始编号] [进程数] [rear]   # 远程渲染训练图
zsh $R push-data <数据集名>                # 本机渲染的训练图传过去
zsh $R train <名> [轮数=4] [初始权重] [批大小=16] [读图进程数=6]             # 远程训练，权重自动拉回本机 runs/<名>/
zsh $R run '<命令>'                        # 在远程 video2rig 目录里跑一条命令，$PY 是 python，$BL 是 Blender
```

- **`remote.sh` 里写死的是 `jadon7-wsl`，所以它只能在家里用。** 在外面要用它，把 `$R` 换成临时改过别名的版本：`zsh <(sed 's/^H=jadon7-wsl/H=jadon7-ts/' $R) check`（11-26 实测 `check` 能跑通；`train`、`render` 这些长任务没有用这种写法跑过）。
- 速度（11-19 记录）：训练约 85 到 90 张/秒（这台 Mac 约 9 到 12）；渲染 8 个进程约 7 组/秒。
- 训练和渲染各自排队，同一时间只跑一个（锁目录 `D:\moba-remote\train.lock`、`render.lock`）。看到“别的训练在跑”就等，不要删别人的锁。
- 读图进程数不要超过 6：开 16 个时一次训练占 24G 内存，两个训练同时跑把 32G 撑爆过。
- 远程（CUDA）训练出的权重拿回 Mac（MPS）直接能用。

## 7. 坑

- **这台 Mac 的磁盘经常是满的**（11-26 写这份说明时就满到连命令都起不来）。命令报 `no space left on device` 时问题在本机，不在远程。把大文件从远程拉回来之前先看 `df -h /System/Volumes/Data`；能留在远程 D 盘的就留在远程。
- **ssh 会打印一段 post-quantum 警告**，无害。命令里加 `-o LogLevel=ERROR` 就不显示；`-o BatchMode=yes` 保证连不上时直接报错而不是停下来等输入密码。
- **`python3` 是微软商店的空壳**，用 `venv/Scripts/python.exe` 或 `py -3.12`。
- **中文乱码**：终端代码页是 936（GBK）。Python 脚本前设 `PYTHONUTF8=1`；Windows 自带命令的输出接 `| iconv -f GBK -t UTF-8`。
- **Windows 上 PyPI 的 torch 不带显卡**，要装带 `+cu126` 的版本（见第 4 节）。
- **外网时通时不通**：11-19 时 `pypi.org`、`github.com`、`huggingface.co` 都连不上，11-26 实测都能连（那台机器上开着代理）。装东西前先 `curl -m 6 -sI <地址>` 试一下；不通就走国内镜像：清华 PyPI（`https://pypi.tuna.tsinghua.edu.cn/simple`）、阿里云 pytorch-wheels（`https://mirrors.aliyun.com/pytorch-wheels/cu126/`）、阿里云 Blender（`https://mirrors.aliyun.com/blender/release/`）、`https://hf-mirror.com`。
- **Git Bash 里 Windows 命令的斜杠参数要写两个**，例如 `taskkill //PID 1234 //F`、`tasklist //FI "IMAGENAME eq python.exe"`。
- **路径两种写法**：ssh 里跑命令用 `/d/目录` 或 `D:/目录` 都行；scp 只认 `D:/目录`。
