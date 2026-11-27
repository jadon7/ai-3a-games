// 角色模块测试页。
//   ?view=front|rear|side|sun|face|low|top  相机预设（相对角色；也可以直接用 ?cam=&look=&fov= 覆盖）
//   ?speed=45&boost=0&bank=0&pitch=0&turn=0&flip=0   喂给 update 的状态
//   ?heading=0   航向（度）。0 = 朝 +X 飞，和影片里的光照关系一致（太阳在前方偏左）
import * as THREE from 'three';
import { createApp } from '../app.js';
import { createCharacter } from '../character.js';
import { SUN_DIR, PARAMS, num, CRUISE_Y } from '../common.js';

const app = await createApp();
const wk = createCharacter(app);
const heading = THREE.MathUtils.degToRad(num('heading', 0));
wk.group.position.set(0, CRUISE_Y, 0);
wk.group.rotation.y = -Math.PI / 2 + heading;
wk.group.updateMatrixWorld(true);

// 占位的筋斗云：脚下一团压扁的球
const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 1 }));
cloud.scale.set(1.9, 0.42, 2.9); cloud.position.set(0, -0.40, 0.7); cloud.receiveShadow = true;
wk.group.add(cloud);

// 相机预设：偏移量写成（前, 上, 右），单位米
const V = {
  front: { off: [4.6, 0.75, 2.3], look: [0.05, 1.20, 0], fov: 13.6 },     // 对标影片 E 镜头（85mm）
  face: { off: [2.4, 1.38, 1.0], look: [0.16, 1.33, 0.0], fov: 11 },
  rear: { off: [-8.2, 1.7, 5.0], look: [0.4, 0.45, 0], fov: 25.4 },       // 对标 B 镜头（45mm）
  side: { off: [0.2, 0.8, 8.5], look: [0.3, 0.6, 0], fov: 22.9 },         // 对标 F 镜头（50mm）
  low: { off: [3.2, -0.6, -2.6], look: [0, 0.9, 0], fov: 30 },
  chase6: { off: [-5.6, 2.3, 0], look: [0.6, 1.25, 0], fov: 42 },         // 正后上方 6 m（游戏里的常用视角）
  chase40: { off: [-38, 11, 0], look: [2, 1.0, 0], fov: 42 },             // 正后上方 40 m
  cape: { off: [-3.4, 1.9, 1.2], look: [-1.0, 1.0, 0], fov: 38 },         // 披风近景
  crown: { off: [1.6, 2.05, 0.9], look: [0.05, 1.72, 0], fov: 22 },       // 金冠近景
  full: { off: [4.6, 1.3, 3.2], look: [-0.3, 1.15, 0], fov: 34 },         // 正面 3/4 全身
  top: { off: [-2.5, 5.0, 0.5], look: [0, 0.8, 0], fov: 30 },
};
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
let yaw = -Math.PI / 2 + heading;
const yawRate = num('yawrate', 0);                                         // 模拟转弯：角色整体每秒转多少弧度（>0 = 右转）
function basis() { fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); right.set(Math.cos(yaw), 0, -Math.sin(yaw)); }
basis();
const P = (a) => wk.group.position.clone().addScaledVector(fwd, a[0]).addScaledVector(up, a[1]).addScaledVector(right, a[2]);
const view = PARAMS.get('view');
function placeCamera() {
  basis();
  if (view === 'sun') {
    const tgt = P([0, 1.05, 0]);
    const sd = SUN_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(num('off', 0)));
    app.camera.position.copy(tgt).addScaledVector(sd, -num('dist', 7.5)).add(new THREE.Vector3(0, 0.2, 0));
    app.camera.fov = num('fov', 22); app.camera.lookAt(tgt);
  } else if (V[view]) {
    app.camera.position.copy(P(V[view].off)); app.camera.fov = num('fov', V[view].fov); app.camera.lookAt(P(V[view].look));
  }
  app.camera.updateProjectionMatrix();
}
placeCamera();
app.shadowFocus.copy(wk.group.position);
app.setShadowRange(num('shadow', 10));
// ?sbias=-0.00001&snb=0.02：试阴影偏移（外壳默认值是按 ±160 m 的大范围调的，近处的自阴影基本被偏移吃掉了）
if (PARAMS.has('sbias')) app.sunLight.shadow.bias = num('sbias', -0.00001);
if (PARAMS.has('env')) app.scene.environmentIntensity = num('env', 1);      // ?env=0 只看太阳光
if (PARAMS.has('snb')) app.sunLight.shadow.normalBias = num('snb', 0.02);

// 用主线的后期（调色/颗粒）看最终观感；景深和运动模糊关掉，方便看角色细节。?post=0 关闭
let post = null;
if (num('post', 1)) {
  try { const m = await import('../post.js'); post = m.createPost(app); app.setPost(post); if (post.params) { post.params.dof = num('dof', 0); post.params.motionBlur = 0; post.params.glare = num('glare', 0.3); } }
  catch (e) { console.warn('post.js 不可用，改用内置色调映射', e); }
}
if (num('atmo', 0)) {
  try { const m = await import('../atmosphere.js'); app.setAtmosphere(m.createAtmosphere(app)); } catch (e) { console.warn('atmosphere.js 不可用', e); }
}

