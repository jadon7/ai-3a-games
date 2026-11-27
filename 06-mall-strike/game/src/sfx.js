/**
 * sfx.js - real-time WebAudio player for the mall-FPS sound library in game/assets/sfx
 * (rendered by scripts/export_sfx.py from the same DSP as the video soundtrack, scripts/audio.py).
 * ES module, no dependencies.
 *
 * Routing (mirrors audio.py's dry bus + reverb bus + mastering):
 *
 *   voice: BufferSource -> gain -> [HRTF PannerNode | StereoPannerNode] -+-> dry gain ------------------> master
 *                                                                        '-> send gain (wet) -> Convolver -> master
 *   master -> highpass 28 Hz -> DynamicsCompressor -> soft clip -> destination
 *
 * - Files carry the video mix's relative levels, so gain = 1 reproduces the video balance.
 * - `wet` values are audio.py's reverb sends. The convolver gets ir_hall rescaled so each channel
 *   has sum|h| = 20 (audio.py: ir normalised to sum|h| = 40, reverb returned at 0.5), with
 *   normalize = false, so a send of 0.22 sounds like the video's 0.22.
 * - The send is tapped after the panner, so reverb follows a positional source's distance
 *   attenuation (dry/wet ratio as in the video at any distance).
 * - Default master volume 0.8 + the gentle compressor match the video's loudness (offline
 *   check in game/test/sfx_check.py: loudest 50 ms RMS -7.5 dBFS vs the video's -7.6).
 * - Coordinates: three.js world space (Y up, metres) is the same handedness WebAudio uses.
 */

const SPEED_OF_SOUND = 343;
const IR_SUM_ABS = 20;
const DEFAULT_MASTER = 0.8;
const COMPRESSOR = { threshold: -10, knee: 10, ratio: 3, attack: 0.003, release: 0.25 };
/** Enemy shot files hold the level heard at ~9.7 m in the video; with refDistance 3 the
 *  inverse model gives 3/9.7, so this gain puts a 9.7 m shot back at the video level. */
const ENEMY_SHOT_GAIN = 3.2;

/** Reload timeline of the video (frames 505..562 at 30 fps): [name, seconds, reverb send]. */
export const RELOAD_DURATION = 1.9;
const RELOAD_STEPS = [
  ['mag_out', 6 / 30, 0.1],
  ['mag_in', 29 / 30, 0.15],
  ['mag_drop', 24 / 30 + 0.25, 0.5],
  ['bolt', 40 / 30, 0.25],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);
const vec3 = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? [p[0], p[1], p[2]] : [p.x, p.y, p.z]);

function rampParam(ctx, param, value, sec) {
  const t = ctx.currentTime;
  const cur = param.value; // last rendered value; read before cancelling
  param.cancelScheduledValues(t);
  param.setValueAtTime(cur, t); // explicit start point so the ramp begins now in every browser
  if (sec > 0) param.linearRampToValueAtTime(value, t + sec);
  else param.setValueAtTime(value, t);
}

function decode(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

function offlineContext(channels, length, rate) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  return new OAC(channels, length, rate);
}

function resample(buffer, rate) {
  const oc = offlineContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const s = oc.createBufferSource();
  s.buffer = buffer;
  s.connect(oc.destination);
  s.start();
  const p = oc.startRendering();
  return p && p.then ? p : new Promise((r) => { oc.oncomplete = (e) => r(e.renderedBuffer); });
}

/** Soft clip after the compressor (audio.py ended its master in a tanh). Unity below 0.6,
 *  tanh knee above, approaching 1.0. A 0.5 pre-gain maps the shaper's [-1,1] to [-2,2]. */
function softClipCurve(n = 2049) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 4 - 2;
    const a = Math.abs(u);
    curve[i] = a <= 0.6 ? u : Math.sign(u) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
  }
  return curve;
}

