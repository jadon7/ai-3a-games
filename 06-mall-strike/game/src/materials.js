// Shaders for the baked mall: lightmapped static surfaces, glass, emissive, sky, and a patch that
// lights skinned / dynamic MeshStandardMaterials with probe SH + a shadowed real-time sun.
import * as THREE from 'three';

// Effective sun under the skylight: white-diffuse radiance at normal incidence in Cycles units
// (three.js light intensity = PI * this).
// Derived from the baked floor: sun-direct max 1.74 at cos 0.86 (skylight glass transmits ~27%).
export const SUN_EFF = 1.93;

// globally shared uniforms (same objects referenced by every material)
export const G = {
  uProbes: { value: null },
  uProbeLum: { value: new Float32Array(92) },
  uProbeFlipV: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.42, 0.86, 0.30).normalize() }, // direction towards the sun (three coords)
  uSunColLM: { value: new THREE.Vector3(1, 0.95, 0.88) },
  uSunColDyn: { value: new THREE.Vector3(1, 0.95, 0.88).multiplyScalar(Math.PI * SUN_EFF) },
  uDynShadow: { value: null },
  uDynShadowMat: { value: new THREE.Matrix4() },
  uStatShadow: { value: null },
  uStatShadowMat: { value: new THREE.Matrix4() },
  uRefl: { value: null },
  uReflMat: { value: new THREE.Matrix4() },
  uTime: { value: 0 },
  uSky: { value: null },
  uLmFlip: { value: 1 },
  uDebug: { value: 0 },
  uFlashPos: { value: new THREE.Vector3() },
  uFlashCol: { value: new THREE.Vector3() },
};

export const GLSL_COMMON = /* glsl */`
#define PI 3.141592653589793
float hash3(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1,0,0)),f.x), mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x), mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y), f.z); }
float fbm(vec3 p){ float a=0.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s/0.97; }
float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec2 envBRDF(float NoV, float r){ const vec4 c0=vec4(-1.,-0.0275,-0.572,0.022); const vec4 c1=vec4(1.,0.0425,1.04,-0.04);
  vec4 rr = r*c0+c1; float a004 = min(rr.x*rr.x, exp2(-9.28*NoV))*rr.x + rr.y; return vec2(-1.04,1.04)*a004 + rr.zw; }
`;

export const GLSL_SHADOW = /* glsl */`
uniform sampler2D uDynShadow; uniform mat4 uDynShadowMat;
uniform sampler2D uStatShadow; uniform mat4 uStatShadowMat;
float pcf(sampler2D sm, mat4 m, vec3 wp, float texel, float bias){
  vec3 c = (m * vec4(wp,1.0)).xyz;
  if (c.x<0.0||c.x>1.0||c.y<0.0||c.y>1.0||c.z>1.0) return 1.0;
  float s = 0.0;
  s += step(c.z-bias, texture(sm, c.xy).r);
  s += step(c.z-bias, texture(sm, c.xy+vec2( texel, 0.3*texel)).r);
  s += step(c.z-bias, texture(sm, c.xy+vec2(-texel,-0.3*texel)).r);
  s += step(c.z-bias, texture(sm, c.xy+vec2( 0.3*texel,-texel)).r);
  s += step(c.z-bias, texture(sm, c.xy+vec2(-0.3*texel, texel)).r);
  return s*0.2;
}
float dynVis(vec3 wp){ return pcf(uDynShadow, uDynShadowMat, wp, 1.0/2048.0, 0.0015); }
float statVis(vec3 wp){ return pcf(uStatShadow, uStatShadowMat, wp, 1.0/4096.0, 0.0008); }
`;

