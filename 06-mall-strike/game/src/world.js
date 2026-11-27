// Loads the baked mall: geometry, lightmaps, probes, sky; builds materials + collision BVH.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, staticMaterial, glassMaterial, emissiveMaterial, skyMaterial } from './materials.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

export const LAYER = { STATIC: 1, DYN: 2, VM: 3, FLOOR: 4, FX: 5 };

// Blender (x, y, z) -> three (x, z, -y)
export const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

const TILED = {
  floor_marble: { tex: 'marble_01', tint: [1.0, 0.97, 0.93], roughMul: 0.35, roughAdd: 0.02, coat: 0.55, coatRough: 0.03, normalScale: 0.4, dirt: 0.35 },
  plaster_white: { tex: 'white_plaster_02', tint: [0.93, 0.92, 0.9], roughMul: 1.0, roughAdd: 0, normalScale: 0.5, dirt: 0.15 },
  plaster_warm: { tex: 'plaster_grey_04', tint: [0.95, 0.92, 0.87], roughMul: 1.0, roughAdd: 0, normalScale: 0.4 },
  planter_stone: { tex: 'plaster_grey_04', tint: [0.55, 0.53, 0.5], roughMul: 1.0, roughAdd: 0, normalScale: 0.8, dirt: 0.3 },
  pavement: { tex: 'concrete_debris', tint: [0.8, 0.8, 0.78], roughMul: 1.0, roughAdd: 0, normalScale: 1.0 },
};
const GLASS_DIRT = { glass_clean: 0.06, glass_sky: 0.15, glass_shard: 0.0 };

function loadTex(loader, url, srgb) {
  return new Promise((res, rej) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    res(t);
  }, undefined, rej));
}
const exrLoad = (url) => new Promise((res, rej) => new EXRLoader().setDataType(THREE.HalfFloatType).load(url, res, undefined, rej));

