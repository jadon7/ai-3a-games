#!/usr/bin/env node
// 伊缇特效在真实对局里的录像（iti-fx3 第二步；做法照 kaz_clip.mjs：把页面里的 performance.now 换成脚本推的钟，每推 1/fps 秒画一帧、截一张）。
// 和 kaz_clip 的区别：
//   · 测试场（arena=1）和正常的 5v5 对局都能录——网址参数自己给；
//   · 录出来的是真实时间（顿帧、屏幕级的演出都按真实时间走，钟是按真实时间推的）；slow=4 就每帧只推 1/120 秒、仍按 30 帧拼，得到慢放 4 倍的一条；
//   · 每帧记一下对局时间和屏幕演出开着哪几样（stats.json），连续帧拼图用。
// 用法: MOBA_URL=http://localhost:5254/map.html node tools/iti_fx_clip.mjs <输出目录> '<任务 JSON 数组>' "<网址参数>" [宽=1600] [高=900]
//   任务: {"name":"combo","pre":"…开录前执行（摆位置、设等级）…","wait":1.2,"js":"…第 0 帧执行（放技能）…","dur":5,"slow":1,"keep":true,
//          "probe":"…每帧算一个数记进 stats.json（比如镜头抖了多少）…","post":"…录完执行、结果打印出来（比如打中了几个人）…"}
//   页面里现成的: __W(u,v) 路向坐标换世界坐标；__me 自己的控制器；__dummy 测试场的假人；
//                __chain([[键, 目标函数], …]) 一个接一个放（前一个放完、这个能放了就放）
// 输出: <目录>/<name>.mp4、<目录>/<name>/f_0000.jpg…（keep 才留）、<目录>/<name>/stats.json
// 现成的任务（docs/hero_iti/fx3/game/ 里的证据就是用它们录的）：
//   测试场每个技能和连招： node tools/iti_fx_clip.mjs <目录> tools/iti_fx_jobs/arena.json "arena=1&h=iti&nohud=1"   （手机档在参数后面加 &q=lite）
//   5v5 团战（慢放 4 倍）： node tools/iti_fx_clip.mjs <目录> tools/iti_fx_jobs/team.json "h=iti&seed=3"
//     团战每次打出来不一样，真实时间的那一条从慢放的每四帧取一帧： ffmpeg -i 团战_5v5_慢放4倍.mp4 -vf "select='not(mod(n\,4))',setpts=N/30/TB" -r 30 团战_5v5.mp4
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [out, jobsJson, query = "arena=1&h=iti&nohud=1", w = "1600", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson.trim().startsWith("[") ? jobsJson : fs.readFileSync(jobsJson, "utf8"));      // 任务可以直接写 JSON，也可以给一个 .json 文件（任务里引号多，写文件省得在命令行里转义）
for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let bad = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { const real = performance.now.bind(performance); window.__vt = null; performance.now = () => (window.__vt ?? real()); window.__real = real; });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 400))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 400)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
    await page.goto(`${process.env.MOBA_URL || "http://localhost:5254/map.html"}?${query}`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__sim && window.__actors", { timeout: 180000 });
    await page.evaluate(`window.__W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; window.__me=__actors.get(__sim.hero.id); window.__dummy=window.__arena?.dummy;
      window.__chain=(list)=>{let i=0;__api.run(12,()=>{if(i>=list.length)return;const [k,f]=list[i];if(__me.canCast(k)){const t=f();__me.cast(k,{x:t.x,z:t.z},__me.skill(k).target?t:null);i++;}});};
      const sel=document.querySelector('select'); if (sel) sel.parentElement.style.display='none'; 1`);
    await new Promise(r => setTimeout(r, 1500));
    if (bad) throw new Error("显卡被抢");
    for (const j of jobs) {
      const slow = j.slow ?? 1, fps = 30 * slow, dir = `${out}/${j.name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(`(async()=>{ window.__vt=null; ${j.pre ?? ""}; return 1; })()`);
      await new Promise(r => setTimeout(r, (j.wait ?? 1.2) * 1000));
      await page.evaluate(`window.__vt = window.__real(); 1`);
      const step = async () => page.evaluate(`new Promise(r => { window.__vt += ${1000 / fps}; requestAnimationFrame(() => requestAnimationFrame(() => r({ wt: +__sim.time.toFixed(3), on: __fx.screen ? __fx.screen.stats().on : "", z: __fx.screen ? +__fx.screen.zoomK().toFixed(3) : 1${j.probe ? `, p: (${j.probe})` : ""} }))); })`);
      await step();
      const pre = Math.round((j.lead ?? 0.3) * fps), frames = []; let fi = 0;
      const snap = async (s, t) => { await page.screenshot({ path: `${dir}/f_${String(fi).padStart(4, "0")}.jpg`, type: "jpeg", quality: 90 }); frames.push({ t: +t.toFixed(4), ...s }); fi++; };
      for (let i = 0; i < pre; i++) await snap(await step(), -(j.lead ?? 0.3) + (i + 1) / fps);
      if (j.js) await page.evaluate(`(()=>{ ${j.js}; return 1; })()`);
      const n = Math.round((j.dur ?? 3) * fps);
      for (let i = 0; i < n; i++) await snap(await step(), (i + 1) / fps);
      await page.evaluate(`window.__vt = null; 1`);
      if (j.post) console.log("结果", j.name, JSON.stringify(await page.evaluate(`(()=>{ return (${j.post}); })()`)));
      fs.writeFileSync(`${dir}/stats.json`, JSON.stringify({ name: j.name, slow, dur: j.dur, frames }, null, 1));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "30", "-i", `${dir}/f_%04d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-movflags", "+faststart", `${out}/${j.name}.mp4`], { env: { ...process.env, DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ?? "/opt/homebrew/Cellar/x265/4.2/lib" } });
      if (!j.keep) for (const f of fs.readdirSync(dir)) if (/^f_\d+\.jpg$/.test(f)) fs.unlinkSync(`${dir}/${f}`);
      console.log("录好", j.name, fi, "帧", slow > 1 ? `（慢放 ${slow} 倍）` : "", "屏幕演出用到：", [...new Set(frames.flatMap(f => (f.on || "").split(" ").filter(Boolean)))].join(" "));
    }
    console.log(JSON.stringify({ errors: errors.slice(0, 8) }));
  } catch (e) { console.log("出错", String(e).slice(0, 400)); bad = true; }
  finally { await browser.close(); }
  if (!bad) break; console.log("重试", attempt + 1);
}
