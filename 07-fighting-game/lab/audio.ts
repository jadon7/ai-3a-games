import { AudioSystem, type LoopHandle } from '../src/audio/audio';

const audio = new AudioSystem();
(window as any).audio = audio;
const $ = (id: string) => document.getElementById(id)!;

const GROUPS: Array<[string, string[]]> = [
  ['打击', ['hit_light', 'hit_heavy', 'hit_slash', 'hit_fire', 'hit_frost']],
  ['防御', ['block', 'block_blade', 'parry', 'guard_break']],
  ['破风', ['whoosh_light', 'whoosh_heavy', 'whoosh_blade']],
  ['移动', ['step', 'jump', 'land', 'dash', 'bodyfall']],
  ['火', ['fire_charge', 'fire_blast', 'fire_fly', 'fire_explode']],
  ['霜', ['frost_charge', 'frost_wave', 'frost_fly', 'frost_shatter', 'frost_spike']],
  ['大招和回合', ['super_freeze', 'super_fire', 'super_frost', 'ko', 'round_gong', 'fight_drum', 'win_sting']],
  ['界面', ['ui_move', 'ui_confirm', 'ui_back']],
];
const LOOPS = new Set(['fire_fly', 'frost_fly']);

let unlocked = false;
const unlock = () => {
  if (unlocked) return;
  unlocked = true;
  audio.unlock();
  $('status').textContent += '（已解锁）';
};
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

const num = (id: string) => parseFloat(($(id) as HTMLInputElement).value);
const opts = () => ({ pan: num('pan'), rate: num('rate') });

function btn(parent: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void, extra = '') {
  const b = document.createElement('button');
  b.innerHTML = label + (extra ? `<span class="n">${extra}</span>` : '');
  b.onclick = () => fn(b);
  parent.appendChild(b);
  return b;
}

async function main() {
  const t0 = performance.now();
  let man: any = { sfx: {} };
  try { man = await (await fetch('/assets/audio/manifest.json', { cache: 'no-cache' })).json(); } catch { /* */ }
  await audio.init();
  $('status').textContent = `载入完成 ${Math.round(performance.now() - t0)}ms，${Object.keys(man.sfx).length} 个音效名，总 ${(man.totalBytes / 1e6).toFixed(2)}MB`;

  const mus = $('music');
  const mbtns: HTMLButtonElement[] = [];
  for (const m of ['menu', 'battle', 'victory'] as const) {
    mbtns.push(btn(mus, m, (b) => { audio.music(m); mbtns.forEach((x) => x.classList.toggle('on', x === b)); }));
  }
  btn(mus, '停止配乐', () => { audio.music(null); mbtns.forEach((x) => x.classList.remove('on')); });
  let amb = false;
  btn(mus, '环境声 开/关', (b) => { amb = !amb; audio.ambience(amb); b.classList.toggle('on', amb); });

  const tests = $('tests');
  btn(tests, 'duck 0.8 / 1s', () => audio.duck(0.8, 1));
  btn(tests, '大招定格演示', () => {
    audio.play('super_freeze'); audio.duck(0.85, 1.4); audio.setTimeScale(0.2);
    setTimeout(() => { audio.setTimeScale(1); setUI(1); audio.play('super_fire'); }, 1000);
    setUI(0.2);
  });
  btn(tests, '连击升调 ×8', () => {
    for (let i = 0; i < 8; i++) audio.play(i % 3 === 2 ? 'hit_heavy' : 'hit_light', { delay: i * 0.12, rate: 1 + i * 0.03 });
  });
  btn(tests, '轻-重-砍 组合', () => {
    audio.play('whoosh_light'); audio.play('hit_light', { delay: 0.08 });
    audio.play('whoosh_heavy', { delay: 0.35 }); audio.play('hit_heavy', { delay: 0.5 });
    audio.play('whoosh_blade', { delay: 0.9 }); audio.play('hit_slash', { delay: 1.0 });
  });
  btn(tests, '开场：锣 + 鼓', () => { audio.play('round_gong'); audio.play('fight_drum', { delay: 1.6 }); });

  const groups = $('groups');
  const loops = new Map<string, LoopHandle>();
  for (const [title, names] of GROUPS) {
    const h = document.createElement('h2');
    h.textContent = title;
    groups.appendChild(h);
    const row = document.createElement('div');
    row.className = 'row';
    groups.appendChild(row);
    for (const n of names) {
      const have = man.sfx[n]?.length ?? 0;
      const b = btn(row, n, () => audio.play(n, opts()), have ? String(have) : '缺');
      if (!have) b.style.opacity = '0.4';
      if (LOOPS.has(n)) {
        btn(row, n + ' 循环', (bb) => {
          const h0 = loops.get(n);
          if (h0) { h0.stop(0.2); loops.delete(n); bb.classList.remove('on'); }
          else { loops.set(n, audio.loop(n, opts())); bb.classList.add('on'); }
        });
      }
    }
  }

  const imgs = $('imgs');
  for (const f of ['sfx_hits', 'sfx_defense', 'sfx_whoosh_move', 'sfx_fire_frost', 'sfx_super_round_ui',
    'music_battle', 'music_other']) {
    const im = document.createElement('img');
    im.src = `/docs/audio/${f}.png`;
    im.loading = 'lazy';
    im.onerror = () => im.remove();
    imgs.appendChild(im);
  }
}

function setUI(v: number) {
  ($('ts') as HTMLInputElement).value = String(v);
  $('tsv').textContent = v.toFixed(2);
}
$('ts').addEventListener('input', () => { const v = num('ts'); $('tsv').textContent = v.toFixed(2); audio.setTimeScale(v); });
$('pan').addEventListener('input', () => { $('panv').textContent = num('pan').toFixed(1); });
$('rate').addEventListener('input', () => { $('ratev').textContent = num('rate').toFixed(2); });
for (const g of ['master', 'sfx', 'music'] as const) {
  $('v_' + g).addEventListener('input', () => audio.setVolume(g, num('v_' + g)));
}

main();
