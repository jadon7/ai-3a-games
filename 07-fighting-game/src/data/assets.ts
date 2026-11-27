import * as THREE from 'three';
import { loadRigAsset, type ClipMeta, type FighterMeta, type RigAsset } from '../anim/rig';
import { Animator } from '../anim/animator';
import { Rig } from '../anim/rig';
import type { FighterDef } from '../combat/types';
import { piecewise } from '../core/math';
import { DEBUG } from '../core/config';
import { buildAlias, metaFromMoba } from './build';
import { FIGHTER_BUILDERS } from './fighters';

const BASE = '/assets/fighters';
const STANDIN: Record<string, string> = { yanjin: 'gorran', lingshuang: 'iti' };
const HEIGHT: Record<string, number> = { yanjin: 1.92, lingshuang: 1.74 };

export interface LoadedFighter { id: string; asset: RigAsset; def: FighterDef; standin: boolean }

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch { return false; }
}
async function json<T = any>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

const cache = new Map<string, Promise<LoadedFighter>>();

/** 载入一个角色。正式成品还没做好（或者缺文件）时用替身顶上；成品里缺的动作用替补表顶上。 */
export function loadFighter(id: string): Promise<LoadedFighter> {
  let p = cache.get(id);
  if (!p) { p = doLoad(id); cache.set(id, p); }
  return p;
}

async function doLoad(id: string): Promise<LoadedFighter> {
  const v = `?v=${Date.now()}`;
  const realGlb = `${BASE}/${id}/${id}.glb`;
  let meta = await json<FighterMeta>(`${BASE}/${id}/${id}.json${v}`);
  const forceStandin = DEBUG.has('standin') && (DEBUG.get('standin') === '' || DEBUG.get('standin') === id);   // ?standin 全用替身；?standin=yanjin 只换一个
  const real = !!meta && !forceStandin && (await exists(realGlb));
  let asset: RigAsset;
  if (real && meta) {
    meta.height = meta.height || HEIGHT[id];
    const extra: string[] = [];
    const gj = await json<{ clips: Record<string, ClipMeta> }>(`${BASE}/${id}/${id}_generic.json${v}`);
    if (gj && (await exists(`${BASE}/${id}/${id}_generic.glb`))) { extra.push(`${BASE}/${id}/${id}_generic.glb${v}`); Object.assign(meta.clips, gj.clips); }
    // 带物理骨骼（马尾）的版本做好了就用它
    const physGlb = `${BASE}/${id}/${id}_phys.glb`;
    const usePhys = !DEBUG.has('nophys') && (await exists(physGlb));
    asset = await loadRigAsset(id, (usePhys ? physGlb : realGlb) + v, meta, extra);
  } else {
    const s = STANDIN[id];
    const mj = await json(`${BASE}/_standin/${s}.json`);
    const extra: string[] = [];
    const gj = await json<{ clips: Record<string, ClipMeta> }>(`${BASE}/_standin/${s}_generic.json${v}`);
    if (gj && (await exists(`${BASE}/_standin/${s}_generic.glb`))) extra.push(`${BASE}/_standin/${s}_generic.glb${v}`);
    meta = { id, height: HEIGHT[id], clips: {} };
    asset = await loadRigAsset(id, `${BASE}/_standin/${s}.glb`, meta, extra);
    const durs: Record<string, number> = {};
    for (const [n, c] of Object.entries(asset.clips)) durs[n] = c.duration;
    const m2 = metaFromMoba(id, mj ?? {}, durs, HEIGHT[id]);
    if (gj) Object.assign(m2.clips, gj.clips);
    meta.clips = m2.clips;
  }
  if (!asset.clips.idle && asset.clips.idle_pose) asset.clips.idle = asset.clips.idle_pose;
  // 时间表里没写时长的，用动作本身的时长补上；成品里没有的动作从时间表里去掉
  for (const [n, c] of Object.entries(asset.clips)) { meta.clips[n] = meta.clips[n] ?? {}; meta.clips[n].dur = meta.clips[n].dur ?? c.duration; }
  for (const n of Object.keys(meta.clips)) if (!asset.clips[n]) delete meta.clips[n];
  meta.clips.idle = { ...meta.clips.idle, loop: true };
  flattenAirClips(asset, ['jump', 'air']);
  const alias = buildAlias(new Set(Object.keys(asset.clips)));
  const def = FIGHTER_BUILDERS[id](meta, alias);
  return { id, asset, def, standin: !real };
}

