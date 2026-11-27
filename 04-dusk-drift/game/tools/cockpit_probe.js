// 驾驶位手部检查（浏览器里用，?test=1 静音）：await import('/tools/cockpit_probe.js?' + Date.now())
// SETUP(车型) → 进驾驶位；POSE(方向盘转角)；EYESHOT(名字, 转角) 驾驶员视角截图；CU 握点近景；ISO(true) 只显示方向盘和手臂；INFO() 轮缘测量 + 穿模检查
const THREE = G.THREE, g = G.game;
const W = window;
W.SETUP = async (id) => { G.freeCam = false; g.playerSpec = id; g.laps = 1; await g.startRace(); g.camMode = 'cockpit'; for (let i = 0; i < 60 && !(g.focus === g.player && g.focus.car.specName === id && g.focus.view.arms); i++) await G.step(10); G.freeCam = true; return g.focus.view; };
W.POSE = async (w) => { const v = g.focus.view; v.steerPivot.quaternion.copy(v.steerQ0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), w)); v.steerRot = w; v.arms.update(w); v.root.updateMatrixWorld(true); };
W.EYESHOT = async (name, w, fov = 66) => { const v = g.focus.view; await POSE(w); v.body.updateMatrixWorld(true); const M = v.body.matrixWorld, cam = G.camera; cam.position.copy(v.eye).applyMatrix4(M); cam.near = 0.03; cam.fov = fov; cam.up.set(0, 1, 0); cam.updateProjectionMatrix(); cam.lookAt(v.eye.clone().add(new THREE.Vector3(0, -0.075, 1)).applyMatrix4(M)); await G.step(2); await POSE(w); await G.step(1); return G.shot(name); };
W.ISO = (on) => { const v = g.focus.view; v.root.traverse(o => { if (!o.isMesh) return; let p = o, keep = false; while (p) { if (p === v.steerPivot || p === v.arms.root) { keep = true; break; } p = p.parent; } if (on) { if (!keep) { o.userData._vis = o.visible; o.visible = false; } } else if (o.userData._vis !== undefined) { o.visible = o.userData._vis; delete o.userData._vis; } }); };
W.CU = async (name, side, off, fov = 45) => { const v = g.focus.view, P = v.steerInfo, s = v.arms.sides[side]; const a = s.a0 + THREE.MathUtils.clamp(v.steerRot, -0.6, 0.6), c = Math.cos(a), sn = Math.sin(a);
  const gp = new THREE.Vector3(c * s.rim.r, sn * s.rim.r, s.rim.z).applyMatrix4(P.base); v.body.updateMatrixWorld(true); const M = v.body.matrixWorld, cam = G.camera;
  cam.position.copy(gp.clone().add(new THREE.Vector3(...off))).applyMatrix4(M); cam.near = 0.01; cam.fov = fov; cam.up.set(0, 1, 0); cam.updateProjectionMatrix(); cam.lookAt(gp.clone().applyMatrix4(M)); await G.step(2); return G.shot(name); };
W.GRIPCHK = () => {
  const v = g.focus.view, P = v.steerInfo, A = v.arms; let sm = null; A.root.traverse(o => { if (o.isSkinnedMesh) sm = o; });
  A.root.updateMatrixWorld(true);
  const bodyInv = new THREE.Matrix4().copy(v.body.matrixWorld).invert(), baseInv = new THREE.Matrix4().copy(P.base).invert();
  const bones = sm.skeleton.bones.map(b => b.name), si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight, pos = sm.geometry.attributes.position, out = {}, p = new THREE.Vector3();
  for (const s of A.sides) { const hb = bones.indexOf(s.ha.name), ds = []; const a = s.a0 + THREE.MathUtils.clamp(v.steerRot, -0.6, 0.6);
    for (let i = 0; i < pos.count; i++) { let w = 0; for (let j = 0; j < 4; j++) if (si.getComponent(i, j) === hb) w += sw.getComponent(i, j); if (w < 0.5) continue;
      sm.getVertexPosition(i, p); p.applyMatrix4(sm.matrixWorld).applyMatrix4(bodyInv).applyMatrix4(baseInv);
      const da = Math.atan2(Math.sin(Math.atan2(p.y, p.x) - a), Math.cos(Math.atan2(p.y, p.x) - a)); if (Math.abs(da) > 0.6) continue;
      ds.push(Math.hypot(Math.hypot(p.x, p.y) - s.rim.r, p.z - s.rim.z) - s.rim.tube); }
    ds.sort((x, y) => x - y); out[s.sx > 0 ? 'L' : 'R'] = `pen${ds.filter(x => x < -0.003).length} min${(ds[0] * 1000).toFixed(1)}mm reach${s.reach.toFixed(2)}`; }
  return out; };
W.INFO = () => { const v = g.focus.view, u = v.steerPivot.userData; return JSON.stringify({ found: u.found, refine: u.refine && Object.fromEntries(Object.entries(u.refine).map(([k, x]) => [k, +x.toFixed(4)])), rim: v.arms.sides.map(s => [s.rim.r, s.rim.z, s.rim.tube].map(x => +x.toFixed(3)).join(',')).join(' / '), chk: GRIPCHK() }); };
