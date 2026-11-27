// 第一人称武器：程序化枪模 + 手臂 + 弹簧动画 + 射击 / 换弹 / 近战 / 手雷
import * as THREE from 'three';
import { canvasTex } from '../gfx/texgen.js';
import { ATMOS } from '../gfx/sky.js';
import { Parts, buildRifle, buildShotgun, buildRail, buildArms, rifleExtras, gunDecal } from './gunmodels.js';
import { loadGunModels, gunFromModel, armsFromModel, gunMaterials } from './gunloader.js';
export { Parts, loadGunModels };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _e = new THREE.Euler();
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const kf = (t, keys) => { if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) { if (t <= keys[i][0]) { const u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); const s = u * u * (3 - 2 * u); return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * s; } } return keys[keys.length - 1][1]; };

export const WEAPONS = {
  rifle: { key: 'rifle', name: 'R-27 卡宾枪', tag: '突击步枪', mag: 30, rpm: 720, dmg: 25, head: 1.8, range: 160, fall: [30, 90, 0.55], spread: [0.0050, 0.0012], bloom: 0.0021, maxBloom: 0.028, recoil: [0.0115, 0.0045, 0.030, 0.030], reload: 1.75, auto: true, zoom: 1.32, sound: 'rifle_fire', pellets: 1, mechMul: 0.28, ads: [0, -0.100, -0.19], hip: [0.172, -0.188, -0.47], flash: 1 },
  shotgun: { key: 'shotgun', name: 'SG-8 猛禽', tag: '霰弹枪', mag: 6, rpm: 78, dmg: 17, head: 1.3, range: 60, fall: [9, 28, 0.25], spread: [0.058, 0.040], bloom: 0, maxBloom: 0, recoil: [0.05, 0.012, 0.085, 0.10], reload: 2.3, auto: false, zoom: 1.15, sound: 'shotgun_fire', pellets: 10, mechMul: 0.3, ads: [0, -0.092, -0.20], hip: [0.175, -0.185, -0.47], flash: 1.8, pump: 0.62 },
  rail: { key: 'rail', name: 'RG-1 长矛', tag: '轨道步枪 · 反装甲', mag: 4, rpm: 46, dmg: 260, head: 1.5, range: 240, fall: [999, 1000, 1], spread: [0.002, 0.0], bloom: 0, maxBloom: 0, recoil: [0.07, 0.01, 0.11, 0.12], reload: 2.5, auto: false, zoom: 2.7, sound: 'rail_fire', pellets: 1, mechDmg: 720, charge: 0.52, ads: [0, -0.108, -0.14], hip: [0.18, -0.19, -0.48], flash: 0 },
};
const ORDER = ['rifle', 'shotgun', 'rail'];

