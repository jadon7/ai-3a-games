# 界面状态

- 2026-11-25 第一版可用：对战界面 + 全流程。
- 2026-11-25 当前版：全部界面、流程、图都已接上并截图验证（1920×1080、1280×720、800×600）。

## 入口
- 正式入口 `http://localhost:5300/` 已走菜单（main.ts 的 glob 已经能看到 app.ts）。`?direct` 直接开打时没有对战界面（界面是 app.ts 挂上去的）。
- 调试入口（内容和 main.ts 一样）：`http://localhost:5300/lab/ui.html`，调试加 `?standin`。

## 文件
- `src/app.ts`：流程（主菜单 → 选人 → 对阵 → 对战 → 结算；Esc / 回车暂停；观战演示自动循环、换边）。
- `src/ui/hud.ts`：对战界面（Presenter）。`window.__hud.freeze(ms)` / `thaw()` 截图用。
- `src/ui/screens.ts`：主菜单、选人（单人 / 双人同时选 / 训练）、难度、对阵过场、结算、暂停、出招表。
- `src/ui/nav.ts` 菜单按键；`src/ui/data.ts` 出招表 / 按键说明（从 `core/input` 和角色定义读）；`src/ui/dom.ts` 小工具。
- `src/style.css`：全部样式。字体在 `public/assets/ui/fonts/`（马善政毛笔楷书、思源宋体、Oswald 子集，OFL），改了界面文字重跑 `bash lab/ui.fonts.sh`。
- 图：`public/assets/ui/*.webp`（半身特写、头像、大招横幅、两道墨笔遮罩）；原图和出图任务在 `concepts/ui/`。

## 截图
`node lab/ui.shot.mjs docs/ui 1920 1080 all standin`、`node lab/ui.flow.mjs docs/ui 1920 1080`。
