// 双界试炼的界面：计时 + 检查点进度、相位徽标（T 切换 / Z 透视）、沿途提示。样式随脚本注入，不动 style.css
import { RIFT_NAME } from '../world/rift.js';
import { touchText } from './touch.js';

const CSS = `
body.rift #scorebar, body.rift #abV { display: none; }
#riftTop { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); text-align: center; padding: 4px 22px 8px; background: var(--ink); border-top: 2px solid var(--amber); min-width: 190px; z-index: 2; transition: border-color 0.25s; }
#riftTop small { display: block; font-size: 10px; letter-spacing: 0.3em; opacity: 0.7; }
#riftTop b { display: block; font-size: 28px; font-weight: 600; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; line-height: 1.15; }
#riftTop em { display: block; font-style: normal; font-size: 11px; letter-spacing: 0.14em; opacity: 0.6; }
#riftCp { display: flex; gap: 5px; justify-content: center; margin-top: 5px; }
#riftCp i { width: 18px; height: 4px; background: rgba(255, 255, 255, 0.2); transform: skewX(-20deg); transition: background 0.3s, box-shadow 0.3s; }
#riftCp i.on { background: var(--amber); box-shadow: 0 0 8px var(--amber); }
#riftPhase { position: absolute; left: 50%; bottom: 104px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; padding: 7px 18px 9px; background: var(--ink); border-bottom: 2px solid #ffb347; z-index: 2; transition: border-color 0.25s; }
#riftPhase .nm { font-size: 22px; letter-spacing: 0.32em; font-weight: 600; color: #ffc46b; transition: color 0.25s; min-width: 3.2em; text-align: center; }
#riftPhase .nm small { display: block; font-size: 9px; letter-spacing: 0.34em; opacity: 0.6; font-weight: 400; color: #fff; }
#riftPhase .k { font-size: 12px; letter-spacing: 0.1em; opacity: 0.85; white-space: nowrap; }
#riftPhase .k + .k { margin-top: 3px; }
#riftPhase .cd { position: absolute; left: 0; bottom: -2px; height: 2px; width: 100%; background: #fff; transform-origin: left; transform: scaleX(0); }
#riftPhase.blocked { animation: riftShake 0.32s; border-color: var(--e); }
#riftPhase.peek .k.z { color: #8ff3ff; }
body.phase1 #riftPhase { border-color: #58e0ff; } body.phase1 #riftPhase .nm { color: #7fefff; } body.phase1 #riftTop { border-color: #58e0ff; } body.phase1 #riftCp i.on { background: #58e0ff; box-shadow: 0 0 8px #58e0ff; }
@keyframes riftShake { 0%, 100% { transform: translateX(-50%); } 25% { transform: translateX(calc(-50% - 7px)); } 75% { transform: translateX(calc(-50% + 7px)); } }
#riftHint { position: absolute; left: 50%; top: 150px; transform: translateX(-50%); max-width: min(760px, calc(78 * var(--vw))); padding: 8px 20px; font-size: 15px; letter-spacing: 0.06em; line-height: 1.5; text-align: center; background: var(--ink); border-left: 3px solid #58e0ff; opacity: 0; transition: opacity 0.35s; z-index: 2; }
#riftHint.on { opacity: 0.96; }
#riftBlock { position: absolute; left: 50%; bottom: 172px; transform: translateX(-50%); padding: 4px 14px; font-size: 13px; letter-spacing: 0.14em; color: #ffd9cc; background: var(--ink); border-left: 2px solid var(--e); opacity: 0; transition: opacity 0.2s; z-index: 2; white-space: nowrap; }
#riftBlock.on { opacity: 1; }
body.mech #riftPhase { display: none; }
`;

export class RiftHUD {
  constructor() {
    document.body.classList.add('rift');
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const hud = document.getElementById('hud'); const mk = (id, html) => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; hud.appendChild(d); return d; };
    this.top = mk('riftTop', '<small>双界回廊 · 相位试炼</small><b>0:00.0</b><em></em><div id="riftCp"></div>');
    this.phase = mk('riftPhase', '<div class="nm">现世<small>PHASE</small></div><div><div class="k t"><kbd>T</kbd>相位切换</div><div class="k z"><kbd>Z</kbd>按住 · 蜃影透视</div></div><i class="cd"></i>');
    this.hintEl = mk('riftHint', ''); this.blockEl = mk('riftBlock', '相位受阻 —— 另一界的这个位置有实体');
    this.timeEl = this.top.querySelector('b'); this.bestEl = this.top.querySelector('em'); this.cpEl = this.top.querySelector('#riftCp'); this.nmEl = this.phase.querySelector('.nm'); this.cdEl = this.phase.querySelector('.cd');
    this._t = ''; this._cd = -1; this._peek = false; this.blockT = 0;
    // 开场字幕
    const h1 = document.querySelector('#letter h1'), sub = document.querySelector('#letter p'); if (h1) h1.textContent = '双界回廊'; if (sub) sub.textContent = 'THE TWIN CORRIDOR · 相位试炼';
  }
  reset(n, best) {
    this.cpEl.innerHTML = '<i class="on"></i>' + '<i></i>'.repeat(Math.max(0, n - 1)); this.timeEl.textContent = '0:00.0'; this._t = '';
    this.bestEl.textContent = best ? '最佳 ' + fmtT(best) : '尚无记录'; this.hint(''); this.blockEl.className = '';
  }
  setPhase(k) { this.nmEl.firstChild.nodeValue = RIFT_NAME[k]; }
  checkpoint(i, name) { const c = this.cpEl.children; for (let j = 0; j < c.length; j++) c[j].className = j <= i ? 'on' : ''; }
  hint(text) { if (text) { this.hintEl.textContent = touchText(text); this.hintEl.className = 'on'; } else this.hintEl.className = ''; }
  blocked() { this.blockT = 1.1; this.blockEl.className = 'on'; const p = this.phase; p.classList.remove('blocked'); void p.offsetWidth; p.classList.add('blocked'); }
  frame(m, dt) {
    const t = fmtT(m.t); if (t !== this._t) { this._t = t; this.timeEl.textContent = t; }
    const cd = Math.round(Math.min(1, m.cd / 0.45) * 50) / 50; if (cd !== this._cd) { this._cd = cd; this.cdEl.style.transform = 'scaleX(' + cd + ')'; }
    if (m.peek !== this._peek) { this._peek = m.peek; this.phase.classList.toggle('peek', m.peek); }
    if (this.blockT > 0) { this.blockT -= dt; if (this.blockT <= 0) this.blockEl.className = ''; }
  }
}
export const fmtT = (t) => { const d = Math.floor(t * 10); return Math.floor(d / 600) + ':' + (d % 600 < 100 ? '0' : '') + ((d % 600) / 10).toFixed(1); };
