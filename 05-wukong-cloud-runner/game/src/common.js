// 全工程共用的约定和常量。
// 坐标系：three.js 右手系，Y 向上，单位 = 米。影片（Blender）里的 (x, y, z) 对应这里的 (x, z, -y)。
import * as THREE from 'three';

export const bl = (x, y, z) => new THREE.Vector3(x, z, -y);       // Blender 坐标 → three 坐标

// 太阳：与影片一致（仰角 13°，方位角从 +X 朝 +Y 转 25°）。SUN_DIR 指向太阳。
export const SUN_EL_DEG = 13.0, SUN_AZ_DEG = 25.0;
const _el = THREE.MathUtils.degToRad(SUN_EL_DEG), _az = THREE.MathUtils.degToRad(SUN_AZ_DEG);
export const SUN_DIR = bl(Math.cos(_el) * Math.cos(_az), Math.cos(_el) * Math.sin(_az), Math.sin(_el)).normalize();

// 灯光强度（线性、场景参考）。模块里不要自己写死曝光，统一用这里的值；最终曝光/调色在 post 里做。
export const SUN_COLOR = new THREE.Color(1.0, 0.80, 0.58);          // 低角度太阳的暖色
export const SUN_INTENSITY = 6.0;
export const SKY_INTENSITY = 1.0;                                    // 环境光（天空 IBL）倍率

// 世界高度基准（three 的 Y）：云海顶面大约在这个高度，巡航高度在云海之上。
export const CLOUD_TOP_Y = 96.0;      // 云海主体顶面（由云模块最终确定，改这里要同步通知）
export const CRUISE_Y = 112.0;        // 影片里悟空的飞行高度

export const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const SHOT_MODE = PARAMS.has('shot');
export const num = (k, d) => (PARAMS.has(k) ? parseFloat(PARAMS.get(k)) : d);
export const vec = (k, d) => {
  if (!PARAMS.has(k)) return d.clone();
  const a = PARAMS.get(k).split(',').map(parseFloat);
  return new THREE.Vector3(a[0], a[1], a[2]);
};

// 画质档位
export const QUALITY_PRESETS = {
  low: { scale: 0.75, msaa: 0, shadow: 1024, cloudSteps: 28, furShells: 10 },
  high: { scale: 1.0, msaa: 4, shadow: 2048, cloudSteps: 48, furShells: 18 },
  ultra: { scale: 1.5, msaa: 4, shadow: 4096, cloudSteps: 72, furShells: 28 },
};
export const QUALITY_NAME = PARAMS.get('q') || 'high';
export const QUALITY = QUALITY_PRESETS[QUALITY_NAME] || QUALITY_PRESETS.high;

// 透明/体积物体（筋斗云、尾迹、光环等）在大气合成之后单独画，没有深度缓冲可用，
// 所以它们的着色器要自己拿场景深度做遮挡。把下面这段贴进片元着色器，uniform 用 app.fx.uniforms 里的同名对象。
export const SCENE_DEPTH_GLSL = /* glsl */`
uniform sampler2D tSceneDepth;      // 不透明场景的深度图
uniform vec2 uResolution;           // 渲染分辨率（像素）
uniform float uCamNear, uCamFar;
float sceneViewDist(vec2 fragCoord) {           // 该像素处不透明场景到相机平面的距离（米，正值）
  float d = texture2D(tSceneDepth, fragCoord / uResolution).x;
  float z = d * 2.0 - 1.0;
  return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - z * (uCamFar - uCamNear));
}
`;
