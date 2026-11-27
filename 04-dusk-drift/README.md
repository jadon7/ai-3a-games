# 暮色漂移 · Dusk Drift

先用 Blender Cycles 做了一段 7 秒的赛车漂移 CG 短片（黄昏、雨后半湿的赛道，BMW M3 E30 领着两台老赛车甩尾过右弯），再把同一套车、天空、路面和调色搬进浏览器，做成一个能开、能漂移的赛车游戏。另外把同样的两道题交给 Codex 做了一遍，留作对照。

| 子目录 | 是什么 |
| --- | --- |
| [`racing/`](racing/README.md) | 漂移短片的制作管线：Blender 5.2 + Python 脚本搭场景、算车辆运动、自写粒子烟雾（OpenVDB），ffmpeg 后期 |
| [`game/`](game/README.md) | 可玩版《暮色漂移》：three.js r187 + WebGPU，13 台车、1.5 公里 8 个弯的闭合赛道、AI 对手、自动驾驶和自动切镜（方便录屏） |
| [`codex_task/`](codex_task/game/README.md) | 对照组：`TASK.md`、`TASK_GAME.md` 是题目原文，`REPORT.md` 是 Codex 做的短片《Selva 47》的报告，`game/` 是 Codex 做的游戏版（three.js r170，WebGL） |

---

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的。车辆模型、贴图、HDRI 天空、Blender 工程、成片和截图都没放进来，**直接 clone 下来大多不能完整运行**：游戏缺 `assets/` 和 three.js 打不开，短片管线缺 `.blend` 和素材也跑不起来。

### 怎么运行

**游戏（`game/`）**，先把下面“不在仓库里”的 `game/assets/` 补齐，再放回 three.js：

```bash
cd game
# index.html 从 ./vendor/three/ 加载 three.js r187（build/three.webgpu.js、build/three.tsl.js、examples/jsm/）
npm install --no-save three@0.187.0
mkdir -p vendor/three
cp -R node_modules/three/build node_modules/three/examples node_modules/three/LICENSE vendor/three/
python3 serve.py 8320 --open      # 或者在 Finder 里双击 启动游戏.command
```

`serve.py` 是一个不缓存的本地静态服务器，默认端口 8317，被占用就顺延；`启动游戏.command` 用的是 8320 并自动打开浏览器。浏览器要支持 WebGPU（Chrome / Edge 113 以上，或 Safari 26 以上）。无画面的物理和自动驾驶测试可以直接跑：`node tools/sim_test.mjs`、`node tools/autopilot_test.mjs` 等（见 `game/README.md`）。

**Codex 对照版（`codex_task/game/`）**：`./启动游戏.command`（即 `python3 -IB serve.py`）会起本地服务器并打开 `/Applications/Google Chrome.app`；加 `--no-browser` 只起服务器。它同样缺 `assets/` 和 `vendor/`（three.js r170 的 `three.module.min.js` 以及 `GLTFLoader.js`、`RGBELoader.js`、`BufferGeometryUtils.js`，外加 Barlow 字体的 OFL 许可文本）。

**短片管线（`racing/`）**：

- 需要 Blender 5.2（作者用 5.2.2 LTS）和 ffmpeg。渲染、后期命令在 `racing/README.md` 的“重新渲染”一节。
- `racing/scripts/` 和 `game/tools/carprep.py` 的开头把 `ROOT` 写死成了作者本机的绝对路径，换台机器要先改成自己的目录。
- `01_base.py` 到 `10_finalize.py` 按编号看是搭场景的顺序（基础设置 → 赛道 → 材质 → 动画 → 灯光 → 烟雾 → 胎痕 → 布景 → 收尾），但文档里没有写一份从零重建 `race_scene.blend` 的完整步骤，中间也有在 Blender 里手动调整的部分。
- `racing/scripts/start_mcp.py` 在单独的 Blender 实例里打开 MCP for Blender 插件，并开启它的 Poly Haven、Sketchfab 功能，素材是通过它找和下载的。

### 哪些东西不在仓库里

