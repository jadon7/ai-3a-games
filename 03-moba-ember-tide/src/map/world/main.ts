// 整张地图入口（阶段 2.4 起）。2.4 做了墙、山体和高低；2.5 做了手绘的地面、地表的短草和小石子。
// 2.6 做了草丛、城墙外的树、枯木、岸边的水草。2.7 把塔、水晶、出生点换成正式的模型（还没有模型的仍是白色占位）。
//   默认            游戏镜头，拖动或 WASD 平移，滚轮缩放，Q / E 转镜头
//   ?cam=u,v,距离,俯角,高度,转角   固定机位（路向坐标；高度是镜头看向的点离地多高），截图用
//   ?top=1&span=96&c=x,z          正俯视（默认看整张图）
//   ?guide=i,j&n=2&px=2048        把整张地面的布局图分成 n×n 块，画第 (i,j) 块
//   ?guide=1&gc=cx,cz&gs=60       以世界坐标 (cx,cz) 为中心、边长 gs 米的一块布局图
//   ?hide=a,b                     隐藏某一类（ground、water、walls、ramparts、tufts、marks、details、brush、trees、shore、buildings、gateprops）
//   ?man=u,v;u,v                  在这些位置（路向坐标）各立一个两米高的小人，看比例用
//   ?hero=u,v,朝向,队伍            英雄站在哪（路向坐标；朝向是角度，0 朝镜头；队伍 0 我方 1 对方）。不写就站在一进来看的地方；hero=0 不放
//   ?look=lift:1.2,rim:1.4         调英雄的画面参数（见 hero/hero.ts 的 LOOK），调试用
//   ?play=0                       不操控英雄，只当地图查看器用（WASD 平移、Q / E 转镜头）
//   ?speed=4                      对局按几倍速走（测试用）
//   ?auto=1                       自己的英雄也交给电脑打（测试和录像用，见 game/bot.ts）
//   ?diff=easy|normal|hard        电脑的难度（默认 normal）；?ally= 单独指定队友的难度
//   ?pos=top|jungle|mid|adc|sup   自己打什么位置（第九轮 5v5；不写就按英雄的主位置。旧的 ?lane=mid|top|bot 照旧认）
//   ?a=上,野,中,射,辅&b=…         两队的五个英雄（按位置的顺序，选人界面排好写进来的；不写就照 game/lineup.ts 的规矩现排，?seed=数字 换一种排法）
//   ?solo=1                       只有自己一个英雄、没有电脑（阶段 5 以前的玩法，回归测试用）
//   ?director=1                   观战（导播）：十个英雄都交给电脑，镜头自己跟着打架的地方走，击杀时慢放（见 game/director.ts）
//   ?fps=1                        左下角显示帧率
// 什么参数都不带：主菜单（game/lobby.ts）。选好英雄以后带着 ?h= 重新载入，直接进对局
// 操控（第九轮改成 LoL 的习惯）：右键点地面移动、右键点对方的小兵、塔、水晶普攻，按住右键拖着走；左键确认技能；Q W E R 技能，A 打最近的，S 停下；
// 按住左键拖动或点小地图看别处，空格回到英雄身上。触屏：点地面走、点敌人打（松手时算，拖动是平移镜头）

import * as THREE from "three";
import { TOON_ON, T } from "../toon";      // 画风 B 的光照和调色（style-b 默认开，?toon=0 退回厚涂写实版；见 toon.ts）
import { clamp } from "../../core/noise";
import { A_CORNER, coreSpots, fields, fountainSpots, toLane, toWorld, towerSpots } from "../layout";
import { WATER_Y, plateau, terrainHeight } from "../terrain";
import { surface } from "../slice/guide";
import { createWalls, useGround, type StoneTextures } from "../slice/stone";
import { createWater } from "../slice/water";
import { W_HALF, createWorldGround } from "./ground";
import { kitSee } from "../kit/materials";
import { renderWorldGuide } from "./guide";
import { createRamparts } from "./ramparts";
import { createTufts } from "./tufts";
import { createDetails } from "./details";
import { createBrush } from "./brush";
import { createTrees } from "./trees";
import { createShore } from "./shore";
import { coreName, createBuildings, loadKitIndex, spawnName, towerName } from "./buildings";
import { createGateProps } from "./gateprops";
import { loadHero, type Hero } from "../hero/hero";
import { createNav, gateSolids } from "../game/nav";
import { createPlay, type Play } from "../game/play";
import { createActor, normMeta, type Actor } from "../game/actor";
import { createSkills } from "../game/skills";
import { createFxLib, type FxLib } from "../game/fxlib";
import { warmIti } from "../game/fx_iti";
import { createScreenFx, type ScreenFx } from "../game/fx_iti_screen";      // iti-fx3：屏幕级的演出（压暗、镜头推拉、泛光、打击帧……），没人调就什么都不发生
import { POS, kitOf } from "../game/heroes";
import { readLineup, spawnAt } from "../game/lineup";
import { itemOf } from "../game/items";
import { createBot, createBrain, type Bot, type Brain, type Diff } from "../game/bot";
import { createArena, type Arena } from "../game/arena";
import { createFx, type Fx } from "../game/fx";
import { createSim, type Sim } from "../game/sim";
import { createView, type View } from "../game/view";
import { createFow, type Fow } from "../game/fow";
import { createHud, type Hud } from "../game/hud";
import { createLobby, goHome, setLoad, showLoading, showResult } from "../game/lobby";
import { createDirector } from "../game/director";
import { createEnding, type Ending } from "../game/ending";
import { LITE, TOUCH, glb } from "../quality";
import { blocked, initMobile } from "../game/mobile";
import { sfx } from "../game/sfx";

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

if (params.has("guide") || params.has("top") || params.get("vig") === "0") document.getElementById("vig")?.remove();      // 画布局图、正俯视截图时不要暗角
else if (TOON_ON) { const v = document.getElementById("vig"); if (v) v.style.background = "radial-gradient(ellipse 80% 80% at 50% 46%, rgba(10,30,40,0) 62%, rgba(10,30,40,.16) 100%)"; }      // 画风 B：暗角轻一半、偏冷青，不压脏亮地面
if (params.has("guide")) {
  (document.getElementById("view") as HTMLCanvasElement).style.display = "none";
  const cv = document.getElementById("guide") as HTMLCanvasElement; cv.hidden = false;
  if (params.has("gc")) {                                 // ?guide=1&gc=cx,cz&gs=60：以 (cx,cz) 为中心、边长 gs 米的一块（2.5 分区重绘用）
    const [cx, cz] = params.get("gc")!.split(",").map(Number);
    renderWorldGuide(cv, cx, cz, num("gs", 60), num("px", 2048));
  } else {
    const [i, j] = params.get("guide")!.split(",").map(Number), n = num("n", 2), size = (W_HALF * 2) / n;
    renderWorldGuide(cv, -W_HALF + (i + 0.5) * size, -W_HALF + (j + 0.5) * size, size, num("px", 2048));
  }
  (window as any).__stats = { fps: 0, tris: 0, calls: 0 }; (window as any).__ready = true;
} else boot().catch(e => { console.error(e); document.getElementById("hud")!.textContent = "出错了：" + e; });

