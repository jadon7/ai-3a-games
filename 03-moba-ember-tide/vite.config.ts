import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

// 开发：和以前一样，public/ 整个都能访问（样板间、建筑查看器这些调试页还要用里面的旧资源）。
// 打包（npm run build，阶段 8）：只出游戏这一页。
//   · 入口是 map.html；打完再抄一份成 index.html，所以线上 / 和 /map.html 都是游戏
//   · 代码放在 dist/app/（文件名带哈希，可以永久缓存）；dist/assets/ 留给模型和贴图，和 public/assets/ 的地址一样
//   · public/ 里只抄游戏真的会下载的东西（KEEP），调试页用的不上线
//   · 生成 sw.js（离线缓存，模板在 src/pwa/sw.js）和 _headers（给 Cloudflare Pages 的缓存规则）
// MOBA_PUBLIC：在 worktree 里开发时指回主目录的 public，这样用的是同一份（最新的）模型和贴图，不用每个 worktree 各放一份
const PUBLIC = process.env.MOBA_PUBLIC || "public";

/** public/ 里哪些文件要上线（路径相对 public/，用 / 分隔） */
const KEEP = (f: string) =>
  /^assets\/(hero|unit)\/(m\/)?[\w-]+\.(glb|json)$/.test(f) ||
  /^assets\/kit\/[\w-]+\.glb$/.test(f) || f === "assets/kit/index.json" ||
  /^assets\/map\/(ground_all|ground_mask)\.webp$/.test(f) || /^assets\/map\/ground\/[\w-]+\.(webp|json)$/.test(f) ||
  /^assets\/slice\/tex\/[\w-]+\.webp$/.test(f) ||
  /^assets\/ui\//.test(f) || /^assets\/sfx\//.test(f) || /^assets\/fx\//.test(f) ||      // fx：伊缇的特效贴图（iti-fx3）
  /^icons\//.test(f) || f === "manifest.webmanifest";

function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel)); else out.push(rel);
  }
  return out;
}

function ship(): Plugin {
  let outDir = "dist";
  return {
    name: "moba-ship", apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      // 1. 抄资源
      const files = walk(PUBLIC).filter(KEEP); let bytes = 0;
      for (const f of files) { const to = path.join(outDir, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(PUBLIC, f), to); bytes += fs.statSync(to).size; }
      // 1b. 每个模型再出一份 gzip 压过的（.glbz）。网格已经用 meshopt 压过，再套一层通用压缩还能小四成；
      //     CDN 默认不压 .glb，所以自己压好，页面里用 DecompressionStream 解（src/map/quality.ts 的 loadGLB）。原来的 .glb 留着兜底
      const gz = new Set<string>();
      for (const f of files) { if (!f.endsWith(".glb")) continue; const raw = fs.readFileSync(path.join(outDir, f)), z = zlib.gzipSync(raw, { level: 9 }); if (z.length < raw.length * 0.92) { fs.writeFileSync(path.join(outDir, f + "z"), z); gz.add(f); } }
      // 2. / 也是游戏
      fs.copyFileSync(path.join(outDir, "map.html"), path.join(outDir, "index.html"));
      // 2b. 找不到的地址给一张真的 404（没有这张的话，静态托管会把首页当 404 发回去，缺了的模型贴图就成了“下载成功的一张网页”）
      fs.writeFileSync(path.join(outDir, "404.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>烬与潮 · 没有这一页</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d1014;color:#e6ece9;font:600 16px/1.8 'Avenir Next','PingFang SC',system-ui,sans-serif;text-align:center"><div><div style="font:800 44px/1.2 'Songti SC',serif;letter-spacing:.14em"><span style="color:#ff9a5a">烬</span>与<span style="color:#7fe9e4">潮</span></div><p style="color:#8e9b98">没有这一页。</p><a href="/" style="color:#e8c66a;text-decoration:none;letter-spacing:.2em">回主菜单</a></div></body></html>`);
      // 3. 离线缓存：外壳（页面和代码）装的时候就存；模型贴图用到了才存，另外给两档各一张清单，进过一次对局以后在后台把剩下的补齐
      const app = walk(path.join(outDir, "app")).map(f => `/app/${f}`);
      const tier = (lite: boolean) => files.filter(f => /^assets\//.test(f) && (/^assets\/(hero|unit)\//.test(f) && f.endsWith(".glb") ? /\/m\//.test(f) === lite : true)).map(f => `/${f}${gz.has(f) ? "z" : ""}`);
      const h = crypto.createHash("sha1"); for (const f of [...files, ...app.map(f => f.slice(1)), "map.html"]) { const st = fs.statSync(path.join(outDir, f)); h.update(`${f}:${st.size}:`); if (st.size < 4e6) h.update(fs.readFileSync(path.join(outDir, f))); }
      h.update(fs.readFileSync("src/pwa/sw.js"));      // 离线缓存的逻辑改了也要换版本
      const version = h.digest("hex").slice(0, 10);
      const sw = fs.readFileSync("src/pwa/sw.js", "utf8").replace('"__VERSION__"', JSON.stringify(version))
        .replace('"__SHELL__"', JSON.stringify(["/", "/manifest.webmanifest", ...files.filter(f => /^icons\//.test(f)).map(f => `/${f}`), ...app]))
        .replace('"__FULL__"', JSON.stringify(tier(false))).replace('"__LITE__"', JSON.stringify(tier(true)));
      fs.writeFileSync(path.join(outDir, "sw.js"), sw);
      // 4. Cloudflare Pages 的缓存规则：带哈希的代码永久缓存；模型贴图缓存一天、过期后先用旧的再在后台更新；页面和 sw.js 每次都问
      fs.writeFileSync(path.join(outDir, "_headers"), [
        "/app/*", "  Cache-Control: public, max-age=31536000, immutable", "",
        "/assets/*", "  Cache-Control: public, max-age=86400, stale-while-revalidate=604800", "",
        "/icons/*", "  Cache-Control: public, max-age=86400", "",
        "/sw.js", "  Cache-Control: no-cache", "", "/", "  Cache-Control: no-cache", "", "/map.html", "  Cache-Control: no-cache", "", "/index.html", "  Cache-Control: no-cache", "",
        "/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin", ""].join("\n"));
      const mb = (n: number) => (n / 1e6).toFixed(1) + " MB", sum = (l: string[]) => l.reduce((a, f) => a + fs.statSync(path.join(outDir, f)).size, 0);
      console.log(`\n上线的资源 ${files.length} 个，${mb(bytes)}；电脑档 ${mb(sum(tier(false)))}，手机档 ${mb(sum(tier(true)))}；代码 ${mb(sum(app))}；版本 ${version}`);
    },
  };
}

export default defineConfig({
  publicDir: PUBLIC,
  server: { host: true, port: 5183, strictPort: true },
  preview: { host: true, port: 5184, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 2000, assetsDir: "app", copyPublicDir: false, rollupOptions: { input: "map.html" } },
  plugins: [ship()],
});
