// 英雄（阶段 3）：把整理好的模型（tools/blender/hero_build.py 的产出）放进地图，播动作。
// 模型按管线的约定是身高 1、面朝 +Z（glTF 里），这里整体放大到游戏里的身高。
// 画面上做三件事，都是照 Dota 2 对标清单里英雄那一类来的：
//   · 提亮：英雄要比脚下的地面亮一档、饱和度高一档（B3）。深色的衣服在着色里抬一点暗部。
//   · 边缘光：背光一侧勾一道冷色的亮边，把轮廓从地面上托出来（B6）。
//   · 发光：贴图里青色的纹路自己会亮，是全身最亮的地方（B7）。不另加点光，不算进地图的发光预算。
// 队伍归属靠脚下的细圈和头顶的血条（血条现在只是占位，阶段 4 做正式的）。

import { TOON_ON, T } from "../toon";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { TOUCH, loadGLB } from "../quality";
import { FXB } from "../game/fxb";
import { createScarf } from "./scarf";

/** height 连头冠的身高（米）；lift 提亮；sat 饱和度；fill 只照英雄的一盏跟着镜头的补光；rim 边缘光；glow 青色纹路的亮度；head、hand 头和手的放大 */
export interface HeroLook { height: number; lift: number; sat: number; fill: number; rim: number; glow: number; metal: number; rough: number; bump: number; head: number; hand: number; ring: number; bar: number; }
/** 伊缇（第三阶段 iti-model）：scarf 有值就在脖子后面挂两条代码模拟的围巾飘带（hero/scarf.ts），数值是长度倍数。老英雄的 look 里没有它，什么都不挂。单独再声明一次（接口合并），上面那行原样不动 */
export interface HeroLook { scarf?: number; }
export const LOOK: HeroLook = { height: 3.1, lift: 1.4, sat: 1.3, fill: 0.5, rim: 1.2, glow: 1.0, metal: 0.15, rough: 1.0, bump: 0.5, head: 1, hand: 1, ring: 1, bar: 0 };      // ring：脚下的圈和影子放大几倍（四足的大个子要大一点）。head、hand 原来写的是 1.18 和 1.3，但导出的动作每根骨骼都带缩放，一播动作就被冲回 1，从来没生效过；用户看到并验收的一直是 1 倍，所以改成 1，免得哪天“修好”了反而把样子改了

export interface PlayOpts { fade?: number; loop?: boolean; speed?: number; }
export interface Hero {
  group: THREE.Group;                                     // 放位置、转朝向用这个
  model: THREE.Object3D; marks: THREE.Group; mixer: THREE.AnimationMixer; clips: Map<string, THREE.AnimationClip>;
  current: string;
  /** 换动作。loop 不写就是循环；一次性的动作播完停在最后一帧，并触发 onFinish */
  play: (name: string, opts?: PlayOpts) => void;
  setSpeed: (k: number) => void;                          // 当前动作的播放速度
  time: () => number;                                     // 当前动作播到第几秒
  onFinish: ((name: string) => void) | null;
  setVeil: (k: number) => void;                           // 0 正常，1 隐身（半透明、轮廓发青）
  setHide: (k: number) => void;                           // 0 正常，1 躲在草丛里（自己看是半透明的）
  setLife: (ratio: number, max?: number, level?: number, mana?: number, status?: string, shield?: number) => void;
  bone: (name: string) => THREE.Object3D | undefined;
  /** 一把刀现在的位置（世界坐标）：base 靠近护手，tip 刀尖。side 是 "L" 或 "R"。刀光用 */
  blade: (side: string, base: THREE.Vector3, tip: THREE.Vector3) => boolean;
  update: (dt: number, camDist?: number) => void;        // camDist 镜头离得多远：贴近看的时候不显示血条
  /** 受击闪白（第九轮）：被打中的那一下整个人亮一下白，0.12 秒退掉。k 是多亮（0～1） */
  hit?: (k?: number) => void;
  /** iti-fx3 新加：整个人闪一下（不只亮轮廓）。k 多满（0～1），color 闪成什么颜色（默认白热偏绯），约 0.1 秒退掉。和 hit 各管各的，可以一起用。老的技能不调它就没有任何变化 */
  hitWhole?: (k?: number, color?: number) => void;
  /** iti-fx3 新加：连头冠的身高（米），特效按它找胸口、头顶 */
  height?: number;
  /** 第九轮 ui2：告诉头顶血条英雄叫什么、是不是玩家自己（自己的血条绿、脚下亮绿圈；队友蓝；对方红，照 LoL）。self 每帧问一次：观战时谁都不算“自己” */
  tag?: (name: string, self: () => boolean) => void;
  tris: number;
}

const RIM = [new THREE.Color(0.62, 0.9, 1.0), new THREE.Color(1.0, 0.72, 0.5), new THREE.Color(0.86, 0.86, 0.8)];           // 我方冷、对方暖、中立（野怪）偏白
const RING = [new THREE.Color(0x5cb4ff), new THREE.Color(0xff5a48)], SELF_RING = new THREE.Color(0x7dff7a);      // 脚下的圈（第九轮 ui2 照 LoL）：队友蓝、对方红、自己亮绿
const RING_DEEP = [new THREE.Color(0x0d3d86), new THREE.Color(0x7a160e)], SELF_DEEP = new THREE.Color(0x0f5524);      // 换画风 B：圈底下的描边，同色系深一档

