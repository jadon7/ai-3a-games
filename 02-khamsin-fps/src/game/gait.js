// 程序化步态：相位按“实际走过的距离”推进，支撑脚锁在地面上不打滑；腿用两段反解（髋 → 膝 → 踝），
// 脚踝单独控制脚掌（脚跟着地 → 全掌 → 蹬地），骨盆随步伐起伏、侧移、旋转，上半身反向补偿让枪口保持稳定。
// 行进方向取身体局部速度：侧移、后退时脚朝实际移动方向迈，不再只会前后摆腿。
import * as THREE from 'three';

const L1 = 0.44, L2 = 0.41;          // 大腿、小腿长度（BONES：髋 0.94 → 膝 0.50 → 踝 0.09）
const ANKLE = 0.09;                  // 踝关节离地高度（脚掌平放时）
const HIP_X = 0.1, HIP_Y = -0.04;    // 髋关节相对骨盆骨骼的偏移
const TOE = 0.19, HEEL = 0.07;       // 踝到靴尖 / 靴跟的水平距离：脚跟着地时绕靴跟转，蹬地时绕靴尖转（脚踝随之前移、抬高）
const REACH = L1 + L2 - 0.012;       // 腿伸直时髋到踝的最大距离
const DOWN = new THREE.Vector3(0, -1, 0);
const _d = new THREE.Vector3(), _n = new THREE.Vector3(), _u = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();
const _qh = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _eu = new THREE.Euler();
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export function newGait() { return { ph: Math.random(), vx: 0, vz: 0, dx: 0, dz: -1, px: 0, pz: 0, yaw: 0, t: -1, yr: 0, amp: 0, sp: 0, yawP: 0, rollP: 0, lean: 0 }; }

// 两段反解：thigh / shin 是骨盆的子骨骼，(tx,ty,tz) 是踝关节在骨盆局部空间里的目标，hint 是膝盖朝向（骨盆局部）
function legIK(thigh, shin, tx, ty, tz, hint) {
  const d = _d.set(tx - thigh.position.x, ty - thigh.position.y, tz - thigh.position.z);
  const len = d.length(); const dist = Math.max(0.22, Math.min(len, L1 + L2 - 0.006)); const n = _n.copy(d).multiplyScalar(1 / Math.max(len, 1e-4));
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  const u = _u.copy(hint); u.addScaledVector(n, -u.dot(n)); if (u.lengthSq() < 1e-6) u.set(0, 0, -1); u.normalize();
  const e = _e.copy(n).multiplyScalar(Math.cos(al) * L1).addScaledVector(u, Math.sin(al) * L1);          // 膝盖相对髋
  thigh.quaternion.setFromUnitVectors(DOWN, _f.copy(e).normalize());
  const f = _f.copy(n).multiplyScalar(dist).sub(e).normalize().applyQuaternion(_qi.copy(thigh.quaternion).invert());
  shin.quaternion.setFromUnitVectors(DOWN, f);
}

/**
 * 摆好骨盆、双腿和双脚。
 * S：士兵（用到 pos / yaw / crouchW / game.nav / game.time，状态存在 S.gait 里）
 * b：骨骼数组（0 骨盆，7/8 左大腿 / 小腿，9/10 右，12/13 左 / 右脚；没有脚骨骼的旧模型也能用）
 * o.grounded：脚是否踩在地上（腾空 / 蹬墙时不贴合地面高度）
 * 返回步态状态（yawP / rollP / lean / amp / sp …），调用方据此给脊柱、头做反向补偿
 */