/** 塔、水晶、出生点的占位白模：只为了看比例和位置，2.7 换成正式的模型 */
function createMarks(have: Set<string>): THREE.Group {
  const group = new THREE.Group(); group.name = "marks";
  const mat = [0xc6d2c8, 0xd6c3bc].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  const add = (g: THREE.BufferGeometry, team: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(g, mat[team]); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m); };
  for (const t of towerSpots()) {
    if (have.has(towerName(t.team, t.tier))) continue;      // 这座塔已经有正式的模型了
    const y = terrainHeight(t.x, t.z), H = [0, 6.6, 8.0, 9.4][t.tier];
    add(new THREE.CylinderGeometry(1.5, 1.75, 0.5, 20), t.team, t.x, y + 0.25, t.z);
    add(new THREE.CylinderGeometry(0.72, 1.05, H, 12), t.team, t.x, y + 0.5 + H / 2, t.z);
    add(new THREE.OctahedronGeometry(0.75), t.team, t.x, y + H + 1.5, t.z);
  }
  for (const c of coreSpots()) {
    if (have.has(coreName(c.team))) continue;
    const y = terrainHeight(c.x, c.z);
    add(new THREE.CylinderGeometry(4.0, 4.4, 0.7, 28), c.team, c.x, y + 0.35, c.z); add(new THREE.CylinderGeometry(2.6, 3.2, 1.2, 28), c.team, c.x, y + 1.3, c.z);
    const o = new THREE.OctahedronGeometry(2.6); o.scale(1, 1.9, 1); add(o, c.team, c.x, y + 7.2, c.z);
  }
  for (const f of fountainSpots()) if (!have.has(spawnName(f.team))) add(new THREE.CylinderGeometry(3.0, 3.0, 0.14, 36), f.team, f.x, terrainHeight(f.x, f.z) + 0.07, f.z);
  return group;
}

