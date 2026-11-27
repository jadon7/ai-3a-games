// 程序化 PBR 贴图生成器：全部在 GPU 上用片元着色器生成（可平铺的 albedo / normal / ORM）
import * as THREE from 'three';

const COMMON = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uMode;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec4 uP;
uniform float uSeed;
#define TAU 6.2831853
float hash12(vec2 p){ p += uSeed * 13.37; vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ p += uSeed * 13.37; vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float pnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = hash12(mod(i, per)); float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per)); float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 uv, vec2 scale, int oct){
  float s = 0.0, a = 0.5, n = 0.0; vec2 p = uv * scale; vec2 per = scale;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * pnoise(p + float(i) * 17.0, per); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
  return s / n;
}
// 返回 (F1, F2, 单元随机值)
vec3 pvoronoi(vec2 p, vec2 per){
  vec2 n = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j)); vec2 cell = mod(n + g, per);
    vec2 o = hash22(cell); vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; id = hash12(cell + 7.7); } else if (d < d2){ d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

const MAIN = /* glsl */`
void main(){
  vec3 col; float h, r, ao, m;
  surface(vUv, col, h, r, ao, m);
  if (uMode == 0) gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), clamp(h, 0.0, 1.0));
  else if (uMode == 1) gl_FragColor = vec4(clamp(ao, 0.0, 1.0), clamp(r, 0.04, 1.0), clamp(m, 0.0, 1.0), 1.0);
  else gl_FragColor = vec4(h, h, h, 1.0);
}
`;

// 每个表面：void surface(uv, out col(sRGB), out h, out rough, out ao, out metal)
export const SURFACES = {
  plaster: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float big = pfbm(uv, vec2(3.0), 5);
  float med = pfbm(uv + 0.37, vec2(10.0), 4);
  float fine = pfbm(uv + 0.71, vec2(48.0), 4);
  float grain = pnoise(uv * 320.0, vec2(320.0));
  float trowel = pfbm(uv + 0.13, vec2(5.0, 34.0), 3);
  float drip = pfbm(uv + 0.5, vec2(26.0, 2.0), 3);
  vec2 wp = uv * 6.0 + 0.6 * vec2(pfbm(uv, vec2(6.0), 3), pfbm(uv + 0.5, vec2(6.0), 3));
  vec3 v = pvoronoi(wp, vec2(6.0));
  float crackMask = smoothstep(0.60, 0.72, pfbm(uv + 0.9, vec2(4.0), 3));
  float crack = (1.0 - smoothstep(0.0, 0.014, v.y - v.x)) * crackMask;
  h = 0.5 + 0.30 * (med - 0.5) + 0.22 * (trowel - 0.5) + 0.16 * (fine - 0.5) + 0.05 * (grain - 0.5) - 0.35 * crack;
  col = vec3(0.92, 0.90, 0.86);
  col *= 0.84 + 0.30 * big;
  col *= 1.0 - 0.12 * smoothstep(0.5, 0.8, drip) * smoothstep(0.35, 0.65, big);
  col = mix(col, col * vec3(0.80, 0.74, 0.66), 0.35 * smoothstep(0.55, 0.75, med));
  col *= 0.96 + 0.08 * grain;
  col *= 1.0 - 0.45 * crack;
  r = 0.86 + 0.12 * (fine - 0.5);
  ao = clamp(1.0 - 0.6 * crack - 0.2 * (1.0 - smoothstep(0.3, 0.6, med + 0.2)), 0.0, 1.0);
  m = 0.0;
}`,
  brick: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 g = vec2(8.0, 16.0); vec2 p = uv * g; float row = floor(p.y); p.x += 0.5 * mod(row, 2.0);
  vec2 id = mod(floor(p), g); vec2 f = fract(p);
  float rnd = hash12(id + 3.1); float rnd2 = hash12(id + 9.4);
  vec2 e = min(f, 1.0 - f) * vec2(0.25, 0.125);
  float edge = min(e.x, e.y);
  float mortar = 1.0 - smoothstep(0.005, 0.014, edge);
  float n1 = pfbm(uv, vec2(24.0), 4); float n2 = pfbm(uv + 0.3, vec2(96.0), 3);
  float chip = smoothstep(0.62, 0.8, pfbm(uv + rnd, vec2(18.0), 3));
  h = mix(0.62 + 0.14 * (rnd - 0.5) + 0.10 * (n1 - 0.5) + 0.06 * (n2 - 0.5) - 0.18 * chip, 0.30 + 0.06 * n2, mortar);
  vec3 brick = mix(vec3(0.66, 0.44, 0.29), vec3(0.78, 0.60, 0.40), rnd);
  brick = mix(brick, vec3(0.55, 0.38, 0.28), 0.5 * rnd2 * rnd2);
  brick *= 0.8 + 0.4 * n1;
  vec3 mort = vec3(0.72, 0.66, 0.56) * (0.85 + 0.3 * n2);
  col = mix(brick, mort, mortar);
  col = mix(col, mort * 0.9, 0.5 * chip * (1.0 - mortar));
  r = mix(0.82, 0.95, mortar); ao = mix(1.0, 0.72, mortar); m = 0.0;
}`,
  sandstone: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 g = vec2(4.0, 8.0); vec2 p = uv * g; float row = floor(p.y);
  p.x += 0.5 * mod(row, 2.0) + 0.17 * hash12(vec2(mod(row, g.y), 5.0));
  vec2 id = mod(floor(p), g); vec2 f = fract(p);
  float rnd = hash12(id + 1.3), rnd2 = hash12(id + 5.9);
  vec2 e = min(f, 1.0 - f) * vec2(0.75, 0.375); float edge = min(e.x, e.y);
  float gap = 1.0 - smoothstep(0.004, 0.012, edge);
  float bevel = smoothstep(0.0, 0.035, edge);
  float n1 = pfbm(uv, vec2(9.0), 5), n2 = pfbm(uv + 0.2, vec2(60.0), 4);
  float pit = smoothstep(0.70, 0.82, pfbm(uv + 0.6, vec2(72.0), 3));
  float strata = pfbm(uv + 0.1 * rnd, vec2(3.0, 46.0), 3);
  h = 0.45 + 0.25 * bevel + 0.10 * (rnd - 0.5) + 0.08 * (n1 - 0.5) + 0.07 * (strata - 0.5) + 0.05 * (n2 - 0.5) - 0.12 * pit;
  h = mix(h, 0.2, gap);
  col = mix(vec3(0.82, 0.69, 0.50), vec3(0.90, 0.79, 0.61), rnd);
  col = mix(col, vec3(0.72, 0.58, 0.42), 0.4 * rnd2);
  col *= 0.82 + 0.3 * n1; col *= 0.94 + 0.12 * strata; col *= 1.0 - 0.10 * pit;
  col = mix(col, vec3(0.42, 0.34, 0.26), gap * 0.85);
  r = 0.9; ao = mix(1.0, 0.6, gap) * (0.8 + 0.2 * bevel) * (1.0 - 0.2 * pit); m = 0.0;
}`,
  sand: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float w1 = pfbm(uv, vec2(4.0), 4); float w2 = pfbm(uv + 0.4, vec2(4.0), 4);
  float ph = TAU * (uv.x * 9.0 + uv.y * 31.0) + 5.0 * w1 + 3.0 * sin(TAU * (uv.x * 2.0 - uv.y) + 4.0 * w2);
  float rip = pow(0.5 + 0.5 * sin(ph), 1.6);
  float ripMask = smoothstep(0.52, 0.80, pfbm(uv + 0.77, vec2(3.0), 3));
  float fine = pfbm(uv + 0.21, vec2(90.0), 4);
  float g2 = pnoise(uv * 512.0, vec2(512.0));
  vec3 pv = pvoronoi(uv * 70.0, vec2(70.0)); float peb = (1.0 - smoothstep(0.08, 0.16, pv.x)) * step(0.80, pv.z);
  float foot = pfbm(uv + 0.33, vec2(14.0), 4);
  h = 0.5 + 0.085 * (rip - 0.5) * ripMask + 0.25 * (foot - 0.5) * (1.0 - 0.6 * ripMask) + 0.10 * (fine - 0.5) + 0.05 * (g2 - 0.5) + 0.3 * peb;
  col = mix(vec3(0.80, 0.63, 0.42), vec3(0.91, 0.77, 0.56), w1);
  col *= 0.90 + 0.16 * fine; col *= 0.95 + 0.1 * g2; col *= 0.96 + 0.06 * rip * ripMask;
  col = mix(col, vec3(0.50, 0.44, 0.38) * (0.6 + 0.8 * pv.z), peb * 0.9);
  r = 0.93 - 0.1 * peb; ao = 1.0 - 0.12 * (1.0 - rip) * ripMask; m = 0.0;
}`,
  dirt: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(5.0), 5), n2 = pfbm(uv + 0.5, vec2(40.0), 4), g2 = pnoise(uv * 400.0, vec2(400.0));
  vec3 pv = pvoronoi(uv * 46.0, vec2(46.0)); float peb = (1.0 - smoothstep(0.10, 0.22, pv.x)) * step(0.55, pv.z);
  vec3 pv2 = pvoronoi(uv * 120.0 + 3.3, vec2(120.0)); float peb2 = (1.0 - smoothstep(0.12, 0.25, pv2.x)) * step(0.5, pv2.z);
  vec3 cv = pvoronoi(uv * 15.0 + 0.8 * n1, vec2(15.0));
  float crk = (1.0 - smoothstep(0.0, 0.035, cv.y - cv.x)) * smoothstep(0.56, 0.72, n1) * 0.6;
  h = 0.45 + 0.2 * (n1 - 0.5) + 0.12 * (n2 - 0.5) + 0.04 * (g2 - 0.5) + 0.28 * peb + 0.12 * peb2 - 0.2 * crk;
  col = mix(vec3(0.58, 0.47, 0.34), vec3(0.72, 0.60, 0.44), n1); col *= 0.88 + 0.2 * n2;
  col = mix(col, mix(vec3(0.45, 0.42, 0.38), vec3(0.72, 0.66, 0.58), pv.z), peb * 0.85);
  col = mix(col, vec3(0.6, 0.55, 0.48) * (0.7 + 0.5 * pv2.z), peb2 * 0.7);
  col *= 1.0 - 0.3 * crk;
  r = 0.9; ao = 1.0 - 0.3 * crk; m = 0.0;
}`,
  paving: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 wp = uv * 11.0 + 0.22 * vec2(pfbm(uv, vec2(11.0), 2), pfbm(uv + 0.5, vec2(11.0), 2));
  vec3 v = pvoronoi(wp, vec2(11.0)); float edge = v.y - v.x;
  float gap = 1.0 - smoothstep(0.035, 0.085, edge); float bevel = smoothstep(0.035, 0.24, edge);
  float n1 = pfbm(uv, vec2(12.0), 5), n2 = pfbm(uv + 0.3, vec2(70.0), 4);
  float worn = pfbm(uv + 0.8, vec2(3.0), 3);
  h = mix(0.5 + 0.22 * bevel + 0.12 * (v.z - 0.5) + 0.08 * (n1 - 0.5) + 0.05 * (n2 - 0.5), 0.22 + 0.1 * n2, gap);
  vec3 stone = mix(vec3(0.62, 0.56, 0.48), vec3(0.80, 0.72, 0.60), v.z);
  stone = mix(stone, vec3(0.56, 0.50, 0.46), 0.5 * step(0.7, hash12(vec2(v.z * 91.0, 3.0))));
  stone *= 0.8 + 0.35 * n1;
  vec3 sandc = vec3(0.80, 0.66, 0.46) * (0.85 + 0.3 * n2);
  col = mix(stone, sandc, gap);
  col = mix(col, sandc, 0.35 * smoothstep(0.55, 0.8, worn) * (1.0 - bevel * 0.5));
  r = mix(0.70 + 0.2 * n2, 0.95, gap); ao = mix(1.0, 0.7, gap); m = 0.0;
}`,
  concrete: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(4.0), 5), n2 = pfbm(uv + 0.4, vec2(30.0), 4), g2 = pnoise(uv * 300.0, vec2(300.0));
  vec3 pv = pvoronoi(uv * 90.0, vec2(90.0)); float pore = (1.0 - smoothstep(0.05, 0.14, pv.x)) * step(0.7, pv.z);
  float seam = 1.0 - smoothstep(0.0, 0.004, abs(fract(uv.y * 2.0 + 0.5) - 0.5) * 0.5);
  float stain = pfbm(uv + 0.6, vec2(14.0, 2.0), 4);
  h = 0.5 + 0.15 * (n2 - 0.5) + 0.04 * (g2 - 0.5) - 0.3 * pore - 0.25 * seam;
  col = vec3(0.66, 0.63, 0.58) * (0.8 + 0.35 * n1); col *= 1.0 - 0.18 * smoothstep(0.5, 0.8, stain);
  col *= 1.0 - 0.3 * pore; col *= 1.0 - 0.3 * seam;
  r = 0.8 + 0.15 * (n2 - 0.5); ao = 1.0 - 0.5 * pore - 0.4 * seam; m = 0.0;
}`,
  wood: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float planks = 8.0; float px = uv.x * planks; float pid = mod(floor(px), planks); float pf = fract(px);
  float rnd = hash12(vec2(pid, 2.0)), rnd2 = hash12(vec2(pid, 7.0));
  vec2 guv = vec2(uv.x, uv.y + rnd * 3.7);
  float grain = pfbm(guv, vec2(planks * 6.0, 3.0), 5);
  float ring = sin(TAU * (grain * 6.0 + pf * 2.0));
  float fine = pfbm(guv + 0.2, vec2(planks * 24.0, 6.0), 3);
  float gapx = 1.0 - smoothstep(0.0, 0.035, min(pf, 1.0 - pf));
  float jy = fract(uv.y + rnd2); float joint = 1.0 - smoothstep(0.0, 0.004, min(jy, 1.0 - jy));
  float gap = max(gapx, joint);
  vec2 kc = vec2(0.5 + 0.2 * (rnd - 0.5), fract(rnd2 * 3.3));
  float dy = fract(uv.y - kc.y + 0.5) - 0.5;
  float knot = (1.0 - smoothstep(0.0, 0.03, length(vec2((pf - kc.x) * 0.25, dy * 2.0)))) * step(0.6, rnd);
  h = 0.5 + 0.12 * (grain - 0.5) + 0.03 * ring + 0.05 * (fine - 0.5) - 0.4 * gap - 0.1 * knot;
  vec3 base = mix(uColA, uColB, rnd);
  base = mix(base, vec3(0.52, 0.48, 0.42), 0.35 * rnd2);
  col = base * (0.75 + 0.4 * grain + 0.06 * ring); col *= 0.94 + 0.12 * fine;
  col = mix(col, vec3(0.2, 0.14, 0.09), knot * 0.7); col *= 1.0 - 0.75 * gap;
  r = 0.78 + 0.12 * (fine - 0.5); ao = 1.0 - 0.7 * gap; m = 0.0;
}`,
  metalPaint: /* glsl */`
// uP.x = 锈蚀量(0..1), uP.y = 波纹(瓦楞)条数, uP.z = 面板缝密度
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(5.0), 5), n2 = pfbm(uv + 0.3, vec2(36.0), 4), g2 = pnoise(uv * 256.0, vec2(256.0));
  float drip = pfbm(uv + 0.8, vec2(30.0, 2.0), 3);
  float rustMask = smoothstep(0.70 - 0.16 * uP.x, 0.80 - 0.16 * uP.x, n1 + 0.25 * (n2 - 0.5) + 0.12 * (drip - 0.5));
  float scr = pfbm(uv + 0.6, vec2(3.0, 120.0), 3);
  float scratch = smoothstep(0.72, 0.8, scr) * smoothstep(0.4, 0.6, pfbm(uv + 0.1, vec2(8.0), 2));
  float panel = uP.z > 0.5 ? 1.0 - smoothstep(0.0, 0.004, abs(fract(uv.x * uP.z + 0.5) - 0.5) / uP.z) : 0.0;
  float ridge = uP.y > 0.5 ? sin(TAU * uv.x * uP.y) : 0.0;
  h = 0.5 + 0.03 * (n2 - 0.5) + 0.10 * rustMask * n2 - 0.1 * scratch - 0.3 * panel + 0.32 * ridge;
  vec3 paint = vec3(0.88, 0.88, 0.86) * (0.9 + 0.15 * n2);
  vec3 rust = mix(vec3(0.36, 0.17, 0.07), vec3(0.60, 0.31, 0.12), n2);
  col = mix(paint, rust, rustMask);
  col = mix(col, vec3(0.66, 0.64, 0.61), scratch * (1.0 - rustMask));
  col *= 1.0 - 0.4 * panel; col *= 0.97 + 0.06 * g2; col *= 1.0 - 0.12 * (0.5 - 0.5 * ridge) * step(0.5, uP.y);
  r = mix(0.42 + 0.2 * n2, 0.9, rustMask); r = mix(r, 0.3, scratch * (1.0 - rustMask));
  ao = 1.0 - 0.4 * panel; m = scratch * (1.0 - rustMask) * 0.9;
}`,
  steel: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(6.0), 5), br = pfbm(uv, vec2(2.0, 160.0), 3), n2 = pfbm(uv + 0.3, vec2(40.0), 4);
  float rust = smoothstep(0.66 - 0.3 * uP.x, 0.78 - 0.25 * uP.x, n1 + 0.3 * (n2 - 0.5));
  h = 0.5 + 0.04 * (br - 0.5) + 0.1 * rust * n2;
  col = mix(uColA * (0.8 + 0.3 * br), mix(vec3(0.33, 0.16, 0.07), vec3(0.5, 0.27, 0.12), n2), rust);
  r = mix(uP.y + 0.25 * br, 0.9, rust); m = 1.0 - rust; ao = 1.0;
}`,
  fabric: /* glsl */`
