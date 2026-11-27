// 用法: node tools/ui2_hud.mjs <输出目录> <宽> <高> [touch] [只截这几个,逗号分开]
// 第九轮 ui2（对局界面第二轮）用：摆一个固定的对局局面再截图，改之前、改之后跑同一个脚本，对着看。
//   局面：五对五，玩家是岚（打野）站在中路河道，8:34，9 级、四件装备、1331 金、血 72%、蓝 58%，Q 和 E 在冷却；
//   身边一个己方上单、一个己方射手，对面三个英雄、两边各几个小兵；刚拆了一座塔、岚拿了一个人头、对面射手杀了我方辅助（击杀条上三行）。
//   TOWER=1：同一套人摆到对面中路一塔前面（塔掉到 55% 血），看塔的血条和英雄、小兵的血条放在一起。
//   摆好以后把对局停住（__setSpeed(0)：规则和动作都不走，画面和界面照常刷新），所以每次截出来是同一个局面。
// 截的图：game（主图）、tip（桌面：鼠标停在 R 上出说明）、shop、board、menu。带 touch 就按手机横屏截（触屏、两倍屏、苹果手机的 UA）。地址由 MOBA_URL 指定。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, w, h, mode = "", only = ""] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const touch = mode === "touch", base = process.env.MOBA_URL || "http://localhost:5215/map.html", dpr = +(process.env.DPR || (touch ? 2 : 1)), want = new Set(only.split(",").filter(Boolean));
const sleep = ms => new Promise(r => setTimeout(r, ms)), job = n => !want.size || want.has(n);
const Q = "h=lan&pos=jungle&a=torg,lan,osen,vero,moko&b=gorran,lan,osen,vero,moko&hero=-13,0,135" + (touch ? "&touch=1" : "") + (process.env.EXTRA ? "&" + process.env.EXTRA : "");

// 第一步（正常速度）：电脑都停手；回出生点买装备再回来；升级（升级的光柱要放完再停住，不然会定格在身上）
const STEP1 = `(() => { for (const b of __bots) b.update = () => {}; const S = __sim, me = S.hero, A = [...__actors.values()]; window.__P = [me.x, me.z];
  ${process.env.TOWER ? "{ const T = S.ents.find(e => e.kind === 'tower' && e.team === 1 && e.lane === 0 && e.open), [cx, cz] = S.fountain[0], dx = cx - T.x, dz = cz - T.z, l = Math.hypot(dx, dz); window.__P2 = [T.x - 9, T.z + 3.5]; T.hp = T.max * 0.55; }" : ""}
  const [fx, fz] = S.fountain[0]; __play.actor.teleport(fx, fz); me.h.gold = 9000; for (const id of ['ambush', 'boots_cd', 'edge', 'plate']) __shop.buy(id); me.h.gold = 1331;
  __play.actor.teleport(__P[0], __P[1]); __play.actor.stop();
  const lv = (e, n) => { let k = 0; while (e.h.level < n && k++ < 400) S.gainXp(e, 40); };
  lv(me, 9); const L = { top: 10, jungle: 8, mid: 9, adc: 8, sup: 7 }; for (const a of A) if (a.ent !== me) lv(a.ent, L[a.ent.h.pos] + (a.ent.team ? 1 : 0));
  return me.h.level; })()`;
