# video2rig：用 AI 视频给任意怪物做骨骼动画

复现 YouTube 视频《AI Can Now Animate Any Monster》（Can It Code?）里的管线：
让 Seedance 拍一段“我们自己的怪物在动”的双机位视频，再把视频里每一帧的关节读出来，放回怪物自己的骨架上。

## 流程

| 步骤 | 做什么 | 用什么 | 脚本 |
|---|---|---|---|
| 1 | 怪物概念图 | 即梦 CLI（Seedream） | `dreamina-canvas node create image` |
| 2 | 图转 3D 模型 | Tripo API | `scripts/tripo.py image2model` |
| 3 | 自动绑骨 | Tripo API（双足用 Mixamo 命名；四足用 `--rig-type quadruped`） | `scripts/tripo.py rig` |
| 3b | 仅非双足：看清骨架，写骨骼角色映射 | 无界面 Blender + 手写 JSON | `scripts/blender/inspect_weights.py`、`assets/model/<name>_rigmap.json` |
| 4 | 摆正、搭双机位棚、导出骨架、自检 | 无界面 Blender | `scripts/blender/prep_rig.py` |
| 5 | 随机姿势训练集（精确关节标签） | 无界面 Blender | `scripts/blender/render_dataset.py` |
| 6 | 训练这只怪物专用的关节检测器 | DINOv2 ViT-S 微调（PyTorch/MPS） | `scripts/train.py` |
| 7 | “考试”：已知运动 → 渲染 → 读回 → 逐骨头比对 | 全部本地 | `scripts/pipeline.py exam` |
| 8 | 双机位参考图 → AI 视频 | 即梦 CLI（Seedance 2.5 样片模式） | `dreamina-canvas node create video` |
| 9 | 视频 → 骨架动画（.blend / .glb / 对比视频） | 全部本地 | `scripts/pipeline.py animate` |

## 常用命令

```bash
# 新怪物：绑好骨的 GLB 放到 assets/model/<name>_rigged.glb 之后
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/prep_rig.py -- assets/model/troll_rigged.glb troll

# 渲染训练集（一个进程约 0.33 秒/样本；别同时开太多个，内存吃紧会把交换文件撑大）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup assets/model/troll.blend -P scripts/blender/render_dataset.py -- troll data/troll/train 1600 2000 0

# 训练（M3 Max 约 16~25 张/秒，6 轮约 40 分钟；--init 可以从已有权重热启动；每轮结束都会存一次权重）
# 训练是最吃内存的一步：--batch 24 时进程占约 12GB（其中 11GB 显存），--batch 12 约 7GB。
# 别和 Blender 渲染、浏览器里的 3D 页面同时跑；机器上开着很多大应用时用 --batch 12 --workers 2
.venv/bin/python scripts/train.py troll --epochs 6

# 考试（换了权重重考时加 --reuse，直接用上次渲染好的考试视频）
.venv/bin/python scripts/pipeline.py exam troll --seed 1

# 把一段 Seedance 视频变成动画
.venv/bin/python scripts/pipeline.py animate troll out/seedance/troll_slam_01.mp4 --tag slam
```

## 非双足怪物（四足）

双足怪物让 Tripo 按 Mixamo 命名绑骨，骨骼名是固定的，直接查表就行。四足不一样：Tripo 的四足绑骨是模型预测出来的骨架，
**没有固定命名**（很多骨骼叫 `bone_N`，左肩胛骨可能叫 `Spine_3`），左右腿的拓扑也可能不对称，还会有重复骨骼和挂错父级的骨骼。
所以每只非双足怪物要多做一步——写一份 `assets/model/<name>_rigmap.json`：

```bash
# 1. 绑骨
.venv/bin/python scripts/tripo.py rig <图转模型的 task_id> --rig-type quadruped
# 2. 看每根骨骼管哪块肉：打印各骨骼的蒙皮权重范围，并把骨架画在侧 / 顶 / 正三视图上（out/inspect/<前缀>_*_bones.jpg）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/inspect_weights.py -- assets/model/beast_rigged.glb out/inspect/beast_w
# 3. 照着写 assets/model/beast_rigmap.json（可以拿现成的这份改），然后和双足一样跑 prep_rig.py
```

映射文件里写的东西（`beast_rigmap.json` 是完整例子）：

- `forward`：模型原始坐标里怪物面朝哪个方向；`target_length`：摆正后把身长缩放到多少（四足用 1.2，两个机位都装得下）
- `bones`：每根受控骨骼的角色和左右。没列出的骨骼不受控，跟着父骨骼走，重复骨骼和零碎骨骼就这样处理
- `reparent`：挂错父级的骨骼改挂到哪（这只怪物右后腿膝盖附近的皮被绑到了脊柱上的一根骨骼，不改的话抬腿会撕裂）
- `chains`：几根骨骼共用一组角度的“骨骼链”（脊柱、尾巴）
- `joints`：跟踪哪些点——骨骼头部、骨骼尾部（`"at": "tail"`），或者从网格上自动找的标记点（鼻尖、两只角）
- `torso_joints` / `root_joint` / `ground_joints`：求解器要用的几组点（定整体朝向、定整体位置、不许踩进地面）

