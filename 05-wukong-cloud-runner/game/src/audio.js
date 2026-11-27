// 音频引擎（WebAudio）。素材由 tools/make_game_audio.py 生成，放在 assets/audio/。
//
// 用法：
//   const audio = createAudio();
//   addEventListener('pointerdown', () => audio.init(), { once: true });   // 必须在第一次用户手势里调用
//   每帧：audio.update(dt, { speed, boost, nearMiss, inCloud, paused });
//   事件：audio.play('hoop');  audio.play('whoosh_pass', { volume: 0.8, pan: -0.6, rate: 1.1 });
//
// state：speed 米/秒（巡航 45、冲刺 120）；boost 0..1；nearMiss 0..1（离石峰很近时升高）；inCloud 0..1；paused 布尔。
// 单次音效名：boost flip whoosh_pass（随机取 _1.._3 之一）hoop hoop_combo_1..5 hit cloud_dive ui_click。
// 信号链：
//   风/披风循环、单次音效 → 云海低通 → 暂停增益 ┐
//   音乐床 → 音乐低通（云里略闷）→ 音乐增益 → 暂停增益 ┼→ 主音量 → 限幅压缩 → 输出
//   ui_click（不受云海和暂停影响）──────────────────┘
// 所有随状态变化的参数都用 setTargetAtTime 平滑过渡，不直接改 value，所以不会有爆音。

const LOOP_FILES = { wind_low: 'wind_low.wav', wind_high: 'wind_high.wav', cloth: 'cloth_loop.wav', music: 'music_bed.wav' };

// 单次音效：文件名（不带扩展名）→ 默认音量（play 的 volume 再乘上去）
const SFX_GAIN = {
  boost: 0.85, flip: 0.70, whoosh_pass_1: 0.75, whoosh_pass_2: 0.75, whoosh_pass_3: 0.75,
  hoop: 0.62, hoop_combo_1: 0.60, hoop_combo_2: 0.60, hoop_combo_3: 0.60, hoop_combo_4: 0.60, hoop_combo_5: 0.64,
  hit: 1.0, cloud_dive: 0.85, ui_click: 0.55,
};
const VARIANTS = { whoosh_pass: ['whoosh_pass_1', 'whoosh_pass_2', 'whoosh_pass_3'] };
const UI_SOUNDS = new Set(['ui_click']);

export const AUDIO_ASSETS = [...Object.values(LOOP_FILES), ...Object.keys(SFX_GAIN).map(n => n + '.wav')];

const MUSIC_LEVEL = 0.60;        // 音乐床相对音量
const MAX_VOICES = 20;           // 同时发声的单次音效上限
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * @param {{ base?: string, context?: BaseAudioContext, music?: boolean, master?: number }} [opts]
 *   base：素材目录 URL（默认 ../assets/audio/）；context：自带的 AudioContext / OfflineAudioContext（测试用）；
 *   music：初始是否开音乐（默认开）；master：初始主音量（默认 0.9）。
 */
