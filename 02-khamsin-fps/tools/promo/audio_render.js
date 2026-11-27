// KHAMSIN 宣传片：离线渲染音轨（只用 OfflineAudioContext，绝不连扬声器）。
// 在 http://localhost:5190/promo-audio/ （空白页）里：await import('/audio_render.js?' + Date.now()) → window.__PA
//   PA.renderLogs(['g01','g02',...], 'sfx.wav')       把采集时记录的音频事件按帧重放，渲染成音效轨（不含配乐）
//   PA.renderMusic(plan, frames, 'music.wav')         按计划渲染配乐：plan = [[帧, 'music'|'setIntensity', 参数], ...]
// 结果以 16 位 WAV 回传给 receiver（/file）。
const { AudioEngine } = await import('/promo-audio/audio.js?' + Date.now());
const SR = 48000, URL0 = 'http://127.0.0.1:5191';
const PA = window.__PA = { job: null };

async function render(events, frames, { sfx = true, music = false, master = 0.9, musicVol = 0.4, tail = 2 } = {}) {
  const len = Math.ceil((frames / 60 + tail) * SR);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: len, sampleRate: SR });
  globalThis.__PromoAC = function () { return ctx; };
  const e = new AudioEngine();
  if (!(await e.init())) throw new Error('audio init failed');
  e.setMasterVolume(master); e.setMusicVolume(music ? musicVol : 0); e.setSfxVolume(sfx ? 1 : 0);
  const byF = new Map();
  for (const ev of events) { const f = ev[0]; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(ev); }
  const apply = (f) => {
    for (const [, m, a] of byF.get(f) || []) {
      if (m === 'restart') continue;
      if (!sfx && (m === 'play' || m === 'loop' || m === 'duck')) continue;
      if (!music && (m === 'music')) continue;
      try { e[m](...a); } catch (err) { /* ignore */ }
    }
    e.update(1 / 60);
  };
  apply(0);
  for (let f = 1; f < frames + tail * 60 - 1; f++) ctx.suspend(f / 60).then(() => { apply(f); PA.job && (PA.job.f = f); ctx.resume(); });
  return ctx.startRendering();
}

function wav(buf) {
  const n = buf.length, ch = buf.numberOfChannels, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, SR, true); out.setUint32(28, SR * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const C = [...Array(ch)].map((_, c) => buf.getChannelData(c)); let o = 44, peak = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, C[c][i])); peak = Math.max(peak, Math.abs(v)); out.setInt16(o, v * 32767, true); o += 2; }
  return { blob: new Blob([out.buffer], { type: 'audio/wav' }), peak };
}
const post = (name, body) => fetch(URL0 + '/file?name=' + encodeURIComponent(name), { method: 'POST', body });
const getJSON = async (name) => (await fetch('/promo-logs/' + name)).json();

// 采集分段的音频事件拼接：每段的帧号从 0 开始，按每段保存的帧数（rows 数）累加偏移
PA.renderLogs = (shots, outName) => {
  const job = PA.job = { kind: 'sfx', outName, done: false, t0: performance.now() };
  (async () => {
    try {
      // 采集时开局的风声循环发生在记录开始之前，这里补上
      const all = [[0, 'loop', ['wind', true, { volume: 0.5 }]]]; let off = 0; job.offsets = {};
      for (const s of shots) {
        const rows = (await getJSON(s + '.rows.json')).rows, ev = await getJSON(s + '.audio.json');
        job.offsets[s] = [off, rows.length];
        for (const x of ev) all.push([x[0] + off, x[1], x[2]]);
        off += rows.length;
      }
      job.frames = off;
      const buf = await render(all, off, { sfx: true, music: false });
      const { blob, peak } = wav(buf); job.peak = peak;
      await post(outName, blob);
      await post(outName + '.offsets.json', JSON.stringify(job.offsets));
    } catch (err) { job.err = String(err && err.stack || err).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started';
};

PA.renderMusic = (plan, frames, outName, opt = {}) => {
  const job = PA.job = { kind: 'music', outName, done: false, t0: performance.now() };
  (async () => {
    try {
      const buf = await render(plan, frames, { sfx: false, music: true, musicVol: opt.musicVol ?? 1, master: opt.master ?? 0.9, tail: opt.tail ?? 3 });
      const { blob, peak } = wav(buf); job.peak = peak;
      await post(outName, blob);
    } catch (err) { job.err = String(err && err.stack || err).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started';
};
// 渲染 edit.py plan 步骤生成的事件表（music_plan.json / extra_plan.json）
PA.renderPlan = (planFile, outName, opt = {}) => {
  const job = PA.job = { kind: 'plan', planFile, outName, done: false, t0: performance.now() };
  (async () => {
    try {
      const { frames, plan } = await getJSON(planFile + '?' + Date.now());
      const music = !!opt.music;
      const buf = await render(plan, frames, { sfx: !music, music, musicVol: opt.musicVol ?? 1, master: opt.master ?? 0.9, tail: opt.tail ?? 3 });
      const { blob, peak } = wav(buf); job.peak = peak;
      await post(outName, blob);
    } catch (err) { job.err = String(err && err.stack || err).slice(0, 500); }
    job.done = true; job.ms = Math.round(performance.now() - job.t0);
  })();
  return 'started';
};
export default PA;
