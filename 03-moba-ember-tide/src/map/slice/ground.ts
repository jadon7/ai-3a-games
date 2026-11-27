// 样板间的地面：一张连续的手绘地面贴在一块带高低的网格上（河床往下凹，过河的路沉在浅水下面）。

import * as THREE from "three";
import { fbm, smoothstep } from "../../core/noise";
import { fields } from "../layout";
import { PAINT_HALF, SLICE_X, SLICE_Z } from "./def";
import { rippleNormal } from "./ripple";

export const WATER_Y = -0.26;          // 水面高度
const BED = -1.2, FORD = -0.62;        // 河床最深处；过河的路面

/** 地面高度：岸边缓缓下到河床，过河的石板路垫高一些，只没到小腿 */
export function groundHeight(x: number, z: number): number {
  const f = fields(x, z);
  // 岸线不是一条直线：和画地面时用的是同一份起伏，水边线跟着画上的河岸走
  let h = BED * smoothstep(0.9, -1.7, f.dRiver + (fbm(x * 0.35, z * 0.35, 2, 8) - 0.5) * 0.9 + (fbm(x * 0.9, z * 0.9, 2, 14) - 0.5) * 0.3);
  const onLane = smoothstep(3.2, -0.8, f.dLane);       // 过河的路两侧是很缓的坡，慢慢落到河床，不是一道坎
  return h + (Math.max(h, FORD) - h) * onLane;
}

export interface Contact { lines: { pts: [number, number][]; w: number; a: number }[]; circles: { x: number; z: number; r: number; a: number }[]; }
export interface Ground { mesh: THREE.Mesh; heightTex: THREE.DataTexture; uvOf: (x: number, z: number) => [number, number]; setContact: (c: Contact) => void;
  /** 画好的地面上这一点是草（1）还是石板、河床（0）：直接看贴图的颜色，草是鲜艳的，石头是灰的。植被按它来长，才和画对得上 */
  grassAt: (x: number, z: number) => number; }

