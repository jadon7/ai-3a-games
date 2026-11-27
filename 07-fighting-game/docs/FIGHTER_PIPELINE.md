# 格斗角色资源任务（共同说明）

你是 Opus 5.5，负责把**一个**全新的格斗角色从设定图做到“带全套 21 段专属动作的成品 GLB”。两个角色各一个任务并行（`yanjin`、`lingshuang`）。调度（另一个模型，Fable）同时在写游戏本体，只派活、核对、整合。全程中文。用户在睡觉，**没有人可以问**：遇到问题自己判断、自己换路，实在走不通的写进报告，不要停下来等。

## 位置

- 新项目（下面叫 FG）：`/Users/jadon7/Documents/SynologyDrive/code/fighting-game`。你的工作目录是 `FG/art/fighter/<id>/`，成品放 `FG/public/assets/fighters/<id>/`，证据放 `FG/docs/fighter_<id>/`。
- 动作管线（V2R）：`/Users/jadon7/Documents/SynologyDrive/code/video2rig`。游戏项目 MOBA：`/Users/jadon7/Documents/SynologyDrive/code/moba`，管线的外围工具在它的 `tools/` 里。
- Python：`V2R/.venv/bin/python`。Blender：`/Applications/Blender.app/Contents/MacOS/Blender`，**只用 `-b --factory-startup` 无界面跑**（用户开着的 Blender 窗口和 Blender MCP 不要碰）。
- 远程 4090（`ssh jadon7-wsl`，`MOBA/tools/remote.sh`，说明 `MOBA/tools/REMOTE.md`）：渲染训练图、训练都放它上面跑；用户说了这台机器显卡更好，渲染类的重活也可以放上去。

## 先读（按顺序）

1. `FG/docs/FIGHTERS.md`：两名角色的设计和 21 段动作清单（你那个角色的一节是你的任务清单）。`FG/art/fighter/<id>/brief.json`：外形、武器、架势。
2. `MOBA/tools/HERO_PIPELINE.md`：从头读到尾，连同最后两节补充。这是操作手册。
3. `MOBA/docs/round9/NEW_HEROES.md`：上一轮“一个任务从设定图做到成品”的做法，这次照它的流程（自己建模、绑骨、远程渲染训练图、远程训练）。
4. `MOBA/tools/REMOTE.md`、`MOBA/tools/MONSTER_PIPELINE.md` 最后一节“做完六只以后补的”（各种坑）。
5. `V2R/README.md`。照着看的例子：`MOBA/art/hero/gorran/`（人形近战）、`MOBA/art/hero/lan/`、`MOBA/art/hero/hedda/`（带武器），提示词 `V2R/prompts/lan_*.txt`、`gorran_*.txt`。

## 这次和手册不一样的地方（以这里为准）

1. **不改已有文件**。MOBA 和 V2R 里已有的任何文件都不许改、不许删（包括共用脚本、别的角色的文件、日志）。
   - 管线脚本要求写进 V2R 的那些位置（`assets/model/<id>*`、`assets/ref/<id>_ref.png`、`prompts/<id>_*.txt`、`out/seedance/<id>_*`、`out/anim/<id>_*`、`data/<id>`、`runs/<id>`）可以**新增**以你的 id 命名的文件。
   - MOBA 里不新增文件：`build.json`、`motions.json`、中间文件全放 `FG/art/fighter/<id>/`，路径都写绝对路径（`hero_build.sh` 先 `cd` 到 MOBA 再读你给的目录，传绝对路径即可；`packed` 指到 `FG/public/assets/fighters/<id>/<id>.glb`）。
   - 共用脚本不够用或有毛病：**拷一份到 `FG/tools/pipeline/`（或你自己的目录）再改**，改了什么写进报告。`tripo_batch.py` 会往 MOBA 的日志里追加，所以用 FG 里的那份：`FG/tools/tripo_batch.py`、`FG/tools/tripo.py`（日志在 `FG/art/models_src/log.jsonl`，模型落在 `FG/art/models_src/`）。
2. **画风是写实**，不是 MOBA 的卡通厚涂：材质名不要以 `_b` 结尾，不跑 `style_b` 的任何处理。**保留全套 PBR 贴图**（基础色、法线、粗糙度 / 金属度），不要 `strip_maps`。
3. **近景要经得起看**（格斗镜头里角色占屏幕高度一半以上，大招有特写）：
   - Tripo 图转模型：`face_limit` 60000，`texture_quality` detailed，`pbr` 开。出来以后渲六个角度看结构、看脸、看手。明显糊成一团或结构错（多一条胳膊、手和身体粘连、腿并在一起）就重出一次（最多一次）。
   - 成品贴图：身体 4096（源贴图不到 4K 就按源尺寸），武器 2048。`hero_build.py` 里要是把贴图压小了、丢了法线或粗糙度，用你拷出来的那份改。
   - 成品 GLB 用 meshopt 压网格、webp 贴图（和手册一样的 `gltf-transform` 流程），但动作重采样不要把快动作削平（`resample` 的容差用默认，看一眼出手那几帧还在不在）。