export class SFX {
  /** No AudioContext is created until unlock(). */
  constructor() {
    this.ctx = null;
    this.manifest = null;
    /** @type {Map<string, AudioBuffer[]>} */
    this.buffers = new Map();
    this.voiceLimit = 8; // per sound name; the rifle fires ~11 rounds/s with 0.45 s tails
    this.voiceLimits = { step: 4, tick: 4, tick_kill: 4, medal: 2, hurt: 3, heartbeat: 2, ambience_loop: 2 };
    this.maxVoices = 64; // global cap; loops are never stolen by it
    this._voices = new Map(); // name -> voice[] (oldest first)
    this._all = [];
    this._bySource = new WeakMap();
    this._lastVariant = new Map();
    this._masterVolume = DEFAULT_MASTER;
    this._listener = [0, 0, 0, 0, 0, -1, 0, 1, 0];
    this._loaded = false;
    this._reverbReady = false;
    this._ready = Promise.resolve();
    this._ambience = null;
    this._wantAmbience = false;
    this._heartbeat = null;
    this._lowHealth = false;
    this._stepSide = 1;
    this._warned = new Set();
  }

  /** Fetch manifest.json and decode every buffer. Can run before unlock() (decodes through an
   *  OfflineAudioContext, which needs no user gesture). */
  async load(baseUrl = 'assets/sfx/') {
    const base = baseUrl && !baseUrl.endsWith('/') ? baseUrl + '/' : baseUrl;
    const res = await fetch(base + 'manifest.json');
    if (!res.ok) throw new Error(`[sfx] could not load ${base}manifest.json (${res.status})`);
    const manifest = await res.json();
    this.manifest = manifest;
    const decoder = this.ctx || offlineContext(2, 1, 48000);
    await Promise.all(Object.entries(manifest)
      .filter(([, files]) => Array.isArray(files))
      .map(async ([name, files]) => {
        const bufs = await Promise.all(files.map(async (f) => {
          const r = await fetch(base + f);
          if (!r.ok) throw new Error(`[sfx] ${base + f}: ${r.status}`);
          return decode(decoder, await r.arrayBuffer());
        }));
        this.buffers.set(name, bufs);
      }));
    this._loaded = true;
    if (this.ctx) {
      this._ready = this._finishSetup();
      await this._ready;
    }
    return this;
  }

