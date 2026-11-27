# 烬霜 · 武斗

原创 2.5D 横版格斗游戏（3D 角色、侧面镜头），写实 · 东方暗黑武侠。网页里直接玩，three.js。
两名全新角色：**阎烬 · 烬拳**（火系重拳拳师）对 **凌霜 · 霜刃**（霜系快刀女刀客），场景「雪夜残寺」。

2026-11-25 一夜做成：Fable 5.2 负责设计、战斗核心、动画系统、特效框架和整合；角色管线、场景、界面、音效、专属特效由 Opus 5.5 并行完成。

## 怎么跑

```bash
npm install
npm run dev
```

然后打开 <http://localhost:5300>。

地址栏参数（调试、录屏用）：

| 参数 | 作用 |
|---|---|
| `?direct` | 跳过菜单直接开打（配合下面几个用） |
| `p1=yanjin&p2=lingshuang` | 选角色 |
| `p1c=cpu&p2c=cpu` | 谁来控制：`human`、`cpu`、`dummy`（木桩）。两边都是 `cpu` 就是观战 |
| `level=1..3` | 电脑难度 |
| `training` | 训练模式（不掉血、气常满） |
| `boxes` | 画出命中盒和受击盒 |
| `standin` | 用替身模型（开发时角色动作没做完用的） |
| `nostage` / `mute` | 不载入正式场景 / 静音 |
| `nolimit` / `noprocfix` | 关掉关节限位 / 关掉“程序化叠加逐帧累积”的修复（只用来对比修复前后） |
| `nosanitize` | 关掉泛光之前的坏像素清洗（只用来复现“闪黑块”） |

## 操作

| | 一号位 | 二号位（双人） |
|---|---|---|
| 移动 / 跳 | A D / W（单人时方向键也行） | ← → / ↑ |
| 轻击 | J | 小键盘 1 或 `,` |
| 重击 | K | 小键盘 2 或 `.` |
| 技能 | L | 小键盘 3 或 `/` |
| 防御 | U 或空格 | 小键盘 4 或 M |
| 投技 | I | 小键盘 5 或 N |
| 大招（气满） | O | 小键盘 6 或 B |
| 冲刺 | 双击方向，或左 Shift | 双击方向，或右 Shift |

另外：`H` 隐藏 / 显示界面（录干净画面用），`Esc` 或回车暂停。

出招：

- 轻击连按三下是一套连段；连段里可以接重击、技能。
- 重击：站着按是重击，按住「前」是突进重击，按住「下」是挑空（之后可以追打）。按住「下」加轻击是扫腿。
- 技能：不按方向是飞行道具，按住「前」是突进技，按住「下」是地面技。
- 防御挡不住投技；刚按下防御的一瞬间挡住攻击是**弹反**，对手会被弹开露出破绽。一直防会被打空防御条而破防。
- 气槽满了按大招：先定格，再突进；打中就进入演出。

## 目录

| 路径 | 是什么 |
|---|---|
| `src/combat/` | 战斗模拟：`sim.ts`（状态机、命中、连段、演出）、`types.ts`、`ai.ts`（电脑对手）。固定 60 帧每秒，和画面解耦 |
| `src/data/` | `fighters.ts` 两名角色的招式帧数表；`build.ts` 把帧数表和动作时间表对上（分段变速）；`assets.ts` 载入角色、自动算命中盒 |
| `src/anim/` | `rig.ts` 骨架；`animator.ts` 动作播放（时间由模拟给）；`ribbon.ts` 腰带的布料物理；`springbones.ts` 马尾；`limits.ts` 腰和脖子的关节限位 |
| `src/present/` | `fighterView.ts` 角色表现（受击弹簧、头部跟随）；`fightFx.ts` 把模拟事件变成特效、镜头、声音 |
| `src/fx/` | `core.ts` 特效系统；`common.ts`、`generic.ts` 通用和基线特效；`yanjin.ts`、`lingshuang.ts` 角色专属特效 |
| `src/render/` | `gfx.ts` 渲染和后处理；`camera.ts` 对战镜头和分镜 |
| `src/stages/temple/` | 场景「雪夜残寺」 |
| `src/ui/`、`src/app.ts` | 对战界面、菜单和流程 |
| `src/audio/` | 音频系统（音效和配乐全部程序化合成，脚本在 `tools/audio/`） |
| `public/assets/fighters/<id>/` | 角色成品：`<id>.glb`（模型 + 专属动作）、`<id>.json`（动作时间表）、`<id>_generic.glb`（受击、倒地等通用动作） |
| `art/` | 角色、场景的制作过程文件 |
| `docs/` | 设计和各任务的说明、验收截图 |
| `tools/` | `fxshot.mjs` 一招的连拍联系表；`posesheet.mjs` 把角色定在某段动作的某几个时刻拍近景，并标出腰和脖子的角度（查姿势问题用）；`nanscan.mjs` 电脑对打时逐帧找无效像素并定位是哪个物体画出来的（查“画面闪黑块”用）；`record.mjs` 逐帧录制 60 帧的实机视频；`fps.mjs` 量帧率；`generic/` 通用动作的重定向工具；`audio/` 合成脚本 |

