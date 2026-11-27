// 触屏操控：左半屏浮动摇杆移动，右半屏拖动转视角，右下一圈按钮（开火 / 跳 / 蹲滑 / 瞄准 …）。
// 全部通过 Input 的 sim() / axis / dx,dy 灌进去，游戏逻辑不用知道输入来自键鼠还是手指。
// 用的是 Pointer Events：一根手指一个 pointerId，多指互不干扰；鼠标也能点（方便在电脑上调试 ?touch=1）。
import { VIEW, toStage } from '../core/view.js';

const LOOK_GAIN = 2.6, LOOK_GAIN_Y = 0.78;   // 手指拖动的像素 → 等效鼠标位移（纵向略钝一点，不容易拖飞）
const JOY_R = 56;                            // 摇杆半径（乘 --tu）

// [id, 文字, 类型, 键位, 所属模式, 直径, 右, 下]（直径 / 右 / 下 以 390 高的屏幕为基准，实际乘 --tu；右下再加安全区）
//   类型：hold 按住 = 键按下；toggle 点一下切换；wheel 切下一把枪；pause 暂停
//   模式：p 飞行员，m 机甲，r 仅双界试炼，t 仅旧城，ctx 有可交互对象时才出现
const FIRE_ICON = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20 3v9M20 28v9M3 20h9M28 20h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="20" r="2.6" fill="currentColor"/></svg>';
const DEFS = [
  ['fire', FIRE_ICON, 'hold', 'Mouse0', 'p m', 80, 84, 60],
  ['jump', '跳', 'hold', 'Space', 'p', 62, 14, 18],
  ['crouch', '蹲滑', 'hold', 'KeyC', 'p', 54, 10, 92],
  ['ads', '瞄准', 'toggle', 'Mouse2', 'p', 52, 62, 152],
  ['reload', '换弹', 'hold', 'KeyR', 'p', 46, 174, 28],
  ['swap', '切枪', 'wheel', null, 'p', 46, 180, 106],
  ['nade', '手雷', 'hold', 'KeyG', 'p', 46, 138, 172],
  ['melee', '近战', 'hold', 'KeyF', 'p', 46, 6, 160],
  ['grap', '钩爪', 'hold', 'KeyQ', 'p', 50, 40, 218],
  ['phase', '相位', 'hold', 'KeyT', 'p r', 56, 194, 160],
  ['rocket', '火箭', 'hold', 'Mouse2', 'm', 60, 14, 20],
  ['dash', '冲刺', 'hold', 'ShiftLeft', 'm', 54, 10, 94],
  ['punch', '重拳', 'hold', 'KeyF', 'm', 52, 62, 152],
  ['mreload', '装填', 'hold', 'KeyR', 'm', 46, 174, 28],
  ['core', '核心', 'hold', 'KeyX', 'm', 52, 180, 106],
];
// 左上（小地图下方）和右上角的按钮：[id, 文字, 类型, 键位, 模式]
const SIDE = [
  ['mechcall', '机甲', 'hold', 'KeyV', 'p t'],
  ['peek', '透视', 'toggle', 'KeyZ', 'p r'],
  ['exit', '离舱', 'hold', 'KeyE', 'm'],
];