export class Weapons {
  constructor(game) {
    this.game = game; this.player = game.player; this.cam = game.engine.camera; this.input = game.input;
    const T = game.engine.T;
    const std = (t, color, o = {}) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, color, ...o });
    const phys = (t, color, o = {}) => new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, color, ...o });
    this.mats = {
      // 物理材质 + 清漆层：金属本体的反射之上再叠一层锐利的高光（枪油 / 阳极氧化膜），转动枪身时反光明显
      metal: phys(T.gunmetalClean, 0x55575c, { metalness: 0.6, roughness: 0.98, clearcoat: 0.42, clearcoatRoughness: 0.26 }),    // 深色阳极氧化 / 氮化钢
      metalBare: phys(T.gunmetalClean, 0x9a9ca2, { metalness: 1.0, roughness: 0.62, clearcoat: 0.3, clearcoatRoughness: 0.2 }),  // 裸露钢件：枪管、枪机、销钉
      tanMetal: phys(T.gunmetalClean, 0xa88e68, { metalness: 0.3, roughness: 1.05, clearcoat: 0.36, clearcoatRoughness: 0.3 }),   // 沙色陶瓷涂层铝护木
      glass: new THREE.MeshPhysicalMaterial({ color: 0x16282c, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, envMapIntensity: 1.8 }),
      poly: std(T.polymer, 0xffffff, { metalness: 0 }),
      tan: std(T.polymerLight, 0xa3865a, { metalness: 0 }),               // 沙色聚合物护木 / 枪托 / 握把
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.1 }),
      sleeve: std(T.camoDesert, 0xffffff, { metalness: 0 }), glove: std(T.polymer, 0xd8d8da, { metalness: 0 }), plate: std(T.armorClean, 0x7d6c50),
      gloveFab: std(T.fabric, 0x9b8463, { metalness: 0 }),   // 手套手背：狼棕色织物（掌面由顶点权重染成深色合成革）
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 3.2), fog: false }),
      red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.5, 0.2), fog: false }),
      coil: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.5, 0.7), fog: false }),
      shell: new THREE.MeshStandardMaterial({ color: 0xa02818, roughness: 0.5, metalness: 0.0 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 1.0 }),
      rubber: std(T.polymer, 0x5c5c60, { metalness: 0 }),
    };
    this.matsG = gunMaterials(this.mats);   // GLB 硬表面枪模用：带 AO / 棱边磨损补丁
    this.root = new THREE.Group(); this.cam.add(this.root);
    this.sway = new THREE.Group(); this.root.add(this.sway);
    this.vmFov = 60; this.vmScale = 0.28; this._fov = 0; this.root.visible = false;
    this.guns = {};
    this._buildRifle(); this._buildShotgun(); this._buildRail(); this._buildArms(); this._buildFlash();

    this.cur = 'rifle'; this.ammo = { rifle: 30, shotgun: 6, rail: 4 };
    this.cooldown = 0; this.bloom = 0; this.reloadT = -1; this.switchT = -1; this.switchTo = null; this.meleeT = -1; this.meleeHit = false; this.pumpT = -1;
    this.charge = 0; this.charging = false;
    this.grenades = 2; this.grenadeMax = 2; this.meleeCD = 0; this.fireHold = 0;
    this.rec = { z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0 };
    this.sw = { x: 0, y: 0 }; this.poseSprint = 0; this.poseAir = 0; this.poseRoll = 0; this.flashT = 0; this.lower = 1;
    this.stats = { shots: 0, hits: 0 };
    for (const k of ORDER) this.guns[k].group.visible = k === this.cur;
    this._ammoTexDirty = true;
    // 视模专用投影：近裁面极近（开镜时机匣后部不会被裁出"穿模"的断面），深度压进最靠前的 2%（永远不会插进墙里）
    this.vmProj = { value: new THREE.Matrix4() }; const seen = new Set();
    const each = (o) => { if (!o.material) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) { if (seen.has(m)) continue; seen.add(m); this._vmPatch(m); } };
    this.root.traverse(each); this.flash.traverse(each);   // 枪口焰开火时才挂到枪口上，这里一并处理
  }
  _vmPatch(mat) {
    const prev = mat.onBeforeCompile; const key = mat.customProgramCacheKey(); const U = this.vmProj;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.uniforms.uVmProj = U;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uVmProj;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position = uVmProj * mvPosition;\n  gl_Position.z = gl_Position.z * 0.02 - gl_Position.w * 0.98;');
    };
    mat.customProgramCacheKey = () => key + '|vm';
  }
  get def() { return WEAPONS[this.cur]; }
  // 钩索发射点（左腕发射器）的世界坐标
  grappleOrigin(out) { this.cam.updateMatrixWorld(true); return out.copy(this._grapple).applyMatrix4(this.armL.matrixWorld); }

  _buildRifle() {
    this.ammoCanvas = document.createElement('canvas'); this.ammoCanvas.width = 64; this.ammoCanvas.height = 32;
    this.ammoTex = new THREE.CanvasTexture(this.ammoCanvas); this.ammoTex.colorSpace = THREE.SRGBColorSpace;
    const m = gunFromModel('rifle', this.matsG); if (m) rifleExtras(m.group, this.ammoTex, -0.02165, true);
    this.guns.rifle = m || buildRifle(this.mats, this.ammoTex); this.sway.add(this.guns.rifle.group);
    this._ammoDisp = this.guns.rifle.group.getObjectByName('ammoDisp') || null;
  }
  _buildShotgun() { const m = gunFromModel('shotgun', this.matsG); if (m) m.group.add(gunDecal('SG-8', '12 GA  KHAMSIN ARMS', 0.066, 0.0165, -0.02335, 0.040, 0.078)); this.guns.shotgun = m || buildShotgun(this.mats); this.sway.add(this.guns.shotgun.group); }
  _buildRail() { const m = gunFromModel('rail', this.matsG); if (m) { m.coils = m.coils || []; m.group.add(gunDecal('RG-1', 'RAIL  1.2 MJ  KHAMSIN ARMS', 0.085, 0.021, -0.02545, 0.004, 0.0)); } this.guns.rail = m || buildRail(this.mats); this.sway.add(this.guns.rail.group); }
  _buildArms() {
    const a = armsFromModel(this.matsG) || buildArms(this.mats); this.armR = a.armR; this.armL = a.armL; this._grapple = a.grapple || new THREE.Vector3(-0.05, -0.058, 0.085); this.sway.add(this.armR); this.sway.add(this.armL);
    if (a.disp) {   // 左前臂发射器上的状态屏：显示钩索充能
      this.grCanvas = document.createElement('canvas'); this.grCanvas.width = 128; this.grCanvas.height = 176;
      this.grTex = new THREE.CanvasTexture(this.grCanvas); this.grTex.colorSpace = THREE.SRGBColorSpace; this.grTex.anisotropy = 4;
      const holder = new THREE.Group(); holder.position.copy(a.disp.pos); holder.quaternion.copy(a.disp.quat); this.armL.add(holder);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.0300, 0.0412), new THREE.MeshBasicMaterial({ map: this.grTex, color: new THREE.Color(1.7, 1.7, 1.7), fog: false }));
      scr.matrixAutoUpdate = false; scr.matrix.makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)); holder.add(scr); this._grKey = '';
    }
  }
  _drawGrapple() {
    const gp = this.player.grapple; const full = Math.floor(gp.charges + 1e-6), frac = gp.charges >= gp.max ? 1 : gp.charges - full; const busy = gp.state > 0;
    const key = full + '|' + Math.round(frac * 14) + '|' + (busy ? 1 : 0); if (key === this._grKey) return; this._grKey = key;
    const g = this.grCanvas.getContext('2d'), W = 128, H = 176, C = '#5fe6ff', D = '#12333a';
    g.fillStyle = '#020a0c'; g.fillRect(0, 0, W, H);
    g.fillStyle = C; g.font = '700 15px "DIN Alternate", "Helvetica Neue", Arial'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('GRAPPLE', 10, 16);
    g.fillStyle = busy ? '#ffb347' : full > 0 ? C : '#ff5a2a'; g.textAlign = 'right'; g.fillText(busy ? 'LINE' : full > 0 ? 'RDY' : 'CHG', W - 10, 16);
    g.fillStyle = D; g.fillRect(10, 27, W - 20, 2);
    for (let i = 0; i < gp.max; i++) {   // 每格一发：实心 = 可用
      const x = 10 + i * 56, y = 40, w = 52, h = 70; g.strokeStyle = i < full ? C : D; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      if (i < full) { g.fillStyle = C; g.fillRect(x + 7, y + 7, w - 14, h - 14); } else if (i === full && frac > 0) { g.fillStyle = '#1f6f80'; const hh = (h - 14) * frac; g.fillRect(x + 7, y + h - 7 - hh, w - 14, hh); }
    }
    g.fillStyle = D; g.fillRect(10, 124, W - 20, 10); g.fillStyle = busy ? '#ffb347' : C; g.fillRect(10, 124, (W - 20) * Math.min(1, gp.charges / gp.max), 10);
    g.fillStyle = '#3c98a8'; g.font = '600 12px "DIN Alternate", "Helvetica Neue", Arial'; g.textAlign = 'left'; g.fillText('KA-GL2', 10, 154); g.textAlign = 'right'; g.fillText('34 M', W - 10, 154);
    this.grTex.needsUpdate = true;
  }
  _buildFlash() {
    const tex = canvasTex(128, 128, (g) => { g.translate(64, 64); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(-64, -64, 128, 128); g.fillStyle = 'rgba(255,255,255,0.9)'; for (let k = 0; k < 6; k++) { g.save(); g.rotate(k / 6 * 6.28 + 0.3); g.beginPath(); g.moveTo(0, -7); g.lineTo(60, 0); g.lineTo(0, 7); g.fill(); g.restore(); } }, { srgb: false });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(3.2, 2.0, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), mat); this.flash.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), mat); b.rotation.y = Math.PI / 2; b.position.z = -0.1; this.flash.add(b);
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), mat); c.rotation.set(Math.PI / 2, 0, Math.PI / 2); c.position.z = -0.1; this.flash.add(c);
    this.flash.visible = false; this.flash.traverse((o) => { o.renderOrder = 9; o.frustumCulled = false; });
  }

  _drawAmmo() {
    const g = this.ammoCanvas.getContext('2d'); g.fillStyle = '#02080a'; g.fillRect(0, 0, 64, 32);
    const low = this.ammo.rifle <= 8; g.fillStyle = low ? '#ff5a2a' : '#5fe6ff'; g.font = '700 26px "DIN Alternate", "Helvetica Neue", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(this.ammo.rifle).padStart(2, '0'), 32, 17); this.ammoTex.needsUpdate = true;
  }

  switchWeapon(k) { if (k === this.cur || this.switchT >= 0 || !WEAPONS[k]) return; this.switchT = 0; this.switchTo = k; this.reloadT = -1; this.charging = false; this.charge = 0; this.game.audio.play('weapon_swap'); }
  startReload() { if (this.reloadT >= 0 || this.switchT >= 0 || this.ammo[this.cur] >= this.def.mag) return; this.reloadT = 0; this._rl = 0; this.charging = false; this.charge = 0; }

  update(dt) {
    const p = this.player, inp = this.input, def = this.def, gun = this.guns[this.cur];
    const active = p.alive && !p.inMech;
    this.root.visible = active && !this.game.cinematic;
    // 视模 FOV 补偿：缩小 + xy 拉伸，使其在任意世界 FOV 下外观一致
    if (Math.abs(this.cam.fov - this._fov) > 0.01) { this._fov = this.cam.fov; const k = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(this.vmFov / 2)); this.root.scale.set(this.vmScale * k, this.vmScale * k, this.vmScale); }
    { const e = this.vmProj.value.copy(this.cam.projectionMatrix).elements; const n = 0.006, f = 30; e[10] = -(f + n) / (f - n); e[14] = -2 * f * n / (f - n); }
    if (this._ammoTexDirty) { this._drawAmmo(); this._ammoTexDirty = false; }
    if (this.grCanvas) this._drawGrapple();
    this.cooldown -= dt; this.meleeCD -= dt; this.bloom = Math.max(0, this.bloom - dt * 0.05); this.flashT -= dt;
    if (this.grenades < this.grenadeMax) this.grenades = Math.min(this.grenadeMax, this.grenades + dt / 9);
    if (!active) { p.adsT = damp(p.adsT, 0, 12, dt); this.game.audio.loop('rail_hold', false); return; }

    const busy = this.switchT >= 0 || this.meleeT >= 0;
    // 切枪
    for (let i = 0; i < ORDER.length; i++) if (inp.hit('Digit' + (i + 1))) this.switchWeapon(ORDER[i]);
    if (inp.wheel) this.switchWeapon(ORDER[(ORDER.indexOf(this.cur) + (inp.wheel > 0 ? 1 : ORDER.length - 1)) % ORDER.length]);
    if (this.switchT >= 0) {
      this.switchT += dt;
      if (this.switchT > 0.17 && this.switchTo) { this.guns[this.cur].group.visible = false; this.cur = this.switchTo; this.guns[this.cur].group.visible = true; this.switchTo = null; this.cooldown = 0.12; }
      if (this.switchT > 0.4) this.switchT = -1;
    }
    this.lower = damp(this.lower, this.switchT >= 0 && this.switchT < 0.17 ? 1 : 0, 16, dt);

    // 瞄准
    const wantAds = inp.down('Mouse2') && this.reloadT < 0 && !busy && !p.zip.on;
    p.adsZoom = this.def.zoom; p.adsT = damp(p.adsT, wantAds ? 1 : 0, 13, dt);
    if (inp.hit('KeyR')) this.startReload();

    // 换弹
    if (this.reloadT >= 0) {
      const d = this.def.reload; const pr = this.reloadT; this.reloadT += dt; const t = this.reloadT;
      const ev = (at, s) => { if (pr < at * d && t >= at * d) this.game.audio.play(s); };
      ev(0.16, 'reload_out'); ev(0.58, 'reload_in'); ev(0.82, 'bolt');
      if (this.cur === 'shotgun') { ev(0.34, 'reload_in'); ev(0.46, 'reload_in'); }
      if (pr < 0.62 * d && t >= 0.62 * d) { this.ammo[this.cur] = this.def.mag; this._ammoTexDirty = true; }
      if (t >= d) this.reloadT = -1;
    }
    // 近战
    if (inp.hit('KeyF') && this.meleeT < 0 && this.meleeCD <= 0 && !this.game.interactPrompt) this.startMelee();
    if (this.meleeT >= 0) {
      this.meleeT += dt;
      if (!this.meleeHit && this.meleeT > 0.11) { this.meleeHit = true; this.game.meleeAttack(p, 3.0, 110); }
      if (this.meleeT > 0.42) this.meleeT = -1;
    }
    // 手雷
    if (inp.hit('KeyG') && this.grenades >= 1 && !busy) {
      this.grenades -= 1; p.getEye(_v); _v.addScaledVector(p.right, 0.2).addScaledVector(p.look, 0.4);
      _v2.copy(p.look).multiplyScalar(19).addScaledVector(p.vel, 0.6); _v2.y += 3.2;
      this.game.throwGrenade(_v, _v2, p); this.game.audio.play('grenade_throw'); this.rec.vrx += 1.2; this.meleeCD = 0.3;
    }
    // 泵动
    if (this.pumpT >= 0) { const pr = this.pumpT; this.pumpT += dt; if (pr < 0.2 && this.pumpT >= 0.2) this.game.audio.play('bolt', { pitch: 0.8 }); if (this.pumpT > this.def.pump) this.pumpT = -1; }

    // 射击
    const trig = inp.down('Mouse0'), trigHit = inp.hit('Mouse0');
    const canFire = this.reloadT < 0 && !busy && this.cooldown <= 0;
    if (trig) this.fireHold = 0.3; else this.fireHold -= dt;
    if (def.charge) {
      if (trig && canFire && this.ammo.rail > 0) {
        if (!this.charging) { this.charging = true; this.charge = 0; this.game.audio.play('rail_charge'); }
        this.charge += dt / def.charge;
        if (this.charge >= 1) { this.fire(); this.charging = false; this.charge = 0; }
      } else { if (this.charging) this.charging = false; this.charge = Math.max(0, this.charge - dt * 3); if (trigHit && this.ammo.rail <= 0 && this.reloadT < 0) { this.game.audio.play('dry_fire'); this.startReload(); } }
      const k = this.charge; for (let i = 0; i < gun.coils.length; i++) { const on = Math.max(0, Math.min(1, k * gun.coils.length - i)); gun.coils[i].material.color.setRGB(0.05 + on * 1.2, 0.25 + on * 4.5, 0.4 + on * 6.0); }
    } else if ((def.auto ? trig : trigHit) && canFire) {
      if (this.ammo[this.cur] > 0) this.fire(); else { this.game.audio.play('dry_fire'); this.startReload(); this.cooldown = 0.2; }
    }
    this.animate(dt);
  }

  startMelee() { this.meleeT = 0; this.meleeHit = false; this.meleeCD = 0.75; this.reloadT = -1; this.charging = false; this.game.audio.play('melee_swing'); this.game.meleeLunge(this.player); }

  fire() {
    const p = this.player, def = this.def, g = this.game, gun = this.guns[this.cur];
    this.ammo[this.cur]--; this.cooldown = 60 / def.rpm; this.stats.shots++; if (this.cur === 'rifle') this._ammoTexDirty = true;
    const eye = p.eyePos; const ads = p.adsT;
    const moving = Math.min(1, p.speedH / 9) * 0.006 + (p.onGround ? 0 : 0.006);
    const spread = def.spread[0] + (def.spread[1] - def.spread[0]) * ads + this.bloom + (def.pellets > 1 ? 0 : moving * (1 - ads * 0.7));
    gun.muzzle.updateWorldMatrix(true, false); const mz = _v3.setFromMatrixPosition(gun.muzzle.matrixWorld);
    const fwd = p.look, right = p.right; const up = _v2.crossVectors(right, fwd);
    const upx = up.x, upy = up.y, upz = up.z;
    let anyHit = false, anyKill = false, anyHead = false;
    if (def.charge) {
      // 穿透光束
      const res = g.hitscanAll(eye, fwd, def.range, p);
      for (const h of res.hits) { const dmg = h.ent.kind === 'mech' ? def.mechDmg : def.dmg * (h.head ? def.head : 1); const killed = h.ent.takeDamage(dmg, p, { point: h.point, dir: fwd, head: h.head, weapon: 'rail' }); anyHit = true; anyKill = anyKill || killed; anyHead = anyHead || h.head; g.fx.hitFlesh(h.point, fwd, h.ent.robot || h.ent.kind === 'mech'); }
      const end = res.end; g.fx.beam(mz, end, [0.45, 0.9, 1.0], 0.16, 0.5, 9); g.fx.beam(mz, end, [1, 1, 1], 0.05, 0.3, 14);
      const len = mz.distanceTo(end); const n = Math.min(40, Math.floor(len / 1.6));
      for (let i = 1; i < n; i++) { const t = i / n; g.fx.add.spawn({ x: mz.x + (end.x - mz.x) * t, y: mz.y + (end.y - mz.y) * t, z: mz.z + (end.z - mz.z) * t, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, life: 0.5 + Math.random() * 0.5, s0: 0.25, s1: 0.05, r: 0.5, g: 1.4, b: 2.2, a: 0.8, tile: 6 }); }
      if (res.world) { g.fx.sparks(end, res.normal, 16, [0.7, 1.4, 2.0], 9); g.fx.impact(end, res.normal, res.surf, 2.2); g.fx.flashLight(end, [0.4, 0.8, 1], 60, 0.25, 12); }
      g.fx.flashLight(_v.copy(eye).addScaledVector(fwd, 0.8), [0.4, 0.8, 1.0], 70, 0.18, 14);
      g.audio.loop('rail_hold', false);
    } else {
      for (let i = 0; i < def.pellets; i++) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * spread;
        const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
        _v.set(fwd.x + right.x * dx + upx * dy, fwd.y + right.y * dx + upy * dy, fwd.z + right.z * dx + upz * dy).normalize();
        const h = g.hitscan(eye, _v, def.range, p);
        if (!h) { if (i < 3) g.fx.tracer(mz, _v4.copy(eye).addScaledVector(_v, 120), 0xffd9a0); continue; }
        if (h.ent) {
          let dmg = def.dmg; const f = def.fall; if (h.dist > f[0]) dmg *= 1 - (1 - f[2]) * Math.min(1, (h.dist - f[0]) / (f[1] - f[0]));
          if (h.ent.kind === 'mech') dmg *= def.mechMul; else if (h.head) dmg *= def.head;
          const killed = h.ent.takeDamage(dmg, p, { point: h.point, dir: _v, head: h.head, weapon: this.cur });
          anyHit = true; anyKill = anyKill || killed; anyHead = anyHead || h.head;
          g.fx.hitFlesh(h.point, _v, h.ent.robot || h.ent.kind === 'mech');
        } else g.fx.impact(h.point, h.normal, h.surf, def.pellets > 1 ? 0.8 : 1);
        if (def.pellets === 1 || i % 3 === 0) g.fx.tracer(mz, h.point, 0xffd9a0, 340, 0.03);
      }
      g.fx.flashLight(_v.copy(eye).addScaledVector(fwd, 0.7).addScaledVector(right, 0.15), [1.0, 0.72, 0.38], 26 * def.flash, 0.06, 13);
      gun.eject.updateWorldMatrix(true, false); _v.setFromMatrixPosition(gun.eject.matrixWorld);
      if (this.cur === 'rifle') g.fx.shell(_v, _v2.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(fwd, -0.4 + Math.random() * 0.5).add(p.vel).setY(p.vel.y + 1.6 + Math.random()));
      this.flashT = 0.045; this.flash.rotation.z = Math.random() * 6.28; this.flash.scale.setScalar(def.flash * (0.9 + Math.random() * 0.6));
      g.fx.add.spawn({ x: mz.x, y: mz.y, z: mz.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z, life: 0.05, s0: 0.2 * def.flash, s1: 0.3 * def.flash, r: 2.6, g: 1.6, b: 0.7, a: 1, tile: 6 });
      g.fx.alpha.spawn({ x: mz.x + fwd.x * 0.05, y: mz.y + fwd.y * 0.05, z: mz.z + fwd.z * 0.05, vx: p.vel.x + fwd.x * 0.5, vy: p.vel.y + 0.25, vz: p.vel.z + fwd.z * 0.5, life: 0.55, s0: 0.025, s1: 0.2 * def.flash, r: 0.62, g: 0.6, b: 0.58, a: 0.16, tile: 1, drag: 3 });
      if (this.flash.parent !== gun.muzzle) gun.muzzle.add(this.flash);
      if (def.pump) this.pumpT = 0;
    }
    if (anyHit) { this.stats.hits++; g.hud.hitMarker(anyHead, anyKill); g.audio.play(anyKill ? 'kill_confirm' : anyHead ? 'headshot' : 'hit_marker'); }
    // 后坐力
    const rc = def.recoil; const k = 1 - ads * 0.35;
    p.recoilPitch += rc[0] * k; p.pitch += rc[0] * 0.28 * k; p.recoilYaw += (Math.random() - 0.5) * 2 * rc[1] * k;
    this.rec.vz += rc[2] * 38; this.rec.vrx += rc[3] * 34; this.rec.vry += (Math.random() - 0.5) * rc[3] * 20;
    this.bloom = Math.min(def.maxBloom, this.bloom + def.bloom);
    p.shake = Math.min(1, p.shake + (def.pellets > 1 ? 0.35 : def.charge ? 0.55 : 0.07));
    g.audio.play(def.sound);
    g.noise(p.pos, def.charge ? 70 : 50, p);
    if (this.ammo[this.cur] <= 0 && !def.charge) { /* 自动换弹留给下一次扣扳机 */ }
  }

  animate(dt) {
    const p = this.player, def = this.def, gun = this.guns[this.cur], inp = this.input, rec = this.rec;
    // 弹簧后坐
    const K = 190, C = 22;
    rec.vz += (-K * rec.z - C * rec.vz) * dt; rec.z += rec.vz * dt;
    rec.vrx += (-K * rec.rx - C * rec.vrx) * dt; rec.rx += rec.vrx * dt;
    rec.vry += (-K * rec.ry - C * rec.vry) * dt; rec.ry += rec.vry * dt;
    // 鼠标摆动
    this.sw.x = damp(this.sw.x, Math.max(-1, Math.min(1, inp.dx * 0.012)), 9, dt); this.sw.y = damp(this.sw.y, Math.max(-1, Math.min(1, inp.dy * 0.012)), 9, dt);
    const ads = p.adsT;
    const sprintW = (p.sprinting && p.onGround && this.fireHold <= 0 && this.reloadT < 0 && this.meleeT < 0 && ads < 0.1 && !p.sliding) ? 1 : 0;
    this.poseSprint = damp(this.poseSprint, sprintW, 9, dt);
    this.poseAir = damp(this.poseAir, p.onGround ? 0 : Math.max(-1, Math.min(1, p.vel.y * 0.08)), 8, dt);
    const side = p.wr.on ? Math.sign(p.wr.normal.x * p.right.x + p.wr.normal.z * p.right.z) : 0;
    this.poseRoll = damp(this.poseRoll, p.wr.on ? side * 0.32 : p.sliding ? -0.3 : 0, 9, dt);
    this.sway.visible = !(this.cur === 'rail' && ads > 0.72);   // 开镜后由瞄准镜画面接管，隐藏视模
    if (this._ammoDisp) this._ammoDisp.visible = ads < 0.5;   // 开镜时关掉护木上的弹药屏：它正好落在瞄具窗口下沿，发光会干扰瞄准
    const sp = this.poseSprint, hip = def.hip, ad = def.ads;
    let x = hip[0] + (ad[0] - hip[0]) * ads, y = hip[1] + (ad[1] - hip[1]) * ads, z = hip[2] + (ad[2] - hip[2]) * ads;
    let rx = 0, ry = 0, rz = 0;
    // 冲刺姿态
    x += -0.07 * sp; y += -0.035 * sp; z += 0.05 * sp; rx += 0.12 * sp; ry += 0.62 * sp; rz += 0.16 * sp;
    // 行走晃动
    const bobK = (1 - ads * 0.85) * Math.min(1, p.speedH / 7) * (p.onGround && !p.sliding ? 1 : 0.15);
    x += Math.cos(p.bobT) * 0.008 * bobK * (1 + sp); y += Math.abs(Math.sin(p.bobT)) * -0.008 * bobK * (1 + sp * 1.5); rz += Math.cos(p.bobT) * 0.02 * bobK * (1 + sp);
    const t = this.game.time; y += Math.sin(t * 1.4) * 0.0018 * (1 - ads); rx += Math.sin(t * 1.1) * 0.003 * (1 - ads);
    // 惯性
    x -= this.sw.x * 0.012 * (1 - ads * 0.6); y += this.sw.y * 0.010 * (1 - ads * 0.6); ry -= this.sw.x * 0.05; rx -= this.sw.y * 0.04; rz -= this.sw.x * 0.06;
    y -= this.poseAir * 0.02; rx += this.poseAir * 0.05;
    rz += this.poseRoll; x += this.poseRoll * 0.03;
    // 后坐
    z += rec.z; rx += rec.rx; ry += rec.ry; y += rec.rx * 0.02;
    // 切枪下沉
    y -= this.lower * 0.22; rx -= this.lower * 0.7;
    // 蓄力抖动
    if (this.charge > 0) { x += (Math.random() - 0.5) * 0.002 * this.charge; y += (Math.random() - 0.5) * 0.002 * this.charge; z += 0.012 * this.charge; }
    // 换弹
    let magY = 0, magA = 1, handL = 0;
    if (this.reloadT >= 0) {
      const u = this.reloadT / def.reload;
      const tilt = kf(u, [[0, 0], [0.14, 1], [0.7, 1], [0.86, 0.3], [1, 0]]);
      rz += 0.42 * tilt; rx += 0.22 * tilt; y -= 0.035 * tilt; x += 0.02 * tilt; ry += kf(u, [[0.76, 0], [0.84, -0.12], [0.94, 0]]) ; z += kf(u, [[0.78, 0], [0.84, 0.03], [0.94, 0]]);
      magY = kf(u, [[0.12, 0], [0.3, -0.3], [0.42, -0.3], [0.6, 0]]); magA = u > 0.3 && u < 0.42 ? 0 : 1;
      handL = kf(u, [[0, 0], [0.12, 1], [0.64, 1], [0.76, 0]]);
      if (gun.bolt && this.cur !== 'shotgun') gun.bolt.position.z = kf(u, [[0.78, 0], [0.84, 0.035], [0.9, 0]]);
    }
    if (gun.mag) { gun.mag.position.y = magY; gun.mag.visible = magA > 0; }
    if (this.cur === 'shotgun') { const pu = this.pumpT >= 0 ? this.pumpT / def.pump : -1; gun.bolt.position.z = pu >= 0 ? kf(pu, [[0.15, 0], [0.4, 0.07], [0.55, 0.07], [0.85, 0]]) : (this.reloadT >= 0 ? kf(this.reloadT / def.reload, [[0.78, 0], [0.84, 0.07], [0.92, 0]]) : 0); if (pu >= 0) { rx += kf(pu, [[0.1, 0], [0.4, 0.06], [1, 0]]); } }
    // 近战
    if (this.meleeT >= 0) { const u = this.meleeT / 0.42; const s = kf(u, [[0, 0], [0.22, 1], [0.45, 1], [1, 0]]); x -= 0.16 * s; z -= 0.12 * s; y += 0.03 * s; ry += 0.9 * s; rz += 0.5 * s; rx -= 0.2 * s; }
    this.sway.position.set(x, y, z); this.sway.rotation.set(rx, ry, rz, 'YXZ');
    // 左手
    const gl = gun.gripL; let lx = gl.x, ly = gl.y, lz = gl.z;
    if (this.cur === 'shotgun') lz += gun.bolt.position.z;
    if (handL > 0) { lx += -0.02 * handL; ly += (-0.12 + magY * 0.6) * handL; lz += 0.22 * handL; }
    if (p.grapple.state > 0 && p.grapple.state < 3) { lx -= 0.1; ly += 0.05; lz -= 0.12; }
    this.armL.position.set(lx, ly, lz);
    this.flash.visible = this.flashT > 0;
    // 环境光随所在位置变化
    // 太阳有没有照到枪：从视点朝太阳打一条射线（每 4 帧一次），平滑过渡。日照下反射明亮、棱边闪光；阴影里明显变暗变哑
    this._sunTick = (this._sunTick || 0) + 1;
    if (this._sunTick % 4 === 0 && this.game.world) this._sunLit = this.game.world.raycast(p.eyePos, ATMOS.sunDir, 160, false) ? 0 : 1;
    this.sunK = damp(this.sunK === undefined ? 1 : this.sunK, this._sunLit === undefined ? 1 : this._sunLit, 6, dt);
    const sky = this.game.nav ? this.game.nav.skyAt(p.pos.x, p.pos.z) : 1; const ek = this.game.engine.envK === undefined ? 1 : this.game.engine.envK; const ei = ((0.22 + 0.26 * sky) * (1 - this.sunK) + (0.60 + 0.46 * sky) * this.sunK) * (0.25 + 0.75 * ek);
    if (Math.abs(ei - (this._ei || 0)) > 0.01) { this._ei = damp(this._ei || ei, ei, 6, dt); for (const k of ['metal', 'metalBare', 'tanMetal', 'poly', 'tan', 'plate', 'sleeve', 'glove', 'gloveFab', 'dark', 'brass', 'shell', 'rubber']) { this.mats[k].envMapIntensity = this._ei; if (this.matsG[k] !== this.mats[k]) this.matsG[k].envMapIntensity = this._ei; } }
  }
}
