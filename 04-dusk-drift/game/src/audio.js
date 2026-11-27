// 声音：全部用 Web Audio 程序合成（引擎、轮胎尖叫、风噪、越野路噪、碰撞、对手车、倒计时提示音）
import { FIRES } from './physics.js';
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

export class GameAudio {
  constructor() {
    this.ctx = null; this.muted = false; this.lastHit = 9;
    const wake = () => this.unlock();
    window.addEventListener('keydown', wake, { once: false }); window.addEventListener('pointerdown', wake, { once: false });
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain(); master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    // 白噪声素材
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const shaper = (k) => { const w = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } w.curve = c; w.oversample = '2x'; return w; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };

    // ---------- 引擎 ----------
    const mkEngine = (vol) => {
      const e = { o: [osc('sawtooth', 60), osc('sawtooth', 60.7), osc('square', 30), osc('sawtooth', 120)], g: [gain(0.5), gain(0.4), gain(0.42), gain(0.16)] };
      const pre = gain(1); e.o.forEach((o, i) => { o.connect(e.g[i]); e.g[i].connect(pre); });
      // 进气 / 排气的粗糙感：噪声调幅
      const rasp = gain(0); const nz = noise(); const nf = filt('bandpass', 900, 0.8); nz.connect(nf); nf.connect(rasp); rasp.connect(pre); e.rasp = rasp; e.raspF = nf;
      e.shape = shaper(2.6); e.lp = filt('lowpass', 1200, 1.2); e.peak = filt('peaking', 420, 1.4); e.peak.gain.value = 7; e.out = gain(0); e.vol = vol;
      pre.connect(e.shape); e.shape.connect(e.peak); e.peak.connect(e.lp); e.lp.connect(e.out); e.out.connect(master);
      return e;
    };
    this.engine = mkEngine(0.42);
    this.rivals = [mkEngine(0.3), mkEngine(0.3)];
    // ---------- 轮胎尖叫 ----------
    { const n = noise(), b1 = filt('bandpass', 1050, 7), b2 = filt('bandpass', 1650, 9), g = gain(0); n.connect(b1); n.connect(b2); b1.connect(g); b2.connect(g);
      const o = osc('sawtooth', 880), ob = filt('bandpass', 900, 5), og = gain(0); o.connect(ob); ob.connect(og); og.connect(master); g.connect(master);
      const lfo = osc('sine', 9), lg = gain(40); lfo.connect(lg); lg.connect(o.frequency);
      this.squeal = { g, og, b1, b2, o, ob }; }
    // ---------- 风噪与路噪 ----------
    { const n = noise(), f = filt('lowpass', 500, 0.6), g = gain(0); n.connect(f); f.connect(g); g.connect(master); this.wind = { f, g }; }
    { const n = noise(), f = filt('lowpass', 220, 1.2), g = gain(0); n.connect(f); f.connect(g); g.connect(master); this.rumble = { f, g }; }
    { const n = noise(), f = filt('bandpass', 2400, 0.9), g = gain(0); n.connect(f); f.connect(g); g.connect(master); this.spray = { f, g }; }
    this.noiseSrc = noise; this.mk = { gain, filt, osc };
  }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.03); }
  beep(freq, dur) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime; o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.01); g.gain.setValueAtTime(0.22, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  thump(mag) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return; const t = ctx.currentTime, k = clamp(mag / 10, 0.15, 1);
    const n = this.noiseSrc(), f = this.mk.filt('lowpass', 900 + 2200 * k, 0.8), g = this.mk.gain(0);
    g.gain.setValueAtTime(0.55 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28); n.connect(f); f.connect(g); g.connect(this.master); n.stop(t + 0.3);
    const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    og.gain.setValueAtTime(0.6 * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.27);
  }
  setEngine(e, car, vol, pitchMul, t) {
    const cyl = FIRES[car.specName] || 3;                            // 每转点火次数：四缸 2 次，六缸 3 次，V8 4 次，十二缸 6 次
    const f = car.rpm / 60 * cyl * 0.5 * pitchMul, load = car.throttle, tc = 0.035;
    e.o[0].frequency.setTargetAtTime(f, t, tc); e.o[1].frequency.setTargetAtTime(f * 1.012, t, tc); e.o[2].frequency.setTargetAtTime(f * 0.5, t, tc); e.o[3].frequency.setTargetAtTime(f * 2, t, tc);
    const r = clamp(car.rpm / car.spec.redline, 0, 1.05);
    e.lp.frequency.setTargetAtTime(500 + 2300 * r * r + 2600 * load * r, t, 0.05);
    e.peak.frequency.setTargetAtTime(280 + f * 1.6, t, 0.05);
    e.rasp.gain.setTargetAtTime(0.25 * load * r, t, 0.05); e.raspF.frequency.setTargetAtTime(500 + f * 3, t, 0.05);
    const cut = car.limiter > 0 ? 0.45 : 1;
    e.out.gain.setTargetAtTime(vol * (0.22 + 0.42 * r + 0.42 * load) * cut, t, car.limiter > 0 ? 0.008 : 0.04);
  }
  update(dt, car, state, entries, camera) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, v = car.speed, live = state !== 'pause';
    const scene = state === 'menu' ? 0.35 : 1;
    this.setEngine(this.engine, car, live ? this.engine.vol * scene : 0, 1, t);
    // 最近的两台对手车：按距离衰减，带多普勒
    const others = entries.filter(e => e.car !== car).map(e => ({ e, d: Math.hypot(e.car.x - car.x, e.car.y - car.y) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.rivals.length; i++) {
      const o = others[i], rv = this.rivals[i];
      if (!o || !live) { rv.out.gain.setTargetAtTime(0, t, 0.05); continue; }
      const oc = o.e.car, dx = oc.x - car.x, dy = oc.y - car.y, d = Math.max(1, o.d);
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw), ocy = Math.cos(oc.yaw), osy = Math.sin(oc.yaw);
      const rvx = (oc.vx * ocy - oc.vy * osy) - (car.vx * cy - car.vy * sy), rvy = (oc.vx * osy + oc.vy * ocy) - (car.vx * sy + car.vy * cy);
      const closing = -(rvx * dx + rvy * dy) / d;                    // 正值 = 在靠近
      this.setEngine(rv, oc, rv.vol * scene * clamp(7 / (d + 4), 0, 1), clamp(1 + closing / 340, 0.85, 1.18), t);
    }
    // 轮胎
    let slide = 0, off = 0, wet = 0;
    for (const w of car.wheels) { if (w.surf <= 1) slide += w.slide; else off++; wet += w.wet; }
    const sq = clamp((slide / 4 - 1.2) / 9, 0, 1) * (live ? 1 : 0);
    this.squeal.g.gain.setTargetAtTime(0.5 * sq, t, 0.05); this.squeal.og.gain.setTargetAtTime(0.11 * sq, t, 0.05);
    const pf = 820 + 360 * clamp(v / 45, 0, 1) + 120 * sq;
    this.squeal.o.frequency.setTargetAtTime(pf, t, 0.08); this.squeal.ob.frequency.setTargetAtTime(pf, t, 0.08); this.squeal.b1.frequency.setTargetAtTime(pf * 1.2, t, 0.08); this.squeal.b2.frequency.setTargetAtTime(pf * 1.9, t, 0.08);
    const sp = clamp(v / 70, 0, 1.2);
    this.wind.g.gain.setTargetAtTime(live ? 0.26 * sp * sp : 0, t, 0.1); this.wind.f.frequency.setTargetAtTime(300 + 900 * sp, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(live ? clamp(off / 4, 0, 1) * clamp(v / 25, 0, 1) * 0.75 + 0.05 * sp : 0, t, 0.06);
    this.spray.g.gain.setTargetAtTime(live ? clamp(wet / 4, 0, 1) * clamp(v / 40, 0, 1) * 0.12 : 0, t, 0.08);
    // 碰撞
    if (car.hitT < this.lastHit && car.hitT < 0.05 && car.hitMag > 1) this.thump(car.hitMag);
    this.lastHit = car.hitT;
  }
}
