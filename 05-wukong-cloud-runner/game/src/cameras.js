// 镜头系统：追尾 / 贴身 / 侧面跟拍 / 正面特写 / 掠过机位 / 航拍，对应影片里的几种机位。
import * as THREE from 'three';

const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// 偏移量在"机体坐标"里：x 右、y 上、z 后（前是 -z）
export const CAMERA_MODES = [
  { id: 'chase', name: '追尾', off: [0, 2.15, 6.4], look: [0, 1.25, -14], fov: 48, fovBoost: 14, lag: 5.0, roll: 0.42, fstop: 4.0, pitchFollow: 0.75,
    // 加速时：镜头被远远甩到身后上方，换成广角，整条筋斗云拖尾都在画面里
    offBoost: [2.6, 9.5, 34], lookBoost: [0, 2.0, -70], fovB: 77 },
  { id: 'close', name: '贴身', off: [1.25, 1.6, 2.9], look: [0.5, 1.3, -8], fov: 46, fovBoost: 12, lag: 9, roll: 0.5, fstop: 2.8, pitchFollow: 0.85,
    offBoost: [2.0, 4.6, 15], lookBoost: [0, 1.6, -50], fovB: 73 },
  { id: 'side', name: '侧面跟拍', off: [8.8, 1.0, -0.6], look: [0, 0.75, -0.4], fov: 34, fovBoost: 6, lag: 9, roll: 0.0, fstop: 2.0, pitchFollow: 0.3 },
  { id: 'hero', name: '正面特写', off: [2.3, 1.0, -5.5], look: [0.0, 1.02, 0], fov: 19, fovBoost: 3, lag: 12, roll: -0.5, fstop: 2.8, pitchFollow: 0.2 },
  { id: 'flyby', name: '掠过机位', fov: 22, fstop: 5.6 },
  { id: 'aerial', name: '航拍', off: [0, 16, 40], look: [0, 0, -30], fov: 38, fovBoost: 8, lag: 2.5, roll: 0.0, fstop: 8, pitchFollow: 0.2 },
];