export const GLSL_PROBES = /* glsl */`
uniform highp sampler2DArray uProbes; uniform float uProbeLum[92]; uniform float uProbeFlipV;
const float GY[10] = float[10](-10.,-2.,6.,14.,22.,30.,38.,46.,54.,60.);
const float UB[9] = float[9](-12.,-3.,6.,15.,24.,33.,42.,51.,62.);
vec2 eqUV(vec3 d){ vec3 b = vec3(d.x, -d.z, d.y);
  float lat = asin(clamp(b.z,-1.,1.)); float lon = atan(-b.x, b.y);
  vec2 uv = vec2(0.5 - lon/(2.*PI), 0.5 - lat/PI);
  if (uProbeFlipV > 0.5) uv.y = 1.0 - uv.y;
  return uv; }
vec3 sP(int l, vec2 uv, float lod){ return textureLod(uProbes, vec3(uv, float(l)), lod).rgb; }
vec3 probeRadiance(vec3 wp, vec3 dir, float lod, out float plum){
  float bx = wp.x, by = -wp.z, bz = wp.y;
  vec2 uv = eqUV(dir);
  int lvl = bz > 4.8 ? 1 : 0;
  float sx = smoothstep(10.9, 11.5, abs(bx));
  vec3 cg = vec3(0.); float lg = 0.;
  if (sx < 1.0) {
    float fx = clamp((bx + 7.5)/7.5, 0., 2.); int x0 = int(min(floor(fx), 1.)); float tx = fx - float(x0);
    int y0 = 0; for (int i=0;i<8;i++){ if (by > GY[i+1]) y0 = i+1; }
    float ty = clamp((by - GY[y0])/(GY[y0+1]-GY[y0]), 0., 1.);
    int a = lvl*30 + y0*3 + x0; int b = a+1; int c = a+3; int d = a+4;
    float wa=(1.-tx)*(1.-ty), wb=tx*(1.-ty), wc=(1.-tx)*ty, wd=tx*ty;
    cg = sP(a,uv,lod)*wa + sP(b,uv,lod)*wb + sP(c,uv,lod)*wc + sP(d,uv,lod)*wd;
    lg = uProbeLum[a]*wa + uProbeLum[b]*wb + uProbeLum[c]*wc + uProbeLum[d]*wd;
  }
  vec3 cs = vec3(0.); float ls = 0.;
  if (sx > 0.0) {
    int k = 0; for (int i=0;i<7;i++){ if (by > UB[i+1]) k = i+1; }
    int l = 60 + lvl*16 + (bx > 0. ? 8 : 0) + k;
    cs = sP(l, uv, lod); ls = uProbeLum[l];
  }
  plum = mix(lg, ls, sx);
  return mix(cg, cs, sx);
}
`;

const STATIC_VS = /* glsl */`
#ifdef LM_TEX
attribute vec2 uv1;
varying vec2 vUv1;
#endif
#ifdef LM_VCOL
attribute vec4 color;
varying vec4 vLm;
#endif
varying vec2 vUv;
varying vec3 vWPos;
varying vec3 vWNrm;
#ifdef FLOOR
uniform mat4 uReflMat;
varying vec4 vRefl;
#endif
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vWNrm = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
#ifdef LM_TEX
  vUv1 = uv1;
#endif
#ifdef LM_VCOL
  vLm = color * 16.0;
#endif
#ifdef FLOOR
  vRefl = uReflMat * wp;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const STATIC_FS = /* glsl */`
${GLSL_COMMON}
${GLSL_SHADOW}
${GLSL_PROBES}
uniform vec3 uSunColLM;
#ifdef LM_TEX
uniform sampler2D lmMap; uniform float uLmFlip; varying vec2 vUv1;
#endif
#ifdef LM_VCOL
varying vec4 vLm;
#endif
#ifdef USE_MAP
uniform sampler2D map;
#endif
#ifdef USE_RMAP
uniform sampler2D roughMap;
#endif
#ifdef USE_NMAP
uniform sampler2D normalMap; uniform float normalScale;
#endif
#ifdef FLOOR
uniform sampler2D uRefl; varying vec4 vRefl;
#endif
uniform float uDebug; uniform vec3 uFlashPos, uFlashCol;
uniform vec3 tint; uniform float roughMul, roughAdd, metal, coat, coatRough, dirt, noiseRough, alphaCut;
varying vec2 vUv; varying vec3 vWPos; varying vec3 vWNrm;
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv){
  vec3 dp1=dFdx(p), dp2=dFdy(p); vec2 duv1=dFdx(uv), duv2=dFdy(uv);
  vec3 dp2perp=cross(dp2,N), dp1perp=cross(N,dp1);
  vec3 T=dp2perp*duv1.x+dp1perp*duv2.x; vec3 B=dp2perp*duv1.y+dp1perp*duv2.y;
  float invmax=inversesqrt(max(max(dot(T,T),dot(B,B)), 1e-12)); return mat3(T*invmax,B*invmax,N); }