export async function loadWorld(renderer, progress = () => {}) {
  const base = './assets/';
  const [matInfo, probeMeta] = await Promise.all([
    fetch(base + 'materials.json').then((r) => r.json()),
    fetch(base + 'probes.json').then((r) => r.json()),
  ]);
  progress(0.05, '材质');
  const tl = new THREE.TextureLoader();
  const tex = {};
  await Promise.all(Object.values(TILED).map(async (t) => {
    if (tex[t.tex]) return;
    tex[t.tex] = {};
    const [d, r, n] = await Promise.all([
      loadTex(tl, `${base}tex/${t.tex}/Diffuse.jpg`, true), loadTex(tl, `${base}tex/${t.tex}/Rough.jpg`, false),
      loadTex(tl, `${base}tex/${t.tex}/nor_gl.jpg`, false)]);
    tex[t.tex] = { d, r, n };
  }));
  progress(0.15, '光照贴图');
  const lmNames = ['floor', 'arch', 'store0', 'store1', 'propbox', 'outside'];
  const lms = {};
  await Promise.all(lmNames.map(async (n) => {
    const t = await exrLoad(`${base}lm/${n}.exr`);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.needsUpdate = true;
    lms[n] = t;
  }));
  progress(0.35, '光照探针');
  // probes: EXR atlas (w x h*count) -> DataArrayTexture
  const pt = await exrLoad(base + 'probes.exr');
  const { w: PW, h: PH, count: PN } = probeMeta;
  const src = pt.image.data; // Uint16 half, RGBA, rows = h*count
  const arr = new Uint16Array(PW * PH * PN * 4);
  // EXRLoader returns rows bottom-up: last probe first. Re-order so layer i = probe i, rows top-down per layer.
  for (let i = 0; i < PN; i++) {
    for (let y = 0; y < PH; y++) {
      const fileRow = i * PH + y;                    // top-down row in the file
      const dataRow = PH * PN - 1 - fileRow;         // bottom-up storage
      arr.set(src.subarray(dataRow * PW * 4, (dataRow + 1) * PW * 4), ((i * PH) + y) * PW * 4);
    }
  }
  const at = new THREE.DataArrayTexture(arr, PW, PH, PN);
  at.type = THREE.HalfFloatType; at.format = THREE.RGBAFormat;
  at.minFilter = THREE.LinearMipmapLinearFilter; at.magFilter = THREE.LinearFilter;
  at.wrapS = THREE.RepeatWrapping; at.wrapT = THREE.ClampToEdgeWrapping;
  at.generateMipmaps = true; at.needsUpdate = true;
  G.uProbes.value = at;
  const probeData = { arr, PW, PH, PN };
  G.uProbeFlipV.value = 0; // layer rows are top-down, sampled with v=0 at row 0
  probeMeta.probes.forEach((p, i) => { G.uProbeLum.value[i] = 0.2126 * p.mean[0] + 0.7152 * p.mean[1] + 0.0722 * p.mean[2]; });

  progress(0.45, '商场模型');
  const gltf = await new Promise((res, rej) => new GLTFLoader().load(base + 'mall.glb', res,
    (e) => e.total && progress(0.45 + 0.35 * e.loaded / e.total, '商场模型'), rej));
  const root = gltf.scene;
  const collGeoms = [];
  const glassList = [];
  const matCache = new Map();
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    // which chunk?
    let p = m; while (p && !(p.name || '').startsWith('CH_')) p = p.parent;
    const chunk = p ? (p.name.match(/^CH_([a-z0-9]+)/) || [0, 'arch'])[1] : 'arch';
    const gm = m.material; const name = gm.name;
    const info = matInfo[name] || { type: 'ph' };
    const key = chunk + '|' + name;
    let mat = matCache.get(key);
    if (!mat) {
      const lmMap = lms[chunk] || null;
      if (info.type === 'emit') mat = emissiveMaterial(info.color, info.strength);
      else if (info.type === 'glass' || name.endsWith('_glass')) mat = glassMaterial(info.tint || [0.95, 0.95, 0.95], info.rough || 0.0, GLASS_DIRT[name] ?? 0.04);
      else if (info.type === 'tiled') {
        const t = TILED[name];
        mat = staticMaterial({ name, lmMap, map: tex[t.tex].d, roughMap: tex[t.tex].r, normalMap: tex[t.tex].n, tint: t.tint,
          roughMul: t.roughMul, roughAdd: t.roughAdd, coat: t.coat || 0, coatRough: t.coatRough || 0.05, normalScale: t.normalScale,
          dirt: t.dirt || 0, floor: chunk === 'floor' });
      } else if (info.type === 'principled') {
        mat = staticMaterial({ name, lmMap, tint: info.color, roughAdd: info.rough, metal: info.metal, coat: info.coat,
          coatRough: info.coat_rough, noiseRough: info.noise_rough ? 0.08 : 0, shutter: name === 'shutter_metal',
          doubleSide: name.startsWith('paper') });
      } else { // poly haven glTF material
        const alpha = gm.alphaTest > 0 || gm.transparent || name.includes('leaves') || name.includes('_paper');
        mat = staticMaterial({ name, lmMap, map: gm.map, roughMap: gm.roughnessMap, phMR: !!gm.roughnessMap, normalMap: gm.normalMap,
          tint: [gm.color.r, gm.color.g, gm.color.b], roughMul: gm.roughnessMap ? gm.roughness : 0, roughAdd: gm.roughnessMap ? 0 : gm.roughness,
          metal: gm.metalness, normalScale: gm.normalScale ? gm.normalScale.x : 1, alphaTest: alpha, doubleSide: alpha || gm.side === THREE.DoubleSide });
      }
      matCache.set(key, mat);
    }
    m.material = mat;
    m.matrixAutoUpdate = false; m.updateMatrix();
    const isGlass = mat.name === 'glass';
    const isEmit = mat.name === 'emit';
    m.layers.set(0);
    if (!isGlass && !isEmit && chunk !== 'plants') m.layers.enable(LAYER.STATIC);
    if (chunk === 'floor') { m.layers.set(LAYER.FLOOR); m.layers.enable(LAYER.STATIC); }
    if (isGlass) { m.renderOrder = 10; glassList.push(m); }
    // collision: everything solid except foliage, signs and tiny props
    if (!isEmit && chunk !== 'plants' && chunk !== 'outside' && !name.startsWith('paper') && name !== 'glass_shard') {
      m.updateWorldMatrix(true, false);
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      g.morphAttributes = {};
      collGeoms.push(g.index ? g.toNonIndexed() : g);
    }
  }
  root.updateMatrixWorld(true);

  // escalator ramps (smooth walkable surface over the steps), Blender coords
  const ramps = [];
  for (const xc of [-0.75, 0.75]) {
    const run = 44.66 - 36.0, n = 26, rise = 5.0 / n;
    const y0 = 36.0 - run / n, y1 = 44.66, z1 = 5.0 + rise;
    const pts = [B(xc - 0.5, y0, 0), B(xc + 0.5, y0, 0), B(xc + 0.5, y1, z1), B(xc - 0.5, y1, z1), B(xc - 0.5, y1 + 0.6, z1), B(xc + 0.5, y1 + 0.6, z1)];
    const pos = [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3], pts[3], pts[2], pts[5], pts[3], pts[5], pts[4]];
    const g = new THREE.BufferGeometry().setFromPoints(pos);
    ramps.push(g);
  }
  collGeoms.push(...ramps);
  const collGeom = mergeGeometries(collGeoms.map((g) => { const n = new THREE.BufferGeometry(); n.setAttribute('position', g.attributes.position); return n; }));
  const bvh = new MeshBVH(collGeom, { targetLeafSize: 8 });
  collGeom.boundsTree = bvh;
  const collMesh = new THREE.Mesh(collGeom, new THREE.MeshBasicMaterial());
  collMesh.visible = false;

  progress(0.85, '天空');
  const skyTex = await new Promise((res, rej) => new HDRLoader().setDataType(THREE.HalfFloatType).load(base + 'sky.hdr', res, undefined, rej));
  skyTex.wrapS = THREE.RepeatWrapping; skyTex.minFilter = THREE.LinearFilter; skyTex.generateMipmaps = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMaterial(skyTex));
  sky.frustumCulled = false; sky.renderOrder = -1;
  sky.layers.set(0);

  const sd = matInfo._sun.dir_blender; // direction the light travels (blender)
  G.uSunDir.value.copy(B(-sd[0], -sd[1], -sd[2])).normalize();

  return { root, sky, collMesh, bvh, probeMeta, glassList, lms, matInfo, probeData, envCache: new Map() };
}