// 第二步（停住以后）：时钟拨到 8:34（会补出十几波兵，都在出生点，清掉）；英雄摆进来；加小兵；拆塔、两次击杀；冷却
const STEP2 = `(() => { const S = __sim, me = S.hero, [px, pz] = window.__P2 ?? __P, A = [...__actors.values()]; if (window.__P2) { __play.actor.teleport(px, pz); __play.actor.stop(); }      /* 塔前的那一版：停住以后再过去，塔不会开火 */
  for (const e of S.ents) if ((e.kind === 'melee' || e.kind === 'ranged') && e.alive) { e.alive = false; e.hp = 0; }
  const H = (tm, pos) => A.find(a => a.ent.team === tm && a.ent.h.pos === pos);
  const put = (a, dx, dz, hp) => { a.teleport(px + dx, pz + dz); a.stop(); a.ent.hp = a.ent.max * hp; a.ent.seen = true; a.ent.h.mana = a.ent.h.stat.mana * 0.7; };
  put(H(0, 'top'), -5.5, 1.8, 0.86); put(H(0, 'adc'), 5.6, 2.2, 0.42);
  put(H(1, 'top'), -3.8, -6.6, 0.62); put(H(1, 'mid'), 2.4, -7.0, 0.9); put(H(1, 'adc'), 7.4, -5.6, 0.33);
  me.hp = me.max * 0.72; me.h.mana = me.h.stat.mana * 0.58;
  const mk = (kind, tm, dx, dz, hp) => { const e = S.add(kind, tm, px + dx, pz + dz, { lane: 0, s: 0, max: kind === 'melee' ? 620 : 420, ad: 0, range: kind === 'melee' ? 1.6 : 6, period: 99, sight: 8, r: 0.5, state: 'idle', think: 1e9, yaw: tm ? 0 : Math.PI, seen: true }); e.root = 1e9; e.hp = e.max * hp; return e; };
  mk('melee', 0, -1.6, -2.7, 0.9); mk('melee', 0, 1.0, -3.1, 0.55); mk('melee', 0, 3.4, -2.5, 1); mk('ranged', 0, -2.9, -0.6, 0.8); mk('ranged', 0, 2.5, -0.4, 1);
  mk('melee', 1, -0.9, -4.6, 0.7); mk('melee', 1, 1.6, -5.0, 0.35); mk('melee', 1, 4.2, -4.4, 0.95); mk('ranged', 1, 0.2, -6.5, 1); mk('ranged', 1, -2.0, -5.8, 0.6);
  const tw = S.ents.find(e => e.kind === 'tower' && e.team === 1 && e.open && e.lane === 1); if (tw) S.damage(tw, 1e8, me, { type: 'true' });
  if (window.__P2) for (const a of A) a.ent.h.xp -= 1e6;      /* 塔前那一版：击杀给的经验不升级（停住时升级的飘字会定在画面上） */
  const eLan = H(1, 'jungle').ent, aMoko = H(0, 'sup').ent; S.damage(eLan, 40, H(0, 'top').ent); S.damage(eLan, 1e8, me, { type: 'true' }); S.damage(aMoko, 1e8, H(1, 'adc').ent, { type: 'true' });
  if (window.__P2) for (const a of A) a.ent.h.xp += 1e6;
  Object.assign(me.h, { kills: 4, deaths: 1, assists: 6, cs: 67 }); S.kills[0] = 7; S.kills[1] = 5;
  __play.actor.setCd('Q', 3.4); __play.actor.setCd('E', 8.6);
  return { lv: me.h.level, items: me.h.items, ents: S.ents.filter(e => e.alive && (e.kind === 'melee' || e.kind === 'ranged')).length }; })()`;

for (let tryN = 0; tryN < 3; tryN++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  const errors = []; let ok = true;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: +w, height: +h, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch, isLandscape: +w > +h });
    if (touch) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
    page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    const ev = s => page.evaluate(s), shot = n => page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 90 });
    const center = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await page.goto(base + "?" + Q, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 }); await sleep(1500);
    if (!touch) await page.mouse.move(+w * 0.5, +h * 0.3);
    console.log("等级", await ev(STEP1)); await sleep(3200);
    await ev("__setSpeed(0); __sim.time = 514; 1"); await sleep(2500);
    console.log(JSON.stringify(await ev(STEP2))); await sleep(4600);
    if (job("game")) await shot("game");
    if (!touch && job("tip")) { const r = await ev("(() => { const b = [...document.querySelectorAll('.skills .sk')].find(b => b.textContent.includes('R')); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"); await page.mouse.move(r[0], r[1]); await sleep(500); await shot("tip"); await page.mouse.move(+w * 0.5, +h * 0.3); await sleep(200); }
    if (job("shop")) { await ev("__shop.open()"); await sleep(500); await shot("shop"); await ev("__shop.close()"); await sleep(300); }
    if (job("board")) { if (touch) { const c = await center(".hud-top .mid"); await page.touchscreen.tap(c[0], c[1]); await sleep(600); await shot("board"); const b = await center(".board"); await page.touchscreen.tap(b[0], b[1]); } else { await page.keyboard.down("Tab"); await sleep(700); await shot("board"); await page.keyboard.up("Tab"); } await sleep(300); }
    if (job("menu")) { const c = await center(".hud-me button"); if (touch) await page.touchscreen.tap(c[0], c[1]); else await page.mouse.click(c[0], c[1]); await sleep(500); await shot("menu"); await ev("document.querySelector('.hud-menu [data-a=go]').click()"); await sleep(300); }
    if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { ok = false; console.log("着色器没编过，重来"); }
  } catch (e) { console.log("出错", String(e).slice(0, 300)); ok = false; } finally { await browser.close(); }
  console.log(JSON.stringify({ out, errors: errors.slice(0, 6) }));
  if (ok) break;
}
