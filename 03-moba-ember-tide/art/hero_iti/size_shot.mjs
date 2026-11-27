#!/usr/bin/env node
// 伊缇的个头图：测试场里玩家用岚的技能、换伊缇的模型（glb=iti），旁边站葛隆（测试场的己方假人）、岚（hero= 第二个人，一律载入 lan.glb）、两个小兵，停住截两张（游戏镜头 27 米、近一点 15 米）。
// 用法: MOBA_URL=http://localhost:5253/map.html node art/hero_iti/size_shot.mjs <输出前缀> [伊缇身高=3.3] [额外参数]
import puppeteer from "puppeteer-core";
const [out, h = "3.3", extra = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  for (const dist of [27, 15]) {
    const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
    // 第二个人（岚）站在伊缇右边 3 米；look 里的 height 两个人都吃，所以岚也是 3.3（和岚 kit 里的一样），scarf 只给伊缇（下面把岚身上的那条收掉）
    await page.goto((process.env.MOBA_URL || "http://localhost:5253/map.html") + `?arena=1&h=lan&glb=iti&look=height:${h},scarf:1&hero=-13,0,135;-11.4,1.4,135&nohud=1&dist=${dist}` + (extra ? "&" + extra : ""), { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 }); await new Promise(r => setTimeout(r, 1500));
    // 屏幕的“右”和“朝镜头”在地面上是哪个方向（用 __screen 反推），四个人沿屏幕横排、都朝着镜头：伊缇、右边岚、左边葛隆、最右两个小兵
    const r = await page.evaluate(`(() => { const me = __play.actor, A = __arena, p = me.pos, s0 = __screen(p.x, p.z, 0), sx = __screen(p.x + 1, p.z, 0), sz = __screen(p.x, p.z + 1, 0);
      const a = sx[0] - s0[0], b = sz[0] - s0[0], c = sx[1] - s0[1], d = sz[1] - s0[1], det = a * d - b * c;
      const R = [d / det, -c / det], D = [-b / det, a / det], nR = Math.hypot(...R), nD = Math.hypot(...D); R[0] /= nR; R[1] /= nR; D[0] /= nD; D[1] /= nD;      /* R：屏幕往右一米；D：屏幕往下（朝镜头）一米 */
      const at = k => [p.x + R[0] * k, p.z + R[1] * k], yaw = Math.atan2(D[0], D[1]);
      const look = a0 => { a0.stop(); a0.face?.(a0.pos.x + D[0] * 5, a0.pos.z + D[1] * 5, true); };
      look(me);
      const fr = __actors.get(A.friend.id), [gx, gz] = at(-3.6); fr.teleport(gx, gz); look(fr);
      A.pals.forEach((m, i) => { const [x, z] = at(6.2 + i * 1.6); m.x = x; m.z = z; m.yaw = yaw; });
      const mine = new Set([...__actors.values()].map(a0 => a0.hero.group)); let lan = null, n = 0;
      __scene.traverse(o => { if (o.name === "hero" && o.isGroup && !mine.has(o) && !lan) lan = o; if (o.name === "scarf" && o.parent && o.parent !== me.hero.group) { o.visible = false; n++; } });
      if (lan) { const [lx, lz] = at(3.2); lan.position.x = lx; lan.position.z = lz; lan.rotation.y = yaw; lan.scale.setScalar(3.3 / ${h}); }      /* 岚也吃了网址里的 height，缩回岚自己的 3.3 */
      return { friend: fr.kit.id, pals: A.pals.length, lan: !!lan, hiddenScarf: n, yaw: +yaw.toFixed(2) }; })()`);
    await new Promise(r => setTimeout(r, 1200)); await page.evaluate("__setSpeed(0.0001)"); await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: `${out}_d${dist}.jpg`, type: "jpeg", quality: 92 }); console.log(JSON.stringify({ dist, ...r }));
    await page.close();
  }
} finally { await browser.close(); }