// uP.x = 条纹数（0 = 纯色）
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float N = 96.0; float wx = sin(TAU * uv.x * N), wy = sin(TAU * uv.y * N);
  float weave = 0.5 + 0.5 * wx * wy;
  float n1 = pfbm(uv, vec2(6.0), 4), n2 = pfbm(uv + 0.4, vec2(50.0), 3);
  float fold = pfbm(uv + 0.2, vec2(2.0, 9.0), 3);
  float stripe = uP.x > 0.5 ? step(0.5, fract(uv.x * uP.x)) : 0.0;
  h = 0.5 + 0.2 * (weave - 0.5) + 0.2 * (n1 - 0.5) + 0.06 * (n2 - 0.5) + 0.25 * (fold - 0.5);
  col = mix(uColA, uColB, stripe) * (0.8 + 0.25 * n1) * (0.92 + 0.16 * weave);
  col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(1.05, 1.0, 0.92), 0.22 * n1 + 0.1);
  r = 0.95; ao = 0.85 + 0.15 * weave; m = 0.0;
}`,
  tiles: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 p = uv * 4.0; vec2 id = mod(floor(p), 4.0); vec2 f = fract(p) - 0.5;
  float grout = smoothstep(0.455, 0.478, max(abs(f.x), abs(f.y)));
  vec2 q = abs(f); if (q.y > q.x) q = q.yx;
  float rr = length(f); float ang = atan(q.y, q.x);
  float star = cos(ang * 8.0) * 0.06 + 0.25;
  float d1 = rr - star;
  float d2 = abs(rr - 0.385) - 0.028;
  float d3 = length(q - vec2(0.5, 0.5)) - 0.16;
  float dia = abs(q.x + q.y - 0.47) - 0.012;
  vec3 white = vec3(0.90, 0.88, 0.80), yel = vec3(0.86, 0.63, 0.16);
  col = white;
  col = mix(col, uColB, 1.0 - smoothstep(0.0, 0.012, d2));
  col = mix(col, uColA, 1.0 - smoothstep(0.0, 0.012, d1));
  col = mix(col, white, 1.0 - smoothstep(0.0, 0.012, rr - 0.15));
  col = mix(col, yel, 1.0 - smoothstep(0.0, 0.012, rr - 0.085));
  col = mix(col, uColA, 1.0 - smoothstep(0.0, 0.012, d3));
  col = mix(col, uColB, (1.0 - smoothstep(0.0, 0.01, dia)) * step(0.3, rr) * smoothstep(0.0, 0.02, d3));
  float n = pfbm(uv, vec2(20.0), 4);
  float chipped = smoothstep(0.70, 0.80, pfbm(uv + 0.5, vec2(9.0), 3) + 0.22 * hash12(id));
  col *= 0.9 + 0.2 * n; col = mix(col, vec3(0.74, 0.64, 0.52), chipped * 0.85); col = mix(col, vec3(0.56, 0.50, 0.42), grout);
  h = mix(0.62 - 0.25 * chipped + 0.03 * n, 0.35, grout);
  r = mix(0.16 + 0.2 * n, 0.9, max(grout, chipped)); ao = 1.0 - 0.3 * grout; m = 0.0;
}`,
  rug: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 c = uv - 0.5; vec2 q = abs(c);
  float n = pfbm(uv, vec2(40.0), 3); float weave = 0.5 + 0.5 * sin(TAU * uv.y * 180.0);
  vec3 cream = vec3(0.84, 0.76, 0.60), gold = vec3(0.74, 0.52, 0.20);
  vec2 m2 = vec2(c.x * 2.0, c.y * 3.0);
  float d = min((0.5 - q.x) * 2.0, (0.5 - q.y) * 3.0);
  col = uColA;
  col = mix(col, uColB, step(d, 0.30));
  col = mix(col, cream, step(d, 0.26) * step(0.22, d));
  col = mix(col, gold, step(d, 0.10) * step(0.06, d));
  float dm = abs(fract(m2.x * 4.0) - 0.5) + abs(fract(m2.y * 4.0) - 0.5);
  col = mix(col, cream, step(dm, 0.25) * step(d, 0.21) * step(0.11, d));
  float lat = abs(fract(m2.x * 2.5 + 0.5) - 0.5) + abs(fract(m2.y * 2.5 + 0.5) - 0.5);
  float inField = step(0.30, d);
  col = mix(col, uColB, step(lat, 0.18) * inField); col = mix(col, gold, step(lat, 0.07) * inField);
  float md = abs(m2.x) + abs(m2.y) * 0.7;
  col = mix(col, uColB, step(md, 0.62)); col = mix(col, cream, step(md, 0.52)); col = mix(col, uColA, step(md, 0.44));
  col = mix(col, gold, step(md, 0.2)); col = mix(col, uColB, step(md, 0.12));
  float fr = step(d, 0.012) * step(0.5, fract(uv.x * 60.0));
  col = mix(col, cream, fr);
  col *= (0.75 + 0.3 * n) * (0.9 + 0.2 * weave);
  col = mix(col, vec3(0.62, 0.52, 0.40), 0.28 * smoothstep(0.45, 0.8, pfbm(uv + 0.3, vec2(5.0), 3)));
  h = 0.5 + 0.1 * weave + 0.1 * n; r = 1.0; ao = 1.0; m = 0.0;
}`,
  rock: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(3.0), 6); float strata = pfbm(vec2(uv.x, uv.y + 0.08 * n1), vec2(2.0, 24.0), 4);
  vec2 wp = uv * 5.0 + 0.8 * vec2(pfbm(uv, vec2(5.0), 3), pfbm(uv + 0.5, vec2(5.0), 3)); vec3 v = pvoronoi(wp, vec2(5.0));
  float crack = 1.0 - smoothstep(0.0, 0.06, v.y - v.x);
  float fine = pfbm(uv + 0.2, vec2(48.0), 4);
  h = 0.5 + 0.3 * (n1 - 0.5) + 0.25 * (strata - 0.5) + 0.1 * (fine - 0.5) - 0.3 * crack + 0.1 * (v.z - 0.5);
  col = mix(vec3(0.64, 0.44, 0.30), vec3(0.84, 0.64, 0.44), strata);
  col = mix(col, vec3(0.52, 0.35, 0.26), 0.5 * smoothstep(0.5, 0.7, n1)); col *= 0.85 + 0.3 * fine; col *= 1.0 - 0.5 * crack;
  r = 0.92; ao = 1.0 - 0.5 * crack; m = 0.0;
}`,
  // 精细金属/聚合物（武器、机甲、士兵装甲）
  gunmetal: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(4.0), 5), br = pfbm(uv, vec2(2.0, 90.0), 3), n2 = pfbm(uv + 0.3, vec2(64.0), 3);
  float scr = smoothstep(0.74, 0.8, pfbm(uv + 0.6, vec2(60.0, 4.0), 2)) * smoothstep(0.45, 0.6, pfbm(uv + 0.2, vec2(5.0), 2));
  float wear = smoothstep(0.58, 0.72, n1);
  h = 0.5 + 0.05 * (br - 0.5) + 0.05 * (n2 - 0.5) - 0.1 * scr;
  col = uColA * (0.82 + 0.3 * br); col = mix(col, uColB, 0.6 * wear + 0.8 * scr);
  r = uP.x + 0.2 * (br - 0.5) + 0.15 * (n2 - 0.5) - 0.12 * wear; m = uP.y; ao = 1.0;
}`,
  polymer: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec3 pv = pvoronoi(uv * 90.0, vec2(90.0)); float dot_ = 1.0 - smoothstep(0.15, 0.4, pv.x);
  float n1 = pfbm(uv, vec2(5.0), 4), n2 = pfbm(uv + 0.3, vec2(50.0), 3);
  h = 0.5 + 0.25 * dot_ + 0.05 * (n2 - 0.5);
  col = uColA * (0.85 + 0.25 * n1) * (0.95 + 0.1 * dot_);
  col = mix(col, uColB, 0.35 * smoothstep(0.6, 0.75, n1));
  r = uP.x + 0.12 * (n2 - 0.5); m = 0.0; ao = 0.9 + 0.1 * dot_;
}`,
  armor: /* glsl */`
// 涂装装甲：近白色可着色，边缘掉漆露出金属
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  float n1 = pfbm(uv, vec2(5.0), 5), n2 = pfbm(uv + 0.3, vec2(40.0), 4), g2 = pnoise(uv * 200.0, vec2(200.0));
  float chip = smoothstep(0.66 - 0.2 * uP.x, 0.72 - 0.2 * uP.x, n1 * 0.6 + n2 * 0.5);
  float scr = smoothstep(0.76, 0.82, pfbm(uv + 0.6, vec2(4.0, 110.0), 3)) * smoothstep(0.4, 0.6, pfbm(uv + 0.1, vec2(7.0), 2));
  float dirt = smoothstep(0.4, 0.8, pfbm(uv + 0.7, vec2(3.0, 5.0), 4));
  float bare = max(chip, scr);
  h = 0.55 + 0.03 * (n2 - 0.5) - 0.2 * bare;
  col = mix(vec3(0.90, 0.90, 0.88) * (0.92 + 0.12 * n2), vec3(0.42, 0.42, 0.44), bare);
  col *= 1.0 - 0.28 * dirt; col *= 0.97 + 0.06 * g2;
  r = mix(0.48 + 0.18 * n2, 0.34, bare); r = mix(r, 0.85, dirt * 0.6); m = bare; ao = 1.0 - 0.15 * bare;
}`,
  // 迷彩作战服面料：uColA 底色，uColB 深色斑，uP.rgb 浅色斑
  camo: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  vec2 w = uv + 0.06 * vec2(pfbm(uv, vec2(6.0), 3), pfbm(uv + 0.5, vec2(6.0), 3));
  float n1 = pfbm(w, vec2(5.0), 4), n2 = pfbm(w + 0.37, vec2(8.0), 4), n3 = pfbm(w + 0.71, vec2(13.0), 3), n4 = pfbm(w + 0.13, vec2(22.0), 3);
  col = uColA;
  col = mix(col, uColB, smoothstep(0.515, 0.535, n1));
  col = mix(col, uP.rgb, smoothstep(0.555, 0.575, n2));
  col = mix(col, mix(uColA, uColB, 0.5) * vec3(0.9, 1.0, 0.82), smoothstep(0.585, 0.605, n3));
  col = mix(col, uColB * 0.55, smoothstep(0.66, 0.68, n4));
  float N = 150.0; float weave = 0.5 + 0.5 * sin(TAU * uv.x * N) * sin(TAU * uv.y * N);
  float fold = pfbm(uv + 0.2, vec2(3.0, 7.0), 4); float wr = pfbm(uv + 0.6, vec2(9.0, 4.0), 3);
  float fine = pfbm(uv + 0.4, vec2(60.0), 3);
  h = 0.5 + 0.12 * (weave - 0.5) + 0.45 * (fold - 0.5) + 0.25 * (wr - 0.5) + 0.05 * (fine - 0.5);
  col *= (0.86 + 0.2 * fine) * (0.93 + 0.14 * weave) * (0.85 + 0.3 * fold);
  r = 0.9; ao = 0.8 + 0.2 * fold; m = 0.0;
}`,
  // 低频噪声（世界空间宏观变化用）：RGBA 四个不同频率
  macro: /* glsl */`
