# 音频交付记录

| 时间 | 内容 |
|---|---|
| 2026-11-25 第 1 版 | 首批可用：`hit_light hit_heavy hit_slash block block_blade whoosh_light/heavy/blade`（各 2-3 个变体）+ `battle` 配乐（73.1 秒无缝循环，105 BPM）。`src/audio/audio.ts` 接口完整可用，试听页 `lab/audio.html`。Chrome 实测解码长度与循环点逐样本一致。 |
| 2026-11-25 第 2 版 | 补全清单全部 36 个音效名（57 个文件）+ `menu`（40 秒循环）、`victory`（8.5 秒）、环境声 `amb_snow`（20 秒循环）。总 3.12MB。所有音效瞬时响度与目标误差 < 0.5 LU、峰值 ≤ -1 dBFS；循环接缝跳变低于接缝附近 99 分位逐样本差。新增可选接口 `loop(name)`（原签名未改）。AudioContext 固定 44.1kHz。 |
