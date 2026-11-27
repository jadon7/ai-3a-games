// 所有色值都是最终画面上的 sRGB。身子盖色，只有细刃和星心少量叠亮。
import * as THREE from "three";
import type { FxCtx, FxHandle } from "../api";
export const sat = (n: number) => Math.max(0, Math.min(1, n));
export const out = (n: number) => 1 - (1 - sat(n)) ** 3;
export const plane = new THREE.PlaneGeometry(1, 1);
export const groundPlane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
export const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const palette = /* glsl */ `
const vec3 ink=vec3(126.,15.,47.)/255., red=vec3(227.,19.,75.)/255., pink=vec3(255.,77.,122.)/255.;
const vec3 plum=vec3(217.,32.,127.)/255., ivory=vec3(255.,243.,230.)/255., gold=vec3(255.,195.,77.)/255.;
float hash(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*4375.5453);}
float grain(vec2 q){vec2 i=floor(q), f=fract(q); f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void paint(vec3 c,float a,float light){if(a<.006) discard; gl_FragColor=vec4(c*a,a*(1.-light));}
`;
const params = 'uniform vec4 state, extra; varying vec2 vUv; varying vec3 local; varying float band;';
const library = new Map<THREE.ShaderMaterial, THREE.BufferGeometry>();
export function brush(geometry: THREE.BufferGeometry, frag: string, vert = '', attributes = '') {
    const mat = new THREE.ShaderMaterial({
        uniforms: { state: { value: new THREE.Vector4() }, extra: { value: new THREE.Vector4() } },
        vertexShader: params + attributes + `
    void main(){vUv=uv; local=position; band=0.; vec3 p=position;
    ` + vert + `
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
        fragmentShader: params + palette + 'void main(){' + frag + '}',
        side: THREE.DoubleSide, forceSinglePass: true, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    library.set(mat, geometry);
    return mat;
}
export function piece(ctx: FxCtx, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order: number) {
    const m = new THREE.Mesh(geometry, material);
    const state = new THREE.Vector4(0, 1, 0, 0), extra = new THREE.Vector4();
    m.renderOrder = order;
    m.frustumCulled = false;
    m.onBeforeRender = () => {
        material.uniforms.state.value.copy(state);
        material.uniforms.extra.value.copy(extra);
        material.uniformsNeedUpdate = true;
        ctx.onFxDraw?.(geometry instanceof THREE.InstancedBufferGeometry ? geometry.instanceCount : 0);
    };
    return { m, state, extra };
}
export const warmSkins = new Map<THREE.Material, THREE.SkinnedMesh>();
export async function warmPaint(ctx: FxCtx) {
    const scene = new THREE.Scene();
    for (const [mat, geo] of library)
        scene.add(new THREE.Mesh(geo, mat));
    for (const shell of warmSkins.values())
        scene.add(shell);
    await ctx.renderer.compileAsync(scene, ctx.camera, ctx.scene);
    scene.clear();
}
export function timed(ctx: FxCtx, root: THREE.Object3D, duration: number, frame: (age: number) => void): FxHandle {
    let age = 0;
    ctx.scene.add(root);
    frame(0);
    return {
        update(dt) { age += dt; frame(age); return age < duration; },
        dispose() { root.removeFromParent(); },
    };
}
const starMat = brush(plane, `
vec2 q=abs(vUv*2.-1.);
float d=max(q.x,q.y)+4.*min(q.x,q.y);
if(d>1.) discard;
vec3 c=d>.91?ink:(d>.69?red:ivory);
paint(c,state.y,d<.69?.055:0.);
`);
export function star(ctx: FxCtx, order = 14) { return piece(ctx, plane, starMat, order); }
export function faceCamera(mesh: THREE.Object3D, ctx: FxCtx, roll = 0) {
    mesh.quaternion.copy(ctx.camera.quaternion);
    mesh.rotateZ(roll);
}
const ringMat = brush(groundPlane, `
vec2 q=local.xz;
float r=length(q), d=(1.-r)*state.x, w=state.y;
if(d<0. || d>w)discard;
float a=atan(q.y,q.x);
if(extra.x>.5 && min(abs(sin(a-.77)),abs(sin(a-2.35)))<.009 && cos(a)>.0)discard;
float lip=min(w*.27,extra.y), outline=min(w*.2,.05);
vec3 c=d<lip?pink:(d>w-outline?ink:red);
float opacity=d<lip?.96:(d>w-outline?.82:state.z);
float feather=smoothstep(0.,min(.026,w*.15),w-d);
paint(c,opacity*extra.z*(.65+.35*feather),0.);
`);
export function ring(ctx: FxCtx, order = 4) { return piece(ctx, groundPlane, ringMat, order); }
export function sizeRing(s: ReturnType<typeof ring>, radius: number, width: number, alpha: number, lip: number, notches = false) {
    s.m.scale.setScalar(Math.max(.001, radius));
    s.state.set(radius, width, alpha, 0);
    s.extra.set(notches ? 1 : 0, lip, 1, 0);
}
const stainMat = brush(groundPlane, `
vec2 q=local.xz;float a=atan(q.y,q.x), r=length(q);
float lobe=.67+.29*pow(.5+.5*cos(6.*a+.45*sin(3.*a)),1.4)+.04*grain(q*7.);
float edge=mix(1.,lobe,state.x);
if(r>edge)discard;
float rim=(edge-r)*state.z;
bool lip=state.w>.01 && rim<.059;
paint(lip?pink:vec3(110.,26.,44.)/255.,lip?state.w:state.y,0.);
`);
export const stain = (ctx: FxCtx) => piece(ctx, groundPlane, stainMat, 1);
export interface Splinter {
    start: THREE.Vector3;
    travel: THREE.Vector3;
    length: number;
    width: number;
    gold: boolean;
    delay: number;
}
export function splinterGeometry(particles: Splinter[]) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, -.48, 0, -.46, -.12, 0, .10, .52, 0, .54, .06, 0], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([.5, 0, 0, .36, .55, 1, 1, .61], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const starts: number[] = [], travel: number[] = [], sizes: number[] = [];
    for (const s of particles) {
        starts.push(s.start.x, s.start.y, s.start.z);
        travel.push(s.travel.x, s.travel.y, s.travel.z);
        sizes.push(s.length, s.width, s.gold ? 1 : 0, s.delay);
    }
    g.setAttribute("birth", new THREE.InstancedBufferAttribute(new Float32Array(starts), 3));
    g.setAttribute("flight", new THREE.InstancedBufferAttribute(new Float32Array(travel), 3));
    g.setAttribute("shape", new THREE.InstancedBufferAttribute(new Float32Array(sizes), 4));
    g.instanceCount = particles.length;
    return g;
}
const chipMat = brush(plane, `
if(local.z<0. || local.z>=1.) discard;
vec3 c=band>.5?(vUv.x<.27?vec3(1.,.588,.251):gold):(vUv.x<.29?ink:(vUv.x<.61?pink:red));
paint(c,1.,0.);
`, `
float t=(state.x-shape.w)/state.y;
float k=clamp(t,0.,1.);local.z=t;band=shape.z;
vec3 center=birth+flight*(1.-pow(1.-k,2.));
vec3 velocity=mat3(modelViewMatrix)*flight;
vec2 axis=normalize(velocity.xy+vec2(.0001));vec2 side=vec2(-axis.y,axis.x);
vec2 offset=(axis*p.y*shape.x+side*p.x*shape.y)*(1.-smoothstep(.36,1.,k));
p=center+inverse(mat3(modelViewMatrix))*vec3(offset,0.);
`, 'attribute vec3 birth,flight; attribute vec4 shape;');
export const chips = (ctx: FxCtx, g: THREE.InstancedBufferGeometry) => piece(ctx, g, chipMat, 13);