void main(){
  vec3 albedo = tint; float alpha = 1.0;
#ifdef USE_MAP
  vec4 mt = texture(map, vUv); albedo *= mt.rgb; alpha = mt.a;
#endif
#ifdef ALPHA_TEST
  if (alpha < alphaCut) discard;
#endif
  float rough = roughAdd; float met = metal;
#ifdef USE_RMAP
  vec4 rt = texture(roughMap, vUv);
  #ifdef PH_MR
    rough = clamp(rt.g * roughMul + roughAdd, 0.02, 1.0); met = rt.b * metal;
  #else
    rough = clamp(rt.r * roughMul + roughAdd, 0.02, 1.0);
  #endif
#endif
  if (noiseRough > 0.0) rough = clamp(rough + (fbm(vWPos*4.0)-0.5)*2.0*noiseRough, 0.02, 1.0);
  if (dirt > 0.0) {
    float cr = smoothstep(0.45, 0.75, fbm(vec3(vWPos.x, -vWPos.z, vWPos.y)*0.35));
    rough = clamp(rough + cr*dirt, 0.0, 1.0);
    albedo *= mix(vec3(1.0), vec3(0.78,0.74,0.68), cr*dirt);
  }
  vec3 Ng = normalize(vWNrm);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 N = Ng;
#ifdef USE_NMAP
  vec3 tn = texture(normalMap, vUv).xyz*2.0-1.0; tn.xy *= normalScale;
  N = normalize(cotangentFrame(Ng, vWPos, vUv) * tn);
#endif
#ifdef SHUTTER
  N = normalize(N + vec3(0.0, 1.0, 0.0) * 0.0 + Ng.zxy*0.0 + vec3(0.0, sin(vWPos.y*56.5)*0.35, 0.0) * (1.0-abs(Ng.y)));
#endif
#ifdef LM_TEX
  vec4 lm = texture(lmMap, vec2(vUv1.x, mix(vUv1.y, 1.0 - vUv1.y, uLmFlip)));
#else
  vec4 lm = vLm;
#endif
  // baked values are Cycles 'diffuse light' (direct+indirect): radiance = albedo * E
  vec3 E = max(lm.rgb - uSunColLM * lm.a * (1.0 - dynVis(vWPos)), vec3(0.0));
  if (uFlashCol.r > 0.0) { vec3 fl = uFlashPos - vWPos; float fd = length(fl); E += uFlashCol * max(dot(N, fl/fd), 0.0) / (1.0 + fd*fd); }
  vec3 V = normalize(cameraPosition - vWPos);
  float NoV = clamp(dot(N, V), 1e-3, 1.0);
  vec3 F0 = mix(vec3(0.04), albedo, met);
  vec2 ab = envBRDF(NoV, rough);
  vec3 specW = F0*ab.x + ab.y;
  vec3 col = albedo * (1.0 - met) * E;
#ifdef FLOOR
  vec2 ruv = vRefl.xy / vRefl.w;
  vec2 dist = (N.xz - Ng.xz) * 0.06;
  vec3 rBase = textureLod(uRefl, ruv + dist, rough * 7.0).rgb;
  vec3 rCoat = textureLod(uRefl, ruv + dist*0.4, 0.7).rgb;
  float Fc = 0.04 + 0.96*pow(1.0 - clamp(dot(Ng, V),0.0,1.0), 5.0);
  float occ = 1.0;
  col = (col + rBase * specW * occ) * (1.0 - coat*Fc) + rCoat * Fc * coat;
#else
  float plum;
  vec3 R = reflect(-V, N);
  vec3 env = probeRadiance(vWPos, R, rough * 7.0, plum);
  float occ = clamp(lum(E) / max(plum, 1e-3), 0.0, 1.0);
  occ = mix(occ, 1.0, 0.25);
  col += env * specW * occ;
  if (coat > 0.0) {
    vec3 Rc = reflect(-V, Ng);
    float pl2; vec3 ce = probeRadiance(vWPos, Rc, coatRough*7.0, pl2);
    float Fc = 0.04 + 0.96*pow(1.0 - clamp(dot(Ng, V),0.0,1.0), 5.0);
    col = col * (1.0 - coat*Fc) + ce * Fc * coat * occ;
  }
#endif
  if (uDebug > 0.5 && uDebug < 1.5) col = E;
  if (uDebug > 1.5 && uDebug < 2.5) col = albedo * 0.3;
  if (uDebug > 2.5) col = vec3(fract(vUv*4.0), 0.0) * 0.3;
  gl_FragColor = vec4(col, 1.0);
}`;

export function staticMaterial(opts) {
  const defines = {};
  const u = {
    tint: { value: new THREE.Color(1, 1, 1) }, roughMul: { value: 1 }, roughAdd: { value: 0 }, metal: { value: 0 },
    coat: { value: 0 }, coatRough: { value: 0.05 }, dirt: { value: 0 }, noiseRough: { value: 0 }, alphaCut: { value: 0.5 },
    normalScale: { value: 1 },
    uSunColLM: G.uSunColLM, uDebug: G.uDebug, uFlashPos: G.uFlashPos, uFlashCol: G.uFlashCol,
    uDynShadow: G.uDynShadow, uDynShadowMat: G.uDynShadowMat, uStatShadow: G.uStatShadow, uStatShadowMat: G.uStatShadowMat,
    uProbes: G.uProbes, uProbeLum: G.uProbeLum, uProbeFlipV: G.uProbeFlipV,
  };
  if (opts.lmMap) { defines.LM_TEX = 1; u.lmMap = { value: opts.lmMap }; u.uLmFlip = G.uLmFlip; } else defines.LM_VCOL = 1;
  if (opts.map) { defines.USE_MAP = 1; u.map = { value: opts.map }; }
  if (opts.roughMap) { defines.USE_RMAP = 1; u.roughMap = { value: opts.roughMap }; if (opts.phMR) defines.PH_MR = 1; }
  if (opts.normalMap) { defines.USE_NMAP = 1; u.normalMap = { value: opts.normalMap }; }
  if (opts.alphaTest) defines.ALPHA_TEST = 1;
  if (opts.floor) { defines.FLOOR = 1; u.uRefl = G.uRefl; u.uReflMat = G.uReflMat; }
  if (opts.shutter) defines.SHUTTER = 1;
  for (const k of ['roughMul', 'roughAdd', 'metal', 'coat', 'coatRough', 'dirt', 'noiseRough', 'normalScale', 'alphaCut'])
    if (opts[k] !== undefined) u[k].value = opts[k];
  if (opts.tint) u.tint.value.setRGB(...opts.tint);
  const m = new THREE.ShaderMaterial({ vertexShader: STATIC_VS, fragmentShader: STATIC_FS, uniforms: u, defines,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  m.name = opts.name || 'static';
  return m;
}

// ------------------------------------------------------------------ glass
const GLASS_VS = /* glsl */`
varying vec3 vWPos; varying vec3 vWNrm;
void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWPos = wp.xyz; vWNrm = normalize(mat3(modelMatrix)*normal);
  gl_Position = projectionMatrix*viewMatrix*wp; }`;
const GLASS_FS = /* glsl */`
${GLSL_COMMON}
${GLSL_PROBES}
uniform vec3 tint; uniform float rough; uniform float dirtAmt;
varying vec3 vWPos; varying vec3 vWNrm;
void main(){
  vec3 N = normalize(vWNrm); vec3 V = normalize(cameraPosition - vWPos);
  if (dot(N, V) < 0.0) N = -N;
  float NoV = clamp(dot(N,V), 0.0, 1.0);
  float F = 0.04 + 0.96*pow(1.0-NoV, 5.0);
  float d = dirtAmt * smoothstep(0.35, 0.8, fbm(vWPos*3.0));
  F = clamp(F + d, 0.0, 1.0);
  float pl; vec3 env = probeRadiance(vWPos, reflect(-V, N), rough*7.0 + d*12.0, pl);
  // premultiplied: reflection added, background attenuated by (1-F) and tint
  gl_FragColor = vec4(env * F, F);
}`;

export function glassMaterial(tint, rough, dirt) {
  const m = new THREE.ShaderMaterial({
    vertexShader: GLASS_VS, fragmentShader: GLASS_FS,
    uniforms: { tint: { value: new THREE.Color(...tint) }, rough: { value: rough }, dirtAmt: { value: dirt },
      uProbes: G.uProbes, uProbeLum: G.uProbeLum, uProbeFlipV: G.uProbeFlipV },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  m.name = 'glass';
  return m;
}

export function emissiveMaterial(color, strength) {
  const m = new THREE.ShaderMaterial({
    vertexShader: `void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }`,
    uniforms: { c: { value: new THREE.Vector3(...color).multiplyScalar(strength) } },
    side: THREE.DoubleSide,
  });
  m.name = 'emit';
  return m;
}

// ------------------------------------------------------------------ sky (Blender world: equirect, mapping rot Z 110deg, strength 1.2)
export function skyMaterial(tex) {
  return new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      #define PI 3.141592653589793
      uniform sampler2D sky; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 b = vec3(d.x, -d.z, d.y);
        float a = radians(110.0);  // Mapping node (Point) rotates the lookup vector by +110 deg about Z
        b = vec3(cos(a)*b.x - sin(a)*b.y, sin(a)*b.x + cos(a)*b.y, b.z);
        // Cycles direction_to_equirectangular
        float u = 0.5 - atan(b.y, b.x) / (2.0*PI);
        float v = 0.5 + atan(b.z, length(b.xy)) / PI;
        gl_FragColor = vec4(texture(sky, vec2(u, v)).rgb * 1.2, 1.0);
      }`,
    uniforms: { sky: { value: tex } }, side: THREE.BackSide, depthWrite: false,
  });
}

