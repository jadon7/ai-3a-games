// 卡兹的技能逐个放一遍（测试场），看报错、伤害、冷却、位置、锁定。用法: MOBA_URL=... node tools/kaz_check.mjs [截图目录]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const base = process.env.MOBA_URL, out = process.argv[2]; if (out) fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto(base + "?arena=1&h=kaz&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await sleep(1500);
  const ev = s => page.evaluate(s);
  const R = {};
  R.kit = await ev("__actors.get(__sim.hero.id).kit.id");
  R.bones = await ev(`(() => { const a = __actors.get(__sim.hero.id), v = a.pos.clone(); const f = n => { const b = a.hero.bone(n); if (!b) return null; b.getWorldPosition(v); return [+(v.x - a.pos.x).toFixed(2), +(v.y - a.pos.y).toFixed(2), +(v.z - a.pos.z).toFixed(2)]; }; return { yaw: +a.yaw().toFixed(2), head: f("tripo::Head_1"), chest: f("tripo::Spine_5"), pawL: f("tripo0_Left_Limb_5"), pawR: f("tripo0_Right_Limb_5"), hindL: f("tripo1_Left_Limb_4"), hand: (() => { const h = a.hand(a.pos.clone()); return [+(h.x - a.pos.x).toFixed(2), +(h.y - a.pos.y).toFixed(2), +(h.z - a.pos.z).toFixed(2)]; })() }; })()`);
  await ev("for (let i = 0; i < 15; i++) __sim.gainXp(__sim.hero, 2000)");
  const reset = `(()=>{ const a=__actors.get(__sim.hero.id); for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; __arena.reset(); return 1; })()`;
  const snap = `(()=>{ const d=__arena.dummy, a=__actors.get(__sim.hero.id); return { hp: Math.round(d.hp), max: d.max, stun: +d.stun.toFixed(2), slow: +d.slow.toFixed(2), vuln: +d.vulnT.toFixed(2), dist: +Math.hypot(d.x-a.pos.x, d.z-a.pos.z).toFixed(2), me: [+a.pos.x.toFixed(1), +a.pos.z.toFixed(1)], st: a.state(), mana: Math.round(__sim.hero.h.mana), cd: ["Q","W","E","R"].map(k => +a.cdLeft(k).toFixed(1)), hunt: !!a.data.kaz?.hunt, myhp: Math.round(__sim.hero.hp) }; })()`;
  for (const [key, how] of [["Q", "unit"], ["W", "self"], ["E", "dir"], ["R", "unit"]]) {
    await ev(reset); await sleep(1800);
    const before = await ev(snap);
    const ok = await ev(`(()=>{ const a=__actors.get(__sim.hero.id), d=__arena.dummy; return a.cast("${key}", {x:d.x, z:d.z}, ${how === "unit" ? "d" : "null"}); })()`);
    await sleep(400); const mid = await ev(snap);
    if (out) await page.screenshot({ path: `${out}/${key}.jpg`, type: "jpeg", quality: 80 });
    await sleep(1100); const after = await ev(snap);
    R[key] = { ok, before, mid, after };
  }
  // 锁定期间打死：Q W 转好、回血
  await ev(reset); await sleep(1800);
  await ev(`(()=>{ const a=__actors.get(__sim.hero.id), d=__arena.dummy; a.cast("R", {x:d.x,z:d.z}, d); })()`); await sleep(1300);
  await ev(`(()=>{ const a=__actors.get(__sim.hero.id); a.setCd("Q", 5); a.setCd("W", 4); __sim.hero.hp = __sim.hero.max * 0.5; })()`);
  const pre = await ev(snap);
  await ev(`(()=>{ const d=__arena.dummy; __sim.damage(d, 99999, __sim.hero, {type:"true"}); })()`); await sleep(300);
  R.killReset = { pre, post: await ev(snap) };
  // 被动：打同一个目标三下点燃
  await ev(reset); await sleep(1800);
  await ev(`(()=>{ const a=__actors.get(__sim.hero.id); a.attack(__arena.foes[0]); })()`); await sleep(3500);
  R.passive = await ev(`(()=>{ const a=__actors.get(__sim.hero.id); return { burns: a.data.kaz.burns.size, hits: [...a.data.kaz.hits.values()], foeHp: Math.round(__arena.foes[0].hp), foeMax: __arena.foes[0].max }; })()`);
  R.errors = errors.slice(0, 8);
  console.log(JSON.stringify(R, null, 1));
} finally { await browser.close(); }
