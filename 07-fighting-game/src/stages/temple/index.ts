import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGLTF } from '../../anim/rig';
import type { Stage, StageContext, StageFactory } from '../../stage/types';
import { createArchitecture, HALL, HALL_OFFSET } from './architecture';
import { createEnv } from './env';
import { createCloths, createFlames, createFogCards, createHalos, createLanterns, createLightShafts, createParticles, fogUniforms, type Cloth } from './fx';
import { createGround } from './ground';
import { patchSnow, snowyMaterial } from './materials';
import { createForest, createGrass, fallbackBrazier, fallbackPagoda, fallbackStoneLantern, LAYOUT, pineGeometry, type Place } from './props';
import { createShared, FOG_COLOR, FOG_DENSITY } from './shared';
import { createSky } from './sky';
import { PlanarReflection } from './reflection';

const BASE = '/assets/stage/temple';
const REFLECT = new Set(['brazier']);

async function tryGLTF(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await loadGLTF(url);
  } catch (e) { console.warn('场景模型没载入', url, e); return null; }
}
async function tryTexture(url: string, srgb = true) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
    const t = await new THREE.TextureLoader().loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch { return null; }
}

/** 把一个道具模型按目标高度缩放、放到地上 */
function place(src: THREE.Object3D, p: Place, srcHeight: number) {
  const o = src.clone();
  const k = p.h / srcHeight;
  o.scale.set(p.mirror ? -k : k, k, k);
  o.rotation.y = p.ry ?? 0;
  o.position.set(p.x, p.y ?? 0, p.z);
  return o;
}

/** 同一个道具摆好几处：每个网格做成实例化网格，一个网格一次绘制。 */
function instanced(src: THREE.Object3D, places: Place[], cast: boolean) {
  const g = new THREE.Group();
  src.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(src);
  const srcH = Math.max(1e-3, b.max.y - b.min.y);
  const pm = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const inst = new THREE.InstancedMesh(m.geometry, m.material, places.length);
    places.forEach((p, i) => {
      const k = p.h / srcH;
      pm.compose(new THREE.Vector3(p.x, (p.y ?? 0) - b.min.y * k, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry ?? 0), new THREE.Vector3(p.mirror ? -k : k, k, k));
      inst.setMatrixAt(i, tmp.multiplyMatrices(pm, m.matrixWorld));
    });
    inst.computeBoundingSphere();
    inst.castShadow = cast; inst.receiveShadow = true;
    g.add(inst);
  });
  return g;
}

/**
 * 雪夜残寺。
 * 布局（z 越负越远）：对战区 z = 0 → 火盆 z -3.4 → 石灯 z -6.4 → 石狮、台阶 z -8.6..-10.9 → 大殿 z -12.7 起 →
 * 院墙 z -10.6（两侧）→ 雪松 z -12..-25 → 树林 z -26..-80 → 佛塔 z -46 → 远山（画在天空里）。
 */
