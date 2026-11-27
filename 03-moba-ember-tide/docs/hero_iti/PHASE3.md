# 新刺客伊缇 · 第三阶段：模型和大幅度动作

先完整读 `docs/hero_iti/DESIGN.md`（技能设计，“动作”一节是这次的清单）、`docs/round9/COMMON.md`（规矩、怎么跑、回归、汇报格式）、**`docs/round9/NEW_HEROES.md`（第九轮四个新英雄从设定图做到游戏里带全套动作的做法，照它做）**、`tools/HERO_PIPELINE.md`（从头读到尾）、`docs/style_b/HERO_B.md`（卡通版的模型、材质、武器、出品的做法和坑）、`tools/MONSTER_PIPELINE.md` 最后一节、`tools/REMOTE.md`。全程中文。**这个英雄分阶段做，每阶段做完由调度找用户确认**：第三阶段只做模型和动作，不写技能代码、不登记名册（第四阶段的事）。

## 已经定了的

- 外形用户说“你来定”，定了**方向 A**：银白短发女刺客、深紫灰贴身甲、暗铁护臂、半张暗铁面具、绯红发光的眼睛、长绯红围巾、双持**反握直刃**。设定图 `art/hero_iti/concept/iti-a-sheet.png`（建模用）、`iti-a-game-v2.png`、`iti-a-poster.png`，武器 `iti-weapon-v2.png`；说明 `docs/hero_iti/concept/README.md`（里面列了 A 的毛病：掌心朝上、动作图里正手握、刃画弯）。
- 画风是卡通厚涂（路子一），材质名以 `_b` 结尾走 B 的处理（`HERO_B.md`“材质”一节）。

## 要做的

1. **建模图**：从 `iti-a-sheet.png` 做 `art/hero_iti/ref.png`。**围巾的两条长飘带抠掉**，只留脖子上那一圈（照第九轮赫达把炉子抠掉的做法，`art/hero/hedda/make_ref.py`）：飘带交给 Tripo 会烤成一块硬布，第 4 步用代码做。
2. **Tripo**：模型（`face_limit` 40000、`detailed`，`name` 用 `hero_iti`）、绑骨（biped、mixamo）；渲几个角度看结构，不行最多重出一次。
3. **武器**：双直刃照 `iti-weapon-v2.png` 用脚本建（照 `art/style_b/lan/gear.py`，**颜色直接写 sRGB，不要先转线性**——岚那份踩过这个坑，`b-polish` 修过），材质名 `weapon_b`；反手握：刃朝小臂后方。
4. **围巾飘带（代码）**：新建 `src/map/hero/scarf.ts`——两条从脖子骨骼拖出去的飘带，用简单的弹簧质点链（每条十几个点，跟着脖子走、有惯性和重力、不穿地），渲染成有宽度、两面可见的带子，卡通厚涂的绯红（亮面、暗面两阶，尾部渐变成火舌形）。跑、冲刺、闪现（瞬移时不要拉出一条横贯画面的长带：瞬移就整条重置到新位置附近）时都要好看。在 `hero/hero.ts` 里只做**新增**的挂钩（kit 的 `look` 里有 `scarf` 才挂），老英雄一点不变。
5. **动作**（照 `NEW_HEROES.md` 和 `HERO_PIPELINE.md`：即梦出视频 → 远程训练和读成动作 → 烘到骨架上；人形从 `runs/heroes5/jointnet.pt` 起步）。10 段，幅度要大、有张力（设计方案“动作”一节）：
   - 待机（压低重心的蹲姿，双刃反握在身侧）、跑（大幅前倾的冲刺跑，双手向后拖）
   - 普攻 1、2（左右交替的大幅旋身斩）
   - Q 一二段（低身前冲斩）、Q 三段（腾空前空翻下劈，落地单膝跪地）
   - W（后撤一步、接前扑冲刺）、E（一缩、在身后出现、反手上挑刺）
   - R（起跳、空中连续翻转劈砍、落地双刃胸前交叉收势）、死亡
   - 提示词里**锁死“反手握”“直刃”**（设定图任务说动作图里老是画成正手、刃画弯）；时间表里写清 `hit`、`release`、`end`，出手时刻照手感的规矩（普攻发力到打中 ≤0.3 秒、普通技能出手 ≤0.3 秒、大招 ≤0.4 秒，R 空中连砍是技能本身的时长）。
6. **出品**：`public/assets/hero/iti.glb`、`iti.json`，手机档 `m/iti.glb`（`tools/lite_glb.mjs`）。用不上的法线粗糙度贴图去掉（`tools/style_b/strip_maps.mjs`）。
7. **在游戏里看**：还没有技能代码，借岚的技能看（`kit_test.mjs` 的写法，`MOBA_Q` 里写 `glb=iti&look=height:3.3`，再带上围巾的开关）。截：站、跑、每段动作的连拍；和小兵、岚、葛隆站一起的个头图；B 的草地、石板、红土上显不显眼（`tools/style_b/pop.mjs`）；围巾在跑、冲刺、急停、转身时的样子（录像）。

## 在哪干活

- worktree `/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model`，分支 `iti-model`，测试端口 5253（已建好）。**每条命令开头都写 `cd <worktree> &&`**，文件用 worktree 下的绝对路径；主目录的 `src/` 不要碰。过程文件放 worktree 下 `art/hero_iti/`（二进制交之前 `rsync -a --ignore-existing` 拷到主目录同一路径，只拷主目录没有的）。
- 证据放主目录 `/Users/jadon7/Documents/SynologyDrive/code/moba/docs/hero_iti/model/`。在自己分支上提交，不合并、不切分支、不 push。
- 查看页（`viewer.html`）和测试场截图用你自己的 5253；主目录的 5183、5190 别动。
- 另一个任务 `iti-fx2` 同时在 `lab/fx_iti/` 做特效，你不碰。

## 额度

Tripo ≤150（模型 40、绑骨 25、预留一次重出）；即梦 ≤700（10 段动作视频每段约 45，加几次重出；`V2R/scripts/jimeng.py video … --ceiling 50`，可以两段同时跑）。开始和结束各查一次余额（Tripo：`/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python tools/tripo.py balance`；即梦：`dreamina-canvas auth account --format json`）。远程机器（`ssh jadon7-wsl`，`tools/remote.sh` 自己排队）只用已有的免密登录。

## 规矩

结束进程只按确切 PID（远程机器上也一样），禁止 `pkill`、`killall`；`rm` 只写完整绝对路径；不要跑会等输入的命令；长命令放后台；不打印、不复述 `~/.config/video2rig/env`，`CODEX_API_KEY` 不要动；拼图用 `/opt/homebrew/opt/python@3.14/bin/python3.14`；ffmpeg 要加 `DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib`；无界面 Chrome 用完在 finally 里关；磁盘剩约 40 GB，渲染图和逐帧看完就删。

## 汇报

照 `docs/round9/COMMON.md`：先给结论（能不能用、最大的问题），再写：模型和绑骨的情况；每段动作的时间点、实测 runSpeed、滑步多少；围巾怎么做的、好不好看；游戏里的 `height`、个头图；显不显眼；毛病（穿模、抖、脚陷地、循环接不上）；Tripo 和即梦各花多少；没验证的。回归四项要过。