// SH9 (three convention, radiance projection) at a world position by the same probe interpolation as the shader
export function probeSH(world, wp, out) {
  const P = world.probeMeta.probes;
  const bx = wp.x, by = -wp.z, bz = wp.y;
  const lvl = bz > 4.8 ? 1 : 0;
  const GY = [-10, -2, 6, 14, 22, 30, 38, 46, 54, 60], UB = [-12, -3, 6, 15, 24, 33, 42, 51, 62];
  const acc = Array.from({ length: 9 }, () => [0, 0, 0]);
  const add = (i, w) => { if (w <= 0) return; const sh = P[i].sh; for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) acc[k][c] += sh[k][c] * w; };
  const sx = THREE.MathUtils.smoothstep(Math.abs(bx), 10.9, 11.5);
  if (sx < 1) {
    const fx = THREE.MathUtils.clamp((bx + 7.5) / 7.5, 0, 2); const x0 = Math.min(Math.floor(fx), 1); const tx = fx - x0;
    let y0 = 0; for (let i = 0; i < 8; i++) if (by > GY[i + 1]) y0 = i + 1;
    const ty = THREE.MathUtils.clamp((by - GY[y0]) / (GY[y0 + 1] - GY[y0]), 0, 1);
    const a = lvl * 30 + y0 * 3 + x0;
    add(a, (1 - tx) * (1 - ty) * (1 - sx)); add(a + 1, tx * (1 - ty) * (1 - sx)); add(a + 3, (1 - tx) * ty * (1 - sx)); add(a + 4, tx * ty * (1 - sx));
  }
  if (sx > 0) {
    let k = 0; for (let i = 0; i < 7; i++) if (by > UB[i + 1]) k = i + 1;
    add(60 + lvl * 16 + (bx > 0 ? 8 : 0) + k, sx);
  }
  for (let k = 0; k < 9; k++) out[k].set(acc[k][0], acc[k][1], acc[k][2]);
  return out;
}

// nearest probe index for a world position (same layout as the shader)
export function nearestProbe(world, wp) {
  const bx = wp.x, by = -wp.z, bz = wp.y, lvl = bz > 4.8 ? 1 : 0;
  const GY = [-10, -2, 6, 14, 22, 30, 38, 46, 54, 60], UB = [-12, -3, 6, 15, 24, 33, 42, 51, 62];
  if (Math.abs(bx) > 11.2) { let k = 0; for (let i = 0; i < 7; i++) if (by > UB[i + 1]) k = i + 1; return 60 + lvl * 16 + (bx > 0 ? 8 : 0) + k; }
  const xi = bx < -3.75 ? 0 : bx > 3.75 ? 2 : 1;
  let yi = 0, bd = 1e9; GY.forEach((y, i) => { const d = Math.abs(y - by); if (d < bd) { bd = d; yi = i; } });
  return lvl * 30 + yi * 3 + xi;
}

// PMREM env map (specular IBL) from probe i, resampled to three's equirect convention
export function probeEnv(world, renderer, i) {
  if (world.envCache.has(i)) return world.envCache.get(i);
  const { arr, PW, PH } = world.probeData;
  const W = 256, H = 128, out = new Float32Array(W * H * 4);
  const f16 = THREE.DataUtils.fromHalfFloat;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // three equirect: u = atan(z, x)/2pi + 0.5, v = asin(y)/pi + 0.5 (row 0 = bottom with flipY=false data)
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    const phi = (u - 0.5) * 2 * Math.PI, th = (v - 0.5) * Math.PI;
    const dx = Math.cos(th) * Math.cos(phi), dy = Math.sin(th), dz = Math.cos(th) * Math.sin(phi);
    // to blender, then our probe mapping
    const bx = dx, byy = -dz, bz = dy;
    const lat = Math.asin(Math.max(-1, Math.min(1, bz))), lon = Math.atan2(-bx, byy);
    let su = 0.5 - lon / (2 * Math.PI), sv = 0.5 - lat / Math.PI;
    su = ((su % 1) + 1) % 1;
    const sx = Math.min(PW - 1, Math.floor(su * PW)), sy = Math.min(PH - 1, Math.floor(sv * PH));
    const si = ((i * PH + sy) * PW + sx) * 4, di = (y * W + x) * 4;
    out[di] = f16(arr[si]); out[di + 1] = f16(arr[si + 1]); out[di + 2] = f16(arr[si + 2]); out[di + 3] = 1;
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.LinearSRGBColorSpace; t.needsUpdate = true;
  if (!world.pmrem) world.pmrem = new THREE.PMREMGenerator(renderer);
  const rt = world.pmrem.fromEquirectangular(t);
  t.dispose();
  world.envCache.set(i, rt.texture);
  return rt.texture;
}
