// 高速时掠过身边的气流丝：留在世界空间里的细长亮线，飞得越快越长越明显，增强速度感。
import * as THREE from 'three';
import { SCENE_DEPTH_GLSL } from './common.js';

export function createWindFx(app, count = 140) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { seed[i] = Math.random(); pos[i * 3 + 1] = -1e6; }
  const aPos = new THREE.InstancedBufferAttribute(pos, 3); aPos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...app.fx.uniforms, uDir: { value: new THREE.Vector3(1, 0, 0) }, uLen: { value: 4 }, uAlpha: { value: 0 } },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute float iSeed; uniform vec3 uDir, uCamPos; uniform float uLen;
      varying vec2 vUv; varying float vDist; varying float vSeed;
      void main() {
        vec3 toCam = normalize(uCamPos - iPos);
        vec3 side = normalize(cross(uDir, toCam));
        float len = uLen * (0.5 + iSeed);
        vec3 wp = iPos + uDir * (position.y - 0.5) * len + side * position.x * (0.012 + 0.02 * iSeed);
        vec4 mv = viewMatrix * vec4(wp, 1.0); vDist = -mv.z; vUv = position.xy + vec2(0.5, 0.0); vSeed = iSeed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: SCENE_DEPTH_GLSL + /* glsl */`
      uniform float uAlpha; varying vec2 vUv; varying float vDist; varying float vSeed;
      void main() {
        if (vDist > sceneViewDist(gl_FragCoord.xy)) discard;
        float a = sin(vUv.y * 3.14159) * (1.0 - abs(vUv.x - 0.5) * 2.0);
        a *= uAlpha * (0.35 + 0.65 * vSeed) * smoothstep(1.2, 5.0, vDist) * (1.0 - smoothstep(60.0, 150.0, vDist));
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * a * 1.6, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.name = 'WindFx';
  const _rel = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();

  return {
    mesh,
    update(dt, s) {
      const alpha = THREE.MathUtils.smoothstep(s.speed, 62, 115) * 0.26 * (s.fxGain ?? 1);
      mat.uniforms.uAlpha.value += (alpha - mat.uniforms.uAlpha.value) * Math.min(1, dt * 4);
      if (mat.uniforms.uAlpha.value < 0.004) { mesh.visible = false; return; }
      mesh.visible = true;
      _f.copy(s.forward); mat.uniforms.uDir.value.copy(_f); mat.uniforms.uLen.value = Math.max(1.2, s.speed * 0.028);
      _r.set(-_f.z, 0, _f.x).normalize(); _u.crossVectors(_r, _f).normalize();
      for (let i = 0; i < count; i++) {
        _rel.set(pos[i * 3] - s.position.x, pos[i * 3 + 1] - s.position.y, pos[i * 3 + 2] - s.position.z);
        const a = _rel.dot(_f); const rad = Math.sqrt(Math.max(0, _rel.lengthSq() - a * a));
        if (a < -45 || a > 190 || rad > 34) {
          const ang = Math.random() * Math.PI * 2, r = 2.2 + Math.pow(Math.random(), 0.7) * 26, ahead = (a < -45 ? 110 : 20) + Math.random() * 70;
          pos[i * 3] = s.position.x + _f.x * ahead + (_r.x * Math.cos(ang) + _u.x * Math.sin(ang)) * r;
          pos[i * 3 + 1] = s.position.y + 0.8 + _f.y * ahead + (_r.y * Math.cos(ang) + _u.y * Math.sin(ang)) * r;
          pos[i * 3 + 2] = s.position.z + _f.z * ahead + (_r.z * Math.cos(ang) + _u.z * Math.sin(ang)) * r;
        }
      }
      aPos.needsUpdate = true;
    },
  };
}
