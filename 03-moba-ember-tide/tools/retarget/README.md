# 把旧动作套到同一个角色的新模型上（换画风 B · 第二批用）

换画风第 2 档的做法是：角色按 B 风格重出模型和绑骨，动作不重出视频，沿用现在的。这个目录里的工具做“沿用”这一步：
读旧模型、新模型的静止骨架，把旧的 `motions/*.npz`（`tools/hero_motion.py` 的产出）换算成新骨架上的同名动作，修脚、修副手，量毛病，出拼图和录像，最后照旧交给 `tools/hero_build.sh`（人形）出游戏用的 GLB。

不花积分：不调 Tripo、不调即梦、不用远程显卡。全部在本机，一个角色从套到出拼图约 1 分钟。

## 文件

| 文件 | 做什么 | 怎么跑 |
|---|---|---|
| `dump_rig.py` | 把一个模型读成纯数据：骨架（世界坐标的静止矩阵）、蒙皮网格、哪些顶点是武器 | Blender |
| `rig.py` | FK、蒙皮、四元数（numpy），别的脚本共用 | 库 |
| `retarget.py` | 套动作本身（旋转换算、根位移缩放、脚的 IK 锁地、头不入地、副手跟主手） | V2R 的 python |
| `measure.py` | 量毛病：脚滑（米/秒）、陷地/飘（厘米）、跑步该填的 runSpeed、出手时刻、两手距离、手插进身体 | 库 |
| `run_case.py` | 一个试验从头跑到尾：套 → 量 → 拼图 → 录像 →（可选）出品 | V2R 的 python |
| `render.py`、`sheet.py`、`label_frames.py` | 渲染格子和录像帧（Blender Workbench，按 npz 直接摆骨骼）、拼图、录像加字 | Blender / python3.14 |
| `table.py`、`page.py` | 数字表、查看页 | python / python3.14 |
| `toonify.py` | 把现有模型改成卡通比例（头、手放大，腿缩短），这次验证用；第二批用不上 | Blender |
| `game_probe.mjs` | 在游戏测试场里看新模型（`glb=` 换模型），截图并量跑步滑步 | node |

记号：`PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python`，`BL="/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup"`，`P314=/opt/homebrew/opt/python@3.14/bin/python3.14`。命令都在 MOBA 根目录（或 worktree 根目录）跑。

## 原理（出了问题时看）

- 动作文件存的是每根骨骼“相对它自己静止朝向”的旋转。不同的 Tripo 绑骨，骨骼的静止朝向（roll）、A 字站姿手臂张开的角度都不一样，所以不能原样拿过去用，要先换到世界坐标再换回来。
- **旋转**两种搬法，`case.json` 里 `mode`（整体）和 `mode_bones`（按骨骼名的一部分单独定）：
  - `dir`（人形默认）：目标骨骼在世界里指向和源一样的方向，连同扭转。标架按“骨骼方向 + 一根参考轴”搭；手的标架按“小指根→食指根”和前臂方向搭，和 `hero_build.py` 装武器用的是同一套，所以**武器在世界里的朝向和原来一模一样**。A 字站姿差 8 度、肩宽差四成都不影响姿势。
  - `delta`（四足默认）：把“相对静止转了多少”原样搬。两边静止姿势都是自然站姿时用。跨物种时再加 `ref_pose`：以两边各自 idle 的第 0 帧为准，“源从它的站姿转了多少，目标就从它的站姿转多少”（不加的话鹿的抬头角度给到猞猁身上，猞猁会一直低着头）。
- **根位移**按胯高之比 `k` 缩放（腿短了，蹲、冲、跳的幅度跟着变小，姿势不变）。
- **脚**（`ik`，默认开）：每条腿两段骨骼 + 末端（人形：大腿/小腿/脚；四足：上臂/前臂/掌，大腿/小腿/跖骨），脚的朝向保持旋转搬过来的结果，只解两段骨骼。
  - 哪几帧算踩地：看**源**里这只脚网格的最低点（离地 2% 身高以内；跑步放宽到 3.5%）。
  - 竖直：脚底最低点的高度照源的（乘 `k`），贴地那一截压成正好贴地（源自己陷地、飘的那几厘米顺手修掉），往上平滑接回去，不跳。
  - 水平：贴地的那些脚底顶点在地面上“照源的走法走”（乘 `k`）。源里慢于 `clean`（默认 0.1 身高/秒）的那点滑动当抖动去掉；攒下的修正超过 `cap`（默认 5% 身高）就不再修，说明源本来就在拖着脚走（比如 `hero_motion.py` 把结尾拉回原点）。抬脚时在空中把修正平滑地还回去。
  - 跑步是原地跑：贴地顶点改成一个匀速往后走，这个速度就是新模型该填的 `runSpeed`（`build` 一步按“新的/旧的”比例把时间表里的数改好）。
  - 腿伸直了也够不着：把胯放低一点再解一遍（报告里的“胯放低最多”）。