四足这一类共用的东西（各关节能怎么动、随机姿势怎么采样）在 `v2r/profiles.py`。带翅膀或六足的怪物，需要在那里再加一类。

四足的“考试”多一个选项，专门考人立：`scripts/pipeline.py exam beast --seed 2 --rear 70`。

## 查看结果

线上：<https://claude.ai/artifact/C1taxfVK7vLGxbiD5qYosx>（私有，只有你能打开）。

本地：

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory viewer
```

然后打开 <http://localhost:8765>。页面顶部可以切换角色（岩石巨魔 / 岩甲巨兽），也可以用 `?c=beast&a=rear` 这样的地址直接打开某个角色的某个动作。页面循环播放动作，可以拖动旋转、缩放、平移摄像机，逐帧步进，并和 Seedance 原视频同步对照；两个“对照机位”按钮会还原生成视频时的正面 / 侧面正交相机。

页面的数据全在 `viewer/assets/manifest.js`（`characters` 里每个角色一项，文件头部有字段说明）。加新动作的步骤（四足把 troll 换成 beast）：

```bash
# 1. 把视频转成动画
.venv/bin/python scripts/pipeline.py animate troll out/seedance/<新视频>.mp4 --tag <动作名>
# 2. 把所有动作重新打进一个 GLB（每个动作是一段 glTF 动画）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup assets/model/troll.blend -P scripts/blender/export_actions.py -- troll viewer/assets/troll.glb slam=out/anim/troll_slam/motion.npz punch=out/anim/troll_punch/motion.npz <动作名>=out/anim/troll_<动作名>/motion.npz
# 3. Artifact 不能直接托管 .glb，转成 base64 文本；再把视频拷进去，并在 manifest.js 的 actions 里加一项
base64 -i viewer/assets/troll.glb -o viewer/assets/troll.glb.txt
```

## 目录

- `v2r/`：核心代码。`skeleton.py` 骨架 / 自由度 / FK / 投影 / 随机姿势；`profiles.py` 各类骨架的配置（双足查表、四足读映射文件）；`model.py` 关节检测网络；`data.py` 数据增强；`solver.py` 关节读数 → 骨骼旋转；`video.py` 视频读写
- `scripts/blender/`：所有 Blender 端脚本，都用 `-b --factory-startup` 无界面运行，不会碰你正在用的 Blender 窗口
- `assets/`：概念图、模型、骨架 JSON、双机位参考图
- `data/`：渲染出来的训练集和考试数据（可以随时重新生成，不进版本库）
- `runs/`：训练权重和考试成绩
- `out/`：Seedance 视频、最终动画和对比视频（`out/anim_v1/` 是加手指之前的第一版结果）
- `viewer/`：3D 查看网页和它的素材

## 约定

- 归一化之后：角色脚踩 z=0，面朝 -Y，左手边是 +X；双足身高约 1.0，四足身长 1.2（误差都按这个尺寸的百分比报告）
- 两个机位都是正交相机，画幅 8:9，拼起来正好 16:9；左半正面、右半侧面（角色朝右）
- 正交相机下“两条视线求交”就是直接读数：正面给 x 和 z，侧面给 y 和 z
- 即梦画布项目信息在 `jimeng_project.json`；Tripo 的 key 在 `~/.config/video2rig/env`，不在项目目录里

## 目前的限制

- 双足（Mixamo 命名）全自动；四足要为每只怪物手写一份骨骼角色映射（见上面“非双足怪物”一节）。带翅膀、六足的怪物还没有对应的自由度表
- 手指只有“四指握拳”和“拇指”两个联动自由度（靠中指尖和拇指尖两个关键点估计）；头两侧各有一个标记点，所以头的左右转动是可观测的；模型没有下颌骨，嘴不会张
- 被身体挡住的关节是网络猜的，和原视频作者说的一样
- 岩甲巨兽的检测器是分两段训完 6 轮的（前 3 轮后磁盘告急被看护程序停下，清理后续训 3 轮）。`runs/beast/jointnet_ep3.pt` 是只训 3 轮时的权重，留作对照
- 四足没有跟踪下颌（模型没有口腔，转下颌骨嘴也不会张）

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的：核心代码 `v2r/`、全部脚本、Seedance 提示词 `prompts/`、各怪物的骨架 / 骨骼映射 JSON（`assets/model/*_skeleton.json`、`*_rigmap.json`）、查看器页面和 `manifest.js`。模型、训练集、权重、视频都没放进来，**直接 clone 下来不能完整运行**，要从第 1 步自己生成一遍，或者换成你自己的怪物。

### 怎么运行

- **Python**：上面的命令都用项目根目录下的 `.venv/bin/python`。仓库里没有 requirements 文件；作者本机是用 uv 建的 Python 3.11 虚拟环境，里面装的主要是 torch、torchvision、timm、opencv-python、numpy、scipy、Pillow、requests、huggingface_hub。训练在 Mac 上用 PyTorch 的 MPS。
- **DINOv2 骨干权重**：`v2r/model.py` 通过 timm 从 HuggingFace 自动下载；连不上 HuggingFace 的机器，把环境变量 `V2R_BACKBONE_FILE` 指到本地的 `model.safetensors`。
- **Blender**：命令里写的是 macOS 的 `/Applications/Blender.app/Contents/MacOS/Blender`，脚本都用 `-b --factory-startup` 无界面跑。`REMOTE_4090.md` 里记录远程那台 4090 上用的是 Blender 5.2.2，主文档没写最低版本要求。
- **查看器**：`viewer/index.html` 需要的 `.glb`、`.glb.txt` 和对照视频不在仓库里，要按上面"查看结果"一节自己导出后才能看。README 里的线上链接是作者的私有 Artifact，别人打不开。
- **远程 4090**：`REMOTE_4090.md` 和 `scripts/remote4090_test.py` 是作者自己那台 Windows + RTX 4090 机器的使用笔记和测速脚本，ssh 别名只在作者的电脑上配过，别人用不了，仅供参考。

### 需要自己填的配置

- **即梦（Seedream 出图、Seedance 出视频）**：`scripts/jimeng.py` 调用命令行工具 `dreamina-canvas`，需要你自己装好并登录。画布项目信息读 `jimeng_project.json`，仓库里只有 `jimeng_project.example.json`：复制一份改名为 `jimeng_project.json`，填上你自己的即梦画布项目 ID。
- **Tripo（图转模型、自动绑骨）**：`scripts/tripo.py` 先读环境变量 `TRIPO_API_KEY`，没有的话读 `~/.config/video2rig/env` 里 `TRIPO_API_KEY=` 这一行。key 不要放进项目目录。脚本默认连国际站，国内站的地址写在脚本注释里。

### 哪些东西不在仓库里

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| 怪物概念图 | `assets/concept/` | 约 20 MB | 即梦 Seedream 出图（流程第 1 步） |
| 绑好骨的模型和 Blender 工程（`*_rigged.glb`、`<name>.blend`） | `assets/model/` | 约 750 MB | Tripo 图转模型 + 自动绑骨（`scripts/tripo.py image2model` / `rig`），再跑 `scripts/blender/prep_rig.py`。孙悟空例外：是用 `scripts/blender/wukong_build_rig.py` 从作者另一部影片的角色文件整理出来的，那个源文件在作者本机，未公开 |
| 双机位参考图 | `assets/ref/` | 约 9 MB | 悟空用 `scripts/blender/wukong_ref.py`；其它角色文档里没写具体出图步骤，原始文件在作者本机，未公开 |
| 训练集和考试数据（约 7.8 万张渲染图 + 标签） | `data/` | 约 1.8 GB | `scripts/blender/render_dataset.py`（可以随时重新生成） |
| 训练好的关节检测器权重（`.pt`）和考试成绩 | `runs/` | 约 1.4 GB | `scripts/train.py` 重新训练；作者的权重原文件在作者本机，未公开 |
| Seedance 视频 | `out/seedance/` | 约 390 MB | `scripts/jimeng.py video --ref ... --prompt-file prompts/<动作>.txt`（会消耗即梦积分，加 `--quote-only` 只报价） |
| 生成的动画（`.npz` / `.blend` / `.glb`）、对比视频、骨架检查图 | `out/anim/`、`out/anim_v1/`、`out/inspect/` | 约 1.5 GB | `scripts/pipeline.py animate ...`、`scripts/blender/inspect_weights.py` |
| 查看器素材（`troll.glb`、`beast.glb` 及 base64 文本、对照视频） | `viewer/assets/` | 约 37 MB | `scripts/blender/export_actions.py` + `base64`，见"查看结果"一节 |
| 即梦画布项目配置 | `jimeng_project.json` | 很小 | 从 `jimeng_project.example.json` 复制后自己填 |
| Python 虚拟环境 | `.venv/` | 约 870 MB | 自己建一个，装上面列的包 |

### 素材许可

文档里没有第三方素材的许可说明：怪物概念图、模型、视频是作者用即梦和 Tripo 生成的（孙悟空模型来自作者自己的另一个项目），相关原始文件都不在仓库里。用这些服务生成的内容，使用条款以各服务自己的规定为准。
