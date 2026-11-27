import type { ClipMeta, FighterMeta } from '../anim/rig';
import type { FighterDef, MoveDef, ProjectileDef } from '../combat/types';
import { buildCine, buildMove, type MoveSpec } from './build';

const SPECIALS = ['sp1', 'sp2', 'sp3'];
const NORMALS_AFTER_LIGHT = ['heavy', 'lunge', 'launcher', 'sweep', 'grab'];

const COMMANDS: Record<string, string> = {
  nL: 'light1', fL: 'light1', bL: 'light1', dL: 'sweep',
  nH: 'heavy', fH: 'lunge', bH: 'heavy', dH: 'launcher',
  nS: 'sp1', fS: 'sp2', dS: 'sp3', bS: 'sp1',
  nT: 'grab', nU: 'ult',
  airL: 'air', airH: 'air',
};

function assemble(specs: MoveSpec[], meta: FighterMeta, alias: Record<string, string>): Record<string, MoveDef> {
  const out: Record<string, MoveDef> = {};
  const scale = meta.height / 1.8;
  for (const s of specs) {
    const clip = alias[s.clip] ?? s.clip;
    const cm: ClipMeta | undefined = meta.clips[clip];
    out[s.id] = buildMove(s, cm, scale);
  }
  return out;
}

