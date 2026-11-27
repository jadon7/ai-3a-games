#!/usr/bin/env node
// 试验页录像：无界面 Chrome 打开试验页（录像模式 cap=1），时间由这里一帧一帧推（每帧 1/30 秒真实时间），每推一帧截一张，最后用 ffmpeg 合成 30 帧的 mp4。
// 录出来的是匀速的“真实时间”，和电脑快慢无关（顿帧、屏幕演出都按真实时间算进去了）。
//
// 用法：node tools/rec.mjs <输出目录> <演示名> [网址参数] [秒数] [宽=1600] [高=900] [开头静止秒数=0.3]
//   例：node tools/rec.mjs out/r_top r "cam=top" 4.6
// 输出：<目录>/f_000.jpg …（每帧一张）、<目录>/clip.mp4、<目录>/stats.json（每帧的绘制次数等）
// 环境变量：LAB_URL（默认 http://localhost:5255/lab/fx_iti/index.html）、KEEP_FRAMES=0（合成后删掉逐帧，只留 mp4）、SLOW=4（另出一条慢放 4 倍的 clip_slow.mp4：每帧推 1/120 秒）
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [outDir, demo, query = "", secArg = "", w = "1600", h = "900", preArg = "0.3"] = process.argv.slice(2);
if (!outDir || !demo) { console.error("用法：node tools/rec.mjs <输出目录> <演示名> [网址参数] [秒数] [宽] [高] [开头静止秒数]"); process.exit(1); }
const base = process.env.LAB_URL || "http://localhost:5255/lab/fx_iti/index.html";
const SLOW = +(process.env.SLOW || 1);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));      // 只清本目录里上一次的逐帧

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--disable-background-networking", "--disable-crash-reporter", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`],
});
const errors = [];
let fi = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
  page.on("pageerror", e => errors.push("[pageerror] " + String(e).slice(0, 600)));
  const url = `${base}?cap=1&nohud=1${query ? "&" + query : ""}`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__lab && window.__lab.ready === true", { timeout: 90000 });
  const dur = secArg ? +secArg : await page.evaluate(d => (window.__lab.demos[d]?.duration ?? 2) + 0.6, demo);
  const pre = +preArg, dt = 1 / 30 / SLOW, frames = [];
  await page.evaluate(d => window.__lab.stage(d), demo);
  for (let i = 0; i < 6; i++) await page.evaluate(dt => window.__lab.step(dt), 1 / 30);      // 先空跑几帧（动作混合、着色器编译都过去）
  const snap = async () => { await page.screenshot({ path: path.join(outDir, `f_${String(fi).padStart(4, "0")}.jpg`), type: "jpeg", quality: 90 }); fi++; };
  for (let i = 0; i < Math.round(pre * 30); i++) { const s = await page.evaluate(dt => window.__lab.step(dt), 1 / 30); frames.push({ t: +(-pre + (i + 1) / 30).toFixed(4), wt: s.t, calls: s.calls, fx: s.fx, particles: s.particles, passes: s.passes, on: s.on }); await snap(); }
  const ok = await page.evaluate(d => window.__lab.play(d), demo);
  if (!ok) throw new Error(`没有这段演示：${demo}`);
  for (let i = 0; i < Math.round(dur / dt); i++) { const s = await page.evaluate(dt => window.__lab.step(dt), dt); frames.push({ t: +((i + 1) * dt).toFixed(4), wt: s.t, calls: s.calls, fx: s.fx, particles: s.particles, passes: s.passes, on: s.on, kit: s.kit }); await snap(); }
  const pk = k => Math.max(...frames.map(f => f[k] ?? 0));
  const sum = { url, demo, dur, pre, slow: SLOW, peakFx: pk("fx"), peakParticles: pk("particles"), peakCalls: pk("calls"), peakPasses: pk("passes"), peakLines: Math.max(...frames.map(f => f.kit?.lines ?? 0)), peakStars: Math.max(...frames.map(f => f.kit?.stars ?? 0)), peakRings: Math.max(...frames.map(f => f.kit?.rings ?? 0)), peakGhosts: Math.max(...frames.map(f => f.kit?.ghosts ?? 0)), errors: errors.slice(0, 20) };
  fs.writeFileSync(path.join(outDir, "stats.json"), JSON.stringify({ ...sum, frames }, null, 1));
  console.log(JSON.stringify({ outDir, frames: fi, ...sum, url: undefined }));
} finally { await browser.close(); }

// 合成 mp4（30 帧，H.264，手机也能放）
const env = { ...process.env, DYLD_LIBRARY_PATH: "/opt/homebrew/Cellar/x265/4.2/lib" };
const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", path.join(outDir, "f_%04d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium", "-movflags", "+faststart", path.join(outDir, "clip.mp4")], { env, stdio: "inherit" });
if (r.status !== 0) console.error("ffmpeg 失败");
if (process.env.KEEP_FRAMES === "0") for (const f of fs.readdirSync(outDir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));
