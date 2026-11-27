# AI 做 3A 大作 · 项目合集

01–10 是抖音「大师的AI小灶」《如何做出自己的第一款3A大作》这期视频里项目的代码：网页游戏、CG 短片管线，还有一条给怪物做骨骼动画的 AI 管线；11–14 是按同一套「源码 + 文档 + 小配置」格式收录的后续独立样例。每个项目都是和 Claude（Fable 5.2 / Opus 5.5）一起，从零做出来的。

每个子目录是一个项目，进去先看它自己的 `README.md`。

| 目录 | 项目 | 是什么 | 技术栈 | 怎么跑 |
|---|---|---|---|---|
| [01-umbra-gt](01-umbra-gt/) | UMBRA GT | 浏览器里的 3D 街头赛车：城市和山路两条赛道、AI 对手、天气、昼夜 | three.js r187（WebGPU）+ Rapier + Vite + TS | `npm install && npm run dev`（完整素材在独立仓库 [jadon7/umbra-gt](https://github.com/jadon7/umbra-gt)） |
| [02-khamsin-fps](02-khamsin-fps/) | KHAMSIN · 热风行动 | 沙漠城镇网页 FPS：跑酷、钩爪、滑索、机甲空降 | three.js + three-mesh-bvh，Blender 脚本建模 | `npm install && npm start` |
| [03-moba-ember-tide](03-moba-ember-tide/) | 烬与潮 | 原创网页 MOBA，标准三路地图，手机也能玩 | three.js + TS + Vite，素材来自即梦、Tripo 和 video2rig 动作管线 | `npm install && npm run dev` |
| [04-dusk-drift](04-dusk-drift/) | 暮色漂移 Dusk Drift | 7 秒的漂移 CG 短片（`racing/`），加上用同一套车、天空、路面做的可玩赛车（`game/`），还有同一任务交给 Codex 做的对照（`codex_task/`） | Blender Cycles + Python；three.js r187 WebGPU | 见目录 README |
| [05-wukong-cloud-runner](05-wukong-cloud-runner/) | 筋斗云 | 悟空驾筋斗云穿过云海：两条 Blender 短片（动漫版、写实版），加上一个驾驶模拟小游戏 | Blender + OpenVDB + Tripo；three.js r170 | 见目录 README |
| [06-mall-strike](06-mall-strike/) | MALL STRIKE 商场突袭 | 20 秒 COD 风格枪战短片，加上用同一套素材做的网页 FPS，光照在 Cycles 里烘焙 | Blender 5.2 Cycles + Tripo；three.js r187 + three-mesh-bvh | `cd game && npm install && python3 serve.py` |
| [07-fighting-game](07-fighting-game/) | 烬霜 · 武斗 | 原创 2.5D 横版格斗：两名角色、「雪夜残寺」场景 | TS + Vite + three.js，素材来自 Tripo、即梦、video2rig | `npm install && npm run dev` |
| [08-bodycam](08-bodycam/) | BODY CAM · 清剿 | 随身记录仪视角的 CG 枪战短片，加上用同一个厂房做的可玩版 | Blender 脚本 + Python；three.js + three-mesh-bvh | 见目录 README |
| [09-video2rig](09-video2rig/) | video2rig | 让 AI 视频（即梦 Seedance）拍怪物的动作，再把关节读出来，放回怪物自己的骨架上 | Python（PyTorch / DINOv2 / OpenCV）+ Blender + Tripo | 见目录 README |
| [10-midnight-sprint](10-midnight-sprint/) | 午夜冲刺 MIDNIGHT SPRINT | 42 秒原创夜景街头赛车 CG 短片，场景、动画、特效、HUD、音频都由脚本生成 | Blender Cycles + Python + ffmpeg | 见目录 README |
| [11-iron-dust](11-iron-dust/) | 铁尘 IRON DUST | 第三人称重型机甲战术动作：驾驶舱、换装机体、沙漠与轨道战场 | Godot 4.7 + GDScript，Blender 脚本建模 | 见目录 README |
| [12-blind-tide](12-blind-tide/) | 盲潮 Blind Tide | 声音驱动的恐怖游戏垂直切片：声呐视物、引开潮听者、开井固守 | Godot 4.7 + GDScript，Blender 脚本建模 | 见目录 README |
| [13-starship-cockpits](13-starship-cockpits/) | 三界座舱 Starship Cockpits | 赛博朋克 / NASA 朋克 / Y2K 三套实时飞船仪表盘 | three.js r170 + WebGL2 | 见目录 README |
| [14-qingming-menu](14-qingming-menu/) | 青冥劫 · 行者菜单 | 水墨暗金角色菜单：行囊、舆图、卷宗、3D 检视与配伍 | three.js r160 + 原生 JS / CSS | 见目录 README |

## 这个仓库里有什么，没有什么

**有**：源码、脚本、说明文档、提示词、生成任务的记录，以及小的配置文件（`package.json`、`package-lock.json` 等）。

**没有**（一共几十 GB，没法放进 git）：
- 模型和场景：`.glb`、`.blend`、`.fbx`、`.vdb`
- 贴图、图片、HDRI：`.png`、`.jpg`、`.exr`、`.hdr`
- 音频、视频、成片、逐帧渲染
- 训练数据和权重：`.npz`、`.pt`
- `node_modules`、`.venv`、`dist`，以及游戏目录里的 `vendor/three` 拷贝

所以**直接 clone 下来，大多数游戏没法完整运行**。每个项目 README 末尾的「关于这份拷贝」一节写了缺哪些东西、大概多大、怎么用脚本重新生成或者去哪下载（Poly Haven、Sketchfab、Tripo、即梦等）。

## 密钥

仓库里没有任何 API key。用到外部服务的脚本从环境变量或本机配置文件读 key，例如：
- Tripo：`TRIPO_API_KEY`，写在 `~/.config/video2rig/env`
- 即梦画布项目：`JIMENG_PROJECT_ID` 环境变量，或者从 `09-video2rig/jimeng_project.example.json` 复制一份 `jimeng_project.json`
- Sketchfab / Tripo（BODY CAM 管线）：从 `08-bodycam/scripts/keys.example.json` 复制一份 `keys.json` 自己填

`keys.json`、`*.env` 都写进了 `.gitignore`。

## 素材许可

代码随便看、随便学。第三方素材各有各的许可，用之前先看各项目的 `CREDITS` 或 README：Poly Haven 是 CC0；部分 Sketchfab 模型是 CC BY 或 CC BY-NC（不能商用）；Tripo 生成的模型归生成它的账号所有。这些素材本身都没有放进仓库。