export async function createGround(anisotropy: number, time: { value: number }): Promise<Ground> {
  const STEP = 0.25, N = Math.round((PAINT_HALF * 2) / STEP), V = N + 1;
  const pos = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2), hts = new Float32Array(V * V), wet = new Float32Array(V * V * 2), trail = new Float32Array(V * V * 2);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = SLICE_X - PAINT_HALF + i * STEP, z = SLICE_Z - PAINT_HALF + j * STEP, h = groundHeight(x, z), k = j * V + i;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N; hts[k] = h;
    const f = fields(x, z);
    wet[k * 2] = smoothstep(1.1, -0.1, f.dRiver);                              // 水边和水下是湿的
    wet[k * 2 + 1] = Math.max(WATER_Y - h, 0);                                 // 水有多深
    // 野区的土路：沿着路线把草地染成踩秃的颜色，边缘是虚的、宽窄有变化；到了石板路、水边就没有了
    trail[k * 2] = smoothstep(1.0, -0.7, f.dTrail + (fbm(x * 0.45, z * 0.45, 3, 5) - 0.5) * 1.9) * smoothstep(-0.2, 0.9, f.dLane) * smoothstep(0.6, 2.0, f.dRiver) * smoothstep(5.4, 6.4, f.dTower);
    trail[k * 2 + 1] = smoothstep(-3, 3, f.u);
  }
  const idx = new Uint32Array(N * N * 6);
  for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * V + i, b = a + 1, c = a + V, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setAttribute("aWet", new THREE.BufferAttribute(wet, 2)); geo.setAttribute("aTrail", new THREE.BufferAttribute(trail, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const loader = new THREE.TextureLoader();
  const load = async (url: string) => { try { return await loader.loadAsync(url); } catch { return null; } };
  // 手绘地面还没画好的时候，先用布局图顶着
  const map = (await load("/assets/slice/ground.webp")) ?? (await loader.loadAsync("/assets/slice/ground_guide.jpg"));
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = anisotropy;
  const normalMap = await load("/assets/slice/ground_n.webp");
  if (normalMap) normalMap.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: normalMap ?? undefined, normalScale: new THREE.Vector2(0.38, 0.38), roughness: 1, metalness: 0 });
  // 湿的地方光滑一些：对面来的光会在石板的细纹上留下细碎的高光（地面上也要有近看才有的小细节）
  // 物件接地的那圈暗影：按墙、石头、草丛、塔的实际位置画成一张图，乘在地面上。物件挪了，暗影跟着走
  const cv = document.createElement("canvas"); cv.width = cv.height = 1024;
  const contact = new THREE.CanvasTexture(cv); contact.colorSpace = THREE.NoColorSpace;
  { const g = cv.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, 1024, 1024); }
  const uContact = { value: contact };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uContact = uContact; sh.uniforms.uTime = time; sh.uniforms.uRipple = { value: rippleNormal() };
    sh.vertexShader = ("attribute vec2 aWet; attribute vec2 aTrail; varying vec2 vWet; varying vec2 vTrail; varying vec2 vXZ;\n" + sh.vertexShader).replace("#include <begin_vertex>", "#include <begin_vertex>\nvWet = aWet; vTrail = aTrail; vXZ = position.xz;");
    sh.fragmentShader = ("varying vec2 vWet; varying vec2 vTrail; varying vec2 vXZ; uniform sampler2D uContact, uRipple; uniform float uTime;\n" + sh.fragmentShader)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.9, 0.36, vWet.x * (1.0 - smoothstep(0.0, 0.08, vWet.y)));      // 只有水边露在外面的那一圈是湿亮的；水下的高光归水面管")
      // 水下的地面随水纹轻轻晃（水越深晃得越多）：隔着水看河底的石头就是这样
      .replace("#include <map_fragment>", `
        float dp_ = smoothstep(0.0, 0.5, vWet.y);
        vec2 rf_ = (texture2D(uRipple, vXZ * 0.21 + vec2(uTime * 0.035, uTime * 0.03)).xy + texture2D(uRipple, vXZ * 0.47 - vec2(uTime * 0.05, -uTime * 0.04)).xy - 1.0) * 0.0016 * dp_;
        diffuseColor *= texture2D(map, vMapUv + rf_);`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        { // 野区的土路：把草地往踩秃的颜色带一点，边是虚的
          float l_ = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          vec3 d_ = mix(vec3(0.33, 0.27, 0.12), vec3(0.50, 0.30, 0.17), vTrail.y) * (0.5 + l_ * 2.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, d_, vTrail.x * 0.3); }
        { // 水下：越深越偏青绿、越暗；河底有水纹聚出来的一条条亮线
          float dk_ = smoothstep(0.0, 0.95, vWet.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.24, 0.62, 0.54) + vec3(0.0, 0.028, 0.024), dk_);
          float ca_ = texture2D(uRipple, vXZ * 0.36 + vec2(uTime * 0.045, uTime * 0.04)).a - texture2D(uRipple, vXZ * 0.36 - vec2(uTime * 0.04, -uTime * 0.03) + 0.5).a;
          diffuseColor.rgb += vec3(0.7, 1.0, 0.9) * smoothstep(0.1, 0.0, abs(ca_)) * 0.055 * smoothstep(0.03, 0.3, vWet.y) * (1.0 - dk_ * 0.4); }
        diffuseColor.rgb *= mix(1.0, 0.84, vWet.x) * texture2D(uContact, vMapUv).r;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.name = "ground";

  // 给水面用的地面高度图
  const heightTex = new THREE.DataTexture(hts, V, V, THREE.RedFormat, THREE.FloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter; heightTex.needsUpdate = true;
  const uvOf = (x: number, z: number): [number, number] => [(x - (SLICE_X - PAINT_HALF)) / (PAINT_HALF * 2), (z - (SLICE_Z - PAINT_HALF)) / (PAINT_HALF * 2)];
  // 读一遍画好的地面：哪里是草
  const GW = 1024, gcv = document.createElement("canvas"); gcv.width = gcv.height = GW;
  const gctx = gcv.getContext("2d", { willReadFrequently: true })!; gctx.drawImage(map.image as CanvasImageSource, 0, 0, GW, GW);
  const gpx = gctx.getImageData(0, 0, GW, GW).data;
  const grassAt = (x: number, z: number) => {
    const i = Math.min(Math.max(Math.floor(((x - (SLICE_X - PAINT_HALF)) / (PAINT_HALF * 2)) * GW), 0), GW - 1), j = Math.min(Math.max(Math.floor(((z - (SLICE_Z - PAINT_HALF)) / (PAINT_HALF * 2)) * GW), 0), GW - 1), o = (j * GW + i) * 4;
    const r = gpx[o], g = gpx[o + 1], b = gpx[o + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return smoothstep(0.33, 0.45, (mx - mn) / Math.max(mx, 1));
  };
  const setContact = (c: Contact) => {
    const g = cv.getContext("2d")!, k = 1024 / (PAINT_HALF * 2), X = (x: number) => (x - (SLICE_X - PAINT_HALF)) * k, Z = (z: number) => (z - (SLICE_Z - PAINT_HALF)) * k;
    g.filter = "none"; g.fillStyle = "#fff"; g.fillRect(0, 0, 1024, 1024);
    g.filter = "blur(7px)"; g.lineCap = "round"; g.lineJoin = "round";
    for (const l of c.lines) { g.strokeStyle = `rgba(0,0,0,${l.a})`; g.lineWidth = l.w * k; g.beginPath(); l.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
    for (const o of c.circles) { g.fillStyle = `rgba(0,0,0,${o.a})`; g.beginPath(); g.arc(X(o.x), Z(o.z), o.r * k, 0, 6.283); g.fill(); }
    contact.needsUpdate = true;
  };
  return { mesh, heightTex, uvOf, setContact, grassAt };
}
