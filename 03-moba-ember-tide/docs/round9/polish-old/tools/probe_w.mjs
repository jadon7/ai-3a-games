import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errs = []; page.on("pageerror", e => errs.push(String(e))); page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  await page.goto("http://localhost:5217/map.html?arena=1&h=vero&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
  await new Promise(r => setTimeout(r, 1500));
  console.log(await page.evaluate(`(async()=>{ const a=__actors.get(__sim.hero.id); a.setCd("W",0); const n0=__fx.group.children.length; const r=a.cast("W",{x:a.pos.x+5,z:a.pos.z}); await new Promise(r=>setTimeout(r,250)); const kids=__fx.group.children.filter(c=>c.visible&&c.renderOrder===5.6).map(c=>({s:[c.scale.x.toFixed(2),c.scale.z.toFixed(2)], u: c.material.uniforms?.uAlpha?.value})); return JSON.stringify({r, n0, n1:__fx.group.children.length, kids}); })()`));
  console.log(errs.slice(0,5));
} finally { await browser.close(); }
