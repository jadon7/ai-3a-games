// KHAMSIN 离线缓存（Service Worker）。tools/build.mjs 把它写成 dist/sw.js，并填好下面 BUILD（本次打包的指纹）和 FILES（素材清单）两个占位符。
//   · 页面（index.html）：先走网络，3.5 秒内没回来就用缓存 —— 重新部署后联网打开就是新版，断网时用上一次的
//   · 素材（贴图 / 模型 / 天空）：按「路径 + 内容指纹」存，取到一次就不再下载；内容没变的素材，重新部署后也不用重下
//   · 页面进了菜单后会发一条 precache 消息，这里在后台把还没存下来的素材补齐，补完回一条 offline-ready
const BUILD = '__BUILD__';
const FILES = __FILES__;   // { 'assets/tex/sand_diff.avif': '3fa2c1d0e9', ... }：首次打开会用到的素材 → 内容指纹
const SHELL = 'khamsin-shell-' + BUILD, ASSETS = 'khamsin-assets';
const BASE = self.registration.scope;   // 站点根，以 / 结尾
const SHELL_FILES = ['manifest.webmanifest', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-maskable-512.png', 'assets/icons/apple-touch-icon.png'];
const keyOf = (rel) => BASE + rel + '?v=' + FILES[rel];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.add(new Request(BASE, { cache: 'reload' }));                 // 页面必须存下来，否则断网打不开
    await Promise.allSettled(SHELL_FILES.map((u) => c.add(BASE + u)));   // 清单和图标缺一两个不影响运行
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('khamsin-shell-') && k !== SHELL) await caches.delete(k);
    const c = await caches.open(ASSETS), want = new Set(Object.keys(FILES).map(keyOf));
    for (const r of await c.keys()) if (!want.has(r.url)) await c.delete(r);   // 旧版本里已经换掉的素材
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
async function page() {
  const c = await caches.open(SHELL);
  try {
    const r = await Promise.race([fetch(new Request(BASE, { cache: 'no-cache' })), timeout(3500)]);
    if (r && r.ok) { c.put(BASE, r.clone()).catch(() => {}); return r; }
  } catch (err) { /* 断网或太慢：用缓存 */ }
  return (await c.match(BASE)) || fetch(BASE);
}
async function asset(rel, req) {
  const c = await caches.open(ASSETS), k = keyOf(rel);
  const hit = await c.match(k); if (hit) return hit;
  const r = await fetch(req);
  if (r.status === 200) c.put(k, r.clone()).catch(() => {});   // 存不下（空间不足）不影响这次载入
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const rel = req.url.slice(BASE.length).split('#')[0].split('?')[0];
  if (req.mode === 'navigate') { if (rel === '' || rel === 'index.html') e.respondWith(page()); return; }
  if (FILES[rel]) { e.respondWith(asset(rel, req)); return; }
  if (SHELL_FILES.includes(rel)) e.respondWith(caches.open(SHELL).then((c) => c.match(BASE + rel)).then((r) => r || fetch(req)));
});

// 后台补齐素材（4 路并发）。全部到位后通知页面「可以离线运行了」
async function precache() {
  const c = await caches.open(ASSETS), todo = [];
  for (const rel of Object.keys(FILES)) if (!(await c.match(keyOf(rel)))) todo.push(rel);
  let i = 0, fail = 0;
  const run = async () => { while (i < todo.length) { const rel = todo[i++]; try { const r = await fetch(BASE + rel); if (r.status === 200) await c.put(keyOf(rel), r); else fail++; } catch (err) { fail++; } } };
  await Promise.all([run(), run(), run(), run()]);
  if (!fail && (await caches.open(SHELL).then((s) => s.match(BASE)))) for (const cl of await self.clients.matchAll()) cl.postMessage({ type: 'offline-ready', files: Object.keys(FILES).length, fetched: todo.length });
}
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'precache') e.waitUntil(precache()); });
