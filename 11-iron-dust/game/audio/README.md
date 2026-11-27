# audio/ 素材投放目录

引擎侧逻辑见 `scripts/sfx.gd`：启动时先找 `res://audio/<id>.ogg`（或 `.wav`），
找到就用真实录音，找不到就回落到**程序化合成**（保证游戏永远有声音）。

## 使用方法

把文件按下面的名字放进 `tools/audio/src/` 并运行母带脚本（见下文），**不需要改代码**：

| 文件名（id） | 用途 | 建议时长 | 严格程度 |
|---|---|---|---|
| `rifle.ogg` | 突击步炮射击 | 0.3–1.0 s | 单发或短连发 |
| `gatling.ogg` | 转管机炮射击 | 1–2 s 密集 | 必须密集连发 |
| `smg.ogg` | 冲锋机炮 | 0.3–1.0 s | 单发 |
| `cannon.ogg` | 大口径炮（240mm 无后坐力炮） | 1–2 s | 要有低频冲击 |
| `shotgun.ogg` | 霰弹炮 | 0.5–1.0 s | 散弹感 |
| `missile.ogg` | 导弹发射 | 0.5–1.5 s | 带推进噪声 |
| `explosion.ogg` | 常规爆炸 | 1.5–3 s | 弹着爆炸 |
| `bigboom.ogg` | 重型爆炸 | 3–6 s | 建筑级、长尾 |
| `hit.ogg` | 命中金属 | 0.1–0.3 s | 短促金属撞击 |
| `ric.ogg` | 跳弹 | 0.2–0.4 s | 高频擦过 |
| `step.ogg` | 机甲脚步 | 0.3–0.8 s | 金属重物落地 |
| `land.ogg` | 落地 | 0.6–1.2 s | 比脚步更重 |
| `boost.ogg` | 推进器加速 | 0.4–1.0 s | 短促喷流 |
| `qb.ogg` | 快速推进 | 0.3–0.8 s | 更短更脆 |
| `swing.ogg` / `whiff.ogg` | 挥砍 / 挥空 | 0.2–0.5 s | 风声型 |
| `clang.ogg` | 兵器相撞 | 0.6–1.2 s | 金属鸣响 |
| `jet.ogg` | 长喷射 | 2–4 s | 可循环最佳 |
| `siren.ogg` | 警报 | 2–4 s | 循环 |
| `wind_loop.ogg` | 环境风（循环） | 10–30 s | **必须无缝循环** |
| `drone_loop.ogg` | 战斗低鸣（循环） | 10–30 s | **必须无缝循环** |
| `thr_loop.ogg` | 推进器长鸣（循环） | 1–3 s | **必须无缝循环** |

## 许可要求（唯一硬性）

- **可以**：CC0 / Public Domain / CC BY（需署名）/ Mixkit License
- **不可以**：CC BY-NC（禁商用）、CC BY-SA（传染性）、任何游戏提取音频

投放后在 `audio/CREDITS.md` 里补一行：

```
<文件名> — <标题> by <作者>, <许可>, <来源 URL>
```

## 2026-11-23 新增的 id

| 文件名（id） | 用途 |
|---|---|
| `beam_rifle.ogg` | 光束步炮射击 |
| `rail.ogg` | 线圈炮 / 磁轨炮 |
| `grenade.ogg` | 榴弹发射 |
| `hook.ogg` | 钩锁射出 |
| `plasma_swing.ogg` | 等离子火炬挥砍 |
| `heat_hit.ogg` | 热能 / 等离子命中灼烧 |
| `flak.ogg` | 防空弹空爆 |
| `scan.ogg` `jam.ogg` `ram.ogg` `focus.ogg` | 四种机体技能各自的启动声 |
| `swap.ogg` | 切换武器 |
| `brace.ogg` | 站定架设 |
| `servo.ogg` `touch.ogg` | 座舱瞄准镜臂、触摸屏 |
| `collapse.ogg` | 巨构崩塌低鸣 |

## 母带处理（响度统一、限幅、去毛刺）

`audio/` 里的文件不是原始素材，而是 `tools/audio/master.py` 从 `tools/audio/src/` 处理出来的：

- 按用途统一响度（最响 100 ms 的均方根）：界面/座舱 −21 dBFS，轻武器 −18，重武器 −15，爆炸 −14，机体动作 −17，技能/系统 −18，警报 −21，循环音 −19，BGM −13。
- 前瞻式峰值限幅到 −2 dBFS，编码后复查解码峰值都低于 −1 dBFS（原来有 12 个文件解码后超过满刻度，会破音）。
- 高频占比过大的素材（点击、维修、导弹、喷射等）按比例削减 4.5 kHz 以上，最多 9 dB。
- 去直流、首尾加短淡入淡出。

**换音效的做法**：把新文件按 id 命名放进 `tools/audio/src/`，运行 `python tools/audio/master.py`，不要直接放进 `audio/`（否则响度和别的对不上）。
`python tools/audio/measure.py` 可以列出每个文件的峰值、响度和削波情况。

游戏里另有一道保险：主总线挂了限幅器（−1 dB），单次播放的音量加成最多 +4 dB。

## 当前状态

2026-11-23：共 55 个音效文件加一首 BGM。启动日志会打印 `SFX: N real recordings, M synthesised`；目前只有 `beam` 仍为合成音。来源见 `CREDITS.md`。
