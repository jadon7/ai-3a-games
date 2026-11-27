import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Stage, StageContext } from './types';

/** 占位场景：正式场景做好之前用，也是正式场景载入失败时的后备。夜色石板地、冷暖两路光。 */
export async function createPlaceholderStage(ctx: StageContext): Promise<Stage> {
  const root = new THREE.Group();
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  ctx.scene.background = new THREE.Color(0x05070b);
  ctx.scene.fog = new THREE.FogExp2(0x070a10, 0.028);
  ctx.scene.environment = env;
  ctx.scene.environmentIntensity = 0.22;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.62, metalness: 0.0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  root.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(90, 26), new THREE.MeshBasicMaterial({ color: 0x0a0e16 }));
  back.position.set(0, 10, -22);
  root.add(back);
  for (let i = 0; i < 9; i++) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.8 }));
    pillar.position.set(-16 + i * 4, 3.5, -6.5); pillar.castShadow = true; pillar.receiveShadow = true;
    root.add(pillar);
  }

  const key = new THREE.DirectionalLight(0xbcd0ff, 2.3);
  key.position.set(-5, 10, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 8; sc.bottom = -3; sc.near = 1; sc.far = 30;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
  root.add(key, key.target);
  const warm = new THREE.DirectionalLight(0xff8a4a, 1.5);
  warm.position.set(8, 4, -6);
  root.add(warm);
  const cool = new THREE.DirectionalLight(0x5aa0ff, 1.1);
  cool.position.set(-9, 5, -7);
  root.add(cool);
  root.add(new THREE.HemisphereLight(0x4a5a78, 0x1a1410, 0.5));

  ctx.scene.add(root);
  const baseEnv = 0.22, baseKey = key.intensity, baseWarm = warm.intensity, baseCool = cool.intensity;
  return {
    root, env,
    update() {},
    setDim(k: number) {
      const m = 1 - 0.8 * k;
      ctx.scene.environmentIntensity = baseEnv * m; key.intensity = baseKey * m; warm.intensity = baseWarm * m; cool.intensity = baseCool * m;
      floorMat.color.setHex(0x23262b).multiplyScalar(m);
    },
    dispose() { ctx.scene.remove(root); env.dispose(); },
  };
}
