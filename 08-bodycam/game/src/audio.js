// 声音：所有音效先进"记录仪麦克风"链路 —— 空旷房间混响 → 自动增益（枪响后环境声被压低再慢慢回来）→ 削波失真 → 窄频带。
const FILES = ['pistol_0', 'pistol_1', 'pistol_2', 'pistol_3', 'rifle_0', 'rifle_1', 'rifle_2', 'rifle_3', 'snap_0', 'snap_1', 'snap_2',
  'impact_0', 'impact_1', 'impact_2', 'impact_3', 'casing_0', 'casing_1', 'casing_2', 'casing_3', 'step_0', 'step_1', 'step_2', 'step_3', 'step_4', 'step_5',
  'bodyfall_0', 'bodyfall_1', 'rifledrop', 'splash_0', 'splash_1', 'splash_2', 'plop', 'water', 'mag_out', 'mag_in', 'slide', 'dry', 'thud', 'breath_in', 'breath_out', 'gasp', 'tone', 'rustle', 'ir'];

const VOL = 0.9;

export class Audio {
  constructor() { this.buf = {}; this.ready = false; this.stress = 0; this.nextBreath = 0; this.holdUntil = 0; }

  async init(offlineCtx) {         // offlineCtx：离线渲染自检用
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = this.ctx = offlineCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    await Promise.all(FILES.map(async (n) => {
      const ab = await (await fetch(`./assets/sfx/${n}.wav`)).arrayBuffer();
      this.buf[n] = await ctx.decodeAudioData(ab);
    }));
    // 总线
    this.dry = ctx.createGain(); this.send = ctx.createGain(); this.mix = ctx.createGain();
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = this.buf.ir;
    const wet = ctx.createGain(); wet.gain.value = 2.2;
    this.send.connect(conv); conv.connect(wet); wet.connect(this.mix); this.dry.connect(this.mix);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    const agc = ctx.createDynamicsCompressor(); agc.threshold.value = -18; agc.knee.value = 0; agc.ratio.value = 20; agc.attack.value = 0.005; agc.release.value = 0.5;
    const pre = ctx.createGain(); pre.gain.value = 2.0;
    const shaper = ctx.createWaveShaper(); const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3.0) * 0.92; }
    shaper.curve = curve; shaper.oversample = '2x';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200; lp.Q.value = 0.7;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2600; pk.Q.value = 0.9; pk.gain.value = 3;
    // 中频提升之后再过一道软限幅，保证输出不会数字削顶（和影片音轨的最后一步相同）
    const shaper2 = ctx.createWaveShaper(); const curve2 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 4 - 2; curve2[i] = Math.tanh(x * 1.15); }
    const pad = ctx.createGain(); pad.gain.value = 0.5; shaper2.curve = curve2;        // WaveShaper 的输入范围是 ±1，这里先缩一半、曲线按 ±2 画
    this.master = ctx.createGain(); this.master.gain.value = VOL;
    this.duck = ctx.createBiquadFilter(); this.duck.type = 'lowpass'; this.duck.frequency.value = 20000; this.duck.Q.value = 0.5;
    this.mix.connect(this.duck); this.duck.connect(hp); hp.connect(agc); agc.connect(pre); pre.connect(shaper); shaper.connect(lp); lp.connect(pk); pk.connect(pad); pad.connect(shaper2); shaper2.connect(this.master); this.master.connect(ctx.destination);
    // 循环底噪
    const tone = ctx.createBufferSource(); tone.buffer = this.buf.tone; tone.loop = true; const tg = ctx.createGain(); tg.gain.value = 0.02; tone.connect(tg); tg.connect(this.dry); tone.start();
    const wat = ctx.createBufferSource(); wat.buffer = this.buf.water; wat.loop = true; this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0; wat.connect(this.waterGain); this.waterGain.connect(this.dry); const ww = ctx.createGain(); ww.gain.value = 0.6; this.waterGain.connect(ww); ww.connect(this.send); wat.start();      // 池核里的水声底噪
    const rus = ctx.createBufferSource(); rus.buffer = this.buf.rustle; rus.loop = true; this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0; rus.connect(this.rustleGain); this.rustleGain.connect(this.dry); rus.start();
    this.ready = true;
  }

  play(name, o = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, b = this.buf[name]; if (!b) return;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = o.rate ?? (0.97 + Math.random() * 0.06);
    const g = ctx.createGain(); g.gain.value = o.gain ?? 1;
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    s.connect(g); g.connect(p); p.connect(this.dry);
    const w = ctx.createGain(); w.gain.value = (o.wet ?? 0.3) * (1 + 0.9 * (this.poolK || 0)); p.connect(w); w.connect(this.send);      // 铺满瓷砖的泳池里回声更重
    s.start(ctx.currentTime + (o.delay ?? 0));
  }
  rnd(prefix, n, o) { this.play(`${prefix}_${Math.floor(Math.random() * n)}`, o); }

  // 每帧：衣物摩擦跟转头速度走；呼吸跟紧张程度走，开枪时屏气
  update(dt, angSpeedDeg, speed, stress, alive) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const env = Math.min(1.6, Math.pow(Math.min(angSpeedDeg / 105, 1.6), 1.2) + 0.25 * Math.min(speed, 1));
    this.rustleGain.gain.setTargetAtTime(env * 0.05, t, 0.03);
    if (alive && t >= this.nextBreath && t >= this.holdUntil) {
      const dur = stress > 0.5 ? 1.05 + Math.random() * 0.3 : (stress > 0.15 ? 1.4 + Math.random() * 0.4 : 2.6 + Math.random() * 0.6);
      const g = stress > 0.5 ? 0.022 : (stress > 0.15 ? 0.016 : 0.005);
      this.play('breath_in', { gain: g * 0.7, wet: 0, rate: 1 }); this.play('breath_out', { gain: g, wet: 0, delay: dur * 0.42, rate: 1 });
      this.nextBreath = t + dur;
    }
  }
  // 闪光弹：一声巨响；被晃到的话之后几秒耳鸣、其它声音发闷
  bang(dist, los, k) {
    if (!this.ready) return;
    const g = Math.min(1.6, 7 / Math.max(dist, 1.5)) * (los ? 1 : 0.55);
    this.play('rifle_1', { gain: 16 * g, wet: 1.0, rate: 0.5, delay: dist / 343 }); this.play('pistol_2', { gain: 12 * g, wet: 1.0, rate: 0.62, delay: dist / 343 }); this.play('impact_0', { gain: 6 * g, wet: 1.0, rate: 0.5, delay: dist / 343 + 0.02 });
    if (k > 0.15) {
      const ctx = this.ctx, t = ctx.currentTime + dist / 343, dur = 1.5 + 3.5 * k;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4150; const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 6230;
      const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.05 * k, t + 0.05); gg.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      const g2 = ctx.createGain(); g2.gain.value = 0.4; o.connect(gg); o2.connect(g2); g2.connect(gg); gg.connect(this.master); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
      this.duck.frequency.cancelScheduledValues(t); this.duck.frequency.setValueAtTime(20000, t); this.duck.frequency.exponentialRampToValueAtTime(Math.max(500, 2600 - 2000 * k), t + 0.06); this.duck.frequency.exponentialRampToValueAtTime(20000, t + dur);
    }
  }
  // k：离池核有多近（0 不在，1 在里面）。水声底噪跟着渐入，所有声音的混响加重
  setPool(k) { this.poolK = k; if (this.ready) this.waterGain.gain.setTargetAtTime(0.03 * k, this.ctx.currentTime, 0.4); }
  holdBreath(sec) { if (this.ready) this.holdUntil = this.ctx.currentTime + sec; }
  cut(sec) { if (!this.ready || this.muted) return; const t = this.ctx.currentTime; this.master.gain.setValueAtTime(0, t); this.master.gain.setValueAtTime(VOL, t + sec); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : VOL; }
}
