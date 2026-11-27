# 第九轮 · 四个新英雄的资源任务（共同说明）

你是 Opus 5.5，负责把一个新英雄从设定图做到“游戏里带全套动作能看”。四个英雄各一个任务并行：`kaz`（四足猞猁）、`hedda`（人形铁匠）、`ugo`（两足鮟鱇鱼人）、`seren`（人形射手）。调度（另一个模型）只派活、核对、合并。全程中文。

## 先读

1. 设计：`docs/round9/heroes/DESIGN.md` 里你那个英雄的一节；`art/hero/<id>/brief.json`（外形、要哪几段动作、每段怎么做、绑骨的注意事项）；设定图 `concepts/heroes/h7…h10-<id>-*`（建模用 `-sheet-b`）。
2. 管线手册（照着做，**但下面“和手册不一样的地方”优先**）：
   - 人形和两足（hedda、seren、ugo）：`tools/HERO_PIPELINE.md`，从头读到尾，连同最后两节补充。
   - 四足（kaz）：`tools/CREATURE_PIPELINE.md`，从头读到尾；出视频、写提示词、裁动作、写时间表的细节在 `HERO_PIPELINE.md`。
   - 都要读：`tools/MONSTER_PIPELINE.md` 最后一节“做完六只以后补的”（各种坑），`tools/REMOTE.md`（远程渲染和训练）。
3. 上一批怎么做的：`PLAN.md` 阶段 5 的记录（搜“五个人形英雄”“动作是怎么来的”“踩过的坑”），照着看的例子 `art/hero/gorran/`、`art/hero/vero/`（人形，带武器）、`art/hero/osen_stag/`、`art/hero/torg_turtle/`（四足）、`art/unit/mandrill/`（两足非人，绑骨改名）。

## 和手册不一样的地方（这一轮你自己从头做到尾）

手册里“主线来做”“不许做”的几步，这一轮由你自己做：

1. **建模（Tripo 图转 3D）**：先从 `-sheet-b` 建模图里裁出一张干净的 `art/hero/<id>/ref.png`（只有这个角色、纯灰底、居中、四周留白；人形是正面 A 字站姿）。然后照 `art/hero/tripo_jobs_a.json` 的格式写 `art/hero/<id>/tripo_jobs.json`，用 `V2R/.venv/bin/python tools/tripo_batch.py art/hero/<id>/tripo_jobs.json` 出模型（`name` 用 `hero_<id>`，`face_limit` 40000，`texture_quality` detailed）。有武器的（hedda 的火钳、seren 的螺壳长铳）武器单独出一个（`weapon_<id>`，face_limit 12000，standard），或者照 `HERO_PIPELINE.md` 里 `gear` 的 `script` 写法自己用脚本建（简单的几何更稳）。出来以后用 Blender 渲几张图看：结构对不对、有没有糊成一团、贴图有没有明显的错。**不行最多重出一次**，再不行停下来向调度汇报。
2. **绑骨**：人形和两足照 `art/hero/rig_all.sh` 的写法（`--rig-type biped --spec mixamo`）；ugo 的头很大，绑完先看骨架和权重（`inspect_weights.py`）再往下走，如果绑出来不是 Mixamo 的骨骼名，照 `art/unit/mandrill/scripts/to_mixamo.py` 改名。四足（kaz）照 `CREATURE_PIPELINE.md` 第一步，映射从狼（`V2R/assets/model/wolf_rigmap.json`）改。只绑一次。
3. **渲染训练图和训练**：你自己在远程那台机器上跑（`tools/remote.sh`，它自己会排队，放后台跑）。人形和两足从 `runs/heroes5/jointnet.pt` 起步，四足从 `runs/beast/jointnet.pt` 起步。远程机器内存 32G：训练用默认的读图进程数，别改大。
4. **出品**：成品放 `public/assets/hero/<id>.glb` 和 `public/assets/hero/<id>.json`（id 就是英雄名，不用另起管线名）。再出手机档：`node tools/lite_glb.mjs public/assets/hero/<id>.glb public/assets/hero/m/<id>.glb 1024 512`。
5. **在游戏里看**：新英雄还没有技能代码（下一批才写），所以借一个已有英雄的技能来看模型和动作：人形借 `vero`（远程）或者 `gorran`（近战），四足借 `osen`。照 `CREATURE_PIPELINE.md` 第 14 步的 `kit_test.mjs` 写法，`MOBA_Q` 里写 `glb=<id>&look=height:<身高>,ring:<圈>`。另外截一张和小兵、已有英雄站在一起的图，看个头合不合适（英雄要明显比小兵大）。
6. **服务器**：查看页（`viewer.html`）和测试场的截图都走 `http://localhost:5190`（不做热更新；5183 那个在 `public/` 里的文件一变就整页刷新，四个任务一出品就会互相打断）。这两个服务器都已经在跑，不要启动、停止、重启。`tools/anim_sheet.mjs` 用 `VIEW_URL=http://localhost:5190/viewer.html?...`。

