#!/usr/bin/env node
// 换画风 B · b-build：一个无界面 Chrome 连着截建筑的一串机位（塔六座、水晶两座、出生点两处、两边基地的全景），顺便记每张的帧率和绘制调用。
// 改前在主目录 5190 截，改后在 5224 截，同名的两张就是同一个机位。量帧率时加 MOBA_UNCAP=1（去掉 60 帧的上限，每张多读 6 次取平均）。
// 用法: MOBA_URL=http://localhost:5224/map.html node tools/bbuild_shots.mjs <输出目录> [额外网址参数] [名字过滤（逗号分隔，只截这几张）]
// 都加 nohud=1&hero=0&t=3。cam 是 路向u,v,距离,俯角,看向的高度,转角（转角 0 = 镜头在南边，和游戏里一样）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [dir, extra = "", only = ""] = process.argv.slice(2);
export const SHOTS = [
  ["t_me1", "cam=-22,0,17,38,3.6,-20"],        // 中路外塔（我方）近景
  ["t_me2", "cam=-45,0,21,38,4.6,-20"],
  ["t_me3", "cam=-73.3,0,25,38,5.6,-20"],
  ["t_foe1", "cam=22,0,17,38,3.6,20"],
  ["t_foe2", "cam=45,0,21,38,4.6,20"],
  ["t_foe3", "cam=73.3,0,25,38,5.6,20"],
  ["core_me", "cam=-90.3,0,34,40,6,-10"],
  ["core_foe", "cam=90.3,0,34,40,6,10"],
  ["spawn_me", "cam=-102.3,0,22,40,3,85"],     // 出生点从斜前方看（正前方被水晶挡住，偏开 50 度）
  ["spawn_foe", "cam=102.3,0,22,40,3,-95"],
  ["g_spawn_me", "cam=-100,0,27,56,0"],        // 出生点在游戏镜头里（转角 0）
  ["g_spawn_foe", "cam=100,0,27,56,0"],
  ["g_me1", "cam=-22,0,27,56,0"],              // 游戏镜头（27 米、56 度）
  ["g_foe1", "cam=22,0,27,56,0"],
  ["g_me3", "cam=-77,17.9,27,56,0"],
  ["g_foe3", "cam=77,-17.9,27,56,0"],
  ["base_me", "cam=-88,0,52,54,0"],            // 基地全景
  ["base_foe", "cam=88,0,52,54,0"],
  ["wide_me", "cam=-40,0,90,56,0"],
  ["wide_foe", "cam=40,0,90,56,0"],
];
const want = only ? new Set(only.split(",")) : null;
fs.mkdirSync(dir, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5224/map.html", W = +(process.env.W || 1920), H = +(process.env.H || 1080);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`, ...(process.env.MOBA_UNCAP ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : [])] });
const log = [];
try {
  for (const [name, q] of SHOTS) {
    if (want && !want.has(name)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await browser.newPage(); await page.setViewport({ width: W, height: H });
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
{ const f = `${dir}/shots.json`; let old = []; try { old = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}      // 只截了其中几张时，和上次的记录合在一起（同名的换成这次的）
  fs.writeFileSync(f, JSON.stringify([...old.filter(o => !log.some(l => l.name === o.name)), ...log], null, 1)); }
