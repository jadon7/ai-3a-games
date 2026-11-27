// 样板间入口（阶段 2.3）：中路外塔到河边这一小块，做到最终画质。
//   默认          俯视镜头，拖动或 WASD 平移，滚轮缩放
//   ?cam=du,dv,距离,俯角,高度   固定机位（相对样板间中心的路向坐标偏移；高度是镜头看向的点离地多高），截图用
//   ?guide=i,j   画第 (i,j) 块地面的布局图（给重绘用）；?guide=all 画整张
//   ?hide=a,b    隐藏某一类东西（water、walls、rocks、flora、tower）

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clamp } from "../../core/noise";
import { toWorld } from "../layout";
import { renderGuide } from "./guide";
import { CAM_HALF, PAINT_HALF, SLICE_X, SLICE_Z, TILE_M, tileCenter } from "./def";
import { createGround } from "./ground";
import { createWater } from "./water";
import { createTower } from "./tower";
import { createLog, createRiverRocks, createWalls, type StoneTextures } from "./stone";
import { createFlora } from "./flora";

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

if (params.has("guide")) {
  (document.getElementById("view") as HTMLCanvasElement).style.display = "none";
  const cv = document.getElementById("guide") as HTMLCanvasElement; cv.hidden = false;
  const g = params.get("guide")!, px = num("px", 2048);
  if (g === "all") renderGuide(cv, SLICE_X, SLICE_Z, PAINT_HALF * 2, px);
  else { const [i, j] = g.split(",").map(Number), [cx, cz] = tileCenter(i, j); renderGuide(cv, cx, cz, TILE_M, px); }
  (window as any).__stats = { fps: 0, tris: 0, calls: 0 }; (window as any).__ready = true;
} else boot().catch(e => { console.error(e); document.getElementById("hud")!.textContent = "出错了：" + e; });

