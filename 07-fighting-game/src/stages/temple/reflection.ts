import * as THREE from 'three';

/**
 * 地面平面反射（y = 0）：每帧用镜像相机把场景画到半分辨率的目标上（带 mipmap，粗糙的地方取模糊的层），
 * 地面着色器按世界坐标投影采样，再按积水/湿度遮罩混进去。做法照 three 的 Reflector（斜裁剪面把地面以下的东西裁掉）。
 */
export class PlanarReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly texMatrix = new THREE.Matrix4();
  private mirrorCam = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3(); private look = new THREE.Vector3(); private target = new THREE.Vector3();
  private clip = new THREE.Vector4(); private q = new THREE.Vector4();
  private size = new THREE.Vector2();
  /** 画反射时隐藏的东西（地面自己、雾片之类） */
  hide: THREE.Object3D[] = [];
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scale = 0.5) {
    this.rt = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 0,
    });
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!this.enabled) return;
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(16, Math.floor(this.size.x * this.scale)), h = Math.max(16, Math.floor(this.size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    camera.updateMatrixWorld();
    const camPos = this.v.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.01) return;
    const mc = this.mirrorCam;
    // 镜像位置和朝向
    mc.position.set(camPos.x, -camPos.y, camPos.z);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    this.target.set(this.look.x, -this.look.y, this.look.z);
    mc.up.set(0, 1, 0).applyMatrix4(rot); mc.up.reflect(this.normal);
    mc.lookAt(this.target);
    mc.far = camera.far; mc.near = camera.near;
    mc.updateMatrixWorld();
    mc.projectionMatrix.copy(camera.projectionMatrix);

    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);

    // 斜裁剪面：把 y < 0 的东西裁掉
    this.plane.setFromNormalAndCoplanarPoint(this.normal, new THREE.Vector3(0, 0, 0)).applyMatrix4(mc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = mc.projectionMatrix;
    this.q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    this.q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    this.q.z = -1.0;
    this.q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2.0 / this.clip.dot(this.q));
    pm.elements[2] = this.clip.x; pm.elements[6] = this.clip.y; pm.elements[10] = this.clip.z + 1.0; pm.elements[14] = this.clip.w;

    const vis = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    if (r.autoClear === false) r.clear();
    r.render(scene, mc);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = prevShadow;
    this.hide.forEach((o, i) => (o.visible = vis[i]));
  }

  dispose() { this.rt.dispose(); }
}
