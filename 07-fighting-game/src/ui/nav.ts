// 菜单的键盘输入：方向键或 WASD 移动光标，J / 回车确认，K / Esc 返回。
// 双人选人时 WASD + J/K 是一号位，方向键 + 二号位的轻/重击键是二号位。键位从 core/input 读。
import { KEYS_P1, KEYS_P2 } from '../core/input';

export type NavKind = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'pause';
export interface NavAct { kind: NavKind; pad: 0 | 1; code: string }
type Handler = (a: NavAct) => void;

const table = new Map<string, { kind: NavKind; pad: 0 | 1 }>();
const put = (codes: string[], kind: NavKind, pad: 0 | 1) => { for (const c of codes) if (!table.has(c)) table.set(c, { kind, pad }); };
// 通用键（Esc / 回车）最先放，保证它们的含义固定
put(['Escape'], 'back', 0); put(['Enter', 'NumpadEnter'], 'ok', 0); put(['Backspace'], 'back', 0);
put(KEYS_P1.up, 'up', 0); put(KEYS_P1.down, 'down', 0); put(KEYS_P1.left, 'left', 0); put(KEYS_P1.right, 'right', 0);
put(KEYS_P1.L, 'ok', 0); put(KEYS_P1.H, 'back', 0); put(['Space'], 'ok', 0);
put(KEYS_P2.up, 'up', 1); put(KEYS_P2.down, 'down', 1); put(KEYS_P2.left, 'left', 1); put(KEYS_P2.right, 'right', 1);
put(KEYS_P2.L, 'ok', 1); put(KEYS_P2.H, 'back', 1);

class Nav {
  private stack: Handler[] = [];
  /** 对战中：Esc / 回车 打开暂停 */
  onPause: (() => void) | null = null;
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && !e.code.startsWith('Arrow') && !/^Key[WASD]$/.test(e.code)) return;
      const top = this.stack[this.stack.length - 1];
      if (!top) {
        if (this.onPause && (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter')) { e.preventDefault(); this.onPause(); }
        return;
      }
      const m = table.get(e.code); if (!m) return;
      e.preventDefault();
      top({ kind: m.kind, pad: m.pad, code: e.code });
    });
  }
  push(h: Handler) { this.stack.push(h); return () => { const i = this.stack.lastIndexOf(h); if (i >= 0) this.stack.splice(i, 1); }; }
  get active() { return this.stack.length > 0; }
}
export const nav = new Nav();
