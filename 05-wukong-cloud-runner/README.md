# 筋斗云 · 悟空驾云

孙悟空踩着筋斗云在云海和石峰林之间穿行。先用 Blender 做了两版 CG 短片：第一版是二次元风（EEVEE，Q 版悟空、仙鹤、山水），第二版是写实风（Cycles，AI 生成并绑骨的悟空、真毛发、布料披风、体积云海）。然后把写实版的角色、石峰、天空和调色搬进浏览器，做成实时的《筋斗云驾驶模拟器》（three.js r170，WebGL）。

| 子目录 | 是什么 |
| --- | --- |
| `assets/char/` | 角色：写实悟空的搭建（`build_wukong_real.py`）、披风布料解算（`build_cape_real.py`）、金箍棒 / 毛发 / 材质部件库，Q 版悟空和仙鹤，以及 Tripo、TRELLIS.2、Hunyuan3D 的图转 3D 脚本 |
| `assets/clouds/` | 云海、大气雾、筋斗云和它身后的水汽尾迹（二次元版和写实版各一套） |
| `assets/env/` | 石峰山水环境的生成脚本（二次元版、写实版），Poly Haven 下载脚本，自检渲染 |
| `assets/fx/` | 二次元版的特效库 |
| `common/` | 全项目共用的坐标、太阳方向、天空、渲染设置；`start_mcp.py` 在单独的 Blender 实例里开 MCP 服务 |
| `audio/` | 两版短片的配乐和音效，全部用 numpy / scipy 代码合成 |
| `post/`、`post_real/` | 第一版的后期（速度模糊、泛光、色散）和写实版的合成调色、拼成片 |
| `tests/` | 各种自检和调试脚本（天空标定、毛发、披风、闪烁检查等） |
| [`game/`](game/说明.md) | 游戏《筋斗云驾驶模拟器》：驾云飞行、穿金环、翻筋斗、自动巡航、拍照模式，操作说明见 `game/说明.md` |

---

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的。角色和石峰模型、贴图、VDB 体积云、Blender 工程、逐帧渲染、成片和音频都没放进来，**直接 clone 下来大多不能完整运行**：游戏缺 `game/assets/` 里的模型贴图和 three.js 打不开，短片管线缺 `.blend`、素材和镜头脚本也跑不起来。

### 怎么运行

**游戏（`game/`）**，先把下面“不在仓库里”的 `game/assets/` 补齐，再放回 three.js：

```bash
cd game
npm install                       # package.json 里是 three ^0.170.0 和 puppeteer-core（截图、录屏工具用）
# index.html 从 ./vendor/three/ 加载 three.js r170：build/three.module.js 和 jsm/
mkdir -p vendor/three
cp -R node_modules/three/build vendor/three/
cp -R node_modules/three/examples/jsm vendor/three/jsm
node tools/serve.mjs --open       # 默认端口 8765；或者在 Finder 里双击 启动游戏.command
```

没有 Node.js 时，`启动游戏.command` 会改用 `python3 -m http.server 8765`。推荐 Chrome。`npm run shot`（`tools/shot.mjs`）和 `tools/record.mjs` 是无头 Chrome 截图 / 逐帧录屏工具，`game/test_*.html` 是各模块的单独测试页。

**短片管线**：

- 需要 Blender（脚本按 `Blender -b -P 脚本.py -- 参数` 运行，每个脚本开头的注释写了用法；文档里没写 Blender 版本要求）、ffmpeg，以及装了 numpy、scipy、opencv-python 的 Python（`audio/`、`post/`、`post_real/` 用）。体积云脚本用 Blender 自带的 `openvdb` 模块。
- **镜头搭建脚本不在这份拷贝里**：原项目的 `shots/`（第一版）和 `shots_real/`（写实版，含渲染队列脚本）没有拷进来，原始文件在作者本机，未公开。所以只靠本仓库没法从头渲出成片。

### 需要自己配的外部服务

- **Tripo**（`assets/char/tripo_api.py`，图转 3D、自动绑骨）：从环境变量 `TRIPO_KEY_FILE` 指向的文件里读 API key，key 不放在工程里。
- **Hugging Face 上的开源图转 3D**（`trellis2_gen.py`、`hunyuan_gen.py`、`gen_alt.py`，备用通道）：用 `gradio_client` 调公开的 Space（TRELLIS.2、Hunyuan3D-2.1 等）。
- **Poly Haven**（`assets/env/ph_download.py`）：公开 API，不需要 key。

### 哪些东西不在仓库里