4. **动作是格斗动作，一共 21 段**，id 固定用 `FIGHTERS.md` 里那 21 个（`idle walk_f walk_b jump block light1 light2 light3 heavy lunge launcher sweep air grab sp1 sp2 sp3 ult_start ult_combo win intro`），不是手册里的 `run/attack1/q/w/e/r/death`。`build.json` 的 `motions` 里就用这些名字。
   - **判断动作好坏以侧面机位为主**：游戏镜头在角色右手一侧，等于管线的侧面机位。出招要往正前方（侧面画面的右边）打，侧面的剪影要清楚、幅度要大。
   - 架势：左脚在前、左肩对敌、胸口转向自己右侧。`stance`（站姿）就摆成 `idle` 的架势，这样每段视频第 0 帧就是架势。
   - 一次性动作必须**从架势开始、回到架势结束**；裁剪时首尾各留两三帧架势。循环动作（`idle`、`walk_f`、`walk_b`）首尾要接得上。
   - `walk_f`、`walk_b` 是保持架势的垫步，不是跑步：提示词里写“像在跑步机上一样原地做、双脚交替、身体不前移”，不要写“稳步行走”（会出成原地踏步）。`walk_f` 在 `motions.json` 里加 `"stride": true` 量原速。
   - 水平位移去掉（原地），**竖直方向的起伏保留**（下蹲、跳起、跪地都要看得到重心变化）。
   - 贴地的姿势少用：`sweep` 蹲到最低、手撑地就够，不要躺倒；`sp3` 只到单膝跪地。
   - 提示词里不要出现“火、冰、冲击波、发射、喷出、刀光”这类词（视频里会真的画出特效），只写身体怎么动。清单里括号内的效果说明是给你理解用的，不要抄进提示词。
   - 5 秒一段。`ult_combo` 内容多，提示词里把顺序写清楚、说明“动作连贯不停顿”；一段装不下就拆成两段（算在额度里），在时间表里说明怎么接。
   - 出手要干脆：出的动作偏慢是正常的，游戏里会按帧数表分段变速；但每一下的**最远伸展那一帧要清楚**（定格半拍最好），时间表靠它。
5. **时间表** `FG/public/assets/fighters/<id>/<id>.json`，格式（时间都是成品动作里的秒，30 帧每秒）：
   ```json
   {
     "id": "yanjin", "height": 1.92, "skeleton": "mixamo",
     "weapon": null,
     "stance": {"lead": "L"},
     "clips": {
       "idle":   {"loop": true,  "dur": 2.40},
       "walk_f": {"loop": true,  "dur": 0.93, "stride": 0.62},
       "walk_b": {"loop": true,  "dur": 0.93, "stride": 0.55},
       "jump":   {"dur": 1.60, "takeoff": 0.40, "land": 1.20, "recover": 1.50},
       "block":  {"dur": 2.60, "hold": [0.35, 2.20], "recover": 2.55},
       "light1": {"dur": 0.80, "hits": [{"t": 0.20, "limb": "LH"}], "recover": 0.60},
       "ult_combo": {"dur": 4.6, "hits": [{"t": 0.3, "limb": "LH"}, {"t": 0.7, "limb": "RH"}], "recover": 4.4},
       "sp1":    {"dur": 1.9, "hits": [{"t": 0.75, "limb": "RH"}], "release": 0.75, "recover": 1.7}
     },
     "notes": "…哪些时间点是量的、哪些是估的…"
   }
   ```
   - `hits[].t`：打到的那一刻（出手的肢体或刀尖速度最大、伸得最远）；`limb`：`LH` `RH` 左右手、`LE` `RE` 肘、`LF` `RF` 脚、`LK` `RK` 膝、`BODY` 肩背撞、`W` 武器。多段的每一下都列。
   - `recover`：姿势基本回到架势、可以接下一个动作的时刻。`release`：技能生效（冲击波、冰刃离手，拳或刀砸到地面）的时刻。`hold`：防御姿势保持住的起止。`takeoff` / `land`：双脚离地、落地的时刻。
   - `stride`：循环一遍身体应该前进（后退）的距离，身高按 1 算（用落地脚后蹬的距离量）。
   - 有武器的写 `"weapon": {"bone": "mixamorig:RightHand", "base": [x,y,z], "tip": [x,y,z]}`：刀镡处和刀尖在**成品 GLB 里那根手骨骼的局部坐标**（游戏用它画刀光拖尾和算命中）。另外在 GLB 里给武器网格起名 `weapon`。
