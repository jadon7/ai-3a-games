# 烬与潮 · 网页 MOBA

《烬与潮》是一款原创的网页 MOBA：两个原创阵营「烬誓庭」（琥珀橙）和「沉月会」（青色）在一张标准三路的小地图上对战，我方在左下、对方在右上，河道斜穿过中间。画面以 Dota 2 的水准为目标，阵营、英雄、名字、地图都是自己设计的；英雄、小兵、野怪的动作来自同一个总仓库里的骨骼绑定管线 video2rig，游戏可以在手机上横屏玩，也能装成 PWA 离线玩。

这是「AI 做 3A 大作」系列的第三个案例（前两个是 UMBRA GT 赛车和 KHAMSIN 射击）。项目没有写 README，完整的计划、每一轮的意见和进度都记在 `PLAN.md` 里；技术栈是 three.js + TypeScript + Vite，部署在 Cloudflare 的静态托管上。线上地址：<https://moba.dsxzai.com/>。

## 关于这份拷贝（总仓库说明）

这个文件夹是项目收进总仓库的**精简拷贝**：只放了源码、文档和小配置（代码、脚本、网页、样式、json、md 等，单个文件不超过 1 MB）。游戏运行要用的模型和贴图一个都没放进来（`public/assets/` 下只剩各类资源的 json 清单），所以**直接 clone 下来不能完整运行**，开发服务器能起来，但英雄、建筑、地面这些都载不到。想看完整效果，直接打开上面的线上地址。

### 怎么运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5183/`，会自动跳到游戏页 `map.html`。其他几个网页是开发时用的调试页：`greybox.html`（地图灰盒）、`slice.html`（样板间）、`kit.html`（建筑预览）、`viewer.html` 等。

- 类型检查：`npm run typecheck`
- 打包：`npm run build`（出 `dist/`），`npm run preview` 在 5184 端口看打包后的样子。打包、手机适配、发布的细节见 `tools/SHIP.md`。
- 这份拷贝没带 `package-lock.json`，`npm install` 会按 `package.json` 里的版本范围重新装依赖。
- `tools/` 里的脚本是给作者本机写的，不少写死了作者电脑上的绝对路径和 Blender 的安装位置，别人要用得先改路径。

### 哪些东西不在这里

| 类别 | 原来在哪 | 大约多大 | 怎么重新生成 / 从哪拿 |
|---|---|---|---|
| 游戏运行要用的全部资源：英雄和野怪模型（`.glb`，含手机用的小贴图版 `m/`）、建筑模型、地面贴图、界面的立绘和图标、特效贴图等 | `public/assets/` | 约 69 MB | 见下一节「游戏资源是怎么做出来的」。只有 json 清单在这里 |
| 设计稿、即梦出的原图、Tripo 出的原始模型、动作和重绘的中间文件 | `art/` | 约 4.3 GB | 原始文件在作者本机，未公开。各英雄、小兵的配置（`build.json`、`brief.json`、`motions.json` 等）和脚本在这里 |
| 阶段 1 的概念图（英雄、小兵、塔、环境） | `concepts/` | 约 230 MB | 是用即梦出的图，原图在作者本机，未公开 |
| Codex 建模的产出（模型、渲染图） | `lab/` | 约 380 MB | 任务说明（`lab/**/TASK.md`）和建模脚本在这里，产出的模型在作者本机，未公开 |
| 各轮验收页里的截图、录像和宣传片 | `docs/` | 约 5.7 GB | 验收页的网页和说明文字在这里，图片和录像在作者本机，未公开。宣传片（约 118 MB，另有 13 MB 的网页版）的分镜和做法见 `docs/trailer/README.md`，录制和剪辑脚本在 `tools/trailer/` |
| Dota 2 的对标截图 | `refs/dota2/` | 约 65 MB | 只作内部画面对标参考，不能再分发；来源清单在 `refs/dota2/sources.md` |
| 风格板的图 | `styleboard/` | 约 13 MB | 原图在作者本机，未公开；页面用 `python3 tools/build_styleboard.py` 生成 |
| 依赖、打包产物 | `node_modules/`、`dist/` | 约 690 MB、84 MB | `npm install`、`npm run build` 生成 |
| 开发工具留下的会话数据和临时工作区 | `.claude/` | 约 470 MB | 不属于项目内容，不需要 |

