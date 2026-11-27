// 材质：半湿沥青（积水 + 平面倒影）、路肩、草地、砾石、护栏、轮胎墙、广告牌
import * as THREE from 'three/webgpu';
import {
  texture, uv, positionWorld, cameraPosition, vec2, vec3, vec4, float, mix, smoothstep, max, pow, normalize, abs, fract, floor,
  exp, attribute, output, reflector, normalMap, oneMinus, saturate, step, mrt, positionLocal, time, sin, length, normalWorld, color, uniform, hash, min, dot,
} from 'three/tsl';

export const NOISE_SIZE = 512, NOISE_WORLD = 96;   // 噪声贴图边长（像素）与对应的世界尺寸（米）
export const WET = { a: 0.43, b: 0.62, pa: 0.645, pb: 0.69 };
export const PROBE = { on: uniform(0) };                                  // 正在拍反射探针时为 1
export const AMBIENT = { irr: null };                                     // 天光辐照度（随法线变化），由 main.js 填入
// 纯漫反射材质（草、树叶）：把天光作为间接漫反射加进去（会被环境光遮蔽压暗）；reflectivity=0：不让环境反射去乘漫反射颜色
export const soft = (m) => { m.reflectivity = 0; m.setupLightMap = () => (AMBIENT.irr ? new THREE.IrradianceNode(AMBIENT.irr) : null); return m; };
export const PASS = { pre: false, csm: null };                            // pre：正在画遮蔽用的深度预渲染（这一遍不更新倒影和阴影贴图）
export const SUN = { dir: uniform(new THREE.Vector3(0.7, 0.35, 0.6)) };   // 太阳方向（世界坐标），启动时由 main.js 填入
// 逆光透亮：镜头朝太阳方向看时，草叶 / 树叶被阳光打透的程度（0–1）
export const backlit = (power = 3) => pow(saturate(dot(normalize(positionWorld.sub(cameraPosition)), SUN.dir)), power);

