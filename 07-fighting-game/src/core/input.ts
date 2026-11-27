import type { Cmd, InputSource } from '../combat/types';
import { emptyCmd } from '../combat/types';

export interface KeyMap { left: string[]; right: string[]; up: string[]; down: string[]; L: string[]; H: string[]; S: string[]; G: string[]; T: string[]; U: string[]; D: string[] }

export const KEYS_P1: KeyMap = {
  left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
  L: ['KeyJ'], H: ['KeyK'], S: ['KeyL'], G: ['KeyU', 'Space'], T: ['KeyI'], U: ['KeyO'], D: ['ShiftLeft'],
};
export const KEYS_P2: KeyMap = {
  left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
  L: ['Numpad1', 'Comma'], H: ['Numpad2', 'Period'], S: ['Numpad3', 'Slash'], G: ['Numpad4', 'KeyM'], T: ['Numpad5', 'KeyN'], U: ['Numpad6', 'KeyB'], D: ['Numpad0', 'ShiftRight'],
};
/** 单人模式：方向键也能控制一号位 */
export const KEYS_SOLO: KeyMap = {
  ...KEYS_P1,
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
};

export class Keyboard {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Slash') e.preventDefault();
      if (!e.repeat) { this.down.add(e.code); this.pressed.add(e.code); }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  any(codes: string[]) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  /** 这一帧有没有新按下（界面用，读完清掉） */
  consume(code: string) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  consumeAny(codes: string[]) { let h = false; for (const c of codes) if (this.consume(c)) h = true; return h; }
  flush() { this.pressed.clear(); }
}

export class KeyboardSource implements InputSource {
  constructor(private kb: Keyboard, private map: KeyMap, private pad = -1) {}
  poll(): Cmd {
    const k = this.kb, m = this.map;
    const c = emptyCmd();
    c.x = (k.any(m.right) ? 1 : 0) - (k.any(m.left) ? 1 : 0);
    c.y = (k.any(m.up) ? 1 : 0) - (k.any(m.down) ? 1 : 0);
    c.L = k.any(m.L); c.H = k.any(m.H); c.S = k.any(m.S); c.G = k.any(m.G); c.T = k.any(m.T); c.U = k.any(m.U); c.D = k.any(m.D);
    if (this.pad >= 0) mergePad(c, this.pad);
    return c;
  }
}

/** 标准手柄布局：十字键 / 左摇杆移动，X 轻、Y 重、B 技，RB 防御，LB 投，RT 冲刺，LT 大招。 */
function mergePad(c: Cmd, index: number) {
  const gp = navigator.getGamepads?.()[index];
  if (!gp) return;
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
  if (b(14) || ax < -0.45) c.x = -1; if (b(15) || ax > 0.45) c.x = 1;
  if (b(12) || ay < -0.6) c.y = 1; if (b(13) || ay > 0.6) c.y = -1;
  c.L ||= b(2); c.H ||= b(3); c.S ||= b(1); c.G ||= b(5); c.T ||= b(4); c.D ||= b(7); c.U ||= b(6);
  if (b(0)) c.y = 1;
}

/** 不动的木桩（训练、调试用） */
export class DummySource implements InputSource {
  cmd = emptyCmd();
  poll(): Cmd { return this.cmd; }
}
