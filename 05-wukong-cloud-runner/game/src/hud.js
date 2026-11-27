// 界面：标题页、飞行仪表（速度/高度/金环/连击/里程）、下一个金环的指示、提示条、暂停菜单。全部是 DOM 叠层。
const CSS = `
#ui, #ui * { box-sizing: border-box; }
#ui { position: fixed; inset: 0; pointer-events: none; color: rgba(255, 244, 222, 0.92); font-family: "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  text-shadow: 0 1px 6px rgba(0,0,0,0.55); user-select: none; -webkit-user-select: none; letter-spacing: 0.08em; }
#ui .corner { position: absolute; font-size: 15px; line-height: 1.7; transition: opacity 0.5s; }
#ui .tl { left: 34px; top: 28px; } #ui .tr { right: 34px; top: 28px; text-align: right; }
#ui .bl { left: 34px; bottom: 26px; } #ui .br { right: 34px; bottom: 26px; text-align: right; }
#ui .num { font-size: 34px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; font-family: "Baskerville", "Songti SC", serif; }
#ui .unit { font-size: 13px; opacity: 0.72; margin-left: 4px; }
#ui .label { font-size: 12px; opacity: 0.62; letter-spacing: 0.35em; display: block; margin-bottom: -4px; }
#ui .bar { width: 150px; height: 2px; background: rgba(255,244,222,0.22); margin-top: 8px; position: relative; }
#ui .bar i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, #f6d38a, #fff4d8); width: 0%; box-shadow: 0 0 8px rgba(255,210,120,0.8); }
#ui .toast { position: absolute; left: 50%; top: 22%; transform: translate(-50%, 0); font-size: 30px; letter-spacing: 0.4em; opacity: 0; transition: opacity 0.25s, transform 0.6s; white-space: nowrap; color: #ffe2a0; }
#ui .toast.show { opacity: 1; transform: translate(-50%, -8px); }
#ui .hint { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); font-size: 13px; opacity: 0.0; transition: opacity 1.2s; white-space: nowrap; letter-spacing: 0.18em; }
#ui .hint.show { opacity: 0.78; }
#ui .hint b { font-weight: normal; border: 1px solid rgba(255,244,222,0.45); border-radius: 3px; padding: 1px 6px; margin: 0 4px 0 12px; font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 11px; letter-spacing: 0.05em; }
#ui .marker { position: absolute; width: 0; height: 0; opacity: 0; transition: opacity 0.3s; }
#ui .marker .ring { position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; border: 1.5px solid rgba(255,214,130,0.95); border-radius: 50%; box-shadow: 0 0 10px rgba(255,200,100,0.7); }
#ui .marker .arrow { position: absolute; left: -7px; top: -22px; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 12px solid rgba(255,214,130,0.95); display: none; }
#ui .marker.off .ring { display: none; } #ui .marker.off .arrow { display: block; }
#ui .marker .dist { position: absolute; left: 16px; top: -9px; font-size: 12px; white-space: nowrap; opacity: 0.85; font-family: -apple-system, sans-serif; letter-spacing: 0.02em; }
#ui .mode { font-size: 13px; opacity: 0.75; }
#ui .lens { position: absolute; right: 34px; top: 50%; transform: translateY(-50%); width: 46px; display: flex; flex-direction: column; align-items: center; gap: 8px; transition: opacity 0.5s; opacity: 0.55; font-family: -apple-system, "Helvetica Neue", sans-serif; letter-spacing: 0.02em; }
#ui .lens.active { opacity: 1; }
#ui .lens .lv { font-size: 15px; font-variant-numeric: tabular-nums; }
#ui .lens .lu { font-size: 10px; opacity: 0.7; margin-top: -8px; }
#ui .lens .track { position: relative; width: 2px; height: 200px; background: rgba(255,244,222,0.25); }
#ui .lens .track i { position: absolute; left: -6px; width: 14px; height: 2px; background: #ffe2a0; box-shadow: 0 0 8px rgba(255,200,100,0.8); }
#ui .lens .track b { position: absolute; left: -3px; width: 8px; height: 1px; background: rgba(255,244,222,0.45); }
#ui .lens .lk { font-size: 10px; opacity: 0.75; text-align: center; line-height: 1.5; white-space: nowrap; }
#ui .lens .lk span { border: 1px solid rgba(255,244,222,0.45); border-radius: 3px; padding: 0 4px; }
#ui.hide-hud .lens { opacity: 0 !important; }
#ui .lensrow { display: flex; align-items: center; gap: 14px; margin-top: 18px; font-size: 14px; letter-spacing: 0.2em; pointer-events: auto; }
#ui .lensrow input { width: 260px; accent-color: #f6d38a; }
#ui.hide-hud .corner, #ui.hide-hud .marker, #ui.hide-hud .hint, #ui.hide-hud .toast { opacity: 0 !important; }
#ui .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto; transition: opacity 0.9s; background: radial-gradient(ellipse at center, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.45) 100%); }
#ui .screen.gone { opacity: 0; pointer-events: none; }
#ui h1 { font-family: "Kaiti SC", "STKaiti", "KaiTi", "Songti SC", serif; font-weight: normal; font-size: min(11vw, 132px); margin: 0; letter-spacing: 0.16em; padding-left: 0.16em; color: #fff3da; text-shadow: 0 2px 30px rgba(0,0,0,0.55), 0 0 60px rgba(255,200,110,0.25); }
#ui h2 { font-weight: normal; font-size: min(2.6vw, 24px); letter-spacing: 0.9em; padding-left: 0.9em; margin: 6px 0 46px; opacity: 0.86; }
#ui .btn { pointer-events: auto; cursor: pointer; font: inherit; color: inherit; background: rgba(20,14,6,0.28); border: 1px solid rgba(255,236,196,0.55); padding: 13px 46px 13px 54px; font-size: 19px; letter-spacing: 0.5em;
  border-radius: 2px; transition: background 0.2s, border-color 0.2s; backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); margin: 6px; }
#ui .btn:hover { background: rgba(255,214,130,0.22); border-color: #ffe2a0; }
#ui .btn.small { font-size: 14px; padding: 8px 20px 8px 26px; letter-spacing: 0.3em; }
#ui .keys { margin-top: 40px; font-size: 13px; opacity: 0.8; line-height: 2.1; text-align: center; letter-spacing: 0.16em; }
#ui .keys b { font-weight: normal; border: 1px solid rgba(255,244,222,0.45); border-radius: 3px; padding: 1px 7px; margin: 0 5px 0 14px; font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 11px; letter-spacing: 0.05em; }
#ui .loading { margin-top: 26px; font-size: 13px; opacity: 0.7; letter-spacing: 0.3em; min-height: 1.5em; }
#ui .row { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; }
#ui .pause-title { font-size: 40px; letter-spacing: 0.8em; padding-left: 0.8em; margin-bottom: 26px; font-family: "Kaiti SC", "STKaiti", serif; }
#ui.notrans, #ui.notrans * { transition: none !important; }
#ui .screen.pause { background: rgba(8,6,3,0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
`;

