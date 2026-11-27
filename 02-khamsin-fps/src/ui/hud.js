// HUD 与菜单界面
import { WEAPONS } from '../game/weapons.js';
import { SCORE_GOAL, MATCH_TIME } from '../game/game.js';
import { Cockpit } from './cockpit.js';
import { touchText } from './touch.js';

const $ = (id) => document.getElementById(id);
const setTxt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const setW = (el, p) => { const v = Math.round(p * 1000) / 10; if (el._w !== v) { el._w = v; el.style.width = v + '%'; } };
const setVar = (el, k, v) => { const key = '_' + k; if (el[key] !== v) { el[key] = v; el.style.setProperty(k, v); } };

export class HUD {
  constructor() {
    this.el = {}; for (const id of ['hud', 'scF', 'scE', 'sbF', 'sbE', 'clock', 'minimap', 'killfeed', 'announce', 'warn', 'cross', 'chargeRing', 'hit', 'dmg', 'popups', 'prompt', 'spv', 'spb', 'hpf', 'hpn', 'abQ', 'abG', 'abF', 'abV', 'mechFill', 'mechPct', 'wname', 'wtag', 'ammo', 'ammoN', 'slots', 'mhp', 'mhpN', 'mcore', 'mcoreN', 'mAmmo', 'mRocket', 'mDash', 'doom', 'scope', 'dead', 'deadT', 'loading', 'lfill', 'ltext', 'menu', 'pause', 'end', 'endTitle', 'endSub', 'endScore', 'endStats', 'mcross', 'speed']) this.el[id] = $(id);
    this.mm = this.el.minimap.getContext('2d'); this.mapImg = null; this.annT = 0; this.kf = []; this.mode = 'pilot'; this.game = null; this.yawRef = 0;
    this.pipsQ = this.el.abQ.querySelectorAll('.pips i'); this.pipsG = this.el.abG.querySelectorAll('.pips i'); this.cdF = this.el.abF.querySelector('.cd i'); this.slots = this.el.slots.querySelectorAll('i');
    this.cockpit = new Cockpit(this);   // 机甲座舱：把 #cockpit 换成全息 HUD 的 DOM（立体内饰到第一次登机时才建）
  }
  progress(p, text) { this.el.lfill.style.width = Math.round(p * 100) + '%'; if (text) this.el.ltext.textContent = text; }
  setState(s) {
    const e = this.el; document.body.classList.toggle('intro', s === 'intro'); document.body.dataset.ui = s;
    e.loading.classList.toggle('hidden', s !== 'loading'); e.menu.classList.toggle('hidden', s !== 'menu'); e.pause.classList.toggle('hidden', s !== 'paused'); e.end.classList.toggle('hidden', s !== 'ended');
    e.hud.classList.toggle('hidden', !(s === 'playing' || s === 'intro' || s === 'paused'));
    if (s !== 'playing' && s !== 'paused') this.setMode('pilot');
  }
  setMode(m) { this.mode = m; document.body.classList.toggle('mech', m === 'mech'); if (m !== 'mech') this.cockpit.hide(); }

  // 由导航网格生成小地图底图
  buildMap(nav, level) {
    const c = document.createElement('canvas'); c.width = nav.w; c.height = nav.h; const g = c.getContext('2d'); const img = g.createImageData(nav.w, nav.h);
    for (let i = 0; i < nav.w * nav.h; i++) {
      const h = nav.hgt[i]; let r = 0, gg = 0, b = 0, a = 0;
      if (nav.ok[i]) { if (h < (level && level.mapLow !== undefined ? level.mapLow : -1.5)) { r = 70; gg = 110; b = 130; a = 120; } else { r = 215; gg = 200; b = 170; a = 46; } }   // 低于 mapLow 的可走格画成河床的颜色
      else if (h > -900) { r = 235; gg = 222; b = 196; a = 150; }
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0); this.mapImg = c; this.nav = nav; this.level = level;
  }

