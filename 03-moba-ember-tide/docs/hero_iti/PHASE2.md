# 新刺客伊缇 · 第二阶段：卡通设定图 + Codex 试做两个特效

先完整读 `docs/hero_iti/DESIGN.md`（用户已确认的设计方案：“能过，开始阶段二”），再读 `docs/round9/COMMON.md`（规矩、汇报格式）和 `docs/style_b/STYLE.md`（画风路子一：王者式卡通厚涂）。全程中文。**这个英雄分阶段做，每阶段做完由调度找用户确认**：第二阶段只做下面两件，做完交差，不要往第三阶段（建模、动作）走。

两个任务同时做：

| 任务 | 做什么 | 在哪干活 |
|---|---|---|
| `iti-concept` | 伊缇的卡通设定图 | 只出图，不改代码；图放主目录 `art/hero_iti/concept/`，说明放 `docs/hero_iti/concept/` |
| `iti-fx` | 让 Codex 在独立试验页里试做 R 的十字新月斩、被动的绯红爆裂 | Codex 的文件夹 `lab/fx_codex/`（主目录下），证据放 `docs/hero_iti/fx/` |

## `iti-concept`（即梦上限 120）

1. 看现在的画风标杆：`art/style_b/concept/lan-p1-sheet.png`（岚的建模设定图）、`docs/style_b/b-art/compare/splash.jpg`（新海报），和 `docs/style_b/b-concept/README.md`、`docs/style_b/b-sheets/README.md`（上两个出设定图的任务用哪个模型、提示词怎么写、踩过什么坑，提示词全文在它们的 `jobs*.json`）。
2. 出图（照设计方案的“外形”一节：修长人形、深色贴身短甲、暗铁护臂、半张暗铁面具、眼睛一道亮色、**一条很长的绯红围巾**、双持反握短刃——刃身暗铁、刃口一道绯红；主色绯红到品红，亮芯暖白，点缀赤金；不要和岚撞：岚是兜帽、钩镰、青色）：
   - **建模设定图**：正面 A 字站姿、空手（武器另出）、纯灰底、居中、四周留白，照 `tools/HERO_PIPELINE.md` 对建模设定图的要求；围巾要清楚地从身体分出来（Tripo 才读得懂），不要缠成一团。出两个方向供用户选（比如：A 偏女性、利落短发；B 偏男性或中性、长马尾——你判断哪两个方向拉得最开），每个方向一张。
   - **游戏镜头图**：和 B 设计稿同样约 55 度的俯视，站在 B 的地面上，摆一个有张力的动作（比如 Q 三段腾空下劈的瞬间、或者 R 落地双刃交叉的收势），旁边两三个小兵当比例。每个方向一张。
   - **武器图**：双短刃的正侧视图（纯灰底），一张。
   - **海报式主视觉**（可选，额度够再出）：一张有张力的动作海报，看这个角色“够不够帅”。
3. 每张自己看：好看、有张力、轮廓在俯视里好认（围巾、双刃）、颜色比地面亮、和现有十个英雄放在一起是一套。不合格的在额度内重出。
4. 一张总表：两个方向的设定图、游戏镜头图并排；再加一张“和现在的十个英雄头像/设定图放在一起”的对比。
5. 出图走排队脚本 `zsh /Users/jadon7/Documents/SynologyDrive/code/moba/tools/jimeng_lock.sh <jobs.json 绝对路径>`；开始和结束各查余额（`dreamina-canvas auth account --format json`）。不改代码、不提交 git。

## `iti-fx`（Codex 试做两个特效）

目的：让用户看到 Codex 做特效的水平。用户看到一条别人用 GPT 6.2 在 UE5 里做特效的视频（`docs/hero_iti/DESIGN.md` 第一节有我截图看下来的要点：干净的新月斩、带白芯的螺旋刀气、**品红橙紫两三阶硬色块的动漫风爆发**、霓虹光带、火柱爆点），想让我们的 Codex 也试试。

