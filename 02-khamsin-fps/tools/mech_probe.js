// 机甲检查台（开发用）：在浏览器控制台里 `await import('/tools/mech_probe.js')`。
// 开一局、清场、空降一台玩家机甲，然后可以手动驱动、从各个机位截图、测量支撑脚打滑。
//   __mk.start({ clear })      开局并空降玩家机甲（clear = 清掉敌人并停掉刷兵）
//   __mk.enemy(dx, dz)         在玩家机甲前方放一台敌方机甲
//   __mk.embark() / keys({ KeyW: 1, Mouse0: 1 }) / adv(帧数)     登机、按住按键、推进
//   __mk.tp('q34' | 'front' | 'side' | 'back', 距离, fov, 目标机甲)   第三人称机位（会临时隐藏座舱内饰、显示座舱盖）
//   __mk.fp()                  回到第一人称并渲染一帧
//   __mk.slip(秒)              支撑脚（已落地的脚）在世界里的水平移动速度（应为 0）、步频、任意脚的最大速度（查瞬移）、骨盆高度范围
//   await __mk.tiles(n, 每格帧数, 机位)   在页面顶部拼出 n 格连拍
const d = window.__dbg, g = d.game;
window.__errs = window.__errs || []; window.addEventListener('error', (e) => window.__errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
{ const ce = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ').slice(0, 240)); ce.apply(console, a); }; }
const quiet = (fn) => { d.engine.render = () => {}; try { return fn(); } finally { delete d.engine.render; } };
const K = window.__mk = {
  adv(n, dt = 1 / 60) { d.view = null; quiet(() => d.step(n, dt, 0)); },
  clear() {
    g.dir.want = [0, 0]; g.dir.pod = [1e9, 1e9]; g.dir.pilotCD = [1e9, 1e9]; g.dir.droneCD = 1e9; g.dir.sniperCD = 1e9; g.dir.mechAt = [];
    for (const a of g.actors.slice()) if (a.alive && a.team === 1) a.takeDamage(99999, null, {});
  },
  start({ clear = true, x = 0, z = 40 } = {}) {
    document.querySelectorAll('#letter, #softHint').forEach((e) => { e.style.display = 'none'; });
    d.auto(); g.player.invuln = 1e9; this.adv(60 * 4); if (clear) this.clear();
    d.cam(x, g.nav.height(x, z), z, 0, -0.5); this.adv(2); g.mechCharge = 1; g.tryCallMech(); this.adv(60 * 4);
    const m = g.playerMech; return m ? { state: m.state, glb: !!m.model.glb, pos: m.pos.toArray().map((v) => +v.toFixed(1)) } : null;
  },
  async enemy(dx = 0, dz = -26) {
    const { Mech } = await import('/src/game/mech.js'); const pm = g.playerMech; const m = new Mech(g, 1, pm.pos.x + dx, pm.pos.z + dz, { yaw: Math.PI, delay: 0 }); g.mechs.push(m); this.adv(150); return m;
  },
  embark() { const m = g.playerMech; g.player.pos.copy(m.pos); g.player.yaw = m.legYaw; g.player.pitch = 0; g.embark(m); this.adv(1); },
  keys(o) { for (const k of Object.keys(o)) d.input.sim(k, !!o[k]); },
  tp(side = 'q34', dist = 13, fov = 40, m = g.playerMech, yLook = 3.1, yCam = 4.0) {
    const a = m.aimYaw; const fx = -Math.sin(a), fz = -Math.cos(a), rx = -fz, rz = fx; let px, pz;
    if (side === 'side') { px = rx; pz = rz; } else if (side === 'front') { px = fx; pz = fz; } else if (side === 'back') { px = -fx; pz = -fz; } else if (side === 'q34b') { px = -(rx + fx) * 0.72; pz = -(rz + fz) * 0.72; } else if (side === 'q34l') { px = (fx - rx) * 0.72; pz = (fz - rz) * 0.72; } else { px = (rx + fx) * 0.72; pz = (rz + fz) * 0.72; }
    d.view = { pos: [m.pos.x + px * dist, m.pos.y + yCam, m.pos.z + pz * dist], look: [m.pos.x, m.pos.y + yLook, m.pos.z], fov };
    const ck = d.hud.cockpit; const vis = ck && ck.g3 ? ck.g3.visible : false; if (ck && ck.g3) ck.g3.visible = false; const hv = m.model.hatch ? m.model.hatch.visible : true; if (m.model.hatch) m.model.hatch.visible = true;
    document.getElementById('hud').style.visibility = 'hidden'; d.draw(1); g.fx.update(1e-6); d.draw(2);   // 光束 / 曳光是朝相机的面片：换了机位要重新对一次方向
    if (ck && ck.g3) ck.g3.visible = vis; if (m.model.hatch) m.model.hatch.visible = hv;
  },
  // 相对机甲的任意机位：rel / look 为相对机甲位置的偏移
  shot(rel, look, fov = 42, m = g.playerMech) {
    const ck = d.hud.cockpit, pm = g.playerMech; d.view = { pos: [m.pos.x + rel[0], m.pos.y + rel[1], m.pos.z + rel[2]], look: [m.pos.x + look[0], m.pos.y + look[1], m.pos.z + look[2]], fov };
    const vis = ck && ck.g3 ? ck.g3.visible : false; if (ck && ck.g3) ck.g3.visible = false; const hv = pm && pm.model.hatch ? pm.model.hatch.visible : true; if (pm && pm.model.hatch) pm.model.hatch.visible = true;
    document.getElementById('hud').style.visibility = 'hidden'; d.draw(1); g.fx.update(1e-6); d.draw(2);
    if (ck && ck.g3) ck.g3.visible = vis; if (pm && pm.model.hatch) pm.model.hatch.visible = hv;
  },
  freeze() { const c = d.engine.camera, p = c.position, l = g.player.look; d.view = { pos: [p.x, p.y, p.z], look: [p.x + l.x, p.y + l.y, p.z + l.z], fov: c.fov }; d.draw(1); },   // 冻结在当前第一人称画面（截图用）
  fp(n = 1) { d.view = null; document.getElementById('hud').style.visibility = ''; d.step(n, 1 / 60, 0); },
  slip(sec, dt = 1 / 60) {
    const m = g.playerMech, G = m.gait; const P = [new m.pos.constructor(), new m.pos.constructor()], Q = [new m.pos.constructor(), new m.pos.constructor()];
    let max = 0, sum = 0, n = 0, steps = 0, minP = 9, maxP = 0, clampN = 0, vmax = 0; const was = [true, true];
    d.view = null;
    quiet(() => {
      for (let i = 0; i < sec / dt; i++) {
        d.step(1, dt, 0); m.model.root.updateMatrixWorld(true);
        for (let k = 0; k < 2; k++) {
          const f = G.foot[k]; m.model.legs[k].foot.getWorldPosition(Q[k]);   // 渲染出来的踝关节位置（IK 之后）
          if (i > 20 && f.planted && was[k] && f.t > dt * 1.5) { const sp = Math.hypot(Q[k].x - P[k].x, Q[k].z - P[k].z) / dt; max = Math.max(max, sp); sum += sp; n++; if (Math.hypot(Q[k].x - f.p.x, Q[k].z - f.p.z) > 0.01) clampN++; }
          if (i > 20) vmax = Math.max(vmax, Q[k].distanceTo(P[k]) / dt);   // 任意一只脚（含摆动脚）的最大速度：远大于机体速度的两三倍说明有瞬移
          if (f.planted && !was[k]) steps++;
          was[k] = f.planted; P[k].copy(Q[k]);
        }
        const py = m.model.pelvis.position.y; minP = Math.min(minP, py); maxP = Math.max(maxP, py);
      }
    });
    return { speed: +m.moveSp.toFixed(2), stanceSamples: n, slipMax: +max.toFixed(4), slipAvg: +(sum / Math.max(1, n)).toFixed(5), ikMiss: clampN, stepsPerSec: +(steps / sec).toFixed(2), footVmax: +vmax.toFixed(1), pelvisY: [+minP.toFixed(3), +maxP.toFixed(3)] };
  },
  async tiles(n, stepF, side = 'side', dist = 15, fov = 34) {
    let cv = document.getElementById('__st'); if (!cv) { cv = document.createElement('canvas'); cv.id = '__st'; document.body.appendChild(cv); }
    const tw = Math.floor(innerWidth / n), th = Math.round(tw * 1.5); cv.width = n * tw * 2; cv.height = th * 2; cv.style.cssText = `position:fixed;left:0;top:0;width:${n * tw}px;height:${th}px;z-index:99999;background:#222`;
    const c2 = cv.getContext('2d'); const gl = d.engine.renderer.domElement;
    for (let i = 0; i < n; i++) { this.adv(stepF); this.tp(side, dist, fov); const sw = gl.height * (tw / th); c2.drawImage(gl, (gl.width - sw) / 2, 0, sw, gl.height, i * tw * 2, 0, tw * 2, th * 2); }
    await new Promise((r) => setTimeout(r, 1400));
  },
  untile() { const cv = document.getElementById('__st'); if (cv) cv.remove(); },
};