## 角色是怎么做出来的

沿用「3d 模型骨骼绑定」（`video2rig`）那条管线，按格斗游戏的需要做了调整：

1. 即梦出正面 A 字站姿的设定图 → Tripo 图转 3D（6 万面、4K 贴图、全套 PBR）→ Tripo 自动绑骨（Mixamo 骨骼命名）。
2. 每个角色 21 段专属动作（架势、进退、跳、防御、三段轻击、重击、突进、挑空、扫腿、空中攻击、投技、三个技能、大招两段、胜利、出场）：即梦出“正面 + 侧面”双机位视频 → 远程 4090 上训练这个角色专用的关节检测器 → 把视频读成骨骼动作 → 裁剪、去位移、装进模型。
3. 受击、击飞倒地、起身这类贴地的动作视频管线做不好，改用 Tripo 的真人动捕预设，重定向到角色自己的骨架上，并以“差量”的方式叠在角色的格斗架势上（`tools/generic/`）。
4. 游戏里再加一层程序化的东西：按帧数表给动作分段变速、受击弹簧、头部跟随对手、布料物理、刀光拖尾。

详细说明：`docs/FIGHTERS.md`（角色和动作设计）、`docs/FIGHTER_PIPELINE.md`、`docs/GENERIC_MOTIONS.md`、`docs/STAGE.md`、`docs/UI.md`、`docs/AUDIO.md`、`docs/FX.md`。

## 录视频素材

```bash
# 电脑对打，从出场演出开始，带界面，录 45 秒 1080p 60 帧（无声）
node tools/record.mjs --out docs/showcase/match.mp4 --sec 45 --intro --hud
# 不带界面的干净画面，跳过开场
node tools/record.mjs --out docs/showcase/clean.mp4 --sec 30
# 某一招的连拍联系表
node tools/fxshot.mjs --out docs/showcase/sp1.jpg --move sp1 --frames 4,10,16,22,30,40,55,75 --gap 4 --q "training&mute"
```

`record.mjs` 是按固定的 1/60 秒一帧推进、逐帧截图再编码，出来的视频一定流畅，但没有声音。要带声音就在浏览器里开「观战演示」用录屏软件录（`H` 键隐藏界面）。

## 现状和已知问题（2026-11-25）

做完并验证过的：

- 两名角色各 21 段专属动作加 11 段通用动作，全部在游戏里逐招看过；每招都有专属特效，两个大招都有定格、分镜和终结演出。
- 完整流程：主菜单 → 选人（背后是实时 3D 角色）→ 对阵过场 → 出场演出 → 三回合对战 → 结算；暂停、训练模式、观战循环。
- 电脑对手三档难度。纯模拟连跑 60 局电脑对打：阎烬 29 胜、凌霜 31 胜，平均一场 98 秒，没有卡死和报错。

2026-11-25 白天修掉的（用户反馈“男角色的头有时候转进身体里”）：

- **根因是表现层的一个错误**：动作停在某一帧不动时（胜利定格、倒地、防御保持、受击顿帧），three.js 的动画混合器不会重写骨骼，而“头部跟随对手”和“受击弹簧”每帧都在骨骼上再叠一次，越叠越多，头一路转进胸口。两名角色都有。修在 `src/present/fighterView.ts`（叠加之前先还原成纯动作的值）。
- **通用受击动作脖子后仰过头**（重受击 78 到 84 度、倒地不起 72 度）：加了关节限位 `src/anim/limits.ts`，腰和脖子超出人体范围的部分平滑压回来；专属动作量过，基本碰不到上限。
- **击倒瞬间被打飞的人飞出画面上沿**：击飞动作自己带一段腾空，镜头原来只按模拟高度取景，而且击倒时的推近会把镜头拉得比击飞取景还近。改在 `src/game.ts`、`src/render/camera.ts`。
- **画面上闪黑色方块**（用户反馈）：场景的雾片着色器在雾片最上沿做了 `pow(1.0 - vUv.y, 1.6)`，插值误差让底数略小于 0，个别像素算出 NaN；泛光逐级缩放把这一个像素放大成整块黑。在 2 倍像素密度的屏幕上约 2% 的帧会中招。改了三层：雾片这一处；所有着色器里同类的幂运算和法线归一化统一改成安全写法（34 处）；泛光之前加一道坏像素清洗（`src/render/gfx.ts` 的 `createSanitizePass`）兜底，故意注入坏像素验证过：不开清洗整屏变黑，开了只剩坏像素本身那几个点（`docs/anim_check/inject_off.jpg` / `inject_on.jpg`）。修复后 45 秒对打 5400 帧无坏像素（修复前 14 秒里有 36 帧）。
- 对比图在 `docs/anim_check/`（`win_before.jpg` / `win_after.jpg` 最直观）。`docs/showcase/` 里的演示视频是修复前录的，没有重录。

