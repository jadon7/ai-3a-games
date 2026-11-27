// audio.js — fully procedural WebAudio sound engine. No audio files, no dependencies.
//
// Design: every one-shot is synthesised once into mono AudioBuffers by a tiny offline DSP
// toolkit (Float32Array maths), so playing a sound is just BufferSource → Gain (→ Panner).
// Loops use a handful of live nodes; music is scheduled with a look-ahead inside update().
//
// Graph:  voices ─→ sfxGain ─→ duck ─→ master ─→ limiter ─→ destination
//         big voices + reverb return ─→ sfxDirect (not ducked) ─→ master
//         voices ─→ revLo/revHi ─→ convolver (outdoor slapback)
//         music state bus ─→ musBus (+ feedback delay) ─→ musGain ─→ duck

const TAU = Math.PI * 2;
const MAX_VOICES = 40, MAX_DIST = 140, REF_DIST = 5, ROLLOFF = 1.2, LOOKAHEAD = 0.2;
const MUSIC_TRIM = 0.6, D3 = 146.83;
const NO = Object.freeze({});
let SR = 48000; // render rate, set in init()

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const st = (s) => Math.pow(2, s / 12);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pair = (v) => (Array.isArray(v) ? v : [v, v]);

// ───────────────────────────── offline DSP toolkit ─────────────────────────────
// Layer params: t start(s), d length(s), a amplitude, att/rel linear attack/release(s),
// dec exponential decay time-constant(s), ep:2 squares the envelope, lp/hp/bp filter Hz
// (number or [from,to] sweep), q filter Q.

const span = (out, p) => Math.max(0, Math.min(Math.floor(p.d * SR), out.length - Math.floor((p.t || 0) * SR)));

function biquad(x, type, f0, f1, q) { // in place; cutoff sweeps geometrically f0 → f1
  const n = x.length, sweep = f1 !== f0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const set = (f) => {
    const w = TAU * clamp(f, 15, SR * 0.45) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === 'lp') { b1 = (1 - c) / a0; b0 = b2 = b1 / 2; }
    else if (type === 'hp') { b1 = -(1 + c) / a0; b0 = b2 = -b1 / 2; }
    else { b0 = al / a0; b1 = 0; b2 = -b0; }
    a1 = -2 * c / a0; a2 = (1 - al) / a0;
  };
  set(f0);
  for (let i = 0; i < n; i++) {
    if (sweep && (i & 31) === 0) set(f0 * Math.pow(f1 / f0, i / n));
    const xi = x[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y; x[i] = y;
  }
  return x;
}

function filt(x, p) {
  const q = p.q || 0.707;
  if (p.hp) biquad(x, 'hp', ...pair(p.hp), q);
  if (p.bp) biquad(x, 'bp', ...pair(p.bp), q);
  if (p.lp) biquad(x, 'lp', ...pair(p.lp), q);
  return x;
}

function mix(out, x, p) { // apply envelope and add into out
  const n = x.length, o = Math.floor((p.t || 0) * SR), sq = p.ep === 2;
  const att = Math.max(1, (p.att === undefined ? 0.001 : p.att) * SR);
  const rel = Math.max(1, (p.rel === undefined ? 0.006 : p.rel) * SR);
  const kd = p.dec ? Math.exp(-1 / (p.dec * SR)) : 1;
  let g = p.a === undefined ? 1 : p.a;
  for (let i = 0; i < n; i++) {
    let e = Math.min(1, i / att, (n - i) / rel);
    if (sq) e *= e;
    out[o + i] += x[i] * e * g; g *= kd;
  }
}

function rawNoise(n, color, dens) {
  const x = new Float32Array(n);
  if (dens > 0) { // crackle: sparse, fast-decaying bursts
    const k = Math.exp(-1 / (0.003 * SR)), pr = dens / SR; let e = 0;
    for (let i = 0; i < n; i++) { if (Math.random() < pr) e = 0.3 + Math.random() * 0.7; x[i] = (Math.random() * 2 - 1) * e; e *= k; }
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
  } else if (color === 'brown') {
    let y = 0;
    for (let i = 0; i < n; i++) { y = (y + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = y * 3.5; }
  } else for (let i = 0; i < n; i++) x[i] = Math.random() * 2 - 1;
  return x;
}

// noise layer: color 'white'|'pink'|'brown', dens (bursts/s) for crackle. Level-normalised after
// filtering (dense noise to a sine-like RMS, crackle to unit peak) so `a` is comparable across layers.
function noise(out, p) {
  const n = span(out, p); if (n <= 0) return;
  const x = filt(rawNoise(n, p.color, p.dens), p);
  let pk = 1e-9, sq = 0;
  for (let i = 0; i < n; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > pk) pk = v; sq += v * v; }
  const k = p.dens ? 1 / pk : 0.6 / Math.sqrt(sq / n + 1e-12);
  for (let i = 0; i < n; i++) x[i] *= k;
  mix(out, x, p);
}

// oscillator layer: f → f1 (geometric over d, or exponential approach with time-constant sw),
// type 'sine'|'saw'|'square'|'tri', fm {r ratio, i index, dec}
function tone(out, p) {
  const n = span(out, p); if (n <= 0) return;
  const x = new Float32Array(n), f1 = p.f1 === undefined ? p.f : p.f1, type = p.type || 'sine', fm = p.fm;
  const k = p.sw ? Math.exp(-1 / (p.sw * SR)) : Math.pow(f1 / p.f, 1 / n);
  const kfm = fm && fm.dec ? Math.exp(-1 / (fm.dec * SR)) : 1;
  let f = p.f, ph = 0, mi = fm ? fm.i / TAU : 0;
  for (let i = 0; i < n; i++) {
    f = p.sw ? f1 + (f - f1) * k : f * k;
    ph += f / SR;
    let c = ph;
    if (fm) { c += Math.sin(TAU * ph * fm.r) * mi; mi *= kfm; }
    if (type === 'sine') x[i] = Math.sin(TAU * c);
    else {
      c -= Math.floor(c);
      x[i] = type === 'saw' ? 2 * c - 1 : type === 'square' ? (c < 0.5 ? 0.7 : -0.7) : 4 * Math.abs(c - 0.5) - 1;
    }
  }
  mix(out, filt(x, p), p);
}

function pluck(out, p) { // Karplus–Strong string; fb = loop feedback (sustain)
  const n = span(out, p), N = Math.round(SR / p.f), fb = p.fb || 0.99;
  if (n <= N + 1) return;
  const x = new Float32Array(n); let s = 0;
  for (let i = 0; i < N; i++) { s = s * 0.55 + (Math.random() * 2 - 1) * 0.45; x[i] = s * 2; }
  x[N] = x[0] * fb;
  for (let i = N + 1; i < n; i++) x[i] = (x[i - N] + x[i - N - 1]) * 0.5 * fb;
  mix(out, filt(x, p), p);
}

function echo(b, taps, lp) { // discrete, duller repeats (far walls)
  const src = biquad(b.slice(), 'lp', lp, lp, 0.707);
  for (const [dt, g] of taps) { const o = Math.floor(dt * SR); for (let i = 0; i + o < b.length; i++) b[i + o] += src[i] * g; }
}

function finish(b, drive) { // optional saturation, normalise, de-click the tail
  const n = b.length; let pk = 1e-9;
  for (let i = 0; i < n; i++) { if (drive) b[i] = Math.tanh(b[i] * drive); const v = b[i] < 0 ? -b[i] : b[i]; if (v > pk) pk = v; }
  const g = 0.95 / pk, f = Math.min(n, Math.floor(0.004 * SR));
  for (let i = 0; i < n; i++) b[i] *= g;
  for (let i = 0; i < f; i++) b[n - 1 - i] *= i / f;
}

// layer macros
const click = (b, t, f, a = 1, dec = 0.008, q = 2) => noise(b, { t, d: dec * 7, a, dec, bp: f, q });
const crack = (b, t, a = 1, dec = 0.02, hp = 1800) => noise(b, { t, d: dec * 7, a, dec, hp, att: 0.0003 });
const thump = (b, t, f, f1, a = 1, dec = 0.1, sw = 0.03) => tone(b, { t, d: dec * 6, f, f1, sw, a, dec });
const body = (b, t, a, dec, lp0, lp1 = lp0, color) => noise(b, { t, d: dec * 6, a, dec, lp: [lp0, lp1], color });
const whoosh = (b, t, d, f0, f1, a = 1, q = 1.2, peak = 0.5) => noise(b, { t, d, a, att: d * peak, rel: d * (1 - peak), ep: 2, bp: [f0, f1], q });
const debris = (b, t, d, a, dens = 50, f = 2500) => noise(b, { t, d, a, att: 0.03, dec: d / 3, dens, bp: f, q: 0.7 });
const ping = (b, t, f, a = 1, dec = 0.1) => { // inharmonic metal partials
  for (const [r, g] of [[1, 1], [2.76, 0.55], [5.4, 0.3], [8.93, 0.15]]) {
    if (f * r < SR * 0.45) tone(b, { t, d: dec * 6 / Math.sqrt(r), f: f * r, a: a * g, dec: dec / Math.sqrt(r) });
  }
};
const boom = (b, t, s = 1) => { // layered explosion, s = size
  tone(b, { t, d: 1.6 * s, f: 120, f1: 40, sw: 0.1 * s, a: 1.1, dec: 0.28 * s });
  thump(b, t, 260, 70, 1, 0.05, 0.02); crack(b, t, 1.2, 0.025, 1000);
  noise(b, { t, d: 1.2 * s, a: 1.3, dec: 0.2 * s, lp: [8000, 500] });
  noise(b, { t: t + 0.04, d: 1.7 * s, a: 0.7, att: 0.05, dec: 0.45 * s, lp: 420, color: 'brown' });
  debris(b, t + 0.12, 1.4 * s, 0.45, 55);
};
const step = (b, f, f1, cf, a = 0.8) => { thump(b, 0, f, f1, a, 0.028, 0.012); click(b, 0, cf, 0.8, 0.013, 2.5); };

// ───────────────────────────── one-shot recipes ─────────────────────────────
// d seconds, r render fn, v variants, pv pitch variance, g gain, rev reverb send (0/1/2),
// gap min seconds between plays, prio importance for voice stealing, big bypasses ducking, drive saturation
const S = (d, r, o) => ({ d, r, v: 1, pv: 0, g: 0.5, rev: 0, gap: 0, prio: 0.5, big: false, drive: 0, ...o });

