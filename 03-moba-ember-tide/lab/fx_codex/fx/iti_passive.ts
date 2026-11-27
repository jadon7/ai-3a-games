import * as THREE from "three";
import type { FxCtx, LabActor } from "../api";
import { brush, chips, faceCamera, out, piece, plane, ring, sat, sizeRing, splinterGeometry, stain, timed, vec, type Splinter } from "./paint";
function markGeometry() {
    const p: number[] = [], uv: number[] = [], ids: number[] = [], ix: number[] = [];
    for (let i = 0; i < 6; i++) {
        const base = p.length / 3;
        const rows = i < 3 ? 1 : 10;
        for (let j = 0; j <= rows; j++) {
            const v = j / rows;
            for (const u of [0, 1]) {
                p.push(u - .5, v - .5, 0);
                uv.push(u, v);
                ids.push(i);
            }
            if (j) {
                const k = base + 2 * j;
                ix.push(k - 2, k - 1, k, k - 1, k + 1, k);
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("slot", new THREE.Float32BufferAttribute(ids, 1));
    g.setIndex(ix);
    return g;
}
export const MARK_FLIGHT = .060;
export const THIRD_HIT_DELAY = .014 + MARK_FLIGHT;
const glyphs = markGeometry();
const markMat = brush(glyphs, `
float id=mod(band,3.);
if(band>2.5){
 if(state.w<=0. || state.w>=1.)discard;
 float side=abs(vUv.x-.5)*2.;
 float head=vUv.y;
 float profile=head<.67?mix(.06,.47,head/.67):(head<.78?mix(.48,1.,(head-.67)/.11):(1.-head)/.22);
 if(side>profile)discard;
 bool leading=head>.69;
 vec3 c=side>profile*.78?ink:(leading?ivory:red);
 paint(c,state.y,leading && side<profile*.78?.10:0.);
}else{
 if(state.w>0.)discard;
 float y=vUv.y;
 float width=y<.35?sqrt(max(0.,1.-pow((y-.35)/.35,2.))):pow(max(0.,(1.-y)/.65),.84);
 float x=abs((vUv.x-.5)*2.-.25*y*y+.11*y);
 float inside=min((width-x)*.16,min(y,1.-y)*.42);
 if(inside<0.)discard;
 bool lit=id+.5<state.x;
 bool white=state.x>2.5 && state.z<=.014;
 vec3 c=inside<.040?ink:(white?ivory:(lit?red:ink));
 if(lit && inside>.079 && y<.61)c=ivory;
 paint(c,state.y*(lit||inside<.04?1.:.25),0.);
}
`, `
band=slot;float id=mod(slot,3.);
vec3 anchor=vec3((id-1.)*.49,id==1.?.115:0.,0.);
if(slot<2.5){
 float pop=step(abs(id+1.-state.x),.1)*(1.-clamp(state.z/.12,0.,1.));
 p=anchor+vec3(p.x*.32,p.y*.42,0.)*(1.+.60*pop*pop);
}else{
 vec3 sink=extra.xyz;float k=clamp(state.w,0.,1.);
 float head=1.-pow(1.-k,1.32),tail=k*k;
 vec2 path=sink.xy-anchor.xy;vec2 side=normalize(vec2(-path.y,path.x));
 float s=mix(tail,head,uv.y);
 p=mix(anchor,sink,s);
 p.x+=(id-1.)*.35*sin(3.14159*s);
 p.y+=.06*(id-1.)*sin(6.28318*s);
 p+=vec3(side*(uv.x-.5)*.16,0.);
}
`, 'attribute float slot;');
markMat.depthTest = false;
const flick = splinterGeometry([{ start: vec(.10, .15, 0), travel: vec(.15, .26, 0), length: .112, width: .045, gold: false, delay: 0 }]);
function chest(target: LabActor) {
    return target.obj.position.clone().add(vec(-.04, target.height * .62, target.radius * .89));
}
export function marks(ctx: FxCtx, target: LabActor) {
    const mark = piece(ctx, glyphs, markMat, 32), spark = chips(ctx, flick), anchor = vec(), lift = vec(), q = new THREE.Quaternion();
    const bar = target.obj.children.find(o => (o as THREE.Sprite).isSprite) as THREE.Sprite | undefined;
    const g = new THREE.Group();
    g.add(mark.m, spark.m);
    ctx.scene.add(g);
    spark.m.renderOrder = 32;
    let count = 0, age = 0;
    function draw() {
        const travel = count === 3 ? sat((age - .014) / MARK_FLIGHT) : 0;
        if (bar)
            bar.getWorldPosition(anchor);
        else
            anchor.copy(target.obj.position).y += target.height + .62;
        // 血条图含名字。用整张图的上沿来量间隙，包含点亮时的 1.6 倍高度。
        const clearance = bar?.visible ? bar.scale.y * (1 - bar.center.y) + .56 : .38;
        lift.set(0, clearance, 0).applyQuaternion(ctx.camera.quaternion);
        g.position.copy(anchor).add(lift);
        faceCamera(g, ctx);
        const sink = chest(target).sub(g.position).applyQuaternion(q.copy(g.quaternion).invert());
        mark.extra.set(sink.x, sink.y, sink.z, 0);
        mark.state.set(count, 1 - sat((age - 4) / .18), age, travel);
        mark.m.renderOrder = travel > 0 ? 29 : 32;
        spark.m.visible = count > 0 && age < .12 && travel === 0;
        spark.m.position.set((count - 2) * .49, count === 2 ? .115 : 0, 0);
        spark.state.set(age, .12, 0, 0);
    }
    draw();
    return { set(n: number) { count = Math.min(3, Math.max(0, n)); age = 0; draw(); },
        update(dt: number) { age += dt; draw(); return age < (count === 3 ? THIRD_HIT_DELAY : 4.18); }, dispose() { g.removeFromParent(); } };
}
// 方位角自 +X 朝 +Z，仰角自地面向上。前三支决定轮廓，较短的火舌填在前后空隙里。
const design = [
    [198, 31, 2.29, .39], [242, 49, 2.38, .40], [354, 34, 2.23, .37],
    [142, 24, 1.53, .29], [302, 46, 1.46, .29], [36, 29, 1.59, .28], [86, 22, 1.41, .25], [222, 32, 1.34, .25],
    [165, 69, .96, .24], [19, 45, .92, .24], [281, 26, .97, .22], [56, 50, .88, .20], [126, 43, .94, .23], [327, 19, .82, .16]
];
function spikes(lite: boolean) {
    const ids = lite ? [0, 1, 2, 3, 4, 5, 10, 12] : design.map((_, i) => i);
    const p: number[] = [], uv: number[] = [], widths: number[] = [], facets: number[] = [], tags: number[] = [], axisData: number[] = [], ix: number[] = [];
    const debris: Splinter[] = [];
    for (const id of ids) {
        const [az, el, len, width] = design[id], a = az * Math.PI / 180, e = el * Math.PI / 180;
        const axis = vec(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
        const side = vec().crossVectors(axis, vec(0, .79, .61)).normalize(), front = vec().crossVectors(side, axis).normalize();
        const bend = (id % 2 ? 1 : -1) * (.19 + .11 * Math.sin(id * 1.7));
        const center = (u: number) => axis.clone().multiplyScalar(len * u).addScaledVector(side, bend * u * u + .056 * Math.sin(u * 7 + id) * u);
        const cross = [[-.5, 0, 0], [-.08, .29, .42], [.5, 0, 1], [.09, -.23, .57], [-.5, 0, 0]];
        for (let face = 0; face < 4; face++) {
            const base = p.length / 3;
            for (let j = 0; j <= 20; j++) {
                const u = j / 20;
                const w = width * (u < .35 ? 1 - .08 * u / .35 : 1.42 * (1 - u)) * (1 + .09 * Math.sin(11 * u + id) * Math.sin(Math.PI * u));
                const notchAt = .54 + .08 * Math.sin(id);
                const nick = Math.max(0, Math.min(1 + (u - notchAt) / .045, 1 - (u - notchAt) / .12));
                for (const [v, d, tex] of [cross[face], cross[face + 1]]) {
                    const pos = center(u).addScaledVector(side, w * (v - (v > 0 ? .43 * nick : 0))).addScaledVector(front, w * d);
                    p.push(pos.x, pos.y, pos.z);
                    uv.push(u, tex);
                    tags.push(id);
                    facets.push(face);
                    widths.push(w);
                    axisData.push(axis.x, axis.y, axis.z);
                }
                if (j) {
                    const b = base + j * 2;
                    ix.push(b - 2, b - 1, b, b, b - 1, b + 1);
                }
            }
        }
        for (const k of lite && id >= 10 ? [0] : [0, 1]) {
            const gold = (id === 1 || id === 5 || id === 9) && k === 0;
            const start = center(.69 + .22 * k), travel = axis.clone().multiplyScalar(.25 + .04 * k).addScaledVector(side, (k ? 1 : -1) * .065);
            debris.push({ start, travel, length: gold ? .24 : .12 + .08 * k, width: gold ? .032 : .08 - .025 * k, gold, delay: .025 * k + .005 * (id % 3) });
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("widthM", new THREE.Float32BufferAttribute(widths, 1));
    g.setAttribute("leaf", new THREE.Float32BufferAttribute(tags, 1));
    g.setAttribute("facet", new THREE.Float32BufferAttribute(facets, 1));
    g.setAttribute("axis", new THREE.Float32BufferAttribute(axisData, 3));
    g.setIndex(ix);
    g.name = lite ? "八支火舌" : "十四支火舌";
    return { g, debris: splinterGeometry(debris) };
}
const full = spikes(false), liteSet = spikes(true);
const fireMat = brush(full.g, `
float u=vUv.x,v=vUv.y,id=band, width=local.x;
float n=grain(vec2(u*9.+id*1.7,v*2.));
float border=min(v,1.-v)*width;
float cut=state.w*1.13+(n-.5)*.16;
if(local.z<.44*smoothstep(.052,.15,state.x))discard;
if(state.w>0. && (u<cut || (u>.64 && abs(fract((u+.04*n)*6.)-.5)<.12*state.w)))discard;
float along=u+.046*(n-.5)*smoothstep(.20,.38,u);
bool root=u<.20;
vec3 c=root?ivory:(along<.62?pink:red);
bool folded=local.y>.5 && local.y<2.5;
if(!root && folded)c=along<.62?mix(pink,red,.26):mix(red,plum,.20);
float tooth=.48+.18*sin(id*2.);
if(u>tooth && u<tooth+.23 && v>.76+.23*(u-tooth)/.23 && mod(id,3.)<2.)discard;
float edgeWidth=.023*smoothstep(.20,.57,u)*(v<.5?.58:1.);
if(!root && (border<min(edgeWidth,width*.14) || u>.99))c=ink;
if((id==1.||id==4.||id==7.) && along>.26 && along<.72 && abs(v-.41-.09*sin(u*9.))<.073)c=gold;
paint(c,1.,root?.045:0.);
`, `band=leaf;local.y=facet;local.x=widthM;
float t=state.x-.03-.002*mod(leaf,3.);
float k=clamp(t/.062,0.,1.);
float grow=1.10*(1.-pow(1.-k,2.5))-.10*smoothstep(.062,.090,t);
float drift=smoothstep(.095,.160,state.x)*.065+.235*state.w;
p*=grow;p+=axis*drift*uv.x*uv.x;
float unfurl=smoothstep(.090,.160,state.x);
p.x+=.085*sin(leaf*2.+uv.x*5.+unfurl*1.2)*uv.x*unfurl;
local.z=length((modelViewMatrix*vec4(p,0.)).xy);`, 'attribute float leaf,facet,widthM; attribute vec3 axis;');
fireMat.depthWrite = true;
// 刺根和爆团共用胸口投影。四个边界分别采样，火舌的尖角可以穿过相邻色阶。
const cloudMat = brush(plane, `
vec2 q=vUv*2.-1.;
float r=length(q), age=state.x;
vec2 dir=q/max(r,.0001);
float a=atan(dir.y,dir.x);
vec2 travel=vec2(-1.2,1.7)*age;
// 陡坡和缓坡组成不等长的火舌。一侧沿射线翻卷，另一侧被切断。
float flow=a+.31*r+.14*sin(3.*a+2.7*r)-.8*age;
vec2 stream=vec2(cos(flow),sin(flow));
float chips=2.*grain(stream*4.8+travel)-1.;
float stroke=fract(flow*1.114085+.23*sin(3.*flow)+.17);
float tip=min(stroke/.78,(1.-stroke)/.22);
float hull=clamp(.804+.16*tip+.086*chips+.046*dir.y,.68,1.);
if(r>hull)discard;
float split=pow(max(0.,cos(3.*flow+1.1*sin(2.*flow))),8.);
float vent=state.z*(1.08+.09*chips)+.48*smoothstep(.17,.64,state.z)*split;
if(r<vent)discard;
float radius=r/hull;
float rake=2.*grain(stream*7.1+vec2(.9*r,-.5*r)+travel)-1.;
float hot=.35+.109*clamp(.85*sin(3.*flow+6.*q.x)+.72*rake,-1.,1.);
float lit=.65+.117*clamp(.84*sin(4.*flow-6.*q.y)+.68*chips,-1.,1.);
float shade=.92+.098*clamp(sin(3.*flow+.85)+.52*rake,-1.,1.);
vec3 c=radius<hot?ivory:(radius<lit?pink:(radius<shade?red:ink));
// 将两级亮面切出相离的笔触。短笔仍在各自分界两侧约十分之一半径内。
float warmTongue=abs(sin(2.*flow+.48+radius*2.6));
if(radius>hot+.025 && radius<.468 && warmTongue<1.75*(.47-radius)+.04*rake)c=ivory;
float redFork=abs(sin(3.*flow-.45+2.5*radius));
if(radius>.525 && radius<lit-.025 && redFork<1.40*(radius-.52))c=red;
float brightTip=abs(sin(3.*flow+.88-2.9*radius));
if(radius>lit+.022 && radius<.765 && brightTip<1.85*(.767-radius)+.04*chips)c=pink;
paint(c,.99,c==ivory?.045:0.);
`);
export function burst(ctx: FxCtx, target: LabActor) {
    const set = ctx.lite ? liteSet : full, g = new THREE.Group();
    g.position.copy(target.obj.position);
    const fire = piece(ctx, set.g, fireMat, 11), core = piece(ctx, plane, cloudMat, 16), pulse = ring(ctx, 13), wave = ring(ctx), splash = stain(ctx), chipsFx = chips(ctx, set.debris);
    core.m.name = "胸口爆团";
    const peak = chest(target).sub(g.position);
    fire.m.position.copy(peak);
    core.m.position.copy(peak);
    const towardsCamera = vec();
    pulse.m.position.copy(peak);
    chipsFx.m.position.copy(peak);
    g.add(fire.m, core.m, pulse.m, wave.m, splash.m, chipsFx.m);
    splash.m.position.y = .027;
    wave.m.position.y = .048;
    target.hit(.97);
    ctx.shake(.083, .115);
    return timed(ctx, g, .60, t => {
        fire.m.visible = t >= .03 && t < .40;
        fire.state.set(t, 1, 0, sat((t - .160) / .240));
        core.m.visible = t > 0 && t < .28;
        towardsCamera.copy(ctx.camera.position).sub(g.position).sub(peak).normalize();
        core.m.position.copy(peak).addScaledVector(towardsCamera, .37);
        faceCamera(core.m, ctx, .08);
        const radius = .75 * out(t / .055);
        core.m.scale.setScalar(2 * radius);
        core.state.set(t, radius, 1 - (1 - sat((t - .050) / .230)) ** 1.45, 0);
        pulse.m.visible = t >= .05 && t < .17;
        faceCamera(pulse.m, ctx);
        pulse.m.rotateX(Math.PI / 2);
        const p = sat((t - .05) / .12);
        sizeRing(pulse, .6 + .5 * (1 - (1 - p) ** 1.6), .10 * (1 - .89 * p), .73, .04);
        pulse.extra.z = 1 - .44 * p * p;
        const w = sat((t - .04) / .23);
        wave.m.visible = t > .04 && w < 1;
        sizeRing(wave, 1.55 * out(w), .13 * (1 - w), .56, .045);
        const r = 1.4 * out(t / .09);
        splash.m.scale.setScalar(Math.max(.001, r));
        splash.state.set(1, .35 * (1 - sat((t - .21) / .39)), r, 0);
        chipsFx.m.visible = t > .225 && t < .40;
        chipsFx.state.set(t - .225, .14, 0, 0);
    });
}
