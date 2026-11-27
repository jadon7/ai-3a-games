// 整张地图的地面网格：按 terrain.ts 的高度起伏，切成 8×8 块（每块 25 米），镜头外的块不画。
//
// 贴图分两层（阶段 2.5）：
//   · 总览：整张图一张 2048 的小图，一直在，拉远了看、或者近处的细图还没到的时候用它；
//   · 细图：每块一张 1024 的手绘贴图（约 41 像素/米），只加载镜头附近的十来块，走远了就释放。
// 还没画的时候（2.4）两层都退回平涂的布局图。
// 石板的凹凸不另存法线图：直接拿贴图的明暗当高度，在着色里现算（石头上明显，草地上弱）。
// 水下的染色和晃动、接地暗影、野区土路的染色沿用样板间的做法。

import { TOON_ON, groundToonGLSL, BG_B } from "../toon";
import * as THREE from "three";
import { fbm, smoothstep } from "../../core/noise";
import { fields, toLane, LAGOON } from "../layout";
import { WATER_Y, terrainHeight } from "../terrain";
import { rippleNormal } from "../slice/ripple";
import type { Contact } from "../slice/ground";
import { renderWorldGuide } from "./guide";

export const W_HALF = 100;                    // 地面网格铺到正负 100 米（可活动区域是正负 78 米，外面一圈是背景）
const SIZE = W_HALF * 2, CH = 8, CHUNK_M = SIZE / CH;
const LOAD_R = 64, DROP_R = 88;               // 细图：离镜头这么近就加载，这么远就释放

export interface WorldGround {
  group: THREE.Group;
  heightTex: THREE.DataTexture;               // 河道一带的地面高度，每 0.25 米一个点（给水面算水深）
  terrainTex: THREE.DataTexture;              // 整张图的地面高度，每 0.5 米一个点，一边 terrainN 个（给贴地的特效用：在坡上不会被地形切掉）
  terrainN: number;
  waterShape: THREE.BufferGeometry;           // 有水的地方铺的面
  setContact: (c: Contact) => void;
  /** 每帧调一次：按镜头看着的位置加载、释放细图。far 是拉远了看（只用总览） */
  update: (x: number, z: number, far: boolean) => void;
  /** 还有没有正在加载的细图（截图前要等它们到齐） */
  busy: () => boolean;
  /** 画好的地面上这一点是草或土（1）还是石板、河床（0）。没有手绘地面的时候返回 null，调用的人自己按布局判断 */
  grassAt: ((x: number, z: number) => number) | null;
  painted: boolean;
}