6. **检查动作不用网页**（MOBA 的开发服务器没开）：用 Blender 渲连拍。`MOBA/tools/blender/views.py` 看静态；动作连拍自己写个小脚本（导入成品 GLB，每段动作隔几帧渲一张，正面一行、侧面一行，EEVEE，小图拼成联系表）。用 Read 看图。每段都要看：姿势崩没崩（手脚拧反、陷地、武器乱甩）、首尾是不是架势、循环接不接得上、出手那一帧在不在。确实需要网页查看器时可以在 MOBA 目录自己起一个预览（`npx vite --port <端口> --strictPort`，阎烬用 5261、凌霜用 5262），用完按确切 PID 结束。
7. 两个角色的任务同时在跑：远程渲染、训练会排队（`remote.sh` 自己排），耐心等，放后台任务里跑；即梦一次最多同时出两段。

## 步骤（概要，细节照手册）

1. 建模图：从设定图做 `FG/art/fighter/<id>/ref.png`（设定图已经是干净的灰底正面 A 字站姿，一般只需要核对四周留白、必要时裁一下）。
2. Tripo：模型（`name` 用 `fighter_<id>`）、绑骨（`--rig-type biped --spec mixamo`，绑一次）。凌霜的刀单独出一个模型（`weapon_lingshuang`，`face_limit` 12000，detailed），或者用脚本建（看哪个更像设定图、近看更好；Tripo 出的刀身歪了、厚了就改用脚本建并贴设定图的质感）。
3. `build.json`（建议一开始就加 `"palm_by_hand": true`）、装武器、摆架势、`prep_rig.py` 自检、参考图、`RIG_READY`。
4. 远程渲染训练图 + 远程训练（从 `runs/heroes5/jointnet.pt` 起步）。同时写提示词、出视频（不用等训练）。
5. 权重好了以后：读视频、裁动作、建成品、写时间表、渲连拍检查、反复改。手册最后一节列的通病（左右腿认反、深蹲解不出屈膝、握武器的手偏 30 度、长武器指向）先看一遍，现成的修法在各英雄目录里。
6. 交付、写报告。

**阶段性交付（重要，游戏那边等着用）**：
- 第 3 步做完就先出一版只有架势的成品到 `FG/public/assets/fighters/<id>/<id>.glb`（`hero_build.sh` 不带动作那一步的产物），并在 `FG/art/fighter/<id>/STATUS.md` 里记一行。通用动作那个任务要用它的骨架。
- 之后每做好几段动作就重新出一版成品覆盖上去，并更新 `STATUS.md`（写清楚现在成品里有哪几段、哪几段还没好）。不要等 21 段全齐了才出。
- 先做 `idle walk_f walk_b light1 light2 heavy block`，再做其余攻击和技能，最后 `ult_*`、`win`、`intro`。

## 额度

- Tripo：阎烬 ≤ 150，凌霜 ≤ 200（模型约 40 到 60、绑骨 25、刀约 30、各预留一次重出）。
- 即梦：每个角色 ≤ 1080（21 段每段约 45，另外最多重出 3 段）。出视频用 `V2R/scripts/jimeng.py video … --ceiling 50`。`--out` 指的文件已存在时下载会失败但积分照扣，重出要换文件名（`_02`）。
- 开始和结束各查一次余额（`V2R/.venv/bin/python FG/tools/tripo.py balance`、`dreamina-canvas auth account --format json` 的 `availableCredits`），写进报告。另一个角色也在花，你花了多少按自己出了几次算。

## 规矩

- 结束进程只用确切的 PID（远程也一样：先列出命令行里带自己模型名的进程，再按进程号结束）；**禁止 `pkill`、`killall`**。
- `rm` 只写完整的字面量绝对路径；不要 `cd` 以后删相对路径；不要删 `$变量` 开头的路径；不删别人的文件。
- 不运行会等输入的命令；耗时长的放后台并设超时。macOS 没有 `timeout` 命令。
- 密钥在 `~/.config/video2rig/env`，脚本自己会读。不打印、不复述、不写进任何文件。
- 不 `git commit`、不切分支、不 push。
- 同一时间只跑一个你自己的无界面 Chrome；截图白屏了重截。
- 磁盘剩约 90GB：渲染图、逐帧图看完就删（按上面 `rm` 的规矩）。本机内存 48GB，另一个角色的任务和游戏开发同时在跑：本机 Blender 同时别开超过 2 个进程。
- 只动自己角色的文件。`FG/src/`、`FG/public/assets/` 下别人的目录不要碰。

## 报告（最后一条消息）

先给结论（能不能用、最大的问题），再写：模型和绑骨的情况（附图路径）；21 段动作每段的状态和时间点、回投偏差、哪些重出过、哪些不满意；`walk_f` / `walk_b` 的 `stride`；穿模、抖、脚陷地、循环接不上之类的毛病；改过哪些脚本（拷到了哪）；Tripo 和即梦各花了多少；没验证的。不要只报喜。
