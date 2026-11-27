import * as THREE from 'three';
import { NOISE } from './glsl';
import { FOG_COLOR, FOG_DENSITY, type Shared } from './shared';

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor; uniform float uFogDensity;
  vec3 applyFog(vec3 c, float dist) { float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist); return mix(c, uFogColor, f); }
  float fogK(float dist) { return exp(-uFogDensity * uFogDensity * dist * dist); }
`;
export const fogUniforms = () => ({ uFogColor: { value: FOG_COLOR.clone() }, uFogDensity: { value: FOG_DENSITY } });

// ------------------------------------------------------------------
// 火盆的火：每个火盆若干张朝向镜头的面片（各自相位不同，叠出体积感）+ 一张大的暖色辉光
// ------------------------------------------------------------------
export function createFlames(sh: Shared, fogU: ReturnType<typeof fogUniforms>) {
  const centers: number[] = [], corners: number[] = [], params: number[] = [];
  const idx: number[] = [];
  let v = 0;
  const quad = (c: THREE.Vector3, w: number, h: number, kind: number, seed: number, which: number) => {
    for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
      centers.push(c.x, c.y, c.z); corners.push(cx * w, cy * h); params.push(kind, seed, which, w);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  };
  sh.braziers.forEach((b, i) => {
    const top = new THREE.Vector3(b.x, 0.98, b.z);
    quad(new THREE.Vector3(b.x, 0.35, b.z), 3.4, 3.2, 2, i * 3.1, i);        // 辉光（放在最前面画）
    for (let k = 0; k < 3; k++) {
      const off = new THREE.Vector3((k - 1) * 0.1, 0, ((k * 7) % 3 - 1) * 0.08);
      quad(top.clone().add(off), 1.1 - k * 0.1, 1.4 + (k % 2) * 0.3, 1, i * 10 + k * 2.37, i);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(centers, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(params, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sh.uTime, uDim: sh.uDim, uFire: sh.uFire, ...fogU },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; attribute vec4 aParam;
      varying vec2 vUv; varying vec4 vP; varying float vDist;
      uniform vec2 uFire;
      void main() {
        float boost = aParam.z < 0.5 ? uFire.x : uFire.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec2 c = aCorner;
        if (aParam.x > 1.5) c.y -= 0.5 * 3.2; // 辉光以中心为原点
        else c *= vec2(1.0, 0.8 + 0.25 * boost);
        mv.xy += c;
        vUv = aCorner / vec2(1.0, 1.0); vUv.x = vUv.x; vP = aParam; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim; uniform vec2 uFire;
      varying vec2 vUv; varying vec4 vP; varying float vDist;
      ${NOISE}
      ${FOG_GLSL}
      void main() {
        float boost = vP.z < 0.5 ? uFire.x : uFire.y;
        vec3 col;
        if (vP.x > 1.5) {
          // 辉光
          float r = length(vec2(vUv.x / 1.7, (vUv.y - 1.6) / 1.6));
          float a = exp(-r * r * 4.5) * 0.22 * boost;
          col = vec3(1.0, 0.42, 0.12) * a;
        } else {
          float w = vP.w;
          vec2 uv = vec2(vUv.x / w + 0.5, vUv.y / 1.2);
          float t = uTime;
          float sd = vP.y;
          // 域扭曲：往上走的湍流把火苗撕成几条舌头
          vec2 q = vec2(uv.x * 2.4 + sd, uv.y * 1.8 - t * 2.4);
          vec2 warp = vec2(fbm3(q), fbm3(q + 5.2)) - 0.5;
          vec2 u2 = uv + warp * vec2(0.55, 0.3) * (0.25 + uv.y);
          float y = clamp(u2.y, 0.0, 1.2);
          float n = fbm3(vec2(u2.x * 4.0 + sd * 2.0, u2.y * 3.0 - t * 3.6));
          float width = 0.36 * pow(max(1.0 - y, 0.0), 0.7);
          float dx = abs(u2.x - 0.5);
          float body = smoothstep(width, width * 0.25, dx) * smoothstep(0.0, 0.1, uv.y);
          body *= smoothstep(0.15, 0.6, n + (1.0 - y) * 0.55);
          body = clamp(body * 1.4, 0.0, 1.0);
          float core = smoothstep(0.5, 1.0, body) * (1.0 - smoothstep(0.05, 0.45, y));
          vec3 hot = vec3(1.0, 0.7, 0.35) * 3.6, mid = vec3(1.0, 0.33, 0.06) * 2.0, cool = vec3(0.5, 0.07, 0.015) * 0.9;
          col = mix(cool, mid, smoothstep(0.15, 0.6, body) * (1.0 - smoothstep(0.3, 0.9, y)));
          col = mix(col, hot, core);
          col *= body * (0.5 + 0.55 * boost) * 0.55;
        }
        col *= fogK(vDist) * (1.0 - 0.55 * uDim);
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// ------------------------------------------------------------------
// 粒子：雪（近处大而虚、远处小而密）+ 火盆的火星 + 砸地扬起的雪粉。一次绘制，全在顶点着色器里算。
// ------------------------------------------------------------------
export function createParticles(sh: Shared, fogU: ReturnType<typeof fogUniforms>) {
  const NS = 9000, NE = 260, NP = 420;
  const N = NS + NE + NP;
  const a = new Float32Array(N * 4), b = new Float32Array(N * 4), kd = new Float32Array(N);
  const rnd = Math.random;
  for (let i = 0; i < N; i++) {
    let kind = 0;
    if (i >= NS) kind = 1;
    if (i >= NS + NE) kind = 2;
    if (kind === 0) {
      // 雪：在一个盒子里循环下落。一半粒子集中在镜头附近（近处的大雪片），另一半散在远处
      const near = i < NS * 0.35;
      a[i * 4] = (rnd() - 0.5) * (near ? 30 : 64);
      a[i * 4 + 1] = rnd() * 16;
      a[i * 4 + 2] = near ? -4 + rnd() * 14 : -30 + rnd() * 26;
      a[i * 4 + 3] = 0;
    } else if (kind === 1) {
      a[i * 4] = rnd(); a[i * 4 + 1] = rnd(); a[i * 4 + 2] = rnd(); a[i * 4 + 3] = 1;
    } else {
      a[i * 4] = rnd(); a[i * 4 + 1] = rnd(); a[i * 4 + 2] = rnd(); a[i * 4 + 3] = 2;
    }
    b[i * 4] = rnd(); b[i * 4 + 1] = rnd(); b[i * 4 + 2] = rnd(); b[i * 4 + 3] = rnd();
    kd[i] = kind;
  }
  const a3 = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { a3[i * 3] = a[i * 4]; a3[i * 3 + 1] = a[i * 4 + 1]; a3[i * 3 + 2] = a[i * 4 + 2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a3, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(b, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(kd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sh.uTime, uDim: sh.uDim, uFire: sh.uFire, uImpact: sh.uImpact,
      uBrz: { value: sh.braziers }, uScale: { value: 800 }, ...fogU,
    },
    vertexShader: /* glsl */ `
      attribute vec4 aRand; attribute float aKind;
      uniform float uTime; uniform float uDim; uniform vec3 uBrz[2]; uniform float uScale; uniform vec3 uImpact; uniform vec2 uFire;
      varying vec4 vCol; varying float vSoft; varying float vAdd;
      ${FOG_GLSL}
      void main() {
        float kind = aKind;
        vec3 p; float size; vec3 col; float alpha; float soft = 0.0; float add = 0.0;
        if (kind < 0.5) {
          float speed = 0.55 + aRand.x * 0.5;
          float H = 16.0;
          p = position.xyz;
          p.y = mod(p.y - uTime * speed, H);
          float ph = aRand.y * 6.283;
          p.x += sin(uTime * (0.4 + aRand.z * 0.5) + ph) * 0.45 + uTime * 0.35;
          p.z += cos(uTime * (0.3 + aRand.w * 0.4) + ph) * 0.35;
          // x 方向绕着镜头附近循环，风把雪往右吹也不会吹空
          float W = position.z > -4.5 ? 30.0 : 64.0;
          p.x = mod(p.x + W * 0.5 - cameraPosition.x, W) - W * 0.5 + cameraPosition.x;
          size = 0.022 + aRand.w * 0.03;
          col = vec3(0.78, 0.84, 0.95);
          alpha = 0.85;
        } else if (kind < 1.5) {
          // 火星：从火盆里往上飘，打着旋，烧尽就没了
          int bi = aRand.x < 0.5 ? 0 : 1;
          vec3 b = uBrz[bi];
          float boost = bi == 0 ? uFire.x : uFire.y;
          float rate = 0.35 + aRand.y * 0.4;
          float ph = fract(uTime * rate + position.x);
          float life = ph;
          vec2 o = (vec2(position.y, position.z) - 0.5) * 0.5;
          float rise = life * (1.8 + aRand.z * 2.2) * (0.7 + 0.3 * boost);
          float sw = uTime * (1.5 + aRand.w * 2.0) + position.x * 30.0;
          p = vec3(b.x + o.x + sin(sw) * 0.25 * life + life * life * 0.9, 1.05 + rise, b.z + o.y + cos(sw * 0.8) * 0.2 * life);
          size = 0.016 + aRand.w * 0.018;
          float fl = 0.6 + 0.4 * sin(uTime * 23.0 + position.x * 50.0);
          col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.22, 0.04), life) * 3.2 * fl;
          alpha = (1.0 - smoothstep(0.55, 1.0, life)) * smoothstep(0.0, 0.05, life);
          add = 1.0;
        } else {
          // 砸地扬起的雪粉：从冲击点往外、往上喷，然后落下来
          float age = uTime - uImpact.y;
          float dur = 1.3 + aRand.x * 0.9;
          float k = clamp(age / dur, 0.0, 1.0);
          float ang = position.x * 6.283;
          float spd = (0.5 + position.y * 2.4) * uImpact.z;
          vec3 v0 = vec3(cos(ang) * spd, (0.8 + position.z * 2.6) * uImpact.z, sin(ang) * spd * 0.6);
          float tt = age * (1.0 - 0.5 * k);
          p = vec3(uImpact.x, 0.05, 0.0) + v0 * tt + vec3(0.0, -2.2 * tt * tt, 0.0);
          p.y = max(p.y, 0.02);
          size = 0.04 + aRand.w * 0.09 * (0.5 + k);
          col = vec3(0.72, 0.78, 0.88);
          alpha = (age > 0.0 ? 1.0 : 0.0) * (1.0 - k) * 0.55;
          soft = 0.6;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float px = size * uScale / max(dist, 0.05);
        // 很近的雪片：放大、变虚、变淡（像在焦外）
        if (kind < 0.5) {
          float nearK = 1.0 - smoothstep(1.5, 5.0, dist);
          px *= 1.0 + nearK * 2.0;
          soft = max(soft, nearK);
          alpha *= mix(1.0, 0.22, nearK) * smoothstep(0.35, 1.2, dist);
          // 太小的远雪：点不小于 1.2 像素，用透明度来补偿
          float m = max(px, 1.2);
          alpha *= clamp(px / m, 0.0, 1.0) * 0.85 + 0.15;
          px = m;
        }
        px = min(px, 46.0);
        float fk = fogK(dist);
        vec3 c = col * (1.0 - 0.6 * uDim);
        // 雾里的雪带一点雾色
        if (add < 0.5) c = mix(uFogColor * 2.2, c, fk);
        alpha *= mix(0.25, 1.0, fk);
        vCol = vec4(c, alpha);
        vSoft = soft + add * 0.5;
        // 加色混合的粒子：预乘透明度为 0
        vAdd = add;
        if (add > 0.5) vCol = vec4(c * alpha * fk, 0.0);
        if (alpha <= 0.001) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        gl_PointSize = px;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vCol; varying float vSoft; varying float vAdd;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float r = dot(q, q);
        if (r > 1.0) discard;
        float m = mix(1.0 - smoothstep(0.35, 1.0, r), exp(-r * 3.0) * (1.0 - r), clamp(vSoft, 0.0, 1.0));
        if (vAdd < 0.5) gl_FragColor = vec4(vCol.rgb * vCol.a * m, vCol.a * m);
        else gl_FragColor = vec4(vCol.rgb * m, 0.0);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 20;
  return { points: pts, mat };
}

