// Particles, decals, tracers, casings and muzzle flashes (all rendered into the HDR world pass).
import * as THREE from 'three';
import { LAYER, probeSH as probeSHFn } from './world.js';
import { G, patchDynamic, makeSH, GLSL_SHADOW } from './materials.js';

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

export const TEX = {};
function makeTextures() {
  TEX.flash = canvasTex(256, (g, s) => {
    const c = s / 2;
    g.globalCompositeOperation = 'lighter';
    const rg = g.createRadialGradient(c, c, 0, c, c, c * 0.55);
    rg.addColorStop(0, 'rgba(255,250,235,1)'); rg.addColorStop(0.25, 'rgba(255,200,110,0.9)'); rg.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd(-0.2, 0.2), L = c * rnd(0.55, 0.98), w = rnd(0.07, 0.14);
      g.save(); g.translate(c, c); g.rotate(a);
      const lg = g.createLinearGradient(0, 0, L, 0);
      lg.addColorStop(0, 'rgba(255,240,200,0.95)'); lg.addColorStop(0.5, 'rgba(255,170,70,0.5)'); lg.addColorStop(1, 'rgba(255,110,20,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(0, -c * w); g.lineTo(L, 0); g.lineTo(0, c * w); g.closePath(); g.fill();
      g.restore();
    }
  });
  TEX.smoke = canvasTex(128, (g, s) => {
    const c = s / 2;
    for (let i = 0; i < 40; i++) {
      const x = c + rnd(-0.25, 0.25) * s, y = c + rnd(-0.25, 0.25) * s, r = rnd(0.12, 0.3) * s;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,0.13)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, s, s);
    }
  });
  TEX.hole = canvasTex(128, (g, s) => {
    const c = s / 2;
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    const rg = g.createRadialGradient(c, c, 0, c, c, c * 0.9);
    rg.addColorStop(0, 'rgb(20,18,16)'); rg.addColorStop(0.14, 'rgb(35,32,30)'); rg.addColorStop(0.2, 'rgb(150,145,140)');
    rg.addColorStop(0.45, 'rgb(215,210,205)'); rg.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(90,85,80,0.8)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      let a = rnd(0, 6.28), r = c * 0.12, x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { a += rnd(-0.5, 0.5); r += c * rnd(0.06, 0.13); g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
      g.stroke();
    }
  });
  TEX.blood = canvasTex(128, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 22; i++) {
      const c = s / 2, a = rnd(0, 6.28), d = i < 6 ? rnd(0, 6) : rnd(8, 52), x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, r = i < 6 ? rnd(10, 18) : rnd(1.5, 5);
      g.fillStyle = 'rgb(95,12,10)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
  TEX.puff = canvasTex(64, (g, s) => {
    const c = s / 2; const rg = g.createRadialGradient(c, c, 0, c, c, c);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
  });
}

class SpritePool {
  constructor(scene, tex, blending, n, layer = LAYER.FX) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, blending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
      const s = new THREE.Sprite(m); s.visible = false; s.layers.set(layer); s.frustumCulled = false; s.renderOrder = 20;
      scene.add(s); this.items.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 0, size0: 1, a0: 1, col: new THREE.Color(), drag: 0, grav: 0 });
    }
    this.i = 0;
  }
  spawn(pos, o) {
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    it.s.visible = true; it.s.position.copy(pos); it.life = 0; it.max = o.life;
    it.vel.copy(o.vel || new THREE.Vector3()); it.grow = o.grow || 0; it.size0 = o.size; it.a0 = o.alpha ?? 1;
    it.col.copy(o.color); it.drag = o.drag ?? 1.5; it.grav = o.grav ?? 0;
    it.s.material.rotation = rnd(0, 6.28); it.s.scale.setScalar(o.size);
    it.s.material.color.copy(o.color); it.s.material.opacity = it.a0;
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.life += dt;
      if (it.life >= it.max) { it.s.visible = false; continue; }
      const t = it.life / it.max;
      it.vel.multiplyScalar(Math.exp(-it.drag * dt)); it.vel.y -= it.grav * dt;
      it.s.position.addScaledVector(it.vel, dt);
      it.s.scale.setScalar(it.size0 * (1 + it.grow * t));
      it.s.material.opacity = it.a0 * (1 - t) * (1 - t);
    }
  }
}

