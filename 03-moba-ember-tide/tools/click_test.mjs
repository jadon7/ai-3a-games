// 用法: node tools/click_test.mjs <输出目录>
// 真的用鼠标点：右键点地面走过去、左键点地面不走、按住右键拖着走、右键点对方小兵打它、点对方的塔打它、按 Q、点小地图、最后看失败面板。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = {};
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto("" + (process.env.MOBA_URL || "http://localhost:5183/map.html") + "?hero=-6,2,135&solo=1", { waitUntil: "load" });      /* solo=1：只有自己，没有电脑（这份测试查的是鼠标和键盘，不要别的英雄来搅局） */ await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(800);
  // 1 点地面
  // 第九轮改了操作：右键点地面走、右键点敌人打（按下就生效），左键不再走路（左键是确认技能、拖镜头）
  const p0 = await ev("[__sim.hero.x, __sim.hero.z]"); let [cx, cy] = await ev(`__screen(${p0[0] + 4}, ${p0[1] - 4}, 0)`); await page.mouse.click(cx, cy, { button: "right" }); await sleep(1800);
  const p1 = await ev("[__sim.hero.x, __sim.hero.z]"); R["右键点地面后走了几米"] = +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1);
  [cx, cy] = await ev(`__screen(${p1[0] - 4}, ${p1[1] + 3}, 0)`); await page.mouse.click(cx, cy); await sleep(900);
  const p1b = await ev("[__sim.hero.x, __sim.hero.z]"); R["左键点地面不走（米）"] = +Math.hypot(p1b[0] - p1[0], p1b[1] - p1[1]).toFixed(1);
  // 按住右键拖着：鼠标从英雄右边拖到左边，人跟着鼠标走
  { const q0 = await ev("[__sim.hero.x, __sim.hero.z]"); const [ax, ay] = await ev(`__screen(${p1b[0] + 5}, ${p1b[1]}, 0)`), [bx, by] = await ev(`__screen(${p1b[0]}, ${p1b[1] + 5}, 0)`);
    await page.mouse.move(ax, ay); await page.mouse.down({ button: "right" }); const t0 = Date.now(); await sleep(60); const q1 = await ev("[__sim.hero.x, __sim.hero.z]");
    for (let i = 1; i <= 10; i++) { await page.mouse.move(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10); await sleep(80); } await sleep(500); await page.mouse.up({ button: "right" }); void t0;
    const q2 = await ev("[__sim.hero.x, __sim.hero.z]"); R["右键按下 60 毫秒内已经在走"] = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 0.05; R["按住右键拖着走：最后往 +z 走了几米"] = +(q2[1] - q0[1]).toFixed(1); }
  // 2 放一个对方小兵（不会动、不还手），点它
  await ev(`(() => { const h = __sim.hero; window.__d = __sim.add("melee", 1, h.x + 4.5, h.z - 1.5, { max: 1000, ad: 0, range: 0.1, period: 99, sight: 0, r: 0.55, state: "idle", lane: 0, s: 0, seen: true, think: 1e9, root: 1e9 }); })()`); await sleep(600);      /* root：定住。没有目标的小兵会沿兵线走开，第九轮改了兵线上的走法以后它走的路线不一样，英雄追着它打就成了碰运气 */
  [cx, cy] = await ev("__screen(__d.x, __d.z, 1.1)"); await page.mouse.click(cx, cy, { button: "right" }); await sleep(2600);
  R["右键点小兵后它剩的血"] = await ev("__d.hp"); R["英雄状态"] = await ev("__play.state()");
  await page.screenshot({ path: out + "/click_minion.jpg", type: "jpeg", quality: 85 });
  // 3 把鼠标移到小兵上，按住 Q（出指示）、松开（放出钩引）
  await ev("__d.hp = __d.max; 1"); await ev(`(() => { const h = __sim.hero; __d.x = h.x + 7; __d.z = h.z - 5; })()`); await page.keyboard.press("KeyS"); await sleep(500);
  [cx, cy] = await ev("__screen(__d.x, __d.z, 1.1)"); await page.mouse.move(cx, cy); const d0 = await ev("Math.hypot(__d.x - __sim.hero.x, __d.z - __sim.hero.z)");
  await page.keyboard.down("KeyQ"); await sleep(350); R["按住 Q 时在瞄准"] = await ev("__play.aiming()"); await page.screenshot({ path: out + "/aim_q.jpg", type: "jpeg", quality: 85 }); await page.keyboard.up("KeyQ"); await sleep(1800);
  const d1 = await ev("Math.hypot(__d.x - __sim.hero.x, __d.z - __sim.hero.z)"); R["钩引前后小兵离英雄"] = [+d0.toFixed(1), +d1.toFixed(1)]; R["钩引后小兵剩的血"] = await ev("__d.hp"); R["钩引进了冷却"] = await ev("__play.actor.cdLeft('Q') > 0");
  // 4 按 W（潮隐，按下就放）
  await page.keyboard.press("KeyS"); await page.keyboard.press("KeyW"); await sleep(1500); R["潮隐后隐身"]      /* 先按 S：钩引以后岚会接着普攻那个小兵，前摇缩短以后 1.5 秒内就打出了“隐身第一击”现了形（这是对的），测的又是隐身本身 */ = await ev("__sim.hero.invis"); R["法力少了"] = await ev("__sim.hero.h.mana < __sim.hero.h.stat.mana");
  // 4b 按住 Q 再按 Esc：取消，不放
  await ev("__play.actor.setCd('Q', 0); 1"); await page.keyboard.down("KeyQ"); await sleep(200); await page.keyboard.press("Escape"); await page.keyboard.up("KeyQ"); await sleep(300); R["Esc 取消后没放"] = await ev("__play.actor.cdLeft('Q') === 0 && __play.aiming() === null");
  // 4b2 按住 Q 时点右键：取消，不放，也不走；按住 Q 时点左键：立刻放出去
  await ev("__play.actor.setCd('Q', 0); __play.actor.stop(); 1"); await sleep(200); { const q0 = await ev("[__sim.hero.x, __sim.hero.z]"); await page.keyboard.down("KeyQ"); await sleep(150); [cx, cy] = await ev(`__screen(${q0[0] - 3}, ${q0[1] + 3}, 0)`); await page.mouse.click(cx, cy, { button: "right" }); await page.keyboard.up("KeyQ"); await sleep(400);
    const q1 = await ev("[__sim.hero.x, __sim.hero.z]"); R["瞄准时右键取消：没放、没走"] = await ev("__play.actor.cdLeft('Q') === 0 && __play.aiming() === null") && Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) < 0.05; }
  await ev("__play.actor.setCd('Q', 0); 1"); await page.keyboard.down("KeyQ"); await sleep(150); [cx, cy] = await ev("__screen(__d.x, __d.z, 1.1)"); await page.mouse.down(); await sleep(30); R["瞄准时左键按下就放"] = await ev("__play.actor.cdLeft('Q') > 0 || __play.state() === 'cast'"); await page.mouse.up(); await page.keyboard.up("KeyQ"); await sleep(1500);
  // 4c 打开商店再关上
  await page.keyboard.press("KeyP"); await sleep(300); R["按 P 打开了商店"] = await ev("!document.querySelector('.shop').hidden"); await page.keyboard.press("Escape"); await sleep(200); R["Esc 关了商店"] = await ev("document.querySelector('.shop').hidden");
  // 4d 回城：按 B 开始读条；走一步就断
  await page.keyboard.press("KeyB"); await sleep(500); R["按 B 开始回城"] = await ev("__play.actor.recalling() > 0 && !document.querySelector('.recall').hidden"); await ev("__play.moveTo(__play.pos.x + 2, __play.pos.z); 1"); await sleep(300); R["走一步回城断了"] = await ev("__play.actor.recalling() === 0"); await ev("__play.actor.stop(); 1"); await sleep(300);
  // 5 点小地图：镜头跳过去，再按空格回来
  const box = await ev("(() => { const r = document.querySelector('.hud-map').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
  await page.mouse.click(box[0] + box[2] * 0.8, box[1] + box[3] * 0.2); await sleep(700); await page.screenshot({ path: out + "/minimap_jump.jpg", type: "jpeg", quality: 85 });
  R["点小地图后还跟着英雄"] = await ev("__play.follow"); await page.keyboard.press("Space"); await sleep(600); R["按空格后跟着英雄"] = await ev("__play.follow");
  // 6 点界面上的技能键（A）
  await ev("__d.hp = __d.max; 1"); await ev("__play.actor.setCd('Q', 0); __play.aim(__d.x, __d.z); 1"); await page.evaluate(() => [...document.querySelectorAll(".skills button")].find(b => b.textContent.includes("Q")).click()); await sleep(400); R["点界面上的 Q 键后在施法、进了冷却"] = await ev("[__play.state(), __play.actor.cdLeft('Q') > 0]"); await sleep(2100);      /* 原来看的是小兵剩多少血，但那只小兵在前面的步骤里可能已经被打死了，判不出来 */
  // 7 失败面板：把自己的水晶打掉
  for (const tier of [1, 2, 3]) { await ev(`(() => { const t = __sim.ents.find(e => e.kind === 'tower' && e.team === 0 && e.lane === 0 && e.tier === ${tier}); __sim.damage(t, 1e6, null); })()`); await sleep(300); }      // 自己的水晶有塔保护，要先按顺序拆掉一条线的三座塔
  R["我方中路三座塔拆掉后剩几座"] = await ev("__sim.towersLeft(0)");
  await ev("(() => { const c = __sim.ents.find(e => e.kind === 'core' && e.team === 0); __sim.damage(c, 1e6, null); })()"); await sleep(4200);
  R["自己水晶没了以后"] = await ev("[__sim.over, document.querySelector('.hud-end h2')?.textContent]"); await page.screenshot({ path: out + "/lose.jpg", type: "jpeg", quality: 85 });
  R["画面还在渲染"] = await ev("(() => { const c = document.querySelector('canvas'), g = c.getContext('webgl2'); return !g.isContextLost(); })()");
  R.errors = errors;
  console.log(JSON.stringify(R, null, 1));
} finally { await browser.close(); }
