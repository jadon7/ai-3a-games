// 步态检查台（开发用）：在浏览器控制台里 `await import('/tools/gait_probe.js')`。
// 清场后留一个友军步兵，由 __M 手动驱动（世界速度、朝向、是否蹲），用来多角度截图和测量脚底打滑。
//   __M.vx / vz   世界速度（m/s）；__M.yaw 朝向；__M.crouch 0/1
//   await __tiles(n, 每格推进帧数, 'side' | 'front' | 'back' | 'q34')   在页面顶部拼出 n 格连拍
//   __slip(秒)    全掌踩实阶段脚踝的世界水平速度（应接近 0）、踝高范围、骨盆高度范围
const d = window.__dbg, g = d.game;
document.querySelectorAll('#hud').forEach((e) => { e.style.display = 'none'; });
window.__errs = window.__errs || []; window.addEventListener('error', (e) => window.__errs.push(e.message));
{ const ce = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ').slice(0, 200)); ce.apply(console, a); }; }
d.auto(); g.player.invuln = 1e9; d.cam(-60, 0.1, 70, 0, 0);
d.engine.render = () => {}; try { d.step(60 * 14, 1 / 60, 0); } finally { delete d.engine.render; }
g.dir.want = [0, 0]; g.dir.pod = [1e9, 1e9]; g.dir.pilotCD = [1e9, 1e9]; g.dir.droneCD = 1e9; g.dir.sniperCD = 1e9; g.dir.mechAt = [];
for (const a of g.actors.slice()) if (a.alive && (a.team === 1 || a.kind !== 'grunt')) a.takeDamage(99999, null, {});
const fr = g.actors.filter((a) => a.alive && a.kind === 'grunt' && a.team === 0);
const A = window.__A = fr[0]; for (const a of fr.slice(1)) { a.pos.set(-60, 0, 60); a.update = () => true; }
const M = window.__M = { vx: 0, vz: -4.3, yaw: 0, crouch: 0, x0: 0, z0: 40 };
A.pos.set(M.x0, 0, M.z0);
A.update = function (dt) {
  this.pos.x += M.vx * dt; this.pos.z += M.vz * dt;
  if (this.pos.z < 20 || this.pos.z > 58 || Math.abs(this.pos.x - M.x0) > 5) { this.pos.x = M.x0; this.pos.z = M.vz < -0.1 ? 56 : M.vz > 0.1 ? 22 : 40; if (this.gait) this.gait.t = -1; }
  this.pos.y = g.nav.heightSmooth(this.pos.x, this.pos.z); this.yaw = M.yaw; this.moveSp = Math.hypot(M.vx, M.vz); this.target = null;
  this.crouchW += (M.crouch - this.crouchW) * Math.min(1, dt * 8); this.animT += dt * 3;
  this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw; this.pose(this.moveSp / 4.3, dt); return true;
};
const adv = (n) => { d.view = null; d.engine.render = () => {}; try { d.step(n, 1 / 60, 0); } finally { delete d.engine.render; } };
window.__set = (vx, vz, yaw = 0, crouch = 0, settle = 90) => { M.vx = vx; M.vz = vz; M.yaw = yaw; M.crouch = crouch; adv(settle); return A.gait ? { sp: +A.gait.sp.toFixed(2), amp: +A.gait.amp.toFixed(2) } : null; };
window.__tiles = async (n, stepF, side, dist = 3.3, fov = 35, yLook = 0.95) => {
  let cv = document.getElementById('__st'); if (!cv) { cv = document.createElement('canvas'); cv.id = '__st'; document.body.appendChild(cv); }
  const tw = 200, th = 560; cv.width = n * tw * 2; cv.height = th * 2; cv.style.cssText = `position:fixed;left:0;top:0;width:${n * tw}px;height:${th}px;z-index:99999;background:#222`;
  const c2 = cv.getContext('2d'); const gl = d.engine.renderer.domElement; const info = [];
  for (let i = 0; i < n; i++) {
    adv(stepF); const a = A; const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw); const rx = -fz, rz = fx; let px, pz;
    if (side === 'side') { px = a.pos.x + rx * dist; pz = a.pos.z + rz * dist; } else if (side === 'front') { px = a.pos.x + fx * dist; pz = a.pos.z + fz * dist; }
    else if (side === 'back') { px = a.pos.x - fx * dist; pz = a.pos.z - fz * dist; } else { px = a.pos.x + (rx + fx) * dist * 0.72; pz = a.pos.z + (rz + fz) * dist * 0.72; }
    d.view = { pos: [px, a.pos.y + 1.0, pz], look: [a.pos.x, a.pos.y + yLook, a.pos.z], fov }; d.draw(1);
    const sw = gl.height * (tw / th); c2.drawImage(gl, (gl.width - sw) / 2, 0, sw, gl.height, i * tw * 2, 0, tw * 2, th * 2); info.push(+(a.gait ? a.gait.ph : 0).toFixed(2));
  }
  await new Promise((r) => setTimeout(r, 1400)); return info;
};
window.__slip = (sec) => {
  const b = A.bones; const V = A.pos.constructor; const p = [new V(), new V()], q = [new V(), new V()];
  let max = 0, sum = 0, n = 0, maxLift = 0, minY = 9, maxHip = 0, minHip = 9, maxKnee = 0;
  d.view = null; d.engine.render = () => {};
  try {
    for (let i = 0; i < sec * 60; i++) {
      d.step(1, 1 / 60, 0); A.mesh.updateMatrixWorld(true); const G = A.gait; const F = G.foot;
      for (let k = 0; k < 2; k++) {
        q[k].setFromMatrixPosition(b[12 + k].matrixWorld);
        if (i > 30) {
          const sp = Math.hypot(q[k].x - p[k].x, q[k].z - p[k].z) * 60; const yy = q[k].y - A.pos.y; maxLift = Math.max(maxLift, yy); minY = Math.min(minY, yy);
          if (F[k].w >= 0.999 && Math.abs(F[k].p) < 0.02) { max = Math.max(max, sp); sum += sp; n++; }   // 全掌踩实：既不是脚跟着地也不是蹬地
        }
        p[k].copy(q[k]);
      }
      const hy = b[0].position.y; maxHip = Math.max(maxHip, hy); minHip = Math.min(minHip, hy);
      maxKnee = Math.max(maxKnee, 2 * Math.acos(Math.min(1, Math.abs(b[8].quaternion.w))), 2 * Math.acos(Math.min(1, Math.abs(b[10].quaternion.w))));
    }
  } finally { delete d.engine.render; }
  return { flatN: n, flatSlipMax: +max.toFixed(2), flatSlipAvg: +(sum / Math.max(1, n)).toFixed(2), ankleY: [+minY.toFixed(3), +maxLift.toFixed(3)], hipY: [+minHip.toFixed(3), +maxHip.toFixed(3)], kneeMaxDeg: Math.round(maxKnee * 57.3), gait: { sp: +A.gait.sp.toFixed(2), amp: +A.gait.amp.toFixed(2) } };
};