// ------------------------------------------------------------------ dynamic objects (characters, viewmodel, debris)
export function patchDynamic(mat, perObj) {
  // perObj.uSH: {value: Array(9) of Vector3}
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSH = perObj.uSH;
    sh.uniforms.uSunDir = G.uSunDir; sh.uniforms.uSunColDyn = G.uSunColDyn;
    sh.uniforms.uDynShadow = G.uDynShadow; sh.uniforms.uDynShadowMat = G.uDynShadowMat;
    sh.uniforms.uStatShadow = G.uStatShadow; sh.uniforms.uStatShadowMat = G.uStatShadowMat;
    sh.uniforms.uSunMul = perObj.uSunMul || { value: 1 };
    sh.uniforms.uFlashPos = G.uFlashPos; sh.uniforms.uFlashCol = G.uFlashCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMyWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMyWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMyWPos;\nuniform vec3 uSH[9];\nuniform vec3 uSunDir;\nuniform vec3 uSunColDyn;\nuniform float uSunMul;\nuniform vec3 uFlashPos, uFlashCol;\n${GLSL_SHADOW}`)
      .replace('#include <lights_fragment_begin>', /* glsl */`#include <lights_fragment_begin>
      {
        vec3 wN = inverseTransformDirection( geometryNormal, viewMatrix );
        irradiance += max(shGetIrradianceAt( wN, uSH ), vec3(0.0));
        float sv = uSunMul * statVis(vMyWPos + wN*0.03) * dynVis(vMyWPos + wN*0.05);
        if (sv > 0.001) {
          IncidentLight sl; sl.color = uSunColDyn * sv; sl.direction = normalize((viewMatrix*vec4(uSunDir,0.0)).xyz); sl.visible = true;
          RE_Direct( sl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        }
        if (uFlashCol.r > 0.0) {
          vec3 fl = uFlashPos - vMyWPos; float fd = length(fl);
          IncidentLight fli; fli.color = uFlashCol * PI / (1.0 + fd*fd); fli.direction = normalize((viewMatrix*vec4(fl/fd,0.0)).xyz); fli.visible = true;
          RE_Direct( fli, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
        }
      }`)
      .replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
  };
  mat.customProgramCacheKey = () => 'dyn1';
  mat.needsUpdate = true;
}

export function makeSH() { return { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }; }
