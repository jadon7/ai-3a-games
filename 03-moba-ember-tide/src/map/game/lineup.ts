// 一局的两队（第九轮，5v5）。地图的两边是“队伍”：0 是左下（绿，玩家这一队），1 是右上（红）。英雄的阵营只管造型和特效颜色，和在哪一队无关。
// 规矩照 LoL 的匹配模式：每队五个人、五个位置各一个；一队之内英雄不重复，两队之间可以撞（能不撞就先不撞，好看一点）。
// 选人界面（lobby.ts）排好两队以后写进网址（a=…&b=…，按 POS 的顺序），主程序（main.ts）照着生成英雄和电脑；网址里没有（测试脚本直接带 ?h= 进来）就按同样的规矩现排一次，
// 不带 seed 的时候每次排出来一样（测试要稳定），带 seed=数字 就换一种排法。

import { fountainSpots, toLane, toWorld } from "../layout";
import { ORDER, POS, canPick, infoOf, isPos, posOf, type Pos } from "./heroes";

export interface Slot { id: string; pos: Pos; }
/** 两队，每队按 POS 的顺序五个人；me 是玩家在 0 队里的位置 */
export interface Lineup { teams: [Slot[], Slot[]]; me: Pos; }

/** 这个位置的英雄被占完了，换一个英雄来打的时候先挑哪种职业（打野要能单挑和抓人，辅助要能扛或者能保人……） */
const FLEX: Record<Pos, string[]> = { top: ["斗士", "坦克", "刺客"], jungle: ["刺客", "斗士", "坦克"], mid: ["法师", "刺客", "射手"], adc: ["射手", "法师"], sup: ["辅助", "坦克", "法师"] };

/** 给一队补齐：fixed 是已经定了的位置（玩家自己）；avoid 是对面已经用的英雄（能不撞就不撞） */
function fill(fixed: Partial<Record<Pos, string>>, avoid: Set<string>, rnd: () => number): Slot[] {
  const got: Partial<Record<Pos, string>> = { ...fixed }, used = new Set(Object.values(got) as string[]);
  const choose = (list: string[]) => { const fresh = list.filter(id => !avoid.has(id)), l = fresh.length ? fresh : list; return l[Math.floor(rnd() * l.length) % Math.max(1, l.length)]; };
  // 第一遍：主位置就是这个位置的英雄；第二遍：主位置的英雄都上场了的位置，从剩下的里面按职业挑
  for (const p of POS) { if (got[p]) continue; const l = ORDER.filter(id => !used.has(id) && posOf(id) === p); if (l.length) { got[p] = choose(l); used.add(got[p]!); } }
  for (const p of POS) { if (got[p]) continue; const l = ORDER.filter(id => !used.has(id)), rank = (id: string) => { const i = FLEX[p].indexOf(infoOf(id)?.role ?? ""); return i < 0 ? 9 : i; };
    const best = Math.min(...l.map(rank)); got[p] = choose(l.filter(id => rank(id) === best)) ?? ORDER[0]; used.add(got[p]!); }
  return POS.map(p => ({ id: got[p]!, pos: p }));
}
/** 排两队。me：玩家选的英雄；pos：玩家的位置（空的是“随便”：按英雄的主位置） */
export function makeLineup(me: string, pos: Pos | "", rnd: () => number = Math.random): Lineup {
  const id = canPick(me) ? me : ORDER[0], p = pos || posOf(id), a = fill({ [p]: id }, new Set(), rnd), b = fill({}, new Set(a.map(s => s.id)), rnd);
  return { teams: [a, b], me: p };
}
/** 写进网址的样子：a=上,野,中,射,辅&b=… */
export const lineupQuery = (l: Lineup): Record<string, string> => ({ pos: l.me, a: l.teams[0].map(s => s.id).join(","), b: l.teams[1].map(s => s.id).join(",") });
/** 从网址里读两队：a、b 不全或者不对（重复、没有技能代码、玩家不在自己说的位置上）就按规矩重排 */
export function readLineup(p: URLSearchParams, me: string): Lineup {
  const legacy: Record<string, Pos> = { mid: "mid", top: "top", bot: "adc" }, pp = p.get("pos") ?? "", pos: Pos | "" = isPos(pp) ? pp : legacy[p.get("lane") ?? ""] ?? "";      // lane=mid|top|bot 是三对三时候的参数，照旧认
  const seed = p.has("seed") ? Number(p.get("seed")) || 1 : 0, rnd = seed ? mulberry(seed) : () => 0;
  const team = (k: string) => { const l = (p.get(k) ?? "").split(",").filter(Boolean); return l.length === 5 && l.every(canPick) && new Set(l).size === 5 ? l : null; };
  const a = team("a"), b = team("b"), want = pos || posOf(me);
  if (a && b && a[POS.indexOf(want)] === me) return { teams: [a.map((id, i) => ({ id, pos: POS[i] })), b.map((id, i) => ({ id, pos: POS[i] }))], me: want };
  return makeLineup(me, pos, rnd);
}
/** 按一个数排出来的“随机数”：同一个数每次排出一样的两队（选人界面一次选人里换位置、换英雄，队友不跟着乱跳） */
export const seeded = (seed: number) => mulberry(seed);
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** 出生点上第 i 个位置（按 POS 的顺序）站在哪：五个人在出生点朝地图中间的那一侧排成一段弧，复活也回到这一格 */
export function spawnAt(team: 0 | 1, i: number): [number, number] {
  const f = fountainSpots().find(s => s.team === team)!, [u, v] = toLane(f.x, f.z), sg = team === 0 ? 1 : -1, a = (i - 2) * 0.42, R = 5.2;      // 半径 4.2 时鹿（奥森）和两边的人挤在一起，放到 5.2：相邻两格隔 2.2 米，两头离墙还有一点余地
  return toWorld(u + sg * R * Math.cos(a), v + R * Math.sin(a));      // 上单站在靠上路的一头（两队的上路是同一条线，在 v 负的一侧），辅助站在靠下路的一头
}
