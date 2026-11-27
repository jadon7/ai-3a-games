// 场景试验页：和游戏同一套渲染（Gfx）、同一个镜头（FightCamera），放两个角色站着看场景。
// 参数：cam=far|near|left|right|close45|close45r|wide  dim=0..1  reflect=0  impact=1  fps=1（量 5 秒平均帧率）  nohud=1  t=秒（时间起点）
import * as THREE from 'three';
import { Animator } from '../src/anim/animator';
import { Rig } from '../src/anim/rig';
import { loadFighter } from '../src/data/assets';
import { FightCamera } from '../src/render/camera';
import { Gfx } from '../src/render/gfx';
import { createTempleStage } from '../src/stages/temple';

const q = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const W = window as any;

async function boot() {
  const gfx = new Gfx(document.getElementById('view') as HTMLCanvasElement);
  const stage = await createTempleStage({ renderer: gfx.renderer, scene: gfx.scene, camera: gfx.camera });
  const cam = new FightCamera(gfx.camera);

  const mode = q.get('cam') ?? 'far';
  const xs: Record<string, [number, number]> = {
    far: [-3.6, 3.6], near: [-1.15, 1.15], left: [-8.2, -5.2], right: [5.2, 8.2], close45: [-1.2, 1.2], close45r: [-1.2, 1.2], wide: [-3.8, 3.8],
  };
  const [ax, bx] = xs[mode] ?? xs.far;

  const fighters: { rig: Rig; anim: Animator }[] = [];
  if (q.get('nofighters') !== '1') {
    const [a, b] = await Promise.all([loadFighter('yanjin'), loadFighter('lingshuang')]);
    for (const [i, f] of [a, b].entries()) {
      const rig = new Rig(f.asset);
      const anim = new Animator(rig.model, f.asset.clips);
      anim.play('idle', 0, i * 0.7, true);
      rig.root.position.set(i === 0 ? ax : bx, 0, 0);
      rig.setFacing(i === 0 ? 1 : -1);
      gfx.scene.add(rig.root);
      fighters.push({ rig, anim });
    }
  }

  if (mode === 'close45' || mode === 'close45r') {
    const s = mode === 'close45' ? 1 : -1;
    const look = new THREE.Vector3(ax, 1.15, 0);
    const a = THREE.MathUtils.degToRad(45) * s;
    const pos = look.clone().add(new THREE.Vector3(Math.sin(a) * 3.0, 0.15, Math.cos(a) * 3.0));
    if (s < 0) { look.x = bx; pos.x = bx + Math.sin(a) * 3.0; }
    cam.play([{ pos, look, fov: 32, dur: 1e9 }]);
  }
  if (mode === 'wide') cam.zoomBias = 5;
  for (let i = 0; i < 400; i++) cam.update(1 / 60, ax, 0, bx, 0);

  const dimK = +(q.get('dim') ?? 0);
  let t = +(q.get('t') ?? 3);
  let last = performance.now();
  let frames = 0, acc = 0, hf = 0, measuring = q.get('fps') === '1', mStart = 0, mFrames = 0;
  const stats: any = { mode };
  W.__stats = stats;

  // 只算场景本身的绘制调用和三角形（不含后处理）
  const countScene = () => {
    const r = gfx.renderer; const rt = new THREE.WebGLRenderTarget(64, 64);
    r.info.reset(); r.setRenderTarget(rt); r.render(gfx.scene, gfx.camera); r.setRenderTarget(null);
    const o = { calls: r.info.render.calls, tris: r.info.render.triangles };
    rt.dispose(); return o;
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt;
    for (const f of fighters) { f.anim.setTime(t); f.anim.update(dt); f.rig.root.updateMatrixWorld(true); }
    cam.update(dt, ax, 0, bx, 0);
    stage.setDim(dimK);
    gfx.renderer.info.reset();
    stage.update(dt, t);
    if (frames === 28) stats.reflectPass = { calls: gfx.renderer.info.render.calls, tris: gfx.renderer.info.render.triangles };
    gfx.render(dt);
    frames++; hf++; acc += dt;
    if (frames === 29) stats.total = { calls: gfx.renderer.info.render.calls, tris: gfx.renderer.info.render.triangles };
    if (frames === 30) {
      Object.assign(stats, { scene: countScene() });
      if (q.get('tris') === '1') {
        // 按对象统计三角形（实例化的乘实例数），找面数大头
        const list: [string, number][] = [];
        stage.root.traverse((o: any) => {
          if (!o.isMesh || !o.visible) return;
          const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
          let p = o; let name = o.name; while (!name && p.parent) { p = p.parent; name = p.name; }
          list.push([name || o.type, Math.round(n * (o.isInstancedMesh ? o.count : 1))]);
        });
        const agg: Record<string, number> = {};
        for (const [k, n] of list) agg[k] = (agg[k] ?? 0) + n;
        stats.trisBy = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 25);
      }
      if (q.get('impact') === '1') stage.onImpact?.(+(q.get('ix') ?? 0), 1);
      if (!measuring) W.__ready = true;
      mStart = now; mFrames = 0;
    }
    if (measuring && frames > 30) {
      mFrames++;
      if (now - mStart >= 5000) { stats.fps = +(mFrames / ((now - mStart) / 1000)).toFixed(1); measuring = false; W.__ready = true; }
    }
    if (acc > 0.5 && q.get('nohud') !== '1') {
      const i = gfx.renderer.info.render;
      hud.textContent = `${mode}  ${(hf / acc).toFixed(0)} fps  calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k\nscene ${JSON.stringify(stats.scene ?? {})}`;
      hf = 0; acc = 0;
    }
  };
  requestAnimationFrame(frame);
}
boot().catch((e) => { console.error(e); hud.textContent = String(e?.stack ?? e); W.__ready = true; W.__error = String(e); });