## 额度（每个英雄）

- Tripo：模型 40、武器 30、绑骨 25，加最多一次重出，**合计不超过 150**。
- 即梦：brief 里每段动作出一段（每段约 45 积分），另外最多重出 3 段，**合计不超过 600**。出视频用 `V2R/scripts/jimeng.py video … --ceiling 50`，可以两段同时跑。
- 开始和结束各查一次余额（`V2R/.venv/bin/python tools/tripo.py balance`、`dreamina-canvas auth account --format json` 里的 `availableCredits`），写进报告。别的任务也在花，算你自己花的就看你自己出了几次。

## 不许做的事

- 不改 `src/` 下的任何东西（技能代码下一批写），不改 `tools/` 里的共用脚本（有问题写进报告），不碰别的英雄的文件。自己的小脚本放 `art/hero/<id>/` 里。
- 不提交 git、不切分支。
- 结束进程只用确切的 PID；不许 `pkill`、`killall`。远程机器上要停自己的进程，先列出带自己模型名的进程，按确切的进程号结束。
- `rm` 只写完整的绝对路径；不要 `cd` 以后删相对路径；不要删 `$变量` 开头的路径。macOS 没有 `timeout`。不要运行会等输入的命令。耗时长的命令放后台。
- 不打印、不复述 `~/.config/video2rig/env` 里的东西；环境变量 `CODEX_API_KEY` 不要动。
- 同一时间只跑一个无界面 Chrome（你自己的）；截图白屏了重截。

## 用户的要求（和这个任务有关的）

- 英雄要比小兵显眼；动作幅度要大（大步、抡圆、腾空、重心大幅移动）；技能的动作要有张力。
- 手感：用户刚说过“很多动作前摇都很长”。另一个任务在改引擎这边的前摇，你这边做动作时把出手（`hit`、`release`）放在片段里尽量靠前的地方：普攻发力到打中别超过 0.3 秒（按游戏里的播放倍率算），技能出手别超过 0.4 秒；蓄力长的大招除外，在报告里写明。
- 交之前自己对着已有英雄并排看，挑毛病，改几轮。

## 交付和汇报

成品：`public/assets/hero/<id>.glb`、`<id>.json`、`m/<id>.glb`；过程文件都在 `art/hero/<id>/`。证据（截图、联系表、各动作的查看页拼图、游戏里和小兵站一起的图）放 `docs/round9/hero_<id>/`。

汇报：先说结论（能不能用、最大的问题），再写：模型和绑骨的情况；每段动作的时间点（`swing`、`hit`、`release`、`end`）、实测的 `runSpeed`、滑步多少、回投偏差；游戏里合适的 `height`、`ring`、`bar`；看下来的毛病（穿模、抖、脚陷地、循环接不上）；和 brief、设计不一致的地方；Tripo 和即梦各花了多少；没验证的。
