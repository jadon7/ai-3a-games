#!/usr/bin/env node
// 录一个英雄的技能展示：在测试场里依次放普攻和每个技能，画面上方打出技能名和说明。验收页和视频素材用。
// 用法: node tools/showcase.mjs <英雄 id> <输出.webm> [宽=1280] [高=720]
// 环境变量: MOBA_URL（默认 http://localhost:5183/map.html）
// 每个技能放之前靶子复位、英雄回到起点、冷却清零。录完打印真实秒数，用 tools/rec_fix.sh 按这个秒数转成视频。
// 每个技能录多久：WAIT 里按技能键给了默认值，个别技能持续得久的在 LONG 里单独写。
import puppeteer from "puppeteer-core";
const [id, out, w = "1280", h = "720"] = process.argv.slice(2);
if (!id || !out) { console.error("用法: node tools/showcase.mjs <英雄 id> <输出.webm> [宽] [高]"); process.exit(1); }
const WAIT = { A: 2600, Q: 3000, W: 3400, E: 3600, R: 5200 };
const LONG = { "gorran:W": 4600, "gorran:E": 5400, "gorran:R": 6600, "vero:E": 6000, "vero:R": 5200, "osen:W": 4200, "osen:E": 5200, "osen:R": 6200, "moko:W": 5600, "moko:R": 7600, "torg:R": 5800, "lan:W": 5200, "lan:R": 4800 };
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5183/map.html") + `?arena=1&h=${id}` + (/(^|&)dist=/.test(process.env.MOBA_Q ?? "") ? "" : "&dist=22") + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""),      /* 展示时镜头比平时近一点（平时 27），动作和特效看得清 */ { waitUntil: "load" });      /* MOBA_Q：额外的地址参数，比如 glb=turtle&look=height:2.6,ring:1.7 */
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  // 录像时不要左上角那排调试按钮；加一条字幕
  await ev(`(() => { for (const el of document.querySelectorAll("body > div")) if (el.querySelector("select") && !el.classList.contains("hud")) el.style.display = "none";
    const c = document.createElement("div"); c.id = "cap"; c.style.cssText = "position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:9;max-width:min(760px,86vw);padding:9px 18px;border-radius:6px;background:rgba(10,15,17,.78);border:1px solid rgba(200,184,136,.45);color:#e9f3f1;font:500 14.5px/1.55 'Avenir Next','PingFang SC',system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .25s linear";
    document.body.appendChild(c); window.__cap = (t, s) => { c.innerHTML = t ? "<b style='color:#fff;font-size:16.5px;margin-right:8px'>" + t + "</b>" + (s ?? "") : ""; c.style.opacity = t ? 1 : 0; }; })()`);
  const kit = JSON.parse(await ev("JSON.stringify({ name: __play.actor.kit.name, title: __play.actor.kit.title, role: __play.actor.kit.role, skills: __play.actor.kit.skills.map(s => ({ key: s.key, name: s.name, desc: s.desc, cast: s.cast, target: s.target ?? '' })) })"));
  const reset = "(() => { const a = __play.actor; __arena.reset(); a.stop(); a.teleport(window.__kx ?? (window.__kx = a.pos.x), window.__kz ?? (window.__kz = a.pos.z)); for (const k of ['Q','W','E','R']) a.setCd(k, 0); const h = __sim.hero; h.hp = h.max; h.h.mana = h.h.stat.mana; h.stun = 0; h.shield = 0; })()";
  await sleep(1200); await ev(reset); await sleep(600);
  const castJs = d => `(() => { const A = __arena, f = A.foes, cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
      const ally = ${JSON.stringify(d.target)} === "ally", unit = ${JSON.stringify(d.cast)} === "unit" ? (ally ? A.friend : A.dummy) : null; const x = unit ? unit.x : cx, z = unit ? unit.z : cz;
      const a0 = __play.actor, def = a0.skill(${JSON.stringify(d.key)}), reach = def.cast === "self" ? (def.radius ?? def.range ?? 0) * 0.6 : (def.range ?? def.radius ?? 0) * 0.7, ddx = a0.pos.x - x, ddz = a0.pos.z - z, dl = Math.hypot(ddx, ddz);
      if (reach > 0 && dl > reach) { const kk = Math.max(reach, 1.6) / dl; let px = x + ddx * kk, pz = z + ddz * kk; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a0.teleport(px, pz); }      /* 够不着就先站近（近战距离的技能） */
      return __play.cast(${JSON.stringify(d.key)}, x, z, unit); })()`;
  // 开录之前每个技能先空放一遍：第一次放要现编着色器，会卡一下，不能录进去
  if (!process.env.NOWARM) { for (const d of kit.skills.filter(s => s.cast !== "passive")) { await ev(reset); await sleep(250); await ev(castJs(d)); await sleep(Math.min(3200, LONG[id + ":" + d.key] ?? WAIT[d.key] ?? 3000)); } await ev(reset); await sleep(4300); await ev(reset); await sleep(500); }
  const rec = await page.screencast({ path: out }); const t0 = Date.now();
  await ev(`__cap(${JSON.stringify(kit.name + " · " + kit.title)}, ${JSON.stringify(kit.role)})`); await sleep(1800);
  const passive = kit.skills.find(s => s.cast === "passive");
  await ev(`__cap("普攻"${passive ? `, ${JSON.stringify("被动 " + passive.name + "：" + passive.desc)}` : ""})`); await ev("__play.attack(__arena.foes[0])"); await sleep(WAIT.A + (passive ? 900 : 0));
  for (const d of kit.skills.filter(s => s.cast !== "passive")) {
    await ev(reset); await ev(`__cap(${JSON.stringify(d.key + " " + d.name)}, ${JSON.stringify(d.desc)})`); await sleep(1100);
    await ev(castJs(d));
    await sleep(LONG[id + ":" + d.key] ?? WAIT[d.key] ?? 3000);
  }
  await ev("__cap('')"); await sleep(500);
  const real = (Date.now() - t0) / 1000; await rec.stop();
  console.log(JSON.stringify({ hero: id, out, real: +real.toFixed(2), errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
