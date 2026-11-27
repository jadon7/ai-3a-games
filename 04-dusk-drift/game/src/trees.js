// 树：近处用减面网格，远处换成交叉公告板；每隔几帧按与镜头的距离重新分配
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { materialColor, vec3, vec4, float } from 'three/tsl';
import { backlit, soft } from './materials.js';

// 逆光时树叶被打透：朝太阳方向看过去，叶片偏黄发亮
const leafGlow = (k) => vec4(vec3(1, 1, 1).add(vec3(1.25, 1.0, 0.35).mul(backlit(3)).mul(k)), 1);
// 把法线改成从树冠中心向外发散：整棵树有体积感（朝阳一侧亮、背阳一侧暗），而不是每片叶子各亮各的
function crownNormals(g, H, keep) {
  const P = g.attributes.position, Nn = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = (P.getY(i) - 0.5 * H) * 0.6, z = P.getZ(i); const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    let nx = Nn.getX(i) * keep + x * (1 - keep), ny = Nn.getY(i) * keep + y * (1 - keep) + 0.12, nz = Nn.getZ(i) * keep + z * (1 - keep); const m = Math.hypot(nx, ny, nz) || 1;
    Nn.setXYZ(i, nx / m, ny / m, nz / m);
  }
  Nn.needsUpdate = true;
}

const MIX = [['fir', 0.42], ['fir_b', 0.28], ['tree_small_02', 0.16], ['jacaranda', 0.14]];

