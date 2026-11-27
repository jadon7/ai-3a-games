// 输入：键盘 + 鼠标（指针锁定）+ 手柄，统一成一组连续量。
//   turn  -1..1  （左负右正）     A/D、←/→、鼠标左右、左摇杆
//   climb -1..1  （上正下负）     W/S、↑/↓、鼠标上下、左摇杆
//   boost 0..1   加速             Shift、手柄 RT
//   brake 0..1   减速             Ctrl / X、手柄 LT
//   一次性动作通过 on(name, fn) 订阅：flip（空格/手柄 A）、camera（C）、photo（V）、pause（Esc/P）、hud（H）、mute（M）、reset（R）、auto（T）
export function createInput(canvas) {
  const keys = new Set();
  const listeners = {};
  const state = { turn: 0, climb: 0, boost: 0, brake: 0, invertY: false, mouseSteer: true, locked: false, lookX: 0, lookY: 0 };
  let mx = 0, my = 0;                      // 鼠标"虚拟摇杆"（-1..1），慢慢回中
  let enabled = true;
  const emit = (n, ...a) => { (listeners[n] || []).forEach(fn => fn(...a)); };
  const ACTIONS = { Space: 'flip', KeyC: 'camera', KeyV: 'photo', Escape: 'pause', KeyP: 'pause', KeyH: 'hud', KeyM: 'mute', KeyR: 'reset', KeyT: 'auto', KeyY: 'invert', KeyL: 'letterbox', KeyF: 'fps' };

  addEventListener('keydown', (e) => {
    if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
    keys.add(e.code);
    if (ACTIONS[e.code]) { emit(ACTIONS[e.code]); if (e.code === 'Space') e.preventDefault(); }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    emit('any');
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  document.addEventListener('pointerlockchange', () => { state.locked = document.pointerLockElement === canvas; emit('lock', state.locked); });
  addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    const s = 1 / 260;
    mx = Math.max(-1, Math.min(1, mx + e.movementX * s));
    my = Math.max(-1, Math.min(1, my - e.movementY * s));
    state.lookX += e.movementX; state.lookY += e.movementY;
  });
  addEventListener('mousedown', (e) => { if (state.locked && e.button === 0) emit('flip'); });

  let padPrev = {};
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
      const edge = (i, name) => { const d = b(i) > 0.5; if (d && !padPrev[i]) emit(name); padPrev[i] = d; };
      edge(0, 'flip'); edge(3, 'camera'); edge(9, 'pause'); edge(2, 'photo'); edge(8, 'reset');
      return { turn: dz(p.axes[0] || 0), climb: -dz(p.axes[1] || 0), boost: b(7), brake: b(6) };
    }
    return null;
  }

  return {
    state,
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    setEnabled(v) { enabled = v; if (!v) { keys.clear(); mx = my = 0; } },
    requestLock() { if (canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* 忽略 */ } } },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    update(dt) {
      const k = (...c) => (c.some(x => keys.has(x)) ? 1 : 0);
      let turn = k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft');
      let climb = k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown');
      let boost = k('ShiftLeft', 'ShiftRight');
      let brake = k('ControlLeft', 'ControlRight', 'KeyX');
      // 鼠标虚拟摇杆缓慢回中，键盘优先
      const decay = Math.exp(-dt * 1.6); mx *= decay; my *= decay;
      if (state.mouseSteer && state.locked) { if (!turn) turn = mx; if (!climb) climb = my; }
      const pad = pollPad();
      if (pad) { if (Math.abs(pad.turn) > Math.abs(turn)) turn = pad.turn; if (Math.abs(pad.climb) > Math.abs(climb)) climb = pad.climb; boost = Math.max(boost, pad.boost); brake = Math.max(brake, pad.brake); }
      if (state.invertY) climb = -climb;
      if (!enabled) { turn = climb = boost = brake = 0; }
      state.turn = turn; state.climb = climb; state.boost = boost; state.brake = brake;
      return state;
    },
  };
}
