// 天空穹顶、太阳、大气高度雾、环境光贴图
import * as THREE from 'three';

const v3 = (a) => `vec3(${a[0].toFixed(4)}, ${a[1].toFixed(4)}, ${a[2].toFixed(4)})`;

// 全局大气参数（线性空间 HDR）
export const ATMOS = {
  sunDir: new THREE.Vector3(-0.60, 0.50, -0.38).normalize(),
  sunColor: [1.0, 0.80, 0.58],
  sunIntensity: 9.0,
  fogColor: [0.50, 0.56, 0.66],       // 背光方向的雾色
  fogSunColor: [1.25, 0.86, 0.52],    // 朝向太阳的雾色
  fogDensity: 0.0032,
  fogFalloff: 0.022,
  fogBase: 0.0,
  skyZenith: [0.10, 0.25, 0.60],
  skyMid: [0.30, 0.50, 0.80],
  groundBounce: [0.36, 0.27, 0.17],
  skyE: [0.9, 1.3, 2.0],     // 天光在水平面上的辐照度（烘焙 GI 用）
  hdri: null,                // 载入实拍天空后由 hdri.js 填充
};

// 覆盖 three 的雾着色器片段：指数高度雾 + 朝阳方向散射染色
export function installAtmosphereFog() {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWPos;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWPos = cameraPosition + ( mvPosition.xyz * mat3( viewMatrix ) );
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying float vFogDepth;
  varying vec3 vFogWPos;
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec3 fogV = vFogWPos - cameraPosition;
  float fogDist = length( fogV );
  vec3 fogDir = fogV / max( fogDist, 1e-4 );
  float fogFy = fogDir.y; if ( abs( fogFy ) < 1e-3 ) fogFy = 1e-3;
  float fogAmt = fogDensity * exp( - ${ATMOS.fogFalloff.toFixed(4)} * ( cameraPosition.y - ${ATMOS.fogBase.toFixed(2)} ) )
    * ( 1.0 - exp( - ${ATMOS.fogFalloff.toFixed(4)} * fogFy * fogDist ) ) / ( ${ATMOS.fogFalloff.toFixed(4)} * fogFy );
  float fogFactor = 1.0 - exp( - max( fogAmt, 0.0 ) );
  float fogSun = pow( max( dot( fogDir, ${v3(ATMOS.sunDir.toArray())} ), 0.0 ), 4.0 );
  vec3 fogCol = mix( fogColor, fogColor * ${v3(ATMOS.fogSunColor.map((c, i) => c / Math.max(ATMOS.fogColor[i], 1e-3)))}, fogSun );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uEnv;      // 1 = 用于环境贴图（无太阳圆盘）
uniform float uGround;   // 地平线以下的地面反照强度

float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++){ s += a * vn(p); p = r * p * 2.03 + 11.7; a *= 0.5; } return s; }

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = dot(d, uSunDir); float sdp = max(sd, 0.0);
  float yc = clamp(y, 0.0, 1.0);
  vec3 col = mix(${v3(ATMOS.skyMid)}, ${v3(ATMOS.skyZenith)}, pow(yc, 0.55));
  vec3 haze = mix(${v3(ATMOS.fogColor)}, ${v3(ATMOS.fogSunColor)}, pow(sdp, 6.0));
  float hz = pow(1.0 - yc, 5.0);
  col = mix(col, haze, hz);
  // 朝阳方向的暖色散射
  col += vec3(1.0, 0.60, 0.28) * (0.22 * pow(sdp, 8.0) + 0.55 * pow(sdp, 48.0)) * (0.35 + 0.65 * (1.0 - yc));

  // 卷云 / 高积云
  if (y > 0.0) {
    vec2 cuv = d.xz / (y + 0.14) * 0.42 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(cuv * 1.3);
    float n2 = fbm(cuv * 1.3 + uSunDir.xz * 0.11);
    float streak = fbm(vec2(cuv.x * 0.5 + 3.0, cuv.y * 2.6));
    float cl = smoothstep(0.50, 0.82, n * 0.75 + streak * 0.35);
    cl *= smoothstep(0.015, 0.22, y);
    float lit = clamp((n - n2) * 3.5 + 0.55, 0.0, 1.0);
    vec3 cShadow = vec3(0.42, 0.44, 0.52);
    vec3 cLit = vec3(1.25, 1.02, 0.82) + vec3(1.2, 0.7, 0.3) * pow(sdp, 10.0);
    vec3 cc = mix(cShadow, cLit, lit);
    cc = mix(cc, haze * 1.1, pow(1.0 - yc, 6.0));
    col = mix(col, cc, cl * 0.85);
    // 太阳圆盘（被云遮挡）
    if (uEnv < 0.5) {
      float disk = smoothstep(0.99972, 0.99990, sd);
      col += vec3(1.0, 0.86, 0.66) * disk * 90.0 * (1.0 - cl * 0.92);
      col += vec3(1.0, 0.72, 0.42) * pow(sdp, 900.0) * 3.0 * (1.0 - cl * 0.7);
    }
  } else {
    vec3 g = ${v3(ATMOS.groundBounce)} * uGround;
    col = mix(haze, g, smoothstep(0.0, -0.25, y));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const HDR_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform sampler2D tSky; uniform float uRot; uniform float uEnv; uniform float uGround; uniform vec3 uGroundCol; uniform vec3 uHaze; uniform float uGain; uniform vec3 uTiltAxis; uniform float uTilt;
void main(){
  vec3 d = normalize(vDir);
  // 先绕水平轴把视线朝太阳一侧抬高 uTilt（等效于把整张天空压低），再绕 Y 轴对齐方位
  vec3 t = d * cos(uTilt) + cross(uTiltAxis, d) * sin(uTilt) + uTiltAxis * dot(uTiltAxis, d) * (1.0 - cos(uTilt));
  float c = cos(uRot), s = sin(uRot);
  vec3 q = vec3(c * t.x + s * t.z, t.y, -s * t.x + c * t.z);
  vec2 uv = vec2(atan(q.z, q.x) * 0.15915494 + 0.5, asin(clamp(q.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  vec3 col = texture2D(tSky, uv).rgb * uGain;
  col = mix(col, uHaze, smoothstep(0.04, -0.02, q.y));   // 实拍天空自身地平线以下的部分用地平线雾色盖住
  if (uEnv > 0.5) { if (d.y < 0.0) col = mix(col, uGroundCol * uGround, smoothstep(0.0, -0.12, d.y)); }
  else if (d.y < 0.02) col = mix(col, uHaze, smoothstep(0.02, -0.06, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor() {
    const H = ATMOS.hdri;
    this.hdr = !!H;
    this.uniforms = H ? {
      tSky: { value: H.sky }, uRot: { value: H.rot }, uEnv: { value: 0 }, uGround: { value: 1 }, uGain: { value: 1.4 }, uTilt: { value: H.tilt || 0 }, uTiltAxis: { value: H.tiltAxis || new THREE.Vector3(1, 0, 0) },
      uGroundCol: { value: new THREE.Vector3(ATMOS.groundBounce[0], ATMOS.groundBounce[1], ATMOS.groundBounce[2]) },
      uHaze: { value: new THREE.Vector3(ATMOS.fogColor[0], ATMOS.fogColor[1], ATMOS.fogColor[2]) }, uTime: { value: 0 },
    } : {
      uSunDir: { value: ATMOS.sunDir.clone() }, uTime: { value: 0 }, uEnv: { value: 0 }, uGround: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: H ? HDR_FRAG : SKY_FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.mesh.scale.setScalar(900);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
  }

  // 生成两张环境贴图：full（含地面反照，给动态物体）与 skyOnly（下半球全黑，给烘焙了 GI 的静态场景）
  buildEnvironments(renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(this.mesh.geometry, this.material);
    mesh.scale.setScalar(50);
    scene.add(mesh);
    const H = ATMOS.hdri; const visTex = H ? this.uniforms.tSky.value : null;
    if (H) this.uniforms.tSky.value = H.env;
    const visGain = H ? this.uniforms.uGain.value : 1; if (H) this.uniforms.uGain.value = 1;   // 可见天空的亮度增益只是观感调整，不进入环境光
    this.uniforms.uEnv.value = 1;
    this.uniforms.uGround.value = 1;
    const full = pmrem.fromScene(scene, 0, 0.1, 100).texture;
    this.uniforms.uGround.value = 0;
    const skyOnly = pmrem.fromScene(scene, 0, 0.1, 100).texture;
    this.uniforms.uEnv.value = 0;
    this.uniforms.uGround.value = 1;
    if (H) { this.uniforms.tSky.value = visTex; this.uniforms.uGain.value = visGain; }
    pmrem.dispose();
    return { full, skyOnly };
  }
}
