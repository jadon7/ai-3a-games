# 音频任务：全部音效和配乐（程序化合成）

你是 Opus 5.5，负责给一个 2.5D 横版格斗游戏（写实 · 东方暗黑武侠，火系拳师「阎烬」对霜系女刀客「凌霜」，场景是雪夜残寺）做全部声音。全程中文。用户在睡觉，没有人可以问。

## 原则

- **全部自己合成，不从网上下载任何音频素材**。两种做法都可以，按效果选：
  - 离线合成：用 Python（`/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python`，有 numpy、scipy）写合成脚本，生成 WAV，再用 ffmpeg（已装，命令前加 `DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib` 如果报 x265 的错）转成 `.m4a`（AAC，Chrome 和 Safari 都能放）放到 `public/assets/audio/`。打击感、配乐这类要层次的建议走这条。
  - 运行时合成：WebAudio 节点现场合成（适合需要随参数变化的，比如按连击数升调）。
- 你听不到声音，所以**靠分析验收**：每个音效生成后算一下峰值、响度（RMS 或 LUFS 近似）、时长、频谱重心，画出波形和频谱图（matplotlib 存 PNG 用 Read 看），确认没有削波、没有直流偏移、首尾没有爆音（淡入淡出）、同类音效响度一致、低频没有糊成一片。打击声要有清楚的瞬态（起音 5 毫秒以内）和一个有重量的低频身体（60 到 150 赫兹）。
- 好的格斗游戏打击声是**叠层**的：瞬态的“啪”（噪声爆破，2 到 6 千赫）+ 身体的“咚”（低频正弦下滑）+ 质感层（布料、骨肉、金属、火、冰）+ 很短的空间尾巴。重击比轻击多一层更低更长的冲击和一点失真。照这个思路做，不要用一个正弦波糊弄。

## 接口

实现 `src/audio/audio.ts`，导出一个类（游戏那边按这个接口调用，签名不要改）：

```ts
export interface PlayOpts { volume?: number; rate?: number; pan?: number; delay?: number }
export class AudioSystem {
  /** 预载全部音频。可以在用户点击之前调用（只下载和解码，不出声） */
  init(): Promise<void>;
  /** 用户第一次点击或按键时调用，恢复 AudioContext */
  unlock(): void;
  /** 播一个音效。同名有多个变体时随机挑一个并自动做一点音高随机。pan：-1 左、1 右 */
  play(name: string, opts?: PlayOpts): void;
  /** 切配乐（交叉淡化）。null 是停 */
  music(name: 'menu' | 'battle' | 'victory' | null, fade?: number): void;
  /** 环境声循环开关（风声、火盆噼啪） */
  ambience(on: boolean): void;
  /** 总音量 0..1；分组音量 */
  setVolume(group: 'master' | 'sfx' | 'music', v: number): void;
  /** 慢动作时整体降调：rate 是游戏当前的时间倍率（1 正常，0.2 很慢）。配乐也跟着闷一点（低通） */
  setTimeScale(rate: number): void;
  /** 大招定格那一下：配乐瞬间压低再放开 */
  duck(amount: number, seconds: number): void;
}
```
没载入完、名字不存在、AudioContext 没解锁时都要静默忽略，不能抛错。

## 音效清单（名字固定）

| 名字 | 是什么 | 变体数 |
|---|---|---|
| `hit_light` | 轻击打中（拳脚） | 3 |
| `hit_heavy` | 重击打中，沉、有冲击 | 3 |
| `hit_slash` | 刀砍中（金属划过加一点湿的质感） | 3 |
| `hit_fire` | 带火的命中：重击上面叠一层火焰爆燃 | 2 |
| `hit_frost` | 带霜的命中：叠一层冰裂、清脆的高频 | 2 |
| `block` | 挡住了（拳脚打在前臂上，闷） | 2 |
| `block_blade` | 刀被挡住或用刀挡（金属碰撞） | 2 |
| `parry` | 弹反成功：很亮的金属“叮”加一声短促的冲击，要爽 | 1 |
| `guard_break` | 破防：玻璃碎裂感加一声闷响 | 1 |
| `whoosh_light` / `whoosh_heavy` / `whoosh_blade` | 挥拳、重挥、挥刀的破风声 | 各 3 |
| `step` | 脚步（石板上，轻） | 3 |
| `jump` / `land` | 起跳、落地 | 各 1 |
| `dash` | 冲刺（衣物加破风） | 1 |
| `bodyfall` | 倒地 | 2 |
| `fire_charge` | 火系蓄力（由低到高的轰鸣，约 0.5 秒） | 1 |
| `fire_blast` | 放出火焰冲击波 | 1 |
| `fire_fly` | 火球飞行的循环（约 1 秒，可循环） | 1 |
| `fire_explode` | 火焰爆炸（地面喷火、火球炸开） | 2 |
| `frost_charge` | 霜系蓄力（清冷的上行音，带结晶声） | 1 |
| `frost_wave` | 放出冰刃 | 1 |
| `frost_fly` | 冰刃飞行的循环 | 1 |
| `frost_shatter` | 冰碎裂 | 2 |
| `frost_spike` | 冰刺破地而出（由下往上、连续几声） | 1 |
| `super_freeze` | 大招定格：一声倒吸式的低频加一个尖锐的上行音，约 1 秒 | 1 |
| `super_fire` / `super_frost` | 大招最后一击的巨响（约 2 秒，带长尾） | 各 1 |
| `ko` | 终结一击后的余响（低频长音加一声钟） | 1 |
| `round_gong` | 回合开始的锣 | 1 |
| `fight_drum` | “开战”的一组鼓点（约 0.8 秒） | 1 |
| `win_sting` | 胜利的短乐句（约 2.5 秒） | 1 |
| `ui_move` / `ui_confirm` / `ui_back` | 界面：移动光标、确认、返回 | 各 1 |

配乐（循环，做成能无缝循环的）：
- `battle`：对战曲，约 60 到 90 秒一个循环。大鼓（太鼓）做骨架，低音持续音，上面是五声音阶的拨弦（古筝、琵琶那种质感，可以用 Karplus-Strong 合成）和箫一样的长音；每分钟 100 到 110 拍，紧张、肃杀，不要欢快。
- `menu`：主菜单和选人，慢、空，约 40 秒循环：风声、偶尔的钟、稀疏的拨弦。
- `victory`：胜利结算，不循环，约 8 秒。
- 环境声：风雪声加火盆的噼啪，约 20 秒循环。

## 交付和规矩

- 代码 `src/audio/audio.ts`（只写这个目录），资源 `public/assets/audio/`，合成脚本 `tools/audio/`，分析图和说明 `docs/audio/`。全部音频加起来不超过 12MB。
- 做一个试听页 `lab/audio.html`（每个音效一个按钮、配乐切换、时间倍率滑条），开发服务器已经在 `http://localhost:5300` 跑着，**不要重启它**；`lab/` 下只写你自己的 `audio.*`。`src/` 下别的目录只读。
- 尽快先交一版能用的（先做 `hit_light hit_heavy hit_slash block whoosh_*` 和 `battle`），之后补全。每次交付在 `docs/audio/STATUS.md` 记一行。
- 结束进程只用确切 PID，禁止 `pkill`、`killall`；`rm` 只写完整的字面量绝对路径；不跑等输入的命令；长命令放后台；不 `git commit`。

## 报告（最后一条消息）

先给结论，再写：每类音效怎么合成的；响度和峰值是否一致；配乐的结构；哪些没把握（因为听不到）；接口有没有改动。不要只报喜。
