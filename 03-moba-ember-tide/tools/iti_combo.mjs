#!/usr/bin/env node
// 伊缇的连招伤害（第四阶段 iti-kit）：在测试场里把伊缇和对面的假人英雄设成指定的等级、装备（假人的属性换成指定英雄的），
// 按顺序放一套技能（每个技能能放了就马上放，中间不普攻），记下假人每一下掉多少血、什么时候死的。调数值用。
// 用法: MOBA_URL=... node tools/iti_combo.mjs <输出.json> '<场景 JSON 数组>'
//   场景: {"name":"脆皮","lv":11,"items":["ambush","boots_cd"],"target":"ugo","tlv":11,"titems":["ember","boots_ap"],"seq":["E","Q","Q","Q","R"],"dist":8,"hp":1}
//   hp：假人开始时的血量比例；seq 里写 "A" 是普攻一下（等这一下打出去）；"wait:0.5" 是等 0.5 秒
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, json] = process.argv.slice(2);
const scenes = JSON.parse(json);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const all = [];
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(process.env.MOBA_URL + "?arena=1&h=iti&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena && window.__arena.dummy", { timeout: 120000 });
  await page.evaluate(`(async () => { window.__I = await import("/src/map/game/items.ts"); window.__H = await import("/src/map/game/heroes/index.ts"); return 1; })()`);
  for (const sc of scenes) {
    const res = await page.evaluate(`(async () => {
      const sc = ${JSON.stringify(sc)}, sim = __sim, me = sim.hero, a = __actors.get(me.id), d = __arena.dummy, da = __actors.get(d.id), sleep = ms => new Promise(r => setTimeout(r, ms));
      __setSpeed(1); da.kit.passive = undefined;      // 假人是托尔格：它的被动（越残越硬）会搅乱数，关掉
      const setup = (e, base, lv, items) => { const h = e.h; if (base) h.base = { ...base }; h.level = lv; h.xp = 0; h.items = []; h.mods.clear(); h.gold = 1e6; sim.recalc(e); for (const id of items) __I.buy(sim, e, id, true); sim.recalc(e); e.hp = e.max * (sc.hp ?? 1); h.mana = h.stat.mana; e.shield = 0; e.vuln = 0; e.vulnT = 0; e.stun = e.slow = 0; };
      // 先等假人活着
      for (let i = 0; i < 100 && !d.alive; i++) await sleep(100);
      a.stop(); for (const k of ["Q","W","E","R"]) a.setCd(k, 0); a.data.iti = undefined;
      setup(me, null, sc.lv, sc.items ?? []); setup(d, __H.KITS[sc.target].base, sc.tlv ?? sc.lv, sc.titems ?? []);
      const ux = Math.SQRT1_2, uz = Math.SQRT1_2; let px = d.x - ux * (sc.dist ?? 8), pz = d.z - uz * (sc.dist ?? 8); if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a.teleport(px, pz); a.face(d.x, d.z, true);
      await sleep(300);
      const t0 = sim.time, hp0 = d.hp, log = [], orig = sim.damage; let dead = -1;
      sim.damage = (e, n, src, o) => { const r = orig(e, n, src, o); if (e === d && r > 0) { log.push([+(sim.time - t0).toFixed(2), Math.round(r), new Error().stack.includes("stack") ? 1 : 0]); if (!d.alive && dead < 0) dead = +(sim.time - t0).toFixed(2); } return r; };
      const steps = [];
      try {
        for (const k of sc.seq) {
          if (!d.alive) break;
          if (k.startsWith("wait:")) { await sleep(+k.slice(5) * 1000); continue; }
          if (k === "A") { const n = log.length; a.attack(d); for (let i = 0; i < 60 && log.length === n && d.alive; i++) await sleep(25); continue; }
          let w = 0; while (!a.canCast(k) && w < 200) { await sleep(20); w++; }
          const before = a.data.iti?.q?.n, cd0 = a.cdLeft(k), tc = +(sim.time - t0).toFixed(2), def = a.skill(k);
          const ok = a.cast(k, { x: d.x, z: d.z }, def.cast === "unit" ? d : null);
          let f = 0; while (f < 150) { const now = a.data.iti?.q?.n; if (k === "Q" ? now !== before : a.cdLeft(k) > 0.4 || (k === "W" && a.skill("W")?.instant)) break; await sleep(20); f++; }
          steps.push({ k, name: def.name, cast: tc, fired: +(sim.time - t0).toFixed(2), ok });
        }
        for (let i = 0; i < 120 && d.alive && (a.state() === "lock" || a.state() === "cast" || a.state() === "dash"); i++) await sleep(25);
        await sleep(400);
      } finally { sim.damage = orig; }
      const total = log.reduce((s, x) => s + x[1], 0);
      return { name: sc.name, me: { lv: me.h.level, ad: me.h.stat.ad, items: me.h.items }, target: { id: sc.target, lv: d.h.level, max: d.max, armor: Math.round(d.armor), hp0: Math.round(hp0), items: d.h.items }, total, pct: +(total / d.max).toFixed(2), dead, steps, hits: log.map(x => x[0] + "s " + x[1]) };
    })()`);
    all.push(res);
    console.log(`${res.name}: 伊缇 ${res.me.lv} 级 攻击 ${res.me.ad} [${res.me.items}]  对 ${res.target.id} ${res.target.lv} 级 ${res.target.max} 血 护甲 ${res.target.armor} [${res.target.items}]  共 ${res.total}（${Math.round(res.pct * 100)}%） ${res.dead >= 0 ? res.dead + " 秒死" : "没死"}`);
    console.log("   " + res.steps.map(s => `${s.k}@${s.cast}→${s.fired}`).join("  ") + "   每下: " + res.hits.join(", "));
    await new Promise(r => setTimeout(r, 4200));      // 等假人复活、残影炸完
  }
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
fs.writeFileSync(out, JSON.stringify(all, null, 1));
