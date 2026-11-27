import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { snowyMaterial } from './materials';

/** 场景里道具的摆放。x 左右、z 前后（负数往里），ry 绕竖直轴转，s 缩放（按目标高度算），mirror 左右镜像。 */
export interface Place { x: number; z: number; y?: number; ry?: number; h: number; mirror?: boolean }

export const LAYOUT: Record<string, Place[]> = {
  brazier: [{ x: -4.9, z: -3.4, h: 0.95, ry: 0.3 }, { x: 4.9, z: -3.4, h: 0.95, ry: -0.5 }],
  lion: [{ x: -1.5, z: -12.7, h: 2.0, ry: 0.32 }, { x: 7.5, z: -12.7, h: 2.0, ry: -0.32, mirror: true }],
  stonelantern: [
    { x: -8.6, z: -8.2, h: 2.35, ry: 0.2 }, { x: 9.4, z: -8.6, h: 2.35, ry: -0.25 },
    // 两侧成排的石灯（院子边上），近景侧前方的镜头里能看到
    { x: -14.6, z: -3.6, h: 2.0, ry: 0.9 }, { x: -14.9, z: 1.6, h: 1.9, ry: 2.2 },
    { x: 15.4, z: -4.4, h: 2.0, ry: -0.7 }, { x: 15.8, z: 0.9, h: 1.9, ry: 1.6 },
  ],
  deadtree: [{ x: -15.2, z: -4.6, y: -1.1, h: 8.6, ry: 0.6 }, { x: 18.5, z: -1.2, y: -1.0, h: 7.5, ry: 2.4, mirror: true }],
  pine: [
    { x: -15.5, z: -19.4, h: 11, ry: 0.3 }, { x: -21.5, z: -19.6, h: 10, ry: 2.1 }, { x: 19.5, z: -19.0, h: 13, ry: 1.2 },
    { x: 25, z: -19.8, h: 10.5, ry: 4.0 }, { x: -28, z: -19.5, h: 12, ry: 5.1 }, { x: 31, z: -20, h: 12, ry: 0.9 },
  ],
  pagoda: [{ x: -26, z: -60, h: 16, ry: 0.4 }],
  // 第二轮：两侧的中景和近景（Tripo 模型正面朝它自己的 +x，ry = -π/2 朝镜头）
  // 左钟右鼓：右边用同一个亭子镜像（鼓亭），位置错开一点
  bellpavilion: [{ x: -19.0, z: -10.5, h: 6.0, ry: -Math.PI / 2 + 0.55 }, { x: 22.5, z: -11.5, h: 5.6, ry: -Math.PI / 2 - 0.55, mirror: true }],
  // 院子两侧边上的石栏杆（正面朝院子里），左边一段断了
  balustrade: [
    { x: -12.9, z: -6.0, h: 1.05, ry: 0 }, { x: -12.9, z: -3.4, h: 1.05, ry: 0 }, { x: -13.0, z: 2.6, h: 1.05, ry: 0.05 },
    { x: 13.0, z: -6.0, h: 1.05, ry: Math.PI }, { x: 13.0, z: -3.4, h: 1.05, ry: Math.PI }, { x: 13.0, z: -0.8, h: 1.05, ry: Math.PI },
  ],
  // 塌墙下的瓦砾、左边断栏杆旁边一堆
  rubble: [
    { x: 20.0, z: -15.6, h: 1.0, ry: -Math.PI / 2 + 0.2 }, { x: -23.3, z: -15.7, h: 1.1, ry: -Math.PI / 2 - 0.3 },
    { x: -13.6, z: 0.2, h: 0.75, ry: 0.4 },
  ],
};

