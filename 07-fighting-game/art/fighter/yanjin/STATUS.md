# 阎烬 yanjin 进度

成品：`public/assets/fighters/yanjin/yanjin.glb`（时间表 `yanjin.json`）。骨架 Mixamo 命名（`mixamorig:*`，65 根），模型脚踩 0、面朝 -Y、身高约 1.0。

| 时间 | 成品里有什么 | 说明 |
|---|---|---|
| 2026-11-25 第 1 版 | 只有架势 `idle_pose`（呼吸循环 3.2 秒） | 骨架已定（RIG_READY），之后不再变。21 段动作都还没有。贴图 4096 webp（基础色、法线、金属度粗糙度） |
| 2026-11-25 第 2 版 | idle walk_f walk_b block light1 light2 heavy（+ idle_pose） | 时间表已填这 7 段。还没有：jump light3 lunge launcher sweep air grab sp1 sp2 sp3 ult_start ult_combo win intro |
| 2026-11-25 第 3 版（10:20，成品） | 全部 21 段：idle walk_f walk_b jump block light1 light2 light3 heavy lunge launcher sweep air grab sp1 sp2 sp3 ult_start ult_combo win intro（+ idle_pose） | 时间表 `yanjin.json` 21 段全部填好。动作原地、脚不入地（fix_ground.py 抬胯）。骨架没变。 |
| 2026-11-25 10:26 | 通用动作重建 | 按调度要求在 FG 下跑了 `tools/generic/build_generic.py art/generic/yanjin/config.json --no-merge`，`yanjin_generic.glb/.json` 已按新成品（含视频 idle）重出；`check_match.py` 骨骼名/层级/静止姿势全一致（ok: true）。 |

重做成品：`zsh art/fighter/yanjin/build.sh`（hero_motion → fix_ground → hero_build game → gltf-transform）。改了成品以后记得重跑上面那条 build_generic。
