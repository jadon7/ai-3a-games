# 出一个英雄：从绑好骨的模型到游戏里的动作

这份说明给并行干活的 agent 用，也是这条管线的操作手册。每个英雄一个 agent，各管各的文件夹，互不相干。
背景、踩过的坑在 `PLAN.md` 的“阶段 3”“阶段 4”两段记录里（搜“动作是怎么来的”“踩过的坑”），动手前读一遍。

## 位置和约定

- 游戏项目：`/Users/jadon7/Documents/SynologyDrive/code/moba`（下面叫 MOBA）。动作管线：`/Users/jadon7/Documents/SynologyDrive/code/video2rig`（下面叫 V2R）。
- Python 用 `V2R/.venv/bin/python`（下面叫 PY）。Blender：`/Applications/Blender.app/Contents/MacOS/Blender`（下面叫 BL），都用 `-b --factory-startup` 无界面跑。
- 一个英雄的东西放在三处，名字都用英雄的 id（gorran、vero、osen、moko、torg）：
  - `MOBA/art/hero/<id>/`：配置、中间文件。你的工作目录。
  - `V2R/assets/model/<id>_rigged.glb`、`<id>.blend`、`<id>_skeleton.json`、`V2R/assets/ref/<id>_ref.png`、`V2R/prompts/<id>_*.txt`、`V2R/out/seedance/<id>_*.mp4`、`V2R/out/anim/<id>_*/`。
  - 成品：`MOBA/public/assets/hero/<id>.glb` 和 `<id>.json`。
- 坐标约定（和管线一致）：角色脚踩 z=0，面朝 -Y，左手边是 +X，身高约 1.0。游戏里再整体放大。
- 每个英雄的具体要求在 `MOBA/art/hero/<id>/brief.json`：拿什么武器、怎么拿、要哪几段动作、每段动作是什么样。
- 已经做完的可以照着看：主角 `art/hero/lan/`（`build.json`、`motions.json`）、小兵 `art/unit/melee/`、`art/unit/ranged/`；提示词 `V2R/prompts/lan_*.txt`、`melee_*.txt`。

## 不许做的事

- 只动自己英雄的文件（上面列的那些路径）。不要改 `tools/` 下面共用的脚本、`src/`、别的英雄的文件夹；共用脚本有问题或不够用，在最后的报告里说，不要自己改。需要临时脚本就放在 `art/hero/<id>/` 里。
- 不要渲染训练集（`render_dataset.py`），不要训练（`train.py`）。这两步占显卡，由主线统一排队做。
- 不要调用 Tripo（额度只剩几十，模型和绑骨已经由主线出好）。
- 即梦只用来出动作视频：`scripts/jimeng.py video … --ceiling 50`，每段 45 积分。brief.json 里每段动作出一段；不满意最多重出 2 段（整个英雄合计），再不行就在报告里说。不要出图。
- 密钥在 `~/.config/video2rig/env`，脚本自己会读。不要打印、不要复述、不要写进任何文件。环境变量 `CODEX_API_KEY` 不要动。
- 结束进程只用确切的 PID（`kill <PID>`），不许用 `pkill`、`killall` 这类按名字匹配的命令。不要运行等着键盘输入的命令。
- 删除文件时 `rm` 后面写完整的绝对路径，不要 `cd` 以后删相对路径，不要删 `$变量` 开头的路径。
- 不要 `git commit`、不要切分支。不要启动或停止开发服务器（已经在 5183 端口跑着）。
- 无界面 Chrome 截图（`tools/anim_sheet.mjs`、`tools/shot.mjs`）偶尔会截出白屏（显卡被训练占着时），重跑一次；连着三次都白就改用 Blender 渲染检查，或者在报告里说。

## 第一段：装武器、摆站姿、出参考图、出视频

输入：`art/hero/<id>/tripo_rigged.glb`（Tripo 绑好骨的模型，Mixamo 骨骼命名）、`brief.json`、武器（`art/models_src/weapon_<id>_raw.glb` 或者要你自己写脚本建）。

