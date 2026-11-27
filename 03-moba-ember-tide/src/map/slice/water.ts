// 水面：清、浅、看得见河底；水面连续地盖过中路；整片水面都有细碎的粼光（用户点名说好的那种）。

import { TOON_ON } from "../toon";
import * as THREE from "three";
import { rippleNormal } from "./ripple";
import { PAINT_HALF, SLICE_X, SLICE_Z } from "./def";
import { WATER_Y } from "./ground";

/** 水面要知道地面有多高（一张高度图，和它盖住的那块方形范围），才能算出水深和岸线 */
export interface WaterSource { heightTex: THREE.Texture; origin: [number, number]; size: number; }

/** 蹚水的涟漪：不是贴一张圈，而是让水面在那一处真的起一圈波，反光和明暗跟着变。最多同时 44 圈，轮着用。
 *  单位在水里走的时候每隔半米起一圈弱的：很多圈叠在一起，包出来的就是身后那道 V 形的尾迹，而不是一个个圆 */
const NW = 44, wakeU = { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, -99, 0)) }; let wakeI = 0, wakeClock: { value: number } | null = null;
/** 在水面 (x,z) 处起一圈涟漪。strength：英雄迈一步是 1，小兵 0.5 左右，重物砸进水里 2 */
export function addWake(x: number, z: number, strength = 1) { if (!wakeClock) return; wakeU.value[wakeI].set(x, z, wakeClock.value, strength); wakeI = (wakeI + 1) % NW; }

