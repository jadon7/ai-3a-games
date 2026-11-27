// 特效：粒子、曳光弹、光束、弹孔/焦痕贴花、动态闪光、弹壳、钩索、环境尘埃、巴扎光柱
import * as THREE from 'three';
import { canvasTex, mulberry32 } from '../gfx/texgen.js';
import { ATMOS } from '../gfx/sky.js';
import { SUNSH, SUNSH_GLSL } from '../gfx/post.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);

function atlasTexture() {
  return canvasTex(1024, 512, (g) => {
    const R = mulberry32(5);
    const tile = (i, fn) => { g.save(); g.translate((i % 4) * 256 + 128, Math.floor(i / 4) * 256 + 128); fn(); g.restore(); };
    const radial = (r, stops) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); };
    tile(0, () => radial(124, [[0, 0.9], [0.4, 0.55], [0.75, 0.16], [1, 0]]));
    tile(1, () => { for (let k = 0; k < 16; k++) { g.save(); const a = R() * 6.28, d = R() * 58; g.translate(Math.cos(a) * d, Math.sin(a) * d); radial(34 + R() * 30, [[0, 0.5], [0.55, 0.22], [1, 0]]); g.restore(); } });
    tile(2, () => radial(120, [[0, 1], [0.08, 0.95], [0.22, 0.3], [0.5, 0.06], [1, 0]]));
    tile(3, () => { radial(110, [[0, 1], [0.2, 0.5], [0.6, 0.1], [1, 0]]); g.fillStyle = 'rgba(255,255,255,0.85)'; for (let k = 0; k < 7; k++) { g.save(); g.rotate(k / 7 * 6.28 + R()); g.beginPath(); g.moveTo(0, -9); g.lineTo(100 + R() * 22, 0); g.lineTo(0, 9); g.fill(); g.restore(); } });
    tile(4, () => { g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28, r = 60 + R() * 50; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill(); });
    tile(5, () => { for (let k = 0; k < 6; k++) { g.strokeStyle = `rgba(255,255,255,${0.16})`; g.lineWidth = 26 - k * 4; g.beginPath(); g.arc(0, 0, 100, 0, 7); g.stroke(); } });
    tile(6, () => radial(126, [[0, 0.7], [0.3, 0.32], [0.65, 0.08], [1, 0]]));
    tile(7, () => { g.scale(1, 0.14); radial(124, [[0, 1], [0.3, 0.6], [1, 0]]); });
  }, { srgb: false });
}

