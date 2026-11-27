# 三界座舱 Starship Cockpits

三套实时渲染的飞船仪表盘：赛博朋克、NASA 朋克、Y2K。构件、程序化 PBR 贴图、镜头后期都在浏览器里生成；`README.txt` 说明单文件版与源码版的区别和操作方式。

| 项 | 内容 |
|---|---|
| 技术栈 | three.js r170、WebGL2、原生 JavaScript、Python 构建脚本 |
| 平台 | 支持 WebGL2 的桌面浏览器 |
| 怎么跑 | 双击 `game/starship-cockpits.html`；或在 `game/` 运行 `python -m http.server 8731` 后打开 `game/index.html` 对应的本地地址 |

## 目录

- `game/index.html`、`game/js/`：多文件源码版。`core.js` 是渲染核心，`cyber.js` / `nasa.js` / `y2k.js` 是三套座舱
- `game/starship-cockpits.html`：`tools/build_standalone.py` 生成的单文件版
- `game/tools/build_standalone.py`：改完源码后重新打包单文件版
- `game/README.txt`：原作者写的运行、操作与文件说明

## 关于这份拷贝（总仓库说明）

本次按仓库习惯只收录源码、文档和小配置，**不含 `js/vendor/` 里的 three.js 及七个 addon，也不含原始 zip 包**。原目录约 1.8 MB，其中本地 vendor 约 1.4 MB、单文件版约 158 KB。因此 `starship-cockpits.html` 直接打开时仍需要本地 `js/vendor/`；源码版还需通过静态服务器打开。

### 怎么运行

1. 下载 three.js r170 与对应的 addon（`BufferGeometryUtils`、`EffectComposer`、`GTAOPass`、`UnrealBloomPass` 等），按 `index.html` 和 `js/` 里的引用放进 `game/js/vendor/`。
2. 在 `game/` 运行 `python -m http.server 8731`，浏览器访问 `http://localhost:8731/`；ES 模块不建议从 `file://` 直接打开。
3. 改完源码后运行 `python game/tools/build_standalone.py` 重新生成单文件版。
4. 字体仍从 Google Fonts 加载，加载不到时回落到系统字体；其余渲染可离线完成。

### 素材许可

座舱构件、贴图与效果均由代码生成。three.js 为 MIT 许可；字体与 addon 的条款以各自项目为准。第三方 vendor 文件不随本次 PR 上传。
