// 用法: node tools/ui2_size.mjs <输出目录> [只截这几个英雄,逗号分开]
// 第九轮 ui2：每个英雄和一排小兵站在一起截一张（游戏里的镜头，测试场），看英雄是不是明显比小兵大。
// 英雄站中间、脸朝镜头偏右；右边一排对面的小兵（三近战两远程），左边两个己方近战兵。截完按英雄的位置裁一块。
// 新的四个英雄（卡兹、乌戈、塞伦、赫达）还没有技能代码，借一个老英雄的技能、用 glb= 换模型、look=height: 指定身高；身高从环境变量 H_<id> 读（不给就用模型任务定的起点）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, only = ""] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5215/map.html", want = new Set(only.split(",").filter(Boolean)), sleep = ms => new Promise(r => setTimeout(r, ms));
const H = (id, d) => process.env["H_" + id] || d;
const LIST = [
  ["torg", "h=torg"], ["gorran", "h=gorran"], ["lan", "h=lan"], ["kaz", `h=osen&glb=kaz&look=height:${H("kaz", 2.4)},ring:1.6,bar:0.3`],
  ["ugo", `h=vero&glb=ugo&look=height:${H("ugo", 3.1)}`], ["osen", "h=osen"], ["seren", `h=vero&glb=seren&look=height:${H("seren", 3.1)}`], ["vero", "h=vero"],
  ["moko", "h=moko"], ["hedda", `h=gorran&glb=hedda&look=height:${H("hedda", 3.2)}`],
];
const STAGE = `(() => { const A = __arena, me = __sim.hero, P = [me.x, me.z];
  for (const a of __actors.values()) if (a.ent !== me) a.teleport(P[0] + 40, P[1] + 40);
  A.foes.forEach((e, i) => { e.x = P[0] + 2.2 + i * 1.2; e.z = P[1] + 0.6; e.yaw = -0.35; e.hp = e.max; });
  A.pals.forEach((e, i) => { e.x = P[0] - 2.2 - i * 1.2; e.z = P[1] + 0.6; e.yaw = 0.35; e.hp = e.max; });
  __play.actor.face(P[0] + 1.2, P[1] + 3, true); return __screen(P[0], P[1], 0); })()`;
for (const [id, q] of LIST) {
  if (want.size && !want.has(id)) continue;
  for (let tryN = 0; tryN < 3; tryN++) {
    const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
      args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
    const errors = []; let ok = true;
    try {
      const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
      page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
      await page.goto(base + "?arena=1&nohud=1&" + q, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true && !!window.__arena", { timeout: 180000 }); await sleep(2500);
      await page.evaluate(STAGE); await sleep(1200); await page.evaluate("__setSpeed(0)"); const p = await page.evaluate(STAGE); await sleep(1500);
      const x = Math.max(0, Math.min(1920 - 1000, p[0] - 500)), y = Math.max(0, Math.min(1080 - 560, p[1] - 400));
      await page.screenshot({ path: `${out}/${id}.jpg`, type: "jpeg", quality: 92, clip: { x, y, width: 1000, height: 560 } });
      if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { ok = false; console.log(id, "着色器没编过，重来"); } else console.log(id, "好了", errors.slice(0, 2));
    } catch (e) { console.log(id, "出错", String(e).slice(0, 200)); ok = false; } finally { await browser.close(); }
    if (ok) break;
  }
}
