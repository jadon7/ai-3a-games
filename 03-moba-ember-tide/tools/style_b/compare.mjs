#!/usr/bin/env node
// 换画风 B（b-lan 写的，第二批每个角色照着用）：在测试场里把一个英雄的站、跑、普攻、每个技能、回城、死亡各连拍一组，
// 镜头比游戏近（dist=15，镜头跟着人）。跑两遍——旧模型（public/assets/hero/<旧名>.glb，比如从 v9-painted 拷出来的 lan_v9）和新模型——
// 再用同目录的 pairs.py 拼成“现在 / 卡通版”上下对照，一个动作一张。
// 用法: MOBA_URL=http://localhost:<端口>/map.html node tools/style_b/compare.mjs <英雄 id> <输出目录> [glb 名字，可省] [额外网址参数]
// 产出: <输出目录>/<键>_<序号>.jpg，键是 idle run A <技能键…> B（回城）D（死亡）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [id, out, glb = "", extra = ""] = process.argv.slice(2);
if (!id || !out) { console.error("用法: node tools/style_b/compare.mjs <英雄 id> <输出目录> [glb] [额外参数]"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const N = 10, GAP = 150;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5226/map.html") + `?arena=1&h=${id}&nohud=1&nofog=1&dist=15` + (glb ? `&glb=${glb}` : "") + (extra ? "&" + extra : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await sleep(1500);
  const ev = s => page.evaluate(s);
  if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { console.log(JSON.stringify({ blank: true, note: "三维画面没出来（显卡被占），重跑", errors })); process.exit(2); }
  await ev("(() => { const a = __play.actor; window.__kx = a.pos.x; window.__kz = a.pos.z; })()");
  const keys = await ev("JSON.stringify(__play.actor.kit.skills.filter(s => s.cast !== 'passive').map(s => s.key))").then(JSON.parse);
  const reset = () => ev("(() => { const a = __play.actor; __arena.reset(); a.stop(); a.teleport(window.__kx, window.__kz); for (const k of ['Q','W','E','R']) a.setCd(k, 0); const h = __sim.hero; h.hp = h.max; h.h.mana = h.h.stat.mana; h.stun = 0; h.shield = 0; })()");
  const shots = async (key, n = N, gap = GAP) => { for (let i = 0; i < n; i++) { await page.screenshot({ path: `${out}/${key}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await sleep(gap); } };
  // 瞄哪（照 tools/kit_test.mjs）：给友军的瞄己方假人；指向单位的瞄对面假人；其余瞄对面小兵堆的中间；够不着就先站近
  const castAt = key => ev(`(() => { const A = __arena, f = A.foes, cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
    const a0 = __play.actor, def = a0.skill("${key}"), ally = def.target === "ally", unit = def.cast === "unit" ? (ally ? A.friend : A.dummy) : null, x = unit ? unit.x : cx, z = unit ? unit.z : cz;
    const reach = def.cast === "self" ? (def.radius ?? def.range ?? 0) * 0.6 : (def.range ?? def.radius ?? 0) * 0.7, ddx = a0.pos.x - x, ddz = a0.pos.z - z, dl = Math.hypot(ddx, ddz);
    if (reach > 0 && dl > reach) { const kk = Math.max(reach, 1.6) / dl; let px = x + ddx * kk, pz = z + ddz * kk; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a0.teleport(px, pz); }
    return __play.cast("${key}", x, z, unit); })()`);
  await reset(); await sleep(900); await shots("idle", 4, 500);                                     // 站
  await reset(); await sleep(600);                                                                   // 跑：往一个空的方向跑 16 米
  await ev("(() => { const a = __play.actor, x0 = a.pos.x, z0 = a.pos.z; for (let i = 0; i < 16; i++) { const y = i * Math.PI / 8, dx = Math.sin(y), dz = Math.cos(y); if (__nav.clear(x0, z0, x0 + dx * 16, z0 + dz * 16)) { a.moveTo(x0 + dx * 16, z0 + dz * 16); return; } } })()");
  await sleep(500); await shots("run", N, 90);
  await reset(); await sleep(600);                                                                   // 普攻：先站到小兵跟前，拍出手的那一下
  await ev("(() => { const a = __play.actor, f = __arena.foes[0], r = Math.max(1.6, (a.ent?.range ?? a.meta?.attackRange ?? 2) * 0.8); let px = f.x + r, pz = f.z; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a.teleport(px, pz); })()"); await sleep(400);
  await ev("__play.attack(__arena.foes[0])"); await shots("A");
  for (const k of keys) { await reset(); await sleep(700); await castAt(k); await shots(k, N, GAP); await sleep(1200); }
  await reset(); await sleep(700); await ev("__play.actor.recall()"); await shots("B", N, 300);      // 回城：读条 5 秒，拍前 3 秒
  await reset(); await sleep(700); await ev("(() => { const h = __sim.hero; __sim.damage(h, h.max * 5, __arena.dummy, { type: 'true' }); })()"); await shots("D", N, 200);      // 死亡
  console.log(JSON.stringify({ hero: id, glb: glb || id, keys, errors: errors.slice(0, 6), fps: await ev("Math.round(__stats.fps)") }));
} finally { await browser.close(); }