- **手撑地**（人形默认开，`"arms_ground": false` 关掉）：源里手（连同手里的武器）离地 10% 身高以内的帧，手的最低点照源的离地高度放，用手臂两段骨骼解；离地远的帧只管不穿到地下。腿短了胯就低，源里“手撑着地”的姿势（岚的死亡）到新模型上手和刀会插进地里，这一步就是修它的。
- **头不入地**（`ground_chains`）：某条链（四足的脖子）管的顶点穿到地下时，从链根往上抬到刚好贴地，前后几帧平滑。源自己就插进地里的帧（原版的死亡常这样），目标插得一样深（乘 `k`）就不管；最多抬 `max_deg`（默认 35）度，抬满了还在地下的报“还插在地下”，留给手修。
- **副手跟主手**（`hands`，双手武器用）：源里两只手一起握着武器的帧（两手距离不超过“握着时”的 1.25 倍，1.6 倍以上完全放开），副手手腕保持源里“相对主手”的位置，用手臂两段骨骼解。
- 时间不动：输入输出帧数、帧率一样，出手时刻（`hit`、`release`）不用改；`measure.py` 用武器尖速度曲线的互相关核对（报告里“出手时刻差”）。

## 第二批：一个人形角色怎么走（以岚为例）

前提：B 风格的新模型已经由 Tripo 出好、绑好骨（Mixamo 骨骼名），放在 `art/hero/lan_b/tripo_rigged.glb`。

1. **装武器、摆站姿**：复制 `art/hero/lan/build.json` 到 `art/hero/lan_b/build.json`，改 `raw`（新模型）、`rigged`（**写一个新路径**，比如 `V2R/assets/model/lan_b_rigged.glb`，千万别指回旧的 `lan_rigged.glb`，`rig` 一步会覆盖它）、`out`、`packed`（先放 `art/hero/lan_b/lan_b.glb`，别直接写 `public/`）、删掉 `motions`。武器的 `length` 是按身高算的：新模型比例变了，对着设计图重调。然后照 `tools/HERO_PIPELINE.md` 第一段 2、3 步：`zsh tools/hero_build.sh art/hero/lan_b rig`，看 `check_*.png` 改到武器握对。**不用**做第一段 4–7 步（摆正自检、参考图、视频）。
2. **读两个模型**：
   ```bash
   $BL -P tools/retarget/dump_rig.py -- $V2R/assets/model/lan_rigged.glb   art/style_b/retarget/rigs/lan.npz
   $BL -P tools/retarget/dump_rig.py -- $V2R/assets/model/lan_b_rigged.glb art/style_b/retarget/rigs/lan_b.npz
   ```
3. **写 `art/style_b/retarget/lan_b/case.json`**，照 `art/style_b/retarget/lan_to_toon/case.json` 改 `tgt_rig`、`tgt_model`、`name`、`labels`。双手武器的加 `"hands": {"lead": "Right", "follow": "Left"}`（见 `vero_to_toon`）。
4. **套、量、看**：`$PY tools/retarget/run_case.py art/style_b/retarget/lan_b/case.json`。产出在 case 目录：`motions/fk|ik/*.npz`、`measure.json`、`sheets/<动作>.jpg`、`video/*.mp4`。`$PY tools/retarget/table.py art/style_b/retarget/lan_b/measure.json` 打印对照表。看什么见下一节。
5. **出品**：`$PY tools/retarget/run_case.py art/style_b/retarget/lan_b/case.json build`。它照源的 `build.json` 写一份新的（模型换成新的，动作换成 `motions/ik/`，站姿的手腕、脚踝跟着肩和脚的静止位置挪），调 `tools/hero_build.sh`，产出 `build/<name>.glb` 和改好 `runSpeed` 的时间表 `build/<name>.json`。
6. **进游戏看**：把这两个文件放到 `public/assets/hero/<名字>.glb/.json`（测试用的名字，不要覆盖正式的），测试服务器开着时：
   `MOBA_URL=http://localhost:<端口>/map.html node tools/retarget/game_probe.mjs lan <输出目录> <名字>`（站、跑、普攻截图 + 跑步滑步），
   `MOBA_URL=… MOBA_Q="glb=<名字>" node tools/kit_test.mjs lan <输出目录>`（每个技能连拍，看特效和出手对不对得上）。
   没问题了再由主线换掉正式的 `public/assets/hero/lan.glb` 和 `lan.json`。

四足：新模型先照 `tools/CREATURE_PIPELINE.md` 第一段写映射、`prep_rig.py` 摆正出 `.blend`（不用训练、不用出视频），`dump_rig.py` 读 `.blend`（`$BL <模型>.blend -P tools/retarget/dump_rig.py -- - <输出.npz>`）。Tripo 四足绑骨的骨骼名每次都不一样，新旧骨骼名对不上时 `case.json` 的 `map` 要按骨骼角色手写（照 `stag_to_kaz/case.json`）；名字一样就写 `"map": "same"`（照 `kaz_to_toon/case.json`）。`legs`、`ground_chains` 都要写。出品走 `tools/creature_build.sh`（它只认 `V2R/assets/model/<name>.blend`）。