/** 换画风 B（b-lan 定的，第二批每个角色照着用）：卡通厚涂的新模型怎么着色。
 *  认法：材质名以 _b 结尾（tools/blender/hero_build.py 的 build.json 写 "body_material": "hero_b"，武器材质叫 weapon_b）。资源自己带着画风：
 *  还没换的老模型（材质名 hero / weapon）走原来的厚涂处理，一点不变；把 lan.glb 换回 v9-painted 的旧文件也自动回到旧处理。
 *  和厚涂版的区别（为什么）：
 *   · 不要凹凸、不要金属和粗糙度贴图：Tripo 照卡通设定图出的贴图里已经画好了明暗和高光（王者式卡通厚涂的做法），法线贴图只会把手绘的大块明暗打碎成细碎的写实起伏
 *   · 提亮照旧、饱和度压回去：量过 Tripo 出的贴图比设定图暗约两成（海军蓝 29,50,83 对 40,65,98），提亮 1.4 照旧刚好补回来；厚涂版另加的三成饱和度会把海军蓝冲成电光蓝，B 乘 0.7（量出来游戏里骨白 206,196,178、设定图 205,202,176）
 *   · 分阶光的交界软一点（STYLE.md 3.2：“分阶光但阶数弱”）：地面、墙的交界是硬的，人身上硬交界会切出一块块怪影子
 *   · 边缘光换成顺光一侧一道窄的亮边（STYLE.md 3.1 第 5 条）：亮地面上英雄靠这一圈亮从地面里跳出来；原来那道宽的、整圈的冷色光是给暗地面设计的
 *  ?hb=键:值 临时改，调试用。lift / sat 乘在厚涂版的提亮、饱和度上（Tripo 出的贴图比设定图暗两成，提亮照旧；饱和度厚涂版加了三成，B 的海军蓝会冲成电光蓝，乘 0.7 回到 0.9 左右），fill 是补光乘几，edge / soft 是分阶光交界的位置和软边，rim 边缘亮边多亮、rimA / rimB 亮边从多靠外开始到哪里满、rimT 亮边带多少队伍色 */
export const HB: Record<string, number> = { lift: 1.0, sat: 0.7, fill: 0.6, edge: 0.0, soft: 0.28, rim: 0.8, rimA: 0.52, rimB: 0.78, rimT: 0.35, rough: 1.0 };
for (const kv of (new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("hb") ?? "").split(",")) { const [k, v] = kv.split(":"); if (k && v !== undefined && Number.isFinite(+v)) HB[k] = +v; }
export const isB = (m: THREE.Material) => /_b(_\d+)?$/.test(m.name);

