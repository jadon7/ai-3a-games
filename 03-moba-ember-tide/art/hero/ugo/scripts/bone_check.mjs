// 测试场里查乌戈模型的骨骼名能不能按时间表里的写法找到（points.hand 写 "Head" 还是 "mixamorig:Head"），以及灯球被当成“武器尖”的位置。
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--window-size=800,600"] });
try {
  const page = await browser.newPage(); await page.goto((process.env.MOBA_URL || "http://localhost:5190/map.html") + "?arena=1&h=vero&glb=ugo&look=height:3.1,ring:1.0", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  console.log(await page.evaluate(`(() => { const h = __play.actor.hero, T = h.bone("Head"), V = T && T.getWorldPosition(new T.position.constructor()), a = new T.position.constructor(), b = new T.position.constructor(), ok = h.blade("R", a, b);
    return JSON.stringify({ Head: !!h.bone("Head"), mixamoHead: !!h.bone("mixamorig:Head"), headY: V && +V.y.toFixed(2), bladeR: ok, lampTip: ok ? [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)] : null, pos: [+__play.actor.pos.x.toFixed(2), +__play.actor.pos.z.toFixed(2)], meta: __play.actor.meta.points, runSpeed: __play.actor.meta.runSpeed }); })()`));
} finally { await browser.close(); }