按扩展名算，没收进来的主要是 JPG（约 1.9 万张，4.4 GB）、PNG（约 1100 张，2.8 GB）、MP4（约 750 段，2.0 GB）、GLB 模型（约 520 个，1.5 GB）、训练和动作的中间数据 `.npz`（约 650 个，220 MB）和 WebP 贴图（约 1300 张，90 MB）。大部分是中间文件和验收材料，游戏真正用到的只有 `public/` 那 69 MB。

### 游戏资源是怎么做出来的

下面只写项目文档和脚本里写明了的做法。这些步骤都要用到付费的外部服务，原始素材也不在仓库里，所以只能当作参考，没法照着一键重建。

- **英雄、小兵、野怪**（`public/assets/hero/`、`public/assets/unit/`）：即梦出建模图 → Tripo 图转 3D 并自动绑骨（`tools/tripo.py`）→ 即梦出动作视频 → 用 video2rig（总仓库里的 `09-video2rig/`）把视频读成动作 → `tools/hero_build.sh` 和 `tools/blender/hero_build.py` 装武器、整理并压缩到 `public/assets/hero/<id>.glb`。完整步骤见 `tools/HERO_PIPELINE.md`，四足和其他怪物见 `tools/CREATURE_PIPELINE.md`、`tools/MONSTER_PIPELINE.md`。小兵的武器由 `tools/blender/unit_gear.py` 建。手机用的小贴图版：`zsh tools/pack_assets.sh lite`。
- **关键建筑**（防御塔、水晶、出生点，`public/assets/kit/`）：交给 Codex 在 Blender 里建模，每件一个文件夹（`lab/kit/`、`lab/kit_b/`，任务说明由 `tools/kit_tasks.py` 生成），再用 `python3 tools/kit_collect.py` 收进来、压缩并写清单。
- **地面贴图**（`public/assets/map/`）：引擎先导出俯视布局图，再用即梦逐块图生图重画（`tools/jimeng_i2i.py`），`tools/map_ground.py`（卡通画风用 `tools/map_ground_b.py`）校色、拼接、切块。做法写在 `PLAN.md` 的「工程结构」一节。
- **界面的立绘、头像、技能和装备图标**（`public/assets/ui/`）：即梦出原图，用 `tools/ui_cut.py`、`tools/item_icons.py`、`tools/style_b/art_cut.py` 切成游戏里用的尺寸。
- **伊缇的技能特效贴图**（`public/assets/fx/iti/`）：即梦出的图，说明见 `docs/hero_iti/fx3/说明.md`。
- **音效**：用 WebAudio 现场合成（`src/map/game/sfx.ts`），没有音频文件，不缺东西。

### 外部服务

- **即梦**：用它的命令行 `dreamina-canvas`，登录用它自己的账号授权；批量出图的脚本是 `tools/jimeng_gen.py`、`tools/jimeng_i2i.py`。
- **Tripo**：`tools/tripo.py` 从环境变量 `TRIPO_API_KEY` 读密钥，没有的话读 `~/.config/video2rig/env` 里的 `TRIPO_API_KEY=` 那一行。密钥不要放进项目目录。
- **Codex**：用的是本机登录好的 Codex 命令行。环境里如果设了 `CODEX_API_KEY`，Codex 会优先用它，文档里的命令都先 `env -u CODEX_API_KEY` 去掉它。
- **训练关节识别网络**：作者把这一步放在局域网里另一台带 N 卡的 Windows 机器上跑（`tools/remote.sh`、`tools/REMOTE.md`），那台机器别人用不上。在本机跑也行，就是慢。
- **Cloudflare**：`npm run build && npx wrangler deploy`，要先 `npx wrangler login` 登录自己的账号；`wrangler.jsonc` 里的域名是作者的，换成自己的再发。仓库里没有任何密钥。

### 素材许可

- `refs/dota2/` 的 Dota 2 截图只作内部参考，**不能再分发**（这里也没放）。
- 骨骼用的是 Mixamo 的命名规则，没有用 Mixamo 的动作或模型素材。
- 宣传片没有用网上的素材，字体只用了系统自带的宋体和苹方（见 `docs/trailer/README.md`）。
- 文档里没有写模型、贴图这些生成素材和代码的授权条款，项目里也没有许可证文件；要用的话先问作者。