合计约 2.2 GB。

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| 短片的 Blender 工程 `race_scene.blend` | `racing/scene/` | 约 540 MB | 用 `racing/scripts/01_*.py`–`10_finalize.py` 搭（前提是下面的贴图、HDRI、车模都齐了）；作者调好的那份原始文件在作者本机，未公开 |
| 新车和手臂的工作场景 `cars_work.blend`、`arms_rig.blend`、`arms_rig_fingers.blend`（含 `.blend1` 备份） | `racing/scene/` | 约 670 MB | 在 Blender 里手动整理的（`game/tools/carprep.py` 只负责自动分车轮、绑定），原始文件在作者本机，未公开 |
| 车辆模型（13 台）和驾驶位的手臂、方向盘 | 在上面几个 `.blend` 里 | — | 从 Sketchfab 下载，作者、模型名见 `game/README.md` 的素材表，Sketchfab 编号写在 `game/assets/cars/cars.json` |
| HDRI 天空 “Lilienstein”（8K EXR、1K HDR） | `racing/assets/hdri/` | 约 93 MB | Poly Haven，各分辨率的下载地址和 md5 在 `racing/assets/hdri/lilienstein_files.json` |
| 路面、草地、砾石、混凝土贴图 | `racing/assets/tex/` | 约 120 MB | Poly Haven 的 `asphalt_02`、`asphalt_pit_lane`、`asphalt_track`、`concrete_wall_008`、`gravel_floor_02`、`leafy_grass`、`painted_concrete`、`sparse_grass` |
| 短片成片 `drift_final.mp4`、`drift_final_share.mp4`、`drift_clean.mp4` | `racing/out/` | 约 90 MB | `render_frames.py` 渲帧（约 1.5 小时）+ `post.sh` 合成；烟雾缓存先用 `smoke_sim.py` 重新生成。原始逐帧和烟雾缓存作者已删；成片原文件在作者本机，未公开 |
| 游戏用的 13 台车 GLB 和选车预览图 | `game/assets/cars/` | 约 105 MB | `game/tools/export_cars.py`（从 `race_scene.blend` / `cars_work.blend` 导出）→ `glb_weld.py` 合并顶点 → `verify_cars.py` 核对并渲染预览图 |
| 游戏用的树（减面树、公告板、叶簇图集） | `game/assets/trees/` | 约 24 MB | `game/tools/export_trees.py`（从 `race_scene.blend` 里的 Poly Haven 树木导出）；`trees.json` 在仓库里 |
| 游戏用的天空 `sky_4k.hdr`、`sky_1k.hdr` | `game/assets/hdri/` | 约 34 MB | `game/tools/convert_hdri.py` 把 Lilienstein 8K EXR 转成 Radiance HDR |
| 游戏用的地面贴图 | `game/assets/tex/` | 约 48 MB | 文件名对应上面同一批 Poly Haven 贴图；游戏里用的分辨率版本怎么转的，文档里没写 |
| 驾驶位手臂 `arms.glb`、补装方向盘 `steering_wheel.glb` | `game/assets/driver/` | 约 1.4 MB | 来自 Sketchfab（见素材表），骨骼和握姿在 `arms_rig*.blend` 里做；导出没有脚本，原始文件在作者本机，未公开 |
| three.js r187 | `game/vendor/three/` | 约 17 MB | `npm install three@0.187.0`，见上面的运行步骤 |
| 调试截图 | `game/shots/` | 约 48 MB | `serve.py --shots` 时页面上传的截图，可以不要 |
| 试玩录像 `暮色漂移_试玩.mp4` 和几张对比图 | 项目根目录 | 约 33 MB | 原始文件在作者本机，未公开 |
| Codex 的短片工程 `Selva-47.blend`、成片 `final.mp4` | `codex_task/` | 约 220 MB | 原始文件在作者本机，未公开 |
| Codex 游戏版的模型、贴图、HDRI、字体和 three.js | `codex_task/game/assets/`、`vendor/` | 约 44 MB | 据它的 README，车模、路面和植被来自 `Selva-47.blend` 原工程，导出脚本不在仓库里，原始文件在作者本机，未公开；three.js 是 r170（`npm install three@0.170.0` 后从 `build/`、`examples/jsm/` 里取对应文件） |
| Codex 运行日志、截图 | `codex_task/` | 约 6 MB | 原始文件在作者本机，未公开 |

### 外部服务

这个项目的脚本里没有直接调用需要 key 的接口，仓库里也没有存任何 key。素材是通过 MCP for Blender 插件的 Poly Haven、Sketchfab 功能找和下载的（`racing/scripts/start_mcp.py`），想自己重下就用这个插件或直接去两个网站下载。

### 素材许可

- 13 台车、驾驶位手臂（“Fps arms”，bumstrum）和补装方向盘（“Steering Wheel (Racing)”，Cakeservant）都是 Sketchfab 上的 **CC BY 4.0** 模型，**公开使用时必须署名**，作者清单见 `game/README.md` 和 `racing/README.md`。
- HDRI、路面 / 草地 / 砾石 / 混凝土贴图、树木模型来自 Poly Haven，CC0。three.js 是 MIT。
- 车身涂装是模型自带的，其中 FINA、Alitalia、Hoonigan、Shell 是真实品牌；赛道广告牌的品牌全是虚构的。声音全部是程序合成的。
- Codex 版：车模作者 vecarz（CC BY 4.0），环境素材来自 Poly Haven（CC0），音效用的三段 Freesound 录音是 CC0，Barlow 字体是 OFL；短片里用到的 macOS 系统字体受 Apple 的系统许可约束。详见 `codex_task/REPORT.md` 和 `codex_task/game/README.md`。