1. **写 `art/hero/<id>/build.json`**。照 `art/unit/melee/build.json` 的结构：
   - `name`、`raw`（tripo_rigged.glb）、`rigged`（`V2R/assets/model/<id>_rigged.glb` 的绝对路径）、`out`（`art/hero/<id>/game.glb`）、`packed`（`public/assets/hero/<id>.glb`）、`pose_out`（`art/hero/<id>/stance.npz`）、`tex`（2048）、`weapon_tex`（1024）、`motions`（先留空 `{}`，第二段再填）。
   - `gear`：拿在手里的东西，写法见 `tools/blender/hero_build.py` 里 `load_weapon` 和它下面那段注释。三种来源：
     - `{"type":"file","src":"art/models_src/weapon_<id>_raw.glb","side":"Right","length":1.3,"grip":0.35}`：图转 3D 的武器。`length` 是整件武器的长度（角色身高是 1），`grip` 是手握在长轴上的位置（0 底端、1 顶端），`flip` 两头对调，`roll` 绕杆身转，`offset`、`rot` 微调。
     - `{"type":"script","path":"art/hero/<id>/gear.py","func":"make_hammer","side":"Right"}`：自己写脚本建。函数返回一个 Blender 网格，按“握持坐标”建：原点是手握的位置，+Y 是杆身从拳眼（食指一侧）伸出去的方向。材质名要以 `weapon` 开头。写法照 `tools/blender/unit_gear.py`（可以 `import unit_gear` 用它的调色板材质和 `_finish`，也可以自己做一张小贴图；颜色、明暗、磨损要有变化，不要一整块纯色）。武器的设计图在 `art/hero/<id>/weapon_concept.png`。
     - 盾：加 `"mount":"forearm"`，绑在前臂外侧。
   - `grip`（可选）：每只手的手指。`{"Left": 0}` 左手摊开，`{"Right": 0.8}` 右手握松一点（粗的杖），`{"Left": null}` 左手的手指跟着动作走。不写就是两只手都握紧。只影响 game 那一步，改它不用重跑 rig。
   - `stance`：站姿。不是手调骨骼角度，是给脚踝、手腕的位置和武器的指向，脚本解出来。照 `art/hero/lan/build.json` 和小兵的写，站姿要符合这个英雄的性格（brief.json 里有描述），重心稳，武器拿得自然，不穿模。
2. **装武器加出站姿**：`cd MOBA && zsh tools/hero_build.sh art/hero/<id> rig`。它先做 rig 一步（摆正、装武器、导出 `V2R/assets/model/<id>_rigged.glb`），再做 game 一步（站姿加呼吸，导出并压缩到 `public/assets/hero/<id>.glb`）。`mktemp` 报错的话在前面加 `TMPDIR=<一个你能写的目录>`。
3. **看结果，反复改到对**：`BL -b --factory-startup -P tools/blender/views.py -- art/hero/<id>/game.glb art/hero/<id>/check.png 560 "0:8,35:18,90:8,180:8,0:56"`，它出五张 `check_0.png` 到 `check_4.png`（正、斜、侧、背、游戏俯视），用 Read 看。要检查：武器握在手心、方向对、大小和设计图一致、不穿进身体；站姿自然；脚踩在地上。改 build.json 再跑第 2 步。**注意**：每次重跑 rig 都会重写管线的输入模型，所以武器必须在这一步定下来，后面不能再改。
4. **管线摆正自检**：`cd V2R && BL -b --factory-startup -P scripts/blender/prep_rig.py -- assets/model/<id>_rigged.glb <id> 2>&1 | grep -E "^(FORWARD|SKELETON|SELFTEST|SAVED|Traceback|.*Error)"`。要看到 SELFTEST 通过、SAVED。产出 `assets/model/<id>.blend`、`<id>_skeleton.json`。
5. **参考图**：`cd MOBA && BL -b --factory-startup V2R/assets/model/<id>.blend -P tools/blender/hero_ref.py -- V2R "$PWD/art/hero/<id>/stance.npz" "$PWD/art/hero/<id>/ref"`（V2R 写绝对路径），得到 `ref_front.png`、`ref_side.png`；再 `python3 tools/hero_refsheet.py art/hero/<id>/ref_front.png art/hero/<id>/ref_side.png V2R/assets/ref/<id>_ref.png`。用 Read 看一眼：左正面、右侧面，角色完整、握着武器。
6. **模型定了就做个记号**：`touch art/hero/<id>/RIG_READY`。主线看到这个文件就拿 `<id>.blend` 去排队渲染训练集，所以放了记号以后**不许再跑带 rig 的那一步**（模型一变训练集就废了）。然后接着做第 7 步，不用等。
7. **写提示词，出视频**。brief.json 的 `clips` 里每段动作写一个 `V2R/prompts/<id>_<动作>.txt`，格式照 `V2R/prompts/lan_attack.txt`：开头固定那句“固定机位的双机位同步监视画面…”，中间描述角色外形（两句话，和参考图一致）和动作，结尾固定那一长句约束。要点：
   - 动作幅度写大、写具体：重心怎么移、哪只手从哪到哪、抡多大的弧、有没有腾空。用户的原话是“技能的动作张力动作幅度可以大一些”。
   - 一次性的动作（普攻、技能）写成“做一次，收回站姿，停顿片刻，再做一次”，5 秒里有两遍可以挑。
   - 跑步照 `lan_run.txt` 的写法（“像在跑步机上一样快速奔跑、上身前倾、双腿交替高抬向后蹬、步幅大”）。写“稳步行走”出来的是原地踏步，不能用。
   - 角色始终留在各自半边画面中央，不向前移动；不出现任何特效、光效；武器不脱手。
   - 射击、施法这类动作只写身体怎么动，不要写“射出、射击、后坐力、火光、喷出”这些词：写了视频里就会真的画出火光和飞出去的东西，写“不出现特效”也压不住。
   - 贴地的姿势（趴下、翻滚、倒地躺平）两个机位经常画不一致。翻滚类的动作改成“下沉、横移、弹起”；死亡截到跪地为止。
   - 出视频：`cd V2R && PY scripts/jimeng.py video --ref assets/ref/<id>_ref.png --prompt-file prompts/<id>_<动作>.txt --out out/seedance/<id>_<动作>_01.mp4 --title <id>_<动作> --ceiling 50`。一段两三分钟，可以两段同时跑。`--out` 指的文件已经存在时下载会失败但积分照扣，重出要换成 `_02`。
   - 每段出完：`python3 MOBA/tools/vsheet.py <视频> art/hero/<id>/sheets/v_<动作>.jpg 24 8`，用 Read 看抽帧：动作对不对、幅度够不够、有没有走出画面、两个机位是不是同一个动作。

