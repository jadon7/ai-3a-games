import type { ClipMeta, FighterMeta } from '../anim/rig';
import type { CinePlan, HitDef, MoveDef, MoveEvent } from '../combat/types';

export interface HitSpec extends Omit<HitDef, 'f' | 'a'> { f: number; a?: number }
export interface MoveSpec extends Omit<MoveDef, 'hits' | 'warp' | 'kind'> {
  kind?: MoveDef['kind'];
  hits: HitSpec[];
  /** 动作里每一下打到的时刻（秒）。不写就用时间表里的 */
  tHits?: number[];
  tStart?: number; tEnd?: number;
  /** 前摇最多快放到几倍；再短就从动作中间起播 */
  maxRate?: number;
  /** 大招定格：定格发生在第几帧、多少帧、定格里演到动作的几分之几（相对第一下的时刻） */
  freeze?: { f: number; frames: number; upto: number };
}

const F = 60;

/**
 * 把“帧数表”（玩法定的）和“动作时间表”（动作实际的节奏）对上。
 * 每一下命中的那一帧对动作里打到的那一刻，中间分段线性；前摇太长就砍掉动作开头。
 */
export function buildMove(spec: MoveSpec, meta: ClipMeta | undefined, scale: number): MoveDef {
  const hits: HitDef[] = spec.hits.map((h) => ({ ...h, a: h.a ?? 3, box: h.box ? (h.box.map((v) => v * scale) as [number, number, number, number]) : undefined }));
  const dur = meta?.dur ?? 1.2;
  const metaHits = meta?.hits?.map((h) => h.t) ?? (meta?.release !== undefined ? [meta.release] : []);
  // 投技：时间表里通常只记了后面几下击打，没记“抓住”的那一刻，往前补一个
  if (spec.kind === 'throw' && metaHits.length === hits.length - 1 && metaHits.length > 0) metaHits.unshift(Math.max(0.08, metaHits[0] - 0.42));
  const anchorHits = hits.filter((h) => !h.chain || true);
  const th: number[] = [];
  for (let i = 0; i < anchorHits.length; i++) {
    let t = spec.tHits?.[i] ?? metaHits[i];
    if (t === undefined) {
      // 时间表里的段数比帧数表少：后面的按帧距往后排
      const prevT = th[i - 1] ?? metaHits[metaHits.length - 1] ?? dur * 0.35;
      const prevF = anchorHits[i - 1]?.f ?? 0;
      t = i === 0 ? dur * 0.35 : prevT + (anchorHits[i].f - prevF) / F;
    }
    th.push(Math.min(t, dur - 0.02));
  }
  const maxRate = spec.maxRate ?? 2.3;
  const warp: [number, number][] = [];
  let events: MoveEvent[] | undefined = spec.events ? [...spec.events] : undefined;
  let freezeSpan: [number, number] | undefined; let freezeFrames: number | undefined;

  if (anchorHits.length === 0) {
    // 没有命中段的招（纯位移、纯放道具）：用 release 或整段匀速
    const rel = meta?.release ?? meta?.hits?.[0]?.t, ev = spec.events?.find((e) => e.proj);
    const tEnd = spec.tEnd ?? meta?.recover ?? dur;
    if (rel !== undefined && ev) {
      const t0 = spec.tStart ?? Math.max(0, rel - (ev.f / F) * maxRate);
      warp.push([0, t0], [ev.f, rel], [spec.total, Math.min(tEnd, rel + ((spec.total - ev.f) / F) * 2.5)]);
    } else warp.push([0, spec.tStart ?? 0], [spec.total, tEnd]);
  } else {
    const f0 = anchorHits[0].f + 1;
    let t0 = spec.tStart ?? Math.max(0, th[0] - (f0 / F) * maxRate);
    if (spec.freeze) {
      // 定格前演到 tA，定格里从 tA 演到 tB，定格后剩下的帧里从 tB 冲到命中
      const tB = Math.max(0, th[0] - ((f0 - spec.freeze.f) / F) * maxRate);
      const tA = Math.min(tB, Math.max(0, tB * (1 - spec.freeze.upto)));
      warp.push([0, Math.max(0, tA - (spec.freeze.f / F))], [spec.freeze.f, tA], [spec.freeze.f + 0.001, tB]);
      freezeSpan = [tA, tB]; freezeFrames = spec.freeze.frames;
      events = [...(events ?? []), { f: spec.freeze.f, flag: 'superFreeze' }];
    } else warp.push([0, t0]);
    let lastF = warp[warp.length - 1][0], lastT = warp[warp.length - 1][1];
    for (let i = 0; i < anchorHits.length; i++) {
      const f = anchorHits[i].f + 1;
      const t = Math.max(th[i], lastT + 0.001);
      if (f > lastF) { warp.push([f, t]); lastF = f; lastT = t; }
    }
    const rawEnd = spec.tEnd ?? meta?.recover ?? dur;
    const tEnd = Math.max(lastT + 0.02, Math.min(rawEnd, lastT + ((spec.total - lastF) / F) * 2.6));
    if (spec.total > lastF) warp.push([spec.total, tEnd]);
  }

  const { tHits, tStart, tEnd, maxRate: _m, freeze, ...rest } = spec;
  return { ...rest, kind: spec.kind ?? 'normal', hits, warp, events, freezeSpan, freezeFrames };
}

