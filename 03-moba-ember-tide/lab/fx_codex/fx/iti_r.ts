import * as THREE from "three";
import type { FxCtx, FxHandle, LabActor } from "../api";
import { brush, faceCamera, groundPlane, out, piece, ring, sizeRing, stain, sat, star, timed, vec } from "./paint";
import { blade, echo, edgeChips } from "./blade";
export function ignition(ctx: FxCtx, actor: LabActor) {
    const g = new THREE.Group(), lights = [star(ctx), star(ctx)];
    const base = vec(), tip = vec();
    lights.forEach(s => g.add(s.m));
    return timed(ctx, g, .12, t => {
        lights.forEach((s, i) => {
            s.m.visible = actor.obj.visible && actor.hero.blade(i ? "R" : "L", base, tip);
            s.m.position.lerpVectors(base, tip, .84);
            s.m.scale.setScalar(.14 + .67 * Math.sin(Math.PI * sat(t / .12)));
            s.state.y = .94;
            faceCamera(s.m, ctx, i ? .55 : -.4);
        });
    });
}
export function afterimage(ctx: FxCtx, actor: LabActor, at: THREE.Vector3, yaw: number, pose: number) {
    const e = echo(ctx, actor, pose);
    e.m.position.copy(at);
    e.m.rotation.y = yaw;
    return timed(ctx, e.m, .31, t => { const k = sat(t / .31); e.state.y = .61 * (1 - k * k); e.state.w = k * .93; e.m.position.y = at.y + .06 * k; });
}
// 四段共享一次绘制。横向尺寸直接用米，闪线长度只影响纵向坐标。
function threadGeometry() {
    const ps: number[] = [], uv: number[] = [], ids: number[] = [], ix: number[] = [];
    function quad(p: number[][], id: number) {
        const start = ps.length / 3;
        for (const [x, z, u, v] of p) {
            ps.push(x, 0, z);
            uv.push(u, v);
            ids.push(id);
        }
        ix.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    }
    for (let i = 0; i < 4; i++) {
        for (let panel = 0; panel < 8; panel++) {
            const a = (i * 8 + panel) / 32, b = a + 1 / 32;
            quad([[a, -.065, a, 0], [b, -.065, b, 0], [a, .065, a, 1], [b, .065, b, 1]], i);
        }
    }
    for (const angle of [.69, 2.26]) {
        const c = Math.cos(angle), s = Math.sin(angle);
        quad([[-.30, -.047], [.30, -.047], [-.30, .047], [.30, .047]].map(([x, z]) => [x * c - z * s, x * s + z * c, x / .6 + .5, z / .094 + .5]), 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("sectionId", new THREE.Float32BufferAttribute(ids, 1));
    g.setIndex(ix);
    return g;
}
const links = threadGeometry();
const threadMat = brush(links, `
float u=vUv.x, v=abs(vUv.y*2.-1.);
float shot=state.w;
if(band>3.5){
 if(extra.w<.5 || state.y<.027 || shot>.065 || v>1.-.76*abs(2.*u-1.))discard;
 paint(v>.67?ink:(v<.26?pink:red),.97,0.);
}else{
 if(u>clamp(state.y/.038,0.,1.))discard;
 float gather=state.z;
 float scan=1.-smoothstep(.045,.16,abs(u-mix(extra.x,extra.y,clamp(gather,0.,1.))));
 float strength=gather<0.?0.:scan;
 vec3 c=v<.30?ivory:(v>.77?ink:red);
 if(gather>=0.){
    c=mix(c,v<.42?ivory:pink,.30);
    if(strength>.08)c=v<.78*strength?ivory:(v<.92?pink:ink);
 }
 if(shot>=0.){c=shot<.028?ivory:(v>.76?ink:red);}
 paint(c,shot<0.?(.72+.27*strength):1.,0.);
}
`, `band=sectionId;
if(band<3.5){
 p.x*=state.x;
 if(state.z>=0. && state.w<0.){
    float spark=mix(extra.x,extra.y,clamp(state.z,0.,1.));
    float ridge=1.-smoothstep(.0,.11,abs(uv.x-spark));
    p.z*=1.+.50*ridge;p.y+=.09*ridge;
 }
 float k=clamp((state.w-.045)/.105,0.,1.);
 float midpoint=(band+.5)*.25*state.x;
 p.x=mix(p.x,midpoint+(p.x-midpoint)*(1.-.83*k),k);
 vec2 direction=normalize(vec2(midpoint-extra.y*state.x,extra.z)+vec2(.001));
 p.z*=1.-.62*k;
 p.xz+=direction*(.50*k);p.y+=.12*sin(k*3.14159);
}else{p.x+=state.x;}
`, 'attribute float sectionId;');
export function thread(ctx: FxCtx, from: THREE.Vector3, to: THREE.Vector3, leaveMark = true) {
    const s = piece(ctx, links, threadMat, 3), dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
    s.m.position.copy(from);
    s.m.position.y = ctx.ground(from.x, from.z) + .04;
    s.m.rotation.y = -Math.atan2(dz, dx);
    let gathering = false;
    let age = 0, gatherAge = -1, gatherLength = .11, shot = -1;
    s.state.set(length, 0, -1, -1);
    s.extra.set(0, .5, .2, leaveMark ? 1 : 0);
    ctx.scene.add(s.m);
    return {
        gather(delay = 0, center = vec()) {
            const x = center.x - from.x, z = center.z - from.z;
            const closest = sat((x * dx + z * dz) / (length * length));
            s.extra.set(closest > .5 ? 0 : 1, closest, (x * dz - z * dx) / length, leaveMark ? 1 : 0);
            gatherAge = -delay;
            gatherLength = .13 - delay;
            gathering = true;
        },
        ignite() { shot = 0; s.state.w = 0; },
        update(dt: number) {
            age += dt;
            if (gathering)
                gatherAge += dt;
            if (shot >= 0)
                shot += dt;
            s.state.set(length, age, gathering ? gatherAge / gatherLength : -1, shot);
            return shot < .15;
        },
        dispose() { s.m.removeFromParent(); }
    };
}
export function blink(ctx: FxCtx, cast: LabActor, from: THREE.Vector3, to: THREE.Vector3, target: LabActor, angle: number, pose: number) {
    const web = thread(ctx, from, to), g = new THREE.Group(), b = blade(ctx, 10, true), impact = star(ctx);
    const p = target.obj.position.clone();
    b.m.position.set(p.x, p.y + target.height * .39, p.z);
    b.m.rotation.order = "YXZ";
    impact.m.position.copy(p).add(vec(0, target.height * .55, target.radius * .92));
    g.add(b.m, impact.m);
    ctx.scene.add(g);
    g.visible = false;
    let age = 0, shadow: FxHandle | undefined, landed = false;
    return {
        gather: web.gather, ignite: web.ignite,
        update(dt: number) {
            age += dt;
            const t = age - .03;
            if (t >= 0 && !landed) {
                landed = true;
                target.hit(.96);
                shadow = afterimage(ctx, cast, to, Math.atan2(p.x - to.x, p.z - to.z), pose);
            }
            if (shadow && !shadow.update(Math.min(dt, Math.max(t, 0)))) {
                shadow.dispose();
                shadow = undefined;
            }
            g.visible = t >= 0 && t < .18;
            if (g.visible) {
                const phase = sat(t / .065);
                b.m.scale.setScalar((.38 + .025 * (pose % 3)) * (.94 + .06 * phase));
                b.m.rotation.set(.37 + .08 * (pose % 3), angle + .53 * (1 - out(phase)), 0);
                b.state.set(1.05 * phase, t, pose, sat((t - .083) / .097));
                b.extra.x = pose % 2;
                faceCamera(impact.m, ctx, angle);
                impact.m.scale.setScalar(1.24 * (1 - .68 * out(t / .092)));
                impact.m.visible = t < .092;
            }
            return web.update(dt);
        },
        dispose() { shadow?.dispose(); g.removeFromParent(); web.dispose(); }
    };
}
function fractureGeometry() {
    const positions: number[] = [], uv: number[] = [], widths: number[] = [], ix: number[] = [];
    function ribbon(nodes: number[][], width: number) {
        const start = positions.length / 3;
        nodes.forEach(([x, z], i) => {
            const prev = nodes[Math.max(0, i - 1)], next = nodes[Math.min(nodes.length - 1, i + 1)];
            const dx = next[0] - prev[0], dz = next[1] - prev[1], l = Math.hypot(dx, dz), u = i / (nodes.length - 1);
            const w = width * (i === nodes.length - 1 ? .16 : 1 - .31 * u);
            for (const sign of [-1, 1]) {
                positions.push(x + sign * dz / l * w / 2, 0, z - sign * dx / l * w / 2);
                uv.push(Math.hypot(x, z) / 5.5, (sign + 1) / 2);
                widths.push(w);
            }
            if (i) {
                const b = start + i * 2;
                ix.push(b - 2, b - 1, b, b, b - 1, b + 1);
            }
        });
    }
    [-.76, -2.37, Math.PI - .76, Math.PI - 2.37].forEach((a, j) => {
        const c = Math.cos(a), s = Math.sin(a), end = [5.43, 5.23, 5.37, 5.15][j], sign = j % 2 ? 1 : -1;
        const at = (x: number, z: number) => [x * c - z * sign * s, x * s + z * sign * c];
        ribbon([at(1, 0), at(1.54, -.08), at(2.12, .13), at(2.56, -.16), at(3.11, .10), at(3.72, -.16), at(4.18, -.11), at(4.49, .16), at(end, .03)], .196);
        ribbon([at(2.12, .13), at(2.44, .48), at(2.77, .49), at(3.22, .82)], .105);
        ribbon([at(3.72, -.16), at(4.01, -.51), at(4.32, -.48), at(4.75, -.79)], .086);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("meters", new THREE.Float32BufferAttribute(widths, 1));
    g.setIndex(ix);
    return g;
}
const fractures = fractureGeometry();
const fissureMat = brush(fractures, `
if(vUv.x>state.x)discard;
float dist=abs(vUv.y-.5)*band;
vec3 c=dist<.020?mix(vec3(110.,26.,44.)/255.,pink,state.z):vec3(94.,36.,32.)/255.;
paint(c,dist<.020?state.y*mix(.45,.94,state.z):state.y*.45,0.);
`, 'band=meters;', 'attribute float meters;');
// 尖芒共用一次绘制。位置属性保存每条芒的方向、全长与根宽。
function rayFanGeometry() {
    const data: number[] = [], uv: number[] = [], index: number[] = [];
    const rays = [[3, 5.62, .37], [22, 4.25, .21], [77, 5.10, .29], [106, 4.52, .26], [164, 5.83, .41],
        [193, 4.60, .24], [246, 5.36, .28], [272, 4.34, .21], [294, 5.70, .36]];
    for (const [deg, end, width] of rays) {
        const start = data.length / 3;
        for (const [u, v] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
            data.push(deg * Math.PI / 180, end, width);
            uv.push(u, v);
        }
        index.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    return g;
}
const fanGeometry = rayFanGeometry();
fanGeometry.name = "贴地尖芒";
const fanMat = brush(fanGeometry, `
float u=vUv.x, side=abs(2.*vUv.y-1.);
if(u<state.y || side>1.-u)discard;
float face=side/max(.001,1.-u);
vec3 c=u<.14?ivory:(u<.22?pink:red);
if(face>.79 || u>.80)c=ink;
paint(c,.94,0.);
`, `vec2 dir=vec2(cos(position.x),sin(position.x)), side=vec2(-dir.y,dir.x);
p=vec3(0.);p.xz=dir*(1.+uv.x*(position.y-1.)*state.x)+side*(uv.y-.5)*position.z;`);
// 同一网格内的八面体核心和四道带脊光芒。前后顶点在不同深度。
function glintGeometry() {
    const pos: number[] = [], uv: number[] = [], kind: number[] = [], indices: number[] = [];
    function vertex(x: number, y: number, z: number, u: number, v: number, id: number) {
        pos.push(x, y, z);
        uv.push(u, v);
        kind.push(id);
        return kind.length - 1;
    }
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
        const at = (d: number, w: number, h: number, u: number, v: number) => vertex(d * c - w * s, d * s + w * c, h, u, v, i);
        const start = at(.19, -.06, 0, 0, 0);
        at(.19, 0, .095, 0, .5);
        at(.19, .06, 0, 0, 1);
        at(2.19, 0, i % 2 ? -.19 : .14, 1, .5);
        indices.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
    }
    const n = 8;
    for (let i = 0; i < n; i++) {
        const a = i * Math.PI * 2 / n, b = (i + 1) * Math.PI * 2 / n;
        const center = vertex(0, 0, .25, 0, 0, 4);
        vertex(.30 * Math.cos(a), .30 * Math.sin(a), 0, 1, 0, 4);
        vertex(.30 * Math.cos(b), .30 * Math.sin(b), 0, 1, 0, 4);
        indices.push(center, center + 1, center + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("part", new THREE.Float32BufferAttribute(kind, 1));
    g.setIndex(indices);
    return g;
}
const flareGeometry = glintGeometry();
flareGeometry.name = "四向闪光";
const flareMat = brush(flareGeometry, `
if(band>3.5){
 float rim=.79+.07*clamp((local.y-local.x)*3.,-1.,1.);
 vec3 c=vUv.x<rim?ivory:(local.y>local.x?pink:red);
 paint(c,1.,vUv.x<rim?.32:0.);
}
else{
 float flank=abs(vUv.y-.5)/max(.001,1.-vUv.x);
 paint(flank<.21?ivory:(flank<.37?pink:red),.98,flank<.21?.28:0.);
}`, 'band=part;', 'attribute float part;');
const pullMat = brush(groundPlane, `
float d=(1.-length(local.xz))*state.x;
if(d<0. || d>.055)discard;
paint(pink,.94,0.);
`);
export function finale(ctx: FxCtx, center: THREE.Vector3, onImpact?: () => void): FxHandle {
    const g = new THREE.Group();
    g.position.copy(center);
    const swords = [blade(ctx, 10), blade(ctx, 11)], fragments = [edgeChips(ctx), edgeChips(ctx)];
    const shock = ring(ctx), flash = piece(ctx, flareGeometry, flareMat, 17), mark = stain(ctx), floor = piece(ctx, fractures, fissureMat, 2);
    const chargeDot = star(ctx, 12), pull = piece(ctx, groundPlane, pullMat, 4);
    const fan = piece(ctx, fanGeometry, fanMat, 3);
    pull.m.position.y = .065;
    fan.m.position.y = .072;
    const chordOffset = vec();
    flash.m.position.set(0, 1.4, .84);
    chargeDot.m.position.set(0, 1.22, .76);
    shock.m.position.y = .054;
    mark.m.position.y = .023;
    floor.m.position.y = .03;
    g.add(pull.m, fan.m, shock.m, flash.m, chargeDot.m, mark.m, floor.m);
    for (let i = 0; i < 2; i++) {
        const b = swords[i];
        b.m.rotation.order = "YZX";
        g.add(b.m, fragments[i].m);
    }
    let fired = false;
    return timed(ctx, g, 1.28, age => {
        const t = age - .13, active = t >= 0, k = out(age / .13);
        if (active && !fired) {
            fired = true;
            onImpact?.();
            ctx.shake(.16, .16);
            ctx.hitstop(.032);
        }
        const radius = active ? 3.2 : 3.2 * k;
        mark.m.scale.setScalar(Math.max(.001, radius));
        // 压痕在放刀时消失。冲击带通过后才显出冷却的焦痕。
        mark.m.visible = !active || t > .32;
        const scorch = .30 * sat((t - .32) / .07) * (1 - sat((t - .43) / .72));
        mark.state.set(active ? 1 : 0, active ? scorch : .36, radius, active ? 0 : .98);
        chargeDot.m.visible = !active;
        faceCamera(chargeDot.m, ctx, .3);
        chargeDot.m.scale.setScalar(.8 * k);
        pull.m.visible = !active;
        const pullRadius = 2.5 - 2.2 * sat((age - .006) / .12);
        pull.m.scale.setScalar(pullRadius);
        pull.state.x = pullRadius;
        fan.m.visible = active && t < .17;
        fan.state.set(out(t / .05), sat((t - .05) / .12), 0, 0);
        swords.forEach((b, i) => {
            const u = t, slip = out((u - .103) / .12), scale = (1 + .12 * slip) / 1.12;
            b.m.visible = u >= 0 && u < .47;
            b.m.scale.setScalar(scale);
            const yaw = (i ? -1 : 1) * Math.PI / 4 + .045 * (1 - slip);
            b.m.rotation.set(.42, yaw, i ? -.164 : .164);
            // 将两条弦的中点落在同一条中心垂线上。
            chordOffset.set(0, 0, 1.10 * scale).applyQuaternion(b.m.quaternion);
            b.m.position.copy(chordOffset);
            b.m.position.y += 3.12;
            const sweep = sat((u - .005) / .080);
            b.state.set(1.07 * sweep * sweep * (3 - 2 * sweep), u, 2.6 * i, sat((u - .223) / .245));
            b.extra.x = i;
            const f = fragments[i];
            f.m.visible = u > .23 && u < .52;
            f.m.position.copy(b.m.position);
            f.m.quaternion.copy(b.m.quaternion);
            f.m.scale.copy(b.m.scale);
            f.state.set(u - .23, .225, 0, 0);
        });
        flash.m.visible = active && t < .08;
        faceCamera(flash.m, ctx, .25 + .21 * sat(t / .08));
        flash.m.rotateY(.15);
        flash.m.scale.setScalar(out(t / .03) * (1 - sat((t - .03) / .05) ** 1.25));
        const r = 6 * out(t / .22), w = (.70 - .35 * sat((r - 2) / 4)) * (1 - sat((t - .22) / .1));
        shock.m.visible = active && t < .32;
        sizeRing(shock, r, w, .55, .08, true);
        floor.m.visible = active;
        floor.state.set(out(t / .13), 1 - sat((t - .55) / .60), 1 - sat(t / .40), 0);
    });
}
