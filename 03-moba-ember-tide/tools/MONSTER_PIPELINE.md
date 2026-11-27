# 野怪和 Boss 的资源手册（阶段 6）

给做资源的并行任务看的。一个任务只做一只怪，做到“游戏里带全套动作能看”。
流程和四足英雄是同一条（`tools/CREATURE_PIPELINE.md`，先把它从头到尾读一遍，连同最后“做完两个四足以后补的”那一节），这份只写不一样的地方。
出视频、写提示词、裁动作、写时间表的细节在 `tools/HERO_PIPELINE.md`；远程训练在 `tools/REMOTE.md`。

记号同那两份：`MOBA`、`V2R`、`PY`、`BL`。每只怪只有一个名字 `<n>`（比如 `wolf`），管线名、目录名、成品名都用它。

## 和四足英雄不一样的地方

1. **目录是 `art/unit/<n>/`**，不是 `art/hero/<dir>`。任务要求写在 `art/unit/<n>/brief.json`：长什么样、游戏里多高、走多快、要哪几段动作。
2. **成品放 `public/assets/unit/<n>.glb` 和 `public/assets/unit/<n>.json`**。`build.json` 里 `"packed": "public/assets/unit/<n>.glb"`，`"out": "art/unit/<n>/game.glb"`。不要碰 `public/assets/unit/` 里别的文件（`melee.*`、`ranged.*`、`units.json`、别的怪）。
3. **模型**：图转模型的任务号在 `art/models_src/log.jsonl` 里，名字是 `unit_<n>`，模型文件 `art/models_src/unit_<n>_raw.glb`。两只 Boss（`troll`、`beast`）不用绑骨：模型、骨架、权重都是现成的，见各自的 brief。
4. **两足的怪**（brief 里写了 `"legs": 2`）：绑骨不加 `--rig-type`（Tripo 默认按人形绑，骨骼是 Mixamo 的名字），不用写映射，`prep_rig.py` 直接能跑；训练从 `runs/minion/jointnet.pt` 起步。出品仍然用 `tools/creature_build.sh`（不摆站姿、不装武器，待机用视频读出来的）。
5. **动作的名字是固定的**（游戏按名字找）：
   - `idle` 待机（循环）
   - `run` 移动（循环；大个子是沉重地走，小的是跑，brief 里写了游戏里的移速）
   - `attack1` 普通攻击
   - `attack2` 重击（只有增益怪和 Boss 有：出手前有一段明显的蓄力，游戏里会在地上给一个预警圈，蓄力结束那一刻结算）
   - `roar` 咆哮（只有 Boss 有）
   - `death` 死亡（停在最后一帧）
6. **时间表 `public/assets/unit/<n>.json`**：格式是英雄时间表（`HERO_PIPELINE.md` 第二段第 5 步）加三项，例子：
   ```json
   {
    "height": 2.3, "ring": 1.6, "bar": 0,
    "runSpeed": 3.4,
    "attacks": [
     {"clip": "attack1", "swing": 0.35, "hit": 0.5, "end": 1.1, "hands": []},
     {"clip": "attack2", "swing": 0.9, "hit": 1.25, "end": 2.2, "hands": []}
    ],
    "skills": {"roar": {"clip": "roar", "release": 0.7, "end": 2.2}},
    "death": {"clip": "death"},
    "points": {"hand": "<头部那根骨骼的名字>", "chest": "<躯干中段那根骨骼的名字>", "up": 0.3}
   }
   ```
   - `height`：游戏里连背上、头上的东西一起算的总高（米），从 brief 给的数开始，在游戏里看着合适为准。`ring`：脚下的圈放大几倍。`bar`：血条再抬高多少米。
   - `runSpeed`：`run` 按原速播时脚下对应的移速（米/秒，按游戏里的大小算），换算方法见 `CREATURE_PIPELINE.md` 最后一节。
   - `attacks` 里时间都按动作原速算：`swing` 开始发力、`hit` 打中的那一刻、`end` 可以接下一个动作。`attack2` 的 `hit` 之前就是蓄力，至少要有 0.8 秒，不够就把动作放慢（`"speed": 0.8`）。`hands` 写空的。
   - 没有 `attack2`、`roar` 的怪就不写那一项。
7. **在游戏里看**：怪还没接进对局的时候，借英雄的位置看——把它当成玩家的模型放进测试场：
   ```bash
   MOBA_Q="glb=../unit/<n>&look=height:<身高>,ring:<圈>,bar:<血条抬高>" node tools/kit_test.mjs lan art/unit/<n>/play A 18 180      # 连打几下普攻，attack1、attack2 轮流出（后两个数是连拍几张、每张隔多少毫秒）
   FEET=<左前脚骨骼>,<右前脚骨骼> MOBA_Q="glb=../unit/<n>&look=height:<身高>" node tools/run_probe.mjs lan art/unit/<n>/probe          # 跑起来落地脚滑不滑
   ```
   测试场里它按岚的移速（6 米/秒）走，步频会比 brief 里的移速快，看滑不滑步不受影响；动作本身的节奏用查看页按原速看。
   这里的技能特效、伤害数字是岚的，不用管；只看模型、大小、动作。

## 提示词要注意的（怪和英雄不一样的地方）