/** 角色材质的统一处理。shift 为 1 时把青绿的涂装换成对方的暗铁加余烬色（小兵两方共用一个模型，靠这个区分） */
export function tune(mat: THREE.MeshStandardMaterial, team: number, look: HeroLook, weapon: boolean, veil: { value: number }, hide: { value: number }, shift = 0, hit: { value: number } = { value: 0 }, hitW: { value: THREE.Vector4 } = { value: new THREE.Vector4(1, 1, 1, 0) }) {
  const B = isB(mat);
  mat.metalness = look.metal; mat.roughness = look.rough; mat.envMapIntensity = 0; mat.normalScale.setScalar(look.bump * (TOON_ON ? T.heroBump : 1));      /* stylecost 试验：卡通档凹凸压到三成（b-toon：英雄材质这一批不动，默认 1，toonp=heroBump:0.3 预览） */
  if (B) { mat.metalness = 0; mat.metalnessMap = null; mat.roughness = HB.rough; mat.roughnessMap = null; mat.normalMap = null; }      // B：明暗和高光都画在贴图里了，见上面 HB 的说明
  const rimB = new THREE.Color(1.0, 0.97, 0.9).lerp(RIM[team], HB.rimT).multiplyScalar(HB.rim * look.rim / LOOK.rim);
  const u = { uRim: { value: B ? rimB : RIM[team].clone().multiplyScalar(look.rim) }, uGlow: { value: look.glow }, uLift: { value: B ? look.lift * HB.lift : look.lift * (TOON_ON ? T.heroLift : 1) }, uSat: { value: B ? look.sat * HB.sat : look.sat * (TOON_ON ? T.heroSat : 1) }, uFill: { value: look.fill * (B ? HB.fill : 1) }, uVeil: veil, uHide: hide, uShift: { value: shift }, uHit: hit, uHitW: hitW };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    if (B && TOON_ON) sh.fragmentShader = sh.fragmentShader.replace("#include <lights_physical_pars_fragment>", THREE.ShaderChunk.lights_physical_pars_fragment      // 分阶光的交界：只给这个材质换一个软的（toon.ts 里那份是地面、墙用的硬交界）
      .replace(/float toonRamp_\( float nl \) \{[^}]*\}/, `float toonRamp_( float nl ) { return mix( ${T.dark.toFixed(4)}, 1.0, smoothstep( ${(HB.edge - HB.soft).toFixed(4)}, ${(HB.edge + HB.soft).toFixed(4)}, nl ) ); }`));
    sh.fragmentShader = ("uniform vec3 uRim; uniform float uGlow, uLift, uSat, uFill, uVeil, uHide, uShift, uHit; uniform vec4 uHitW;\n" + sh.fragmentShader)
      // 颜色：抬暗部、加一点饱和度；青色的纹路记下来，后面让它自己亮
      .replace("#include <map_fragment>", `#include <map_fragment>
        ${TOON_ON ? `#ifdef USE_MAP
          { vec4 tb_ = texture2D(map, vMapUv, ${T.heroBias.toFixed(2)}); diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * tb_.rgb, ${T.heroBlur.toFixed(2)}); }      // 卡通档：混一层模糊的贴图，压掉细碎的磨损和笔触
        #endif` : ""}
        float glow_ = smoothstep(0.10, 0.34, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r * 1.2);
        ${B ? "float tB_ = smoothstep(0.3, 0.45, (min(diffuseColor.g, diffuseColor.b) - diffuseColor.r) / max(max(diffuseColor.g, diffuseColor.b), 0.02));      /* B 的换色区：按“青蓝有多纯”认（Tripo 贴图里的钢是偏冷的灰，绝对差 0.02–0.08 和布片 0.08–0.2 挨得太近，比值钢 0.1–0.25、布片 0.4–0.6 分得开） */" : `if (uShift > 0.5) { vec3 c0_ = diffuseColor.rgb; float l0_ = dot(c0_, vec3(0.3, 0.55, 0.15)), t_ = smoothstep(0.02, 0.16, min(c0_.g, c0_.b) - c0_.r);
          vec3 iron_ = vec3(l0_) * vec3(0.95, 0.86, 0.82) * 0.82, warm_ = vec3(l0_ * 1.35, l0_ * 0.5, l0_ * 0.3);
          diffuseColor.rgb = mix(iron_, warm_, max(t_ * 0.75, glow_)); }`}
        { vec3 c_ = diffuseColor.rgb; float l_ = dot(c_, vec3(0.3, 0.55, 0.15));
          c_ = mix(vec3(l_), c_, uSat); c_ = c_ * uLift + (uLift - 1.0) * 0.06 * (1.0 - l_); diffuseColor.rgb = c_; }
        ${B ? `if (uShift > 0.5) { float lB_ = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)); diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.9, 0.86, 0.84), lB_ * vec3(2.4, 0.42, 0.28), tB_); }
        else if (uShift < -0.5) { float lB_ = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15)); diffuseColor.rgb = mix(diffuseColor.rgb, lB_ * vec3(0.32, 1.0, 2.15), tB_ * 0.7); }      // 我方的小兵（view.ts 传 -1）：青蓝那一块也把饱和度补回来一点，不然被 B 的 0.7 压成灰蓝，和对方的红比弱一截      // 换画风 B（w-unit）：小兵两队共用模型，对方只把青蓝那一块换成余烬红（同样亮、饱和度在调色之后给，不被 B 的 0.7 冲淡），别处原样只暗一点、偏暖一点。老模型那套“整个换成暗铁”会把 B 的盾、布片压成一块黑灰` : ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * glow_ * uGlow * 2.2;`)
      // 边缘光：越靠轮廓越亮，朝上、背着镜头的那一侧最亮。隐身时身体变淡，只剩一圈青色的轮廓
      .replace("#include <opaque_fragment>", `{
          vec3 n_ = normalize(nonPerturbedNormal), v_ = normalize(vViewPosition);      // 用没加凹凸的法线：边缘光是一条干净的线，不跟着贴图的细节闪
          float fr_ = pow(1.0 - clamp(dot(n_, v_), 0.0, 1.0), 3.0);
          outgoingLight += diffuseColor.rgb * uFill * (0.35 + 0.65 * clamp(dot(n_, normalize(vec3(0.35, 0.55, 0.76))), 0.0, 1.0));      // 补光：从镜头右上方照过来，只照英雄
          ${B ? `#if NUM_DIR_LIGHTS > 0
            float lit_ = dot(n_, directionalLights[ 0 ].direction);      // 太阳（投影子的那盏排在第一个）在视空间里的方向
          #else
            float lit_ = 1.0;
          #endif
          outgoingLight += uRim * smoothstep(${HB.rimA.toFixed(3)}, ${HB.rimB.toFixed(3)}, 1.0 - clamp(dot(n_, v_), 0.0, 1.0)) * smoothstep(-0.2, 0.45, lit_) * ${weapon ? "0.6" : "1.0"};      // B：顺光一侧一道窄的亮边` : `outgoingLight += uRim * fr_ * (0.25 + 0.75 * clamp(n_.y * 0.7 + 0.45, 0.0, 1.0)) * ${weapon ? "0.7" : "1.0"};`}
          float e_ = pow(1.0 - clamp(dot(n_, v_), 0.0, 1.0), 1.6);
          outgoingLight = mix(outgoingLight, ${FXB.on ? "vec3(0.02, 0.33, 0.55) * (0.45 + 1.25 * e_)" : "vec3(0.25, 0.85, 0.9) * (0.25 + 1.3 * e_)"}, uVeil * 0.85);      // 换画风 B（b-fx）：隐身的水影是海蓝、轮廓亮（浅青白的水影在亮地面上是一个白剪影）
          outgoingLight = mix(outgoingLight, vec3(1.0, 0.97, 0.92) * (0.6 + 0.6 * e_), uHit * (0.08 + 0.34 * e_));      // 受击闪白（第九轮）：不要整个变白，亮一层就够。polish-lib 压一档：原来整个人一样亮（普攻 18%、大招 30%），现在亮在轮廓上（脸朝镜头的地方最多 8%、轮廓 42%），按伤害占血量的比例给 uHit；实测假人身上平均亮度的抬升：普攻那一下 +19 → 约 +4，掉两成血的大招 +48 → 约 +23
          outgoingLight = mix(outgoingLight, uHitW.rgb * (0.8 + 0.7 * e_), uHitW.a * (0.62 + 0.38 * e_));      // iti-fx3 新加：整个人闪一下（hitWhole）。uHitW.a 平时是 0，这一行不起作用
          diffuseColor.a *= mix(1.0, 0.16 + 0.6 * e_, uVeil) * (1.0 - 0.45 * uHide);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `hero${team}${weapon ? "w" : "b"}${shift}${B ? "B" : ""}`;
  mat.needsUpdate = true;
}

/** 脚下的圈和一小片接地的暗影。第九轮 ui2 照 LoL / 王者荣耀的习惯分三种：
 *  自己——一圈亮绿的粗圈，圈里一层很淡的绿，正前方一小段亮弧指着朝向（王者荣耀的做法：混战里一眼找到自己、看得出脸朝哪）；
 *  队友——细的蓝圈，压低一点；对方——细的红圈。是不是“自己”要等 tag() 告诉（模型载入时还不知道），所以三样都先建好，update 里切 */
function footMarks(team: number): { g: THREE.Group; self: (on: boolean) => void } {
  const g = new THREE.Group(), flat = (m: THREE.Mesh, y: number, order: number) => { m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = order; return m; };
  const mat = (o: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...o });
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c = cv.getContext("2d")!;
  const sh = FXB.on ? "8,34,40" : "0,0,0";      // 换画风 B（b-fx）：接地的影子是偏冷的深青（B 的影子有颜色，不是黑的）
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, `rgba(${sh},0.55)`); gr.addColorStop(0.55, `rgba(${sh},0.28)`); gr.addColorStop(1, `rgba(${sh},0)`); c.fillStyle = gr; c.fillRect(0, 0, 128, 128);
  g.add(flat(new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), 0.03, 2));
  // 换画风 B：亮石板上细的蓝圈、红圈很淡，亮草地上亮绿的圈和草是一个颜色。三种圈都垫一道同色系深一档的描边（王者荣耀亮场景里脚下圈的做法），圈本身略粗、不走色调映射（颜色不被压灰）
  const B = FXB.on, tm = B ? { toneMapped: false } : {};
  const ringDeep = B ? flat(new THREE.Mesh(new THREE.RingGeometry(0.81, 0.915, 64), mat({ color: RING_DEEP[team], opacity: 0.8 })), 0.039, 3) : null; if (ringDeep) g.add(ringDeep);
  const ring = flat(new THREE.Mesh(new THREE.RingGeometry(B ? 0.835 : 0.84, B ? 0.89 : 0.885, 64), mat({ color: RING[team], opacity: B ? 0.92 : team === 0 ? 0.6 : 0.78, ...tm })), 0.04, 3); g.add(ring);
  // 自己：圈里一层从边上往里淡掉的绿（不是一整块实心，不压地面），一道粗亮圈，正前方一段更亮的短弧
  const me = new THREE.Group(); me.visible = false; g.add(me);
  const cf = document.createElement("canvas"); cf.width = cf.height = 128; const f = cf.getContext("2d")!, fg = f.createRadialGradient(64, 64, 20, 64, 64, 64); fg.addColorStop(0, "rgba(120,255,140,0)"); fg.addColorStop(0.78, "rgba(120,255,140,0.10)"); fg.addColorStop(0.97, "rgba(150,255,160,0.26)"); fg.addColorStop(1, "rgba(150,255,160,0)"); f.fillStyle = fg; f.fillRect(0, 0, 128, 128);
  me.add(flat(new THREE.Mesh(new THREE.PlaneGeometry(1.84, 1.84), mat({ map: new THREE.CanvasTexture(cf) })), 0.035, 3));
  if (B) { me.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.76, 0.94, 72), mat({ color: SELF_DEEP, opacity: 0.85 })), 0.041, 4));      // 自己的圈底下一道深绿的描边：草地上也跳得出来
    me.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.91, 1.06, 24, 1, -Math.PI / 2 - 0.46, 0.92), mat({ color: SELF_DEEP, opacity: 0.85 })), 0.043, 4)); }
  me.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 72), mat({ color: SELF_RING, opacity: 0.95, ...tm })), 0.042, 4));
  me.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.93, 1.03, 24, 1, -Math.PI / 2 - 0.42, 0.84), mat({ color: 0xe6ffd8, opacity: 0.95, ...tm })), 0.044, 4));      // 模型面朝 +Z，圈躺平以后 +Z 是角度 -90°
  return { g, self: on => { me.visible = on; ring.visible = !on; if (ringDeep) ringDeep.visible = !on; } };
}