export function createCameras(app, opts = {}) {
  const cam = app.camera;
  let modeIndex = 0;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), relPos = new THREE.Vector3(), relLook = new THREE.Vector3();
  let floorY = -1e9, fov = 54, roll = 0, inited = false, shake = 0, shakeT = 0, occl = 1, boostCam = 0, boostVel = 0, lensMul = 1;
  const flybyPos = new THREE.Vector3(); let flybyValid = false, flybyTimer = 0, flybySide = 1, flybyBlocked = 0;
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3();
  const head = new THREE.Vector3();
  const out = { focus: 9, fstop: 5.6, mode: CAMERA_MODES[0], protect: new THREE.Vector3(0.5, 0.5, 0.2), charDist: 9 };
  // 拍照模式：绕角色自由环绕
  const orbit = { on: false, yaw: 0.6, pitch: 0.12, dist: 7, fov: 32 };

  function frame(s, mode, pitchFollow) {          // 机体坐标 → 世界
    _e.set(s.pitch * pitchFollow, s.yaw, 0); _q.setFromEuler(_e); return _q;
  }

  function losClear(world, a, b) {            // a→b 之间有没有被石峰挡住
    if (!world || !world.collide) return true;
    const n = Math.max(3, Math.ceil(a.distanceTo(b) / 7));
    for (let i = 1; i < n; i++) { _f.lerpVectors(a, b, i / n); if (world.collide(_f, 1.5)) return false; }
    return true;
  }
  const _fut = new THREE.Vector3(), _cand = new THREE.Vector3();
  function placeFlyby(s, world) {
    // 在前方航线旁找一个固定机位等悟空掠过：机位本身不能在山里，看向"现在的他"和"一两秒后的他"都不能被挡
    flybySide = -flybySide;
    let found = false;
    for (let k = 0; k < 14 && !found; k++) {
      const ahead = s.speed * (1.3 + Math.random() * 1.0);
      const side = flybySide * (10 + Math.random() * 26) * (k % 2 ? -1 : 1), h = -2 + Math.random() * (k > 8 ? 30 : 12);
      _a.set(s.forward.x, 0, s.forward.z).normalize();
      _b.set(-_a.z, 0, _a.x);
      _cand.copy(s.position).addScaledVector(_a, ahead).addScaledVector(_b, side); _cand.y += h + Math.sin(s.pitch) * ahead;
      if (world && world.collide && world.collide(_cand, 4)) continue;
      _fut.copy(s.position).addScaledVector(s.forward, ahead * 0.75); _fut.y += 1;
      head.copy(s.position); head.y += 1.2;
      if (losClear(world, _cand, head) && losClear(world, _cand, _fut)) { flybyPos.copy(_cand); found = true; }
    }
    if (!found) { flybyPos.copy(s.position).addScaledVector(s.forward, s.speed * 0.9); flybyPos.y += 14; }       // 找不到好位置：退到航线正上方
    flybyValid = true; flybyTimer = 0; flybyBlocked = 0;
  }

  function update(dt, s, world, getHead) {
    const mode = orbit.on ? null : CAMERA_MODES[modeIndex];
    // 加速镜头量 surge：照搬赛车游戏的手感——按下时欠阻尼（ω=5.2, ζ=0.55：约 0.7 秒甩到位并冲过头 12% 再收回），松开后临界阻尼慢慢回来（ω=2.2, ζ=1）
    {
      const on = s.boostHeld || s.boost > 0.6, target = on ? 1 : 0, w = on ? 5.2 : 2.2, zeta = on ? 0.55 : 1.0;
      const sub = dt > 0.02 ? 2 : 1, h = dt / sub;
      for (let i = 0; i < sub; i++) { boostVel += (w * w * (target - boostCam) - 2 * zeta * w * boostVel) * h; boostCam += boostVel * h; }
      boostCam = Math.max(0, Math.min(1.3, boostCam));
    }
    if (getHead) getHead(head); else head.copy(s.position).add(_a.set(0, 1.35, 0));
    let tPos = _a, tLook = _b, tFov, lag = 6, tRoll = 0;
    if (orbit.on) {
      const cp = Math.cos(orbit.pitch);
      tPos = new THREE.Vector3(Math.sin(orbit.yaw) * cp, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cp).multiplyScalar(orbit.dist).add(s.position).add(new THREE.Vector3(0, 0.9, 0));
      tLook = s.position.clone().add(new THREE.Vector3(0, 0.95, 0)); tFov = orbit.fov; lag = 14; out.fstop = 2.8;
    } else if (mode.id === 'flyby') {
      flybyTimer += dt;
      const rel = _f.copy(s.position).sub(flybyPos);
      const passed = rel.dot(s.forward) > Math.max(70, s.speed * 1.4);
      if (flybyValid && !losClear(world, flybyPos, head)) flybyBlocked += dt; else flybyBlocked = 0;
      if (!flybyValid || passed || flybyTimer > 7 || rel.length() > 600 || flybyBlocked > 0.35) placeFlyby(s, world);
      tPos = flybyPos.clone(); tLook = head.clone();
      const d = tPos.distanceTo(head);
      tFov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(4.2 / Math.max(d, 6))), 7, 42);   // 距离越远镜头越长，保持人在画面里的大小
      lag = 60; out.fstop = mode.fstop;
      if (!inited || flybyTimer === 0) { fov = tFov; }
    } else {
      const q = frame(s, mode, mode.pitchFollow);
      const fl = Math.sin(Math.min(1, s.flip) * Math.PI);
      const pull = 1 + 0.22 * s.boost + 0.18 * fl;
      // 加速镜头：boostCam 是带一点过冲的缓动量（按下瞬间猛地甩远，稳定后略收回来）
      const e = mode.offBoost ? boostCam : 0;
      const ox = mode.off[0] + ((mode.offBoost ? mode.offBoost[0] : 0) - mode.off[0]) * e, oy = mode.off[1] + ((mode.offBoost ? mode.offBoost[1] : 0) - mode.off[1]) * e;
      const oz = mode.offBoost ? mode.off[2] + (mode.offBoost[2] - mode.off[2]) * e : mode.off[2] * (mode.off[2] > 0 ? pull : 1);
      tPos = new THREE.Vector3(ox, oy, oz).applyQuaternion(q).add(s.position);
      tLook = new THREE.Vector3(mode.look[0], mode.look[1], mode.look[2]);
      if (mode.lookBoost) tLook.lerp(_f.set(mode.lookBoost[0], mode.lookBoost[1], mode.lookBoost[2]), Math.min(1, e));
      tLook.applyQuaternion(q).add(s.position);
      if (mode.id === 'hero') tLook.copy(head).add(_f.set(0, -0.28, 0));          // 特写始终盯着头部（压弯、翻筋斗时人不会出画）
      tFov = mode.fovB ? mode.fov + (mode.fovB - mode.fov) * Math.min(1.15, e) + 8 * fl + 10 * s.boostKick : mode.fov + mode.fovBoost * (s.boost * 0.8 + 0.6 * fl) + (s.speed - 45) * 0.03;
      lag = mode.lag; tRoll = s.bank * mode.roll; out.fstop = mode.fstop;
    }
    // 平滑是在"跟着飞行器走"的坐标里做的：只对转向/机位变化产生滞后，不会因为飞得快而被甩在后面
    if (!inited) { relPos.copy(tPos).sub(s.position); relLook.copy(tLook).sub(s.position); fov = tFov; roll = tRoll; inited = true; }
    if (!orbit.on && mode.id === 'flyby') { relPos.copy(tPos).sub(s.position); relLook.copy(tLook).sub(s.position); }
    else {
      relPos.lerp(_f.copy(tPos).sub(s.position), 1 - Math.exp(-lag * dt));
      relLook.lerp(_f.copy(tLook).sub(s.position), 1 - Math.exp(-(lag + 4) * dt));
    }
    pos.copy(s.position).add(relPos); look.copy(s.position).add(relLook);
    fov = damp(fov, tFov, tFov > fov ? 7 : 3.5, dt); roll = damp(roll, tRoll, 5, dt);
    // 广角程度（推拉变焦）：视场角变宽的同时把镜头沿"角色→镜头"方向推近，人在画面里的大小不变，只是透视越来越夸张、张力越来越强
    const isFlyby = !orbit.on && mode && mode.id === 'flyby';
    const fovOut = isFlyby ? fov : THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) / lensMul)), 4, 125);
    if (!isFlyby && Math.abs(lensMul - 1) > 1e-3) {
      const k = Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(fovOut * 0.5));
      _a.copy(s.position); _a.y += 0.9;
      _b.copy(pos).sub(_a); const d0 = _b.length();
      if (d0 > 1e-3) pos.copy(_a).addScaledVector(_b, Math.max(1.3, d0 * k) / d0);
    }
    // 相机别钻进山里，也别被石峰挡住视线：从角色往相机方向探测，被挡住就把相机拉近到遮挡物之前
    if (world && world.collide && !(mode && mode.id === 'flyby')) {
      _a.copy(head); _b.copy(pos).sub(head); const full = _b.length();
      if (full > 2.5) {
        _b.multiplyScalar(1 / full);
        const N = Math.min(14, Math.max(4, Math.ceil(full / 2.5))); let okDist = full;
        for (let i = 1; i <= N; i++) { const d = full * i / N; _f.copy(head).addScaledVector(_b, d); if (world.collide(_f, 0.9)) { okDist = Math.max(1.8, full * (i - 1) / N - 0.6); break; } }
        occl += ((okDist / full) - occl) * (okDist / full < occl ? 1 : Math.min(1, dt * 2.5));     // 被挡立刻拉近，放开后慢慢退回
        if (occl < 0.999) pos.copy(head).addScaledVector(_b, full * occl);
      }
    }

    // 震动：撞击 + 高速时的细微抖动
    shake = Math.max(shake * Math.exp(-dt * 5), s.hitFlash * 0.9);
    shakeT += dt;
    const amp = shake * 0.35 + s.nearMiss * 0.02 * (orbit.on || s.boostHeld ? 0 : 1);          // 加速时不抖镜头（用户要求），只保留撞击和擦身而过的轻微震动
    const sx = (Math.sin(shakeT * 61.3) + Math.sin(shakeT * 37.1 + 1.3)) * 0.5 * amp, sy = (Math.sin(shakeT * 53.7 + 0.4) + Math.sin(shakeT * 29.9 + 2.1)) * 0.5 * amp;

    // 镜头别钻进云海：保持在当地云面之上（人在云里时除外），否则整个画面被雾糊掉
    if (opts.floor && !(s.inCloud > 0.5)) {
      const fy = opts.floor(pos.x, pos.z);
      if (fy != null) { const tgt = Math.max(fy + 4, Math.min(fy + 11, s.position.y + 2.5)); floorY += (tgt - floorY) * (1 - Math.exp(-6 * dt)); if (pos.y < floorY) pos.y = floorY; }
    }
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (Math.abs(roll) > 1e-4) cam.rotateZ(roll);
    cam.translateX(sx); cam.translateY(sy);
    if (Math.abs(cam.fov - fovOut) > 0.01) { cam.fov = fovOut; cam.updateProjectionMatrix(); }
    out.focalMm = 12 / Math.tan(THREE.MathUtils.degToRad(fovOut * 0.5));       // 等效全画幅焦距（毫米）
    out.hfov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(fovOut * 0.5)) * cam.aspect));    // 水平视角（度）
    cam.updateMatrixWorld();

    // 对焦和"保护区"（后期里运动模糊/景深不要糊到角色）
    out.focus = Math.max(1.5, cam.position.distanceTo(head));
    out.charDist = cam.position.distanceTo(s.position);
    _f.copy(s.position); _f.y += 0.9; _f.project(cam);
    const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * out.charDist;       // 该距离处半屏高（米）
    out.protect.set(_f.x * 0.5 + 0.5, _f.y * 0.5 + 0.5, _f.z < 1 ? Math.min(1.5, 2.6 / Math.max(hh, 0.01) * 0.5) : 0);
    out.mode = mode || { id: 'photo', name: '拍照模式' };
    return out;
  }

  return {
    out, orbit, update,
    get mode() { return CAMERA_MODES[modeIndex]; },
    setMode(id) { const i = CAMERA_MODES.findIndex(m => m.id === id); if (i >= 0) { modeIndex = i; flybyValid = false; } },
    next() { modeIndex = (modeIndex + 1) % CAMERA_MODES.length; flybyValid = false; return CAMERA_MODES[modeIndex]; },
    snap() { inited = false; },
    kick(v) { shake = Math.max(shake, v); },
    get lens() { return lensMul; },
    setLens(m) { lensMul = THREE.MathUtils.clamp(m, 0.32, 2.5); return lensMul; },
    get boostCam() { return boostCam; },
  };
}
