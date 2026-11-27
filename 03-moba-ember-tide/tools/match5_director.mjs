// 用法: MOBA_URL=http://localhost:5207/map.html node tools/match5_director.mjs <输出目录> ["<网址参数>"=director=1&h=lan&seed=5] [跑到第几秒=600]
// 第九轮 match5：观战（导播）在十个人的时候找不找得到打架的地方。8 倍速跑一局观战，每过 2 秒（对局时间）记一次：
//   · 场上有没有“打架”（两边的英雄在 13 米内、两秒半内互相打过）；有的话导播是不是在看打架（focus 以 fight 开头）；
//   · 导播在看什么（打架、Boss/野怪、拆塔、对线）各占几成。
// 跑的中途在有打架的时候截三张画面（看镜头里是不是真的有人在打）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "director=1&h=lan&seed=5", until = "600"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const R = { q, samples: 0, fights: 0, onFight: 0, focus: {}, shots: [], errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 160)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5207/map.html") + "?" + q, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__director", { timeout: 120000 });
  await page.evaluate("__setSpeed(8)"); let next = 20;
  for (;;) {
    await new Promise(r => setTimeout(r, 120));
    const t = await page.evaluate("__sim.time"); if (t >= +until || (await page.evaluate("__sim.over"))) break; if (t < next) continue; next = t + 2;
    const s = await page.evaluate(`(() => { const hs = __sim.heroes().filter(e => e.alive), hot = h => [...h.h.hitBy.values()].some(tm => __sim.time - tm < 2.5); let fight = null;
      for (const h of hs) { if (!hot(h)) continue; const who = hs.filter(e => Math.hypot(e.x - h.x, e.z - h.z) < 13); if (who.some(e => e.team !== h.team)) { if (!fight || who.length > fight.n) fight = { n: who.length, x: who.reduce((a, e) => a + e.x, 0) / who.length, z: who.reduce((a, e) => a + e.z, 0) / who.length }; } }
      const f = __director.focus(); return { f, fight }; })()`);
    R.samples++; const k = s.f.replace(/[0-9-]+$/, "") || "开场"; R.focus[k] = (R.focus[k] ?? 0) + 1;
    if (s.fight) { R.fights++; if (s.f.startsWith("fight")) R.onFight++;
      if (R.shots.length < 3 && s.fight.n >= 4 && t > 60 + R.shots.length * 120) { await page.evaluate("__setSpeed(1)"); await new Promise(r => setTimeout(r, 1300)); const n = `director_fight_${R.shots.length + 1}`; await page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 88 }); R.shots.push({ n, t: Math.round(t), fighters: s.fight.n }); await page.evaluate("__setSpeed(8)"); } }
  }
} finally { await browser.close(); }
fs.writeFileSync(`${out}/director.json`, JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