export function createWater(src: WaterSource, time: { value: number }, sunColor: THREE.Color, rocks: { x: number; z: number; r: number }[] = [], shape?: THREE.BufferGeometry): THREE.Mesh {
  // shape 不给就是样板间那一整块方形；全图时只在有水的地方铺面
  const geo = shape ?? new THREE.PlaneGeometry(PAINT_HALF * 2, PAINT_HALF * 2, 1, 1); if (!shape) geo.rotateX(-Math.PI / 2);
  wakeClock = time;
  const MAXR = 24, rk = Array.from({ length: MAXR }, (_, i) => (rocks[i] ? new THREE.Vector3(rocks[i].x, rocks[i].z, rocks[i].r) : new THREE.Vector3(0, 0, 0)));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: time, uHeight: { value: src.heightTex }, uRipple: { value: rippleNormal() }, uSunDir: { value: new THREE.Vector3(-0.42, 0.78, -0.46).normalize() }, uSunColor: { value: sunColor },
      uShallow: { value: new THREE.Color(TOON_ON ? 0x84d8cc : 0x62c4a4) }, uDeep: { value: new THREE.Color(TOON_ON ? 0x2fa6ae : 0x1a8672) },      /* 画风 B：水是青蓝、透亮的（B 我方浅水 (136,195,192)），河底的浅色石板透得出来 */ uSky: { value: new THREE.Color(0xbfdcea) }, uRocks: { value: rk },
      uOrigin: { value: new THREE.Vector2(src.origin[0], src.origin[1]) }, uSize: { value: src.size }, uWake: wakeU,
    },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uSize; uniform sampler2D uHeight, uRipple; uniform vec3 uSunDir, uSunColor, uShallow, uDeep, uSky; uniform vec2 uOrigin; uniform vec3 uRocks[${MAXR}]; uniform vec4 uWake[${NW}];
      varying vec3 vW;
      float h21(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec2 tuv = (vW.xz - uOrigin) / uSize;
        float depth = ${WATER_Y.toFixed(3)} - texture2D(uHeight, tuv).r;
        if (depth < -0.01) discard;
        // 水往右下流（沿着河道）
        vec2 flow = normalize(vec2(1.0, 1.0)), p = vW.xz;
        vec4 r1 = texture2D(uRipple, p * 0.13 + flow * uTime * 0.03), r2 = texture2D(uRipple, p * 0.31 - flow.yx * vec2(1.0, -1.0) * uTime * 0.045 + 0.37), r3 = texture2D(uRipple, p * 0.74 + flow * uTime * 0.07 + 0.11);
        // 蹚水的涟漪：每一圈是一个向外走、越走越宽越弱的波包，把它的坡度加到水面的法线上
        vec2 wk = vec2(0.0); float wkc = 0.0, wkt = 0.0;
        float wkf = 0.0;
        for (int i = 0; i < ${NW}; i++) { vec4 w = uWake[i]; float age = uTime - w.z; if (w.w <= 0.0 || age < 0.0 || age > 1.7) continue; vec2 d = p - w.xy; float r = length(d); if (r > 3.4) continue;
          vec2 dir = d / max(r, 0.05); float jag = vn(dir * 1.9 + w.z * 5.3);                                  // 圈不是正圆：不同方向走得快慢、强弱都不一样
          float R = 0.12 + age * (1.15 + jag * 0.5), x = (r - R) / (0.17 + age * 0.1), g = exp(-x * x), a = w.w * exp(-age * 2.3) * smoothstep(0.0, 0.08, age) * (0.45 + jag * 1.1);
          float cz = cos(2.6 * x); wk += dir * g * (-2.0 * x * cz - 2.6 * sin(2.6 * x)) * a; wkc += g * max(cz, 0.0) * a; wkt += g * max(-cz, 0.0) * a;
          wkf += smoothstep(0.6, 0.05, r) * smoothstep(0.5, 0.0, age) * w.w; }                                   // 刚踩下去的地方一小团被搅起来的碎沫
        vec3 n = normalize(vec3((r1.xy * 2.0 - 1.0) * 0.5 + (r2.xy * 2.0 - 1.0) * 0.42 + (r3.xy * 2.0 - 1.0) * 0.36 + wk * 1.15, 1.0)).xzy;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        // 水色：水本身很清，颜色主要是河底透上来的（河底那边按水深染了青绿）。水面只加一层薄薄的青色，深处厚一点
        float dk = smoothstep(0.0, 0.9, depth);
        vec3 col = mix(uShallow, uDeep, dk);
        float alpha = mix(${TOON_ON ? "0.13, 0.46" : "0.05, 0.4"}, dk);      // 画风 B：水有一层看得见的青蓝，河底透上来但不是一清二楚
        col = mix(col, uSky, fres * ${TOON_ON ? "0.22" : "0.4"}); alpha = mix(alpha, 0.8, fres * 0.5);      // B：天空的反光少一点，不然浅水发白发雾
        // 波峰上一道道很淡的亮线，水面才有“在流”的纹理
        float hh = r1.a * 0.45 + r2.a * 0.35 + r3.a * 0.2;
        float crest = smoothstep(0.585, 0.63, hh) * (1.0 - smoothstep(0.63, 0.675, hh));
        col += vec3(0.85, 1.0, 0.96) * crest * ${TOON_ON ? "0.3" : "0.1"}; alpha = max(alpha, crest * ${TOON_ON ? "0.45" : "0.2"});      // B：水面一道道亮的波纹线是卡通水的主要纹理（粼光不加）
        col = col * (1.0 - min(wkt, 1.0) * 0.14) + vec3(0.86, 1.0, 0.97) * min(wkc, 1.2) * 0.22; alpha = max(alpha, min(wkc, 1.0) * 0.4 + min(wkt, 1.0) * 0.16);      // 涟漪的波峰上一点点亮
        // 水面起伏的明暗：朝着光的坡亮一点，背着光的暗一点，水才有厚度
        float sh = dot(n.xz, normalize(vec2(-0.6, -0.5)));
        col *= 1.0 + sh * 0.42; alpha = clamp(alpha + abs(sh) * 0.26, 0.0, 0.95);      // 阶段 8：起伏的明暗收了四成（对着 Dota 2 的河看，原来的太花）
        // 细碎的粼光：水纹上朝着太阳的小面一闪一闪，一片密一片疏
        vec3 H = normalize(V + uSunDir), H2 = normalize(V + normalize(vec3(0.5, 0.8, -0.34)));
        float nh = max(dot(n, H), 0.0), nh2 = max(dot(n, H2), 0.0);
        float cl = smoothstep(0.3, 0.62, vn(p * 0.2 + flow * uTime * 0.04) * 0.6 + vn(p * 0.55 - flow * uTime * 0.03) * 0.4);
        float glint = min((pow(nh, 340.0) * 1.2 + pow(nh2, 400.0) * 0.7) * (0.2 + cl * 0.9) + pow(nh, 60.0) * 0.02, 0.9);      // 只要细碎的亮点，不要大片的白
        glint *= 0.42;      // 阶段 8：粼光压到原来的四成。近镜头下它是一块一块的白，盖住了河底，也是画面里最碎的东西
        col += uSunColor * glint; alpha = max(alpha, min(glint * 1.5, 0.95));
        // 白沫：岸边一道断断续续的细线，一涨一落；露出水面的石头周围贴着几团
        float nz = vn(p * 1.5 + flow * uTime * 0.12) * 0.6 + vn(p * 4.3 - flow * uTime * 0.2) * 0.4;
        float lap = 0.5 + 0.5 * sin(uTime * 1.1 + nz * 6.0);
        float foam = smoothstep(0.045 + lap * 0.03, 0.01, depth) * smoothstep(0.46, 0.66, nz);
        float ring = 0.0;
        // 石头周围不是一个圈，是贴着石头的几团碎沫
        for (int i = 0; i < ${MAXR}; i++) { vec3 q = uRocks[i]; if (q.z > 0.0) ring = max(ring, smoothstep(0.22 + lap * 0.06, 0.0, length(p - q.xy) - q.z * 0.95)); }
        foam = clamp(foam + ring * smoothstep(0.56, 0.72, vn(p * 2.6 - flow * uTime * 0.15) * 0.55 + nz * 0.45) * 0.6 + min(wkf, 1.0) * smoothstep(0.38, 0.7, vn(p * 5.5 + uTime * 0.9) * 0.6 + nz * 0.4) * 0.75, 0.0, 1.0);
        col = mix(col, vec3(0.9, 0.96, 0.94), foam * 0.7); alpha = max(alpha, foam * 0.7);
        alpha *= smoothstep(-0.01, 0.03, depth);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); if (shape) mesh.position.y = WATER_Y; else mesh.position.set(SLICE_X, WATER_Y, SLICE_Z); mesh.renderOrder = 5; mesh.name = "water";
  return mesh;
}
