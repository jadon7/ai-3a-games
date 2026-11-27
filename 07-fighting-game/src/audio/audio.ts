/**
 * 游戏音频系统：音效 + 配乐 + 环境声。全部音频是程序化合成好的 m4a（见 tools/audio/），
 * 运行时按 public/assets/audio/manifest.json 预载和解码。
 *
 * 规则：没载入完、名字不存在、AudioContext 没解锁时一律静默忽略，任何方法都不抛错。
 */

export interface PlayOpts { volume?: number; rate?: number; pan?: number; delay?: number }

/** loop() 返回的句柄（火球、冰刃飞行这类需要持续发声再停下的）。 */
export interface LoopHandle {
  stop(fade?: number): void;
  setPan(pan: number): void;
  setVolume(v: number): void;
}

type MusicName = 'menu' | 'battle' | 'victory';
type Group = 'master' | 'sfx' | 'music';

interface Manifest {
  sfx: Record<string, string[]>;
  music: Record<string, { file: string; loop: boolean; loopSec: number | null; loopSamples: number | null; sr: number }>;
  loops?: string[];
}

interface Track { buf: AudioBuffer; loop: boolean; loopEnd: number }
interface Voice { src: AudioBufferSourceNode; out: GainNode; name: string; baseRate: number; t0: number; ended: boolean }
interface Playing { name: string; src: AudioBufferSourceNode; gain: GainNode }

const BASE = '/assets/audio/';
const NOOP_LOOP: LoopHandle = { stop() {}, setPan() {}, setVolume() {} };
const MAX_PER_NAME = 4;
const MAX_VOICES = 40;
const PITCH_JITTER = 0.06; // ±3%

