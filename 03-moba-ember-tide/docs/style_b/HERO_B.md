# 换画风 B · 第二批：一个角色从卡通设定图到游戏里（照岚的试点定的做法）

`b-lan` 试点写的（2026-11-20）。岚已经照这一份走完，结果和证据在 `docs/style_b/b-lan/README.md`。第二批其余角色照下面的清单做。
规矩、回归、汇报照 `docs/round9/COMMON.md` 和 `docs/style_b/COMMON.md`；画风照 `docs/style_b/STYLE.md` 路子一。

## 成本（岚的实数）

| 步 | 额度 | 机器时间 | 人要盯 / 手修 |
|---|---|---|---|
| Tripo 出模型（`face_limit` 40000、`detailed`） | 40 | 4 分钟 | 渲 6 个角度看一眼，2 分钟 |
| Tripo 绑骨（biped、mixamo） | 25 | 3 分钟 | 0 |
| 武器 | 脚本建 0；Tripo 出 20–40 | 脚本出图 10 秒 | 脚本第一次写 15–20 分钟（岚的新月刃），以后同类改参数 5 分钟；在游戏里看朝向再调 1–2 轮 |
| 装武器、出站姿（`hero_build.sh rig`） | 0 | 1 分钟 | 看 `check` 图 2 分钟 |
| 读骨架、套动作、量、出拼图和录像（`run_case.py`） | 0 | 2.5 分钟 | 看 `table.py` 和拼图 5 分钟；岚没有一段要手修 |
| 出品（`run_case.py build` + 去贴图 + 手机档） | 0 | 1.5 分钟 | 0 |
| 进游戏看、出证据（对照连拍、个头、对局、回归四项） | 0 | 约 25 分钟（多半是跑测试） | 挑毛病、调武器 20–30 分钟 |

合计：**Tripo 65（武器也走 Tripo 就 85–105）、即梦 0（设定图已经有了）**；一个人形角色从拿到设定图到进游戏约 **1 小时**，加上证据和回归约 **2 小时**。
上限预留一次重出模型（再 40+25），一个角色 Tripo 不超过 150。

## 清单（人形；`<id>` 是英雄名，过程文件放 worktree 的 `art/style_b/<id>/`）

1. **设定图**：`art/style_b/concept/<id>-p1-sheet.png`（`b-sheets` 出的），直接复制成 `art/style_b/<id>/ref.png`，不用裁。先自己看一遍 STYLE.md 第四节的设定图清单（A 字、空手、灰底、露出的手是肤色）。
2. **Tripo 出模型**：`art/style_b/<id>/tripo_jobs.json` 写一条 `{"name": "hero_<id>_b", "image": "art/style_b/<id>/ref.png", "face_limit": 40000, "texture_quality": "detailed"}`，
   `$PY tools/tripo_batch.py art/style_b/<id>/tripo_jobs.json`（它下载到 `art/models_src/hero_<id>_b_raw.glb`，挪到 `art/style_b/<id>/`）。
   `$BL -P tools/blender/views.py -- <raw.glb> <输出.png> 640 "0,90,180,270,35:20,0:56"` 渲 6 个角度看：四肢分开、没糊成一团、贴图颜色对、轮廓特征（头冠、肩甲）在。不行最多重出一次。
3. **绑骨**：`$PY tools/tripo.py rig <模型的 task_id> --rig-type biped --spec mixamo --out-format glb`，再 `tools/tripo.py wait <rig 的 task_id> --download art/style_b/<id>/tripo_rigged.glb`。task_id 在 `tripo.log` 或 `art/models_src/log.jsonl` 里。
4. **武器**（判断标准见下一节“武器”）：脚本建就照 `art/style_b/lan/gear.py` 写 `art/style_b/<id>/gear.py`，材质名 `weapon_b`；`art/style_b/lan/gear_preview.py` 出两张图看形状。
5. **`art/style_b/<id>/build.json`**（照 `art/style_b/lan/build.json`）：`raw` 新模型；`rigged` **写 `art/style_b/<id>/<id>_b_rigged.glb`（相对仓库根目录写，`hero_build.py` 按根目录解析；不要写某个 worktree 的绝对路径，worktree 删了就断——岚的 build.json 原来指着删掉的 `b-lan` worktree，`b-polish` 改成了相对路径；千万别指回 `V2R/assets/model/<id>_rigged.glb`，rig 一步会把旧的覆盖掉）**；
   `out`/`packed` 指 `art/style_b/<id>/check/`；`"body_material": "hero_b"`（游戏靠这个认 B 的材质，见下面“材质”）；`"palm_by_hand": true`；`gear` 照旧英雄的 build.json 换成新武器；`stance` 抄旧的；`motions` 留空。
   `TMPDIR=<能写的目录> zsh tools/hero_build.sh art/style_b/<id> rig`，`views.py` 看 `check/game.glb`：武器在手心、方向对、不穿身体。
