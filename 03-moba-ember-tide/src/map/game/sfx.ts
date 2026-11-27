// 音效（阶段 8）。全部用 WebAudio 现场合成：一段噪声过滤波器当“呼”和“啪”，几个振荡器当“咚”和“叮”，没有任何音频文件。
// 原则和画面一样：克制。小兵互殴的声音很轻，英雄的技能和击杀才是主角；同一种声音短时间内不重复堆叠；离镜头远的听不见。
//   · 对局里的事件（打中、开火、放技能、阵亡、击杀、拆塔、升级、得金币、Boss 的重击和咆哮）在 view.ts 里转给 on()
//   · 界面的按钮点一下有一声轻响；买装备是硬币声；胜负各有一段
//   · 浏览器要等用户动过一次手才让出声，所以第一次点击或者按键时才真正开始；菜单里可以关（记在 localStorage 里）
// 这些是合成出来的占位级音效，不是录音棚的素材：能分清“谁打了谁、放了什么”，谈不上好听。

import type { SimEvent, Ent } from "./sim";

export interface Sfx { on: (ev: SimEvent, me: Ent) => void; cast: (side: number, key: string, x: number, z: number, big: boolean) => void; listen: (x: number, z: number) => void; ui: (kind: "click" | "buy" | "deny" | "open") => void; end: (win: boolean) => void; muted: () => boolean; setMuted: (m: boolean) => void; }

let ctx: AudioContext | null = null, out: GainNode | null = null, noiseBuf: AudioBuffer | null = null, mute = false, amb: GainNode | null = null;
try { mute = localStorage.getItem("moba_mute") === "1"; } catch { /* 不让用就算了 */ }
const last = new Map<string, number>(); let lx = 0, lz = 0;

function boot(): boolean {
  if (ctx) return ctx.state === "running";
  const AC = window.AudioContext ?? (window as any).webkitAudioContext; if (!AC) return false;
  ctx = new AC(); const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18;
  out = ctx.createGain(); out.gain.value = mute ? 0 : 0.55; out.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // 环境声：很低的一层风（低通的噪声，音量慢慢起伏）
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.4;
  amb = ctx.createGain(); amb.gain.value = 0.03; const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.014; lfo.connect(lg); lg.connect(amb.gain); lfo.start();
  src.connect(lp); lp.connect(amb); amb.connect(out); src.start();
  return ctx.state === "running";
}
const wake = () => { boot(); ctx?.resume().catch(() => { /* 还不让出声 */ }); };
for (const t of ["pointerdown", "keydown", "touchend"]) addEventListener(t, wake, { capture: true, passive: true });
document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => { /* 同上 */ }); else ctx.resume().catch(() => { /* 同上 */ }); });

/** 离镜头看的地方多远、偏左还是偏右，决定音量和左右声道。返回 null：太远，不出声 */
function place(x?: number, z?: number): { vol: number; pan: number } | null {
  if (x === undefined || z === undefined) return { vol: 1, pan: 0 };
  const dx = x - lx, dz = z - lz, d = Math.hypot(dx, dz); if (d > 30) return null;
  return { vol: Math.pow(1 - d / 30, 1.4), pan: Math.max(-0.7, Math.min(0.7, dx / 22)) };
}
/** 同一种声音隔多久才能再出一次（秒）。返回 false：太密了，这一下不出声 */
const gate = (name: string, gap: number) => { const t = ctx!.currentTime; if (t - (last.get(name) ?? -9) < gap) return false; last.set(name, t); return true; };
function bus(vol: number, pan: number): AudioNode { const g = ctx!.createGain(); g.gain.value = vol; if (pan && typeof (ctx as any).createStereoPanner === "function") { const p = ctx!.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(out!); } else g.connect(out!); return g; }
/** 一段噪声过带通（或者低通、高通），滤波器的中心频率从 f0 滑到 f1 */
function noise(to: AudioNode, dur: number, f0: number, f1: number, vol: number, o: { q?: number; type?: BiquadFilterType; at?: number; delay?: number } = {}) {
  const t = ctx!.currentTime + (o.delay ?? 0), s = ctx!.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ctx!.createBiquadFilter(); f.type = o.type ?? "bandpass"; f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx!.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.at ?? 0.006)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(to); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
/** 一个振荡器，频率从 f0 滑到 f1 */
function tone(to: AudioNode, type: OscillatorType, dur: number, f0: number, f1: number, vol: number, o: { at?: number; delay?: number } = {}) {
  const t = ctx!.currentTime + (o.delay ?? 0), s = ctx!.createOscillator(); s.type = type; s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx!.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.at ?? 0.005)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(g); g.connect(to); s.start(t); s.stop(t + dur + 0.02);
}
const ready = () => !!ctx && ctx.state === "running" && !mute;