export class TouchControls {
  constructor(stage, input, hooks = {}) {
    this.input = input; this.hooks = hooks; this.btn = {}; this.ptr = new Map(); this.joy = { id: null, x: 0, y: 0 };
    this.enabled = false; this.intro = false; this.mech = null; this._p = { x: 0, y: 0 };
    const root = this.root = document.createElement('div'); root.id = 'touch';
    const mk = (id, label, type, key, mode, cls, style) => {
      const el = document.createElement('div'); el.className = 'tb ' + cls + ' ' + mode.split(' ').map((m) => 'm-' + m).join(' '); el.dataset.id = id;
      el.innerHTML = `<span>${label}</span><b></b>`; if (style) el.style.cssText = style; root.appendChild(el);
      this.btn[id] = { id, el, type, key, on: false, lit: false, txt: el.firstChild, n: el.lastChild };
    };
    for (const [id, label, type, key, mode, d, r, b] of DEFS) mk(id, label, type, key, mode, 'rb' + (id === 'fire' ? ' fire' : ''), `--d:${d};--r:${r};--b:${b}`);
    for (const [id, label, type, key, mode] of SIDE) mk(id, label, type, key, mode, 'side');
    mk('use', '互动', 'hold', 'KeyE', 'ctx', 'use'); mk('pause', '<i></i><i></i>', 'pause', null, 'sys', 'pause');
    this.joyEl = document.createElement('div'); this.joyEl.className = 'tj'; this.joyEl.innerHTML = '<i></i>'; root.appendChild(this.joyEl); this.knob = this.joyEl.firstChild;
    const hud = stage.querySelector('#hud'); stage.insertBefore(root, hud ? hud.nextSibling : null);

    root.addEventListener('pointerdown', (e) => this.onDown(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.onUp(e)); window.addEventListener('pointercancel', (e) => this.onUp(e));
    // iOS：阻止双指缩放、长按放大镜、边缘回弹
    for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  press(b, on) {
    const inp = this.input;
    if (b.type === 'hold') inp.sim(b.key, on);
    else if (b.type === 'toggle') { if (on) { b.lit = !b.lit; inp.sim(b.key, b.lit); b.el.classList.toggle('lit', b.lit); } }
    else if (b.type === 'wheel') { if (on) inp.wheel += 1; }
    else if (b.type === 'pause') { if (on && this.hooks.pause) this.hooks.pause(); }
    b.on = on; b.el.classList.toggle('on', on);
  }

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const el = e.target.closest ? e.target.closest('.tb') : null, pt = toStage(e, this._p);
    if (el) {
      const b = this.btn[el.dataset.id]; if (b.type !== 'pause' && !this.enabled) return;
      this.press(b, true);
      // 按着按钮拖动也能转视角（边开火边跟枪、边跳边转向）；开火键立即跟手，其它键先过一小段防抖
      this.ptr.set(e.pointerId, { b, x: pt.x, y: pt.y, moved: b.id === 'fire', slop: 9 });
      return;
    }
    if (!this.enabled) return;
    if (this.intro) { this.input.tap('Mouse0'); return; }   // 开场镜头：点一下跳过
    if (pt.x < VIEW.w * 0.4 && this.joy.id === null) {
      const j = this.joy, tu = VIEW.tu; j.id = e.pointerId; j.x = pt.x; j.y = pt.y; this.input.axis = { f: 0, s: 0 };
      const s = this.joyEl.style; s.left = (pt.x - JOY_R * tu) + 'px'; s.top = (pt.y - JOY_R * tu) + 'px'; this.joyEl.classList.add('on'); this.knob.style.transform = 'translate(0px, 0px)';
      return;
    }
    this.ptr.set(e.pointerId, { b: null, x: pt.x, y: pt.y, moved: true, slop: 0 });
  }

  onMove(e) {
    const j = this.joy;
    if (e.pointerId === j.id) {
      const pt = toStage(e, this._p), R = JOY_R * VIEW.tu; let dx = pt.x - j.x, dy = pt.y - j.y; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      const a = this.input.axis; if (a) { const dead = l < R * 0.16; a.f = dead ? 0 : -dy / R; a.s = dead ? 0 : dx / R; }
      e.preventDefault(); return;
    }
    const s = this.ptr.get(e.pointerId); if (!s) return;
    const pt = toStage(e, this._p), dx = pt.x - s.x, dy = pt.y - s.y;
    if (!s.moved) { if (Math.hypot(dx, dy) < s.slop * VIEW.tu) return; s.moved = true; s.x = pt.x; s.y = pt.y; return; }
    s.x = pt.x; s.y = pt.y;
    if (this.enabled && !this.intro) { this.input.dx += dx * LOOK_GAIN; this.input.dy += dy * LOOK_GAIN * LOOK_GAIN_Y; }
    e.preventDefault();
  }

  onUp(e) {
    const j = this.joy;
    if (e.pointerId === j.id) { this.joyOff(); return; }
    const s = this.ptr.get(e.pointerId); if (!s) return; this.ptr.delete(e.pointerId);
    if (s.b && s.b.on) this.press(s.b, false);
  }

  // 摇杆回到左下角的提示位置
  joyOff() { this.joy.id = null; this.input.axis = null; const s = this.joyEl.style; s.left = ''; s.top = ''; this.knob.style.transform = ''; this.joyEl.classList.remove('on'); }

  // 松开所有按键和摇杆（暂停、回菜单、上下机甲时调用）
  release(toggles = true) {
    for (const s of this.ptr.values()) if (s.b && s.b.on) this.press(s.b, false);
    this.ptr.clear(); this.joyOff();
    if (toggles) for (const b of Object.values(this.btn)) if (b.type === 'toggle' && b.lit) { b.lit = false; b.el.classList.remove('lit'); this.input.sim(b.key, false); }
  }

  // 每帧：按游戏状态显示 / 隐藏按钮，刷新按钮上的充能、数量
  frame(game, paused, demo) {
    const st = game.state, inp = this.input;
    const en = !!inp.touchLock && !paused && !demo && (st === 'playing' || st === 'ending' || st === 'intro');
    if (en !== this.enabled) { this.enabled = en; if (!en) this.release(); }
    this.intro = st === 'intro';
    const show = inp.touchMode && (st === 'playing' || st === 'ending' || st === 'intro') && !paused;
    if (show !== this._show) { this._show = show; this.root.classList.toggle('show', show); }
    if (!show || this.intro) return;
    const p = game.player, w = game.weapons, pm = game.playerMech, B = this.btn; const mech = !!p.inMech;
    if (mech !== this.mech) { this.mech = mech; this.release(); this.root.classList.toggle('mech', mech); this.root.classList.toggle('rift', !!game.rift); }
    const P = (b, v) => { v = Math.max(0, Math.min(1, v)); const k = v.toFixed(2); if (b._p !== k) { b._p = k; b.el.style.setProperty('--p', k); } };
    const N = (b, v) => { if (b._n !== v) { b._n = v; b.n.textContent = v; } };
    const C = (b, c, on) => { const k = '_' + c; if (b[k] !== on) { b[k] = on; b.el.classList.toggle(c, on); } };
    // 互动（登机 / 滑索 / 机关）：把「按 E xxx」的提示变成按钮上的字
    const pr = !demo && game.interactPrompt ? game.interactPrompt.replace(/^按 E ?/, '') : ''; const u = B.use;
    if (u._t !== pr) { u._t = pr; u.el.classList.toggle('vis', !!pr); if (pr) u.txt.textContent = pr; }
    if (mech && pm) {
      P(B.rocket, 1 - pm.rocketCD / 9); C(B.rocket, 'dim', pm.rocketCD > 0);
      N(B.dash, Math.floor(pm.dash + 1e-3) || ''); C(B.dash, 'dim', pm.dash < 1);
      P(B.core, pm.laserT >= 0 ? 1 : pm.core); C(B.core, 'ready', pm.core >= 1 && pm.laserT < 0); C(B.core, 'dim', pm.core < 1 && pm.laserT < 0);
      P(B.exit, pm.exitHold / 0.45); C(B.punch, 'dim', pm.punchT >= 0); C(B.mreload, 'dim', pm.reloadT >= 0);
    } else {
      const g = p.grapple; P(B.grap, g.charges / g.max); N(B.grap, Math.floor(g.charges + 1e-3) || ''); C(B.grap, 'dim', g.charges < 1);
      P(B.nade, w.grenades / w.grenadeMax); N(B.nade, Math.floor(w.grenades + 1e-3) || ''); C(B.nade, 'dim', w.grenades < 1);
      C(B.melee, 'dim', w.meleeCD > 0); C(B.reload, 'dim', w.reloadT >= 0);
      if (game.rift) { P(B.phase, 1 - game.rift.cd / 0.45); }
      else { const rdy = !pm && game.mechCharge >= 1; P(B.mechcall, pm ? 0 : game.mechCharge); C(B.mechcall, 'ready', rdy); C(B.mechcall, 'gone', !!pm); N(B.mechcall, pm || rdy ? '' : Math.floor(game.mechCharge * 100) + '%'); }
    }
  }
}

// 界面提示里的按键名换成触屏按钮的叫法
const RULES = [[/再按 T\s*/g, '再点「相位」'], [/按 T\s*/g, '点「相位」'], [/按住 Z\s*/g, '打开「透视」'], [/按 V\s*/g, '点「机甲」'], [/长按 E 离舱/g, '长按「离舱」'], [/靠近并按 E 登机/g, '靠近后点「登机」'],
  [/按 E 弹射/g, '长按「离舱」弹射'], [/，Q 发射钩爪/g, '，点「钩爪」发射钩爪'], [/就绪 · 右键/g, '就绪'], [/就绪 · 按 X/g, '就绪'], [/ · X 熔毁核心 · Shift 冲刺 · F 动力拳/g, ''], [/按 E /g, '点右侧按钮'], [/Enter \/ 点击画面接管 · H 隐藏界面 · Esc 返回/g, '点击画面接管 · 右上角返回']];
export const touchText = (s) => { if (!VIEW.touch || typeof s !== 'string') return s; for (const [a, b] of RULES) s = s.replace(a, b); return s; };
