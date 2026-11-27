// 音频引擎测试页：手动试听 + 自检（?shot=1）。
// 自检做三件事：① 加载并解码全部素材，和 manifest.json 对时长；② 在真实 AudioContext 上把 update/play 全走一遍；
// ③ 用 OfflineAudioContext 把引擎离线渲染 8 秒（状态突变、暂停），从渲染结果里量电平、亮度和有没有爆音；
// ④ 在浏览器里让每条循环素材跨过循环点，量循环点处有没有咔哒声。
import { createAudio, AUDIO_ASSETS } from '../audio.js';

const $ = id => document.getElementById(id);
const SHOT = new URLSearchParams(location.search).has('shot');
const SFX = ['boost', 'flip', 'whoosh_pass', 'whoosh_pass_1', 'whoosh_pass_2', 'whoosh_pass_3', 'hoop',
  'hoop_combo_1', 'hoop_combo_2', 'hoop_combo_3', 'hoop_combo_4', 'hoop_combo_5', 'hit', 'cloud_dive', 'ui_click'];
const LABEL = { boost: '冲刺', flip: '翻筋斗', whoosh_pass: '掠过石峰（随机）', hoop: '穿环', hit: '撞山', cloud_dive: '钻进云海', ui_click: '界面点击' };

const audio = createAudio();
const state = { speed: 45, boost: 0, nearMiss: 0, inCloud: 0, paused: false };
let demoT = -1;

function showAssets(stats, manifest) {
  const rows = stats.map(s => {
    const m = manifest && manifest[s.file.replace(/\.wav$/, '')];
    return `<tr><td>${s.file}</td><td class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '成功' : '失败：' + (s.error || '')}</td>` +
      `<td>${s.duration.toFixed(3)}</td><td>${s.channels}</td><td>${s.sampleRate}</td><td>${m ? (m.bytes / 1024).toFixed(0) : '-'}</td>` +
      `<td>${m && m.lufs != null ? m.lufs : '-'}</td><td>${m ? m.peak_db : '-'}</td></tr>`;
  }).join('');
  $('assets').innerHTML = `<table><tr><th>文件</th><th>解码</th><th>时长 s</th><th>声道</th><th>采样率</th><th>KB</th><th>LUFS</th><th>峰值 dBFS</th></tr>${rows}</table>`;
}

function bindSlider(id, apply) {
  const el = $(id), out = $(id + '_o');
  const f = () => { out.textContent = el.value; apply(parseFloat(el.value)); };
  el.addEventListener('input', f); f();
}

