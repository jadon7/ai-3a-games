// 界面：比赛 HUD、菜单、暂停、成绩单（DOM 叠加层）
import { fmt } from './game.js';
import { CAR_LIST as CARS } from './carlist.js';

export class Hud {
  constructor(root, T) {
    this.root = root; this.T = T; this.car = 'e30'; this.laps = 3; this.rivals = 5; this.visible = true; this.mode = ''; this.hintT = 14;
    root.innerHTML = `
    <div id="hud" class="layer">
      <div class="tl"><div class="pos"><span id="h-pos">1</span><small><span id="h-total">/6</span></small></div><div class="lap">第 <b id="h-lap">1</b> / <span id="h-laps">3</span> 圈</div></div>
      <div class="tr"><div class="time" id="h-time">0:00.000</div><div class="best">最快 <span id="h-best">--:--.---</span></div><div class="best">上圈 <span id="h-last">--:--.---</span></div></div>
      <div class="drift" id="h-drift"><div class="dl">漂移</div><div class="dp" id="h-dp">0</div><div class="dm" id="h-dm">×1.0</div></div>
      <div class="total">漂移总分 <b id="h-dtotal">0</b></div>
      <div class="msg" id="h-msg"></div>
      <div class="bl"><canvas id="h-map" width="400" height="230"></canvas></div>
      <div class="br"><div class="gear" id="h-gear">1</div><div class="spd"><span id="h-speed">0</span><small>km/h</small></div><div class="rpm"><i id="h-rpm"></i><u></u></div></div>
      <div class="hint" id="h-hint">W/↑ 油门 · S/↓ 刹车 · A D/← → 方向 · 空格 手刹 · C / 1–8 镜头 · V 驾驶位 · [ ] 转向灵敏度 · X 自动驾驶 · N 自动切镜 · R 复位 · Esc 暂停</div>
    </div>
    <div id="menu" class="layer overlay">
      <div class="title"><h1>暮色漂移</h1><p>DUSK DRIFT · 雨后黄昏的 1.5 公里</p></div>
      <div class="cards" id="m-cards"></div>
      <div class="cardinfo" id="m-info"></div>
      <div class="row"><span class="lbl">圈数</span><button class="chip" data-laps="2">2</button><button class="chip" data-laps="3">3</button><button class="chip" data-laps="5">5</button><span class="lbl sp">对手</span><button class="chip wide" data-rivals="5">5 台</button><button class="chip wide" data-rivals="0">无 · 练习</button><button class="go" id="m-go">开始比赛 <kbd>Enter</kbd></button></div>
      <div class="keys">← → 选车 · ↑ ↓ 圈数 · O 切换对手 · 入弯前刹车，按住方向 + 空格甩尾，再踩住油门维持漂移 · 支持手柄</div>
    </div>
    <div id="pause" class="layer overlay"><div class="panel"><h2>暂停</h2><p><kbd>Esc</kbd> 继续　<kbd>Q</kbd> 回到主菜单</p><p class="dim">W/↑ 油门 · S/↓ 刹车/倒车 · A D 方向 · 空格 手刹 · C 镜头 · V 驾驶位 · R 复位 · M 静音 · H 隐藏界面</p><p class="dim">录制：X 自动驾驶（会漂移，比赛不结束）· N 自动切镜 · 1–8 选镜头（1 追尾 2 远追尾 3 车顶 4 驾驶位 5 场边 6 侧跟 7 倒拍 8 高空）· Shift+数字 加入/移出切镜池 · [ ] 转向灵敏度</p></div></div>
    <div id="results" class="layer overlay"><div class="panel"><h2 id="r-title">完赛</h2><div class="rgrid" id="r-grid"></div><p><kbd>Enter</kbd> 再来一局　<kbd>Q</kbd> 回到主菜单</p></div></div>`;
    const $ = id => root.querySelector('#' + id);
    this.el = { hud: $('hud'), menu: $('menu'), pause: $('pause'), results: $('results'), pos: $('h-pos'), total: $('h-total'), lap: $('h-lap'), laps: $('h-laps'), time: $('h-time'), best: $('h-best'), last: $('h-last'), drift: $('h-drift'), dp: $('h-dp'), dm: $('h-dm'), dtotal: $('h-dtotal'), msg: $('h-msg'), map: $('h-map'), gear: $('h-gear'), speed: $('h-speed'), rpm: $('h-rpm'), hint: $('h-hint'), cards: $('m-cards'), info: $('m-info'), go: $('m-go'), rgrid: $('r-grid'), rtitle: $('r-title') };
    this.el.cards.innerHTML = CARS.map(c => `<button class="card" data-car="${c.id}"><img src="assets/cars/preview_${c.id}.jpg" alt="" loading="lazy"><b>${c.name}</b><i>${c.tag}</i></button>`).join('');
    root.querySelectorAll('[data-car]').forEach(b => b.addEventListener('click', () => { this.car = b.dataset.car; this.refreshMenu(); }));
    root.querySelectorAll('[data-laps]').forEach(b => b.addEventListener('click', () => { this.laps = +b.dataset.laps; this.refreshMenu(); }));
    root.querySelectorAll('[data-rivals]').forEach(b => b.addEventListener('click', () => { this.rivals = +b.dataset.rivals; this.refreshMenu(); }));
    $('m-go').addEventListener('click', () => this.onStart && this.onStart());
    this.refreshMenu(); this.prepMap(); this.cache = {};
  }
  refreshMenu() {
    this.root.querySelectorAll('[data-car]').forEach(b => {
      const on = b.dataset.car === this.car; b.classList.toggle('on', on);
      if (on && this.el && this.el.menu.classList.contains('show')) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    if (this.el) { const c = CARS.find(c => c.id === this.car); this.el.info.innerHTML = c ? `<b>${c.name}</b><span>${c.desc}</span>` : ''; }
    this.root.querySelectorAll('[data-laps]').forEach(b => b.classList.toggle('on', +b.dataset.laps === this.laps));
    this.root.querySelectorAll('[data-rivals]').forEach(b => b.classList.toggle('on', +b.dataset.rivals === this.rivals));
  }
  pickCar(dir) { const i = CARS.findIndex(c => c.id === this.car); this.car = CARS[(i + dir + CARS.length) % CARS.length].id; this.refreshMenu(); }
  pickLaps(dir) { const opts = [2, 3, 5], i = opts.indexOf(this.laps); this.laps = opts[Math.max(0, Math.min(opts.length - 1, i + dir))]; this.refreshMenu(); }
  setLoading(on) { this.el.go.classList.toggle('wait', on); this.el.go.innerHTML = on ? '加载车辆…' : '开始比赛 <kbd>Enter</kbd>'; }
  toggleRivals() { this.rivals = this.rivals ? 0 : 5; this.refreshMenu(); }
  toggle() { this.visible = !this.visible; this.el.hud.style.opacity = this.visible ? 1 : 0; }
  setMode(m) {
    this.mode = m; const e = this.el;
    e.menu.classList.toggle('show', m === 'menu'); e.pause.classList.toggle('show', m === 'pause'); e.results.classList.toggle('show', m === 'finish');
    e.hud.classList.toggle('show', m === 'race' || m === 'countdown' || m === 'pause');
    if (m === 'countdown') this.hintT = 14;
  }
  showResults(r) {
    this.el.rtitle.textContent = r.total === 1 ? '练习结束' : r.pos === 1 ? '夺冠！' : `第 ${r.pos} 名完赛`;
    this.el.rgrid.innerHTML = `<div><small>名次</small><b>${r.pos} / ${r.total}</b></div><div><small>总用时</small><b>${fmt(r.time)}</b></div><div><small>最快圈</small><b>${fmt(r.best)}</b></div><div><small>漂移总分</small><b>${r.drift.toLocaleString()}</b></div>`;
  }
  prepMap() {
    const T = this.T, b = T.bounds, cv = this.el.map, pad = 16;
    const sc = Math.min((cv.width - pad * 2) / (b.maxx - b.minx), (cv.height - pad * 2) / (b.maxy - b.miny));
    this.mapXY = (x, y) => [pad + (x - b.minx) * sc + ((cv.width - pad * 2) - (b.maxx - b.minx) * sc) / 2, cv.height - pad - (y - b.miny) * sc - ((cv.height - pad * 2) - (b.maxy - b.miny) * sc) / 2];
    const path = new Path2D(); for (let i = 0; i <= T.N; i += 3) { const [x, y] = this.mapXY(T.px[i % T.N], T.py[i % T.N]); i ? path.lineTo(x, y) : path.moveTo(x, y); } path.closePath(); this.mapPath = path;
    const s0 = this.mapXY(T.px[0], T.py[0]); this.mapStart = s0;
  }
  set(key, el, val) { if (this.cache[key] !== val) { this.cache[key] = val; el.textContent = val; } }
  update(s, dt) {
    if (this.mode !== 'race' && this.mode !== 'countdown') return;
    const e = this.el;
    this.set('pos', e.pos, s.total > 1 ? s.pos : '练习'); this.set('total', e.total, s.total > 1 ? '/' + s.total : ''); this.set('lap', e.lap, s.lap); this.set('laps', e.laps, s.laps);
    this.set('time', e.time, s.state === 'race' ? fmt(Math.max(0.001, s.time)) : '0:00.000'); this.set('best', e.best, fmt(s.best)); this.set('last', e.last, fmt(s.last));
    this.set('speed', e.speed, Math.round(s.speed)); this.set('gear', e.gear, s.gear);
    const rf = Math.min(1, s.rpm / s.redline); e.rpm.style.transform = `scaleX(${rf.toFixed(3)})`; e.rpm.classList.toggle('red', rf > 0.93);
    const D = s.drift;
    const show = D.active && D.points > 15, lost = D.lostT < 1.4, bank = D.bankT < 1.6 && !show;
    e.drift.classList.toggle('show', show || lost || bank); e.drift.classList.toggle('lost', lost && !show); e.drift.classList.toggle('bank', bank && !lost);
    if (show) { this.set('dp', e.dp, Math.round(D.points).toLocaleString()); this.set('dm', e.dm, '×' + D.mult.toFixed(1)); }
    else if (lost) { this.set('dp', e.dp, '漂移中断'); this.set('dm', e.dm, ''); }
    else if (bank) { this.set('dp', e.dp, '+' + D.banked.toLocaleString()); this.set('dm', e.dm, ''); }
    this.set('dtotal', e.dtotal, D.total.toLocaleString());
    const msg = s.state === 'countdown' ? '' : s.msg; if (this.cache.msg !== msg) { this.cache.msg = msg; e.msg.textContent = msg; e.msg.classList.toggle('show', !!msg); }
    if (s.state === 'race') { this.hintT -= dt; } e.hint.classList.toggle('show', this.hintT > 0);
    // 小地图
    const g = e.map.getContext('2d'); g.clearRect(0, 0, e.map.width, e.map.height);
    g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 11; g.stroke(this.mapPath); g.strokeStyle = 'rgba(255,255,255,0.86)'; g.lineWidth = 5; g.stroke(this.mapPath);
    g.fillStyle = '#fff'; g.fillRect(this.mapStart[0] - 2, this.mapStart[1] - 8, 4, 16);
    for (const en of s.entries) { if (en.player) continue; const [x, y] = this.mapXY(en.car.x, en.car.y); g.fillStyle = '#1c1c1e'; g.beginPath(); g.arc(x, y, 6.5, 0, 6.3); g.fill(); g.fillStyle = '#e9e4d8'; g.beginPath(); g.arc(x, y, 4.2, 0, 6.3); g.fill(); }
    { const [x, y] = this.mapXY(s.player.car.x, s.player.car.y); g.fillStyle = '#1c1c1e'; g.beginPath(); g.arc(x, y, 9, 0, 6.3); g.fill(); g.fillStyle = '#ff8a2a'; g.beginPath(); g.arc(x, y, 6.2, 0, 6.3); g.fill(); }
  }
}