export function gaitPose(S, b, dt, o = {}) {
  const G = S.gait || (S.gait = newGait());
  const now = S.game.time; const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  // —— 实际水平速度（世界）→ 身体局部（x 右，z 后；前方是 -z）——
  let lx = 0, lz = 0, yr = 0;
  if (dt > 1e-4 && G.t >= 0 && now - G.t < 0.2) {
    const wvx = (S.pos.x - G.px) / dt, wvz = (S.pos.z - G.pz) / dt;
    if (wvx * wvx + wvz * wvz < 20 * 20) { lx = wvx * cy - wvz * sy; lz = wvx * sy + wvz * cy; }
    yr = angDiff(S.yaw, G.yaw) / dt;
  } else { G.vx = 0; G.vz = -(S.moveSp || 0); G.yr = 0; G.amp = (S.moveSp || 0) > 0.5 ? 1 : 0; lx = G.vx; lz = G.vz; }   // 刚出现 / 离镜头太远停更后恢复：按“正朝前走”起步，不从静止姿态突变
  G.px = S.pos.x; G.pz = S.pos.z; G.yaw = S.yaw; G.t = now;
  const k = dt > 0 ? 1 - Math.exp(-12 * dt) : 1; G.vx += (lx - G.vx) * k; G.vz += (lz - G.vz) * k; G.yr += (yr - G.yr) * k;
  const sp = Math.hypot(G.vx, G.vz); G.sp = sp;
  if (sp > 0.1) { G.dx = G.vx / sp; G.dz = G.vz / sp; }
  // 前进分量 fw、后退分量 bw、横向分量 side。后退不是把腿倒着摆，而是脚掌滚动的次序反过来：脚尖先着地、脚跟最后离地
  const side = Math.abs(G.dx), fw = Math.max(0, -G.dz), bw = Math.max(0, G.dz), back = bw;
  const runK = sstep(2.2, 4.8, sp) * fw * (1 - side), sprK = sstep(5.5, 9, sp) * fw * (1 - side);
  // —— 步频与步幅：自然步频随速度上升；侧移、后退的步幅有上限，超过就加快步频（小碎步）——
  const fNat = 0.8 + 0.15 * Math.min(sp, 9.5);
  const Lmax = lerp(lerp(3.6 + 1.3 * sprK, 1.2, bw), 1.05, side);
  let f = sp > 0.05 ? sp / Math.max(Math.min(sp / fNat, Lmax), 0.05) : 0; if (f > 2.8) f = 2.8;
  const turnK = sstep(1.0, 2.6, Math.abs(G.yr)) * (1 - sstep(0.15, 0.5, sp));      // 原地转身：小碎步
  if (turnK > 0.01) f = Math.max(f, 1.6 * turnK);
  G.ph = frac(G.ph + f * dt);
  G.amp += (sstep(0.06, 0.5, sp) - G.amp) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 1);
  const A = G.amp, la = Math.max(A, turnK);
  const beta = lerp(lerp(0.63, 0.33, runK), 0.26, sprK);         // 支撑期占比：走路 > 0.5（有双脚支撑），跑步 < 0.5（有腾空）
  // 支撑期里身体走过的距离（= 触地点相对身体后移的距离）。步频封顶后再长就够不着了：宁可让脚滑一点，也不把人压成蹲着走
  const stride = Math.min((f > 1e-3 ? sp / f : 0) * beta, lerp(lerp(1.2, 0.8, bw), 0.72, side));
  const shiftB = stride * lerp(0.13, 0.2, runK) * (fw + bw) * (1 - side);   // 落脚范围整体靠后：腿前伸有限，往后够靠抬脚跟延长
  const liftH = lerp(0.05, 0.16, runK) + 0.08 * sprK + 0.02 * side + 0.02 * turnK;
  const rF = fw * (1 - side), rB = bw * (1 - side);              // 脚掌滚动只在前后行进时出现
  const hsF = lerp(0.30, 0.06, runK) * rF, toF = lerp(0.95, 1.1, runK) * rF;   // 向前：脚跟着地时脚尖上翘 / 蹬地时脚尖下压
  const toB = 0.5 * rB, hsB = 0.2 * rB;                          // 后退：脚尖先着地 / 脚跟最后离地
  const wHalf = lerp(lerp(0.092, 0.066, runK), 0.135, side);
  const cw = S.crouchW || 0;
  // 脚掌绕靴跟 / 靴尖转动时，踝关节相对“全掌平放”位置的前移与抬高
  const heelF = (a) => HEEL * Math.cos(a) - ANKLE * Math.sin(a) - HEEL, heelU = (a) => HEEL * Math.sin(a) + ANKLE * Math.cos(a) - ANKLE;
  const toeF = (a) => TOE - TOE * Math.cos(a) + ANKLE * Math.sin(a), toeU = (a) => TOE * Math.sin(a) + ANKLE * Math.cos(a) - ANKLE;
  // 支撑期开始 / 结束时的脚掌状态（摆动期在两者之间过渡）
  const p0 = hsF - toB, adv0 = heelF(hsF) + toeF(toB), up0 = heelU(hsF) + toeU(toB);
  const p1 = hsB - toF, adv1 = heelF(hsB) + toeF(toF), up1 = heelU(hsB) + toeU(toF);
  // —— 每只脚的目标（网格空间）——
  const nav = S.game.nav; const foot = G.foot || (G.foot = [{ x: 0, y: 0, z: 0, p: 0, w: 1 }, { x: 0, y: 0, z: 0, p: 0, w: 1 }]);
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, F = foot[i]; const u = frac(G.ph + (i ? 0.5 : 0)); let along, lift, pitch, wAbs, adv;
    if (u < beta) {         // 支撑：先着地的一端落地 → 全掌踩实（此时脚锁在地面上）→ 另一端最后离地
      const t = u / beta; const k0 = 1 - sstep(0.0, 0.2, t), k1 = Math.pow(sstep(0.48, 1.0, t), 1.25);
      const hs = hsF * k0 + hsB * k1, to = toB * (1 - sstep(0.0, 0.4, t)) + toF * k1;
      along = stride * (0.5 - t); pitch = hs - to; adv = heelF(hs) + toeF(to); lift = heelU(hs) + toeU(to); wAbs = 1;
    } else {                // 摆动：从离地姿态带起，摆到下一个落脚点，落地前摆好着地姿态
      const t = (u - beta) / (1 - beta); const e = t * t * (3 - 2 * t); const k1 = 1 - sstep(0.0, 0.45, t), k0 = sstep(0.75, 1.0, t);
      along = stride * (e - 0.5); adv = adv1 * k1 + adv0 * k0;
      lift = up1 * k1 + up0 * k0 + liftH * Math.sin(Math.PI * Math.pow(t, 0.85));
      pitch = lerp(p1, p0, sstep(0.3, 0.95, t)); wAbs = 1 - sstep(0.0, 0.25, t) + sstep(0.72, 1.0, t);
    }
    // 行进方向上的位置；落脚范围靠后、脚掌滚动带来的前移都沿身体前后轴（前方是 -z）
    // 站立：持枪的戒备站姿 —— 两脚略宽于髋、左脚在前
    let x = lerp(sd * 0.125, sd * wHalf + G.dx * along, A), z = lerp(i ? 0.075 : -0.095, G.dz * along + shiftB - adv, A), y = lift * la;
    pitch *= la; wAbs = lerp(1, wAbs, la);
    if (cw > 0.01) {        // 跪姿射击：左脚在前踩实，右膝着地、右脚尖点地
      if (i === 0) { x = lerp(x, -0.115, cw); z = lerp(z, -0.25, cw); y = lerp(y, 0, cw); pitch = lerp(pitch, 0, cw); }
      else { x = lerp(x, 0.125, cw); z = lerp(z, 0.41, cw); y = lerp(y, 0.05, cw); pitch = lerp(pitch, -1.2, cw); }
      wAbs = lerp(wAbs, 1, cw);
    }
    if (o.grounded !== false && nav) {   // 贴合地面：台阶、坡道上两只脚各踩各的高度
      const gy = nav.heightSmooth(S.pos.x + cy * x + sy * z, S.pos.z - sy * x + cy * z) - S.pos.y;
      if (gy > -0.45 && gy < 0.45) y += gy;
    }
    F.x = x; F.y = y + ANKLE; F.z = z; F.p = pitch; F.w = wAbs;
  }
  // —— 骨盆：起伏、侧移、旋转、前倾 ——
  const TAU = Math.PI * 2; const c2 = Math.cos(TAU * (G.ph - beta / 2)), c4 = Math.cos(2 * TAU * (G.ph - beta / 2));
  G.yawP = -lerp(0.09, 0.16, runK) * A * Math.cos(TAU * G.ph) * (1 - side) * (1 - 0.5 * back);   // 摆动腿一侧的髋向前送
  G.rollP = -lerp(0.05, 0.03, runK) * A * c2 * (1 - 0.5 * side);                                 // 摆动腿一侧的髋略下沉
  G.lean = (0.03 * (fw - bw) + 0.085 * runK + 0.13 * sprK) * A;
  const swayX = -lerp(0.02, 0.006, runK) * A * c2 * (1 - side);
  // 骨盆高度：先取名义高度（跑步时支撑中期下沉、腾空最高），再保证两条腿都够得着各自的落脚点 ——
  // 走路时“双脚支撑最低、单脚支撑中期最高”的起伏就是这条约束自然带出来的
  let py = 0.98 - 0.028 * (1 - A) - (0.012 + 0.03 * runK + 0.025 * sprK + 0.02 * side) * A - 0.02 * turnK - 0.035 * runK * A * (0.5 + 0.5 * c4) - cw * 0.36 + (A < 0.1 ? Math.sin(S.animT * 0.4) * 0.004 : 0);
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, F = foot[i]; const hx = swayX + sd * HIP_X * Math.cos(G.yawP), hz = -sd * HIP_X * Math.sin(G.yawP);   // 骨盆旋转把摆动侧的髋向前送
    const h2 = (F.x - hx) * (F.x - hx) + (F.z - hz) * (F.z - hz); const lim = F.y + Math.sqrt(Math.max(0.02, REACH * REACH - h2)) - HIP_Y;
    if (lim < py) py = lim;
  }
  // 约束最多把骨盆压低 15 cm；再够不着就让反解自己截断
  const pyNom = 0.98 - cw * 0.36; py = Math.max(py, pyNom - 0.15, 0.5);
  // 高度变化做平滑，避免落脚瞬间骨盆突然一沉
  G.py = G.py === undefined || dt <= 0 ? py : G.py + (py - G.py) * (1 - Math.exp(-24 * dt));
  const hips = b[0];
  hips.position.set(swayX, G.py, 0);
  hips.rotation.set(-G.lean * 0.6 - cw * 0.1, G.yawP, G.rollP);
  // —— 双腿反解 + 脚掌 ——
  _qh.copy(hips.quaternion); const qhi = _qr.copy(_qh).invert();
  for (let i = 0; i < 2; i++) {
    const sd = i ? 1 : -1, F = foot[i]; const thigh = b[i ? 9 : 7], shin = b[i ? 10 : 8], ft = b[i ? 13 : 12];
    _t.set(F.x - hips.position.x, F.y - hips.position.y, F.z - hips.position.z).applyQuaternion(qhi);
    const hint = _u.set(sd * (0.07 + 0.1 * cw), 0.12, -1).applyQuaternion(qhi);   // 膝盖朝前、略朝外（跪姿时更外展）
    const hx = hint.x, hy = hint.y, hz = hint.z; legIK(thigh, shin, _t.x, _t.y, _t.z, _e.set(hx, hy, hz));
    if (ft) {
      // 支撑期脚掌按“相对地面”的角度摆（平放 / 蹬地），摆动中段放松成相对小腿的自然角度
      _qs.copy(_qh).multiply(thigh.quaternion).multiply(shin.quaternion).invert();
      _qa.setFromEuler(_eu.set(F.p, -sd * lerp(i ? 0.3 : 0.1, 0.1, A), 0, 'YXZ')).premultiply(_qs);   // 脚尖略外撇；站立时后脚外撇更多
      ft.quaternion.setFromEuler(_eu.set(-0.14, 0, 0, 'XYZ')).slerp(_qa, clamp01(F.w));
    }
  }
  return G;
}
