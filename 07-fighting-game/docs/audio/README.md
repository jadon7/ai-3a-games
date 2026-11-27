# 音频说明

全部声音程序化合成，没有下载任何素材。重新生成：

```
cd tools/audio
.venv/bin/python sfx.py            # 全部音效（可带名字前缀只生成一部分）
.venv/bin/python music.py          # battle menu victory ambience
.venv/bin/python manifest.py       # 重建 public/assets/audio/manifest.json
```

- `tools/audio/.venv`：自建虚拟环境（numpy / scipy / matplotlib），可删可重建；`tools/audio/wav/` 是中间 WAV（约 32MB），可删。
- 输出：`public/assets/audio/*.m4a`（AAC，音效单声道 80k、大招类立体声 128k，配乐 128k）+ `manifest.json`。
- 分析：`sfx_*.png` / `music_*.png`（波形 + 对数频谱）；`sfx_report.json` / `music_report.json`（时长、峰值、瞬时最大响度、积分响度、起音时间、频谱重心、40–160Hz 能量占比、首尾样本、循环接缝）。

## 响度目标（瞬时最大响度，LUFS 近似）

| 档 | 音效 | 目标 |
|---|---|---|
| 最响 | super_fire / super_frost | -9 |
| 重 | hit_heavy hit_fire guard_break fire_explode ko fight_drum | -11 |
| 中 | hit_frost parry fire_blast frost_shatter frost_spike super_freeze round_gong | -12 |
| | hit_slash frost_wave win_sting | -13 |
| 轻 | hit_light -14，block_blade -14，block -16，fire/frost_charge -16，bodyfall -17 |
| 动作 | land/dash -21，whoosh_heavy -20，whoosh_blade -21，whoosh_light -22，jump -25，step -28 |
| 界面 | ui_confirm -22，ui_back -25，ui_move -26 |
| 配乐（积分） | battle -16，victory -16，menu -21，环境 -27 |

运行时配乐组默认音量 0.7，所以对战时配乐实际比打击低约 8 到 10 dB。

## 运行时

- `AudioSystem.loop(name, opts)`：新增的可选方法，返回 `{stop(fade), setPan, setVolume}`，给 `fire_fly` / `frost_fly` 用；`play('fire_fly')` 也能用，只放一遍并自动加首尾包络。
- 慢动作：音效音高 = rate^0.35（0.2 倍速约降 10 个半音），配乐音高 = rate^0.12，低通 700Hz·(20000/700)^rate。
- `duck(amount, s)`：30ms 压低，保持到 s 的一半，再线性放开到 s。
- 同名最多 4 个同时发声、总共 40 个，超出淡出最老的；同名多个变体不连续重复，音高随机 ±3%。
