# 界面任务：对战界面、菜单和整个游戏流程

你是 Opus 5.5，负责一个 2.5D 横版格斗游戏（three.js，写实 · 东方暗黑武侠）的**全部界面和游戏流程**：对战时的血条气槽等、出招字幕、大招切入、回合播报，以及主菜单、选人、对阵、结算、暂停。要做到 3A 格斗游戏的界面水准。全程中文。用户在睡觉，没有人可以问：自己判断、自己改到满意。

## 游戏是什么

《烬霜》：两名原创角色，阎烬（火系重拳拳师，橙红）对凌霜（霜系快刀女刀客，冰蓝），场景是雪夜残寺。角色资料 `docs/FIGHTERS.md`、`src/data/fighters.ts`（`ROSTER`、招式表）；设定图 `concepts/fighters/*-sheet-1.png`。

## 视觉方向

- 东方暗黑武侠：墨、金属、宣纸、朱砂印。**克制**：深色半透明底、细金属描边、书法字只用在标题和播报上，正文用清楚的黑体。不要霓虹、不要赛博、不要圆角卡片堆叠、不要表情符号。
- 两个角色各有一个主色（阎烬 `#ff6a1a`、凌霜 `#7fd8ff`），界面上属于谁的东西就带谁的颜色。
- 动效要有打击感：血条掉血先闪白、再有一条延迟跟上的残影；连击数字每加一下弹一下；播报文字像毛笔一笔扫出来（遮罩擦除 + 轻微缩放回弹），退场干脆。所有动效用 CSS transform / opacity，不要触发布局。
- 字体：标题和播报用书法体，装 `@fontsource/ma-shan-zheng`（或你觉得更合适的，`@fontsource/zcool-xiaowei`、`@fontsource/noto-serif-sc` 都可以装，`npm install` 即可），正文用系统黑体。数字用等宽、有力的西文字体。
- 对标：街霸 6、铁拳 8、真人快打 1 的对战界面的信息布局和动效节奏（只学布局和节奏，不要照搬它们的图形）。做之前先想清楚这类界面好看在哪，做完自己截图对着挑毛病，改几轮。

## 要做的东西

### 对战界面（`src/ui/hud.ts`，实现 `Presenter` 接口）
- 顶部：两条血条（左边一号位、右边二号位镜像），角色名和称号，头像，胜局标记（两胜制），中间是倒计时。血条下面是气槽（满 100，满了要有“大招就绪”的醒目状态）和防御条（细，被打空会破防）。
- 连击：谁在连击就显示在谁那一侧，“N 连”加本次连段的总伤害；断了以后停一下再消失。
- 提示字：破招（`counter`）、弹反（`parry`）、破防（`guardBreak`）、完美（满血获胜）。
- 招式名：放技能时在出招者一侧闪一下招式的中文名（`MoveDef.name`，`kind` 是 `special` 的）。
- **大招切入**：`superFreeze` 事件时（世界定格约 1 秒），一道墨色的笔触横扫过屏幕，上面是角色的大招特写图和大招的名字（“焚天” / “霜天”）。特写图用即梦出（见下）。
- 回合播报：`round` 事件的各个阶段——“第一回合 / 第二回合 / 决胜回合”、“开战”、“终结”（KO）、“时间到”、“阎烬 胜”。
- 训练模式（`game.config.training`）：左下角显示按键说明和出招表。
- 所有数字从 `game.match` 里每帧读（`match.f[i].hp / def.hp / meter / guard / wins / comboHits / comboDmg`、`match.timer`（帧，除以 60 是秒）、`match.round`、`match.phase`）。展示模式（`game.config.showcase`）时对战界面整个隐藏。

### 菜单和流程（`src/ui/` 下，入口 `src/app.ts`）
`src/app.ts` 导出 `export async function runApp(game: Game, presenter: FightPresenter): Promise<void>`，`src/main.ts` 会在启动后调用它（地址栏带 `?direct` 时不调用，直接开打，调试用）。流程：

1. **主菜单**：游戏名「烬霜」（书法大字）和副标题，选项：单人对战（打电脑）、双人对战（同一键盘）、观战演示（电脑打电脑，录视频用）、训练。背后是实时的 3D 场景（什么都不用做，场景本来就在渲染；可以调 `game.startMatch({ p1, p2, ctrl: ['dummy','dummy'], showcase: true })` 让两人站在场上）。
2. **选人**：两张角色卡（名字、称号、一句介绍、四项能力条，数据在 `ROSTER`）。单人：选自己的角色、再选对手和难度（1 到 3）；双人：两人各选各的；观战：直接随机或让用户选。选中时背后的 3D 角色跟着换（用展示模式的 `startMatch`，镜头可以用 `game.cam.play([...])` 给选中的角色一个近景，`Shot` 的写法看 `src/render/camera.ts` 和 `src/present/fightFx.ts` 里的 `introShots`）。
3. **对阵过场**：斜切的左右分屏，两个角色的特写图和名字，“对”字，约 2.5 秒，然后开打：`game.startMatch({ p1, p2, ctrl, level, training })`，`ctrl` 是 `'human' | 'cpu' | 'dummy'`。
4. **对战**：等 `round` 事件的 `phase: 'matchEnd'`（带 `winner`）。
5. **结算**：胜者的名字和特写、再来一局 / 重新选人 / 回主菜单。观战模式自动再来一局（换边或换角色）。
6. **暂停**：对战中按 Esc 或回车，`game.paused = true`，显示继续 / 出招表 / 退出到主菜单。

