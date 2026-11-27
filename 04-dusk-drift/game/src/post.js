// 后期管线：环境光遮蔽（预渲染深度 → GTAO，只压暗环境光）→ 时域抗锯齿 → 动态模糊 → 景深 → 辉光 → AgX 色调映射 → 锐化 → 调色 / 色散 / 暗角 / 颗粒
import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, uniform, vec2, vec3, vec4, float, int, mix, smoothstep, screenUV, screenCoordinate, renderOutput, convertToTexture, dot, pow, cos, length, time, fract, sin, max, min, saturate, interleavedGradientNoise, Fn, Loop, context, builtinAOContext } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { PASS } from './materials.js';

export function setupPost(renderer, scene, camera, quality) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const U = {
    blur: uniform(0.9), blurMax: uniform(0.03), bloom: uniform(0.2), focus: uniform(12), focalLen: uniform(6), bokeh: uniform(0),
    vignette: uniform(0.36), grain: uniform(0.028), ca: uniform(0.0011), sat: uniform(1.1), contrast: uniform(0.66), warmth: uniform(1), fade: uniform(1),
    ao: uniform(1), sharp: uniform(1.0), toe: uniform(0.025),
  };
  const scenePass = pass(scene, camera);
  const sceneMRT = mrt({ output, velocity });
  // 速度缓冲也按材质自己的混合方式写入：不透明物体照常覆盖；烟雾等透明特效输出 alpha=0 的速度，等于不写
  sceneMRT.setBlendMode('velocity', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);
  const col = scenePass.getTextureNode('output'), depth = scenePass.getTextureNode('depth'), vel = scenePass.getTextureNode('velocity');
  // 环境光遮蔽：先用半分辨率只画一遍深度，算出遮蔽后在正式那一遍里只乘到环境光上（阳光直射处不会被压脏）
  let prePass = null, aoPass = null;
  if (quality.ao > 0) {
    // 预渲染用一台独立的相机（每帧从主相机同步）：引擎按"场景 + 相机"共用绘制列表，嵌套渲染时同一台相机会互相覆盖
    const preCam = camera.clone(); preCam.matrixAutoUpdate = false; preCam.matrixWorldAutoUpdate = false;
    preCam.layers.mask = 0; preCam.layers.enable(0); preCam.layers.enable(1); preCam.layers.enable(4);        // 草丛（第 3 层）不参与
    prePass = pass(scene, preCam);
    prePass.setMRT(mrt({ output: vec4(0, 0, 0, 1) }));
    prePass.setResolutionScale(quality.ao);
    prePass.transparent = false;                                         // 烟雾、玻璃等透明物体不参与
    prePass.contextNode = context({ getAO: (inputNode) => inputNode });  // 预渲染这一遍自己不采样遮蔽贴图
    const runPre = prePass.updateBefore.bind(prePass);
    prePass.updateBefore = (frame) => {
      preCam.near = camera.near; preCam.far = camera.far; preCam.fov = camera.fov; preCam.aspect = camera.aspect;
      preCam.projectionMatrix.copy(camera.projectionMatrix); preCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      preCam.matrixWorld.copy(camera.matrixWorld); preCam.matrixWorldInverse.copy(camera.matrixWorldInverse); preCam.position.copy(camera.position); preCam.quaternion.copy(camera.quaternion);
      const ls = (PASS.csm && PASS.csm.lights) || []; for (const l of ls) l.shadow.autoUpdate = false;
      PASS.pre = true;
      try { return runPre(frame); } finally { PASS.pre = false; for (const l of ls) l.shadow.autoUpdate = true; }
    };
    aoPass = ao(prePass.getTextureNode('depth'), null, preCam);
    aoPass.resolutionScale = quality.ao; aoPass.radius.value = 0.85; aoPass.thickness.value = 1.3; aoPass.distanceExponent.value = 1.3; aoPass.scale.value = 1.15;
    aoPass.samples.value = quality.aoSamples || 10; aoPass.useTemporalFiltering = !!quality.traa;
    const aoVal = aoPass.getTextureNode().sample(screenUV).r;
    scenePass.contextNode = builtinAOContext(mix(float(1), aoVal, U.ao));
  }
  const traaNode = quality.traa ? traa(col, depth, vel, camera) : null;
  // 两条链：比赛用（无景深）与电影机位用（带景深），按需切换
  const blooms = [];
  const chain = (withDof) => {
    let node = traaNode || col;
    if (quality.motionBlur > 0) {
      const src = convertToTexture(node), N = quality.motionBlur;
      node = Fn(() => {
        const v0 = vel.sample(screenUV).xy.mul(U.blur), len = length(v0).max(1e-6);
        const v = v0.mul(min(float(1), U.blurMax.div(len)));                           // 限制拖影最大长度
        const jit = interleavedGradientNoise(screenCoordinate.xy.add(fract(time.mul(13.7)).mul(64))).sub(0.5);
        const acc = vec4(0).toVar();
        Loop({ start: int(0), end: int(N), type: 'int', condition: '<' }, ({ i }) => {
          const t = float(i).add(0.5).add(jit).div(N).sub(0.5);
          acc.addAssign(src.sample(screenUV.add(v.mul(t))));
        });
        return acc.div(N);
      })();
    }
    if (withDof) node = dof(node, scenePass.getViewZNode(), U.focus, U.focalLen, U.bokeh);
    if (quality.bloom) { const bl = bloom(node, 1, 0.45, 2.2); blooms.push(bl); node = node.add(bl.mul(U.bloom).mul(vec3(1.0, 0.86, 0.70))); }
    // 色调映射 + sRGB（之后在显示空间里调色，对应影片里 ffmpeg 那条链）
    node = renderOutput(node, THREE.AgXToneMapping, THREE.SRGBColorSpace);
    if (quality.sharpen) node = sharpen(node, U.sharp);                 // 补回时域抗锯齿抹掉的细节（0 最锐，2 不锐化）
    const src = convertToTexture(node);
    const c = screenUV.sub(0.5), r2 = dot(c, c);
    const samp = (k) => src.sample(c.mul(float(1).add(r2.mul(k))).add(0.5));
    let g = vec3(samp(U.ca.mul(-1).sub(0.004)).r, samp(float(-0.004)).g, samp(U.ca.sub(0.004)).b);   // 轻微桶形畸变 + 色散
    const warm = mix(vec3(1, 1, 1), vec3(1.035, 1.0, 0.955), U.warmth);
    g = g.mul(warm);
    const l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    const ws = float(1).sub(l).pow(2), wh = l.pow(2), wm = float(1).sub(ws).sub(wh);
    g = g.add(vec3(-0.012, 0.0, 0.02).mul(ws).add(vec3(0.014, 0.003, -0.016).mul(wm)).add(vec3(0.022, 0.006, -0.028).mul(wh)).mul(U.warmth));
    const gc = saturate(g), s3 = gc.mul(gc).mul(float(3).sub(gc.mul(2)));
    g = mix(gc, s3, U.contrast).pow(vec3(0.975));
    g = max(g.sub(U.toe), 0).div(float(1).sub(U.toe));                 // 压一点暗部，去掉灰蒙蒙的底
    const l2 = dot(g, vec3(0.2126, 0.7152, 0.0722)); g = mix(vec3(l2), g, U.sat);
    const rr = length(c.mul(vec2(1.0, 0.72))).mul(1.62);
    g = g.mul(pow(cos(rr.mul(U.vignette).min(1.5)), 4));
    const n = fract(sin(dot(screenUV.add(fract(time.mul(7.13))), vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
    g = g.add(n.mul(U.grain).mul(float(1.15).sub(l2)));
    return vec4(g.mul(U.fade), 1);
  };
  const outGame = chain(false), outCine = quality.dof ? chain(true) : outGame;
  pipeline.outputColorTransform = false;
  pipeline.outputNode = outGame;
  let cine = false;
  const setCinematic = (on) => { on = on && quality.dof; if (on === cine) return; cine = on; pipeline.outputNode = on ? outCine : outGame; pipeline.needsUpdate = true; };
  return { pipeline, U, scenePass, traaNode, setCinematic, prePass, aoPass, blooms };
}