// ───────────────────────────── 阎烬 · 烬拳 ─────────────────────────────
// 重、慢、疼。重击带霸体，近身压制；远了靠隔空崩拳和冲拳逼近。
export function buildYanjin(meta: FighterMeta, alias: Record<string, string>): FighterDef {
  const specs: MoveSpec[] = [
    { id: 'light1', name: '刺拳', clip: 'light1', total: 22, next: { light1: 'light2' }, hits: [{ f: 6, a: 3, limb: 'LH', dmg: 36, hitstun: 18, blockstun: 11, push: 3.2, react: 'high' }],
      moves: [{ f0: 0, f1: 6, dist: 0.45 }],
      cancels: [{ f0: 7, f1: 19, into: ['light2', ...NORMALS_AFTER_LIGHT, ...SPECIALS], when: 'contact' }, { f0: 12, f1: 22, into: ['light2'], when: 'always' }] },
    { id: 'light2', name: '直拳', clip: 'light2', total: 27, next: { light1: 'light3' }, hits: [{ f: 7, a: 3, limb: 'RH', dmg: 46, hitstun: 20, blockstun: 13, push: 3.8, react: 'mid' }],
      moves: [{ f0: 1, f1: 8, dist: 0.3 }],
      cancels: [{ f0: 8, f1: 22, into: ['light3', ...NORMALS_AFTER_LIGHT, ...SPECIALS], when: 'contact' }, { f0: 14, f1: 27, into: ['light3'], when: 'always' }] },
    { id: 'light3', name: '顶心肘', clip: 'light3', total: 38, hits: [{ f: 11, a: 4, limb: 'RE', dmg: 69, heavy: true, hitstun: 26, blockstun: 17, push: 7.5, react: 'heavy', shake: 0.45, el: 'fire' }],
      moves: [{ f0: 2, f1: 11, dist: 0.85 }],
      cancels: [{ f0: 12, f1: 26, into: [...SPECIALS, 'ult'], when: 'hit' }] },
    { id: 'heavy', name: '崩拳', clip: 'heavy', total: 46, hits: [{ f: 16, a: 4, limb: 'RH', dmg: 109, heavy: true, hitstun: 30, blockstun: 20, push: 9.5, react: 'heavy', shake: 0.6, guardDmg: 30, el: 'fire' }],
      moves: [{ f0: 6, f1: 16, dist: 0.55 }], armor: [5, 17],
      cancels: [{ f0: 17, f1: 30, into: [...SPECIALS, 'ult'], when: 'hit' }] },
    { id: 'lunge', name: '贴山靠', clip: 'lunge', total: 48, hits: [{ f: 15, a: 5, limb: 'BODY', box: [0.0, 0.3, 1.05, 1.65], dmg: 92, heavy: true, knock: 'down', launch: [6.2, 4.4], blockstun: 21, pushBlock: 7, shake: 0.7, guardDmg: 36, el: 'fire' }],
      moves: [{ f0: 3, f1: 15, dist: 1.9 }], armor: [4, 16] },
    { id: 'launcher', name: '冲天炮', clip: 'launcher', total: 43, hits: [{ f: 10, a: 5, limb: 'RH', box: [0.05, 0.3, 1.25, 2.3], dmg: 78, heavy: true, knock: 'launch', launch: [1.1, 11.8], blockstun: 18, shake: 0.55, el: 'fire' }],
      moves: [{ f0: 2, f1: 10, dist: 0.4 }],
      cancels: [{ f0: 26, f1: 43, into: ['light1', 'heavy', 'sp2', 'sp3', 'ult'], when: 'hit' }] },
    { id: 'sweep', name: '扫堂腿', clip: 'sweep', total: 36, hits: [{ f: 10, a: 4, limb: 'RF', box: [0.1, 0.0, 1.45, 0.5], dmg: 56, knock: 'down', launch: [2.2, 3.1], blockstun: 14, level: 'low', react: 'mid' }] },
    { id: 'air', name: '飞踢', clip: 'air', total: 34, air: true, landLag: 6, hits: [{ f: 7, a: 14, limb: 'RF', box: [0.0, -0.1, 1.15, 0.95], dmg: 64, heavy: true, hitstun: 24, blockstun: 16, push: 5, react: 'high', shake: 0.35 }] },
    { id: 'grab', name: '擒拿', clip: 'grab', kind: 'throw', total: 74, moves: [{ f0: 0, f1: 7, dist: 0.45 }],
      hits: [
        { f: 7, a: 3, box: [0.1, 0.5, 1.05, 1.5], dmg: 12, level: 'throw', stop: 6 },
        { f: 26, a: 2, limb: 'RH', dmg: 40, chain: true, react: 'mid', stop: 6 },
        { f: 38, a: 2, limb: 'RH', dmg: 40, chain: true, react: 'mid', stop: 6 },
        { f: 54, a: 2, limb: 'LH', dmg: 70, chain: true, heavy: true, knock: 'down', launch: [6.5, 4.6], shake: 0.6, el: 'fire' },
      ] },
    { id: 'sp1', name: '隔空崩拳', clip: 'sp1', kind: 'special', el: 'fire', total: 52, hits: [], events: [{ f: 18, proj: 'fireblast', fx: 'release' }, { f: 3, fx: 'charge' }],
      cancels: [] },
    { id: 'sp2', name: '燎原冲拳', clip: 'sp2', kind: 'special', el: 'fire', total: 56, armor: [5, 20],
      hits: [
        { f: 11, a: 7, limb: 'BODY', box: [0.0, 0.3, 1.0, 1.6], dmg: 46, hitstun: 22, blockstun: 16, push: 1.2, react: 'mid', el: 'fire', stop: 5 },
        { f: 21, a: 5, limb: 'RH', box: [0.0, 0.4, 1.15, 2.2], dmg: 84, heavy: true, knock: 'launch', launch: [3.4, 9.4], blockstun: 22, pushBlock: 8, shake: 0.7, el: 'fire' },
      ],
      moves: [{ f0: 4, f1: 20, dist: 3.5, ease: 'lin' }], events: [{ f: 4, fx: 'dash' }],
      cancels: [{ f0: 22, f1: 34, into: ['ult'], when: 'hit' }] },
    { id: 'sp3', name: '震地', clip: 'sp3', kind: 'special', el: 'fire', total: 62,
      hits: [{ f: 21, a: 4, box: [0.1, 0.0, 1.5, 1.0], dmg: 60, heavy: true, knock: 'launch', launch: [1.4, 8.6], blockstun: 22, shake: 0.9, el: 'fire', guardDmg: 30 }],
      events: [{ f: 22, proj: 'firepillar', fx: 'slam' }, { f: 4, fx: 'charge' }] },
    { id: 'ult', name: '焚天', clip: 'ult_start', kind: 'ult', el: 'fire', cost: 100, total: 78, invul: [0, 16],
      freeze: { f: 3, frames: 62, upto: 0.85 }, maxRate: 2.6,
      hits: [{ f: 15, a: 6, limb: 'RH', box: [0.0, 0.3, 1.3, 1.9], dmg: 70, heavy: true, cine: true, hitstun: 30, blockstun: 28, pushBlock: 9, shake: 0.8, el: 'fire', stop: 14 }],
      moves: [{ f0: 5, f1: 16, dist: 3.0, ease: 'lin' }] },
  ];
  const moves = assemble(specs, meta, alias);
  const projectiles: Record<string, ProjectileDef> = {
    fireblast: { id: 'fireblast', speed: 10.5, life: 72, y: 1.22, box: [-0.45, -0.42, 0.5, 0.42], el: 'fire',
      hit: { dmg: 82, heavy: true, hitstun: 24, blockstun: 16, push: 6.5, react: 'mid', el: 'fire', shake: 0.45, chip: 12 } },
    firepillar: { id: 'firepillar', speed: 9.5, life: 36, y: 0, ground: true, box: [-0.5, 0, 0.5, 1.7], el: 'fire',
      hit: { dmg: 58, heavy: true, knock: 'launch', launch: [1.0, 8.8], blockstun: 18, el: 'fire', shake: 0.5, chip: 9 } },
  };
  const ultClip = alias.ult_combo ?? 'ult_combo';
  return {
    id: 'yanjin', name: '阎烬', title: '烬拳', el: 'fire', height: meta.height,
    walkF: 1.7, walkB: 1.4, dashF: 2.8, dashB: 2.2, jumpV: 10.2, jumpVx: 4.3, hp: 1090,
    moves, projectiles, commands: COMMANDS, clipAlias: alias, color: 0xff6a1a,
    cine: buildCine(ultClip, meta.clips[ultClip], 410, { speed: 1.2, gap: 0.6, launch: [6.5, 12.5] }),
  };
}

