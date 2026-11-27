// 关键建筑的材质（阶段 2.7；换画风 B · b-build 按 B 的色板重调）。建筑的模型只带形状和顶点色，材质在这里统一换成项目自己的一套：
// 石头、金属用的就是墙上那种按世界坐标投影的贴图（B 起换成 b-walls 画的干净贴图 *_b.webp），所以塔、水晶、出生点和周围的墙、地面是一家的。
// 模型里每个网格的材质名决定它用哪一种：stone 石头，metal 金属（我方青铜、对方暗铁），accent 点缀（我方金边、对方赤陶），
// crystal 晶体，glow 发光的芯和嵌条，water 水（对方是余烬槽）。认不出名字的一律当石头。

import * as THREE from "three";
import { rippleNormal } from "../slice/ripple";
import { stoneMaterial, texB, type StoneTextures } from "../slice/stone";

/** 水池、水槽的时间（入口每帧更新）。水面上的细碎粼光和河面是同一套算法（2.8：粼光铺到所有水面） */
export const kitTime = { value: 0 };
/** 镂空（阶段 4）：塔和水晶很高，英雄走到它们背后会被整个挡住。挡在镜头和英雄之间的那部分，在英雄周围一圈里抽掉大部分像素，看得见后面。
 *  xy 是英雄在画面上的位置（像素），z 是英雄离镜头多远，w 是圈的半径（像素）；w 为 0 就是关掉。每帧由主循环更新 */
