import { defineConfig } from "vite";
// 跑自动对局、截图用的第二个开发服务器（端口 5190）：不做热更新。
// 平时那个（5183）在源码或者 public 里的文件一变就让页面整页刷新，正在快进的对局会被重置；这个不会，新打开的页面照样拿到最新的代码。
// 用法：npx vite --config vite.test.config.ts；测试脚本前面加 MOBA_URL=http://localhost:5190/map.html
// 在 worktree 里并行干活时每个任务各开一个：MOBA_PORT=5201 npx vite --config vite.test.config.ts（端口不同，缓存目录也跟着分开，互不干扰）
const port = Number(process.env.MOBA_PORT || 5190);
export default defineConfig({
  publicDir: "public", cacheDir: port === 5190 ? "node_modules/.vite-test" : `node_modules/.vite-test-${port}`,
  server: { host: true, port, strictPort: true, hmr: false },
});
