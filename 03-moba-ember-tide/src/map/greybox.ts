// 地图灰盒（阶段 2.1）：只用色块和方块把布局搭出来，用来看大小、走法和节奏，不看画面。
//
//   默认：一个 2 米高的小人站在我方出生点。WASD 或点地面让它走（参考移速），镜头跟着，左下角计时。
//         F 切到自由镜头（拖动平移、滚轮缩放），R 回出生点重新计时。
//   ?cam=u,v,距离,俯角   固定机位（路向坐标），截图用
//   ?top=1               正俯视整张图
//   ?view=map            带标注的平面示意图

import * as THREE from "three";
import { clamp, hash2 } from "../core/noise";
import {
  A_CORNER, BRUSH, HALF, HERO_SPEED, LAGOON, L_RIVER, RIVER_END, WORLD_HALF,
  bossSpots, campSpots, coreSpots, fountainSpots, metrics, routes, sample, sideLaneW, toLane, toWorld, towerSpots, type Cell,
} from "./layout";

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);

// 灰盒的配色：一种地方一个颜色。开阔地面我方一侧偏绿，对方一侧偏红；墙是深色的石头
const C = {
  lane: 0xd3cab6, trail: 0xbfae8e, camp: 0xdcc98a, river: 0x4d95aa, island: 0xd8d0b8, ramp: 0xd3cab6,
  base0: 0xcbdcc4, base1: 0xe6cbc3, brush: 0x4c9a3a, grass0: 0x9fbe8c, grass1: 0xcda28d, wall: 0x646a74, out: 0x2b2e34,
  team0: 0x4fbf6a, team1: 0xd9503f,
};
const col = new THREE.Color(), col2 = new THREE.Color();
function cellColor(c: Cell, out: THREE.Color) {
  if (c.brush) return out.set(C.brush);
  switch (c.zone) {
    case "out": return out.set(C.out);
    case "wall": return out.set(C.wall);
    case "grass": return out.set(C.grass0).lerp(col2.set(C.grass1), c.side);
    case "base": return out.set(c.team === 0 ? C.base0 : C.base1);
    case "ramp": return out.set(C.ramp);
    case "river": return out.set(C.river);
    case "island": return out.set(C.island);
    case "camp": return out.set(C.camp);
    case "trail": return out.set(C.trail);
    default: return out.set(C.lane);
  }
}

if (params.get("view") === "map") drawMap(); else boot();