const clamp = (v: number, a: number, b: number) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private musicLP: BiquadFilterNode | null = null;
  private ambBus: GainNode | null = null;

  private sfx = new Map<string, AudioBuffer[]>();
  private loopNames = new Set<string>(['fire_fly', 'frost_fly']);
  private tracks = new Map<string, Track>();
  private lastIdx = new Map<string, number>();
  private voices: Voice[] = [];
  private loopsActive = new Set<{ src: AudioBufferSourceNode; baseRate: number }>();

  private cur: Playing | null = null;
  private wantMusic: MusicName | null = null;
  private wantFade = 1.2;
  private amb: Playing | null = null;
  private wantAmb = false;

  private timeScale = 1;
  private vols: Record<Group, number> = { master: 1, sfx: 1, music: 0.7 };
  private initP: Promise<void> | null = null;

  // ---------------------------------------------------------------- 公共接口

  /** 预载全部音频。可以在用户点击之前调用（只下载和解码，不出声）。永不 reject。 */
  init(): Promise<void> {
    if (!this.initP) this.initP = this.doInit().catch(() => {});
    return this.initP;
  }

  /** 用户第一次点击或按键时调用，恢复 AudioContext。 */
  unlock(): void {
    try {
      if (!this.ctx) this.createGraph();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running') {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(() => this.applyAll(), () => {});
      }
      // iOS：放一个静音缓冲才能真正解锁
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      this.applyAll();
    } catch { /* 静默 */ }
  }

  /** 播一个音效。同名多个变体时随机挑一个并做一点音高随机。pan：-1 左、1 右。 */
  play(name: string, opts?: PlayOpts): void {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !this.sfxBus) return;
      const bufs = this.sfx.get(name);
      if (!bufs || bufs.length === 0) return;
      const buf = bufs[this.pickIdx(name, bufs.length)];
      const volume = clamp(opts?.volume ?? 1, 0, 4);
      if (volume <= 0) return;
      const userRate = clamp(opts?.rate ?? 1, 0.25, 4);
      const baseRate = userRate * (1 + (Math.random() - 0.5) * PITCH_JITTER);
      const when = ctx.currentTime + clamp(opts?.delay ?? 0, 0, 10);

      this.reapVoices();
      this.limitVoices(name);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = baseRate * this.sfxPitch();
      const out = ctx.createGain();
      out.gain.value = volume;
      if (this.loopNames.has(name)) {
        // 循环素材首尾没有淡化：单次播放时补一个包络，防爆音
        const d = buf.duration / Math.max(0.01, src.playbackRate.value);
        out.gain.setValueAtTime(0, when);
        out.gain.linearRampToValueAtTime(volume, when + 0.015);
        out.gain.setValueAtTime(volume, when + Math.max(0.02, d - 0.08));
        out.gain.linearRampToValueAtTime(0, when + d);
      }
      src.connect(out);
      this.connectPan(out, opts?.pan, this.sfxBus);
      const v: Voice = { src, out, name, baseRate, t0: when, ended: false };
      src.onended = () => {
        v.ended = true;
        try { out.disconnect(); } catch { /* */ }
      };
      src.start(when);
      this.voices.push(v);
    } catch { /* 静默 */ }
  }

  /**
   * 额外接口（新增，不影响原有签名）：循环播放一个音效（fire_fly / frost_fly），返回句柄用于停止。
   * 不可用时返回空句柄。
   */
  loop(name: string, opts?: PlayOpts): LoopHandle {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running' || !this.sfxBus) return NOOP_LOOP;
      const bufs = this.sfx.get(name);
      if (!bufs || bufs.length === 0) return NOOP_LOOP;
      const src = ctx.createBufferSource();
      src.buffer = bufs[0];
      src.loop = true;
      const baseRate = clamp(opts?.rate ?? 1, 0.25, 4);
      src.playbackRate.value = baseRate * this.sfxPitch();
      const out = ctx.createGain();
      const vol = clamp(opts?.volume ?? 1, 0, 4);
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.06);
      src.connect(out);
      const panner = this.connectPan(out, opts?.pan ?? 0, this.sfxBus);
      // 随机起点，避免多个同时循环时相位一致
      src.start(ctx.currentTime + clamp(opts?.delay ?? 0, 0, 10), Math.random() * bufs[0].duration);
      const entry = { src, baseRate };
      this.loopsActive.add(entry);
      let stopped = false;
      return {
        stop: (fade = 0.12) => {
          if (stopped) return;
          stopped = true;
          try {
            const t = ctx.currentTime;
            const f = clamp(fade, 0.005, 5);
            out.gain.cancelScheduledValues(t);
            out.gain.setValueAtTime(out.gain.value, t);
            out.gain.linearRampToValueAtTime(0, t + f);
            src.stop(t + f + 0.02);
            src.onended = () => { try { out.disconnect(); } catch { /* */ } };
          } catch { /* */ }
          this.loopsActive.delete(entry);
        },
        setPan: (p: number) => {
          try { if (panner) panner.pan.setTargetAtTime(clamp(p, -1, 1), ctx.currentTime, 0.02); } catch { /* */ }
        },
        setVolume: (v: number) => {
          try { out.gain.setTargetAtTime(clamp(v, 0, 4), ctx.currentTime, 0.03); } catch { /* */ }
        },
      };
    } catch {
      return NOOP_LOOP;
    }
  }

  /** 切配乐（交叉淡化）。null 是停。没解锁或没载入时记住，就绪后自动开始。 */
  music(name: 'menu' | 'battle' | 'victory' | null, fade?: number): void {
    try {
      this.wantMusic = name === 'menu' || name === 'battle' || name === 'victory' ? name : null;
      this.wantFade = clamp(fade ?? 1.2, 0, 10);
      this.applyMusic();
    } catch { /* 静默 */ }
  }

  /** 环境声循环开关（风雪 + 火盆噼啪）。 */
  ambience(on: boolean): void {
    try {
      this.wantAmb = !!on;
      this.applyAmb();
    } catch { /* 静默 */ }
  }

  /** 总音量 0..1；分组音量。 */
  setVolume(group: 'master' | 'sfx' | 'music', v: number): void {
    try {
      if (!(group in this.vols) || !Number.isFinite(v)) return;
      this.vols[group] = clamp(v, 0, 1);
      this.applyVolumes();
    } catch { /* 静默 */ }
  }

  /** 慢动作：rate 是游戏时间倍率（1 正常，0.2 很慢）。音效降调，配乐轻微降调并低通变闷。 */
  setTimeScale(rate: number): void {
    try {
      if (!Number.isFinite(rate)) return;
      const r = clamp(rate, 0.02, 2);
      if (Math.abs(r - this.timeScale) < 1e-4) return;
      this.timeScale = r;
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const p = this.sfxPitch();
      for (const v of this.voices) {
        if (!v.ended) v.src.playbackRate.setTargetAtTime(v.baseRate * p, t, 0.03);
      }
      for (const l of this.loopsActive) l.src.playbackRate.setTargetAtTime(l.baseRate * p, t, 0.03);
      const mr = this.musicRate();
      if (this.cur) this.cur.src.playbackRate.setTargetAtTime(mr, t, 0.08);
      if (this.musicLP) this.musicLP.frequency.setTargetAtTime(this.musicCutoff(), t, 0.06);
    } catch { /* 静默 */ }
  }

  /** 大招定格：配乐在 30ms 内压低 amount（0..1），保持约一半时间，再在剩余时间里放开。 */
  duck(amount: number, seconds: number): void {
    try {
      const ctx = this.ctx;
      const g = this.duckGain?.gain;
      if (!ctx || !g) return;
      const a = clamp(amount, 0, 1);
      const s = clamp(seconds, 0.06, 30);
      const t = ctx.currentTime;
      const low = Math.max(0.0001, 1 - a);
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(low, t + 0.03);
      g.setValueAtTime(low, t + 0.03 + (s - 0.03) * 0.5);
      g.linearRampToValueAtTime(1, t + s);
    } catch { /* 静默 */ }
  }

  // ---------------------------------------------------------------- 内部

  private createGraph(): void {
    if (this.ctx) return;
    const AC: typeof AudioContext | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    // 用 44.1k 和素材一致：解码不重采样，循环点落在整数样本上
    try {
      ctx = new AC({ latencyHint: 'interactive', sampleRate: 44100 });
    } catch {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    }
    this.ctx = ctx;
    // 总线：sfx / music(-> duck -> 低通) / ambience(-> sfx) -> master -> 安全限幅 -> 输出
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.Q.value = 0.5;
    this.musicLP.frequency.value = this.musicCutoff();
    this.musicLP.connect(this.master);
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.musicLP);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.duckGain);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 0.9;
    this.ambBus.connect(this.sfxBus);
    this.applyVolumes();
    try {
      ctx.addEventListener('statechange', () => this.applyAll());
    } catch { /* */ }
  }

  private async doInit(): Promise<void> {
    this.createGraph();
    const ctx = this.ctx;
    if (!ctx) return;
    let man: Manifest;
    try {
      const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      man = (await r.json()) as Manifest;
      if (Array.isArray(man.loops)) man.loops.forEach((n) => this.loopNames.add(n));
    } catch {
      return;
    }
    const jobs: Array<() => Promise<void>> = [];
    // 先排配乐和环境声以外的短音效，再排配乐（大文件）
    for (const [name, files] of Object.entries(man.sfx ?? {})) {
      files.forEach((f, i) => jobs.push(async () => {
        const buf = await this.fetchDecode(f);
        if (!buf) return;
        const arr = this.sfx.get(name) ?? [];
        arr[i] = buf;
        this.sfx.set(name, arr);
      }));
    }
    for (const [key, m] of Object.entries(man.music ?? {})) {
      jobs.push(async () => {
        const buf = await this.fetchDecode(m.file);
        if (!buf) return;
        const loopEnd = m.loop && m.loopSamples ? Math.min(buf.duration, m.loopSamples / (m.sr || 44100)) : buf.duration;
        this.tracks.set(key, { buf, loop: !!m.loop, loopEnd });
        this.applyAll();
      });
    }
    let k = 0;
    const worker = async () => {
      while (k < jobs.length) {
        const j = jobs[k++];
        try { await j(); } catch { /* */ }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    // 变体数组里可能有空洞（个别文件失败），压实
    for (const [name, arr] of this.sfx) this.sfx.set(name, arr.filter(Boolean));
  }

  private async fetchDecode(file: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      const r = await fetch(BASE + file);
      if (!r.ok) return null;
      const data = await r.arrayBuffer();
      return await new Promise<AudioBuffer | null>((res) => {
        try {
          const p = ctx.decodeAudioData(data, (b) => res(b), () => res(null));
          if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(() => res(null));
        } catch {
          res(null);
        }
      });
    } catch {
      return null;
    }
  }

  private applyAll(): void {
    this.applyMusic();
    this.applyAmb();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(this.vols.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.vols.music, t, 0.02);
  }

  private applyMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.musicBus) return;
    const want = this.wantMusic;
    if (this.cur && this.cur.name === want) return;
    const fade = this.wantFade;
    const t = ctx.currentTime;
    const next = want ? this.tracks.get('music_' + want) : undefined;
    if (want && !next) {
      // 还没载入：先把旧的淡出，载入后再来
      this.fadeOut(this.cur, fade);
      this.cur = null;
      return;
    }
    this.fadeOut(this.cur, fade);
    this.cur = null;
    if (!want || !next) return;
    const src = ctx.createBufferSource();
    src.buffer = next.buf;
    src.loop = next.loop;
    if (next.loop) {
      src.loopStart = 0;
      src.loopEnd = next.loopEnd;
    }
    src.playbackRate.value = this.musicRate();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + Math.max(0.01, fade));
    src.connect(gain).connect(this.musicBus);
    src.start(t);
    const playing: Playing = { name: want, src, gain };
    src.onended = () => {
      try { gain.disconnect(); } catch { /* */ }
      if (this.cur === playing) this.cur = null; // 胜利曲放完：保持 wantMusic，不自动重播
    };
    this.cur = playing;
  }

  private applyAmb(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.ambBus) return;
    if (!this.wantAmb) {
      this.fadeOut(this.amb, 1.5);
      this.amb = null;
      return;
    }
    if (this.amb) return;
    const tr = this.tracks.get('amb_snow');
    if (!tr) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = tr.buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = tr.loopEnd;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 2);
    src.connect(gain).connect(this.ambBus);
    src.start(t, Math.random() * tr.loopEnd * 0.9);
    this.amb = { name: 'amb_snow', src, gain };
  }

  private fadeOut(p: Playing | null, fade: number): void {
    const ctx = this.ctx;
    if (!p || !ctx) return;
    try {
      const t = ctx.currentTime;
      const f = Math.max(0.02, fade);
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setValueAtTime(p.gain.gain.value, t);
      p.gain.gain.linearRampToValueAtTime(0, t + f);
      p.src.stop(t + f + 0.05);
    } catch { /* */ }
  }

  private connectPan(node: AudioNode, pan: number | undefined, dest: AudioNode): StereoPannerNode | null {
    const ctx = this.ctx!;
    if (pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p).connect(dest);
      return p;
    }
    node.connect(dest);
    return null;
  }

  private pickIdx(name: string, n: number): number {
    if (n <= 1) return 0;
    const last = this.lastIdx.get(name) ?? -1;
    let i = Math.floor(Math.random() * n);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.lastIdx.set(name, i);
    return i;
  }

  private reapVoices(): void {
    if (this.voices.length > 16) this.voices = this.voices.filter((v) => !v.ended);
  }

  /** 同名最多 MAX_PER_NAME 个、总共最多 MAX_VOICES 个，超出时快速淡出最老的。 */
  private limitVoices(name: string): void {
    const ctx = this.ctx!;
    const kill = (v: Voice) => {
      try {
        const t = ctx.currentTime;
        v.out.gain.cancelScheduledValues(t);
        v.out.gain.setValueAtTime(v.out.gain.value, t);
        v.out.gain.linearRampToValueAtTime(0, t + 0.03);
        v.src.stop(t + 0.04);
      } catch { /* */ }
      v.ended = true;
    };
    const same = this.voices.filter((v) => !v.ended && v.name === name);
    while (same.length >= MAX_PER_NAME) kill(same.shift()!);
    const live = this.voices.filter((v) => !v.ended);
    while (live.length >= MAX_VOICES) kill(live.shift()!);
  }

  /** 音效的慢动作降调：0.2 倍速时约降到 0.57（约低 10 个半音），不至于完全变成闷声。 */
  private sfxPitch(): number {
    return Math.pow(Math.min(1, this.timeScale), 0.35);
  }

  private musicRate(): number {
    return Math.pow(Math.min(1, this.timeScale), 0.12);
  }

  private musicCutoff(): number {
    const s = Math.min(1, this.timeScale);
    return 700 * Math.pow(20000 / 700, s);
  }
}