export function createHUD() {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const ui = document.createElement('div'); ui.id = 'ui'; ui.className = 'hide-hud' + (new URLSearchParams(location.search).has('shot') ? ' notrans' : '');
  ui.innerHTML = `
    <div class="corner tl"><span class="label">速度</span><span class="num" id="h-spd">0</span><span class="unit">公里/时</span><div class="bar"><i id="h-boost"></i></div></div>
    <div class="corner tr"><span class="label">金环</span><span class="num" id="h-hoops">0</span><span class="unit" id="h-combo"></span></div>
    <div class="corner bl"><span class="label">高度</span><span class="num" id="h-alt">0</span><span class="unit">米</span></div>
    <div class="corner br"><span class="mode" id="h-mode"></span><br><span class="label" style="margin-top:6px">已行</span><span class="num" id="h-li" style="font-size:24px">0</span><span class="unit">里 / 十万八千里</span></div>
    <div class="lens corner" id="h-lens"><div class="lk">广角程度<br><span>Q</span> 更广</div><div class="lv" id="h-lensv">60°</div><div class="lu" id="h-lensmm">35 毫米</div><div class="track" id="h-lenst"><b style="top:0"></b><b style="top:25%"></b><b style="top:50%"></b><b style="top:75%"></b><b style="top:100%"></b><i id="h-lensi"></i></div><div class="lk"><span>E</span> 收窄<br>滚轮也可调<br><span>0</span> 复位</div></div>
    <div class="marker" id="h-marker"><div class="ring"></div><div class="arrow"></div><div class="dist" id="h-dist"></div></div>
    <div class="toast" id="h-toast"></div>
    <div id="h-fps" style="position:absolute;left:50%;top:10px;transform:translateX(-50%);font:11px -apple-system,sans-serif;letter-spacing:0.04em;opacity:0.7;display:none"></div>
    <div class="hint" id="h-hint"><b>W</b><b>S</b>升降<b>A</b><b>D</b>转向<b>Shift</b>加速<b>空格</b>翻筋斗<b>C</b>换镜头<b>Q</b><b>E</b>焦距<b>T</b>自动巡航<b>V</b>拍照<b>Esc</b>暂停</div>
    <div class="screen" id="s-title">
      <h1>筋斗云</h1><h2>驾驶模拟器</h2>
      <div class="row"><button class="btn" id="b-start">启程</button></div>
      <div class="loading" id="h-loading">正在腾云……</div>
      <div class="keys"><b>W</b><b>S</b>升降<b>A</b><b>D</b>转向（或移动鼠标）<b>Shift</b>加速<b>Ctrl</b>减速<b>空格</b>翻筋斗<br><b>C</b>换镜头<b>Q</b><b>E</b>或滚轮 调焦距<b>T</b>自动巡航<b>V</b>拍照模式<b>L</b>电影遮幅<b>H</b>隐藏界面<b>R</b>回到起点</div>
    </div>
    <div class="screen pause gone" id="s-pause">
      <div class="pause-title">稍歇</div>
      <div class="row"><button class="btn" id="b-resume">继续</button><button class="btn" id="b-restart">回到起点</button></div>
      <div class="row" style="margin-top:18px">
        <button class="btn small" id="b-quality"></button><button class="btn small" id="b-invert"></button><button class="btn small" id="b-mouse"></button><button class="btn small" id="b-music"></button><button class="btn small" id="b-lb"></button><button class="btn small" id="b-blur"></button>
      </div>
      <div class="lensrow">广角程度 <input type="range" id="b-lens" min="0" max="1000" step="1"> <span id="b-lensv"></span><button class="btn small" id="b-lens0">复位</button>
      </div>
    </div>`;
  document.body.appendChild(ui);
  const $ = (id) => ui.querySelector('#' + id);
  const el = { spd: $('h-spd'), boost: $('h-boost'), hoops: $('h-hoops'), combo: $('h-combo'), alt: $('h-alt'), li: $('h-li'), mode: $('h-mode'), marker: $('h-marker'), dist: $('h-dist'), toast: $('h-toast'), hint: $('h-hint'), loading: $('h-loading') };
  let toastTimer = 0, acc = 0, hintTimer = 0;
  const listeners = {};
  const emit = (n, ...a) => (listeners[n] || []).forEach(fn => fn(...a));
  $('b-start').addEventListener('click', () => emit('start'));
  $('b-lens').addEventListener('input', (e) => emit('lensFrac', 1 - +e.target.value / 1000));
  $('b-lens0').addEventListener('click', () => emit('lensReset'));
  let lensAct = 0;
  $('b-resume').addEventListener('click', () => emit('resume'));
  $('b-restart').addEventListener('click', () => emit('restart'));
  for (const k of ['quality', 'invert', 'mouse', 'music', 'lb', 'blur']) $('b-' + k).addEventListener('click', () => emit(k));

  return {
    root: ui,
    on(n, fn) { (listeners[n] = listeners[n] || []).push(fn); },
    setLoading(text) { el.loading.textContent = text; },
    showTitle(v) { $('s-title').classList.toggle('gone', !v); },
    showPause(v) { $('s-pause').classList.toggle('gone', !v); },
    showHUD(v) { ui.classList.toggle('hide-hud', !v); },
    showHint(seconds = 9) { el.hint.classList.add('show'); hintTimer = seconds; },
    setOptions(o) {
      $('b-quality').textContent = '画质：' + ({ low: '流畅', high: '高', ultra: '极致' }[o.quality] || o.quality);
      $('b-invert').textContent = '升降反向：' + (o.invertY ? '开' : '关');
      $('b-mouse').textContent = '鼠标操控：' + (o.mouse ? '开' : '关');
      $('b-music').textContent = '声音：' + (o.sound ? '开' : '关');
      $('b-lb').textContent = '电影遮幅：' + (o.letterbox ? '开' : '关');
      $('b-blur').textContent = '运动模糊：' + (['关', '标准', '强'][o.blur] || '标准');
    },
    /** deg：水平视角；mm：等效焦距；wide：0（最窄）..1（最广） */
    setLens(deg, mm, wide, bump) {
      const e = ui.querySelector('#h-lens'), frac = wide;
      ui.querySelector('#h-lensv').textContent = Math.round(deg) + '°';
      ui.querySelector('#h-lensmm').textContent = Math.round(mm) + ' 毫米';
      ui.querySelector('#h-lensi').style.top = ((1 - frac) * 100).toFixed(1) + '%';
      if (bump) lensAct = 2.0;
      e.classList.toggle('active', lensAct > 0); lensAct = Math.max(0, lensAct - 1 / 60);
      const r = ui.querySelector('#b-lens'); if (document.activeElement !== r) r.value = Math.round(frac * 1000);
      ui.querySelector('#b-lensv').textContent = '视角 ' + Math.round(deg) + '°（' + Math.round(mm) + ' 毫米）';
    },
    setFps(text) { const e = ui.querySelector('#h-fps'); if (text === null) e.style.display = 'none'; else { e.style.display = 'block'; e.textContent = text; } },
    toast(text, seconds = 1.6) { el.toast.textContent = text; el.toast.classList.add('show'); toastTimer = seconds; },
    /** d: { speed, boost, alt, hoops, combo, li, mode, marker: {x, y, visible, behind, dist} | null } */
    update(dt, d) {
      if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) el.toast.classList.remove('show'); }
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) el.hint.classList.remove('show'); }
      if (d.marker) {
        const m = d.marker, w = innerWidth, h = innerHeight;
        let x = m.x * w, y = (1 - m.y) * h; const pad = 46;
        const off = m.behind || x < pad || x > w - pad || y < pad || y > h - pad;
        if (off) {
          let dx = x - w / 2, dy = y - h / 2; if (m.behind) { dx = -dx; dy = -dy; }
          const s = Math.min((w / 2 - pad) / Math.max(Math.abs(dx), 1e-3), (h / 2 - pad) / Math.max(Math.abs(dy), 1e-3));
          x = w / 2 + dx * s; y = h / 2 + dy * s;
          el.marker.querySelector('.arrow').style.transform = `rotate(${Math.atan2(dx, -dy)}rad)`;
        }
        el.marker.classList.toggle('off', off);
        el.marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; el.marker.style.opacity = m.dist < 40 && !off ? 0 : 0.95;
        el.dist.textContent = Math.round(m.dist) + ' 米';
      } else el.marker.style.opacity = 0;
      acc += dt; if (acc < 0.1) return; acc = 0;
      el.spd.textContent = Math.round(d.speed * 3.6);
      el.boost.style.width = Math.round(d.boost * 100) + '%';
      el.hoops.textContent = d.hoops;
      el.combo.textContent = d.combo > 1 ? '连击 ×' + d.combo : '';
      el.alt.textContent = Math.round(d.alt);
      el.li.textContent = d.li.toFixed(1);
      el.mode.textContent = d.mode;
    },
  };
}