6. **读骨架**：`$BL -P tools/retarget/dump_rig.py -- $V2R/assets/model/<id>_rigged.glb art/style_b/<id>/rigs/<id>.npz` 和 `… art/style_b/<id>/<id>_b_rigged.glb art/style_b/<id>/rigs/<id>_b.npz`。
7. **源的配置**（两份，防止踩坑）：
   - `art/style_b/<id>/src_build.json`：旧英雄的 `art/hero/<id>/build.json` 去掉旧武器那一项（`weapon` 或 `gear`），加 `"palm_by_hand": true`。出品时 `run_case.py` 照它写新的 build.json，**不去掉的话手里会多出一把旧刀**（新模型的武器在第 5 步已经装进 `<id>_b_rigged.glb` 了）。
   - `art/style_b/<id>/src_timing.json`：**开工时**把 `public/assets/hero/<id>.json` 拷一份。`case.json` 的 `src_timing` 指它，不要指 `public/` 里那份：出品会覆盖 `public/` 的时间表，再出一次 `runSpeed` 就会在新值上再乘一遍（岚踩过：10.8 → 10.97 → 11.14）。
8. **`art/style_b/<id>/retarget/case.json`**（照 `art/style_b/lan/retarget/case.json`）：`src_rig`/`tgt_rig` 指第 6 步的两个 npz，`src_build`、`src_timing` 指第 7 步的两份，`tgt_model` 是新的 rigged，双手武器加 `hands`。
   `$PY tools/retarget/run_case.py art/style_b/<id>/retarget/case.json`，`$PY tools/retarget/table.py …/measure.json` 看表、看 `sheets/`（怎么看、怎么修见 `tools/retarget/README.md`）。看完删掉 `retarget/render/`（几百 MB 的逐帧）。
9. **出品**：照 `art/style_b/lan/rebuild.sh` 写一份（装武器 → `run_case.py … build` → 拷到 `public/assets/hero/<id>.glb`、`.json` → `node tools/style_b/strip_maps.mjs` 去掉用不上的法线和粗糙度贴图 → `node tools/lite_glb.mjs` 出手机档 `m/<id>.glb`）。先用测试名（`<id>_b`）进游戏看，定了再覆盖正式的。
10. **进游戏看**（测试服务器开着）：
    - 旧模型拷一份当对照：`git show v9-painted:public/assets/hero/<id>.glb > public/assets/hero/<id>_v9.glb`（`.json` 同样），**提交前删掉**。
    - 技能对照：`node tools/style_b/compare.mjs <id> <旧目录> <id>_v9`、`node tools/style_b/compare.mjs <id> <新目录>`，`python3.14 tools/style_b/pairs.py <旧目录> <新目录> <证据目录>/skills <英雄名>`，一个动作一张“现在 / 卡通版”。
    - 显眼不显眼：`node tools/style_b/pop.mjs <前缀> "play=0&glb=<名字>&hero=<u,v>,10&look=height:<身高>&cam=<u,v>,27&nohud=1&nofog=1&t=3"`，`python3.14 tools/style_b/pop.py <前缀>_hero.jpg <前缀>_none.jpg`，草地、石板、对方红土各一处，新旧都量。
    - 个头和对局：`shot.mjs` 测试场（`arena=1&h=<id>&glb=<id>_v9&hero=-13,-2.5,10;-13,0.5,10&look=height:<身高>`：第一个是旧的，第二个是新的），`look_shots.mjs … "h=<id>&auto=1"`。
    - 对着设定图并排看（同样约 50 度的俯视、近镜头），量颜色（骨白、主色、点缀色的中位数），自己挑毛病改两轮。
