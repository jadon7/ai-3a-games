// 演示/比对模式：按影片逐帧的机位数据摆相机和持枪手臂，用来和离线渲染的影片同机位对比。
import * as THREE from 'three';
import { C_B2T, C_T2B, matFromRows, b2t } from './config.js';
import { L } from './world.js';

export class Demo {
  async load() {
    this.t = await (await fetch('./assets/demo_track.json')).json();
    this.n = this.t.frames.length;
    return this;
  }
  // 影片帧号 f（1 起），可带小数（线性插值）
  camMatrix(f, out = new THREE.Matrix4()) { return this._m(f, 'c', out, false); }
  vmMatrix(f, out = new THREE.Matrix4()) { return this._m(f, 'v', out, true); }
  _m(f, key, out, conj) {
    const i0 = Math.max(0, Math.min(this.n - 1, Math.floor(f) - 1)), i1 = Math.min(this.n - 1, i0 + 1), a = Math.max(0, Math.min(1, f - Math.floor(f)));
    const A = matFromRows(this.t.frames[i0][key], new THREE.Matrix4()), B = matFromRows(this.t.frames[i1][key], new THREE.Matrix4());
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
    A.decompose(pa, qa, sa); B.decompose(pb, qb, sb);
    pa.lerp(pb, a); qa.slerp(qb, a);
    out.compose(pa, qa, sa).premultiply(C_B2T);
    if (conj) out.multiply(C_T2B);
    return out;
  }
  slide(f) { const i = Math.max(0, Math.min(this.n - 1, Math.round(f) - 1)); return this.t.frames[i].s; }
  enemyRoot(f, out = new THREE.Matrix4()) {
    const i = Math.max(0, Math.min(this.n - 1, Math.round(f) - 1));
    return matFromRows(this.t.enemy_root[i], out).premultiply(C_B2T).multiply(C_T2B);
  }
  applyCamera(f, camera) {
    const m = this.camMatrix(f);
    m.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);
  }
  // 枪灯跟着持枪手臂（VM 局部 +Y 是枪口方向，换到 three 局部就是 -Z）
  applyWeaponLight(f) {
    const vm = this.vmMatrix(f);
    const lp = this.t.light_local;
    L.uWLPos.value.copy(b2t(lp[0], lp[1], lp[2])).applyMatrix4(vm);
    L.uWLDir.value.set(0, 0, -1).transformDirection(vm);
  }
}