- 怪的动作幅度要大、有分量，但**四只脚（两足的是两只脚）基本留在原地**：扑咬写成“身体猛地前探再收回”，不要真的跳出去；冲撞写成“原地蹬地、肩膀前顶”。
- 死亡：四足的写到前腿跪下、胸口贴地、头垂下停住；两足的写到双膝跪下、上身前倾、双手撑地、头垂下停住。不要躺倒、翻身、打滚。
- 不出现火光、水花、尘土、光效、别的角色。发光的纹路、余烬色的鬃毛只写颜色，不写“燃烧”“闪烁”。

## 额度

- Tripo：新怪绑骨一次（25），不许绑第二次。Boss 不花。
- 即梦：brief 里列的每段动作各一段（每段 45 积分），另外最多重出 2 段。
- 远程训练一次只能跑一个，`remote.sh train` 自己会排队等，放后台跑就行。

## 不许做的事

同 `CREATURE_PIPELINE.md`：不改 `src/` 和 `tools/` 里的共用脚本；不碰别的角色的文件；不按名字结束进程；`rm` 只写完整的绝对路径；不打印、不复述 `~/.config/video2rig/env` 里的内容；不提交 git。自己的小脚本放 `art/unit/<n>/` 里。

## 报告

先说结论（能不能用、最大的问题是什么），再写：产出了哪些文件；游戏里合适的 `height`、`ring`、`bar`；每段动作的时间点和实测的 `runSpeed`、滑步多少；每段视频的回投偏差；看下来的毛病（穿模、抖、脚陷进地里、循环接不上）；和 brief 不一致的地方；花了多少积分；共用脚本的问题。问题不要藏。


## 做完六只以后补的（2026-11-19，各任务报告里来的）

**现在可以直接在对局里看怪了**，不用再借英雄的位置：
- 测试场（`map.html?arena=1&h=<英雄>`）左上角有“放野怪”下拉框；脚本里是 `__arena.wild("<n>")`，返回那个营地（`.mobs` 是里面的怪）。
- 一条命令截五张（站着、普攻、重击预警、重击落下、死亡）：`zsh tools/wild_look.sh <n> <输出目录> [英雄] [镜头距离]`。
- 真实对局里开局 20 秒刷野怪，Boss 用脚本提前放：`__sim.spawnCamp(__sim.camps.find(c => c.mob === "<n>"))`。现成的检查脚本：`art/unit/toad/scripts/game_check.mjs`。
- 截图、跑对局走不做热更新的测试服务器（`MOBA_URL=http://localhost:5190/map.html`）：平时那个 5183 在 `public/` 里的文件一变就整页刷新，别的任务一出品，正在截的图就断了。

**时间表和规则怎么对上**：规则里每种怪的出手时间在 `src/map/game/sim.ts` 的 `MOBS`（`wind` 普攻、`heavy.wind` 重击蓄力）。画面按 `时间表的 hit ÷ 规则的 wind` 定动作的播放倍率，所以两边差得远动作就会被快放或慢放。出品以后把 `hit` 报给主线，由主线把 `MOBS` 改到播放倍率在 0.9 到 1.2 之间。

**手册和共用脚本的坑**：
- 两足的怪：`tools/tripo.py rig` 默认绑出来是 Tripo 自己的骨骼名（Hip、Waist、L_Thigh……），不是 Mixamo 的，`prep_rig.py` 直接跑不了。骨架和权重是对的，用 `art/unit/mandrill/scripts/to_mixamo.py` 改名（加 `--spec mixamo` 没试过）。
- `remote.sh render` 现在和 `train` 一样会排队。四个任务同时各开 8 个 Blender 会把那台机器的显存撑满，每分钟只出几组。
- 远程的进程不会因为本机这边断开就停（`REMOTE.md` 原来写反了）。要停先在远程列出命令行里带自己模型名的进程，再按确切的进程号结束。
- `tools/run_probe.mjs` 判“脚着地”的门槛写死 12 厘米、量的是脚踝或爪根：抬脚低的（野猪、狼）和个头大的（巨魔、巨兽）都量不准。各目录里有改过的：`art/unit/wolf/scripts/run_probe_tip.mjs`（按爪尖量）、`art/unit/troll/run_probe2.mjs`（门槛按身高放大）、`art/unit/beast/scripts/run_probe2.mjs`。
- `tools/hero_motion.py` 算的“原速”对四足普遍偏低一两成，以探针实测为准。
- 共用的读视频脚本只管脚上的关节不入地，不管肚皮、手和脚掌的肉：趴下、跪下、砸地的动作要自己补“网格不许到地面以下”。现成的：`art/unit/beast/scripts/lib.py`（`resolve2`）、`art/unit/toad/scripts/solve_toad.py`、`art/unit/wolf/scripts/solve_wolf.py`。
- 即梦出的双机位视频有时两个机位差几帧（巨魔的行走差 9.5 帧，狼的跑步差三四帧）。脚该踩地时被抬起一截就是这个原因：把一个机位的读数挪几帧对齐，或者高度一律听侧面机位。
- 跑步的视频常常是冲刺：原速比游戏里的移速高很多时，要么收步幅重建步态（巨蟾、狼、巨兽），要么让主线把移速提上去（山魈）。
- 某个关节相对静止姿势转过 120 度以上（举臂过头）的角色，腋下混合出来的法线是歪的，游戏的边缘光会把那一片打亮：`art/unit/mandrill/scripts/fix_normals.py`。
- 同一窝的怪动作同相位的问题在画面那边解决了（循环动作从随机的地方开始播），资源这边不用管。
- 大小、亮度、饱和度由主线在 `src/map/game/view.ts` 的 `MOB_LOOK` 里按怪单独调（狼背上的苔藓原样用太亮太黄），资源这边贴图原样出。
