// 引擎外壳自测：几根方柱当石峰、一个球当角色。各模块的测试页照这个写。
import * as THREE from 'three';
import { createApp } from '../app.js';
import { SCENE_DEPTH_GLSL } from '../common.js';

const app = await createApp();
const rock = new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.95 });
const rng = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (let i = 0; i < 60; i++) {
  const h = 120 + rng() * 260, r = 14 + rng() * 26;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 12), rock);
  m.position.set((rng() - 0.5) * 1800, h / 2 - 40, -80 - rng() * 1600);
  m.castShadow = m.receiveShadow = true; app.scene.add(m);
}
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshStandardMaterial({ color: 0xb8742a, roughness: 0.6 }));
ball.position.set(0, 112.8, 0); ball.castShadow = true; app.scene.add(ball);
// 透明层示例：一个用场景深度做遮挡的发光环
const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.25, 12, 64), new THREE.ShaderMaterial({
  uniforms: { ...app.fx.uniforms }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `varying float vDist; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: SCENE_DEPTH_GLSL + `varying float vDist; void main(){ if (vDist > sceneViewDist(gl_FragCoord.xy)) discard; gl_FragColor = vec4(vec3(1.0,0.75,0.3)*3.0, 1.0); }`,
}));
ring.position.set(0, 114, -40); app.sceneFx.add(ring);
app.onUpdate((dt, t) => { ball.position.y = 112.8 + Math.sin(t * 2) * 0.2; });
await app.start();
