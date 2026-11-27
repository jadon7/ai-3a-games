// KHAMSIN 宣传片：页面内逐帧采集库。
// 用法（见 tools/promo/README.md）：把本文件复制到发行版快照根目录（promo-build/），页面就绪后在控制台
//   await import('/capture.js?' + Date.now())
// 得到 window.__P。所有采集都是“离线逐帧”：推进一帧 → 渲染 → 立刻 canvas.toBlob 抓图 → POST 给 receiver.mjs。
// 长任务（P.play / P.fly / P.follow）是 async 的，立即返回，进度在 P.job 里，用 P.status() 轮询。
const d = window.__dbg, g = d.game, E = d.engine, R = E.renderer, cv = R.domElement;
const P = window.__P = window.__P || {};
Object.assign(P, { W: 1920, H: 1080, q: 0.92, url: 'http://127.0.0.1:5191', queue: [], sent: 0, failed: 0, lastErr: null, job: null, alog: null });

// ---------- 画布固定 1920×1080（pixelRatio 1，不随窗口变化） ----------
P.fix = () => {
  E.renderScale = 1;
  E.resize = function () { this.renderer.setSize(P.W, P.H, false); this.post.setSize(P.W, P.H); this.camera.aspect = P.W / P.H; this.camera.updateProjectionMatrix(); this.width = P.W; this.height = P.H; };
  E.resize(); return [cv.width, cv.height];
};

// ---------- 抓帧：必须紧跟在渲染之后、同一段同步代码里调用 ----------
// 黑帧检测：GPU 被别的标签页抢占时偶尔会渲染出整帧黑，读 9 个像素判断，黑就用同样的状态重渲（最多 3 次）
const gl = R.getContext(), px = new Uint8Array(4);
P.isBlack = () => { let s = 0; for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.5, 0.75]) { gl.readPixels((cv.width * fx) | 0, (cv.height * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); s += px[0] + px[1] + px[2]; } return s < 9; };
P.guard = (rerender) => { let k = 0; while (P.isBlack() && k < 3) { rerender(); k++; } if (k) P.blackFix = (P.blackFix || 0) + 1; if (k === 3 && P.isBlack()) P.blackLeft = (P.blackLeft || 0) + 1; };
P.grab = (shot, i) => {
  const pr = new Promise((res) => {
    cv.toBlob((b) => {
      if (!b) { P.failed++; P.lastErr = 'toBlob null'; res(); return; }
      fetch(P.url + '/frame?shot=' + encodeURIComponent(shot) + '&i=' + i, { method: 'POST', body: b })
        .then((r) => { if (r.ok) P.sent++; else { P.failed++; P.lastErr = 'http ' + r.status; } })
        .catch((e) => { P.failed++; P.lastErr = String(e); }).finally(res);
    }, 'image/jpeg', P.q);
  });
  P.queue.push(pr); return pr;
};
P.throttle = async (max = 6) => { while (P.queue.length > max) await P.queue.shift(); };
P.flush = async () => { while (P.queue.length) await P.queue.shift(); };
P.upload = (name, obj) => fetch(P.url + '/file?name=' + encodeURIComponent(name), { method: 'POST', body: typeof obj === 'string' ? obj : JSON.stringify(obj) });

// ---------- 音频事件记录（?mute 下音频引擎不初始化，这里只记录调用，供离线重放成音效轨） ----------
P.hookAudio = () => {
  const A = g.audio; if (A.__promoHooked) return; A.__promoHooked = true;
  for (const m of ['play', 'loop', 'music', 'setIntensity', 'setListener', 'duck']) {
    const orig = A[m].bind(A);
    A[m] = (...args) => { if (P.alog) { let a; try { a = JSON.parse(JSON.stringify(args)); } catch (e) { a = []; } P.alog.push([P.frameI | 0, m, a]); } return orig(...args); };
  }
};

// ---------- 状态 ----------
const pl = () => g.player;
P.row = (i) => { const p = pl(); return [i, +g.time.toFixed(3), g.state, p.alive ? 1 : 0, p.inMech ? 1 : 0, p.wr && p.wr.on ? 1 : 0, p.sliding ? 1 : 0, p.grapple ? p.grapple.state : 0, p.onGround ? 1 : 0, g.stats.kills, g.stats.deaths, +(p.speedH || 0).toFixed(1), +p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1), +p.yaw.toFixed(3), +p.pitch.toFixed(3), g.weapons.stats ? g.weapons.stats.shots : 0]; };
P.ROWKEYS = ['i', 't', 'state', 'alive', 'mech', 'wall', 'slide', 'grap', 'ground', 'kills', 'deaths', 'speed', 'x', 'y', 'z', 'yaw', 'pitch', 'shots'];
P.status = () => ({ job: P.job && { ...P.job, rows: undefined }, sent: P.sent, failed: P.failed, q: P.queue.length, err: P.lastErr, canvas: [cv.width, cv.height], state: g.state, t: +g.time.toFixed(1) });

