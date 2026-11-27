// 键盘 + 手柄输入
export class Input {
  constructor() {
    this.keys = new Set(); this.hit = new Set();
    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    window.addEventListener('keydown', e => { if (block.has(e.code)) e.preventDefault(); if (!e.repeat) this.hit.add(e.code); this.keys.add(e.code); });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = [];
  }
  // 本帧新按下的键（读一次即清）
  pressed(...codes) { for (const c of codes) if (this.hit.has(c)) { this.hit.delete(c); return true; } return false; }
  endFrame() { this.hit.clear(); }
  read() {
    const k = this.keys, o = { steer: 0, throttle: 0, brake: 0, handbrake: false, analog: false };
    if (k.has('KeyA') || k.has('ArrowLeft')) o.steer += 1;
    if (k.has('KeyD') || k.has('ArrowRight')) o.steer -= 1;
    if (k.has('KeyW') || k.has('ArrowUp')) o.throttle = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) o.brake = 1;
    if (k.has('Space')) o.handbrake = true;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = v => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
      const sx = dz(p.axes[0] || 0), rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(sx) > 0.02 || rt > 0.02 || lt > 0.02) { o.analog = true; o.steer = -Math.sign(sx) * Math.pow(Math.abs(sx), 1.6); o.throttle = Math.max(o.throttle, rt); o.brake = Math.max(o.brake, lt); }
      if (p.buttons[0] && p.buttons[0].pressed) o.handbrake = true;
      const map = { 3: 'KeyC', 1: 'KeyR', 9: 'Enter', 8: 'Escape' };
      for (const b in map) { const down = p.buttons[b] && p.buttons[b].pressed; if (down && !this.padPrev[b]) this.hit.add(map[b]); this.padPrev[b] = down; }
      break;
    }
    return o;
  }
}