  hitMarker(head, kill) { const h = this.el.hit; h.className = ''; void h.offsetWidth; h.className = 'on' + (kill ? ' kill' : head ? ' head' : ''); }
  damageFrom(pos) {
    const g = this.game; if (!g) return; const p = g.player; const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z;
    const ang = Math.atan2(dx * p.right.x + dz * p.right.z, dx * p.fwd.x + dz * p.fwd.z);
    const d = this.el.dmg; if (d.children.length > 5) d.removeChild(d.firstChild);
    const i = document.createElement('i'); i.style.transform = `rotate(${ang}rad)`; d.appendChild(i); setTimeout(() => i.remove(), 1100);
  }
  popup(text, pts) { const p = this.el.popups; if (p.children.length > 4) p.removeChild(p.firstChild); const d = document.createElement('div'); d.innerHTML = `${text}<b>+${pts}</b>`; p.appendChild(d); setTimeout(() => d.remove(), 1900); }
  killfeed(killer, victim, team) {
    const k = this.el.killfeed; if (k.children.length > 5) k.removeChild(k.firstChild);
    const d = document.createElement('div'); const me = killer === '你' || victim === '你'; if (me) d.className = 'me';
    d.innerHTML = `<span class="${team === 0 ? 'f' : 'e'}">${killer}</span><em>▸</em><span class="${team === 0 ? 'e' : 'f'}">${victim}</span>`;
    k.appendChild(d); setTimeout(() => d.remove(), me ? 6000 : 4200);
  }
  announce(text, type = 'info') { const a = this.el.announce; a.textContent = touchText(text); a.className = 'on ' + type; this.annT = 4.2; if (this.game) this.game.audio.play('announce', { volume: 0.5 }); }

  showEnd(win, game) {
    const e = this.el; e.end.classList.toggle('lose', !win); e.endTitle.textContent = win ? '胜 利' : '失 败'; e.endSub.textContent = win ? '旧城已在我方控制之下' : '赤蝎守住了卡姆辛';
    e.endScore.innerHTML = `<span class="f">${game.score[0]}</span> : <span class="e">${game.score[1]}</span>`;
    const s = game.stats, w = game.weapons.stats, p = game.player.stats;
    const acc = w.shots ? Math.round(w.hits / w.shots * 100) : 0;
    const items = [[s.kills, '击杀'], [s.deaths, '阵亡'], [s.bestStreak, '最高连杀'], [s.mechKills, '摧毁机甲'], [s.headshots, '爆头'], [acc + '%', '命中率'], [p.maxSpeed.toFixed(1), '最高速度 m/s'], [Math.round(p.wallrunTime) + 's', '蹬墙时长']];
    e.endStats.innerHTML = items.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    this.setState('ended');
  }

