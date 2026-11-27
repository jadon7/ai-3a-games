// 舞台布局：整个画面（画布 + 界面 + 触屏按钮）都装在 #stage 里。
//   · 触屏设备竖着拿时，把舞台整体旋转 90°，所以不管横屏竖屏，画面始终按横屏显示
//   · 屏幕矮（手机）时按比例缩小 HUD 和菜单，尺寸写进 CSS 变量：--ui（HUD 缩放）、--um（菜单缩放）、--tu（触屏按钮缩放）
//   · --svw / --svh：舞台宽高的 1%（旋转后浏览器自己的 vw / vh 不再对应画面方向，样式里一律用这两个）
const Q = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
// 触屏设备：主指针是手指，或者是带触摸点的手机 / 平板。?touch=1 / ?touch=0 可以强制开关（调试用）
export const TOUCH_DEVICE = Q.has('touch') ? Q.get('touch') !== '0' : (coarse || ((navigator.maxTouchPoints || 0) > 0 && /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)));
export const IS_IOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
export const STANDALONE = !!((window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone);

export const VIEW = { w: window.innerWidth, h: window.innerHeight, rot: false, touch: TOUCH_DEVICE, ui: 1, um: 1, tu: 1 };
const subs = []; let stage = null;
export const onViewChange = (fn) => { subs.push(fn); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function layoutView() {
  if (!stage) return;
  const W = window.innerWidth, H = window.innerHeight; if (!W || !H) return;
  const rot = VIEW.touch && H > W;
  const w = rot ? H : W, h = rot ? W : H;
  // 手机横屏高度只有 360–430 个 CSS 像素：HUD 按 660 高的版面缩小，菜单按 470 高的紧凑版面缩小，按钮跟手指走、不随界面缩
  const ui = clamp(h / 660, 0.6, 1), um = VIEW.touch ? clamp(h / 470, 0.72, 1) : clamp(h / 640, 0.6, 1), tu = clamp(h / 390, 0.86, 1.3);
  const s = stage.style;
  s.width = w + 'px'; s.height = h + 'px'; s.transform = rot ? `translateX(${W}px) rotate(90deg)` : 'none';
  s.setProperty('--svw', (w / 100) + 'px'); s.setProperty('--svh', (h / 100) + 'px'); s.setProperty('--ui', ui.toFixed(4)); s.setProperty('--um', um.toFixed(4)); s.setProperty('--tu', tu.toFixed(4));
  const root = document.documentElement; root.classList.toggle('rot', rot); root.classList.toggle('touch', VIEW.touch);
  const changed = VIEW.w !== w || VIEW.h !== h || VIEW.rot !== rot || VIEW.ui !== ui;
  VIEW.w = w; VIEW.h = h; VIEW.rot = rot; VIEW.ui = ui; VIEW.um = um; VIEW.tu = tu;
  if (changed) for (const fn of subs) fn(VIEW);
}

export function initView(el) {
  stage = el; layoutView();
  window.addEventListener('resize', layoutView);
  // 转屏时有的浏览器先发事件、后更新视口尺寸：稍后再量两次
  window.addEventListener('orientationchange', () => { layoutView(); setTimeout(layoutView, 120); setTimeout(layoutView, 500); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layoutView);
  document.addEventListener('fullscreenchange', () => { layoutView(); setTimeout(layoutView, 200); });
}
export function setTouchMode(on) { if (VIEW.touch === on) return; VIEW.touch = on; layoutView(); }

// 指针事件的屏幕坐标 → 舞台坐标（舞台旋转后两者不一致）
export function toStage(e, out = {}) { if (VIEW.rot) { out.x = e.clientY; out.y = window.innerWidth - e.clientX; } else { out.x = e.clientX; out.y = e.clientY; } return out; }