已知的不足：

- **声音没人听过**。音效和配乐全部是程序合成的，只做了响度、峰值、频谱的数值验收。好不好听需要人来判断，改起来在 `tools/audio/`。
- **走路有滑步**。视频管线出的垫步是原地做的，步幅很小，游戏里角色移动得比脚步快。已经把行走速度调低来减轻，但没有消除。
- **部分动作的时间点是估的**（阎烬的防御保持段、贴山靠和震地的出手时刻，凌霜大招第五刀和跃斩的命中时刻），出手和特效可能差一两帧。
- **角色的脸没有表情**，嘴不会动（绑骨没有下颌和面部骨骼）。凌霜戴面甲看不出来，阎烬的特写里能看出来。
- **帧率**：M3 Max 上 1920×1080 全特效、不锁帧，机器上没有别的渲染任务时实测 74 到 79 帧（`node tools/fps.mjs`）；同时跑着别的 Blender 渲染时会掉到 30 到 55 帧。整帧约 74 万面、90 到 125 次绘制调用。
- 手柄、双人同键盘的按键冲突没有实测。
- 只在 Chrome 里跑过。

## 花费（2026-11-25 这一夜）

| | 开始 | 结束 | 用掉 | 用在哪 |
|---|---|---|---|---|
| Tripo | 2195 | 1080 | 1115 | 两个角色的模型和绑骨 170；通用动作（三次老版本绑骨加动捕预设）545；场景道具两轮 400 |
| 即梦 | 2918 | 742 | 2176 | 42 段动作视频 1890；角色、武器设定图 65；场景设定图和贴图 143；界面特写和笔触 78 |

约定是各留两成（Tripo 439、即梦 584），都守住了。

`art/stage/work/` 里有约 179MB 的场景模型处理中间文件，可以删（都能重新生成）。

---

## 关于这份拷贝（总仓库说明）

这份目录是从作者本机的项目里**只挑源码、文档和小配置**拷出来的。角色模型、场景模型和贴图、界面图片和字体、音频、制作中间文件、演示视频都没放进来，**直接 clone 下来大多不能完整运行**：代码能装能编译，但 `public/assets/` 里的角色、场景、界面和声音文件都不在，游戏载不进角色和场景。

### 怎么运行

```bash
npm install          # three 0.175、postprocessing、n8ao；开发依赖 vite、typescript、playwright-core
npm run dev          # http://localhost:5300
npm run build        # 打包到 dist/（试验页 lab/*.html 也会一起打包）
npm run typecheck    # 只做类型检查
```

- 试验页：`/lab/stage.html`（场景）、`/lab/ui.html`（界面）、`/lab/audio.html`（声音）。
- `tools/record.mjs`、`fxshot.mjs`、`posesheet.mjs`、`fps.mjs` 这些截图 / 录屏工具通过 `playwright-core` 驱动本机的 Google Chrome，要先开着 `npm run dev`。
- 要正常玩，得先把下面表里 `public/assets/` 的几项补齐。

### 需要自己配的外部服务

- **Tripo**（`tools/tripo.py`、`tools/tripo_batch.py`：图转 3D、自动绑骨、动捕预设）：先读环境变量 `TRIPO_API_KEY`，没有的话读 `~/.config/video2rig/env` 文件里 `TRIPO_API_KEY=` 那一行。key 故意不放在项目目录里。
- **即梦**（`tools/jimeng_gen.py`：设定图、贴图、界面图）：调用即梦画布的命令行工具 `dreamina-canvas`，需要自己装好并登录。脚本里写死了作者自己的画布项目编号（`PROJECT`），换成自己的才能用。出图任务的例子在 `concepts/jobs_sheets.json`、`concepts/ui/jobs_ui*.json`、`art/stage/jobs_concepts*.json`。
- **角色动作管线**用的是 video2rig（见总仓库的 [`../09-video2rig/`](../09-video2rig/README.md)）和 MOBA 项目里的外围工具（`hero_build.sh`、`remote.sh`、`HERO_PIPELINE.md` 等，见 [`../03-moba-ember-tide/tools/`](../03-moba-ember-tide/tools/)）。关节检测器的训练图渲染和训练是放在作者自己的一台远程 4090 机器上跑的，别人用要换成自己的机器。
- `art/`、`tools/`、`lab/` 里不少脚本把作者本机的绝对路径写死了（项目目录、MOBA 和 video2rig 的目录、字体文件位置），换台机器要先改路径。

