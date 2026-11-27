// 界面要用的数据：角色资料、出招表、按键说明。全部从游戏的定义里读，不写死。
import type { FighterDef } from '../combat/types';
import { KEYS_P1, KEYS_P2, KEYS_SOLO, type KeyMap } from '../core/input';
import { ROSTER } from '../data/fighters';
import { keyLabel, ASSET } from './dom';

export type RosterEntry = (typeof ROSTER)[number];
export const roster = ROSTER;
export const rosterOf = (id: string): RosterEntry => ROSTER.find((r) => r.id === id) ?? ROSTER[0];

export const art = {
  portrait: (id: string) => ASSET(`${id}-portrait.webp`),
  face: (id: string) => ASSET(`${id}-face.webp`),
  super: (id: string) => ASSET(`${id}-super.webp`),
};

/** 特写图里角色朝哪边（1 朝右、-1 朝左）。界面上要朝对手看，方向不对就镜像 */
const ART_FACING: Record<string, { portrait: number; super: number }> = { yanjin: { portrait: 1, super: 1 }, lingshuang: { portrait: -1, super: -1 } };
export const needFlip = (id: string, kind: 'portrait' | 'super', want: number) => (ART_FACING[id]?.[kind] ?? 1) !== want;

/** 大招名：没载入定义前先用资料里的写法 */
const ULT_FALLBACK: Record<string, string> = { yanjin: '焚天', lingshuang: '霜天' };
export function ultName(id: string, def?: FighterDef | null): string {
  if (def) for (const m of Object.values(def.moves)) if (m.kind === 'ult') return m.name;
  return ULT_FALLBACK[id] ?? '绝技';
}

export const ROUND_NAME = ['', '第一回合', '第二回合', '决胜回合', '第四回合', '第五回合'];
export const roundName = (r: number, final: boolean) => (final ? '决胜回合' : ROUND_NAME[r] ?? `第 ${r} 回合`);

export const LEVELS = [
  { lv: 1, name: '初窥', desc: '出手慢，常露破绽' },
  { lv: 2, name: '登堂', desc: '会防会连，偶有失误' },
  { lv: 3, name: '宗师', desc: '弹反、确反、大招不手软' },
];

const k = (codes: string[], n = 1) => codes.slice(0, n).map(keyLabel).join(' / ');
export function keysFor(map: KeyMap) {
  return {
    move: `${k(map.up)}${k(map.left)}${k(map.down)}${k(map.right)}`,
    up: k(map.up), down: k(map.down), left: k(map.left), right: k(map.right),
    L: k(map.L), H: k(map.H), S: k(map.S), G: k(map.G, 2), T: k(map.T), U: k(map.U), D: k(map.D),
  };
}
export const KEYSETS = { solo: KEYS_SOLO, p1: KEYS_P1, p2: KEYS_P2 };

export interface MoveRow { input: string; name: string; tag?: string }

/** 出招表：从角色定义的 commands 里读。dirs 用屏幕朝右时的箭头表示。 */
export function moveList(def: FighterDef, map: KeyMap): { specials: MoveRow[]; normals: MoveRow[]; system: MoveRow[] } {
  const ks = keysFor(map);
  const btn = (b: string) => (ks as any)[b] as string;
  const dir: Record<string, string> = { n: '', f: '→ ', b: '← ', d: '↓ ' };
  const seen = new Set<string>();
  const specials: MoveRow[] = [], normals: MoveRow[] = [];
  const entries = Object.entries(def.commands).sort(([a], [b]) => order(a) - order(b));
  for (const [cmd, id] of entries) {
    const mv = def.moves[id]; if (!mv || seen.has(id)) continue;
    seen.add(id);
    const air = cmd.startsWith('air');
    const d = air ? '' : cmd[0], b = air ? cmd.slice(3) : cmd.slice(1);
    const input = (air ? '空中 ' : dir[d] ?? '') + btn(b);
    const row: MoveRow = { input, name: mv.name };
    if (mv.kind === 'ult') { row.tag = '满气'; specials.push(row); }
    else if (mv.kind === 'special') specials.push(row);
    else if (id === 'light1' && def.moves.light2) { row.input = `${btn('L')} ${btn('L')} ${btn('L')}`; row.name = [def.moves.light1, def.moves.light2, def.moves.light3].filter(Boolean).map((m) => m!.name).join(' · '); normals.push(row); }
    else normals.push(row);
  }
  const system: MoveRow[] = [
    { input: `${ks.left} / ${ks.right}`, name: '移动' },
    { input: ks.up, name: '跳跃' },
    { input: `${ks.D} 或 双击方向`, name: '冲刺 / 后撤' },
    { input: ks.G, name: '防御（挨打瞬间按下为弹反）' },
  ];
  return { specials, normals, system };
}
function order(cmd: string) {
  const b = cmd.startsWith('air') ? cmd.slice(3) : cmd.slice(1);
  const d = cmd.startsWith('air') ? 'z' : cmd[0];
  return 'LHSTU'.indexOf(b) * 10 + 'nfbdz'.indexOf(d);
}