export class Effects {
  constructor(scene, world) {
    makeTextures();
    this.scene = scene; this.world = world;
    this.smoke = new SpritePool(scene, TEX.smoke, THREE.NormalBlending, 60);
    this.puffs = new SpritePool(scene, TEX.puff, THREE.NormalBlending, 80);
    this.blood = new SpritePool(scene, TEX.puff, THREE.NormalBlending, 50);
    this.sparks = new SpritePool(scene, TEX.puff, THREE.AdditiveBlending, 60);
    this.flashes = new SpritePool(scene, TEX.flash, THREE.AdditiveBlending, 12);
    // decals
    this.decals = [];
    this.decalMats = {
      hole: new THREE.MeshBasicMaterial({ map: TEX.hole, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
      blood: new THREE.MeshBasicMaterial({ map: TEX.blood, transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
    };
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    // tracers
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); tg.rotateX(Math.PI / 2); tg.translate(0, 0, 0.5);
    this.tracerGeo = tg;
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false; m.layers.set(LAYER.FX); m.frustumCulled = false; scene.add(m);
      this.tracers.push({ m, life: 0, max: 0.05, from: new THREE.Vector3(), to: new THREE.Vector3(), speed: 0 });
    }
    // casings
    this.caseSH = makeSH();
    const cmat = new THREE.MeshStandardMaterial({ color: 0xc8963c, metalness: 1, roughness: 0.32 });
    patchDynamic(cmat, { uSH: this.caseSH }); this.caseMat = cmat;
    const cg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.045, 8); cg.rotateZ(Math.PI / 2);
    this.cases = new THREE.InstancedMesh(cg, cmat, 40);
    this.cases.layers.set(LAYER.FX); this.cases.frustumCulled = false; this.cases.count = 40;
    this.caseData = Array.from({ length: 40 }, () => ({ p: new THREE.Vector3(0, -50, 0), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), life: 99, ground: 0, bounced: 0 }));
    this.caseI = 0; scene.add(this.cases);
    this.onCasingLand = null;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    // world flash light
    this.flashT = 0;
    this.makeDust(scene);
  }

