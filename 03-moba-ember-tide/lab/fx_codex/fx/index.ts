import type { Demo, FxHandle } from "../api";
import { afterimage, blink, finale, ignition, thread } from "./iti_r";
import { arrivalRim } from "./blade";
import { burst, marks, THIRD_HIT_DELAY } from "./iti_passive";
import { sat, vec } from "./paint";
// 在事件的世界时间切开 dt。30 帧录像和正常播放都能保留完整的 0.13 秒蓄力。
function sequence(live: FxHandle[], events: [
    number,
    () => void
][], end: number, onEnd?: () => void): FxHandle {
    let time = 0, next = 0;
    function advance(to: number) {
        const dt = to - time;
        time = to;
        for (let i = 0; i < live.length;) {
            const h = live[i];
            if (h.update(dt))
                i++;
            else {
                h.dispose();
                live.splice(i, 1);
            }
        }
    }
    return {
        update(dt) {
            const to = time + dt;
            while (next < events.length && events[next][0] <= to) {
                const [at, run] = events[next++];
                advance(at);
                run();
            }
            advance(to);
            return time < end;
        },
        dispose() { live.forEach(h => h.dispose()); onEnd?.(); }
    };
}
const r: Demo = {
    label: "R · 绯月千刃", duration: 2.25,
    run(ctx, cast, targets) {
        const origin = vec(0, ctx.ground(0, 0), 0), start = cast.obj.position.clone();
        const group: ReturnType<typeof thread>[] = [], live: FxHandle[] = [ignition(ctx, cast)];
        let previous = start, windup = 0;
        live.push({ update(dt) { windup += dt; cast.obj.scale.setScalar(1 - .18 * sat((windup - .055) / .035)); return windup < .09; }, dispose() { cast.obj.scale.setScalar(1); } });
        cast.play("r", { loop: false, fade: 0, speed: 1.7 });
        const events: [
            number,
            () => void
        ][] = [[.09, () => {
                    live.push(afterimage(ctx, cast, start, cast.obj.rotation.y, 0));
                    cast.setHide(1);
                }]];
        const order = [0, 1, 3, 2, 4, 5], angles = [-.78, 1.95, .30, -1.25, 2.74, .88];
        order.forEach((index, i) => events.push([.09 + i * .1195, () => {
                const target = targets[index], p = target.obj.position, a = angles[i], d = target.radius + .43;
                const landing = vec(p.x + Math.sin(a) * d, 0, p.z + Math.cos(a) * d);
                landing.y = ctx.ground(landing.x, landing.z);
                cast.setPos(landing.x, landing.z);
                cast.faceTo(p.x, p.z);
                const h = blink(ctx, cast, previous, landing, target, a, i);
                group.push(h);
                live.push(h);
                previous = landing;
            }]));
        events.push([.92, () => {
                const back = thread(ctx, previous, origin, false);
                live.push(back);
                group.forEach((h, i) => h.gather(i * .021, origin));
                group.push(back);
                cast.setPos(origin.x, origin.z);
                cast.setHide(0);
                cast.face(.68);
                cast.play("r_end", { loop: false, fade: 0, speed: 1.12 });
                live.push(arrivalRim(ctx, cast), finale(ctx, origin, () => {
                    group.forEach(h => h.ignite());
                    targets.forEach(a => a.hit(a.obj.position.distanceTo(origin) < 3 ? .76 : .36));
                }));
            }], [1.57, () => cast.play("idle", { fade: .14 })]);
        return sequence(live, events, 2.24, () => { cast.setHide(0); cast.obj.scale.setScalar(1); });
    }
};
const passive: Demo = {
    label: "被动 · 烬痕引爆", duration: 1.82,
    setup(_ctx, cast, targets) {
        targets.slice(1).forEach(t => { t.obj.visible = false; });
        targets[0].setPos(0, 0);
        cast.setPos(-2.1, .35);
        cast.faceTo(0, 0);
        targets[0].faceTo(-2.1, .35);
    },
    run(ctx, cast, targets) {
        const target = targets[0], mark = marks(ctx, target), live: FxHandle[] = [mark], events: [
            number,
            () => void
        ][] = [];
        for (let i = 0; i < 3; i++) {
            events.push([.035 + i * .42, () => cast.play(i % 2 ? "attack2" : "attack1", { loop: false, speed: 1.88, fade: .025 })], [.205 + i * .42, () => { mark.set(i + 1); target.hit(i === 2 ? .85 : .68); }]);
        }
        events.push([.205 + 2 * .42 + THIRD_HIT_DELAY, () => live.push(burst(ctx, target))], [1.51, () => cast.play("idle", { fade: .13 })]);
        return sequence(live, events, 1.81);
    }
};
export const DEMOS: Record<string, Demo> = { r, passive };
