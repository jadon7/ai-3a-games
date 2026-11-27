# 凌霜 lingshuang 进度

成品：`public/assets/fighters/lingshuang/lingshuang.glb`、`lingshuang.json`。骨架：Tripo 绑的 Mixamo 骨骼（65 根，`mixamorig:*`），根节点名 `lingshuang`；网格 `body`（身体）、`weapon`（刀，只蒙在 `mixamorig:RightHand` 上）。模型身高按 1（游戏放大到 1.74），面朝 -Y（glTF 里面朝 +Z），脚踩 0。

| 时间 | 成品里有什么 | 还没好 |
|---|---|---|
| 2026-11-25 22:50 | 只有架势 `idle_pose`（脚本摆的持刀架势 + 呼吸，3 秒循环）。骨架、刀、贴图都是最终的（RIG_READY），之后只加动作，骨架不会再变。 | 21 段动作全部 |
| 2026-11-25 第二版 | 架势 + `idle walk_f walk_b light1 light2 heavy block`（7 段），时间表已填。马尾权重改成只跟头（Head）。 | `jump light3 lunge launcher sweep air grab sp1 sp2 sp3 ult_start ult_combo win intro`（视频都出好了，正在读） |
| 2026-11-25 第三版（全量） | 21 段全齐：`idle walk_f walk_b jump block light1 light2 light3 heavy lunge launcher sweep air grab sp1 sp2 sp3 ult_start ult_combo win intro`，外加 `idle_pose`。时间表 `lingshuang.json` 全部填好。 | 无。不满意的见下 |
| 2026-11-25 通用动作 | 成品里有了视频读出的 `idle` 以后，重跑了 `tools/generic/build_generic.py art/generic/lingshuang/config.json --no-merge`（不花额度），`lingshuang_generic.glb/json` 的起始架势现在取 `idle` 第 0 帧。 | — |
| 2026-11-25 加分项 | `lingshuang_phys.glb`：同一套 21 段动作 + 马尾 4 节骨骼链 `phys_ponytail_01..04`（父骨骼 `mixamorig:Head`），动作里这 4 根骨骼没有动画通道（保持静止姿势，留给弹簧模拟）。`lingshuang.glb` 没有这几根骨骼。 | — |

已知问题：`ult_start` 冲步那几帧身体前倾得很平（像扑出去）；`ult_combo` 视频有运动模糊，第 5 下（回旋斩）时间点是估的，结尾跪地后 0.6 秒回架势是脚本补的；`win` 停在胜利姿势不回架势；`lunge`、`sp3` 两段刀的朝向是脚本按规则改的（视频里刀出画面/反手握读不准）。