### 哪些东西不在仓库里

合计约 1.3 GB。

| 内容 | 原目录 | 大约体积 | 怎么重新生成 / 从哪拿 |
| --- | --- | --- | --- |
| 两名角色的成品：`<id>.glb`（模型 + 21 段专属动作）、`<id>_generic.glb`（通用受击、倒地动作） | `public/assets/fighters/yanjin/`、`lingshuang/` | 约 13 MB | 即梦设定图 → Tripo 图转 3D 和绑骨 → 即梦生成动作视频 → video2rig 解成骨骼动作 → `art/fighter/<id>/build.sh`（Blender + `tools/pipeline/` 里的 `hero_build.py`，再用 `gltf-transform` 压缩）；通用动作用 `tools/generic/`。整条链要 Tripo、即梦的额度和 GPU 训练，原始文件在作者本机，未公开。各自的 `.json` 动作时间表在仓库里 |
| 替身模型 `gorran.glb` 等（`?standin` 用） | `public/assets/fighters/_standin/` | 约 3 MB | 从作者的 MOBA 项目拷来的，原始文件在作者本机，未公开 |
| 场景「雪夜残寺」的道具模型和贴图 | `public/assets/stage/temple/` | 约 7 MB | 道具是即梦出设定图 → Tripo 图转 3D → `bash art/stage/build_props.sh`（减面、贴图转 webp、meshopt 压缩）；任务清单在 `art/stage/jobs_*.json`。原始模型在作者本机，未公开 |
| 界面图片（半身特写、头像、大招横幅、墨笔遮罩） | `public/assets/ui/*.webp` | 约 1 MB | 即梦出图（任务在 `concepts/ui/jobs_ui*.json`），压成 webp；原图在作者本机，未公开 |
| 界面字体子集 `brush.woff2`、`serif.woff2`、`num.woff2` | `public/assets/ui/fonts/` | 约 0.6 MB | `bash lab/ui.fonts.sh`：用 `pyftsubset`（fonttools）从三款 OFL 开源字体（马善政毛笔楷书、思源宋体、Oswald）里裁出用到的字；字体文件要自己准备，并改脚本里的路径 |
| 音效和配乐 `*.m4a` | `public/assets/audio/` | 约 3 MB | 全部程序合成：`cd tools/audio` 后运行 `sfx.py`、`music.py`、`manifest.py`（详见 `docs/audio/README.md`；要 numpy、scipy、matplotlib，转 AAC 用 ffmpeg）；`manifest.json` 在仓库里 |
| Python 虚拟环境、中间 WAV | `tools/audio/.venv`、`tools/audio/wav/` | 约 275 MB | 自己建虚拟环境装上面几个包；WAV 会重新生成 |
| 角色制作过程文件（Tripo 原始模型、动作视频和抽帧、解算结果） | `art/fighter/`、`art/models_src/` | 约 280 MB | 跑上面的角色管线时产生，原始文件在作者本机，未公开 |
| 通用动作的中间文件 | `art/generic/` | 约 120 MB | `tools/generic/` 的脚本产生，原始文件在作者本机，未公开 |
| 场景制作中间文件 | `art/stage/` | 约 210 MB | 其中 `art/stage/work/` 约 179 MB 可由 `build_props.sh` 重新生成；Tripo 原始模型在作者本机，未公开 |
| 设定图 | `concepts/` | 约 20 MB | 即梦出图（`tools/jimeng_gen.py`），原图在作者本机，未公开 |
| 演示视频和验收截图 | `docs/`（其中 `docs/showcase/` 约 141 MB） | 约 220 MB | 演示视频可以用 `tools/record.mjs` 重录；原文件在作者本机，未公开 |
| npm 依赖、打包结果 | `node_modules/`、`dist/` | 约 140 MB | `npm install`、`npm run build` |

### 素材许可

- 角色、武器、场景道具、贴图、界面图和动作视频都是用 Tripo、即梦生成的；通用受击动作是 Tripo 的动捕预设。文档里的“Mixamo 骨骼”只是骨骼命名方式。这些生成内容的使用条款以 Tripo、即梦各自的服务条款为准，文档里没有另外写。
- 界面字体是 OFL 开源字体（马善政毛笔楷书、思源宋体、Oswald）的子集。
- 音效和配乐全部程序合成，没有下载任何素材。
- 场景任务说明里允许过用 Sketchfab 的 CC0 / CC-BY 模型（来源要记进 `CREDITS.md`），但项目里没有 `CREDITS.md`，按场景的制作记录，道具都来自 Tripo。
