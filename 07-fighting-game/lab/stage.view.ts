// 场景资源查看页：载入一个 GLB，中性灯光下从几个角度看。参数：url=模型地址 az=方位角(度) el=仰角 d=距离倍数 y=注视高度(0..1)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const q = new URLSearchParams(location.search);
const W = window as any;
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('view') as HTMLCanvasElement, antialias: true });
r.setSize(innerWidth, innerHeight);
r.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x505458);
scene.add(new THREE.HemisphereLight(0xdde6ff, 0x302820, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 5, 4); scene.add(sun);
const cam = new THREE.PerspectiveCamera(+(q.get('fov') ?? 30), innerWidth / innerHeight, 0.01, 1000);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
loader.load(q.get('url')!, (g) => {
  const o = g.scene; scene.add(o);
  if (q.get('wire') === '1') o.traverse((m: any) => { if (m.isMesh) m.material.wireframe = true; });
  const b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const R = Math.max(s.x, s.y, s.z) * +(q.get('d') ?? 1.6);
  const az = THREE.MathUtils.degToRad(+(q.get('az') ?? 0)), el = THREE.MathUtils.degToRad(+(q.get('el') ?? 10));
  const look = new THREE.Vector3(c.x + s.x * +(q.get('x') ?? 0), b.min.y + s.y * +(q.get('y') ?? 0.5), c.z);
  cam.position.set(look.x + Math.sin(az) * Math.cos(el) * R, look.y + Math.sin(el) * R, look.z + Math.cos(az) * Math.cos(el) * R);
  cam.lookAt(look);
  r.render(scene, cam);
  W.__stats = { size: s.toArray(), min: b.min.toArray(), max: b.max.toArray() };
  requestAnimationFrame(() => { r.render(scene, cam); W.__ready = true; });
});