class Particles {
  constructor(max, additive, atlas) {
    this.max = max; this.n = 0; this.p = [];
    const g = this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aDat = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);   // size, rot, tile
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aData', this.aDat);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tMap: { value: null }, uScale: { value: 800 } }]),
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute vec3 aData; uniform float uScale;
        varying vec4 vColor; varying vec2 vRT;
        #include <fog_pars_vertex>
        void main(){
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aData.x * uScale / max(0.05, -mvPosition.z), 0.0, 1400.0);
          vColor = aColor; vRT = aData.yz;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; varying vec4 vColor; varying vec2 vRT;
        #include <fog_pars_fragment>
        void main(){
          vec2 p = gl_PointCoord - 0.5; float c = cos(vRT.x), s = sin(vRT.x);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          if (max(abs(p.x), abs(p.y)) > 0.5) discard;
          float tile = floor(vRT.y + 0.5);
          vec2 uv = (vec2(mod(tile, 4.0), 1.0 - floor(tile / 4.0)) + vec2(p.x + 0.5, 0.5 - p.y)) / vec2(4.0, 2.0);
          float a = texture2D(tMap, uv).a;
          ${additive ? 'gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);' : 'gl_FragColor = vec4(vColor.rgb, a * vColor.a);'}
          ${additive ? '' : '#include <fog_fragment>'}
        }`,
      transparent: true, depthWrite: false, fog: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mat.uniforms.tMap.value = atlas;
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
  }
  // o: {x,y,z,vx,vy,vz,life,s0,s1,r,g,b,a,tile,grav,drag,rot,vrot,fadeIn}
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    o.t = 0; o.rot = o.rot === undefined ? Math.random() * 6.28 : o.rot; o.vrot = o.vrot || 0; o.grav = o.grav || 0; o.drag = o.drag || 0; o.fadeIn = o.fadeIn || 0; o.s1 = o.s1 === undefined ? o.s0 : o.s1; o.a = o.a === undefined ? 1 : o.a;
    this.p.push(o);
  }
  update(dt) {
    const P = this.p, pos = this.aPos.array, col = this.aCol.array, dat = this.aDat.array; let n = 0;
    for (let i = 0; i < P.length; i++) {
      const o = P[i]; o.t += dt; if (o.t >= o.life) continue;
      const k = Math.exp(-o.drag * dt); o.vx *= k; o.vy = o.vy * k - o.grav * dt; o.vz *= k;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; o.rot += o.vrot * dt;
      if (o.floor !== undefined && o.y < o.floor) { o.y = o.floor; o.vy = -o.vy * 0.3; o.vx *= 0.6; o.vz *= 0.6; }
      const u = o.t / o.life;
      let a = o.a * (1 - u * u); if (o.fadeIn > 0 && u < o.fadeIn) a *= u / o.fadeIn;
      pos[n * 3] = o.x; pos[n * 3 + 1] = o.y; pos[n * 3 + 2] = o.z;
      if (o.r1 !== undefined) { col[n * 4] = o.r + (o.r1 - o.r) * u; col[n * 4 + 1] = o.g + (o.g1 - o.g) * u; col[n * 4 + 2] = o.b + (o.b1 - o.b) * u; } else { col[n * 4] = o.r; col[n * 4 + 1] = o.g; col[n * 4 + 2] = o.b; }
      col[n * 4 + 3] = a;
      dat[n * 3] = o.s0 + (o.s1 - o.s0) * (o.ease ? 1 - (1 - u) * (1 - u) : u); dat[n * 3 + 1] = o.rot; dat[n * 3 + 2] = o.tile;
      P[n++] = o;
    }
    P.length = n; this.geo.setDrawRange(0, n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aDat.needsUpdate = true;
  }
}

export class FX {
  constructor(game) {
    this.game = game; const scene = this.scene = game.engine.scene;
    this.atlas = atlasTexture();
    this.alpha = new Particles(1400, false, this.atlas); this.add = new Particles(1600, true, this.atlas);
    scene.add(this.alpha.points); scene.add(this.add.points);
    this.dustCol = [0.80, 0.66, 0.46];

    // 动态点光源池
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 16, 2); l.userData = { t: 0, dur: 0.1, peak: 0 }; scene.add(l); this.lights.push(l); }

    // 曳光弹
    const streak = canvasTex(128, 16, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const g2 = g.createLinearGradient(0, 0, 0, h); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = g2; g.fillRect(0, 0, w, h); }, { srgb: false });
    const quad = new THREE.PlaneGeometry(1, 1);
    this.tracers = [];
    for (let i = 0; i < 56; i++) {
      const m = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: streak, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, color: 0xffffff }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 7; scene.add(m); this.tracers.push({ m, on: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, head: 0, speed: 300, len: 7, w: 0.04 });
    }
    // 光束
    const beamTex = canvasTex(8, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { srgb: false });
    this.beams = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 7; scene.add(m); this.beams.push({ m, on: false, t: 0, life: 0.2, a: new THREE.Vector3(), b: new THREE.Vector3(), w: 0.1, col: new THREE.Color(), hdr: 1, hold: false });
    }
    // 贴花
    const holeTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(8,6,5,1)'); gr.addColorStop(0.28, 'rgba(14,11,9,0.95)'); gr.addColorStop(0.45, 'rgba(60,50,40,0.6)'); gr.addColorStop(0.75, 'rgba(120,105,85,0.25)'); gr.addColorStop(1, 'rgba(120,105,85,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const scorchTex = canvasTex(256, 256, (g) => { const R = mulberry32(9); for (let k = 0; k < 40; k++) { const a = R() * 6.28, d = R() * 70, r = 30 + R() * 60; const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(10,8,6,0.22)'); gr.addColorStop(1, 'rgba(10,8,6,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); } });
    const mkDecal = (tex, n) => {
      const im = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), n);
      im.frustumCulled = false; im.renderOrder = 3; im.count = n; _m.makeScale(0, 0, 0); for (let i = 0; i < n; i++) im.setMatrixAt(i, _m); im.instanceMatrix.needsUpdate = true; scene.add(im);
      return { im, i: 0, n };
    };
    this.holes = mkDecal(holeTex, 260); this.scorch = mkDecal(scorchTex, 36);

    // 弹壳
    this.shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.35 }), 40);
    this.shellMesh.frustumCulled = false; this.shellMesh.castShadow = false; scene.add(this.shellMesh);
    this.shells = []; for (let i = 0; i < 40; i++) { this.shells.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), life: 0, floor: 0 }); _m.makeScale(0, 0, 0); this.shellMesh.setMatrixAt(i, _m); }
    this.shellI = 0;

    // 钩索：细编织缆绳（逐帧更新的管状网格，带垂度与甩动）+ 三爪钩头
    this.ropeN = 26; this.ropeS = 6;
    { const N = this.ropeN, S = this.ropeS; const g = new THREE.BufferGeometry(); const cnt = (N + 1) * S;
      this.ropePos = new Float32Array(cnt * 3); this.ropeNrm = new Float32Array(cnt * 3); const uv = new Float32Array(cnt * 2); const idx = [];
      for (let i = 0; i <= N; i++) for (let k = 0; k < S; k++) { uv[(i * S + k) * 2] = k / S; uv[(i * S + k) * 2 + 1] = i; }
      for (let i = 0; i < N; i++) for (let k = 0; k < S; k++) { const a = i * S + k, b = i * S + (k + 1) % S, c = a + S, d = b + S; idx.push(a, c, b, b, c, d); }
      g.setAttribute('position', new THREE.BufferAttribute(this.ropePos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('normal', new THREE.BufferAttribute(this.ropeNrm, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const braid = canvasTex(32, 32, (c) => { c.fillStyle = '#3a3b3e'; c.fillRect(0, 0, 32, 32); c.strokeStyle = '#8a8c90'; c.lineWidth = 5; for (let k = -2; k < 4; k++) { c.beginPath(); c.moveTo(k * 16, 0); c.lineTo(k * 16 + 32, 32); c.stroke(); } c.strokeStyle = '#17181a'; c.lineWidth = 2; for (let k = -2; k < 4; k++) { c.beginPath(); c.moveTo(k * 16 + 8, 0); c.lineTo(k * 16 + 40, 32); c.stroke(); } }, { repeat: true });
      braid.repeat.set(2, 1);
      this.rope = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: braid, roughness: 0.8, metalness: 0.15, color: 0x9a9ca0 }));
      this.rope.visible = false; this.rope.frustumCulled = false; this.rope.castShadow = true; scene.add(this.rope); }
    { const hm = new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.38, metalness: 1 }); const hk = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.11, 8), hm); shaft.position.y = -0.055; hk.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 8), hm); tip.position.y = 0.015; hk.add(tip);
      for (let k = 0; k < 3; k++) { const claw = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0055, 6, 10, Math.PI * 0.85), hm); const piv = new THREE.Group(); piv.rotation.y = k * Math.PI * 2 / 3; claw.position.set(0.034, -0.012, 0); claw.rotation.z = Math.PI * 0.08; piv.add(claw); hk.add(piv); }
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 3.0), fog: false })); glow.position.y = -0.085; hk.add(glow);
      this.hook = hk; hk.visible = false; hk.traverse((o) => { o.frustumCulled = false; }); scene.add(hk); }

    // 冲击波环（贴地）
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 6; scene.add(m); this.rings.push({ m, on: false, t: 0, life: 1, r: 10 });
    }
    this._initAmbient();
  }

  _initAmbient() {
    // 空气中的浮尘：远层稀疏、随风飘；近层细密、缓慢打转，只在室内明显 —— 光柱里能看到尘埃在飞
    const mkMotes = (N, C, wind, s0, s1, near) => {
      const g = new THREE.BufferGeometry(); const seed = new Float32Array(N * 3); for (let i = 0; i < N * 3; i++) seed[i] = Math.random();
      g.setAttribute('position', new THREE.BufferAttribute(seed, 3)); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uScale: { value: 800 }, uGain: { value: 1 }, ...SUNSH },
        vertexShader: /* glsl */`
          ${SUNSH_GLSL}
          uniform vec3 uCam; uniform float uTime; uniform float uScale; uniform float uGain; varying float vA;
          void main(){
            vec3 s = position; const float C = ${C.toFixed(1)};
            vec3 p = s * C + vec3(uTime * ${(0.45 * wind).toFixed(3)} + sin(uTime * 0.31 + s.z * 31.0) * ${near ? '0.22' : '0.0'}, sin(uTime * 0.25 + s.x * 20.0) * 0.4 - uTime * 0.02, uTime * ${(0.16 * wind).toFixed(3)} + cos(uTime * 0.27 + s.y * 27.0) * ${near ? '0.22' : '0.0'});
            p = mod(p - uCam, C) - C * 0.5;
            vec4 mv = viewMatrix * vec4(uCam + p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            gl_PointSize = clamp((${s0.toFixed(4)} + ${s1.toFixed(4)} * s.y) * uScale / max(d, 0.3), 1.0, ${near ? '5.0' : '7.0'});
            vA = smoothstep(C * 0.5, C * 0.31, length(p)) * smoothstep(${near ? '0.3, 1.1' : '0.4, 2.0'}, d) * (0.35 + 0.65 * fract(s.z * 7.3 + uTime * 0.2 * s.x)) * uGain;
            vA *= mix(${near ? '0.0' : '0.05'}, 1.5, sunVisAir(uCam + p, d));   // 浮尘只在阳光里闪亮，阴影里几乎看不见
          }`,
        fragmentShader: /* glsl */`
          varying float vA;
          void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, r) * vA; gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * 0.9, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 4; this.scene.add(pts);
      return pts;
    };
    this.motes = mkMotes(1600, 26, 1, 0.010, 0.022, false); this.moteMat = this.motes.material;
    this.motesNear = mkMotes(2600, 9, 0.12, 0.0045, 0.0085, true); this.moteNearMat = this.motesNear.material; this.indoor = 0;
    // 贴地流动的风沙
    const NW = 240; const wg = new THREE.BufferGeometry(); const ws = new Float32Array(NW * 3); for (let i = 0; i < NW * 3; i++) ws[i] = Math.random();
    wg.setAttribute('position', new THREE.BufferAttribute(ws, 3)); wg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.wispMat = new THREE.ShaderMaterial({
      uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uScale: { value: 800 } },
      vertexShader: /* glsl */`
        uniform vec3 uCam; uniform float uTime; uniform float uScale; varying float vA;
        void main(){
          vec3 s = position; vec2 wind = vec2(0.92, 0.38);
          vec2 xz = s.xz * 64.0 + wind * uTime * (2.2 + 2.8 * s.y) + vec2(sin(uTime * 0.3 + s.x * 30.0), cos(uTime * 0.23 + s.z * 30.0)) * 1.5;
          xz = mod(xz - uCam.xz, 64.0) - 32.0;
          float y = 0.10 + s.y * s.y * 1.2 + sin(uTime * 0.7 + s.z * 40.0) * 0.07;
          vec4 mv = viewMatrix * vec4(uCam.x + xz.x, y, uCam.z + xz.y, 1.0);
          gl_Position = projectionMatrix * mv; float d = -mv.z;
          gl_PointSize = clamp((0.8 + 1.7 * s.x) * uScale / max(d, 0.5), 2.0, 420.0);
          float gust = 0.5 + 0.5 * sin(uTime * 0.35 + s.x * 6.0 + (uCam.x + xz.x) * 0.06);
          vA = smoothstep(32.0, 20.0, length(xz)) * smoothstep(1.5, 5.0, d) * (0.25 + 0.75 * gust) * 0.10;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vec3(0.95, 0.80, 0.58), a * a * vA); }`,
      transparent: true, depthWrite: false,
    });
    this.wisps = new THREE.Points(wg, this.wispMat); this.wisps.frustumCulled = false; this.wisps.renderOrder = 4; this.scene.add(this.wisps);
  }

  // ---- 烟柱：绕竖轴朝向相机的面片 + 向上滚动的噪声。远处是战场的大烟柱，近处是闷烧轮胎堆的黑烟 ----
  addSmoke(spots) {
    const noise = this.game.engine.T.macro.map; const wind = new THREE.Vector2(0.92, 0.38).normalize();
    const geo = new THREE.PlaneGeometry(1, 1, 1, 20); geo.translate(0.5, 0.5, 0);   // uv 与顶点同为 0..1
    this.smokes = [];
    const mk = (x, y, z, w, h, o) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tNoise: { value: noise }, uTime: { value: 0 }, uSize: { value: new THREE.Vector2(w, h) }, uLean: { value: o.lean }, uWind: { value: wind }, uSeed: { value: Math.random() * 7 }, uSpeed: { value: o.speed }, uBaseW: { value: o.baseW }, uErode: { value: o.erode },
          uDark: { value: new THREE.Vector3(...o.dark) }, uLit: { value: new THREE.Vector3(...o.lit) }, uOpacity: { value: o.opacity }, uSunSide: { value: 0 },
          uFog: { value: new THREE.Vector3(ATMOS.fogColor[0], ATMOS.fogColor[1], ATMOS.fogColor[2]) }, uFogK: { value: o.fogK },
        },
        vertexShader: /* glsl */`
          uniform vec2 uSize; uniform float uLean; uniform vec2 uWind; uniform float uBaseW; varying vec2 vUv; varying float vDist;
          void main(){
            vUv = uv; vec3 base = modelMatrix[3].xyz;
            vec3 toCam = cameraPosition - base; toCam.y = 0.0; vec3 fwd = toCam / max(length(toCam), 1e-3); vec3 right = vec3(fwd.z, 0.0, -fwd.x);
            float v = uv.y; float width = uSize.x * (uBaseW + (1.0 - uBaseW) * pow(v, 0.65));
            vec3 p = base + right * (uv.x - 0.5) * width + vec3(0.0, v * uSize.y, 0.0);
            p.xz += uWind * uLean * pow(v, 1.6) * uSize.y;
            vec4 mv = viewMatrix * vec4(p, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */`
          uniform sampler2D tNoise; uniform float uTime; uniform float uSeed; uniform float uSpeed; uniform vec3 uDark; uniform vec3 uLit; uniform float uOpacity; uniform float uSunSide; uniform vec3 uFog; uniform float uFogK; uniform float uErode;
          varying vec2 vUv; varying float vDist;
          void main(){
            float v = vUv.y; float t = uTime * uSpeed;
            vec2 q = vec2(vUv.x * 0.8 + uSeed, v * 1.6 - t);
            float n1 = texture2D(tNoise, q * vec2(0.55, 0.42)).g;
            float n2 = texture2D(tNoise, q * vec2(1.1, 0.85) + vec2(0.37, - t * 0.6)).b;
            float n = n1 * 0.62 + n2 * 0.38;
            float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float shape = smoothstep(0.02, 0.6, edge + (n - 0.5) * uErode);
            float a = shape * (1.0 - smoothstep(0.5, 1.0, v)) * smoothstep(0.0, 0.05, v) * (0.5 + 0.5 * n) * uOpacity;
            if (a < 0.004) discard;
            float lit = clamp(0.5 + (vUv.x - 0.5) * uSunSide * 1.7 + (n2 - 0.5) * 0.7, 0.0, 1.0);
            vec3 col = mix(uDark, uLit, lit * (0.3 + 0.7 * smoothstep(0.0, 0.7, v)));
            col = mix(col, uFog, 1.0 - exp(- vDist * uFogK));
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.frustumCulled = false; m.renderOrder = 2; this.scene.add(m); this.smokes.push(m);
    };
    // 远处：城外的大烟柱（灰褐色，被风吹斜，融进天边的雾里）
    const far = { lean: 0.42, speed: 0.022, dark: [0.035, 0.033, 0.034], lit: [0.40, 0.33, 0.27], opacity: 0.9, fogK: 0.0019, baseW: 0.2, erode: 1.1 };
    mk(-150, -6, -235, 62, 200, far); mk(215, -6, -125, 46, 150, { ...far, speed: 0.028 }); mk(125, -6, 265, 54, 175, far); mk(-285, -6, 95, 74, 230, { ...far, speed: 0.018, opacity: 0.7 });
    // 近处：轮胎堆的黑烟
    for (const [x, z] of spots) mk(x, 0.2, z, 3.4, 15, { lean: 0.5, speed: 0.15, dark: [0.006, 0.006, 0.007], lit: [0.10, 0.088, 0.08], opacity: 1.0, fogK: 0.004, baseW: 0.42, erode: 0.75 });
  }

  // 巴扎顶棚的体积光柱（与太阳方向平行的斜面片）
  addShafts(regions) {
    const P = [], U = [], N = []; const sd = ATMOS.sunDir; const kz = -sd.z / sd.y, kx = -sd.x / sd.y;
    const nrm = new THREE.Vector3(0, -kz, -1).normalize();
    for (const r of regions) {
      for (let k = 0; k < 9; k++) {
        const zg = r.z0 + 0.96 + k * 0.78; let yb = 0.05, zb = zg + kz * (r.y - 0.05);
        if (zb > r.z1 - 0.1) { zb = r.z1 - 0.1; yb = r.y - (zb - zg) / kz; }
        const xs = kx * (r.y - yb);
        const x0 = r.x0 + 0.5, x1 = r.x1 - 0.5;
        P.push(x0, r.y, zg, x1, r.y, zg, x1 + xs, yb, zb, x0, r.y, zg, x1 + xs, yb, zb, x0 + xs, yb, zb);
        U.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
        for (let i = 0; i < 6; i++) N.push(nrm.x, nrm.y, nrm.z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vW = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
          float nd = abs(dot(V, normalize(vN)));
          float thick = clamp(0.16 / (nd + 0.07), 0.0, 1.8);
          float edge = smoothstep(0.0, 0.08, vUv.y) * (1.0 - 0.75 * vUv.y) * smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x);
          float n = n2(vec2(vW.x * 0.7 + uTime * 0.08, vW.y * 1.3 - uTime * 0.05)) * 0.6 + n2(vec2(vW.x * 2.3 - uTime * 0.11, vW.y * 3.1)) * 0.4;
          float near = smoothstep(0.4, 2.5, dist) * smoothstep(60.0, 25.0, dist);
          gl_FragColor = vec4(vec3(1.0, 0.80, 0.52) * thick * edge * (0.25 + 1.1 * n * n) * near * 0.24, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, this.shaftMat); m.frustumCulled = false; m.renderOrder = 4; this.scene.add(m);
  }

  // ---------- 发射器 ----------
  dustPuff(p, count = 6, size = 0.6, col = this.dustCol, speed = 1.2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, sp = rnd(0.3, 1) * speed;
      this.alpha.spawn({ x: p.x + rnd(-0.2, 0.2), y: p.y + rnd(0.05, 0.3), z: p.z + rnd(-0.2, 0.2), vx: Math.cos(a) * sp, vy: rnd(0.2, 0.9), vz: Math.sin(a) * sp, life: rnd(0.7, 1.5), s0: size * rnd(0.4, 0.7), s1: size * rnd(1.6, 2.6), r: col[0], g: col[1], b: col[2], a: 0.34, tile: 1, drag: 1.6, vrot: rnd(-0.6, 0.6), fadeIn: 0.12, ease: true });
    }
  }
  jetPuff(p) {
    for (let i = 0; i < 7; i++) this.add.spawn({ x: p.x + rnd(-0.15, 0.15), y: p.y + 0.6, z: p.z + rnd(-0.15, 0.15), vx: rnd(-1, 1), vy: rnd(-5, -2.5), vz: rnd(-1, 1), life: rnd(0.18, 0.32), s0: 0.22, s1: 0.5, r: 0.5, g: 0.85, b: 1.4, a: 0.9, tile: 6, drag: 3 });
    this.dustPuff({ x: p.x, y: p.y - 0.1, z: p.z }, 3, 0.4, [0.8, 0.8, 0.82], 0.8);
  }
  sparks(p, n, count = 8, col = [1.6, 1.0, 0.45], speed = 6) {
    for (let i = 0; i < count; i++) {
      _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(); if (n) _v.addScaledVector(n, 1.1).normalize();
      const sp = rnd(0.35, 1) * speed;
      this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: _v.x * sp, vy: _v.y * sp + 1, vz: _v.z * sp, life: rnd(0.18, 0.5), s0: rnd(0.03, 0.07), s1: 0.01, r: col[0], g: col[1], b: col[2], a: 1, tile: 2, grav: 12, drag: 1 });
    }
  }
  // 子弹命中表面
  impact(p, n, surf, scale = 1, decal = true) {
    const cam = this.game.engine.camera.position; const d2 = cam.distanceToSquared(p); if (d2 > 110 * 110) return;
    if (decal && surf !== 'glass' && surf !== 'cloth') this.decal(this.holes, p, n, rnd(0.07, 0.11) * scale);
    if (d2 > 70 * 70) return;
    const cnt = d2 < 30 * 30 ? 4 : 2;
    if (surf === 'metal') { this.sparks(p, n, cnt + 3, [1.7, 1.2, 0.6], 7); this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.07, s0: 0.35 * scale, s1: 0.1, r: 1.6, g: 1.2, b: 0.7, a: 1, tile: 3 }); }
    else {
      const col = surf === 'sand' ? this.dustCol : surf === 'wood' ? [0.55, 0.42, 0.28] : [0.74, 0.68, 0.58];
      for (let i = 0; i < cnt; i++) this.alpha.spawn({ x: p.x + n.x * 0.05, y: p.y + n.y * 0.05, z: p.z + n.z * 0.05, vx: n.x * rnd(0.6, 2.4) + rnd(-0.5, 0.5), vy: n.y * rnd(0.6, 2.4) + rnd(0, 0.8), vz: n.z * rnd(0.6, 2.4) + rnd(-0.5, 0.5), life: rnd(0.45, 1.0), s0: 0.12 * scale, s1: rnd(0.6, 1.0) * scale, r: col[0], g: col[1], b: col[2], a: 0.42, tile: 1, drag: 2.5, ease: true, vrot: rnd(-1, 1) });
      for (let i = 0; i < cnt; i++) { _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).addScaledVector(n, 1.4).normalize(); const sp = rnd(2, 5); this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: _v.x * sp, vy: _v.y * sp + 1, vz: _v.z * sp, life: rnd(0.4, 0.8), s0: rnd(0.02, 0.05) * scale, s1: 0.02, r: col[0] * 0.8, g: col[1] * 0.8, b: col[2] * 0.8, a: 1, tile: 4, grav: 14, vrot: rnd(-8, 8) }); }
      if (surf === 'stone' && Math.random() < 0.3) this.sparks(p, n, 2, [1.5, 1.1, 0.6], 4);
    }
    this.game.audio.play('impact_' + (surf === 'sand' ? 'sand' : surf === 'metal' ? 'metal' : surf === 'wood' ? 'wood' : 'stone'), { x: p.x, y: p.y, z: p.z, volume: 0.6 });
  }
  // 命中装甲士兵 / 机器人
  hitFlesh(p, dir, robot = false) {
    this.sparks(p, null, robot ? 7 : 3, robot ? [1.4, 1.3, 1.0] : [1.5, 0.7, 0.25], 4.5);
    this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: dir.x * 1.5, vy: 0.6, vz: dir.z * 1.5, life: 0.45, s0: 0.15, s1: 0.7, r: robot ? 0.3 : 0.42, g: robot ? 0.3 : 0.10, b: robot ? 0.32 : 0.08, a: 0.5, tile: 1, drag: 3, ease: true });
  }
  decal(d, p, n, size) {
    _q.setFromUnitVectors(Z, n); _v2.set(0, 0, 1); _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v2, Math.random() * 6.28));
    _m.compose(_v.copy(p).addScaledVector(n, 0.012), _q, _s.set(size * 2, size * 2, 1));
    d.im.setMatrixAt(d.i, _m); d.im.instanceMatrix.needsUpdate = true; d.i = (d.i + 1) % d.n;
  }
  tracer(from, to, col = 0xffd9a0, speed = 320, w = 0.035, len = 7) {
    let t = null; for (const x of this.tracers) if (!x.on) { t = x; break; }
    if (!t) return;
    t.on = true; t.from.copy(from); t.dir.subVectors(to, from); t.dist = t.dir.length(); if (t.dist < 1.5) { t.on = false; return; } t.dir.multiplyScalar(1 / t.dist);
    t.head = Math.min(t.dist, 2.5 + Math.random() * 3); t.speed = speed; t.len = len; t.w = w; t.m.material.color.setHex(col); t.m.material.color.multiplyScalar(2.2); t.m.visible = true;
  }
  beam(a, b, col, w = 0.12, life = 0.25, hdr = 6) {
    let x = null; for (const e of this.beams) if (!e.on) { x = e; break; } if (!x) x = this.beams[0];
    x.on = true; x.t = 0; x.life = life; x.a.copy(a); x.b.copy(b); x.w = w; x.col.setRGB(col[0], col[1], col[2]); x.hdr = hdr; x.m.visible = true; x.hold = false;
    return x;
  }
  flashLight(p, col, intensity = 30, dur = 0.07, dist = 14) {
    let l = this.lights[0]; for (const x of this.lights) if (x.intensity < l.intensity) l = x;
    l.position.copy(p); l.color.setRGB(col[0], col[1], col[2]); l.intensity = intensity; l.distance = dist; l.userData.t = 0; l.userData.dur = dur; l.userData.peak = intensity;
  }
  muzzleFlash(p, dir, scale = 1, col = [1.8, 1.25, 0.6]) {
    this.add.spawn({ x: p.x + dir.x * 0.12, y: p.y + dir.y * 0.12, z: p.z + dir.z * 0.12, vx: 0, vy: 0, vz: 0, life: 0.05, s0: 0.5 * scale, s1: 0.7 * scale, r: col[0], g: col[1], b: col[2], a: 1, tile: 3 });
    this.add.spawn({ x: p.x + dir.x * 0.3, y: p.y + dir.y * 0.3, z: p.z + dir.z * 0.3, vx: dir.x * 3, vy: dir.y * 3, vz: dir.z * 3, life: 0.07, s0: 0.3 * scale, s1: 0.15, r: col[0], g: col[1] * 0.8, b: col[2] * 0.5, a: 0.8, tile: 6 });
  }
  shell(p, v) {
    const s = this.shells[this.shellI]; this.shellI = (this.shellI + 1) % this.shells.length;
    s.on = true; s.p.copy(p); s.v.copy(v); s.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); s.life = 2.2; s.floor = this.game.player ? this.game.player.pos.y + 0.012 : 0; s.b = 0;
  }
  ring(p, col, r = 10, life = 0.7) {
    let x = null; for (const e of this.rings) if (!e.on) { x = e; break; } if (!x) return;
    x.on = true; x.t = 0; x.life = life; x.r = r; x.m.position.set(p.x, p.y + 0.08, p.z); x.m.material.color.setRGB(col[0], col[1], col[2]); x.m.visible = true;
  }
  // 爆炸（size≈1 手雷，3 机甲坠地，5 机甲殉爆）
  explosion(p, size = 1, opts = {}) {
    const A = this.add, S = this.alpha; const sq = Math.sqrt(size); const dc = this.dustCol;
    // 核心闪光
    A.spawn({ x: p.x, y: p.y + 0.5 * size, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.10, s0: 7 * size, s1: 12 * size, r: 4.5, g: 3.4, b: 2.2, a: 1, tile: 6 });
    A.spawn({ x: p.x, y: p.y + 0.5 * size, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.13, s0: 3.5 * size, s1: 6 * size, r: 6, g: 5, b: 3.6, a: 1, tile: 3 });
    // 火球：由亮黄冷却到暗红
    const nf = Math.round(12 + size * 5);
    for (let i = 0; i < nf; i++) { _v.set(rnd(-1, 1), rnd(-0.1, 1), rnd(-1, 1)).normalize(); const sp = rnd(3, 9) * sq; A.spawn({ x: p.x + _v.x * 0.3 * size, y: p.y + 0.4 + _v.y * 0.3 * size, z: p.z + _v.z * 0.3 * size, vx: _v.x * sp, vy: _v.y * sp + rnd(1, 3), vz: _v.z * sp, life: rnd(0.35, 0.8) * sq, s0: rnd(1.0, 1.8) * size, s1: rnd(2.6, 4.2) * size, r: 3.6, g: 2.0, b: 0.75, r1: 0.9, g1: 0.15, b1: 0.03, a: 1, tile: 1, drag: 3.2, ease: true, vrot: rnd(-1.5, 1.5) }); }
    // 浓烟：由黑转灰并上升
    const ns = Math.round(12 + size * 6);
    for (let i = 0; i < ns; i++) { _v.set(rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1)).normalize(); const sp = rnd(1.5, 5) * sq; const g = rnd(0.045, 0.11); S.spawn({ x: p.x + _v.x * size * 0.8, y: p.y + 0.5 + _v.y * size * 0.8, z: p.z + _v.z * size * 0.8, vx: _v.x * sp, vy: _v.y * sp + rnd(1.5, 3), vz: _v.z * sp, life: rnd(2.4, 4.8) * sq, s0: rnd(1.4, 2.2) * size, s1: rnd(4.5, 7.5) * size, r: g * 1.15, g, b: g * 0.95, r1: 0.42, g1: 0.40, b1: 0.38, a: 0.8, tile: 1, drag: 1.4, fadeIn: 0.1, ease: true, vrot: rnd(-0.5, 0.5), grav: -0.7 }); }
    // 贴地尘浪
    for (let i = 0; i < 12 + size * 3; i++) { const an = Math.random() * 6.28, cs = Math.cos(an), sn = Math.sin(an), sp = rnd(5, 9) * sq; S.spawn({ x: p.x + cs * size, y: p.y + 0.3, z: p.z + sn * size, vx: cs * sp, vy: rnd(0.2, 1), vz: sn * sp, life: rnd(1.2, 2.2), s0: 1.2 * size, s1: rnd(3, 5) * size, r: dc[0], g: dc[1], b: dc[2], a: 0.4, tile: 1, drag: 2.2, ease: true, fadeIn: 0.1, vrot: rnd(-0.6, 0.6) }); }
    // 火星与余烬
    for (let i = 0; i < 14 + size * 6; i++) { _v.set(rnd(-1, 1), rnd(0.2, 1.3), rnd(-1, 1)).normalize(); const sp = rnd(6, 17) * sq; A.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: _v.x * sp, vy: _v.y * sp, vz: _v.z * sp, life: rnd(0.6, 1.6), s0: rnd(0.06, 0.14), s1: 0.02, r: 2.8, g: 1.5, b: 0.55, r1: 1.2, g1: 0.3, b1: 0.05, a: 1, tile: 2, grav: 12, drag: 0.5, floor: p.y }); }
    // 碎块
    for (let i = 0; i < 8 + size * 4; i++) { _v.set(rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1)).normalize(); const sp = rnd(5, 13) * sq; S.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: _v.x * sp, vy: _v.y * sp, vz: _v.z * sp, life: rnd(0.9, 1.7), s0: rnd(0.08, 0.2) * sq, s1: 0.06, r: 0.2, g: 0.17, b: 0.14, a: 1, tile: 4, grav: 17, vrot: rnd(-10, 10), floor: p.y }); }
    this.ring(p, [1.3, 0.85, 0.45], 6 + size * 5, 0.38 + size * 0.08);
    this.flashLight(_v.set(p.x, p.y + 1, p.z), [1, 0.62, 0.3], 340 * size, 0.4, 18 + size * 10);
    if (opts.scorch !== false) this.decal(this.scorch, p, opts.normal || Y, 1.7 * size);
    this.game.shake(p, 0.55 * size, 14 + size * 10);
  }

  // state: 1/3 = 飞行中（缆绳甩动），2 = 已钩住并牵引（绷紧，微颤）
  setRope(on, from, to, state = 2, time = 0) {
    this.rope.visible = on; this.hook.visible = on; if (!on) return;
    const dir = _v.subVectors(to, from); const len = dir.length(); if (len < 0.05) { this.rope.visible = false; return; }
    const n = _v2.copy(dir).multiplyScalar(1 / len); const sx = _v3.crossVectors(n, Y); if (sx.lengthSq() < 1e-6) sx.set(1, 0, 0); sx.normalize(); const ux = _s.crossVectors(sx, n).normalize();
    const N = this.ropeN, S = this.ropeS, P = this.ropePos, Nm = this.ropeNrm;
    const flying = state !== 2; const amp = flying ? Math.min(0.45, 0.05 + len * 0.03) : 0.012; const sag = flying ? 0.02 * len : Math.min(0.12, 0.006 * len);
    const fr = flying ? 24 : 70;
    for (let i = 0; i <= N; i++) {
      const t = i / N; const env = Math.sin(Math.PI * t) * (flying ? (1 - t * 0.5) : 1);
      const wa = Math.sin(t * (flying ? 11 : 30) - time * fr) * amp * env, wb = Math.cos(t * (flying ? 8.5 : 23) - time * fr * 0.8) * amp * 0.6 * env;
      const cx = from.x + dir.x * t + sx.x * wa + ux.x * wb, cy = from.y + dir.y * t + sx.y * wa + ux.y * wb - sag * 4 * t * (1 - t), cz = from.z + dir.z * t + sx.z * wa + ux.z * wb;
      // 靠近手部的一段更细：抵消视模缩放带来的透视放大
      const r = 0.0017 + (0.0052 - 0.0017) * Math.min(1, (t * len) / 1.6);
      for (let k = 0; k < S; k++) { const a = k / S * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); const o = (i * S + k) * 3; const nx = sx.x * ca + ux.x * sa, ny = sx.y * ca + ux.y * sa, nz = sx.z * ca + ux.z * sa; P[o] = cx + nx * r; P[o + 1] = cy + ny * r; P[o + 2] = cz + nz * r; Nm[o] = nx; Nm[o + 1] = ny; Nm[o + 2] = nz; }
    }
    const g = this.rope.geometry; g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    this.rope.material.map.repeat.set(2, len * 14 / N);
    this.hook.position.copy(to); this.hook.quaternion.setFromUnitVectors(Y, n);
  }

  update(dt) {
    const eng = this.game.engine, cam = eng.camera; const scale = eng.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)));
    this.alpha.mat.uniforms.uScale.value = scale; this.add.mat.uniforms.uScale.value = scale; this.moteMat.uniforms.uScale.value = scale;
    this.moteMat.uniforms.uCam.value.copy(cam.position); this.moteMat.uniforms.uTime.value = eng.time; this.wispMat.uniforms.uCam.value.copy(cam.position); this.wispMat.uniforms.uTime.value = eng.time; this.wispMat.uniforms.uScale.value = scale; if (this.shaftMat) this.shaftMat.uniforms.uTime.value = eng.time;
    this.motes.visible = !!SUNSH.tShadow.value;
    // 镜头所在处有多“室内”（导航网格记录了每格的天空可见度）：室内时近层密尘全开，室外只留一点
    { const nav = this.game.nav; let sky = 1; if (nav) { sky = nav.skyAt(cam.position.x, cam.position.z); if (cam.position.y - nav.height(cam.position.x, cam.position.z) > 4.5) sky = 1; }
      this.indoor += ((1 - sky) - this.indoor) * Math.min(1, dt * 2.5);
      const mu = this.moteNearMat.uniforms; mu.uScale.value = scale; mu.uCam.value.copy(cam.position); mu.uTime.value = eng.time; mu.uGain.value = 0.22 + 0.95 * this.indoor; this.motesNear.visible = this.motes.visible;
      if (eng.post.fx.uIndoor) eng.post.fx.uIndoor.value = this.indoor; }
    if (this.smokes) for (const m of this.smokes) {   // 烟柱：时间与"太阳在烟柱的哪一侧"（决定哪边受光）
      const u = m.material.uniforms; u.uTime.value = eng.time;
      const dx = cam.position.x - m.position.x, dz = cam.position.z - m.position.z; const il = 1 / Math.max(1e-3, Math.hypot(dx, dz));
      u.uSunSide.value = (dz * il) * ATMOS.sunDir.x + (-dx * il) * ATMOS.sunDir.z;
    }
    this.alpha.update(dt); this.add.update(dt);
    for (const l of this.lights) { if (l.intensity <= 0) continue; l.userData.t += dt; const u = l.userData.t / l.userData.dur; l.intensity = u >= 1 ? 0 : l.userData.peak * (1 - u) * (1 - u); }
    for (const t of this.tracers) {
      if (!t.on) continue; t.head += t.speed * dt; const tail = Math.max(0, t.head - t.len), head = Math.min(t.head, t.dist);
      if (tail >= t.dist) { t.on = false; t.m.visible = false; continue; }
      const len = Math.max(0.05, head - tail); _v.copy(t.from).addScaledVector(t.dir, (head + tail) / 2);
      this._orient(t.m, _v, t.dir, len, t.w + cam.position.distanceTo(_v) * 0.0022, cam);
    }
    for (const b of this.beams) {
      if (!b.on) continue; if (!b.hold) b.t += dt; const u = b.t / b.life; if (u >= 1) { b.on = false; b.m.visible = false; continue; }
      _v2.subVectors(b.b, b.a); const len = _v2.length(); if (len < 0.01) continue; _v2.multiplyScalar(1 / len); _v.copy(b.a).addScaledVector(_v2, len / 2);
      const k = (1 - u) * (1 - u); b.m.material.color.copy(b.col).multiplyScalar(b.hdr * k);
      this._orient(b.m, _v, _v2, len, b.w * (0.5 + 0.5 * k) + cam.position.distanceTo(_v) * 0.0015, cam);
    }
    let any = false;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i]; if (!s.on) continue; any = true; s.life -= dt;
      s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); s.r.x += 14 * dt; s.r.z += 9 * dt;
      if (s.p.y < s.floor) { s.p.y = s.floor; if (s.b++ === 0) this.game.audio.play('shell', { volume: 0.35 }); s.v.y = -s.v.y * 0.35; s.v.x *= 0.5; s.v.z *= 0.5; }
      if (s.life <= 0) { s.on = false; _m.makeScale(0, 0, 0); } else _m.compose(s.p, _q.setFromEuler(new THREE.Euler(s.r.x, s.r.y, s.r.z)), _s.set(1, 1, 1));
      this.shellMesh.setMatrixAt(i, _m);
    }
    if (any) this.shellMesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) { if (!r.on) continue; r.t += dt; const u = r.t / r.life; if (u >= 1) { r.on = false; r.m.visible = false; continue; } const e = 1 - (1 - u) * (1 - u); r.m.scale.setScalar(0.3 + r.r * e); r.m.material.opacity = (1 - u) * 0.8; }
  }
  _orient(mesh, mid, dir, len, w, cam) {
    _v3.subVectors(cam.position, mid); const y = _s.crossVectors(dir, _v3); if (y.lengthSq() < 1e-8) y.set(0, 1, 0); y.normalize();
    const z = _v3.crossVectors(dir, y); _m.makeBasis(dir, y, z); mesh.quaternion.setFromRotationMatrix(_m); mesh.position.copy(mid); mesh.scale.set(len, w, 1);
  }

  // ---------- 机甲专用特效（只用到粒子池、冲击环和闪光灯，不需要额外的每帧更新）----------
  // 机炮开火：炮口火球 + 制退器向两侧喷的焰舌 + 滞留的炮口烟
  mechMuzzle(p, dir, right) {
    const A = this.add, S = this.alpha;
    A.spawn({ x: p.x + dir.x * 0.5, y: p.y + dir.y * 0.5, z: p.z + dir.z * 0.5, vx: dir.x * 8, vy: dir.y * 8, vz: dir.z * 8, life: 0.08, s0: 1.3, s1: 2.6, r: 3.4, g: 2.0, b: 0.8, a: 1, tile: 3 });
    for (let i = 0; i < 3; i++) { const k = 1.2 + i * 1.3; A.spawn({ x: p.x + dir.x * k, y: p.y + dir.y * k, z: p.z + dir.z * k, vx: dir.x * 22, vy: dir.y * 22, vz: dir.z * 22, life: 0.07 + i * 0.015, s0: 1.3 - i * 0.3, s1: 0.4, r: 3.2, g: 1.7, b: 0.6, a: 0.9, tile: 6, drag: 6 }); }
    for (const sg of [-1, 1]) for (let i = 0; i < 2; i++) A.spawn({ x: p.x + right.x * sg * 0.3, y: p.y + right.y * sg * 0.3, z: p.z + right.z * sg * 0.3, vx: right.x * sg * (9 + i * 6) + dir.x * 3, vy: right.y * sg * (9 + i * 6) + 0.5, vz: right.z * sg * (9 + i * 6) + dir.z * 3, life: 0.08, s0: 0.9, s1: 0.3, r: 3.0, g: 1.6, b: 0.55, a: 0.9, tile: 6, drag: 8 });
    for (let i = 0; i < 5; i++) { const g = rnd(0.34, 0.5); S.spawn({ x: p.x + dir.x * rnd(0.2, 1.2), y: p.y + dir.y * rnd(0.2, 1.2), z: p.z + dir.z * rnd(0.2, 1.2), vx: dir.x * rnd(2, 7) + rnd(-1, 1), vy: dir.y * rnd(2, 7) + rnd(0.2, 1.2), vz: dir.z * rnd(2, 7) + rnd(-1, 1), life: rnd(0.8, 1.6), s0: rnd(0.5, 0.8), s1: rnd(1.8, 2.8), r: g, g: g * 0.97, b: g * 0.93, a: 0.32, tile: 1, drag: 2.6, ease: true, fadeIn: 0.08, vrot: rnd(-0.8, 0.8), grav: -0.4 }); }
    for (let i = 0; i < 5; i++) { _v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).addScaledVector(dir, 2.2).normalize(); const sp = rnd(8, 20); A.spawn({ x: p.x, y: p.y, z: p.z, vx: _v.x * sp, vy: _v.y * sp, vz: _v.z * sp, life: rnd(0.15, 0.4), s0: rnd(0.05, 0.1), s1: 0.01, r: 2.6, g: 1.4, b: 0.5, a: 1, tile: 2, grav: 9, drag: 1 }); }
  }
  // 重脚落地 / 着陆：贴地向外翻滚的尘环 + 蹦起的碎石
  stomp(p, w = 1) {
    const S = this.alpha, dc = this.dustCol; const n = Math.round(7 + 7 * w);
    for (let i = 0; i < n; i++) { const an = Math.random() * 6.28, cs = Math.cos(an), sn = Math.sin(an), sp = rnd(2.2, 4.6) * (0.6 + 0.6 * w); S.spawn({ x: p.x + cs * 0.5, y: p.y + rnd(0.05, 0.25), z: p.z + sn * 0.5, vx: cs * sp, vy: rnd(0.2, 0.9), vz: sn * sp, life: rnd(0.9, 1.7), s0: rnd(0.5, 0.8) * (0.7 + 0.5 * w), s1: rnd(1.8, 2.8) * (0.7 + 0.5 * w), r: dc[0], g: dc[1], b: dc[2], a: 0.3, tile: 1, drag: 2.4, ease: true, fadeIn: 0.1, vrot: rnd(-0.6, 0.6) }); }
    for (let i = 0; i < 3 + 4 * w; i++) { const an = Math.random() * 6.28, sp = rnd(1.5, 4); S.spawn({ x: p.x, y: p.y + 0.1, z: p.z, vx: Math.cos(an) * sp, vy: rnd(2, 5) * w, vz: Math.sin(an) * sp, life: rnd(0.5, 0.9), s0: rnd(0.04, 0.09), s1: 0.03, r: dc[0] * 0.6, g: dc[1] * 0.6, b: dc[2] * 0.6, a: 1, tile: 4, grav: 16, vrot: rnd(-9, 9), floor: p.y }); }
  }
  // 火箭出筒：筒口闪焰 + 向后喷出的尾焰与白烟
  backblast(p, dir) {
    const A = this.add, S = this.alpha;
    for (let i = 0; i < 3; i++) A.spawn({ x: p.x, y: p.y, z: p.z, vx: -dir.x * rnd(10, 22) + rnd(-2, 2), vy: -dir.y * rnd(10, 22) + rnd(-1, 2), vz: -dir.z * rnd(10, 22) + rnd(-2, 2), life: rnd(0.1, 0.18), s0: 0.5, s1: 1.2, r: 3.0, g: 1.5, b: 0.5, a: 0.9, tile: 6, drag: 5 });
    for (let i = 0; i < 4; i++) { const g = rnd(0.62, 0.8); S.spawn({ x: p.x - dir.x * 0.4, y: p.y - dir.y * 0.4, z: p.z - dir.z * 0.4, vx: -dir.x * rnd(3, 9) + rnd(-1.2, 1.2), vy: -dir.y * rnd(3, 9) + rnd(0.2, 1.4), vz: -dir.z * rnd(3, 9) + rnd(-1.2, 1.2), life: rnd(1.0, 1.9), s0: rnd(0.4, 0.6), s1: rnd(1.6, 2.6), r: g, g: g, b: g, a: 0.34, tile: 1, drag: 2.2, ease: true, fadeIn: 0.08, vrot: rnd(-0.7, 0.7), grav: -0.5 }); }
  }
  // 动力拳命中：正面冲击波、碎屑、地面尘浪
  mechPunch(p, dir, groundY) {
    const A = this.add, S = this.alpha, dc = this.dustCol;
    A.spawn({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.1, s0: 2.2, s1: 4.6, r: 2.6, g: 2.0, b: 1.4, a: 0.9, tile: 3 });
    A.spawn({ x: p.x, y: p.y, z: p.z, vx: dir.x * 4, vy: 0, vz: dir.z * 4, life: 0.22, s0: 1.2, s1: 6.5, r: 1.3, g: 1.2, b: 1.0, a: 0.5, tile: 5, ease: true });
    for (let i = 0; i < 16; i++) { _v.set(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).addScaledVector(dir, 1.6).normalize(); const sp = rnd(7, 19); A.spawn({ x: p.x, y: p.y, z: p.z, vx: _v.x * sp, vy: _v.y * sp, vz: _v.z * sp, life: rnd(0.25, 0.6), s0: rnd(0.06, 0.12), s1: 0.01, r: 2.4, g: 1.5, b: 0.6, a: 1, tile: 2, grav: 12, drag: 0.8 }); }
    for (let i = 0; i < 9; i++) { const an = rnd(-1.1, 1.1), cs = Math.cos(an), sn = Math.sin(an); const fx = dir.x * cs - dir.z * sn, fz = dir.z * cs + dir.x * sn, sp = rnd(4, 9); S.spawn({ x: p.x + fx, y: groundY + 0.3, z: p.z + fz, vx: fx * sp, vy: rnd(0.3, 1.2), vz: fz * sp, life: rnd(1.0, 1.8), s0: 0.9, s1: rnd(2.6, 3.8), r: dc[0], g: dc[1], b: dc[2], a: 0.34, tile: 1, drag: 2.2, ease: true, fadeIn: 0.1, vrot: rnd(-0.6, 0.6) }); }
    this.ring(_v.set(p.x, groundY, p.z), [1.4, 1.1, 0.8], 7, 0.4); this.flashLight(p, [1, 0.8, 0.5], 120, 0.12, 16);
  }
  // 熔毁光束命中点：白热核心、带重力的熔融金属珠、焦烟
  molten(p, n, dt = 0.016) {
    const A = this.add, S = this.alpha; const k = Math.min(3, Math.max(1, Math.round(dt * 150)));
    A.spawn({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.09, s0: rnd(2.2, 3.4), s1: 1.4, r: 3.4, g: 1.9, b: 0.7, a: 1, tile: 3 });
    for (let i = 0; i < 2 * k; i++) { _v.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)); if (n) _v.addScaledVector(n, 1.3); _v.normalize(); const sp = rnd(4, 13); A.spawn({ x: p.x, y: p.y, z: p.z, vx: _v.x * sp, vy: _v.y * sp + 2, vz: _v.z * sp, life: rnd(0.6, 1.4), s0: rnd(0.1, 0.2), s1: 0.03, r: 3.2, g: 1.6, b: 0.4, r1: 1.4, g1: 0.25, b1: 0.03, a: 1, tile: 2, grav: 15, drag: 0.4, floor: p.y - 0.4 }); }
    if (Math.random() < 0.5 * k) S.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: rnd(-0.6, 0.6), vy: rnd(1.5, 3), vz: rnd(-0.6, 0.6), life: rnd(1.0, 1.8), s0: 0.6, s1: rnd(2, 3), r: 0.1, g: 0.09, b: 0.085, a: 0.5, tile: 1, drag: 1.2, ease: true, fadeIn: 0.1, vrot: rnd(-0.6, 0.6), grav: -0.6 });
  }
  // 机体起火：火舌 + 黑烟（濒毁、残骸）
  mechFire(p, size = 1) {
    this.add.spawn({ x: p.x, y: p.y, z: p.z, vx: rnd(-0.6, 0.6), vy: rnd(2, 4.5), vz: rnd(-0.6, 0.6), life: rnd(0.3, 0.6), s0: rnd(0.7, 1.1) * size, s1: rnd(0.2, 0.5) * size, r: 3.2, g: 1.5, b: 0.4, r1: 1.0, g1: 0.15, b1: 0.03, a: 0.9, tile: 1, drag: 1.5, vrot: rnd(-2, 2) });
    if (Math.random() < 0.6) { const g = rnd(0.04, 0.09); this.alpha.spawn({ x: p.x, y: p.y + 0.5, z: p.z, vx: rnd(-0.8, 0.8), vy: rnd(2.5, 4.5), vz: rnd(-0.8, 0.8), life: rnd(1.6, 2.8), s0: rnd(0.8, 1.2) * size, s1: rnd(3, 4.5) * size, r: g, g: g, b: g, r1: 0.3, g1: 0.29, b1: 0.28, a: 0.6, tile: 1, drag: 0.9, ease: true, fadeIn: 0.12, vrot: rnd(-0.6, 0.6), grav: -0.8 }); }
  }
  // 一团蒸汽 / 排烟
  steam(p, vx, vy, vz, size = 1, a = 0.3, g = 0.8) {
    this.alpha.spawn({ x: p.x, y: p.y, z: p.z, vx: vx + rnd(-0.4, 0.4), vy: vy + rnd(-0.2, 0.5), vz: vz + rnd(-0.4, 0.4), life: rnd(0.7, 1.3), s0: 0.3 * size, s1: rnd(1.2, 1.9) * size, r: g, g: g, b: g * 1.02, a, tile: 1, drag: 2.2, ease: true, fadeIn: 0.1, vrot: rnd(-0.8, 0.8), grav: -0.6 });
  }
}
