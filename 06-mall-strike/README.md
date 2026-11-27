# MALL STRIKE · 商场突袭

先用 Blender 做了一段 20 秒的“COD 风格”第一人称枪战短片：玩家在城市商场里依次击杀 4 名敌人再换弹，画面全部 Cycles 逐帧渲染，HUD 和音效用代码生成，AI 只用来通过 Tripo 生成 4 个模型并绑骨套动作。然后用同一个商场场景和素材做了一个浏览器里能玩的 FPS《商场突袭》：静态光照从 Cycles 烘焙成光照贴图，画面按短片的标准实时还原（three.js r187）。

| 子目录 | 是什么 |
| --- | --- |
| [`process/制作记录.md`](process/制作记录.md) | 制作记录：短片和游戏两部分的流程、踩过的坑、数字和素材来源，**先看这个** |
| [`game/`](game/README.md) | 游戏《商场突袭》：团队死斗，先拿 30 杀获胜；操作和画面做法见 `game/README.md` |
| `scripts/` | 全部脚本：搭商场（`build_mall.py`）、拼短片镜头（`build_shot.py`）、渲染、后期和 HUD（`composite.py`）、音效（`audio.py`），以及游戏资源的烘焙和导出（`game_*.py`） |
| `assets/` | 只留了素材的清单：`polyhaven/` 是 Poly Haven 全站素材目录的 API 缓存，`tripo/` 是 4 个 Tripo 模型的生成、绑骨、动作任务记录（含提示词） |

---

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的。商场场景、光照贴图、光照探针、角色和武器模型、贴图、音效、Blender 工程、逐帧渲染和成片都没放进来，**直接 clone 下来大多不能完整运行**：游戏缺 `game/assets/` 里的大文件和 `node_modules/` 打不开，短片管线缺 `.blend` 和素材也跑不起来。

### 怎么运行

**游戏（`game/`）**，先把下面“不在仓库里”的 `game/assets/` 补齐：

```bash
cd game
npm install                 # package.json 里是 three ^0.187.0 和 three-mesh-bvh ^0.9.18，index.html 从 ./node_modules 加载
python3 serve.py            # 默认端口 8765，然后浏览器打开 http://localhost:8765/
```

Mac 上也可以双击 `game/启动游戏.command`（端口被占用会自动顺延）。必须通过 `serve.py` 打开，直接双击 `index.html` 不行。推荐 Chrome，加载约 15–20 秒。地址后加 `?fps=1` 显示帧率、`?god=1` 无敌。

**短片和游戏资源管线（`scripts/`）**：

- Blender 脚本按 `Blender -b [某个 .blend] -P scripts/xxx.py -- 参数` 运行，每个脚本开头写了用法；作者用的是 Blender 5.2，Cycles 用 Metal GPU（`gpu_setup.py`）。
- 大致顺序：`ph_dl.py` 下 Poly Haven 素材 → `tripo.py` 生成角色和步枪 → `build_mall.py` 搭商场（出 `blend/mall.blend`）→ `build_shot.py` 拼镜头（出 `blend/shot.blend` 和 `renders/events.json`）→ `render_range.py` 渲帧 → `composite.py` 后期加 HUD、`audio.py` 生成音轨并编码成片。
- 游戏资源：`game_prep.py` → `game_bake.py` → `game_denoise.py`（`game_rebuild_assets.sh` 把降噪和导出串起来）→ `game_probes.py` → `game_export.py` / `game_chars.py` / `game_viewmodel.py` → `game_lut.py`；音效用 `python3 scripts/export_sfx.py`。详细说明在 `process/制作记录.md` 第二部分。
- Python 那部分（后期、音效）用到 numpy、scipy、OpenCV、Pillow，还要 ffmpeg。

### 需要自己配的外部服务

- **Tripo**（`scripts/tripo.py`，生成模型、自动绑骨、套动捕动作）：从环境变量 `TRIPO_KEY_FILE` 指向的文件里读 API key，key 不放在工程里。原来的提示词和参数在 `assets/tripo/<名字>/meta.json`、`gen_task.json` 里，可以照着重新生成（结果不会和原来完全一样）。
- **Poly Haven**（`scripts/ph_dl.py`）：公开 API，不需要 key。

