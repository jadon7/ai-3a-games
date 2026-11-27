# 通用动作任务：受击、击飞倒地、起身、被击败

你是 Opus 5.5。格斗游戏里两名新角色（`yanjin`、`lingshuang`）的招式动作走视频管线（另外两个任务在做）。视频管线不擅长贴地、被打的动作，所以**受击 / 倒地 / 起身这一类通用动作由你来做**：用 Tripo 的预设动作（真人动捕）搬到每个角色自己的骨架上。全程中文。用户在睡觉，没有人可以问：自己判断、自己换路，走不通的写进报告。

## 位置

- 新项目 FG：`/Users/jadon7/Documents/SynologyDrive/code/fighting-game`。你的工作目录 `FG/art/generic/`，工具放 `FG/tools/generic/`，证据放 `FG/docs/generic/`。
- 管线 V2R：`/Users/jadon7/Documents/SynologyDrive/code/video2rig`；MOBA：`/Users/jadon7/Documents/SynologyDrive/code/moba`。这两处**已有的文件都不许改、不许删**，只读、只拷。
- Python：`V2R/.venv/bin/python`（有 numpy、requests）。Blender：`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup`（只用无界面，用户开着的 Blender 窗口和 Blender MCP 不碰）。
- Tripo 客户端：`FG/tools/tripo.py`（v3 接口，key 自己从 `~/.config/video2rig/env` 读；不打印、不复述）。接口文档：<https://developers.tripo3d.com/en/docs/animations-retarget>、`…/animations-rig`（需要看就自己抓；`/llms-full.txt` 有全文）。
- 可以参考的旧代码：`V2R/scripts/wukong_retarget.py`（两副骨架之间按世界朝向差搬动作、写“只有骨架 + 动画的 GLB”）、`V2R/scripts/blender/export_actions.py`、`MOBA/tools/blender/hero_build.py`（成品 GLB 怎么导出的）。

## 已知的接口事实（2026-11-25 查文档）

- `POST /v3/animations/retarget`：`input` 是**绑好骨的任务的 task_id**；`animation` 单个或 `animations` 最多 5 个；`out_format` glb；`animate_in_place`（原地）；`export_with_geometry`。
- 绑骨版本和能用的预设：
  - **v3.0-20260909 双足**（我们角色用的就是它，`spec mixamo` 只是骨骼命名）：`preset:idle walk run dive climb jump slash shoot hurt fall turn`，一共 11 个。这些可以直接套在角色自己的绑骨任务上，骨架相同，不用重定向。
  - **v1.0-20240301 双足**：90 多个，带前缀 `preset:biped:`。和格斗有关的：`hit_to_head hit_to_body_01 hit_to_body_02 hit_to_side hit_to_stomach hurt fall defeat_02 defeat_03 flip dive jump jump_down turn box_01 box_02 box_03 front_kick_01 front_kick_02 slash chop cast_a_spell victory_celebration angry_01 cross_body_crunch press-up sit standing_relax look_around`。骨架和 v3 的不一样，要你写重定向。
- 文档示例里绑骨 25 额度、一个预设 10 额度；批量 5 个怎么计费没写，第一次调用后看 `credits_consumed`。

## 要交付的动作（每个角色一套，id 固定）

