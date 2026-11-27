// 筋斗云 + 尾流测试页：一个占位小人踩着云沿带转弯的路径飞。
// 参数：?view=chase|side|front|far|top|tele（相机；tele=长焦掠过机位）  ?speed=110（巡航速度，默认 42）  ?boost=1（全程加速状态）
//       ?atmo=0 / ?jdy=0 / ?trail=0 / ?body=0（关模块，对比耗时）  ?bench2=40（同步测帧耗时）  ?rep=9（多画几遍放大耗时差）  ?alt=140（飞高一点）
// 路径：朝太阳方向起飞 42 m/s → t=2.5~4.5 s 左转约 57° → t=5~6.5 s 加速到 70 m/s（boost 0→1）。
import * as THREE from 'three';
import { createApp } from '../app.js';
import { PARAMS, num, SUN_DIR } from '../common.js';
import { createAtmosphere } from '../atmosphere.js';
import { createJDY } from '../jdy.js';

const app = await createApp();
const rock = new THREE.MeshStandardMaterial({ color: 0x3a342d, roughness: 0.95 });
const rng = (() => { let s = 5; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (let i = 0; i < 90; i++) {
  const h = 150 + rng() * 300, r = 12 + rng() * 30;
  const x = (rng() - 0.5) * 3200, z = (rng() - 0.5) * 3200;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 14), rock);
  m.position.set(x, h / 2 - 40, z); m.castShadow = m.receiveShadow = true; app.scene.add(m);
}
let atmo = null, jdy = null;
if (num('atmo', 1)) { atmo = createAtmosphere(app); app.setAtmosphere(atmo); }
if (num('jdy', 1)) {
  jdy = createJDY(app); app.sceneFx.add(jdy.group);
  jdy.group.traverse(o => { if (o.name === 'JDY_Trail' && !num('trail', 1)) o.visible = false; if (o.name === 'JDY_Body' && !num('body', 1)) o.visible = false; });   // ?trail=0 / ?body=0 单独关掉一部分
  // ?rep=9：把云体和尾流各多画 8 遍，(rep=9 的耗时 − rep=1 的耗时) / 8 = 画一遍的耗时。机器上有别的程序抢 GPU、单次差值淹没在抖动里时用
  const parts = []; jdy.group.traverse(o => { if (o.name === 'JDY_Trail' || o.name === 'JDY_Body') parts.push(o); });
  for (let i = 1; i < num('rep', 1); i++) for (const o of parts) o.parent.add(o.clone());
}

// 占位小人（不透明，脚底在原点）
const hero = new THREE.Group();
const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.7 });
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.75, 6, 16), skin); torso.position.y = 0.95;
const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.45, 4, 10), skin); legL.position.set(-0.16, 0.33, 0);
const legR = legL.clone(); legR.position.x = 0.16;
const headM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), skin); headM.position.y = 1.72;
hero.add(torso, legL, legR, headM); hero.traverse(o => { o.castShadow = true; }); app.scene.add(hero);