## 套完看什么、怎么手修

看 `measure.json`（或 `table.py` 的表）和拼图，和“源”那一行比：

| 看到 | 原因 | 修法 |
|---|---|---|
| “只搬旋转”那行脚陷地、飘、拖地；“加脚 IK”正常 | 比例变了（腿短、脚大） | 默认就是 IK 那套，不用管 |
| IK 后某段脚滑还是大（p90 好几米/秒） | 源里本来就在拖着脚走（源那一行也大） | 一般不修（和现在游戏里一样）；要修就调大 `ik.clean`（身高/秒）、`ik.cap` |
| 跑步“一步内不匀”大 | 源的原地跑脚的速度本来就不匀 | 改不了；`runSpeed` 用 `build` 算出来的数 |
| 胯放低最多 > 2% | 腿太短，源的姿势伸得太开 | 看拼图，蹲得太低就给那段单独调 `k` |
| 手插进身体的帧% 比源高很多 | 头、胸变大，手臂贴身的动作会插进去 | 目前只量不修：在 Blender 里给那几帧的肩、肘加一点外展（或者 `mode_bones` 把手臂改成 `delta`）。量法见下面“不可靠的地方” |
| 副手离握点（改后）还有 1% 以上 | 手臂短，够不着 | 弩、锤的握点位置改一下（`build.json` 的 `grip`），或接受 |
| 四足的头插进地里 | 新模型的脖子、头比例变了 | `ground_chains` 已经抬了（报告里“抬头最多”）；抬了几十度的那几段要重看，可能要手调 |

## 不可靠的地方

- 手插进身体用的是“躯干、头的胶囊”（半径取网格到骨骼的 70 分位），背上有大件（赫达的炉子）或者衣摆很大的模型会量多，只能横向比，不能当绝对数。
- 出手时刻的“最快”是武器尖速度最大的那一帧，弩、法杖这类出手时不怎么动的武器量不准；时刻差用的是整条速度曲线的互相关，靠得住一些。
- 脚滑、跑步速度是在动作数据里量的；游戏里的实测（`game_probe.mjs`）判踩地的办法不一样，数会差一两成，看趋势。
- 手指：`hero_build.py` 出品时按 `grip` 把手指换成握拳，`render.py` 的拼图里手指是动作里原来的样子。
- 关节扭曲、蒙皮权重的毛病（大头和脖子之间的过渡、大手的手腕）是模型的事，这里看不出来，要在出品的 GLB 上看。

## 这次验证怎么复现（2026-11-20，`b-retarget`）

模型、读出来的骨架、套好的动作都是二进制，不进 git（`.gitignore`），在 worktree 的 `art/style_b/retarget/` 里；几秒就能重新生成：

```bash
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model; R=art/style_b/retarget
for n in lan vero seren hedda; do $BL -P tools/retarget/dump_rig.py -- $V/${n}_rigged.glb $R/rigs/$n.npz; done
for n in stag kaz; do $BL $V/$n.blend -P tools/retarget/dump_rig.py -- - $R/rigs/$n.npz; done
$BL -P tools/retarget/toonify.py -- $V/lan_rigged.glb  $R/models/lan_toon_rigged.glb                       # 头 1.35、手 1.4、腿 0.75、脚 1.1
$BL -P tools/retarget/toonify.py -- $V/vero_rigged.glb $R/models/vero_toon_rigged.glb 1.35 1.4 0.75 1.1 1.0 0.85   # 再加手臂 0.85
$BL $V/kaz.blend -P tools/retarget/toonify.py -- - $R/models/kaz_toon.blend $R/models/kaz_toon_spec.json
for m in lan_toon_rigged vero_toon_rigged; do $BL -P tools/retarget/dump_rig.py -- $R/models/$m.glb $R/rigs/${m%_rigged}.npz; done
$BL $R/models/kaz_toon.blend -P tools/retarget/dump_rig.py -- - $R/rigs/kaz_toon.npz
for c in lan_to_toon vero_to_toon lan_to_vero lan_to_seren lan_to_hedda stag_to_kaz kaz_to_toon; do $PY tools/retarget/run_case.py $R/$c/case.json; done
$PY tools/retarget/run_case.py $R/lan_to_toon/case.json build
$P314 tools/retarget/page.py <主目录>/docs/style_b/b-retarget <开头说明.html> $R/lan_to_toon $R/vero_to_toon …
```

七个试验：`lan_to_toon`（岚 → 卡通比例的岚）、`vero_to_toon`（薇萝 → 卡通比例、手臂也缩短的薇萝，试双手弩）、`lan_to_vero`/`lan_to_seren`/`lan_to_hedda`（岚的动作给别的英雄的身体，比例差得更多）、`stag_to_kaz`（鹿 → 猞猁，跨物种）、`kaz_to_toon`（卡兹 → 卡通比例的卡兹）。
