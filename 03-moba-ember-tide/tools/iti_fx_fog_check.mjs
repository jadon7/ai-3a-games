// 屏幕级演出只给看得见的那一次：对面的伊缇在迷雾里（画面内）放大招 → 我这边不该有任何屏幕演出、不顿帧、世界里的特效被迷雾藏住；走到看得见的地方放 → 有
// 用法: MOBA_URL=http://localhost:5254/map.html node tools/iti_fx_fog_check.mjs <输出目录>   （iti-fx3 第二步；截四张图，打印两种情况下开了哪些屏幕演出、对局时间和真实时间差多少）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const errors = [];
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", e => errors.push("[pageerror] " + String(e).slice(0, 300)));
  await page.goto(`${process.env.MOBA_URL || "http://localhost:5254/map.html"}?h=lan&pos=mid&a=gorran,kaz,lan,seren,hedda&b=torg,osen,iti,vero,ugo&nohud=1`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__actors", { timeout: 180000 });
  await new Promise(r => setTimeout(r, 3000));
  const info = await page.evaluate(`(()=>{ const sim=__sim, me=sim.hero; const A=[...__actors.values()]; const ei=A.find(a=>a.kit.id==="iti"&&a.ent.team!==me.team); window.__ei=ei; window.__mea=__actors.get(me.id);
    return { mine: me.h.kit, team: me.team, enemyIti: !!ei, lineup: sim.heroes().map(e=>e.h.kit+":"+e.team).join(" ") }; })()`);
  console.log(JSON.stringify(info));
  if (!info.enemyIti) throw new Error("对面没有伊缇");
  // 我站到河道口（地图正中偏我方一点），身边没有队友、小兵；电脑别动
  const setup = `const sim=__sim, me=sim.hero, ei=__ei, e=ei.ent; __setSpeed(1);
      for (const h of sim.heroes()) { h.h.level=12; sim.recalc(h); h.hp=h.max; h.h.mana=h.h.stat.mana; }
      const put=(a,x,z)=>{ const p=__nav.walkable(x,z)?[x,z]:__nav.nearest(x,z); a.teleport(p[0],p[1]); return p; };`;
  // far=true：镜头用方向键往右挪 22 米左右（不跟人了），对面的伊缇放到镜头正中——离我 20 米以上，在迷雾里、但在画面里
  const run = async (name, far) => {
    await page.keyboard.press("Space"); await page.evaluate(`(()=>{ ${setup} put(__mea, -4, -4); __mea.stop(); return 1; })()`);
    await new Promise(r => setTimeout(r, 800));
    if (far) { await page.keyboard.down("ArrowRight"); await new Promise(r => setTimeout(r, 1000)); await page.keyboard.up("ArrowRight"); await new Promise(r => setTimeout(r, 300)); }
    const before = await page.evaluate(`(()=>{ ${setup} const cr=__fx.screen.camRight(), d=${far ? 22 : 5}; const p=put(ei, me.x+cr.x*d, me.z+cr.z*d); ei.stop(); for (const k of ["Q","W","E","R"]) ei.setCd(k,0); ei.data.iti=undefined;
      window.__log=[]; window.__cast=ei.cast("R",{x:e.x,z:e.z},null); window.__t0=sim.time; window.__r0=performance.now(); window.__was=false; window.__rend=null; window.__iv=setInterval(()=>{ __log.push(__fx.screen.stats().on); const d=ei.data.iti, r=!!(d&&d.r); if (r) window.__was=true; if (window.__was && !r && !window.__rend) window.__rend={ 对局: +(sim.time-window.__t0).toFixed(2), 真实: +((performance.now()-window.__r0)/1000).toFixed(2) }; },8);
      return { 伊缇在画面里: __fx.screen.inView({x:e.x,y:1.2,z:e.z},0.1), 离我: +Math.hypot(e.x-me.x,e.z-me.z).toFixed(1), 镜头跟着我: __play.follow }; })()`);
    await new Promise(r => setTimeout(r, 900)); await page.screenshot({ path: `${out}/${name}_八刀中.jpg`, type: "jpeg", quality: 88 });
    await new Promise(r => setTimeout(r, 1000)); await page.screenshot({ path: `${out}/${name}_十字新月前后.jpg`, type: "jpeg", quality: 88 });
    await new Promise(r => setTimeout(r, 1300));
    const res = await page.evaluate(`(()=>{ clearInterval(__iv); const on=[...new Set(__log.flatMap(s=>s.split(" ").filter(Boolean)))].join(" "); return { 放出去了: __cast, 对局过了几秒: +(__sim.time-__t0).toFixed(2), 真实过了几秒: +((performance.now()-__r0)/1000).toFixed(2), 大招放完时: window.__rend, 屏幕演出: on || "（没有）" }; })()`);
    console.log(name, JSON.stringify(before), JSON.stringify(res));
  };
  await run("迷雾里_画面内", true);
  await run("看得见", false);
  console.log("errors", JSON.stringify(errors.slice(0, 8)));
} finally { await browser.close(); }
