// 一局结束的演出（第九轮）：水晶炸开的那一刻到结算界面出来之前的三秒多。
//   · 慢动作：对局时间先降到两成多（水晶连着炸的三下被拉长，看得清），最后半秒回到正常速度；
//   · 镜头：主程序本来就会移到被打爆的水晶上，这里再给一个“推近”的距离；
//   · 光：胜利是一道金白的光柱从水晶的废墟上冲起来，光点往上飘，画面四周泛一层暖光；
//         失败是水晶的残光往下沉、一圈暗下去，画面慢慢褪色、压暗（情绪是往下走的）；
//   · 大字：胜利是金色的字从宽的字距收拢、一道光扫过去；失败是灰红的字从上面重重落下、抖一下，下面一条暗带。
// 演完调 onDone，主程序在那里出结算界面（结算界面本身在 lobby.ts，不归这里管）。
// 时间都按真实的秒算（慢动作不影响演出本身的节奏）；特效库里的东西按对局时间走，所以在慢动作里会被拉长，这正是要的。

import { SPR, type FxLib } from "./fxlib";
import { FXB } from "./fxb";

export interface Ending { update: (realDt: number) => void; timeScale: () => number; zoom: () => number; done: () => boolean; }

const CSS = `
.r9end{position:fixed;inset:0;z-index:40;pointer-events:none;display:grid;place-items:center;font-family:"PingFang SC","Avenir Next",system-ui,sans-serif}
.r9end .glow{position:absolute;inset:0;opacity:0;transition:opacity 1.2s ease}
.r9end.win .glow{background:radial-gradient(ellipse at 50% 46%,rgba(255,214,140,.0) 30%,rgba(255,190,90,.16) 70%,rgba(80,50,10,.28) 100%)}
.r9end.lose .glow{background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 25%,rgba(4,6,10,.55) 100%)}
.r9end.on .glow{opacity:1}
.r9end .box{position:relative;display:grid;justify-items:center;gap:10px;transform:translateY(-6vh)}
.r9end .band{position:absolute;left:50%;top:50%;width:120vw;height:clamp(110px,22vh,210px);transform:translate(-50%,-56%) scaleY(0);opacity:0;transition:transform .5s cubic-bezier(.2,.9,.2,1),opacity .5s}
.r9end.win .band{background:linear-gradient(90deg,rgba(40,24,4,0),rgba(40,26,6,.55) 30%,rgba(40,26,6,.55) 70%,rgba(40,24,4,0))}
.r9end.lose .band{background:linear-gradient(90deg,rgba(6,6,8,0),rgba(8,8,10,.72) 28%,rgba(8,8,10,.72) 72%,rgba(6,6,8,0))}
.r9end.on .band{transform:translate(-50%,-56%) scaleY(1);opacity:1}
.r9end .t{position:relative;font-weight:900;font-size:clamp(64px,13vh,150px);line-height:1;letter-spacing:.5em;padding-left:.5em;opacity:0;-webkit-background-clip:text;background-clip:text;color:transparent}
.r9end.win .t{background-image:linear-gradient(180deg,#fff8e4 0%,#ffe2a0 38%,#e9b55a 62%,#a86c22 100%);filter:drop-shadow(0 3px 0 rgba(40,20,0,.55)) drop-shadow(0 0 18px rgba(255,190,90,.35));transform:scale(1.25)}
.r9end.lose .t{background-image:linear-gradient(180deg,#e9e4e0 0%,#b9aaa5 45%,#8a6560 70%,#4d2f2c 100%);filter:drop-shadow(0 4px 0 rgba(0,0,0,.7));transform:translateY(-40px) scale(1.12)}
.r9end.on.win .t{animation:r9win 1.1s cubic-bezier(.16,.84,.3,1) forwards}
.r9end.on.lose .t{animation:r9lose .55s cubic-bezier(.55,0,.75,.2) forwards,r9shake .32s .55s linear}
.r9end .t i{position:absolute;inset:0;padding-left:.5em;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.9) 50%,transparent 65%);background-size:250% 100%;background-position:120% 0;-webkit-background-clip:text;background-clip:text;color:transparent;font-style:normal}
.r9end.on.win .t i{animation:r9sweep 1.2s .6s ease-in-out forwards}
.r9end .s{font-weight:600;font-size:clamp(14px,2.4vh,22px);letter-spacing:.6em;padding-left:.6em;opacity:0;transition:opacity .6s .7s}
.r9end.win .s{color:#f3dcae}.r9end.lose .s{color:#a8a19d}
.r9end.on .s{opacity:1}
.r9end .ln{position:absolute;top:50%;height:2px;width:0;transition:width .9s .35s cubic-bezier(.2,.9,.2,1)}
.r9end.win .ln{background:linear-gradient(90deg,rgba(255,220,150,0),#ffd98a)}.r9end.lose .ln{background:linear-gradient(90deg,rgba(150,110,100,0),#8b6a63)}
.r9end .ln.l{right:calc(50% + 2.6em)}.r9end .ln.r{left:calc(50% + 2.6em);transform:scaleX(-1)}
.r9end.on .ln{width:22vw}
.r9end.out{opacity:0;transition:opacity .45s}
@keyframes r9win{0%{opacity:0;letter-spacing:1.1em;transform:scale(1.25)}35%{opacity:1}100%{opacity:1;letter-spacing:.32em;transform:scale(1)}}
@keyframes r9lose{0%{opacity:0;transform:translateY(-40px) scale(1.12)}100%{opacity:1;transform:translateY(0) scale(1)}}
@keyframes r9shake{0%,100%{transform:translate(0,0)}25%{transform:translate(-5px,3px)}50%{transform:translate(4px,-2px)}75%{transform:translate(-2px,1px)}}
@keyframes r9sweep{to{background-position:-60% 0}}
`;

