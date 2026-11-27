# 铁尘 IRON DUST

第三人称重型机甲战术动作游戏的 Godot 单关垂直切片：沙漠基地与轨道登陆战场、四台可换装机体的战术机架、驾驶舱视角、武器后摇与推进取消、程序化地形和战场单位。游戏设计与当前实现见 `game/GDD.md`，技术拆解见根目录下由本地项目一并带来的 `设计方案.md`（本次只收录源码与文档，不含 Blender 工程、模型、贴图及音频成品）。

| 项 | 内容 |
|---|---|
| 引擎 | Godot 4.7 stable，Forward+ / D3D12 / Jolt Physics |
| 平台 | Windows PC |
| 主要代码 | `game/scripts/`（GDScript）、`game/shaders/`（Godot shader）、`game/tools/blender/`（Python 建模管线） |
| 怎么跑 | 用 Godot 4.7 打开 `game/project.godot`，主场景是 `res://main.tscn`；游戏启动时用脚本生成或加载模型与贴图，缺失素材不会自动下载 |

## 目录

- `game/scripts/`：机体、驾驶舱、HUD、任务、武器、载具、世界与程序化几何
- `game/shaders/`：装甲、地形、天空、驾驶舱与后期效果
- `game/tools/blender/`：用 Blender Python 生成机体、装备、舰船和驾驶舱 GLB 的脚本
- `game/tools/audio/`：音频母带与时长检查脚本
- `game/audio/README.md`、`game/audio/CREDITS.md`、`game/textures/CREDITS.md`：素材投放要求及来源
- `game/GDD.md`、`设计方案.md`：设计文档与技术方案

## 关于这份拷贝（总仓库说明）

这份目录只保留源码、文档和小配置，与仓库其他项目一致，不含运行所需素材。原始项目约 1.1 GB，其中模型约 48 MB、贴图约 14 MB、音频及母带约 4.8 MB；此外还有 Godot 缓存、编辑器插件和本机自动测试产物。**直接 clone 下来不能完整运行**。

### 怎么运行

- **Godot**：项目配置要求 4.7、Forward+；Windows 下用 D3D12，物理引擎为 Jolt。用编辑器打开 `game/project.godot` 或执行 `godot --path game`。
- **Blender 管线**：`tools/blender/` 下的脚本在 Blender 5.2 一类版本中以 `-b --factory-startup -P <脚本>` 运行，生成 `.glb` 后放进 `game/models/`。仓库里的启动脚本含有原作者机器上的 Blender 路径，请按本机路径修改后再用；这些路径没有写死在核心 Python 建模脚本里。
- **贴图**：`tools/fetch_textures.py` 与 `textures/CREDITS.md` 记录 Poly Haven CC0 素材的下载方式；下载后按脚本要求放进 `game/textures/`。
- **音频**：`audio/README.md` 说明按 id 投放 `.ogg` 的方法，`tools/audio/master.py` 做母带处理，`CREDITS.md` 逐文件列来源。找不到音频时 `scripts/sfx.gd` 会回落到程序化合成。
- **开发插件**：原项目 `project.godot` 里带 `godot-ai` 自动加载与编辑器插件；本次拷贝不含 `addons/`，发行或独立运行前应从项目配置中删掉这两项。仓库保留原配置以便对照。

### 哪些东西不在仓库里

| 内容 | 原目录 | 怎么处理 |
| --- | --- | --- |
| `.glb` 模型、`.blend` 工程 | `models/`、`tools/blender/out/` | 用 `tools/blender/` 里的脚本生成，或从原作者本机导出 |
| PBR 贴图、预览图 | `textures/`、`tools/blender/preview/` | 按 `textures/CREDITS.md` 从 Poly Haven 下载；预览图由建模脚本渲染 |
| `.ogg` 音频及母带源文件 | `audio/`、`tools/audio/src/` | 按 `audio/CREDITS.md` 取得 CC0 原始素材，再运行 `tools/audio/master.py` |
| Godot 缓存、`.import`、`.uid`、`addons/` | 项目根及子目录 | Godot 打开项目时重建；编辑器插件不属于游戏本体 |
| 本机自动测试脚本、截图、日志 | `tools/test_*`、`_shots/` | 本次按提交要求排除，不进 PR |

### 素材许可

贴图和音频来源文档均标注为 CC0 1.0 或公有领域；音频另有本地 DSP 合成内容。机体、载具、武器和界面为项目原创，设计文档明确不复刻任何受版权保护的高达机体外形、名称与标志。第三方素材本身不随本次 PR 上传；使用前仍以 `game/audio/CREDITS.md`、`game/textures/CREDITS.md` 和各服务条款为准。