操作：键盘为主（方向键或 WASD 移动光标，J 或回车确认，K 或 Esc 返回），鼠标点击也要能用。按键定义在 `src/core/input.ts`（`KEYS_P1`、`KEYS_P2`、`KEYS_SOLO`），出招表里显示的按键从这里读，不要写死。界面里要有一处清楚的按键说明（主菜单角落、暂停菜单里）。

音效：`presenter.audio.play('ui_move' | 'ui_confirm' | 'ui_back' | 'round_gong' | 'fight_drum' | 'win_sting')`；配乐：`(game as any).audio?.music('menu' | 'battle' | 'victory')`、`.ambience(true)`（音频系统是另一个任务在做，可能还没有，调用前判空）。

### 图
用即梦出图（`tools/jimeng_gen.py`，例子 `concepts/jobs_sheets.json`，日志在 `concepts/_raw/log.jsonl`；图生图在 job 里写 `"refs": ["yanjin-sheet-1"]` 引用设定图那个节点；模型用 `jm_image_model_gg_bp_21`，一张约 13 积分）。**额度：即梦 ≤ 200。** 要出的：
- 两个角色的半身特写（选人卡、对阵过场、结算用）：和设定图是同一个人、同一套服装，有姿势、有情绪、戏剧性的侧光，深色简单背景，便于抠成去底图（或者直接让背景是纯黑，用 CSS 混合模式叠上去）。
- 两张大招切入的横幅特写（眼神或出招瞬间的大特写，阎烬配火光、凌霜配霜气）。
- 需要的话：标题画面的题字或印章、纸张 / 墨迹的纹理。也可以用 CSS / SVG 画。
出来的图自己看一遍（Read），不像同一个人、手画坏了就重出。成品压成 webp 放 `public/assets/ui/`。

## 接口和约束

- 先读：`src/game.ts`（`Game`、`Presenter`、`MatchConfig`）、`src/combat/types.ts`（`FightEvent` 的全部类型）、`src/combat/sim.ts`（`Match`、`Fighter` 的字段）、`src/present/fightFx.ts`、`src/main.ts`、`src/core/input.ts`、`src/data/fighters.ts`。
- 对战界面是纯 DOM / CSS，挂在 `#ui` 下面（`index.html`），`pointer-events` 默认关、只有菜单开。每帧更新要轻：只改变了的才写 DOM，血条用 `transform: scaleX`。
- 在 `src/app.ts` 里把你的界面对象 `game.presenters.push(...)` 进去。
- **只写这些位置**：`src/ui/`、`src/app.ts`、`src/style.css`（可以整个重写）、`public/assets/ui/`、`lab/ui.*`、`concepts/ui/`、`docs/ui/`。`src/` 下别的文件是别人的（调度正在改），只读；需要游戏那边加接口就写进报告，同时自己先绕过去。
- 开发服务器已经在 `http://localhost:5300` 跑着（Vite，没有热更新，改了刷新）。**不要重启、不要停。**
- 现在角色的正式模型只有架势（动作还在做），所以调试时地址栏加 `?standin` 用替身角色（有完整动作）。`?mute` 关声音。`window.__dbg`（`src/debug.ts`）有调试入口：`__dbg.skipIntro()`、`__dbg.move(0,'sp1')`、`__dbg.run(秒)` 等。
- 截图用无界面 Chrome（项目里装了 `playwright-core`，Chrome 在 `/Applications/Google Chrome.app`；写法参考 `/Users/jadon7/Documents/SynologyDrive/code/moba/tools/shot.mjs`）。同一时间只开一个你自己的无界面 Chrome，用完关；白屏就重截。1920×1080 和 1280×720 都要看；窄屏（宽度 900 以下）至少不要错位。

## 交付

1. 尽快先交一版能用的（对战界面 + 最简单的流程），在 `docs/ui/STATUS.md` 记一行。之后边做边覆盖。
2. 最终：全部界面、流程、图；每个界面的截图放 `docs/ui/`。

## 规矩

结束进程只用确切 PID，禁止 `pkill`、`killall`；`rm` 只写完整的字面量绝对路径；不跑等输入的命令；长命令放后台；不打印密钥；不 `git commit`。

## 报告（最后一条消息）

先给结论（好不好看、最大的差距），再写：做了哪些界面、流程怎么走；每帧更新的开销；即梦花了多少；需要游戏那边配合改的地方；没做成的、没验证的。附截图路径。不要只报喜。
