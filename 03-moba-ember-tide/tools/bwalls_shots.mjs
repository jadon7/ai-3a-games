#!/usr/bin/env node
// 换画风 B · b-walls：一个无界面 Chrome 连着截一串机位（省得每张都重开浏览器），顺便记每张的帧率和绘制调用。
// 量帧率时加 MOBA_UNCAP=1（去掉 60 帧的上限，每张多读 6 次帧率取平均）。
// 用法: MOBA_URL=http://localhost:5222/map.html node tools/bwalls_shots.mjs <输出目录> [额外网址参数] [名字过滤（逗号分隔，只截这几张）]
// 机位见下面的 SHOTS（我方、对方、水晶三张和 b-toon 一样，另加野区、口子、出生点、全景和墙的近景）。都加 nohud=1&hero=0&t=3。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [dir, extra = "", only = ""] = process.argv.slice(2);
export const SHOTS = [
  ["01_me", "cam=-20,2,36,50,0,-20"],
  ["02_foe", "cam=22,-2,36,50,0,0"],
  ["03_core_me", "cam=-90.3,0,48,58,4"],
  ["04_jungle_me", "cam=-32,-30,36,52,0,180"],
  ["05_jungle_foe", "cam=32,30,36,52,0,0"],
  ["06_gate_me", "cam=-69,0,48,50,0,135"],
  ["07_spawn_me", "cam=-97,0,44,50,2,45"],
  ["08_wide", "cam=-40,10,80,55"],
  ["09_wall_me_close", "cam=-13.5,13,15,46,1,0"],
  ["10_wall_foe_close", "cam=13.5,13,15,46,1,0"],
  ["11_buff_me_close", "cam=-32,30,20,50,1,0"],
  ["12_buff_foe_close", "cam=32,30,20,50,1,0"],
  ["13_rampart_me_close", "cam=-64,14,18,46,2,135"],
  ["14_gate_steps_me", "cam=-64,0,17,46,1.5,135"],
  ["15_edge_me_close", "cam=-40,60,20,48,2,0"],
  ["16_edge_foe_close", "cam=40,60,20,48,2,0"],
  ["17_trees_me", "cam=-46,66,34,50,2,0"],
  ["18_trees_foe", "cam=46,66,34,50,2,0"],
  ["19_rampart_foe_close", "cam=64,14,18,46,2,-45"],
  ["20_wide_foe", "cam=40,-10,80,55"],
  ["21_trees_west_me", "cam=-46,-62,30,50,2,0"],
  ["22_trees_north_foe", "cam=60,-46,30,50,2,0"],
  ["23_island_boss", "cam=0,-46,26,52,1,0"],
];
const want = only ? new Set(only.split(",")) : null;
fs.mkdirSync(dir, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5222/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080", ...(process.env.MOBA_UNCAP ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : [])] });
const log = [];
try {
  for (const [name, q] of SHOTS) {
    if (want && !want.has(name)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
      const errors = []; page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); }); page.on("pageerror", e => errors.push("[pageerror] " + String(e).slice(0, 300)));
      try {
        await page.goto(base + "?" + q + "&nohud=1&hero=0&t=3" + (extra ? "&" + extra : ""), { waitUntil: "load", timeout: 60000 });
        await page.waitForFunction("window.__ready === true", { timeout: 120000 });
        await new Promise(r => setTimeout(r, 2200));
        const out = `${dir}/${name}.jpg`; await page.screenshot({ path: out, type: "jpeg", quality: 90 });
        const st = await page.evaluate(() => ({ ...(window.__stats ?? {}) }));
        if (process.env.MOBA_UNCAP) { const f = []; for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 700)); f.push(await page.evaluate("__stats.fps")); } st.fps = f.reduce((a, b) => a + b, 0) / f.length; st.fpsMin = Math.min(...f); }
        const bad = errors.some(e => /VALIDATE_STATUS|Shader Error/.test(e));
        log.push({ name, q, fps: Math.round(st.fps), fpsMin: st.fpsMin === undefined ? undefined : Math.round(st.fpsMin), calls: st.calls, tris: st.tris, errors: errors.slice(0, 4) }); console.log(name, JSON.stringify(log[log.length - 1]));
        await page.close(); if (!bad) break;
      } catch (e) { console.log(name, "重试", String(e).slice(0, 200)); await page.close().catch(() => {}); }
    }
  }
} finally { await browser.close(); }
fs.writeFileSync(`${dir}/shots.json`, JSON.stringify(log, null, 1));