export const sfx: Sfx = {
  muted: () => mute,
  setMuted(m) { mute = m; try { localStorage.setItem("moba_mute", m ? "1" : "0"); } catch { /* 同上 */ } if (out && ctx) out.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05); },
  listen(x, z) { lx = x; lz = z; },
  ui(kind) {
    if (!ready() || !gate("ui" + kind, 0.04)) return; const b = bus(kind === "buy" ? 0.5 : 0.32, 0);
    if (kind === "click") { tone(b, "triangle", 0.05, 1500, 1100, 0.5); noise(b, 0.03, 3200, 2400, 0.25, { q: 2 }); }
    else if (kind === "open") { noise(b, 0.14, 700, 1900, 0.4, { q: 1.2 }); }
    else if (kind === "buy") { tone(b, "sine", 0.22, 1568, 1568, 0.5); tone(b, "sine", 0.3, 2093, 2093, 0.45, { delay: 0.07 }); noise(b, 0.05, 5200, 4200, 0.2, { q: 3 }); }
    else { tone(b, "square", 0.12, 200, 150, 0.22); }
  },
  cast(side, key, x, z, big) {
    if (!ready()) return; const p = place(x, z); if (!p || !gate("cast" + side + key, 0.08)) return; const b = bus(p.vol * (big ? 0.95 : 0.6), p.pan), ult = key === "R";
    if (side === 0) { noise(b, ult ? 0.7 : 0.3, 420, ult ? 2600 : 1900, 0.7, { q: 0.8, at: 0.03 }); tone(b, "sine", ult ? 0.6 : 0.26, 380, ult ? 760 : 620, 0.22, { at: 0.02 }); }      // 沉月会：水声，往上扬
    else { noise(b, ult ? 0.7 : 0.32, 1800, 420, 0.7, { q: 0.9, at: 0.01 }); tone(b, "sawtooth", ult ? 0.55 : 0.24, 190, 85, 0.16); }      // 烬誓庭：火声，往下沉
    if (ult) tone(b, "sine", 0.8, 90, 34, 0.7, { at: 0.01 });
  },
  on(ev, me) {
    if (!ready()) return;
    if (ev.t === "hit") { const e = ev.e, hero = e.kind === "hero" || ev.src?.kind === "hero", mine = e === me || ev.src === me; if (ev.dmg < 1) return; const p = place(e.x, e.z); if (!p) return;
      const build = e.kind === "tower" || e.kind === "core", name = build ? "hitB" : ev.big || ev.skill ? "hitL" : hero ? "hitH" : "hitM"; if (!gate(name, name === "hitM" ? 0.11 : 0.05)) return;
      const b = bus(p.vol * (mine ? 0.9 : hero ? 0.6 : 0.2), p.pan);
      if (build) { tone(b, "square", 0.07, 300, 210, 0.3); noise(b, 0.06, 2400, 1400, 0.4, { q: 1.5 }); tone(b, "sine", 0.12, 120, 60, 0.5); }
      else if (ev.big || ev.skill) { noise(b, 0.2, 700, 180, 0.9, { q: 0.7 }); tone(b, "sine", 0.24, 120, 42, 0.8); }
      else { noise(b, 0.07, 1100, 500, 0.6, { q: 1 }); tone(b, "sine", 0.09, 150, 70, 0.55); } }
    else if (ev.t === "shot") { const s = ev.s, p = place(s.x, s.z); if (!p) return; const tw = s.kind === "tower"; if (!gate(tw ? "shotT" : "shotR", tw ? 0.05 : 0.1)) return; const b = bus(p.vol * (tw ? 0.5 : s.from === me ? 0.5 : 0.16), p.pan);
      if (tw) { tone(b, "sawtooth", 0.18, 760, 230, 0.3); noise(b, 0.12, 2800, 900, 0.3, { q: 1.2 }); } else noise(b, 0.09, 2600, 1100, 0.5, { q: 1.4 }); }
    else if (ev.t === "kill") { const p = place(ev.e.x, ev.e.z) ?? { vol: 0.35, pan: 0 }, b = bus(Math.max(0.35, p.vol) * 0.8, p.pan), good = ev.e.team !== me.team;      // 英雄被击杀：全图都听得到一点
      tone(b, "triangle", 0.5, 420, 100, 0.4); noise(b, 0.4, 900, 160, 0.5, { q: 0.6 });
      const c = bus(0.4, 0); if (good) { tone(c, "triangle", 0.3, 659, 659, 0.5, { delay: 0.12 }); tone(c, "triangle", 0.5, 988, 988, 0.5, { delay: 0.26 }); } else { tone(c, "triangle", 0.34, 330, 330, 0.5, { delay: 0.12 }); tone(c, "triangle", 0.6, 247, 233, 0.5, { delay: 0.28 }); } }
    else if (ev.t === "die") { const e = ev.e, p = place(e.x, e.z);
      if (e.kind === "tower" || e.kind === "core") { const b = bus(Math.max(0.3, p?.vol ?? 0) * 0.9, p?.pan ?? 0); noise(b, 1.1, 380, 60, 1, { type: "lowpass", q: 0.5 }); tone(b, "sine", 1.0, 70, 28, 0.9); noise(b, 0.25, 2600, 700, 0.5, { q: 0.8 }); }
      else if (p && e.kind !== "hero" && gate("dieM", 0.12)) { const b = bus(p.vol * 0.22, p.pan); tone(b, "sine", 0.12, 110, 50, 0.6); noise(b, 0.1, 500, 200, 0.4); } }
    else if (ev.t === "level" && (!ev.e || ev.e === me)) { const b = bus(0.34, 0); [523, 659, 784, 1047].forEach((f, i) => tone(b, "triangle", 0.2, f, f, 0.5, { delay: i * 0.07 })); }
    else if (ev.t === "gold" && ev.e === me && ev.n >= 20 && gate("gold", 0.08)) { const b = bus(0.22, 0); tone(b, "sine", 0.1, 1760, 1760, 0.5); tone(b, "sine", 0.14, 2349, 2349, 0.4, { delay: 0.04 }); }
    else if (ev.t === "warn") { const p = place(ev.x, ev.z); if (p && gate("warn", 0.2)) tone(bus(p.vol * 0.5, p.pan), "sine", Math.min(1.2, ev.sec), 70, 190, 0.5, { at: ev.sec * 0.7 }); }
    else if (ev.t === "slam") { const p = place(ev.x, ev.z); if (p) { const b = bus(p.vol, p.pan); noise(b, 0.5, 500, 70, 1, { type: "lowpass", q: 0.6 }); tone(b, "sine", 0.5, 95, 30, 1); } }
    else if (ev.t === "roar") { const p = place(ev.e.x, ev.e.z); if (p) { const b = bus(p.vol * 0.8, p.pan); tone(b, "sawtooth", 1.0, 95, 62, 0.4, { at: 0.08 }); noise(b, 1.0, 300, 900, 0.5, { q: 0.7, at: 0.1 }); } }
    else if (ev.t === "boss") { const b = bus(0.4, 0); [196, 247, 294, 392].forEach((f, i) => tone(b, "triangle", 0.5, f, f, 0.5, { delay: i * 0.1 })); }
    else if (ev.t === "buff" && ev.e === me) { const b = bus(0.3, 0); tone(b, "sine", 0.45, 880, 1320, 0.4, { at: 0.05 }); }
    else if (ev.t === "respawn" && (!ev.e || ev.e === me)) { const b = bus(0.3, 0); noise(b, 0.5, 400, 2200, 0.4, { q: 1, at: 0.1 }); tone(b, "sine", 0.4, 440, 880, 0.3, { at: 0.05 }); }
  },
  end(win) {
    wake(); if (!ready()) return; const b = bus(0.5, 0);
    (win ? [392, 494, 587, 784] : [392, 370, 311, 233]).forEach((f, i) => tone(b, "triangle", i === 3 ? 1.4 : 0.42, f, f, 0.5, { delay: i * 0.22, at: 0.02 }));
    if (win) [196, 294].forEach(f => tone(b, "sine", 2.0, f, f, 0.3, { delay: 0.66, at: 0.05 })); else tone(b, "sine", 2.0, 117, 110, 0.4, { delay: 0.66, at: 0.05 });
  },
};