### 哪些东西不在仓库里

合计约 2.2 GB。

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| Blender 工程 `mall.blend`、`shot.blend`、`game_prep.blend`、`game_baked.blend`（含 `.blend1` 备份） | `blend/` | 约 780 MB | 依次由 `build_mall.py`、`build_shot.py`、`game_prep.py`、`game_bake.py` 生成（前提是 `assets/` 里的素材都齐了） |
| Poly Haven 的贴图、道具模型、城市 HDRI `modern_buildings_2` | `assets/polyhaven/` | 约 500 MB（含下一行） | `python3 scripts/ph_dl.py tex（或 model、hdri） <id>[:分辨率] ...`。`assets/polyhaven/*.json` 是 Poly Haven 全站素材目录的缓存，具体用了哪些素材要看 `build_mall.py`、`lib.py` 里的引用 |
| Tripo 生成的 2 个敌人、玩家、步枪模型和动作 GLB | `assets/tripo/` | 同上 | `scripts/tripo.py gen / rig / anim`，任务记录在 `assets/tripo/*/`；原始模型文件在作者本机，未公开 |
| 短片逐帧渲染（EXR / JPG） | `renders/` | 约 240 MB | `render_range.py`（`renders/events.json` 由 `build_shot.py` 写出，`audio.py`、`composite.py` 都靠它对时间） |
| 成片：母版、分享版、无 HUD 纯净版，单独的音效轨 `音效轨_48k.wav` | `output/` | 约 240 MB | `composite.py` + `audio.py`；成片原文件在作者本机，未公开 |
| 光照烘焙的原始 EXR（降噪前） | `bake_raw_lm/` | 约 95 MB | `game_bake.py` 烘出，`game_rebuild_assets.sh` 会拷一份到这里再降噪 |
| 游戏场景 `mall.glb`、光照贴图 `lm/`、`materials.json` | `game/assets/` | 约 160 MB | `game_bake.py` + `game_denoise.py` + `game_export.py`（`game_rebuild_assets.sh`） |
| 光照探针 `probes.exr` | `game/assets/` | 约 10 MB | `game_probes.py`（`probes.json` 在仓库里） |
| 敌人 `enemy_a.glb`、`enemy_b.glb`，敌方低模步枪 `rifle_lod.glb` | `game/assets/` | 约 7 MB | `Blender -b -P scripts/game_chars.py -- <名字>`，名字是 `enemy_a`、`enemy_b` 或 `rifle` |
| 第一人称手臂和步枪 `viewmodel.glb` | `game/assets/` | 约 19 MB | `game_viewmodel.py`（`viewmodel.json` 在仓库里） |
| 天空 `sky.hdr`、贴图 `tex/` | `game/assets/` | 约 14 MB | `game_export.py`（`sky.hdr` 就是拷的 Poly Haven `modern_buildings_2_2k.hdr`） |
| 色彩 LUT 图 `lut_agx_mhc.png` | `game/assets/` | 不到 1 MB | `game_lut.py`（`lut_agx_mhc.json` 在仓库里） |
| 游戏音效 `sfx/*.wav` | `game/assets/sfx/` | 约 7 MB | `python3 scripts/export_sfx.py`（`manifest.json` 在仓库里） |
| npm 依赖 | `game/node_modules/` | 约 25 MB | `npm install` |
| 过程截图、对比图、流程图 | `process/` | 约 20 MB | 原始文件在作者本机，未公开 |
| 日志 | `logs/` | 约 30 MB | 跑脚本时自动生成，可以不要 |

### 素材许可

- **Poly Haven**：贴图、HDRI、道具模型都是 CC0，可以商用，不需要署名。
- **Tripo**：角色和步枪是作者用自己的 Tripo 账号生成的。按制作记录，绑骨和套动捕动作也都是通过 Tripo 的接口完成的，文档里说的“Mixamo 骨架”指骨骼的命名方式。
- 商场建筑、店铺名、HUD、音效都是原创。只是“COD 风格”，没有用《使命召唤》的商标、界面、角色、地图或音效。
