// 手机上跑游戏要处理的几件杂事（阶段 8）：
//   · 竖着拿：盖一层“请把手机横过来”，对局暂停（主程序每帧问 blocked()）
//   · 浏览器自己的手势（双击放大、捏合缩放整页、长按弹菜单）全部关掉，留给游戏
//   · 全屏：安卓上第一次点屏幕时进全屏并锁成横屏；苹果的浏览器不给网页全屏，只能“添加到主屏幕”（主菜单上有一句提示）
//   · 离线缓存（service worker）：只在打包以后的版本里注册；进了对局以后让它在后台把这一档剩下的资源补齐
import { IOS, LITE, STANDALONE, TOUCH } from "../quality";

const CSS = `
.rot{position:fixed;inset:0;z-index:60;display:none;place-items:center;background:radial-gradient(ellipse 80% 70% at 50% 42%,#1f4686,#0b1d44 72%);color:#eef4fb;font:600 16px/1.7 "Avenir Next","PingFang SC",system-ui,sans-serif;text-align:center;letter-spacing:.12em}
.rot svg{width:84px;height:84px;margin-bottom:14px;animation:rotturn 2.4s ease-in-out infinite}
.rot small{display:block;margin-top:6px;font-weight:500;font-size:12.5px;color:#9fb3cf;letter-spacing:.06em}
@keyframes rotturn{0%,20%{transform:rotate(0)}55%,100%{transform:rotate(-90deg)}}
@media (orientation:portrait) and (pointer:coarse){.rot{display:grid}}
.rot.force{display:grid}
`;

/** 现在是不是竖着拿的（盖着提示，对局要暂停） */
export const blocked = () => TOUCH && innerHeight > innerWidth * 1.02;

let installEvt: any = null; const installWaiters: (() => void)[] = [];
/** 安卓和电脑的 Chrome 能直接弹“安装”：浏览器说可以装了才返回真。cb 在可以装的时候调一次 */
export const canInstall = (cb?: () => void) => { if (cb && !installEvt) installWaiters.push(cb); return !!installEvt; };
export const install = async () => { if (!installEvt) return false; installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; return r?.outcome === "accepted"; };
/** 主菜单底下那句提示：苹果的手机上教人“添加到主屏幕”；已经装了或者不是手机就不说 */
export const installHint = () => (TOUCH && IOS && !STANDALONE ? "想全屏玩：点浏览器的“分享”，选“添加到主屏幕”，再从主屏幕打开。" : "");

export function toggleFullscreen(): void {
  const d = document as any, el = document.documentElement as any;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
  else Promise.resolve((el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el, { navigationUI: "hide" })).then(() => (screen.orientation as any)?.lock?.("landscape")).catch(() => { /* 不给全屏就算了 */ });
}
export const canFullscreen = () => !!(document.fullscreenEnabled || (document as any).webkitFullscreenEnabled) && !(IOS && TOUCH && /iPhone|iPod/.test(navigator.userAgent));

export function initMobile(inMatch: boolean): void {
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; for (const w of installWaiters.splice(0)) w(); });
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    const reg = () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* 装不上不影响玩 */ }); };
    if (document.readyState === "complete") reg(); else addEventListener("load", reg);      // 这里跑到的时候页面的 load 可能已经过了（2026-11-20 离线测试查出来的：只挂 load 有时就没注册上）
    if (inMatch) setTimeout(() => { navigator.serviceWorker.ready.then(r => r.active?.postMessage({ type: "warm", lite: LITE })).catch(() => { /* 同上 */ }); }, 15000);
  }
  if (!TOUCH) return;
  const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  const rot = document.createElement("div"); rot.className = "rot";
  rot.innerHTML = `<div><svg viewBox="0 0 64 64" fill="none" stroke="#8fe6de" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="20" y="8" width="24" height="48" rx="4"/><path d="M29 49h6"/></svg><div>请把手机横过来</div><small>《烬与潮》要横屏玩</small></div>`;
  document.body.appendChild(rot);
  for (const t of ["gesturestart", "gesturechange", "dblclick"]) document.addEventListener(t, e => e.preventDefault(), { passive: false });
  document.addEventListener("contextmenu", e => e.preventDefault());
  // 安卓：第一次点屏幕时进全屏、锁横屏（已经是从主屏幕打开的就不用了）
  if (inMatch && !IOS && !STANDALONE && canFullscreen()) addEventListener("pointerup", () => { if (!document.fullscreenElement) toggleFullscreen(); }, { once: true });
}
