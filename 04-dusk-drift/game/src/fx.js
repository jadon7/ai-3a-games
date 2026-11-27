// 特效：轮胎烟 / 尘土 / 水雾（实例化公告板粒子）与胎痕（动态条带网格）
import * as THREE from 'three/webgpu';
import {
  uv, vec2, vec3, vec4, float, texture, instancedDynamicBufferAttribute, smoothstep, length, mix, dot, normalize, sqrt, saturate, oneMinus, pow, max,
  cameraViewMatrix, positionView, uniform, attribute, mrt, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, screenUV, rotateUV,
} from 'three/tsl';
import { SURF } from './track.js';

const MAXP = 1400;

export class Effects {
  constructor(scene, noiseTex, env, quality) {
    this.scene = scene; this.n = 0;
    const P = this.p = { x: new Float32Array(MAXP), y: new Float32Array(MAXP), z: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP), vz: new Float32Array(MAXP), age: new Float32Array(MAXP), life: new Float32Array(MAXP), s0: new Float32Array(MAXP), s1: new Float32Array(MAXP), rot: new Float32Array(MAXP), rv: new Float32Array(MAXP), a: new Float32Array(MAXP), seed: new Float32Array(MAXP), kind: new Uint8Array(MAXP) };
    this.order = new Uint16Array(MAXP); this.dist = new Float32Array(MAXP);
    // ---------- 烟雾粒子 ----------
    const posA = this.posA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3); posA.setUsage(THREE.DynamicDrawUsage);
    const datA = this.datA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4); datA.setUsage(THREE.DynamicDrawUsage);   // 尺寸、旋转、不透明度、种子
    const colA = this.colA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3); colA.setUsage(THREE.DynamicDrawUsage);
    const iPos = instancedDynamicBufferAttribute(posA, 'vec3'), iDat = instancedDynamicBufferAttribute(datA, 'vec4'), iCol = instancedDynamicBufferAttribute(colA, 'vec3');
    const m = new THREE.SpriteNodeMaterial(); m.transparent = true; m.depthWrite = false; m.fog = false;
    m.positionNode = iPos; m.scaleNode = iDat.x; m.rotationNode = iDat.y;
    const p = uv().sub(0.5).mul(2), r = length(p);
    const nuv = uv().mul(0.42).add(vec2(iDat.w, iDat.w.mul(1.618)));
    const n1 = texture(noiseTex, nuv).r, n2 = texture(noiseTex, nuv.mul(2.3).add(0.37)).g;
    // 边缘用噪声"啃"掉一部分，得到絮状而不是一个圆饼
    const fall = saturate(oneMinus(r.mul(r)));
    const nn = n1.mul(0.62).add(n2.mul(0.38));
    const dens = pow(saturate(fall.mul(1.45).sub(oneMinus(nn).mul(1.05))), 1.25);
    // 伪体积光照：把贴片当成球面，朝太阳的一侧更亮；逆光时整体透亮
    const nz = sqrt(saturate(oneMinus(r.mul(r))));
    const nrm = normalize(vec3(p.x, p.y, nz.mul(0.9).add(0.1)));
    const sunV = normalize(cameraViewMatrix.mul(vec4(env.sunDir.x, env.sunDir.y, env.sunDir.z, 0)).xyz);
    const ndl = dot(nrm, sunV).mul(0.5).add(0.5);
    const back = pow(saturate(dot(normalize(positionView).negate(), sunV).negate().mul(0.5).add(0.5)), 3);
    const sc = env.sun.color, sw = 0.5;       // 烟的受光颜色往白色靠一半，避免发黄
    const sunC = vec3(sc.r * (1 - sw) + sw, sc.g * (1 - sw) + sw, sc.b * (1 - sw) + sw).mul(env.sun.intensity * 0.26);
    const amb = vec3(0.60, 0.58, 0.56).mul(0.62);
    const lit = amb.add(sunC.mul(ndl.mul(ndl).mul(0.9).add(back.mul(0.85)))).mul(mix(float(0.62), float(1.0), n2)).mul(mix(float(0.66), float(1.0), smoothstep(0.1, 0.75, uv().y)));
    m.colorNode = iCol.mul(lit);
    let alpha = dens.mul(iDat.z);
    if (quality.softParticles !== false) {
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(screenUV), cameraNear, cameraFar);
      alpha = alpha.mul(smoothstep(0.0, 0.9, positionView.z.sub(sceneZ)));     // 贴近地面/车身处柔化
    }
    alpha = alpha.mul(smoothstep(0.6, 2.8, positionView.z.negate()));        // 贴脸时淡出
    m.opacityNode = alpha;
    m.mrtNode = mrt({ velocity: vec4(0, 0, 0, 0) });    // 不往速度缓冲里写，否则动态模糊会把贴片范围内的画面抹花
    const sp = this.sprites = new THREE.Sprite(m); sp.count = 0; sp.frustumCulled = false; sp.renderOrder = 10; sp.layers.set(1);
    scene.add(sp);

    // ---------- 胎痕 ----------
    const Q = this.Q = 5200;
    const mp = this.markPos = new Float32Array(Q * 4 * 3), ma = this.markA = new Float32Array(Q * 4);
    const idx = new Uint32Array(Q * 6);
    for (let q = 0; q < Q; q++) idx.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    const g = new THREE.BufferGeometry();
    this.markPosAttr = new THREE.BufferAttribute(mp, 3); this.markPosAttr.setUsage(THREE.DynamicDrawUsage);
    this.markAAttr = new THREE.BufferAttribute(ma, 1); this.markAAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.markPosAttr); g.setAttribute('ink', this.markAAttr); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mm = new THREE.MeshBasicNodeMaterial(); mm.transparent = true; mm.depthWrite = false; mm.side = THREE.DoubleSide; mm.fog = false;
    mm.colorNode = vec3(0.012, 0.012, 0.013); mm.opacityNode = attribute('ink', 'float').mul(0.5);
    mm.polygonOffset = true; mm.polygonOffsetFactor = -4; mm.polygonOffsetUnits = -4;
    const mk = this.marks = new THREE.Mesh(g, mm); mk.frustumCulled = false; mk.renderOrder = 4; mk.layers.set(1);
    scene.add(mk);
    this.markHead = 0; this.trails = new Map();

    // ---------- 车灯光晕：一批加色贴片（位置、大小、颜色每帧由车辆写入），亮度够高，辉光会把它晕开 ----------
    const ML = this.ML = 64; this.nl = 0;
    const lp = this.lPos = new THREE.InstancedBufferAttribute(new Float32Array(ML * 3), 3); lp.setUsage(THREE.DynamicDrawUsage);
    const lc = this.lCol = new THREE.InstancedBufferAttribute(new Float32Array(ML * 4), 4); lc.setUsage(THREE.DynamicDrawUsage);   // rgb + 大小
    const jPos = instancedDynamicBufferAttribute(lp, 'vec3'), jCol = instancedDynamicBufferAttribute(lc, 'vec4');
    const lm = new THREE.SpriteNodeMaterial(); lm.transparent = true; lm.depthWrite = false; lm.fog = false; lm.blending = THREE.AdditiveBlending;
    lm.positionNode = jPos; lm.scaleNode = jCol.w;
    const lr = length(uv().sub(0.5).mul(2)), core = pow(saturate(oneMinus(lr.mul(3.2))), 1.5), halo = pow(saturate(oneMinus(lr)), 3).mul(0.16);
    lm.colorNode = jCol.xyz.mul(core.add(halo)); lm.opacityNode = float(1);
    lm.mrtNode = mrt({ velocity: vec4(0, 0, 0, 0) });
    const ls = this.lamps = new THREE.Sprite(lm); ls.count = 0; ls.frustumCulled = false; ls.renderOrder = 11; ls.layers.set(1); ls.visible = false;
    scene.add(ls);
  }

  beginLamps() { this.nl = 0; }
  addLamp(x, y, z, size, r, g, b) {
    if (this.nl >= this.ML) return; const i = this.nl++;
    this.lPos.setXYZ(i, x, y, z); this.lCol.setXYZW(i, r, g, b, size);
  }
  endLamps() { this.lamps.count = this.nl; this.lamps.visible = this.nl > 0; this.lPos.needsUpdate = true; this.lCol.needsUpdate = true; }

  spawn(x, y, z, vx, vy, vz, size0, size1, life, alpha, kind) {
    let i;
    if (this.n < MAXP) i = this.n++; else { i = 0; let old = -1; const P = this.p; for (let k = 0; k < MAXP; k += 7) { const f = P.age[k] / P.life[k]; if (f > old) { old = f; i = k; } } }
    const P = this.p;
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz; P.age[i] = 0; P.life[i] = life; P.s0[i] = size0; P.s1[i] = size1;
    P.rot[i] = Math.random() * 6.28; P.rv[i] = (Math.random() - 0.5) * 0.9; P.a[i] = alpha; P.seed[i] = Math.random(); P.kind[i] = kind;
  }

  // 每帧：根据每台车的车轮打滑发射粒子、延长胎痕
  emitFromCar(car, dt, isNear) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    const wvx = car.vx * cy - car.vy * sy, wvy = car.vx * sy + car.vy * cy;      // 平面系速度
    let trails = this.trails.get(car); if (!trails) { trails = [null, null, null, null]; this.trails.set(car, trails); }
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i], onRoad = w.surf === SURF.ASPHALT || w.surf === SURF.KERB;
      const slide = w.slide, spd = car.speed;
      // ---- 烟 / 尘 ----
      if (isNear) {
        if (onRoad && slide > 2.2 && i >= 2) {
          const k = Math.min(1, (slide - 2.2) / 9), rate = 22 + 78 * k;
          w._acc = (w._acc || 0) + rate * dt;
          while (w._acc >= 1) {
            w._acc -= 1;
            const j = () => (Math.random() - 0.5);
            this.spawn(w.wx + j() * 0.25, 0.12 + Math.random() * 0.12, -(w.wy + j() * 0.25), wvx * 0.22 + j() * 1.2, 0.5 + Math.random() * 1.1, -(wvy * 0.22) + j() * 1.2,
              0.4 + Math.random() * 0.25, 2.4 + Math.random() * 2.4 + k * 1.2, 1.7 + Math.random() * 1.9, (0.10 + 0.15 * k) * (0.6 + Math.random() * 0.6), 0);
          }
        } else if (!onRoad && spd > 5) {
          const g = w.surf === SURF.GRAVEL, rate = (g ? 26 : 9) * Math.min(1, spd / 25) * (1 + Math.min(3, slide * 0.3));
          w._acc = (w._acc || 0) + rate * dt;
          while (w._acc >= 1) {
            w._acc -= 1; const j = () => (Math.random() - 0.5);
            this.spawn(w.wx + j() * 0.3, 0.15, -(w.wy + j() * 0.3), wvx * 0.3 + j() * 1.5, 0.8 + Math.random() * 1.2, -(wvy * 0.3) + j() * 1.5, 0.5, 2.2 + Math.random() * 2, 1.4 + Math.random() * 1.4, g ? 0.34 : 0.16, g ? 1 : 2);
          }
        } else if (onRoad && w.wet > 0.35 && spd > 14) {       // 压过积水的水雾
          w._acc = (w._acc || 0) + 22 * w.wet * Math.min(1, spd / 40) * dt;
          while (w._acc >= 1) {
            w._acc -= 1; const j = () => (Math.random() - 0.5);
            this.spawn(w.wx - cy * 0.3 + j() * 0.2, 0.18, -(w.wy - sy * 0.3 + j() * 0.2), wvx * 0.55 + j(), 0.9 + Math.random() * 1.3, -(wvy * 0.55) + j(), 0.3, 1.3 + Math.random() * 0.9, 0.5 + Math.random() * 0.45, 0.11, 3);
          }
        }
      }
      // ---- 胎痕 ----
      const ink = onRoad ? Math.min(1, Math.max(0, (slide - 2.0) / 9)) * (1 - 0.5 * w.wet) : 0;
      let tr = trails[i];
      if (ink > 0.03) {
        const hw = 0.115, lx = -sy, ly = cy;       // 车身左向
        const ax = w.wx + lx * hw, ay = w.wy + ly * hw, bx = w.wx - lx * hw, by = w.wy - ly * hw;
        if (!tr) { trails[i] = { ax, ay, bx, by, ink: 0, x: w.wx, y: w.wy }; }
        else if (Math.hypot(w.wx - tr.x, w.wy - tr.y) > 0.28) {
          const q = this.markHead; this.markHead = (q + 1) % this.Q;
          const mp = this.markPos, ma = this.markA, o = q * 12, Y = 0.008;
          mp[o] = tr.ax; mp[o + 1] = Y; mp[o + 2] = -tr.ay; mp[o + 3] = tr.bx; mp[o + 4] = Y; mp[o + 5] = -tr.by;
          mp[o + 6] = ax; mp[o + 7] = Y; mp[o + 8] = -ay; mp[o + 9] = bx; mp[o + 10] = Y; mp[o + 11] = -by;
          ma[q * 4] = ma[q * 4 + 1] = tr.ink; ma[q * 4 + 2] = ma[q * 4 + 3] = ink;
          this.markDirty = true;
          tr.ax = ax; tr.ay = ay; tr.bx = bx; tr.by = by; tr.ink = ink; tr.x = w.wx; tr.y = w.wy;
        }
      } else if (tr) trails[i] = null;
    }
  }

  update(dt, camera) {
    const P = this.p; let n = this.n;
    const wind = 0.6;
    for (let i = 0; i < n; i++) {
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) {   // 用最后一个填补
        n--; for (const k in P) P[k][i] = P[k][n]; i--; continue;
      }
      const drag = Math.exp(-dt * (P.kind[i] === 3 ? 2.2 : 1.5));
      P.vx[i] = (P.vx[i] - wind) * drag + wind; P.vz[i] *= drag; P.vy[i] = P.vy[i] * drag + (P.kind[i] === 0 ? 0.35 : -0.5) * dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt; P.rot[i] += P.rv[i] * dt;
    }
    this.n = n;
    // 由远到近排序
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, ord = this.order, dist = this.dist;
    for (let i = 0; i < n; i++) { ord[i] = i; const dx = P.x[i] - cx, dy = P.y[i] - cy, dz = P.z[i] - cz; dist[i] = dx * dx + dy * dy + dz * dz; }
    const sub = ord.subarray(0, n); sub.sort((a, b) => dist[b] - dist[a]);
    const pa = this.posA.array, da = this.datA.array, ca = this.colA.array;
    for (let k = 0; k < n; k++) {
      const i = sub[k], t = P.age[i] / P.life[i];
      const size = P.s0[i] + (P.s1[i] - P.s0[i]) * (1 - Math.pow(1 - t, 2.2));
      const y = Math.max(P.y[i], size * 0.36);
      pa[k * 3] = P.x[i]; pa[k * 3 + 1] = y; pa[k * 3 + 2] = P.z[i];
      const dc = Math.sqrt(dist[i]), nearK = Math.min(1, Math.max(0, (dc - size * 0.55 - 0.6) / (size * 0.9 + 2.5)));
      const fade = Math.min(1, t * 9) * Math.pow(1 - t, 1.25) * nearK * nearK;
      da[k * 4] = size; da[k * 4 + 1] = P.rot[i]; da[k * 4 + 2] = P.a[i] * fade; da[k * 4 + 3] = P.seed[i];
      const kind = P.kind[i];
      const sh = 0.72 + 0.33 * ((P.seed[i] * 7.31) % 1);       // 每团烟明暗略有差别，叠在一起才有层次
      if (kind === 0) { ca[k * 3] = 0.93 * sh; ca[k * 3 + 1] = 0.93 * sh; ca[k * 3 + 2] = 0.95 * sh; }
      else if (kind === 1) { ca[k * 3] = 0.70; ca[k * 3 + 1] = 0.60; ca[k * 3 + 2] = 0.46; }
      else if (kind === 2) { ca[k * 3] = 0.50; ca[k * 3 + 1] = 0.47; ca[k * 3 + 2] = 0.36; }
      else { ca[k * 3] = 0.9; ca[k * 3 + 1] = 0.92; ca[k * 3 + 2] = 0.95; }
    }
    this.sprites.count = n; this.sprites.visible = n > 0;
    this.posA.needsUpdate = true; this.datA.needsUpdate = true; this.colA.needsUpdate = true;
    if (this.markDirty) { this.markPosAttr.needsUpdate = true; this.markAAttr.needsUpdate = true; this.markDirty = false; }
  }
  clear() { this.n = 0; this.markPos.fill(0); this.markA.fill(0); this.markDirty = true; this.trails.clear(); }
}