const SFX = {
  // ── weapons ──
  rifle_fire: S(0.34, (b) => {
    crack(b, 0, 1, 0.01, 2600); thump(b, 0, 260, 105, 0.8, 0.03, 0.012);
    noise(b, { d: 0.14, a: 1, dec: 0.028, bp: [1500, 520], q: 0.7 });
    noise(b, { d: 0.16, a: 0.8, dec: 0.035, bp: [800, 300], q: 0.8 });
    click(b, 0.006, 3800, 0.3, 0.004);
    noise(b, { t: 0.02, d: 0.31, a: 0.13, dec: 0.085, lp: [3200, 600] });
  }, { v: 4, pv: 0.04, g: 0.5, rev: 1, gap: 0.04, prio: 0.8, drive: 1.8 }),
  shotgun_fire: S(0.95, (b) => {
    thump(b, 0, 180, 50, 1.2, 0.09, 0.04); crack(b, 0, 0.9, 0.02, 1400);
    noise(b, { d: 0.5, a: 1.2, dec: 0.09, lp: [5000, 300] });
    noise(b, { d: 0.4, a: 0.9, dec: 0.07, bp: [700, 250], q: 0.8 });
    noise(b, { t: 0.03, d: 0.9, a: 0.3, dec: 0.22, lp: [3500, 350], color: 'pink' });
  }, { v: 2, pv: 0.05, g: 0.85, rev: 2, gap: 0.08, prio: 0.9, drive: 2.2 }),
  rail_charge: S(0.62, (b) => {
    tone(b, { d: 0.62, f: 160, f1: 1300, type: 'saw', a: 0.5, att: 0.56, rel: 0.04, ep: 2, lp: [900, 7000] });
    tone(b, { d: 0.62, f: 320, f1: 2600, a: 0.5, att: 0.56, rel: 0.04, fm: { r: 0.5, i: 1.5 } });
    noise(b, { d: 0.62, a: 0.25, att: 0.56, rel: 0.04, ep: 2, dens: 1500, hp: 5000 });
    tone(b, { d: 0.62, f: 55, f1: 110, type: 'square', a: 0.25, att: 0.5, rel: 0.05, lp: 500 });
  }, { g: 0.4, prio: 0.8 }),
  rail_fire: S(1.5, (b) => {
    crack(b, 0, 1.5, 0.012, 3000); thump(b, 0, 160, 42, 1, 0.17, 0.08);
    tone(b, { d: 0.4, f: 4500, f1: 160, sw: 0.05, type: 'saw', a: 1.2, dec: 0.09, fm: { r: 1.5, i: 5, dec: 0.12 } });
    noise(b, { d: 0.5, a: 1.2, dec: 0.1, bp: [4000, 600], q: 0.6 });
    noise(b, { t: 0.04, d: 1.4, a: 0.7, dec: 0.38, dens: 900, hp: 3500 });            // sizzle
    tone(b, { t: 0.03, d: 1.2, f: 2300, f1: 1700, a: 0.14, dec: 0.3, fm: { r: 0.11, i: 3 } });
  }, { g: 0.95, rev: 2, prio: 1, drive: 1.6 }),
  reload_out: S(0.24, (b) => {
    click(b, 0, 2200, 0.8, 0.006); click(b, 0.012, 900, 0.6, 0.012); tone(b, { d: 0.1, f: 1800, a: 0.12, dec: 0.02 });
    noise(b, { t: 0.03, d: 0.16, a: 0.25, att: 0.02, rel: 0.1, bp: [1500, 700], q: 1.5 });
  }, { g: 0.4, prio: 0.6 }),
  reload_in: S(0.26, (b) => {
    noise(b, { d: 0.09, a: 0.25, att: 0.05, rel: 0.01, bp: [700, 1600], q: 1.5 });
    click(b, 0.09, 1500, 1, 0.01); thump(b, 0.09, 220, 110, 0.6, 0.02); click(b, 0.1, 3200, 0.5, 0.005);
  }, { g: 0.42, prio: 0.6 }),
  bolt: S(0.32, (b) => {
    click(b, 0, 2600, 0.9, 0.006); thump(b, 0, 300, 150, 0.4, 0.015);
    noise(b, { t: 0.02, d: 0.08, a: 0.18, att: 0.02, rel: 0.03, bp: 2000, q: 2 });
    click(b, 0.11, 1900, 1, 0.008); thump(b, 0.11, 260, 120, 0.6, 0.02); ping(b, 0.11, 2900, 0.12, 0.03);
  }, { g: 0.42, prio: 0.6 }),
  dry_fire: S(0.09, (b) => { click(b, 0, 2800, 1, 0.004); click(b, 0.004, 1100, 0.5, 0.008); }, { g: 0.3, gap: 0.05 }),
  weapon_swap: S(0.3, (b) => {
    noise(b, { d: 0.2, a: 0.4, att: 0.05, rel: 0.12, bp: [600, 1800], q: 0.7 });
    click(b, 0.17, 2000, 0.8, 0.007); thump(b, 0.17, 240, 130, 0.3, 0.02);
  }, { g: 0.35 }),
  melee_swing: S(0.28, (b) => { whoosh(b, 0, 0.26, 500, 2200, 1, 1.5, 0.45); whoosh(b, 0.02, 0.22, 1500, 4000, 0.4, 2); }, { pv: 0.08, g: 0.45 }),
  melee_hit: S(0.32, (b) => {
    thump(b, 0, 180, 70, 1, 0.055, 0.03); body(b, 0, 1, 0.03, 2200, 400);
    crack(b, 0, 0.9, 0.008, 2500); click(b, 0.01, 900, 0.7, 0.02);
  }, { pv: 0.06, g: 0.7, prio: 0.8, drive: 1.6 }),
  grenade_throw: S(0.3, (b) => { whoosh(b, 0, 0.28, 300, 1200, 1, 1, 0.35); ping(b, 0.01, 3500, 0.15, 0.04); }, { g: 0.4 }),
  grenade_bounce: S(0.25, (b) => {
    ping(b, 0, rnd(1700, 2300), 0.8, 0.05); click(b, 0, 3000, 0.6, 0.004); thump(b, 0, 300, 150, 0.4, 0.015);
  }, { v: 3, pv: 0.1, g: 0.4, gap: 0.05 }),
  explosion: S(1.9, (b) => boom(b, 0, 1), { v: 2, pv: 0.06, g: 1, rev: 2, prio: 1, big: true, drive: 2.2 }),
  shell: S(0.2, (b) => {
    ping(b, 0, rnd(3800, 4600), 0.7, 0.035); ping(b, rnd(0.05, 0.08), rnd(4200, 5000), 0.35, 0.025);
  }, { v: 3, pv: 0.12, g: 0.1, gap: 0.05, prio: 0.1 }),

  // ── bullets / impacts ──
  impact_sand: S(0.24, (b) => {
    noise(b, { d: 0.2, a: 1, dec: 0.035, bp: [1800, 500], q: 0.6 }); thump(b, 0, 140, 70, 0.5, 0.02);
    noise(b, { t: 0.01, d: 0.2, a: 0.3, dec: 0.05, dens: 400, hp: 4000 });
  }, { v: 3, pv: 0.1, g: 0.4, gap: 0.025, prio: 0.35 }),
  impact_stone: S(0.26, (b) => {
    crack(b, 0, 1, 0.006, 2000); click(b, 0, rnd(1300, 1900), 0.8, 0.012, 4); thump(b, 0, 220, 110, 0.5, 0.015);
    debris(b, 0.02, 0.22, 0.4, 150, 2600);
  }, { v: 3, pv: 0.1, g: 0.45, gap: 0.025, prio: 0.35 }),
  impact_metal: S(0.5, (b) => {
    crack(b, 0, 0.8, 0.004, 3000); ping(b, 0, rnd(1300, 3000), 0.9, rnd(0.04, 0.09)); thump(b, 0, 320, 160, 0.4, 0.012);
    if (Math.random() < 0.6) { // ricochet whine
      const f = rnd(2400, 4200); tone(b, { t: 0.01, d: 0.45, f, f1: f * rnd(0.45, 0.7), a: 0.35, att: 0.01, dec: 0.13 });
    }
  }, { v: 5, pv: 0.1, g: 0.45, gap: 0.025, prio: 0.4 }),
  impact_wood: S(0.2, (b) => {
    thump(b, 0, rnd(260, 340), 150, 0.9, 0.025, 0.01); click(b, 0, rnd(700, 1000), 0.8, 0.015, 3); crack(b, 0, 0.4, 0.005, 2500);
  }, { v: 3, pv: 0.1, g: 0.45, gap: 0.025, prio: 0.35 }),
  impact_flesh: S(0.22, (b) => {
    thump(b, 0, 130, 55, 1, 0.04, 0.02); body(b, 0, 0.7, 0.025, 900, 250); click(b, 0.005, 600, 0.4, 0.02, 1);
  }, { v: 3, pv: 0.1, g: 0.5, gap: 0.025, prio: 0.45 }),
  bullet_whiz: S(0.3, (b) => {
    const f = rnd(2600, 3400);
    tone(b, { d: 0.24, f, f1: f * 0.45, type: 'saw', a: 0.4, att: 0.06, rel: 0.17, ep: 2, bp: [3500, 1200], q: 2 });
    whoosh(b, 0, 0.26, 4200, 1200, 0.9, 2.5, 0.28); crack(b, 0.065, 0.45, 0.004, 3500);
  }, { v: 3, pv: 0.15, g: 0.45, gap: 0.05, prio: 0.5 }),
  enemy_fire: S(0.55, (b) => {
    thump(b, 0, 150, 55, 1, 0.05, 0.02); noise(b, { d: 0.3, a: 1, dec: 0.05, bp: [900, 350], q: 0.7 });
    crack(b, 0, 0.3, 0.01, 1500); noise(b, { t: 0.03, d: 0.5, a: 0.25, dec: 0.13, lp: [1500, 300] });
    biquad(b, 'lp', 4500, 4500, 0.707);
  }, { v: 3, pv: 0.06, g: 0.6, rev: 1, gap: 0.03, prio: 0.5, drive: 1.6 }),
  drone_fire: S(0.28, (b) => {
    tone(b, { d: 0.24, f: 2400, f1: 380, sw: 0.045, type: 'saw', a: 0.7, dec: 0.07, lp: [6000, 1500] });
    tone(b, { d: 0.24, f: 1200, f1: 200, sw: 0.05, a: 0.7, dec: 0.07, fm: { r: 2, i: 2, dec: 0.05 } });
    noise(b, { d: 0.1, a: 0.3, dec: 0.02, hp: 3000 });
  }, { v: 2, pv: 0.08, g: 0.38, rev: 1, gap: 0.03, prio: 0.45 }),
  sniper_charge: S(1.5, (b) => {
    for (const m of [1, 1.02]) tone(b, { d: 1.5, f: 300 * m, f1: 1500 * m, a: 0.45, att: 1.4, rel: 0.06, ep: 2, fm: { r: 2.01, i: 1.2 } });
    tone(b, { d: 1.5, f: 150, f1: 750, type: 'saw', a: 0.3, att: 1.4, rel: 0.06, ep: 2, lp: [600, 3500] });
  }, { g: 0.45, prio: 0.8 }),
  sniper_fire: S(1.9, (b) => {
    crack(b, 0, 1.3, 0.012, 2200); thump(b, 0, 190, 58, 1.1, 0.08, 0.035);
    noise(b, { d: 0.4, a: 1.4, dec: 0.06, bp: [1600, 400], q: 0.7 });
    noise(b, { t: 0.03, d: 1, a: 0.3, dec: 0.28, lp: [2500, 300], color: 'pink' });
    echo(b, [[0.33, 0.32], [0.62, 0.2], [0.97, 0.11]], 2200);
  }, { g: 0.9, rev: 2, prio: 0.9, drive: 1.8 }),

  // ── movement ──
  step_sand: S(0.2, (b) => {
    noise(b, { d: 0.18, a: 1, att: 0.004, dec: 0.035, bp: [rnd(500, 700), 250], q: 0.7 }); thump(b, 0, 95, 55, 0.5, 0.03);
    noise(b, { t: 0.01, d: 0.14, a: 0.25, dec: 0.04, dens: 500, hp: 3500 });
  }, { v: 4, pv: 0.08, g: 0.26, gap: 0.06, prio: 0.2 }),
  step_stone: S(0.18, (b) => {
    step(b, 150, 85, rnd(900, 1300), 0.5); crack(b, 0.002, 0.3, 0.006, 3000);
    noise(b, { t: 0.02, d: 0.09, a: 0.12, dec: 0.03, bp: 2200, q: 1 });
  }, { v: 4, pv: 0.08, g: 0.28, gap: 0.06, prio: 0.2 }),
  step_metal: S(0.3, (b) => {
    step(b, 150, 75, rnd(700, 900), 0.7); ping(b, 0, rnd(520, 680), 0.35, 0.07); ping(b, 0, rnd(1300, 1700), 0.15, 0.04);
  }, { v: 4, pv: 0.08, g: 0.3, gap: 0.06, prio: 0.2 }),
  step_wood: S(0.2, (b) => { step(b, rnd(170, 210), 95, rnd(450, 600), 0.7); click(b, 0.003, 1800, 0.3, 0.006); },
    { v: 4, pv: 0.08, g: 0.3, gap: 0.06, prio: 0.2 }),
  jump: S(0.24, (b) => {
    whoosh(b, 0, 0.22, 300, 900, 0.7, 1, 0.3); thump(b, 0, 120, 70, 0.5, 0.025);
    noise(b, { d: 0.08, a: 0.2, att: 0.01, rel: 0.05, bp: 1500, q: 1 });
  }, { pv: 0.05, g: 0.3 }),
  double_jump: S(0.46, (b) => {
    noise(b, { d: 0.44, a: 1, att: 0.008, dec: 0.08, bp: [3200, 900], q: 0.7 });
    noise(b, { d: 0.44, a: 0.8, att: 0.01, dec: 0.1, lp: [900, 200], color: 'brown' });
    tone(b, { d: 0.4, f: 180, f1: 90, type: 'saw', a: 0.3, dec: 0.1, lp: 600 }); thump(b, 0, 200, 80, 0.5, 0.03);
  }, { pv: 0.05, g: 0.5, prio: 0.7 }),
  land: S(0.36, (b) => {
    thump(b, 0, 130, 55, 1, 0.06, 0.03); body(b, 0, 1, 0.035, 2000, 400);
    noise(b, { t: 0.02, d: 0.28, a: 0.3, dec: 0.07, dens: 300, hp: 2500 });
  }, { v: 2, pv: 0.06, g: 0.55, prio: 0.6 }),
  slide_start: S(0.4, (b) => {
    noise(b, { d: 0.38, a: 1, att: 0.03, dec: 0.12, bp: [2500, 900], q: 0.8 }); thump(b, 0, 120, 60, 0.5, 0.03);
  }, { g: 0.4 }),
  wallrun_start: S(0.3, (b) => {
    thump(b, 0, 180, 90, 0.7, 0.025); click(b, 0, 1100, 0.6, 0.012); whoosh(b, 0, 0.28, 600, 1800, 0.6, 1.2, 0.3);
  }, { g: 0.4 }),
  mantle: S(0.4, (b) => {
    noise(b, { d: 0.36, a: 0.5, att: 0.08, rel: 0.2, bp: [500, 1500], q: 0.7 });
    thump(b, 0.02, 200, 100, 0.5, 0.02); thump(b, 0.16, 160, 80, 0.6, 0.025);
  }, { g: 0.35 }),
  grapple_fire: S(0.55, (b) => {
    noise(b, { d: 0.16, a: 1, dec: 0.03, bp: [5000, 1500], q: 0.8 }); thump(b, 0, 260, 90, 0.7, 0.025);
    tone(b, { t: 0.02, d: 0.5, f: 500, f1: 1500, type: 'saw', a: 0.25, att: 0.02, rel: 0.3, lp: 3000, fm: { r: 0.07, i: 2 } });
    noise(b, { t: 0.02, d: 0.5, a: 0.3, att: 0.03, rel: 0.3, bp: [2000, 5000], q: 4 });
  }, { g: 0.55, prio: 0.7 }),
  grapple_hit: S(0.5, (b) => {
    crack(b, 0, 0.9, 0.005, 2500); ping(b, 0, rnd(700, 900), 0.9, 0.09); ping(b, 0, 1900, 0.4, 0.05); thump(b, 0, 200, 90, 0.7, 0.03);
  }, { v: 2, pv: 0.06, g: 0.6, prio: 0.7 }),
  grapple_release: S(0.26, (b) => {
    click(b, 0, 2400, 0.8, 0.006); tone(b, { d: 0.22, f: 1200, f1: 300, type: 'saw', a: 0.3, dec: 0.06, lp: 2500 });
    noise(b, { d: 0.22, a: 0.4, dec: 0.05, bp: [4000, 1200], q: 2 });
  }, { g: 0.4 }),
  zipline: S(0.3, (b) => {
    click(b, 0, 2600, 1, 0.005); ping(b, 0, 1500, 0.5, 0.06); thump(b, 0, 240, 120, 0.4, 0.02); click(b, 0.03, 3400, 0.4, 0.004);
  }, { g: 0.45 }),

  // ── feedback / UI ──
  hit_marker: S(0.08, (b) => {
    tone(b, { d: 0.07, f: 2100, a: 0.8, dec: 0.012 }); tone(b, { d: 0.05, f: 3150, type: 'tri', a: 0.3, dec: 0.008 }); click(b, 0, 4200, 0.6, 0.003);
  }, { pv: 0.02, g: 0.28, gap: 0.03, prio: 0.9 }),
  headshot: S(0.18, (b) => {
    tone(b, { d: 0.17, f: 3100, a: 0.8, dec: 0.03 }); tone(b, { d: 0.14, f: 4650, a: 0.4, dec: 0.025 });
    click(b, 0, 6000, 0.6, 0.003); thump(b, 0, 500, 250, 0.3, 0.012);
  }, { g: 0.36, gap: 0.03, prio: 0.95 }),
  kill_confirm: S(0.55, (b) => {
    for (const [f, t, dec] of [[880, 0, 0.05], [1318.5, 0.085, 0.09]]) {
      tone(b, { t, d: dec * 5, f, type: 'tri', a: 0.8, dec }); tone(b, { t, d: dec * 4, f: f * 2, a: 0.3, dec: dec * 0.7 });
    }
    click(b, 0, 3500, 0.4, 0.003);
  }, { g: 0.36, prio: 0.95 }),
  hurt: S(0.62, (b) => {
    thump(b, 0, 120, 45, 1.2, 0.06, 0.025); body(b, 0, 0.8, 0.03, 900, 200);
    for (const f of [3900, 3946]) tone(b, { t: 0.02, d: 0.58, f, a: 0.1, att: 0.03, dec: 0.18 });   // tinnitus
  }, { pv: 0.05, g: 0.6, gap: 0.08, prio: 0.9 }),
  shield_break: S(0.7, (b) => {
    noise(b, { d: 0.55, a: 0.9, dec: 0.12, dens: 700, hp: 3000 }); thump(b, 0, 180, 50, 0.8, 0.06);
    tone(b, { d: 0.5, f: 1800, f1: 200, sw: 0.12, type: 'saw', a: 0.5, dec: 0.15, fm: { r: 3.1, i: 3, dec: 0.2 } });
    for (let k = 0; k < 5; k++) ping(b, rnd(0, 0.15), rnd(2500, 6000), 0.3, 0.05);
  }, { g: 0.55, prio: 0.9 }),
  low_health: S(0.62, (b) => { // lub-dub
    thump(b, 0, 125, 58, 1.2, 0.065, 0.03); thump(b, 0.17, 105, 52, 0.8, 0.065, 0.03); body(b, 0, 0.25, 0.025, 420, 160); body(b, 0.17, 0.18, 0.025, 380, 150);
  }, { g: 0.6, prio: 0.8 }),
  pickup: S(0.4, (b) => {
    [660, 880, 1320].forEach((f, k) => tone(b, { t: k * 0.05, d: 0.25, f, type: 'tri', a: 0.7, dec: 0.06 }));
    tone(b, { t: 0.1, d: 0.28, f: 2640, a: 0.25, dec: 0.08 });
  }, { g: 0.3, prio: 0.8 }),
  ui_hover: S(0.06, (b) => { tone(b, { d: 0.05, f: 1500, a: 0.7, dec: 0.012 }); click(b, 0, 3500, 0.3, 0.003); }, { g: 0.14, gap: 0.03 }),
  ui_click: S(0.12, (b) => {
    click(b, 0, 2500, 0.8, 0.004); tone(b, { d: 0.1, f: 1100, a: 0.7, dec: 0.02 }); tone(b, { t: 0.012, d: 0.1, f: 1650, a: 0.4, dec: 0.02 });
  }, { g: 0.26, prio: 0.9 }),
  ui_back: S(0.12, (b) => { tone(b, { d: 0.1, f: 800, f1: 480, a: 0.8, dec: 0.03 }); click(b, 0, 1800, 0.5, 0.004); }, { g: 0.26, prio: 0.9 }),
  announce: S(0.3, (b) => { // radio squelch + two blips
    noise(b, { d: 0.07, a: 0.8, att: 0.002, rel: 0.01, bp: 2200, q: 1.5 });
    tone(b, { t: 0.07, d: 0.06, f: 1250, type: 'square', a: 0.35, rel: 0.01, lp: 3000 });
    tone(b, { t: 0.14, d: 0.07, f: 1650, type: 'square', a: 0.35, rel: 0.01, lp: 3000 });
    noise(b, { t: 0.21, d: 0.05, a: 0.5, att: 0.002, rel: 0.03, bp: 2500, q: 1.5 });
  }, { g: 0.26, prio: 0.9 }),
  objective: S(1, (b) => {
    for (const [f, t] of [[587.33, 0], [880, 0.09], [1174.66, 0.18]]) {
      tone(b, { t, d: 0.8, f, a: 0.7, dec: 0.2 }); tone(b, { t, d: 0.5, f: f * 2.01, a: 0.2, dec: 0.1 }); tone(b, { t, d: 0.3, f: f * 3, a: 0.08, dec: 0.05 });
    }
  }, { g: 0.3, rev: 1, prio: 0.9 }),
  warning: S(0.42, (b) => {
    for (const t of [0, 0.19]) {
      tone(b, { t, d: 0.13, f: 932, type: 'square', a: 0.5, att: 0.004, rel: 0.02, lp: 3000 });
      tone(b, { t, d: 0.13, f: 622, type: 'saw', a: 0.35, att: 0.004, rel: 0.02, lp: 2400 });
    }
  }, { g: 0.28, prio: 0.9 }),
  countdown_tick: S(0.14, (b) => {
    tone(b, { d: 0.13, f: 1000, a: 0.8, dec: 0.03 }); tone(b, { d: 0.1, f: 2000, a: 0.2, dec: 0.02 }); click(b, 0, 3000, 0.5, 0.003);
  }, { g: 0.3, prio: 0.9 }),
  match_start: S(3, (b) => {
    thump(b, 0, 95, 36, 1.2, 0.45, 0.15); body(b, 0, 1, 0.12, 3500, 300);
    for (const f of [36.71, 73.1, 73.8, 110.2, 146.4]) tone(b, { d: 2.8, f, type: 'saw', a: 0.45, att: 0.02, dec: 0.8, rel: 0.5, lp: [2400, 300] });
    whoosh(b, 0.05, 1.7, 300, 5000, 0.45, 1, 0.8);
    noise(b, { t: 0.05, d: 2.8, a: 0.4, att: 0.05, dec: 0.8, lp: 240, color: 'brown' });
  }, { g: 0.9, rev: 2, prio: 1, big: true, drive: 1.6 }),
  victory_sting: S(2.4, (b) => {
    for (const [f, t] of [[293.66, 0], [369.99, 0.13], [440, 0.26], [587.33, 0.39]]) {
      for (const dt of [0.996, 1.004]) tone(b, { t, d: 2.4 - t, f: f * dt, type: 'saw', a: 0.35, att: 0.015, dec: 0.9, rel: 0.3, lp: [3200, 900] });
      tone(b, { t, d: 0.4, f: f * 2, a: 0.2, dec: 0.08 });
    }
    thump(b, 0.39, 110, 45, 1, 0.2, 0.05); body(b, 0.39, 0.4, 0.05, 2500, 400);
  }, { g: 0.45, rev: 2, prio: 0.95 }),
  defeat_sting: S(2.6, (b) => {
    [[220, 0], [174.61, 0.28], [155.56, 0.56], [146.83, 0.9]].forEach(([f, t], k) => {
      for (const dt of [0.995, 1.005]) tone(b, { t, d: k === 3 ? 1.7 : 0.6, f: f * dt, type: 'saw', a: 0.4, att: 0.02, dec: k === 3 ? 0.7 : 0.3, rel: 0.2, lp: [2600, 600] });
    });
    tone(b, { t: 0.9, d: 1.7, f: 73.42, f1: 69, type: 'saw', a: 0.4, att: 0.03, dec: 0.7, rel: 0.3, lp: [1200, 300] });
    thump(b, 0.9, 100, 42, 0.7, 0.3, 0.1);
  }, { g: 0.5, rev: 2, prio: 0.95 }),

  // ── mech ──
  // ── 两界切换 ──
  phase_shift: S(0.9, (b) => { // 向内吸的反向嘶声 + 低音一沉 + 玻璃般的泛音
    noise(b, { d: 0.22, a: 0.9, att: 0.2, rel: 0.02, ep: 2.5, bp: [600, 5200], q: 1.4 });
    thump(b, 0.2, 150, 38, 1.1, 0.11, 0.05); crack(b, 0.2, 0.6, 0.012, 3000);
    for (const [f, a] of [[523.25, 0.3], [784, 0.24], [1174.7, 0.18], [1568, 0.1]]) tone(b, { t: 0.2, d: 0.7, f, f1: f * 0.985, a, att: 0.004, dec: 0.2, fm: { r: 2.01, i: 0.6 } });
    whoosh(b, 0.2, 0.55, 3800, 500, 0.5, 1.2, 0.12);
  }, { g: 0.6, rev: 1, prio: 0.9, gap: 0.12 }),
  phase_block: S(0.4, (b) => { // 切换受阻：两声发闷的错音
    for (const [f, t] of [[196, 0], [185, 0.11]]) tone(b, { t, d: 0.26, f, type: 'saw', a: 0.5, att: 0.005, dec: 0.07, lp: 900 });
    click(b, 0, 1400, 0.5, 0.006);
  }, { g: 0.5, prio: 0.7, gap: 0.2 }),
  phase_peek: S(0.5, (b) => { // 蜃影透视展开：一声上扬的扫频
    tone(b, { d: 0.45, f: 700, f1: 2100, a: 0.3, att: 0.03, rel: 0.25, fm: { r: 3.0, i: 0.4 } });
    whoosh(b, 0, 0.45, 1500, 6000, 0.4, 2, 0.6);
  }, { g: 0.35, prio: 0.5, gap: 0.3 }),
  lever: S(0.9, (b) => { // 机关：金属撞击 + 链条 + 远处石门的闷响
    crack(b, 0, 0.9, 0.006, 2200); ping(b, 0, 620, 0.8, 0.12); thump(b, 0.02, 180, 70, 0.9, 0.05);
    for (let i = 0; i < 6; i++) click(b, 0.12 + i * 0.055, rnd(1800, 3200), 0.45, 0.005, 3);
    noise(b, { t: 0.3, d: 0.6, a: 0.6, att: 0.08, dec: 0.2, lp: 300, color: 'brown' });
  }, { g: 0.6, rev: 1, prio: 0.8 }),
  checkpoint: S(0.7, (b) => { // 存档点：三声上行的钟音
    for (const [f, t] of [[659.25, 0], [880, 0.09], [1318.5, 0.18]]) tone(b, { t, d: 0.5, f, a: 0.4, att: 0.004, dec: 0.14, fm: { r: 2.0, i: 0.3 } });
  }, { g: 0.4, prio: 0.6 }),
  mech_ready: S(1.8, (b) => { // deep two-note horn
    for (const [f, t] of [[73.42, 0], [110, 0.45]]) {
      for (const m of [0.995, 1.005, 2, 2.01]) tone(b, { t, d: 1.8 - t, f: f * m, type: 'saw', a: m >= 2 ? 0.4 : 0.45, att: 0.12, rel: 0.6, lp: [500, 2200] });
    }
    tone(b, { d: 1.8, f: 36.71, a: 0.3, att: 0.1, rel: 0.6 });
  }, { g: 0.6, rev: 2, prio: 0.9 }),
  mech_drop_warn: S(2.5, (b) => {
    tone(b, { d: 2.5, f: 3000, f1: 650, a: 0.5, att: 2.35, rel: 0.12, ep: 2, fm: { r: 0.013, i: 2 } });
    noise(b, { d: 2.5, a: 0.9, att: 2.35, rel: 0.12, ep: 2, bp: [5500, 900], q: 2.5 });
    noise(b, { d: 2.5, a: 0.7, att: 2.4, rel: 0.08, ep: 2, lp: 350, color: 'brown' });
  }, { g: 0.7, prio: 0.9 }),
  mech_impact: S(2.6, (b) => {
    boom(b, 0, 1.5); thump(b, 0, 90, 34, 1, 0.4, 0.16); ping(b, 0, 170, 0.5, 0.3); ping(b, 0.01, 395, 0.3, 0.2);
    debris(b, 0.3, 2, 0.4, 70, 1800);
  }, { g: 1, rev: 2, prio: 1, big: true, drive: 2.4 }),
  mech_step: S(0.75, (b) => {
    thump(b, 0, 115, 45, 1, 0.1, 0.045); body(b, 0, 1.2, 0.05, 2400, 300); ping(b, 0, rnd(210, 260), 0.6, 0.12); click(b, 0, 700, 0.9, 0.02);
    tone(b, { t: 0.12, d: 0.4, f: 220, f1: 430, type: 'saw', a: 0.14, att: 0.05, rel: 0.2, lp: 1800 });   // servo
    debris(b, 0.05, 0.5, 0.3, 60, 2000);
  }, { v: 3, pv: 0.06, g: 0.8, rev: 1, gap: 0.1, prio: 0.75, drive: 1.6 }),
  mech_cannon: S(1.3, (b) => {
    thump(b, 0, 160, 45, 1.2, 0.12, 0.05); crack(b, 0, 1.1, 0.012, 1800);
    noise(b, { d: 0.6, a: 1.2, dec: 0.1, lp: [6000, 300] }); noise(b, { d: 0.5, a: 0.9, dec: 0.08, bp: [600, 200], q: 0.8 });
    click(b, 0.09, 1200, 0.3, 0.015); ping(b, 0.09, 520, 0.15, 0.06);
    noise(b, { t: 0.04, d: 1.2, a: 0.4, dec: 0.3, lp: [2500, 250], color: 'pink' });
  }, { v: 2, pv: 0.04, g: 1, rev: 2, gap: 0.05, prio: 0.95, drive: 2.4 }),
  mech_rocket: S(1.2, (b) => {
    crack(b, 0, 0.6, 0.01, 1500); thump(b, 0, 180, 60, 0.8, 0.06);
    noise(b, { d: 1.15, a: 1, att: 0.05, dec: 0.4, bp: [600, 3500], q: 0.8 });
    noise(b, { d: 1.1, a: 0.8, att: 0.03, dec: 0.35, lp: [1500, 500], color: 'brown' });
    tone(b, { d: 1, f: 90, f1: 200, type: 'saw', a: 0.3, att: 0.03, dec: 0.3, lp: 500 });
  }, { v: 2, pv: 0.06, g: 0.7, rev: 1, gap: 0.05, prio: 0.8 }),
  mech_dash: S(0.8, (b) => {
    noise(b, { d: 0.78, a: 1.2, att: 0.02, dec: 0.2, lp: [3500, 400], color: 'pink' });
    whoosh(b, 0, 0.7, 400, 2500, 0.7, 0.8, 0.25); thump(b, 0, 120, 40, 1, 0.1, 0.04);
    tone(b, { d: 0.7, f: 110, f1: 55, type: 'saw', a: 0.5, dec: 0.25, lp: 700 });
  }, { g: 0.8, rev: 1, prio: 0.8, drive: 1.5 }),
  mech_embark: S(2.4, (b) => { // hydraulics → seal → power-up → systems beeps
    tone(b, { d: 0.6, f: 90, f1: 180, type: 'saw', a: 0.3, att: 0.05, rel: 0.2, lp: 900 });
    noise(b, { d: 0.6, a: 0.3, att: 0.05, rel: 0.2, bp: [800, 2000], q: 1.5 });
    thump(b, 0.7, 110, 40, 1, 0.08); click(b, 0.7, 900, 0.7, 0.02); noise(b, { t: 0.75, d: 0.6, a: 0.4, dec: 0.15, hp: 4000 });
    tone(b, { t: 1, d: 1.4, f: 40, f1: 110, type: 'saw', a: 0.5, att: 0.6, rel: 0.4, lp: [300, 1800] });
    tone(b, { t: 1, d: 1.2, f: 220, f1: 880, a: 0.15, att: 0.8, rel: 0.3 });
    tone(b, { t: 1.9, d: 0.07, f: 1760, a: 0.2, rel: 0.02 }); tone(b, { t: 2.02, d: 0.12, f: 2349, a: 0.2, rel: 0.04 });
  }, { g: 0.7, prio: 0.9 }),
  mech_disembark: S(1.4, (b) => {
    tone(b, { d: 0.95, f: 110, f1: 40, type: 'saw', a: 0.5, att: 0.02, rel: 0.5, lp: [1800, 300] });
    noise(b, { t: 0.1, d: 0.6, a: 0.5, dec: 0.15, hp: 3500 });
    thump(b, 0.55, 120, 45, 0.9, 0.07); click(b, 0.55, 1000, 0.6, 0.02); ping(b, 0.55, 340, 0.2, 0.1);
    noise(b, { t: 0.6, d: 0.7, a: 0.25, att: 0.05, rel: 0.4, bp: [1800, 700], q: 1.5 });
  }, { g: 0.65, prio: 0.9 }),
  mech_shield_hit: S(0.4, (b) => {
    const f = rnd(500, 700);
    tone(b, { d: 0.36, f, f1: f * 0.6, a: 0.8, dec: 0.08, fm: { r: 3.5, i: 3, dec: 0.08 } });
    noise(b, { d: 0.2, a: 0.5, dec: 0.04, bp: [5000, 1500], q: 2 }); thump(b, 0, 200, 80, 0.5, 0.03);
  }, { v: 3, pv: 0.08, g: 0.5, gap: 0.04, prio: 0.6 }),
  mech_doomed: S(1.5, (b) => { // klaxon x3
    for (const t of [0, 0.5, 1]) {
      tone(b, { t, d: 0.36, f: 392, f1: 523, type: 'saw', a: 0.6, att: 0.02, rel: 0.04, lp: 2600 });
      tone(b, { t, d: 0.36, f: 196, f1: 261, type: 'square', a: 0.4, att: 0.02, rel: 0.04, lp: 1500 });
    }
  }, { g: 0.36, prio: 0.95 }),
  eject: S(1.7, (b) => {
    for (const t of [0, 0.045, 0.09]) { crack(b, t, 1, 0.012, 1500); thump(b, t, 200, 60, 0.9, 0.04); }   // explosive bolts
    noise(b, { t: 0.1, d: 1.55, a: 1, att: 0.08, dec: 0.5, bp: [800, 5000], q: 0.9 });
    noise(b, { t: 0.1, d: 1.4, a: 0.8, att: 0.05, dec: 0.4, lp: [1800, 400], color: 'brown' });
    tone(b, { t: 0.1, d: 1.2, f: 150, f1: 500, type: 'saw', a: 0.25, att: 0.05, dec: 0.4, lp: 1200 });
  }, { g: 0.9, rev: 2, prio: 1, big: true, drive: 1.8 }),
  mech_explode: S(3.3, (b) => { // three precursor blasts, then the big one
    boom(b, 0, 0.5); boom(b, 0.22, 0.6); boom(b, 0.5, 0.5); boom(b, 0.85, 1.4);
    tone(b, { d: 0.9, f: 90, f1: 40, type: 'saw', a: 0.5, att: 0.05, rel: 0.1, lp: 500 });
    for (let k = 0; k < 7; k++) ping(b, rnd(1, 2.3), rnd(300, 1300), 0.25, 0.1);
    debris(b, 1, 2.2, 0.5, 80, 2200);
  }, { g: 1, rev: 2, prio: 1, big: true, drive: 2.4 }),
  mech_melee: S(0.9, (b) => {
    thump(b, 0, 140, 45, 1.1, 0.1, 0.04); crack(b, 0, 1.2, 0.008, 1800); body(b, 0, 1.2, 0.05, 3000, 400);
    ping(b, 0, 160, 0.6, 0.25); ping(b, 0, 370, 0.5, 0.18); ping(b, 0, 890, 0.3, 0.1); debris(b, 0.05, 0.7, 0.35, 70);
  }, { pv: 0.05, g: 0.9, rev: 1, prio: 0.9, drive: 1.8 }),
  pod_incoming: S(1.5, (b) => {
    tone(b, { d: 1.5, f: 3800, f1: 1100, a: 0.45, att: 1.38, rel: 0.1, ep: 2 });
    noise(b, { d: 1.5, a: 0.9, att: 1.38, rel: 0.1, ep: 2, bp: [6000, 1500], q: 2.5 });
  }, { g: 0.55, prio: 0.7 }),
  pod_impact: S(1.5, (b) => {
    boom(b, 0, 0.8); ping(b, 0, 300, 0.4, 0.15); noise(b, { t: 0.15, d: 1.3, a: 0.35, att: 0.05, dec: 0.35, hp: 3000 });   // hiss
  }, { g: 0.9, rev: 2, prio: 0.9, big: true, drive: 2 }),
  drone_die: S(0.65, (b) => {
    noise(b, { d: 0.45, a: 0.8, dec: 0.12, dens: 1200, hp: 2500 });
    tone(b, { d: 0.4, f: 900, f1: 120, sw: 0.1, type: 'saw', a: 0.5, dec: 0.12, fm: { r: 7.3, i: 4 } });
    thump(b, 0.22, 200, 60, 1, 0.05); crack(b, 0.22, 0.8, 0.012, 1500); body(b, 0.22, 0.6, 0.04, 2500, 400);
  }, { v: 2, pv: 0.08, g: 0.55, rev: 1, prio: 0.6 }),
  robot_die: S(1, (b) => {
    tone(b, { d: 0.75, f: 600, f1: 60, type: 'saw', a: 0.45, att: 0.01, rel: 0.3, lp: [3000, 500] });
    tone(b, { d: 0.75, f: 300, f1: 30, type: 'square', a: 0.3, rel: 0.3, lp: 1200 });
    noise(b, { d: 0.5, a: 0.3, dec: 0.2, dens: 300, hp: 3000 });
    ping(b, 0.6, rnd(280, 360), 0.7, 0.1); thump(b, 0.6, 150, 60, 0.9, 0.05); click(b, 0.6, 1000, 0.6, 0.02);
  }, { v: 2, pv: 0.08, g: 0.6, rev: 1, prio: 0.6 }),

  // ── loop material ──
  l_heart: S(0.86, (b) => { thump(b, 0.01, 125, 58, 1.2, 0.065, 0.03); thump(b, 0.2, 105, 52, 0.8, 0.065, 0.03); body(b, 0.01, 0.25, 0.025, 420, 160); body(b, 0.2, 0.18, 0.025, 380, 150); }),
  l_steps: S(0.42, (b) => { for (const t of [0.01, 0.22]) { thump(b, t, 140, 70, 0.7, 0.025); click(b, t, rnd(900, 1300), 0.8, 0.012); } }),
  l_grit: S(1.3, (b) => noise(b, { d: 1.3, dens: 240, hp: 1500, rel: 0.001 })),

  // ── music instruments (rendered at D; pitched via playbackRate) ──
  m_pluck: S(2.2, (b) => { // oud-like double course
    pluck(b, { d: 2.2, f: D3, a: 1, fb: 0.99, dec: 0.7, lp: 3500 }); pluck(b, { d: 2.2, f: D3 * 1.004, a: 0.6, fb: 0.989, dec: 0.6, lp: 3000 });
    click(b, 0, 1800, 0.2, 0.004);
  }, { v: 2 }),
  m_ost: S(0.5, (b) => {
    pluck(b, { d: 0.5, f: D3, a: 1, fb: 0.98, dec: 0.12 }); tone(b, { d: 0.3, f: D3, type: 'saw', a: 0.25, dec: 0.06, lp: [2400, 500] });
  }),
  m_pulse: S(0.32, (b) => {
    tone(b, { d: 0.3, f: 73.42, type: 'saw', a: 0.9, dec: 0.09, lp: [1800, 300] }); tone(b, { d: 0.3, f: 36.71, a: 0.35, dec: 0.1 });
    click(b, 0, 900, 0.15, 0.004);
  }, { drive: 1.5 }),
  m_taiko: S(1.1, (b) => {
    thump(b, 0, 170, 74, 1.1, 0.19, 0.03); body(b, 0, 1, 0.04, 2500, 400); click(b, 0, 2400, 0.4, 0.005);
    noise(b, { d: 0.9, a: 0.12, dec: 0.25, lp: 350, color: 'brown' });
  }, { v: 2, drive: 1.8 }),
  m_taikoHi: S(0.5, (b) => { thump(b, 0, 260, 125, 1, 0.1, 0.02); body(b, 0, 0.5, 0.025, 2500, 500); click(b, 0, 3000, 0.3, 0.004); }, { v: 2 }),
  m_rim: S(0.14, (b) => { click(b, 0, 1700, 1, 0.007, 4); tone(b, { d: 0.1, f: 820, a: 0.5, dec: 0.02 }); tone(b, { d: 0.1, f: 1930, a: 0.25, dec: 0.012 }); }),
  m_shaker: S(0.09, (b) => noise(b, { d: 0.08, att: 0.008, dec: 0.018, hp: 5500 }), { v: 3 }),
  m_brass: S(2.6, (b) => {
    for (const m of [0.994, 1, 1.007, 2.003]) tone(b, { d: 2.6, f: 73.42 * m, type: 'saw', a: 0.5, att: 0.04, dec: 0.9, rel: 0.4, lp: [2600, 450] });
    tone(b, { d: 2.6, f: 36.71, a: 0.3, att: 0.03, dec: 1, rel: 0.4 });
  }, { drive: 1.6 }),
};