/** 头顶的血条（第九轮 ui2 照 LoL 的分级重做）：上面一行英雄名字（被控住时换成状态字，Dota 那样一眼看出是什么控），
 *  下面左边一个方的等级牌、右边血条，血条下面一条细的蓝条是法力。颜色照 LoL：自己绿、队友蓝、对方红；自己的整条再描一圈铜金边。
 *  血条每 250 血一道细刻度、每 1000 血一道粗刻度（血越厚刻度越密，一眼看得出肉不肉）；掉血时先留一截浅色再慢慢缩回去。
 *  小兵、野怪、塔的血条是另一套（view.ts 里合批画的），小得多、没有字。
 *  换画风 B（b-polish）：底、空槽、等级牌、字的描边从第九轮的黑换成界面那套深海蓝（uikit.ts 的 --ink、--line），自己那一圈铜金换成界面的亮金（上亮下深的渐变、外面压一道深蓝细线，
 *  和 uikit.ts 的金边九宫格一个画法）；三档分级、血条和法力的颜色、刻度、拖尾、护盾都没动（第九轮 ui2 定的语义）。 */
const STATUS_COLOR: Record<string, string> = { 眩晕: "#ffe7a0", 嘲讽: "#ffb9a0", 禁锢: "#cdeaa6", 沉默: "#dccbff", 减速: "#b4dcff", 击飞: "#ffe7a0", 隐身: "#bfeee8" };
/** 三种关系的配色：血条上中下三档、等级牌的边、名字的颜色。0 队友，1 对方，2 自己（自己的边是亮金，画的时候换成渐变，edge 只在没有渐变的地方用） */
const REL = [
  { hp: ["#9ad4ff", "#3d94ea", "#1f5cb4"], edge: "#7fb3e2", name: "#e0efff", lag: "rgba(230,244,255,0.9)" },
  { hp: ["#ff9a84", "#e2412f", "#a2231a"], edge: "#e58b7b", name: "#ffe0d9", lag: "rgba(255,236,226,0.9)" },
  { hp: ["#b4f584", "#4cbb35", "#2a8020"], edge: "#f3cd72", name: "#fff3cc", lag: "rgba(240,255,232,0.92)" },
];
/** 画风 B 的底色（和 uikit.ts 一家）：深蓝细线、深海蓝玻璃的上下两端、空槽、法力槽、刻度、字的描边 */
const BAR_INK = { line: "rgba(3,11,32,0.92)", glassTop: "rgba(30,62,116,0.95)", glassBot: "rgba(7,19,45,0.95)", slot: "rgba(9,24,54,0.96)", mslot: "rgba(6,16,38,0.96)", tick: "4,12,32", text: "rgba(6,19,49,0.9)" };
const GOLD = ["#fff4cf", "#f5d27a", "#e4b553", "#c4913c"];      // 亮金：上沿最亮、下沿深一档（uikit.ts 的 FRAME 那条渐变整体提亮一点：这里一道渐变跨了整条血条的高，照原样下半截发棕）
// ---- 头顶名字不叠（第九轮 polish-lib）：十个人挤在一起打的时候，名字那一行叠成一片、压在别人的血条上。
// LoL 的头顶默认就没有名字、只留血条和等级；这里保留名字，但挤的时候让：每帧按镜头把每个英雄的名字行、血条换算到屏幕上的框，
// 按“自己 → 被控住的（那一行写的是眩晕、沉默这类状态字，比名字要紧）→ 离镜头近的”排先后，后面的名字行只要压到前面已经留下的名字，或者压到别人的血条，就淡掉，只留血条。
// 分开了再淡回来（藏的时候框外扩 4 像素就算压到，回来要外扩 14 像素都不压才回，免得在边上一闪一闪）。
// 名字是血条那张图最上面一行，淡掉靠贴图着色器里把那一行的不透明度乘掉（每条血条自己一个数），不用重画、也不多一次绘制。
// 在血条自己的 onBeforeRender 里算（每画一帧只算一次）；画左上角头像那一遍开着裁剪，跳过。
type BarRec = { s: THREE.Sprite; nameU: { value: number }; a: number; row: () => number; status: () => boolean; self: () => boolean; on: boolean };
const BARS: BarRec[] = [];
let barFrame = -1, barT = 0;
const bv = new THREE.Vector3(), bq = new THREE.Vector3();
function declutter(r: THREE.WebGLRenderer, cam: THREE.Camera) {
  if (r.getScissorTest() || !(cam as THREE.PerspectiveCamera).isPerspectiveCamera) return;
  const f = r.info.render.frame; if (f === barFrame) return; barFrame = f;
  const now = performance.now(), dt = Math.min(0.1, (now - barT) / 1000); barT = now;
  const pc = cam as THREE.PerspectiveCamera, el = r.domElement, VW = el.clientWidth || el.width, VH = el.clientHeight || el.height, tanF = Math.tan(THREE.MathUtils.degToRad(pc.fov) / 2);
  const shown = (o: THREE.Object3D | null) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  type Box = { b: BarRec; bar: number[]; name: number[] | null; pri: number };
  const list: Box[] = [];
  for (const b of BARS) {
    if (!b.s.parent || !shown(b.s)) { b.a = b.nameU.value = 1; b.on = true; continue; }
    b.s.getWorldPosition(bv); bq.copy(bv).applyMatrix4(pc.matrixWorldInverse); const d = -bq.z; if (d <= 0.1) continue;
    bv.project(pc); const x = (bv.x * 0.5 + 0.5) * VW, y = (-bv.y * 0.5 + 0.5) * VH, k = (VH / 2) / (tanF * d) * b.s.scale.x / 512;      /* k：血条那张图上一个像素在屏幕上多大（锚点在血条正中，图上坐标 (287, 60)） */
    const rw = b.row();
    list.push({ b, bar: [x - 287 * k, y - 22 * k, x + 225 * k, y + 38 * k], name: rw > 0 ? [x - rw / 2 * k, y - 60 * k, x + rw / 2 * k, y - 24 * k] : null, pri: (b.self() ? 0 : b.status() ? 1 : 2) * 1e4 - k * 1e3 });
  }
  list.sort((p, q) => p.pri - q.pri);
  const kept: number[][] = [], hit = (a: number[], c: number[], m: number) => a[0] - m < c[2] && a[2] + m > c[0] && a[1] - m < c[3] && a[3] + m > c[1];
  for (const L of list) {
    let on = !!L.name;
    if (L.name && !L.b.self()) { const m = L.b.on ? 4 : 14; on = !kept.some(c => hit(L.name!, c, m)) && !list.some(o => o !== L && hit(L.name!, o.bar, m)); }
    if (on && L.name) kept.push(L.name); L.b.on = on;
    L.b.a = on ? Math.min(1, L.b.a + dt * 6) : Math.max(0, L.b.a - dt * 8); L.b.nameU.value = L.b.a;
  }
}