export function createAudio(opts = {}) {
  const base = opts.base || new URL('../assets/audio/', import.meta.url).href;
  let ctx = null, initPromise = null;
  let master, limiter, pauseGain, cloudLP, worldBus, uiBus, musicLP, musicGain;
  const buffers = {};            // 名字 → AudioBuffer
  const loops = {};              // wind_low / wind_high / cloth / music → { src, lp, g }
  const voices = new Set();
  const lastPlay = {};
  const lastTarget = new Map();  // AudioParam → 上一次设的目标值（没变就不重复排事件）
  let musicOn = opts.music !== false, masterVol = opts.master ?? 0.9, clock = 0;

  const api = {
    ready: false,
    stats: [],                   // init 之后：[{ name, file, ok, duration, channels, sampleRate, error? }]
    init, update, play, setMusic, setMaster, dispose,
    get context() { return ctx; },
    get voiceCount() { return voices.size; },
    names: Object.keys(SFX_GAIN).concat(Object.keys(VARIANTS)),
  };

  // 平滑地把参数推向目标值。tau 是时间常数（秒），约 3×tau 后到位。
  function glide(param, value, tau) {
    if (!Number.isFinite(value)) return;
    const prev = lastTarget.get(param);
    if (prev !== undefined && Math.abs(prev - value) <= 1e-4 * Math.max(1, Math.abs(value))) return;
    lastTarget.set(param, value);
    param.setTargetAtTime(value, ctx.currentTime, tau);
  }

  function buildGraph() {
    master = ctx.createGain(); master.gain.value = masterVol;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.knee.value = 8; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.18;
    master.connect(limiter).connect(ctx.destination);
    pauseGain = ctx.createGain(); pauseGain.gain.value = 1; pauseGain.connect(master);
    cloudLP = ctx.createBiquadFilter(); cloudLP.type = 'lowpass'; cloudLP.frequency.value = 20000; cloudLP.Q.value = 0.6;
    worldBus = ctx.createGain(); worldBus.gain.value = 1;
    worldBus.connect(cloudLP).connect(pauseGain);
    musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 20000; musicLP.Q.value = 0.5;
    musicGain = ctx.createGain(); musicGain.gain.value = 0;
    musicLP.connect(musicGain).connect(pauseGain);
    uiBus = ctx.createGain(); uiBus.gain.value = 1; uiBus.connect(master);
  }

  function startLoop(key, dest) {
    const buf = buffers[key];
    if (!buf) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;                       // 从 0 淡入
    src.connect(lp).connect(g).connect(dest);
    src.start(0, key === 'music' ? 0 : Math.random() * buf.duration);    // 几条循环错开起点
    loops[key] = { src, lp, g };
  }

  async function load(name, file) {
    const rec = { name, file, ok: false, duration: 0, channels: 0, sampleRate: 0 };
    try {
      const res = await fetch(base + file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      buffers[name] = buf;
      Object.assign(rec, { ok: true, duration: buf.duration, channels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    } catch (e) {
      rec.error = String(e && e.message || e);
      console.warn('[audio] 素材加载失败：' + file + ' — ' + rec.error);       // 缺一条不影响其余
    }
    return rec;
  }

  /** 在第一次用户手势里调用：创建并唤醒 AudioContext，加载、解码全部素材，启动循环层。可重复调用。 */
  function init() {
    if (initPromise) return initPromise;
    if (opts.context) ctx = opts.context;
    else {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { initPromise = Promise.resolve([]); return initPromise; }
      try { ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); }   // 与素材同采样率，循环点不经过重采样
      catch (e) { ctx = new AC(); }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});    // 必须同步发生在手势回调里
    buildGraph();
    initPromise = (async () => {
      const jobs = [...Object.entries(LOOP_FILES).map(([k, f]) => load(k, f)), ...Object.keys(SFX_GAIN).map(n => load(n, n + '.wav'))];
      api.stats = await Promise.all(jobs);
      startLoop('wind_low', worldBus); startLoop('wind_high', worldBus); startLoop('cloth', worldBus); startLoop('music', musicLP);
      glide(musicGain.gain, musicOn ? MUSIC_LEVEL : 0, 0.8);
      api.ready = true;
      return api.stats;
    })();
    return initPromise;
  }

  /** 每帧调用。dt 秒；state 里缺的字段按巡航状态处理。 */
  function update(dt, state = {}) {
    if (!api.ready) return;
    clock += Math.max(0, dt || 0);
    const speed = Math.max(0, state.speed ?? 45), boost = clamp(state.boost ?? 0, 0, 1);
    const near = clamp(state.nearMiss ?? 0, 0, 1), cloud = clamp(state.inCloud ?? 0, 0, 1);
    const s = clamp((speed - 15) / 105, 0, 1);                           // 15 m/s → 0，120 m/s → 1（巡航 45 ≈ 0.29）
    const x = clamp(smoothstep(35, 112, speed) + 0.22 * boost, 0, 1);    // 低速风 → 高速风的交叉淡化
    // 两个互不成整数比的慢摆动，盖住循环素材自身的周期感
    const w1 = 1 + 0.07 * Math.sin(clock * 0.37 + 1.0) + 0.04 * Math.sin(clock * 0.83);
    const w2 = 1 + 0.06 * Math.sin(clock * 0.29 + 2.1) + 0.05 * Math.sin(clock * 0.71 + 0.4);
    const L = loops;
    if (L.wind_low) {
      glide(L.wind_low.g.gain, 0.62 * Math.cos(x * Math.PI / 2) * (0.45 + 0.55 * clamp(speed / 45, 0, 1)) * w1, 0.18);
      glide(L.wind_low.src.playbackRate, 0.86 + 0.30 * s, 0.30);                       // 越快音调越高
      glide(L.wind_low.lp.frequency, 1800 * Math.pow(2, 2.6 * s), 0.15);               // 越快越亮：1.8 k → 11 k
    }
    if (L.wind_high) {
      glide(L.wind_high.g.gain, (0.80 * Math.sin(x * Math.PI / 2) + 0.26 * near * (0.35 + 0.65 * x)) * w2, 0.14);
      glide(L.wind_high.src.playbackRate, 0.80 + 0.40 * s + 0.06 * boost + 0.05 * near, 0.25);
      glide(L.wind_high.lp.frequency, 3000 * Math.pow(2, 2.4 * s), 0.15);
    }
    if (L.cloth) {
      glide(L.cloth.g.gain, (0.16 + 0.44 * s + 0.08 * boost + 0.08 * near) * clamp(speed / 20, 0, 1), 0.20);
      glide(L.cloth.src.playbackRate, 0.80 + 0.62 * s, 0.30);                          // 越快抖得越急
      glide(L.cloth.lp.frequency, 2600 * Math.pow(2, 2.2 * s), 0.15);
    }
    // 云里：整体低通闷住，略微压低
    glide(cloudLP.frequency, 20000 * Math.pow(650 / 20000, cloud), 0.10);
    glide(worldBus.gain, 1 - 0.22 * cloud, 0.12);
    glide(musicLP.frequency, 20000 * Math.pow(1500 / 20000, cloud), 0.15);
    // 暂停：淡出；恢复：淡入
    glide(pauseGain.gain, state.paused ? 0 : 1, state.paused ? 0.06 : 0.12);
  }

  /**
   * 播放一个单次音效。volume 0..2（乘在该音效的默认音量上），pan −1..1，rate 0.25..4。
   * 返回 { stop() }；素材未就绪或名字不存在时返回 null。
   */
  function play(name, { volume = 1, pan = 0, rate = 1 } = {}) {
    if (!api.ready) return null;
    const list = VARIANTS[name];
    const key = list ? list[(Math.random() * list.length) | 0] : name;
    const buf = buffers[key];
    if (!buf || !(key in SFX_GAIN)) return null;
    if (!opts.context && ctx.state === 'suspended') ctx.resume().catch(() => {});    // 切回标签页后被浏览器挂起的情况
    const now = ctx.currentTime;
    if (lastPlay[key] !== undefined && now - lastPlay[key] < 0.03) return null;      // 同一帧重复触发只响一次
    lastPlay[key] = now;
    if (voices.size >= MAX_VOICES) voices.values().next().value.stop();             // 超限：最老的一个快速淡出
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = clamp(rate, 0.25, 4);
    const g = ctx.createGain(); g.gain.value = clamp(volume, 0, 2) * SFX_GAIN[key];
    let tail = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); tail = p; }
    src.connect(g); tail.connect(UI_SOUNDS.has(key) ? uiBus : worldBus);
    const voice = {
      stop() {
        if (!voices.delete(voice)) return;
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.012);
        try { src.stop(t + 0.08); } catch (e) { /* 已经结束 */ }
      },
    };
    src.onended = () => { voices.delete(voice); try { tail.disconnect(); } catch (e) { /* noop */ } };
    voices.add(voice);
    src.start(now);
    return voice;
  }

  /** 开/关音乐床（淡入淡出约 1 秒）。init 之前调用也有效。 */
  function setMusic(on) {
    musicOn = !!on;
    if (api.ready) glide(musicGain.gain, musicOn ? MUSIC_LEVEL : 0, 0.35);
  }

  /** 主音量 0..1。init 之前调用也有效。 */
  function setMaster(v) {
    masterVol = clamp(Number(v) || 0, 0, 1.5);
    if (master) glide(master.gain, masterVol, 0.05);
  }

  /** 停掉全部声音并关闭 AudioContext（自带 context 的不关）。 */
  function dispose() {
    api.ready = false;
    for (const k of Object.keys(loops)) { try { loops[k].src.stop(); } catch (e) { /* noop */ } delete loops[k]; }
    for (const v of [...voices]) v.stop();
    if (ctx && !opts.context && ctx.close) ctx.close().catch(() => {});
  }

  return api;
}