// ------------------------------------------------------------------ 三维灰盒
function boot() {
  const canvas = document.getElementById("view") as HTMLCanvasElement, hud = document.getElementById("hud")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const fit = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, num("dpr", 2), Math.sqrt(2.6e6 / (innerWidth * innerHeight))));
    renderer.setSize(innerWidth, innerHeight, false);
  };
  fit();
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x14171c);

  // 地面：每半米取一个点。墙不是直上直下的台阶：先算出每个墙格离最近的可走格有多远，再按这个距离把墙面抹成一道斜坡，边缘才干净
  const STEP = 0.5, N = Math.round((WORLD_HALF * 2) / STEP), V = N + 1;
  const cells: Cell[] = new Array(V * V), wd = new Float32Array(V * V), nearH = new Float32Array(V * V), hgt = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { const k = j * V + i, c = sample(-WORLD_HALF + i * STEP, -WORLD_HALF + j * STEP); cells[k] = c; wd[k] = c.walk ? 0 : 1e9; nearH[k] = c.walk ? c.h : 0; }
  const relax = (k: number, n: number, w: number) => { if (wd[n] + w < wd[k]) { wd[k] = wd[n] + w; nearH[k] = nearH[n]; } };
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { const k = j * V + i; if (i > 0) relax(k, k - 1, STEP); if (j > 0) relax(k, k - V, STEP); if (i > 0 && j > 0) relax(k, k - V - 1, STEP * 1.414); if (i < N && j > 0) relax(k, k - V + 1, STEP * 1.414); }
  for (let j = N; j >= 0; j--) for (let i = N; i >= 0; i--) { const k = j * V + i; if (i < N) relax(k, k + 1, STEP); if (j < N) relax(k, k + V, STEP); if (i < N && j < N) relax(k, k + V + 1, STEP * 1.414); if (i > 0 && j < N) relax(k, k + V - 1, STEP * 1.414); }
  const tufts: { x: number; z: number }[] = [];
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const k = j * V + i, c = cells[k], x = -WORLD_HALF + i * STEP, z = -WORLD_HALF + j * STEP;
    const t = clamp(wd[k] / 0.7, 0, 1);       // 薄墙：墙面收得陡，不然 2.6 米厚的墙立不起来
    hgt[k] = c.walk ? c.h : nearH[k] + (c.h - nearH[k]) * t * t * (3 - 2 * t);

    if (c.brush && i % 2 === 0 && j % 2 === 0) tufts.push({ x: x + (hash2(i, j, 4) - 0.5) * 0.7, z: z + (hash2(i, j, 5) - 0.5) * 0.7 });
  }
  // 每个小方格一个颜色（不在顶点之间渐变）：只要沾到墙，整格就是墙的颜色，崖面不会被地面的颜色染花
  const pos = new Float32Array(N * N * 18), colors = new Float32Array(N * N * 18);
  for (let j = 0, o = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ks = [j * V + i, j * V + i + 1, (j + 1) * V + i, (j + 1) * V + i + 1];
    let deep = ks[0]; for (const k of ks) if (wd[k] > wd[deep]) deep = k;
    cellColor(cells[deep], col);
    for (const q of [0, 2, 1, 1, 2, 3]) { const k = ks[q], ii = k % V, jj = (k - ii) / V; pos[o] = -WORLD_HALF + ii * STEP; pos[o + 1] = hgt[k]; pos[o + 2] = -WORLD_HALF + jj * STEP; colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b; o += 3; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  ground.receiveShadow = true; ground.castShadow = true; scene.add(ground);
  // 河面：一层半透明的水
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2), new THREE.MeshBasicMaterial({ color: 0x5fb4c8, transparent: true, opacity: 0.45, depthWrite: false }));
  water.rotation.x = -Math.PI / 2; water.position.y = L_RIVER + 0.5; scene.add(water);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();



  // 草丛：一丛一个矮锥
  const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 0.95, 5).translate(0, 0.47, 0), new THREE.MeshLambertMaterial({ color: 0x8fcf5e }), tufts.length);
  tufts.forEach((t, i) => grass.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(1, 0.8 + hash2(i, 3, 8) * 0.5, 1))));
  scene.add(grass);

  // 建筑和标记：防御塔 9 米高，水晶 8 米，小人 2 米
  const add = (g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, emissive = 0) => {
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : 0, emissiveIntensity: emissive }));
    m.position.set(x, y, z); m.castShadow = true; scene.add(m); return m;
  };
  const teamColor = (t: number) => (t === 0 ? C.team0 : C.team1);
  for (const t of towerSpots()) {
    const y = sample(t.x, t.z).h, hgt = t.tier === 3 ? 10 : 9;
    add(new THREE.CylinderGeometry(1.25, 1.9, hgt, 10), 0xe8e4da, t.x, y + hgt / 2, t.z);
    add(new THREE.SphereGeometry(1.25, 14, 10), teamColor(t.team), t.x, y + hgt + 0.6, t.z, 0.5);
  }
  for (const c of coreSpots()) { const y = sample(c.x, c.z).h; add(new THREE.CylinderGeometry(4.2, 4.4, 0.7, 28), 0xe8e4da, c.x, y + 0.35, c.z); add(new THREE.OctahedronGeometry(3.0), teamColor(c.team), c.x, y + 4.4, c.z, 0.45); }
  for (const f of fountainSpots()) { const y = sample(f.x, f.z).h; add(new THREE.CylinderGeometry(3.8, 3.8, 0.3, 32), teamColor(f.team), f.x, y + 0.15, f.z, 0.35); add(new THREE.TorusGeometry(4.1, 0.4, 8, 36).rotateX(Math.PI / 2), 0xe8e4da, f.x, y + 0.4, f.z); }
  for (const c of campSpots()) add(new THREE.ConeGeometry(c.kind === "buff" ? 1.5 : 1.0, c.kind === "buff" ? 3.0 : 1.9, 6), c.kind === "buff" ? 0xf08a2c : 0xe7c94a, c.x, (c.kind === "buff" ? 1.5 : 0.95), c.z);
  for (const b of bossSpots()) add(new THREE.ConeGeometry(2.4, 5, 6), 0x9a5fd0, b.x, 2.4, b.z);

  // 小人
  const hero = add(new THREE.CapsuleGeometry(0.45, 1.1, 6, 12), 0xffffff, 0, 0, 0);
  const band = add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12), C.team0, 0, 0, 0, 0.6); hero.add(band); band.position.set(0, 0.25, 0);
  const home = fountainSpots().find(f => f.team === 0)!;
  const [hx, hz] = toWorld(-(A_CORNER - 13.9), 0);
  const heroPos = new THREE.Vector3(hx, 0, hz);
  let walked = 0, timer = 0, goal: THREE.Vector3 | null = null;
  const resetHero = () => { heroPos.set(home.x, 0, home.z); const [x, z] = toWorld(-(A_CORNER - 13.9), 0); heroPos.set(x, 0, z); walked = 0; timer = 0; goal = null; };

  // 光
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); const sunDir = new THREE.Vector3(-0.62, 1.0, 0.16).normalize();
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.05;
  const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.near = 1; sc.far = 400;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe0ff, 0x6b6258, 1.7));

  // 镜头：和正式版一样的俯角和视野
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 900);
  const target = new THREE.Vector3(); let dist = num("dist", 24), pitch = THREE.MathUtils.degToRad(56), free = false;
  let ortho: THREE.OrthographicCamera | null = null;
  if (params.has("cam")) { const [u, v, d, p] = params.get("cam")!.split(",").map(Number); const [x, z] = toWorld(u, v); target.set(x, 0, z); dist = d || dist; if (p) pitch = THREE.MathUtils.degToRad(p); free = true; hero.visible = params.has("hero"); if (hero.visible) { const [hu, hv] = (params.get("hero") || "").split(",").map(Number); const [ax, az] = toWorld(u + (hu || 0), v + (hv || 0)); heroPos.set(ax, 0, az); } }
  if (num("top", 0) > 0) { const s = WORLD_HALF; ortho = new THREE.OrthographicCamera(-s, s, s, -s, 1, 600); ortho.position.set(0, 300, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0); hero.visible = false; }

  const keys = new Set<string>();
  addEventListener("keydown", e => { keys.add(e.code); if (e.code === "KeyF") free = !free; if (e.code === "KeyR") { resetHero(); free = false; } });
  addEventListener("keyup", e => keys.delete(e.code)); addEventListener("blur", () => keys.clear());
  canvas.addEventListener("wheel", e => { e.preventDefault(); dist = clamp(dist * (1 + Math.sign(e.deltaY) * 0.08), 14, 90); }, { passive: false });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let down = false, lastX = 0, lastY = 0;
  const pick = (e: PointerEvent) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(plane, hit)) goal = hit.clone(); };
  canvas.addEventListener("pointerdown", e => { down = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); if (!free) pick(e); });
  canvas.addEventListener("pointerup", () => { down = false; });
  canvas.addEventListener("pointermove", e => {
    if (!down) return;
    if (!free) { pick(e); return; }
    const k = (2 * dist * Math.tan(THREE.MathUtils.degToRad(17))) / innerHeight;
    target.x = clamp(target.x - (e.clientX - lastX) * k, -HALF, HALF); target.z = clamp(target.z - ((e.clientY - lastY) * k) / Math.sin(pitch), -HALF, HALF);
    lastX = e.clientX; lastY = e.clientY;
  });
  addEventListener("resize", () => { fit(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  const m = metrics();
  (window as any).__metrics = m; (window as any).__routes = routes;
  const clock = new THREE.Clock(); let frames = 0, fpsT = 0, fps = 0, n = 0;
  const canWalk = (x: number, z: number) => sample(x, z).walk;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    // 走路：键盘方向或者朝点过的地方走，撞墙就贴着墙滑
    let dx = 0, dz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) dz -= 1; if (keys.has("KeyS") || keys.has("ArrowDown")) dz += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) dx -= 1; if (keys.has("KeyD") || keys.has("ArrowRight")) dx += 1;
    if (free) { target.x = clamp(target.x + dx * dt * dist, -HALF, HALF); target.z = clamp(target.z + dz * dt * dist, -HALF, HALF); }
    else if (hero.visible) {
      if (dx || dz) goal = null;
      else if (goal) { dx = goal.x - heroPos.x; dz = goal.z - heroPos.z; if (Math.hypot(dx, dz) < 0.25) { goal = null; dx = dz = 0; } }
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        const sx = (dx / len) * HERO_SPEED * dt, sz = (dz / len) * HERO_SPEED * dt, ox = heroPos.x, oz = heroPos.z;
        if (canWalk(ox + sx, oz + sz)) { heroPos.x += sx; heroPos.z += sz; } else if (canWalk(ox + sx, oz)) heroPos.x += sx; else if (canWalk(ox, oz + sz)) heroPos.z += sz;
        const moved = Math.hypot(heroPos.x - ox, heroPos.z - oz); walked += moved; if (moved > 0) timer += dt;
      }
      target.set(heroPos.x, 0, heroPos.z);
    }
    hero.position.set(heroPos.x, sample(heroPos.x, heroPos.z).h + 1.0, heroPos.z);
    camera.position.set(target.x, dist * Math.sin(pitch), target.z + dist * Math.cos(pitch)); camera.lookAt(target);
    const span = ortho ? WORLD_HALF * 1.2 : Math.max(34, dist * 1.3);
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix();
    sun.target.position.copy(ortho ? new THREE.Vector3() : target); sun.position.copy(sun.target.position).addScaledVector(sunDir, 180);
    renderer.render(scene, ortho ?? camera);
    frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    const [u, v] = toLane(heroPos.x, heroPos.z);
    hud.textContent = params.has("nohud") ? "" : `${fps.toFixed(0)} fps · 灰盒 · 地图 ${m.size} 米见方\n` +
      (free ? "自由镜头：拖动或 WASD 平移，滚轮缩放。F 回到小人，R 回出生点" : `走了 ${walked.toFixed(0)} 米 · ${timer.toFixed(1)} 秒（移速 ${HERO_SPEED} 米/秒）· 位置 u ${u.toFixed(0)} v ${v.toFixed(0)}\nWASD 或点地面走路，滚轮缩放。F 自由镜头，R 回出生点重新计时`);
    (window as any).__hero = { x: heroPos.x, z: heroPos.z, walked, timer, free };
    if (++n > 6) (window as any).__ready = true;
    (window as any).__stats = { fps, tris: renderer.info.render.triangles, calls: renderer.info.render.calls };
  });
}

