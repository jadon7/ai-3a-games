import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FxCtx, LabActor } from "../api";
import { brush, chips, piece, plane, splinterGeometry, vec, warmSkins, type Splinter } from "./paint";
// 椭圆外刃决定弦和拱高。截面沿曲线法向切入，在亮绯面与绯红面的交界处起脊。
function section(u: number, v: number, midWidth = 1.04) {
    const angle = (u - .5) * Math.PI, c = Math.cos(angle), s = Math.sin(angle);
    const width = midWidth * Math.max(0, c) ** .86;
    const nx = s * 2.04, nz = c * 4.8, n = Math.hypot(nx, nz);
    const ridge = v < .32 ? v / .32 : 1 - (v - .32) / .68;
    return vec(4.8 * s - v * width * nx / n, width * (.22 * ridge - .08 * v), 2.04 * c - 1.10 - v * width * nz / n);
}
// 椭圆参数与实际弧长不同。用外刃的累计长度控制亮边和刀头速度。
const arcLength = [0];
for (let i = 1; i <= 256; i++)
    arcLength.push(arcLength[i - 1] + section(i / 256, 0).distanceTo(section((i - 1) / 256, 0)));
function alongRim(u: number) {
    const t = u * 256, i = Math.min(255, Math.floor(t));
    return THREE.MathUtils.lerp(arcLength[i], arcLength[i + 1], t - i) / arcLength[256];
}
function crescentGeometry(strands: number, small = false) {
    const p: number[] = [], uv: number[] = [], lane: number[] = [], strandUv: number[] = [], widths: number[] = [], ix: number[] = [];
    const midWidth = small ? 1.12 : 1.04;
    const surface = (u: number, v: number) => section(u, v, midWidth);
    function strip(steps: number, rows: number, id: number, sample: (u: number, v: number) => [
        THREE.Vector3,
        number
    ]) {
        const start = p.length / 3;
        for (let i = 0; i <= steps; i++)
            for (let j = 0; j <= rows; j++) {
                const u = i / steps, v = j / rows, [q, along] = sample(u, v);
                p.push(q.x, q.y, q.z);
                uv.push(alongRim(along), v);
                widths.push(midWidth * Math.max(0, Math.sin(Math.PI * along)) ** .86);
                lane.push(id);
                strandUv.push(u);
                if (i && j) {
                    const b = start + i * (rows + 1) + j;
                    ix.push(b - rows - 2, b - 1, b, b - rows - 2, b, b - rows - 1);
                }
            }
    }
    strip(72, 6, -1, (u, v) => {
        const rim = surface(u, 0), q = surface(u, v).sub(rim).multiplyScalar(1.30).add(rim);
        q.x *= 1.025;
        q.z = q.z * 1.14 - .48;
        q.y -= .21;
        return [q, u];
    });
    for (let i = 0; i < strands; i++) {
        const tip = i % 2 === 0, j = Math.floor(i / 2), sign = j % 2 === 0 ? -1 : 1;
        const start = tip ? (sign < 0 ? .025 + .011 * j : .976 - .011 * j) : small ? .12 + .76 * ((j * .618) % 1)
            : sign < 0 ? .07 + .008 * j : .93 - .008 * j;
        const anchor = surface(start, tip ? .72 : 1.);
        const tangent = surface(Math.min(.999, start + .003), .84).sub(surface(Math.max(.001, start - .003), .84)).normalize();
        const normal = vec(-tangent.z, 0, tangent.x);
        const length = 1.08 + .79 * ((i * .3819) % 1);
        const centers = Array.from({ length: 19 }, (_, step) => {
            const u = step / 18, wave = Math.sin(u * 4.3 + i * .82) - Math.sin(i * .82);
            const offset = tangent.clone().multiplyScalar((tip || !small ? sign : -1) * length * u)
                .addScaledVector(normal, -(.32 + .085 * j) * u - wave * .095);
            offset.y += u * (.07 * j - .19) + .07 * wave;
            return offset;
        });
        const actual = centers.slice(1).reduce((sum, v, k) => sum + v.distanceTo(centers[k]), 0);
        strip(18, 1, 1 + i, (u, v) => {
            const q = anchor.clone().addScaledVector(centers[Math.round(u * 18)], length / actual);
            q.addScaledVector(normal, (.034 + .016 * ((i + 1) % 3) / 2) * (1 - u) * (v - .5));
            return [q, start];
        });
    }
    // 后沿折入刀背。尖端与刀刃一起合拢。
    strip(84, 1, -2, (u, v) => {
        const q = surface(u, 1), fold = v * Math.sin(Math.PI * u);
        q.y -= .055 * fold;
        q.z -= .042 * fold;
        return [q, u];
    });
    strip(84, 10, 0, (u, v) => [surface(u, v), u]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("widthM", new THREE.Float32BufferAttribute(widths, 1));
    g.setAttribute("lane", new THREE.Float32BufferAttribute(lane, 1));
    g.setAttribute("strandUv", new THREE.Float32BufferAttribute(strandUv, 1));
    g.setIndex(ix);
    g.name = small ? "闪砍" : "十字新月";
    return g;
}
const full = crescentGeometry(16), lite = crescentGeometry(8), mini = crescentGeometry(2, true);
const bladeMat = brush(full, `
float u=vUv.x,v=vUv.y,head=state.x;
float along=extra.x>.5?1.-u:u;
float n=grain(vec2(u*17.+state.z,2.1));
if(along>head || (band> -1.5 && band<-.5 && along>head-.045 && head<1.045))discard;
if(extra.y>.5 && head<1.035 && band==0. && along>head-.061*v*v)discard;
float wear=state.w;
if(band>.5){
  if(local.y>1.-wear)discard;
  paint(mod(band,3.)<1.?pink:plum, (.90-.49*local.y)*(1.-wear),0.);
}else{
  float width=max(.001,local.x);
  bool finish=extra.y>.5;
  float edge=(u>.20 && u<.80)?min(.35,(finish?.14:.08)/width):0.;
  float wobble=.08*(n-.5);
  float pulse=clamp(state.y/.22,0.,1.);
  float cut=1.-v+(grain(vec2(u*27.+state.z,v*2.5))-.5)*.21+sin(u*31.+v*3.)*.045;
  if(band==0. && v<edge)cut=max(cut,1.085+.079*n);
  if(wear>0. && cut<wear*1.20)discard;
  if(band< -1.5){
    if(wear>.055)discard;
    paint(ink,finish?.20:.98,0.);
  }else if(band<-.5){
    if(wear>.74 || (v>.79 && grain(vec2(u*22.,v*5.))*1.6<((v-.79)*4.6)))discard;
    vec3 trail=v>.71?ink:(v>.32?plum:red);
    float toTip=min(u,1.-u);
    float wake=finish?.145*(1.-smoothstep(.05,.16,toTip)):.32;
    paint(trail,wake*(1.-wear)*smoothstep(0.,finish?.045:.055,toTip),0.);
  }else{
    if(finish){
      // v 是横截面比例；线宽和刃口用米，滚动速度用每秒弧长比例。
      float opacity=v<.45?.97:(v<.75?.50:.20);
      float pinkEdge=edge>0.?edge+.10/width:0.;
      vec3 c=v<edge?ivory:(v<pinkEdge?pink:(v>.91?ink:red));
      if(v>=pinkEdge)c=mix(c,plum,.27*smoothstep(.31,.50,abs(u-.5)));
      float time=max(0.,state.y);
      float shift=3.15*min(time,.10)+.38*max(0.,time-.10);
      for(int j=0;j<3;j++){
        float i=float(j),span=.34+.15*i;
        float run=fract(along-shift+.31*i+.06*state.z);
        float across=.263+.076*i+.012*sin(10.*u+i+.45*shift);
        float taper=smoothstep(0.,.08,min(run,span-run));
        float meters=.033+.003*i;
        if(v<.45 && run<span && abs(v-across)*width<.5*meters*taper && v>=pinkEdge)
          c=mod(i,2.)<.5?vec3(1.,122./255.,154./255.):ink;
      }
      if(head<1. && head-along<.024)c=pink;
      paint(c,opacity,v>=edge && v<pinkEdge?.05:0.);
    }else{
    vec3 c=v<edge?ivory:(v<.34+wobble?pink:(v<.81+wobble?red:ink));
    if(v>=edge && v<.80+wobble)c=mix(c,plum,.52*smoothstep(.27,.49,abs(u-.5)));
    // 窄笔锋只用相邻色阶。亮刃和整条暗边保持完整。
    float s1=(u-.34-.035*pulse)/.22, s2=(u-.72+.028*pulse)/.16;
    float fleck=.41+.055*sin(13.*u+state.z)-.012*pulse;
    if(abs(s1)<1. && abs(v-fleck)<.024*(1.-s1*s1))c=pink;
    if(abs(s2)<1. && abs(v-(.73+.058*s2))<.030*(1.-s2*s2))c=plum;
    float headBand=head-along;
    if(head<1.005 && headBand<.046)c=headBand<.017?ivory:pink;
    if(v>.95)c=ink;
    paint(c,.985,v<edge?.055:0.);
    }
  }
}
`, `band=lane;local.x=widthM;local.y=strandUv;
if(lane>.5){p.y+=.085*strandUv*sin(lane*1.2+strandUv*5.-state.y*20.);}`, 'attribute float lane,strandUv,widthM;');
export function blade(ctx: FxCtx, order = 10, small = false) {
    const result = piece(ctx, small ? mini : ctx.lite ? lite : full, bladeMat, order);
    result.extra.y = small ? 0 : 1;
    return result;
}
function bladeChips(count: number) {
    const list: Splinter[] = [];
    for (let i = 0; i < count; i++) {
        const gold = i % 7 === 6, tip = i % 3 === 0;
        const u = tip ? (i % 2 ? .015 : .985) : .11 + .78 * ((i * .61803) % 1);
        const start = section(u, tip ? .65 : .94);
        const travel = vec((u - .5) * 1.5, .18 + .21 * Math.sin(i), -.32 - .54 * ((i * .41) % 1)).normalize().multiplyScalar(.42 + .92 * ((i * .399) % 1));
        list.push({ start, travel, length: gold ? .29 : .15 + .20 * ((i * .52) % 1), width: gold ? .029 : .09 + .065 * ((i * .71) % 1), gold, delay: .015 + .068 * ((i * .43) % 1) });
    }
    return splinterGeometry(list);
}
const fragments = [bladeChips(14), bladeChips(7)];
export const edgeChips = (ctx: FxCtx) => chips(ctx, fragments[ctx.lite ? 1 : 0]);
const ghostMat = brush(plane, `
float edge=abs(band);
float scratch=grain(vec2(local.y*5.9,local.x*1.3+local.z*.42));
if(scratch+.36*(1.-local.y/3.4)<state.w) discard;
vec3 c=edge<.27?pink:(edge<.61?red:ink);
paint(c,state.y,0.);
`, 'band=normalize(normalMatrix*normal).z;');
ghostMat.side = THREE.FrontSide;
const poses = new WeakMap<THREE.Object3D, THREE.BufferGeometry[]>();
export function prepareGhosts(actor: LabActor) {
    if (poses.has(actor.hero.model))
        return;
    const model = clone(actor.hero.model), mixer = new THREE.AnimationMixer(model);
    const shapes: THREE.BufferGeometry[] = [];
    for (const [j, name] of ["attack1", "attack2"].entries()) {
        mixer.stopAllAction();
        const clip = actor.hero.clips.get(name);
        if (clip) {
            mixer.clipAction(clip).play();
            mixer.update(clip.duration * (j ? .47 : .38));
        }
        model.updateMatrixWorld(true);
        const vertices: number[] = [], indices: number[] = [];
        model.traverse(o => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || mesh.name === "outline")
                return;
            const base = vertices.length / 3, geometry = mesh.geometry, v = vec();
            for (let i = 0; i < geometry.attributes.position.count; i++) {
                mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
                vertices.push(v.x, v.y, v.z);
            }
            const indx = geometry.index;
            for (let i = 0; i < (indx?.count ?? geometry.attributes.position.count); i++)
                indices.push(base + (indx ? indx.getX(i) : i));
        });
        const neck = vec();
        const socket = model.getObjectByProperty("name", actor.hero.bone("Neck")?.name ?? "Neck");
        if (socket) {
            socket.getWorldPosition(neck);
            const start = vertices.length / 3;
            for (let i = 0; i <= 12; i++) {
                const u = i / 12, width = (.095 + .10 * Math.sin(Math.PI * u)) * (1 - u ** 4);
                for (const [side, ridge] of [[-1, 0], [1, 0], [.22, .55]]) {
                    vertices.push(neck.x + .71 * u + .23 * Math.sin(u * 6.) + side * width, neck.y + .28 * u + .14 * Math.sin(5 * u) + (side * .51 + ridge) * width, neck.z - 1.75 * u);
                }
                if (i) {
                    const n = start + i * 3;
                    for (let k = 0; k < 3; k++) {
                        const a = n + k, b = n + (k + 1) % 3;
                        indices.push(a - 3, b - 3, a, a, b - 3, b);
                    }
                }
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        shapes.push(g);
    }
    mixer.uncacheRoot(model);
    poses.set(actor.hero.model, shapes);
    prepareRim(actor);
}
export function echo(ctx: FxCtx, actor: LabActor, pose: number) {
    return piece(ctx, poses.get(actor.hero.model)![pose % 2], ghostMat, 7);
}
const rimMat = new THREE.ShaderMaterial({
    uniforms: { opacity: { value: 1 } }, side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `
    #include <common>
    #include <skinning_pars_vertex>
    void main(){
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 view=modelViewMatrix*vec4(transformed,1.);
      view.xyz+=normalize(normalMatrix*objectNormal)*.065;
      gl_Position=projectionMatrix*view;
    }`,
    fragmentShader: `uniform float opacity;void main(){gl_FragColor=vec4(1.,.302,.478,opacity);}`
});
const outlines = new WeakMap<THREE.Object3D, {
    skin: THREE.SkinnedMesh;
    shell: THREE.SkinnedMesh;
}[]>();
function prepareRim(actor: LabActor) {
    const parts: {
        skin: THREE.SkinnedMesh;
        shell: THREE.SkinnedMesh;
    }[] = [];
    actor.hero.model.traverse(o => {
        const skin = o as THREE.SkinnedMesh;
        if (!skin.isSkinnedMesh || skin.name === "outline")
            return;
        const shell = new THREE.SkinnedMesh(skin.geometry, rimMat);
        shell.bind(skin.skeleton, skin.bindMatrix);
        shell.frustumCulled = false;
        shell.renderOrder = 9;
        parts.push({ skin, shell });
    });
    outlines.set(actor.hero.model, parts);
    if (parts.length)
        warmSkins.set(rimMat, parts[0].shell);
}
export function arrivalRim(ctx: FxCtx, actor: LabActor) {
    const parts = outlines.get(actor.hero.model)!;
    let age = 0;
    for (const { skin, shell } of parts) {
        skin.add(shell);
        shell.onBeforeRender = () => { rimMat.uniforms.opacity.value = 1 - .65 * (age / .10); rimMat.uniformsNeedUpdate = true; ctx.onFxDraw?.(0); };
    }
    return { update(dt: number) { age += dt; return age < .10; }, dispose() {
            for (const { shell } of parts)
                shell.removeFromParent();
        } };
}
