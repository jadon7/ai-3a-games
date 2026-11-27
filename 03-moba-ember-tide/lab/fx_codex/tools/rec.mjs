#!/usr/bin/env node
// 试验页录像：无界面 Chrome 打开试验页（录像模式 cap=1），时间由这里一帧一帧推（每帧 1/30 秒），每推一帧截一张，最后用 ffmpeg 合成 30 帧的 mp4。
// 录出来的是匀速的“真实时间”，和电脑快慢无关。
//
// 用法：node tools/rec.mjs <输出目录> <演示名> [网址参数] [秒数] [宽=1600] [高=900] [开头静止秒数=0.3]
//   例：node tools/rec.mjs out/r1/r_top r "cam=top" 2.0
//       node tools/rec.mjs out/r1/r_close r "cam=close&ground=foe" 2.0 1280 720
// 输出：<目录>/f_000.jpg …（每帧一张）、<目录>/clip.mp4、<目录>/stats.json（每帧的绘制次数等）
// 环境变量：LAB_URL（默认 http://localhost:5251/lab/fx_codex/index.html）、KEEP_FRAMES=0（合成后删掉逐帧，只留 mp4）
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [outDir, demo, query = "", secArg = "", w = "1600", h = "900", preArg = "0.3"] = process.argv.slice(2);
if (!outDir || !demo) { console.error("用法：node tools/rec.mjs <输出目录> <演示名> [网址参数] [秒数] [宽] [高] [开头静止秒数]"); process.exit(1); }
const base = process.env.LAB_URL || "http://localhost:5251/lab/fx_codex/index.html";
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));      // 只清本目录里上一次的逐帧

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--disable-background-networking", "--disable-crash-reporter", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
  page.on("pageerror", e => errors.push("[pageerror] " + String(e).slice(0, 400)));
  const url = `${base}?cap=1&nohud=1${query ? "&" + query : ""}`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__lab && window.__lab.ready === true", { timeout: 90000 });
  const dur = secArg ? +secArg : await page.evaluate(d => (window.__lab.demos[d]?.duration ?? 2) + 0.3, demo);
  const pre = +preArg, dt = 1 / 30, frames = [];
  await page.evaluate(d => window.__lab.stage(d), demo);
  // 先空跑几帧（让动作混合、着色器编译都过去）
  for (let i = 0; i < 6; i++) await page.evaluate(dt => window.__lab.step(dt), dt);
  let fi = 0;
  const snap = async () => { await page.screenshot({ path: path.join(outDir, `f_${String(fi).padStart(3, "0")}.jpg`), type: "jpeg", quality: 90 }); fi++; };
  for (let i = 0; i < Math.round(pre / dt); i++) { const s = await page.evaluate(dt => window.__lab.step(dt), dt); frames.push({ ...s, wt: s.t, t: +(-pre + (i + 1) * dt).toFixed(4) }); await snap(); }
  const ok = await page.evaluate(d => window.__lab.play(d), demo);
  if (!ok) throw new Error(`没有这段演示：${demo}`);
  for (let i = 0; i < Math.round(dur / dt); i++) { const s = await page.evaluate(dt => window.__lab.step(dt), dt); frames.push({ ...s, wt: s.t, t: +((i + 1) * dt).toFixed(4) }); await snap(); }
  fs.writeFileSync(path.join(outDir, "stats.json"), JSON.stringify({ url, demo, dur, pre, peakFxCalls: Math.max(...frames.map(f => f.fxCalls)), peakFxParticles: Math.max(...frames.map(f => f.fxParticles)), maxCalls: Math.max(...frames.map(f => f.calls)), errors: errors.slice(0, 20), frames }, null, 1));
  console.log(JSON.stringify({ outDir, frames: fi, peakFxCalls: Math.max(...frames.map(f => f.fxCalls)), peakFxParticles: Math.max(...frames.map(f => f.fxParticles)), maxCalls: Math.max(...frames.map(f => f.calls)), errors: errors.slice(0, 8) }));
} finally { await browser.close(); }

// 合成 mp4（30 帧，H.264，手机也能放）
const env = { ...process.env, DYLD_LIBRARY_PATH: "/opt/homebrew/Cellar/x265/4.2/lib" };
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", path.join(outDir, "f_%03d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", path.join(outDir, "clip.mp4")], { env, stdio: "inherit" });
if (r.status !== 0) console.error("ffmpeg 失败");
if (process.env.KEEP_FRAMES === "0") for (const f of fs.readdirSync(outDir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));