void surface(vec2 uv, out vec3 col, out float h, out float r, out float ao, out float m){
  col = pow(vec3(pfbm(uv, vec2(4.0), 6), pfbm(uv + 0.31, vec2(9.0), 5), pfbm(uv + 0.67, vec2(22.0), 4)), vec3(1.0 / 2.2));
  h = pfbm(uv + 0.11, vec2(48.0), 3); r = 1.0; ao = 1.0; m = 0.0;
}`,
};

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NORMAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tH; uniform vec2 uTexel; uniform float uStrength;
float H(vec2 o){ return texture2D(tH, vUv + o * uTexel).r; }
void main(){
  float tl = H(vec2(-1.0, 1.0)), t = H(vec2(0.0, 1.0)), tr = H(vec2(1.0, 1.0));
  float l = H(vec2(-1.0, 0.0)), r = H(vec2(1.0, 0.0));
  float bl = H(vec2(-1.0, -1.0)), b = H(vec2(0.0, -1.0)), br = H(vec2(1.0, -1.0));
  float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  vec3 n = normalize(vec3(-dx * uStrength, -dy * uStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

export class TexGen {
  constructor(renderer, maxAniso = 8) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.aniso = Math.min(maxAniso, renderer.capabilities.getMaxAnisotropy());
    this.heightRTs = new Map();
    this.mats = new Map();
    this.normalMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: NORMAL_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tH: { value: null }, uTexel: { value: new THREE.Vector2() }, uStrength: { value: 1 } },
    });
  }

  _rt(size, srgb, mip = true, type = THREE.UnsignedByteType) {
    return new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false, type, format: THREE.RGBAFormat,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      anisotropy: mip ? this.aniso : 1,
    });
  }

  _mat(surfName) {
    let m = this.mats.get(surfName);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: COMMON + SURFACES[surfName] + MAIN, depthTest: false, depthWrite: false,
        uniforms: {
          uMode: { value: 0 }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() },
          uP: { value: new THREE.Vector4() }, uSeed: { value: 0 },
        },
      });
      this.mats.set(surfName, m);
    }
    return m;
  }

  _draw(mat, rt) {
    this.mesh.material = mat;
    this.r.setRenderTarget(rt);
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
  }

  // 生成一套贴图：{ map, normalMap, ormMap }
  make(surfName, { size = 1024, normal = 2.0, colA = [1, 1, 1], colB = [1, 1, 1], p = [0, 0, 0, 0], seed = 0, clampUV = false } = {}) {
    const mat = this._mat(surfName);
    mat.uniforms.uColA.value.setRGB(colA[0], colA[1], colA[2]);
    mat.uniforms.uColB.value.setRGB(colB[0], colB[1], colB[2]);
    mat.uniforms.uP.value.set(p[0] || 0, p[1] || 0, p[2] || 0, p[3] || 0);
    mat.uniforms.uSeed.value = seed;

    const albedo = this._rt(size, true);
    const orm = this._rt(size, false);
    const nrm = this._rt(size, false);
    let hrt = this.heightRTs.get(size);
    if (!hrt) { hrt = this._rt(size, false, false, THREE.HalfFloatType); this.heightRTs.set(size, hrt); }

    mat.uniforms.uMode.value = 0; this._draw(mat, albedo);
    mat.uniforms.uMode.value = 1; this._draw(mat, orm);
    mat.uniforms.uMode.value = 2; this._draw(mat, hrt);
    this.normalMat.uniforms.tH.value = hrt.texture;
    this.normalMat.uniforms.uTexel.value.set(1 / size, 1 / size);
    this.normalMat.uniforms.uStrength.value = normal * size / 1024;
    this._draw(this.normalMat, nrm);

    const out = { map: albedo.texture, normalMap: nrm.texture, ormMap: orm.texture };
    if (clampUV) for (const k in out) { out[k].wrapS = out[k].wrapT = THREE.ClampToEdgeWrapping; }
    return out;
  }

  dispose() {
    for (const rt of this.heightRTs.values()) rt.dispose();
    this.heightRTs.clear();
    for (const m of this.mats.values()) m.dispose();
    this.normalMat.dispose();
  }
}

// ---------- Canvas 2D 贴图（贴花、叶片、粒子等） ----------
export function canvasTex(w, h, draw, { srgb = true, mip = true, repeat = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// 简易可复现随机数
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
