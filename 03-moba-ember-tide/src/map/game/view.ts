// 对局的画面（阶段 4）：把规则那边（sim.ts）的小兵、塔、弹道、掉血画出来。
//   · 小兵：两个模型（近战、远程），两方共用，对方的在着色里换成暗铁加余烬色。动作是管线从视频里读出来的走、打、倒。
//   · 血条：所有小兵和建筑的血条合成一次绘制；脚下的影子也是一次绘制（小兵不投真影子，省一遍蒙皮）。
//   · 塔和水晶的弹道是一颗阵营色的光点；塔倒了变成一截矮石座，周围落一圈碎石。
// 镜头看不到的小兵不播动作、不显示。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { glb, loadGLB } from "../quality";
import { sfx } from "./sfx";
import { BOUT, FXB, glowBlend, glowOut } from "./fxb";
import { KITS } from "./heroes";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { LOOK, isB, tune, type Hero, type HeroLook } from "../hero/hero";
import type { Buildings } from "../world/buildings";
import type { Fx } from "./fx";
import { SPR, type FxLib } from "./fxlib";
import type { Ent, Shot, Sim, SimEvent } from "./sim";
import { addWake } from "../slice/water";
import { BUFFS, MOBS, RULES } from "./sim";
import { OWN_SHIELD, flinch } from "./skills";

/** 小兵模型的数据（public/assets/unit/units.json）：身高；走路动作原速对应的移速；攻击动作里第几秒算出手 */
export interface UnitDef { height: number; walkSpeed: number; hit: number; }
const BIG = 1.3;      // 超级兵比普通近战兵大这么多
const DEF: Record<string, UnitDef> = { melee: { height: 1.89, walkSpeed: 2.54, hit: 0.95 }, ranged: { height: 1.78, walkSpeed: 3.34, hit: 0.75 } };      // 第九轮 ui2：小兵从 1.75 / 1.65 米缩到 1.45 / 1.37（英雄是小兵的两倍多高，兵线像 LoL 那样是一排小个子）；步子跟着变小，walkSpeed 按身高同比例缩，不然脚下打滑。2026-11-21 用户说“小兵都有点太小了，放大到 1.3 倍左右”：放大到 1.89 / 1.78（walkSpeed 同比例放大；实际用的是 units.json 里的数，这里是它载不到时的默认值）。只放大模型，碰撞半径不变

/** 野怪模型的时间表（public/assets/unit/<名>.json，格式见 tools/MONSTER_PIPELINE.md）：总高、脚下的圈放大几倍、血条再抬高多少、跑步原速对应的移速、每段攻击第几秒打中 */
interface MobMeta { height?: number; ring?: number; bar?: number; runSpeed?: number; attacks?: { clip: string; hit: number; end: number; speed?: number }[]; skills?: Record<string, { clip: string; release: number; end: number; speed?: number }>; }
/** 时间表还没有的时候用的大小 */
const MOB_SIZE: Record<string, { height: number; ring: number }> = { wolf: { height: 1.45, ring: 0.9 }, mandrill: { height: 2.3, ring: 1.1 }, toad: { height: 2.3, ring: 1.8 }, boar: { height: 2.7, ring: 1.9 }, beast: { height: 3.3, ring: 3.2 }, troll: { height: 6.0, ring: 2.6 } };
/** 每种怪在游戏光照下单独调的画面参数（没写的用通用的那套）。狼背上的苔藓原样用太亮太黄；山魈的毛是炭灰色，抬一点才看得清 */
const MOB_LOOK: Record<string, Partial<HeroLook>> = { wolf: { lift: 0.92, sat: 0.62, fill: 0.3 }, mandrill: { lift: 1.34, fill: 0.42 }, boar: { lift: 1.35 }, troll: { lift: 1.15, sat: 1.0 } };
/** 换画风 B（w-beast、w-unit）：材质名以 _b 结尾的新模型（卡通厚涂）不吃上面那张表（那是给厚涂版的贴图调的，狼的 sat 0.62 再乘 HB 的 0.7 会把苔藓压成灰的），单独调的写这里；没写的用通用的那套乘 HB。
 *  小兵（melee、ranged）也写在这张表里，loadKind 给小兵的 B 材质用它（老模型照旧不读）。glow 0：小兵、山魈、巨魔身上没有发光的部位（STYLE.md 3.1 第 6 条），不关的话小兵青蓝的布片、盾面、山魈蓝灰的皮会被当成发光纹路点亮 */
const MOB_LOOK_B: Record<string, Partial<HeroLook>> = {
  boar: { sat: 1.4 },      // 通用那套的饱和度乘 HB 只剩 0.77，橙红鬃毛发灰、身子偏冷灰；提到 0.98，鬃毛 147,70,45
  toad: { lift: 0.82, sat: 1.0, rim: 0.42 },      // 浅蓝的背在太阳底下几乎发白（p90 0.86，设定图 0.72），疙瘩上的亮边碎成一片白点；压暗、亮边减半：身子 82,117,133（设定图 112,137,146），背上的疙瘩和苔藓分得开了
  beast: { lift: 0.85, sat: 1.45, glow: 0.35, rim: 0.5 },      // 通用那套下整只发白（p50 0.61，设定图 0.47），晶体被发光冲成白的；压暗、饱和度提回 1.0、发光减半：甲 90,130,155，晶体是青色的。饱和度再低晶体又发白（晶体的发光吃的是调过饱和度的颜色）
  wolf: { lift: 1.12, sat: 1.33, rim: 0.42 },      // 通用那套（1.25 / 1.1 / 0.75）下苔藓比设定图浅、偏灰蓝（113,132,95 对 89,100,64），在亮草地上糊成一片，毛也偏灰；压暗一点、饱和度提回来：苔藓 100,120,77、毛 148,139,121。苔藓一簇簇的边多，顺光亮边会碎成一片白点，压一半
  mandrill: { lift: 1.2, sat: 1.65, fill: 0.36, glow: 0 },      // 旧的 lift 1.34 是给炭灰的毛抬的，B 的毛是暖褐，用 1.2；饱和度乘 HB 的 0.7 以后毛发灰（136,111,94），1.65 时 (111,81,56)，设定图 (107,70,55)
  troll: { lift: 1.15, sat: 1.25, glow: 0 },      // 饱和度 1.0 × 0.7 时皮裙、青苔发灰，1.25 接近设定图；lift 照旧的 1.15（试过 1.0，和河心岛上的白石头更混）
  melee: { lift: 0.8, glow: 0 }, ranged: { lift: 0.8, glow: 0 },      // 小兵（通用 1.2）：B 的小兵是浅钢灰，照 1.2 游戏镜头里亮度中位数 0.48–0.56，比英雄（岚 B 0.45–0.51）还亮；0.8 时 0.32–0.46、亮部 p90 0.58–0.79（英雄 0.81–0.90），饱和度只有英雄的一半多，暗一档（第九轮 ui2：英雄比小兵显眼）
};
interface KindRec { scene: THREE.Object3D; clips: THREE.AnimationClip[]; mats: Map<string, THREE.Material>[]; scale: number; height: number; meta: MobMeta; /** iti-fx3：按材质名再做一份这个单位自己的材质（整身一闪用） */ makers?: Map<string, (team: number, hw?: { value: THREE.Vector4 }) => THREE.Material>; }
interface MinionView { e: Ent; K: KindRec; root: THREE.Object3D; mixer: THREE.AnimationMixer; acts: Record<string, THREE.AnimationAction | undefined>; cur: string; deadT: number; y: number; wade: number; }
export interface View { update: (dt: number, cx: number, cz: number, camDist: number) => void; pick: (ray: THREE.Ray, team?: number, not?: number) => Ent | null; count: () => { minions: number; shown: number }; }

