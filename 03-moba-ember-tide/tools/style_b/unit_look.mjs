#!/usr/bin/env node
// 换画风 B（w-unit）：在测试场里摆一排小兵 / 野怪拍照，看两队的换色、个头、和英雄比亮不亮。
// 用法: MOBA_URL=… node tools/style_b/unit_look.mjs <输出.jpg> "<网址参数>" '<摆法 JSON>' [宽=1920] [高=1080]
//   网址参数照常写（一般是 arena=1&h=<英雄>&hero=u,v,朝向&cam=u,v,距离,俯角&nohud=1&t=3）。
//   摆法：[{"kind":"melee","team":0,"u":-13,"v":1,"yaw":200}, {"mob":"mandrill","u":…}, …]，u、v 是路向坐标（和 hero=、cam= 一样），yaw 是度（0 朝 +Z）。
//         kind 是 melee / ranged；写 mob 就放一窝野怪（n 只，现搭一个营地，yaw 是营地朝向；"boss":true 按 Boss 的营地）；"big":true 是超级兵。
//   另外 "clear":true 的一项把测试场自己的靶子小兵挪远（它们三秒后回位，所以拍之前再挪一次）。
// 拍完打印每个单位在画面里的位置（[x,y]，方便裁图），最后一项是玩家英雄。MOBA_NONE=1 时另拍一张 <输出>_none.jpg（单位和英雄都藏起来），给 unit_pop.py 量亮度。
import puppeteer from "puppeteer-core";
const [out, q, layoutS = "[]", w = "1920", h = "1080"] = process.argv.slice(2);
const layout = JSON.parse(layoutS);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5235/map.html") + "?" + q, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__ready === true && !!window.__sim", { timeout: 90000 }); await new Promise(r => setTimeout(r, 2500));
  const place = () => page.evaluate(L => {
    const S = Math.SQRT2, W = (u, v) => [(u + v) / S, (v - u) / S], sim = window.__sim; window.__mine ??= [];
    if (L.some(o => o.clear) && window.__arena) for (const e of sim.ents) if ((e.kind === "melee" || e.kind === "ranged") && !window.__mine.includes(e)) { e.x += 400; e.z += 400; }
    if (window.__mine.length) return;
    for (const o of L) { if (o.clear) continue; const [x, z] = W(o.u, o.v), yaw = (o.yaw ?? 0) * Math.PI / 180;
      if (o.mob) {      // 野怪要有营地（规则里按营地管它），照测试场的 wild() 现搭一个；朝向是营地的 fx、fz
        const c = { id: sim.camps.length, x, z, r: 6, fx: Math.sin(yaw), fz: Math.cos(yaw), kind: o.boss ? "boss" : "small", mob: o.mob, n: o.n ?? 1, side: 2, top: false, buff: "", mobs: [], up: false, nextAt: 1e9 };
        sim.camps.push(c); sim.spawnCamp(c); for (const e of c.mobs) { e.seen = true; window.__mine.push(e); } continue; }
      const e = sim.add(o.kind, o.team, x, z, { lane: 0, s: 0, max: 9999, ad: 0, range: 1, period: 99, sight: 1, r: 0.5, state: "idle", think: 1e9, yaw, seen: true, big: !!o.big });
      e.root = 1e9; e.hp = e.max; window.__mine.push(e); } }, layout);
  await place(); await new Promise(r => setTimeout(r, 2500)); await place(); await new Promise(r => setTimeout(r, 600));
  if (process.env.MOBA_NONE) await page.evaluate(() => {      // 量亮度用：血条、脚下的影子团、英雄的圈和血条都藏起来，免得混进单位的像素（照 pop.mjs）
    const u = __scene.getObjectByName("units"); for (const c of u.children) if (c.isInstancedMesh || c.material?.isShaderMaterial) c.visible = false;
    __scene.traverse(o => { if (o.name === "hero" && o.isGroup) o.children.forEach((c, i) => { if (i > 0) c.scale.setScalar(1e-4); }); }); window.__setSpeed?.(0); });
  if (process.env.MOBA_NONE) await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: out, type: "jpeg", quality: 95 });
  if (process.env.MOBA_NONE) {      // 再拍一张把单位和英雄都藏起来的：tools/style_b/unit_pop.py 拿两张的差当单位的像素
    await page.evaluate(() => { __scene.getObjectByName("units").visible = false; __scene.traverse(o => { if (o.name === "hero" && o.isGroup) o.children[0].scale.multiplyScalar(1e-4); }); });      /* 英雄的可见每帧会被设回去（战争迷雾），所以把模型缩成一个点 */
    await new Promise(r => setTimeout(r, 300)); await page.screenshot({ path: out.replace(/\.jpg$/, "_none.jpg"), type: "jpeg", quality: 95 }); }
  const pos = await page.evaluate(() => [...window.__mine.map(e => [e.kind === "monster" ? e.mob : e.kind, e.team, window.__screen ? window.__screen(e.x, e.z, 0.8) : null]), ["hero", 0, window.__screen(__sim.hero.x, __sim.hero.z, 1.6)]]);
  console.log(JSON.stringify({ out, pos, errors: errors.slice(0, 6) }));
} finally { await browser.close(); }
