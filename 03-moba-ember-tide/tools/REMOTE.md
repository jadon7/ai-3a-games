# 远程那台 Windows 机器：怎么把重活放上去跑

2026-11-19 打通。入口是 `tools/remote.sh`，这里记机器的情况、装了什么、踩过的坑。

## 机器

- 局域网里的一台 Windows，主机名 `Jadon7`，地址 `<4090 主机局域网 IP>`（`Jadon7.local` 也能解析）。
- 显卡是 **RTX 4090，24G 显存**（`nvidia-smi` 报的；不是 5090）。32 线程，32G 内存。C 盘剩 62G，D 盘剩 130G 左右。
- 登录：本机 `~/.ssh/config` 里已经有别名 `jadon7-wsl`（用户 `<用户名>`，密钥 `~/.ssh/id_ed25519`），`ssh jadon7-wsl` 直接进，不用密码。名字里带 wsl，但进去是 Windows 的 Git Bash（MSYS），不是 Linux。
- 这台机器上还跑着别的东西（一个 Python 3.10 的进程占着约 6G 显存）。只在自己的目录里干活，不动别的进程。

## 目录（全在 `D:\moba-remote`，Git Bash 里写 `/d/moba-remote`）

| 路径 | 是什么 |
|---|---|
| `venv` | 独立的 Python 3.12 环境：torch 2.14.1+cu126、torchvision、timm、opencv、numpy、scipy |
| `video2rig` | 本机 `video2rig` 的一份拷贝：`scripts`、`v2r`、`data/<名>/train`、`runs`、`assets/model` |
| `cache/dinov2_vits14_reg4.safetensors` | DINOv2 骨干的预训练权重（从本机的 HuggingFace 缓存拷过去的） |
| `blender-5.2.2-windows-x64` | 免安装版 Blender，和本机同一个版本 |
| `bin/ffmpeg.exe` | 从 `imageio-ffmpeg` 包里拿出来的 ffmpeg |
| `dl` | 下载的安装包 |

没有动系统设置，没有装系统级的东西；不想要了把 `D:\moba-remote` 整个删掉就干净了。

## 能放上去的活

| 活 | 本机 | 远程 | 说明 |
|---|---|---|---|
| 训练关节识别网络 | 约 9 到 12 张/秒 | 约 85 到 90 张/秒 | 五个英雄 8000 组、4 轮：本机跑了 58 分钟才到第 2 轮，远程 11.7 分钟跑完 4 轮，精度一样（第 2 轮本机 6.93 像素、远程 7.09 像素）。**以后都放远程** |
| 渲染训练图（Blender） | 2 个进程约 4 组/秒，1600 组 6.5 分钟 | 8 个进程约 7 组/秒，1600 组不到 4 分钟 | `remote.sh render`。快得不多，好处是不占本机。2 个进程时每组 0.45 秒，8 个进程时每组 1.1 秒，再加进程收益很小 |
| 读视频成动作（`solve_only`） | 能跑 | 还没接 | 输入输出文件多，本机显卡空出来以后够用，暂时不挪 |
| 网页截图、录屏 | 只能本机 | — | 要连本机的开发服务器。训练挪走以后本机显卡不再被抢，截图不再白屏 |

## 常用命令

```bash
zsh tools/remote.sh check                              # 连得上吗、显卡多忙
zsh tools/remote.sh sync                               # 改了 video2rig 的脚本以后同步一次
zsh tools/remote.sh push-data heroes5                  # 本机渲染的训练图传过去
zsh tools/remote.sh train heroes5 4                    # 远程训练 4 轮，权重自动拉回 runs/heroes5/jointnet.pt
zsh tools/remote.sh push-model torg                    # 传一个角色的 .blend 和骨骼
zsh tools/remote.sh render mobs torg 1600 6000 0 4     # 远程渲染 1600 张，4 个进程
```

## 坑

- **连不上国外的站**：`pypi.org`、`download.pytorch.org`、`github.com`、`huggingface.co` 都不通。装包走国内镜像：
  - Python 包：`--index-url https://pypi.tuna.tsinghua.edu.cn/simple`
  - 带 CUDA 的 torch：`--find-links https://mirrors.aliyun.com/pytorch-wheels/cu126/`（Windows 上 PyPI 的 torch 是不带显卡的版本）
  - Blender：`https://mirrors.aliyun.com/blender/release/`
- **骨干权重下不了**：所以 `v2r/model.py` 加了环境变量 `V2R_BACKBONE_FILE`，指到拷过去的文件；`remote.sh` 已经设好。
- **`train.py` 原来只认 MPS**：改成了有 N 卡先用 N 卡，本机行为不变。
- **scp 的路径要写 `D:/moba-remote/...`**，写 `/d/moba-remote/...` 会报找不到；ssh 里跑命令则两种都行。
- **中文输出**：要设 `PYTHONUTF8=1`，不然日志是乱码（`remote.sh` 已经设好）。
- **本机这边停了，远程的进程不一定跟着停**（2026-11-19 实测：停掉本机的任务后，远程的 8 个 Blender 还在跑）。要停得在远程按确切的进程号结束：先 `wmic process where "name='blender.exe'" get ProcessId,CommandLine` 找出命令行里带自己模型名的，再 `taskkill //PID <号> //F`。训练和渲染都放后台任务里跑；两样现在都会排队（各占一个锁目录 `train.lock`、`render.lock`）。
- **`python3` 是微软商店的空壳**：用 `venv/Scripts/python.exe`，或者 `py -3.12`。
- 在远程训练出来的权重（CUDA）拿回本机（MPS）直接能用，格式一样。

## 验证过的（2026-11-19）

- `check`、`sync`、`push-model`、`render`、`train`、`run` 都实际跑过。`train` 完整跑过一轮（3.7 分钟），权重自动拉回本机。
- 远程渲染的训练图取回来和本机渲染的并排看过，背景、光照、贴图、运动模糊一致。
- `push-data`、`pull-data` 的写法和已经用过的传输命令一样，但这两个子命令本身没有单独跑过。
- 五个英雄正式用的权重就是远程训练的那份（`runs/heroes5/jointnet.pt`；本机训到第 2 轮的那份留作 `jointnet_local_ep2.pt`）。
