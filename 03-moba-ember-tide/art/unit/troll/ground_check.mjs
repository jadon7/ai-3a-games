#!/usr/bin/env node
// 在查看页里量“网格到底有没有陷进地里、飘起来”，和走路时落地脚往后蹬的速度（runSpeed 该填的数）。
// 做法：模型按游戏里的身高放（默认 6 米），每段动作逐帧（每秒 30 帧）取样；每个取样时刻把蒙皮算一遍，拿到每个顶点的世界坐标，
//   按顶点主要跟哪根骨骼分成 左脚、右脚、左小腿（含膝）、右小腿、左手、右手、其余，记各部分最低的顶点离地多高（地面是 y=0，负数就是陷进去了）。
//   走路：每个时刻较低的那只脚算落地脚，脚底贴着地（最低点离地 3 厘米以内）的时候量它脚掌骨骼在世界里的水平速度（动作是原地走，所以这就是“脚往后蹬”的速度）。
// 用法: node art/unit/troll/ground_check.mjs [身高=6] [动作,动作…=全部] [模型地址=/assets/unit/troll.glb] [把逐帧的曲线存到这个 JSON（给 lift.py 用）]
// 打印一份摘要：每段动作各部分的最低高度（米）和出现的时刻；run 另有落地脚速度。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [height = "6", only = "idle,run,attack1,attack2,roar,death", url = "/assets/unit/troll.glb", save = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--window-size=400,400"] });
const page = await browser.newPage(); await page.setViewport({ width: 400, height: 400 });
await page.goto(`http://localhost:5183/viewer.html?model=${url}&height=${height}&ui=0&t=0`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", { timeout: 60000 });
const res = await page.evaluate(async (only) => {
  const model = window.__model; let sm = null; model.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  const pos = sm.geometry.getAttribute("position"), si = sm.geometry.getAttribute("skinIndex"), sw = sm.geometry.getAttribute("skinWeight"), bones = sm.skeleton.bones.map(b => b.name.replace(/^mixamorig:?/, ""));
  const G = ["左脚", "右脚", "左小腿", "右小腿", "左手", "右手", "其余"], gid = nm => /^Left(Foot|Toe)/.test(nm) ? 0 : /^Right(Foot|Toe)/.test(nm) ? 1 : nm === "LeftLeg" ? 2 : nm === "RightLeg" ? 3 : /^LeftHand/.test(nm) ? 4 : /^RightHand/.test(nm) ? 5 : 6;
  const grp = new Int8Array(pos.count);
  for (let i = 0; i < pos.count; i++) { let bj = 0, bw = -1; for (let j = 0; j < 4; j++) { const w = sw.getComponent(i, j); if (w > bw) { bw = w; bj = j; } } grp[i] = gid(bones[si.getComponent(i, bj)]); }
  const v = new sm.position.constructor(), frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const bone = nm => sm.skeleton.bones[bones.indexOf(nm)], wp = b => { const p = b.getWorldPosition(new sm.position.constructor()); return [p.x, p.y, p.z]; };
  const clips = Object.fromEntries(window.__stats.clips), out = { 顶点数: pos.count, 静止时模型高: +(Number(new URLSearchParams(location.search).get("height")) / model.scale.x).toFixed(4) }, curves = {};
  for (const a of only.split(",")) {
    if (!(a in clips)) continue; const dur = clips[a], n = Math.round(dur * 30) + 1, rows = [], feet = [];
    for (let k = 0; k < n; k++) {
      const t = Math.min(k / 30, dur); window.__pose(a, t); await frame();
      const mn = new Array(7).fill(1e9);
      for (let i = 0; i < pos.count; i++) { sm.getVertexPosition(i, v); v.applyMatrix4(sm.matrixWorld); if (v.y < mn[grp[i]]) mn[grp[i]] = v.y; }
      rows.push({ t, mn }); feet.push({ L: wp(bone("LeftToeBase")), R: wp(bone("RightToeBase")), mnL: mn[0], mnR: mn[1] });
    }
    const o = { 时长: dur }; G.forEach((g, j) => { let best = rows[0]; for (const r of rows) if (r.mn[j] < best.mn[j]) best = r; o[g] = `${best.mn[j].toFixed(3)} @${best.t.toFixed(2)}s`; });
    const low = rows.map(r => Math.min(...r.mn)); o.全身最低 = `${Math.min(...low).toFixed(3)}，陷地超过 5 厘米的帧 ${low.filter(x => x < -0.05).length}/${n}，全身离地超过 5 厘米的帧 ${low.filter(x => x > 0.05).length}/${n}`;
    if (a === "run") {
      const sp = [];
      for (let k = 0; k + 1 < feet.length; k++) { const a0 = feet[k], a1 = feet[k + 1], s = a0.mnL < a0.mnR ? "L" : "R";
        if ((a1.mnL < a1.mnR ? "L" : "R") !== s || Math.min(a0.mnL, a0.mnR) > 0.03 || Math.min(a1.mnL, a1.mnR) > 0.03) continue;
        sp.push(Math.hypot(a1[s][0] - a0[s][0], a1[s][2] - a0[s][2]) * 30); }
      sp.sort((p, q) => p - q); if (sp.length) o.落地脚后蹬速度 = `取样 ${sp.length}：中位 ${sp[sp.length >> 1].toFixed(2)}，平均 ${(sp.reduce((s, x) => s + x, 0) / sp.length).toFixed(2)}，四分位 ${sp[sp.length >> 2].toFixed(2)}~${sp[(sp.length * 3) >> 2].toFixed(2)} 米/秒`;
    }
    out[a] = o; curves[a] = { fps: 30, feet: rows.map(r => +Math.min(r.mn[0], r.mn[1], r.mn[2], r.mn[3]).toFixed(4)), all: low.map(x => +x.toFixed(4)), groups: Object.fromEntries(G.map((g, j) => [g, rows.map(r => +r.mn[j].toFixed(4))])) };
  }
  return { out, curves };
}, only);
console.log(JSON.stringify(res.out, null, 1));
if (save) { fs.writeFileSync(save, JSON.stringify({ height: +height, clips: res.curves })); console.log("曲线存到", save); }
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); process.exit(0);
