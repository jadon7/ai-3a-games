#!/usr/bin/env node
// 在测试场里（借岚的位置）直接播巨魔的某段动作并连拍，看它在游戏的光照、镜头、小兵旁边是什么样。
// tools/kit_test.mjs 只能看普攻（而且靶子两下就死了），咆哮、死亡、行走它放不出来；这个脚本直接让模型播指定的动作。
// 用法: node art/unit/troll/arena_shots.mjs <输出目录> <look，如 height:6,ring:2.6,bar:0> <动作:张数:间隔毫秒[:倍率],…>
//   动作写 walk 表示让它走一段（按测试场里岚的移速 6 米/秒）。产出 <输出目录>/<动作>_<序号>.jpg（1500×844 整屏）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, look, list] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
await page.goto(`http://localhost:5183/map.html?arena=1&h=lan&glb=../unit/troll&look=${look}`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
const sleep = ms => new Promise(r => setTimeout(r, ms)), ev = s => page.evaluate(s); await sleep(1200);
await ev("(() => { const a = __play.actor; window.__kx = a.pos.x; window.__kz = a.pos.z; })()");
for (const item of list.split(",")) {
  const [clip, n = "8", gap = "200", speed = "1"] = item.split(":");
  await ev("(() => { const a = __play.actor; a.stop(); a.teleport(window.__kx, window.__kz); a.hero.play('idle', { fade: 0 }); })()"); await sleep(500);
  if (clip === "walk") await ev("(() => { const a = __play.actor, f = __arena.foes, cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length; a.moveTo(a.pos.x + (a.pos.x - cx), a.pos.z + (a.pos.z - cz)); })()");
  else await ev(`__play.actor.hero.play(${JSON.stringify(clip)}, { loop: ${clip === "idle" || clip === "run"}, fade: 0.1, speed: ${+speed} })`);
  for (let i = 0; i < +n; i++) { await page.screenshot({ path: `${out}/${clip}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(+gap); }
}
console.log(JSON.stringify({ errors, fps: await ev("Math.round(__stats.fps)") }));
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); process.exit(0);
