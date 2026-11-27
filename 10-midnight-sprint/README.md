# 午夜冲刺 MIDNIGHT SPRINT — 原创夜景街头赛车 CG 短片

全片 42.4 秒，1920×1080，30 fps。场景、动画、涂鸦特效、HUD、音频全部由脚本生成，可以整条流程重跑。
这是一部原创短片：赛道、车队、涂鸦字、HUD、标题都是自己设计的，没有使用任何现成游戏的名称、标志或界面。

## 片子里有什么
- 片头：两台车并排起步、涂鸦标题、3-2-1 倒计时
- 三段氮气加速（约第 10 秒、18 秒、34 秒）：黄 / 粉 / 白的手绘火焰带、点火爆裂圈、「冲! 飙! 燃!」贴纸字、放射速度线、镜头拉远加径向模糊
- 两段漂移（直角弯约第 16–18 秒，大弯约第 24–27 秒）：车身横摆 20–30°、卡通烟团、粉白轮迹、星星、「漂!」贴纸字、漂移计分
- 擦身而过的闪电、超车的「超!」、冲线彩带、片尾「赢!」和成绩条

## 目录
- `out/midnight_sprint_1080p.mp4` 成片母版（高码率，约 519 MB）；`out/midnight_sprint_1080p_share.mp4` 分享版（约 92 MB）
- `out/audio.wav` 及分轨（引擎 / 配乐 / 提示音，全部代码合成）
- `out/telemetry.json` 每帧的速度、转速、名次、相机矩阵、事件（涂鸦层、HUD、音频都由它驱动）
- `blend/city.blend` 城市场景；`blend/race.blend` 带动画的最终场景；`blend/cars/` 整理好的车辆
- `renders/final_exr_v5/` 渲出的线性 EXR（alpha 通道存的是雾深度；大部分来自 4090，片尾约 90 帧是本机渲的）；`renders/final_png_v5/` 调色并叠好特效和 HUD 的成片帧
- `scripts/` 全部脚本
- `assets/` 下载的素材（各自带 CREDIT.txt）、生成的招牌贴图、`assets/refs/` 对照用的参考图（只用来校准亮度和色彩统计）

## 重跑顺序
1. `prep_car.py -- <车名>` 整理车辆（朝向、尺寸、车轮、材质）
2. `gen_signs.py` 生成霓虹招牌贴图
3. `build_city.py` 生成城市 → `blend/city.blend`
4. `shots.py` 生成比赛动画、相机、灯光 → `blend/race.blend` + `out/telemetry.json`（会自检碰撞）
5. `render_frames.py` 逐帧渲染 EXR：`blender -b blend/race.blend -P scripts/render_frames.py -- <输出目录> 128 100 "1-1272"`（本机或 4090，可续渲）
6. `make_audio.py` 合成音频
7. `final_build.sh` 从 4090 增量拉帧 → `finish.py`（调色 `post.py` + 涂鸦层 `gfx.py` + HUD `hud.py`）→ 帧齐了自动编码成片

辅助脚本：`imgstats.py`（画面亮度 / 饱和度统计，用来和参考图对数）、`debug_wheels.py`（检查所有车的车轮是否贴地）、`follow.sh`（跟着渲染进度增量合成）、`render_local.py`（本机从片尾往前渲，和 4090 在中间会合）。

## 画面是怎么校准的
- 灯光按参考图的统计量来调：平均亮度 28–59、亮部（>180）占比 2–6%、色彩丰富度 43–55。
- 湿沥青路面带积水反射；路灯钠黄为主、桥上冷白；只有很亮的灯头和车灯才有大光晕。
- 行道树用灯光链接排除了路灯直射（否则紧挨灯头的树冠会过曝成灰白色），只受环境光和反弹光，呈暗色剪影。
- 调色最后一步在感知空间里做锐化和局部对比，暗部不加。
- 涂鸦层是独立的 2D 手绘层：元素锚定在三维世界坐标，用每帧导出的相机矩阵投影到画面上，所以会跟着车和路走；墨线描边、平涂、网点、错位投影色、一拍三的抖动。

## 素材来源
- 车辆（Sketchfab，CC 署名，均为原创 / 虚构车型）：Tokii Abyss GT.7 (fiendishfarlander76)、Patriot P10-XR (Swiss_Fox)、Generic Coupe "Azura" (mk2design)、Fictional supercar V12 Goblin (ollitei)、Generic passenger car pack (comrade1280)
- 贴图和道具：Poly Haven（HDRI、沥青、混凝土、街道道具，CC0）、ambientCG（Facade 系列建筑立面，CC0）
- 字体：Barlow Condensed、Bebas Neue、Monoton、站酷庆科黄油体、站酷快乐体、马善政（均为 OFL 开源字体）

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的：`scripts/` 全部脚本、招牌清单 `assets/signs/manifest.json`、各下载素材的 `CREDIT.txt`。上面"目录"一节列的成片、音频、`telemetry.json`、`.blend`、渲染帧和素材本身都不在仓库里，**直接 clone 下来不能完整运行**，要先把素材下齐、再按"重跑顺序"从头生成。