11. **回归四项**，提交（不提交 `<id>_v9.*` 和 `art/` 下的二进制）。worktree 删之前，把 `art/style_b/<id>/` 拷回主目录（模型、骨架、套好的动作都是二进制，不进 git）。

四足（卡兹、奥森、托尔格的龟）和野怪：第 2、3 步照 `tools/CREATURE_PIPELINE.md` 绑骨和写映射，第 6–9 步照 `tools/retarget/README.md` 最后的“四足”一段（`delta` 模式、`ref_pose`、`ground_chains`），出品走 `creature_build.sh`，出品以后**材质要改名**（见下面“材质改名”）。做法和实数见 `docs/style_b/w-quad/README.md`（四足英雄，`art/style_b/quad/rebuild.sh`）、`art/style_b/beasts/rebuild.sh`（四足野怪）。

## 材质（定下来了，第二批不用再调）

游戏里的着色在 `src/map/hero/hero.ts` 的 `tune()`：**材质名以 `_b` 结尾就走 B 的处理**（`HB` 那张表），老模型（材质名 `hero`、`weapon`）一点不变，还没换的英雄、小兵、野怪不受影响。资源自己带着画风：把某个 GLB 换回 `v9-painted` 的旧文件，它自动回到厚涂的处理。

| | 厚涂版（老模型） | B（`_b`） | 为什么 |
|---|---|---|---|
| 法线（凹凸）、金属、粗糙度贴图 | 用（凹凸 0.5） | 全不用（出品时直接删掉，`strip_maps.mjs`） | Tripo 照卡通设定图出的颜色贴图里已经画好了明暗和高光；法线贴图把大块明暗打碎成写实的细起伏 |
| 提亮 `lift` | 1.4 | 1.4（`HB.lift` 1.0） | 量过：Tripo 的贴图比设定图暗约两成，1.4 刚好补回来（游戏里骨白 206,196,178，设定图 205,202,176） |
| 饱和度 `sat` | 1.3 | 0.91（`HB.sat` 0.7） | 1.3 会把海军蓝冲成电光蓝；0.91 时主色 (55,96,142)，设定图 (50,82,113)，略亮略蓝（故意留一点，亮地面上更跳） |
| 补光 `fill` | 0.5 | 0.3（`HB.fill` 0.6） | 贴图自带明暗，补光多了人发平 |
| 分阶光的交界 | 地面、墙那份硬交界（N·L 0.03–0.17） | 软交界（N·L −0.28–0.28） | STYLE.md 3.2“分阶光但阶数弱”；硬交界在人身上切出一块块怪影子 |
| 边缘光 | 整圈、宽、冷色，背光一侧最亮 | 顺光一侧一道窄的亮边（暖白带三成队伍色） | STYLE.md 3.1 第 5 条：亮地面上靠这一圈亮把人提出来 |
| 发光纹路、受击闪白、隐身、草丛半透明 | — | 和厚涂版一样 | 认的是贴图里的青色、和画风无关 |

`?hb=键:值` 在网址里临时改（比如 `hb=sat:0.6,rim:1.1`）。哪个角色的贴图特别暗或特别艳，先在网址里试，确实需要再给那个角色在 `heroes/<id>.ts` 的 `look` 里单独写 `lift`、`sat`（`HB` 是乘在 `look` 上的），不要改 `HB` 的默认值（会动到已经换好的角色）。

### 材质改名（四足、野怪）

人形走 `hero_build.py`，`build.json` 写 `"body_material": "hero_b"` 就行。四足英雄和野怪走 `creature_build.py`，它把身体材质一律叫 `hero` / `heroN`、没有这个选项，游戏认不出 B。出品以后跑一步改名，再去贴图：

```bash
node tools/style_b/b_rename.mjs public/assets/hero/<id>.glb            # 四足英雄：hero → hero_b（art/style_b/quad/rebuild.sh 里就是这样）
node tools/style_b/b_rename.mjs --as mob public/assets/unit/<怪>.glb   # 野怪：hero → mob_b、hero1 → mob_b_1（art/style_b/beasts/rebuild.sh）
node tools/style_b/strip_maps.mjs <同一个 glb>                          # 只认 _b 结尾的材质，所以要在改名之后
```

