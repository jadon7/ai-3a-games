import * as THREE from 'three';
import { NOISE } from './glsl';
import type { Shared } from './shared';

// ---- JS 里的噪声（地形起伏用，和着色器里不必一致） ----
function h2(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbmJS(x: number, y: number, oct = 4) { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += a * vn(x, y); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 3.7; a *= 0.5; } return s / n; }
const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 院子外面的积雪堆的高度。院子（|x| < 12.5，-14.6 < z < 7.5）里严格为 0。 */
export function snowHeight(x: number, z: number) {
  const n = fbmJS(x * 0.18, z * 0.18), n2 = fbmJS(x * 0.6 + 9, z * 0.6 + 4, 3);
  const dx = Math.max(0, Math.abs(x) - 12.5), dzf = Math.max(0, z - 7.5), dzb = Math.max(0, -14.6 - z);
  let h = ss(0, 4.5, dx) * (0.35 + 0.75 * n) + ss(0, 3, dzf) * (0.25 + 0.5 * n) + ss(0, 2.5, dzb) * 0.25 * n;
  h += (dx > 0 || dzf > 0 ? 1 : 0) * (n2 - 0.5) * 0.12 * ss(0, 2, dx + dzf);
  return Math.max(0, h);
}

/**
 * 地面：一整块网格。院子是大块旧石板（程序化铺法：错缝的长条石板，缝里残雪），
 * 局部有积水和薄冰（低粗糙度，反射环境和点光），院子外面隆起成积雪。
 * 对战那一条（|x| < 10，|z| < 1.5）严格是 y = 0 的平面，起伏只在法线上。
 */