// ---------- 第一人称实战：开一局自动对战，逐帧推进并全部保存，同时记录状态与音频事件 ----------
// P.startDemo() 后多次调用 P.play(shot, 秒)；每段结束把状态表 <shot>.rows.json 和音频事件 <shot>.audio.json 传回。
P.startDemo = () => { d.view = { pos: [0, 80, 0], look: [0, 0, 0.1] }; P.hookAudio(); P.alog = []; d.demo(true); return g.state; };
P.play = (shot, sec, opt = {}) => {
  const n = Math.round(sec * 60), job = P.job = { kind: 'play', shot, i: 0, n, done: false, t0: performance.now(), rows: [] };
  P.alog = []; const skipDead = opt.skipDead !== false;
  (async () => {
    try {
      let k = 0;
      for (let f = 0; f < n && !job.stop; f++) {
        P.frameI = k;
        d.view = { pos: [0, 80, 0], look: [0, 0, 0.1] };   // 保持 rAF 主循环冻结
        d.step(1, 1 / 60, 0);
        if (g.state === 'ended' && opt.restart !== false) { P.alog.push([k, 'restart', []]); d.demo(true); }
        const p = pl();
        if (skipDead && !p.alive) { job.skipped = (job.skipped || 0) + 1; continue; }   // 阵亡回放不要
        P.guard(() => E.render(0)); P.grab(shot, k); job.rows.push(P.row(k)); k++; job.i = f + 1; job.saved = k;
        await P.throttle(6);
      }
      await P.flush();
      await P.upload(shot + '.rows.json', { keys: P.ROWKEYS, rows: job.rows });
      await P.upload(shot + '.audio.json', P.alog);
    } catch (e) { job.err = String(e && e.stack || e).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started ' + shot;
};
// 不保存地快进（找时机用）
P.skip = (sec) => { const n = Math.round(sec * 60); for (let f = 0; f < n; f++) { d.step(1, 1 / 60, 0); if (g.state === 'ended') d.demo(true); } return P.row(-1); };

// ---------- 自由机位（空镜 / 光影）：关键帧之间线性插值，游戏冻结 ----------
// keys: [{ pos:[x,y,z], look:[x,y,z], fov }]，均匀分布在 sec 秒上；opt.live=true 时同时推进游戏逻辑（世界里的人会动）
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
P.setCam = (pos, look, fov) => { const c = E.camera; c.position.set(pos[0], pos[1], pos[2]); c.lookAt(look[0], look[1], look[2]); c.fov = fov || 40; c.updateProjectionMatrix(); c.updateMatrixWorld(true); g.weapons.root.visible = false; };
P.camAt = (keys, u) => { if (keys.length === 1) return [keys[0].pos, keys[0].look, keys[0].fov || 40]; const m = keys.length - 1, x = Math.min(m - 1e-9, Math.max(0, u * m)), j = Math.floor(x), t = x - j, a = keys[j], b = keys[Math.min(m, j + 1)]; return [lerp3(a.pos, b.pos, t), lerp3(a.look, b.look, t), lerp(a.fov || 40, b.fov || 40, t)]; };
P.still = (keys, u = 0, warm = 90) => { const [pos, look, fov] = P.camAt(keys, u); d.view = { pos, look, fov }; for (let i = 0; i < warm; i++) { P.setCam(pos, look, fov); E.render(1 / 60); } P.setCam(pos, look, fov); E.render(1 / 60); return [cv.width, cv.height]; };
P.fly = (shot, keys, sec, opt = {}) => {
  const n = Math.round(sec * 60), job = P.job = { kind: 'fly', shot, i: 0, n, done: false, t0: performance.now() };
  (async () => {
    try {
      // 预热：让曝光适应、体积光的时间累积稳定下来
      const [p0, l0, f0] = P.camAt(keys, 0); d.view = { pos: p0, look: l0, fov: f0 };
      for (let i = 0; i < (opt.warm ?? 120); i++) { if (opt.live) liveStep(); P.setCam(p0, l0, f0); E.render(1 / 60); }
      for (let f = 0; f < n && !job.stop; f++) {
        const [pos, look, fov] = P.camAt(keys, n > 1 ? f / (n - 1) : 0);
        d.view = { pos, look, fov };
        if (opt.live) liveStep();
        P.setCam(pos, look, fov); E.render(1 / 60);
        P.guard(() => E.render(0)); P.grab(shot, f); job.i = f + 1;
        await P.throttle(6);
      }
      await P.flush();
    } catch (e) { job.err = String(e && e.stack || e).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started ' + shot;
};
function liveStep() { d.input.update(1 / 60); g.update(1 / 60); d.input.endFrame(); if (g.state === 'ended') d.demo(true); }

// ---------- 跟拍某个单位（第三人称看 AI 铁驭 / 机甲），游戏实时推进 ----------
// target(): 返回被跟拍对象（有 pos）；rig(t, tp): 返回 { pos, look, fov }，tp 为目标当前位置（THREE.Vector3）
P.follow = (shot, target, rig, sec, opt = {}) => {
  const n = Math.round(sec * 60), job = P.job = { kind: 'follow', shot, i: 0, n, done: false, t0: performance.now(), rows: [] };
  (async () => {
    try {
      for (let f = 0; f < n && !job.stop; f++) {
        d.view = { pos: [0, 80, 0], look: [0, 0, 0.1] };
        liveStep();
        const a = target(); if (!a) { job.lost = f; break; }
        const v = rig(f / 60, a.pos, a);
        P.setCam(v.pos, v.look, v.fov); E.render(1 / 60);
        P.guard(() => E.render(0)); P.grab(shot, f); job.i = f + 1;
        if (opt.row) job.rows.push(opt.row(a, f));
        await P.throttle(6);
      }
      await P.flush();
      if (opt.row) await P.upload(shot + '.rows.json', job.rows);
    } catch (e) { job.err = String(e && e.stack || e).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started ' + shot;
};

// ---------- 第三人称跟拍 AI 铁驭：追尾机位（跟随速度方向，带碰撞收缩），记录被跟拍者的机动状态 ----------
// 被跟拍者阵亡或消失时换下一个活着的铁驭（同队优先）。状态表每行：[帧, 铁驭id, 蹬墙, 滑铲, 钩索状态, 着地, 速度, 距相机]
P.followPilot = (shot, sec, opt = {}) => {
  const V = g.player.pos.constructor, W = d.world;
  const st = { id: null, dir: null, cam: null };
  const pick = () => {
    let a = g.actors.find((x) => x.kind === 'pilot' && x.alive && x.mesh.id === st.id);
    if (!a) { const all = g.actors.filter((x) => x.kind === 'pilot' && x.alive && (opt.team === undefined || x.team === opt.team)); a = all[0]; if (a) { st.id = a.mesh.id; st.dir = null; st.cam = null; } }
    return a;
  };
  const back = opt.back ?? 5.5, side = opt.side ?? 1.4, up = opt.up ?? 1.9, fov = opt.fov ?? 55;
  const rig = (t, tp, a) => {
    const b = a.body, v = b.vel, h = Math.hypot(v.x, v.z);
    const want = h > 2 ? [v.x / h, v.z / h] : (st.dir || [-Math.sin(b.yaw), -Math.cos(b.yaw)]);
    if (!st.dir) st.dir = want.slice(); else { st.dir[0] += (want[0] - st.dir[0]) * 0.05; st.dir[1] += (want[1] - st.dir[1]) * 0.05; const l = Math.hypot(st.dir[0], st.dir[1]) || 1; st.dir[0] /= l; st.dir[1] /= l; }
    const [dx, dz] = st.dir, rx = -dz, rz = dx;
    const head = new V(tp.x, tp.y + 1.5, tp.z);
    const off = new V(-dx * back + rx * side, up - 1.5 + 0.0, -dz * back + rz * side); const dist = off.length(); off.normalize();
    const hit = W.raycast(head, off, dist + 0.4); const k = hit ? Math.max(0.25, (hit.distance - 0.4) / dist) : 1;
    const target = [head.x + off.x * dist * k, head.y + off.y * dist * k, head.z + off.z * dist * k];
    if (!st.cam) st.cam = target.slice(); else for (let i = 0; i < 3; i++) st.cam[i] += (target[i] - st.cam[i]) * 0.15;
    return { pos: st.cam.slice(), look: [tp.x + dx * 2.5, tp.y + 1.1, tp.z + dz * 2.5], fov };
  };
  const row = (a, f) => { const b = a.body; return [f, a.mesh.id, b.wr && b.wr.on ? 1 : 0, b.sliding ? 1 : 0, b.grapple ? b.grapple.state : 0, b.onGround ? 1 : 0, +Math.hypot(b.vel.x, b.vel.z).toFixed(1), st.cam ? +Math.hypot(st.cam[0] - a.pos.x, st.cam[2] - a.pos.z).toFixed(1) : 0]; };
  return P.follow(shot, pick, rig, sec, { row });
};

// 单帧快照（看构图用）：渲染当前自由机位并保存到 frames/<shot>/<i>.jpg
P.snap = (shot, i, keys, u = 0, warm = 60) => { P.still(keys, u, warm); return P.grab(shot, i); };
P.fix();
export default P;