// ───────────────────────────── loops (live nodes) ─────────────────────────────
// part: n noise colour | o oscillator type + hz | b looped rendered buffer; f/fhz/q filter;
// g gain; lfo [Hz, depth 0..1] on gain; flfo [Hz, ±Hz] on filter; rt = playbackRate follows pitch.
const LOOPS = {
  wind: { g: 0.3, att: 1.2, fade: 0.6, parts: [
    { n: 'pink', f: 'bandpass', fhz: 380, q: 0.5, g: 0.7, lfo: [0.08, 0.2] },
    { n: 'white', f: 'bandpass', fhz: 1500, q: 1.6, g: 0.3, lfo: [0.13, 0.5], flfo: [0.05, 450] },
    { n: 'brown', f: 'lowpass', fhz: 170, g: 0.9, lfo: [0.05, 0.3] }],
    tick(inst, dt, now) { // slow random gusts
      inst.gT = (inst.gT || 0) - dt;
      if (inst.gT > 0) return;
      inst.gT = rnd(1.5, 5);
      const s = Math.random(), [a, w] = inst.parts;
      a.g.gain.setTargetAtTime(0.3 + s * 0.7, now, rnd(0.5, 1.5));
      a.flt.frequency.setTargetAtTime(280 + s * 420, now, 1);
      w.g.gain.setTargetAtTime(0.08 + s * s * 0.5, now, rnd(0.4, 1.2));
    } },
  slide: { g: 0.75, parts: [
    { n: 'pink', f: 'bandpass', fhz: 1700, q: 0.7, g: 0.7 },
    { n: 'brown', f: 'lowpass', fhz: 420, g: 0.6 },
    { b: 'l_grit', f: 'highpass', fhz: 1200, g: 0.8, rt: 1 }] },
  wallrun: { g: 1, parts: [
    { n: 'white', f: 'bandpass', fhz: 2300, q: 0.8, g: 0.3, lfo: [7, 0.25] },
    { n: 'pink', f: 'highpass', fhz: 700, g: 0.25 },
    { b: 'l_steps', g: 0.5, rt: 1 }] },
  grapple_reel: { g: 0.65, parts: [
    { o: 'sawtooth', hz: 310, f: 'lowpass', fhz: 2400, g: 0.22, lfo: [41, 0.6] },
    { o: 'square', hz: 623, f: 'bandpass', fhz: 1900, q: 3, g: 0.12 },
    { n: 'white', f: 'bandpass', fhz: 4200, q: 5, g: 0.5 }] },
  speed_wind: { g: 0.5, att: 0.15, fade: 0.15, parts: [
    { n: 'pink', f: 'lowpass', fhz: 850, g: 0.8, lfo: [0.7, 0.15] },
    { n: 'white', f: 'bandpass', fhz: 2600, q: 0.6, g: 0.45, lfo: [4.3, 0.2] }] },
  mech_hum: { g: 0.25, att: 0.4, fade: 0.25, parts: [
    { o: 'sawtooth', hz: 55, f: 'lowpass', fhz: 300, g: 0.5 },
    { o: 'sawtooth', hz: 55.6, f: 'lowpass', fhz: 420, g: 0.4 },
    { o: 'sine', hz: 36.7, g: 0.2, lfo: [0.31, 0.3] },
    { o: 'square', hz: 110.3, f: 'bandpass', fhz: 660, q: 4, g: 0.5, lfo: [6.1, 0.4] },
    { n: 'brown', f: 'lowpass', fhz: 300, g: 0.6 }] },
  mech_laser: { g: 0.4, att: 0.02, parts: [
    { o: 'sawtooth', hz: 110, f: 'highpass', fhz: 500, g: 0.8, lfo: [58, 0.6] },
    { o: 'sawtooth', hz: 164.2, f: 'bandpass', fhz: 1800, q: 1.2, g: 0.9, lfo: [31, 0.5] },
    { o: 'square', hz: 221.5, f: 'bandpass', fhz: 3200, q: 2, g: 0.5 },
    { o: 'sawtooth', hz: 55, f: 'lowpass', fhz: 400, g: 0.5 },
    { o: 'sine', hz: 62, g: 0.25 },
    { n: 'white', f: 'highpass', fhz: 4500, g: 0.35, lfo: [58, 0.8] }] },
  rail_hold: { g: 0.3, att: 0.08, parts: [
    { o: 'sine', hz: 880, g: 0.25, lfo: [13, 0.6] },
    { o: 'sawtooth', hz: 220, f: 'bandpass', fhz: 1800, q: 6, g: 1.2, lfo: [27, 0.4] },
    { o: 'sine', hz: 90, g: 0.25 },
    { n: 'white', f: 'bandpass', fhz: 6000, q: 3, g: 0.5, lfo: [19, 0.7] }] },
  heartbeat: { g: 0.7, att: 0.1, fade: 0.2, parts: [{ b: 'l_heart', g: 1, rt: 1 }] },
  zipline_ride: { g: 0.8, parts: [
    { n: 'white', f: 'bandpass', fhz: 1200, q: 2, g: 1, lfo: [23, 0.5] },
    { o: 'sawtooth', hz: 180, f: 'bandpass', fhz: 900, q: 3, g: 0.5 },
    { n: 'pink', f: 'highpass', fhz: 3000, g: 0.3 }] },
  drone_hum: { g: 0.9, att: 0.2, fade: 0.1, parts: [
    { o: 'sawtooth', hz: 190, f: 'lowpass', fhz: 1400, g: 0.3, lfo: [28, 0.5] },
    { o: 'square', hz: 381, f: 'lowpass', fhz: 2200, g: 0.08 },
    { n: 'white', f: 'bandpass', fhz: 3000, q: 1.5, g: 0.12, lfo: [28, 0.6] }] },
};