/** 程序化的后备道具（Tripo 模型到位前用） */
export function fallbackBrazier() {
  const parts: THREE.BufferGeometry[] = [];
  const bowl = new THREE.LatheGeometry([
    new THREE.Vector2(0.0, 0.6), new THREE.Vector2(0.38, 0.6), new THREE.Vector2(0.52, 0.72), new THREE.Vector2(0.58, 0.95),
    new THREE.Vector2(0.62, 0.97), new THREE.Vector2(0.56, 0.98), new THREE.Vector2(0.5, 0.8), new THREE.Vector2(0.0, 0.78),
  ], 20);
  parts.push(bowl);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.05, 0.07, 0.66, 6);
    leg.rotateZ(0.18); leg.rotateY(-a); leg.translate(Math.cos(a) * 0.36, 0.33, Math.sin(a) * 0.36);
    parts.push(leg);
  }
  const coal = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); coal.scale(1, 0.25, 1); coal.translate(0, 0.86, 0);
  parts.push(coal);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(strip))!;
  const m = snowyMaterial({ color: 0x1d1a18, roughness: 0.55, metalness: 0.7, snow: 0.0, grime: 0.8 });
  m.emissive.set(0xff4a10); m.emissiveIntensity = 0.0;
  return new THREE.Mesh(g, m);
}

export function fallbackStoneLantern() {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, y: number) => { g.translate(0, y, 0); parts.push(g); };
  add(new THREE.BoxGeometry(0.9, 0.3, 0.9), 0.15);
  add(new THREE.CylinderGeometry(0.32, 0.38, 0.18, 8), 0.39);
  add(new THREE.CylinderGeometry(0.15, 0.17, 0.85, 8), 0.9);
  add(new THREE.CylinderGeometry(0.42, 0.3, 0.16, 8), 1.4);
  add(new THREE.BoxGeometry(0.5, 0.42, 0.5), 1.69);
  add(new THREE.ConeGeometry(0.7, 0.32, 8), 2.06);
  add(new THREE.SphereGeometry(0.1, 8, 6), 2.3);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(strip))!;
  return new THREE.Mesh(g, snowyMaterial({ color: 0x75777a, roughness: 0.9, snow: 1.0, grime: 0.8 }));
}

/** 雪松：几层压着雪的圆锥叠起来。远处的树林也用它（实例化）。 */
export function pineGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.3, 4, 6); trunk.translate(0, 2, 0); parts.push(trunk);
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 2.6 * (1 - t * 0.8), h = 2.4 - t * 0.9;
    const c = new THREE.ConeGeometry(r, h, 9, 2, true);
    const p = c.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k), y = p.getY(k);
      const a = Math.atan2(z, x);
      const j = 1 + 0.22 * Math.sin(a * 3 + i * 1.9) + 0.12 * Math.sin(a * 7 + i);
      if (y < 0) { p.setX(k, x * j); p.setZ(k, z * j); p.setY(k, y - 0.25 * (j - 1) * 2); }
    }
    c.computeVertexNormals();
    c.translate(0, 2.2 + t * 7.5, 0);
    parts.push(c);
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(strip))!;
  g.scale(1 / 11, 1 / 11, 1 / 11); // 归一化到 1 米高
  return g;
}

export function fallbackPagoda() {
  const parts: THREE.BufferGeometry[] = [];
  let y = 0;
  const base = new THREE.CylinderGeometry(3.2, 3.4, 1.5, 8); base.translate(0, 0.75, 0); parts.push(base); y = 1.5;
  const body = new THREE.CylinderGeometry(2.2, 2.4, 6, 8); body.translate(0, y + 3, 0); parts.push(body); y += 6;
  for (let i = 0; i < 7; i++) {
    const r = 2.25 - i * 0.18;
    const eave = new THREE.CylinderGeometry(r + 0.9, r + 1.2, 0.5, 8); eave.translate(0, y + 0.25, 0); parts.push(eave);
    const seg = new THREE.CylinderGeometry(r - 0.1, r, 1.8, 8); seg.translate(0, y + 0.5 + 0.9, 0); parts.push(seg);
    y += 2.3;
  }
  const top = new THREE.ConeGeometry(1.6, 1.8, 8); top.translate(0, y + 0.9, 0); parts.push(top); y += 1.8;
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(strip))!;
  g.scale(1 / y, 1 / y, 1 / y);
  return g;
}

function strip(g: THREE.BufferGeometry) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

