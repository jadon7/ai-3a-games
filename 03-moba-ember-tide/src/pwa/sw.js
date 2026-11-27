// 《烬与潮》的离线缓存（阶段 8）。这个文件是模板：打包时 vite.config.ts 把下面四个占位换成真的清单，写到 dist/sw.js。
//   外壳（页面、代码、图标）：安装的时候就存好。页面每次先走网络（有新版马上能拿到），断网了才用存的。
//   模型和贴图：用到了才存，存了以后先用存的。进过一次对局以后，页面会让它在后台把这一档剩下的资源补齐，
//   所以装到主屏幕、进过一次对局以后，断网也能开一局。
//   版本变了（重新打包上线过）：新的 service worker 装好就接管，旧版本的缓存整个删掉。
const VERSION = "__VERSION__", SHELL = "__SHELL__", FULL = "__FULL__", LITE = "__LITE__";
const CACHE = "moba-" + VERSION;

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("moba-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") {      // 页面：先网络，断网用存的（带着查询参数的也用同一份）
    // 存的时候统一存在 "/" 这一个名字下。线上（Cloudflare）访问 /map.html 会被重定向到 /map，重定向来的页面不能存、也不能拿来应答，所以外壳里也只预存 "/"
    e.respondWith(fetch(req).then(r => { if (r.ok && !r.redirected) caches.open(CACHE).then(c => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
    return;
  }
  if (!/^\/(app|assets|icons)\//.test(url.pathname) && url.pathname !== "/manifest.webmanifest") return;
  e.respondWith(caches.open(CACHE).then(c => c.match(url.pathname).then(hit => hit || fetch(req).then(r => { if (r.ok && r.status === 200) c.put(url.pathname, r.clone()); return r; }))));
});

// 页面发来 {type:"warm", lite}：把这一档还没存的资源一个个补齐（一次只下一个，不跟正在玩的对局抢网）
let warming = false;
self.addEventListener("message", e => {
  const d = e.data || {}; if (d.type !== "warm" || warming) return; warming = true;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE); let got = 0;
    for (const u of d.lite ? LITE : FULL) { if (await c.match(u)) continue; try { const r = await fetch(u); if (r.ok) { await c.put(u, r); got++; } } catch { break; } }
    warming = false; const cs = await self.clients.matchAll(); for (const cl of cs) cl.postMessage({ type: "warmed", got });
  })());
});
