// 画质档位和设备（阶段 8）。手机和平板是“轻”的一档：贴图小一号、阴影小一号、分辨率跟着帧率自己降。
//   ?q=lite | full     强制用哪一档（测试用）
//   ?touch=1 | 0       强制开或者关触屏操作（测试用）
// 档位只在这里判断一次，别处都从这里拿。

const p = new URLSearchParams(location.search);
// 测试用的强制开关写在网址里；从主菜单进对局会换网址，所以顺手记在这个标签页里，换了网址还管用
for (const k of ["q", "touch"]) { try { if (p.has(k)) sessionStorage.setItem("moba_" + k, p.get(k)!); else { const v = sessionStorage.getItem("moba_" + k); if (v != null) p.set(k, v); } } catch { /* 不让用 sessionStorage 就算了 */ } }
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** 触屏操作（摇杆和技能键）开不开：主要的指点设备是手指 */
export const TOUCH = p.has("touch") ? p.get("touch") !== "0" : coarse && navigator.maxTouchPoints > 0;
/** 轻的一档：手机、平板 */
export const LITE = p.has("q") ? p.get("q") === "lite" : TOUCH;
/** 苹果的手机和平板（全屏只能靠“添加到主屏幕”） */
export const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** 已经是从主屏幕打开的（没有浏览器的地址栏） */
export const STANDALONE = (typeof matchMedia === "function" && (matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches)) || (navigator as any).standalone === true;

/** 英雄、小兵、野怪模型的地址。轻的一档在 m/ 子目录里（tools/pack_assets.sh 生成，贴图小一号） */
export const glb = (dir: "hero" | "unit", name: string) => `/assets/${dir}/${LITE ? "m/" : ""}${name}.glb`;

/** 载入一个 .glb。打包以后的版本里每个模型旁边还有一份 gzip 压过的（.glbz，打包时生成，小四成左右），浏览器会解压就用它；
 *  开发时、或者浏览器不会解压（很老的 Safari）、或者那一份拿不到，就用原来的 .glb。
 *  扩展名不用 .gz：有的服务器看到 .gz 会自作主张加上 Content-Encoding，浏览器先解了一遍，这边再解就错了。拿到以后还是看一眼开头两个字节再决定解不解 */
export async function loadGLB<T>(loader: { loadAsync: (url: string) => Promise<T>; parseAsync: (data: ArrayBuffer, path: string) => Promise<T>; manager: { itemStart: (u: string) => void; itemEnd: (u: string) => void } }, url: string): Promise<T> {
  if (import.meta.env.PROD && typeof DecompressionStream === "function") {
    loader.manager.itemStart(url);
    try {
      const r = await fetch(url + "z");
      if (r.ok) { let buf = await r.arrayBuffer(); const b = new Uint8Array(buf, 0, 4);
        if (b[0] === 0x1f && b[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        if (new Uint8Array(buf, 0, 4)[0] === 0x67) { const g = await loader.parseAsync(buf, ""); loader.manager.itemEnd(url); return g; } }      // 0x67 是 "glTF" 的 g
    } catch { /* 拿不到或者解不开：走下面原来的路 */ }
    loader.manager.itemEnd(url);
  }
  return loader.loadAsync(url);
}
