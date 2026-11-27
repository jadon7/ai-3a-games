# 盲潮 Blind Tide

声音驱动的 Godot 恐怖游戏垂直切片：玩家靠声呐脉冲「看见」空间，用脚步与道具声引开潮听者，在 40×21 格的遗迹里完成开井与固守信标的单关流程。设计文档 `game/GDD.md` 按当前代码逐项写了机制、数值、声能经济与关卡流程。

| 项 | 内容 |
|---|---|
| 引擎 | Godot 4.7 stable，Forward+，纯 GDScript |
| 平台 | Windows PC；原项目附启动脚本 |
| 主要代码 | `game/blind-tide-godot/scripts/`、`game/blind-tide-godot/shaders/`、`game/art_src/listener.py` |
| 怎么跑 | Godot 4.7 打开 `game/blind-tide-godot/project.godot`；Windows 下可将 Godot 可执行文件放进 `game/godot/` 后运行 `game/play.bat` |

## 目录

- `game/blind-tide-godot/scripts/`：主循环、声呐射线、怪物、HUD、开场、程序化几何与合成音效
- `game/blind-tide-godot/shaders/`：血水、雨滴、点云、遮挡与后期效果
- `game/art_src/listener.py`：用 Blender Python 程序化生成潮听者与四种姿态
- `game/GDD.md`：单关设计、数值表和当前限制
- `game/play.bat`：Windows 启动脚本

## 关于这份拷贝（总仓库说明）

这份目录只保留源码、文档和小配置。原项目约 224 MB，其中四个 `.blend` 源文件约 10 MB、Godot 缓存与导入网格约 14 MB、随附 Godot 可执行程序约 200 MB；这些都不在仓库里。**直接 clone 下来不能完整运行**，需要先生成潮听者点云所需的模型。

### 怎么运行

- **Godot**：用 4.7 stable 打开 `game/blind-tide-godot/project.godot`，主场景为 `res://main.tscn`。`play.bat` 期望可执行文件在 `game/godot/Godot_v4.7-stable_win64.exe`，请自行放置。
- **怪物模型**：`art_src/listener.py` 在 Blender 无界面模式下生成 `listener.obj` 及 `listener_drift.obj`、`listener_sus.obj`、`listener_hunt.obj`；Godot 启动时从这些模型表面采样约 16 000 个点作为声呐画面。GDD 第 1309 行附近写了替换流程。
- **音效**：全部由 `scripts/sfx.gd` 在启动时合成，没有外部音频文件。
- **开发插件**：本次拷贝不含 `addons/`，`project.godot` 已移除原作者开发用的 `godot-ai` 自动加载与编辑器插件引用；`GDD.md` 第 1208 行附近记录了原项目里这一项。

### 哪些东西不在仓库里

| 内容 | 原目录 | 怎么处理 |
| --- | --- | --- |
| 四个 `.blend` 怪物源文件 | `game/art_src/` | 用 `listener.py` 重新生成，或在原作者本机打开编辑 |
| 从模型导出的 `.obj` | `game/blind-tide-godot/` 导入路径 | `listener.py` 生成后按 GDD 说明放回项目 |
| Godot 缓存、导入网格、编辑器插件 | `.godot/`、`addons/` | 打开项目时重建；插件不属于游戏本体 |
| 随附 Godot 可执行文件 | `game/godot/` | 自行下载 4.7 stable |

### 素材许可

场景、怪物、音效与界面均由项目代码或 Blender 脚本生成，文档没有列出第三方素材。本次 PR 只上传源码、文档和小配置，不含 `.blend`、`.obj`、音频或成片。
