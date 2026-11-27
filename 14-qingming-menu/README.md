# 青冥劫 · 行者菜单

水墨暗金风格的 Three.js 角色菜单原型：行者、行囊、舆图、卷宗四个页签，包含 8×6 背包、物件 3D 检视、配伍合成、快捷四向位、三层寺院平面图和脉象波形。原项目 `README.md` 列了可试交互与文件结构。

| 项 | 内容 |
|---|---|
| 技术栈 | three.js r160（CDN）、原生 JavaScript / CSS / SVG |
| 平台 | 桌面浏览器 |
| 怎么跑 | 在 `game/` 运行 `python -m http.server 8765`，访问 `http://localhost:8765/`；Windows 也可运行 `game/start.bat` |

## 目录

- `game/index.html`、`game/css/style.css`：页面骨架与夜色主题
- `game/js/`：状态、页签、行囊、舆图、卷宗、程序化模型与 Three.js 舞台
- `game/assets/icons/`：菜单 SVG 图标
- `game/assets/credits.json`：图标、字体、3D 模型与引擎的来源和许可
- `game/README.md`：原作者写的运行说明、可试交互与结构

## 关于这份拷贝（总仓库说明）

本次只上传源码、文档、小配置和 SVG 图标，**不含 Poly Haven / Poly Pizza 的 3D 模型 JSON 与 JPG 贴图**，也不含 zip 包。原 zip 解压约 21 MB，其中模型与贴图约 20 MB；体积大的素材和仓库 `.gitignore` 对图片、模型的处理一致，需要自行取得后放进 `game/assets/models/`。

### 怎么运行

1. 在 `game/` 启动静态服务器：`python -m http.server 8765`，再打开 `http://localhost:8765/`；ES 模块不从 `file://` 直接加载。
2. 需要联网加载 jsDelivr 上的 three.js 与 Google Fonts。离线时字体回落系统字体，但 3D 检视仍需 three.js。
3. 按 `assets/credits.json` 从 Poly Haven / Poly Pizza 下载模型并放进 `assets/models/<id>/`，文件布局见原 `README.md` 的「结构」一节。
4. `Q` / `E` 切换页签；地址栏可用 `#hero`、`#bag`、`#map`、`#files` 直达。

### 素材许可

- 3D 模型：Poly Haven 与 Quaternius（经 Poly Pizza），`assets/credits.json` 标注 CC0 1.0
- 图标：game-icons.net，CC BY 3.0，作者 Lorc、Delapouite、Lucasms
- 字体：Noto Serif SC、Ma Shan Zheng、Liu Jian Mao Cao，SIL OFL 1.1
- 引擎：three.js r160，MIT

界面风格只参考 interfaceingame.com 收录的截图，未使用其中图像。第三方模型、贴图与字体文件不随本次 PR 上传；署名信息保留在 `game/assets/credits.json` 和 `game/README.md`。
