// 基地口子上的旗和火盆（用户看完 2.7 后要加的；规矩里也有“重要的口子上放旗或火盆”）。
// 每个口子两面旗、两个火盆：旗立在两根门墩的顶上，火盆坐在台阶底下两侧护墙的方墩上。一共六个口子。
//   · 旗：一根杆、一根横梁、垂下来的一面燕尾旗，随风轻轻摆。我方深青底金边、一弯新月；对方暗红底铁边、一团火。
//   · 火盆：我方是青铜盆里几颗小晶体（是灯，不是火）；对方是铁盆里一堆余烬和一小簇火苗。
// 发光只有盆里那一点，只用阵营色，没有再加照亮周围的灯。

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GATES, GATE_HW, GATE_LP, GATE_RUN, toWorld } from "../layout";
import { kitMaterials } from "../kit/materials";
import type { StoneTextures } from "../slice/stone";

/** 旗面的图案：底色、包边、正中的徽记 */
function bannerTexture(team: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 280; const g = cv.getContext("2d")!;
  g.fillStyle = team === 0 ? "#1c5a58" : "#74241a"; g.fillRect(0, 0, 128, 280);
  const gr = g.createLinearGradient(0, 0, 0, 280); gr.addColorStop(0, "rgba(255,255,255,0.10)"); gr.addColorStop(1, "rgba(0,0,0,0.28)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 280);
  g.strokeStyle = team === 0 ? "#b79f60" : "#3a3536"; g.lineWidth = 9; g.strokeRect(6, 6, 116, 268);
  g.lineWidth = 2; g.strokeStyle = team === 0 ? "#d8c58a" : "#a04a2c"; g.strokeRect(15, 15, 98, 250);
  if (team === 0) {        // 新月
    g.fillStyle = "#d9c98f"; g.beginPath(); g.arc(64, 112, 30, 0, 6.283); g.fill();
    g.fillStyle = "#1c5a58"; g.beginPath(); g.arc(74, 104, 26, 0, 6.283); g.fill();
    g.fillStyle = "#7fd8cf"; g.beginPath(); g.moveTo(64, 160); g.lineTo(72, 176); g.lineTo(64, 194); g.lineTo(56, 176); g.closePath(); g.fill();
  } else {                 // 火
    g.fillStyle = "#d9772f"; g.beginPath(); g.moveTo(64, 70); g.bezierCurveTo(96, 110, 92, 150, 64, 166); g.bezierCurveTo(36, 150, 32, 110, 64, 70); g.fill();
    g.fillStyle = "#f0b25a"; g.beginPath(); g.moveTo(64, 104); g.bezierCurveTo(80, 126, 78, 148, 64, 156); g.bezierCurveTo(50, 148, 48, 126, 64, 104); g.fill();
    g.strokeStyle = "#3a3536"; g.lineWidth = 5; g.beginPath(); g.moveTo(40, 188); g.lineTo(64, 204); g.lineTo(88, 188); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function createGateProps(tex: StoneTextures, time: { value: number }): { group: THREE.Group; update: (t: number) => void; count: { banners: number; braziers: number } } {
  const group = new THREE.Group(); group.name = "gateprops";
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), flames: THREE.Sprite[] = []; let banners = 0, braziers = 0;
  const white = (g: THREE.BufferGeometry) => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute("uv"); o.setAttribute("color", new THREE.BufferAttribute(new Float32Array(o.getAttribute("position").count * 3).fill(1), 3)); return o; };
  // 光晕和火苗用的小图
  const dot = document.createElement("canvas"); dot.width = dot.height = 96;
  { const g = dot.getContext("2d")!, gr = g.createRadialGradient(48, 56, 0, 48, 48, 46); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 96, 96); }
  const dotTex = new THREE.CanvasTexture(dot);

  for (const su of [-1, 1]) {
    const team = su < 0 ? 0 : 1, mats = kitMaterials(tex, team), metal: THREE.BufferGeometry[] = [], accent: THREE.BufferGeometry[] = [], gem: THREE.BufferGeometry[] = [], coal: THREE.BufferGeometry[] = [];
    const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0, tilt = 0) => { const o = white(g); o.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(tilt, yaw, 0, "YXZ")), one)); list.push(o); };
    // 旗面：一块细分过的布，下边剪成燕尾；着色里让它越往下摆得越多
    const cloth = new THREE.PlaneGeometry(1.05, 2.3, 6, 14); { const p = cloth.getAttribute("position"); for (let i = 0; i < p.count; i++) if (p.getY(i) < -1.1) p.setY(i, p.getY(i) + (1 - Math.abs(p.getX(i)) / 0.525) * 0.38); }
    const clothMat = new THREE.MeshStandardMaterial({ map: bannerTexture(team), side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    clothMat.onBeforeCompile = sh => { sh.uniforms.uTime = time; sh.vertexShader = ("uniform float uTime;\n" + sh.vertexShader).replace("#include <begin_vertex>", "#include <begin_vertex>\n{ float k_ = (1.0 - uv.y); vec3 wp_ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float ph_ = wp_.x * 0.37 + wp_.z * 0.23; transformed.z += (sin(uTime * 1.7 + position.y * 2.4 + ph_) * 0.11 + sin(uTime * 2.9 + position.x * 3.0 + ph_ * 1.7) * 0.04) * k_; }"); };
    for (const [g, sv] of [[GATES[0], 1], [GATES[1], 1], [GATES[1], -1]] as const) {
      const L = (s: number, l: number) => toWorld(su * (g.o[0] + g.t[0] * s + g.n[0] * l), sv * (g.o[1] + g.t[1] * s + g.n[1] * l));
      const c0 = L(0, 0), c1 = L(-1, 0), yaw = Math.atan2(c1[0] - c0[0], c1[1] - c0[1]);       // 朝口子外面（下台阶的方向）
      for (const sd of [-1, 1]) {
        // ---- 旗：立在门墩顶上 ----
        const [px, pz] = L(g.sp[sd < 0 ? 0 : 1], sd * GATE_LP), y0 = 5.66;
        put(metal, new THREE.CylinderGeometry(0.055, 0.07, 3.3, 8), px, y0 + 1.65, pz);
        put(metal, new THREE.CylinderGeometry(0.16, 0.2, 0.16, 8), px, y0 + 0.08, pz);
        { const bar = new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6); bar.rotateZ(Math.PI / 2); put(metal, bar, px + Math.sin(yaw) * 0.12, y0 + 3.0, pz + Math.cos(yaw) * 0.12, yaw); }
        put(accent, new THREE.OctahedronGeometry(0.14), px, y0 + 3.42, pz);
        const m = new THREE.Mesh(cloth, clothMat); m.position.set(px + Math.sin(yaw) * 0.12, y0 + 3.0 - 1.17, pz + Math.cos(yaw) * 0.12); m.rotation.y = yaw; m.castShadow = true; group.add(m); banners++;
        // ---- 火盆：坐在台阶底下护墙的方墩上 ----
        const [bx, bz] = L(-GATE_RUN - 0.8, sd * (GATE_HW + 0.5)), by = 1.44;
        const bowl = new THREE.LatheGeometry([[0.12, 0], [0.17, 0.04], [0.1, 0.1], [0.09, 0.3], [0.2, 0.42], [0.44, 0.56], [0.5, 0.7], [0.46, 0.72], [0.38, 0.62], [0.0, 0.58]].map(([r, y]) => new THREE.Vector2(r, y)), 14);
        put(metal, bowl, bx, by, bz); put(accent, new THREE.TorusGeometry(0.49, 0.03, 6, 20).rotateX(Math.PI / 2), bx, by + 0.7, bz);
        if (team === 0) for (let k = 0; k < 3; k++) { const a = k * 2.1 + sd, o = new THREE.OctahedronGeometry(0.15); o.scale(0.8, 1.7 - k * 0.3, 0.8); put(gem, o, bx + Math.cos(a) * 0.13 * (k ? 1 : 0), by + 0.86 - k * 0.07, bz + Math.sin(a) * 0.13 * (k ? 1 : 0), a, 0.2 * (k ? 1 : 0)); }
        else {
          put(coal, new THREE.SphereGeometry(0.36, 10, 5, 0, 6.283, 0, 1.2).scale(1, 0.35, 1), bx, by + 0.55, bz);
          const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: 0xff8a34, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 })); f.position.set(bx, by + 0.98, bz); f.scale.set(0.5, 0.85, 1); (f.userData as any).ph = bx * 1.3 + bz; group.add(f); flames.push(f);
        }
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: team === 0 ? 0x58e6e0 : 0xff7a2e, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 })); halo.position.set(bx, by + 0.9, bz); halo.scale.setScalar(1.5); group.add(halo); braziers++;
      }
    }
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material, cast: boolean) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeometries(list)!, mat); m.castShadow = cast; m.receiveShadow = cast; group.add(m); };
    add(metal, mats.metal, true); add(accent, mats.accent, true); add(gem, mats.crystal, false); add(coal, mats.glow, false);
  }
  const update = (t: number) => { for (const f of flames) { const ph = (f.userData as any).ph, k = 1 + Math.sin(t * 9 + ph) * 0.12 + Math.sin(t * 15.7 + ph * 2.1) * 0.07; f.scale.set(0.42 * (2 - k), 1.05 * k, 1); } };      // 火苗瘦高一点，忽大忽小
  return { group, update, count: { banners, braziers } };
}
