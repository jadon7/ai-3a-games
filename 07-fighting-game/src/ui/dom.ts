// 界面用的小工具：建 DOM、只在值变了时才写、Web Animations 的简写。

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function uiRoot(): HTMLElement {
  return document.getElementById('ui') ?? document.body;
}

/** 只在变了的时候写 transform / 文本 / 透明度，避免每帧都触碰 DOM */
const last = new WeakMap<HTMLElement, { t?: string; x?: string; o?: string }>();
function rec(el: HTMLElement) { let r = last.get(el); if (!r) { r = {}; last.set(el, r); } return r; }
export function setTf(el: HTMLElement, v: string) { const r = rec(el); if (r.t !== v) { r.t = v; el.style.transform = v; } }
export function setText(el: HTMLElement, v: string) { const r = rec(el); if (r.x !== v) { r.x = v; el.textContent = v; } }
export function setOp(el: HTMLElement, v: string) { const r = rec(el); if (r.o !== v) { r.o = v; el.style.opacity = v; } }
export function toggle(el: HTMLElement, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** 打击感的常用曲线 */
export const EASE = {
  out: 'cubic-bezier(.16,1,.3,1)',
  back: 'cubic-bezier(.34,1.56,.64,1)',
  in: 'cubic-bezier(.7,0,.84,0)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  lin: 'linear',
};

/** 多段关键帧时，曲线放到每一段上（整体曲线会把关键帧的时间点也扭曲掉） */
export function anim(el: Element, frames: Keyframe[], ms: number, opts: Partial<KeyframeAnimationOptions> = {}): Animation {
  const ease = (opts.easing as string | undefined) ?? EASE.out;
  if (frames.length > 2) {
    frames = frames.map((f) => (f.easing ? f : { ...f, easing: ease }));
    return el.animate(frames, { duration: ms, fill: 'both', ...opts, easing: 'linear' });
  }
  return el.animate(frames, { duration: ms, fill: 'both', ...opts, easing: ease });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 按键码转成界面上显示的字 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6);
  const map: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift',
    Comma: ',', Period: '.', Slash: '/', Enter: '回车', Escape: 'Esc', Backspace: '退格', Semicolon: ';', Quote: "'",
  };
  return map[code] ?? code;
}

export function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

export const ASSET = (n: string) => `${import.meta.env.BASE_URL}assets/ui/${n}`;