  // floating dust: invisible in shade, glitters inside the sun shafts (sun visibility from the static shadow map)
  makeDust(scene) {
    const N = 9000, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rnd(-10.5, 10.5); pos[i * 3 + 1] = rnd(0.2, 9.5); pos[i * 3 + 2] = rnd(-61, 11); seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: G.uTime, uStatShadow: G.uStatShadow, uStatShadowMat: G.uStatShadowMat, uDynShadow: G.uDynShadow, uDynShadowMat: G.uDynShadowMat,
        uSunCol: { value: new THREE.Vector3(1, 0.95, 0.88).multiplyScalar(2.2) }, uPx: { value: 1 } },
      vertexShader: `${GLSL_SHADOW}
        attribute float seed; uniform float uTime, uPx; uniform vec3 uSunCol; varying vec3 vC; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.05 + seed*0.08);
          p += vec3(sin(t*1.7 + seed*40.0), sin(t*1.1 + seed*17.0)*0.6 + 0.15*sin(uTime*0.03+seed*9.0), cos(t*1.3 + seed*23.0)) * 0.35;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float vis = statVis(p);
          float d = -mv.z;
          vA = smoothstep(0.4, 1.2, d) * (1.0 - smoothstep(10.0, 22.0, d));
          vC = uSunCol * vis * (0.4 + 0.6*fract(seed*7.31)) + vec3(0.015);
          gl_PointSize = clamp(uPx * (0.9 + seed) * 1.6 / max(d, 0.5) * 4.0, 1.0, 4.0);
        }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 c = gl_PointCoord*2.0-1.0; float a = exp(-dot(c,c)*3.0) * vA; gl_FragColor = vec4(vC * a, 0.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m); pts.layers.set(LAYER.FX); pts.frustumCulled = false; pts.renderOrder = 15;
    scene.add(pts); this.dust = pts;
  }

  setVMScene(vmScene) {
    this.vmFlashes = new SpritePool(vmScene, TEX.flash, THREE.AdditiveBlending, 8, LAYER.VM);
    for (const it of this.vmFlashes.items) { it.s.material.depthTest = true; it.s.renderOrder = 30; }
  }

  muzzleFlash(pos, dir, scale = 1, light = true, vm = false) {
    const pool = vm && this.vmFlashes ? this.vmFlashes : this.flashes;
    const f = pool.spawn(pos, { life: 0.045, size: 0.32 * scale * rnd(0.85, 1.2), color: new THREE.Color(7, 5.6, 4), alpha: 1, drag: 0 });
    f.s.material.opacity = 1;
    pool.spawn(pos.clone().addScaledVector(dir, 0.06 * scale), { life: 0.035, size: 0.18 * scale, color: new THREE.Color(10, 8, 6), drag: 0 });
    for (let i = 0; i < 2; i++)
      this.smoke.spawn(pos.clone().addScaledVector(dir, 0.05), { life: rnd(0.6, 1.1), size: rnd(0.08, 0.14) * scale, grow: 3.5,
        vel: dir.clone().multiplyScalar(rnd(0.4, 1.0)).add(new THREE.Vector3(0, rnd(0.1, 0.3), 0)), color: new THREE.Color(0.55, 0.53, 0.5), alpha: 0.35, drag: 2.5 });
    if (light) { G.uFlashPos.value.copy(pos); G.uFlashCol.value.set(30, 20, 10.5).multiplyScalar(scale); this.flashT = 0.045; }
  }

  impact(p, n, kind = 'plaster', decal = true) {
    const col = kind === 'metal' ? new THREE.Color(0.35, 0.34, 0.33) : kind === 'glass' ? new THREE.Color(0.6, 0.65, 0.65) : new THREE.Color(0.62, 0.58, 0.52);
    for (let i = 0; i < 4; i++) {
      const v = n.clone().multiplyScalar(rnd(0.8, 2.6)).add(new THREE.Vector3(rnd(-0.7, 0.7), rnd(-0.2, 0.9), rnd(-0.7, 0.7)));
      this.puffs.spawn(p.clone().addScaledVector(n, 0.03), { life: rnd(0.5, 1.0), size: rnd(0.05, 0.12), grow: 3, vel: v, color: col, alpha: 0.6, drag: 3, grav: 0.4 });
    }
    if (kind === 'metal' || Math.random() < 0.35) {
      for (let i = 0; i < 6; i++) {
        const v = n.clone().multiplyScalar(rnd(2, 5)).add(new THREE.Vector3(rnd(-2, 2), rnd(-1, 2.5), rnd(-2, 2)));
        this.sparks.spawn(p.clone().addScaledVector(n, 0.02), { life: rnd(0.08, 0.22), size: rnd(0.012, 0.025), vel: v, color: new THREE.Color(12, 7, 2.5), drag: 1, grav: 9 });
      }
    }
    if (decal) this.addDecal('hole', p, n, rnd(0.07, 0.1));
  }

  bloodHit(p, dir, n) {
    for (let i = 0; i < 7; i++) {
      const v = dir.clone().multiplyScalar(rnd(0.6, 2.2)).add(new THREE.Vector3(rnd(-0.6, 0.6), rnd(-0.2, 0.8), rnd(-0.6, 0.6)));
      this.blood.spawn(p, { life: rnd(0.25, 0.55), size: rnd(0.08, 0.2), grow: 1.6, vel: v, color: new THREE.Color(0.16, 0.012, 0.01), alpha: 0.75, drag: 3.5, grav: 2 });
    }
  }

  addDecal(kind, p, n, size) {
    let d;
    if (this.decals.length >= 140) { d = this.decals.shift(); } else {
      d = new THREE.Mesh(this.decalGeo, this.decalMats[kind]); d.layers.set(LAYER.FX); d.renderOrder = 5; this.scene.add(d);
    }
    d.material = this.decalMats[kind];
    d.position.copy(p).addScaledVector(n, 0.003);
    d.lookAt(p.clone().add(n)); d.rotateZ(rnd(0, 6.28));
    d.scale.setScalar(size); d.visible = true;
    this.decals.push(d);
  }

  tracer(from, to) {
    const t = this.tracers.find((x) => !x.m.visible) || this.tracers[0];
    t.from.copy(from); t.to.copy(to); t.life = 0; t.max = Math.min(0.09, from.distanceTo(to) / 400 + 0.02);
    t.m.visible = true;
  }

  casing(pos, vel, groundY) {
    const c = this.caseData[this.caseI]; this.caseI = (this.caseI + 1) % this.caseData.length;
    c.p.copy(pos); c.v.copy(vel); c.q.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)));
    c.w.set(rnd(-25, 25), rnd(-25, 25), rnd(-25, 25)); c.life = 0; c.ground = groundY; c.bounced = 0;
  }

  update(dt, camPos) {
    if (this.world && camPos) { this._shT = (this._shT || 0) - dt; if (this._shT <= 0) { this._shT = 0.25; probeSHFn?.(this.world, camPos, this.caseSH.value); } }
    this.vmFlashes?.update(dt); this.smoke.update(dt); this.puffs.update(dt); this.blood.update(dt); this.sparks.update(dt); this.flashes.update(dt);
    this.flashT -= dt;
    if (this.flashT <= 0) G.uFlashCol.value.set(0, 0, 0);
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.life += dt; if (t.life > t.max) { t.m.visible = false; continue; }
      const k = t.life / t.max; const a = t.from.clone().lerp(t.to, Math.max(0, k * 1.3 - 0.3)), b = t.from.clone().lerp(t.to, Math.min(1, k * 1.3 + 0.15));
      t.m.position.copy(a); t.m.lookAt(b); t.m.scale.set(0.006, 0.006, a.distanceTo(b));
    }
    for (let i = 0; i < this.caseData.length; i++) {
      const c = this.caseData[i];
      if (c.life < 4) {
        c.life += dt;
        if (c.bounced < 3) {
          c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt);
          this._q.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt)); c.q.multiply(this._q);
          if (c.p.y < c.ground + 0.006) {
            c.p.y = c.ground + 0.006; c.v.y = -c.v.y * 0.35; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5); c.bounced++;
            if (c.bounced === 1 && this.onCasingLand) this.onCasingLand(c.p);
            if (c.bounced >= 3) { c.q.setFromEuler(new THREE.Euler(0, rnd(0, 6), 0)); }
          }
        }
        if (c.life > 3.5) c.p.y -= dt * 0.02;
      }
      this._m.compose(c.p, c.q, new THREE.Vector3(1, 1, 1));
      this.cases.setMatrixAt(i, this._m);
    }
    this.cases.instanceMatrix.needsUpdate = true;
  }
}