## 第二段：把视频读成动作，装进模型（主线通知“权重好了”以后再做）

主线训练完会把权重放到 `V2R/runs/<id>/jointnet.pt`，并告诉你。

1. **读视频**：`cd V2R && PY MOBA/tools/solve_only.py <id> idle=out/seedance/<id>_idle_01.mp4 run=… attack=…`（一次可以给多段）。每段打印置信度、两机位对不上的帧数、回投偏差。回投偏差 3% 以内算好，5% 以上这段大概率要重出视频。产出 `out/anim/<id>_<动作>/motion.npz`。
2. **写 `art/hero/<id>/motions.json`**，照 `art/hero/lan/motions.json`：`skeleton` 指 `V2R/assets/model/<id>_skeleton.json`，`out_dir` 是 `art/hero/<id>/motions`。帧号是视频的帧号（24 帧每秒，共 121 帧）。
   - 循环动作（idle、run）：`{"src":…,"loop":[最短帧数,最长帧数],"from":从第几帧开始找}`，run 加 `"stride":true`（会打印“原速”：落地脚后蹬的速度，单位是身高每秒）。
   - 一次性动作：`"range":[起,止]` 或 `"segments":[[起,止],[起,止]]`（把中间摆着不动的那几帧剪掉）。普攻和技能只取视频里做得好的那一遍；死亡加 `"settle":false`。
   - 起止帧从第一段的抽帧图里定：从动作开始动的前两三帧，到收回站姿为止。