// ───────────────────────────── 凌霜 · 霜刃 ─────────────────────────────
// 快、长、连。刀够得远，出手快，单发伤害低；踏雪能穿到身后。
export function buildLingshuang(meta: FighterMeta, alias: Record<string, string>): FighterDef {
  const specs: MoveSpec[] = [
    { id: 'light1', name: '横斩', clip: 'light1', total: 19, next: { light1: 'light2' }, hits: [{ f: 5, a: 3, limb: 'W', box: [0.1, 0.7, 1.55, 1.5], dmg: 27, hitstun: 17, blockstun: 10, push: 3.0, react: 'side', el: 'frost' }],
      cancels: [{ f0: 6, f1: 17, into: ['light2', ...NORMALS_AFTER_LIGHT, ...SPECIALS], when: 'contact' }, { f0: 10, f1: 19, into: ['light2'], when: 'always' }] },
    { id: 'light2', name: '回挑', clip: 'light2', total: 23, next: { light1: 'light3' }, hits: [{ f: 6, a: 3, limb: 'W', box: [0.1, 0.6, 1.55, 1.9], dmg: 32, hitstun: 19, blockstun: 12, push: 3.2, react: 'high', el: 'frost' }],
      moves: [{ f0: 1, f1: 7, dist: 0.25 }],
      cancels: [{ f0: 7, f1: 19, into: ['light3', ...NORMALS_AFTER_LIGHT, ...SPECIALS], when: 'contact' }, { f0: 12, f1: 23, into: ['light3'], when: 'always' }] },
    { id: 'light3', name: '回旋斩', clip: 'light3', total: 35, hits: [{ f: 10, a: 5, limb: 'W', box: [-0.3, 0.6, 1.75, 1.5], dmg: 52, heavy: true, hitstun: 25, blockstun: 16, push: 7, react: 'side', shake: 0.4, el: 'frost' }],
      moves: [{ f0: 2, f1: 10, dist: 0.55 }],
      cancels: [{ f0: 11, f1: 25, into: [...SPECIALS, 'ult'], when: 'hit' }] },
    { id: 'heavy', name: '力劈', clip: 'heavy', total: 41, hits: [{ f: 14, a: 4, limb: 'W', box: [0.1, 0.2, 1.7, 2.2], dmg: 88, heavy: true, hitstun: 28, blockstun: 18, push: 8.5, react: 'high', shake: 0.55, guardDmg: 26, el: 'frost' }],
      moves: [{ f0: 5, f1: 14, dist: 0.5 }],
      cancels: [{ f0: 15, f1: 28, into: [...SPECIALS, 'ult'], when: 'hit' }] },
    { id: 'lunge', name: '突刺', clip: 'lunge', total: 40, hits: [{ f: 11, a: 5, limb: 'W', box: [0.2, 0.8, 2.15, 1.45], dmg: 74, heavy: true, hitstun: 24, blockstun: 17, push: 6.5, react: 'mid', shake: 0.45, el: 'frost' }],
      moves: [{ f0: 3, f1: 12, dist: 2.1 }],
      cancels: [{ f0: 13, f1: 24, into: ['sp1', 'sp3', 'ult'], when: 'hit' }] },
    { id: 'launcher', name: '上撩', clip: 'launcher', total: 40, hits: [{ f: 9, a: 5, limb: 'W', box: [0.05, 0.2, 1.5, 2.4], dmg: 66, heavy: true, knock: 'launch', launch: [1.0, 11.6], blockstun: 17, shake: 0.5, el: 'frost' }],
      moves: [{ f0: 2, f1: 9, dist: 0.3 }],
      cancels: [{ f0: 24, f1: 40, into: ['light1', 'heavy', 'sp1', 'sp2', 'ult'], when: 'hit' }] },
    { id: 'sweep', name: '扫腿', clip: 'sweep', total: 33, hits: [{ f: 8, a: 4, limb: 'RF', box: [0.1, 0.0, 1.4, 0.5], dmg: 48, knock: 'down', launch: [2.0, 3.0], blockstun: 13, level: 'low', react: 'mid' }] },
    { id: 'air', name: '跃斩', clip: 'air', total: 34, air: true, landLag: 5, hits: [{ f: 7, a: 14, limb: 'W', box: [-0.1, -0.2, 1.5, 1.2], dmg: 56, heavy: true, hitstun: 23, blockstun: 15, push: 4.5, react: 'high', shake: 0.35, el: 'frost' }] },
    { id: 'grab', name: '擒拿', clip: 'grab', kind: 'throw', total: 68, moves: [{ f0: 0, f1: 6, dist: 0.45 }],
      hits: [
        { f: 6, a: 3, box: [0.1, 0.5, 1.05, 1.5], dmg: 12, level: 'throw', stop: 6 },
        { f: 26, a: 2, limb: 'RK', dmg: 46, chain: true, react: 'mid', stop: 7 },
        { f: 46, a: 2, limb: 'RH', dmg: 78, chain: true, heavy: true, knock: 'down', launch: [6.5, 4.4], shake: 0.55, el: 'frost' },
      ] },
    { id: 'sp1', name: '霜月斩', clip: 'sp1', kind: 'special', el: 'frost', total: 46, hits: [], events: [{ f: 15, proj: 'crescent', fx: 'release' }, { f: 2, fx: 'charge' }] },
    { id: 'sp2', name: '踏雪', clip: 'sp2', kind: 'special', el: 'frost', total: 46, invul: [8, 14], ghost: [6, 16],
      hits: [{ f: 10, a: 5, limb: 'W', box: [-3.4, 0.3, 0.9, 1.7], dmg: 86, heavy: true, hitstun: 30, blockstun: 20, push: 0.5, pushBlock: 0.5, react: 'side', shake: 0.6, el: 'frost', stop: 12, tag: 'dashcut' }],
      moves: [{ f0: 8, f1: 13, dist: 4.3, ease: 'lin' }], events: [{ f: 8, fx: 'dash' }, { f: 2, fx: 'charge' }],
      cancels: [{ f0: 15, f1: 30, into: ['ult'], when: 'hit' }] },
    { id: 'sp3', name: '冰棘', clip: 'sp3', kind: 'special', el: 'frost', total: 56,
      hits: [{ f: 18, a: 4, box: [0.1, 0.0, 1.3, 1.0], dmg: 44, heavy: true, knock: 'launch', launch: [0.9, 8.4], blockstun: 20, shake: 0.6, el: 'frost' }],
      events: [{ f: 19, proj: 'icespikes', fx: 'slam' }, { f: 3, fx: 'charge' }] },
    { id: 'ult', name: '霜天', clip: 'ult_start', kind: 'ult', el: 'frost', cost: 100, total: 72, invul: [0, 15],
      freeze: { f: 3, frames: 62, upto: 0.85 }, maxRate: 2.6,
      hits: [{ f: 13, a: 6, limb: 'W', box: [0.0, 0.3, 1.9, 1.9], dmg: 64, heavy: true, cine: true, hitstun: 30, blockstun: 28, pushBlock: 9, shake: 0.8, el: 'frost', stop: 14 }],
      moves: [{ f0: 5, f1: 14, dist: 3.4, ease: 'lin' }] },
  ];
  const moves = assemble(specs, meta, alias);
  const projectiles: Record<string, ProjectileDef> = {
    crescent: { id: 'crescent', speed: 11, life: 66, y: 1.18, box: [-0.35, -0.75, 0.45, 0.75], el: 'frost',
      hit: { dmg: 60, heavy: true, hitstun: 22, blockstun: 15, push: 5.5, react: 'side', el: 'frost', shake: 0.4, chip: 9 } },
    icespikes: { id: 'icespikes', speed: 11, life: 32, y: 0, ground: true, box: [-0.5, 0, 0.5, 1.9], el: 'frost',
      hit: { dmg: 66, heavy: true, knock: 'launch', launch: [0.8, 9.6], blockstun: 18, el: 'frost', shake: 0.5, chip: 9 } },
  };
  const ultClip = alias.ult_combo ?? 'ult_combo';
  return {
    id: 'lingshuang', name: '凌霜', title: '霜刃', el: 'frost', height: meta.height,
    walkF: 2.2, walkB: 1.8, dashF: 3.2, dashB: 2.6, jumpV: 10.8, jumpVx: 4.9, hp: 930,
    moves, projectiles, commands: COMMANDS, clipAlias: alias, color: 0x7fd8ff,
    cine: buildCine(ultClip, meta.clips[ultClip], 375, { speed: 1.2, gap: 0.78, launch: [5.5, 12.0] }),
  };
}

export const FIGHTER_BUILDERS: Record<string, (meta: FighterMeta, alias: Record<string, string>) => FighterDef> = {
  yanjin: buildYanjin, lingshuang: buildLingshuang,
};

export const ROSTER = [
  { id: 'yanjin', name: '阎烬', title: '烬拳', el: 'fire' as const, color: '#ff6a1a', desc: '八极重拳，霸体压制。每一拳都带着未熄的余烬。', stats: { 力: 5, 速: 2, 距: 2, 技: 3 } },
  { id: 'lingshuang', name: '凌霜', title: '霜刃', el: 'frost' as const, color: '#7fd8ff', desc: '唐刀快斩，踏雪无痕。刀锋过处，三尺之内皆成霜。', stats: { 力: 3, 速: 5, 距: 4, 技: 4 } },
];
