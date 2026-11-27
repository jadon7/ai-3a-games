// 测卡兹 q / r / w / e / attack1 动作里胸口的高度、前后位移和最低的骨骼离地多高（每 0.05 秒一行）。用法: MOBA_URL=... node tools/kaz_probe_anim.mjs [网址参数]
import puppeteer from "puppeteer-core";
const base = process.env.MOBA_URL, q = process.argv[2] || "arena=1&h=kaz&nohud=1";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=800,600"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 800, height: 600 });
  page.on("pageerror", e => console.log("ERR", String(e).slice(0, 200)));
  await page.goto(base + "?" + q, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  const r = await page.evaluate(`(() => { const a = __actors.get(__sim.hero.id), h = a.hero; __setSpeed(0); const out = {}; const names = []; h.model.traverse(o => { if (o.isBone) names.push(o.name); });
    const sp = h.model.getObjectByName("tripo::Spine_5") || h.bone("tripo::Spine_5"), hd = h.bone("tripo::Head_1"); const v = new (h.group.position.constructor)();
    out.bones = names.slice(0, 80); out.scale = h.model.scale.x; out.clips = [...h.clips.keys()].map(k => [k, +h.clips.get(k).duration.toFixed(2)]);
    for (const clip of ["q", "r", "w", "e", "attack1"]) { const c = h.clips.get(clip); if (!c) continue; const act = h.mixer.clipAction(c); h.mixer.stopAllAction(); act.reset(); act.play(); act.paused = false; const rows = [];
      for (let t = 0; t <= c.duration + 1e-6; t += 0.05) { act.time = t; h.mixer.update(0); h.group.updateMatrixWorld(true);
        let lo = 1e9; h.model.traverse(o => { if (o.isBone) { o.getWorldPosition(v); lo = Math.min(lo, v.y); } });
        sp.getWorldPosition(v); const cy = v.y - h.group.position.y, cz = (v.x - h.group.position.x) * Math.sin(h.group.rotation.y) + (v.z - h.group.position.z) * Math.cos(h.group.rotation.y);
        rows.push([+t.toFixed(2), +cy.toFixed(2), +cz.toFixed(2), +(lo - h.group.position.y).toFixed(2)]); }
      out[clip] = rows; }
    return out; })()`);
  console.log(JSON.stringify(r));
} finally { await browser.close(); }