export const kitSee = { value: new THREE.Vector4(0, 0, 0, 0) };
export function seeThrough(m: THREE.Material) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();      // 先把原来的着色器标识取出来：包了一层以后默认的标识都一样，不同材质会错用同一份着色器
  m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.uniforms.uSee = kitSee;
    sh.fragmentShader = "uniform vec4 uSee;\n" + sh.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
      if (uSee.w > 0.0 && vViewPosition.z < uSee.z - 2.5) { float d_ = distance(gl_FragCoord.xy, uSee.xy), n_ = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (n_ > 0.1 + 0.9 * smoothstep(uSee.w * 0.55, uSee.w, d_)) discard; }`); };
  m.customProgramCacheKey = () => key + "-see";
}
function poolWater(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: kitTime, uRipple: { value: rippleNormal() }, uSunDir: { value: new THREE.Vector3(-0.42, 0.78, -0.46).normalize() }, uSunColor: { value: new THREE.Color(0xfff4e0) }, uTint: { value: new THREE.Color(0x5fc2c4) }, uSky: { value: new THREE.Color(0xd4eef0) } },
    vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `precision highp float; uniform float uTime; uniform sampler2D uRipple; uniform vec3 uSunDir, uSunColor, uTint, uSky; varying vec3 vW;
      float h21(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 q){ vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec2 p = vW.xz;      // 池子小，水纹比河面细
        vec4 r1 = texture2D(uRipple, p * 0.34 + uTime * 0.03), r2 = texture2D(uRipple, p * 0.8 - vec2(uTime * 0.045, -uTime * 0.04) + 0.37), r3 = texture2D(uRipple, p * 1.9 + uTime * 0.07 + 0.11);
        vec3 n = normalize(vec3((r1.xy * 2.0 - 1.0) * 0.5 + (r2.xy * 2.0 - 1.0) * 0.42 + (r3.xy * 2.0 - 1.0) * 0.36, 1.0)).xzy;
        vec3 V = normalize(cameraPosition - vW); float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 col = mix(uTint, uSky, fres * 0.4); float alpha = mix(0.42, 0.8, fres * 0.5);
        float sh = dot(n.xz, normalize(vec2(-0.6, -0.5))); col *= 1.0 + sh * 0.6; alpha = clamp(alpha + abs(sh) * 0.3, 0.0, 0.95);
        vec3 H = normalize(V + uSunDir), H2 = normalize(V + normalize(vec3(0.5, 0.8, -0.34))); float nh = max(dot(n, H), 0.0), nh2 = max(dot(n, H2), 0.0);
        float cl = smoothstep(0.3, 0.62, vn(p * 0.6 + uTime * 0.04) * 0.6 + vn(p * 1.6 - uTime * 0.03) * 0.4);
        float glint = min((pow(nh, 340.0) * 1.2 + pow(nh2, 400.0) * 0.7) * (0.2 + cl * 0.9) + pow(nh, 60.0) * 0.02, 0.9);
        col += uSunColor * glint; alpha = max(alpha, min(glint * 1.5, 0.95));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export type KitMats = Record<"stone" | "metal" | "accent" | "crystal" | "glow" | "water", THREE.Material>;
export type KitKind = keyof KitMats;
const cache = new Map<number, KitMats>();

/** 画风 B 的干净贴图的平均亮度（tools/bwalls_tex.py 打出来的，和 slice/stone.ts 的 B_MEAN 一样），材质拿它把贴图归一成“只管明暗起伏” */
const B_MEAN = { stone_me_b: 0.72, stone_foe_b: 0.718, bronze_me_b: 0.633, iron_foe_b: 0.5 };
/** 画风 B 的建筑颜色（反照率，sRGB；设计稿 tower-me / tower-foe / core-* / spawn-* 和 docs/style_b/STYLE.md 的色板，对着 kit.html 的截图调的）。
 *  我方：浅灰白石、铜绿青铜、金色细包边；对方：深灰偏一点暖紫的玄武岩、带紫褐的暗铁、赤陶饰带 */
export const KIT_B = {
  stone: [0xdcdbca, 0x8c7a78], metal: [0x63bc9c, 0x7a6b6a], accent: [0xcfb36a, 0xa25a3c], moss: [0x7da234, 0x9a5a2c],
};

/** 晶体的参数（调试用 ?kitc=键:值,…）：em 自发光的强度（我方 / 对方），dk 漫反射留多少（越小越饱和、越不发白），fr 侧棱往深色过渡的快慢 */
const KC: Record<string, number> = { em0: 0.78, em1: 0.8, dk0: 0.22, dk1: 0.18, fr: 0.75 };
for (const kv of (typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("kitc") ?? "").split(",")) { const [k, v] = kv.split(":"); if (k && v !== undefined && Number.isFinite(+v)) KC[k] = +v; }

export function kitMaterials(_tex: StoneTextures, team: number): KitMats {
  if (cache.has(team)) return cache.get(team)!;
  const me = team === 0, k = me ? 0 : 1;
  const st = texB(me ? "stone_me_b" : "stone_foe_b"), tr = texB(me ? "bronze_me_b" : "iron_foe_b"), stMean = me ? B_MEAN.stone_me_b : B_MEAN.stone_foe_b, trMean = me ? B_MEAN.bronze_me_b : B_MEAN.iron_foe_b;
  // 晶体（B）：干净的几个大切面，正对镜头的面是亮的芯色（我方浅青白、对方金黄），斜着的面和棱是深一档的阵营色（我方青蓝、对方橙红）。
  // 不再是 A 那种深色、看得进去的玻璃：B 的设计稿里晶体是整张图最亮、最饱和的东西
  const core = me ? new THREE.Color(0x48f2f2) : new THREE.Color(0xff8c2c), edge = me ? new THREE.Color(0x0a8fc6) : new THREE.Color(0xd82e10);
  const crystal = new THREE.MeshStandardMaterial({ color: edge.clone().lerp(new THREE.Color(1, 1, 1), 0.15), emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.3, metalness: 0, flatShading: true, transparent: true, opacity: 0.96, vertexColors: true });
  crystal.onBeforeCompile = sh => {
    sh.uniforms.uCore = { value: core }; sh.uniforms.uEdge = { value: edge };
    sh.fragmentShader = "uniform vec3 uCore, uEdge;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      { float fr_ = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 1.3); float up_ = clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
        totalEmissiveRadiance = mix(uCore, uEdge, smoothstep(0.08, ${KC.fr.toFixed(3)}, fr_)) * (${KC[me ? "em0" : "em1"].toFixed(3)} + up_ * 0.12) * vColor.r; diffuseColor.rgb *= ${KC[me ? "dk0" : "dk1"].toFixed(3)} + fr_ * 0.25; }`);
  };
  crystal.customProgramCacheKey = () => "kit-crystal-b" + team + JSON.stringify(KC);
  const glowC = me ? new THREE.Color(0x3fe6ee) : new THREE.Color(0xff7a32);
  const stoneB = { keepTex: true, mossEdge: [0.66, 0.7] as [number, number] };
  const m: KitMats = {
    // 石头：和 b-walls 的墙同一套贴图和做法（贴图的起伏压淡、大斑很淡、上沿一圈提亮）；我方压顶上偶尔一小块干净的亮绿苔，对方不长
    stone: stoneMaterial(st, { ...stoneB, scale: 0.21, mean: stMean, chroma: me ? 0.6 : 0.15, gain: me ? 0.55 : 0.5, mottle: me ? 0.16 : 0.16, color: KIT_B.stone[k], moss: me ? 0.45 : 0, mossColor: KIT_B.moss[k], dirt: me ? 0.12 : 0.08, rim: me ? 0.1 : 0.35 }),
    // 金属：游戏里没有环境反射，金属度压到 0.1（再高就发黑）。我方铜绿青铜是一条条明亮干净的整块厚片；对方暗铁偏紫褐，亮面要看得出是铁不是一团黑
    metal: stoneMaterial(tr, { ...stoneB, scale: 0.35, mean: trMean, chroma: me ? 0.9 : 0.3, gain: 0.45, mottle: 0.1, color: KIT_B.metal[k], rough: 0.55, metal: 0.1, moss: 0, rim: me ? 0.16 : 0.32 }),
    accent: new THREE.MeshStandardMaterial({ color: KIT_B.accent[k], roughness: me ? 0.5 : 0.8, metalness: me ? 0.1 : 0, vertexColors: true }),
    crystal,
    glow: new THREE.MeshStandardMaterial({ color: glowC.clone().multiplyScalar(0.6), emissive: glowC, emissiveIntensity: me ? 0.85 : 0.9, roughness: 0.5, metalness: 0, vertexColors: true }),
    // 水：我方是清水，带河面那样的细碎粼光（B：青蓝、透亮）；对方是余烬槽（暗红里一点克制的微光，不是一条亮橙色的带子）
    water: me ? poolWater()
              : new THREE.MeshStandardMaterial({ color: 0x4a1f12, emissive: 0xc0441a, emissiveIntensity: 0.45, roughness: 0.6, metalness: 0 }),
  };
  for (const k of ["stone", "metal", "accent", "crystal", "glow"] as const) seeThrough(m[k]);
  cache.set(team, m); return m;
}

/** 把一个载入的建筑模型换成项目的材质。返回里面要转的部件（名字以 crystal 或 ring 开头的节点） */
export function applyKit(root: THREE.Object3D, tex: StoneTextures, team: number): { spin: THREE.Object3D[]; tris: number } {
  const mats = kitMaterials(tex, team), spin: THREE.Object3D[] = []; let tris = 0;
  root.traverse(o => {
    const n = o.name.toLowerCase(); if (n.startsWith("crystal") || n.startsWith("ring")) spin.push(o);
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    const g = mesh.geometry, key = ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? "").toLowerCase();
    const kind = (["metal", "accent", "crystal", "glow", "water", "stone"] as const).find(k => key.startsWith(k)) ?? "stone";
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (!g.getAttribute("color")) g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(1), 3));      // 没给顶点色的当成全白，不然是黑的
    mesh.material = mats[kind]; mesh.castShadow = kind !== "water" && kind !== "glow"; mesh.receiveShadow = kind !== "crystal" && kind !== "glow";
    tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3;
  });
  return { spin, tris: Math.round(tris) };
}
