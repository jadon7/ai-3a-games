# 换画风 B（明快卡通）· 共同说明

你是 Opus 5.5。规矩、怎么跑、回归四项、汇报格式照 `docs/round9/COMMON.md`（先完整读），这一份写换画风特有的。全程中文。

## 为什么换、换成什么

用户看完第九轮验收页（里面有换画风的成本评估）以后说：“风格换卡通的吧”。评估报告在 `docs/round9/stylecost/REPORT.md`（先读），推荐的是**第 2 档**：环境全换 B，18 个角色（10 英雄、6 野怪、2 小兵）按 B 重出模型，旧动作套到新骨架上；特效、界面、海报、图标跟着换。我们照第 2 档做。

**目标画风 B“明快卡通”**：阶段 2.2 并排给过两个方向，当时用户选了 A（厚涂写实，现在的游戏）。B 的设计稿是 `art/concepts22/env_me_b.png`（沉月会一侧）、`env_foe_b.png`（烬誓庭一侧），出图提示词在 `tools/jobs/concepts22.json`（`c22-env_me_b`、`c22-env_foe_b`），其中画风那句原话：

> 王者荣耀的峡谷那样明快干净的卡通厚涂游戏美术，形体圆润概括，贴图简洁，颜色明亮清爽。不要破败的废墟感，不要骷髅、锁链、尖刺，不要满地杂物，不要到处发光，不要暗黑哥特风，不要黑色粗描边。

评估量出来的要点：现在和 B 最大的差距是**亮度**，不是饱和度（我方草地 B 是 RGB 129,184,87，现在 75,102,42；整屏平均亮度 B 0.66、现在 0.37；B 的饱和度反而更低）。B 只画过环境，**没画过英雄**；英雄的 B 风格要先出设定图请用户选。

换之前的版本已经存档：`main` 分支和标签 `v9-painted` 就是线上 moba.dsxzai.com 现在的厚涂写实版，随时能回去。换画风全部在分支 `style-b` 上做。

## 分两批

- **第一批（现在，四个任务并行）**：
  - `b-concept`：写 B 的风格规矩；岚和葛隆按两个路子各出 B 风格设定图（请用户选路子）；塔、水晶的 B 风格设计稿。**只出图，不改代码。**
  - `b-toon`：环境的卡通光照、调色、草、水、树的颜色，地面九个区按 B 重画。
  - `b-walls`：墙、石头、台阶、城墙、树的造型改圆润干净，平铺贴图换干净的。
  - `b-retarget`：把现有动作套到新骨架上的工具，不花积分先验证（这是第 2 档最大的技术风险）。
- **第二批（用户选定英雄的路子以后）**：先拿岚一个走完整条线（B 设定图 → Tripo 模型和绑骨 → 套旧动作 → 进游戏），走通了再分批做其余角色；建筑照 `b-concept` 的设计稿让 Codex 重建；特效换色、界面换配色、海报图标重出、宣传片重剪。

## 你在哪干活

| 任务 | worktree / 分支 | 测试端口 | 改不改代码 |
|---|---|---|---|
| `b-concept` | 不用 worktree，图放主目录 `art/style_b/concept/`，说明放 `docs/style_b/b-concept/` | 不需要 | 不改 |
| `b-toon` | `.claude/worktrees/b-toon` / `b-toon` | 5221 | 改 |
| `b-walls` | `.claude/worktrees/b-walls` / `b-walls` | 5222 | 改 |
| `b-retarget` | `.claude/worktrees/b-retarget` / `b-retarget` | 5223 | 只加新工具 |