  frame(game, dt) {
    this.game = game; const e = this.el, p = game.player, w = game.weapons;
    if (this.annT > 0) { this.annT -= dt; if (this.annT <= 0) e.announce.className = ''; }
    if (game.state !== 'playing' && game.state !== 'ending') return;
    // 比分 / 时间
    setTxt(e.scF, game.score[0]); setTxt(e.scE, game.score[1]); setW(e.sbF, Math.min(1, game.score[0] / SCORE_GOAL)); setW(e.sbE, Math.min(1, game.score[1] / SCORE_GOAL));
    const left = Math.max(0, MATCH_TIME - game.matchT); setTxt(e.clock, game.explore ? '探索' : Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0'));
    // 死亡界面
    const dead = !p.alive; if (e.dead._on !== dead) { e.dead._on = dead; e.dead.style.display = dead ? 'flex' : 'none'; }
    if (dead) setTxt(e.deadT, '重新部署倒计时 ' + Math.max(0, game.respawnT).toFixed(1) + 's');
    // 提示
    const pr = game.interactPrompt; if (e.prompt._t !== pr) { e.prompt._t = pr; e.prompt.textContent = pr || ''; e.prompt.className = pr ? 'on' : ''; }
    const sw = game.sniperWarn > 0.05; if (e.warn._on !== sw) { e.warn._on = sw; e.warn.className = sw ? 'on' : ''; }
    const pm = game.playerMech;
    if (this.mode === 'mech' && pm) {
      this.cockpit.frame(game, dt, pm);   // 机甲座舱：立体内饰 + 全息 HUD 都在 cockpit.js
    } else {
      // 生命
      setW(e.hpf, p.hp / p.maxHp); setTxt(e.hpn, Math.ceil(p.hp)); const low = p.hp < 35; if (e.hpf._low !== low) { e.hpf._low = low; e.hpf.className = low ? 'low' : ''; }
      // 武器
      const def = WEAPONS[w.cur]; setTxt(e.wname, def.name); setTxt(e.wtag, def.tag); setTxt(e.ammoN, w.reloadT >= 0 ? '--' : w.ammo[w.cur]);
      const lowA = w.ammo[w.cur] <= def.mag * 0.25; if (e.ammo._low !== lowA) { e.ammo._low = lowA; e.ammo.className = lowA ? 'low' : ''; }
      for (const s of this.slots) { const on = s.dataset.k === w.cur; if (s._on !== on) { s._on = on; s.className = on ? 'on' : ''; } }
      // 技能
      const g = p.grapple; setVar(this.pipsQ[0], '--p', Math.min(1, g.charges).toFixed(2)); setVar(this.pipsQ[1], '--p', Math.max(0, Math.min(1, g.charges - 1)).toFixed(2));
      setVar(this.pipsG[0], '--p', Math.min(1, w.grenades).toFixed(2)); setVar(this.pipsG[1], '--p', Math.max(0, Math.min(1, w.grenades - 1)).toFixed(2));
      setW(this.cdF, 1 - Math.max(0, Math.min(1, w.meleeCD / 0.75)));
      const mc = pm ? (pm.alive ? 1 : 0) : game.mechCharge; setW(e.mechFill, mc); setTxt(e.mechPct, pm ? '已部署' : Math.floor(mc * 100) + '%');
      const rdy = !pm && mc >= 1; if (e.abV._r !== rdy) { e.abV._r = rdy; e.abV.className = 'ab wide' + (rdy ? ' ready' : ''); }
      // 准星
      const ads = p.adsT; const spread = (def.spread[0] + (def.spread[1] - def.spread[0]) * ads + w.bloom) * 900 + (p.onGround ? 0 : 5) + Math.min(6, p.speedH * 0.5);
      setVar(e.cross, '--gap', Math.round(5 + spread) + 'px');
      const hideCross = ads > 0.5 || !p.alive || (p.sprinting && p.onGround && w.fireHold <= 0); const op = hideCross ? (ads > 0.5 ? '0' : '0.35') : '1'; if (e.cross._o !== op) { e.cross._o = op; e.cross.style.opacity = op; }
      const ch = w.charge; if (e.chargeRing._c !== ch) { e.chargeRing._c = ch; e.chargeRing.style.opacity = ch > 0.02 ? 1 : 0; e.chargeRing.style.setProperty('--ch', ch.toFixed(3)); }
      const sc = w.cur === 'rail' ? Math.max(0, (ads - 0.6) / 0.4) : 0; if (e.scope._o !== sc) { e.scope._o = sc; e.scope.style.opacity = sc; }
      // 速度
      const sp = Math.hypot(p.vel.x, p.vel.z); setTxt(e.spv, sp.toFixed(1)); setW(e.spb, Math.min(1, sp / 16));
    }
    this.drawMinimap(game);
  }

  drawMinimap(game) {
    if (!this.mapImg || (game.frame & 1)) return;
    const g = this.mm, p = game.player, nav = this.nav; const S = 220, c = S / 2, sc = 2.0;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    g.translate(c, c); g.rotate(p.yaw); g.translate(-p.pos.x * sc, -p.pos.z * sc);
    g.imageSmoothingEnabled = true; const ncs = nav.cs || 1; g.drawImage(this.mapImg, nav.x0 * sc, nav.z0 * sc, nav.w * ncs * sc, nav.h * ncs * sc);
    // 据点字母
    g.font = '700 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (this.level.zones) for (const k of ['A', 'B']) { const z = this.level.zones[k]; g.save(); g.translate(z.x * sc, z.z * sc); g.rotate(-p.yaw); g.fillStyle = 'rgba(255,179,71,0.9)'; g.fillText(k, 0, 0); g.restore(); }
    const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x * sc, z * sc, r, 0, 6.3); g.fill(); };
    for (const a of game.actors) { if (!a.alive || (a.phase || 0) !== game.phase) continue; const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z); if (d > 60) continue; if (a.team === 0) dot(a.pos.x, a.pos.z, '#58e0ff', 2.6); else if (d < 42 || a.kind === 'sniper') dot(a.pos.x, a.pos.z, a.kind === 'sniper' ? '#ffd24a' : '#ff5a36', a.kind === 'drone' ? 2.2 : 2.8); }
    for (const m of game.mechs) { if (!m.alive) continue; g.save(); g.translate(m.pos.x * sc, m.pos.z * sc); g.rotate(Math.PI / 4); g.fillStyle = m.team === 0 ? '#58e0ff' : '#ff5a36'; g.fillRect(-5, -5, 10, 10); g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(-5, -5, 10, 10); g.restore(); }
    for (const pd of game.pods) if (pd.state === 0) { g.strokeStyle = pd.team === 0 ? '#58e0ff' : '#ff5a36'; g.lineWidth = 1.5; g.beginPath(); g.arc(pd.x * sc, pd.z * sc, 5 + (game.time * 10 % 5), 0, 6.3); g.stroke(); }
    // 玩家箭头
    g.setTransform(1, 0, 0, 1, c, c); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill();
  }
}
