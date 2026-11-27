# 第九轮 · 给每个任务的共同说明

你是 Opus 5.5，接手原创网页 MOBA《烬与潮》的一块活。调度的是另一个模型（Fable 5.2），它不写这一轮的代码，只派活、核对、合并。全程用中文工作和汇报。先把这一页读完，再读你自己的任务说明。

## 项目现状

- 三对三、三条线、一条河的 MOBA，three.js + TypeScript + Vite，跑在浏览器里，手机横屏也能玩。已经上线（<https://moba.dsxzai.com/>），**你不要发布**，发布由调度来做。
- 八个阶段都做完了，记录在主目录的 `PLAN.md`（很长，按需查）。用户看完以后提了 12 条意见（`PLAN.md` 里“2026-11-20 用户看完阶段 8 后的 12 条意见”一节有原话），这一轮就是处理这 12 条。
- 主目录：`/Users/jadon7/Documents/SynologyDrive/code/moba`（git 仓库，分支 `phase9`）。
- 入口页 `map.html`，入口代码 `src/map/world/main.ts`（开头的注释列了全部网址参数，先读）。对局的代码都在 `src/map/game/`：

| 文件 | 管什么 |
|---|---|
| `sim.ts` | 对局规则：单位、伤害、小兵、塔、野怪、经济、胜负。`RULES` 是数值表 |
| `actor.ts` | 一个英雄怎么动：走、转身、普攻、放技能、回城的状态机；动作的出手时间来自 `public/assets/hero/<id>.json` |
| `play.ts` | 玩家输入（鼠标、键盘、触屏接口）变成英雄的命令 |
| `skills.ts`、`heroes/<id>.ts` | 技能的定义、数值和每个技能的特效 |
| `bot.ts` | 电脑怎么打 |
| `nav.ts`、`../layout.ts`、`../terrain.ts` | 能走的范围、寻路、地图布局、地面高度 |
| `view.ts` | 把规则里的单位画出来：小兵、野怪、血条、弹道、命中特效 |
| `fxlib.ts`、`fx.ts` | 特效的零件库（粒子、贴花、光柱、冲击环、飘字） |
| `fow.ts` | 战争迷雾 |
| `hud.ts`、`lobby.ts`、`touch.ts`、`mobile.ts` | 对局界面、主菜单/选人/载入/结算、触屏操作、手机杂项 |
| `items.ts` | 装备 |
| `director.ts` | 观战时的导播 |
| `sfx.ts` | 音效（WebAudio 现场合成） |

- 手册：`tools/SHIP.md`（打包、手机、测试命令）、`tools/HERO_PIPELINE.md`、`tools/MONSTER_PIPELINE.md`。对标清单和参考图：`docs/benchmark.md`、`refs/dota2/`（只在主目录有）。

## 你在哪干活

- **写代码的任务在自己的 git worktree 里干**（你一启动就已经在里面了，先 `pwd; git branch --show-current` 确认）。别的任务同时在别的 worktree 里改别的文件，互不影响。**不要碰主目录的 `src/`**。
- worktree 里没有装依赖，先建一个软链接：`ln -s /Users/jadon7/Documents/SynologyDrive/code/moba/node_modules ./node_modules`。
- 开你自己的测试服务器（放后台）：`MOBA_PORT=<你的端口> npx vite --config vite.test.config.ts`。它不做热更新，新打开的页面拿到最新代码。所有测试和截图脚本前面加 `MOBA_URL=http://localhost:<你的端口>/map.html`。不要动 5183、5190 两个端口上的服务器。
- 不进 git 的东西（设计稿 `art/`、`concepts/`，参考图 `refs/`，验收页里的图片）只在主目录有，用绝对路径读。
- **证据（截图、录像、对比图）写到主目录**：`/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/<你的任务名>/`。图片和视频不进 git，留在 worktree 里合并时带不过来。
- 干完在自己的分支上提交（可以分几次提交）。提交说明用中文，末尾加一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不要合并、不要 push、不要切到别的分支。** 软链接 `node_modules` 不要提交（`.gitignore` 里已经忽略了）。

## 怎么跑、怎么看

```bash
npx tsc --noEmit -p .                                   # 类型检查，改完必跑
MOBA_URL=... node tools/shot.mjs <输出.jpg> "<网址参数>" 1920 1080 1400      # 截一张
MOBA_URL=... node tools/look_shots.mjs <目录> "<参数>" 60,120,200 1920 1080  # 开一局，在这几个对局时刻各截一张
MOBA_URL=... zsh tools/rec_clip.sh <输出.mp4> "<参数>" "<开录的条件>" <秒>    # 录一段（帧率只有二十上下，会自动把时间轴拉回去）
MOBA_URL=... node tools/click_test.mjs <目录>           # 鼠标键盘回归，21 项
MOBA_URL=... node tools/touch_test.mjs <目录>           # 触屏回归，28 项
MOBA_URL=... zsh tools/match_batch.sh <目录> a:"h=lan" b:"h=osen&diff=hard"   # 全电脑对战跑到分出胜负，看报错和战况
MOBA_URL=... node tools/mobile_shot.mjs <目录> 844 390 名字:"参数"            # 手机横屏截图
```

