// 金环航线：一串悬在峰林之间的金色光环，无限向前生成。穿过加分并累计连击，错过则连击清零。
import * as THREE from 'three';
import { SCENE_DEPTH_GLSL, CLOUD_TOP_Y } from './common.js';

const HOOP_R = 7.5, TUBE = 0.32, AHEAD = 6;

export function createHoops(app, world, opts = {}) {
  const group = new THREE.Group(); group.name = 'Hoops';
  const geo = new THREE.TorusGeometry(HOOP_R, TUBE, 14, 96);
  const haloGeo = new THREE.RingGeometry(HOOP_R * 0.80, HOOP_R * 1.22, 96, 1);
  let seed = opts.seed ?? 20261122;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  function ringMaterial(halo) {
    return new THREE.ShaderMaterial({
      uniforms: { ...app.fx.uniforms, uAlpha: { value: 1 }, uPulse: { value: 0 }, uNext: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying float vDist; varying vec3 vN; varying vec3 vV; varying vec2 vUv2;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vUv2 = uv; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: SCENE_DEPTH_GLSL + /* glsl */`
        uniform float uAlpha, uPulse, uNext, uTime; varying float vDist; varying vec3 vN; varying vec3 vV; varying vec2 vUv2;
        void main() {
          if (vDist > sceneViewDist(gl_FragCoord.xy) + 0.3) discard;
          float fog = exp(-vDist / 1400.0);
          ${halo ? `
          float r = vUv2.x;                                  // RingGeometry 的 uv：这里用位置重算更稳
          float a = 0.0;` : ''}
          vec3 gold = vec3(1.0, 0.72, 0.28);
          ${halo
            ? `float edge = abs(length(vUv2 - 0.5) * 2.0 / 1.22 - 0.82) / 0.18; float g = exp(-edge * edge * 3.0);
               gl_FragColor = vec4(gold * g * (0.10 + 0.22 * uNext + 1.6 * uPulse) * fog * uAlpha * smoothstep(8.0, 60.0, vDist), 1.0);`
            : `float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
               float shimmer = 0.85 + 0.15 * sin(uTime * 3.0 + vUv2.x * 40.0);
               gl_FragColor = vec4(gold * (2.2 + 2.5 * fr + 3.0 * uNext + 8.0 * uPulse) * shimmer * fog * uAlpha, 1.0);`}
        }`,
    });
  }

  const hoops = [];        // { pos, normal, mesh, halo, state: 'ahead'|'passed'|'missed', t }
  let last = { pos: new THREE.Vector3(120, 112, 0), yaw: -Math.PI / 2 };
  let score = 0, combo = 0, best = 0, passed = 0;
  const events = [];
  const _d = new THREE.Vector3(), _p = new THREE.Vector3();

  function clear(pos, r) { return !(world && world.collide && world.collide(pos, r)); }
  function segmentClear(a, b, r) {
    for (let i = 1; i <= 6; i++) { _p.lerpVectors(a, b, i / 6); if (!clear(_p, r)) return false; }
    return true;
  }

  function spawn() {
    let pos = null, yaw = last.yaw;
    for (let attempt = 0; attempt < 40 && !pos; attempt++) {
      const spread = attempt < 10 ? 0.45 : attempt < 25 ? 0.9 : 1.5;
      const dyaw = (rnd() - 0.5) * 2 * spread * (0.4 + 0.6 * rnd());
      const dist = 170 + rnd() * 90;
      const lo = (opts.cloudHeightAt ? Math.max(CLOUD_TOP_Y - 6, opts.cloudHeightAt(last.pos.x, last.pos.z)) : CLOUD_TOP_Y) + 12;
      // 航线大部分时间贴着云面（这样能犁开云海），偶尔拉高
      const y = THREE.MathUtils.clamp(last.pos.y + (rnd() - 0.64) * 40 + (rnd() < 0.12 ? 45 : 0) + (attempt > 25 ? 30 : 0), lo, CLOUD_TOP_Y + 150);
      const ny = last.yaw + dyaw;
      const c = new THREE.Vector3(last.pos.x - Math.sin(ny) * dist, y, last.pos.z - Math.cos(ny) * dist);
      if (opts.cloudHeightAt) c.y = Math.max(c.y, opts.cloudHeightAt(c.x, c.z) + 12);
      if (clear(c, 26) && segmentClear(last.pos, c, 11)) { pos = c; yaw = ny; }
    }
    if (!pos) {   // 实在找不到空当：抬高到峰顶之上
      const ny = last.yaw; pos = new THREE.Vector3(last.pos.x - Math.sin(ny) * 220, Math.min(last.pos.y + 60, CLOUD_TOP_Y + 420), last.pos.z - Math.cos(ny) * 220); yaw = ny;
    }
    const normal = pos.clone().sub(last.pos).normalize();
    const mesh = new THREE.Mesh(geo, ringMaterial(false)), halo = new THREE.Mesh(haloGeo, ringMaterial(true));
    for (const m of [mesh, halo]) { m.position.copy(pos); m.lookAt(pos.clone().add(normal)); m.frustumCulled = false; group.add(m); }
    hoops.push({ pos, normal, mesh, halo, state: 'ahead', t: 0, side: -1 });
    last = { pos, yaw };
  }

  function remove(h) { group.remove(h.mesh); group.remove(h.halo); h.mesh.material.dispose(); h.halo.material.dispose(); }

  function reset(start, yaw) {
    for (const h of hoops) remove(h); hoops.length = 0; score = combo = passed = 0; events.length = 0;
    const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    last = { pos: start.clone().addScaledVector(f, -40), yaw };
    while (hoops.length < AHEAD) spawn();
  }

  function update(dt, playerPos) {
    events.length = 0;
    let firstAhead = true;
    for (const h of hoops) {
      h.t += dt;
      const u = h.mesh.material.uniforms, uh = h.halo.material.uniforms;
      if (h.state === 'ahead') {
        _d.copy(playerPos).sub(h.pos); const side = _d.dot(h.normal);
        if (h.side < 0 && side >= 0) {         // 刚穿过环所在的平面
          const radial = Math.sqrt(Math.max(0, _d.lengthSq() - side * side));
          if (radial < HOOP_R - 0.4) { h.state = 'passed'; h.t = 0; combo++; passed++; best = Math.max(best, combo); score += 100 * Math.min(combo, 10); events.push({ type: 'pass', combo, pos: h.pos }); }
          else { h.state = 'missed'; h.t = 0; if (combo > 0) events.push({ type: 'miss', combo }); combo = 0; }
        } else if (side > 60) { h.state = 'missed'; h.t = 0; combo = 0; }
        h.side = side;
        const nx = firstAhead ? 1 : 0; firstAhead = false;
        u.uNext.value += (nx - u.uNext.value) * Math.min(1, dt * 4); uh.uNext.value = u.uNext.value;
        u.uAlpha.value = uh.uAlpha.value = Math.min(1, h.t * 1.5);
      } else if (h.state === 'passed') {
        const k = Math.min(1, h.t / 0.7); u.uPulse.value = uh.uPulse.value = (1 - k) * 1.0; u.uAlpha.value = uh.uAlpha.value = 1 - k;
        const s = 1 + k * 1.6; h.mesh.scale.setScalar(s); h.halo.scale.setScalar(s);
      } else { const k = Math.min(1, h.t / 0.6); u.uAlpha.value = uh.uAlpha.value = (1 - k) * 0.5; }
    }
    while (hoops.length && hoops[0].state !== 'ahead' && hoops[0].t > 0.8) remove(hoops.shift());
    while (hoops.filter(h => h.state === 'ahead').length < AHEAD) spawn();
    return events;
  }

  return {
    group, update, reset, radius: HOOP_R,
    get next() { return hoops.find(h => h.state === 'ahead') || null; },
    get nextTwo() { return hoops.filter(h => h.state === 'ahead').slice(0, 2); },
    get score() { return score; }, get combo() { return combo; }, get best() { return best; }, get passed() { return passed; },
  };
}