const state = { position: new THREE.Vector3(-150, 112, 60), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), speed: 42, boost: 0, sink: num('sink', 0.3) };   // ?sink=0.3：脚底陷进云里多深
const sunXZ = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize();
let yaw = Math.atan2(-sunXZ.z, sunXZ.x);                     // 航向角：forward = (cos, 0, -sin)
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), holder = new THREE.Object3D();
const view = PARAMS.get('view') || 'chase';
const farCam = state.position.clone().add(new THREE.Vector3(150, 30, -220));
const teleCam = new THREE.Vector3();
let teleSet = false, aglY = null, flipLift = 0;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
app.onUpdate((dt, t) => {
  const turn = 0.5 * sm(2.3, 2.8, t) * (1 - sm(4.2, 4.7, t));
  yaw += turn * dt;
  // ?boostAt=3：第 3 秒开始加速（0.6 秒内 boost 0→1，速度从 ?speed 升到 ?speedB，默认 110）；不给就是原来的第 5~6.5 秒
  const bAt = num('boostAt', -1);
  state.boost = bAt >= 0 ? sm(bAt, bAt + 0.6, t) : Math.max(num('boost', 0), sm(5.0, 6.5, t));
  state.speed = bAt >= 0 ? num('speed', 45) + (num('speedB', 110) - num('speed', 45)) * state.boost : num('speed', 42) + (num('speed', 0) ? 0 : 28 * state.boost);
  // ?jolt=2：第 2 秒那一帧 boost 直接从 0 跳到 1、速度一帧内 +70 m/s（最坏的输入突变，检查云体会不会被包围盒裁出直边）
  const jolt = num('jolt', -1);
  if (jolt >= 0 && t >= jolt) { state.boost = 1; state.speed = num('speed', 45) + 70; }
  // ?flipAt=2：第 2 秒开始翻一个筋斗（0.9 秒；人腾空 1.25 m 再落回，state.flip = 0..1 进度）
  const fAt = num('flipAt', -1), fp = fAt >= 0 ? Math.min(1, Math.max(0, (t - fAt) / 0.9)) : 0;
  state.flip = fp < 1 ? fp : 0; flipLift = 1.25 * Math.sin(Math.PI * fp);
  fwd.set(Math.cos(yaw), 0, -Math.sin(yaw));
  state.velocity.copy(fwd).multiplyScalar(state.speed);
  state.position.addScaledVector(state.velocity, dt);
  state.position.y = num('alt', 112) + Math.sin(t * 0.9) * 0.6;          // ?alt=140：飞高一点，让尾流衬在天空/石峰前面好检查
  // ?agl=3：贴着云海飞，离当地云顶 3 m（平滑地跟着云顶起伏）——看云海尾波用
  if (num('agl', -1) >= 0 && atmo) {
    const want = atmo.cloudHeightAt(state.position.x, state.position.z) + num('agl', 3);
    aglY = aglY === null ? want : aglY + (want - aglY) * Math.min(1, dt * 1.2);
    state.position.y = aglY;
  }
  state.forward = fwd;
  if (atmo && atmo.update) atmo.update(dt, state);                         // 云海尾波
  holder.position.copy(state.position); holder.up.set(0, 1, 0); holder.lookAt(tmp.copy(state.position).sub(fwd));     // 本地 -Z 朝前
  holder.rotateZ(turn * 0.7);                                                                                        // 转弯时压一点坡度
  state.quaternion.copy(holder.quaternion);
  hero.quaternion.copy(state.quaternion);
  hero.position.copy(state.position).addScaledVector(tmp.set(0, 1, 0).applyQuaternion(state.quaternion), flipLift - state.sink);   // 和游戏里一样：角色整体下沉 sink，position 留在云顶面上
  right.crossVectors(fwd, up).normalize();
  if (view === 'tele' && !teleSet && t >= num('t', 2) - 0.75) { teleSet = true; teleCam.copy(state.position).addScaledVector(fwd, state.speed * 0.75).addScaledVector(right, 85).addScaledVector(up, 22); app.camera.fov = 9; app.camera.updateProjectionMatrix(); }   // 长焦：侧上方 85 m，悟空从镜头前掠过
  const cam = app.camera, p = state.position;
  if (view === 'chase') { cam.position.copy(p).addScaledVector(fwd, -7.5).addScaledVector(up, 2.6); cam.lookAt(tmp.copy(p).addScaledVector(fwd, 6).addScaledVector(up, 0.8)); }
  else if (view === 'side') { const s = num('side', 1); cam.position.copy(p).addScaledVector(right, 9 * s).addScaledVector(up, 1.0).addScaledVector(fwd, -1.5); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -1.5).addScaledVector(up, 0.2)); }
  else if (view === 'front') { cam.position.copy(p).addScaledVector(fwd, 8).addScaledVector(up, -1.8).addScaledVector(right, 1.5); cam.lookAt(tmp.copy(p).addScaledVector(up, 0.6)); }
  else if (view === 'top') { cam.position.copy(p).addScaledVector(up, 70).addScaledVector(fwd, -40); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -40)); }
  else if (view === 'chase6') { cam.position.copy(p).addScaledVector(fwd, -5.2).addScaledVector(up, 3.0); cam.lookAt(tmp.copy(p).addScaledVector(fwd, 8).addScaledVector(up, 0.6)); }   // 正后上方 6 m
  else if (view === 'tele') { cam.position.copy(teleCam); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -6)); }
  else if (view === 'aerial') { cam.position.copy(p).addScaledVector(fwd, -40).addScaledVector(up, 16); cam.lookAt(tmp.copy(p).addScaledVector(fwd, 30)); }       // 游戏里的航拍机位
  else if (view === 'topWake') { cam.position.copy(p).addScaledVector(up, num('h', 150)).addScaledVector(fwd, -90); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -90)); }   // 高空俯视身后的尾波
  // 加速时的远机位（和游戏里加速追尾镜头一样：身后 62 m、上方 15 m、广角）/ 侧远景 / 正面长焦特写
  else if (view === 'boostChase') { cam.position.copy(p).addScaledVector(fwd, -num('back', 62)).addScaledVector(up, num('upc', 15)).addScaledVector(right, 3.5); cam.lookAt(tmp.copy(p).addScaledVector(fwd, 60).addScaledVector(up, 2.5)); }   // ?back=34&upc=9.5 可改机位
  else if (view === 'sideFar') { cam.position.copy(p).addScaledVector(right, 75 * num('side', 1)).addScaledVector(up, 14).addScaledVector(fwd, -45); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -45)); }
  else if (view === 'hero') { cam.position.copy(p).addScaledVector(fwd, 5.5).addScaledVector(up, 1.0).addScaledVector(right, 2.3); cam.lookAt(tmp.copy(p).addScaledVector(up, 1.02)); }
  // 脚部近景三个方向（看人陷在云里的样子）：追尾 / 侧面 / 正面
  else if (view === 'feetChase') { cam.position.copy(p).addScaledVector(fwd, -3.6).addScaledVector(up, 1.7).addScaledVector(right, 0.5); cam.lookAt(tmp.copy(p).addScaledVector(up, 0.45)); }
  else if (view === 'feetSide') { cam.position.copy(p).addScaledVector(right, 3.6 * num('side', 1)).addScaledVector(up, 0.9).addScaledVector(fwd, 0.3); cam.lookAt(tmp.copy(p).addScaledVector(up, 0.4)); }
  else if (view === 'feetFront') { cam.position.copy(p).addScaledVector(fwd, 3.4).addScaledVector(up, 1.0).addScaledVector(right, 1.1); cam.lookAt(tmp.copy(p).addScaledVector(up, 0.45)); }
  else if (view === 'far') { cam.position.copy(farCam); cam.lookAt(tmp.copy(p).addScaledVector(fwd, -25)); }
  app.shadowFocus.copy(p);
  if (jdy) jdy.update(dt, state);
});
if (jdy && num('trailScale', 1) !== 1) { const r = jdy.uniforms.trail.uRadius.value, k = num('trailScale', 1); r.x *= k; r.y *= k; }   // z 是长粗的时间，不缩放
window.__APP = app; window.__JDY = jdy;
await app.start();
if (atmo && atmo.wake) { app.stats.wakeProx = +atmo.wake.prox.toFixed(2); app.stats.wakeAlt = +atmo.wake.alt.toFixed(1); }
if (jdy) { app.stats.trail = jdy.trailCount; app.stats.trailPx = jdy.trailStats.px; app.stats.trailScale = jdy.trailStats.scale; }
const NB = num('bench2', 0);
if (NB) {
  const gl = app.renderer.getContext(), px = new Uint8Array(4);
  // 每帧都推进一步再画（包含尾波图模拟、尾流更新这些每帧开销）
  const run = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) { app.step(1 / 60); app.render(1 / 60); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
  run(8); app.stats.msSync = +run(NB).toFixed(2);
}