export const createTempleStage: StageFactory = async (ctx: StageContext): Promise<Stage> => {
  const { renderer, scene } = ctx;
  const root = new THREE.Group();
  root.name = 'temple';
  const sh = createShared();
  const fogU = fogUniforms();
  const q = new URLSearchParams(location.search);

  // ---- 天空、雾、环境 ----
  const env = createEnv(renderer);
  scene.background = new THREE.Color(0x000000);
  const fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);
  scene.fog = fog;
  scene.environment = env;
  const ENV_I = 0.45;
  scene.environmentIntensity = ENV_I;
  root.add(createSky(sh));

  // ---- 资源（有就用，没有就用程序化的后备） ----
  const PROP_NAMES = ['lion', 'stonelantern', 'brazier', 'pine', 'pine_lod', 'deadtree', 'pagoda', 'bellpavilion', 'balustrade', 'rubble', ...(q.get('hall') === 'proc' ? [] : ['hall'])];
  const [slabTex, ...gl] = await Promise.all([
    tryTexture(`${BASE}/slab_detail.jpg`),
    ...PROP_NAMES.map((n) => (q.get('props') === '0' ? Promise.resolve(null) : tryGLTF(`${BASE}/props/${n}.glb`))),
  ]);
  const nodes = new Map<string, THREE.Object3D>();
  PROP_NAMES.forEach((n, i) => { const g = gl[i]; if (g) { g.scene.name = n; nodes.set(n, g.scene); } });
  {
    for (const c of nodes.values()) {
      c.updateMatrixWorld(true);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true; m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.anisotropy = 8;
        mat.envMapIntensity = 1;
        if (c.name === 'lion' || c.name === 'stonelantern') mat.color.multiplyScalar(0.62);
        if (c.name === 'balustrade' || c.name === 'rubble') mat.color.multiplyScalar(0.7);
        if (c.name === 'bellpavilion') mat.color.multiplyScalar(0.85);
        if (c.name === 'hall') { mat.color.multiplyScalar(0.8); if (mat.map) mat.map.anisotropy = 16; }
        patchSnow(mat, { keepMap: true, snow: c.name === 'brazier' ? 0 : c.name === 'hall' ? 0.2 : 0.55, grime: 0 });
      });
    }
  }
  const heightOf = (o: THREE.Object3D) => { const b = new THREE.Box3().setFromObject(o); return Math.max(1e-3, b.max.y - b.min.y); };

  // ---- 地面、建筑 ----
  const reflection = q.get('reflect') === '0' ? null : new PlanarReflection(renderer, 0.5);
  const ground = createGround(sh, slabTex, reflection ? { tex: reflection.rt.texture, mat: reflection.texMatrix } : null);
  root.add(ground);
  const hallNode = nodes.get('hall');
  const arch = createArchitecture(hallNode ? { skipHall: true, wall: { z: HALL.z + 0.255 * HALL.w, inner: [HALL.x - 0.46 * HALL.w, HALL.x + 0.46 * HALL.w] } } : {});
  arch.group.userData.reflect = true;
  root.add(arch.group);
  // Tripo 的大殿（正面朝模型的 +x，转 -90 度朝向镜头）。宽 22 米、高 12.3 米，自带台基和台阶，
  // 程序化的殿身和台基都藏起来。台基顶面压到 0.8 米左右（往地下沉 0.3 米）。
  let lanternHooks = arch.lanternHooks;
  if (hallNode) {
    arch.hall.visible = false; arch.base.visible = false;
    const h = place(hallNode, { x: HALL.x, y: HALL.y, z: HALL.z, h: HALL.w * 0.5597, ry: -Math.PI / 2 }, heightOf(hallNode));
    h.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    h.userData.reflect = true;
    root.add(h);
    // 檐下挂灯笼：前檐柱在 z = HALL.z + 0.225 * 宽，檐口底大约 0.25 * 宽
    const fz = HALL.z + 0.27 * HALL.w, ly = HALL.y + 0.245 * HALL.w;
    lanternHooks = [new THREE.Vector3(HALL.x - 4.1, ly, fz), new THREE.Vector3(HALL.x + 4.1, ly, fz)];
  }

  // ---- 道具 ----
  const castNear = (o: THREE.Object3D, cast: boolean) => o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = true; } });
  const addProp = (key: string, fallback: (() => THREE.Object3D) | null, cast: boolean) => {
    const n = nodes.get(key);
    if (n) { const g = instanced(n, LAYOUT[key], cast); g.name = key; g.userData.reflect = REFLECT.has(key); root.add(g); return; }
    const src = fallback ? fallback() : null;
    if (!src) return;
    for (const p of LAYOUT[key]) { const o = place(src, p, 1); castNear(o, cast); root.add(o); }
  };
  addProp('brazier', () => { const m = fallbackBrazier(); return m; }, true);
  // 只有火盆离对战区近、影子落得到地上；别的道具不投影（省一遍阴影绘制）
  addProp('stonelantern', () => { const m = fallbackStoneLantern(); m.scale.setScalar(1 / 2.4); const g = new THREE.Group(); g.add(m); return g; }, false);
  addProp('lion', null, false);
  addProp('deadtree', null, false);
  if (q.get('side') !== '0') { addProp('bellpavilion', null, false); addProp('balustrade', null, false); addProp('rubble', null, false); }

  // 雪松：近处几棵用 Tripo 的（有的话），远处的树林用程序化的实例
  const pineMat = snowyMaterial({ color: 0x18221c, roughness: 0.95, snow: 1.0, grime: 0.6 });
  const pineGeo = pineGeometry();
  if (nodes.get('pine') && q.get('pine') !== 'proc') addProp('pine', null, false);
  else {
    const inst = new THREE.InstancedMesh(pineGeo, pineMat, LAYOUT.pine.length);
    const m4 = new THREE.Matrix4();
    LAYOUT.pine.forEach((p, i) => inst.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry ?? 0), new THREE.Vector3(p.h * 0.9, p.h, p.h * 0.9))));
    root.add(inst);
  }
  const lod = nodes.get('pine_lod');
  let lodMesh: THREE.Mesh | null = null;
  lod?.traverse((o) => { if ((o as THREE.Mesh).isMesh && !lodMesh) lodMesh = o as THREE.Mesh; });
  if (lodMesh) {
    const lm = lodMesh as THREE.Mesh;
    const g = lm.geometry.clone();
    g.applyMatrix4(lm.matrixWorld);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(1 / (bb.max.y - bb.min.y), 1 / (bb.max.y - bb.min.y), 1 / (bb.max.y - bb.min.y));
    root.add(createForest(g, lm.material as THREE.Material, [[-26, -36, 14, 9, 15]]));
    root.add(createForest(pineGeo, pineMat, [[-36, -55, 20, 12, 20], [-55, -80, 24, 14, 24]]));
  } else root.add(createForest(pineGeo, pineMat, [[-26, -36, 14, 9, 15], [-36, -55, 20, 12, 20], [-55, -80, 24, 14, 24]]));
  if (nodes.get('pagoda')) addProp('pagoda', null, false);
  else {
    const pg = new THREE.Mesh(fallbackPagoda(), snowyMaterial({ color: 0x3a3532, roughness: 0.9, snow: 1, grime: 0.7 }));
    const p = LAYOUT.pagoda[0]; pg.scale.setScalar(p.h); pg.position.set(p.x, 0, p.z); root.add(pg);
  }

  // 幡杆和幡：杆子放低，幡在常规机位里整面看得见（幡顶约 5.4 米，底约 1.7 米）
  const poleMat = snowyMaterial({ color: 0x241a14, roughness: 0.85, snow: 0.6, grime: 0.5 });
  const baseMat = snowyMaterial({ color: 0x6e7074, roughness: 0.9, snow: 1, grime: 0.7 });
  const cloths: Cloth[] = [];
  const poleGeo: THREE.BufferGeometry[] = [], baseGeo: THREE.BufferGeometry[] = [];
  const POLES: [number, number, number, number][] = [[-11.8, -10.2, 0x5c1a12, 6.2], [-14.2, -12.6, 0x3e3420, 5.6], [13.6, -10.2, 0x4a3a1c, 6.2], [16.4, -12.2, 0x5a1810, 5.4]];
  for (const [x, z, color, H] of POLES) {
    const pg = new THREE.CylinderGeometry(0.07, 0.11, H, 8); pg.translate(x, H / 2, z); poleGeo.push(pg);
    const bar = new THREE.BoxGeometry(1.1, 0.08, 0.08); bar.translate(x, H - 0.5, z); poleGeo.push(bar.toNonIndexed());
    const bg = new THREE.CylinderGeometry(0.35, 0.45, 0.5, 8); bg.translate(x, 0.25, z); baseGeo.push(bg);
    cloths.push({ top: new THREE.Vector3(x, H - 0.55, z + 0.06), w: 0.75, h: H - 2.3, color });
  }
  const strip = (gs: THREE.BufferGeometry[]) => gs.map((gg) => { const n = gg.index ? gg.toNonIndexed() : gg; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; });
  root.add(new THREE.Mesh(mergeGeometries(strip(poleGeo))!, poleMat), new THREE.Mesh(mergeGeometries(strip(baseGeo))!, baseMat));
  // 幡杆之间、幡杆到院墙拉的经幡绳：一串褪色的小方旗，绳子自然下垂
  const flagCols = [0x6a2a1e, 0x8a7a52, 0x3a4652, 0x9a948a, 0x5a5a3a];
  const rope = (a: THREE.Vector3, b: THREE.Vector3, sag: number, step = 0.42) => {
    const n = Math.max(2, Math.floor(a.distanceTo(b) / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t);
      const yaw = Math.atan2(b.z - a.z, b.x - a.x);
      cloths.push({ top: p, w: 0.26, h: 0.36, color: flagCols[i % flagCols.length], yaw: -yaw });
    }
  };
  rope(new THREE.Vector3(-11.8, 5.6, -10.2), new THREE.Vector3(-14.2, 5.0, -12.6), 0.35);
  rope(new THREE.Vector3(-14.2, 5.0, -12.6), new THREE.Vector3(-19.5, 3.7, -17.3), 0.5);
  rope(new THREE.Vector3(13.6, 5.6, -10.2), new THREE.Vector3(16.4, 4.8, -12.2), 0.35);
  rope(new THREE.Vector3(16.4, 4.8, -12.2), new THREE.Vector3(22.0, 3.7, -17.3), 0.5);
  // 枯树上系的布条
  for (const [x, y, z, c] of [[-14.6, 4.2, -4.3, 0x6a1c14], [-15.8, 3.6, -4.9, 0x7a6a4a], [18.0, 3.9, -1.0, 0x5a1810]] as const) {
    cloths.push({ top: new THREE.Vector3(x, y, z), w: 0.16, h: 1.3, color: c });
  }
  root.add(createCloths(cloths, sh));

  // 枯草：镜头前脚边一条（零星几丛，画面最下沿的近景）、院子两侧积雪里、墙根下（?grass=0 关）
  if (q.get('grass') !== '0') {
    const spots: number[][] = [];
    let gs = 41;
    const gr = () => { gs = (gs * 16807) % 2147483647; return gs / 2147483647; };
    // 镜头前的一条：院子前沿（石板和积雪交界，z 6.6~8）一溜枯草。远机位时草尖从画面最下沿探进来，近机位时在画面下面看不见，不会挡脚
    for (let x = -26; x < 26; x += 0.9 + gr() * 1.1) spots.push([x, 6.6 + gr() * 1.4, 0.5 + gr() * 0.4, 2 + Math.floor(gr() * 3), 0.5 + gr() * 0.35]);
    for (const sgn of [-1, 1]) {
      for (let z = -9; z < 7; z += 1.8 + gr() * 1.6) spots.push([sgn * (12.8 + gr() * 6) + (sgn > 0 ? 2 : 0), z, 0.8 + gr() * 0.6, 4 + Math.floor(gr() * 5), 0.4 + gr() * 0.35]);
      for (let x = 10; x < 32; x += 2.5 + gr() * 3) spots.push([HALL.x + sgn * x, HALL.z + 0.255 * HALL.w + 0.9 + gr() * 0.6, 0.5, 2, 0.5]);
    }
    root.add(createGrass(spots, sh));
  }

  // 灯笼
  const hooks = [
    ...lanternHooks.map((p) => ({ pos: p, len: 0.75, scale: 1.25 })),
    { pos: new THREE.Vector3(HALL_OFFSET.x - 9.2, lanternHooks[0].y - 0.2, lanternHooks[0].z - 0.6), len: 0.5, scale: 0.95 },
    { pos: new THREE.Vector3(HALL_OFFSET.x + 9.2, lanternHooks[0].y - 0.2, lanternHooks[0].z - 0.6), len: 0.5, scale: 0.95 },
  ];
  const lanterns = createLanterns(hooks, sh);
  lanterns.group.userData.reflect = true;
  root.add(lanterns.group);

  // ---- 火、粒子、雾片 ----
  const flames = createFlames(sh, fogU);
  flames.userData.reflect = true;
  root.add(flames);
  const particles = createParticles(sh, fogU);
  root.add(particles.points);
  const fogCards = createFogCards(sh, fogU);
  root.add(fogCards);
  // 空气感：月光光柱（?shafts=0 关）、灯笼和火盆的暖色光晕（?halo=0 关）
  const shafts = q.get('shafts') === '0' ? null : createLightShafts(sh, fogU);
  if (shafts) { root.add(shafts); (shafts.material as THREE.ShaderMaterial).uniforms.uStrength.value = +(q.get('shaftk') ?? 1); }
  if (q.get('halo') !== '0') {
    root.add(createHalos([
      ...hooks.map((h, i) => ({ pos: h.pos.clone().add(new THREE.Vector3(0, -h.len, 0)), size: i < 2 ? 2.2 : 1.7, k: i < 2 ? 0.2 : 0.14, fire: 0 })),
      ...sh.braziers.map((b, i) => ({ pos: new THREE.Vector3(b.x, 1.5, b.z), size: 3.6, k: 0.16, fire: i + 1 })),
    ], sh, fogU));
  }
  // 反射里只画近处会倒映到对战区积水里的东西（建筑、火盆、石狮、灯笼、火），天空、树林、粒子之类都不画，省一大半
  if (reflection) reflection.hide.push(...root.children.filter((c) => !c.userData.reflect));

  // ---- 灯光 ----
  // 主光：月光，从左前上方打过来（游戏里的“月光”要照亮角色正面），影子往右后方拖
  const key = new THREE.DirectionalLight(0x9cc6ec, 1.75);
  key.position.set(-11, 16, 9);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -13; sc.right = 13; sc.top = 9; sc.bottom = -9; sc.near = 2; sc.far = 50;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.025; key.shadow.radius = 3;
  root.add(key, key.target);
  // 正面的冷补光（不投影）：保证角色正面不黑
  const fill = new THREE.DirectionalLight(0x7f9cc8, 0.9);
  fill.position.set(2, 4, 10);
  root.add(fill, fill.target);
  // 背后的冷轮廓光
  const rim = new THREE.DirectionalLight(0x8ec4ff, 1.6);
  rim.position.set(-5, 6, -12);
  root.add(rim, rim.target);
  const hemi = new THREE.HemisphereLight(0x2a4058, 0x1a1612, 0.25);
  root.add(hemi);
  // 火盆、灯笼的点光（不投影）
  const fireL = sh.braziers.map((b) => { const l = new THREE.PointLight(0xff7a2a, 24, 11, 2.0); l.position.set(b.x, 1.55, b.z); root.add(l); return l; });
  const lanL = lanternHooks.map((h) => { const l = new THREE.PointLight(0xff4a1c, 9, 11, 1.8); l.position.set(h.x, h.y - 0.8, h.z + 0.5); root.add(l); return l; });

  scene.add(root);

  // ---- 每帧 ----
  const base = {
    key: key.intensity, fill: fill.intensity, rim: rim.intensity, hemi: hemi.intensity,
    fire: fireL.map((l) => l.intensity), lan: lanL.map((l) => l.intensity), glow: arch.glowMat.emissiveIntensity,
  };
  let dim = 0;
  const flare = [0, 0];
  const firePos = sh.braziers.map((b) => b.clone());
  const fogDim = FOG_COLOR.clone();
  const n1 = (t: number, s: number) => Math.sin(t * 7.3 + s) * 0.5 + Math.sin(t * 13.1 + s * 2.3) * 0.3 + Math.sin(t * 23.7 + s * 0.7) * 0.2;

  const stage: Stage = {
    root, env,
    update(dt, t) {
      sh.uTime.value = t;
      for (let i = 0; i < 2; i++) {
        flare[i] = Math.max(0, flare[i] - dt * 1.6);
        const f = 0.86 + 0.14 * n1(t, i * 5.1) + flare[i] * 0.9;
        sh.uFire.value.setComponent(i, f);
        const l = fireL[i];
        l.intensity = base.fire[i] * f * (1 - 0.7 * dim);
        l.position.set(firePos[i].x + Math.sin(t * 9 + i) * 0.05, 1.55 + Math.sin(t * 11.3 + i * 2) * 0.06, firePos[i].z);
      }
      lanterns.update(t);
      reflection?.render(scene, ctx.camera);
    },
    setDim(k) {
      dim = Math.min(1, Math.max(0, k));
      const m = 1 - 0.78 * dim;
      sh.uDim.value = dim;
      key.intensity = base.key * m; fill.intensity = base.fill * m; rim.intensity = base.rim * (1 - 0.6 * dim); hemi.intensity = base.hemi * m;
      lanL.forEach((l, i) => (l.intensity = base.lan[i] * m));
      arch.glowMat.emissiveIntensity = base.glow * m;
      scene.environmentIntensity = ENV_I * (1 - 0.7 * dim);
      fog.color.copy(fogDim).multiplyScalar(1 - 0.75 * dim);
      fogU.uFogColor.value.copy(fog.color);
    },
    onImpact(x, strength) {
      sh.uImpact.value.set(x, sh.uTime.value, Math.min(1.5, 0.4 + strength));
      sh.braziers.forEach((b, i) => { const d = Math.abs(b.x - x); if (d < 5) flare[i] = Math.max(flare[i], strength * (1 - d / 5)); });
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mm of mats) mm.dispose();
      });
      env.dispose();
      reflection?.dispose();
      if (scene.environment === env) scene.environment = null;
      scene.fog = null;
    },
  };
  return stage;
};

export default createTempleStage;
