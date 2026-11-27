// 筋斗云的飞行模型：协调转弯（转向自动侧倾）、升降、加速、翻筋斗冲刺、云面浮力、撞山反弹。
// 朝向约定：本地 -Z 为前、+Y 为上。yaw 绕 +Y（左转为正），pitch 抬头为正，bank 左倾为正。
import * as THREE from 'three';
import { CLOUD_TOP_Y, CRUISE_Y } from './common.js';

const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const clamp = THREE.MathUtils.clamp;

export const FLIGHT = {
  cruise: 45, boost: 165, brake: 20,          // 速度（米/秒）：加速是巡航的 3.7 倍
  yawRate: 0.95,                               // 巡航时最大转向角速度（弧度/秒）
  maxPitch: THREE.MathUtils.degToRad(38),
  maxBank: THREE.MathUtils.degToRad(58),
  floorY: CLOUD_TOP_Y - 5,                     // 再往下云的浮力把人托回来
  ceilY: CLOUD_TOP_Y + 520,
  flipTime: 0.95, flipCooldown: 1.6,
  radius: 1.3,                                  // 碰撞半径
};

export function createFlight(opts = {}) {
  const s = {
    position: new THREE.Vector3(0, CRUISE_Y, 0),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(1, 0, 0),
    yaw: -Math.PI / 2,                          // 初始朝 +X（影片里的飞行方向）
    pitch: 0, bank: 0, yawVel: 0,
    speed: FLIGHT.cruise, boost: 0, turn: 0,
    flip: 0, flipCd: 0, flipAngle: 0,
    hitTimer: 0, hitFlash: 0, distance: 0, gForce: 0,
    boostKick: 0,                               // 刚按下加速那一下的冲击量（1 → 0 衰减），给镜头/特效用
    boostHeld: false,
    inCloud: 0, nearMiss: 0, airtime: 0,
    events: [],                                 // 本帧发生的事件：'flip' | 'hit' | 'dive' | 'surface'
  };
  let wasInCloud = false;
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _v = new THREE.Vector3();
  if (opts.position) s.position.copy(opts.position);

  function reset(pos, yaw) {
    s.position.copy(pos || new THREE.Vector3(0, CRUISE_Y, 0)); s.yaw = yaw ?? -Math.PI / 2; s.pitch = 0; s.bank = 0; s.yawVel = 0;
    s.speed = FLIGHT.cruise; s.boost = 0; s.flip = 0; s.flipCd = 0; s.hitTimer = 0; s.distance = 0; s.boostKick = 0; s.boostHeld = false;
  }

  function startFlip() {
    if (s.flip > 0 || s.flipCd > 0 || s.hitTimer > 0) return false;
    s.flip = 1e-4; s.events.push('flip'); return true;
  }

  /** input: { turn, climb, boost, brake }；world 可为空（无碰撞） */
  function update(dt, input, world, env) {
    s.events.length = 0;
    const floorY = (env && env.cloudHeight != null ? env.cloudHeight : CLOUD_TOP_Y - 13) + 4.0;   /* 查询值不含 ±9 m 噪声鼓包：托在略高处，免得一直在云团里穿 */       // 当地云面略往下：再低就被云托回来
    const ctl = s.hitTimer > 0 ? 0.25 : 1.0;                    // 刚撞完的一小会儿操控变迟钝
    s.hitTimer = Math.max(0, s.hitTimer - dt); s.hitFlash = Math.max(0, s.hitFlash - dt * 2.5);
    s.flipCd = Math.max(0, s.flipCd - dt);
    s.turn = damp(s.turn, input.turn * ctl, 9, dt);

    // ---- 速度：巡航 / 加速 / 减速，俯冲略增速、爬升略减速
    const wantBoost = input.boost > 0.5 && input.brake < 0.5;
    if (wantBoost && !s.boostHeld) { s.boostKick = 1; s.speed += 22; s.events.push('boost'); }       // 起步的一脚"推背"
    if (!wantBoost && s.boostHeld) s.events.push('boost_end');
    s.boostHeld = wantBoost;
    s.boostKick = Math.max(0, s.boostKick - dt * 1.3);
    s.boost = damp(s.boost, wantBoost ? 1 : 0, wantBoost ? 3.2 : 1.1, dt);
    let vTarget = FLIGHT.cruise + (FLIGHT.boost - FLIGHT.cruise) * s.boost;
    if (input.brake > 0.5) vTarget = FLIGHT.brake;
    vTarget -= Math.sin(s.pitch) * 16;
    let flipBoost = 0;
    if (s.flip > 0) {
      s.flip += dt / FLIGHT.flipTime;
      flipBoost = Math.sin(Math.min(1, s.flip) * Math.PI);    // 翻筋斗中段爆发
      if (s.flip >= 1) { s.flip = 0; s.flipCd = FLIGHT.flipCooldown; }
    }
    vTarget += flipBoost * 70;
    s.speed = damp(s.speed, vTarget, vTarget > s.speed ? (wantBoost ? 2.4 : 1.5) : 0.8, dt);
    // 翻转角：0→2π，缓入缓出
    const f = s.flip; s.flipAngle = f > 0 ? (f * f * (3 - 2 * f)) * Math.PI * 2 : 0;

    // ---- 转向：速度越快转得越慢；侧倾角跟着转向角速度走（协调转弯）
    const speedK = clamp(FLIGHT.cruise / s.speed, 0.30, 1.25);
    const yawTarget = -s.turn * FLIGHT.yawRate * (0.55 + 0.45 * speedK);       // turn 右正 → 右转（yaw 减小）
    s.yawVel = damp(s.yawVel, yawTarget, Math.abs(yawTarget) < Math.abs(s.yawVel) ? 6.5 : 4.5, dt);      // 松手回正比压弯快一点
    s.yaw += s.yawVel * dt;
    const bankTarget = clamp(Math.atan2(s.yawVel * s.speed, 9.81) * 0.92, -FLIGHT.maxBank, FLIGHT.maxBank);
    s.bank = damp(s.bank, bankTarget, 5.0, dt);
    s.gForce = Math.sqrt(1 + Math.pow(s.yawVel * s.speed / 9.81, 2));

    // ---- 升降
    let pitchTarget = input.climb * ctl * FLIGHT.maxPitch;
    const y = s.position.y;
    // 云面浮力：贴近云海时把航迹往上托，允许短暂掠入云顶
    const depth = floorY - y;
    if (depth > -14) pitchTarget = Math.max(pitchTarget, clamp((depth + 14) / 26, 0, 1) * FLIGHT.maxPitch * (pitchTarget < 0 ? 1.0 : 0.6) - (depth < -6 ? 0.25 : 0));
    if (depth > 0) pitchTarget = Math.max(pitchTarget, clamp(depth / 10, 0.25, 1) * FLIGHT.maxPitch);
    if (y > FLIGHT.ceilY - 60) pitchTarget = Math.min(pitchTarget, -clamp((y - (FLIGHT.ceilY - 60)) / 60, 0, 1) * FLIGHT.maxPitch * 0.7);
    s.pitch = damp(s.pitch, pitchTarget, 3.2, dt);

    // ---- 位移
    _e.set(s.pitch, s.yaw, 0);
    s.forward.set(0, 0, -1).applyEuler(_e);
    s.velocity.copy(s.forward).multiplyScalar(s.speed);
    s.position.addScaledVector(s.velocity, dt);
    s.distance += s.speed * dt;

    // ---- 撞山：推出去、偏转航向、掉速
    s.nearMiss = damp(s.nearMiss, 0, 3, dt);
    if (world && world.collide) {
      _v.copy(s.position); _v.y += 0.9;
      const hit = world.collide(_v, FLIGHT.radius);
      if (hit) {
        // 撞到侧壁时只做水平方向的推出，免得顺着山壁被一路"挤"上山顶
        const nh = Math.hypot(hit.normal.x, hit.normal.z);
        if (nh > 0.5) { s.position.x += hit.normal.x / nh * (hit.depth + 0.05); s.position.z += hit.normal.z / nh * (hit.depth + 0.05); }
        else s.position.addScaledVector(hit.normal, hit.depth + 0.05);
        const fwdFlat = _v.set(s.forward.x, 0, s.forward.z).normalize();
        const nFlat = new THREE.Vector3(hit.normal.x, 0, hit.normal.z);
        if (nFlat.lengthSq() > 1e-4) {
          nFlat.normalize();
          const into = fwdFlat.dot(nFlat);
          if (into < 0) {
            // 把航向转到沿着山壁滑开的方向
            const slide = fwdFlat.clone().addScaledVector(nFlat, -into * 1.35).normalize();
            const newYaw = Math.atan2(-slide.x, -slide.z);
            let dy = newYaw - s.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
            s.yaw += dy; s.yawVel = dy * 1.5;
            if (s.hitTimer <= 0 && into < -0.18) {
              s.speed *= 1 - 0.55 * Math.min(1, -into * 1.4);
              s.hitTimer = 0.45; s.hitFlash = 1; s.boost *= 0.3; s.events.push('hit');
            }
          }
        } else if (hit.normal.y > 0.5) { s.pitch = Math.max(s.pitch, 0.15); }
      }
      if (world.nearestDistance) {
        const d = world.nearestDistance(s.position);
        if (d < 18) s.nearMiss = Math.max(s.nearMiss, clamp(1 - (d - 3) / 15, 0, 1) * clamp(s.speed / 60, 0.3, 1));
      }
    }

    // ---- 云里/云外
    const inC = clamp((floorY + 3.5 - s.position.y) / 6, 0, 1);
    s.inCloud = damp(s.inCloud, inC, 6, dt);
    const nowIn = inC > 0.5;
    if (nowIn !== wasInCloud) { s.events.push(nowIn ? 'dive' : 'surface'); wasInCloud = nowIn; }

    // ---- 朝向（含侧倾；翻筋斗的整圈翻转另由 flipAngle 给外层叠加）
    _e.set(s.pitch, s.yaw, s.bank);
    s.quaternion.setFromEuler(_e);
    return s;
  }

  return { state: s, update, reset, startFlip };
}
