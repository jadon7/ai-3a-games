# BODY CAM · 清剿

一个"随身记录仪视角"的枪战项目，分两部分：先用 Blender 脚本做了一条 CG 枪战短片（照片扫描的废弃厂房、第一人称持枪手臂、动捕敌人，后期做成鱼眼、自动曝光、卷帘快门、压缩感的记录仪画面），再把同一套场景、手臂、敌人和后期参数搬进浏览器，做成能玩的 three.js 第一人称射击游戏（已经迭代到第六版：三层小楼 + 池核泳池场景、手枪和步枪、会找掩体的敌人）。

各目录：

- `game/`：可玩版（three.js + WebGL2）。玩法、操作、场地图、调试用的网址参数都写在 [`game/README.md`](game/README.md)。
- `scripts/`：短片和游戏共用的管线脚本。Blender 端的（`shot_build.py` 组装镜头、`enemy_build.py` 搭敌人、`level_build.py` 扩建关卡、`render_range.py` 渲染、`game_enemy.py` / `game_bake.py` 给游戏导出动画和光照贴图）用 `blender -b ... -P` 无界面运行；其余（`post.py` 后期、`audio.py` / `game_sfx.py` 合成音效、`game_assets.py` 整理游戏资源、`sf.py` 搜索下载 Sketchfab 模型、各种拼图对比脚本）用 Python 跑。
- `ref_cod_scripts/`：作者之前一个商场枪战（COD 风格）项目里的脚本，留作参考，本项目的部分音效和敌人动捕就沿用自那个项目。
- `assets/`：这里只留了各个下载素材的署名文件（`license.txt`、`_credit.json`）和敌人动画分段表 `_enemy_export/clips.json`，模型本身不在仓库里（见下文）。

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的。模型、贴图、音频、渲染帧、成片、Blender 工程都没放进来，**直接 clone 下来不能完整运行**：游戏缺资源打不开，短片管线缺 `.blend` 和素材也跑不起来。

### 怎么运行

**游戏**（需要先把下面"不在仓库里"的 `game/assets/` 和 `game/node_modules/` 补齐）：

```bash
cd game
# index.html 从 ./node_modules 加载 three 和 three-mesh-bvh（作者本机用的版本如下；仓库里没有 package.json）
npm install three@0.187.0 three-mesh-bvh@0.9.18
python3 serve.py 8770        # 然后浏览器打开 http://localhost:8770/
```

Mac 上也可以双击 `game/启动游戏.command`。必须通过 `serve.py` 这个小服务器打开，直接双击 `index.html` 不行。浏览器要支持 WebGL2，建议 Chrome / Edge。

**短片管线**：

- Python 脚本用项目根目录下的 `.venv/bin/python` 运行（作者本机是用 uv 建的 Python 3.12 虚拟环境，没有 requirements 文件；里面装的是 numpy、scipy、Pillow、opencv-python、OpenEXR、requests）。
- Blender 脚本的写法统一是 `blender -b [某个 .blend] -P scripts/xxx.py -- 参数`，每个脚本文件开头的注释里写了具体用法。文档里没有写 Blender 的版本要求。
- 编码成片要 `ffmpeg` / `ffprobe`（见 `scripts/finalize.sh`）。
- 正式渲染时作者是本机和一台远程 4090 Windows 机器两头并行渲的（`scripts/sync_frames.py`、`scripts/finalize.sh` 里通过 ssh/scp 同步帧，主机别名是作者自己 `~/.ssh/config` 里配的）。别人用的话只在本机渲染即可，需要把这两个脚本里的远程部分去掉或换成自己的机器。

### 需要自己填的配置

- `scripts/sf.py`（Sketchfab 搜索 / 下载）读取 `scripts/keys.json`。仓库里只有 `scripts/keys.example.json`：复制一份改名为 `keys.json`，填上自己的 Sketchfab API token（`tripo` 那一项是 Tripo 的 API key，`scripts/` 下的脚本目前用不到）。`keys.json` 不要提交。
- `ref_cod_scripts/tripo.py`（Tripo 生成 / 绑骨 / 动捕）从环境变量 `TRIPO_KEY_FILE` 指向的文件里读 Tripo API key。

