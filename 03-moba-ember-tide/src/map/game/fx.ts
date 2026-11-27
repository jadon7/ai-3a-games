// 打击和技能的小特效（阶段 3）：刀光、命中的火花、跳出来的伤害数字、地上的水纹、钩引的骨链。
// 规矩：只用岚的阵营色（青）加骨白；亮的时间都很短，不留常亮的光，不往地图的发光预算里加东西。

import * as THREE from "three";
import { FXB, PREMUL } from "./fxb";

interface Live { t: number; life: number; obj: THREE.Object3D; tick: (k: number, dt: number) => void; back?: () => void; }
export interface Trail { push: (base: THREE.Vector3, tip: THREE.Vector3) => void; end: () => void; }
export interface Chain { set: (from: THREE.Vector3, to: THREE.Vector3) => void; remove: () => void; }
export interface Fx {
  group: THREE.Group; update: (dt: number) => void;
  /** 刀光：跟着刀身走的一条拖尾。挥刀的那几帧每帧 push 一次刀身的位置，挥完 end */
  trail: (big?: boolean) => Trail;
  hit: (pos: THREE.Vector3, big?: boolean, tint?: number) => void;      // tint：火花带一点出手那个英雄的颜色
  text: (pos: THREE.Vector3, s: string, big?: boolean, color?: string) => void;
  /** 伤害数字（第九轮 polish-lib，照 LoL）：key 是挨打的那个单位（一个 key 一摞）。同一个目标短时间里的几个数从下往上排开：
   *  新跳的在最下面，旧的往上让一格，不叠在一起；同一刻（0.06 秒内）同一种颜色的两下合成一个数。small：打小兵、野怪的，小一号 */
  num: (key: number, pos: THREE.Vector3, v: number | string, o?: { big?: boolean; color?: string; small?: boolean; dx?: number }) => void;
  ripple: (pos: THREE.Vector3, color?: number, size?: number) => void;
  marker: (pos: THREE.Vector3, attack: boolean) => void;
  chain: () => Chain;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createFx(): Fx {
  const group = new THREE.Group(); group.name = "fx"; const live: Live[] = [];
  const trails: { tr: Trail & { tick: (dt: number) => boolean }; m: THREE.Mesh }[] = [];
  const add = (obj: THREE.Object3D, life: number, tick: Live["tick"]) => { group.add(obj); live.push({ t: 0, life, obj, tick }); tick(0, 0); };

  const dotTex = canvasTex(64, 64, c => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
  const streakTex = canvasTex(64, 16, c => { const g = c.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 5, 64, 6); });
  const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(FXB.on ? { ...PREMUL, toneMapped: false } : { blending: THREE.AdditiveBlending }) });      // 所有刀光共用一个材质。换画风 B（b-fx）：预乘透明——刀尖那道白边是实的，往里一层青盖住一点地面（亮地面上叠加的淡青看不见）
  // 飘字用池子（第九轮）：每个字一块自己的小画布，用完留着下次重画。原来每跳一个数字新建一张贴图、一个材质，而且从来不释放
  type TextRec = { sp: THREE.Sprite; cv: HTMLCanvasElement; tex: THREE.CanvasTexture };
  const textFree: TextRec[] = [];
  const textRec = (): TextRec => textFree.pop() ?? (() => { const cv = document.createElement("canvas"); cv.width = 256; cv.height = 96; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }); mat.userData.fowKeep = true;      /* 飘字不跟着迷雾藏（见 fow.ts）：自己打出去的数、自己挨的数，目标站在视野边上也要看得见 */
    const sp = new THREE.Sprite(mat); sp.renderOrder = 20; return { sp, cv, tex }; })();
  /** 在一块飘字画布上写字：粗体、深色描边、上亮下暗的渐变 */
  const paint = (rec: TextRec, s: string, big: boolean, color?: string) => {
    const c = rec.cv.getContext("2d")!, fs = big ? 70 : s.length > 4 ? 44 : 56, base = color ?? (big ? "#9af7ee" : "#f4efe2"), top = new THREE.Color(base).lerp(new THREE.Color(0xffffff), 0.55).getStyle(), low = new THREE.Color(base).multiplyScalar(0.78).getStyle();
    c.clearRect(0, 0, 256, 96); c.font = `900 ${fs}px "Avenir Next", "PingFang SC", system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
    c.lineWidth = big ? 12 : 10; c.strokeStyle = "rgba(4,8,10,0.92)"; c.strokeText(s, 128, 50);
    const g = c.createLinearGradient(0, 50 - fs * 0.45, 0, 50 + fs * 0.45); g.addColorStop(0, top); g.addColorStop(0.55, base); g.addColorStop(1, low); c.fillStyle = g; c.fillText(s, 128, 50);
    rec.tex.needsUpdate = true; };
  // 一摞一摞的伤害数字（第九轮 polish-lib）：key → 这个目标身上还在飘的数（新的在前）。lift 是被后来的数顶上去了几格，show 是画面上已经挪到的位置（缓过去，不跳）
  type Num = { rec: TextRec; key: number; t: number; life: number; x: number; y: number; z: number; dx: number; w: number; big: boolean; row: number; lift: number; show: number; v: number; s: string; color: string };
  const nums: Num[] = [], stacks = new Map<number, Num[]>(); let numSeq = 0;
  /** 一个数这一帧在哪、多大、多亮：先弹一下（放大再回落），往上飘一段，被顶上去的格子缓着挪过去，后四成时间淡掉 */
  const tickNum = (n: Num, dt: number) => {
    const k = n.t / n.life, sp = n.rec.sp, rise = n.w * 0.55 * (1 - Math.pow(1 - k, 2.2)); n.show += (n.lift - n.show) * (dt > 0 ? 1 - Math.exp(-dt * 22) : 1);
    sp.position.set(n.x + n.dx * Math.min(1, k * 3), n.y + 0.3 + rise + n.show, n.z);
    const pk = n.big ? 0.14 : 0.1, pop = k < pk ? 0.55 + (k / pk) * (n.big ? 0.7 : 0.5) : (n.big ? 1.25 : 1.05) - Math.min(n.big ? 0.25 : 0.05, (k - pk) * 2.2); sp.scale.set(n.w * pop, n.w * pop * 0.375, 1);
    sp.material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4; };
  const ringGeo = new THREE.RingGeometry(0.86, 1.0, 64); ringGeo.rotateX(-Math.PI / 2);
  const thinRing = new THREE.RingGeometry(0.955, 1.0, 72); thinRing.rotateX(-Math.PI / 2);
  // 骨链的贴图：一节一节的骨环，接缝是深色的
  const linkTex = canvasTex(64, 32, c => {
    c.clearRect(0, 0, 64, 32);
    for (const x0 of [0, 32]) { c.fillStyle = "#e9e2cf"; c.beginPath(); c.ellipse(x0 + 16, 16, 15, 9, 0, 0, 6.283); c.fill(); c.fillStyle = "rgba(0,0,0,1)"; c.globalCompositeOperation = "destination-out"; c.beginPath(); c.ellipse(x0 + 16, 16, 8, 3.2, 0, 0, 6.283); c.fill(); c.globalCompositeOperation = "source-over"; c.strokeStyle = "#7c7460"; c.lineWidth = 1.5; c.beginPath(); c.ellipse(x0 + 16, 16, 14.2, 8.2, 0, 0, 6.283); c.stroke(); }
  });
  linkTex.wrapS = THREE.RepeatWrapping;

  const fx: Fx = {
    group,
    update(dt) { for (let i = trails.length - 1; i >= 0; i--) if (!trails[i].tr.tick(dt)) { group.remove(trails[i].m); trails[i].m.geometry.dispose(); trails.splice(i, 1); }
      for (let i = live.length - 1; i >= 0; i--) { const l = live[i]; l.t += dt; if (l.t >= l.life) { group.remove(l.obj); live.splice(i, 1); l.back?.(); continue; } l.tick(l.t / l.life, dt); }
      for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; n.t += dt; if (n.t >= n.life) { group.remove(n.rec.sp); textFree.push(n.rec); nums.splice(i, 1); const st = stacks.get(n.key); if (st) { st.splice(st.indexOf(n), 1); if (!st.length) stacks.delete(n.key); } continue; } tickNum(n, dt); } },
    trail(big = false) {
      // 刀光：每一帧记下刀身的位置（护手和刀尖），把最近十几帧连成一条带子，越旧的越淡。跟着动作走，不会和挥刀对不上。
      // 带子横着分三道：刀尖那一道最亮、很窄，往里很快淡下去，护手那边是透明的。这样看到的是一道亮边，不是一把白扇子
      const N = 18, life = big ? 0.22 : 0.17, posA = new Float32Array(N * 3 * 3), colA = new Float32Array(N * 3 * 4), idx: number[] = [];
      for (let i = 0; i < N - 1; i++) { const k = i * 3; idx.push(k, k + 1, k + 3, k + 1, k + 4, k + 3, k + 1, k + 2, k + 4, k + 2, k + 5, k + 4); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(posA, 3)); g.setAttribute("color", new THREE.BufferAttribute(colA, 4)); g.setIndex(idx);
      const m = new THREE.Mesh(g, trailMat); m.frustumCulled = false; m.renderOrder = 6; group.add(m);
      const pts: { b: THREE.Vector3; t: THREE.Vector3; age: number }[] = []; let ended = false;
      // 第九轮：改成叠加发光，刀尖一道发白的亮边，往里是一层淡青的光，护手那边透明；越旧的越淡、颜色往深处退。原来是普通半透明的白带子，像一片塑料
      const ROWS: [number, number, number, number, number][] = [[0.0, 0.1, 0.3, 0.34, 0], FXB.on ? [0.62, 0.03, 0.36, 0.5, 0.42] : [0.62, 0.25, 0.55, 0.6, 0.3], [1.0, 1, 1, 1, big ? 1.0 : 0.85]];      // 沿刀身的位置、颜色、不透明度（B 下中间那一层是饱和一档的青，厚一点）
      const tr = { push(base: THREE.Vector3, tip: THREE.Vector3) { pts.unshift({ b: base.clone(), t: tip.clone(), age: 0 }); if (pts.length > N) pts.pop(); }, end() { ended = true; },
        tick(dt: number) { for (const p of pts) p.age += dt; while (pts.length && pts[pts.length - 1].age > life) pts.pop();
          for (let i = 0; i < N; i++) { const p = pts[Math.min(i, pts.length - 1)], a = p && i < pts.length ? Math.pow(1 - p.age / life, 1.6) : 0;
            for (let r = 0; r < 3; r++) { const [f, cr, cg, cb, ca] = ROWS[r], k = (i * 3 + r) * 3, c = (i * 3 + r) * 4;
              if (p) { posA[k] = p.b.x + (p.t.x - p.b.x) * f; posA[k + 1] = p.b.y + (p.t.y - p.b.y) * f; posA[k + 2] = p.b.z + (p.t.z - p.b.z) * f; }
              const fade = r === 2 ? a : a * a, cool = 1 - a; colA[c] = (cr * (1 - cool * 0.6)) * fade * ca; colA[c + 1] = (cg * (1 - cool * 0.25)) * fade * ca; colA[c + 2] = cb * fade * ca; colA[c + 3] = ca * fade; } }      /* 叠加发光：颜色本身乘上不透明度 */
          g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.setDrawRange(0, Math.max(0, pts.length - 1) * 12);
          return !(ended && pts.length === 0); } };
      trails.push({ tr, m }); return tr;
    },
    hit(pos, big = false, tint = 0x7fe9e4) {
      const g = new THREE.Group(); g.position.copy(pos); const cT = new THREE.Color(tint), cL = cT.clone().lerp(new THREE.Color(0xffffff), 0.78);
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: cL, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); g.add(flash);
      const bits: { s: THREE.Sprite; v: THREE.Vector3 }[] = [];
      for (let i = 0; i < (big ? 9 : 6); i++) { const a = Math.random() * 6.283, up = 0.2 + Math.random() * 0.9, v = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).multiplyScalar(3.2 + Math.random() * 3.5);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTex, color: i % 3 ? cL : cT, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, rotation: Math.atan2(v.y, Math.hypot(v.x, v.z)) })); s.scale.set(0.55, 0.14, 1); g.add(s); bits.push({ s, v }); }
      add(g, 0.3, (k, dt) => { flash.scale.setScalar((big ? 2.6 : 1.7) * (0.4 + k * 1.2)); flash.material.opacity = Math.max(0, 1 - k * 2.6); for (const b of bits) { b.s.position.addScaledVector(b.v, dt); b.v.y -= 9 * dt; b.s.material.opacity = 1 - k; } });
    },
    text(pos, s, big = false, color) {
      // 伤害数字（第九轮）：粗体、深色描边、上亮下暗的渐变；跳出来先放大一下再回落、往上飘、最后淡掉。暴击（big）大一号、多弹一下
      const rec = textRec(); paint(rec, s, big, color);
      const sp = rec.sp; sp.position.copy(pos); const y0 = pos.y, x0 = pos.x, w = big ? 2.3 : 1.8, dx = (Math.random() - 0.5) * 1.2, life = big ? 0.9 : 0.75;      /* x0 要记下来：pos 是调用的人反复用的那个向量，原来每帧读 pos.x，飘字会横着跳到别人身上 */
      live.push({ t: 0, life, obj: sp, tick: () => {}, back: () => textFree.push(rec) } as Live); group.add(sp);
      const L = live[live.length - 1]; L.tick = k => { sp.position.y = y0 + 0.4 + (big ? 1.5 : 1.25) * (1 - Math.pow(1 - k, 2.2)); sp.position.x = x0 + dx * k;
        const pk = big ? 0.14 : 0.1, pop = k < pk ? 0.55 + (k / pk) * (big ? 0.75 : 0.55) : (big ? 1.3 : 1.1) - Math.min(big ? 0.3 : 0.1, (k - pk) * 2.2); sp.scale.set(w * pop, w * pop * 0.375, 1); sp.material.opacity = k < 0.62 ? 1 : 1 - (k - 0.62) / 0.38; };
      L.tick(0, 0);
    },
    num(key, pos, v, o = {}) {
      // LoL 的做法：数字跳在目标身上、不跟着走；同一个目标连着挨几下，新数在最下面、旧数往上让一格（排成一摞，不叠成“1215163”）；
      // 一摞最多四个，第五个进来时最旧的那个赶紧淡掉。打小兵的小一号（w 1.1 对英雄的 1.6）。左右按次序轻轻错开一点，读起来像一串而不是一根柱子
      const big = !!o.big, color = o.color ?? (big ? "#9af7ee" : "#f4efe2"), s = typeof v === "number" ? String(Math.round(v)) : v, st = stacks.get(key) ?? [];
      const top = st[0];
      if (top && typeof v === "number" && top.v > 0 && top.t < 0.06 && top.color === color && top.big === big) { top.v += v; top.s = String(Math.round(top.v)); paint(top.rec, top.s, big, color); top.t = Math.min(top.t, 0.02); return; }      // 同一刻的两下（一个技能同时打中两次、普攻带出的被动）合成一个数
      const w = (o.small ? (big ? 1.35 : 1.1) : big ? 2.0 : 1.6), row = w * 0.27;
      for (const n of st) n.lift += Math.max(row, n.row);
      if (st.length >= 4) { const old = st[st.length - 1]; old.t = Math.max(old.t, old.life * 0.78); }
      const rec = textRec(); paint(rec, s, big, color); group.add(rec.sp);
      const side = numSeq++ % 2 ? 1 : -1, n: Num = { rec, key, t: 0, life: big ? 0.95 : 0.8, x: pos.x + (o.dx ?? 0), y: pos.y, z: pos.z, dx: side * w * 0.12 + (Math.random() - 0.5) * 0.12, w, big, row, lift: 0, show: 0, v: typeof v === "number" ? v : 0, s, color };
      st.unshift(n); stacks.set(key, st); nums.push(n); tickNum(n, 0);
    },
    ripple(pos, color = 0x7fe9e4, size = 2.6) {
      // 贴着地面散开的一圈细水纹：很淡，半秒就没了
      for (const delay of [0, 0.14]) { const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: 0 }); const m = new THREE.Mesh(thinRing, mat); m.position.copy(pos); m.position.y += 0.06; m.renderOrder = 4;
        add(m, 0.55 + delay, k => { const kk = Math.max(0, (k * (0.55 + delay) - delay) / 0.55); m.scale.setScalar(0.5 + size * (1 - Math.pow(1 - kk, 2.2))); mat.opacity = kk <= 0 ? 0 : 0.42 * (1 - kk) * (1 - kk); }); }
    },
    marker(pos, attack) {
      const mat = new THREE.MeshBasicMaterial({ color: attack ? 0xff6a55 : 0x7dffa6, transparent: true, depthWrite: false }); mat.userData.fowKeep = true; const m = new THREE.Mesh(ringGeo, mat);      /* 点地面的标记是玩家自己的操作反馈：点进迷雾里也要看得见 */ m.position.copy(pos); m.position.y += 0.07; m.renderOrder = 4;
      add(m, 0.45, k => { m.scale.setScalar(0.75 - 0.5 * k); mat.opacity = 0.9 * (1 - k); });
    },
    chain() {
      const mat = new THREE.MeshBasicMaterial({ map: linkTex.clone(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }); mat.map!.wrapS = THREE.RepeatWrapping; mat.map!.needsUpdate = true;
      const g = new THREE.Group(), geo = new THREE.PlaneGeometry(1, 1); geo.translate(0.5, 0, 0);
      const a = new THREE.Mesh(geo, mat), b = new THREE.Mesh(geo, mat); b.rotation.x = Math.PI / 2; g.add(a, b);
      const tip = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0x9af7ee, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 })); tip.scale.setScalar(0.9); group.add(tip);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 6), new THREE.MeshBasicMaterial({ color: 0xe9e2cf })); head.geometry.rotateZ(-Math.PI / 2); head.geometry.translate(0.25, 0, 0); g.add(head);
      group.add(g); const d = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
      return {
        set(from, to) { d.subVectors(to, from); const len = Math.max(0.01, d.length()); g.position.copy(from); g.quaternion.setFromUnitVectors(X, d.normalize()); a.scale.set(len, 0.3, 1); b.scale.set(len, 0.3, 1); mat.map!.repeat.set(len / 0.68, 1); head.position.x = len; tip.position.copy(to); },
        remove() { group.remove(g); group.remove(tip); mat.map!.dispose(); mat.dispose(); },
      };
    },
  };
  return fx;
}