export async function buildTrees(scene, spots, quality, env) {
  let info;
  try { info = await (await fetch('assets/trees/trees.json')).json(); } catch (e) { info = await (await fetch('assets/trees/_trees_info.json')).json(); }
  const loader = new GLTFLoader(), texL = new THREE.TextureLoader(), kinds = {};
  // 给每个位置选树种：离护栏近的地方不放树冠太大的
  const pick = (sp) => {
    let r = sp.kind, acc = 0;
    for (const [id, w] of MIX) { acc += w; if (r <= acc && info[id]) { const scale = id === 'jacaranda' ? sp.s * 0.62 : sp.s; if (info[id].crownRadius * scale < sp.out + 1.5) return [id, scale]; } }
    return info.fir_b ? ['fir_b', sp.s] : [Object.keys(info)[0], sp.s];
  };
  const lists = {}; for (const sp of spots) { const [id, scale] = pick(sp); (lists[id] || (lists[id] = [])).push({ ...sp, scale }); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
  await Promise.all(Object.keys(lists).map(async id => {
    const meta = info[id], list = lists[id], n = list.length;
    const [gltf, cardA, cardB] = await Promise.all([loader.loadAsync('assets/trees/' + meta.file), texL.loadAsync('assets/trees/' + meta.card), texL.loadAsync('assets/trees/' + (meta.cardB || meta.card))]);
    const meshes = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      let mat = o.material; if (mat.map) mat.map.anisotropy = 4;
      if (mat.alphaTest > 0) {       // 叶片：纯漫反射、压暗，避免逆光下发白
        mat = new THREE.MeshLambertNodeMaterial({ map: mat.map, alphaTest: mat.alphaTest, side: THREE.FrontSide, color: new THREE.Color(0.44, 0.50, 0.33) });   // 叶片几何自带正反两面，保持单面
        mat.colorNode = materialColor.mul(leafGlow(1.5)); soft(mat);
        crownNormals(g, meta.cardHeightM, 0.3);
      } else { mat.roughness = 1; mat.metalness = 0; mat.color.multiplyScalar(0.7); }
      const im = new THREE.InstancedMesh(g, mat, n); im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      im.layers.set(4);                                    // 第 4 层：只有主画面看得到（倒影和反射探针改看第 5 层的公告板）
      scene.add(im); meshes.push(im);
    });
    // 交叉公告板
    const cards = [];
    for (const [tex, w, rot] of [[cardA, meta.cardWidthM, 0], [cardB, meta.cardBWidthM || meta.cardWidthM, Math.PI / 2]]) {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const g = new THREE.PlaneGeometry(w, meta.cardHeightM, 4, 5); g.translate(0, meta.cardHeightM / 2, 0); g.rotateY(rot);
      { const ia = g.index.array, n = ia.length, both = new Uint16Array(n * 2); both.set(ia); for (let i = 0; i < n; i += 3) { both[n + i] = ia[i]; both[n + i + 1] = ia[i + 2]; both[n + i + 2] = ia[i + 1]; } g.setIndex(new THREE.BufferAttribute(both, 1)); }   // 正反两面共用同一套法线
      crownNormals(g, meta.cardHeightM, 0);                           // 和近处网格同样的"树冠球面"明暗，切换时不跳变
      const mat = new THREE.MeshLambertNodeMaterial({ map: tex, alphaTest: 0.42, side: THREE.FrontSide });
      mat.colorNode = materialColor.mul(leafGlow(1.2)); soft(mat);
      const im = new THREE.InstancedMesh(g, mat, n); im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      im.layers.set(4);
      scene.add(im); cards.push(im);
    }
    for (const t of list) { q.setFromAxisAngle(up, t.rot); p3.set(t.x, -0.05, -t.y); s3.setScalar(t.scale); t.m = new THREE.Matrix4().compose(p3, q, s3); }
    // 倒影和反射探针里所有的树都用公告板（第 5 层），省掉大量三角形
    for (const c of cards) {
      const all = new THREE.InstancedMesh(c.geometry, c.material, n);
      list.forEach((t, k) => { all.setMatrixAt(k, t.m); col.setScalar(t.tone * 0.9); col.r *= 0.96; col.b *= 0.9; all.setColorAt(k, col); });
      all.instanceColor.needsUpdate = true; all.castShadow = false; all.receiveShadow = false; all.frustumCulled = false; all.layers.set(5); scene.add(all);
    }
    // 阴影全部由公告板来投（每棵树 4 个三角形），放在只给阴影相机看的第 2 层
    for (const c of cards) {
      const sm = new THREE.MeshBasicNodeMaterial({ map: c.material.map, alphaTest: 0.42, side: THREE.DoubleSide });
      const sh = new THREE.InstancedMesh(c.geometry, sm, n); list.forEach((t, k) => sh.setMatrixAt(k, t.m));
      sh.castShadow = true; sh.receiveShadow = false; sh.frustumCulled = false; sh.layers.set(2); scene.add(sh);
    }
    kinds[id] = { meta, list, meshes, cards };
  }));
  const near2 = quality.treeMeshDist * quality.treeMeshDist;
  let tick = 0, lastX = 1e9, lastZ = 1e9;
  const update = (cam, force) => {
    if (!force && (tick++ % 5 !== 0)) return;
    const cx = cam.position.x, cz = cam.position.z;
    if (!force && Math.hypot(cx - lastX, cz - lastZ) < 3) return; lastX = cx; lastZ = cz;
    for (const id in kinds) {
      const k = kinds[id]; let a = 0, b = 0;
      for (const t of k.list) {
        const dx = t.x - cx, dz = -t.y - cz, near = dx * dx + dz * dz < near2;
        col.setScalar(t.tone); col.r *= 0.96; col.b *= 0.9;
        if (near) { for (const im of k.meshes) { im.setMatrixAt(a, t.m); im.instanceColor.setXYZ(a, col.r, col.g, col.b); } a++; }
        else { for (const im of k.cards) { im.setMatrixAt(b, t.m); im.instanceColor.setXYZ(b, col.r * 0.9, col.g * 0.9, col.b * 0.9); } b++; }
      }
      for (const im of k.meshes) { im.count = a; im.visible = a > 0; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
      for (const im of k.cards) { im.count = b; im.visible = b > 0; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
    }
  };
  return { update, kinds, count: spots.length };
}