### 哪些东西不在仓库里

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| Blender 工程（`shot.blend`、`enemy.blend`、`level.blend`、打包版 `day_packed` / `dusk_packed` 及 `.blend1` 备份） | `blend/` | 约 3.1 GB | `scripts/shot_build.py`、`scripts/enemy_build.py`、`scripts/level_build.py -- build` 重新生成（前提是 `assets/` 里的素材都齐了） |
| 下载的模型（手臂和枪、敌人、场景扫描） | `assets/<名字>/` | 约 1.2 GB（含下面几项） | 从 Sketchfab 下载，每个子目录的 `license.txt` / `_credit.json` 里有原始链接；也可以用 `scripts/sf.py download <uid> <名字>` 下到 `assets/<名字>/` |
| 门外全景 HDRI `abandoned_slipway_4k.hdr` | `assets/hdri/` | 约 25 MB | Poly Haven 的 "Abandoned Slipway"（CC0） |
| 敌人的 Tripo 动捕动作（`cod_enemy_a`、`cod_enemy_b`） | `assets/` | 约 330 MB | 来自作者之前 COD 项目里用 Tripo 生成的文件，原始文件在作者本机，未公开。`ref_cod_scripts/tripo.py` 是当时调用 Tripo 的脚本 |
| 沿用的旧音效（`cod_sfx`） | `assets/cod_sfx/` | 约 7 MB | 之前 COD 项目里代码合成的音效，原始文件在作者本机，未公开（合成脚本 `ref_cod_scripts/audio.py`、`export_sfx.py` 在仓库里） |
| 特效贴图、其它贴图 | `assets/fx/`、`assets/tex/` | 约 12 MB | 特效贴图用 `scripts/gen_fx_textures.py` 程序化生成；`tex/` 的来源文档里没写、`scripts/` 里也没有引用到，原始文件在作者本机，未公开 |
| 敌人导出的 glTF | `assets/_enemy_export/` | 约 75 MB | `blender -b blend/shot.blend -P scripts/game_enemy.py`（分段表 `clips.json` 在仓库里） |
| 游戏资源：扫描房间、关卡网格和光照贴图、敌人、手臂和枪、HDRI、特效、音效 | `game/assets/` | 约 160 MB | `scripts/game_assets.py room / hdri / fx / vm / gltf`（从 `assets/` 整理过来）、`scripts/level_build.py -- export`、`scripts/game_bake.py`、`scripts/game_enemy.py`、`scripts/game_sfx.py`、`scripts/game_sfx_pool.py`；`demo_track.json`、`level.json`、`enemy/clips.json` 在仓库里 |
| three.js 依赖 | `game/node_modules/` | 约 30 MB | `npm install three@0.187.0 three-mesh-bvh@0.9.18` |
| 逐帧渲染（线性 EXR、预览 JPG/PNG） | `renders/` | 约 1.3 GB | `scripts/render_range.py`（可断点续渲）、`scripts/render_prev.py` |
| 成片、实机录像、对比图、音轨、素材署名 | `out/` | 约 1.4 GB | `scripts/finalize.sh`（后期 `post.py` + 音轨 `audio.py` + ffmpeg 编码）、`scripts/game_rec.py`、`scripts/cmp.py` 等。成片原文件在作者本机，未公开 |
| 缩略图 | `thumbs/` | 约 4 MB | `scripts/sf.py search` 生成的搜索结果拼图 |
| Python 虚拟环境 | `.venv/` | 约 180 MB | 自己建一个，装上面列的几个包 |

### 素材许可

用到的第三方素材和授权写在作者本机的 `out/素材署名.txt` 里（`game/README.md` 末尾也有一段），这里摘要：

- 敌人角色 "FSB Operator"，作者 jeandiz，CC BY 4.0（片中去掉了模型上的徽章贴片）
- 手臂和手枪 "G17 Pistol - Animated"、步枪 "M4A1 Assault Rifle - Animated"，作者 user77，CC BY-SA 4.0（作者注明手臂和动画来自 DJMaesen 的 "FPS Animated Carbine"）
- 废弃厂房、两间小房间的照片扫描，作者 archiwum_xyz，Sketchfab 标准免费授权
- 门外全景 HDRI "Abandoned Slipway"，Poly Haven，CC0
- 敌人动捕：Tripo 预设动作；音效全部代码合成；池核场景全部代码生成

`assets/` 下还有几个下载过、但署名清单里没列的候选素材（`arms_ccransh_pistol`、`arms_fn502`，作者 ccransh，CC BY；`env_gasstation`，作者 Dystopia，CC BY），各自的 `license.txt` 里有出处。公开使用时请按各自的协议保留署名。