- 常用参数：`h=<英雄>`（lan torg moko gorran vero osen）、`arena=1&h=<英雄>`（测试场，靶子站着不动，试技能最方便）、`director=1&h=lan`（观战，六个都是电脑）、`auto=1`（自己的英雄也交给电脑）、`speed=N`、`nohud=1`、`solo=1`、`touch=1&q=lite`（强制手机布局和手机画质）、`cam=…`（固定机位）。页面里的全局对象：`__sim __play __actors __api __fx __nav __arena __setSpeed __report() __stats`。
- 无界面 Chrome 的坑：显卡被别的任务抢的时候整页会白（日志里有 `Shader Error … VALIDATE_STATUS`），脚本会重试，你拿到图要自己看一眼；**同一时间只跑一个无界面 Chrome**，别并行开；录像尽量短。
- 你要亲眼看自己做的东西：截图用 Read 工具打开看，对着参考图并排比，改几轮再交。不要只跑通了就交。

## 回归：交之前必须过

1. `npx tsc --noEmit -p .` 无报错。
2. `tools/click_test.mjs` 和 `tools/touch_test.mjs` 的结果和你动手之前一致（先跑一遍留底）。你的改动让某一项的预期变了，就改测试并在汇报里说明为什么。
3. `tools/match_batch.sh` 跑一整局全电脑对战，能分出胜负、`errors` 是空的。
4. `npm run build` 能打出包。

## 规矩

- 结束进程只能按确切的 PID（你自己启动的）；**禁止 `pkill`、`killall` 这类按名字杀进程的命令**。你开的后台服务器，干完用任务工具停掉或者 `kill <PID>`。
- `rm` 只写完整的绝对路径；不要 `cd 目录 && rm 相对路径`；不要 `rm` 带变量开头的路径。macOS 没有 `timeout` 命令。不要运行会等输入的命令。耗时长的命令放后台。
- 不要打印或者写下任何密钥、令牌、邮箱。不要发布、不要碰 Cloudflare、不要动 `wrangler.jsonc`。
- 可以上网搜参考来看（LoL、Dota 2、王者荣耀的界面和特效长什么样），**只看，不把别人的素材、图标、字体放进项目**；要用的美术自己做（代码画、SVG、或者用即梦生成）。
- 用即梦出图要排队（几个任务不能同时出）：`zsh /Users/jadon7/Documents/SynologyDrive/code/moba/tools/jimeng_lock.sh <jobs.json 的绝对路径>`，jobs 的格式看 `tools/jimeng_gen.py` 开头，`out` 写主目录下的绝对路径。模型：写实厚涂用 `jm_image_model_oa_it`（2K 一张约 21 积分），干净听话的图标用 `jm_image_model_gg_bp`（约 25 积分）。各任务的积分上限在各自的说明里，开始和结束各查一次余额（`dreamina-canvas auth account --format json` 里的 `availableCredits`）。已知的坑：下载的目标文件已经存在会报错但积分照扣，出图前把旧文件挪走。
- 文件归属：每个任务的说明里写了“你管哪些文件”。不归你的文件确实要改的时候，只做最小的改动，并在汇报里列出来（文件、哪几行、为什么），方便合并。
- 代码风格照现有的：一行可以很长，注释用中文、写“为什么”和踩过的坑。不要顺手重排别人的代码（会让合并冲突）。

## 用户的口味（这个项目一直在说的）

- 干净、融合、发光克制。反感杂、碎、老、光污染。重点处要精致。
- 行业里已经有标准做法的东西（界面、血条、手感、特效的层次），照 LoL、Dota 2、王者荣耀做，不要自己发明一套。
- 英雄要比小兵显眼，技能要有看得清的特效。
- 做完要对着标杆并排比、连续改几轮、自己挑毛病再交。
- 汇报要老实：做了什么、没做到什么、没验证什么，分开写；不要夸大。

## 最后怎么汇报

1. 你的分支名、提交了几次、改了哪些文件（按文件列，一句话说改了什么）；不归你管却改了的文件单独列。
2. 每条意见：改之前是什么样（数字或者截图）、改成了什么样、证据在哪（主目录 `docs/round9/<任务名>/` 下的文件名）。
3. 回归四项的结果。
4. 自己认为还弱的地方、没做到的、没验证的。
5. 即梦花了多少积分（没用就写没用）。
