import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export type Limb = 'LH' | 'RH' | 'LE' | 'RE' | 'LF' | 'RF' | 'LK' | 'RK' | 'BODY' | 'HEAD' | 'W';

export interface ClipMeta {
  loop?: boolean;
  dur?: number;
  hits?: { t: number; limb: Limb }[];
  recover?: number;
  release?: number;
  hold?: [number, number];
  takeoff?: number;
  land?: number;
  stride?: number;
  // 通用动作
  impact?: number;
  ground?: number;
  airborne?: [number, number];
  travel?: number;
}

export interface FighterMeta {
  id: string;
  height: number;
  weapon?: { bone: string; base: [number, number, number]; tip: [number, number, number] } | null;
  clips: Record<string, ClipMeta>;
}

export interface RigAsset {
  id: string;
  scene: THREE.Object3D;
  clips: Record<string, THREE.AnimationClip>;
  meta: FighterMeta;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export function loadGLTF(url: string) {
  return loader.loadAsync(url);
}

const BONE_KEYS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
export type BoneKey = (typeof BONE_KEYS)[number];

const LIMB_BONE: Record<Exclude<Limb, 'W'>, BoneKey> = {
  LH: 'LeftHand', RH: 'RightHand', LE: 'LeftForeArm', RE: 'RightForeArm',
  LF: 'LeftFoot', RF: 'RightFoot', LK: 'LeftLeg', RK: 'RightLeg', BODY: 'Spine2', HEAD: 'Head',
};

/** 只保留旋转轨道和胯的位移轨道：别的位移、缩放轨道在这套骨架上都是常量，留着只会干扰混合。 */
function cleanClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  clip.tracks = clip.tracks.filter((t) => {
    if (t.name.endsWith('.scale')) return false;
    if (t.name.endsWith('.position')) return /Hips\.position$/.test(t.name);
    return true;
  });
  clip.resetDuration();
  return clip;
}

/** 载入一个角色：主 GLB（网格 + 骨架 + 专属动作），外加若干“只有骨架 + 动画”的 GLB（通用动作）。 */
export async function loadRigAsset(id: string, glbUrl: string, meta: FighterMeta, extraClipUrls: string[] = []): Promise<RigAsset> {
  const gltf = await loadGLTF(glbUrl);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const c of gltf.animations) clips[c.name] = cleanClip(c);
  for (const url of extraClipUrls) {
    try {
      const g = await loadGLTF(url);
      for (const c of g.animations) clips[c.name] = cleanClip(c);
    } catch (e) { console.warn('通用动作没载入', url, e); }
  }
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const s = mat as THREE.MeshStandardMaterial;
        if (s.map) s.map.anisotropy = 8;
        s.envMapIntensity = 1.0;
      }
    }
  });
  return { id, scene: gltf.scene, clips, meta };
}

/**
 * 一个上场的角色实例。层级：root（世界位置）→ face（左右朝向，镜像）→ orient（把模型的 +Z 转到 +X，并缩放到身高）→ 模型。
 * 角色“本地坐标”指 face 里面的坐标：x 朝前、y 朝上、单位米。
 */
export class Rig {
  readonly root = new THREE.Group();
  readonly face = new THREE.Group();
  readonly orient = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly bones = {} as Record<BoneKey, THREE.Bone>;
  readonly allBones: THREE.Bone[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly height: number;
  weaponBone: THREE.Bone | null = null;
  readonly weaponBase = new THREE.Vector3();
  readonly weaponTip = new THREE.Vector3();
  /** 静止姿势下各骨骼的局部旋转，程序化动作叠加时用 */
  readonly rest = new Map<THREE.Bone, THREE.Quaternion>();

  constructor(readonly asset: RigAsset) {
    this.model = SkeletonUtils.clone(asset.scene);
    this.height = asset.meta.height;
    this.orient.rotation.y = Math.PI / 2;
    this.orient.scale.setScalar(this.height);
    this.orient.add(this.model);
    this.face.add(this.orient);
    this.root.add(this.face);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const b = o as THREE.Bone;
        this.allBones.push(b);
        this.rest.set(b, b.quaternion.clone());
        const key = b.name.replace(/^mixamorig[:_]?/, '') as BoneKey;
        if ((BONE_KEYS as readonly string[]).includes(key)) this.bones[key] = b;
      }
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        // 克隆出来的实例各自一份材质：受击闪白、冰冻这类效果要按角色单独改
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        this.meshes.push(m);
      }
    });
    const w = asset.meta.weapon;
    if (w) {
      const name = w.bone.replace(/[:.]/g, '');
      this.weaponBone = this.allBones.find((b) => b.name === name || b.name === w.bone) ?? this.bones.RightHand ?? null;
      this.weaponBase.fromArray(w.base); this.weaponTip.fromArray(w.tip);
    }
  }

  setFacing(dir: 1 | -1) { this.face.scale.x = dir; }

  /** 肢体末端的世界坐标。W 是武器尖。 */
  limbWorld(limb: Limb, out: THREE.Vector3): THREE.Vector3 {
    if (limb === 'W') {
      if (this.weaponBone) return out.copy(this.weaponTip).applyMatrix4(this.weaponBone.matrixWorld);
      limb = 'RH';
    }
    const b = this.bones[LIMB_BONE[limb as Exclude<Limb, 'W'>]];
    return b ? out.setFromMatrixPosition(b.matrixWorld) : out.setFromMatrixPosition(this.root.matrixWorld);
  }
  weaponWorld(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    if (!this.weaponBone) return false;
    base.copy(this.weaponBase).applyMatrix4(this.weaponBone.matrixWorld);
    tip.copy(this.weaponTip).applyMatrix4(this.weaponBone.matrixWorld);
    return true;
  }
  boneWorld(key: BoneKey, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones[key];
    return b ? out.setFromMatrixPosition(b.matrixWorld) : out.setFromMatrixPosition(this.root.matrixWorld);
  }

  /** 世界坐标 → 角色本地坐标（x 朝前、y 朝上，米）。 */
  toLocal(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return this.face.worldToLocal(out.copy(world));
  }

  /** 材质上的统一调节（受击闪白等）。 */
  eachMaterial(fn: (m: THREE.MeshStandardMaterial) => void) {
    for (const mesh of this.meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) fn(m as THREE.MeshStandardMaterial);
    }
  }
}
