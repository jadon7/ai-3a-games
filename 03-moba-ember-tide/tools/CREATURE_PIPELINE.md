# 非人形英雄（四足）的资源手册

给做资源的并行任务看的。一个任务只做一个角色，从“已经有的 3D 模型”做到“游戏里带全套动作能看”。
人形英雄的手册是 `tools/HERO_PIPELINE.md`，这份只写不一样的地方；出视频、写提示词、裁动作、写时间表这些一样的部分去那边看。

记号：`MOBA` = `/Users/jadon7/Documents/SynologyDrive/code/moba`，`V2R` = `/Users/jadon7/Documents/SynologyDrive/code/video2rig`，
`PY` = `V2R/.venv/bin/python`，`BL` = `/Applications/Blender.app/Contents/MacOS/Blender`。
每个角色有三个名字，任务说明里会给：**管线名** `<n>`（比如 `stag`）、**目录** `art/hero/<dir>`（比如 `art/hero/osen_stag`）、**游戏里的英雄** `<hero>`（比如 `osen`）。

## 和人形的四点不同

1. Tripo 的四足绑骨没有固定的骨骼名，要自己看骨架、写一份映射（`V2R/assets/model/<n>_rigmap.json`）。`V2R/README.md` 的“非双足怪物（四足）”一节是原理，`V2R/assets/model/beast_rigmap.json` 是完整例子，先读这两个。
2. 没有“摆站姿、装武器、握拳”这一步。模型原样用，待机也用视频读出来的动作。出品脚本是 `tools/creature_build.sh`，不是 `hero_build.sh`。
3. 训练图的渲染和训练放到远程那台 4090 上跑（`tools/remote.sh`，说明在 `tools/REMOTE.md`），每个角色单独训一个网络，几分钟。
4. 成品先放在 `public/assets/hero/<n>.glb` 和 `<n>.json`（用管线名，不是英雄名），不要碰 `public/assets/hero/<hero>.glb`，那是人形版，主线来换。

## 步骤

### 一、绑骨、写映射、摆正

1. **绑骨**（Tripo，25 额度，只绑一次）。图转模型的任务号在 `MOBA/art/models_src/log.jsonl` 里，名字是 `hero_<dir>`；模型文件是 `art/models_src/hero_<dir>_raw.glb`。
   ```bash
   cd MOBA && PY tools/tripo.py rig <图转模型的 task_id> --rig-type quadruped --out-format glb     # 打印 task_id
   PY tools/tripo.py wait <绑骨的 task_id> --download V2R/assets/model/<n>_rigged.glb
   ```
   绑出来的骨架如果明显不能用（缺腿、骨头全挤在一处），先停下报告，不要自己再绑第二次。
2. **看骨架**：`cd V2R && BL -b --factory-startup -P scripts/blender/inspect_weights.py -- assets/model/<n>_rigged.glb out/inspect/<n>_w`，它打印每根骨骼管哪块网格，并把骨架画在三视图上（`out/inspect/<n>_w_*_bones.jpg`，用 Read 看）。
3. **写 `V2R/assets/model/<n>_rigmap.json`**，拿 `beast_rigmap.json` 改。要点：
   - `forward` 是模型原始坐标里它面朝哪边；`target_length` 用 1.2。
   - `bones` 里给每根受控骨骼写角色和左右；没用的碎骨头不列。挂错父级的用 `reparent` 改。
   - `joints` 里列要跟踪的点。四只脚、膝、肘、肩、髋、脊柱、脖子、头这些必须有；头上的大件（鹿角尖、头盔）和背上的大件（钟）各加一两个网格标记点，求解时头和躯干的朝向才稳。
   - 尾巴短的可以不跟踪。
4. **摆正自检**：`cd V2R && BL -b --factory-startup -P scripts/blender/prep_rig.py -- assets/model/<n>_rigged.glb <n> 2>&1 | grep -E "^(FORWARD|SCALE|SKELETON|SELFTEST|SAVED|Traceback|.*Error)"`。要看到 SELFTEST 的两个误差都接近 0、SAVED。它还会把几个极限姿势渲染到 `out/inspect/<n>_*.png`，逐张看：腿弯的方向对不对、有没有撕裂、左右有没有写反。不对就改映射重跑，改到对为止。这一步最花功夫，也最重要：映射错了后面全错。
5. **先看一眼模型在游戏里的样子**（还没有动作也能出）：在 `art/hero/<dir>/build.json` 里写
   ```json
   {"name": "<n>", "skeleton": "V2R 的绝对路径/assets/model/<n>_skeleton.json", "out": "art/hero/<dir>/game.glb", "packed": "public/assets/hero/<n>.glb", "tex": 2048, "motions": {}}
   ```
   然后 `cd MOBA && zsh tools/creature_build.sh art/hero/<dir>`，再用查看页截图：
   `VIEW_URL="http://localhost:5183/viewer.html?model=/assets/hero/<n>.glb&height=<身高>" node tools/anim_sheet.mjs art/hero/<dir>/sheets/a idle_pose 2 wide,wside 420`。开发服务器在 5183，一直开着，不要另起、不要重启。