/** win：true 胜利、false 失败、null 观战（按获胜那一方的颜色演胜利的那一套，字写“对局结束”）。color 是获胜一方的阵营色 */
export function createEnding(o: { fxl: FxLib; win: boolean | null; x: number; z: number; color: number; sub: string; dom: boolean; canvas?: HTMLElement; onDone: () => void }): Ending {
  const { fxl: f, x, z } = o, happy = o.win !== false, gy = f.ground(x, z), GOLD = 0xffe2a0, WHITE = 0xfff8e6;
  let t = 0, finished = false, el: HTMLDivElement | null = null; const beats = new Set<string>();
  const once = (k: string, at: number, fn: () => void) => { if (t >= at && !beats.has(k)) { beats.add(k); fn(); } };
  if (o.dom) {
    if (!document.getElementById("r9end-css")) { const st = document.createElement("style"); st.id = "r9end-css"; st.textContent = CSS; document.head.appendChild(st); }
    const title = o.win === null ? "对局结束" : o.win ? "胜利" : "失败";
    el = document.createElement("div"); el.className = "r9end " + (happy ? "win" : "lose");
    el.innerHTML = `<div class="glow"></div><div class="band"></div><div class="box"><div class="ln l"></div><div class="ln r"></div><div class="t">${title}<i>${title}</i></div><div class="s">${o.sub}</div></div>`;
    document.body.appendChild(el);
  }
  return {
    update(dt) {
      t += dt;
      // 光（对局时间在慢动作里，下面写的寿命会被拉长四五倍）
      once("light", 0.3, () => {
        if (happy) { f.column({ x, z, r: 3.4, h: 34, life: 1.4, color: GOLD, color2: o.color, kind: "light" }); f.column({ x, z, r: 1.4, h: 40, life: 1.1, color: 0xffffff, color2: GOLD, kind: "light" });      // 亮只在中间一根细的；外面一层是淡的（不满屏泛光）
          f.flash({ x, y: gy + 4, z }, WHITE, 8, 0.5, true); f.ring(x, z, 26, GOLD, 1.4);
          f.burst({ pos: { x, y: gy + 1, z }, n: 60, sprite: SPR.glint, add: true, radius: 6, color: [0xffffff, GOLD], size: [0.25, 0.55], life: [1.2, 2.2], speed: [1, 3], up: 7, drag: 0.5 }); }
        else { f.flash({ x, y: gy + 3, z }, o.color, 10, 0.5, true); f.ring(x, z, 18, 0x6b6460, 1.6, false);
          f.decal({ kind: "dark", x, z, r: 16, life: 6, color: FXB.on ? 0x1a2433 : 0x07080a, color2: FXB.on ? 0x2c3646 : 0x15171b, alpha: FXB.on ? 0.5 : 0.6, fadeIn: 0.15, fadeOut: 0.2 });      /* 换画风 B：亮地面上一片纯黑像开了个洞，换成偏冷的暗蓝灰（暗下去的天色） */
          f.burst({ pos: { x, y: gy + 7, z }, n: 50, sprite: SPR.ember, add: true, radius: 5, color: [o.color, 0x3a2a26], size: [0.12, 0.26], life: [1.6, 2.6], speed: [0.2, 0.8], gravity: 1.6, drag: 0.6 });      // 残光往下沉
          f.burst({ pos: { x, y: gy + 2, z }, n: 16, sprite: SPR.smoke, color: [0x2a2a2c, 0x0e0f11], alpha: [0.3, 0.5], radius: 4, size: [2.5, 4], grow: 2, life: [2, 3], speed: [0.2, 0.8], up: 0.5, drag: 0.6 }); }
      });
      if (happy) once("rise", 1.2, () => f.burst({ pos: { x, y: gy + 0.5, z }, n: 40, sprite: SPR.glint, add: true, radius: 9, color: [0xffffff, GOLD], size: [0.2, 0.4], life: [1.2, 2], speed: 0.3, up: 5, drag: 0.4 }));
      once("text", 0.55, () => { el?.classList.add("on"); if (!happy && o.canvas) { o.canvas.style.transition = "filter 1.6s ease"; o.canvas.style.filter = "saturate(0.35) brightness(0.72)"; } });
      once("out", 3.45, () => el?.classList.add("out"));
      once("done", 3.75, () => { finished = true; el?.remove(); el = null; o.onDone(); });
    },
    // 慢动作：0.3 秒里降到 0.22，保持到 2.3 秒，再用 0.6 秒回到 1
    timeScale() { const sm = (a: number) => { const k = Math.max(0, Math.min(1, a)); return k * k * (3 - 2 * k); }; return t < 0.3 ? 1 - 0.78 * sm(t / 0.3) : t < 2.3 ? 0.22 : 0.22 + 0.78 * sm((t - 2.3) / 0.6); },
    zoom() { const k = Math.min(1, t / 1.6); return 1 - 0.32 * (1 - (1 - k) * (1 - k)); },      // 镜头推近到原来的七成
    done: () => finished,
  };
}
