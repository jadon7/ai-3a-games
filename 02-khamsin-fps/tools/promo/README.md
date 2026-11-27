# 宣传片采集与剪辑流程

成片：`promo/KHAMSIN-宣传片.mp4`（1920×1080，60 fps，H.264 + AAC），总览图 `promo/contact-sheet.jpg`，镜头表 `promo/镜头表.md`。
所有中间文件放在草稿目录 `<SCRATCH>/promo-work/`（下文记作 `WORK`），发行版快照在 `<SCRATCH>/promo-build/`（记作 `BUILD`）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `receiver.mjs` | 帧接收服务（只听 127.0.0.1:5191，带 CORS）：页面 POST 来的 JPEG 落到 `WORK/frames/<镜头>/<序号>.jpg`，日志 / 音轨落到 `WORK/` |
| `capture.js` | 页面内采集库（复制到 `BUILD/` 后 `import('/capture.js')`，得到 `window.__P`）：固定 1920×1080 画布、逐帧推进 + 抓图、黑帧重渲、记录状态与音频事件 |
| `make_audio_module.mjs` | 把 `src/core/audio.js` 打补丁后写到 `BUILD/promo-audio/audio.js`：改用 `OfflineAudioContext`，**永远不接扬声器** |
| `audio_render.js` | 在空白页 `http://localhost:5190/promo-audio/` 里离线渲染音轨（采集时记录的音效事件、配乐计划、环境声计划）→ WAV |
| `mezz.py` | 逐帧 JPEG → 近无损中间片 `WORK/mezz/<镜头>.mp4`，核对帧数后可删原始帧 |
| `analyze.py` | 读实战采集段的状态表，按半秒打印机动状态（滑铲 / 蹬墙 / 钩索 / 空中 / 机甲 / 击杀），给出连招密集的候选时段 |
| `peek.py` | 按“源:起始帧:帧数”抽帧拼预览图，挑素材用 |
| `edl.json` | 剪辑表：镜头顺序、源、入点、长度、字幕、配乐强度、手工音效 |
| `edit.py` | 剪辑：`clips`（截镜头）→ `text`（Pillow 画字幕）→ `plan`（音频事件表）→ `audio`（numpy 混音）→ `final`（拼接 + 叠字 + 混音）→ `sheet`（总览图） |

## 重跑步骤

```sh
P=<项目目录>; S=<SCRATCH>; WORK=$S/promo-work; BUILD=$S/promo-build
# 1) 发行版快照 + 两个服务（都在后台；结束时用 kill <PID> 停）
cp -R "$P/dist/" "$BUILD/"; cp "$P/tools/promo/capture.js" "$P/tools/promo/audio_render.js" "$BUILD/"
node "$P/tools/promo/make_audio_module.mjs" "$BUILD"
printf '<!doctype html><meta charset="utf-8"><title>promo audio</title>\n' > "$BUILD/promo-audio/index.html"
ln -sfn "$WORK" "$BUILD/promo-logs"
(cd "$BUILD" && node serve.mjs 5190) &            # 静态服务
node "$P/tools/promo/receiver.mjs" "$WORK" 5191 &  # 帧接收
```

2) 内置浏览器开**自己的**标签页，打开 `http://localhost:5190/?mute&q=high`，等 `window.__dbg` 出现，然后：

```js
await import('/capture.js?' + Date.now());   // window.__P，画布固定 1920×1080
```

- **第一人称实战**：`__P.startDemo()` 开一局自动对战，再 `__P.play('g01', 60)`（60 秒，逐帧保存；阵亡回放自动跳过）。任务是异步的，用 `__P.status()` 轮询；结束时传回 `g01.rows.json`（状态表）和 `g01.audio.json`（音频事件）。
  需要机甲：`__dbg.game.tryCallMech()`（先把 `game.player.look` 指向一块空地），再 `__P.play('m02', 24)`，自动对战的 AI 会走过去登机。
- **空镜 / 光影**：`__P.fly('e05_gate', [{pos,look,fov}, {pos,look,fov}], 秒, {warm:150})`，关键帧之间线性插值，游戏冻结。各镜头机位见 `promo/镜头表.md`。
- **机甲空降（第三人称）**：开局后 `__dbg.cam(49,0.1,53,0,-0.14)` 把玩家放到长街，`player.look` 指向前方，`tryCallMech()`，然后 `__P.fly('t01_mechdrop', 固定机位, 6, {live:true, warm:10})`（`live` = 游戏照常推进、机位固定）。
- **AI 铁驭跟拍（第三人称，含士兵 / 铁驭近景）**：`__P.followPilot('t02_pilot', 45, {team:0})`（追尾机位）、`__P.followPilot('t03_pilot_side', 35, {team:1, back:1.2, side:5, up:1.7, fov:50})`（侧面机位）。状态表 `t02_pilot.rows.json` 每行 `[帧, 铁驭id, 蹬墙, 滑铲, 钩索, 着地, 速度, 距相机]`。

3) 中间片与挑素材：

```sh
python3 tools/promo/mezz.py "$WORK" g01 e05_gate ... --delete-frames
python3 tools/promo/analyze.py "$WORK" g01 --quiet        # 候选时段
python3 tools/promo/peek.py "$WORK" /tmp/x.jpg g01:2925:240 t02_pilot:1080:210
```

4) 音轨（另开一个标签页到 `http://localhost:5190/promo-audio/`）：

```js
await import('/audio_render.js?' + Date.now());
__PA.renderLogs(['g01','g02'], 'sfx_g.wav');                 // 实战音效（按 edl.json 里 audio.sfx_wavs 需要的分组各渲一份）
// 先在终端跑 python3 tools/promo/edit.py "$WORK" plan 生成事件表，再：
__PA.renderPlan('music_plan.json', 'music.wav', {music:true});
__PA.renderPlan('extra_plan.json', 'extra.wav');              // 空镜下的风声 + 机甲落地等手工音效
```

5) 剪辑：`python3 tools/promo/edit.py "$WORK" clips text audio final sheet`（`all` = 全部步骤，包括 plan）。

## 重采含士兵 / 铁驭近景的镜头

镜头表里“士兵近景”一列标“是”的镜头（目前是 AI 铁驭跟拍 t02 / t03、机甲空降 t01 的背景）在新动画下重采：
按第 2 步重新采 `t02_pilot` / `t03_pilot_side`（或 `t01_mechdrop`），`mezz.py` 压中间片，用 `peek.py` 和状态表重新挑入点，
改 `edl.json` 里对应镜头的 `in`，再跑第 5 步。对局不是确定性的，入点每次都要重新挑。

## 注意

- 采集页一律带 `?mute`；音频只用 `OfflineAudioContext` 离线渲染，不会出声。
- 面板里 rAF 被节流，所有画面都是“推进一帧 → 渲染 → 立刻 toBlob”离线逐帧得到的；同时开多个标签页会互相抢 GPU，偶尔出黑帧——`capture.js` 会读像素检测并重渲；采集进行中不要刷新别的游戏标签页。
- 画布没有 preserveDrawingBuffer，抓图必须紧跟渲染、在同一段同步代码里。