export async function createView(o: { scene: THREE.Scene; sim: Sim; hero: Hero; fx: Fx; fxl?: FxLib; buildings: Buildings; height: (x: number, z: number) => number; waterY: number; tint?: number; feed?: SimEvent[] }): Promise<View> {
  const tint = o.tint ?? 0x7fe9e4, bigNum = "#" + new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45).getHexString();      // 命中火花和大数字带一点自己英雄的颜色
  const { sim, fx } = o, group = new THREE.Group(); group.name = "units"; o.scene.add(group);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), off = { value: 0 };
  let defs = DEF; try { const r = await fetch("/assets/unit/units.json"); if (r.ok) defs = { ...DEF, ...(await r.json()) }; } catch { /* 用默认的 */ }
  // 每种小兵：模型一份，材质两套（我方原样，对方换色）
  const kinds: Record<string, KindRec | null> = {};
  /** 载入一种单位的模型：材质按队伍各做一套（小兵两方共用模型，对方的换色；野怪只有中立一套） */
  async function loadKind(file: string, height: number, teams: number[], shadow: boolean, look: Partial<HeroLook> = {}, lookB: Partial<HeroLook> = look): Promise<KindRec> {
    const g = await loadGLB(loader, glb("unit", file)), box = new THREE.Box3().setFromObject(g.scene), mats: Map<string, THREE.Material>[] = [new Map(), new Map(), new Map()], makers = new Map<string, (team: number, hw?: { value: THREE.Vector4 }) => THREE.Material>();
    g.scene.traverse(n => { const m = n as THREE.Mesh; if (!m.isMesh) return; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; const src = m.material as THREE.MeshStandardMaterial; if (mats[teams[0]].has(src.name)) return;
      if (src.name.startsWith("weapon") && src.map && !isB(src)) { src.map.magFilter = src.map.minFilter = THREE.NearestFilter; src.map.generateMipmaps = false; src.map.needsUpdate = true; }      /* 武器的贴图是几个纯色块，不要插值（B 的武器贴图带手绘明暗，照常插值） */
      // iti-fx3：做材质的那几行收成一个函数（参数原样没动），好给“整身一闪”再做一份每个单位自己的（见下面 flashUnit）
      const mkOne = (team: number, hw?: { value: THREE.Vector4 }) => { const c = src.clone(); c.name = src.name; tune(c, team, { ...LOOK, lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6, bump: 0.5, ...(isB(src) ? lookB : look) },      /* 小兵比英雄暗一档、边缘光弱一半（第九轮 ui2，原来 1.3 / 1.15 / 0.42 / 0.9 和英雄差不多亮，抢眼）；野怪自己传了这几项，不受影响 */ src.name.startsWith("weapon"), off, off, team === 1 ? 1 : isB(src) && teams.length > 1 ? -1 : 0, undefined, hw); return c; };
      for (const team of teams) mats[team].set(src.name, mkOne(team)); makers.set(src.name, mkOne); });      /* B 的小兵：我方传 -1，hero.ts 里把青蓝那块的饱和度补一点（英雄、野怪都是 0，不受影响） */
    return { scene: g.scene, clips: g.animations, mats, scale: height / (box.max.y - box.min.y), height, meta: {}, makers };
  }
  for (const k of ["melee", "ranged"]) { try { kinds[k] = await loadKind(k, defs[k].height, [0, 1], false, {}, MOB_LOOK_B[k]); } catch (e) { console.warn("小兵模型没载入", k, e); kinds[k] = null; } }
  // 野怪和 Boss：不等它们，载好一种算一种（开局二十秒才刷第一批）。增益怪和 Boss 个头大，投真的影子；小野怪和小兵一样只有脚下一团
  for (const mob of Object.keys(MOBS)) { kinds[mob] = null; (async () => {
    let meta: MobMeta = {}; try { const r = await fetch(`/assets/unit/${mob}.json`); if (r.ok) meta = await r.json(); } catch { meta = {}; }
    const h = meta.height ?? MOB_SIZE[mob].height;
    try { const K = await loadKind(mob, h, [2], !!MOBS[mob].heavy, { lift: 1.25, sat: 1.1, fill: 0.36, rim: 0.75, glow: 0.7, ...MOB_LOOK[mob] }, { lift: 1.25, sat: 1.1, fill: 0.36, rim: 0.75, glow: 0.7, ...MOB_LOOK_B[mob] }); K.meta = meta; kinds[mob] = K; }
    catch { try { const K = await loadKind("melee", h, [2], false); kinds[mob] = K; console.warn("野怪的模型还没有，先用近战兵顶着：", mob); } catch { /* 连小兵都没有就不画 */ } }
  })(); }
  const views = new Map<number, MinionView>();
  function spawn(e: Ent) {
    const K = kinds[e.kind === "monster" ? e.mob : e.kind]; if (!K) return;
    const root = SkeletonUtils.clone(K.scene); root.scale.setScalar(K.scale * (e.big ? BIG : 1));
    root.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh) m.material = K.mats[e.team].get((m.material as THREE.Material).name) ?? m.material; });
    const mixer = new THREE.AnimationMixer(root), act = (n: string) => { const c = K.clips.find(x => x.name === n); return c ? mixer.clipAction(c) : undefined; };
    // 小兵的动作叫 walk、attack；野怪的照英雄的叫法：run、attack1、attack2（重击）、roar
    const acts = { idle: act("idle") ?? act("idle_pose"), walk: act("run") ?? act("walk") ?? act("idle_pose"), attack: act("attack1") ?? act("attack") ?? act("idle_pose"), heavy: act("attack2") ?? act("attack1") ?? act("attack"), roar: act("roar"), death: act("death") };
    const y = o.height(e.x, e.z); root.position.set(e.x, y, e.z); root.rotation.y = e.yaw; group.add(root);
    views.set(e.id, { e, K, root, mixer, acts, cur: "", deadT: 0, y, wade: 0 });
  }
  // ---- iti-fx3 新加：小兵、野怪的“整身一闪”（英雄的在 hero.ts 的 hitWhole）。同一种小兵共用一份材质，所以挨打的这一个临时换上自己的一份（着色器是同一个，不重编），
  // 闪完（约 0.11 秒）换回共用的；模型被撤掉以后把它那份材质扔掉。没人调 fxl.flashUnit 就什么都不发生
  const flashes = new Map<number, { v: MinionView; hw: { value: THREE.Vector4 }; own: Map<string, THREE.Material>; on: boolean }>(), flashC = new THREE.Color();
  if (o.fxl) o.fxl.flashUnit = (e, k, color = 0xffd9de) => {
    const v = views.get(e.id); if (!v || !v.K.makers) return; let f = flashes.get(e.id);
    if (!f || f.v !== v) { f?.own.forEach(m => m.dispose()); f = { v, hw: { value: new THREE.Vector4(1, 1, 1, 0) }, own: new Map(), on: false }; flashes.set(e.id, f); }
    flashC.set(color); f.hw.value.set(flashC.r * 1.25, flashC.g * 1.25, flashC.b * 1.25, Math.max(f.hw.value.w, k));
    if (!f.on) { f.on = true; const F = f; v.root.traverse(n => { const m = n as THREE.Mesh; if (!m.isMesh) return; const nm = (m.material as THREE.Material).name, mk = v.K.makers!.get(nm); if (!mk) return; let own = F.own.get(nm); if (!own) { own = mk(e.team, F.hw); F.own.set(nm, own); } m.material = own; }); }
  };
  function tickFlashes(dt: number) {
    for (const [id, f] of flashes) {
      if (views.get(id) !== f.v) { f.own.forEach(m => m.dispose()); flashes.delete(id); continue; }
      if (!f.on) continue; f.hw.value.w = Math.max(0, f.hw.value.w - dt * 9);
      if (f.hw.value.w <= 0) { f.on = false; f.v.root.traverse(n => { const m = n as THREE.Mesh; if (!m.isMesh) return; const sh = f.v.K.mats[f.v.e.team].get((m.material as THREE.Material).name); if (sh) m.material = sh; }); }
    }
  }
  function setAnim(v: MinionView, name: string, speed = 1, once = false, restart = false) {
    const a = v.acts[name]; if (!a) return; if (v.cur === name && !restart) { a.timeScale = speed; return; }
    const prev = v.acts[v.cur]; a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.timeScale = speed;
    if (prev && prev !== a) a.crossFadeFrom(prev, 0.14, false); a.play(); v.cur = name;
    if (!once && v.e.kind === "monster") a.time = Math.random() * a.getClip().duration;      // 循环的动作（站、走）从随机的地方开始播：一窝三只狼不会一起转头、齐步走
  }

  // ---- 血条：一次绘制。每条的数据是位置、剩几成血、颜色、宽度 ----
  const MAXB = 200, barGeo = new THREE.InstancedBufferGeometry(); { const p = new THREE.PlaneGeometry(1, 1); barGeo.index = p.index; barGeo.setAttribute("position", p.getAttribute("position")); barGeo.setAttribute("uv", p.getAttribute("uv")); }
  const bPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3), bDat = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4); bPos.setUsage(THREE.DynamicDrawUsage); bDat.setUsage(THREE.DynamicDrawUsage);
  barGeo.setAttribute("iPos", bPos); barGeo.setAttribute("iDat", bDat);
  const bars = new THREE.Mesh(barGeo, new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `attribute vec3 iPos; attribute vec4 iDat; varying vec2 vUv; varying vec4 vDat;
      void main() { vUv = uv; vDat = iDat; vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * vec2(iDat.z, iDat.w); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec2 vUv; varying vec4 vDat;
      void main() { float edge = step(0.06 / vDat.z * 0.6, vUv.x) * step(vUv.x, 1.0 - 0.06 / vDat.z * 0.6) * step(0.16, vUv.y) * step(vUv.y, 0.84);
        float big = step(3.5, vDat.y), id = vDat.y - 4.0 * big;      /* 颜色号加了 4 的是塔和水晶：颜色饱满；小兵的淡一档，不和英雄的血条抢 */
        vec3 col = id < 0.5 ? vec3(0.3, 0.64, 0.98) : id < 1.5 ? vec3(0.95, 0.3, 0.24) : id < 2.5 ? vec3(0.62, 0.64, 0.66) : vec3(0.98, 0.7, 0.24);      /* 第九轮 ui2 照 LoL：0 队（玩家这一队）蓝、1 队红；3：野怪，琥珀色 */ col = mix(mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))), 0.16) * 0.92, col, big);
        col *= 0.72 + 0.28 * vUv.y; float fill = step(vUv.x, vDat.x) * edge;
        gl_FragColor = vec4(mix(vec3(0.025, 0.06, 0.14), col, fill), mix(0.8, 0.9, big)); }` }));      /* 换画风 B：空槽从近黑换成深海蓝，和英雄头顶血条（hero.ts 的 BAR_INK.slot）、界面一家 */
  bars.frustumCulled = false; bars.renderOrder = 26; group.add(bars);
  // ---- 小兵脚下的影子：一次绘制 ----
  const blobTex = (() => { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d")!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(0,0,0,0.66)"); g.addColorStop(0.55, "rgba(0,0,0,0.36)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
  const blobGeo = new THREE.PlaneGeometry(1.25, 1.25); blobGeo.rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 160); blobs.frustumCulled = false; blobs.renderOrder = 2; group.add(blobs);
  // ---- 弹道 ----
  const dot = (() => { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d")!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
  const HUE = [0x7fe9e4, 0xff8a3c], HOT = [0xe6fffb, 0xffe2b8], bolts = new Map<number, { s: Shot; head: THREE.Sprite; tail: THREE.Sprite; rib: ReturnType<FxLib["trail"]> | null }>();
  // 弹道（第九轮）：头上一颗白芯外面裹一层阵营色，后面拖一条带子（塔的粗、长，小兵的细、短）。原来是两颗光点，飞起来像一个点在跳
  const boltMat = [0, 1].map(t => [new THREE.SpriteMaterial({ map: dot, color: HUE[t], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }), new THREE.SpriteMaterial({ map: dot, color: HOT[t], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1 })]);
  function bolt(s: Shot) { const big = s.kind === "tower", t = s.from.team === 1 ? 1 : 0, mk = (k: number, m: THREE.SpriteMaterial) => { const sp = new THREE.Sprite(m); sp.scale.setScalar((big ? 1.5 : 0.75) * k); sp.position.set(s.x, s.y, s.z); sp.renderOrder = 9; group.add(sp); return sp; };
    bolts.set(s.id, { s, head: mk(1, boltMat[t][0]), tail: mk(0.42, boltMat[t][1]), rib: o.fxl ? o.fxl.trail({ color: HUE[t], color2: HUE[t], width: big ? 0.75 : 0.32, life: big ? 0.2 : 0.12, alpha: big ? 1 : 0.8 }) : null }); }
  /** 普攻打中的样子（第九轮）：按出手的是谁来——近战英雄是一道月牙刀光划过目标加一下亮，远程英雄是弹道炸开，塔是一大下，小兵和野怪小一号。
   *  镜头附近、看得见的才画 */
  function strikeFx(src: Ent, e: Ent, y: number, big: boolean) {
    const f = o.fxl; if (!f || Math.hypot(e.x - camX, e.z - camZ) > 42) return; const top = topOf(e), p = { x: e.x, y: y + Math.min(1.5, top * 0.55), z: e.z };
    let dx = e.x - src.x, dz = e.z - src.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; const dir = { x: dx, y: 0.35, z: dz };
    if (src.kind === "hero" && src.h) { const K = KITS[src.h.kit], col = K?.color ?? tint, c2 = K?.color2 ?? 0xffffff;
      if (K && !K.ranged) { const sz = big ? 1.35 : 1;      // 近战：一道斜着划过目标的月牙，加打击点
        f.slash({ pos: { x: p.x - dx * 1.1 * sz, y: p.y, z: p.z - dz * 1.1 * sz }, yaw: Math.atan2(dx, dz), r: 1.5 * sz, arc: 1.5, width: 0.42, tilt: (Math.random() - 0.5) * 1.1, flip: Math.random() < 0.5, color: 0xffffff, color2: col, life: big ? 0.24 : 0.18 });
        f.impact(p, { color: col, color2: c2, size: sz, big, dir }); }
      else f.impact(p, { color: col, color2: c2, size: big ? 1.15 : 0.8, big, dir });
      return; }
    if (src.kind === "tower" || src.kind === "core") { f.impact(p, { color: HOT[src.team === 1 ? 1 : 0], color2: HUE[src.team === 1 ? 1 : 0], size: 1.4, big: true }); return; }
    if (src.kind === "monster") { const M = MOBS[src.mob]; f.impact(p, { color: 0xfff0d8, color2: 0xd8b48a, size: M?.boss ? 1.5 : M?.heavy ? 1.15 : 0.8, big: !!M?.heavy, dir }); return; }
    if (src.kind === "ranged") { f.impact(p, { color: HUE[src.team === 1 ? 1 : 0], size: 0.6, sparks: 4 }); return; }
    f.burst({ pos: p, n: 4, sprite: SPR.streak, add: true, color: [0xfff4e0, 0xb9b2a4], size: [0.08, 0.13], life: [0.1, 0.18], speed: [3, 6], dir, spread: 1.0, gravity: 9, stretch: 1.2 });      // 近战小兵：几点火星就够了，不抢英雄的
  }
  // 碎石：塔倒了以后落在脚下的一圈石头
  const rockGeo = new THREE.DodecahedronGeometry(0.5, 0), rockMat = [new THREE.MeshStandardMaterial({ color: 0x9a9a8c, roughness: 1, flatShading: true }), new THREE.MeshStandardMaterial({ color: 0x57504e, roughness: 1, flatShading: true })];
  function rubble(e: Ent) { const n = e.kind === "core" ? 16 : 9, y = o.height(e.x, e.z);
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + Math.random(), r = e.r * (0.6 + Math.random() * 0.9), m = new THREE.Mesh(rockGeo, rockMat[e.team === 1 ? 1 : 0]); const s = 0.5 + Math.random() * 0.9; m.scale.set(s, s * (0.5 + Math.random() * 0.4), s); m.position.set(e.x + Math.cos(a) * r, y + s * 0.18, e.z + Math.sin(a) * r); m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); m.castShadow = true; m.receiveShadow = true; group.add(m); } }
  // 塔和水晶被拆的那一下（阶段 8）：顶上的晶体炸开——一团亮光、两圈冲击波、往四周飞的碎晶、一股往上翻的烟尘、地上一块焦痕，镜头震一下。
  // 模型是在这一帧直接换成残座的，亮光和烟尘正好把这一下盖住。水晶是一局的结尾，接着再炸两下，一下比一下大。
  const later: { t: number; fn: () => void }[] = []; let camX = 0, camZ = 0;
  function boom(e: Ent, y: number) {
    const f = o.fxl; if (!f) return; const big = e.kind === "core", col = HUE[e.team], top = big ? 6 : 4.6, near = Math.hypot(e.x - camX, e.z - camZ) < 46, P = (h: number) => ({ x: e.x, y: y + h, z: e.z });
    const shards = (n: number, sp: [number, number], h: number) => { f.burst({ pos: P(h), n, sprite: SPR.shard, add: true, color: [0xffffff, col], size: [0.28, 0.85], life: [0.8, 1.7], speed: sp, spread: 3.14, gravity: 13, drag: 0.5, spin: 6 });
      f.burst({ pos: P(h), n: Math.round(n * 1.2), sprite: SPR.ember, add: true, color: [0xfff2d8, col], size: [0.1, 0.24], life: [1.0, 2.3], speed: [sp[0] * 0.5, sp[1] * 0.8], spread: 3.14, gravity: 5, drag: 0.8 }); };
    const dust = (n: number, r: number, h: number) => { f.burst({ pos: P(h), n, sprite: SPR.dust, color: [0xc4bcab, 0x857e72], alpha: [0.42, 0.62], size: [1.6, 3.2], grow: 2.3, life: [1.1, 2.1], speed: [2, 6.5], dir: { x: 0, y: 1, z: 0 }, spread: 1.5, radius: r, drag: 1.7 });
      f.burst({ pos: P(h + 1), n: Math.round(n * 0.6), sprite: SPR.smoke, color: [0x4d4741, 0x2b2826], alpha: [0.36, 0.55], size: [2.0, 3.8], grow: 2.4, life: [1.9, 3.3], speed: [1.2, 3.6], dir: { x: 0, y: 1, z: 0 }, spread: 0.7, radius: r * 0.7, drag: 0.9 }); };
    f.flash(P(top), col, big ? 14 : 7.5, big ? 0.42 : 0.28, true);
    f.ring(e.x, e.z, big ? 11 : 6.5, 0xfff2d8, big ? 0.8 : 0.55); f.ring(e.x, e.z, big ? 7.5 : 4.4, col, big ? 1.1 : 0.75);
    shards(big ? 44 : 22, big ? [6, 15] : [4, 10], top); dust(big ? 26 : 14, big ? 2.4 : 1.2, top * 0.45);
    f.column({ x: e.x, z: e.z, r: big ? 2.4 : 1.2, h: big ? 11 : 6.5, life: big ? 1.1 : 0.7, color: col, color2: 0xfff2d8, kind: "light" });
    f.decal({ kind: "scorch", x: e.x, z: e.z, r: big ? 8 : 3.8, life: 18, color: 0x17120f, alpha: 0.55, fadeIn: 0.03, fadeOut: 0.3 }); f.decal({ kind: "crack", x: e.x, z: e.z, r: big ? 9.5 : 4.6, life: 18, color: col, alpha: 0.5, fadeIn: 0.05, fadeOut: 0.4 });
    if (near) f.shake(big ? 0.4 : 0.16, big ? 0.9 : 0.4);
    if (!big) return;
    later.push({ t: 0.3, fn: () => { f.flash(P(3.5), 0xfff2d8, 10, 0.3, false); f.ring(e.x, e.z, 15, col, 1.1); shards(34, [8, 18], 3.5); dust(18, 3.4, 1.5); if (near) f.shake(0.3, 0.6); } });
    later.push({ t: 0.68, fn: () => { f.flash(P(2.5), col, 18, 0.55, true); f.ring(e.x, e.z, 21, 0xfff2d8, 1.3); f.ring(e.x, e.z, 13, col, 1.6); shards(52, [9, 21], 2.5); dust(30, 4.6, 1);
      f.column({ x: e.x, z: e.z, r: 4.2, h: 16, life: 1.5, color: col, color2: 0xfff2d8, kind: "light" }); if (near) f.shake(0.5, 1.1); } });
  }
  // 被对方的塔或水晶盯上时，从它的顶上到英雄拉一条细线：提醒该退了
  // （线条在网页里只能画一像素宽，看不清，所以每条线用两片交叉的细长面片拼出来，从哪个角度看都有宽度）
  const AIMS = 4, aimGeo = new THREE.BufferGeometry(); aimGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(AIMS * 8 * 3), 3));
  { const idx: number[] = []; for (let i = 0; i < AIMS * 2; i++) { const k = i * 4; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); } aimGeo.setIndex(idx); }
  const aims = new THREE.Mesh(aimGeo, new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); aims.frustumCulled = false; aims.renderOrder = 24; group.add(aims);
  const aimA = new THREE.Vector3(), aimB = new THREE.Vector3(), aimD = new THREE.Vector3(), aimS = new THREE.Vector3(), aimT = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const tops = new Map<number, number>();      // 塔和水晶的实际高度，量一次记下来（被拆掉以后也按原来的高度算，倒塌时的火花才在原处）
  const topOf = (e: Ent) => { if (e.kind === "tower" || e.kind === "core") { let t = tops.get(e.id); if (t === undefined) { t = o.buildings.top(e.x, e.z) || (e.kind === "core" ? 9.5 : 8.5); tops.set(e.id, t); } return t; } return e.kind === "hero" ? LOOK.height : e.kind === "monster" ? kinds[e.mob]?.height ?? MOB_SIZE[e.mob]?.height ?? 2 : (defs[e.kind]?.height ?? 2) * (e.big ? BIG : 1); };
  const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), m4 = new THREE.Matrix4(); let noHit = 0;

  function events() {
    for (const ev of sim.events) {
      if (ev.t === "cast") { if (ev.e.team === sim.hero.team || ev.e.seen) sfx.cast(KITS[ev.e.h?.kit ?? ""]?.side ?? 0, ev.key, ev.e.x, ev.e.z, ev.e === sim.hero); continue; } else sfx.on(ev, sim.hero);
      if (o.feed && (ev.t === "kill" || ev.t === "boss" || ev.t === "camp" || (ev.t === "die" && ev.e.kind === "tower"))) o.feed.push(ev);      // 界面要播报的事：这里读完就清掉了，所以转一份给它
      if (ev.t === "shot") bolt(ev.s);
      else if (ev.t === "hit") { const e = ev.e, y = o.height(e.x, e.z);
        if (ev.dmg > 0 && !ev.skill && ev.src && (e.seen || e.team === 0)) { if (o.fxl) strikeFx(ev.src, e, y, !!ev.big); else if (ev.src === sim.hero) fx.hit(v3.set(e.x, y + Math.min(1.5, topOf(e) * 0.6), e.z), ev.big, tint);      /* 技能的命中特效由技能自己出 */
          if (ev.src.kind === "hero" || ev.src.kind === "tower" || ev.src.kind === "core") flinch(e, !!ev.big, ev.dmg); }      // 被英雄和塔打中的英雄闪一下白（小兵打的不闪，不然一直在闪）
        // 伤害数字（第九轮 polish-lib 照 LoL）：只跳玩家自己打出去的和自己挨的；同一个目标的几个数排成一摞（fx.num），打小兵、野怪的小一号。
        // 观战（导播，sim.reveal）时谁都不是“自己”，照 LoL 的观战一个数都不跳，画面留给技能
        const spec = sim.reveal;
        if (ev.src === sim.hero && ev.dmg > 0 && !spec) {
          fx.num(e.id, v3.set(e.x, y + Math.min(topOf(e), 3.4) + 0.4, e.z), ev.dmg, { big: ev.big, small: e.kind !== "hero", color: ev.type === "magic" ? (ev.big ? "#c9b8ff" : "#b9a8f5") : ev.type === "true" ? "#ffffff" : ev.big ? bigNum : undefined }); }      /* 伤害数字：物理是骨白，魔法是淡紫，真实伤害是白 */
        else if (ev.src === sim.hero && ev.dmg === 0 && !ev.block && !spec && sim.time - noHit > 1.2) { noHit = sim.time; fx.text(v3.set(e.x, y + Math.min(topOf(e), 3.4) + 0.5, e.z), "打不动", false, "#c9ced4"); }
        else if (e === sim.hero && ev.dmg >= 60 && !spec) fx.num(-1 - e.id, v3.set(e.x, y + LOOK.height * 0.45, e.z), "-" + Math.round(ev.dmg), { color: "#ff7a66", small: true, dx: -1.2 });      /* 自己挨的：红字，在身子左边另起一摞 */
        else if (!o.fxl && ev.src && ev.src.kind !== "melee" && e.seen) fx.hit(v3.set(e.x, y + Math.min(1.4, topOf(e) * 0.5), e.z)); }
      else if (ev.t === "heal") { const e = ev.e; if (!sim.reveal && ev.n >= 12 && (e === sim.hero || (e.team === sim.hero.team && e.kind === "hero" && ev.n >= 50))) fx.num(-1e6 - e.id, v3.set(e.x, o.height(e.x, e.z) + LOOK.height * 0.45, e.z), "+" + ev.n, { color: "#8df59a", small: true, dx: 1.2 }); }      /* 治疗：自己回的血，加上队友英雄一下回得多的（像 LoL 只看和自己有关的），对面回血不跳字；在身子右边另起一摞（和左边挨打的红字分开排） */
      else if (ev.t === "gold") { if (!sim.reveal) fx.num(ev.e.id, v3.set(ev.e.x, o.height(ev.e.x, ev.e.z) + Math.min(topOf(ev.e), 3.4) + 0.4, ev.e.z), "+" + ev.n, { color: "#ffd76a", small: true }); }      /* 补刀的金币进同一摞：排在最后一下伤害的下面，不和它叠 */
      else if (ev.t === "level" && (!ev.e || ev.e === sim.hero) && sim.time > 0.5 && !sim.reveal) { const h = sim.hero, gy = Math.max(o.height(h.x, h.z), o.waterY);
        if (o.fxl) { const f = o.fxl;      // 升级（第九轮）：脚下一圈金色的环往外推，一道金光从脚下升起来，几颗光点绕着往上飘（LoL 的路子），亮只亮开头那一下
          f.ring(h.x, h.z, 2.6, 0xffe9a8, 0.55); f.decal({ kind: "rune", x: h.x, z: h.z, r: 1.6, life: 0.9, color: 0xffe2a0, alpha: 0.7, add: true, fadeIn: 0.05, fadeOut: 0.6, spin: 2 });
          f.column({ x: h.x, z: h.z, r: 0.95, h: 4.6, life: 0.75, color: 0xfff1c8, color2: 0xffb84a, kind: "light" });
          f.burst({ pos: { x: h.x, y: gy + 0.3, z: h.z }, n: 14, sprite: SPR.glint, add: true, ringR: 1.0, color: [0xfff6dc, 0xffc861], size: [0.14, 0.26], life: [0.6, 1.0], speed: 0.2, up: 3.2, drag: 0.6 }); }
        else fx.ripple(v3.set(h.x, gy, h.z), 0xffe9a8, 3.2);
        fx.text(v3.set(sim.hero.x, o.height(sim.hero.x, sim.hero.z) + LOOK.height + 1.2, sim.hero.z), "升到 " + ev.n + " 级", false, "#ffe9a8"); }
      else if (ev.t === "warn" && o.fxl) {      // 重击的预警：一个红圈，里面一层从中心往外涨，涨满的那一刻落下（LoL 的画法）
        o.fxl.decal({ kind: "disc", x: ev.x, z: ev.z, r: ev.r, life: ev.sec + 0.06, color: 0xff5a3a, alpha: 0.75, fadeIn: 0.1, fadeOut: 0.04, lift: 0.1 });
        o.fxl.decal({ kind: "disc", x: ev.x, z: ev.z, r: ev.r, life: ev.sec, color: 0xff7a4a, alpha: 0.5, from: 0.08, fadeIn: 0.05, fadeOut: 0.02, lift: 0.11 }); }
      else if (ev.t === "slam" && o.fxl) { const f = o.fxl, gy = f.ground(ev.x, ev.z), boss = !!MOBS[ev.src.mob]?.boss, near = Math.hypot(ev.x - sim.hero.x, ev.z - sim.hero.z);      // 重击落下：一圈震波、地上的裂纹、扬起来的土
        f.ring(ev.x, ev.z, ev.r, 0xb9ad94, 0.5, false); f.decal({ kind: "crack", x: ev.x, z: ev.z, r: ev.r * 0.8, life: 2.6, color: 0x2a2520, color2: 0x8a7a66, alpha: 0.7, fadeIn: 0.03, fadeOut: 0.5 });
        f.burst({ pos: { x: ev.x, y: gy + 0.15, z: ev.z }, n: boss ? 34 : 20, sprite: SPR.dust, ringR: ev.r * 0.55, color: [0xd9cdb4, 0x7d745f], alpha: 0.75, size: [0.5, 1.0], grow: 2.2, life: [0.6, 1.1], speed: [0.6, 2.2], up: 1.6, drag: 1.8 });
        f.burst({ pos: { x: ev.x, y: gy + 0.2, z: ev.z }, n: boss ? 16 : 9, sprite: SPR.shard, radius: ev.r * 0.4, color: [0x9a9a8c, 0x57504e], size: [0.12, 0.26], life: [0.5, 0.9], speed: [3, 7], up: 5, gravity: 14, spin: 6 });
        if (near < 24) f.shake(boss ? 0.2 : 0.1, boss ? 0.4 : 0.25); }
      else if (ev.t === "roar" && o.fxl && ev.e.seen) { o.fxl.ring(ev.e.x, ev.e.z, 9, 0xfff0d0, 0.8); o.fxl.ring(ev.e.x, ev.e.z, 6, 0xffb38a, 0.6); o.fxl.shake(0.12, 0.6); }
      else if (ev.t === "buff" && o.fxl && ev.e.seen) { const B = BUFFS[ev.id], f = o.fxl; if (B) { f.ring(ev.e.x, ev.e.z, 2.6, B.color, 0.6); f.column({ x: ev.e.x, z: ev.e.z, r: 0.9, h: 3.6, life: 0.7, color: B.color, color2: B.color, kind: "light" });
        if (ev.e === sim.hero && !sim.reveal) fx.text(v3.set(ev.e.x, o.height(ev.e.x, ev.e.z) + LOOK.height + 1.2, ev.e.z), B.name, false, "#" + B.color.toString(16).padStart(6, "0")); } }
      else if (ev.t === "die" && ev.e.kind === "hero" && o.fxl && (ev.e.seen || ev.e.team === 0)) { const e = ev.e, f = o.fxl, gy = Math.max(o.height(e.x, e.z), o.waterY), col = KITS[e.h?.kit ?? ""]?.color ?? HUE[e.team === 1 ? 1 : 0];      // 英雄阵亡（第九轮）：倒下的那一下身上散出一团暗色的烟和几点自己颜色的光，往上飘走；脚下一圈暗的
        f.burst({ pos: { x: e.x, y: gy + 1.2, z: e.z }, n: 8, sprite: SPR.smoke, color: [0x2a2c30, 0x121316], alpha: [0.3, 0.45], size: [0.9, 1.4], grow: 2.2, life: [0.9, 1.4], speed: [0.3, 1.0], up: 0.9, radius: 0.6, drag: 1 });
        f.burst({ pos: { x: e.x, y: gy + 1.0, z: e.z }, n: 12, sprite: SPR.ember, add: true, color: [0xffffff, col], size: [0.1, 0.2], life: [0.9, 1.6], speed: [0.2, 0.8], up: 2.0, radius: 0.7, drag: 0.8 });
        f.decal({ kind: "dark", x: e.x, z: e.z, r: 1.8, life: 2.4, color: 0x0b0c0e, color2: 0x1e2226, alpha: 0.5, fadeIn: 0.1, fadeOut: 0.6 }); f.ring(e.x, e.z, 2.4, col, 0.5); }
      else if (ev.t === "die" && (ev.e.kind === "tower" || ev.e.kind === "core")) { const e = ev.e, y = o.height(e.x, e.z); o.buildings.destroy(e.x, e.z); rubble(e);
        for (let i = 0; i < 5; i++) fx.hit(v3.set(e.x + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 5, e.z + (Math.random() - 0.5) * 3), true);
        fx.ripple(v3.set(e.x, y, e.z), 0xd8d2c0, e.kind === "core" ? 9 : 5.5); fx.ripple(v3.set(e.x, y, e.z), HUE[e.team], e.kind === "core" ? 6 : 3.6); boom(e, y); }
    }
    sim.events.length = 0;
  }

  let shown = 0;
  // ---- 状态的显示（第九轮 polish-lib 重做，照 LoL）：原来每 0.16 秒在身上喷几颗粒子，几个人一起被晕时满屏星星像撒彩纸。
  // 现在每个单位一套常驻的小图标，整齐、小、一眼认得出，状态在就在，没了就收：
  //   眩晕：头顶一圈五颗小金星，平着绕头转（LoL 的晕星）；沉默：头顶一个紫色的“禁言”小牌；易伤：头顶一块裂开的橙色小盾（和沉默同时有就并排）；
  //   减速：膝盖高度三个淡蓝的向下箭头慢慢绕身子转；定身：脚下贴地一个骨白的镣圈（四个卡扣），套上的那一下收紧；
  //   护盾：一层只亮边缘的罩子（中间几乎透明），挨打时边缘亮一下。技能自己画了罩子的（api.shieldOwn：摩珂的水泡、托尔格的钟罩）通用的就不画。
  // 图标都画在一张小图集上（代码画的，深色描边、亮色填充：深色地面上靠暗边托出来，不靠更亮），所有单位所有图标一次绘制。
  const ICON = { star: 0, silence: 1, slow: 2, vuln: 3, shackle: 4 } as const;
  const iconTex = (() => {
    const S = 128, cv = document.createElement("canvas"); cv.width = S * 4; cv.height = S * 2; const c = cv.getContext("2d")!;
    const at = (i: number, draw: () => void) => { c.save(); c.translate((i % 4) * S, Math.floor(i / 4) * S); draw(); c.restore(); };
    const lin = (y0: number, y1: number, stops: [number, string][]) => { const g = c.createLinearGradient(0, y0, 0, y1); for (const [p, s] of stops) g.addColorStop(p, s); return g; };
    at(ICON.star, () => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832 - 1.5708, r = i % 2 ? 21 : 48; c.lineTo(64 + Math.cos(a) * r, 66 + Math.sin(a) * r); } c.closePath(); c.lineJoin = "round";
      c.lineWidth = 9; c.strokeStyle = "rgba(48,28,6,0.92)"; c.stroke(); c.fillStyle = lin(20, 110, [[0, "#fffbe2"], [0.45, "#ffd862"], [1, "#e09a1e"]]); c.fill();
      c.fillStyle = "rgba(255,255,255,0.75)"; c.beginPath(); c.ellipse(56, 50, 7, 4, -0.5, 0, 6.2832); c.fill(); });
    at(ICON.silence, () => { c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); c.arc(64, 60, 40, 0, 6.2832); c.moveTo(46, 94); c.lineTo(38, 112); c.lineTo(62, 99); c.closePath(); c.lineWidth = 10; c.strokeStyle = "rgba(14,8,24,0.92)"; c.stroke(); c.fillStyle = lin(20, 110, [[0, "#6b55a0"], [1, "#2e2148"]]); c.fill();
      c.lineWidth = 4; c.strokeStyle = "#d9c9ff"; c.beginPath(); c.arc(64, 60, 40, 0, 6.2832); c.stroke();
      c.fillStyle = "#efe6ff"; for (const x of [46, 64, 82]) { c.beginPath(); c.arc(x, 60, 6.5, 0, 6.2832); c.fill(); }
      c.lineWidth = 13; c.strokeStyle = "rgba(14,8,24,0.95)"; c.beginPath(); c.moveTo(38, 88); c.lineTo(90, 32); c.stroke(); c.lineWidth = 6.5; c.strokeStyle = "#ff9aa8"; c.stroke(); });
    at(ICON.slow, () => { c.lineJoin = "round"; c.lineCap = "round";
      for (const dy of [0, 32]) { c.beginPath(); c.moveTo(28, 30 + dy); c.lineTo(64, 62 + dy); c.lineTo(100, 30 + dy); c.lineWidth = 24; c.strokeStyle = "rgba(6,22,34,0.9)"; c.stroke(); c.lineWidth = 12; c.strokeStyle = lin(28 + dy, 64 + dy, [[0, "#f2fbff"], [1, "#7cc6f4"]]); c.stroke(); } });
    at(ICON.vuln, () => { c.lineJoin = "round"; c.lineCap = "round"; const sh = () => { c.beginPath(); c.moveTo(64, 16); c.lineTo(102, 28); c.quadraticCurveTo(102, 84, 64, 112); c.quadraticCurveTo(26, 84, 26, 28); c.closePath(); };
      sh(); c.lineWidth = 10; c.strokeStyle = "rgba(40,14,4,0.92)"; c.stroke(); c.fillStyle = lin(16, 112, [[0, "#ffd08a"], [0.5, "#ff8a2e"], [1, "#c2420e"]]); c.fill();
      c.beginPath(); c.moveTo(66, 18); c.lineTo(56, 46); c.lineTo(72, 62); c.lineTo(58, 88); c.lineTo(64, 110); c.lineWidth = 7; c.strokeStyle = "rgba(40,14,4,0.95)"; c.stroke(); });
    at(ICON.shackle, () => { c.lineWidth = 11; c.strokeStyle = "rgba(24,20,14,0.85)"; c.beginPath(); c.arc(64, 64, 48, 0, 6.2832); c.stroke(); c.lineWidth = 5; c.strokeStyle = "#e8dec0"; c.stroke();
      for (let i = 0; i < 4; i++) { c.save(); c.translate(64, 64); c.rotate(0.785 + i * 1.5708); c.fillStyle = "rgba(24,20,14,0.92)"; c.fillRect(41, -9, 14, 18); c.fillStyle = "#c4b99c"; c.fillRect(43.5, -6.5, 9, 13); c.restore(); } });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return t; })();
  const MAXI = 320, icoGeo = new THREE.InstancedBufferGeometry(); { const p = new THREE.PlaneGeometry(1, 1); icoGeo.index = p.index; icoGeo.setAttribute("position", p.getAttribute("position")); icoGeo.setAttribute("uv", p.getAttribute("uv")); }
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3), iDat = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 4), 4), iOff = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
  for (const a of [iPos, iDat, iOff]) a.setUsage(THREE.DynamicDrawUsage); icoGeo.setAttribute("iPos", iPos); icoGeo.setAttribute("iDat", iDat); icoGeo.setAttribute("iOff", iOff); icoGeo.instanceCount = 0;
  const icons = new THREE.Mesh(icoGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uMap: { value: iconTex } },
    vertexShader: /* glsl */ `attribute vec3 iPos, iOff; attribute vec4 iDat; varying vec2 vUv; varying float vA;
      void main() { float cs = cos(iDat.y), sn = sin(iDat.y); vec2 q = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y) * iDat.x; vA = iDat.w;
        vec4 mv = iOff.z > 0.5 ? modelViewMatrix * vec4(iPos + vec3(q.x, 0.0, -q.y), 1.0) : modelViewMatrix * vec4(iPos, 1.0);      /* iOff.z：1 是贴地的（镣圈），0 是正对镜头的 */
        if (iOff.z < 0.5) mv.xy += q + iOff.xy; gl_Position = projectionMatrix * mv;
        vUv = (vec2(mod(iDat.z, 4.0), 1.0 - floor(iDat.z / 4.0)) + uv) / vec2(4.0, 2.0); }`,
    fragmentShader: /* glsl */ `uniform sampler2D uMap; varying vec2 vUv; varying float vA;
      void main() { vec4 t = texture2D(uMap, vUv); float a = t.a * vA; if (a < 0.01) discard; gl_FragColor = vec4(t.rgb, a);
        #include <colorspace_fragment>
      }` }));
  icons.frustumCulled = false; icons.renderOrder = 25; group.add(icons);
  let ni = 0; const icon = (x: number, y: number, z: number, size: number, cell: number, a: number, rot = 0, ox = 0, oy = 0, flat = false) => { if (ni >= MAXI || a <= 0.01) return; iPos.setXYZ(ni, x, y, z); iDat.setXYZW(ni, size, rot, cell, a); iOff.setXYZ(ni, ox, oy, flat ? 1 : 0); ni++; };
  // 护盾泡：一个球，只有边缘亮（菲涅尔），中间几乎透明；上半边亮一点，挨打时整圈亮一下。每个带盾的单位一个，用池子
  const bubGeo = new THREE.SphereGeometry(1, 36, 20), bubFree: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[] = [];
  const bubble = () => bubFree.pop() ?? (() => { const m = new THREE.Mesh(bubGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...glowBlend(), uniforms: { uA: { value: 0 }, uHit: { value: 0 } },
    vertexShader: `varying vec3 vN, vV; varying float vY; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uA, uHit; varying vec3 vN, vV; varying float vY; ${FXB.on ? BOUT : ""}
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))), rim = pow(f, 2.6), up = 0.7 + 0.3 * clamp(vY * 0.6 + 0.5, 0.0, 1.0);
        float a = uA * (0.035 + rim * 0.62 * up + uHit * (0.06 + 0.5 * rim)); if (a < 0.003) discard;
        vec3 col = mix(${FXB.on ? "vec3(0.06, 0.3, 0.85)" : "vec3(0.55, 0.84, 1.0)"}, vec3(1.0), clamp(rim * 0.55 + uHit * 0.6, 0.0, 1.0)); ${glowOut("col", "a")}      /* 换画风 B：罩子的边是饱和的天蓝（亮地面上淡蓝的叠加光看不见），挨打时边上发白 */
      }` })); m.frustumCulled = false; m.renderOrder = 24; group.add(m); return m; })();
  type St = { stun: number; root: number; slow: number; sil: number; vul: number; sh: number; hit: number; last: number; bub: ReturnType<typeof bubble> | null; mark: number; clock: number };
  const stMap = new Map<number, St>(), fxl = o.fxl; let stFrame = 0;
  const ease = (v: number, on: boolean, dt: number) => on ? Math.min(1, v + dt / 0.12) : Math.max(0, v - dt / 0.16);      // 出来 0.12 秒、收起 0.16 秒
  function statusFx(e: Ent, dt: number) {
    const rooted = e.root > 0 && e.root < 1e6, own = (OWN_SHIELD.get(e.id) ?? 0) > sim.time, shielded = e.shield > 0 && !own, buffed = !!e.h && (e.h.mods.has("buff_blue") || e.h.mods.has("buff_red"));      /* 测试场的靶子小兵 root 是 1e9（钉在原地），不算定身 */
    const act = e.stun > 0 || rooted || e.slow > 0 || e.silence > 0 || e.vulnT > 0 || shielded || buffed;
    let s = stMap.get(e.id); if (!act && !s) return;
    if (!s) { s = { stun: 0, root: 0, slow: 0, sil: 0, vul: 0, sh: 0, hit: 0, last: 0, bub: null, mark: 0, clock: 0 }; stMap.set(e.id, s); } s.mark = stFrame;
    s.stun = ease(s.stun, e.stun > 0, dt); s.root = ease(s.root, rooted, dt); s.slow = ease(s.slow, e.slow > 0, dt); s.sil = ease(s.sil, e.silence > 0, dt); s.vul = ease(s.vul, e.vulnT > 0, dt); s.sh = ease(s.sh, shielded, dt);
    const hero = e.kind === "hero", gy = Math.max(o.height(e.x, e.z), o.waterY), top = hero ? (KITS[e.h?.kit ?? ""]?.height ?? LOOK.height) : topOf(e), k = hero ? 1 : e.kind === "monster" ? Math.max(0.9, Math.min(1.6, e.r / 0.7)) : 0.86, t = sim.time + e.id * 0.37;
    if (s.stun > 0) { const n = hero ? 5 : 4, R = (hero ? 0.62 : 0.42) * (e.kind === "monster" ? k : 1), y = gy + top - (hero ? 0.12 : 0.02), a0 = t * 2.4;      // 晕星：一圈平着绕头转，自己也慢慢转；出来的时候从小圈张开
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * 6.2832; icon(e.x + Math.cos(a) * R * (0.6 + 0.4 * s.stun), y + Math.sin(a * 2 + i) * 0.025, e.z + Math.sin(a) * R * (0.6 + 0.4 * s.stun), 0.36 * k, ICON.star, s.stun, a * 1.3); } }
    { const y = gy + top + (hero ? 0.12 : 0.24), sz = 0.56 * k, both = s.sil > 0 && s.vul > 0, bob = Math.sin(t * 3) * 0.03;      // 头顶的小牌：沉默、易伤，同时有就左右并排
      if (s.sil > 0) icon(e.x, y + bob, e.z, sz * (0.7 + 0.3 * s.sil), ICON.silence, s.sil, 0, both ? -sz * 0.55 : 0);
      if (s.vul > 0) icon(e.x, y + bob, e.z, sz * 0.9 * (0.7 + 0.3 * s.vul), ICON.vuln, s.vul, 0, both ? sz * 0.55 : 0); }
    if (s.slow > 0) { const R = e.r + (hero ? 0.38 : 0.26), y = gy + (hero ? 0.55 : 0.32) * (e.kind === "monster" ? k : 1), a0 = t * 0.9;      // 减速：膝盖高度三个向下的箭头，慢慢绕着转
      for (let i = 0; i < 3; i++) { const a = a0 + (i / 3) * 6.2832; icon(e.x + Math.cos(a) * R, y - 0.05 * Math.sin(t * 2.2 + i * 2.1), e.z + Math.sin(a) * R, 0.38 * k, ICON.slow, s.slow * 0.9); } }
    if (s.root > 0) icon(e.x, gy + 0.07, e.z, (hero ? 1.5 : (e.r + 0.18) * 2.1) * (1 + 0.35 * (1 - s.root)), ICON.shackle, s.root * 0.9, 0.3, 0, 0, true);      // 镣圈：套上的那一下从大往小收紧
    if (e.shield < s.last - 0.5) s.hit = 1; s.last = e.shield; s.hit = Math.max(0, s.hit - dt * 5);
    if (s.sh > 0) { const b = (s.bub ??= bubble()), hr = hero ? 1.05 : e.r + 0.4, vr = top * (hero ? 0.56 : 0.62); b.visible = true; b.position.set(e.x, gy + vr * 0.86, e.z); b.scale.set(hr * (0.9 + 0.1 * s.sh), vr * (0.9 + 0.1 * s.sh), hr * (0.9 + 0.1 * s.sh)); b.material.uniforms.uA.value = s.sh; b.material.uniforms.uHit.value = s.hit; }
    else if (s.bub) { s.bub.visible = false; bubFree.push(s.bub); s.bub = null; }
    if (buffed && fxl && (s.clock += dt) >= 0.16) { s.clock = 0; for (const id of ["blue", "red"]) if (e.h!.mods.has("buff_" + id)) fxl.burst({ pos: { x: e.x, y: gy + 0.15, z: e.z }, n: 1, sprite: SPR.glint, add: true, ringR: e.r + 0.45, color: BUFFS[id].color, alpha: 0.7, size: [0.12, 0.2], life: [0.5, 0.8], speed: 0.1, up: 1.1 }); }      // 身上带着野怪增益：脚边一圈慢慢往上飘的小光点
    if (!act && s.stun + s.root + s.slow + s.sil + s.vul + s.sh <= 0) { if (s.bub) { s.bub.visible = false; bubFree.push(s.bub); } stMap.delete(e.id); }
  }
  function update(dt: number, cx: number, cz: number, camDist: number) {
    camX = cx; camZ = cz; for (let i = later.length - 1; i >= 0; i--) if ((later[i].t -= dt) <= 0) later.splice(i, 1)[0].fn();
    events(); tickFlashes(dt);
    const near = Math.max(34, camDist * 1.5); let nb = 0, ns = 0; shown = 0;
    const bar = (x: number, y: number, z: number, ratio: number, color: number, w: number, h = 0.15) => { if (nb >= MAXB) return; bPos.setXYZ(nb, x, y, z); bDat.setXYZW(nb, ratio, color, w, h); nb++; };
    // 小兵的模型等它第一次走进镜头附近、而且看得见的时候才建：一波兵不会在同一帧里全建出来
    let made = 0; for (const e of sim.ents) { if ((e.kind !== "melee" && e.kind !== "ranged" && e.kind !== "monster") || !e.alive || views.has(e.id) || made >= 3) continue; if (e.seen && Math.hypot(e.x - cx, e.z - cz) < near) { spawn(e); made++; } }
    for (const [id, v] of views) {
      const e = v.e, mob = e.kind === "monster", M = mob ? MOBS[e.mob] : null, R = e.kind === "melee" ? RULES.melee : RULES.ranged, D = defs[e.kind], close = Math.hypot(e.x - cx, e.z - cz) < near, boss = !!M?.boss, lie = boss ? 4.5 : 2.2;
      if (!e.alive) { if (v.deadT === 0) { if (v.acts.death) setAnim(v, "death", mob ? 1 : 1.25, true); else v.deadT = 1.6; } v.deadT += dt; if (v.deadT > lie) v.root.position.y -= dt * (boss ? 1.1 : 0.55); if (v.deadT > lie + (boss ? 2.6 : 1.5)) { group.remove(v.root); v.mixer.stopAllAction(); views.delete(id); continue; } }
      else if (M) {      // 野怪：动作的快慢按规则里出手的时间对齐（时间表里写了第几秒打中）
        const mt = v.K.meta, a1 = mt.attacks?.[0], a2 = mt.attacks?.[1] ?? a1, sp = (hit: number | undefined, wind: number) => Math.max(0.45, Math.min(2.4, (hit ?? wind) / wind));
        if (e.state === "attack") { if (v.cur !== "attack" || e.swing < dt * 1.5) setAnim(v, "attack", sp(a1?.hit, M.wind), true, true); }
        else if (e.state === "heavy") { if (v.cur !== "heavy" || e.swing < dt * 1.5) setAnim(v, "heavy", sp(a2?.hit, M.heavy?.wind ?? 1), true, true); }
        else if (e.state === "roar") { if (v.cur !== "roar") setAnim(v, v.acts.roar ? "roar" : "idle", 1, !!v.acts.roar, true); }
        else if (e.state === "walk") setAnim(v, "walk", M.speed * (e.target ? 1 : 1.3) / (mt.runSpeed ?? M.speed)); else setAnim(v, "idle");
        const gy = o.height(e.x, e.z); v.y += (gy - v.y) * Math.min(1, dt * 14); v.root.position.set(e.x, v.y, e.z); v.root.rotation.y = e.yaw;
      } else {
        if (e.state === "attack") { if (v.cur !== "attack" || e.swing < dt * 1.5) setAnim(v, "attack", D.hit / R.wind, true, true); } else if (e.state === "walk") setAnim(v, "walk", R.speed / D.walkSpeed / (e.big ? BIG : 1)); else setAnim(v, "idle");
        const gy = o.height(e.x, e.z); v.y += (gy - v.y) * Math.min(1, dt * 14); v.root.position.set(e.x, v.y, e.z); v.root.rotation.y = e.yaw;
      }
      const vis = e.seen && close; v.root.visible = vis; if (!vis) { if (e.alive && Math.hypot(e.x - cx, e.z - cz) > near + 25) { group.remove(v.root); v.mixer.stopAllAction(); views.delete(id); } continue; } shown++;      // 走远了就把模型撤掉
      v.mixer.update(dt);
      if (e.alive && v.y < o.waterY - 0.08) { v.wade += dt * (e.state === "walk" ? 1 : 0.25); if (v.wade > 0.2) { v.wade = 0; addWake(e.x, e.z, e.big ? 0.5 : 0.36); } }      /* 小兵蹚水也起涟漪 */
      if (e.alive && M) { const big = !!M.heavy, ring = v.K.meta.ring ?? MOB_SIZE[e.mob]?.ring ?? 1;      /* 野怪的血条：琥珀色；增益怪和 Boss 的又宽又厚。满血而且没在打的时候不画，营地里不会常年顶着几条 */
        if (e.hp < e.max || e.fight > 0) bar(e.x, v.y + v.K.height + 0.3 + (v.K.meta.bar ?? 0), e.z, e.hp / e.max, big ? 7 : 3, boss ? 5.2 : big ? 2.6 : 1.15, boss ? 0.3 : big ? 0.2 : 0.1);
        if (ns < 160) { m4.makeScale(ring, 1, ring).setPosition(e.x, Math.max(v.y, o.waterY) + 0.03, e.z); blobs.setMatrixAt(ns++, m4); } }
      else if (e.alive) { bar(e.x, v.y + D.height * (e.big ? BIG : 1) + 0.24, e.z, e.hp / e.max, e.team, e.big ? 1.25 : 0.86, e.big ? 0.1 : 0.075);      /* 小兵的血条又小又细、没有字（LoL）：英雄的那条是它的四倍宽 */ if (ns < 160) { m4.makeTranslation(e.x, Math.max(v.y, o.waterY) + 0.03, e.z); blobs.setMatrixAt(ns++, m4); } }
    }
    stFrame++; ni = 0; for (const e of sim.ents) if (e.alive && e.seen && e.kind !== "tower" && e.kind !== "core" && Math.hypot(e.x - cx, e.z - cz) < near) statusFx(e, dt);
    for (const [id, s] of stMap) if (s.mark !== stFrame) { if (s.bub) { s.bub.visible = false; bubFree.push(s.bub); } stMap.delete(id); }      // 死了、走进迷雾、离开镜头的：图标马上收
    icoGeo.instanceCount = ni; iPos.needsUpdate = iDat.needsUpdate = iOff.needsUpdate = true;
    for (const e of sim.ents) { if (!e.alive || (e.kind !== "tower" && e.kind !== "core")) continue; if (Math.hypot(e.x - cx, e.z - cz) > near + 10 || (e.team === 0 && e.hp >= e.max)) continue;      /* 自己的塔和水晶满血时不画血条：在基地里走动时不会顶着几条大绿条 */ bar(e.x, o.height(e.x, e.z) + (e.kind === "core" ? 4.8 : 4.4), e.z, e.hp / e.max, (e.open || e.team === 0 ? e.team : 2) + 4, e.kind === "core" ? 3.8 : 2.6, 0.2); }      /* 血条固定在塔身上离地四米多的位置，不跟镜头。不放在塔顶：塔有七到十米高，镜头近，站在塔下打它的时候塔顶在画面外 */
    bPos.needsUpdate = true; bDat.needsUpdate = true; barGeo.instanceCount = nb; blobs.count = ns; blobs.instanceMatrix.needsUpdate = true;
    for (const [id, b] of bolts) { if (!b.s.alive) { group.remove(b.head); group.remove(b.tail); b.rib?.stop(); bolts.delete(id); continue; } v3.set(b.s.x, b.s.y + o.height(b.s.from.x, b.s.from.z), b.s.z); /* 弹道的高度是相对出手那座塔脚下算的 */ b.head.position.copy(v3); b.tail.position.copy(v3); const vis = b.s.to.seen || b.s.from.team === 0; b.head.visible = vis; b.tail.visible = vis; if (vis) b.rib?.at(v3.x, v3.y, v3.z); }
    { let n = 0; const p = aimGeo.getAttribute("position") as THREE.BufferAttribute, h = sim.hero, W = 0.065;
      for (const e of sim.ents) { if (n >= AIMS || !e.alive || e.team !== 1 || e.target !== h || !h.alive || (e.kind !== "tower" && e.kind !== "core")) continue;
        aimA.set(e.x, o.height(e.x, e.z) + topOf(e) - 1.4, e.z); aimB.set(h.x, o.height(h.x, h.z) + 1.5, h.z); aimD.subVectors(aimB, aimA).normalize(); aimS.crossVectors(aimD, UP).normalize().multiplyScalar(W); aimT.crossVectors(aimD, aimS).normalize().multiplyScalar(W);
        let k = n * 8; for (const sd of [aimS, aimT]) { p.setXYZ(k++, aimA.x + sd.x, aimA.y + sd.y, aimA.z + sd.z); p.setXYZ(k++, aimA.x - sd.x, aimA.y - sd.y, aimA.z - sd.z); p.setXYZ(k++, aimB.x + sd.x, aimB.y + sd.y, aimB.z + sd.z); p.setXYZ(k++, aimB.x - sd.x, aimB.y - sd.y, aimB.z - sd.z); } n++; }
      p.needsUpdate = true; aimGeo.setDrawRange(0, n * 12); aims.material.opacity = 0.5 + 0.18 * Math.sin(sim.time * 9); }
  }
  /** 鼠标指着哪个单位。team 不给就是哪一队都算；not 是不要哪一队（点敌人时不要自己这一队，野怪也算进来）；玩家自己的英雄不算 */
  function pick(ray: THREE.Ray, team?: number, not?: number): Ent | null {
    let best: Ent | null = null, bd = 1e9;
    for (const e of sim.ents) { if (!e.alive || (team !== undefined && e.team !== team) || e.team === not || !e.seen || e.untarget || e === sim.hero) continue; const y = o.height(e.x, e.z), h = topOf(e), r = e.kind === "core" ? 4.2 : e.kind === "tower" ? 2.1 : e.kind === "hero" ? 1.1 : e.kind === "monster" ? e.r + 0.5 : 0.85;
      const d = Math.sqrt(ray.distanceSqToSegment(v3.set(e.x, y + 0.2, e.z), v3b.set(e.x, y + h, e.z))); if (d < r) { const dd = ray.origin.distanceTo(v3) - (e.kind === "tower" || e.kind === "core" ? 0 : 3); if (dd < bd) { bd = dd; best = e; } } }
    return best;
  }
  return { update, pick, count: () => ({ minions: views.size, shown }) };
}