/** 大招演出：攻击方照动作原速（可整体变速）演一遍，时间表里的每一下就是一拍。 */
export function buildCine(clip: string, meta: ClipMeta | undefined, totalDmg: number, opts: { speed?: number; gap?: number; launch?: [number, number] } = {}): CinePlan {
  const speed = opts.speed ?? 1.15;
  const dur = meta?.dur ?? 3.2;
  let ts = meta?.hits?.map((h) => ({ t: h.t, limb: h.limb })) ?? [];
  if (ts.length < 2) { ts = [0.2, 0.35, 0.5, 0.62, 0.75, 0.9].map((k) => ({ t: dur * k * 0.8, limb: 'RH' as const })); }
  const tEnd = Math.min(meta?.recover ?? dur, ts[ts.length - 1].t + 1.2);
  const n = ts.length;
  const finalDmg = Math.round(totalDmg * 0.42);
  const each = Math.round((totalDmg - finalDmg) / Math.max(1, n - 1));
  const reacts = ['high', 'mid', 'side', 'mid', 'high', 'heavy'] as const;
  const beats = ts.map((h, i) => ({ f: Math.max(2, Math.round((h.t / speed) * F)), dmg: i === n - 1 ? finalDmg : each, react: reacts[i % reacts.length], limb: h.limb, heavy: i >= n - 2, final: i === n - 1 }));
  const total = Math.round((tEnd / speed) * F);
  return { clip, total, beats, warp: [[0, 0], [total, tEnd]], launch: opts.launch ?? [7.5, 9.5], gap: opts.gap ?? 0.62 };
}

/** 动作不全时的替补表：成品里缺哪段，就用排在后面的顶上。 */
const FALLBACK: Record<string, string[]> = {
  walk_f: ['run', 'idle'], walk_b: ['walk_f', 'run', 'idle'], jump: [], block: [],
  light1: ['attack1', 'heavy'], light2: ['attack2', 'light1', 'attack1'], light3: ['light2', 'light1', 'q', 'attack1'],
  heavy: ['q', 'light2', 'light1', 'attack1'], lunge: ['e', 'heavy', 'light2', 'light1', 'attack1'], launcher: ['r', 'heavy', 'light1', 'attack1'],
  sweep: ['light1', 'attack1'], air: ['light1', 'heavy', 'attack1'], grab: ['light1', 'attack1'],
  sp1: ['w', 'heavy', 'light2', 'attack1'], sp2: ['e', 'lunge', 'heavy', 'attack1'], sp3: ['r', 'heavy', 'attack1'],
  ult_start: ['sp2', 'q', 'heavy', 'attack1'], ult_combo: ['r', 'q3', 'sp2', 'attack1'], win: [], intro: [],
};

export function buildAlias(have: Set<string>): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const [want, subs] of Object.entries(FALLBACK)) {
    if (have.has(want)) continue;
    const s = subs.find((x) => have.has(x));
    if (s) alias[want] = s;
  }
  return alias;
}

/** MOBA 英雄的时间表（attacks / skills）转成这边的格式，替身角色用。 */
export function metaFromMoba(id: string, j: any, clipDur: Record<string, number>, height: number): FighterMeta {
  const clips: Record<string, ClipMeta> = {};
  for (const [name, dur] of Object.entries(clipDur)) clips[name] = { dur, loop: name === 'idle' || name === 'run' };
  for (const a of j.attacks ?? []) clips[a.clip] = { ...clips[a.clip], hits: [{ t: a.hit, limb: a.hands?.[0] === 'L' ? 'LH' : 'RH' }], recover: a.end };
  for (const [, s] of Object.entries<any>(j.skills ?? {})) {
    const hs = s.hits ? s.hits.map((t: number) => ({ t, limb: 'RH' })) : [{ t: s.release, limb: 'RH' }];
    clips[s.clip] = { ...clips[s.clip], hits: hs, release: s.release, recover: s.end };
  }
  if (clips.run) clips.run.stride = 1.6;
  return { id, height, clips };
}