function setupUI() {
  for (const k of ['speed', 'boost', 'nearMiss', 'inCloud']) bindSlider(k, v => { state[k] = v; });
  bindSlider('master', v => audio.setMaster(v));
  bindSlider('pan', () => {}); bindSlider('rate', () => {});
  $('paused').addEventListener('change', e => { state.paused = e.target.checked; });
  $('music').addEventListener('change', e => audio.setMusic(e.target.checked));
  const box = $('sfx');
  for (const name of SFX) {
    const b = document.createElement('button');
    b.textContent = LABEL[name] ? `${LABEL[name]}（${name}）` : name;
    b.addEventListener('click', () => audio.play(name, { pan: parseFloat($('pan').value), rate: parseFloat($('rate').value) }));
    box.appendChild(b);
  }
  const combo = document.createElement('button');
  combo.textContent = '连续穿环 0→5';
  combo.addEventListener('click', () => ['hoop', 'hoop_combo_1', 'hoop_combo_2', 'hoop_combo_3', 'hoop_combo_4', 'hoop_combo_5']
    .forEach((n, i) => setTimeout(() => audio.play(n), i * 420)));
  box.appendChild(combo);
  $('init').addEventListener('click', async () => {
    $('init').disabled = true; $('status').textContent = ' 加载中…';
    const stats = await audio.init();                    // 在点击回调里调用
    const manifest = await fetch('./assets/audio/manifest.json').then(r => r.json()).catch(() => null);
    showAssets(stats, manifest);
    $('status').textContent = ` 已就绪：${stats.filter(s => s.ok).length}/${stats.length} 条素材`;
    $('controls').hidden = false; $('demo').disabled = false;
  });
  $('demo').addEventListener('click', () => { demoT = 0; });
  let last = performance.now();
  const tick = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (demoT >= 0) runDemo(dt);
    audio.update(dt, state);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// 自动演示：巡航 → 冲刺 → 擦过石峰 → 连续穿环 → 钻云 → 撞山 → 暂停
const DEMO_EVENTS = [[3, 'boost'], [5.2, 'whoosh_pass', { pan: -0.7 }], [6.0, 'whoosh_pass', { pan: 0.7 }], [8, 'hoop'], [8.6, 'hoop_combo_1'], [9.2, 'hoop_combo_2'],
  [9.8, 'hoop_combo_3'], [10.4, 'hoop_combo_4'], [11, 'hoop_combo_5'], [12, 'flip'], [13.5, 'cloud_dive'], [16.5, 'hit']];
let demoFired = 0;
function runDemo(dt) {
  if (demoT === 0) demoFired = 0;
  demoT += dt;
  const t = demoT, pulse = (c, w) => Math.exp(-0.5 * ((t - c) / w) ** 2);
  state.boost = t > 3 && t < 7 ? 1 : 0;
  state.speed = 45 + 75 * Math.min(1, Math.max(0, (t - 3) / 1.2)) * Math.min(1, Math.max(0, (8 - t) / 1.2));
  state.nearMiss = Math.max(pulse(5.2, 0.18), pulse(6.0, 0.18));
  state.inCloud = t > 13.5 && t < 16 ? 1 : 0;
  state.paused = t > 18 && t < 19.5;
  while (demoFired < DEMO_EVENTS.length && DEMO_EVENTS[demoFired][0] <= t) { const e = DEMO_EVENTS[demoFired++]; audio.play(e[1], e[2]); }
  for (const k of ['speed', 'boost', 'nearMiss', 'inCloud']) { $(k).value = state[k]; $(k + '_o').textContent = (+state[k]).toFixed(k === 'speed' ? 0 : 2); }
  $('paused').checked = state.paused;
  if (t > 20) { demoT = -1; state.paused = false; }
}

// ------------------------------------------------------------------ 自检
const dB = v => (v > 0 ? 20 * Math.log10(v) : -200);
function measure(buf, t0, t1) {
  const sr = buf.sampleRate, a = Math.floor(t0 * sr), b = Math.floor(t1 * sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let sq = 0, peak = 0, jump = 0, zc = 0, nan = 0;
  for (let i = a; i < b; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue; }
    sq += l * l + r * r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (i > a) {
      jump = Math.max(jump, Math.abs(l - L[i - 1]), Math.abs(r - R[i - 1]));
      if ((l >= 0) !== (L[i - 1] >= 0)) zc++;
    }
  }
  return { rms: +dB(Math.sqrt(sq / (2 * (b - a)))).toFixed(1), peak: +dB(peak).toFixed(1), jump: +jump.toFixed(4), zcr: Math.round(zc / (t1 - t0)), nan };
}

// 离线渲染：script(t) 返回该时刻的 state，events 是 [时间, 名字, 选项]
async function renderOffline(seconds, script, events = []) {
  const off = new OfflineAudioContext(2, 48000 * seconds, 48000);
  const eng = createAudio({ context: off });
  await eng.init();
  const step = 0.05;
  let fired = 0;
  eng.update(0, script(0));
  for (let k = 1; k * step < seconds; k++) {
    const t = k * step;
    off.suspend(t).then(() => {
      eng.update(step, script(t));
      while (fired < events.length && events[fired][0] <= t + 1e-6) { const e = events[fired++]; eng.play(e[1], e[2]); }
      off.resume();
    });
  }
  return off.startRendering();
}

async function selfTest() {
  const R = { n: 0, ok: 0, bad: [], sr: 0, ch2: 0, mism: 0, dur: '' };
  const log = [];
  try {
    // ① 加载并解码
    const stats = await audio.init();
    const manifest = await fetch('./assets/audio/manifest.json').then(r => r.json()).catch(() => null);
    showAssets(stats, manifest);
    R.n = stats.length; R.ok = stats.filter(s => s.ok).length; R.bad = stats.filter(s => !s.ok).map(s => s.file);
    R.sr = audio.context.sampleRate; R.ch2 = stats.filter(s => s.channels === 2).length;
    R.dur = stats.map(s => +s.duration.toFixed(2)).join(',');
    R.listed = AUDIO_ASSETS.length;
    for (const s of stats) {
      const m = manifest && manifest[s.file.replace(/\.wav$/, '')];
      if (!m || Math.abs(m.duration - s.duration) > 0.002) R.mism++;
    }
    log.push(`① 解码：${R.ok}/${R.n} 成功，双声道 ${R.ch2} 条，AudioContext 采样率 ${R.sr}，与 manifest 时长不符 ${R.mism} 条`);
    // ② 真实 AudioContext 上把接口走一遍
    let played = 0;
    for (let i = 0; i < 40; i++) audio.update(0.016, { speed: 20 + i * 3, boost: (i % 10) / 10, nearMiss: (i % 7) / 7, inCloud: i > 30 ? 1 : 0, paused: i > 36 });
    for (const name of SFX) { if (audio.play(name, { volume: 0.5, pan: Math.random() * 2 - 1, rate: 0.8 + Math.random() * 0.4 })) played++; await new Promise(r => setTimeout(r, 40)); }
    audio.update(0.016, {}); audio.setMusic(false); audio.setMusic(true); audio.setMaster(0.5);
    R.played = played; R.ctx = audio.context.state;
    log.push(`② 实时上下文：状态 ${R.ctx}，${played}/${SFX.length} 个单次音效成功触发，未知名字返回 ${audio.play('no_such_sound')}`);
    audio.dispose();
    // ③ 离线渲染：带事件的完整流程
    const flow = t => ({
      speed: t < 1.5 ? 45 : t < 3.5 ? 120 : 45, boost: t >= 1.5 && t < 3.5 ? 1 : 0,
      nearMiss: t >= 3.8 && t < 4.1 ? 1 : 0, inCloud: t >= 4.5 && t < 6 ? 1 : 0, paused: t >= 7,
    });
    const buf = await renderOffline(8, flow, [[1.5, 'boost'], [2.5, 'hoop'], [2.9, 'hoop_combo_1'], [3.9, 'whoosh_pass', { pan: -0.7 }], [4.5, 'cloud_dive'], [5.2, 'hit'], [6.3, 'flip']]);
    const all = measure(buf, 0, 8);
    const ph = { cruise: measure(buf, 0.6, 1.5), boost: measure(buf, 2.6, 3.5), paused: measure(buf, 7.6, 8) };
    R.flow = { peak: all.peak, nan: all.nan, rms: [ph.cruise.rms, ph.boost.rms, ph.paused.rms] };
    log.push(`③ 离线渲染（含音效，8 s）：峰值 ${all.peak} dBFS，NaN ${all.nan} 个；RMS 巡航 ${ph.cruise.rms} / 冲刺 ${ph.boost.rms} / 暂停后 ${ph.paused.rms} dBFS`);
    // ③ 离线渲染：只有循环层（关音乐不关——音乐也在），状态瞬间突变，和状态不变的对照比"相邻采样最大跳变"
    const jumpy = t => ({ speed: t < 2 ? 45 : t < 4 ? 120 : 45, boost: t >= 2 && t < 4 ? 1 : 0, nearMiss: t >= 3 && t < 3.2 ? 1 : 0, inCloud: t >= 5 && t < 6.5 ? 1 : 0, paused: t >= 7 });
    const dyn = await renderOffline(8, jumpy);
    const steadyFast = await renderOffline(4, () => ({ speed: 120, boost: 1 }));
    const d = { cruise: measure(dyn, 0.8, 2), fast: measure(dyn, 3, 4), cloud: measure(dyn, 5.6, 6.5), back: measure(dyn, 6.6, 7), paused: measure(dyn, 7.5, 8), all: measure(dyn, 0, 8) };
    const sf = measure(steadyFast, 1.5, 4);
    R.dyn = { rms: [d.cruise.rms, d.fast.rms, d.cloud.rms, d.paused.rms], zcr: [d.cruise.zcr, d.fast.zcr, d.cloud.zcr], jump: d.all.jump, jumpSteady: sf.jump, nan: d.all.nan };
    log.push(`③ 离线渲染（只有循环层，状态瞬变）：RMS 巡航 ${d.cruise.rms} / 冲刺 ${d.fast.rms} / 云里 ${d.cloud.rms} / 暂停后 ${d.paused.rms} dBFS`);
    log.push(`   过零率（越高越亮）：巡航 ${d.cruise.zcr} / 冲刺 ${d.fast.zcr} / 云里 ${d.cloud.zcr} 次每秒`);
    log.push(`   相邻采样最大跳变：状态瞬变全程 ${d.all.jump}，对照（一直全速、状态不变）${sf.jump} —— 两者同量级说明参数切换没有爆音`);
    // ④ 浏览器里的循环点：每条循环素材从结尾前 0.5 s 起播（变速 0.93，过循环点时要跨首尾插值），
    //    比较循环点 ±5 ms 内的相邻采样最大跳变和其余部分的最大跳变；比值 ≤ 1 说明循环点没有咔哒声
    const seam = [];
    for (const file of ['wind_low.wav', 'wind_high.wav', 'cloth_loop.wav', 'music_bed.wav']) {
      const off = new OfflineAudioContext(2, 48000 * 3, 48000);
      const b = await off.decodeAudioData(await (await fetch('./assets/audio/' + file)).arrayBuffer());
      const src = off.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = 0.93;
      src.connect(off.destination); src.start(0, b.duration - 0.5);
      const out = await off.startRendering();
      const tw = 0.5 / 0.93, at = measure(out, tw - 0.005, tw + 0.005), rest = Math.max(measure(out, 0.02, tw - 0.01).jump, measure(out, tw + 0.01, 2.98).jump);
      seam.push(+(at.jump / rest).toFixed(2));
    }
    R.seam = seam;
    log.push(`④ 浏览器内循环点（风低/风高/披风/音乐，变速 0.93）：循环点处最大跳变 ÷ 其余部分最大跳变 = ${seam.join(' / ')}`);
  } catch (e) {
    R.error = String(e && e.stack || e).slice(0, 300);
    log.push('自检出错：' + R.error);
  }
  $('selftest_h').hidden = false; $('selftest').hidden = false; $('selftest').textContent = log.join('\n');
  window.__STATS = R;
  window.__READY = true;
}

setupUI();
if (SHOT) { $('init').disabled = true; selfTest(); }