// ---------- 可平铺的分形噪声（CPU 生成，着色器和物理共用同一份数据）----------
function hash2(ix, iy, seed) { let h = (ix * 374761393 + iy * 668265263 + seed * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function tileFbm(size, cells, octaves, seed) {
  const out = new Float32Array(size * size); let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o, sc = c / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x * sc, fy = y * sc, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = hash2(ix % c, iy % c, seed + o), b = hash2((ix + 1) % c, iy % c, seed + o), d = hash2(ix % c, (iy + 1) % c, seed + o), e = hash2((ix + 1) % c, (iy + 1) % c, seed + o);
      out[y * size + x] += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
    }
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
export function makeNoise() {
  const S = NOISE_SIZE;
  const R = tileFbm(S, 5, 5, 11), Gn = tileFbm(S, 8, 5, 37), B = tileFbm(S, 40, 3, 71), A = tileFbm(S, 3, 3, 97);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { data[i * 4] = R[i] * 255; data[i * 4 + 1] = Gn[i] * 255; data[i * 4 + 2] = B[i] * 255; data[i * 4 + 3] = A[i] * 255; }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
  const sample = (arr, wx, wz) => {   // 与着色器一致：uv = worldXZ / NOISE_WORLD
    let fx = (wx / NOISE_WORLD) * S - 0.5, fy = (wz / NOISE_WORLD) * S - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const m = v => ((v % S) + S) % S, g = (x, y) => arr[m(y) * S + m(x)];
    return (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
  };
  return { tex, wet: (wx, wz) => sample(R, wx, wz), puddle: (wx, wz) => sample(Gn, wx, wz) };
}

export function loadTextures(names, onProgress) {
  const L = new THREE.TextureLoader(), T = {};
  const jobs = [];
  for (const n of names) for (const k of ['diff', 'nor', 'rough']) {
    jobs.push(L.loadAsync(`assets/tex/${n}_${k}.jpg`).then(t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; t.colorSpace = k === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      T[`${n}_${k}`] = t; onProgress && onProgress();
    }));
  }
  return Promise.all(jobs).then(() => T);
}

const noVel = () => mrt({ velocity: vec4(0, 0, 0, 0) });   // 透明物体不写速度（alpha=0 时混合后保持背景速度）

export function makeMaterials(T, noise, scene, quality) {
  const M = {};
  const wpos = positionWorld.xz;
  const nz = texture(noise.tex, wpos.div(NOISE_WORLD));
  const nd = texture(noise.tex, wpos.div(7.3)).b;

  // ================= 沥青路面 =================
  // 新旧沥青分段铺装、施工缝与灌缝胶、行车线上的两道胎胶、石子颗粒、路缘积土；半湿：湿痕 + 积水 + 平面倒影
  {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const uvm = uv();                                  // (d 横向, s 里程)，单位米
    const tuv = uvm.div(4.6), tuvB = uvm.div(6.1).add(vec2(0.37, 0.11));
    const A = texture(T.asphalt_track_diff, tuv).rgb, B = texture(T.asphalt_02_diff, tuvB).rgb;
    const norT = texture(T.asphalt_track_nor, tuv).rgb, norB = texture(T.asphalt_02_nor, tuvB).rgb, norD = texture(T.asphalt_track_nor, tuv.mul(5.3)).rgb;
    const rgh = texture(T.asphalt_track_rough, tuv).g;
    const ad = abs(uvm.x);
    const ld = attribute('lineDist', 'float'), rubK = attribute('rub', 'float');
    const fine = texture(noise.tex, wpos.div(1.15)).b;                     // 约 3 cm 的石子颗粒
    const macro = nz.a.mul(0.5).add(0.75);
    // 分段：每 47 m 一段，约四成是颜色更浅、带裂缝的旧沥青
    const SEC = 47, sf = uvm.y.div(SEC), fs = fract(sf);
    const old = smoothstep(0.56, 0.60, hash(floor(sf).add(7))).mul(0.8).add(0.1);
    const seam = oneMinus(smoothstep(0.025, 0.055, min(fs, oneMinus(fs)).mul(SEC).add(nd.sub(0.5).mul(0.03))));                       // 横向施工缝
    const joint = oneMinus(smoothstep(0.010, 0.028, abs(uvm.x.sub(0.32).sub(nz.b.sub(0.5).mul(0.07))))).mul(smoothstep(0.35, 0.6, nz.g));   // 纵向接缝，断断续续
    const cn = texture(noise.tex, wpos.div(23)).a;
    const snake = oneMinus(smoothstep(0.004, 0.010, abs(cn.sub(0.5)))).mul(smoothstep(0.5, 0.62, texture(noise.tex, wpos.div(61)).g)).mul(old);   // 旧路面上蜿蜒的灌缝胶
    const tar = saturate(seam.mul(0.85).add(joint.mul(0.6)).add(snake));
    // 行车线：干燥线（影响湿度，和物理一致）与胎胶（两道轮迹，弯道和刹车区更重）
    const dryLine = exp(ld.mul(ld).div(-2.6)).mul(0.8).mul(nz.a.mul(0.7).add(0.5));
    const lt = abs(ld).sub(0.74);
    const rubber = saturate(exp(lt.mul(lt).div(-0.20)).mul(0.6).add(exp(ld.mul(ld).div(-3.4)).mul(0.45)).mul(rubK).mul(nz.a.mul(0.7).add(0.5)));
    const edge = smoothstep(3.0, 5.4, ad);
    const wet = smoothstep(WET.a, WET.b, nz.r.add(edge.mul(0.10)).sub(dryLine.mul(0.16)));
    const pud = smoothstep(WET.pa, WET.pb, nz.g.add(edge.mul(0.055)).add(nd.sub(0.5).mul(0.05)).sub(dryLine.mul(0.13))).mul(wet);
    // 边线与路缘积土
    const wear = smoothstep(0.30, 0.55, nd.add(nz.b.mul(0.3)));
    const lineMask = smoothstep(5.02, 5.06, ad).mul(oneMinus(smoothstep(5.20, 5.24, ad))).mul(wear.mul(0.75).add(0.25));
    const dirt = smoothstep(5.28, 5.62, ad.add(nd.sub(0.5).mul(0.4)));
    let base = mix(A.mul(2.9), B.mul(0.62), old).mul(macro).mul(fine.mul(0.55).add(0.72));
    base = mix(base, base.mul(0.42), rubber);
    base = mix(base, vec3(0.013, 0.013, 0.014), tar);
    base = mix(base, vec3(0.60, 0.60, 0.57), lineMask.mul(0.9));
    base = mix(base, vec3(0.085, 0.07, 0.045).mul(fine.add(0.5)), dirt);
    m.colorNode = base.mul(mix(float(1), float(0.55), wet)).mul(mix(float(1), float(0.72), pud));
    const dist = length(cameraPosition.sub(positionWorld));
    let rough = mix(rgh.mul(0.95).add(0.05), float(0.9), old.mul(0.5));
    rough = mix(rough, mix(float(0.34), float(0.72), fine), wet.mul(0.65));                    // 湿痕的光泽深浅不一，逆光时高光才会碎成一片片
    rough = mix(rough, float(0.3), tar.mul(0.8));
    rough = mix(rough, float(0.06), pud).add(smoothstep(10, 120, dist).mul(0.10).mul(oneMinus(pud)));   // 远处补偿被贴图层级抹平的法线细节
    m.roughnessNode = mix(rough, float(0.95), dirt);
    m.metalnessNode = float(0);
    const nxy = norT.rg.sub(0.5).add(norD.rg.sub(0.5).mul(0.7)).add(norB.rg.sub(0.5).mul(old).mul(0.9));
    m.normalNode = normalMap(mix(vec3(nxy.add(0.5), norT.b), vec3(0.5, 0.5, 1), saturate(pud.mul(1.1))), vec2(1.15, 1.15));
    m.clearcoatNode = max(wet.mul(0.26), pud).mul(oneMinus(dirt));
    m.clearcoatRoughnessNode = mix(float(0.30), float(0.025), pud);
    // 平面倒影：只在水膜上、按菲涅耳混入
    if (quality.reflection > 0) {
      const refl = reflector({ resolutionScale: quality.reflection, bounces: false, generateMipmaps: true });
      refl.target.rotateX(-Math.PI / 2); refl.target.position.y = 0.0; scene.add(refl.target);
      const distort = norT.rg.sub(0.5).mul(0.07).mul(oneMinus(pud));
      refl.uvNode = refl.uvNode.add(distort);
      const V = normalize(cameraPosition.sub(positionWorld));
      const fres = float(0.02).add(float(0.98).mul(pow(oneMinus(saturate(V.y)), 5)));
      const rmask = saturate(pud.add(wet.mul(0.13))).mul(fres).mul(oneMinus(dirt)).mul(oneMinus(PROBE.on));
      m.outputNode = vec4(mix(output.rgb, refl.rgb, rmask), 1);
      M.reflection = refl;
    }
    M.road = m; M.roadNodes = { wet, pud };
  }

  // 湿润通用项（给路肩/砾石等复用）
  const wetG = smoothstep(WET.a, WET.b, nz.r.add(0.06));

  // ================= 路肩 =================
  {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const u = uv();                                    // (横向 0..1, 里程米)
    const stripe = step(0.5, fract(u.y.div(3.2)));
    const paint = mix(vec3(0.62, 0.045, 0.04), vec3(0.78, 0.77, 0.73), stripe);
    const grime = texture(T.painted_concrete_diff, vec2(u.x.mul(1.1), u.y.div(2.2))).rgb;
    const tyreDirt = smoothstep(0.35, 0.75, nd).mul(0.45);
    m.colorNode = mix(paint.mul(grime.mul(0.9).add(0.35)), vec3(0.06, 0.06, 0.06), tyreDirt);
    m.roughnessNode = mix(float(0.62), float(0.25), wetG.mul(0.8));
    m.normalNode = normalMap(texture(T.painted_concrete_nor, vec2(u.x.mul(1.1), u.y.div(2.2))), vec2(0.6, 0.6));
    m.clearcoatNode = wetG.mul(0.22); m.clearcoatRoughnessNode = float(0.3);
    M.kerb = m;
  }

  // ================= 草地 =================
  {
    const g1 = texture(T.leafy_grass_diff, wpos.div(3.1)).rgb, g2 = texture(T.sparse_grass_diff, wpos.div(7.7)).rgb;
    const patch = smoothstep(0.38, 0.62, nz.a);
    const far = texture(T.leafy_grass_diff, wpos.div(41)).rgb;
    const dist = smoothstep(40, 220, length(cameraPosition.sub(positionWorld)));
    const tint = vec3(0.50, 0.84, 0.36);
    let c = mix(g1, g2, patch.mul(0.6));
    c = mix(c, mix(far, vec3(0.25, 0.27, 0.12), 0.6), dist).mul(tint).mul(nz.r.mul(0.5).add(0.72));
    const turf = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))).mul(vec3(0.86, 1.16, 0.42)), 0.5).mul(0.66);      // 修剪过的草皮：去掉枯叶的褐色，更绿更匀
    const glow = float(1).add(backlit(3).mul(0.55));                       // 逆光时草地整体透亮一些
    const m = new THREE.MeshLambertNodeMaterial();
    m.colorNode = c.mul(0.68).mul(glow);                                   // 有了天光之后整体压暗一档，否则草地发亮发荧光
    m.normalNode = normalMap(texture(T.leafy_grass_nor, wpos.div(3.1)), vec2(0.8, 0.8));
    soft(m); M.grass = m; M.grassTint = vec3(0.78, 0.92, 0.62);
    // 路边草带：沿赛道方向的割草条纹；贴着路缘的地方被压秃露土
    const v = new THREE.MeshLambertNodeMaterial();
    const u = uv(), ad = abs(u.x);                                         // (d 横向, s 里程)
    const stripe = step(0.5, fract(ad.div(4.4))).mul(0.17).add(0.915);
    const fine = texture(noise.tex, wpos.div(1.15)).b;
    const worn = smoothstep(0.66, 0.82, nz.g.mul(0.8).add(oneMinus(smoothstep(5.5, 6.6, ad)).mul(0.3)).add(nd.sub(0.5).mul(0.2)));
    v.colorNode = mix(turf.mul(stripe), vec3(0.105, 0.078, 0.045).mul(fine.add(0.5)), worn.mul(0.8)).mul(glow);
    v.normalNode = m.normalNode;
    v.polygonOffset = true; v.polygonOffsetFactor = -1; v.polygonOffsetUnits = -1;
    soft(v); M.verge = v;
  }

  // ================= 砾石 =================
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const guv = wpos.div(2.6);
    m.colorNode = texture(T.gravel_floor_02_diff, guv).rgb.mul(vec3(0.84, 0.79, 0.70)).mul(nz.a.mul(0.36).add(0.78)).mul(mix(float(1), float(0.68), wetG));
    m.roughnessNode = max(texture(T.gravel_floor_02_rough, guv).g, float(0.86)).sub(wetG.mul(0.08));      // 砾石几乎没有镜面高光，逆光时不该白成一片
    m.normalNode = normalMap(texture(T.gravel_floor_02_nor, guv), vec2(1.3, 1.3));
    m.envMapIntensity = 0.3;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    M.gravel = m;
  }

  // ================= 护栏（镀锌钢）=================
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const u = uv();
    const streak = texture(noise.tex, vec2(u.x.div(9), u.y.mul(0.7))).b;
    const dirt = texture(noise.tex, vec2(u.x.div(31), u.y.mul(0.21))).r;
    const lap = oneMinus(smoothstep(0.004, 0.012, abs(fract(u.x.div(3.81)).sub(0.5)).mul(3.81)));        // 板与板的搭接缝
    const bolt = oneMinus(smoothstep(0.018, 0.03, length(vec2(fract(u.x.div(3.81)).sub(0.5).mul(3.81).abs().sub(0.07), fract(u.y.mul(2.15)).sub(0.5).div(2.15)))));
    m.colorNode = mix(vec3(0.50, 0.51, 0.52), vec3(0.30, 0.27, 0.23), smoothstep(0.45, 0.75, dirt).mul(0.7)).mul(streak.mul(0.3).add(0.8)).mul(oneMinus(lap.mul(0.7))).mul(oneMinus(bolt.mul(0.55)));
    m.metalnessNode = float(0.55);
    m.roughnessNode = streak.mul(0.25).add(0.46);
    m.side = THREE.DoubleSide;
    M.armco = m;
    const p = new THREE.MeshStandardNodeMaterial(); p.colorNode = vec3(0.30, 0.31, 0.32); p.metalnessNode = float(0.7); p.roughnessNode = float(0.55); M.post = p;
  }

  // ================= 轮胎墙 =================
  {
    const m = new THREE.MeshStandardNodeMaterial();
    m.roughnessNode = float(0.78); m.metalnessNode = float(0);
    M.tyre = m;       // 颜色走 instanceColor
  }

  // ================= 混凝土 / 通用 =================
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const cu = uv().div(2.4);
    m.colorNode = texture(T.concrete_wall_008_diff, cu).rgb.mul(0.9);
    m.roughnessNode = texture(T.concrete_wall_008_rough, cu).g;
    m.normalNode = normalMap(texture(T.concrete_wall_008_nor, cu), vec2(1, 1));
    M.concrete = m;
    const s = new THREE.MeshStandardNodeMaterial(); s.colorNode = vec3(0.09, 0.09, 0.10); s.metalnessNode = float(0.6); s.roughnessNode = float(0.5); M.steelDark = s;
  }

  // ================= 赛道涂装（起终点线、发车格）=================
  {
    const m = new THREE.MeshPhysicalNodeMaterial();
    const wear = smoothstep(0.25, 0.6, nd.add(nz.b.mul(0.35)));
    m.colorNode = attribute('color', 'vec3').mul(wear.mul(0.35).add(0.65));
    m.roughnessNode = mix(float(0.55), float(0.2), wetG);
    m.clearcoatNode = wetG.mul(0.6); m.clearcoatRoughnessNode = float(0.08);
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    M.paint = m;
  }

  M.noVel = noVel;
  return M;
}