### 怎么运行

- **Blender 脚本**：按各脚本开头注释的写法跑，例如 `blender -b --factory-startup -P scripts/build_city.py`、`blender -b --factory-startup -P scripts/prep_car.py -- <车名>`，渲染用 `blender -b blend/race.blend -P scripts/render_frames.py -- <输出目录> 128 100 "1-1272"`。文档里没有写 Blender 的版本要求。
- **Python 脚本**（后期、涂鸦层、HUD、招牌、音频）：项目里没有虚拟环境，作者用 `uv run --with ...` 临时装依赖，各脚本开头写了要哪些包，例如：
  - `uv run --with pillow --with numpy python gen_signs.py`
  - `uv run --with numpy --with scipy python make_audio.py`
  - `uv run --with opencv-python-headless --with openexr --with numpy --with pillow --with skia-python python finish.py <exr_dir> <out_dir>`（涂鸦层 `gfx.py` 要 `skia-python`，`final_build.sh` 里就是这么调的）
- **编码成片**要 `ffmpeg`（`scripts/assemble.sh`）。
- **远程 4090**：`final_build.sh`、`pull_frames.sh`、`follow.sh`、`render_local.py` 是作者本机和一台远程 4090 Windows 机器两头并行渲染、增量拉帧用的，ssh 主机别名只配在作者自己的电脑上。别人用的话只在本机跑 `render_frames.py`，再用 `finish.py` + `assemble.sh` 合成编码即可。

### 需要自己填的配置

- `scripts/skfb.py`（Sketchfab 搜索 / 下载）从项目根目录的 `keys.env` 里读 `SKFB_KEY=` 这一行。仓库里没有这个文件：在项目根目录自己新建 `keys.env`，写一行 `SKFB_KEY=<你的 Sketchfab API token>`。`keys.env` 不要提交。
- Poly Haven 下载（`scripts/phaven.py`）不需要 key。

### 哪些东西不在仓库里

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| 下载的车辆和街道道具（`model.glb`） | `assets/dl/` | 约 90 MB | Sketchfab，每个子目录的 `CREDIT.txt` 里有原始链接；可以用 `scripts/skfb.py get <uid> <输出目录>` 下载 |
| Poly Haven 的 HDRI 和路面 / 墙面贴图（`shanghai_bund`、`asphalt_track`、`clean_asphalt`、`concrete_slab_wall_02`、`concrete_tiles_02`） | `assets/ph/` | 约 70 MB | `scripts/phaven.py hdri <id> <分辨率>` / `scripts/phaven.py tex <id> <分辨率>` |
| ambientCG 建筑立面贴图（Facade002–010 等，2K JPG） | `assets/acg/` | 约 320 MB | 从 ambientCG 下载 Facade 系列，放到 `assets/acg/<FacadeXXX>/`（`mats.py` 按 `<id>_2K-JPG_<通道>.jpg` 找文件）；仓库里没有下载脚本 |
| 字体（Barlow Condensed、Bebas Neue、Monoton、站酷庆科黄油体、站酷快乐体、马善政） | `assets/fonts/` | 约 16 MB | 都是 OFL 开源字体，自己下载后放到 `assets/fonts/`，文件名要和脚本里一致（如 `BarlowCondensed-ExtraBoldItalic.ttf`、`ZCOOLKuaiLe-Regular.ttf`） |
| 霓虹招牌贴图 | `assets/signs/*.png` | 约 8 MB | `gen_signs.py` 生成（`manifest.json` 在仓库里） |
| 对照用参考图、预览图、搜索缩略图 | `assets/refs/`、`assets/preview/`、`assets/thumbs/` | 约 11 MB | 原始文件在作者本机，未公开（只用来校准亮度和色彩统计，不进成片） |
| Blender 工程（`city.blend`、`race.blend`、`cars/` 及各版本备份） | `blend/` | 约 2.4 GB | `prep_car.py` → `build_city.py` → `shots.py`，见"重跑顺序" |
| 渲染帧（线性 EXR、成片 PNG、各轮测试） | `renders/` | 约 9 GB | `render_frames.py` 渲染，`finish.py` 合成 |
| 成片、预览片、音频及分轨、`telemetry.json` | `out/` | 约 1.4 GB | `shots.py` 出 `telemetry.json`，`make_audio.py` 出音频，`assemble.sh` / `final_build.sh` 编码成片。成片原文件在作者本机，未公开 |
| Sketchfab key | `keys.env` | 很小 | 自己新建，见上文 |

### 素材许可

"素材来源"一节已列出主要素材的作者和协议。补充两点：各下载素材的 `CREDIT.txt` 里，街道道具 "City Props Collection volume 1"（TampaJoey）是 Sketchfab 标准免费授权、路灯 "Street Lamp"（bez_glaza）是 CC BY，**红绿灯 "Traffic Light"（longtail）是 CC BY-NC，不能商用**；CC BY 的车辆和道具公开使用时请保留署名。音频全部代码合成，没有用现成素材。