export function lifeBar(team: number): { sprite: THREE.Sprite; set: (ratio: number, max?: number, level?: number, mana?: number, status?: string, shield?: number) => void; tag: (name: string, self: () => boolean) => void } {
  const W = 512, H = 112, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d")!;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const LV = 58, X0 = LV + 8, X1 = 508, Y0 = 42, Y1 = 78, M0 = Y1 + 4, M1 = M0 + 12, BW = X1 - X0;      // 等级牌 0..58；血条 X0..X1 × Y0..Y1；法力 M0..M1；最上面 0..36 是名字
  let lag = 1, last = performance.now(), drawn = "", nm = "", isSelf: () => boolean = () => false, rowW = 0, rowStatus = false;      // rowW：名字（或状态字）那一行在图上有多宽，挤的时候按它判断压没压到别人
  const rr = (x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const set = (ratio: number, max = 0, level = 0, mana = -1, status = "", shield = 0) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; ratio = Math.max(0, Math.min(1, ratio));
    lag = ratio >= lag ? ratio : Math.max(ratio, lag - dt * 0.45);
    const rel = isSelf() ? 2 : team === 0 ? 0 : 1, R = REL[rel], bot = mana >= 0 ? M1 : Y1;
    const tot = Math.max(1, ratio + shield), hw = ratio / tot, sw = shield / tot;      // 护盾：接在血后面的一段白；血加盾超过上限时整条按比例缩
    const key = `${rel}|${nm}|${Math.round(ratio * 400)}|${Math.round(lag * 400)}|${max}|${level}|${Math.round(mana * 200)}|${status}|${Math.round(shield * 300)}`; if (key === drawn) return; drawn = key;
    c.clearRect(0, 0, W, H);
    // 底框：深海蓝玻璃（上亮下暗，和界面的面板一个颜色），外面一道深蓝细线，压在亮地面上也有边；自己的再描一圈亮金（和界面上“自己”的高亮一个颜色）
    const fg = c.createLinearGradient(0, Y0 - 4, 0, bot + 4); fg.addColorStop(0, BAR_INK.glassTop); fg.addColorStop(1, BAR_INK.glassBot);
    c.fillStyle = fg; rr(X0 - 4, Y0 - 4, BW + 8, bot - Y0 + 8, 5); c.fill();
    c.strokeStyle = BAR_INK.line; c.lineWidth = 2; rr(X0 - 5, Y0 - 5, BW + 10, bot - Y0 + 10, 6); c.stroke();
    const gold = (y0: number, y1: number) => { const g = c.createLinearGradient(0, y0, 0, y1); GOLD.forEach((s, i) => g.addColorStop([0, 0.32, 0.7, 1][i], s)); return g; };
    if (rel === 2) { c.strokeStyle = BAR_INK.line; c.lineWidth = 6; rr(X0 - 6, Y0 - 6, BW + 12, bot - Y0 + 12, 7); c.stroke(); c.strokeStyle = gold(Y0 - 7, bot + 7); c.lineWidth = 3; rr(X0 - 6, Y0 - 6, BW + 12, bot - Y0 + 12, 7); c.stroke(); }      // 深蓝垫底、亮金压上：金线两边各露一道深蓝（uikit 的金边也是这样夹着）
    c.fillStyle = BAR_INK.slot; c.fillRect(X0, Y0, BW, Y1 - Y0);
    if (lag > ratio && shield <= 0) { c.fillStyle = R.lag; c.fillRect(X0 + BW * ratio, Y0, BW * (lag - ratio), Y1 - Y0); }      // 刚掉的那一截
    const gr = c.createLinearGradient(0, Y0, 0, Y1); gr.addColorStop(0, R.hp[0]); gr.addColorStop(0.45, R.hp[1]); gr.addColorStop(1, R.hp[2]); c.fillStyle = gr; c.fillRect(X0, Y0, BW * hw, Y1 - Y0);
    c.fillStyle = "rgba(255,255,255,0.24)"; c.fillRect(X0, Y0, BW * hw, 6);
    if (sw > 0) { const gs = c.createLinearGradient(0, Y0, 0, Y1); gs.addColorStop(0, "#ffffff"); gs.addColorStop(1, "#b4c0c8"); c.fillStyle = gs; c.fillRect(X0 + BW * hw, Y0, BW * sw, Y1 - Y0); }
    // 刻度：只画到有血的地方（深蓝，不是黑）
    if (max > 0) { const per = BW / (max * tot / 250); if (per >= 5) for (let k = 1; k * 250 < max; k++) { const x = X0 + per * k; if (x > X0 + BW * hw - 1) break; const big = k % 4 === 0; c.fillStyle = `rgba(${BAR_INK.tick},${big ? 0.8 : 0.45})`; c.fillRect(Math.round(x) - (big ? 2 : 1), Y0, big ? 4 : 2, big ? Y1 - Y0 : (Y1 - Y0) * 0.55); } }
    if (mana >= 0) { c.fillStyle = BAR_INK.mslot; c.fillRect(X0, M0, BW, M1 - M0); const gm = c.createLinearGradient(0, M0, 0, M1); gm.addColorStop(0, "#86a8ff"); gm.addColorStop(1, "#3048c8"); c.fillStyle = gm; c.fillRect(X0, M0, BW * Math.max(0, Math.min(1, mana)), M1 - M0); }      // 法力偏靛蓝：和队友的天蓝血条拉开
    // 等级牌：方的（LoL），蓝玻璃底、外面一道深蓝细线，边是关系色，自己的是亮金
    if (level > 0) { const top = Y0 - 4, hgt = bot - Y0 + 8, lg = c.createLinearGradient(0, top, 0, top + hgt); lg.addColorStop(0, "#22488a"); lg.addColorStop(1, "#0a1a3d");
      c.fillStyle = lg; rr(0, top, LV, hgt, 6); c.fill(); c.strokeStyle = BAR_INK.line; c.lineWidth = 2; rr(0, top, LV, hgt, 6); c.stroke();
      c.strokeStyle = rel === 2 ? gold(top, top + hgt) : R.edge; c.lineWidth = 3.5; rr(2.5, top + 2.5, LV - 5, hgt - 5, 4.5); c.stroke();
      c.save(); c.shadowColor = "rgba(4,12,34,0.95)"; c.shadowBlur = 5; c.shadowOffsetY = 1.5;
      c.fillStyle = "#fff"; c.font = `800 ${level > 9 ? 33 : 38}px "Avenir Next","PingFang SC",system-ui,sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(level), LV / 2, top + hgt / 2 + 2); c.restore(); }
    // 名字一行；被控住时换成状态字（字的描边、状态字的底都是深蓝，和界面的字一个处理）
    const cx = (X0 + X1) / 2; c.textAlign = "center"; c.textBaseline = "middle";
    rowW = 0; rowStatus = !!status;
    if (status) { c.font = '800 30px "PingFang SC","Avenir Next",system-ui,sans-serif'; const tw = c.measureText(status).width + 30, sg = c.createLinearGradient(0, 1, 0, 35); sg.addColorStop(0, "rgba(30,62,116,0.92)"); sg.addColorStop(1, "rgba(7,19,45,0.92)");
      c.fillStyle = sg; rr(cx - tw / 2, 1, tw, 34, 9); c.fill(); c.strokeStyle = BAR_INK.line; c.lineWidth = 2; rr(cx - tw / 2, 1, tw, 34, 9); c.stroke(); c.fillStyle = STATUS_COLOR[status] ?? "#fff"; c.fillText(status, cx, 19); rowW = tw; }
    else if (nm) { c.font = '700 27px "PingFang SC","Avenir Next",system-ui,sans-serif'; c.lineJoin = "round"; c.strokeStyle = BAR_INK.text; c.lineWidth = 6; c.strokeText(nm, cx, 20); c.fillStyle = R.name; c.fillText(nm, cx, 20); rowW = c.measureText(nm).width + 10; }
    t.needsUpdate = true;
  };
  set(1);
  const nameU = { value: 1 }, mat = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true });
  mat.onBeforeCompile = sh => { sh.uniforms.uNameA = nameU; sh.fragmentShader = "uniform float uNameA;\n" + sh.fragmentShader.replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\n  if (vMapUv.y > 0.67) diffuseColor.a *= uNameA;"); };      // 图上最上面 37 像素（名字那一行）乘 uNameA
  mat.customProgramCacheKey = () => "lifebar-name";
  const s = new THREE.Sprite(mat), SW = TOUCH ? 4.1 : 3.3; s.scale.set(SW, SW * H / W, 1); s.center.set((X0 + X1) / 2 / W, 1 - (Y0 + Y1) / 2 / H); s.renderOrder = 30;      // 锚点在血条正中：血条按原来的高度放在头顶。手机上画面小，整条放大 1.25 倍（王者荣耀的头顶血条也比端游的显眼）
  const rec: BarRec = { s, nameU, a: 1, row: () => rowW, status: () => rowStatus, self: () => isSelf(), on: true }; BARS.push(rec);
  s.onBeforeRender = (r, _sc, cam) => declutter(r, cam);
  return { sprite: s, set, tag(name, self) { nm = name; isSelf = self; drawn = ""; } };
}

/** stylecost 试验：背面外扩的描边。每个蒙皮网格复制一份（共用几何体和骨架），只画背面，顶点沿法线往外推 w（模型自己的单位，身高是 1） */
function addOutline(model: THREE.Object3D, w: number, hide: { value: number }) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x1c1712, side: THREE.BackSide });
  mat.onBeforeCompile = sh => { sh.uniforms.uHide = hide; sh.fragmentShader = "uniform float uHide;\n" + sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\nif (uHide > 0.5) discard;");
    sh.vertexShader = sh.vertexShader.replace("#include <skinning_vertex>", `#include <skinning_vertex>\n#ifdef USE_SKINNING\ntransformed += normalize(objectNormal) * ${w.toFixed(4)};\n#endif`); };
  mat.customProgramCacheKey = () => `outline${w}`;
  const list: THREE.SkinnedMesh[] = []; model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) list.push(o as THREE.SkinnedMesh); });
  for (const sm of list) { const o = new THREE.SkinnedMesh(sm.geometry, mat); o.bind(sm.skeleton, sm.bindMatrix); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; o.name = "outline"; sm.add(o); }
}