| id | 是什么 | 要求 |
|---|---|---|
| `hit_high` | 头部受击 | 头和上身向后一仰，快速回正。短（0.4 到 0.6 秒） |
| `hit_mid` | 腹部受击 | 弯腰含胸、身体对折一下，回正 |
| `hit_side` | 侧面受击（被横扫的刀、摆拳打到） | 上身向一侧拧开 |
| `hit_heavy` | 重击踉跄 | 被打得连退两三步才稳住。0.8 到 1.2 秒 |
| `hit_air` | 空中受击姿势 | 身体后仰、四肢甩开的一小段（可以从 `fall` 的腾空部分截） |
| `knockdown` | 击飞倒地 | 被打飞、背部着地、弹一下、躺平。最后一帧是躺平的姿势 |
| `getup` | 起身 | 从 `knockdown` 最后一帧的躺姿起来，回到站立 |
| `ko` | 被击败 | 最后一击：比 `knockdown` 更重的倒地，倒下不起（可以和 `knockdown` 同源但更慢、更软，或者用 `defeat` 类） |
| `dizzy` | 眩晕（循环） | 站着摇晃、头晕。有合适的预设就做，没有就不做 |
| `dash_f` / `dash_b` | 前冲 / 后撤一小步 | 有合适的就做（`dive`、`flip`、`turn` 里截），没有就不做，游戏那边有后备 |

可以多做（比如两种 `hit_high` 换着播），不许少了前 8 个。`getup` 预设里没有现成的，办法自己试：`fall` 倒放并改节奏；`cross_body_crunch`（仰卧）、`press-up`（俯卧撑，里面有从趴着撑起来的一段）、`sit` 截一段再接站起；或者在 Blender 里用几个关键姿势手摆（躺 → 侧身撑地 → 单膝跪 → 站起），渲出来看着自然为准。

## 质量要求

- 动作搬过去以后**脚不陷地、不漂**；躺倒时身体贴地、不穿地也不悬空（按网格最低点修，不是按骨骼）。
- 这些动作在游戏里会从角色的**格斗架势**（左脚在前、侧身、双手护在身前）接进来、再接回去。建议受击类用“差量”的做法：`结果(t) = 角色架势 ⊕ (动捕(t) ⊖ 动捕(0))`，这样第 0 帧就是架势、受击的晃动叠在架势上；击飞、起身这类全身动作用绝对姿势，首尾几帧向架势过渡。两种都渲出来比一比，哪个好用哪个。角色的架势姿势：成品 GLB 里的 `idle` 第 0 帧（还没有 `idle` 时用 `idle_pose`）。
- 水平位移：`hit_heavy` 的后退、`knockdown` 被打飞的那段位移**从动作里去掉**（原地），但在时间表里记下原始位移曲线的总距离；竖直方向保留。
- 凌霜右手握着刀：搬完检查刀有没有穿进身体和地面，穿了就调右臂。
- 帧率 30。成品是“只有骨架 + 动画”的 GLB（不带网格），骨骼名、层级、静止姿势和角色成品 GLB **完全一致**（游戏按骨骼名把这些动作套到角色身上）。

## 步骤

### 第一段：先在替身上把工具做通（现在就开始）

两名新角色的模型还在做（大约一小时后才有绑好骨的成品）。先用现成的 MOBA 英雄 `gorran` 当替身把整条路走通，游戏那边也正拿它当替身开发：

- 替身的成品：`FG/public/assets/fighters/_standin/gorran.glb`（从 MOBA 拷来的，Mixamo 骨骼名，有 `idle` 等动作）。
- 它的 Tripo 模型和绑骨：`MOBA/art/models_src/hero_gorran_raw.glb`（没绑骨的原模型）、`MOBA/art/hero/gorran/tripo_rigged.glb`（v3 绑骨结果）、任务号在 `MOBA/art/models_src/log.jsonl`（`hero_gorran`）和 `MOBA/art/hero/rig_tasks.txt`。任务号过期了就把原模型上传（`tripo.upload`）重新绑。

要做通的两条路：
1. **v3 预设直接套**（`hurt fall jump dive turn`）：同一副骨架，把动画从 Tripo 导出的 GLB 搬到成品 GLB 的骨架上（成品被摆正、缩放过，骨骼的局部旋转可以直接用，胯的位移要按两边的整体变换换算）。
2. **v1.0 重新绑骨 + v1 预设 + 重定向到 Mixamo 骨架**：同一个网格的两副骨架，静止姿势相同，按骨骼的世界朝向差搬（`wukong_retarget.py` 的思路），手指可以不管。
每条路都渲联系表（原动作一行、搬过去一行，正面和侧面），用 Read 看图确认搬对了，再往下。