  /** Create / resume the AudioContext. Call synchronously inside a user gesture handler. */
  unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) {
        console.warn('[sfx] WebAudio is not available');
        return Promise.resolve();
      }
      try {
        this.ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
      } catch (e) {
        this.ctx = new AC();
      }
      this._buildGraph();
      this._applyListener();
      // iOS only opens the output when something starts inside the gesture
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.onended = () => s.disconnect();
      s.start(0);
      if (this._loaded) this._ready = this._finishSetup();
    }
    const resumed = this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume();
    return Promise.resolve(resumed).then(() => this._ready);
  }

  /** Listener pose in three.js world coords: position, forward vector, up vector. */
  setListener(px, py, pz, fx, fy, fz, ux = 0, uy = 1, uz = 0) {
    const l = this._listener;
    l[0] = px; l[1] = py; l[2] = pz; l[3] = fx; l[4] = fy; l[5] = fz; l[6] = ux; l[7] = uy; l[8] = uz;
    if (this.ctx) this._applyListener();
  }

  /**
   * Play one random variant of `name` (never the same variant twice in a row).
   * opts: pos [x,y,z] (positional, HRTF) | null (2D); gain=1; rate=1; rateJitter=0.03;
   *       wet = reverb send 0..~1; pan -1..1 (2D only); delay seconds; dry=1;
   *       refDistance=3, rolloff=1, maxDistance=10000 (positional); loop; offset (s or 'random'); limit.
   * Returns the AudioBufferSourceNode (with .voiceGain = its GainNode), or null if not ready.
   */
  play(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const list = this.buffers.get(name);
    if (!list || !list.length) {
      if (this._loaded && !this._warned.has(name)) {
        this._warned.add(name);
        console.warn(`[sfx] unknown sound "${name}"`);
      }
      return null;
    }
    const {
      pos = null, gain = 1, rate = 1, rateJitter = 0.03, wet = 0, pan = 0, delay = 0, dry = 1,
      refDistance = 3, rolloff = 1, maxDistance = 10000, loop = false, offset = 0, limit,
    } = opts;
    const buffer = this._pickVariant(name, list);
    this._makeRoom(name, limit ?? this.voiceLimits[name] ?? this.voiceLimit);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = Math.max(0.05, rate * (1 + (Math.random() * 2 - 1) * rateJitter));
    const vgain = ctx.createGain();
    vgain.gain.value = gain;
    src.connect(vgain);
    const nodes = [src, vgain];
    let out = vgain;

    if (pos) {
      const [x, y, z] = vec3(pos);
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = refDistance;
      p.rolloffFactor = rolloff;
      p.maxDistance = maxDistance;
      if (p.positionX) {
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      } else {
        p.setPosition(x, y, z);
      }
      out.connect(p);
      out = p;
      nodes.push(p);
    } else if (pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = clamp(pan, -1, 1);
      out.connect(sp);
      out = sp;
      nodes.push(sp);
    }

    const dg = ctx.createGain();
    dg.gain.value = dry;
    out.connect(dg);
    dg.connect(this.master);
    nodes.push(dg);
    if (wet > 0) {
      const sg = ctx.createGain();
      sg.gain.value = wet;
      out.connect(sg);
      sg.connect(this.reverbSend);
      nodes.push(sg);
    }

    const voice = { name, src, gain: vgain, nodes, loop, done: false };
    src.onended = () => this._release(voice);
    this._voices.has(name) ? this._voices.get(name).push(voice) : this._voices.set(name, [voice]);
    this._all.push(voice);
    this._bySource.set(src, voice);

    const off = offset === 'random' ? Math.random() * buffer.duration : offset;
    src.start(ctx.currentTime + Math.max(0, delay), loop ? off % buffer.duration : Math.min(off, buffer.duration));
    src.voiceGain = vgain;
    return src;
  }

  /** Start a looping sound (fades in). Returns {source, setGain(g, sec), stop(fadeSec), playing}. */
  loop(name, opts = {}) {
    const { gain = 1, fadeIn = 0.5, ...rest } = opts;
    const src = this.play(name, { rateJitter: 0, offset: 'random', ...rest, gain: fadeIn > 0 ? 0 : gain, loop: true });
    if (!src) return null;
    const ctx = this.ctx;
    const g = src.voiceGain.gain;
    if (fadeIn > 0) rampParam(ctx, g, gain, fadeIn);
    let stopped = false;
    return {
      source: src,
      setGain: (v, sec = 0.1) => { if (!stopped) rampParam(ctx, g, v, sec); },
      stop: (fadeSec = 0.5) => {
        if (stopped) return;
        stopped = true;
        rampParam(ctx, g, 0, fadeSec);
        try { src.stop(ctx.currentTime + fadeSec + 0.02); } catch (e) { /* already stopped */ }
      },
      get playing() { return !stopped; },
    };
  }

  /** Master volume (linear; 0.8 default matches the video's loudness). */
  setMasterVolume(v) {
    this._masterVolume = v;
    if (this.master) rampParam(this.ctx, this.master.gain, v, 0.03);
  }

  /** Fade out and stop one voice returned by play(). */
  stopSource(src, fadeSec = 0.03) {
    const v = src && this._bySource.get(src);
    if (v) this._steal(v, fadeSec);
  }

  /** Stop every voice, loops included. */
  stopAll(fadeSec = 0.1) {
    [...this._all].forEach((v) => this._steal(v, fadeSec));
    this._ambience = null;
    this._heartbeat = null;
    this._wantAmbience = false;
  }

  get voiceCount() { return this._all.length; }

  // ------------------------------------------------------------------ game wrappers
  /** Player rifle: 2D, stereo-width file, slight random pan, reverb send 0.22 (audio.py). */
  playerShot() {
    return this.play('shot', { wet: 0.22, pan: rand(-0.05, 0.08), rateJitter: 0.03 });
  }

  /** Enemy rifle at world position: HRTF, inverse distance (ref 3 m), delayed by distance/343 m/s. */
  enemyShot(pos) {
    const delay = this._distanceTo(pos) / SPEED_OF_SOUND;
    return this.play('eshot', { pos, gain: ENEMY_SHOT_GAIN, wet: 1.1, refDistance: 3, rolloff: 1, delay, rateJitter: 0.04 });
  }

  /** Supersonic crack of a near miss (place it near the listener's head on the bullet's path). */
  snap(pos) { return this.play('snap', { pos, wet: 0.2, refDistance: 3, rateJitter: 0.05 }); }

  /** Tonal fly-by of a bullet passing close. */
  whizz(pos) { return this.play('whizz', { pos, wet: 0.15, refDistance: 3, rateJitter: 0.06 }); }

  /** Bullet hitting concrete / tile, with debris. */
  impact(pos) { return this.play('impact', { pos, wet: 0.4, refDistance: 3, rateJitter: 0.05 }); }

  /** Brass casing bouncing 3x. By default it is delayed 0.36-0.5 s (flight time, as in the video),
   *  so call it when the shot fires; pass delay = 0 if you trigger it on landing. */
  casing(pos, delay = rand(0.36, 0.5)) {
    return this.play('casing', { pos, wet: 0.15, refDistance: 2, delay, rateJitter: 0.05 });
  }

  /** Player footstep, alternating left/right like the video. */
  step(sprinting = false) {
    this._stepSide = -this._stepSide;
    return this.play('step', {
      gain: sprinting ? 1 : 0.7, rate: sprinting ? 1.04 : 1, rateJitter: 0.05, pan: 0.15 * this._stepSide, wet: 0.3,
    });
  }

  /** Bullet hitting an enemy (kept audible at range: ref 10 m, rolloff 0.5). */
  fleshHit(pos) { return this.play('flesh', { pos, wet: 0.3, refDistance: 10, rolloff: 0.5, rateJitter: 0.06 }); }

  /** Body hitting the floor. Attenuation min(1, 8/d) exactly as the video. Delayed 0.55 s by
   *  default (the video's kill -> fall gap), so call it at the kill; pass 0 to trigger on contact. */
  bodyFall(pos, delay = 0.55) {
    return this.play('fall', { pos, wet: 0.6, refDistance: 8, rolloff: 1, delay, rateJitter: 0.04 });
  }

  adsIn() { return this.play('ads_in', { wet: 0.1, rateJitter: 0.04 }); }

  adsOut() { return this.play('ads_out', { wet: 0.1, rateJitter: 0.04 }); }

  /** Hitmarker tick; kill = true plays the lower two-tone kill tick. */
  hitTick(kill = false) {
    return kill ? this.play('tick_kill', { wet: 0.05, rateJitter: 0 }) : this.play('tick', { wet: 0, rateJitter: 0 });
  }

  /** Multi-kill UI sting. */
  medal() { return this.play('medal', { wet: 0.08, rateJitter: 0 }); }

  /** Player taking damage. */
  hurt() { return this.play('hurt', { wet: 0.15, rateJitter: 0.05 }); }

  /** Dry fire (trigger pulled on an empty magazine). */
  emptyClick() { return this.play('empty_click', { wet: 0.1, rateJitter: 0.04 }); }

  /** Schedules mag_out (0.20 s), mag_in (0.97 s), mag_drop (1.05 s), bolt (1.33 s) for a 1.9 s
   *  reload, as in the video. Returns {sources, duration, cancel(fadeSec)}. */
  reloadSequence() {
    const sources = [];
    for (const [name, t, wet] of RELOAD_STEPS) {
      const s = this.play(name, { delay: t, wet, rateJitter: 0.02 });
      if (s) sources.push(s);
    }
    return { sources, duration: RELOAD_DURATION, cancel: (fadeSec = 0.03) => sources.forEach((s) => this.stopSource(s, fadeSec)) };
  }

  /** Mall room tone + distant fire bell (reverb baked into the bell). Safe to call before
   *  unlock()/load(): it starts as soon as both are done. */
  startAmbience() {
    this._wantAmbience = true;
    this._flushPending();
    return this._ambience;
  }

  stopAmbience(fadeSec = 1) {
    this._wantAmbience = false;
    if (this._ambience) this._ambience.stop(fadeSec);
    this._ambience = null;
  }

  /** Low health on/off: fades the heartbeat loop in (and the ambience down to half) or back out. */
  setLowHealth(on) {
    on = !!on;
    if (on === this._lowHealth) return;
    this._lowHealth = on;
    if (!this.ctx || !this._loaded) return; // applied by _flushPending() once ready
    if (on) {
      this._startHeartbeat();
      if (this._ambience) this._ambience.setGain(0.5, 0.8);
    } else {
      if (this._heartbeat) this._heartbeat.stop(1.2);
      this._heartbeat = null;
      if (this._ambience) this._ambience.setGain(1, 1.2);
    }
  }

  // ------------------------------------------------------------------ internals
  _buildGraph() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this._masterVolume;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    hp.Q.value = Math.SQRT1_2;
    const comp = c.createDynamicsCompressor();
    for (const [k, v] of Object.entries(COMPRESSOR)) comp[k].value = v;
    const pre = c.createGain();
    pre.gain.value = 0.5;
    const clip = c.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    this.master.connect(hp);
    hp.connect(comp);
    comp.connect(pre);
    pre.connect(clip);
    clip.connect(c.destination);
    this.compressor = comp;

    this.reverbSend = c.createGain();
    this.convolver = c.createConvolver();
    this.convolver.normalize = false; // must be set before .buffer
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.master);
  }

  async _finishSetup() {
    await this._setupReverb();
    this._flushPending();
  }

  async _setupReverb() {
    const irs = this.buffers.get('ir_hall');
    if (!irs || !irs.length || !this.convolver || this._reverbReady) return;
    const c = this.ctx;
    let ir = irs[0];
    if (ir.sampleRate !== c.sampleRate) ir = await resample(ir, c.sampleRate); // Convolver needs the context rate
    const out = c.createBuffer(ir.numberOfChannels, ir.length, c.sampleRate);
    for (let ch = 0; ch < ir.numberOfChannels; ch++) {
      const d = ir.getChannelData(ch);
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += Math.abs(d[i]);
      const k = sum > 0 ? IR_SUM_ABS / sum : 0;
      const o = out.getChannelData(ch);
      for (let i = 0; i < d.length; i++) o[i] = d[i] * k;
    }
    this.convolver.buffer = out;
    this._reverbReady = true;
  }

  _flushPending() {
    if (!this.ctx || !this._loaded) return;
    if (this._wantAmbience && !this._ambience) {
      this._ambience = this.loop('ambience_loop', { gain: this._lowHealth ? 0.5 : 1, fadeIn: 2, wet: 0 });
    }
    if (this._lowHealth) this._startHeartbeat();
  }

  _startHeartbeat() {
    if (!this._heartbeat) this._heartbeat = this.loop('heartbeat', { gain: 1, fadeIn: 0.8, wet: 0.05, offset: 0 });
  }

  _applyListener() {
    const L = this.ctx.listener;
    const [px, py, pz, fx, fy, fz, ux, uy, uz] = this._listener;
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  _distanceTo(pos) {
    const [x, y, z] = vec3(pos);
    const l = this._listener;
    return Math.hypot(x - l[0], y - l[1], z - l[2]);
  }

  _pickVariant(name, list) {
    if (list.length === 1) return list[0];
    const last = this._lastVariant.get(name);
    let i;
    if (last === undefined) {
      i = Math.floor(Math.random() * list.length);
    } else {
      i = Math.floor(Math.random() * (list.length - 1)); // any variant except the last one
      if (i >= last) i += 1;
    }
    this._lastVariant.set(name, i);
    return list[i];
  }

  _makeRoom(name, limit) {
    const list = this._voices.get(name);
    while (list && list.length >= limit && list.length) this._steal(list[0]);
    if (this._all.length >= this.maxVoices) {
      const v = this._all.find((x) => !x.loop);
      if (v) this._steal(v);
    }
  }

  _unlist(v) {
    const list = this._voices.get(v.name);
    const i = list ? list.indexOf(v) : -1;
    if (i >= 0) list.splice(i, 1);
    const j = this._all.indexOf(v);
    if (j >= 0) this._all.splice(j, 1);
  }

  _steal(v, fadeSec = 0.015) {
    this._unlist(v);
    if (v.done) return;
    rampParam(this.ctx, v.gain.gain, 0, fadeSec);
    try { v.src.stop(this.ctx.currentTime + fadeSec + 0.005); } catch (e) { /* not started or already stopped */ }
  }

  _release(v) {
    if (v.done) return;
    v.done = true;
    this._unlist(v);
    for (const n of v.nodes) {
      try { n.disconnect(); } catch (e) { /* already disconnected */ }
    }
  }
}

export default SFX;