3. **在 build.json 的 `motions` 里填上每段**（`"run":"art/hero/<id>/motions/run.npz"` 这样），动作名固定用：`idle`、`run`、`attack1`（有第二种普攻就 `attack2`）、`q`、`w`、`e`、`r`、`death`。然后 `zsh tools/hero_build.sh art/hero/<id>`（不加 rig）。
4. **检查动作**：`VIEW_URL="http://localhost:5183/viewer.html?model=/assets/hero/<id>.glb&height=3.2" node tools/anim_sheet.mjs art/hero/<id>/sheets/a idle,run,attack1,q,w,e,r,death 8 close,side 420`，再 `python3 tools/asheet.py art/hero/<id>/sheets/a idle,run,attack1,q,w,e,r,death art/hero/<id>/sheets/anim.jpg close,side`，用 Read 看。要检查：姿势有没有崩（手脚拧反、陷进地里、武器乱甩）、循环接不接得上、一次性动作首尾是不是站姿。有问题先调 motions.json 的起止帧和 `smooth`，再不行重出那段视频。
5. **写 `public/assets/hero/<id>.json`**（动作的时间点，游戏靠它对齐出手）。照 `public/assets/hero/lan.json`：
   ```json
   { "runSpeed": 8.5,
     "attacks": [ {"clip":"attack1","swing":0.30,"hit":0.45,"end":0.95,"hands":["R"],"speed":1.3} ],
     "skills": { "q": {"clip":"q","release":0.50,"end":1.30,"speed":1.2}, "w": {…}, "e": {…}, "r": {…} },
     "death": {"clip":"death"} }
   ```
   - `runSpeed`：run 的“原速”× 游戏里的身高（brief.json 的 `height`）。
   - 时间都是成品动作（30 帧每秒）里的秒数：`swing` 开始挥、`hit` 打到（远程是出手那一刻）、`end` 可以接下一个动作；`release` 技能生效的那一刻。从 `motions/<动作>.npz` 里量：出手的那只手（或武器尖）速度最大、伸得最远的时刻。量不准就看抽帧图估，并在报告里说是估的。
   - `speed` 是建议的播放倍率：管线出的动作偏慢，普攻一般 1.2 到 1.5，技能 1.0 到 1.4，让它干脆有力。

## 报告

每一段做完给主线一段话，写清楚：
- 做到哪一步，产出了哪些文件（路径）。
- 每段视频的检查数字（置信度、对不上的帧、回投偏差），哪几段重出过。
- 花了多少即梦积分。
- 自己看出来的问题：哪里穿模、哪段动作不满意、哪些时间点是估的。不要只报喜。
- 共用脚本的问题或者希望加的功能。


## 掌心方向（2026-11-19 补）

`hero_build.py` 要知道每只手的掌心朝哪边，握拳和装武器都靠它。老办法是假设“静止姿势下掌心朝前”，岚和两种小兵是按这个调的。
有的模型静止时掌心朝后（托尔格），按老办法手指会朝手背卷、武器贴到手背。遇到这种情况在 `build.json` 最外层加一行 `"palm_by_hand": true`：
按解剖学算（右手 L×d，左手取反），不管静止姿势里手朝哪边都对。新英雄建议一开始就加上；已经调好的英雄不要中途改，握法会变。


## 五个人形英雄做完以后补的（2026-11-19，各资源任务的报告里来的）

共用的读视频脚本（`tools/solve_only.py`）有几个通病，五个任务各自在自己的目录里写了修法，还没有收进共用工具。做新的人形角色先看这几条：

- **遮挡多的时候左右腿会认反**（拿盾、拿长武器、跑得快腿是糊的）：解出来一条腿永远在前，跑步原速低得离谱。修法：`art/hero/gorran/fix_legs.py`、`art/hero/osen/resolve.py`。
- **深蹲、跪、弓步解不出屈膝**（求解从全身伸直起步，卡在“腿伸直往后蹬”）：让蹲得低的帧从屈膝开始解。`art/hero/gorran/resolve.py`、`art/hero/osen/resolve.py`。
- **握武器的那只手整体偏约 30 度**：每段视频第 0 帧就是站姿，用它标定，整段补回去。`art/hero/gorran/calib.py` 和 `fix_hand.py`。
- **长武器、双手武器的指向读不准**：弩按两只手腕的连线定（`art/hero/vero/fix_motion.py`）；长锤是对着视频一帧帧写的方向表（`art/hero/torg/prep_src.py`）；拄着的杖把手钉在站姿的位置（`art/hero/moko/fix_motions.py`）。长柄武器的握点要靠柄尾，握在正中身后会有半截柄扫过自己。
- **`hero_motion.py` 算的“原速”偏低两三成**，直接用会脚下打滑。写完时间表用 `node tools/run_probe.mjs <英雄>` 在游戏里量落地脚的速度，按它反推的数填 `runSpeed`。
- **死亡倒地两个机位常对不上**：倒地以后的那段读坏了就截掉，接一个手摆的姿势（薇萝、摩珂是这么做的）。
- **重跑 `solve_only.py` 会把上面这些修正冲掉**，每个英雄目录里有自己的重建脚本（`build_vero.sh`、`build_all.sh`、`rebuild.sh` 之类），改了裁剪用它重建。
- 头和手的放大（`LOOK.head`、`LOOK.hand`）不生效：导出的动作带缩放通道。现在默认值是 1。
