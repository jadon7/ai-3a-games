// 键鼠输入 + 指针锁定；触屏设备上由 ui/touch.js 的虚拟摇杆和按钮往这里灌输入（不锁指针）
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.hits = new Set();
    this.ups = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    this.forceLocked = false;     // 自动化测试用
    this.soft = false;            // 环境不支持指针锁定时的兼容模式（鼠标移动 + 屏幕边缘转向）
    this.mx = 0.5; this.my = 0.5;
    this.enabled = true;
    this.onLockChange = null;
    this.touchMode = false;       // 触屏操控：lock() 不去锁指针，只打开 touchLock
    this.touchLock = false;
    this.axis = null;             // 虚拟摇杆按着的时候是 { f, s }（模拟量，前后 / 左右），松开为 null

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this.active && e.code !== 'F5' && e.code !== 'F12') e.preventDefault(); return; }
      this.keys.add(e.code); this.hits.add(e.code);
      if (this.active && !['F5', 'F11', 'F12'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); this.ups.add(e.code); });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousedown', (e) => { if (!this.active || this.touchLock) return; const c = 'Mouse' + e.button; this.keys.add(c); this.hits.add(c); e.preventDefault(); });
    window.addEventListener('mouseup', (e) => { const c = 'Mouse' + e.button; this.keys.delete(c); this.ups.add(c); });
    window.addEventListener('mousemove', (e) => { if (this.locked || this.soft) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; } this.mx = e.clientX / window.innerWidth; this.my = e.clientY / window.innerHeight; });
    window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.soft) { this.soft = false; this.keys.clear(); if (this.onLockChange) this.onLockChange(false); } });
    window.addEventListener('wheel', (e) => { if (this.active) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.everLocked = true;
      if (!this.locked) this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  get active() { return (this.locked || this.forceLocked || this.soft || this.touchLock) && this.enabled; }
  get engaged() { return this.locked || this.soft || this.touchLock; }
  lock() {
    if (this.touchMode) { this.touchLock = true; if (this.onLockChange) this.onLockChange(true); return; }
    if (this.soft) { if (this.onLockChange) this.onLockChange(true); return; }
    // 只有从未成功锁定过（说明环境本身不支持）才进入兼容模式；真实浏览器里按 Esc 后立刻重锁会短暂失败，不应降级
    const fallback = () => { if (this.locked || this.everLocked) return; this.soft = true; if (this.onLockChange) this.onLockChange(true); };
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(fallback); } catch (e) { fallback(); } };
    try { const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else fallback(); }); } catch (e) { plain(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); if (this.soft) { this.soft = false; this.keys.clear(); } if (this.touchLock) { this.touchLock = false; this.keys.clear(); this.axis = null; } }
  // 触屏上的「暂停」：相当于键鼠模式下按 Esc 丢掉指针锁定
  pause() { if (!this.touchLock) return; this.touchLock = false; this.keys.clear(); this.axis = null; if (this.onLockChange) this.onLockChange(false); }
  // 兼容模式：鼠标靠近屏幕左右/上下边缘时持续转向
  update(dt) {
    if (!this.soft) return;
    const e = 0.14; let ex = 0, ey = 0;
    if (this.mx < e) ex = -(1 - this.mx / e); else if (this.mx > 1 - e) ex = (this.mx - (1 - e)) / e;
    if (this.my < e) ey = -(1 - this.my / e); else if (this.my > 1 - e) ey = (this.my - (1 - e)) / e;
    this.dx += ex * 1100 * dt; this.dy += ey * 500 * dt;
  }
  down(c) {
    if (!this.active) return false;
    const a = this.axis; if (a && ((c === 'KeyW' && a.f > 0.3) || (c === 'KeyS' && a.f < -0.3) || (c === 'KeyD' && a.s > 0.3) || (c === 'KeyA' && a.s < -0.3))) return true;
    return this.keys.has(c);
  }
  hit(c) { return this.active && this.hits.has(c); }
  up(c) { return this.ups.has(c); }
  anyDown(...cs) { for (const c of cs) if (this.down(c)) return true; return false; }
  anyHit(...cs) { for (const c of cs) if (this.hit(c)) return true; return false; }
  endFrame() { this.hits.clear(); this.ups.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; }
  // —— 测试辅助 ——
  sim(code, isDown) { if (isDown) { if (!this.keys.has(code)) this.hits.add(code); this.keys.add(code); } else { this.keys.delete(code); this.ups.add(code); } }
  tap(code) { this.hits.add(code); }
}