async function boot() {
  const canvas = document.getElementById("view") as HTMLCanvasElement, hud = document.getElementById("hud")!;
  // 什么参数都不带就是主菜单：只搭地图，镜头在上面慢慢转，菜单盖在上面。带了参数（选好了英雄、测试、截图）才进对局
  const lobbyMode = !["h", "arena", "hero", "cam", "top", "play", "solo", "auto", "director", "man", "hide", "nohud"].some(k => params.has(k)), directing = params.has("director");
  let loaded: (() => void) | null = !params.has("nohud") && params.has("h") && !params.has("cam") && !params.has("top") ? showLoading(kitOf(params.get("h")!).id, directing ? "观战" : params.has("arena") ? "测试场" : "") : null;      // 进对局：盖一张载入画面，地图和英雄都到齐了再撤
  if (!params.has("nohud") && !loaded && !lobbyMode) hud.textContent = "正在搭地图……";
  await new Promise(r => setTimeout(r, 0));
  // 载入进度：数已经到了多少个模型和贴图（一局大约要 60 个；总数是边载边涨的，所以拿一个估的数垫底，只进不退）
  if (loaded) { let best = 0; THREE.DefaultLoadingManager.onProgress = (_u, done, total) => { best = Math.max(best, done / Math.max(total, 58)); setLoad(best * 0.96); }; }
  initMobile(!lobbyMode);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LITE, powerPreference: "high-performance" });
  // 分辨率：电脑上最多 2 倍、总共不超过 260 万像素；手机上不超过 170 万像素。帧率撑不住的时候再往下降（见主循环里的 adapt）
  let resScale = 1;
  const fit = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, num("dpr", 2), Math.sqrt((LITE ? 1.7e6 : 2.6e6) / (innerWidth * innerHeight))) * resScale); renderer.setSize(innerWidth, innerHeight, false); };
  fit();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 调色（阶段 8，对着 Dota 2 的截图调的）：还是原来的色调映射，后面接一小段：饱和度提一点，暗部往青蓝偏、不压成死黑，亮部往暖偏。
  // 写在色调映射那一步里，每个材质自己算，不用多画一遍全屏，手机上也不多花钱。特效和血条（不走色调映射的）不受影响。
  // ?grade=0 关掉；?grade=饱和度,暗部偏冷,亮部偏暖,暗部抬亮,黄绿收红（调参数用）
  const gr = params.get("grade") === "0" ? null : (params.get("grade") ?? "").split(",").map(Number), G = (i: number, d: number) => (gr && Number.isFinite(gr[i]) && params.get("grade") ? gr[i] : d).toFixed(3);
  if (gr) {
    THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }", `vec3 CustomToneMapping( vec3 color ) {
      color = NeutralToneMapping( color );
      float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( l ), color, ${G(0, TOON_ON ? T.sat : 1.14)} );
      float sh = 1.0 - smoothstep( 0.0, ${TOON_ON ? T.shl.toFixed(3) : "0.32"}, l ), hi = smoothstep( 0.42, 0.95, l );      // B：偏冷的范围宽一点，草地上的影子也是冷的（B 的草影 (65,115,77)）
      color *= mix( vec3( 1.0 ), vec3( 0.84, 1.0, 1.13 ), sh * ${G(1, TOON_ON ? T.shc : 0.6)} ) * mix( vec3( 1.0 ), vec3( 1.06, 1.0, 0.92 ), hi * ${G(2, 0.2)} );
      float yg = clamp( ( color.g - color.b ) * 3.0, 0.0, 1.0 ) * clamp( 1.0 - abs( color.r - color.g ) * 5.0, 0.0, 1.0 );      // 发黄的草绿往正绿拉一点（红少一点）
      color.r *= 1.0 - ${G(4, TOON_ON ? T.yg : 0.1)} * yg;
      color += sh * ${G(3, 0.014)} * vec3( 0.45, 0.8, 1.0 );
      return clamp( color, 0.0, 1.0 );
    }`);
    renderer.toneMapping = THREE.CustomToneMapping;
  } else renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = num("exp", TOON_ON ? T.exp : 1.0);
  // 影子（阶段 8）：边缘更软、颜色更浅（?shadow=半径,浓度 调参数；半径 0 是以前那种硬边）。软边靠 PCF 加采样半径做，PCFSoft 那种不吃半径
  const shP = (params.get("shadow") ?? "").split(",").map(Number), shR = params.has("shadow") && Number.isFinite(shP[0]) ? shP[0] : LITE ? 1.6 : 3.2, shI = params.has("shadow") && Number.isFinite(shP[1]) ? shP[1] : TOON_ON ? 1.0 : 0.84;      // B：影子浓度给满，影子里剩多少光由 toon.ts 的冷色 tint 管
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = shR > 0 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  const SM = LITE ? 2048 : 4096;      // 阴影贴图的边长：手机上小一号
  const bg = new THREE.Color(TOON_ON ? 0x1d3324 : 0x0d1014), scene = new THREE.Scene(); scene.background = bg;      // B：背景是深绿的林子色，不是黑（亮地图配黑边很扎眼）
  const time = { value: 0 };

  // 光和样板间一样：太阳在左后方、不太高，影子往右前方拉长
  const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();
  const sun = new THREE.DirectionalLight(TOON_ON ? new THREE.Color(0xffffff).lerp(new THREE.Color(0xffe2b8), T.warm) : 0xfff0d6, TOON_ON ? T.sun : 3.0);      // B：太阳略暖，和冷色的影子拉开（太暖了红土和草会发艳，见 toon.ts 的 warm）
  sun.castShadow = true; sun.shadow.mapSize.set(SM, SM); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = shR || 2.2; sun.shadow.intensity = shI;
  const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.near = 1; sc.far = 420;
  const hemi = TOON_ON ? new THREE.HemisphereLight(0xa4d8f0, 0x8a9a62, T.hemi) : new THREE.HemisphereLight(0xcfe2ff, 0x7f8a5c, 1.4);      // B：天光偏冷青，影子和暗面是卡通里那种冷色
  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
  scene.add(sun, sun.target, hemi, rim);

  useGround(terrainHeight);                               // 墙和石头都落在全图的地形上
  const t0 = performance.now();
  const ground = await createWorldGround(renderer.capabilities.getMaxAnisotropy(), time, bg);
  scene.add(ground.group);
  const tl = new THREE.TextureLoader();
  const tex = async (n: string) => { try { const t = await tl.loadAsync(`/assets/slice/tex/${n}.webp`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; } catch { return null; } };
  const st: StoneTextures = { stone: [await tex("stone_me"), await tex("stone_foe")], trim: [await tex("bronze_me"), await tex("iron_foe")], rock: [await tex("rock_me"), await tex("rock_foe")], bark: await tex("bark") };
  const walls = createWalls(st, { inside: () => true, cell: 26 }); scene.add(walls);
  const have = await loadKitIndex();                      // 哪些关键建筑已经有正式的模型
  const ramparts = createRamparts(st, { cornerPier: [!have.has(spawnName(0)), !have.has(spawnName(1))] }); scene.add(ramparts.group);
  const water = createWater({ heightTex: ground.heightTex, origin: [-W_HALF, -W_HALF], size: W_HALF * 2 }, time, new THREE.Color(0xfff4e0), ramparts.foam, ground.waterShape); scene.add(water);
  // 墙脚的草长不长：有手绘地面就看画的是不是草，没有就按布局判断
  const isGrass = (x: number, z: number) => { if (ground.grassAt) return ground.grassAt(x, z) > 0.4; const f = fields(x, z); if (plateau(f.a, f.w, f.dBase) > 0.3 || f.dEdge < 2.2) return false; const s = surface(x, z, f); return s.stone < 0.4 && s.under < 0.1; };
  // 地表的短草和小石子（2.5）：要有手绘地面才知道哪里是草
  const details = ground.grassAt ? createDetails(time, ground.grassAt, st) : null; if (details) scene.add(details.group);
  const tufts = createTufts(time, [...((walls.userData as any).tufts ?? []), ...ramparts.tufts], isGrass); scene.add(tufts);
  // 植被（2.6）：能藏人的草丛、城墙外的树、墙脚的枯木、岸边的水草和睡莲
  const brush = createBrush(time); scene.add(brush.group);
  const trees = createTrees(st, time, ramparts.solids, ((walls.userData as any).contact?.lines ?? []) as [number, number][][]); scene.add(trees.group);
  const shore = createShore(time); scene.add(shore);
  const marks = createMarks(have); scene.add(marks);
  const buildings = await createBuildings(st, have); scene.add(buildings.group);
  const gateProps = createGateProps(st, time); scene.add(gateProps.group);        // 口子上的旗和火盆
  // ?man=u,v;u,v：在这些位置各立一个两米高的小人，看比例用
  for (const pr of (params.get("man") ?? "").split(";").filter(Boolean)) {
    const [mu, mv] = pr.split(",").map(Number), [mx, mz] = toWorld(mu, mv), man = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.16, 6, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 }));
    man.position.set(mx, terrainHeight(mx, mz) + 1.0, mz); man.castShadow = true; marks.add(man);
  }
  (window as any).__h = terrainHeight; (window as any).__veg = trees.contact;
  // 英雄（阶段 3）：岚 · 汐刃。第一个英雄由玩家操控，其余的（?hero= 里多写的）只是站着
  const heroes: Hero[] = []; let play: Play | null = null, sim: Sim | null = null, view: View | null = null, fx: Fx | null = null, fow: Fow | null = null, gameHud: Hud | null = null;
  let screenFx: ScreenFx | null = null;      // iti-fx3
  let fxl: FxLib | null = null, skills: ReturnType<typeof createSkills> | null = null; const actors = new Map<number, Actor>(), bots: Bot[] = [], brains: Brain[] = [];
  const kit = kitOf(params.get("h") ?? "lan");      // ?h=gorran 换英雄
  const lineup = readLineup(params, kit.id), myPos = lineup.me;      // 第九轮：两队各五个人（game/lineup.ts）；玩家在 0 队的 myPos 那个位置上，出生在出生点的第几格也按位置排
  const feed: import("../game/sim").SimEvent[] = []; let diffShown = "";      // 界面要播报的事（击杀、Boss、拆塔）；界面上显示的难度
  const isArena = params.has("arena"); let arena: Arena | null = null;      // ?arena=1 测试场
  const heroStart: [number, number, number][] = [];
  if (params.get("hero") !== "0" && !lobbyMode) {
    const look = Object.fromEntries((params.get("look") ?? "").split(",").filter(Boolean).map(kv => { const [k, v] = kv.split(":"); return [k, Number(v)]; }));
    for (const pr of (params.get("hero") ?? (isArena ? "-13,0,135" : `${toLane(...spawnAt(0, POS.indexOf(myPos))).join(",")},135`)).split(";").filter(Boolean)) {      // 默认站在我方出生点自己位置的那一格；测试场在中路河边
      const [hu, hv, hy, ht] = pr.split(",").map(Number), [hx, hz] = toWorld(hu || 0, hv || 0);
      try { const h = await loadHero(glb("hero", heroes.length ? "lan" : params.get("glb") ?? kit.id),      /* glb=名字：调试用，自己的英雄换一个模型文件（连同它的 .json） */ ht ? 1 : 0, heroes.length ? look : { height: kit.height, ...kit.look, ...look }); h.group.position.set(hx, terrainHeight(hx, hz), hz); h.marks.position.y = Math.max(0, WATER_Y - terrainHeight(hx, hz)); /* 站在水里时，脚下的圈浮在水面上 */ h.group.rotation.y = THREE.MathUtils.degToRad(hy || 0); scene.add(h.group); heroes.push(h); heroStart.push([hx, hz, THREE.MathUtils.degToRad(hy || 0)]); } catch (e) { console.warn("英雄没载入", e); }
    }
  }
  if (heroes.length && params.get("play") !== "0") {
    // 能走的范围：布局说了算，再加上画面上挡着、布局里没有的东西（台阶护墙、门墩、倒木、树桩、墙头的石头）
    const rocks = (((walls.userData as any).contact?.circles ?? []) as { x: number; z: number; r: number }[]).map(c => ({ x: c.x, z: c.z, r: c.r * 0.8 })).filter(c => fields(c.x, c.z).dLane > c.r);      /* 第九轮 balance：伸进兵线的墙头石头和墙墩不挡路（布局里兵线本来就压过墙、整条都能走，墙身早就不挡）。墙两头的大小石头是随机摆的、四份墙各不一样：上路 1 队那一侧、下路 0 队那一侧的墙头各有一块 1.5 米的大石头挡在兵线里，对面同一个位置只有小石头，只放小兵跑十分钟，挡着的那一侧兵对兵少打两成伤害（docs/round9/balance/sym/） */
    const nav = createNav([gateSolids(), { circles: [...rocks, ...trees.contact.circles.map(c => ({ x: c.x, z: c.z, r: c.r * 0.55 }))], lines: trees.contact.lines.map(l => ({ pts: l.pts, w: l.w * 0.5 })) }]);
    let rawMeta: any = null; try { const r = await fetch(`/assets/hero/${params.get("glb") ?? kit.id}.json`); if (r.ok) rawMeta = await r.json(); } catch { /* 没有就用默认的 */ }
    // 阶段 4：对局规则、画面、迷雾、界面
    fx = createFx(); scene.add(fx.group);
    fxl = createFxLib({ height: terrainHeight, waterY: WATER_Y, terrain: { tex: ground.terrainTex, half: W_HALF, n: ground.terrainN } }); scene.add(fxl.group);
    fxl.screen = screenFx = createScreenFx({ renderer, scene, lite: LITE, waterY: WATER_Y });      // iti-fx3：挂在特效库上，技能的特效从 c.fx.screen 拿
    sim = createSim(nav, [heroStart[0][0], heroStart[0][1]], { kit: kit.id, base: kit.base }, { waves: !isArena });
    skills = createSkills({ sim, nav, fx: fxl, fx0: fx, height: terrainHeight, actors });
    const actor = createActor({ ent: sim.hero, kit, hero: heroes[0], meta: normMeta(rawMeta), sim, api: skills.api, nav, fx0: fx, height: terrainHeight, waterY: WATER_Y, yaw: heroStart[0][2] }); actors.set(sim.hero.id, actor);
    view = await createView({ scene, sim, hero: heroes[0], fx, fxl, buildings, height: terrainHeight, waterY: WATER_Y, tint: kit.color, feed });
    play = createPlay({ actor, sim, nav, fx, fxl, height: terrainHeight, waterY: WATER_Y, pick: (r, team, not) => view!.pick(r, team, not) });
    // 再放一个英雄到场上（测试场的假人；以后的电脑对手也走这里）。模型还没做出来的英雄先借岚的模型
    const spawnHero = async (id: string, team: 0 | 1, x: number, z: number, yawR: number, pos = ""): Promise<Actor> => {
      const k = kitOf(id); let hm: Hero, raw: any = null;
      try { hm = await loadHero(glb("hero", k.id), team, { height: k.height, ...k.look }); try { const r = await fetch(`/assets/hero/${k.id}.json`); if (r.ok) raw = await r.json(); } catch { /* 用默认的 */ } }
      catch { hm = await loadHero(glb("hero", "lan"), team, { height: k.height }); try { const r = await fetch("/assets/hero/lan.json"); if (r.ok) raw = await r.json(); } catch { /* 用默认的 */ } }
      scene.add(hm.group); heroes.push(hm); const ent = sim!.addHero(team, x, z, k.id, k.base, pos);
      const a = createActor({ ent, kit: k, hero: hm, meta: normMeta(raw), sim: sim!, api: skills!.api, nav, fx0: fx!, height: terrainHeight, waterY: WATER_Y, yaw: yawR }); actors.set(ent.id, a); return a;
    };
    if (isArena) { sim.gainXp(sim.hero, 1e5); arena = await createArena({ sim, player: actor, spawnHero }); (window as any).__arena = arena; }      // 测试场直接满级
    // 第九轮：5v5。两队各五个人、五个位置各一个（排法见 game/lineup.ts）；英雄的阵营只管造型和特效颜色，和在哪一队无关。
    // 玩家在 0 队自己的位置上，其余九个都由电脑控制（game/bot.ts），按位置打。每个人出生在出生点里自己位置的那一格，复活也回那一格
    const asDiff = (v: string | null, d: Diff): Diff => (v === "easy" || v === "normal" || v === "hard" || v === "show" ? v : d), diff = asDiff(params.get("diff"), directing ? "show" : "normal"), allyDiff = asDiff(params.get("ally"), diff);
    const autoMe = params.has("auto") || directing, versus = !isArena && !params.has("solo");
    if (versus) { diffShown = diff; sim.hero.h!.pos = myPos; }
    brains.push(createBrain(sim, 0, allyDiff, autoMe ? null : sim.hero), createBrain(sim, 1, diff));
    if (versus) {
      const list = lineup.teams.flatMap((t, tm) => t.map((s, i) => ({ ...s, tm: tm as 0 | 1, i }))).filter(s => !(s.tm === 0 && s.pos === myPos));
      const at = (tm: 0 | 1, i: number): [number, number] => { const [x, z] = spawnAt(tm, i); return nav.walkable(x, z) ? [x, z] : nav.nearest(x, z); };
      const made = await Promise.all(list.map(s => spawnHero(s.id, s.tm, ...at(s.tm, s.i), s.tm === 0 ? Math.PI * 0.75 : -Math.PI * 0.25, s.pos)));
      made.forEach((a, k) => bots.push(createBot({ actor: a, sim: sim!, api: skills!.api, nav, brain: brains[a.ent.team as 0 | 1], diff: a.ent.team === 0 ? allyDiff : diff, pos: list[k].pos })));
    }
    if (autoMe && !isArena) bots.push(createBot({ actor, sim, api: skills.api, nav, brain: brains[0], diff: allyDiff, pos: myPos }));
    (window as any).__bots = bots; (window as any).__lineup = lineup; (window as any).__itemCost = (id: string) => itemOf(id)?.cost ?? 0;
    // 测试脚本用：一行一个英雄的战况（带 * 的是对面的）。第九轮加了位置、身家（金币加装备）和清了几个野怪营地
    (window as any).__report = () => ({ t: Math.round(sim!.time), over: sim!.over, kills: sim!.kills, towers: [sim!.towersLeft(0), sim!.towersLeft(1)], lanes: [0, 1].map(tm => [0, 1, 2].map(l => sim!.ents.filter(e => e.kind === "tower" && e.team === tm && e.lane === l && e.alive).length).join("")).join(" 对 "),      /* 每条线各剩几座塔：中、上、下 */ order: brains.map(b => b.order()?.kind ?? "-"), camps: sim!.camps.filter(c => c.up && c.kind !== "boss").length, boss: sim!.camps.filter(c => c.kind === "boss").map(c => c.mob + (c.up ? Math.round((c.mobs[0].hp / c.mobs[0].max) * 100) + "%" : " 还有" + Math.max(0, Math.round(c.nextAt - sim!.time)) + "秒")), buff: [sim!.teamBuff.beast.map(t => Math.max(0, Math.round(t - sim!.time))), sim!.teamBuff.troll.map(t => Math.max(0, Math.round(t - sim!.time)))],
      heroes: [...actors.values()].sort((p, q) => p.ent.team - q.ent.team || POS.indexOf(p.ent.h!.pos as never) - POS.indexOf(q.ent.h!.pos as never)).map(a => { const e = a.ent, h = e.h!, b = bots.find(x => x.ent === e), worth = Math.round(h.gold + h.items.reduce((s, id) => s + (itemOf(id)?.cost ?? 0), 0)); return `${h.kit}${e.team ? "*" : ""} ${h.pos || "-"} L${h.level} ${Math.round((e.hp / e.max) * 100)}% ${h.kills}/${h.deaths}/${h.assists} 金${Math.round(h.gold)} 身家${worth} 装${h.items.length} 刀${h.cs} 营${h.camps}${b && h.pos === "jungle" ? ` 抓${b.ganks()}` : ""} ${b ? `线${b.lane()} [${b.doing()}] ${Object.entries(b.hist).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => k + Math.round(v)).join(" ")}` : "[玩家]"}`; }) });
    if (!params.has("nofog") || directing) { fow = createFow(sim, W_HALF, !directing && !params.has("nofog")); scene.add(fow.mesh); }      /* 观战不压暗，但小地图还要用它那张图。第九轮：迷雾做进了场景的材质里（见 game/fow.ts），渲染前每帧把新出现的材质包上 */
    if (directing) sim.reveal = true;
    (window as any).__play = play; (window as any).__nav = nav; (window as any).__sim = sim; (window as any).__fx = fxl; (window as any).__api = skills.api; (window as any).__actors = actors;
  }
  { // 接地的暗影
    const wc = (walls.userData as any).contact as { lines: [number, number][][]; circles: { x: number; z: number; r: number }[] };
    ground.setContact({
      lines: [...wc.lines.map(pts => ({ pts, w: 2.5, a: 0.5 })), ...ramparts.contact.lines, ...brush.patches.map(b => ({ pts: [b.p, b.q], w: b.hw * 2 - 0.5, a: 0.5 })), ...trees.contact.lines],
      circles: [...wc.circles.map(c => ({ ...c, r: c.r * 1.25, a: 0.5 })), ...ramparts.contact.circles, ...trees.contact.circles, ...buildings.circles, ...towerSpots().map(t => ({ x: t.x, z: t.z, r: 2.4, a: 0.4 })), ...coreSpots().map(c => ({ x: c.x, z: c.z, r: 5.2, a: 0.4 }))],
    });
  }
  const buildMs = performance.now() - t0;
  for (const n of (params.get("hide") ?? "").split(",").filter(Boolean)) { const o = scene.getObjectByName(n); if (o) o.visible = false; }

  // 镜头
  const top = params.has("top");
  const persp = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 900);
  const span0 = num("span", 96), ortho = new THREE.OrthographicCamera(-span0, span0, span0, -span0, 1, 600);
  const [t0x, t0z] = toWorld(-(A_CORNER - 52), 0);        // 一进来看我方中路的口子
  const target = new THREE.Vector3(t0x, 0, t0z); let dist = num("dist", TOUCH && Math.min(innerWidth, innerHeight) < 560 ? 23.5 : 27),      /* 手机屏幕小，镜头近一点（平板不用） */      /* 英雄放大到 3.1 米以后镜头跟着拉远一点：英雄在画面里和原来一样大，小兵显得更小，能多看到一圈 */
     pitch = THREE.MathUtils.degToRad(56), yaw = 0;
  if (params.has("cam")) { const [u, v, d, p, h, y] = params.get("cam")!.split(",").map(Number); const [x, z] = toWorld(u || 0, v || 0); target.set(x, h || 0, z); if (d) dist = d; if (p) pitch = THREE.MathUtils.degToRad(p); if (y) yaw = THREE.MathUtils.degToRad(y); }
  if (top) { const [x, z] = (params.get("c") ?? "0,0").split(",").map(Number); target.set(x || 0, 0, z || 0); }
  if (play && !params.has("cam") && !top) target.set(play.pos.x, 0, play.pos.z);
  if (play && sim && fow && !params.has("nohud")) gameHud = createHud({ sim, play, fow: fow.canvas, half: W_HALF, onJump: (x, z) => { play!.follow = false; target.x = lim(x); target.z = lim(z); }, feed, diff: diffShown || undefined, spectate: directing, yaw: () => yaw, onMenu: w => { if (w === "home") goHome(); else location.reload(); } });
  // 3D 动态头像：英雄的头再单独画一遍，画在界面留出来的方框里。英雄的模型和几盏灯多挂一层，头像的镜头只看这一层；背景是挂在镜头前面的一块渐变
  const faceCam = new THREE.PerspectiveCamera(24, 128 / 150, 0.1, 80), faceAt = new THREE.Vector3(), faceDir = new THREE.Vector3(); faceCam.layers.set(1);
  if (gameHud && heroes[0] && !directing) { scene.add(faceCam); for (const l of [sun, hemi, rim]) l.layers.enable(1); heroes[0].model.traverse(o => o.layers.enable(1));
    const cv = document.createElement("canvas"); cv.width = cv.height = 128; const c2 = cv.getContext("2d")!, g = c2.createRadialGradient(64, 46, 4, 64, 64, 96), col = new THREE.Color(kit.color); g.addColorStop(0, "#" + col.clone().multiplyScalar(0.55).getHexString()); g.addColorStop(0.55, "#" + col.clone().multiplyScalar(0.16).getHexString()); g.addColorStop(1, "#06090b"); c2.fillStyle = g; c2.fillRect(0, 0, 128, 128);
    const bgT = new THREE.CanvasTexture(cv); bgT.colorSpace = THREE.SRGBColorSpace; const back = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: bgT, depthWrite: false, depthTest: false, toneMapped: false })); back.position.z = -50; back.renderOrder = -50; back.layers.set(1); faceCam.add(back); }
  function drawFace() {
    const r = gameHud?.faceRect(), a = sim ? actors.get(sim.hero.id) : undefined; if (!r || r.width < 8 || !a || !faceCam.parent) return;
    const hb = heroes[0].bone(a.meta.points?.head ?? a.meta.points?.hand ?? "Head"), wide = !!a.meta.points; if (hb) hb.getWorldPosition(faceAt); else faceAt.copy(a.pos).setY(a.pos.y + kit.height * 0.86);
    const yw = a.yaw() + 0.5, d = kit.height * (wide ? 1.05 : 0.6); faceDir.set(Math.sin(yw), 0.1, Math.cos(yw)); faceCam.position.copy(faceAt).addScaledVector(faceDir, d); faceCam.lookAt(faceAt.x, faceAt.y - kit.height * (wide ? 0.03 : 0.015), faceAt.z);
    faceCam.aspect = r.width / r.height; faceCam.updateProjectionMatrix();
    renderer.setScissorTest(true); renderer.setViewport(r.left, innerHeight - r.bottom, r.width, r.height); renderer.setScissor(r.left, innerHeight - r.bottom, r.width, r.height);
    const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, faceCam);
    renderer.autoClear = true; renderer.shadowMap.autoUpdate = au; renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  const director = directing && sim ? createDirector(sim) : null; let ended = false, ending: Ending | null = null; (window as any).__director = director;
  if (lobbyMode) { createLobby(); pitch = THREE.MathUtils.degToRad(42); }
  const seeP = new THREE.Vector3();
  (window as any).__screen = (x: number, z: number, up = 1) => { const v = new THREE.Vector3(x, terrainHeight(x, z) + up, z).project(persp); return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)]; };      /* 测试用：地上一点在画面上的像素位置，脚本用它来真的点鼠标 */
  let speed = num("speed", 1), endDist: number | undefined; (window as any).__setSpeed = (v: number) => { speed = v; };      /* 测试和录像时中途改快进倍数 */
  const corner = new THREE.Vector3(), quad: [number, number][] = [];
  const keys = new Set<string>();
  addEventListener("keydown", e => { if (play && e.repeat && /^Key[WASDQER]$/.test(e.code)) { e.preventDefault(); return; } if (play && !e.repeat && !e.metaKey && !e.ctrlKey && play.key(e.code)) { e.preventDefault(); return; } if (play && /^Key[WASDQER]$/.test(e.code)) return; keys.add(e.code); }); addEventListener("keyup", e => { keys.delete(e.code); play?.keyUp(e.code); }); addEventListener("blur", () => keys.clear());
  canvas.addEventListener("wheel", e => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), 8, 150); }, { passive: false });
  let down = false, lx = 0, ly = 0;
  const lim = (v: number) => clamp(v, -86, 86);
  const pan = (dx: number, dz: number) => { const c = Math.cos(yaw), s = Math.sin(yaw); target.x = lim(target.x + dx * c + dz * s); target.z = lim(target.z - dx * s + dz * c); };
  // 触屏：一根手指拖动平移，两根手指捏合缩放
  const touches = new Map<number, [number, number]>(); let pinch = 0;
  const spread = () => { const p = [...touches.values()]; return Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let px0 = 0, py0 = 0, dragged = false;
  const rayAt = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); persp.updateMatrixWorld(); ray.setFromCamera(ndc, persp); return ray.ray; };
  // 鼠标（第九轮）：右键按下的那一刻就下命令（走过去 / 打它），按住右键拖着鼠标一直走；左键按下时正在瞄准就放技能，否则是拖动镜头。
  // 原来是“左键松开才走”：点一下本身就多了按下到松开的那一百多毫秒，也不是 MOBA 的习惯。触屏还是松手时算一次点击
  let rmb = false, mx = 0, my = 0, aimed = false;
  const rayXY = (x: number, y: number) => { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); persp.updateMatrixWorld(); ray.setFromCamera(ndc, persp); return ray.ray; };
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("pointerdown", e => {
    mx = e.clientX; my = e.clientY;
    if (e.pointerType === "mouse" && play && !top) {
      if (e.button === 2) { rmb = true; canvas.setPointerCapture(e.pointerId); play.command(rayAt(e)); return; }
      if (e.button === 0 && play.confirm(rayAt(e))) { aimed = true; return; }      // 瞄准时左键：放出去，这一下不拖镜头
      if (e.button !== 0) return;
    }
    down = true; lx = e.clientX; ly = e.clientY; px0 = e.clientX; py0 = e.clientY; dragged = false; canvas.setPointerCapture(e.pointerId); touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) pinch = spread(); });
  const lift = (e: PointerEvent) => { if (e.pointerType === "mouse" && (e.button === 2 || e.type === "pointercancel")) rmb = false; if (e.pointerType === "mouse" && aimed) { aimed = false; return; }
    if (play && !top && !dragged && touches.size === 1 && e.type === "pointerup" && e.pointerType !== "mouse") play.click(rayAt(e)); touches.delete(e.pointerId); down = touches.size > 0; const p = [...touches.values()][0]; if (p) { lx = p[0]; ly = p[1]; } };
  canvas.addEventListener("pointerup", lift); canvas.addEventListener("pointercancel", lift);
  canvas.addEventListener("pointermove", e => {
    mx = e.clientX; my = e.clientY; if (rmb && !(e.buttons & 2)) rmb = false;      // 在画布外松开的右键
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const s = spread(); if (pinch > 0 && s > 0) dist = clamp(dist * (pinch / s), play && TOUCH ? 15 : 8, play && TOUCH ? 36 : 150); pinch = s; return; }
    if (!down) { if (play && !top && e.pointerType === "mouse") play.hover(rayAt(e)); return; }
    if (play && !dragged) { if (Math.hypot(e.clientX - px0, e.clientY - py0) < 7) return; dragged = true; play.follow = false; }
    const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(17))) / innerHeight;
    pan(-(e.clientX - lx) * k, (-(e.clientY - ly) * k) / Math.sin(pitch)); lx = e.clientX; ly = e.clientY;
  });
  const aspect = () => { persp.aspect = innerWidth / innerHeight; persp.updateProjectionMatrix(); const a = innerWidth / innerHeight; ortho.left = -span0 * Math.max(a, 1); ortho.right = span0 * Math.max(a, 1); ortho.top = span0 / Math.min(a, 1); ortho.bottom = -span0 / Math.min(a, 1); ortho.updateProjectionMatrix(); };
  aspect(); addEventListener("resize", () => { fit(); aspect(); });

  const clock = new THREE.Clock(); let frames = 0, fpsT = 0, fps = 0, n = 0;
  const adapt = params.has("adapt") ? params.get("adapt") !== "0" : !navigator.webdriver && !params.has("cam") && !top; let adT0 = 0, adN = 0, adUp = 0, adLow = 0;      /* 自动化的截图和测试不动分辨率（要测就带 ?adapt=1） */
  const fixedT = params.has("t") ? num("t", 0) : null;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time.value = fixedT ?? time.value + dt;
    screenFx?.update(dt);      // iti-fx3：屏幕演出按真实时间走（顿帧时也在动）
    let dx = 0, dz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) dz -= 1; if (keys.has("KeyS") || keys.has("ArrowDown")) dz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1; if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
    if (keys.has("KeyQ")) yaw += dt * 0.9; if (keys.has("KeyE")) yaw -= dt * 0.9;
    if (play && (dx || dz)) play.follow = false;
    pan(dx * dt * dist * 0.8, dz * dt * dist * 0.8);
    if (lobbyMode) { const tt = time.value; target.set(Math.sin(tt * 0.045) * 30, 0, Math.cos(tt * 0.038) * 30); yaw = Math.sin(tt * 0.03) * 0.7; dist = 50; }      // 主菜单的背景：镜头在地图上空慢慢转
    let slow = 1; if (director && sim && !sim.over) { const sh = director.update(dt); target.x = lim(sh.x); target.z = lim(sh.z); dist = sh.dist; yaw = sh.yaw; slow = sh.slow; if (play) play.follow = false; }      // 导播：镜头和快慢都听它的
    if (play && sim && view && fx) { const sdt = blocked() ? 0 : dt * speed * slow * fxl!.timeScale(dt) * (ending ? ending.timeScale() : 1),      /* timeScale：大招打中时的顿帧（第九轮，见 fxlib 的 hitstop） */ steps = Math.max(1, Math.ceil(sdt / 0.05)), h = sdt / steps;      /* 快进时切成小步走，规则那边每一步不超过二十分之一秒 */
      if (rmb && !top) play.drag(rayXY(mx, my), dt);      // 按住右键：朝鼠标指着的地方一直走（镜头在跟着走，所以每帧按鼠标的屏幕位置重算一次射线）
      for (let i = 0; i < steps; i++) { for (const b of brains) b.update(h); for (const b of bots) b.update(h); for (const a of actors.values()) a.update(h, dist); sim.update(h); skills!.update(h); arena?.update(h); } play.update(sdt); view.update(sdt, target.x, target.z, dist); fx.update(sdt); fxl!.update(sdt);
      const fallen = sim.over ? sim.ents.find(e => e.kind === "core" && !e.alive) : undefined;
      if (fallen && !top && !params.has("cam")) { const k = 1 - Math.exp(-dt * 2.4); target.x += (lim(fallen.x - Math.sin(yaw) * 1.2) - target.x) * k; target.z += (lim(fallen.z - Math.cos(yaw) * 1.2) - target.z) * k;      /* 分出胜负：镜头移到被打爆的那座水晶上 */
        if (ending) { endDist ??= dist; dist += (endDist * ending.zoom() - dist) * (1 - Math.exp(-dt * 3)); } }      /* 第九轮：结束演出里镜头再推近一点 */
      else if (play.follow && !top && !params.has("cam")) { const k = 1 - Math.exp(-dt * 16);      /* 镜头跟人：第九轮从 7 提到 16（时间常数 0.14 → 0.06 秒，跑动时镜头落后人从 0.9 米缩到 0.4 米），不再拖泥带水 */ target.x += (lim(play.pos.x - Math.sin(yaw) * 1.2) - target.x) * k; target.z += (lim(play.pos.z - Math.cos(yaw) * 1.2) - target.z) * k; } }
    let camera: THREE.Camera, span: number;
    if (top) {
      ortho.position.set(target.x, 300, target.z); ortho.up.set(0, 0, -1); ortho.lookAt(target.x, 0, target.z); camera = ortho; span = span0 * 1.25;
    } else {
      const zk = screenFx ? screenFx.zoomK() : 1, h = dist * zk * Math.cos(pitch);      // iti-fx3：镜头推拉（zoomK 平时是 1）
      persp.position.set(target.x + Math.sin(yaw) * h, target.y + dist * zk * Math.sin(pitch), target.z + Math.cos(yaw) * h); persp.lookAt(target); if (fxl) persp.position.add(fxl.shakeOffset(seeP)); camera = persp;      /* 镜头抖动：看的方向不变，只挪位置 */ span = Math.max(22, dist * 1.05);
    }
    const far = top || dist > 80;
    buildings.update(time.value, target.x, target.z); gateProps.update(time.value);
    for (const h of heroes) { if (play && (h === heroes[0] || [...actors.values()].some(a => a.hero === h))) continue; if (fixedT != null) h.mixer.setTime(num("ht", 0)); h.update(fixedT != null ? 0 : dt, dist); }      // 截图时用 ?ht= 指定动作播到第几秒
    ground.update(target.x, target.z, far); details?.update(target.x, target.z, far); brush.setFar(far); shore.visible = !far;
    // 阴影只罩住镜头看得见的那一块，并按阴影贴图的像素对齐，镜头移动时影子的边不闪
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix();
    const texel = (span * 2) / SM, off = top ? 0 : dist * 0.12, cx = Math.round((target.x - Math.sin(yaw) * off) / texel) * texel, cz = Math.round((target.z - Math.cos(yaw) * off) / texel) * texel;
    sun.target.position.set(cx, 0, cz); sun.position.set(cx, 0, cz).addScaledVector(sunDir, 200);
    if (play && !top && (director ? !!sim && !sim.over : sim?.hero.alive)) {      // 挡住英雄的建筑镂空：告诉建筑的材质英雄在画面上的哪里、离镜头多远。观战时没有“自己的英雄”，镂空跟着导播正在看的那一点（阶段 8：以前只认网址里那个英雄，导播去看别人时墙会把人整个挡住）
      camera.updateMatrixWorld(); if (director) seeP.set(target.x, terrainHeight(target.x, target.z) + 1.4, target.z); else seeP.set(play.pos.x, play.pos.y + 1.4, play.pos.z); seeP.applyMatrix4(camera.matrixWorldInverse); const depth = -seeP.z; seeP.applyMatrix4(camera.projectionMatrix);
      const bw = renderer.domElement.width, bh = renderer.domElement.height; kitSee.value.set((seeP.x * 0.5 + 0.5) * bw, (seeP.y * 0.5 + 0.5) * bh, depth, bh * (director ? 0.27 : 0.2));
    } else kitSee.value.w = 0;
    if (fow) { fow.patch(scene); fow.update(dt, camera, renderer, !top); }
    sfx.listen(target.x, target.z);
    renderer.render(scene, camera);
    if (!top) screenFx?.post(camera);      // iti-fx3：泛光和整屏的那几样（没有在放的时候里面直接返回，不多画）
    if (!top) { fow?.enable(false); screenFx?.offscreen(true); drawFace(); screenFx?.offscreen(false); }      /* 头像那一遍的镜头不是主镜头，不压暗 */
    // 分出胜负（第九轮）：先演一段结束的演出（慢动作、镜头推向水晶、阵营色的光、胜利或失败的大字，见 game/ending.ts），演完再出结算
    if (sim && sim.over && !ended && fxl) { ended = true; const fallenC = sim.ents.find(e => e.kind === "core" && !e.alive), winT = sim.over === 1 ? 0 : 1, win = directing ? null : sim.over === 1;      /* 第九轮：两队不再按阵营分，光的颜色按赢的那一边的基地（左下是潮青那一套、右上是余烬那一套），观战的字幕和结算一样叫蓝方、红方（第九轮 ui2 起场上 0 队的血条、圈都是蓝的） */
      ending = createEnding({ fxl, win, x: fallenC?.x ?? target.x, z: fallenC?.z ?? target.z, color: winT === 0 ? 0x9af7ee : 0xffb35c, sub: directing ? (winT === 0 ? "蓝方获胜" : "红方获胜") : win ? "敌方水晶已被摧毁" : "我方水晶已被摧毁", dom: !params.has("nohud"), canvas,
        onDone: () => { if (!params.has("nohud")) { sfx.end(directing ? true : sim!.over === 1); showResult(sim!, { spectate: directing, dmg: new Map(sim!.heroes().map(e => [e.id, e.h!.dmg])) }); } } }); }
    ending?.update(dt);
    if (gameHud) {       // 小地图上的镜头框：屏幕四个角落到地面上的位置
      quad.length = 0; for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { corner.set(nx, ny, 0.5).unproject(persp).sub(persp.position); if (corner.y < -1e-3) { const tt = -persp.position.y / corner.y; quad.push([persp.position.x + corner.x * tt, persp.position.z + corner.z * tt]); } }
      gameHud.update(dt, top ? [] : quad); }
    frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    // 帧率撑不住就降分辨率（按真实时间算，每两秒看一次）：不到 45 帧降一档，不到 30 帧降得更狠，最低降到一半；
    // 已经降到底还不到 30 帧，就把阴影也关了。连着六秒稳在 57 帧以上再把分辨率升回去
    if (adapt && (window as any).__ready && !document.hidden) { const now = performance.now(); adN++; if (!adT0) { adT0 = now; adN = 0; } else if (now - adT0 >= 2000) { const f = (adN * 1000) / (now - adT0); adT0 = now; adN = 0;
        if (f < 45 && resScale > 0.5) { resScale = Math.max(0.5, resScale * (f < 30 ? 0.74 : 0.86)); adUp = 0; fit(); }
        else if (f < 30 && sun.castShadow && ++adLow >= 2) { sun.castShadow = false; renderer.shadowMap.needsUpdate = true; }
        else if (f > 57 && resScale < 1) { if (++adUp >= 3) { adUp = 0; resScale = Math.min(1, resScale * 1.1); fit(); } } else { adUp = 0; if (f >= 30) adLow = 0; } } }
    hud.textContent = params.has("nohud") || params.has("clean") || lobbyMode ? "" : play ? (params.has("fps") ? `${fps.toFixed(0)} fps` : "") : `${fps.toFixed(0)} fps · ${renderer.domElement.width}×${renderer.domElement.height} · 整张地图\n拖动或 WASD 平移，滚轮缩放，Q / E 转镜头`;
    if (n === 3) fxl?.warm(target.x, target.z);                // 特效的着色器趁载入的时候编好
    if (n === 3 && fxl && skills) for (const a of actors.values()) if (a.kit.id === "iti") warmIti({ me: a.ent, a, api: skills.api, fx: fxl });      // iti-fx3：场上有伊缇就把她的零件库、残影池、贴图也备好（没有伊缇的对局不走这里）
    if (++n > 12 && !ground.busy() && !details?.busy()) { (window as any).__ready = true; if (loaded) { loaded(); loaded = null; } }      // 附近的细图和草都到齐了才算好（截图用）
    (window as any).__stats = { fps, res: +resScale.toFixed(2), px: renderer.domElement.width * renderer.domElement.height, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, buildMs: Math.round(buildMs), tufts: (tufts.userData as any).count, painted: ground.painted, ...(details?.count() ?? {}), brush: brush.count, kit: [...have].length, kitTris: buildings.tris, ...(view ? view.count() : {}), heroTris: heroes.reduce((a, h) => a + h.tris, 0), ...trees.count, ...((shore.userData as any).count ?? {}) };
  });
  (window as any).__scene = scene;
}
