// 实时环境反射探针：在镜头跟拍的那台车的位置拍一张立方体贴图（每帧只更新一两个面），
// 让车漆、车窗、轮毂能照出护栏、路肩、树和别的车，而不是只有天空
import * as THREE from 'three/webgpu';
import { cubeTexture, pmremTexture, uniform, float, mix, smoothstep, oneMinus, reflectVector } from 'three/tsl';
import { PROBE } from './materials.js';

class ProbeEnvNode extends THREE.Node {
  static get type() { return 'ProbeEnvNode'; }
  constructor(cubeTex, envTex, size, U) { super('vec3'); this.cubeTex = cubeTex; this.global = pmremTexture(envTex); this.size = size; this.U = U; }
  setup(builder) {
    const ctx = builder.context;
    const dir = ctx.getUV ? ctx.getUV(this, builder) : reflectVector;              // 世界空间的反射方向（漫反射时是法线方向）
    const rough = ctx.getTextureLevel ? ctx.getTextureLevel(this) : float(0);      // 粗糙度；漫反射那一路固定为 1
    // 探针贴图不生成模糊层级（每帧生成一次要 3 ms），所以只给光滑的表面用：清漆、玻璃、镀铬；粗糙表面和漫反射仍用整体天空光
    const p = cubeTexture(this.cubeTex, dir).rgb;
    const w = oneMinus(smoothstep(0.1, 0.36, rough)).mul(this.U.mix);
    return mix(this.global.rgb, p, w);
  }
}

export function setupProbe(renderer, scene, env, quality) {
  const size = quality.probe | 0;
  if (!(size > 0)) return null;
  const rt = new THREE.CubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cam = new THREE.CubeCamera(0.3, 900, rt);
  cam.coordinateSystem = renderer.coordinateSystem; cam.updateCoordinateSystem();
  for (const c of cam.children) { c.layers.set(0); c.layers.enable(5); }           // 只拍第 0、5 层：不含草丛、粒子、轮胎墙，树用公告板
  const U = { mix: uniform(1) };
  const envNode = new ProbeEnvNode(rt.texture, env.envTex, size, U);
  let face = 0, primed = false;
  // entries：所有参赛车。拍探针时全部隐藏——车身材质自己在采样这张贴图，不能同时往里画
  const update = (pos, entries, n = 1) => {
    cam.position.copy(pos); cam.updateMatrixWorld(true);
    const prevRT = renderer.getRenderTarget(), prevFace = renderer.getActiveCubeFace(), prevMip = renderer.getActiveMipmapLevel();
    const ls = (env.csm && env.csm.lights) || []; for (const l of ls) l.shadow.autoUpdate = false;
    for (const e of entries) e.view.root.visible = false;
    PROBE.on.value = 1;
    try {
      const k = primed ? n : 6;
      for (let i = 0; i < k; i++) { renderer.setRenderTarget(rt, face); renderer.render(scene, cam.children[face]); face = (face + 1) % 6; }
      primed = true;
    } finally {
      PROBE.on.value = 0; for (const e of entries) e.view.root.visible = true; for (const l of ls) l.shadow.autoUpdate = true;
      renderer.setRenderTarget(prevRT, prevFace, prevMip);
    }
  };
  return { rt, cam, U, envNode, update, reset: () => { primed = false; } };
}