// 广告牌图集：虚构品牌（与影片一致）
export function makeAdAtlas() {
  const brands = [
    ['KESTREL', '#b3191e', '#f4f1ea', 'italic 900'], ['NORDWIND', '#f1efe9', '#14324d', '800'], ['VELOCE', '#e7b416', '#161616', 'italic 900'],
    ['HALDEN', '#143c2a', '#efe9d6', '700'], ['ORBIT', '#16181d', '#f2f2f2', '900'], ['DASHI', '#f4f1ea', '#c2261d', '900'],
    ['MERIDIAN', '#1f3f8a', '#f6f4ee', '700'], ['CORSA 76', '#d95a16', '#fbf7ee', 'italic 900'],
  ];
  const W = 1024, H = 192, cv = document.createElement('canvas'); cv.width = W; cv.height = H * brands.length;
  const g = cv.getContext('2d');
  brands.forEach((b, i) => {
    g.fillStyle = b[1]; g.fillRect(0, i * H, W, H);
    g.fillStyle = b[2]; g.font = `${b[3]} 124px "Helvetica Neue", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = b[0].split('').join(' ');
    g.fillText(text, W / 2, i * H + H / 2 + 6, W - 90);
    g.fillRect(28, i * H + 20, W - 56, 5); g.fillRect(28, i * H + H - 25, W - 56, 5);
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { tex: t, count: brands.length };
}
