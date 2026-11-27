#!/usr/bin/env node
// 在测试场里把一个英雄的普攻和每个技能各放一遍，连拍成图，并打印放完以后靶子的血量和状态。写技能、调特效时反复跑这个看。
// 用法: node tools/kit_test.mjs <英雄 id> <输出目录> [只测哪几个键，如 Q,R] [连拍张数=10] [间隔毫秒=170]
// 环境变量: MOBA_URL（默认 http://localhost:5183/map.html；在 worktree 里开发时指到自己的端口）
// 产出: <输出目录>/<键>.jpg（一个技能一张，从出手开始按时间排的连拍，裁掉了界面）和 <键>_<序号>.jpg（单张原图，1500×844）。
// 测试场里：__arena.foes 对面五个小兵，__arena.dummy 对面的假人英雄，__arena.friend 己方半血的假人英雄，__arena.pals 己方两个半血小兵。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [id, out, only = "", nShots = "10", gap = "170"] = process.argv.slice(2);
if (!id || !out) { console.error("用法: node tools/kit_test.mjs <英雄 id> <输出目录> [Q,W,E,R,A] [张数] [间隔]"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5183/map.html") + `?arena=1&h=${id}` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });      /* MOBA_Q：额外的地址参数，比如 glb=turtle&look=height:2.6,ring:1.7 */
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(900);
  const lost = await ev("(() => { const c = document.querySelector('canvas'), g = c.getContext('webgl2'); return g ? g.isContextLost() : true; })()");
  if (lost || errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { console.log(JSON.stringify({ blank: true, note: "三维画面没出来（显卡被占用时会这样），等一会儿重跑", errors: errors.slice(0, 3) })); process.exit(2); }
  const kit = await ev("JSON.stringify(__play.actor.kit.skills.map(s => ({ key: s.key, name: s.name, cast: s.cast, target: s.target ?? '', range: s.range ?? 0, channel: s.channel ?? 0 })))").then(JSON.parse);
  const keys = (only ? only.split(",") : ["A", ...kit.filter(s => s.cast !== "passive").map(s => s.key)]);
  // 采样：放技能的这段时间里每 40 毫秒记一次。靶子被打死以后会重生，所以掉血看的是“这段时间里出现过的最低血量”，状态看的是“出现过的最大值”
  const track = `(() => { const A = __arena, h = __sim.hero, all = () => [...A.foes, A.dummy, A.friend, ...A.pals, h]; const T = window.__track = { n: A.foes.length, ids: all().map(e => e.id), hp0: all().map(e => e.hp), min: all().map(e => e.hp), max: all().map(e => e.hp), st: all().map(() => ({})), d0: all().map(e => Math.hypot(e.x - h.x, e.z - h.z)), moved: all().map(() => 0), x0: all().map(e => [e.x, e.z]) };
    clearInterval(window.__trackIv); window.__trackIv = setInterval(() => { all().forEach((e, i) => { if (e.id !== T.ids[i]) return; T.min[i] = Math.min(T.min[i], e.hp); T.max[i] = Math.max(T.max[i], e.hp); const s = T.st[i];
      for (const k of ["stun", "root", "silence", "taunt", "shield", "vulnT"]) if (e[k] > 0 && e[k] < 1e6) s[k] = Math.max(s[k] ?? 0, +e[k].toFixed(1)); if (e.slow > 0) s.slow = Math.max(s.slow ?? 0, +e.slowK.toFixed(2)); if (e.untarget) s.untarget = 1; if (e.invis) s.invis = 1;
      T.moved[i] = Math.max(T.moved[i], Math.hypot(e.x - T.x0[i][0], e.z - T.x0[i][1])); }); }, 40); })()`;
  const collect = `(() => { clearInterval(window.__trackIv); const T = window.__track, h = __sim.hero, row = i => ({ 掉血: Math.round(T.hp0[i] - T.min[i]), 加血: Math.round(T.max[i] - T.hp0[i]), 被挪动: +T.moved[i].toFixed(1), 状态: Object.entries(T.st[i]).map(([k, v]) => k + ":" + v).join(" ") || "-" });
    const n = T.n; return JSON.stringify({ 对面小兵: Array.from({ length: n }, (_, i) => row(i)), 对面假人: row(n), 己方假人: row(n + 1), 己方小兵: [row(n + 2), row(n + 3)], 自己: { ...row(T.ids.length - 1), 法力: Math.round(h.h.mana), 结束时的状态: __play.state(), 位置: [+h.x.toFixed(1), +h.z.toFixed(1)] } }); })()`;
  const report = {};
  for (const key of keys) {
    // 每个技能之前：英雄回到起点，靶子复位，冷却清零，回满
    await ev("(() => { const a = __play.actor; __arena.reset(); a.stop(); a.teleport(window.__kx ?? (window.__kx = a.pos.x), window.__kz ?? (window.__kz = a.pos.z)); for (const k of ['Q','W','E','R']) a.setCd(k, 0); const h = __sim.hero; h.hp = h.max; h.h.mana = h.h.stat.mana; h.stun = 0; h.shield = 0; })()");
    await sleep(700);
    await ev(track);
    let did;
    if (key === "A") did = await ev("(() => { __play.attack(__arena.foes[0]); return 'attack'; })()");
    else {
      const d = kit.find(s => s.key === key); if (!d) { report[key] = "没有这个技能"; continue; }
      // 瞄哪：给友军的瞄己方假人；指向的瞄对面假人；其余瞄对面小兵堆的中间
      did = await ev(`(() => { const A = __arena, f = A.foes, cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
        const ally = ${JSON.stringify(d.target)} === "ally", unit = ${JSON.stringify(d.cast)} === "unit" ? (ally ? A.friend : A.dummy) : null;
        const x = unit ? unit.x : cx, z = unit ? unit.z : cz; const a0 = __play.actor, def = a0.skill(${JSON.stringify(key)}), reach = def.cast === "self" ? (def.radius ?? def.range ?? 0) * 0.6 : (def.range ?? def.radius ?? 0) * 0.7, ddx = a0.pos.x - x, ddz = a0.pos.z - z, dl = Math.hypot(ddx, ddz);
        if (reach > 0 && dl > reach) { const kk = Math.max(reach, 1.6) / dl; let px = x + ddx * kk, pz = z + ddz * kk; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a0.teleport(px, pz); }      /* 够不着就先站近（近战距离的技能） */
        return __play.cast(${JSON.stringify(key)}, x, z, unit); })()`);
    }
    for (let i = 0; i < +nShots; i++) { await page.screenshot({ path: `${out}/${key}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(+gap); }
    await sleep(key === "A" ? 300 : 1200);
    report[key] = { 放出去了: did, ...JSON.parse(await ev(collect)) };
    try { execFileSync("python3", [new URL("./kit_sheet.py", import.meta.url).pathname, out, key, nShots]); } catch (e) { errors.push("拼图失败 " + String(e).slice(0, 120)); }
  }
  console.log(JSON.stringify({ hero: id, skills: kit, report, errors: errors.slice(0, 8), fps: await ev("Math.round(__stats.fps)") }, null, 1));
} finally { await browser.close(); }
