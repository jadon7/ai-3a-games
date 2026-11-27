// 关键建筑的预览页（阶段 2.7）：把一个或几个建筑模型放在游戏的光下，用游戏里的材质看。
// 建模的人（包括 Codex）用它截图自查，游戏里用的也是同一套材质和光，所以这里看到的就是游戏里的样子。
//   ?model=/lab/kit/tower_me/out/tower_me_1.glb[,第二个,第三个]   要看的模型（从项目根目录算的路径）；多个会排成一排
//   ?team=0|1          用哪一方的材质和地面（0 我方，1 对方）
//   ?cam=距离,俯角,看向的高度,转角     默认是游戏镜头（24 米、56 度）
//   ?gap=6             多个模型之间隔多远；?man=0 不放两米高的小人；?t=3 固定时间（截图用）
//   ?ground=颜色        地面的颜色（十六进制，不写就是 B 的草地 / 红土）；?bg=颜色 背景
// 画风 B（b-build）：光、着色、调色和游戏一样走 toon.ts（分阶光、冷色的影子、提亮的曝光），地面是 B 的亮草地、红土

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { StoneTextures } from "../slice/stone";
import { applyKit } from "./materials";
import { TOON_ON, T } from "../toon";      // 引进来就把三的着色器换成 B 的分阶光和冷色影子（和游戏是同一份）

const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
boot().catch(e => { console.error(e); document.getElementById("hud")!.textContent = "出错了：" + e; });

