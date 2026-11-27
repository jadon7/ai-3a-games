// 用法: MOBA_URL=http://localhost:5207/map.html node tools/match5_fps.mjs <输出前缀> [desktop|phone] [读几秒=40]
// 第九轮 match5：十人团战的帧率。开一局观战（十个人都是电脑，“表演”打法：四分钟以后两队都往中路去、撞在一起），16 倍速快进到 4 分 10 秒，
// 切回 1 倍速，导播的镜头跟着打架走，每秒读一次 __stats.fps，同时记下这一秒有几个英雄在打（两秒内挨过对面英雄的打）、镜头里有几个英雄。
// 最后分开算：全部的帧率，和“六个人以上在打”那几秒的帧率。打得最凶的那一秒截一张图（<输出前缀>.jpg）。
// phone：844×390 三倍屏、触屏、手机画质（q=lite）。无界面 Chrome 锁 60 帧，看的是掉没掉到 60 以下；手机档是在这台电脑的显卡上跑手机画质，不等于真手机。
// 先试过把十个人直接摆到河道里：普通难度两边一样强的时候谁也不先动手、各自走回线上，表演打法也只打起来一半，所以改成等真的团战。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, mode = "desktop", n = "40"] = process.argv.slice(2), phone = mode === "phone", W = phone ? 844 : 1920, H = phone ? 390 : 1080;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
const R = { mode, errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone, isLandscape: true });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 160)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5207/map.html") + "?director=1&h=lan&seed=5" + (phone ? "&touch=1&q=lite" : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && __sim.heroes().length === 10", { timeout: 180000 });
  await page.evaluate("__setSpeed(16)"); await page.waitForFunction("__sim.time > 250", { timeout: 600000, polling: 200 }); await page.evaluate("__setSpeed(1)"); await new Promise(r => setTimeout(r, 1500));
  const S = []; let best = -1;
  for (let i = 0; i < +n; i++) { await new Promise(r => setTimeout(r, 1000));
    const s = await page.evaluate(`({ fps: Math.round(__stats.fps), t: Math.round(__sim.time), fighting: __sim.heroes().filter(e => e.alive && [...e.h.hitBy.values()].some(t => __sim.time - t < 2)).length, onScreen: __sim.heroes().filter(e => { if (!e.alive) return false; const [x, y] = __screen(e.x, e.z); return x > 0 && x < innerWidth && y > 0 && y < innerHeight; }).length })`); S.push(s);
    if (s.fighting > best) { best = s.fighting; await page.screenshot({ path: out + ".jpg", type: "jpeg", quality: 88 }); } }
  const avg = l => (l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null), big = S.filter(s => s.fighting >= 6).map(s => s.fps), all = S.map(s => s.fps);
  Object.assign(R, { min: Math.min(...all), avg: avg(all), bigFightSeconds: big.length, bigFightMin: big.length ? Math.min(...big) : null, bigFightAvg: avg(big), maxFighting: best, samples: S });
} finally { await browser.close(); }
fs.writeFileSync(out + ".json", JSON.stringify(R, null, 1)); console.log(JSON.stringify({ ...R, samples: R.samples?.map(s => `${s.fps}/${s.fighting}/${s.onScreen}`).join(" ") }));