export async function createWorldGround(anisotropy: number, time: { value: number }, bg: THREE.Color): Promise<WorldGround> {
  const STEP = 0.5, N = SIZE / STEP, V = N + 1, CN = N / CH;
  // 高度多算一圈，法线在块和块的接缝上才连续
  const H = new Float32Array((V + 2) * (V + 2)), hAt = (i: number, j: number) => H[(j + 1) * (V + 2) + i + 1];
  for (let j = -1; j <= V; j++) for (let i = -1; i <= V; i++) H[(j + 1) * (V + 2) + i + 1] = terrainHeight(-W_HALF + i * STEP, -W_HALF + j * STEP);
  const misc = new Float32Array(V * V * 4);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -W_HALF + i * STEP, z = -W_HALF + j * STEP, f = fields(x, z), h = hAt(i, j), k = (j * V + i) * 4;
    misc[k] = smoothstep(1.1, -0.1, f.dRiver) * smoothstep(-0.3, 0.8, f.dIsland);     // 水边和水下是湿的（Boss 的石台是干的）
    misc[k + 1] = Math.max(WATER_Y - h, 0) * smoothstep(5, 3, f.dRiver);       // 水有多深（只有河道里才算，野区的洼地不是水）
    // 野区的土路：沿着路线把草地染成踩秃的颜色，边是虚的；到了石板路、水边、基地就没有了
    misc[k + 2] = smoothstep(1.0, -0.7, f.dTrail + (fbm(x * 0.45, z * 0.45, 3, 5) - 0.5) * 1.9) * smoothstep(-0.2, 0.9, f.dLane) * smoothstep(0.6, 2.0, f.dRiver) * smoothstep(5.4, 6.4, f.dTower) * smoothstep(0, 3, f.dBase);
    misc[k + 3] = TOON_ON ? smoothstep(-1, -14, f.dEdge) : smoothstep(-7, -21, f.dEdge);      // 城墙外面越远越暗，融进背景（B：从墙根就开始往深色的林子里淡，不然墙外是一大片糊的亮绿）
  }

  const loader = new THREE.TextureLoader();
  const tryLoad = async (url: string) => { try { return await loader.loadAsync(url); } catch { return null; } };
  // 细图的清单：有它才算“画过了”
  let index: string[] = [];
  try { const r = await fetch("/assets/map/ground/index.json"); if (r.ok) index = (await r.json()).chunks ?? []; } catch { /* 还没画 */ }
  const painted = index.length > 0;
  let map = painted ? await tryLoad("/assets/map/ground_all.webp") : null;
  if (!map) map = await tryLoad("/assets/map/ground_guide.webp");
  if (!map) { const cv = document.createElement("canvas"); renderWorldGuide(cv, 0, 0, SIZE, 512); map = new THREE.CanvasTexture(cv); }      // 什么都没有的时候现画一张小的顶着
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = anisotropy;
  const cv = document.createElement("canvas"); cv.width = cv.height = 2048;
  const contact = new THREE.CanvasTexture(cv); contact.colorSpace = THREE.NoColorSpace;
  { const g = cv.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, 2048, 2048); }
  const uContact = { value: contact }, uBg = { value: bg.clone().convertLinearToSRGB() }, uRipple = { value: rippleNormal() }, uFlat = { value: painted ? 0 : 1 };
  const blank = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); blank.needsUpdate = true;

  /** 每块一份材质（着色程序是同一个），区别只是各自的细图 */
  const makeMaterial = (uDetail: { value: THREE.Texture }, uHas: { value: number }) => {
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uContact, uTime: time, uRipple, uBg, uFlat, uDetail, uHas });
      sh.vertexShader = ("attribute vec4 aMisc; attribute vec2 aCuv; varying vec4 vMisc; varying vec2 vXZ; varying vec2 vCuv;\n" + sh.vertexShader).replace("#include <begin_vertex>", "#include <begin_vertex>\nvMisc = aMisc; vXZ = position.xz; vCuv = aCuv;");
      sh.fragmentShader = ("varying vec4 vMisc; varying vec2 vXZ; varying vec2 vCuv; uniform sampler2D uContact, uRipple, uDetail; uniform float uTime, uFlat, uHas; uniform vec3 uBg;\nfloat gLum_ = 0.0, gGrass_ = 0.0;\nfloat gn_(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5453), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5453), c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5453), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5453); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }\n" + sh.fragmentShader)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.94, 0.36, vMisc.x * (1.0 - smoothstep(0.0, 0.08, vMisc.y)));")
        .replace("#include <map_fragment>", `
          float dp_ = smoothstep(0.0, 0.5, vMisc.y);
          // 水下的地面随水纹轻轻晃（单位是米，再换成各张贴图自己的坐标）
          vec2 rw_ = (texture2D(uRipple, vXZ * 0.21 + vec2(uTime * 0.035, uTime * 0.03)).xy + texture2D(uRipple, vXZ * 0.47 - vec2(uTime * 0.05, -uTime * 0.04)).xy - 1.0) * 0.096 * dp_;
          vec4 tx_ = texture2D(map, vMapUv + rw_ * ${(1 / SIZE).toFixed(6)});
          if (uHas > 0.0) tx_ = mix(tx_, texture2D(uDetail, vCuv + rw_ * ${(1 / CHUNK_M).toFixed(6)}), uHas);
          diffuseColor *= tx_;
          ${groundToonGLSL()}
          { vec3 g_ = sqrt(tx_.rgb); float mx_ = max(g_.r, max(g_.g, g_.b)), mn_ = min(g_.r, min(g_.g, g_.b));
            gLum_ = dot(g_, vec3(0.3, 0.59, 0.11)); gGrass_ = smoothstep(0.3, 0.44, (mx_ - mn_) / max(mx_, 0.001)); }
          // 平涂的布局图加一层很淡的深浅，不至于像一块色板；手绘的地面不需要
          diffuseColor.rgb *= mix(1.0, 0.93 + 0.14 * (gn_(vXZ * 0.9) * 0.5 + gn_(vXZ * 3.7) * 0.3 + gn_(vXZ * 13.0) * 0.2), uFlat);`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          { float l_ = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), side_ = smoothstep(-3.0, 3.0, (vXZ.x - vXZ.y) * 0.7071);
            ${TOON_ON ? `vec3 d_ = diffuseColor.rgb * mix(vec3(1.12, 1.0, 0.72), vec3(0.86, 0.8, 0.8), side_);      // 画风 B：土路只是草黄一点、红土深一点（原来那种灰褐色压在亮地面上是一道道发白的污渍）
            diffuseColor.rgb = mix(diffuseColor.rgb, d_, vMisc.z * 0.6); }` : `vec3 d_ = mix(vec3(0.33, 0.27, 0.12), vec3(0.50, 0.30, 0.17), side_) * (0.5 + l_ * 2.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, d_, vMisc.z * 0.34); }`}
          { float dk_ = smoothstep(0.0, 0.95, vMisc.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, ${TOON_ON ? "diffuseColor.rgb * vec3(0.34, 0.68, 0.74) + vec3(0.0, 0.035, 0.045)" : "diffuseColor.rgb * vec3(0.24, 0.62, 0.54) + vec3(0.0, 0.028, 0.024)"}, dk_);
            float ca_ = texture2D(uRipple, vXZ * 0.36 + vec2(uTime * 0.045, uTime * 0.04)).a - texture2D(uRipple, vXZ * 0.36 - vec2(uTime * 0.04, -uTime * 0.03) + 0.5).a;
            diffuseColor.rgb += vec3(0.7, 1.0, 0.9) * smoothstep(0.1, 0.0, abs(ca_)) * ${TOON_ON ? "0.1" : "0.055"} * smoothstep(0.03, 0.3, vMisc.y) * (1.0 - dk_ * 0.4); }      // 河底的光纹（B 亮一倍）
          ${TOON_ON ? "{ float c_ = texture2D(uContact, vMapUv).r; diffuseColor.rgb *= mix(1.0, 0.9, vMisc.x) * mix(vec3(1.0), vec3(0.5, 0.64, 0.8), (1.0 - c_) * 0.75); }      // 画风 B：接地暗影浅一点、偏冷，和冷色的影子是一家" : "diffuseColor.rgb *= mix(1.0, 0.84, vMisc.x) * texture2D(uContact, vMapUv).r;"}`)
        // 石板的凹凸：贴图越亮当成越高（石板面高、缝低），按相邻像素的高差把法线掰一下。草地上弱得多，不然斜光下一地碎影
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          if (uHas > 0.0 && ${TOON_ON ? "false" : "true"}) { float h_ = gLum_ * 0.095 * uHas * (1.0 - 0.93 * gGrass_);      /* stylecost：卡通档不要石板凹凸（分阶光下会冒黑点） */
            vec3 sx_ = dFdx(-vViewPosition), sy_ = dFdy(-vViewPosition), r1_ = cross(sy_, normal), r2_ = cross(normal, sx_); float det_ = dot(sx_, r1_);
            normal = normalize(abs(det_) * normal - sign(det_) * (dFdx(h_) * r1_ + dFdy(h_) * r2_)); }`)
        .replace("#include <dithering_fragment>", (TOON_ON ? `gl_FragColor.rgb = mix(gl_FragColor.rgb, ${BG_B}, vMisc.w);      // 画风 B：墙外淡进深色的林子，两边各自的颜色（我方深绿、对方深红褐），不是一圈黑`
          : "gl_FragColor.rgb = mix(gl_FragColor.rgb, uBg, vMisc.w);") + "\n#include <dithering_fragment>");
    };
    mat.customProgramCacheKey = () => "world-ground";
    return mat;
  };

  type Chunk = { id: string; cx: number; cz: number; uDetail: { value: THREE.Texture }; uHas: { value: number }; state: 0 | 1 | 2 | 3 };     // 0 没加载，1 在路上，2 用着，3 这块没有细图
  const group = new THREE.Group(); group.name = "ground"; const chunks: Chunk[] = [];
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) {
    const W = CN + 1, pos = new Float32Array(W * W * 3), nor = new Float32Array(W * W * 3), uv = new Float32Array(W * W * 2), cuv = new Float32Array(W * W * 2), ms = new Float32Array(W * W * 4);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const gi = ci * CN + i, gj = cj * CN + j, k = j * W + i;
      pos[k * 3] = -W_HALF + gi * STEP; pos[k * 3 + 1] = hAt(gi, gj); pos[k * 3 + 2] = -W_HALF + gj * STEP;
      const nx = hAt(gi - 1, gj) - hAt(gi + 1, gj), nz = hAt(gi, gj - 1) - hAt(gi, gj + 1), inv = 1 / Math.hypot(nx, 2 * STEP, nz);
      nor[k * 3] = nx * inv; nor[k * 3 + 1] = 2 * STEP * inv; nor[k * 3 + 2] = nz * inv;
      uv[k * 2] = gi / N; uv[k * 2 + 1] = 1 - gj / N;
      // 细图的坐标往里收半个像素，块和块的边上不会采到贴图外面去
      cuv[k * 2] = 0.0005 + (i / CN) * 0.999; cuv[k * 2 + 1] = 0.9995 - (j / CN) * 0.999;
      ms.set(misc.subarray((gj * V + gi) * 4, (gj * V + gi) * 4 + 4), k * 4);
    }
    const idx = new Uint16Array(CN * CN * 6);
    for (let j = 0, k = 0; j < CN; j++) for (let i = 0; i < CN; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setAttribute("aCuv", new THREE.BufferAttribute(cuv, 2)); geo.setAttribute("aMisc", new THREE.BufferAttribute(ms, 4)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const id = `c_${ci}_${cj}`, ch: Chunk = { id, cx: -W_HALF + (ci + 0.5) * CHUNK_M, cz: -W_HALF + (cj + 0.5) * CHUNK_M, uDetail: { value: blank }, uHas: { value: 0 }, state: index.includes(id) ? 0 : 3 };
    const m = new THREE.Mesh(geo, makeMaterial(ch.uDetail, ch.uHas)); m.receiveShadow = true; group.add(m); chunks.push(ch);
  }
  let loading = 0;
  const update = (x: number, z: number, far: boolean) => {
    for (const c of chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      if (c.state === 0 && !far && d < LOAD_R && loading < 4) {
        c.state = 1; loading++;
        loader.load(`/assets/map/ground/${c.id}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; c.uDetail.value = t; c.state = 2; loading--; }, undefined, () => { c.state = 3; loading--; });
      } else if (c.state === 2 && (far || d > DROP_R)) { c.uDetail.value.dispose(); c.uDetail.value = blank; c.uHas.value = 0; c.state = 0; }
      if (c.state === 2 && c.uHas.value < 1) c.uHas.value = Math.min(1, c.uHas.value + 0.1);      // 细图到了以后淡入，不跳一下
    }
  };
  const busy = () => loading > 0 || chunks.some(c => c.state === 2 && c.uHas.value < 1);

  // 给水面用的高度图：只算河道和两个 Boss 潭附近，别处填一个高出水面的数
  const HS = 0.25, HN = SIZE / HS + 1, hts = new Float32Array(HN * HN).fill(1);
  const nearWater = (x: number, z: number) => { const [u, v] = toLane(x, z), a = Math.abs(u), w = Math.abs(v); return (a < 13 && w < 88) || Math.hypot(a, w - LAGOON.w) < LAGOON.r + 5; };
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { const x = -W_HALF + i * HS, z = -W_HALF + j * HS; if (nearWater(x, z)) hts[j * HN + i] = terrainHeight(x, z); }
  // 用半精度存：单精度浮点贴图的线性过滤在不少手机上不支持，半精度是 WebGL2 标配
  const h16 = new Uint16Array(hts.length); for (let i = 0; i < hts.length; i++) h16[i] = THREE.DataUtils.toHalfFloat(hts[i]);
  const heightTex = new THREE.DataTexture(h16, HN, HN, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter; heightTex.needsUpdate = true;
  const t16 = new Uint16Array(V * V); for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) t16[j * V + i] = THREE.DataUtils.toHalfFloat(hAt(i, j));
  const terrainTex = new THREE.DataTexture(t16, V, V, THREE.RedFormat, THREE.HalfFloatType); terrainTex.minFilter = terrainTex.magFilter = THREE.LinearFilter; terrainTex.needsUpdate = true;
  // 水面只铺在有水的格子上（每格 2 米，往外多铺一格）
  const WC = 2, WN = SIZE / WC, wet = new Uint8Array(WN * WN), sub = WC / HS;
  for (let j = 0; j < WN; j++) for (let i = 0; i < WN; i++) { let m = 1; for (let b = 0; b <= sub; b += 2) for (let a = 0; a <= sub; a += 2) m = Math.min(m, hts[(j * sub + b) * HN + i * sub + a]); if (m < WATER_Y + 0.06) wet[j * WN + i] = 1; }
  const wpos: number[] = [], widx: number[] = [];
  for (let j = 0; j < WN; j++) for (let i = 0; i < WN; i++) {
    let on = false; for (let b = -1; b <= 1 && !on; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < WN && jj < WN && wet[jj * WN + ii]) { on = true; break; } }
    if (!on) continue;
    const x0 = -W_HALF + i * WC, z0 = -W_HALF + j * WC, n = wpos.length / 3;
    wpos.push(x0, 0, z0, x0 + WC, 0, z0, x0, 0, z0 + WC, x0 + WC, 0, z0 + WC); widx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
  const waterShape = new THREE.BufferGeometry(); waterShape.setAttribute("position", new THREE.Float32BufferAttribute(wpos, 3)); waterShape.setIndex(widx);

  // “哪里是草”：离线算好的一张蒙版（整张图 2048 像素，约 10 像素/米；阶段 8 从 4096 的 PNG 换成 WebP，原图在 art/map/）
  let grassAt: WorldGround["grassAt"] = null;
  if (painted) {
    const mk = await tryLoad("/assets/map/ground_mask.webp");
    if (mk) {
      const GW = (mk.image as HTMLImageElement).width, c2 = document.createElement("canvas"); c2.width = c2.height = GW;
      const g2 = c2.getContext("2d", { willReadFrequently: true })!; g2.drawImage(mk.image as CanvasImageSource, 0, 0);
      const px = g2.getImageData(0, 0, GW, GW).data, m8 = new Uint8Array(GW * GW); for (let i = 0; i < m8.length; i++) m8[i] = px[i * 4];
      grassAt = (x, z) => { const i = Math.min(Math.max(Math.floor(((x + W_HALF) / SIZE) * GW), 0), GW - 1), j = Math.min(Math.max(Math.floor(((z + W_HALF) / SIZE) * GW), 0), GW - 1); return m8[j * GW + i] / 255; };
      mk.dispose();
    }
  }

  const setContact = (c: Contact) => {
    const g = cv.getContext("2d")!, k = 2048 / SIZE, X = (x: number) => (x + W_HALF) * k, Z = (z: number) => (z + W_HALF) * k;
    g.filter = "none"; g.fillStyle = "#fff"; g.fillRect(0, 0, 2048, 2048);
    g.filter = "blur(5px)"; g.lineCap = "round"; g.lineJoin = "round";
    for (const l of c.lines) { g.strokeStyle = `rgba(0,0,0,${l.a})`; g.lineWidth = l.w * k; g.beginPath(); l.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
    for (const o of c.circles) { g.fillStyle = `rgba(0,0,0,${o.a})`; g.beginPath(); g.arc(X(o.x), Z(o.z), o.r * k, 0, 6.283); g.fill(); }
    contact.needsUpdate = true;
  };
  return { group, heightTex, terrainTex, terrainN: V, waterShape, setContact, update, busy, grassAt, painted };
}
