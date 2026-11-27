import * as THREE from 'three';
import { NOISE } from './glsl';
import type { Shared } from './shared';

/** 月亮方向：画面左上，高度角约 11 度，从大殿屋顶左侧露出来。 */
export const MOON_DIR = new THREE.Vector3(-0.344, 0.182, -0.921).normalize();

/**
 * 天空球：夜空渐变、月亮和月晕、薄云、远山三层剪影（各层下半截被山谷里的雾吃掉）。
 * 远山离得够远，没有视差，直接按方向画在天空里，不占几何体。
 */
export function createSky(sh: Shared) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sh.uTime, uDim: sh.uDim,
      uMoonDir: { value: MOON_DIR.clone() },
      uHorizon: { value: new THREE.Color(0.036, 0.05, 0.074) },
      uZenith: { value: new THREE.Color(0.004, 0.007, 0.016) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w; // 永远在最远处
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uDim;
      uniform vec3 uMoonDir; uniform vec3 uHorizon; uniform vec3 uZenith;
      varying vec3 vDir;
      ${NOISE}
      float ridge(float a, float f, float o) {
        float n = fbm5(vec2(a * f + o, o * 1.7));
        float r = 1.0 - abs(vnoise(vec2(a * f * 2.3 + o * 3.1, 4.0)) * 2.0 - 1.0);
        return n * 0.75 + r * r * 0.25;
      }
      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        float az = atan(d.x, -d.z);
        float md = dot(d, uMoonDir);

        // 渐变 + 月亮一侧的天光
        vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.42, e));
        float glow = pow(max(md, 0.0), 14.0);
        float glowWide = pow(max(md, 0.0), 3.0);
        col += vec3(0.10, 0.13, 0.19) * glow * 0.55 + vec3(0.018, 0.026, 0.042) * glowWide;

        // 星星（只在高处，大部分被云盖住）
        vec2 sg = vec2(az * 160.0, e * 160.0);
        float st = hash21(floor(sg));
        float star = step(0.996, st) * smoothstep(0.08, 0.3, e) * (0.5 + 0.5 * sin(uTime * 2.0 + st * 60.0));
        col += vec3(0.35, 0.4, 0.5) * star * 0.25;

        // 月亮
        float ang = acos(clamp(md, -1.0, 1.0));
        float R = 0.021;
        float disk = 1.0 - smoothstep(R - 0.0012, R + 0.0006, ang);
        if (disk > 0.0) {
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 tx = normalize(cross(uMoonDir, up)), ty = cross(tx, uMoonDir);
          vec2 m = vec2(dot(d, tx), dot(d, ty)) / R;
          float mare = fbm5(m * 2.2 + 3.0);
          float crat = smoothstep(0.55, 0.75, vnoise(m * 9.0));
          float limb = sqrt(max(0.0, 1.0 - dot(m, m)));
          vec3 mc = vec3(2.2, 2.35, 2.6) * (0.72 + 0.28 * limb) * (1.0 - 0.32 * smoothstep(0.45, 0.7, mare)) * (1.0 - 0.08 * crat);
          col = mix(col, mc, disk);
        }
        col += vec3(0.35, 0.42, 0.55) * pow(max(md, 0.0), 900.0) * 0.6; // 紧贴月亮的光晕

        // 薄云：投到一个虚拟的云层平面上
        vec2 cuv = d.xz / (max(e, 0.0) + 0.09);
        cuv.x += uTime * 0.035;
        float cn = fbm5(cuv * 0.55 + vec2(0.0, 2.0));
        float cn2 = fbm3(cuv * 1.6 + vec2(uTime * 0.02, 0.0));
        float cloud = smoothstep(0.48, 0.82, cn * 0.8 + cn2 * 0.3) * smoothstep(0.0, 0.08, e);
        vec3 cloudCol = mix(vec3(0.018, 0.024, 0.036), vec3(0.16, 0.19, 0.25), glow * 0.9 + glowWide * 0.12);
        col = mix(col, cloudCol, cloud * 0.72);

        // 远山三层：越远越亮越蓝，每层下半截被谷里的雾吃掉
        vec3 mist = uHorizon * 1.25 + vec3(0.006, 0.008, 0.012);
        float h1 = 0.055 + 0.085 * ridge(az, 1.6, 2.0);
        float h2 = 0.028 + 0.06 * ridge(az, 2.9, 7.0);
        float h3 = 0.004 + 0.042 * ridge(az, 5.2, 13.0);
        float aa = 0.0016;
        // 第一层（最远，带一点雪的亮面）
        float snow1 = smoothstep(0.55, 0.8, fbm3(vec2(az * 26.0, e * 60.0))) * smoothstep(h1 - 0.05, h1, e);
        vec3 c1 = mix(vec3(0.03, 0.042, 0.062), vec3(0.075, 0.09, 0.12), snow1 * 0.6 + glowWide * 0.25);
        c1 = mix(c1, mist, smoothstep(h1 - 0.012, h1 - 0.07, e) * 0.85);
        col = mix(col, c1, 1.0 - smoothstep(h1 - aa, h1 + aa, e));
        vec3 c2 = vec3(0.018, 0.026, 0.04);
        c2 = mix(c2, mist * 0.95, smoothstep(h2 - 0.01, h2 - 0.055, e) * 0.9);
        col = mix(col, c2, 1.0 - smoothstep(h2 - aa, h2 + aa, e));
        vec3 c3 = vec3(0.009, 0.013, 0.021);
        c3 = mix(c3, mist * 0.9, smoothstep(h3 - 0.008, h3 - 0.04, e) * 0.9);
        col = mix(col, c3, 1.0 - smoothstep(h3 - aa, h3 + aa, e));
        // 地平线以下：和场景雾同色
        col = mix(col, mist * 0.85, smoothstep(0.0, -0.03, e));

        col *= 1.0 - 0.72 * uDim;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