// ───────────────────────────── music ─────────────────────────────
const HIJAZ = [0, 1, 4, 5, 7, 8, 10]; // D Phrygian dominant
const deg = (d) => HIJAZ[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const MENU_CHORDS = [[-12, -5, 0, 4], [-12, -7, -4, 0], [-11, -7, -4, 1], [-12, -5, 0, 7]]; // D · Gm/D · Eb · D
const OST = [ // 16th-note ostinato, semitones above D3
  [0, 12, 7, 12, 1, 12, 7, 12, 0, 12, 7, 12, 4, 12, 5, 12],
  [0, 12, 7, 12, 1, 12, 8, 12, 0, 12, 7, 12, 13, 12, 10, 8]];
const MECH_HITS = [1, 0, 0, 0.6, 0, 0, 0.7, 0, 1, 0, 0, 0.6, 0, 0, 0.7, 0];

// sched(e, m, s, t): schedule everything belonging to step s at context time t
const MUSIC = {
  menu: { step: 0.5, gain: 1.6, sched(e, m, s, t) {
    const i = s & 15, bar = (s >> 4) & 3;
    if (i === 0) {
      e._pad(m.bus, t, MENU_CHORDS[bar], { dur: 10, att: 3, rel: 4.5, gain: 0.07, lp: 420, lp1: 950 });
      e._pad(m.bus, t, bar === 2 ? [-23, -11] : [-24, -12], { dur: 9, att: 3.5, rel: 4.5, gain: 0.12, type: 'sine' });  // sub swell
      if (bar === 0) e._note(m.bus, 'm_taiko', t, 0.3, -4);
    }
    if (m.ph > 0) { // sparse oud phrase: random walk through the scale, resolving to D or A
      m.ph--;
      m.deg = clamp(m.deg + [-2, -1, -1, 1, 1, 2][(Math.random() * 6) | 0], 0, 11);
      if (m.ph === 0) { m.deg = [0, 4, 7][(Math.random() * 3) | 0]; m.rest = 5 + ((Math.random() * 9) | 0); }
      const tt = t + (Math.random() < 0.3 ? 0.25 : 0), gn = rnd(0.5, 0.8);
      if (Math.random() < 0.35) e._note(m.bus, 'm_pluck', tt - 0.07, gn * 0.5, deg(m.deg + 1));   // grace note
      e._note(m.bus, 'm_pluck', tt, gn, deg(m.deg));
    } else if (--m.rest <= 0) m.ph = 2 + ((Math.random() * 4) | 0);
  } },
  combat: { step: 60 / 116 / 4, gain: 0.7, sched(e, m, s, t) {
    const i = s & 15, bar = (s >> 4) & 3, I = e._int;
    if (i % 2 === 0) e._note(m.bus, 'm_pulse', t, i % 8 === 0 ? 0.8 : 0.5, bar === 3 && i >= 8 ? 1 : 0);          // driving low pulse
    if (i === 0 || i === 6 || i === 12) e._note(m.bus, 'm_taiko', t, i === 0 ? 1 : 0.7);                           // 3+3+2
    if (i === 0 && bar % 2 === 0) e._pad(m.bus, t, bar === 2 ? [-11, -4, 1] : [-12, -5, 0], { dur: this.step * 34, att: 1.5, rel: 2, gain: 0.05, lp: 420, lp1: 700 });
    if (I > 0.12) {
      e._note(m.l1, 'm_ost', t, i % 4 === 0 ? 1.1 : 0.75, OST[bar & 1][i]);
      if (i === 4 || i === 12 || (bar === 3 && i > 12)) e._note(m.l1, 'm_taikoHi', t, 0.6);
    }
    if (I > 0.5) {
      e._note(m.l2, 'm_shaker', t, i % 2 ? 0.25 : 0.45);
      if (i === 3 || i === 10 || i === 15) e._note(m.l2, 'm_taiko', t, 0.5, 5);
      if (i === 2 || i === 9 || i === 11) e._note(m.l2, 'm_rim', t, 0.5);
      if (i === 0 && bar % 2 === 0) e._note(m.l2, 'm_brass', t, 0.6, bar === 2 ? 1 : 0);
    }
  } },
  mech: { step: 60 / 104 / 4, gain: 0.65, sched(e, m, s, t) {
    const i = s & 15, bar = (s >> 4) & 3, I = e._int;
    if (i % 2 === 0) e._note(m.bus, 'm_pulse', t, i % 4 === 0 ? 0.7 : 0.5, i % 4 === 0 ? -12 : (bar === 3 && i > 8 ? 1 : 0));
    if (MECH_HITS[i]) e._note(m.bus, 'm_taiko', t, MECH_HITS[i], -3);
    if (i === 4 || i === 12) { e._note(m.bus, 'm_taikoHi', t, 0.7, -2); e._note(m.bus, 'm_rim', t, 0.5, -9); }     // drum + anvil
    if (i === 0) {
      e._note(m.bus, 'm_brass', t, 0.4, bar === 2 ? 1 : 0);
      if (bar % 2 === 0) e._pad(m.bus, t, bar === 2 ? [-23, -11, -4] : [-24, -12, -5], { dur: this.step * 34, att: 1, rel: 2, gain: 0.07, lp: 300, lp1: 600 });
    }
    if (I > 0.12) {
      e._note(m.l1, 'm_shaker', t, i % 2 ? 0.2 : 0.4);
      e._note(m.l1, 'm_ost', t, i % 4 === 0 ? 1.1 : 0.75, OST[bar & 1][i] - 12);
    }
    if (I > 0.5) {
      if (i === 2 || i === 7 || i === 10 || i === 15) e._note(m.l2, 'm_taikoHi', t, 0.55, 3);
      if (bar === 3 && i >= 12) e._note(m.l2, 'm_taiko', t, 0.5 + (i - 12) * 0.12, 2);
      if (i % 4 === 2) e._note(m.l2, 'm_rim', t, 0.45);
    }
  } },
  victory: { step: 0.25, gain: 1.8, sting: 36, sched(e, m, s, t) {
    if (s !== 0) return;
    const bus = m.bus;
    e._note(bus, 'm_taiko', t, 1); e._note(bus, 'm_brass', t, 0.6);
    [0, 4, 7, 12].forEach((sm, k) => e._note(bus, 'm_pluck', t + 0.18 * k, 0.8, sm));              // rising D-major arpeggio
    e._note(bus, 'm_taikoHi', t + 0.72, 0.7); e._note(bus, 'm_taiko', t + 0.9, 1);
    e._note(bus, 'm_brass', t + 0.9, 0.8); e._note(bus, 'm_brass', t + 0.9, 0.45, 7);
    e._pad(bus, t + 0.9, [-12, -5, 0, 4, 7], { dur: 6, att: 0.25, rel: 4, gain: 0.05, lp: 900, lp1: 2200 });
    e._pad(bus, t + 0.9, [-24, -12], { dur: 5, att: 0.3, rel: 3.5, gain: 0.12, type: 'sine' });
    [12, 16, 19, 24].forEach((sm, k) => e._note(bus, 'm_pluck', t + 1.7 + 0.4 * k, 0.5, sm));
  } },
  defeat: { step: 0.25, gain: 1, sting: 36, sched(e, m, s, t) {
    if (s !== 0) return;
    const bus = m.bus;
    e._note(bus, 'm_taiko', t, 1, -4); e._note(bus, 'm_brass', t, 0.8, 1);                          // Eb …
    e._pad(bus, t, [-11, -4, 1], { dur: 3.2, att: 0.3, rel: 2, gain: 0.06, lp: 700, lp1: 400 });
    [7, 5, 4, 1, 0].forEach((sm, k) => e._note(bus, 'm_pluck', t + 0.5 + 0.55 * k, 0.6 - k * 0.06, sm));   // falling oud line
    e._note(bus, 'm_taiko', t + 2.2, 0.9, -5); e._note(bus, 'm_brass', t + 2.2, 0.8);              // … resolving down to D
    e._pad(bus, t + 2.2, [-12, -5, 0], { dur: 5.5, att: 0.4, rel: 4, gain: 0.06, lp: 600, lp1: 250 });
    e._pad(bus, t + 2.2, [-24, -12], { dur: 5.5, att: 0.5, rel: 4, gain: 0.12, type: 'sine' });
  } },
};

// stereo impulse response: short dark tail + discrete early echoes (walls of a town)
function makeIR(ctx) {
  const sr = ctx.sampleRate, len = Math.floor(1.4 * sr), ir = ctx.createBuffer(2, len, sr), tap = Math.floor(0.006 * sr);
  const echoes = [[[0.063, 2], [0.109, 1.4], [0.215, 1], [0.37, 0.6]], [[0.047, 2], [0.131, 1.4], [0.262, 0.9], [0.41, 0.55]]];
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0;
    for (let i = Math.floor(0.012 * sr); i < len; i++) {
      const t = i / sr, k = 0.25 + 0.6 * Math.min(1, t / 0.8);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t / 0.3) * 0.5;
    }
    for (const [dt, g] of echoes[ch]) { const o = Math.floor(dt * sr); for (let i = 0; i < tap; i++) d[o + i] += (Math.random() * 2 - 1) * g * (1 - i / tap); }
  }
  return ir;
}