const _v = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
/**
 * 没手写命中盒的招，按动作里出手那一帧肢体（或刀）实际伸到哪来定命中盒。
 * 这样判定范围永远和画面上看到的一致，不用一招一招量。
 */
export function resolveAutoBoxes(def: FighterDef, rig: Rig, animator: Animator) {
  const savedX = rig.root.position.x, savedF = rig.face.scale.x;
  rig.root.position.set(0, 0, 0); rig.setFacing(1);
  for (const m of Object.values(def.moves)) {
    for (const h of m.hits) {
      if (h.box || !h.limb) continue;
      const t = piecewise(m.warp, h.f + 1);
      if (!animator.pose(m.clip, t)) { h.box = [0, 0.6 * def.height / 1.8, 0.9, 1.5 * def.height / 1.8]; continue; }
      rig.root.updateMatrixWorld(true);
      let x1: number, y0: number, y1: number;
      if (h.limb === 'W' && rig.weaponWorld(_b, _t)) {
        rig.toLocal(_b, _b); rig.toLocal(_t, _t);
        x1 = Math.max(_b.x, _t.x) + 0.14; y0 = Math.min(_b.y, _t.y) - 0.22; y1 = Math.max(_b.y, _t.y) + 0.22;
      } else {
        rig.toLocal(rig.limbWorld(h.limb, _v), _v);
        x1 = _v.x + 0.36; y0 = _v.y - 0.36; y1 = _v.y + 0.36;   // 骨骼点在手腕、脚踝，拳头和脚尖还要往外一截，再给一点宽容度
      }
      h.box = [0, Math.max(0, y0), Math.max(0.95 * def.height / 1.8, x1), Math.max(y1, y0 + 0.5)];
    }
  }
  rig.root.position.x = savedX; rig.face.scale.x = savedF;
}

/**
 * 跳跃类动作里角色是真的跳起来的（胯的高度在变），但游戏里高度由模拟来管。
 * 这里把“双脚离地的那部分高度”从胯的位移里减掉：逐个关键帧摆出姿势，量最低的脚比站立时高出多少，就把胯降多少。
 * 处理完的动作里角色始终“脚贴地”，只剩收腿、展身这些姿态变化。
 */
function flattenAirClips(asset: RigAsset, names: string[]) {
  const todo = names.filter((n) => asset.clips[n] && !(asset.clips[n] as any)._flat);
  if (!todo.length) return;
  const rig = new Rig(asset);
  const animator = new Animator(rig.model, asset.clips);
  const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'] as const;
  const v = new THREE.Vector3();
  const low = () => { rig.root.updateMatrixWorld(true); let m = Infinity; for (const k of feet) if (rig.bones[k]) m = Math.min(m, rig.boneWorld(k, v).y); return m; };
  for (const name of todo) {
    const clip = asset.clips[name];
    const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
    if (!track) continue;
    animator.pose(name, 0); const base = low();
    const times = track.times, vals = track.values;
    const offs: number[] = [];
    for (let i = 0; i < times.length; i++) { animator.pose(name, times[i]); offs.push(Math.max(0, low() - base)); }
    // 世界高度 → 胯的局部位移单位（模型被整体缩放到身高）
    for (let i = 0; i < times.length; i++) vals[i * 3 + 1] -= offs[i] / rig.height;
    (clip as any)._flat = true;
    (clip as any)._peak = Math.max(...offs);
  }
}