const state = { speed: num('speed', 45), boost: num('boost', 0), bank: num('bank', 0), pitch: num('pitch', 0), turn: num('turn', 0), flip: num('flip', 0) };
wk.group.rotation.order = 'YXZ';
// ?flipsim=T0[&flipdur=0.8]：从 T0 秒开始模拟一次翻筋斗（和游戏里一样：绕身体中心前翻一圈 + 起跳），state.flip 同步走 0→1
const flipT0 = num('flipsim', -1), flipDur = num('flipdur', 0.8), baseY = wk.group.position.y;
app.onUpdate((dt, t) => {
  if (flipT0 >= 0) {
    const f = (t - flipT0) / flipDur, on = f > 0 && f < 1;
    state.flip = on ? f : 0;
    const ang = on ? Math.PI * 2 * f : 0, hop = on ? 1.25 * Math.sin(Math.PI * f) : 0;
    wk.group.rotation.x = -ang;
    // 绕脚上方 0.9 m 的点转：脚底点 = 枢轴 + R·(0,-0.9,0)
    const c = Math.cos(-ang), s_ = Math.sin(-ang);
    wk.group.position.y = baseY + 0.9 + hop - 0.9 * c;
    wk.group.position.addScaledVector(fwd, 0).setX(wk.group.position.x); 
    const off = -0.9 * s_;                                                   // 脚底点沿前后方向的偏移
    wk.group.position.x = fwd.x * (-off); wk.group.position.z = fwd.z * (-off);
  }
  if (yawRate) { yaw -= yawRate * dt; wk.group.rotation.y = yaw; }
  wk.group.rotation.z = -state.bank * num('roll', 1);                      // 机体跟着压弯（游戏里由外层做）
  wk.group.updateMatrixWorld(true);
  wk.update(dt, state);
  if (yawRate) placeCamera();
});
if (PARAMS.has('play')) { const at = num('playat', 0.5); let done = false; app.onUpdate((dt, t) => { if (!done && t >= at) { done = true; wk.play(PARAMS.get('play')); } }); }
window.__wk = wk; window.__app = app;
await wk.ready;
// ?capegain= / ?capewave= / ?capedbg=：披风调参（风力倍率、波浪倍率、调试开关）
if (PARAMS.has('capegain')) wk.debug.CAPE.windGain = num('capegain', 1); if (PARAMS.has('capewave')) wk.debug.CAPE.wave = num('capewave', 1); if (PARAMS.has('capedbg')) wk.debug.CAPE.dbg = PARAMS.get('capedbg');
// ---- 动画混合器自测
// ?clip=1：现造一段骨骼片段（上身扭转 + 右臂抬起），登记成 'look'，验证"片段 + 程序化增量"的混合通路
// ?borrow=moko:idle：把借来的同骨架片段按骨骼名直接套上来看效果（文件放在 assets/char/anims/borrowed/）
if (num('clip', 0)) {
  const R = wk.debug.rest, q = (n, l, r, y) => { const d = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, y, -l, 'XYZ')); return R[n].q.clone().multiply(R[n].wqi).multiply(d).multiply(R[n].wq).toArray(); };
  const tr = (n, keys) => new THREE.QuaternionKeyframeTrack('mixamorig' + n + '.quaternion', [0, 1, 2], keys.flatMap(k => q(n, ...k)));
  const clip = new THREE.AnimationClip('look', 2, [tr('Spine1', [[0, 0, 0.5], [0.2, 0, -0.5], [0, 0, 0.5]]), tr('RightArm', [[0, 0, 0], [-1.0, -0.5, 0], [0, 0, 0]]), tr('Head', [[0, 0, -0.4], [0, 0, 0.4], [0, 0, -0.4]])]);
  wk.debug.anim.add(clip, true); wk.play('lookout');
}
if (PARAMS.has('borrow')) {
  const [file, name] = PARAMS.get('borrow').split(':');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
  const g = await L.loadAsync(`./assets/char/anims/borrowed/${file}.glb`);
  const clip = g.animations.find(c => c.name === name);
  app.stats.borrow = clip ? { name, dur: +clip.duration.toFixed(2), tracks: clip.tracks.length } : 'not found: ' + g.animations.map(c => c.name).join(',');
  if (clip) { clip.name = 'look'; wk.debug.anim.add(clip, true); wk.play('lookout'); }
}
await app.start();
// ?hide=WK_Cape,WK_FurShells,WK_Crown,WK_Feathers,WK_Body  隐藏某些部件（分项测耗时用）
if (PARAMS.has('hide')) { const names = PARAMS.get('hide').split(','); wk.group.traverse(o => { if (names.includes(o.name)) o.visible = false; }); }
// ?noshadow=WK_FurShells：让某个部件不接收阴影（分析耗时用）
if (PARAMS.has('noshadow')) { const names = PARAMS.get('noshadow').split(','); wk.group.traverse(o => { if (names.includes(o.name)) { o.receiveShadow = false; o.material.needsUpdate = true; } }); }
// 自测帧耗时：连续画 N 帧后读一个像素强制 GPU 完成；?cbench=N 同时测"隐藏角色"的耗时，差值就是角色的开销
const N = num('cbench', 0);
if (N) {
  const gl = app.renderer.getContext(); const px = new Uint8Array(4);
  const run = () => { const t0 = performance.now(); for (let i = 0; i < N; i++) { app.step(1 / 60); app.render(1 / 60); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / N; };
  run();
  const withChar = run();
  wk.group.visible = false; run(); const without = run(); wk.group.visible = true;
  app.step(1 / 60); app.render(1 / 60);
  app.stats.msWith = +withChar.toFixed(2); app.stats.msWithout = +without.toFixed(2); app.stats.msChar = +(withChar - without).toFixed(2);
}
const hp = wk.getHeadPosition(new THREE.Vector3());
app.stats.head = [+(hp.x).toFixed(2), +(hp.y - CRUISE_Y).toFixed(2), +(hp.z).toFixed(2)];