// ───────────────────────────── engine ─────────────────────────────
export class AudioEngine {
  constructor() { // no AudioContext here (autoplay policy)
    this._ctx = null; this._ready = false; this._initP = null; this._paused = false;
    this._vol = { master: 0.9, sfx: 1, music: 0.6 };
    this._bufs = {}; this._noise = {}; this._voices = []; this._last = {}; this._warned = new Set();
    this._loops = new Map(); this._pending = new Map();
    this._mus = null; this._musOld = []; this._musWant = 'off'; this._int = 0;
    this._lx = 0; this._ly = 0; this._lz = 0; this._lpar = null;
    this._lnew = new Float32Array(9); this._lold = new Float32Array([0, 0, 0, 0, 0, -1, 0, 1, 0]);
    this._sweep = 0;
  }

  get ready() { return this._ready; }

  init() { // call from a user gesture; resolves true when usable
    if (!this._initP) this._initP = this._init();
    return this._initP;
  }

  async _init() {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { console.warn('[audio] Web Audio API unavailable'); return false; }
      const ctx = this._ctx = new AC({ latencyHint: 'interactive' });
      SR = Math.min(ctx.sampleRate, 48000);
      const G = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
      const lim = this._limiter = ctx.createDynamicsCompressor();
      lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.12;
      lim.connect(ctx.destination);
      this._master = G(this._vol.master, lim);
      this._duck = G(1, this._master);
      this._sfxGain = G(this._vol.sfx, this._duck);        // normal voices + loops (ducked)
      this._sfxDirect = G(this._vol.sfx, this._master);    // big voices + reverb return (never ducked)
      this._conv = ctx.createConvolver(); this._conv.buffer = makeIR(ctx);
      this._conv.connect(G(1, this._sfxDirect));
      this._revLo = G(0.35, this._conv); this._revHi = G(0.9, this._conv);
      this._musGain = G(this._vol.music * MUSIC_TRIM, this._duck);
      this._musBus = G(1, this._musGain);
      const dly = ctx.createDelay(1), dlp = ctx.createBiquadFilter();   // soft feedback delay gives the score some space
      dly.delayTime.value = 0.36; dlp.type = 'lowpass'; dlp.frequency.value = 1800;
      this._musBus.connect(dly); dly.connect(dlp); dlp.connect(G(0.3, dly)); dlp.connect(G(0.22, this._musGain));
      for (const c of ['white', 'pink', 'brown']) this._noise[c] = this._toBuffer(this._loopable(c));
      const L = ctx.listener;
      if (L.positionX) this._lpar = [L.positionX, L.positionY, L.positionZ, L.forwardX, L.forwardY, L.forwardZ, L.upX, L.upY, L.upZ];
      this._ready = true;
      if (ctx.state !== 'running') {
        const p = ctx.resume(); if (p && p.catch) p.catch(() => {});
        if (globalThis.addEventListener) { // context was created outside a gesture: unlock on the next one
          const unlock = () => { if (!this._paused && ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } };
          for (const ev of ['pointerdown', 'keydown']) globalThis.addEventListener(ev, unlock, { once: true });
        }
      }
      for (const [name, o] of this._pending.values()) this.loop(name, true, o);   // requests made before init
      this._pending.clear();
      const want = this._musWant; this._musWant = 'off'; this.music(want);
      this._prerender();   // background; anything played earlier is rendered on demand
      return true;
    } catch (err) {
      console.warn('[audio] init failed', err);
      this._ready = false; this._initP = null;
      return false;
    }
  }

  async _prerender() {
    let t0 = performance.now();
    for (const name of Object.keys(SFX)) {
      if (this._bufs[name]) continue;
      try { this._get(name); } catch (err) { /* reported on play */ }
      if (performance.now() - t0 > 6) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); }
    }
  }

  _loopable(color) { // 2 s noise with the tail cross-faded into the head for seamless looping
    const n = Math.floor(2 * SR), xf = Math.floor(0.05 * SR), x = rawNoise(n + xf, color, 0);
    for (let i = 0; i < xf; i++) { const k = i / xf; x[i] = x[i] * k + x[n + i] * (1 - k); }
    return x.subarray(0, n);
  }

  _toBuffer(x) { const ab = this._ctx.createBuffer(1, x.length, SR); ab.getChannelData(0).set(x); return ab; }

  _get(name) { // rendered variants of a recipe (lazy)
    let a = this._bufs[name];
    if (!a) {
      const R = SFX[name]; a = this._bufs[name] = [];
      for (let k = 0; k < R.v; k++) { const b = new Float32Array(Math.ceil(R.d * SR)); R.r(b); finish(b, R.drive); a.push(this._toBuffer(b)); }
    }
    return a;
  }

  _warn(name) { if (!this._warned.has(name)) { this._warned.add(name); console.warn('[audio] unknown sound: ' + name); } }

  // ── transport / volume ──
  resume() { this._paused = false; this._ctxCall('resume'); }
  suspend() { this._paused = true; this._ctxCall('suspend'); }
  _ctxCall(fn) { try { const p = this._ctx && this._ctx[fn](); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ } }

  setMasterVolume(v) { this._setVol('master', v); }
  setSfxVolume(v) { this._setVol('sfx', v); }
  setMusicVolume(v) { this._setVol('music', v); }
  _setVol(key, v) {
    v = clamp(+v || 0, 0, 1); this._vol[key] = v;
    if (!this._ready) return;
    const t = this._ctx.currentTime;
    if (key === 'master') this._master.gain.setTargetAtTime(v, t, 0.03);
    else if (key === 'music') this._musGain.gain.setTargetAtTime(v * MUSIC_TRIM, t, 0.03);
    else { this._sfxGain.gain.setTargetAtTime(v, t, 0.03); this._sfxDirect.gain.setTargetAtTime(v, t, 0.03); }
  }

  setListener(px, py, pz, fx, fy, fz, ux, uy, uz) {
    this._lx = px; this._ly = py; this._lz = pz;
    if (!this._ready) return;
    try {
      const v = this._lnew, old = this._lold, t = this._ctx.currentTime;
      v[0] = px; v[1] = py; v[2] = pz; v[3] = fx; v[4] = fy; v[5] = fz; v[6] = ux; v[7] = uy; v[8] = uz;
      if (this._lpar) {
        for (let i = 0; i < 9; i++) {
          if (v[i] === v[i] && Math.abs(v[i] - old[i]) > 1e-4) { old[i] = v[i]; this._lpar[i].setTargetAtTime(v[i], t, 0.015); }
        }
      } else { const L = this._ctx.listener; L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz); }
    } catch (err) { /* ignore bad values */ }
  }

  _panner(x, y, z) {
    const p = this._ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = REF_DIST; p.rolloffFactor = ROLLOFF; p.maxDistance = 150;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    return p;
  }

  // ── one-shots ──
  play(name, opts) {
    if (!this._ready || this._paused) return;   // while suspended, drop instead of queueing a burst for resume
    try {
      const R = SFX[name]; if (!R) return this._warn(name);
      const o = opts || NO, ctx = this._ctx, now = ctx.currentTime;
      const vol = (o.volume === undefined ? 1 : o.volume) * R.g;
      if (!(vol > 0.0005)) return;
      const t = now + (o.delay > 0 ? o.delay : 0);
      if (R.gap && Math.abs(t - (this._last[name] || -9)) < R.gap) return;   // per-name rate limit
      const pos = o.x !== undefined; let dist = 0;
      if (pos) {
        dist = Math.hypot(o.x - this._lx, (o.y || 0) - this._ly, (o.z || 0) - this._lz);
        if (dist > MAX_DIST) return;
      }
      // rough audibility, used to decide who loses when the voice budget is exhausted
      const aud = vol * R.prio * (dist > REF_DIST ? REF_DIST / (REF_DIST + ROLLOFF * (dist - REF_DIST)) : 1);
      if (this._voices.length >= MAX_VOICES && !this._steal(aud, now)) return;
      const bufs = this._get(name), buf = bufs[(Math.random() * bufs.length) | 0];
      if (!buf) return;
      this._last[name] = t;
      const rate = clamp((o.pitch === undefined ? 1 : o.pitch) * (R.pv ? 1 + (Math.random() * 2 - 1) * R.pv : 1), 0.1, 8);
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol; src.connect(g);
      const v = { src, g, lp: null, pan: null, tail: g, big: R.big, aud, t0: t, dur: buf.duration / rate, end: t + buf.duration / rate, freed: false };
      if (pos) {
        if (dist > 30) { // air absorption: distant sounds get duller
          v.lp = ctx.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = clamp(18000 * 30 / dist, 1500, 18000);
          v.tail.connect(v.lp); v.tail = v.lp;
        }
        v.pan = this._panner(o.x, o.y || 0, o.z || 0); v.tail.connect(v.pan); v.tail = v.pan;
      }
      v.tail.connect(R.big ? this._sfxDirect : this._sfxGain);
      if (R.rev) v.tail.connect(R.rev === 2 ? this._revHi : this._revLo);
      this._voices.push(v);
      src.onended = () => this._free(v);
      src.start(t);
    } catch (err) { /* never throw from play */ }
  }

  _free(v) {
    if (v.freed) return;
    v.freed = true; v.src.onended = null;
    try { v.src.disconnect(); v.g.disconnect(); if (v.lp) v.lp.disconnect(); if (v.pan) v.pan.disconnect(); } catch (err) { /* ignore */ }
    this._drop(v);
  }

  _drop(v) { const a = this._voices, i = a.indexOf(v); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } }

  _steal(aud, now) { // make room by fading the least audible voice, if the newcomer beats it
    let worst = null, ws = Infinity;
    for (const v of this._voices) { const s = v.aud * clamp((v.end - now) / v.dur, 0.15, 1); if (s < ws) { ws = s; worst = v; } }
    if (!worst || ws >= aud) return false;
    this._drop(worst);
    try { worst.g.gain.setTargetAtTime(0, now, 0.008); worst.src.stop(Math.max(now, worst.t0) + 0.04); } catch (err) { this._free(worst); }
    return true;
  }

  // ── loops ──
  loop(name, active, opts) {
    try {
      const o = opts || NO, id = o.id === undefined || o.id === null ? 0 : o.id, key = id === 0 ? name : name + '#' + id;
      if (!this._ready) { if (active) this._pending.set(key, [name, { ...o }]); else this._pending.delete(key); return; }
      let inst = this._loops.get(key);
      if (!active) { if (inst) { this._loops.delete(key); this._killLoop(inst); } return; }
      const def = LOOPS[name]; if (!def) return this._warn(name);
      const now = this._ctx.currentTime;
      if (!inst) { inst = this._startLoop(def, o, id, now); this._loops.set(key, inst); }
      let vol = o.volume === undefined ? 1 : Math.max(0, o.volume);
      const pitch = o.pitch === undefined ? 1 : o.pitch;
      if (inst.pan && o.x !== undefined) {
        const x = o.x, y = o.y || 0, z = o.z || 0, dx = x - this._lx, dy = y - this._ly, dz = z - this._lz;
        if (Math.abs(x - inst.px) + Math.abs(y - inst.py) + Math.abs(z - inst.pz) > 0.02) {
          inst.px = x; inst.py = y; inst.pz = z;
          const p = inst.pan;
          if (p.positionX) { p.positionX.setTargetAtTime(x, now, 0.03); p.positionY.setTargetAtTime(y, now, 0.03); p.positionZ.setTargetAtTime(z, now, 0.03); }
          else p.setPosition(x, y, z);
        }
        if (dx * dx + dy * dy + dz * dz > MAX_DIST * MAX_DIST) vol = 0;
      }
      if (Math.abs(vol - inst.vol) > 0.004) {
        inst.out.gain.setTargetAtTime(vol * def.g, now, inst.vol < 0 ? def.att || 0.05 : 0.05);
        inst.vol = vol;
      }
      if (Math.abs(pitch - inst.pitch) > 0.004) { inst.pitch = pitch; this._pitchLoop(inst, pitch, now); }
    } catch (err) { /* never throw from loop */ }
  }

  _lfo(hz, depth, param, now) {
    const ctx = this._ctx, osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.frequency.value = hz; amp.gain.value = depth; osc.connect(amp); amp.connect(param); osc.start(now);
    return { osc, amp };
  }

  _startLoop(def, o, id, now) {
    const ctx = this._ctx, h = typeof id === 'number' ? id : 0;
    const inst = { def, out: ctx.createGain(), pan: null, parts: [], vol: -1, pitch: -1, px: 0, py: 0, pz: 0,
      det: h ? 1 + ((((h * 37) % 9) + 9) % 9 - 4) * 0.012 : 1 };   // instances of one loop are slightly detuned
    inst.out.gain.value = 0;
    if (o.x !== undefined) {
      inst.px = o.x; inst.py = o.y || 0; inst.pz = o.z || 0;
      inst.pan = this._panner(inst.px, inst.py, inst.pz); inst.out.connect(inst.pan); inst.pan.connect(this._sfxGain);
    } else inst.out.connect(this._sfxGain);
    for (const p of def.parts) {
      const g = ctx.createGain(), lfos = []; let src, flt = null;
      g.gain.value = p.g;
      if (p.o) { src = ctx.createOscillator(); src.type = p.o; src.frequency.value = p.hz; }
      else { src = ctx.createBufferSource(); src.buffer = p.b ? this._get(p.b)[0] : this._noise[p.n]; src.loop = true; }
      if (p.f) {
        flt = ctx.createBiquadFilter(); flt.type = p.f; flt.frequency.value = p.fhz; flt.Q.value = p.q || 0.7;
        src.connect(flt); flt.connect(g);
      } else src.connect(g);
      g.connect(inst.out);
      if (p.lfo) lfos.push(this._lfo(p.lfo[0], p.lfo[1] * p.g, g.gain, now));
      if (p.flfo && flt) lfos.push(this._lfo(p.flfo[0], p.flfo[1], flt.frequency, now));
      if (p.o) src.start(now); else src.start(now, p.b ? 0 : Math.random() * 1.5);
      inst.parts.push({ p, src, flt, g, lfos });
    }
    return inst;
  }

  _pitchLoop(inst, pitch, now) {
    const pp = clamp(pitch, 0.05, 8) * inst.det;
    for (const pt of inst.parts) {
      const p = pt.p;
      if (p.o) pt.src.frequency.setTargetAtTime(p.hz * pp, now, 0.04);
      else if (p.rt) pt.src.playbackRate.setTargetAtTime(pp, now, 0.04);
      if (pt.flt) pt.flt.frequency.setTargetAtTime(Math.min(p.fhz * pp, 18000), now, 0.04);
    }
  }

  _killLoop(inst) { // fade, stop, then disconnect everything
    const now = this._ctx.currentTime, tc = inst.def.fade || 0.07, end = now + tc * 5;
    const nodes = [inst.out]; if (inst.pan) nodes.push(inst.pan);
    inst.out.gain.setTargetAtTime(0, now, tc);
    for (const pt of inst.parts) {
      nodes.push(pt.src, pt.g); if (pt.flt) nodes.push(pt.flt);
      pt.src.stop(end);
      for (const l of pt.lfos) { l.osc.stop(end); nodes.push(l.osc, l.amp); }
    }
    inst.parts[0].src.onended = () => { for (const nd of nodes) { try { nd.disconnect(); } catch (err) { /* ignore */ } } };
  }

  // ── ducking ──
  duck(amount, seconds) {
    if (!this._ready) return;
    try {
      const now = this._ctx.currentTime, a = clamp(+amount || 0, 0, 1), s = Math.max(0.1, +seconds || 0.6), p = this._duck.gain;
      for (const v of this._voices) { // the sound that triggered the duck stays at full level
        if (!v.big && Math.abs(v.t0 - now) < 0.15) { v.big = true; v.tail.connect(this._sfxDirect); v.tail.disconnect(this._sfxGain); }
      }
      p.cancelScheduledValues(now);
      p.setTargetAtTime(Math.max(0.05, 1 - a), now, 0.02);
      p.setTargetAtTime(1, now + s * 0.5, s * 0.17);
    } catch (err) { /* ignore */ }
  }

  // ── music ──
  music(state) {
    if (state !== 'off' && !MUSIC[state]) return this._warn('music:' + state);
    if (!this._ready) { this._musWant = state; return; }
    if (state === this._musWant) return;
    this._musWant = state;
    try {
      const ctx = this._ctx, now = ctx.currentTime, old = this._mus;
      if (old) { old.bus.gain.setTargetAtTime(0, now, 0.5); this._musOld.push({ m: old, t: now + 3 }); this._mus = null; }   // ≈1.5 s crossfade
      if (state === 'off') return;
      const def = MUSIC[state], bus = ctx.createGain(), l1 = ctx.createGain(), l2 = ctx.createGain();
      bus.gain.value = 0; bus.gain.setTargetAtTime(def.gain, now, def.sting ? 0.03 : 0.5);
      l1.gain.value = 0; l2.gain.value = 0; l1.connect(bus); l2.connect(bus); bus.connect(this._musBus);
      this._mus = { def, bus, l1, l2, step: 0, next: now + 0.1, done: false, deg: 4, ph: 0, rest: 3 };
      this._layers(0.05);
    } catch (err) { /* ignore */ }
  }

  setIntensity(v) {
    v = clamp(+v || 0, 0, 1);
    if (Math.abs(v - this._int) < 0.01) return;
    this._int = v;
    if (this._ready) this._layers(0.4);
  }

  _layers(tc) { // intensity → gains of the extra percussion / ostinato layers
    const m = this._mus; if (!m) return;
    const now = this._ctx.currentTime;
    m.l1.gain.setTargetAtTime(sstep(0.12, 0.45, this._int), now, tc);
    m.l2.gain.setTargetAtTime(sstep(0.5, 0.85, this._int), now, tc);
  }

  _note(bus, name, t, gain = 1, semi = 0) { // one scheduled music hit
    const bufs = this._get(name), buf = bufs[(Math.random() * bufs.length) | 0];
    if (!buf) return;
    const ctx = this._ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = st(semi); g.gain.value = gain;
    src.connect(g); g.connect(bus);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start(t);
  }

  _pad(bus, t, semis, o) { // sustained detuned-saw (or sine) chord with slow envelope and filter sweep
    const ctx = this._ctx, g = ctx.createGain(), end = t + o.dur, sine = o.type === 'sine', oscs = [];
    let head = g;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + o.att);
    g.gain.setValueAtTime(o.gain, end - o.rel); g.gain.linearRampToValueAtTime(0, end);
    g.connect(bus);
    if (!sine) {
      head = ctx.createBiquadFilter(); head.type = 'lowpass'; head.Q.value = 0.5;
      head.frequency.setValueAtTime(o.lp, t); head.frequency.linearRampToValueAtTime(o.lp1 || o.lp, t + o.dur * 0.5);
      head.frequency.linearRampToValueAtTime(o.lp, end);
      head.connect(g);
    }
    for (const s of semis) {
      for (const det of sine ? [0] : [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = sine ? 'sine' : 'sawtooth'; osc.frequency.value = D3 * st(s); osc.detune.value = det;
        osc.connect(head); osc.start(t); osc.stop(end + 0.05); oscs.push(osc);
      }
    }
    oscs[0].onended = () => { for (const x of oscs) x.disconnect(); if (head !== g) head.disconnect(); g.disconnect(); };
  }

  // ── per-frame ──
  update(dt) {
    if (!this._ready) return;
    try {
      const ctx = this._ctx, now = ctx.currentTime;
      if (ctx.state !== 'running') return;
      const m = this._mus;
      if (m && !m.done) { // look-ahead scheduler
        if (m.next < now) m.next = now + 0.05;   // fell behind (hidden tab): resync instead of bursting
        for (let n = 0; m.next < now + LOOKAHEAD && n < 16; n++) {
          m.def.sched(this, m, m.step, m.next);
          m.step++; m.next += m.def.step;
          if (m.def.sting && m.step > m.def.sting) { m.done = true; this._musOld.push({ m, t: now + 1 }); break; }   // sting over → silence
        }
      }
      for (let i = this._musOld.length - 1; i >= 0; i--) { // retire faded-out music buses
        const r = this._musOld[i];
        if (now >= r.t) { r.m.bus.disconnect(); r.m.l1.disconnect(); r.m.l2.disconnect(); if (this._mus === r.m) this._mus = null; this._musOld.splice(i, 1); }
      }
      const d = dt > 0 ? dt : 0.016;
      for (const inst of this._loops.values()) if (inst.def.tick) inst.def.tick(inst, d, now);
      if ((this._sweep += d) > 1) { // safety net: free voices whose 'ended' never fired
        this._sweep = 0;
        for (let i = this._voices.length - 1; i >= 0; i--) if (this._voices[i].end + 0.5 < now) this._free(this._voices[i]);
      }
    } catch (err) { /* keep the frame alive */ }
  }
}

export default AudioEngine;