// ------------------------------------------------------------------ 平面示意图
function drawMap() {
  (document.getElementById("view") as HTMLCanvasElement).style.display = "none";
  const cv = document.getElementById("map") as HTMLCanvasElement; cv.hidden = false;
  const PX = num("px", 8), R = HALF + 7, S = Math.round(R * 2 * PX);
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!, img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -R + (i + 0.5) / PX, z = -R + (j + 0.5) / PX, c = sample(x, z);
    cellColor(c, col);
    // 草丛画成斜纹，硬山体的边上压一道暗线，树林上撒点
    if (c.brush && ((i + j) >> 2) % 2 === 0) col.multiplyScalar(0.8);

    if (!c.walk && c.zone !== "wall" && c.zone !== "out") col.multiplyScalar(0.8);
    const o = (j * S + i) * 4; img.data[o] = col.r ** (1 / 2.2) * 255; img.data[o + 1] = col.g ** (1 / 2.2) * 255; img.data[o + 2] = col.b ** (1 / 2.2) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const P = (x: number, z: number): [number, number] => [(x + R) * PX, (z + R) * PX];
  const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
  const F = (px: number, w = 600) => `${w} ${px}px -apple-system, "PingFang SC", sans-serif`;
  const text = (s: string, x: number, z: number, px = 15, fill = "#fff", weight = 600, rot = 0, outline = true) => {
    const [cx, cy] = P(x, z); g.save(); g.translate(cx, cy); g.rotate(rot); g.font = F(px, weight); g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = px / 3.5; g.lineJoin = "round"; g.strokeStyle = "rgba(12,14,18,.85)"; if (outline) g.strokeText(s, 0, 0); g.fillStyle = fill; g.fillText(s, 0, 0); g.restore();
  };
  const dot = (x: number, z: number, r: number, fill: string, stroke = "#fff", lw = 2) => { const [cx, cy] = P(x, z); g.beginPath(); g.arc(cx, cy, r * PX, 0, 6.283); g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); };
  const tc = (t: number) => hex(t === 0 ? C.team0 : C.team1);

  // 可活动区域的边框
  { const [x0, y0] = P(-HALF, -HALF); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1.5; g.setLineDash([6, 5]); g.strokeRect(x0, y0, HALF * 2 * PX, HALF * 2 * PX); g.setLineDash([]); }
  for (const t of towerSpots()) { dot(t.x, t.z, 1.9, tc(t.team)); text(["", "外", "内", "高"][t.tier], t.x, t.z + 0.15, 14, "#0c1016", 700, 0, false); }
  // 专门蹲人的草丛描一圈白色虚线
  g.setLineDash([5, 4]); g.strokeStyle = "#fff"; g.lineWidth = 2;
  for (const b of BRUSH) if (b.special) for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const [x0, z0] = toWorld(su * b.p[0], sv * b.p[1]), [x1, z1] = toWorld(su * b.q[0], sv * b.q[1]), [ax, ay] = P(x0, z0), [bx, by] = P(x1, z1), r = b.hw * PX, ang = Math.atan2(by - ay, bx - ax);
    g.beginPath(); g.arc(ax, ay, r, ang + Math.PI / 2, ang - Math.PI / 2); g.arc(bx, by, r, ang - Math.PI / 2, ang + Math.PI / 2); g.closePath(); g.stroke();
  }
  g.setLineDash([]);
  for (const c of coreSpots()) { const [cx, cy] = P(c.x, c.z), r = 3.2 * PX; g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fillStyle = tc(c.team); g.fill(); g.lineWidth = 2.5; g.strokeStyle = "#fff"; g.stroke(); text("水晶", c.x, c.z, 13, "#0c1016", 700, 0, false); }
  for (const f of fountainSpots()) { dot(f.x, f.z, 3.8, "rgba(255,255,255,.2)", tc(f.team), 5); text("出生", f.x, f.z, 13); }
  for (const c of campSpots()) { dot(c.x, c.z, c.kind === "buff" ? 1.7 : 1.2, c.kind === "buff" ? "#f08a2c" : "#e7c94a", "#10131a", 1.5); if (c.kind === "buff") text("增益怪", c.x, c.z + 3.6, 12, "#ffe2b0"); }
  for (const b of bossSpots()) { dot(b.x, b.z, 2.6, "#9a5fd0"); text(b.top ? "Boss 一" : "Boss 二", b.x, b.z + 5, 13, "#e6d4ff"); }

  // 标注
  const lab = (s: string, u: number, v: number, px = 15, fill = "#fff", rot = 0) => { const [x, z] = toWorld(u, v); text(s, x, z, px, fill, 600, rot); };
  lab("我方 · 绿", -(A_CORNER - 22), 13, 19, "#d9ffe0"); lab("对方 · 红", A_CORNER - 22, -13, 19, "#ffe0da");
  lab("中路", -33, 0, 15, "#fff", -Math.PI / 4); lab("中路", 33, 0, 15, "#fff", -Math.PI / 4);
  { const a = 40, w = sideLaneW(a); lab("上路", -a, -w, 15, "#fff", -Math.PI / 2); lab("上路", a, -w, 15); lab("下路", -a, w, 15); lab("下路", a, w, 15, "#fff", Math.PI / 2); }
  lab("河道", 0, -24, 15, "#d6f3fb", Math.PI / 4); lab("河道", 0, 24, 15, "#d6f3fb", Math.PI / 4);
  lab("我方上野区", -36, -44, 13, "#d8e6d8"); lab("我方下野区", -36, 44, 13, "#d8e6d8"); lab("对方上野区", 36, -44, 13, "#ecd8d4"); lab("对方下野区", 36, 44, 13, "#ecd8d4");
  // 比例尺
  { const [x0, y0] = P(-HALF + 4, HALF + 3.6), len = 20 * PX; g.fillStyle = "#fff"; g.fillRect(x0, y0, len, 4); g.fillRect(x0, y0 - 5, 2, 14); g.fillRect(x0 + len - 2, y0 - 5, 2, 14); g.font = F(14); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText("20 米", x0 + len + 8, y0 + 2); }
  { const [x0, y0] = P(HALF - 4, HALF + 3.6); g.font = F(14); g.textAlign = "right"; g.fillStyle = "#cfd6de"; g.fillText(`可活动区域 ${HALF * 2} × ${HALF * 2} 米（虚线框）`, x0, y0 + 2); }
  void LAGOON; void RIVER_END;
  (window as any).__metrics = metrics(); (window as any).__stats = { fps: 0, tris: 0, calls: 0 }; (window as any).__ready = true;
}
