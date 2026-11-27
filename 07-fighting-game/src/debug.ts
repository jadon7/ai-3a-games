import * as THREE from 'three';
import { DEBUG, DT } from './core/config';
import type { Game } from './game';
import type { FightPresenter } from './present/fightFx';

/**
 * 调试入口，挂在 window.__dbg 上，给自动化截图和特效调试用：
 *   __dbg.skipIntro()            跳过开场直接开打
 *   __dbg.move(0, 'sp1')         让 0 号位立刻出某一招（招式 id 见 src/data/fighters.ts）
 *   __dbg.place(-1.2, 1.2)       摆位置
 *   __dbg.pause() / resume()     暂停 / 继续
 *   __dbg.step(n)                暂停状态下前进 n 个模拟帧
 *   __dbg.input(0, { x: 1 })     顶替 0 号位的输入（一直按住右）；传 null 恢复
 *   __dbg.state()                两个角色的状态快照
 *   __dbg.run(秒)                手动推进并渲染（之后不再自动走，__dbg.auto() 恢复）
 * 地址栏参数：?boxes 画命中盒；?standin 用替身；?training 训练模式；?p2c=cpu 让二号位由电脑控制
 */
export function installDebug(game: Game, presenter: FightPresenter) {
  const nan: { rt: THREE.WebGLRenderTarget | null; buf: Float32Array | null } = { rt: null, buf: null };
  const boxes = new THREE.Group();
  game.gfx.scene.add(boxes);
  const mkBox = (color: number) => { const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color, depthTest: false })); m.renderOrder = 99; m.visible = false; boxes.add(m); return m; };
  const hurt = [mkBox(0x40ff80), mkBox(0x40ff80)], hit = [mkBox(0xff4040), mkBox(0xff4040), mkBox(0xff4040), mkBox(0xff4040)];
  const setBox = (m: THREE.LineSegments, b: number[] | null) => { if (!b) { m.visible = false; return; } m.visible = true; m.position.set((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.02); m.scale.set(b[2] - b[0], b[3] - b[1], 1); };
  if (DEBUG.has('boxes')) game.presenters.push({
    update() {
      const m = game.match; if (!m) return;
      let k = 0;
      for (const [i, f] of m.f.entries()) {
        setBox(hurt[i], f.hurtbox());
        if (f.move) for (const h of f.move.hits) if (f.mf >= h.f && f.mf < h.f + h.a && !h.chain && k < 4) setBox(hit[k++], f.hitbox(h));
      }
      for (; k < 4; k++) hit[k].visible = false;
    },
  });
  const dbg = {
    game, presenter,
    skipIntro() { const m = game.match; if (!m) return; m.phase = 'fight'; m.pf = 0; for (const f of m.f) { f.setState('stand'); f.setAnim('idle', 0, true, 0); } game.cam.stop(); },
    move(i: number, id: string) { const m = game.match; if (!m) return false; const f = m.f[i], mv = f.def.moves[id]; if (!mv) return false; if (mv.cost) f.meter = 100; if (mv.air) { f.setState('air'); f.y = 1.2; f.vy = 3; } m.startMove(f, mv); return true; },
    place(x0: number, x1: number) { const m = game.match; if (!m) return; m.f[0].x = m.f[0].px = x0; m.f[1].x = m.f[1].px = x1; },
    pause() { game.paused = true; }, resume() { game.paused = false; },
    step(n = 1) { const m = game.match; if (!m) return; for (let i = 0; i < n; i++) { m.step(); for (const e of m.drainEvents()) for (const p of game.presenters) p.onEvent?.(e, game); for (const p of game.presenters) p.update?.(DT, DT, game); } },
    state() { const m = game.match; if (!m) return null; return { phase: m.phase, frame: m.frame, timer: m.timer, f: m.f.map((f) => ({ x: +f.x.toFixed(2), y: +f.y.toFixed(2), hp: f.hp, meter: +f.meter.toFixed(0), state: f.state, move: f.move?.id ?? null, mf: f.mf, anim: f.anim.name, t: +f.anim.t.toFixed(2), combo: f.comboHits })) }; },
    fps() { return Math.round(game.fps); },
    /** 把镜头固定到某个机位（世界坐标的位置和注视点），dur 秒后回到对战镜头 */
    cam(px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 32, dur = 9999) {
      game.cam.play([{ pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz), fov, dur, into: 0 }]);
    },
    /** 顶替某个位置的输入：__dbg.input(0, { x: 1 }) 让 0 号位一直按住右；传 null 恢复 */
    input(i: number, cmd: Record<string, number | boolean> | null) {
      const m = game.match; if (!m) return;
      const src = m.inputs[i] as any;
      if (!src.__orig) src.__orig = src.poll.bind(src);
      src.poll = cmd ? () => ({ x: 0, y: 0, L: false, H: false, S: false, G: false, T: false, U: false, D: false, ...cmd }) : src.__orig;
    },
    /** 手动跑 seconds 秒（每帧 1/60 秒）。页面在后台、requestAnimationFrame 不走时用它推进并渲染 */
    run(seconds: number) { game.manual = true; const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) game.tick(1 / 60); },
    /**
     * 关节限位的读数：i 号位当前姿势下，腰（胯→胸）和脖子（胸→头）相对站姿偏了多少度。
     * swing 歪了多少、pitch 仰（负）俯（正）、roll 侧倾、twist 扭转、cut 超出上限被压掉的角度。只量不改。
     */
    limits(i: number) {
      const v = game.views[i]; if (!v) return null;
      return v.limits.map((l) => { l.solve(false); return { chain: l.spec.base + '>' + l.spec.end, ...l.last }; });
    },
    /**
     * 查“画面上闪黑色方块”：把场景单独渲染到一张浮点贴图里，数出无效像素（NaN / 无穷大）和亮度溢出的像素
     * （超过半浮点上限 65504 的值进了后处理就是无穷大，泛光会把它放大成整块黑）。
     * find 为真时再用二分法隐藏物体，找出是哪个物体画出来的。返回 null 表示这一帧是干净的。
     */
    nanScan(find = true) {
      const gfx = game.gfx, r = gfx.renderer;
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const w = Math.max(2, Math.round(size.x)), h = Math.max(2, Math.round(size.y));
      if (!nan.rt || nan.rt.width !== w || nan.rt.height !== h) { nan.rt?.dispose(); nan.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true }); nan.buf = new Float32Array(w * h * 4); }
      const rt = nan.rt, buf = nan.buf!;
      const scan = () => {
        r.setRenderTarget(rt); r.clear(); r.render(gfx.scene, gfx.camera); r.readRenderTargetPixels(rt, 0, 0, w, h, buf); r.setRenderTarget(null);
        let bad = 0, hot = 0, max = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let i = 0; i < buf.length; i += 4) {
          const a = buf[i], b = buf[i + 1], c = buf[i + 2];
          const fin = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c);
          const m = fin ? Math.max(a, b, c) : Infinity;
          if (fin && m > max) max = m;
          if (!fin || m > 60000 || Math.min(a, b, c) < -60000) {
            if (fin) hot++; else bad++;
            const pix = i >> 2, x = pix % w, y = (pix / w) | 0;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        return { bad, hot, max, box: x1 < 0 ? null : [x0 / w, 1 - (y1 + 1) / h, (x1 + 1) / w, 1 - y0 / h].map((v) => +v.toFixed(3)) };
      };
      const first = scan();
      if (!first.bad && !first.hot) return null;
      const out: any = { ...first };
      if (!find) return out;
      out.culprits = [];
      const all: THREE.Object3D[] = [];
      gfx.scene.traverseVisible((o) => { const a = o as any; if (a.isMesh || a.isPoints || a.isLine || a.isSprite) all.push(o); });
      const describe = (o: THREE.Object3D) => {
        const a = o as any, mat = Array.isArray(a.material) ? a.material[0] : a.material, path: string[] = [];
        for (let p: THREE.Object3D | null = o; p && path.length < 6; p = p.parent) path.push(p.name || p.type);
        const badU: string[] = [], uni: Record<string, any> = {};
        for (const [k, u] of Object.entries<any>(mat?.uniforms ?? {})) {
          const v = u?.value; const nums: number[] = typeof v === 'number' ? [v] : v?.toArray ? v.toArray() : Array.isArray(v) && typeof v[0] === 'number' ? v : [];
          if (nums.length && nums.length <= 4) uni[k] = nums.map((x) => +(+x).toPrecision(4));
          if (nums.some((x) => !Number.isFinite(x))) badU.push(k);
        }
        const badA: string[] = [], geo = a.geometry as THREE.BufferGeometry | undefined;
        for (const [k, at] of Object.entries<any>(geo?.attributes ?? {})) { const arr = at.array as ArrayLike<number>; const n = Math.min(arr.length, (at.count ?? 0) * at.itemSize); for (let i = 0; i < n; i++) if (!Number.isFinite(arr[i])) { badA.push(k); break; } }
        const wp = o.getWorldPosition(new THREE.Vector3()), ws = o.getWorldScale(new THREE.Vector3());
        return { path: path.join(' < '), type: o.type, mat: `${mat?.type ?? '?'}${mat?.name ? ':' + mat.name : ''} blend=${mat?.blending} transp=${mat?.transparent}`, pos: wp.toArray().map((x) => +x.toFixed(2)), scale: ws.toArray().map((x) => +x.toFixed(3)), count: (a.count ?? geo?.drawRange?.count), badUniforms: badU, badAttrs: badA, uniforms: uni, emissive: mat?.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b, mat.emissiveIntensity].map((x: number) => +x.toFixed(2)) : undefined, color: mat?.color ? [mat.color.r, mat.color.g, mat.color.b].map((x: number) => +x.toFixed(2)) : undefined, opacity: mat?.opacity };
      };
      const vis = new Map(all.map((o) => [o, o.visible]));
      const show = (set: THREE.Object3D[]) => { const st = new Set(set); for (const o of all) o.visible = st.has(o); };
      let pool = all.slice();
      for (let round = 0; round < 3 && pool.length; round++) {
        show(pool); const s0 = scan(); if (!s0.bad && !s0.hot) break;
        let cand = pool.slice();
        while (cand.length > 1) {
          const half = cand.slice(0, cand.length >> 1);
          show(half); const s = scan();
          cand = s.bad || s.hot ? half : cand.slice(cand.length >> 1);
        }
        show(cand); const s1 = scan();
        if (!(s1.bad || s1.hot)) { out.culprits.push({ note: '单独显示时不再出现（可能要几个物体叠在一起才溢出）', among: pool.length }); break; }
        out.culprits.push({ ...describe(cand[0]), alone: s1 });
        pool = pool.filter((o) => o !== cand[0]);
      }
      for (const [o, v] of vis) o.visible = v;
      return out;
    },
  };
  (window as any).__dbg = dbg;
  return dbg;
}
