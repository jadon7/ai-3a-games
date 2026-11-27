// 用法: node tools/offline_test.mjs [地址=http://localhost:5184/]
// 验证离线缓存：打包版进一局（等 service worker 接管）→ 断网 → 重新打开同一局，看还能不能进；再断着网开主菜单。
// 另外看一眼 manifest 和图标能不能拿到。要先 npm run build && npx vite preview。
import puppeteer from "puppeteer-core";
const base = process.argv[2] || "http://localhost:5184/";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = {};
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.goto(base + "?h=lan&solo=1", { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 });
  R["service worker 装上了"] = await page.evaluate("Promise.race([navigator.serviceWorker.ready.then(r => !!r.active), new Promise(r => setTimeout(() => r(false), 15000))])"); if (!R["service worker 装上了"]) throw new Error("service worker 没注册上");
  const man = await page.evaluate("fetch('/manifest.webmanifest').then(r => r.json())"); R["manifest"] = `${man.name} / ${man.display} / ${man.orientation} / 图标 ${man.icons.length} 个`;
  R["图标都拿得到"] = await page.evaluate(`Promise.all(${JSON.stringify(man.icons.map(i => i.src))}.map(u => fetch(u).then(r => r.ok && r.headers.get("content-type")))).then(a => a.join(", "))`);
  // 第一次进来的时候 service worker 还没接管，资源没经过它：重新载入一次，这回用到的都会存下来
  await page.reload({ waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 }); await sleep(3000);
  R["缓存里存了多少个文件"] = await page.evaluate("caches.keys().then(async ks => { let n = 0; for (const k of ks) n += (await (await caches.open(k)).keys()).length; return ks.join(',') + '：' + n; })");
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: "load" }).catch(e => { R["断网后重新载入出错"] = String(e).slice(0, 120); });
  R["断网后还能进对局"] = await page.waitForFunction("window.__ready === true", { timeout: 60000 }).then(() => true).catch(() => false);
  R["断网后对局在走"] = await page.evaluate("new Promise(r => { const t0 = __sim.time; setTimeout(() => r(__sim.time - t0 > 0.5), 1500); })").catch(() => false);
  await page.goto(base, { waitUntil: "load" }).catch(() => {}); R["断网后主菜单能开"] = await page.waitForFunction("window.__ready === true && !!document.querySelector('.lob-home')", { timeout: 60000 }).then(() => true).catch(() => false);
  await page.setOfflineMode(false);
  R["报错"] = errors.slice(0, 5);
} catch (e) { R["出错"] = String(e).slice(0, 300); } finally { await browser.close(); }
console.log(JSON.stringify(R, null, 1));