async function boot() {
  const canvas = document.getElementById("view") as HTMLCanvasElement, hud = document.getElementById("hud")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // 渲染分辨率按像素预算定（约 260 万像素），Retina 屏不按两倍全画
  const fit = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, num("dpr", 2), Math.sqrt(2.6e6 / (innerWidth * innerHeight)))); renderer.setSize(innerWidth, innerHeight, false); };
  fit();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = num("exp", 1.0);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d1014);
  const time = { value: 0 };

  // 光：照设计稿，太阳在左后方、不太高，影子往右前方拉得长长的；朝着镜头的面在背光里，带一点天空的青色
  const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d6, 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.2;
  const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.near = 1; sc.far = 200;
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x7f8a5c, 1.4);
  // 从镜头这边来的一点补光：不投影，只是让背光的面不至于闷成一片
  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
  scene.add(sun, sun.target, hemi, rim);

  const ground = await createGround(renderer.capabilities.getMaxAnisotropy(), time);
  scene.add(ground.mesh);
  // 墙、石头、枯木的手绘材质。还没画好的时候先用纯色顶着
  const tl = new THREE.TextureLoader();
  const tex = async (n: string) => { try { const t = await tl.loadAsync(`/assets/slice/tex/${n}.webp`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; } catch { return null; } };
  const st: StoneTextures = { stone: [await tex("stone_me"), await tex("stone_foe")], trim: [await tex("bronze_me"), await tex("iron_foe")], rock: [await tex("rock_me"), await tex("rock_foe")], bark: await tex("bark") };
  // ?tower=astra / ?tower=xhigh：换成 Codex（GPT 6.2 Astra）照同一张设计图建的塔，对比用。astra 是推理强度 high 那次，xhigh 是 xhigh 那次
  let tower: THREE.Object3D;
  const lab = ({ astra: "astra_tower", xhigh: "astra_tower_xhigh" } as Record<string, string>)[params.get("tower") ?? ""];
  if (lab) {
    const gltf = await new GLTFLoader().loadAsync(`/assets/lab/${lab}.glb`), [ax, az] = toWorld(-22, 0);
    tower = gltf.scene; tower.position.set(ax, 0, az); tower.name = "tower";
    // ?metal=0.2：把它的金属度乘一个数。我们的场景没有环境反射，金属度高的面会发黑；这个参数用来看“只改材质参数”能救回多少
    const mk = num("metal", 1);
    tower.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true; const mat = m.material as THREE.MeshStandardMaterial; if (mk !== 1 && mat.metalness !== undefined) mat.metalness *= mk; });
    const cr = tower.getObjectByName("crystal"); (tower.userData as any).update = (t: number) => { if (cr) cr.rotation.y = t * 0.5; };
  } else tower = createTower(st, -22, 0, 0);
  scene.add(tower);
  const walls = createWalls(st); scene.add(walls);
  const rocks = createRiverRocks(st); scene.add(rocks);
  scene.add(createWater({ heightTex: ground.heightTex, origin: [SLICE_X - PAINT_HALF, SLICE_Z - PAINT_HALF], size: PAINT_HALF * 2 }, time, new THREE.Color(0xfff4e0), (rocks.userData as any).circles));
  { const [lx, lz] = toWorld(-24.5, 15.2); scene.add(createLog(st, lx, lz, 0.9)); }
  const flora = createFlora(time, ground, (walls.userData as any).tufts); scene.add(flora);
  (window as any).__counts = (flora.userData as any).counts;
  { // 接地的暗影
    const wc = (walls.userData as any).contact as { lines: [number, number][][]; circles: { x: number; z: number; r: number }[] }, [tx, tz] = toWorld(-22, 0);
    ground.setContact({
      lines: [...wc.lines.map(pts => ({ pts, w: 2.5, a: 0.5 })), ...((flora.userData as any).brush as { p: [number, number]; q: [number, number]; hw: number }[]).map(b => ({ pts: [b.p, b.q], w: b.hw * 2 - 0.5, a: 0.5 }))],
      circles: [...wc.circles.map(c => ({ ...c, r: c.r * 1.25, a: 0.5 })), ...((rocks.userData as any).circles as { x: number; z: number; r: number }[]).map(c => ({ ...c, r: c.r * 1.3, a: 0.4 })), { x: tx, z: tz, r: 2.5, a: 0.4 }],
    });
  }

  for (const n of (params.get("hide") ?? "").split(",").filter(Boolean)) { const o = scene.getObjectByName(n); if (o) o.visible = false; }

  // 镜头：和灰盒一样，离地面 24 米、俯角 56 度
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 400);
  const [t0x, t0z] = toWorld(-15.5, 0.5);                 // 一进来：塔在左下、河在右上，都在画面里
  const target = new THREE.Vector3(t0x, 0, t0z); let dist = num("dist", 24), pitch = THREE.MathUtils.degToRad(56);
  if (params.has("cam")) { const [du, dv, d, p, h] = params.get("cam")!.split(",").map(Number); const [x, z] = toWorld(-13 + (du || 0), dv || 0); target.set(x, h || 0, z); if (d) dist = d; if (p) pitch = THREE.MathUtils.degToRad(p); }
  const keys = new Set<string>();
  addEventListener("keydown", e => keys.add(e.code)); addEventListener("keyup", e => keys.delete(e.code)); addEventListener("blur", () => keys.clear());
  canvas.addEventListener("wheel", e => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), 9, 34); }, { passive: false });
  let down = false, lx = 0, ly = 0;
  // 镜头能去的范围偏向河道一侧：左下角那一带不在样板间里
  const limX = (v: number) => clamp(v, SLICE_X - 7, SLICE_X + CAM_HALF - 0.5), limZ = (v: number) => clamp(v, SLICE_Z - CAM_HALF + 0.5, SLICE_Z + 7);
  canvas.addEventListener("pointerdown", e => { down = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointerup", () => { down = false; });
  canvas.addEventListener("pointermove", e => {
    if (!down) return;
    const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(17))) / innerHeight;
    target.x = limX(target.x - (e.clientX - lx) * k); target.z = limZ(target.z - ((e.clientY - ly) * k) / Math.sin(pitch)); lx = e.clientX; ly = e.clientY;
  });
  addEventListener("resize", () => { fit(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  const clock = new THREE.Clock(); let frames = 0, fpsT = 0, fps = 0, n = 0;
  const fixedT = params.has("t") ? num("t", 0) : null;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    time.value = fixedT ?? time.value + dt;
    (tower.userData as any).update(time.value);
    let dx = 0, dz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) dz -= 1; if (keys.has("KeyS") || keys.has("ArrowDown")) dz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1; if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
    target.x = limX(target.x + dx * dt * dist * 0.8); target.z = limZ(target.z + dz * dt * dist * 0.8);
    camera.position.set(target.x, target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch)); camera.lookAt(target);
    // 阴影只罩住镜头看得见的那一块，并按阴影贴图的像素对齐，镜头移动时影子的边不闪
    const span = Math.max(20, dist * 0.95); sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix();
    const texel = (span * 2) / 4096, cx = Math.round(target.x / texel) * texel, cz = Math.round((target.z - dist * 0.12) / texel) * texel;
    sun.target.position.set(cx, 0, cz); sun.position.set(cx, 0, cz).addScaledVector(sunDir, 90);
    renderer.render(scene, camera);
    frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    hud.textContent = params.has("nohud") ? "" : `${fps.toFixed(0)} fps · ${renderer.domElement.width}×${renderer.domElement.height} · 样板间\n拖动或 WASD 平移，滚轮缩放`;
    if (++n > 8) (window as any).__ready = true;
    (window as any).__stats = { fps, tris: renderer.info.render.triangles, calls: renderer.info.render.calls };
  });
  (window as any).__scene = scene;
}
