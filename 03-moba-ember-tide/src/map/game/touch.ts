// 触屏操作（阶段 8）。布局照手机 MOBA 的行业习惯（王者荣耀、LoL 手游）：
//   · 左下：摇杆。手指落在左下那一片的哪里，摇杆的底盘就出现在哪里；推着走，松手停。
//   · 右下：大的是攻击键（按一下打最合适的一个，按住一直打）；技能键绕着它排成一段弧。
//     技能键点一下：自动对准最合适的目标放出去。按住拖动：地上出指示，朝拖的方向瞄，松手放；拖到右上角的“取消”圈里松手就不放。
//   · 点地面还是能走、点敌人还是能打（和鼠标一样）；两根手指捏合缩放。
// 这里只管手指怎么变成命令；按钮长什么样、摆在哪在 hud.ts 的样式里。

import type { Play } from "./play";
import type { SkillKey } from "./skills";

export interface Touch { update: (dt: number) => void; }

export function bindTouch(o: { play: Play; yaw: () => number; skills: { key: SkillKey; el: HTMLElement }[]; atk: HTMLElement; stick: HTMLElement; cancel: HTMLElement }): Touch {
  const { play } = o;
  /** 屏幕上的方向（右、下为正）转成地面上的方向：跟着镜头的朝向转 */
  const toWorld = (sx: number, sy: number): [number, number] => { const y = o.yaw(), c = Math.cos(y), s = Math.sin(y); return [sx * c + sy * s, -sx * s + sy * c]; };
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  const buzz = (ms: number) => { try { (navigator as any).vibrate?.(ms); } catch { /* 不支持就算了 */ } };

  // ---- 摇杆 ----
  const base = o.stick.querySelector(".base") as HTMLElement, knob = o.stick.querySelector(".knob") as HTMLElement;
  let sid = -1, sx0 = 0, sy0 = 0;
  const moveStick = (e: PointerEvent) => {
    if (e.pointerId !== sid) return; const R = base.offsetWidth * 0.5; let dx = e.clientX - sx0, dy = e.clientY - sy0; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    if (l < R * 0.2) play.stick(0, 0); else { const [vx, vz] = toWorld(dx / R, dy / R); play.stick(vx, vz); }
  };
  const endStick = (e: PointerEvent) => { if (e.pointerId !== sid) return; sid = -1; play.stick(0, 0); knob.style.transform = ""; base.style.left = base.style.top = ""; o.stick.classList.remove("on"); };
  o.stick.addEventListener("pointerdown", e => {
    stop(e); if (sid >= 0) return; sid = e.pointerId; try { o.stick.setPointerCapture(sid); } catch { /* 合成的事件没有真的指针 */ }
    const r = o.stick.getBoundingClientRect(), R = base.offsetWidth * 0.5;
    sx0 = Math.min(Math.max(e.clientX, r.left + R * 0.75), r.right - R * 0.4); sy0 = Math.min(Math.max(e.clientY, r.top + R * 0.6), r.bottom - R * 0.75);
    base.style.left = `${sx0 - r.left}px`; base.style.top = `${sy0 - r.top}px`; o.stick.classList.add("on"); moveStick(e);
  });
  o.stick.addEventListener("pointermove", moveStick); o.stick.addEventListener("pointerup", endStick); o.stick.addEventListener("pointercancel", endStick);

  // ---- 技能键 ----
  let aim: { id: number; x0: number; y0: number; moved: boolean; el: HTMLElement } | null = null;
  const overCancel = (e: PointerEvent) => { const r = o.cancel.getBoundingClientRect(), pad = r.width * 0.25; return e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad; };
  const endAim = (e: PointerEvent, fire: boolean) => { if (!aim || e.pointerId !== aim.id) return; const ok = play.aimEnd(fire && !overCancel(e)); if (ok) buzz(8); aim.el.classList.remove("hold"); aim = null; o.cancel.hidden = true; o.cancel.classList.remove("hot"); };
  for (const { key, el } of o.skills) {
    el.addEventListener("pointerdown", e => {
      stop(e); if (aim) return; const r = play.aimBegin(key);
      if (r === "cast") { buzz(8); return; } if (r !== "aim") return;
      aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, el }; try { el.setPointerCapture(e.pointerId); } catch { /* 同上 */ }
      el.classList.add("hold"); o.cancel.hidden = false;
    });
    el.addEventListener("pointermove", e => {
      if (!aim || e.pointerId !== aim.id) return; const dx = e.clientX - aim.x0, dy = e.clientY - aim.y0, l = Math.hypot(dx, dy), R = o.atk.offsetWidth * 0.95;
      if (!aim.moved && l < 9) return; aim.moved = true;      // 手指没怎么动：还是自动对准的那个目标
      const [vx, vz] = toWorld(dx, dy); play.aimDrag(vx, vz, Math.min(1, l / R)); o.cancel.classList.toggle("hot", overCancel(e));
    });
    el.addEventListener("pointerup", e => endAim(e, true)); el.addEventListener("pointercancel", e => endAim(e, false));
    el.addEventListener("click", stop);
  }

  // ---- 攻击键：按一下打一个，按住一直打 ----
  let held = false, holdT = 0;
  o.atk.addEventListener("pointerdown", e => { stop(e); held = true; holdT = 0; o.atk.classList.add("hold"); try { o.atk.setPointerCapture(e.pointerId); } catch { /* 同上 */ } if (play.attackNear()) buzz(5); });
  const up = () => { held = false; o.atk.classList.remove("hold"); };
  o.atk.addEventListener("pointerup", up); o.atk.addEventListener("pointercancel", up); o.atk.addEventListener("click", stop);

  return { update(dt) { if (held && (holdT += dt) > 0.3) { holdT = 0; play.attackNear(); } } };
}