// 界面上的按钮：点一下都有一声轻响（主菜单、选人、对局里的菜单和商店都算）
addEventListener("click", e => { const el = (e.target as HTMLElement | null)?.closest?.("button"); if (el && !el.classList.contains("sk") && !el.classList.contains("tc-atk") && !el.classList.contains("buy")) sfx.ui("click"); }, true);
(window as any).__sfx = { ctx: () => ctx, out: () => out, wake };      // 测试脚本用：接一个录音的口子出来

/** 伊缇 · 绯刃的音效（iti-fx3 第二步新加，只有她用；别的英雄的声音一个没动）。由 fx_iti_core.ts 在特效的时机点上调：kind 是哪一下，(x,z) 在哪，vol 再乘几，n 是大招的第几刀（越往后音越高）。
 *  和别的音效一样是现场合成的占位级声音：一段滤过的噪声当“唰”，几个振荡器当“咚”和“叮”。离镜头 30 米外听不见；同一种声音太密不叠 */
export function itiSfx(kind: string, x: number, z: number, vol = 1, n = 0) {      // 调度量过响度（接分析器）：砸地、引爆、收尾原来比老英雄的大招响 5 dB 左右，收到大招比别人略响、小技能和别人的大招差不多
  if (!ready()) return; const p = place(x, z); if (!p) return; const v = p.vol * vol, B = (k: number) => bus(v * k, p.pan);
  if (kind === "hit") { if (!gate("iti_hit", 0.035)) return; const b = B(0.5); noise(b, 0.05, 3400, 1500, 0.5, { type: "highpass", q: 0.7 }); tone(b, "triangle", 0.08, 520, 170, 0.4); }
  else if (kind === "swing") { if (!gate("iti_swing", 0.08)) return; noise(B(0.4), 0.1, 1900, 700, 0.5, { q: 1.2 }); }
  else if (kind === "dash") { const b = B(0.55); noise(b, 0.17, 600, 2600, 0.6, { q: 1.1, at: 0.02 }); tone(b, "sine", 0.13, 900, 1600, 0.1); noise(b, 0.08, 4200, 2000, 0.3, { type: "highpass", delay: 0.09 }); }
  else if (kind === "leap") { noise(B(0.45), 0.32, 380, 1900, 0.6, { q: 0.9, at: 0.05 }); }
  else if (kind === "slam") { const b = B(0.5); tone(b, "sine", 0.4, 120, 36, 1); noise(b, 0.32, 900, 110, 0.7, { type: "lowpass", q: 0.6 }); noise(b, 0.06, 2600, 1800, 0.35, { type: "highpass" }); }
  else if (kind === "blink") { if (!gate("iti_blink", 0.05)) return; const b = B(0.4); noise(b, 0.08, 2600, 5400, 0.5, { q: 1.4 }); tone(b, "sine", 0.07, 1400, 2500, 0.2); }
  else if (kind === "stab") { const b = B(0.7); noise(b, 0.07, 4200, 2000, 0.5, { type: "highpass" }); tone(b, "triangle", 0.13, 880, 210, 0.45); tone(b, "sine", 0.12, 2200, 2100, 0.12); }
  else if (kind === "pop") { const b = B(0.6); tone(b, "sine", 0.24, 300, 88, 0.8); noise(b, 0.2, 1400, 480, 0.5, { q: 0.8 }); tone(b, "sine", 0.28, 1760, 2640, 0.12, { delay: 0.03 }); }
  else if (kind === "burst") { const b = B(0.7); tone(b, "sine", 0.32, 200, 48, 1); noise(b, 0.3, 1500, 190, 0.6, { type: "lowpass", q: 0.6 }); noise(b, 0.07, 3000, 1500, 0.3, { type: "highpass" }); }
  else if (kind === "ult") { const b = B(0.8); noise(b, 0.3, 280, 3200, 0.5, { q: 0.9, at: 0.22 }); tone(b, "sine", 0.32, 58, 130, 0.7, { at: 0.2 }); tone(b, "sine", 0.3, 2400, 3300, 0.1, { delay: 0.1 }); }
  else if (kind === "cut") { if (!gate("iti_cut", 0.03)) return; const b = B(0.6); noise(b, 0.07, 2000 + n * 260, 900, 0.55, { q: 1.3 }); tone(b, "triangle", 0.06, 700 + n * 75, 340 + n * 30, 0.25); }
  else if (kind === "gather") { const b = B(0.6); tone(b, "sine", 0.34, 170, 760, 0.3, { at: 0.26 }); noise(b, 0.34, 500, 4200, 0.25, { q: 1.2, at: 0.28 }); }
  else if (kind === "ting") { const b = B(0.5); tone(b, "sine", 0.5, 2637, 2637, 0.4); tone(b, "sine", 0.34, 3951, 3951, 0.16); }
  else if (kind === "finale") { const b = B(0.75); tone(b, "sine", 0.75, 92, 27, 1); noise(b, 0.6, 2600, 90, 0.75, { type: "lowpass", q: 0.5 }); noise(b, 0.13, 3200, 1500, 0.4, { type: "highpass", delay: 0.07 }); tone(b, "sine", 0.5, 1320, 640, 0.12, { delay: 0.07 }); }
  else if (kind === "refresh") { const b = B(0.4); tone(b, "sine", 0.13, 1320, 1320, 0.4); tone(b, "sine", 0.22, 1760, 1760, 0.4, { delay: 0.07 }); }
}