export async function loadHero(url: string, team = 0, look: Partial<HeroLook> = {}): Promise<Hero> {
  const lk = { ...LOOK, ...look }, gltf = await loadGLB(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), url)      /* 模型的网格是压缩过的（tools/hero_build.sh 的最后一步） */, model = gltf.scene;
  let tris = 0; const box = new THREE.Box3().setFromObject(model), veil = { value: 0 }, hide = { value: 0 }, hitU = { value: 0 }, hitW = { value: new THREE.Vector4(1, 1, 1, 0) }, hitWC = new THREE.Color(), mats: THREE.MeshStandardMaterial[] = [], bones = new Map<string, THREE.Object3D>();
  model.scale.setScalar(lk.height / (box.max.y - box.min.y));
  model.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ""), o);
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
    const mat = m.material as THREE.MeshStandardMaterial; if (!(mat.userData as any).tuned) { tune(mat, team, lk, mat.name.startsWith("weapon"), veil, hide, 0, hitU, hitW); (mat.userData as any).tuned = true; mats.push(mat); }
  });
  if (TOON_ON && T.outline > 0) addOutline(model, T.outline, hide);      // stylecost 试验：卡通档给角色加一圈深色描边（背面外扩）
  // 头和手可以放大一点（俯视镜头下更好认）；动作只动骨骼的旋转，不会把这个缩放冲掉
  for (const [n, o] of bones) { if (n === "Head") o.scale.setScalar(lk.head); if (n === "LeftHand" || n === "RightHand") o.scale.setScalar(lk.hand); }
  // 刀尖在哪：武器的顶点都蒙在手的骨骼上，离手最远的那个顶点就是刀尖（换成手骨自己的坐标记下来）
  const blades: Record<string, { bone: THREE.Object3D; tip: THREE.Vector3; base: THREE.Vector3 } | undefined> = {};
  model.traverse(o => { const sm = o as THREE.SkinnedMesh; if (!sm.isSkinnedMesh || !(sm.material as THREE.Material).name.startsWith("weapon")) return;
    const pos = sm.geometry.getAttribute("position"), si = sm.geometry.getAttribute("skinIndex"), v = new THREE.Vector3(), far = new Map<number, { d: number; p: THREE.Vector3 }>();
    for (let i = 0; i < pos.count; i++) { const b = si.getX(i); v.fromBufferAttribute(pos, i).applyMatrix4(sm.bindMatrix).applyMatrix4(sm.skeleton.boneInverses[b]); const d = v.lengthSq(), f = far.get(b); if (!f || d > f.d) far.set(b, { d, p: v.clone() }); }
    for (const [b, f] of far) { const bone = sm.skeleton.bones[b], k = /Left/.test(bone.name) ? "L" : "R", was = blades[k]; if (was && was.tip.lengthSq() >= f.d) continue;      /* 一件武器有几个材质时会走到这里几次：每只手只留伸得最远的那个点 */
      blades[k] = { bone, tip: f.p, base: f.p.clone().multiplyScalar(0.3) }; } });
  const loose = new Map<string, THREE.Object3D>(); for (const [n, o] of bones) loose.set(n.replace(/[^A-Za-z0-9]/g, "").toLowerCase(), o);
  const group = new THREE.Group(); group.name = "hero"; const fm = footMarks(team), marks = fm.g; marks.scale.setScalar(lk.ring); group.add(model, marks);
  const bar = lifeBar(team); bar.sprite.position.y = lk.height + 0.62 + lk.bar;      /* bar：血条再抬高多少米（鹿的头在身体前面、还会人立，血条按身高放会挡住鹿角） */ group.add(bar.sprite);
  const mixer = new THREE.AnimationMixer(model), clips = new Map(gltf.animations.map(c => [c.name, c] as const));
  let cur: THREE.AnimationAction | null = null, alive = true, selfFn: (() => boolean) | null = null, selfWas = false;
  const sync = () => { const tr = veil.value > 0.001 || hide.value > 0.001; for (const m of mats) if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } };      // 只有半透明的时候才走透明的画法
  const hero: Hero = {
    group, model, marks, mixer, clips, current: "", onFinish: null, tris: Math.round(tris),
    play(name, opts = {}) {
      const c = clips.get(name) ?? (name === "idle" ? clips.get("idle_pose") : undefined); if (!c) return;
      const a = mixer.clipAction(c), loop = opts.loop ?? true, fade = opts.fade ?? 0.15;
      a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.timeScale = opts.speed ?? 1;
      if (cur && cur !== a && fade > 0) a.crossFadeFrom(cur, fade, false); else if (cur && cur !== a) cur.stop();
      a.play(); cur = a; hero.current = name;
    },
    setSpeed(k) { if (cur) cur.timeScale = k; },
    time: () => cur?.time ?? 0,
    setVeil(k) { veil.value = k; sync(); marks.visible = k < 0.5 && alive; },
    setHide(k) { hide.value = k; sync(); },
    setLife(ratio, ...rest) { alive = ratio > 0; bar.set(ratio, ...rest); },      /* 第九轮：血量是 0 就是阵亡了（规则那边阵亡时把血清零），头顶的血条、等级牌和脚下的圈都收起来，复活回满血时再出来 */
    bone: n => bones.get(n) ?? loose.get(n.replace(/[^A-Za-z0-9]/g, "").toLowerCase()),      /* 找不到就不管标点和大小写再找一次：导出时骨骼名里的冒号之类会被去掉 */
    blade(side, base, tip) { const b = blades[side]; if (!b) return false; b.bone.localToWorld(base.copy(b.base)); b.bone.localToWorld(tip.copy(b.tip)); return true; },
    hit(k = 1) { hitU.value = Math.max(hitU.value, k); },
    hitWhole(k = 1, color = 0xffd9de) { hitWC.set(color); hitW.value.set(hitWC.r * 1.25, hitWC.g * 1.25, hitWC.b * 1.25, Math.max(hitW.value.w, k)); },
    height: lk.height,
    tag(name, self) { selfFn = self; bar.tag(name, self); },
    update(dt, camDist = 99) { if (selfFn && selfFn() !== selfWas) { selfWas = !selfWas; fm.self(selfWas); } mixer.update(dt); if (hitU.value > 0) hitU.value = Math.max(0, hitU.value - dt * 7); if (hitW.value.w > 0) hitW.value.w = Math.max(0, hitW.value.w - dt * 9); bar.sprite.visible = alive && camDist > 15 && veil.value < 0.5; marks.visible = alive && veil.value < 0.5; },
  };
  mixer.addEventListener("finished", () => hero.onFinish?.(hero.current));
  // 围巾飘带（look.scarf，只有伊缇有）：包一层 update / setVeil / setHide——骨骼动作更新完再算飘带，隐身时收起、进草丛跟着半透明。没有 scarf 的英雄不走这里
  const scarf = lk.scarf ? createScarf(group, n => hero.bone(n), lk.height, lk.scarf) : null;
  if (scarf) { const up = hero.update, sv = hero.setVeil, sh = hero.setHide; hero.update = (dt, cd) => { up(dt, cd); scarf.update(dt); }; hero.setVeil = k => { sv(k); scarf.setVeil(k); }; hero.setHide = k => { sh(k); scarf.setHide(k); }; }
  hero.play("idle", { fade: 0 });
  return hero;
}