规则：`weapon` 开头的（游戏靠它认刀光、出手点）和已经 `_b` / `_b_N` 结尾的不动；别的加 `_b`；`--as <名字>` 只把 `hero` / `heroN` 改成 `<名字>_b` / `<名字>_b_N`。游戏只看 `_b` 结尾，`hero_b` 和 `mob_b` 效果一样，`--as mob` 只是让野怪重新出品时名字和现在的文件一样。原来是两份脚本（`w-quad` 的 `b_rename.mjs`、`w-beast` 的 `art/style_b/beasts/mob_b.mjs`），`b-polish` 合成了这一份，对狼、野猪、卡兹、赫达试过，和两份旧脚本的结果逐字节一样；已经换好的模型不用重新出品。

## 武器：脚本建还是 Tripo

- **形状简单的（刃、钩、锤头、盾这类“一条轮廓加一个厚度”或几块整形）用脚本建**：照 `art/style_b/lan/gear.py`（`_crescent` 一条弧加透镜截面，`_tube` 柄和护手，手绘明暗直接画进一张 256 的小图）。轮廓干净、面数小（岚的一把约 1600 个三角形，两把加起来不到身体的一成）、颜色完全照设定图、不花额度、没有图转 3D 的背面碎片。
- **形状复杂、有雕刻感的（赫达的火钳、塞伦的螺壳长铳、乌戈的钓竿灯）走 Tripo**：先文生图出一张 B 风格的武器图（不要拿人物设定图当参考，会把人画进去），`face_limit` 12000、`standard`，20–40 额度。
- **旧武器换材质不划算**：旧武器多半是写实的尖刺、镂空、裂纹，B 不要这些，换了颜色形状还是旧的。
- **脚本画的贴图直接写 sRGB 的色值**：`bpy.data.images.new` 建的是 8 位 sRGB 的图，`pixels` 原样存、原样导出，**不要先换成线性**（只有 `float_buffer` 的图才是线性的）。岚的 `gear.py` 第一版先换了线性，导出的图暗了一截、暗部更艳（缠柄的海军蓝 33,56,107 成了 4,11,39，几乎是黑的），`w-unit` 发现、`b-polish` 改了重新出品。
- **颜色比设定图暗一档、偏暖一点**：游戏给 B 的材质整体提亮 1.4（为了补 Tripo 贴图比设定图暗的两成），脚本画的武器贴图也吃这一下；照设定图的原色写，游戏里骨白整片冲成发青的白、明暗没了。岚的刀照身上骨甲在 Tripo 贴图里的亮度（p75 179,163,146）定的：骨白三档 0.9,0.86,0.75 / 0.8,0.74,0.62 / 0.6,0.53,0.42，游戏里和前臂骨甲是同一种白（近景中位数刀 211,219,197、骨甲 205,203,186）。天光是冷青的，朝上的面会偏青，所以贴图要比想要的暖一点。
- **装上以后一定在游戏的俯视镜头里看刀面**：岚的旧刀刀面竖着（和前臂在一个平面里），新月刃在俯视里常常只剩一条细弧；`gear` 里加 `"rot": [0, 55, 0]` 绕长轴转 55 度以后，站着和挥刀时都看得到整个新月。转的是武器自己，动作、出手时刻、刀光都不受影响（刀光按刀尖的实际位置算）。

## 已知的坑

- `tools/tripo_batch.py` 下载到 `art/models_src/`、往 `art/models_src/log.jsonl` 追加记录（这个文件进 git），挪走模型就行，不用管记录。
- `hero_build.sh` 的 `mktemp` 在沙盒里会报错，前面加 `TMPDIR=<能写的目录>`。
- `kit_test.mjs` 的拼图调的是 `python3`（本机 3.15 没有 Pillow），拼图失败不影响连拍；用 `tools/style_b/compare.mjs` + `pairs.py`（python3.14）代替。
- `run_case.py build` 找 `motions/ik/retarget_report.json` 算胯的缩放，但报告实际写在 `motions/retarget_report.json`，所以站姿的胯偏移按 1 算；岚的 k 是 1.022，看不出来；腿长差很多的角色（托尔格、乌戈）要注意（`tools/retarget/run_case.py` 的问题，没改）。
- `?hero=a;b` 摆两个人时，第二个人一律载入 `lan.glb`、只吃 `look` 参数（身高默认 3.1）：做对照时加 `look=height:<身高>`。
