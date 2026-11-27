// 特效：烟尘团、枪口火光（含卷帘快门条带）、弹孔、碎屑、弹壳。参数沿用影片里的设置。
import * as THREE from 'three';
import { FLOOR_Z, GROUND_Z } from './config.js';
import { L, LIGHT_GLSL } from './world.js';
import { LAYER } from './viewmodel.js';

const rand = (a, b) => a + Math.random() * (b - a);
const MAXP = 420;

export class FX {
  constructor(world) {
    this.world = world; this.scene = world.scene; this.time = 0;
    const tl = new THREE.TextureLoader();
    const T = (u, srgb = true) => { const t = tl.load(u); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
    this.tPuff = T('./assets/fx/puff_atlas.png'); this.tStar = T('./assets/fx/flash_star_atlas.png'); this.tSide = T('./assets/fx/flash_side_atlas.png'); this.tHole = T('./assets/fx/hole_atlas.png');
    this._initPuffs(); this._initFlashes(); this._initDecals(); this._initChips(); this._initShells();
    this.flashes = [];        // 正在亮的火光（最多两个同时生效）
    this.onShellBounce = null;
  }

  // ------------------------------------------------------------ 烟尘
  _initPuffs() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);   // xyz + 尺寸
    this.pB = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);   // rgb + 透明度
    this.pC = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);   // 旋转 + 图集格 + 是否受枪灯照射
    for (const a of [this.pA, this.pB, this.pC]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this.pA); g.setAttribute('iB', this.pB); g.setAttribute('iC', this.pC);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...L, tMap: { value: this.tPuff }, uAmbient: { value: 0.5 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec4 iA; attribute vec4 iB; attribute vec3 iC;
        varying vec2 vUv; varying vec4 vCol; varying vec3 vWP; varying vec3 vVP; varying float vWl;
        void main(){
          float c = cos(iC.x), s = sin(iC.x);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iA.w;
          vec4 vp = viewMatrix * vec4(iA.xyz, 1.0); vp.xy += p;       // 始终正对相机
          vVP = vp.xyz; vWP = iA.xyz; vCol = iB; vWl = iC.z;
          float cell = iC.y; vUv = (uv + vec2(mod(cell, 4.0), floor(cell / 4.0))) / vec2(4.0, 2.0);
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform float uAmbient; uniform float uPuffEmit; uniform float uK; uniform vec3 uTint;
        varying vec2 vUv; varying vec4 vCol; varying vec3 vWP; varying vec3 vVP; varying float vWl;
        ${LIGHT_GLSL}
        void main(){
          vec4 t = texture2D(tMap, vec2(vUv.x, 1.0 - vUv.y));
          float a = t.a * vCol.a; if (a < 0.003) discard;
          vec3 alb = t.rgb * vCol.rgb;
          vec3 col = alb * (uAmbient * uK * uTint + uPuffEmit) + alb * wlLightIso(vWP) * vWl * 0.31831;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.puffMesh = new THREE.Mesh(g, m); this.puffMesh.frustumCulled = false; this.puffMesh.layers.set(LAYER.DYN); this.puffMesh.renderOrder = 20;
    this.scene.add(this.puffMesh);
    this.puffs = [];
  }

  // 一团烟尘（参数含义同影片里的 fx.burst）
  burst(origin, normal, o = {}) {
    const n = o.n ?? 7, speed = o.speed ?? 3.5, spread = o.spread ?? 0.55, size0 = o.size0 ?? 0.1, size1 = o.size1 ?? 0.7,
      life = (o.life ?? 70) / 30, color = o.color ?? [0.82, 0.8, 0.76], alpha = o.alpha ?? 0.5, rise = o.rise ?? -0.04, drag = o.drag ?? 0.13, grow = o.grow ?? 0.05, wl = o.wl ?? 0;
    const nn = new THREE.Vector3().copy(normal).normalize();
    for (let i = 0; i < n; i++) {
      if (this.puffs.length >= MAXP) this.puffs.shift();
      const d = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread).add(nn).normalize();
      const tint = rand(0.88, 1.08);
      this.puffs.push({
        o: origin.clone(), v: d.multiplyScalar(speed * rand(0.35, 1.0)), born: this.time + (i < n / 2 ? 0 : rand(0, 0.033)),
        s0: size0 * rand(0.7, 1.3), s1: size1 * rand(0.6, 1.25), a0: alpha * rand(0.6, 1.0), life: life * rand(0.7, 1.15),
        col: [color[0] * tint, color[1] * tint, color[2] * tint], rot: rand(0, 6.283), cell: Math.floor(Math.random() * 8), rise, drag, grow, wl,
      });
    }
  }

  _updatePuffs(camera) {
    const A = this.pA.array, B = this.pB.array, C = this.pC.array; let k = 0;
    this.puffs = this.puffs.filter((p) => this.time - p.born < p.life);
    // 远的先画
    const cp = camera.position;
    for (const p of this.puffs) {
      const t = Math.max(0, this.time - p.born); const e = p.drag * (1 - Math.exp(-t / p.drag));
      p.x = p.o.x + p.v.x * e; p.y = p.o.y + p.v.y * e + p.rise * t; p.z = p.o.z + p.v.z * e;
      p.d2 = (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2; p.t = t;
    }
    this.puffs.sort((a, b) => b.d2 - a.d2);
    for (const p of this.puffs) {
      const t = p.t; if (this.time < p.born) continue;
      const sz = p.s0 + (p.s1 - p.s0) * (1 - Math.exp(-t / 0.30)) + p.grow * t;
      const a = p.a0 * Math.min(1, (t * 30 + 0.6) / 1.6) * Math.exp(-t / (p.life / 2.6)) * Math.min(1, (p.life - t) / 0.1);
      A[k * 4] = p.x; A[k * 4 + 1] = p.y; A[k * 4 + 2] = p.z; A[k * 4 + 3] = sz;
      B[k * 4] = p.col[0]; B[k * 4 + 1] = p.col[1]; B[k * 4 + 2] = p.col[2]; B[k * 4 + 3] = a;
      C[k * 3] = p.rot; C[k * 3 + 1] = p.cell; C[k * 3 + 2] = p.wl; k++;
    }
    this.puffMesh.geometry.instanceCount = k;
    this.pA.needsUpdate = this.pB.needsUpdate = this.pC.needsUpdate = true;
  }

  // ------------------------------------------------------------ 枪口火光
  _flashMat(tex, cols, rows) {
    return new THREE.ShaderMaterial({
      uniforms: { ...L, tMap: { value: tex }, uCell: { value: new THREE.Vector4(0, 0, cols, rows) }, uStrength: { value: 40 }, uBandIdx: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vVP; void main(){ vUv = uv; vec4 vp = modelViewMatrix * vec4(position, 1.0); vVP = vp.xyz; gl_Position = projectionMatrix * vp; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform vec4 uCell; uniform float uStrength; uniform int uBandIdx; varying vec2 vUv; varying vec3 vVP;
        ${LIGHT_GLSL}
        void main(){
          vec2 uv = (vec2(vUv.x, 1.0 - vUv.y) + uCell.xy) / uCell.zw;
          vec4 t = texture2D(tMap, uv);
          float band = uBandIdx == 0 ? flashBand(0, outRow(vVP)) : flashBand(1, outRow(vVP));
          float a = t.a * band; if (a < 0.004) discard;
          gl_FragColor = vec4(t.rgb * uStrength, a);
        }`,
    });
  }
  _initFlashes() {
    const quad = new THREE.PlaneGeometry(1, 1);
    // 我方：两片沿枪管的喷焰 + 一片正对后方的星形，挂在持枪手臂下
    this.pFlash = new THREE.Group(); this.pFlash.visible = false;
    this.pSide = [0, 1].map(() => { const m = new THREE.Mesh(quad, this._flashMat(this.tSide, 4, 1)); m.layers.set(LAYER.DYN); m.frustumCulled = false; this.pFlash.add(m); return m; });
    this.pStar = new THREE.Mesh(quad, this._flashMat(this.tStar, 4, 2)); this.pStar.layers.set(LAYER.DYN); this.pStar.frustumCulled = false; this.pFlash.add(this.pStar);
    // 敌人：正对相机的大小两层星形
    this.eFlash = [0, 1].map(() => { const m = new THREE.Mesh(quad, this._flashMat(this.tStar, 4, 2)); m.layers.set(LAYER.DYN); m.frustumCulled = false; m.visible = false; m.material.uniforms.uBandIdx.value = 1; this.scene.add(m); return m; });
  }
  attachPlayerFlash(vmGroup, muzzleLocal) { vmGroup.add(this.pFlash); this.pFlash.position.copy(muzzleLocal); }

  _band() { const h = rand(0.34, 0.62), y0 = rand(-0.15, 1 - h * 0.75); return [y0, y0 + h]; }

  // 我方开火：showSprite=false 时只有光没有可见火焰（白天手枪火光常拍不到）
  playerFlash(muzzleWorld, forward, energy, showSprite = true, dur = 0.030, row = 0.5, size = 1) {
    let b = this._band();
    if (showSprite && Math.random() < 0.8) { const h = b[1] - b[0], y0 = rand(row - h + 0.07, row - 0.07); b = [y0, y0 + h]; }      // 看得到火焰的那几枪：条带要盖住枪口所在的行
    L.uFlashPos.value[0].set(muzzleWorld.x + forward.x * 0.06, muzzleWorld.y + forward.y * 0.06 + 0.015, muzzleWorld.z + forward.z * 0.06, energy);
    L.uFlashBand.value[0].set(b[0], b[1]);
    this.flashes[0] = { until: this.time + dur };
    if (showSprite) {
      const sc = rand(0.5, 0.72) * size;
      this.pSide.forEach((m, i) => {
        const len = 0.14 * sc * rand(0.8, 1.25);
        m.scale.set(len, 0.075 * sc * rand(0.8, 1.2), 1);
        m.rotation.set(0, 0, 0); m.rotateY(Math.PI / 2); m.rotateX(THREE.MathUtils.degToRad(i * 90 + rand(-25, 25)));   // 面片长边沿枪口方向(-Z)
        m.position.set(0, 0, -len * 0.5 + 0.005);
        m.material.uniforms.uCell.value.x = Math.floor(Math.random() * 4); m.material.uniforms.uStrength.value = 38;
      });
      // 镜头在枪的后上方：火光核心抬到套筒上沿之上才拍得到（影片里就是枪口上方一团白光）
      const s = 0.21 * sc * rand(0.85, 1.25);
      this.pStar.scale.set(s, s, s); this.pStar.rotation.set(0, 0, rand(0, 6.283)); this.pStar.position.set(rand(-0.004, 0.004), 0.024 * size, -0.02);
      this.pStar.material.uniforms.uCell.value.set(Math.floor(Math.random() * 4), Math.floor(Math.random() * 2), 4, 2); this.pStar.material.uniforms.uStrength.value = 49;
      this.pFlash.visible = true; this.pFlashUntil = this.time + dur;
    }
  }

  enemyFlash(muzzleWorld, camera, energy, dur = 0.030) {
    const b = this._band();
    L.uFlashPos.value[1].set(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, energy);
    L.uFlashBand.value[1].set(b[0], b[1]);
    this.flashes[1] = { until: this.time + dur };
    this.eFlash.forEach((m, i) => {
      const s = i === 0 ? rand(0.42, 0.62) : rand(0.2, 0.3);
      m.position.copy(muzzleWorld); m.quaternion.copy(camera.quaternion); m.rotateZ(rand(0, 6.283)); m.scale.set(s, s, s);
      m.material.uniforms.uCell.value.set(Math.floor(Math.random() * 4), Math.floor(Math.random() * 2), 4, 2);
      m.material.uniforms.uStrength.value = i === 0 ? 110 : 220; m.visible = true;
    });
    this.eFlashUntil = this.time + dur;
  }

  // ------------------------------------------------------------ 弹孔
  _initDecals() {
    this.decals = []; this.decalIdx = 0;
    const g = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { ...L, tMap: { value: this.tHole }, uCell: { value: 0 } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        vertexShader: `varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)); vec4 vp = viewMatrix * wp; vVP = vp.xyz; gl_Position = projectionMatrix * vp; }`,
        fragmentShader: /* glsl */`
          uniform sampler2D tMap; uniform float uCell; uniform float uK; uniform vec3 uTint; varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP;
          ${LIGHT_GLSL}
          void main(){ vec4 t = texture2D(tMap, vec2((vUv.x + uCell) / 4.0, 1.0 - vUv.y)); if (t.a < 0.01) discard;
            gl_FragColor = vec4(t.rgb * (0.55 * uK * uTint + dynLight(vWP, normalize(vN), vVP) * 0.31831), t.a); }`,
      });
      const d = new THREE.Mesh(g, m); d.visible = false; d.layers.set(LAYER.DYN); d.renderOrder = 5; this.scene.add(d); this.decals.push(d);
    }
  }
  bulletHole(pos, normal, size = 0.085) {
    const d = this.decals[this.decalIdx++ % this.decals.length];
    d.position.copy(pos).addScaledVector(normal, 0.004);
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); d.rotateZ(rand(0, 6.283));
    d.scale.set(size, size, size); d.material.uniforms.uCell.value = Math.floor(Math.random() * 4); d.visible = true;
  }

  // ------------------------------------------------------------ 碎屑
  _initChips() {
    const N = 220; this.chipN = N; this.chips = [];
    const m = new THREE.ShaderMaterial({
      uniforms: { ...L },
      vertexShader: `attribute vec3 iCol; varying vec3 vC; varying vec3 vWP; varying vec3 vN; varying vec3 vVP;
        void main(){ vC = iCol; vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vWP = wp.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vec4 vp = viewMatrix * wp; vVP = vp.xyz; gl_Position = projectionMatrix * vp; }`,
      fragmentShader: /* glsl */`uniform float uK; uniform vec3 uTint; varying vec3 vC; varying vec3 vWP; varying vec3 vN; varying vec3 vVP; ${LIGHT_GLSL}
        void main(){ vec3 N = normalize(vN); gl_FragColor = vec4(vC * ((0.45 + 0.25 * N.y) * uK * uTint + dynLight(vWP, N, vVP) * 0.31831), 1.0); }`,
    });
    this.chipMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), m, N);
    this.chipCol = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.chipMesh.geometry.setAttribute('iCol', this.chipCol);
    this.chipMesh.frustumCulled = false; this.chipMesh.layers.set(LAYER.DYN); this.chipMesh.count = 0; this.scene.add(this.chipMesh);
  }
  chipBurst(origin, normal, n = 12, speed = 4.0, color = [0.74, 0.73, 0.69], floorY = FLOOR_Z) {
    for (let i = 0; i < n; i++) {
      if (this.chips.length >= this.chipN) this.chips.shift();
      const d = new THREE.Vector3(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).multiplyScalar(0.8).add(normal).normalize();
      const s = rand(0.006, 0.022);
      this.chips.push({ p: origin.clone(), v: d.multiplyScalar(speed * rand(0.3, 1.0)), s: new THREE.Vector3(s, s * rand(0.3, 0.8), s * rand(0.4, 1.0)),
        r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), w: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)), rest: false, col: color, floorY });
    }
  }
  _updateChips(dt) {
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(); let k = 0;
    for (const c of this.chips) {
      if (!c.rest) {
        c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt); c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        if (c.p.y <= c.floorY + 0.004) { c.p.y = c.floorY + 0.004; if (Math.abs(c.v.y) < 1.2) c.rest = true; c.v.set(c.v.x * 0.35, -c.v.y * 0.25, c.v.z * 0.35); c.w.multiplyScalar(0.3); }
      }
      M.compose(c.p, Q.setFromEuler(c.r), c.s); this.chipMesh.setMatrixAt(k, M);
      this.chipCol.setXYZ(k, c.col[0], c.col[1], c.col[2]); k++;
    }
    this.chipMesh.count = k; this.chipMesh.instanceMatrix.needsUpdate = true; this.chipCol.needsUpdate = true;
  }

  // ------------------------------------------------------------ 弹壳
  _initShells() {
    this.shells = []; this.shellIdx = 0;
    const g = new THREE.CylinderGeometry(0.0052, 0.0052, 0.0205, 10);
    this.shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.83, 0.62, 0.24), roughness: 0.28, metalness: 1.0 });
    for (let i = 0; i < 20; i++) { const m = new THREE.Mesh(g, this.shellMat); m.visible = false; m.layers.set(LAYER.DYN); m.frustumCulled = false; this.scene.add(m); this.shells.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), b: 9, fy: FLOOR_Z }); }
  }
  setEnvMap(tex) { if (!this.shellMat.envMap) this.shellMat.needsUpdate = true; this.shellMat.envMap = tex; }
  ejectShell(pos, vel, floorY = FLOOR_Z, size = 1) {
    const s = this.shells[this.shellIdx++ % this.shells.length]; s.fy = floorY; s.m.scale.set(size > 1 ? 1.08 : 1, size, size > 1 ? 1.08 : 1);
    s.m.position.copy(pos); s.m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6)); s.m.visible = true;
    s.v.copy(vel); s.w.set(rand(-45, 45), rand(-45, 45), rand(-30, 30)); s.b = 0;
  }
  _updateShells(dt) {
    for (const s of this.shells) {
      if (!s.m.visible || s.b >= 4) continue;
      s.v.y -= 9.8 * dt; s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; s.m.rotation.z += s.w.z * dt;
      if (s.m.position.y <= s.fy + 0.006) {
        s.m.position.y = s.fy + 0.006; s.b++;
        if (this.onShellBounce) this.onShellBounce(s.m.position, s.b);
        s.v.set(s.v.x * 0.45, -s.v.y * 0.32, s.v.z * 0.45); s.w.multiplyScalar(0.5);
        if (Math.abs(s.v.y) < 0.5) s.b = 4;
      }
    }
  }

  // ------------------------------------------------------------ 成套的弹着效果
  impact(pos, normal, kind, big = 1) {
    const p = pos.clone().addScaledVector(normal, 0.03);
    if (kind === 'floor') {
      const n = new THREE.Vector3(0, 1, 0);
      this.burst(p, n, { n: Math.round(13 * big), speed: 4.6 * big, spread: 0.6, size0: 0.12, size1: 0.70 * big, life: 110, color: [0.80, 0.74, 0.66], alpha: 0.32, rise: -0.03, wl: 1 });
      this.chipBurst(p, n, 16, 4.0, [0.45, 0.4, 0.35], pos.y);
      this.bulletHole(pos, n, 0.07);
    } else if (kind === 'ground') {
      const n = new THREE.Vector3(0, 1, 0);
      this.burst(p, n, { n: 6, speed: 3.2, spread: 0.5, size0: 0.1, size1: 0.6, life: 80, color: [0.62, 0.58, 0.5], alpha: 0.5 });
      this.chipBurst(p, n, 8, 3.0, [0.5, 0.48, 0.44], GROUND_Z);
    } else {
      this.burst(p, normal, { n: Math.round(14 * big), speed: 5.5, spread: 0.6, size0: 0.10, size1: 0.62 * big, life: 95, color: [1.0, 0.98, 0.95], alpha: 0.30, rise: -0.05, wl: 1 });
      this.chipBurst(p, normal, 14, 4.5, undefined, this.floorAt ? this.floorAt(pos) : FLOOR_Z);
      this.bulletHole(pos, normal, 0.10);
    }
  }
  bodyHit(pos, dir) { this.burst(pos, dir, { n: 4, speed: 1.6, spread: 0.5, size0: 0.05, size1: 0.30, life: 30, color: [0.52, 0.53, 0.48], alpha: 0.38 }); }
  // 子弹入水、人跳进水里溅起的水花
  splash(pos, k = 1) { this.burst(pos.clone().add(new THREE.Vector3(0, 0.04, 0)), new THREE.Vector3(0, 1, 0), { n: Math.round(9 * k), speed: 2.6 * Math.sqrt(k), spread: 0.5, size0: 0.035, size1: 0.3 * k, life: 17, color: [0.8, 0.9, 0.92], alpha: 0.42, rise: -0.3, drag: 0.05, wl: 1 }); }
  gunSmoke(pos, forward) {
    const d = forward.clone(); d.y += 0.25;
    this.burst(pos.clone().addScaledVector(forward, 0.05), d, { n: 3, speed: 2.2, spread: 0.3, size0: 0.05, size1: 0.42, life: 34, color: [0.78, 0.8, 0.84], alpha: 0.055, rise: 0.10 });
  }

  update(dt, camera) {
    this.time += dt;
    // 火光至少要被画出来一帧（开火发生在这一帧的逻辑更新里，随后才渲染），之后到时间就灭
    for (let i = 0; i < 2; i++) {
      const f = this.flashes[i]; if (!f) continue;
      if (f.shown && this.time >= f.until) {
        L.uFlashPos.value[i].w = 0; L.uFlashBand.value[i].set(-1, 2); this.flashes[i] = null;
        if (i === 0) this.pFlash.visible = false; else this.eFlash.forEach((m) => (m.visible = false));
      } else f.shown = true;
    }
    this._updatePuffs(camera); this._updateChips(dt); this._updateShells(dt);
  }
  clear() { for (let i = 0; i < 2; i++) { L.uFlashPos.value[i].w = 0; this.flashes[i] = null; } this.pFlash.visible = false; this.eFlash.forEach((m) => (m.visible = false)); this.puffs.length = 0; this.chips.length = 0; this.decals.forEach((d) => (d.visible = false)); this.shells.forEach((s) => (s.m.visible = false)); }
}