合计约 6 GB。

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| 写实悟空：Tripo 生成并绑骨的 `wukong_real_rig.glb`，以及 `wk_real_raw.blend`、`wukong_real.blend`、`wukong_real_final.blend` | `assets/char/` | 约 300 MB | glb 是用 Tripo 生成、自动绑骨的（`tripo_api.py`）；`wukong_real.blend`、`wukong_real_final.blend` 依次由 `build_wukong_real.py`、`build_cape_real.py` 生成；`wk_real_raw.blend` 是中间文件（`import_glb.py` 负责把生成的 glb 导入、统一尺度朝向后存成 .blend） |
| 披风布料缓存 `cape_real.abc` | `assets/char/` | 约 50 MB | `build_cape_real.py` |
| 悟空定妆图、背面图 | `assets/char/ref/` | 约 14 MB | 文档里没写是用什么出的图，原始文件在作者本机，未公开 |
| Q 版悟空 `chibi.blend` | `assets/char/` | 不到 1 MB | `build_chibi.py` |
| 云海和筋斗云：`clouds.blend`、`clouds_real.blend`、VDB 体积 `vdb_real/`、尾迹缓存 `trail_cache/` | `assets/clouds/` | 约 570 MB | `build_clouds.py`（二次元版）、`build_clouds_real.py -- sea mist jdy blend`（写实版）、`trail_lib.py` |
| 山水环境 `env.blend`、`env_real.blend` | `assets/env/` | 约 410 MB | `build_env.py` / `build_env_realistic.py`、`build_env_real.py` |
| Poly Haven 扫描松树 `pine_tree_01`、`island_tree_02` | `assets/env/ph/` | 约 660 MB | `python3 assets/env/ph_download.py model pine_tree_01 1k`（`island_tree_02` 同理） |
| 黄山松模型 `pine_var_a/b.glb`、`pine_welcome.glb` 和参考图 | `assets/env/tripo/` | 约 80 MB | 用 Tripo 生成的，原始文件在作者本机，未公开 |
| 岩石、草地、树皮贴图（`marble_cliff_04`、`marble_cliff_05`、`aerial_grass_rock`、`aerial_rocks_02`、`pine_bark`、`rock_face_03` 等） | `assets/tex/` | 约 63 MB | Poly Haven，`python3 assets/env/ph_download.py tex <id> <分辨率>` |
| 写实版逐帧渲染和合成帧（镜头 A–F） | `renders_real/` | 约 2.3 GB | 镜头脚本 `shots_real/` 渲染（不在仓库里），`post_real/comp.py` 合成调色，`post_real/assemble.py` 拼成片 |
| 成片：`wukong_1080p.mp4`、`wukong_4k.mp4`、竖版 `wukong_vertical_1080x1920.mp4`，写实版 `out/v2/*.mp4`，游戏实机演示 `out/game/*.mp4` | `out/` | 约 610 MB | 第一版 `post/assemble.py`、写实版 `post_real/assemble.py`、实机演示 `game/tools/record.mjs` + `mix_demo_audio.py`。成片原文件在作者本机，未公开 |
| 短片音轨 `mix.wav`、`mix_real.wav` 等 | `audio/` | 约 14 MB | `python audio/make_audio.py <out.wav>`、`audio/make_audio_real.py` |
| 测试渲染图、日志 | `tests/` | 约 97 MB | `tests/` 里对应的脚本 |
| 游戏角色 `wukong.glb` 和身体贴图 | `game/assets/char/` | 约 28 MB | `Blender -b -P game/tools/export_char.py`（从 `wukong_real_final.blend` 导出） |
| 游戏角色的待机动作 `anims/wukong_anims.glb` | `game/assets/char/anims/` | 不到 1 MB | video2rig 管线：即梦 Seedance 2.5 出 5 秒样片 → 角色专用关节检测器 → 解算成骨骼动作（见 [`../09-video2rig/`](../09-video2rig/README.md)，里面有 `wukong_motion.py`、`wukong_retarget.py`）；`manifest.json` 在仓库里 |
| 游戏的石峰、树、岩石贴图、天空 | `game/assets/world/`、`game/assets/sky/` | 约 30 MB | `Blender -b -P game/tools/export_world.py -- [rocks] [trees] [sky] [tex]`（依赖上面的 `build_env_real.py`、`assets/env/ph`、`assets/env/tripo`、`assets/tex`）；`world.json`、`sky.json` 在仓库里 |
| 游戏音效 | `game/assets/audio/` | 约 17 MB | `python tools/make_game_audio.py`（在 `game/` 下运行）；`manifest.json` 在仓库里 |
| three.js r170 | `game/vendor/three/` | 约 15 MB | `npm install` 后从 `node_modules/three` 拷，见上面的运行步骤 |
| npm 依赖 | `game/node_modules/` | 约 76 MB | `npm install` |
| 截图、录屏 | `game/shots/` | 约 420 MB | `tools/shot.mjs`、`tools/record.mjs` |

### 素材许可

- Poly Haven 的松树、贴图都是 CC0。
- 悟空和黄山松是用 Tripo 生成的；悟空的待机动作来自即梦 Seedance 生成的视频。这些生成内容的使用条款以 Tripo、即梦各自的服务条款为准，文档里没有另外写。
- 配乐和音效（短片和游戏）全部是代码合成的，脚本里写明不使用任何现成素材或音乐。
