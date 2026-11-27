// 测试场里各个靶子的位置（世界坐标和路向坐标），定机位用
import puppeteer from "puppeteer-core";
const hero = process.argv[2] || "moko";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5190/map.html") + `?arena=1&h=${hero}&nohud=1`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
  await new Promise(r => setTimeout(r, 1500));
  console.log(await page.evaluate(`(()=>{ const L=(e)=>e?{x:+e.x.toFixed(2),z:+e.z.toFixed(2),u:+((e.x-e.z)/Math.SQRT2).toFixed(2),v:+((e.x+e.z)/Math.SQRT2).toFixed(2)}:null; return JSON.stringify({hero:L(__sim.hero), dummy:L(__arena.dummy), friend:L(__arena.friend), foes:__arena.foes.map(L), pals:__arena.pals.map(L), h: __actors.get(__sim.hero.id).kit.height}); })()`));
} finally { await browser.close(); }