async function boot() {
  const canvas = document.getElementById("view") as HTMLCanvasElement, hud = document.getElementById("hud")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const fit = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, 2, Math.sqrt(2.6e6 / (innerWidth * innerHeight)))); renderer.setSize(innerWidth, innerHeight, false); };
  fit();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 调色和游戏（world/main.ts）一样：色调映射后面接一小段，B 不加饱和、暗部往冷色偏。这里照抄一份（入口那份是写死在入口里的）
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }", `vec3 CustomToneMapping( vec3 color ) {
      color = NeutralToneMapping( color );
      float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
      color = mix( vec3( l ), color, ${(TOON_ON ? T.sat : 1.14).toFixed(3)} );
      float sh = 1.0 - smoothstep( 0.0, ${(TOON_ON ? T.shl : 0.32).toFixed(3)}, l ), hi = smoothstep( 0.42, 0.95, l );
      color *= mix( vec3( 1.0 ), vec3( 0.84, 1.0, 1.13 ), sh * ${(TOON_ON ? T.shc : 0.6).toFixed(3)} ) * mix( vec3( 1.0 ), vec3( 1.06, 1.0, 0.92 ), hi * 0.2 );
      float yg = clamp( ( color.g - color.b ) * 3.0, 0.0, 1.0 ) * clamp( 1.0 - abs( color.r - color.g ) * 5.0, 0.0, 1.0 );
      color.r *= 1.0 - ${(TOON_ON ? T.yg : 0.1).toFixed(3)} * yg;
      color += sh * 0.014 * vec3( 0.45, 0.8, 1.0 );
      return clamp( color, 0.0, 1.0 );
    }`);
  renderer.toneMapping = THREE.CustomToneMapping; renderer.toneMappingExposure = TOON_ON ? T.exp : 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const team = num("team", 0);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(params.has("bg") ? parseInt(params.get("bg")!, 16) : TOON_ON ? 0x1d3324 : 0x0d1014);
  // 和游戏一样的光（B：太阳略暖、天光偏冷青、影子浓度给满，影子里剩多少光由 toon.ts 的冷色管）
  const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize(), sun = new THREE.DirectionalLight(TOON_ON ? new THREE.Color(0xffffff).lerp(new THREE.Color(0xffe2b8), T.warm) : 0xfff0d6, TOON_ON ? T.sun : 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3.2; sun.shadow.intensity = TOON_ON ? 1.0 : 0.84;
  const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.near = 1; sc.far = 200; sc.left = sc.bottom = -26; sc.right = sc.top = 26; sc.updateProjectionMatrix();
  sun.position.copy(sunDir).multiplyScalar(90);
  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
  scene.add(sun, sun.target, TOON_ON ? new THREE.HemisphereLight(0xa4d8f0, 0x8a9a62, T.hemi) : new THREE.HemisphereLight(0xcfe2ff, 0x7f8a5c, 1.4), rim);
  // 地面：一块和游戏里颜色接近的平地（B：我方亮草绿，对方红土）
  // 整个场景挪到这一方的地盘上：toon.ts 的影子颜色按世界坐标分两边（隔着河道 x − z = 0 过渡），放在原点会是两边的平均色
  const O = team === 0 ? new THREE.Vector3(-24, 0, 24) : new THREE.Vector3(24, 0, -24); sun.position.add(O); sun.target.position.copy(O);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: params.has("ground") ? parseInt(params.get("ground")!, 16) : team === 0 ? (TOON_ON ? 0x6e9e3c : 0x73783a) : (TOON_ON ? 0xa55a36 : 0x9a5a3c), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.copy(O); ground.receiveShadow = true; scene.add(ground);

  const tl = new THREE.TextureLoader();
  const tex = async (n: string) => { try { const t = await tl.loadAsync(`/assets/slice/tex/${n}.webp`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; } catch { return null; } };
  const st: StoneTextures = { stone: [await tex("stone_me"), await tex("stone_foe")], trim: [await tex("bronze_me"), await tex("iron_foe")], rock: [await tex("rock_me"), await tex("rock_foe")], bark: await tex("bark") };
  const urls = (params.get("model") ?? "").split(",").filter(Boolean), gap = num("gap", 6), spin: THREE.Object3D[] = []; let tris = 0; const info: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(urls[i]); g.scene.position.set(O.x + (i - (urls.length - 1) / 2) * gap, 0, O.z); scene.add(g.scene);
    const r = applyKit(g.scene, st, team); spin.push(...r.spin); tris += r.tris;
    const bb = new THREE.Box3().setFromObject(g.scene), sz = bb.getSize(new THREE.Vector3());      // 高度从地面（y = 0）算
    info.push(`${urls[i].split("/").pop()}: 高 ${bb.max.y.toFixed(2)} 米，占地 ${sz.x.toFixed(2)}×${sz.z.toFixed(2)} 米，${r.tris} 个三角形`);
  }
  if (num("man", 1)) { const man = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.16, 6, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 })); man.position.set(O.x + (urls.length * gap) / 2 + 1.2, 1.0, O.z + 1.5); man.castShadow = true; scene.add(man); }

  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.3, 400);
  const [dist, pitchDeg, lookY, yawDeg] = (params.get("cam") ?? "24,56,0,0").split(",").map(Number), pitch = THREE.MathUtils.degToRad(pitchDeg || 56), yaw = THREE.MathUtils.degToRad(yawDeg || 0), h = (dist || 24) * Math.cos(pitch);
  camera.position.set(O.x + Math.sin(yaw) * h, (lookY || 0) + (dist || 24) * Math.sin(pitch), O.z + Math.cos(yaw) * h); camera.lookAt(O.x, lookY || 0, O.z);
  addEventListener("resize", () => { fit(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  const clock = new THREE.Clock(), fixedT = params.has("t") ? num("t", 0) : null; let n = 0, time = 0;
  renderer.setAnimationLoop(() => {
    time = fixedT ?? time + clock.getDelta();
    for (const o of spin) o.rotation.y = time * (o.name.toLowerCase().startsWith("ring") ? 0.15 : 0.5);
    renderer.render(scene, camera);
    hud.textContent = params.has("nohud") ? "" : info.join("\n");
    if (++n > 6) (window as any).__ready = true;
    (window as any).__stats = { tris, info, calls: renderer.info.render.calls };
  });
}