1. **搭试验页**（你来搭，或者让 Codex 搭）：`lab/fx_codex/index.html` + 脚本，用项目里的 three.js（`node_modules/three`，版本和游戏一样），由一个 vite 服务器从主目录根上服务（比如在主目录后台起 `npx vite --port 5251 --strictPort`，打开 `http://localhost:5251/lab/fx_codex/index.html`；干完停掉）。场景照游戏：俯视镜头约 50 度、距离 27 米左右（再加一个 12 米左右的近镜头）；地面用 B 的地面贴图（`public/assets/map/` 里挑一块我方草地和一块对方红土）或者同色的平地；光照照 `src/map/toon.ts` 的 B 设置（太阳、天光、分阶）大致搭；放一个占位的人（直接载入 `public/assets/hero/lan.glb`，它有动作；身高 3.3 米）和几个靶子（`public/assets/unit/melee.glb`，1.45 米）。页面上有按钮或者网址参数能重放每个特效，能固定时间步长逐帧截图。
2. **两个特效**（照设计方案）：
   - **R · 绯月千刃的收尾**：伊缇在 6 米范围里连闪几下（占位人瞬移几次，每次身后留一道绯红的残影刀光），最后回到中心，**一道巨大的十字新月斩炸开**——两弯交叉的新月刀气（白芯、绯红到品红的身子、外沿细丝），地面一圈有厚度的冲击环和十字形的裂痕，少量赤金火星，然后迅速收掉。整段约 1.5 秒。
   - **被动 · 烬痕引爆**：叠满三层时，目标身上炸开一朵**绯红的花形爆裂**（参考视频 0:13 那种动漫风的硬边色块爆发，两三阶色），0.5 秒内。另外做三层烬痕叠在目标头顶的小记号（每叠一层亮一格）。
3. **让 Codex 做**（用法和上两次建模攒下的教训）：
   - 调用：`env -u CODEX_API_KEY /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex exec --skip-git-repo-check -C /Users/jadon7/Documents/SynologyDrive/code/moba/lab/fx_codex -m gpt-6.2-astra -c 'model_reasoning_effort="xhigh"' -i <参考图>… -o last.txt - < TASK.md > codex.log 2>&1`，放后台跑；返工接着同一个会话说（照 `lab/kit_b/` 里上次建塔的做法，那里有任务说明和返工意见的例子）。
   - **不能加 `-s workspace-write`**（在 Codex 的沙盒里浏览器、Blender 会崩），只能按用户机器的默认权限（完全访问）跑，所以任务说明里写死：只写 `lab/fx_codex/` 这一个文件夹、不删不改别处、不用 `pkill`/`killall`、不装全局包、不提交 git。
   - 任务说明里写清：three.js 版本、试验页怎么打开；每个特效写成独立模块（一个函数生成、每帧 `update(dt)`、结束 `dispose()`，材质和几何体能复用），以后要接进游戏（游戏里的特效零件在 `src/map/game/fxlib.ts`、`fxb.ts`，它可以看但不改）；**画风规矩**——主色绯红到品红、亮芯暖白、赤金只做点缀火星、发光只在核心那一下最亮、主体是有颜色的半透明或硬边色块、不要满屏泛白、地面痕迹用暖褐或深绯不用黑、和卡通厚涂的场景搭；性能——一次特效的绘制次数、粒子数有上限，手机档能减半；**自己用无界面浏览器在试验页里截连续帧、录像，和参考截图并排看，至少改三轮**。
   - 参考图：可以重新打开那条抖音链接截几张（`https://www.douyin.com/video/7709870497600860645`，页面弹登录框就关掉、不登录），存进 `lab/fx_codex/refs/`；再加两张我们游戏现在的画面（`docs/style_b/acceptance/img/now_game.jpg` 等）让它知道场景长什么样。
4. **你自己把关**：Codex 每交一轮，你在试验页里看（俯视 27 米和近镜头都看），挑毛病写成具体的返工意见（给目标值，别只说“太亮”），至少两轮。
5. **交付**：每个特效一条录像（真实时间，30 帧，俯视和近镜头各一条）、一张连续帧图（至少 10 帧）；一张“参考视频截图 / Codex 做的”并排；Codex 跑了几次、多久、每轮改了什么；你判断 Codex 的水平（和我们现在游戏里最好的特效比，比如第九轮的托尔格 R、乌戈 R，`docs/round9/polish-*/`、`docs/style_b/b-fx/`）。不改游戏代码（`src/`）、不接进游戏，这是第四阶段的事。

## 规矩（两个任务都适用）

- 结束进程只按确切 PID（你自己启动的，包括 Codex 和它带起来的浏览器），禁止 `pkill`、`killall`；`rm` 只写完整绝对路径；不要跑会等输入的命令；长命令放后台；macOS 没有 `timeout`。
- 不打印、不复述任何密钥（`~/.config/video2rig/env`），环境变量 `CODEX_API_KEY` 不要动；用户邮箱等私人信息不发给外部服务。
- 拼图用 `/opt/homebrew/opt/python@3.14/bin/python3.14`；ffmpeg 要加 `DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib`。无界面 Chrome 用完在 finally 里关。
- 磁盘现在剩约 40 GB：逐帧看完就删，录像压小。