6. **放记号**：`touch art/hero/<dir>/RIG_READY`。之后不许再改映射和模型（训练图会作废）。

### 二、参考图和动作视频

7. **参考图**：第 4 步渲染的静止姿势正面、侧面图在 `V2R/out/inspect/` 里（`ls` 看名字，一般是 `<n>_rest_front.png`、`<n>_rest_side.png`），拼成双机位参考图：
   `python3 MOBA/tools/hero_refsheet.py <正面> <侧面> V2R/assets/ref/<n>_ref.png`。用 Read 看：整只动物要完整在各自半边画面里，四周留一点空。
8. **写提示词、出视频**：和人形一样（`HERO_PIPELINE.md` 第一段第 7 步的全部注意事项都适用），要哪几段动作、每段做什么写在 `art/hero/<dir>/brief.json`。四足的提示词照 `V2R/prompts/beast_gore.txt`、`beast_rear.txt` 的写法，另外注意：
   - 开头那句固定的话照抄，中间写清“同一只四足的 XXX”，把外形特征写上（鹿角上的蜡烛、背上的钟），不然它会把这些东西画丢或者画成别的。
   - 四只脚基本留在原地；跑步写成“在跑步机上原地小跑／奔跑”。
   - 不要让它躺倒、翻身、打滚；死亡写到前腿跪下、头垂下为止。
   - 不出现火光、水花、光效；蜡烛不要写“燃烧”“火苗晃动”，钟不要写“发光”。
   - 出视频：`cd V2R && PY scripts/jimeng.py video --ref assets/ref/<n>_ref.png --prompt-file prompts/<n>_<动作>.txt --out out/seedance/<n>_<动作>_01.mp4 --title <n>_<动作> --ceiling 50`，每段 45 积分，可以两段同时跑。每段出完用 `python3 MOBA/tools/vsheet.py` 抽帧看。
   - 额度：brief 里的每段各一段，另外最多重出 2 段。

### 三、训练（远程）

9. 和出视频同时做，不用等：
   ```bash
   cd MOBA && zsh tools/remote.sh sync && zsh tools/remote.sh push-model <n>
   zsh tools/remote.sh render <n> <n> 1600 <种子> 0 8            # 1600 组随机姿势，约 4 分钟
   zsh tools/remote.sh render <n> <n> 400 <种子+100> 1600 4 rear   # brief 里有人立动作的才加这一批
   zsh tools/remote.sh train <n> 6 runs/beast/jointnet.pt       # 6 轮，从四足兽的权重起步；完了权重自动拉回 V2R/runs/<n>/jointnet.pt
   ```
   这几条命令时间长，放后台跑（`run_in_background`），不要前台干等。远程机器是共用的：只动 `D:\moba-remote` 里自己这个角色的东西，不要删别人的数据。
   训练日志最后一轮的“val(退化后)”在 8 像素以内算正常。想更有把握可以本机考一次：`cd V2R && PY scripts/pipeline.py exam <n> --seed 1`。

### 四、读视频、出品

10. **读视频**：`cd V2R && PY MOBA/tools/solve_only.py <n> idle=out/seedance/<n>_idle_01.mp4 run=…`。回投偏差 3% 以内算好，5% 以上的那一段多半不能用。
11. **写 `art/hero/<dir>/motions.json`**：格式和人形的一样（见 `HERO_PIPELINE.md` 第二段第 2 步、`art/hero/lan/motions.json`），`skeleton` 指 `V2R/assets/model/<n>_skeleton.json`。run 一样加 `"stride": true`。
12. **出品**：`build.json` 的 `motions` 里填上每段，`zsh tools/creature_build.sh art/hero/<dir>`。再用查看页逐段看（机位用 `wide,wside`，`python3 tools/asheet.py <目录> <动作,…> <输出.jpg> wide,wside` 拼图）：脚有没有踩进地里或者飘起来、头和背上的大件有没有乱抖、循环接不接得上。
13. **写 `public/assets/hero/<n>.json`**（时间表，格式见 `HERO_PIPELINE.md` 第二段第 5 步），多一项：
    ```json
    "points": {"hand": "<头部那根骨骼的名字>", "chest": "<躯干中段那根骨骼的名字>", "up": 0.3}
    ```
    非人形没有“右手”，技能的出手点用 `hand` 指的骨骼（鹿：头；龟：头），`up` 是再往上抬多少米。名字照骨架文件里的写。
    先读 `src/map/game/heroes/<hero>.ts`（只读，不要改）：看每个技能用哪段动作、特效什么时候出，`release` 对到动作里发力的那一刻。