export function createGround(sh: Shared, detail: THREE.Texture | null, refl: { tex: THREE.Texture; mat: THREE.Matrix4 } | null) {
  const geo = new THREE.PlaneGeometry(100, 52, 160, 84);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -11);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, snowHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  const uniforms = {
    uTime: sh.uTime, uDim: sh.uDim,
    uBrz: { value: sh.braziers },
    uDetail: { value: detail },
    uHasDetail: { value: detail ? 1 : 0 },
    uRefl: { value: refl?.tex ?? null },
    uReflMat: { value: refl?.mat ?? new THREE.Matrix4() },
    uReflOn: { value: refl ? 1 : 0 },
  };
  (mat as any).userData.uniforms = uniforms;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform float uTime; uniform float uDim; uniform vec3 uBrz[2];
        uniform sampler2D uDetail; uniform float uHasDetail;
        uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn;
        ${NOISE}
        // 石板铺法：沿 x 的长条，行宽 0.8~1.1 米，每行错缝；返回 (到缝的距离, 石板编号, 指向石板内部的方向 xz)
        vec4 slab(vec2 p) {
          float rowH = 0.95;
          float r = floor(p.y / rowH);
          float rz = p.y - r * rowH;
          // 行与行之间的缝也做一点不规则
          float jr = (hash11(r * 7.13) - 0.5) * 0.12;
          float x = p.x + hash11(r * 3.71) * 9.0;
          float W = 1.45;
          float k = floor(x / W);
          float bl = k * W + (hash21(vec2(k, r)) - 0.5) * 0.7;
          if (x < bl) { k -= 1.0; bl = k * W + (hash21(vec2(k, r)) - 0.5) * 0.7; }
          float br = (k + 1.0) * W + (hash21(vec2(k + 1.0, r)) - 0.5) * 0.7;
          float dl = x - bl, dr = br - x, db = rz, dt = rowH - rz;
          float dx = min(dl, dr), dz = min(db, dt);
          vec2 dir = dx < dz ? vec2(dl < dr ? 1.0 : -1.0, 0.0) : vec2(0.0, db < dt ? 1.0 : -1.0);
          return vec4(min(dx, dz), hash21(vec2(k * 1.7, r * 2.3)), dir);
        }
      `)
      .replace('#include <map_fragment>', `
        vec2 P = vWPos.xz;
        float nA = fbm3(P * 0.35);
        float nB = vnoise(P * 1.7 + 3.0);
        float ax = abs(P.x);
        float gap, bevel, sid;
        vec3 stone;
        vec2 bevDir = vec2(0.0);
        if (uHasDetail > 0.5) {
          // 用即梦出的石板贴图（一张 4.6 米见方，约 5x7 块石板），缝从亮度里取
          vec2 tuv = P / 4.6;
          vec3 tx = texture2D(uDetail, tuv).rgb;
          float l0 = dot(tx, vec3(0.299, 0.587, 0.114));
          gap = 1.0 - smoothstep(0.035, 0.075, l0);
          bevel = smoothstep(0.05, 0.12, l0);
          sid = fract(floor(P.x / 4.6) * 0.37 + floor(P.y / 4.6) * 0.61);
          // 打散重复：颜色再从一张转过、缩放过的同一张贴图里取一份，按低频噪声混进来（缝只从主采样取，免得出现双线）
          vec2 tuv2 = mat2(0.8, -0.6, 0.6, 0.8) * P / 3.37 + vec2(0.37, 0.71);
          vec3 tx2 = texture2D(uDetail, tuv2).rgb;
          float l2 = dot(tx2, vec3(0.299, 0.587, 0.114));
          float bm = smoothstep(0.35, 0.65, fbm3(P * 0.21 + 19.0));
          vec3 txc = mix(tx, tx * (l2 / max(l0, 0.04)) , bm * 0.7 * smoothstep(0.05, 0.12, l0));
          stone = clamp(txc, 0.0, 1.0) * 0.5;
          // 每块 4.6 米的大格子各自偏一点色调和明暗（按格子哈希）
          vec2 cell = floor(P / 4.6);
          stone *= 0.86 + 0.28 * hash21(cell * 1.31 + 4.0);
          // 大尺度的明暗和冷暖变化，打散贴图重复
          float mac = fbm3(P * 0.13 + 7.0);
          stone *= 0.72 + 0.5 * mac;
          stone *= mix(vec3(0.96, 0.98, 1.03), vec3(1.05, 1.0, 0.94), fbm3(P * 0.31 + 2.0));
          float e = 1.0 / 2048.0 * 1.5;
          float lx = dot(texture2D(uDetail, tuv + vec2(e, 0.0)).rgb, vec3(0.333));
          float lz = dot(texture2D(uDetail, tuv + vec2(0.0, e)).rgb, vec3(0.333));
          // 贴图亮度梯度当法线：石板内部的细颗粒只留一点（不然湿的地方被火盆点光照出一片橙色碎亮点），倒角处保留
          bevDir = -vec2(lx - l0, lz - l0) * 18.0 * mix(1.0, 0.3, bevel);
        } else {
          vec4 sl = slab(P);
          sid = sl.y;
          gap = 1.0 - smoothstep(0.012, 0.03 + nB * 0.015, sl.x);
          bevel = smoothstep(0.0, 0.06, sl.x);
          float grain0 = fbm5(P * 3.1 + sid * 13.0);
          stone = vec3(0.2, 0.205, 0.215) * (0.72 + 0.5 * sid) * (0.78 + 0.4 * grain0);
          stone = mix(stone * 0.55, stone, bevel);
          stone = mix(stone, vec3(0.04, 0.04, 0.042), gap * 0.9);
          bevDir = sl.zw * (1.0 - bevel) * 0.55;
        }
        float grain = fbm3(P * 3.1 + sid * 13.0);

        // 区域：院子外、靠近台阶、对战那一条
        float outside = max(smoothstep(10.8, 14.0, ax + (nA - 0.5) * 3.0), smoothstep(3.6, 7.8, P.y + (nA - 0.5) * 3.0));
        float nearBack = smoothstep(-8.5, -13.0, P.y + (nA - 0.5) * 2.0);
        float strip = (1.0 - smoothstep(1.6, 2.8, abs(P.y))) * (1.0 - smoothstep(9.5, 11.0, ax));
        // 火盆周围雪化了，一圈湿的
        float dB = min(length(P - uBrz[0].xz), length(P - uBrz[1].xz));
        float melt = 1.0 - smoothstep(1.1, 2.4, dB + (nB - 0.5) * 0.8);

        // 积雪覆盖：缝里的残雪（对战区里只有一部分缝有雪）、成片的残雪、院子外的厚雪
        float gapSnowAmt = mix(0.85, 0.3, strip) * smoothstep(0.3, 0.6, fbm3(P * 0.9 + 3.0) + 0.15 * (1.0 - strip));
        float snow = gap * gapSnowAmt;
        float patchS = smoothstep(0.6, 0.72, fbm3(P * 0.5 + 11.0) + (nB - 0.5) * 0.3);
        snow = max(snow, patchS * mix(0.95, 0.25, strip) * (0.6 + 0.4 * (1.0 - bevel)));
        snow = max(snow, outside);
        snow = max(snow, nearBack * (patchS * 0.8 + 0.25 + 0.6 * gap));
        snow = max(snow, smoothstep(0.02, 0.12, vWPos.y));
        snow *= 1.0 - melt * 0.92;
        snow = clamp(snow, 0.0, 1.0);

        // 积水和薄冰（成片、局部）
        float wetN = fbm3(P * 0.19 + vec2(5.0, 1.0));
        float wet = smoothstep(0.53, 0.62, wetN + (nB - 0.5) * 0.08 + strip * 0.04);
        wet = max(wet, melt * 0.8);
        wet = max(wet, gap * 0.6);
        float puddle = smoothstep(0.6 - strip * 0.04, 0.68 - strip * 0.04, wetN) * (1.0 - snow) * (1.0 - gap * 0.5);
        float ice = smoothstep(0.66, 0.76, fbm3(P * 0.27 + 40.0)) * (1.0 - melt) * (1.0 - outside) * (1.0 - snow);
        wet *= 1.0 - snow;

        vec3 wetStone = stone * 0.4;
        vec3 iceCol = mix(wetStone, vec3(0.16, 0.2, 0.26), 0.5);
        vec3 snowCol = vec3(0.5, 0.54, 0.6) * (0.88 + 0.12 * nB);

        vec3 alb = mix(stone, wetStone, wet);
        alb = mix(alb, iceCol, ice);
        alb = mix(alb, snowCol, snow);
        // 镜头前方的地面压暗一点（前景不抢戏），再叠一层缓慢移动的云影
        alb *= mix(1.0, 0.6, smoothstep(2.2, 7.0, P.y));
        alb *= 0.78 + 0.32 * smoothstep(0.3, 0.7, fbm3(P * 0.06 + vec2(uTime * 0.025, uTime * 0.01)));
        diffuseColor.rgb = alb;

        float gRough = mix(0.9 - 0.08 * grain, 0.2, wet);
        gRough = mix(gRough, 0.1, puddle);
        gRough = mix(gRough, 0.13, ice);
        gRough = mix(gRough, 0.8, snow);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          // 石板倒角 + 每块石板轻微倾斜 + 表面颗粒；积水和雪的地方变平
          float e = 0.02;
          float g0 = fbm3(P * 6.0 + sid * 5.0);
          float gx = fbm3((P + vec2(e, 0.0)) * 6.0 + sid * 5.0) - g0;
          float gz = fbm3((P + vec2(0.0, e)) * 6.0 + sid * 5.0) - g0;
          vec2 pert = -bevDir - vec2(gx, gz) * 0.9;
          pert *= 1.0 - max(max(snow, puddle * 0.9), max(ice * 0.85, wet * 0.55));
          // 雪面的软起伏
          float s0 = fbm3(P * 2.2 + 30.0);
          vec2 sg = vec2(fbm3((P + vec2(0.05, 0.0)) * 2.2 + 30.0) - s0, fbm3((P + vec2(0.0, 0.05)) * 2.2 + 30.0) - s0) * 3.0;
          pert -= sg * snow;
          wn = normalize(wn + vec3(pert.x, 0.0, pert.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          // 镜面抗锯齿：法线在一个像素里变得越快，粗糙度越大（不然湿石板和冰面上会冒出一片片闪烁的亮点）
          vec3 dnx = dFdx(normal), dny = dFdy(normal);
          float nvar = max(dot(dnx, dnx), dot(dny, dny));
          roughnessFactor = max(roughnessFactor, min(0.55, sqrt(nvar) * 2.2 + 0.06));
        }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // 雪面的细小闪点（跟视角变化）
          vec2 sp = floor(P * 55.0);
          float hs = hash21(sp + floor(dot(normalize(vViewPosition), vec3(9.0, 13.0, 7.0))));
          float spark = step(0.9993, hs) * snow * smoothstep(3.0, 7.0, length(vViewPosition));
          totalEmissiveRadiance += vec3(0.4, 0.5, 0.65) * spark * (1.0 - uDim);
          // 平面反射：只在对战区附近、湿的地方
          if (uReflOn > 0.5) {
            float reg = (1.0 - smoothstep(3.0, 5.5, abs(P.y))) * (1.0 - smoothstep(12.0, 15.0, ax));
            float rm = clamp(puddle + ice * 0.8 + wet * 0.45, 0.0, 1.0) * (1.0 - snow) * reg;
            if (rm > 0.002) {
              vec4 rc = uReflMat * vec4(vWPos, 1.0);
              vec2 ruv = rc.xy / rc.w + (inverseTransformDirection(normal, viewMatrix).xz) * 0.03;
              float lod = mix(1.0, 5.0, clamp((gRough - 0.04) / 0.3, 0.0, 1.0));
              // 湿地面的倒影是竖着拉长的（微表面在视线方向上被拉伸）：沿屏幕竖直方向取 5 个点平均，
              // 亮点变成一道竖的光痕，而不是一个圆斑
              vec3 rcol = vec3(0.0);
              float sv = 0.012 + 0.05 * clamp((gRough - 0.04) / 0.3, 0.0, 1.0);
              for (int k = -2; k <= 2; k++) rcol += textureLod(uRefl, ruv + vec2(0.0, float(k) * sv), lod).rgb;
              rcol *= 0.2;
              // 灯笼、火这些很亮的东西在倒影里再压一压
              float rl = max(rcol.r, max(rcol.g, rcol.b));
              rcol *= 1.0 / (1.0 + max(0.0, rl - 0.1) * 5.0);
              vec3 V = normalize(-vViewPosition);
              float fr = 0.03 + 0.97 * pow(max(1.0 - clamp(dot(normal, V), 0.0, 1.0), 0.0), 5.0);
              totalEmissiveRadiance += rcol * rm * mix(0.25, 1.0, fr) * 0.9;
            }
          }
        }
      `);
  };
  mat.customProgramCacheKey = () => (refl ? 'temple-ground-v4r' : 'temple-ground-v4');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}
