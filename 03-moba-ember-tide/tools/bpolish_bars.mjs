// 换画风 B · b-polish：只看英雄头顶血条的固定局面（改前、改后跑同一个脚本对着看）。
// 摆法：玩家是岚，身边两个队友、三个对面的英雄，镜头拉近（dist=18，再近血条就藏了）；每个人的血量、护盾、状态字都摆好再把对局停住：
//   队友托尔格 80% 血带一截护盾，队友薇萝 40% 血被减速；对面葛隆 60% 血被眩晕，对面岚 90% 血被沉默，对面薇萝 30% 血、刚掉了一截（浅色拖尾）。
// 用法: MOBA_URL=http://localhost:<端口>/map.html node tools/bpolish_bars.mjs <输出.jpg> [宽=1600] [高=900] [touch]
import puppeteer from "puppeteer-core";
const [out, w = "1600", h = "900", mode = ""] = process.argv.slice(2);
const touch = mode === "touch", base = process.env.MOBA_URL || "http://localhost:5242/map.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const Q = "h=lan&pos=mid&a=torg,lan,osen,vero,moko&b=gorran,lan,osen,vero,moko&hero=-13,0,135&dist=18&nofog=1" + (touch ? "&touch=1" : "");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
try {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, isLandscape: true });
  page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto(base + "?" + Q, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 }); await sleep(1500);
  // 先升级（正常速度下升，升级的光柱放完再停住）
  await page.evaluate(() => { for (const b of __bots) b.update = () => {}; const S = __sim, A = [...__actors.values()]; const lv = (e, n) => { let k = 0; while (e.h.level < n && k++ < 400) S.gainXp(e, 40); };
    const L = { top: 10, jungle: 8, mid: 9, adc: 8, sup: 7 }; for (const a of A) lv(a.ent, a.ent === S.hero ? 9 : L[a.ent.h.pos] + (a.ent.team ? 1 : 0)); });      // 等级按位置定（照 ui2_hud.mjs），改前改后一样
  await sleep(3500);
  await page.evaluate(() => { __setSpeed(0); const S = __sim, me = S.hero, A = [...__actors.values()], [px, pz] = [me.x, me.z];
    for (const e of S.ents) if ((e.kind === "melee" || e.kind === "ranged") && e.alive) { e.alive = false; e.hp = 0; }
    const H = (tm, pos) => A.find(a => a.ent.team === tm && a.ent.h.pos === pos);
    const put = (a, dx, dz, hp, f) => { a.teleport(px + dx, pz + dz); a.stop(); const e = a.ent; e.hp = e.max * hp; e.seen = true; e.h.mana = e.h.stat.mana * 0.6; f?.(e); };
    __play.actor.stop(); me.hp = me.max * 0.72; me.h.mana = me.h.stat.mana * 0.58;
    put(H(0, "top"), -5.2, 2.6, 0.8, e => { e.shield = e.max * 0.12; }); put(H(0, "adc"), 5.0, 3.0, 0.4, e => { e.slow = 99; });
    put(H(1, "top"), -6.2, -2.6, 0.6, e => { e.stun = 99; }); put(H(1, "jungle"), 0.8, -3.0, 0.9, e => { e.silence = 99; }); put(H(1, "adc"), 6.4, -2.2, 0.55);
  });
  await sleep(800);
  await page.evaluate(() => { const e = [...__actors.values()].find(a => a.ent.team === 1 && a.ent.h.pos === "adc").ent; e.hp = e.max * 0.3; });      // 刚掉的一截：拖尾按真实时间缩，停住以后也会慢慢缩，所以掉完马上拍
  await sleep(250);
  await page.screenshot({ path: out, type: "jpeg", quality: 92 });
  console.log(JSON.stringify({ out, errors: errors.slice(0, 8) }));
} finally { await browser.close(); }
