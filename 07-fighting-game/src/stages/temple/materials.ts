import * as THREE from 'three';
import { NOISE } from './glsl';

export interface SnowyOpts {
  color: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** 朝上的面积雪多少（0..1） */
  snow?: number;
  /** 世界坐标噪声做的脏污、色差强度 */
  grime?: number;
  /** 红漆剥落：露出底下的旧木头 */
  peel?: boolean;
  /** 院墙：剥落的地方露出砖，墙根返潮发暗，墙帽下面往下流的水渍 */
  brick?: boolean;
  /** 已经有贴图的模型（Tripo 出的），只加顶面积雪，不改底色 */
  keepMap?: boolean;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
}

/** 场景里大部分硬表面用的材质：标准材质 + 世界坐标噪声的色差和脏污 + 朝上的面盖雪。 */
export function snowyMaterial(o: SnowyOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color, roughness: o.roughness ?? 0.8, metalness: o.metalness ?? 0,
    map: o.map ?? null, normalMap: o.normalMap ?? null, roughnessMap: o.roughnessMap ?? null,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1, side: o.side ?? THREE.FrontSide,
  });
  patchSnow(m, o);
  return m;
}

/** 给已有的标准材质加上世界坐标脏污和顶面积雪（Tripo 模型的材质用 keepMap: true，只加雪）。 */
export function patchSnow(m: THREE.MeshStandardMaterial, o: Omit<SnowyOpts, 'color'>) {
  const snow = o.snow ?? 0.8, grime = o.grime ?? 0.5;
  const key = `snowy-${snow}-${grime}-${o.peel ? 1 : 0}-${o.keepMap ? 1 : 0}-${o.brick ? 1 : 0}`;
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWPos = (modelMatrix * wp).xyz; }`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float n1 = fbm3d(vWPos * 1.3);
          float n2 = vnoise3(vWPos * 7.0);
          ${o.keepMap ? '' : `
          diffuseColor.rgb *= mix(1.0, 0.62 + 0.62 * n1, ${grime.toFixed(3)});
          // 往下流的水渍
          diffuseColor.rgb *= 1.0 - ${(grime * 0.25).toFixed(3)} * smoothstep(0.55, 0.8, vnoise(vec2(vWPos.x * 3.0 + vWPos.z * 3.0, vWPos.y * 0.25)));`}
          ${o.peel ? `
          float peel = smoothstep(0.48, 0.56, fbm3d(vWPos * vec3(2.2, 0.7, 2.2) + 3.0) + n2 * 0.08);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.07, 0.055) * (0.7 + 0.6 * n2), peel);
          roughnessFactor = mix(roughnessFactor, 0.9, peel);` : ''}
          ${o.brick ? `
          {
            // 墙面：大块的灰泥剥落，露出青砖（错缝），墙根一圈返潮，墙帽下面一道道水渍
            vec2 wp2 = vec2(vWPos.x + vWPos.z, vWPos.y);
            float fall = smoothstep(0.52, 0.58, fbm3d(vec3(wp2 * vec2(0.55, 0.9), 2.0)) + n2 * 0.05 - 0.1 * smoothstep(1.0, 2.6, vWPos.y));
            vec2 bu = wp2 / vec2(0.42, 0.14);
            bu.x += step(1.0, mod(floor(bu.y), 2.0)) * 0.5;
            vec2 bf = fract(bu);
            float mortar = 1.0 - smoothstep(0.0, 0.06, min(min(bf.x, 1.0 - bf.x) * 0.42 / 0.14, min(bf.y, 1.0 - bf.y)));
            vec3 brickC = vec3(0.16, 0.16, 0.17) * (0.75 + 0.5 * hash21(floor(bu)));
            brickC = mix(brickC, vec3(0.06, 0.06, 0.065), mortar);
            // 剥落边缘一圈白灰（灰泥层的厚度）
            float rim = smoothstep(0.47, 0.52, fbm3d(vec3(wp2 * vec2(0.55, 0.9), 2.0)) + n2 * 0.05 - 0.1 * smoothstep(1.0, 2.6, vWPos.y)) * (1.0 - fall);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.28, 0.25), rim * 0.55);
            diffuseColor.rgb = mix(diffuseColor.rgb, brickC, fall);
            // 墙根返潮
            float damp = 1.0 - smoothstep(0.4, 1.4 + n1 * 0.6, vWPos.y);
            diffuseColor.rgb *= 1.0 - 0.45 * damp;
            // 水渍：从墙帽往下的竖条
            float streak = smoothstep(0.55, 0.85, vnoise(vec2(wp2.x * 5.0, wp2.y * 0.35 + 3.0))) * smoothstep(0.5, 2.8, vWPos.y);
            diffuseColor.rgb *= 1.0 - 0.35 * streak;
            roughnessFactor = mix(roughnessFactor, 0.95, fall);
            // 砖缝和剥落边的凹凸
            normal = normalize(normal + (viewMatrix * vec4(0.0, (bf.y < 0.5 ? -1.0 : 1.0) * mortar * fall * 0.35, 0.0, 0.0)).xyz);
          }` : ''}
          float up = wn.y + (n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.15;
          float sn = smoothstep(0.42, 0.7, up) * ${snow.toFixed(3)};
          // 竖直面的底部也挂一点雪（风吹上去的）
          sn = max(sn, smoothstep(0.35, 0.0, vWPos.y + (n1 - 0.5) * 0.4) * ${(snow * 0.6).toFixed(3)} * smoothstep(0.2, -0.2, abs(wn.y) - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.70, 0.74, 0.80) * (0.92 + 0.08 * n2), sn);
          roughnessFactor = mix(roughnessFactor, 0.85, sn);
          metalnessFactor *= 1.0 - sn;
          normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, sn * 0.5));
        }`);
  };
  m.customProgramCacheKey = () => key;
}