14. **在游戏里看**：
    ```bash
    MOBA_Q="glb=<n>&look=height:<身高>,ring:<圈>,head:1,hand:1" node tools/kit_test.mjs <hero> <你的输出目录>
    ```
    `height` 是连头上、背上的东西一起算的总高（米），`ring` 是脚下的圈放大几倍，试到看着合适，把数字写进报告。看动作和特效对不对得上、个头和小兵比合不合适、跑起来步子和移动对不对得上。

## 不许做的事

- 不改 `src/` 下的任何东西，不改 `tools/` 里的共用脚本（发现问题写进报告）。自己的小脚本放在 `art/hero/<dir>/` 里。
- 不碰别的角色的文件，不碰 `public/assets/hero/<hero>.glb` 和 `<hero>.json`。
- 不按名字结束进程（`pkill`、`killall` 都不行），要停自己起的进程用确切的 PID。不运行会一直等输入的命令。`rm` 只写完整的绝对路径。
- Tripo 只绑一次骨；即梦只出 brief 里的那几段加最多 2 段重出。花了多少在报告里写清楚。

## 报告

做完写：产出了哪些文件；映射里做了哪些取舍；每段视频用了哪些帧、置信度和回投偏差；训练最后一轮的数字；游戏里合适的 `height` 和 `ring`；时间表的各个时间点；游戏里看下来的问题（穿模、抖、对不上）；和 brief 不一致的地方；花了多少积分；共用脚本的问题。先说结论，问题不要藏。


## 做完两个四足以后补的（2026-11-19，钟龟和烛角鹿的任务报告里来的）

- **`inspect_weights.py` 不画骨架图**，只存 PNG 和骨骼的二维坐标（`bones2d.json`）。要看骨架得自己画，现成的脚本：`art/hero/torg_turtle/draw_bones.py`。
- **`prep_rig.py` 的极限姿势检查是按那只四足兽的骨骼名写死的**，换一只动物只测到一部分。自己另写检查：`art/hero/torg_turtle/pose_check.py`、`art/hero/osen_stag/scripts/pose_tests.py`。
- **`target_length` 不一定用 1.2**：连头上的东西一起比身子还高的（鹿），按 1.2 会顶到画面上沿，用 1.0。
- **Tripo 的四足绑骨会有错绑**（鹿的尾巴骨管着吊炉和两条腿上各一圈）。不用重新绑，直接改 GLB 里的权重：`art/hero/osen_stag/scripts/fix_weights.py`。
- **硬的大件（背甲、钟、头盔）让一根骨骼管**，别让脊柱的弯曲把它拧变形；象腿的中段关节要允许两个方向都能折。
- **放了 `RIG_READY` 以后，映射里只许改活动范围**（骨骼和跟踪点不变，旧训练图的标签就还有效），改完按新范围补渲几百组。
- **远程训练别两个同时跑**：那台机器 32G 内存。`remote.sh train` 的读图进程现在默认 6 个；训练没跑完不会再把半截的权重拉回来。
- **`runSpeed` 的换算**：四足摆正以后身高不是 1。用 原速 × 游戏里的身高 ÷ 摆正后的模型高度（龟 0.906，鹿 1.1225，看 `prep_rig.py` 的输出）。算完用 `FEET=左前脚骨骼,右前脚骨骼 node tools/run_probe.mjs <英雄>` 在游戏里量一下落地脚滑不滑。
- **共用的读视频脚本对远侧被挡住的腿会解错**（回投偏差看不出来，腿会甩到另一条腿的位置）。鹿是用自己的 `art/hero/osen_stag/scripts/solve_stag.py` 解的：读数先清一遍野点、被挡的腿借近侧同名腿的前后位置、稳健损失的门槛从宽收到窄。腿长、互相遮挡多的动物照这个来。
- **裁动作别用 `hero_motion.py` 的 `segments` 接高度不一样的两段**（后面整段会被平移，落地帧陷进地里），用变速代替剪断：`art/hero/torg_turtle/retime.py`。
- **视频和特效左右相反时**可以把动作镜像：`art/hero/torg_turtle/mirror_motion.py`。
- 腿短的动物，步子完全不打滑会碎得难看；可以把移速降一点、`runSpeed` 取个折中，在报告里写明。
- 血条默认按身高放，头在身体前面或者会人立的（鹿），在英雄定义的 `look` 里加 `bar`（再抬高多少米）。