// ------------------------------------------------------------------
// 雾片：几张竖直的大面片，放在前中远几层之间，下浓上淡、慢慢流动。一次绘制。
// ------------------------------------------------------------------
export function createFogCards(sh: Shared, fogU: ReturnType<typeof fogUniforms>) {
  // [z, 宽, 高, 底, 浓度, 冷暖(0 冷 1 暖)]
  const cards: number[][] = [
    [2.6, 46, 0.8, 0, 0.3, 0.0],       // 镜头前脚边的薄雾
    [-2.2, 60, 1.4, 0, 0.42, 0.3],     // 角色身后贴地的雾，被火盆照暖一点
    [-6.5, 70, 2.0, 0, 0.5, 0.15],
    [-11.0, 90, 1.6, 0, 0.55, 0.1],    // 石狮、石灯一带贴地的雾
    [-15.6, 90, 3.6, 0, 0.8, 0.0],     // 大殿台基和院墙前：中景和后面隔开的一层
    [-31, 130, 9, -0.5, 0.75, 0.0],    // 大殿后面、雪松前：远景再隔一层
    [-40, 170, 13, -1, 0.65, 0.0],     // 远处树林前
    [-52, 220, 16, -1, 0.7, 0.0],
  ];
  const pos: number[] = [], uv: number[] = [], prm: number[] = [], idx: number[] = [];
  let v = 0;
  for (const [z, w, h, y0, dens, warm] of cards) {
    for (const [ux, uy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push((ux - 0.5) * w, y0 + uy * h, z); uv.push(ux, uy); prm.push(dens, warm, w, h);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(prm, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sh.uTime, uDim: sh.uDim, uBrz: { value: sh.braziers }, uFire: sh.uFire, ...fogU },
    vertexShader: /* glsl */ `
      attribute vec4 aParam;
      varying vec2 vUv; varying vec4 vP; varying vec3 vW; varying float vDist;
      void main() {
        vUv = uv; vP = aParam;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim; uniform vec3 uBrz[2]; uniform vec2 uFire;
      varying vec2 vUv; varying vec4 vP; varying vec3 vW; varying float vDist;
      ${NOISE}
      ${FOG_GLSL}
      void main() {
        vec2 p = vec2(vW.x, vW.y) * vec2(0.16, 0.5);
        float n = fbm5(p + vec2(uTime * 0.09 + vW.z * 0.37, -uTime * 0.015));
        float n2 = fbm3(p * 2.3 + vec2(-uTime * 0.13, vW.z));
        float d = smoothstep(0.25, 0.85, n * 0.75 + n2 * 0.35);
        float vert = pow(max(1.0 - vUv.y, 0.0), 1.6) * smoothstep(0.0, 0.08, vUv.y + 0.08);
        float side = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float a = d * vert * side * vP.x;
        // 镜头穿过雾片时淡掉
        a *= smoothstep(0.8, 4.0, vDist);
        vec3 c = uFogColor * 3.2;
        // 火盆附近的雾被照成暖色
        float wl = 0.0;
        for (int i = 0; i < 2; i++) { float dd = length(vW - uBrz[i] - vec3(0.0, 0.6, 0.0)); wl += exp(-dd * dd * 0.18) * (i == 0 ? uFire.x : uFire.y); }
        c += vec3(0.5, 0.17, 0.05) * wl * (0.25 + vP.y);
        c *= 1.0 - 0.65 * uDim;
        float fk = fogK(vDist);
        c = mix(uFogColor * 1.6, c, fk);
        gl_FragColor = vec4(c * a, a);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}

// ------------------------------------------------------------------
// 红灯笼：一组实例化的灯笼，自发光，轻轻摇晃
// ------------------------------------------------------------------
export function createLanterns(hooks: { pos: THREE.Vector3; len: number; scale: number }[], sh: Shared) {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, y = -0.5 + t;
    prof.push(new THREE.Vector2(0.06 + 0.32 * Math.sin(Math.PI * (0.08 + 0.84 * t)), y * 0.8));
  }
  const body = new THREE.LatheGeometry(prof, 24);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a0806, roughness: 0.7, emissive: 0xff3a14, emissiveIntensity: 1.0 });
  const uniforms = { uDim: sh.uDim };
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP; uniform float uDim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float a = atan(vLP.z, vLP.x);
          float rib = smoothstep(0.75, 1.0, abs(sin(a * 9.0)));
          float yy = vLP.y / 0.4;
          float band = smoothstep(0.78, 0.86, abs(yy));
          float mid = 1.0 - yy * yy * 0.6;
          vec3 e = vec3(1.0, 0.13, 0.035) * (1.25 * mid) * (1.0 - rib * 0.6);
          e = mix(e, vec3(0.02, 0.01, 0.005), band);
          totalEmissiveRadiance = e * (1.0 - 0.6 * uDim);
        }`);
  };
  mat.customProgramCacheKey = () => 'temple-lantern';
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1a0e08, roughness: 0.6, metalness: 0.3 });
  const n = hooks.length;
  const inst = new THREE.InstancedMesh(body, mat, n);
  // 顶盖、底盖、吊绳、流苏合成一个几何体
  const parts: THREE.BufferGeometry[] = [];
  const cap1 = new THREE.CylinderGeometry(0.17, 0.2, 0.08, 16); cap1.translate(0, 0.42, 0); parts.push(cap1);
  const cap2 = new THREE.CylinderGeometry(0.2, 0.16, 0.08, 16); cap2.translate(0, -0.42, 0); parts.push(cap2);
  const rope = new THREE.CylinderGeometry(0.012, 0.012, 1, 4); rope.translate(0, 0.96, 0); parts.push(rope);
  const tas = new THREE.CylinderGeometry(0.05, 0.02, 0.45, 8); tas.translate(0, -0.7, 0); parts.push(tas);
  const merged = mergeSimple(parts);
  const caps = new THREE.InstancedMesh(merged, capMat, n);
  inst.castShadow = false; caps.castShadow = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const update = (t: number) => {
    hooks.forEach((h, i) => {
      // 绕挂点摆动：先把灯笼挂在挂点下方 len 处，再整体绕挂点转
      const sw = Math.sin(t * 1.1 + i * 1.7) * 0.06 + Math.sin(t * 2.3 + i) * 0.02;
      const sw2 = Math.cos(t * 0.9 + i * 2.1) * 0.04;
      e.set(sw2, t * 0.15 + i, sw); q.setFromEuler(e);
      p.set(0, -h.len, 0).applyQuaternion(q).add(h.pos);
      s.setScalar(h.scale);
      m4.compose(p, q, s);
      inst.setMatrixAt(i, m4); caps.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true; caps.instanceMatrix.needsUpdate = true;
  };
  update(0);
  const group = new THREE.Group(); group.add(inst, caps);
  return { group, update, mat };
}

function mergeSimple(list: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// ------------------------------------------------------------------
// 幡和布条：一组挂着的布，顶点着色器里按风摆动。一次绘制。
// ------------------------------------------------------------------
export interface Cloth { top: THREE.Vector3; w: number; h: number; color: THREE.ColorRepresentation; yaw?: number }
export function createCloths(list: Cloth[], sh: Shared) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], prm: number[] = [], idx: number[] = [];
  let v = 0;
  const c = new THREE.Color();
  list.forEach((cl, k) => {
    const sx = 4, sy = 14;
    c.set(cl.color);
    const yaw = cl.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
      const u = i / sx, t = j / sy;
      const lx = (u - 0.5) * cl.w;
      pos.push(cl.top.x + lx * cs, cl.top.y - t * cl.h, cl.top.z - lx * sn);
      nor.push(sn, 0, cs); uv.push(u, t); col.push(c.r, c.g, c.b); prm.push(t, k * 1.37, cl.h, 0);
    }
    for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      const a = v + j * (sx + 1) + i, b = a + 1, d = a + sx + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    v += (sx + 1) * (sy + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aCloth', new THREE.Float32BufferAttribute(prm, 4));
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = sh.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aCloth; uniform float uTime; varying vec2 vCuv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float t = aCloth.x, ph = aCloth.y;
          float w = t * t;
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + ph * 0.5);
          float wave = sin(uTime * 3.1 + ph - t * 4.0) * 0.18 + sin(uTime * 5.3 + ph * 2.0 - t * 7.0) * 0.06;
          transformed.x += (0.35 * gust + wave) * w * aCloth.z * 0.45;
          transformed.z += (sin(uTime * 2.2 + ph - t * 3.0) * 0.12) * w * aCloth.z * 0.4;
          transformed.y += abs(wave) * w * 0.2 * aCloth.z * 0.3;
          vCuv = uv;
        }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vCuv;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // 褪色、边缘磨破、竖着写的一列字（只是深色的块，不是真的字）
          float fade = fbm3(vCuv * vec2(4.0, 12.0));
          diffuseColor.rgb *= 0.65 + 0.5 * fade;
          float col = smoothstep(0.38, 0.4, vCuv.x) * smoothstep(0.62, 0.6, vCuv.x);
          float glyph = step(0.5, hash21(floor(vCuv * vec2(3.0, 18.0)))) * col * step(0.12, vCuv.y) * step(vCuv.y, 0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.025, 0.02), glyph * 0.7);
          float torn = vnoise(vec2(vCuv.x * 20.0, 3.0)) * 0.12 + vnoise(vec2(vCuv.y * 18.0, 7.0)) * 0.05;
          if (vCuv.y > 0.9 - torn || abs(vCuv.x - 0.5) > 0.5 - torn * 0.3 * vCuv.y) discard;
        }`);
  };
  mat.customProgramCacheKey = () => 'temple-cloth';
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------
// 月光光柱：几束从左上方斜着打下来的体积光。每束是一张沿光柱轴线、绕轴转向镜头的长条面片，
// 加法混合；里面是沿轴慢慢流动的噪声（光里的雾气）和往下飘的细雪尘。镜头顺着光柱看、或者离得很近时淡掉。
// 落点都放在中景两侧（院墙前、大殿台基前），不压在角色身后正中。一次绘制。
// ------------------------------------------------------------------
export const SHAFT_DIR = new THREE.Vector3(-0.42, 1, 0.12).normalize(); // 从落点指向光源
export function createLightShafts(sh: Shared, fogU: ReturnType<typeof fogUniforms>) {
  // [落点 x, 落点 z, 宽, 长, 强度]
  const shafts: number[][] = [
    [-12.5, -10.5, 2.6, 17, 1.0],
    [-8.6, -14.8, 1.6, 18, 0.8],
    [-5.2, -16.2, 2.2, 19, 0.55],
    [-15.5, -6.5, 1.4, 15, 0.7],
    [12.5, -15.5, 1.8, 17, 0.4],
    [17.5, -9.0, 2.4, 16, 0.45],
  ];
  const pos: number[] = [], ax: number[] = [], prm: number[] = [], idx: number[] = [];
  let v = 0;
  for (const [x, z, w, len, k] of shafts) {
    for (const [u, t] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      pos.push(x, 0, z); ax.push(u * w * 0.5, t * len, u); prm.push(k, x * 0.37 + z * 0.11, w, len);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAx', new THREE.Float32BufferAttribute(ax, 3));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(prm, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sh.uTime, uDim: sh.uDim, uDir: { value: SHAFT_DIR.clone() }, uStrength: { value: 1 }, ...fogU },
    vertexShader: /* glsl */ `
      attribute vec3 aAx; attribute vec4 aParam;
      uniform vec3 uDir;
      varying vec2 vUv; varying vec4 vP; varying float vDist; varying float vFace; varying vec3 vW;
      void main() {
        vec3 base = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 p = base + uDir * aAx.y;
        // 绕轴转向镜头
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(uDir, toCam));
        p += side * aAx.x * (1.0 + aAx.y / aParam.w * 0.8); // 往上略微张开
        vW = p;
        vUv = vec2(aAx.z * 0.5 + 0.5, aAx.y / aParam.w);
        vP = aParam;
        // 镜头顺着光柱方向看时这一束会变成一团亮，淡掉
        vFace = 1.0 - abs(dot(uDir, toCam));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim; uniform float uStrength;
      varying vec2 vUv; varying vec4 vP; varying float vDist; varying float vFace; varying vec3 vW;
      ${NOISE}
      ${FOG_GLSL}
      void main() {
        float x = vUv.x, t = vUv.y, sd = vP.y;
        // 横截面：中间实、两边软
        float across = smoothstep(0.0, 0.35, x) * smoothstep(1.0, 0.65, x);
        // 沿轴：落地处最实，往上慢慢没进夜空；地面那一头也软一点
        float along = smoothstep(0.0, 0.08, t) * pow(max(1.0 - t, 0.0), 1.4);
        // 光里的雾：沿轴拉长的噪声，缓慢流动（几道细的条纹 + 大团）
        float streak = fbm3(vec2(x * 6.0 + sd * 3.0, t * 1.2 - uTime * 0.03));
        float puff = fbm3(vec2(x * 1.5 + sd, t * 3.0 + uTime * 0.05));
        float dens = (0.45 + 0.75 * streak) * (0.55 + 0.6 * puff);
        // 雪尘：小亮点慢慢往下飘
        vec2 dg = vec2(x * vP.z * 7.0, t * vP.w * 2.2 + uTime * 0.35 + sd);
        vec2 cell = floor(dg), f = fract(dg) - 0.5;
        vec2 o = hash22(cell + sd) - 0.5;
        float dust = step(0.82, hash21(cell * 1.7 + 3.0)) * smoothstep(0.09, 0.0, length(f - o * 0.6));
        float a = across * along * vP.x * uStrength;
        vec3 c = vec3(0.30, 0.40, 0.56) * a * dens * 0.3 + vec3(0.6, 0.7, 0.85) * dust * a * 0.8;
        c *= smoothstep(0.1, 0.5, vFace) * smoothstep(6.0, 18.0, vDist) * fogK(vDist * 0.6) * (1.0 - 0.85 * uDim);
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return mesh;
}

