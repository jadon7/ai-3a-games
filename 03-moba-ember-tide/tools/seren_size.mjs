#!/usr/bin/env node
// 个头对比（第九轮 k-seren）：开一局，开打之前把塞伦、同位置的薇萝（还可以加别的英雄）和几个小兵摆在一起，用对局的默认镜头截图。
// 用法: MOBA_URL=… node tools/seren_size.mjs <输出.jpg> [英雄=seren] [比的英雄,逗号分开=vero] [额外网址参数]
//   英雄站一排（间隔 3.2 米），前面一排三个近战小兵、后面两个远程小兵（敌我各半）。对局时间停住，镜头是游戏里跟着自己英雄的那个。
import puppeteer from "puppeteer-core";
const [out, me = "seren", others = "vero", extra = ""] = process.argv.slice(2);
const list = others.split(",").filter(Boolean);
const b = ["gorran", "lan", "osen", "vero", "moko"]; for (const id of list) if (!b.includes(id) && id !== me) b[3] = id;
const a = ["torg", "lan", "osen", me, "moko"].map((id, i) => (i !== 3 && (id === me) ? "lan" : id));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5183/map.html") + `?h=${me}&a=${a.join(",")}&b=${b.join(",")}&nohud=1&nofog=1${extra ? "&" + extra : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 120000 });
  await new Promise(r => setTimeout(r, 1500));
  const res = await page.evaluate(`(() => { __setSpeed(0); if (window.__bots) window.__bots.length = 0;
    const S = __sim, me = __play.actor, [x0, z0] = S.along(0, 0, 34), ids = ${JSON.stringify(list)}, row = [me];
    for (const id of ids) { const o = [...__actors.values()].find(v => v.kit.id === id && v !== me); if (o) row.push(o); }
    const ux = Math.SQRT1_2, uz = Math.SQRT1_2;      // 一排横着（画面上左右排开）
    row.forEach((v, i) => { const k = i - (row.length - 1) / 2; v.teleport(x0 + ux * k * 3.2, z0 - uz * k * 3.2); v.face(x0 + 50, z0 + 50, true); v.stop(); });
    for (const v of __actors.values()) if (!row.includes(v)) v.teleport(v.ent.team ? 90 : -90, v.ent.team ? 90 : -90);
    for (const e of S.ents) if (e.kind === "melee" || e.kind === "ranged") { e.alive = false; e.hp = 0; }
    const mk = (kind, team, f, r) => S.add(kind, team, x0 + ux * r + ux * f, z0 - uz * r + uz * f, { lane: 0, s: 0, max: 1000, ad: 0, range: 0.1, period: 99, sight: 0, r: kind === "melee" ? 0.55 : 0.5, state: "idle", think: 1e9, root: 1e9, yaw: Math.PI * 0.25, seen: true });
    [[-2.2, 2.8], [0.2, 2.8], [2.6, 2.8]].forEach(([r, f], i) => mk("melee", i % 2, f, r)); [[-1.2, 4.6], [1.6, 4.6]].forEach(([r, f], i) => mk("ranged", i % 2, f, r));
    __setSpeed(1); return row.map(v => v.kit.id + ":" + v.kit.height); })()`);
  await new Promise(r => setTimeout(r, 1800));
  await page.evaluate("__setSpeed(0)"); await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: out, type: "jpeg", quality: 90 });
  console.log(JSON.stringify({ out, row: res, errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