- worktree 已经建好（从 `style-b` 切的），依赖软链接也建好了。命令行默认在主目录，**每条命令开头都写 `cd <你的 worktree 绝对路径> &&`**，文件都用 worktree 下的绝对路径；主目录的 `src/` 不要碰。测试服务器在 worktree 里后台启动：`MOBA_PORT=<端口> npx vite --config vite.test.config.ts`，干完停掉。
- 证据写到主目录 `docs/style_b/<任务名>/`。在自己的分支上提交（说明末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`），不合并、不切分支、不 push。
- **“改前”**：主目录 5190 的测试服务器现在就是厚涂写实版（`style-b` 还没有任何画风改动），一开工就先录好改前的截图；之后调度合并别的任务，5190 会变。
- 评估任务做过一个“只改光照、着色、调色”的试验，在分支 `r9-stylecost`（提交 `82f6297`，代码集中在 `src/map/toon.ts`，另外 7 个文件各改几行，挂在 `?toon=1` 开关上；参数说明在 REPORT.md 附录）。`b-toon` 和 `b-walls` 都先把这个分支合进自己的分支当起点（两边合的是同一个提交，以后合并不会冲突）。`style-b` 上的目标就是 B，开关可以改成默认开或者去掉，`b-toon` 定，汇报里写清。

## 文件归属

| 文件 | `b-toon` | `b-walls` | `b-retarget` |
|---|---|---|---|
| `src/map/toon.ts`、`world/main.ts` 的光照和调色、天光、影子 | 归你 | 不碰 | 不碰 |
| 地面贴图（`public/assets/map/`）、草（颜色表、草丛）、水 | 归你 | 不碰 | 不碰 |
| 墙、石头、台阶、城墙（`slice/stone.ts`、`world/ramparts.ts` 等）、平铺贴图（`public/assets/slice/tex/`）、树（`trees.ts`） | 树和草的颜色可以改 | 归你（形状、材质、贴图） | 不碰 |
| 建筑（塔、水晶、出生点）、英雄、小兵、野怪的模型和材质 | 不碰 | 不碰 | 不碰（第二批换） |
| 特效（`fx*.ts`、`heroes/*.ts`）、界面（`hud.ts`、`lobby.ts`、`uikit.ts`） | 不碰 | 不碰 | 不碰 |
| `tools/` | 新建自己的脚本可以；共用脚本不改 | 同左 | 新建 `tools/retarget/`；共用脚本不改 |

`r9-stylecost` 那 7 个文件各几行的改动里，落在 `b-walls` 范围内的（墙的石纹明暗、墙色）由 `b-walls` 接着改，`b-toon` 不再动；拿不准的写进汇报。

## 环境上的坑

- 本机 `ffmpeg` 起不来（Homebrew 的 x265 升到了 4.3）：录像时只给 ffmpeg 这一个命令前加 `DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib`。不要 brew 升级或重装任何东西。
- 本机 `python3` 是 3.15，没有 Pillow：拼图用 `/opt/homebrew/opt/python@3.14/bin/python3.14`。
- 管线的 Python 是 `/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python`，Blender 是 `/Applications/Blender.app/Contents/MacOS/Blender`（`-b --factory-startup` 无界面跑）。
- 即梦出图要排队：`zsh /Users/jadon7/Documents/SynologyDrive/code/moba/tools/jimeng_lock.sh <jobs.json 的绝对路径>`，jobs 的格式看 `tools/jimeng_gen.py` 开头，`out` 写主目录下的绝对路径。B 的两张设计稿当初用的模型是 `jm_image_model_gg_bp`（约 25 积分一张）；第九轮海报试下来 Image 2.5 Pro `jm_image_model_lib_s`（4 积分一张）照片质感强、听话。各任务的积分上限写在下面，开始和结束各查一次余额（`dreamina-canvas auth account --format json` 里的 `availableCredits`）。下载的目标文件已经存在会报错但积分照扣，出图前把旧文件挪走。
- 几个任务同时用显卡，偶尔整页报 Shader Error 或者无界面 Chrome 断开（detached Frame），重跑。同一时间只开一个你自己的无界面 Chrome。
- 用户的口味（一直在说的）：干净、融合、发光克制；反感杂、碎、老、光污染；重点处要精致；英雄要比小兵显眼。业内有定式的东西照 LoL、Dota 2、王者荣耀。

## 各任务

### `b-concept`（即梦上限 300 积分）

1. 读 REPORT.md、两张 B 设计稿和提示词、`docs/round9/heroes/DESIGN.md`、岚和葛隆现在的设定（`art/hero/lan/`、`art/hero/gorran/`、`concepts/heroes/` 里的设定图、`public/assets/ui/splash/lan.webp`、`gorran.webp`）。
2. 写 `docs/style_b/STYLE.md`（写不了 .md 就放进汇报，调度存）：
   - 环境的规矩：从两张设计稿量出来的颜色（草、土、石、水、青铜、暗铁各给几个色值）、明暗关系、形状（圆角、厚板、少分块）、细节的主次。
   - 角色的规矩，分两个路子：**路子一：王者式卡通厚涂**（B 原意：圆润概括、贴图简洁、明亮清爽、不要黑色粗描边；比例略敦实，27 米的游戏镜头下一眼认得出）；**路子二：日式赛璐璐**（干净的细描线、平涂色块加一阶阴影、更“动漫感”）。两条都要保住每个英雄的身份：轮廓、武器、阵营色、主色。还要写清英雄怎么在亮地面上显眼（颜色比地面亮、轮廓清楚）。
3. 出图（都放 `art/style_b/concept/`）：
   - 岚、葛隆各两个路子：一张**游戏镜头图**（和 B 设计稿同样约 55 度的俯视镜头，站在 B 的地面上，旁边两三个小兵当比例）和一张**正面 A 字站姿的设定图**（纯灰底、居中、四周留白，照 `tools/HERO_PIPELINE.md` 里建模用设定图的要求，以后直接拿去 Tripo）。
   - 建筑：沉月会和烬誓庭的塔、水晶各一张 B 风格设计稿（照阶段 2.2 的做法，参考 `art/concepts22/` 里 A 方向的塔和水晶，和 B 的环境设计稿配套）。
   - 一张对比总表：每个英雄“现在游戏里 / 路子一 / 路子二”并排；建筑“现在 / B”并排。
4. 不改代码、不提交 git（调度来提交）。交完就停，等用户选路子。

### `b-toon`（即梦上限 400 积分，用于地面重画）

1. 先在主目录 5190 录改前：和评估任务同样的机位（我方 `cam=-20,2,36,50,0,-20`、对方 `cam=22,-2,36,50,0,0`、水晶 `cam=-90.3,0,48,58,4`，都加 `&nohud=1&hero=0&t=3`），再加河道、野区、出生点几处。
2. 合 `r9-stylecost`，在它的基础上做正式的：分阶光和硬一点的整块影子、调色（亮度往 B 上提、饱和度别过）、天光、草（颜色表从 B 量、草丛叶子宽一点更像一簇）、水（青蓝、透亮、粼光克制）、城墙外的树和地面的颜色。
3. **地面九个区按 B 重画**：用 `tools/map_ground.py` 的现成管线，画风参考换成 B 的设计稿（原来参考的是 A 的裁片），石板画成干净的大块、苔少，草地是一整片明亮的绿。解决评估里说的“长苔的石板被当成草染绿”“水晶广场偏白过曝”“城墙外空地扎眼的浅灰”。
4. 英雄、小兵、建筑的材质不动（第二批换），但要截一张英雄站在新地面上的图，说清现在的英雄在亮地面上好不好认、特效（原来按暗青绿地面调的）还看不看得清，列给第二批。
5. 证据：同机位的三联图“B 设计稿 / 改前 / 改后”，加评估里那张颜色亮度表的改后一列。帧率（电脑档、手机档）不能比改前低。

### `b-walls`（即梦上限 100 积分，用于平铺贴图，能用代码画就不用）

1. 先在主目录 5190 录改前（同 `b-toon` 的机位，再加几处野区墙、高地挡墙、城墙的近景）。
2. 合 `r9-stylecost` 当预览的底（最终的光照由 `b-toon` 定）。
3. 墙、石头、台阶、城墙照 B 设计稿改：一整条圆润的厚板、圆角大、少分块、墙头少堆碎石，沉月会浅灰白石加铜绿青铜包边，烬誓庭深灰玄武岩加暗铁箍；平铺贴图换干净的。城墙外的树（变形的二十面体叶团）本来就偏卡通，按 B 调形状和颜色。
4. **位置和挡路范围一点不能变**：寻路、卡兵、两边对称都靠它们。改完跑一局只放小兵的检查（第九轮 `balance` 任务的 `tools/balance_sym.mjs`）和卡兵检测（`docs/round9/feel/STUCK.md` 里的做法），数字要和改前一致。
5. 证据：同机位的“B 设计稿 / 改前 / 改后”，墙的近景对比。

### `b-retarget`（不花积分）

1. 读 `tools/HERO_PIPELINE.md`、`tools/CREATURE_PIPELINE.md`、`tools/MONSTER_PIPELINE.md` 最后一节，弄清现在每个英雄的动作是怎么来的（即梦视频 → 读成动作 → 烘到 Tripo 绑的骨架上），以及游戏里怎么读 `public/assets/hero/<id>.glb` 里的动作片段和时间表。
2. 做一个工具：把一个角色现有的动作片段套到**同一个角色的新模型**上（新模型比例会变：卡通的头大、手大、身子敦实，骨骼名一样或可映射）。人形和两足是 Mixamo 骨骼名；四足用各自的映射（从狼的 `wolf_rigmap.json` 改的那套）。要处理：比例不同时脚踩不住地（脚滑、陷地、飘起来）、手和武器对不上、关节穿模。
3. **不花积分验证**：
   - 人形：把岚的全部动作套到另外几个现成英雄的模型上（比如薇萝、塞伦、赫达，它们比例各不相同），再在 Blender 里把岚自己的骨架改成卡通比例（头、手放大，腿缩短）套一次。
   - 四足：把奥森（鹿）的动作套到卡兹（猞猁）上，或者反过来。
   - 每段动作出查看页拼图或者录像，量脚滑多少（米/秒）、出手时刻（`hit`、`release`）对不对得上。
4. 交付：`tools/retarget/` 里的脚本和一份用法说明（第二批直接照着用），证据放 `docs/style_b/b-retarget/`，汇报里写清：哪些动作套上就能用、哪些要修、修的办法（脚的 IK 锁地、手的 IK 对武器）、四足能不能套、你估计第二批每个角色还要手修多久。
5. 只新增文件，不改现有的共用脚本和游戏代码；可以在自己分支上提交工具。

## 汇报

照 `docs/round9/COMMON.md` 的格式。另外写清：花了多少积分（开始、结束的余额）；和 B 设计稿还差在哪；你自己觉得还不够好的；第二批要接着做的。

## 第一批之后追加的两个任务（2026-11-20，不依赖英雄选哪个路子）

第一批的 `b-toon`（光照、地面）、`b-walls`（墙石树）、`b-retarget`（动作工具）都已合进 `style-b`；`b-concept` 出了风格规矩 `docs/style_b/STYLE.md` 和设计稿 `art/style_b/concept/`。英雄还在等用户选路子，下面两件不受影响，先做。

| 任务 | worktree / 分支 | 测试端口 |
|---|---|---|
| `b-build` | `.claude/worktrees/b-build` / `b-build` | 5224 |
| `b-fx` | `.claude/worktrees/b-fx` / `b-fx` | 5225 |

“改前”现在是 5190 上的 `style-b`（已经有 B 的光照、地面、墙石，但塔、水晶、出生点、特效还是厚涂版的）。

### `b-build`：塔、水晶、出生点按 B 重建（即梦上限 100，只给出生点出设计稿用）

1. 读 `PLAN.md` 阶段 2.7 的记录（搜“2.7”“关键建筑”）：形状交给 Codex，每件一个文件夹 `lab/kit/<名字>/`，任务说明由 `tools/kit_tasks.py` 生成，`tools/kit_collect.py` 收进 `public/assets/kit/` 并写 `index.json`；`src/map/kit/materials.ts` 按材质名（stone、metal、accent、crystal、glow、water）换成项目的材质；`kit.html` 是用游戏的光和材质看单个模型的预览页；`src/map/world/buildings.ts` 摆进地图。
2. 设计稿：塔 `art/style_b/concept/tower-me.png`、`tower-foe.png`（外塔、内塔、高地塔一家三档），水晶 `core-me.png`、`core-foe-v2.png`。出生点没有 B 的设计稿：照 2.2 的做法、参考 `art/concepts22/spawn_*.png` 和 B 的环境设计稿出两张（我方、对方）。
3. 尺寸、占地、高度、朝向、原点、发光部件的位置照**游戏里现在的建筑**（`b-concept` 说它的图里塔相对小人画矮了，不照图上的比例）；被拆以后的残座、爆炸、挡视线时的镂空、晶体转、点光这些都要照常工作。
4. Codex 的用法和教训（两次栽在同样的地方，任务说明里必须写进去）：
   - 调用：`env -u CODEX_API_KEY /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex exec --skip-git-repo-check -C <文件夹> -m gpt-6.2-astra -c 'model_reasoning_effort="xhigh"' -i <参考图>… -o last.txt - < TASK.md > codex.log 2>&1`，放后台跑，可以几件同时跑。
   - **不能加 `-s workspace-write`**（Blender 在 Codex 的沙盒里一启动就崩），只能按用户机器上的默认权限（完全访问）跑，所以任务说明里写死：只写自己的文件夹、不删不改别处、不用 `pkill`/`killall`、不装全局包。汇报里写明是按完全访问跑的。
   - Codex 只出形状（几何体加灰度顶点色，不带贴图），材质名写死那张表；石头要分块留缝；面数上限写死；让它用 `kit.html` 在游戏的光和材质下截图自查；项目定的颜色值（`docs/style_b/STYLE.md` 的色板）写进说明；游戏里没有环境反射，金属度压到 0.1 上下，不然发黑。返工意见给具体的目标值（不然容易矫枉过正）。
5. `materials.ts` 的材质参数按 B 调（浅灰白石、铜绿青铜、深灰玄武岩、暗铁、青色和橙红的发光克制）。注意 `b-walls` 给共用石材加了 4 个可选参数，`stone.ts` 也 import 了 `toon.ts` 的 `TOON_ON`、`T`。
6. 证据：每件“B 设计稿 / 改前 / 改后”，地图里的整体截图（我方、对方、两个基地）；被拆、爆炸、镂空各截一张证明还好使。回归四项、帧率。

### `b-fx`：特效在 B 的亮地面上重新调对比

`b-toon` 列出来的问题（证据 `docs/style_b/b-toon/fx/`、`pair_11_arena.jpg`、`pair_heroes_t75.jpg`）：
- 白色和浅青的特效在亮地面上看不清：岚 W 的水花、R 的刀光，摩珂 W 的泡泡、E 的水柱、R 的治疗罩。
- 深色的贴地痕迹像一块污渍：奥森 E/R 的焦黑坑、葛隆 W 的深色土沟。第二轮定的“下面垫深色、上面叠亮边”是为暗青绿地面设计的，要按亮地面重调。
- 暖色、火焰类（葛隆 Q/E/R、奥森 W 的金圈）在亮地面上反而清楚，不用大动。
- 自己脚下的绿圈在亮绿草地上很弱，蓝、红的队伍圈在浅色石板上也淡。

要做的：十个英雄的全部技能和普攻、回城、结束演出、状态图标在新地面上逐个过一遍（新四个英雄也在内），照王者荣耀那种亮场景里的特效来调——颜色饱和、形状实、核心亮而有色、边缘用同色系的深一档而不是黑底；地上的痕迹用有颜色的（湿印、焦痕偏暖褐）而不是一块黑。英雄的模型第二批会换，特效挂在骨骼和手上的位置不受影响。

文件：特效零件（`fxlib.ts`、`fx.ts`、`fx_*.ts`）、`heroes/*.ts` 的特效部分、`view.ts` 的状态显示、`hero/hero.ts` 的脚下圈和队伍色。**不碰**数值、冷却、时间点、界面（`hud.ts`、`lobby.ts`、`uikit.ts`，界面换配色另做）。

证据：每个改动的技能“改前 / 改后”的连续帧（在新地面上、固定机位，照 `docs/round9/FX2.md` 的做法），一张全部技能的总表。回归四项、团战帧率。

## 第二批：角色（2026-11-20，用户选了路子一）

用户原话：“路子一 卡通厚涂”。角色的规矩照 `docs/style_b/STYLE.md` 里“路子一 · 王者式卡通厚涂”那一节（形体圆润、大块明暗、贴图带手绘光影、比现在亮一档、不描边；保住每个英雄的轮廓、武器、阵营色、主色；在亮地面上要显眼）。岚的鱼鳍头冠用户没提，照现在的设计不改。

先做三件，互不依赖：

| 任务 | 做什么 | worktree / 分支 | 测试端口 |
|---|---|---|---|
| `b-lan` | 试点：岚一个走完整条线（卡通设定图 → Tripo 模型和武器 → 绑骨 → 用 `tools/retarget/` 套旧动作 → 出品进游戏），定下第二批每个角色的做法和成本 | `.claude/worktrees/b-lan` / `b-lan` | 5226 |
| `b-sheets` | 其余 8 个英雄（托尔格、摩珂、奥森、薇萝、卡兹、赫达、乌戈、塞伦）、2 种小兵（近战、远程）、6 种野怪（狼、野猪、蟾蜍、山魈、岩石巨魔、岩甲巨兽）的路子一建模设定图 | 不用 worktree，图放 `art/style_b/concept/`，说明放 `docs/style_b/b-sheets/` | 不需要 |
| `b-ui` | 界面换配色：“黑铁加旧铜”压在亮地图上不搭，照王者荣耀亮场景的界面换（首页、选人、加载、对局电脑和手机、商店、计分板、结算），手机摇杆圈在亮地面上要看得清 | `.claude/worktrees/b-ui` / `b-ui` | 5227 |

试点走通以后，再按试点定下的做法分几波做其余角色（每波几个任务并行），然后是海报、头像、技能和装备图标、宣传片。

### `b-lan`（Tripo 上限 150，即梦上限 50）

1. 设定图用 `art/style_b/concept/lan-p1-sheet.png`（正面 A 字站姿、纯灰底；露出的手肤色要对）。武器（双钩刃）照 `tools/HERO_PIPELINE.md` 的做法：B 风格单独出一个（Tripo 或脚本建），或者把旧武器的形状换成 B 的材质——你判断，汇报里写理由。
2. Tripo：照 `tools/HERO_PIPELINE.md` 和 `docs/round9/NEW_HEROES.md` 第一节的做法（`tools/tripo_batch.py`，`face_limit` 40000，`texture_quality` detailed，`name` 用 `hero_lan_b`），绑骨 `--rig-type biped --spec mixamo`。出来先用 Blender 渲几张看结构和贴图，**不行最多重出一次**。开始和结束各查一次余额（`/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python tools/tripo.py balance`）。
3. 套动作：照 `tools/retarget/README.md`。**出品的 `rigged` 路径一定写新的**，不要覆盖旧的岚。成品放 `public/assets/hero/lan.glb`、`lan.json`（覆盖旧的，旧版在标签 `v9-painted` 里），手机档 `m/lan.glb`（`tools/lite_glb.mjs`）。
4. 进游戏看：测试场和对局里站、跑、普攻、Q W E R、死亡、回城；和小兵、别的老英雄站一起的个头图（`height` 照现在的 3.3，看着不对再调）；在 B 的地面上显不显眼。现在英雄的材质是给厚涂版调的（`hero/hero.ts`：受击闪白、轮廓、凹凸），卡通厚涂的英雄需要什么材质处理（比如压掉凹凸和高光、加一道轮廓亮边）在试点里定下来，写成以后每个角色都照着用的做法；改 `hero/hero.ts` 的通用部分要保证还没换的老英雄不坏。
5. 汇报写清：Tripo 和即梦各花了多少、整条线用了多久、哪一步要手修多久、第二批每个角色照什么步骤做（写成清单）、你觉得还不够好的。证据放 `docs/style_b/b-lan/`（“现在 / 卡通版”并排的测试场技能帧、个头图、对局截图）。

### `b-sheets`（即梦上限 600）

1. 照 `b-concept` 的做法和 `STYLE.md` 路子一的规矩，给 16 个角色各出一张**正面 A 字站姿的建模设定图**（纯灰底、居中、四周留白，人形照 `tools/HERO_PIPELINE.md` 的要求；四足照 `tools/CREATURE_PIPELINE.md` 的要求，侧面站姿）。每个角色的现在设定在 `concepts/heroes/`、`art/hero/<id>/brief.json`、`docs/round9/heroes/DESIGN.md`，小兵和野怪在 `art/unit/<名字>/`（参考图 `art/unit/*_ref.png`、`monster_refs.jpg`）。用现在的设定图当参考图（i2i），保住身份。
2. 两种小兵两队共用一个模型（对方靠着色器换色），出一套中性配色就行。岩石巨魔、岩甲巨兽以前不是 Tripo 出的（video2rig 现成的模型），这次也要出设定图。
3. 葛隆用 `b-concept` 已经出的 `gorran-p1-sheet.png`，不重出；但它说葛隆的亮部没比红土亮、要加轮廓亮边，你在设定图层面能提亮就提亮一点（出一张备选）。
4. 每张自己看：结构清楚（Tripo 要能读懂）、没有多余的手指和武器、颜色比现在亮一档、在 B 地面上显眼。出一张总表“现在 / 卡通版”并排，外加一张“缩到游戏里的大小、站在 B 地面上”的可读性表。
5. 不改代码、不提交 git，交完就停。

### `b-ui`（即梦上限 150）

1. 先在主目录 5190 截改前（首页、选人、加载、对局电脑 1920 和 1366、手机 844 和 667、商店、计分板、结算）。
2. 界面的共用零件在 `src/map/game/uikit.ts`，贴图在 `public/assets/ui/kit/`，设计说明 `docs/round9/ui/DESIGN.md`。把配色和质感从“黑铁加旧铜”换成和 B 搭的一套（参考王者荣耀亮场景下的界面：亮金描边、蓝白底、半透明玻璃感；对局里的面板不能挡住亮地面上的信息，也不能在亮地面上糊掉）。布局、交互、按键、手机适配都不动。
3. 队伍色（我方蓝、对方红）、血条分级、伤害数字、状态图标是第九轮定的，不动。
4. 文件：`uikit.ts`、`hud.ts`、`lobby.ts`、`touch.ts` 和 `mobile.ts` 里的样式部分、`public/assets/ui/kit/`。不碰英雄、特效、地图。
5. 证据：每个界面“改前 / 改后”，回归四项（`click_test`、`touch_test` 的预期不该变）。

## 第二批 · 分波做其余 15 个角色（2026-11-20，岚的试点走通以后）

岚已经按路子一换进游戏（`b-lan`，结果 `docs/style_b/b-lan/README.md`）。**每个角色照 `docs/style_b/HERO_B.md` 的清单做**（设定图 → Tripo 模型 → 绑骨 → 武器 → 装武器 → 读骨架 → 两份源配置 → 套动作 → 出品 → 进游戏看 → 回归），材质已经定了（材质名以 `_b` 结尾走 B 的处理，`hero/hero.ts` 的 `HB`，不改默认值）。设定图在 `art/style_b/concept/<id>-p1-sheet*.png`（`b-sheets` 出的，说明 `docs/style_b/b-sheets/README.md`；葛隆用 `gorran-p1-sheet-bright.png`）。

六个任务同时做：

| 任务 | 角色 | worktree / 分支 | 测试端口 |
|---|---|---|---|
| `w-gh` | 葛隆、赫达（烬誓庭的人形英雄） | `.claude/worktrees/w-gh` / `w-gh` | 5231 |
| `w-vs` | 薇萝、塞伦（两个射手） | `.claude/worktrees/w-vs` / `w-vs` | 5232 |
| `w-mu` | 摩珂、乌戈 | `.claude/worktrees/w-mu` / `w-mu` | 5233 |
| `w-quad` | 卡兹、托尔格、奥森（四足英雄；先做卡兹——`b-retarget` 验证过“卡兹 → 卡通比例的卡兹”能套） | `.claude/worktrees/w-quad` / `w-quad` | 5234 |
| `w-unit` | 近战小兵、远程小兵、骨面山魈、岩石巨魔（两足的单位） | `.claude/worktrees/w-unit` / `w-unit` | 5235 |
| `w-beast` | 苔背狼、炽鬃野猪、石背巨蟾、岩甲巨兽（四足的野怪） | `.claude/worktrees/w-beast` / `w-beast` | 5236 |

- **额度**：每个角色 Tripo 不超过 150（模型 40、绑骨 25，武器走 Tripo 再 20–40，预留一次重出）；即梦只在要给复杂武器出一张 B 风格武器图时用，每个任务上限 60。开始和结束各查余额。
- **文件**：各管各的角色——`public/assets/hero/<id>.*`（英雄）、`public/assets/unit/<名字>.*`（小兵、野怪）、`art/style_b/<id>/`；英雄的 `heroes/<id>.ts` 只许改 `look` 里的 `height`、`lift`、`sat`、`ring`、`bar` 这类外观字段（数值、技能、特效不动）。`units.json` 里只改自己那几个单位的条目，不重排。
- **小兵和野怪的着色**：它们走的着色路径可能还认不出 `_b`（岚只验证了英雄）。`w-unit` 负责让单位也按材质名 `_b` 走 B 的处理（在 `view.ts` / `hero/hero.ts` 里做**新增**，复用英雄那套 `HB`，不改老模型的路径）；`w-beast` 如果等不及，可以在自己分支上做同样的最小新增，汇报里写清改了哪几行，合并时调度统一。小兵两队共用一个模型、对方靠换色：确认新模型的换色（青蓝那一块）还对。
- **四足**：岚的试点没走四足，`HERO_B.md` 末尾那段和 `tools/retarget/README.md` 的“四足”一段是起点；`w-quad`、`w-beast` 先做一个跑通再做下一个，跑不通就停下来向调度汇报，不要硬做。岩石巨魔、岩甲巨兽原来是 video2rig 现成的模型，旧动作在它们现在的 GLB 里。
- **已知的坑**（`HERO_B.md` 最后一节）：`rigged` 一定写新路径；源的时间表开工就拷一份；`run_case.py` 胯缩放的报告路径写错了（腿长差很多的角色要注意，托尔格、乌戈）；`kit_test.mjs` 拼图调的是 `python3`（用 `tools/style_b/compare.mjs` + `pairs.py` 代替）。
- **磁盘**：现在剩三十来 GB，六个任务一起跑会吃得很快。`retarget/render/` 这类几百 MB 的逐帧看完就删；无界面 Chrome 用完在 finally 里关；开工和每做完一个角色看一眼 `df -h /System/Volumes/Data`，不到 10 GB 就停下来报告。
- **交付**：每个角色出“现在 / 卡通版”的技能对照、个头图（和小兵、别的英雄站一起）、亮地面上显不显眼的量数；回归四项；worktree 里 `art/style_b/<id>/` 的二进制交之前拷到主目录（`rsync -a --ignore-existing`，只拷主目录没有的）。

## 收尾（2026-11-21，十个英雄、小兵、野怪全部换完以后）

角色全部换成路子一、合进了 `style-b`。还剩两件，同时做：

| 任务 | 做什么 | worktree / 分支 | 测试端口 |
|---|---|---|---|
| `b-art` | 海报、头像、图标照 B 重出 | `.claude/worktrees/b-art` / `b-art` | 5241 |
| `b-polish` | 零碎收尾（头顶血条、墙上青苔、岚的武器贴图、两个材质改名脚本统一） | `.claude/worktrees/b-polish` / `b-polish` | 5242 |

### `b-art`（即梦上限 900）

现在的 `public/assets/ui/` 里全是第九轮的暗调写实厚涂：竖版海报 `splash/`（10，1200×1600）、横版 `wide/`（10，1920×1080）、头像 `face/`（10，256×256）、技能图标 `skill/`（44，160×160）、装备图标 `item/`（44）、增益 `buff/`（4）、`emblem.webp`、`gold.webp`、`recall.webp`。在新的蓝玻璃金边界面和亮地图里，选人、载入、技能栏、商店里这些图最扎眼（`b-ui` 汇报说的）。

1. 读第九轮出这些图的记录：`PLAN.md` 搜 `poster`、`art4`、`items`（模型选择：Image 2.5 Pro `jm_image_model_lib_s` 4 积分一张，照片质感强、听话；出图记录 `art/ui/poster_jobs.json`、`docs/round9/art4/`、`docs/round9/items/`），尺寸、命名、切图脚本照旧。用户对海报的原话（第九轮第 5 条）：“角色海报也很粗糙，海报要做的有写真感，跟角色有差别都无所谓，要足够好看”。换成 B 以后，海报是**卡通厚涂的主视觉**（王者荣耀英雄海报那种明亮、精致、有氛围），不是写实照片；角色要和现在游戏里的新模型一致（设定图 `art/style_b/concept/<id>-p1-sheet*.png` 当参考图），每张都要足够好看。
2. 图标：技能、装备、增益照 B 的明亮卡通画风重画，和新界面（深海蓝玻璃、亮金边）搭；图标要在 48 像素下一眼认得出（第九轮 `art4` 换过 6 个不合格的，其中一个冒出了别的游戏的标志——提示词里不要写别的游戏名）。
3. 先拿两个英雄（岚、葛隆）把海报、横版、头像、技能图标出一套，自己对着现在的界面放进去看（选人、载入、技能栏），满意了再出其余的。
4. 证据：每类“现在 / B”的总表，放进界面里的截图（电脑和手机的选人、载入、对局底栏、商店）。回归四项（只换图，测试不该变）。

### `b-polish`

1. **英雄头顶的血条**（`hero/hero.ts`）：还是第九轮的黑底、自己那条铜金边；照 `b-ui` 换好的界面配色（深海蓝、亮金）统一，三档分级（自己、队友、对方）和颜色语义不变（`docs/style_b/b-ui/` 有新界面的样子，`docs/round9/ui2/` 有血条分级的规矩）。
2. **墙上的青苔**：我方白墙上的亮绿青苔斑块偏多偏花（`docs/style_b/merged2/sheet.jpg`），收到 B 设计稿那种只在墙顶、淡淡几块（`b-walls` 给共用石材加的“青苔”参数，`src/map/slice/stone.ts`、`world/ramparts.ts`）。位置和挡路范围不能变。
3. **岚的武器贴图**：`art/style_b/lan/gear.py` 先把颜色转成线性再写进贴图，导出后偏暗偏饱和（`w-unit` 发现的）。改成直接写 sRGB，照 `art/style_b/lan/rebuild.sh` 重新出品岚（`build.json` 里 `rigged` 指的是已经删掉的 worktree 路径，改成主目录 `art/style_b/lan/` 下的文件）。动作、时间表不变。
4. **两个材质改名脚本**：`w-beast` 用 `art/style_b/beasts/mob_b.mjs`，`w-quad` 用 `tools/style_b/b_rename.mjs`，看能不能合成一个放在 `tools/style_b/`，写进 `docs/style_b/HERO_B.md`（不用重新出品已经换好的模型）。
5. 证据：每项改前改后；回归四项。
