// 用法: node tools/touch_demo.mjs <输出.mp4> [英雄=vero]
// 录一段手机横屏的操作演示（验收页用）：真的发触摸事件——推摇杆走到兵线、按住攻击键、点技能、拖技能瞄准、拖进取消、开商店。
// 手指碰到的地方画一个半透明的圆点（录像里看得见手指在哪）。地址由 MOBA_URL 指定（默认 5190）。
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const [out, hero = "vero"] = process.argv.slice(2), base = process.env.MOBA_URL || "http://localhost:5190/map.html", W = 844, H = 390;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "touchdemo-"));
for (let tryN = 0; tryN < 3; tryN++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
  let ok = true, real = 0;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
    await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36");
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    await page.goto(`${base}?h=${hero}&lane=mid&diff=easy`, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 });
    const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms)), T = page.touchscreen;
    const box = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    // 手指的圆点
    await ev(`(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;z-index:99;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.35);box-shadow:0 0 0 2px rgba(255,255,255,.75),0 2px 8px rgba(0,0,0,.5);pointer-events:none;display:none"; document.body.appendChild(d);
      const mv = e => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }; addEventListener("pointerdown", e => { d.style.display = "block"; mv(e); }, true); addEventListener("pointermove", mv, true); for (const t of ["pointerup", "pointercancel"]) addEventListener(t, () => { d.style.display = "none"; }, true); })()`);
    // 快进到两边小兵在中路碰上；英雄满级（好演示大招），站到中路己方一侧
    await ev("__setSpeed(12)"); await page.waitForFunction("__sim.time > 26", { timeout: 300000, polling: 200 }); await ev("__setSpeed(1)");
    await ev(`(() => { __sim.gainXp(__sim.hero, 1e5); const ms = __sim.ents.filter(e => e.kind === "melee" && e.team === 0 && e.alive && e.lane === 0); let m = ms[0]; for (const e of ms) if (e.x + -e.z > m.x + -m.z) m = e; if (m) __play.actor.teleport(m.x - 6, m.z + 6); __sim.hero.h.mana = __sim.hero.h.stat.mana; })()`);
    await sleep(900);
    const rec = await page.screencast({ path: `${tmp}/a.webm` }); const t0 = Date.now();
    const st = await box(".tc-stick .base"), atk = await box(".tc-atk"), sk = await ev("[...document.querySelectorAll('.skills .sk:not(.p)')].map(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })");
    const drag = async (x0, y0, x1, y1, hold, steps = 10) => { await T.touchStart(x0, y0); for (let i = 1; i <= steps; i++) { await sleep(30); await T.touchMove(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); } await sleep(hold); };
    await sleep(700);
    await drag(st[0], st[1], st[0] + 46, st[1] - 40, 1500); await T.touchEnd(); await sleep(350);                // 推摇杆：朝右上（对面）走
    await T.touchStart(atk[0], atk[1]); await sleep(2600); await T.touchEnd(); await sleep(300);                   // 按住攻击键
    await T.touchStart(sk[0][0], sk[0][1]); await sleep(60); await T.touchEnd(); await sleep(1300);                // 点一下第一个技能：自动对准
    if (sk[2]) { await drag(sk[2][0], sk[2][1], sk[2][0] + 34, sk[2][1] - 44, 900, 14); await T.touchEnd(); await sleep(1300); }      // 按住第三个技能拖着瞄，松手放
    await drag(st[0], st[1], st[0] - 40, st[1] + 30, 800); await T.touchEnd(); await sleep(200);                   // 往回走两步
    const last = sk[sk.length - 1], cc = await ev("(() => { const el = document.querySelector('.tc-cancel'); el.hidden = false; const r = el.getBoundingClientRect(); el.hidden = true; return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    await drag(last[0], last[1], last[0] + 30, last[1] - 30, 700, 10); for (let i = 1; i <= 12; i++) { await sleep(30); await T.touchMove(last[0] + 30 + ((cc[0] - last[0] - 30) * i) / 12, last[1] - 30 + ((cc[1] - last[1] + 30) * i) / 12); } await sleep(600); await T.touchEnd(); await sleep(500);      // 大招：拖着瞄，再拖进“取消”
    await drag(last[0], last[1], last[0] + 36, last[1] - 34, 800, 12); await T.touchEnd(); await sleep(2600);     // 再来一次，这回放出去
    const gd = await box(".gold"); await T.touchStart(gd[0], gd[1]); await sleep(60); await T.touchEnd(); await sleep(1600);      // 开商店看一眼
    const x = await box(".shop .x"); await T.touchStart(x[0], x[1]); await sleep(60); await T.touchEnd(); await sleep(700);
    real = (Date.now() - t0) / 1000; await rec.stop();
    if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { ok = false; console.log("着色器没编过，重来"); } else if (errors.length) console.log("报错", errors.slice(0, 3));
  } catch (e) { console.log("出错", String(e).slice(0, 300)); ok = false; } finally { await browser.close(); }
  if (ok) { execFileSync("zsh", ["tools/rec_fix.sh", `${tmp}/a.webm`, out, String(real), "1688", "24"], { stdio: "inherit" }); console.log("录好了", out, real.toFixed(1), "秒"); break; }
}
