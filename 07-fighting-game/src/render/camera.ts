import * as THREE from 'three';
import { STAGE_HALF } from '../core/config';
import { clamp, damp, easeInOutCubic, lerp, smoothstep, spring } from '../core/math';

export interface Shot {
  /** 镜头位置和注视点（世界坐标） */
  pos: THREE.Vector3; look: THREE.Vector3; fov: number;
  /** 这一镜持续多久；into 是从上一镜过渡过来用多久（0 = 硬切） */
  dur: number; into?: number;
  /** 这一镜期间镜头缓慢推进 / 环绕的量 */
  push?: number; orbit?: number;
  dof?: number;
}

/**
 * 对战镜头：侧面取景，跟着两人的中点走，按间距推拉；带震动、冲击时的瞬间推近。
 * 大招、出场、终结时切到脚本镜头（Shot 列表），演完再平滑回到对战镜头。
 */
export class FightCamera {
  private pos = new THREE.Vector3(0, 1.5, 9);
  private look = new THREE.Vector3(0, 1.1, 0);
  private fov = 32;
  private trauma = 0;
  private punch = 0;          // 冲击推近
  private t = 0;
  private shots: Shot[] = []; private shotT = 0; private shotIdx = -1;
  private from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 32 };
  private blendBack = 1;      // 0 = 完全是脚本镜头，1 = 完全是对战镜头
  private gPos = new THREE.Vector3(); private gLook = new THREE.Vector3();
  /** 额外的整体偏移（比如终结时慢慢推近），外面可以直接改 */
  zoomBias = 0;
  /** 导播感：镜头绕注视点的偏转（弧度），被重击“甩”一下再弹回来；drama 是整体强度（观战模式调大） */
  private yaw = 0; private yawV = 0; private pitch = 0; private pitchV = 0;
  drama = 1;
  /** 甩镜头：yaw 正数是镜头往右绕，pitch 正数是镜头压低仰拍 */
  kick(yaw: number, pitch = 0) { this.yawV += yaw * 14 * this.drama; this.pitchV += pitch * 14 * this.drama; }
  dofFocus = 0;

  constructor(readonly cam: THREE.PerspectiveCamera) {}

  get inShot() { return this.shotIdx >= 0; }

  shake(k: number) { this.trauma = Math.min(1, Math.max(this.trauma, k)); }
  addShake(k: number) { this.trauma = Math.min(1, this.trauma + k); }
  hitPunch(k: number) { this.punch = Math.max(this.punch, k); }

  play(shots: Shot[]) {
    this.shots = shots; this.shotIdx = 0; this.shotT = 0;
    this.from.pos.copy(this.pos); this.from.look.copy(this.look); this.from.fov = this.fov;
    this.blendBack = 0;
  }
  stop() { this.shotIdx = -1; this.shots = []; }

  /** ax/bx：两人的位置；ay/by：高度（跳起来镜头要跟着抬一点） */
  update(dt: number, ax: number, ay: number, bx: number, by: number) {
    this.t += dt;
    const cam = this.cam;
    const mid = (ax + bx) / 2, dist = Math.abs(ax - bx), top = Math.max(ay, by);
    const tan = Math.tan(THREE.MathUtils.degToRad(32 / 2));
    const aspect = cam.aspect;
    // 两人加左右各 1.5 米的余量要装得下；最近不小于 6.1 米
    const need = (dist / 2 + 1.55) / (tan * aspect);
    // 有人被打上天：镜头拉远一点、抬高一点，别让人飞出画面
    const air = smoothstep(0.25, 1.6, top);
    // 有人被打上天：镜头拉远到“地面到他头顶”都装得下，注视点抬到画面下沿刚好贴着地面
    const dAir = air > 0 ? (top + 2.15) / (2 * tan) : 0;
    // 推近（击倒瞬间的 zoomBias）只作用在平地取景上；有人在天上时不能比 dAir 更近，否则击倒那一下人会飞出画面上沿
    const d = clamp(Math.max(Math.max(6.1, need) + this.zoomBias, dAir), 4.2, 12.5);
    const halfW = d * tan * aspect, halfH = d * tan;
    const maxX = Math.max(0, STAGE_HALF + 1.7 - halfW);
    const gx = clamp(mid, -maxX, maxX);
    const lookY = lerp(1.02, Math.max(1.02, halfH - 0.3), air);
    this.gPos.set(gx, lookY + 0.3 + (d - 6.1) * 0.06, d);
    this.gLook.set(gx, lookY, 0);

    if (this.shotIdx >= 0) {
      const s = this.shots[this.shotIdx];
      this.shotT += dt;
      const into = s.into ?? 0;
      const k = into > 0 ? easeInOutCubic(Math.min(1, this.shotT / into)) : 1;
      const life = Math.min(1, this.shotT / s.dur);
      const p = _a.copy(s.pos), l = _b.copy(s.look);
      if (s.push) { _c.subVectors(l, p).normalize(); p.addScaledVector(_c, s.push * life); }
      if (s.orbit) { _c.subVectors(p, l); _c.applyAxisAngle(UP, s.orbit * life); p.copy(l).add(_c); }
      this.pos.lerpVectors(this.from.pos, p, k);
      this.look.lerpVectors(this.from.look, l, k);
      this.fov = lerp(this.from.fov, s.fov, k);
      this.dofFocus = s.dof ?? 0;
      if (this.shotT >= s.dur) {
        this.from.pos.copy(this.pos); this.from.look.copy(this.look); this.from.fov = this.fov;
        this.shotIdx++; this.shotT = 0;
        if (this.shotIdx >= this.shots.length) { this.shotIdx = -1; this.blendBack = 0; this.dofFocus = 0; }
      }
    } else {
      if (this.blendBack < 1) {
        this.blendBack = Math.min(1, this.blendBack + dt / 0.55);
        const k = easeInOutCubic(this.blendBack);
        this.pos.lerpVectors(this.from.pos, this.gPos, k);
        this.look.lerpVectors(this.from.look, this.gLook, k);
        this.fov = lerp(this.from.fov, 32, k);
      } else {
        this.pos.x = damp(this.pos.x, this.gPos.x, 5.5, dt);
        this.pos.y = damp(this.pos.y, this.gPos.y, this.gPos.y > this.pos.y ? 11 : 3.0, dt);
        this.pos.z = damp(this.pos.z, this.gPos.z, this.gPos.z > this.pos.z ? 10 : 2.4, dt);
        this.look.x = damp(this.look.x, this.gLook.x, 6.5, dt);
        this.look.y = damp(this.look.y, this.gLook.y, this.gLook.y > this.look.y ? 12 : 3.2, dt);
        this.look.z = 0;
        this.fov = damp(this.fov, 32, 6, dt);
      }
    }

    // 导播感：极缓的呼吸式漂移 + 被“甩”之后的回弹。只在对战镜头下生效，脚本镜头不动
    [this.yaw, this.yawV] = spring(this.yaw, this.yawV, 0, 1.1, 0.55, dt);
    [this.pitch, this.pitchV] = spring(this.pitch, this.pitchV, 0, 1.3, 0.6, dt);
    let offX = 0, offY = 0, offZ = 0;
    if (this.shotIdx < 0 && this.blendBack >= 1) {
      const yawAll = clamp(this.yaw + Math.sin(this.t * 0.21) * 0.018 * this.drama, -0.22, 0.22);
      const pit = clamp(this.pitch + Math.sin(this.t * 0.16 + 1.3) * 0.006 * this.drama, -0.12, 0.16);
      const dz = this.pos.z - this.look.z;
      offX = Math.sin(yawAll) * dz; offZ = (Math.cos(yawAll) - 1) * dz; offY = -pit * dz;
    }
    // 震动：位置和角度都抖，强度按 trauma 的平方
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.punch = damp(this.punch, 0, 9, dt);
    const s = this.trauma * this.trauma;
    const n = (seed: number) => Math.sin(this.t * 47.3 + seed * 12.9) * 0.6 + Math.sin(this.t * 83.7 + seed * 4.1) * 0.4;
    cam.position.set(this.pos.x + offX + n(1) * s * 0.16, Math.max(0.25, this.pos.y + offY) + n(2) * s * 0.13, this.pos.z + offZ + n(3) * s * 0.05);
    _c.subVectors(this.look, cam.position).normalize();
    cam.position.addScaledVector(_c, this.punch * 0.9);
    cam.fov = this.fov - this.punch * 1.6;
    cam.updateProjectionMatrix();
    cam.lookAt(this.look.x + n(4) * s * 0.07, this.look.y + n(5) * s * 0.06, this.look.z);
    cam.rotateZ(n(6) * s * 0.022);
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