/** 远处的树林：一圈一圈的雪松剪影，越远越密越小（实例化，一次绘制）。 */
export function createForest(geo: THREE.BufferGeometry, mat: THREE.Material, rows: (readonly [number, number, number, number, number])[]) {
  const items: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 7 + Math.round(rows[0][0]);
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [z0, z1, n, hmin, hmax] of rows) {
    for (let i = 0; i < n; i++) {
      const z = z0 + (z1 - z0) * r();
      const x = (r() - 0.5) * (z1 < -50 ? 170 : 120);
      if (Math.abs(x - 3) < 14 && z > -40) continue; // 正中留空，免得在角色身后太花
      const h = hmin + (hmax - hmin) * r();
      p.set(x, -0.3, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); s.set(h * (0.8 + 0.4 * r()), h, h * (0.8 + 0.4 * r()));
      items.push(m.compose(p, q, s).clone());
    }
  }
  const inst = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((mm, i) => inst.setMatrixAt(i, mm));
  inst.castShadow = false; inst.receiveShadow = false;
  return inst;
}

/**
 * 枯草：一丛一丛弯着的细草叶（真几何体，不用透明贴图），颜色是冻过的枯黄和灰褐，叶尖挂一点雪。
 * 顶点着色器里随风轻摆。全部合成一个网格，一次绘制。
 * spots: [x, z, 半径, 丛数, 高度]
 */
export function createGrass(spots: number[][], sh: { uTime: { value: number }; uDim: { value: number } }) {
  const pos: number[] = [], col: number[] = [], wind: number[] = [], idx: number[] = [];
  let seed = 913;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const c = new THREE.Color();
  let v = 0;
  const SEG = 3;
  for (const [cx, cz, rad, n, hh] of spots) {
    for (let t = 0; t < n; t++) {
      const a0 = r() * 6.283, d0 = Math.sqrt(r()) * rad;
      const tx = cx + Math.cos(a0) * d0, tz = cz + Math.sin(a0) * d0;
      const blades = 14 + Math.floor(r() * 12);
      const th = hh * (0.6 + 0.6 * r());
      for (let b = 0; b < blades; b++) {
        const ang = r() * 6.283, lean = 0.25 + r() * 0.7;
        const h = th * (0.45 + 0.65 * r()), w = 0.005 + r() * 0.007;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        const ox = tx + (r() - 0.5) * 0.12, oz = tz + (r() - 0.5) * 0.12;
        // 草色：枯黄、灰褐、偶尔一点发黑的
        const k = r();
        c.setRGB(0.42 + 0.14 * k, 0.35 + 0.1 * k, 0.22 + 0.04 * k).multiplyScalar(r() < 0.15 ? 0.5 : 0.85 + 0.3 * r());
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG;
          const bend = lean * u * u * h;
          const px = ox + dx * bend, pz = oz + dz * bend, py = h * u * (1 - 0.25 * lean * u);
          const ww = w * (1 - u * 0.9);
          // 叶片横向：垂直于倒伏方向
          pos.push(px - dz * ww, py, pz + dx * ww, px + dz * ww, py, pz - dx * ww);
          const sn = u > 0.75 && r() < 0.35 ? 1 : 0;
          for (let q = 0; q < 2; q++) {
            if (sn) col.push(0.62, 0.66, 0.72); else col.push(c.r * (0.55 + 0.45 * u), c.g * (0.55 + 0.45 * u), c.b * (0.55 + 0.45 * u));
            wind.push(u * u * h, (tx + tz) * 0.7);
          }
          if (s < SEG) { idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
          v += 2;
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = sh.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aWind; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float gust = 0.6 + 0.4 * sin(uTime * 0.7 + aWind.y * 0.3);
        transformed.x += (sin(uTime * 2.3 + aWind.y) * 0.5 + 0.6) * gust * aWind.x * 0.25;
        transformed.z += sin(uTime * 1.7 + aWind.y * 1.3) * aWind.x * 0.08;`);
  };
  mat.customProgramCacheKey = () => 'temple-grass';
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
