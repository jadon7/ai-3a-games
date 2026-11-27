# 通用动作交付记录

| 时间 | 角色 | 文件 | 动作 | 说明 |
|---|---|---|---|---|
| 2026-11-25 09:19 | gorran（替身） | `public/assets/fighters/_standin/gorran_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy knockdown ko | 第一版。受击为 v1 预设差量叠在 idle 第 0 帧上；knockdown 为关键姿势插值（躺姿手摆）；ko 为 defeat_03；hit_heavy 暂无后退步（待换源）；还没有 getup、hit_air |
| 2026-11-25 09:23 | yanjin | `public/assets/fighters/yanjin/yanjin_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy knockdown ko | 第一版。架势取 idle_pose 第 0 帧（成品里还没有 idle，出了 idle 要重跑）；hit_heavy 暂无后退步；还没有 getup、hit_air |
| 2026-11-25 09:24 | lingshuang | `public/assets/fighters/lingshuang/lingshuang_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy knockdown ko | 第一版。架势取 idle_pose 第 0 帧（出了 idle 要重跑）；倒地后刀放平、防刀穿地；受击时刀离腿最近 2–6mm 的帧还有几帧；hit_heavy 暂无后退步；还没有 getup、hit_air |
| 2026-11-25 09:31 | gorran（替身） | `public/assets/fighters/_standin/gorran_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy hit_air knockdown getup ko dizzy | 补全版：hit_heavy 改为上身受击 + 腿倒放 walk 退两步；新增 getup（手摆关键姿势）、hit_air、dizzy（程序生成循环）。没做 dash_f/dash_b |
| 2026-11-25 09:31 | yanjin | `public/assets/fighters/yanjin/yanjin_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy hit_air knockdown getup ko dizzy | 补全版：hit_heavy 改为上身受击 + 腿倒放 walk 退两步；新增 getup（手摆关键姿势）、hit_air、dizzy（程序生成循环）。没做 dash_f/dash_b |
| 2026-11-25 09:31 | lingshuang | `public/assets/fighters/lingshuang/lingshuang_generic.glb/.json` | hit_high hit_high2 hit_mid hit_mid2 hit_side hit_heavy hit_air knockdown getup ko dizzy | 补全版：hit_heavy 改为上身受击 + 腿倒放 walk 退两步；新增 getup（手摆关键姿势）、hit_air、dizzy（程序生成循环）。没做 dash_f/dash_b |
