// 回城的特效（第九轮）。照 LoL 回城的做法：
//   起手：脚下“叮”的一圈，法阵铺开；
//   读条中：脚下的法阵慢慢转、越来越亮；一圈光点从法阵边上往上飘，越到后面飘得越多、越快；身上隔一会儿升起一道光，一道比一道高、比一道亮；
//   到点：原地一道白光冲上去（起点那一下），人到了出生点，那边一道光落下来、一圈冲击（终点那一下）；
//   被打断：法阵很快熄掉，光点往下掉，像灯灭了。
// 时间都跟着回城的进度走（k 从 0 到 1），控制器（actor.ts）每帧报一次进度，回城的时长改了这里不用动。

import { SPR, type Decal, type FxLib } from "./fxlib";
import { FXB, deep } from "./fxb";

export interface RecallFx { tick: (dt: number, k: number, x: number, y: number, z: number) => void; cancel: () => void; leave: (x: number, z: number) => void; arrive: (x: number, z: number) => void; kill: (fade?: number) => void; }

/** seen：现在看不看得见这个英雄（对面的英雄在迷雾里回城，特效也不能露出来） */
export function recallFx(fx: FxLib, x: number, z: number, color0: number, scale = 1, seen: () => boolean = () => true): RecallFx {
  // 换画风 B（b-fx）：法阵的线原来是淡青白的叠加光，亮地面上看不见；B 下法阵的线、光柱的身子用英雄主色的深一档（颜色饱和、读得出形状），白光只留给最亮的那一下
  const color = FXB.on ? deep(color0, 0.5, 0.8) : color0, RUNE = FXB.on ? color : 0xcfeee8;
  const WHITE = 0xeafffb, R = 1.9 * scale, gy = () => fx.ground(x, z);
  const rune = fx.decal({ kind: "rune", x, z, r: R, life: 99, color: RUNE, color2: color, alpha: 0.5, add: true, fadeIn: 0.002, fadeOut: 0.0005, spin: 0.6 });
  const swirl = fx.decal({ kind: "swirl", x, z, r: R * 0.8, life: 99, color, color2: 0x0d2a30, alpha: 0.18, add: true, fadeIn: 0.002, fadeOut: 0.0005, spin: 1.5 });
  const pool: Decal = fx.decal({ kind: "disc", x, z, r: R * 0.9, life: 99, color, alpha: 0.08, add: true, fadeIn: 0.002, fadeOut: 0.0005 });
  if (seen()) fx.ring(x, z, R * 1.15, WHITE, 0.4); if (seen()) fx.burst({ pos: { x, y: gy() + 0.25, z }, n: 10, sprite: SPR.glint, add: true, ringR: R * 0.9, color: [WHITE, color], size: [0.12, 0.22], life: [0.3, 0.5], speed: 0.4, up: 1.2 });
  let acc = 0, pulse = 0.35, gone = false;
  const stopAll = (fade: number) => { if (gone) return; gone = true; rune.kill(fade); swirl.kill(fade); pool.kill(fade); };
  return {
    tick(dt, k) { if (gone) return; const e = k * k, v = seen() ? 1 : 0;
      rune.alpha?.((0.5 + 0.5 * e) * v); swirl.alpha?.((0.2 + 0.35 * e) * v); pool.alpha?.((0.06 + 0.16 * e) * v); if (!v) return;
      acc += dt * (14 + 40 * e);      // 光点：越到后面越密、飘得越快
      while (acc >= 1) { acc -= 1; fx.burst({ pos: { x, y: gy() + 0.15, z }, n: 1, sprite: SPR.glint, add: true, ringR: R * (0.55 + Math.random() * 0.4), color: [WHITE, color], alpha: 0.95, size: [0.16, 0.3], life: [0.6, 1.0], speed: 0.1, up: 2.2 + 4 * e, drag: 0.3 }); }
      if ((pulse -= dt) <= 0) { pulse = 0.55 - 0.25 * k;      // 身上升起的光：一道比一道高、比一道亮
        fx.column({ x, z, r: (0.8 + 0.3 * k) * scale, h: 2.6 + 6 * e, life: 0.8, color: WHITE, color2: color, kind: "light" }); }
    },
    cancel() { if (gone) return; stopAll(0.18); if (!seen()) return;      // 被打断：灯灭了
      fx.burst({ pos: { x, y: gy() + 1.2, z }, n: 10, sprite: SPR.ember, add: true, radius: 0.8, color: [WHITE, color], size: [0.08, 0.14], life: [0.3, 0.5], speed: [0.3, 1], gravity: 6 });
      fx.burst({ pos: { x, y: gy() + 0.3, z }, n: 3, sprite: SPR.smoke, color: [0x9aa6a8, 0x5d6668], alpha: 0.25, size: [0.7, 1.0], grow: 1.8, life: [0.5, 0.8], speed: 0.4, up: 0.6 }); },
    leave(lx, lz) { stopAll(0.25); if (!seen()) return;      // 起点那一下：一道白光冲上去
      const y = fx.ground(lx, lz);
      fx.flash({ x: lx, y: y + 1.6, z: lz }, WHITE, 3.2, 0.24, true);
      fx.column({ x: lx, z: lz, r: 1.15 * scale, h: 10, life: 0.55, color: WHITE, color2: color, kind: "light" });
      fx.ring(lx, lz, R * 1.5, WHITE, 0.45);
      fx.burst({ pos: { x: lx, y: y + 0.5, z: lz }, n: 18, sprite: SPR.glint, add: true, radius: 0.7, color: [WHITE, color], size: [0.14, 0.26], life: [0.4, 0.7], speed: [0.5, 1.5], up: 6, drag: 0.8 }); },
    arrive(ax, az) {      // 终点那一下：一道光落下来，一圈冲击
      if (!seen()) return; const y = fx.ground(ax, az);
      fx.column({ x: ax, z: az, r: 1.0 * scale, h: 7, life: 0.6, color: WHITE, color2: color, kind: "light" });
      fx.flash({ x: ax, y: y + 1.2, z: az }, color, 2.6, 0.22, false);
      fx.ring(ax, az, 2.6 * scale, WHITE, 0.5); fx.decal({ kind: "rune", x: ax, z: az, r: R, life: 0.8, color: RUNE, color2: color, alpha: 0.7, add: true, fadeIn: 0.03, fadeOut: 0.7, spin: 2 });
      fx.burst({ pos: { x: ax, y: y + 3.5, z: az }, n: 14, sprite: SPR.glint, add: true, radius: 0.8, color: [WHITE, color], size: [0.12, 0.22], life: [0.4, 0.7], speed: [1, 2.5], dir: { x: 0, y: -1, z: 0 }, spread: 0.5, drag: 1.2 }); },
    kill(fade = 0.2) { stopAll(fade); },
  };
}