替身的交付：`FG/public/assets/fighters/_standin/gorran_generic.glb` 和 `gorran_generic.json`。**这一份尽快交**（哪怕先只有 `hit_high hit_mid knockdown`），游戏那边等着用；之后补全了再覆盖。每次交付在 `FG/art/generic/STATUS.md` 里记一行（时间、哪个角色、有哪几段）。

### 第二段：给两名新角色做

盯着 `FG/art/fighter/<id>/STATUS.md` 和 `FG/public/assets/fighters/<id>/<id>.glb`（角色任务做完架势会先出一版成品）。出现以后：

- 角色的原模型和任务号在 `FG/art/models_src/`（`fighter_<id>_raw.glb`、`log.jsonl`），绑骨结果在 `FG/art/fighter/<id>/tripo_rigged.glb`，绑骨任务号问不到就看角色目录里的记录或者 `log.jsonl`。
- 跑和替身一样的流程。两个角色体型差别大（阎烬魁梧、凌霜修长），每个角色各自绑 v1、各自要预设，不要拿一个角色的结果硬套另一个。
- 交付 `FG/public/assets/fighters/<id>/<id>_generic.glb` 和 `<id>_generic.json`。**不要动角色任务的文件**（`<id>.glb`、`<id>.json`、`FG/art/fighter/<id>/` 里的东西只读）。
- 角色的成品还没出现时不要干等：继续打磨替身那套、做 `getup`。每隔十来分钟看一眼就行（用后台任务等文件出现，不要前台 `sleep`）。

### 时间表 `<id>_generic.json`

```json
{
  "id": "yanjin",
  "clips": {
    "hit_high":  {"dur": 0.50, "impact": 0.00, "recover": 0.45},
    "hit_heavy": {"dur": 1.00, "impact": 0.00, "recover": 0.90, "travel": -0.45},
    "knockdown": {"dur": 1.30, "airborne": [0.05, 0.60], "ground": 0.60, "travel": -1.2},
    "getup":     {"dur": 1.10, "recover": 1.00},
    "ko":        {"dur": 1.80, "ground": 0.9},
    "dizzy":     {"loop": true, "dur": 2.0}
  },
  "notes": "…每段从哪个预设来、怎么改的…"
}
```
时间是秒。`impact` 受击的那一刻（一般就是第 0 帧）；`ground` 背部着地；`airborne` 双脚离地的起止；`travel` 原动捕里身体的水平位移（身高按 1 算，负数是向后）；`recover` 可以接别的动作的时刻。

## 额度和规矩

- Tripo 合计 ≤ 700：替身约 25（v1 绑骨）加约 25 个预设；两名角色各约 25 加 15 个预设。先在替身上把 v1 的候选预设都要一遍看哪些好，角色上只要选中的。开始和结束各查一次余额写进报告。
- 结束进程只用确切 PID，禁止 `pkill`、`killall`；`rm` 只写完整的字面量绝对路径；不跑等输入的命令；长命令放后台；macOS 没有 `timeout`。
- 不 `git commit`。本机 Blender 同时别开超过 2 个进程（还有三个任务在跑）。渲染图看完就删。
- 只写 `FG/art/generic/`、`FG/tools/generic/`、`FG/docs/generic/`、`FG/public/assets/fighters/_standin/gorran_generic.*`、`FG/public/assets/fighters/<id>/<id>_generic.*`。

## 报告（最后一条消息）

先给结论，再写：每个角色交付了哪几段、各从哪个预设来、差量还是绝对；`getup` 怎么做的、自然不自然；脚滑、穿地、刀穿模的情况；工具怎么用（给下一个角色跑一遍的命令）；Tripo 花了多少；没做成的和没验证的。附联系表路径。不要只报喜。