// ------------------------------------------------------------------
// 暖色光晕：灯笼和火盆周围一团被照亮的雾（朝向镜头的面片，加法混合，带一点慢慢翻动的噪声）。一次绘制。
// ------------------------------------------------------------------
export function createHalos(list: { pos: THREE.Vector3; size: number; k: number; fire: number }[], sh: Shared, fogU: ReturnType<typeof fogUniforms>) {
  const pos: number[] = [], cor: number[] = [], prm: number[] = [], idx: number[] = [];
  let v = 0;
  list.forEach((h, i) => {
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(h.pos.x, h.pos.y, h.pos.z); cor.push(cx * h.size, cy * h.size); prm.push(h.k, i * 2.13, h.fire, h.size);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(cor, 2));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(prm, 4));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sh.uTime, uDim: sh.uDim, uFire: sh.uFire, ...fogU },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner; attribute vec4 aParam;
      varying vec2 vC; varying vec4 vP; varying float vDist;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // 往镜头方向挪一点，免得被挂它的东西（檐、火盆）挡掉一半
        mv.xyz += normalize(-mv.xyz) * min(aParam.w * 0.5, max(0.0, -mv.z - 1.5));
        mv.xy += aCorner;
        vC = aCorner / aParam.w; vP = aParam; vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim; uniform vec2 uFire;
      varying vec2 vC; varying vec4 vP; varying float vDist;
      ${NOISE}
      ${FOG_GLSL}
      void main() {
        float r2 = dot(vC, vC);
        if (r2 > 1.0) discard;
        float fall = exp(-r2 * 4.0) - exp(-4.0);
        float n = fbm3(vC * 1.8 + vec2(vP.y, uTime * 0.12));
        float k = vP.x * fall * (0.65 + 0.7 * n);
        float fire = vP.z > 1.5 ? uFire.y : (vP.z > 0.5 ? uFire.x : 1.0);
        vec3 c = vec3(1.0, 0.36, 0.11) * k * fire;
        c *= smoothstep(1.0, 3.5, vDist) * fogK(vDist * 0.8) * (1.0 - 0.7 * uDim);
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return mesh;
}
