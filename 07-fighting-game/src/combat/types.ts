import type { Limb } from '../anim/rig';

/** 一帧的输入。x 是屏幕方向（-1 左、1 右），y 向上为正。 */
export interface Cmd {
  x: number; y: number;
  L: boolean; H: boolean; S: boolean;   // 轻击、重击、技能
  G: boolean; T: boolean; U: boolean;   // 防御、投技、大招
  D: boolean;                            // 冲刺
  /** 电脑对手用：这次按防御不算弹反（不然它的反应式防御次次都是弹反） */
  np?: boolean;
}
export const emptyCmd = (): Cmd => ({ x: 0, y: 0, L: false, H: false, S: false, G: false, T: false, U: false, D: false });
export type Btn = 'L' | 'H' | 'S' | 'G' | 'T' | 'U' | 'D';
export const BTNS: Btn[] = ['L', 'H', 'S', 'G', 'T', 'U', 'D'];

export interface InputSource {
  /** 每个模拟帧调用一次 */
  poll(self: number): Cmd;
}

export type HitLevel = 'mid' | 'low' | 'throw' | 'unblock';
export type Knock = 'none' | 'stagger' | 'launch' | 'down' | 'spin';
export type React = 'high' | 'mid' | 'side' | 'heavy';
export type Element = 'phys' | 'fire' | 'frost';

export interface HitDef {
  /** 生效的第一帧（从 0 数）和持续帧数 */
  f: number; a: number;
  /** 命中盒：相对角色脚底中心，x 朝前，[x0, y0, x1, y1]（米，按身高 1.8 的标准体型写，自动按身高缩放）。不写就按 limb 在这一帧的位置自动算 */
  box?: [number, number, number, number];
  limb?: Limb;
  dmg: number;
  chip?: number;            // 被防住时的磨血
  hitstun?: number;         // 命中硬直（帧）
  blockstun?: number;
  push?: number;            // 命中后把对手推开的初速度（米每秒）
  pushBlock?: number;
  level?: HitLevel;
  knock?: Knock;
  launch?: [number, number];// 击飞的初速度 [水平, 竖直]
  react?: React;
  stop?: number;            // 顿帧
  shake?: number;           // 镜头震动 0..1
  heavy?: boolean;          // 重击：火花更大、音效更沉
  el?: Element;
  guardDmg?: number;
  meter?: number;
  /** 投技的后续段：只有前一段打中了才生效 */
  chain?: boolean;
  /** 命中后进入大招演出 */
  cine?: boolean;
  /** 自定义标签，表现层按它挑特效 */
  tag?: string;
}

export interface MoveEvent { f: number; fx?: string; sfx?: string; proj?: string; flag?: 'superFreeze' | 'armorOn' | 'armorOff' }

export interface MoveDef {
  id: string;
  name: string;             // 招式的中文名，出招表和大招字幕用
  clip: string;
  total: number;            // 整招的帧数
  hits: HitDef[];
  /** 帧 → 动作时间（秒）的分段映射，由构建函数按动作时间表生成 */
  warp: [number, number][];
  /** 位移：在 [f0, f1) 这几帧里向前移动 dist 米（缓出） */
  moves?: { f0: number; f1: number; dist: number; ease?: 'out' | 'lin' | 'in' }[];
  /** 可以取消接别的招的窗口 */
  cancels?: { f0: number; f1: number; into: string[]; when: 'hit' | 'contact' | 'always' }[];
  /** 连段：在这一招的取消窗口里再按出 键 对应的招时，改出 值 那一招（轻击连按 = 轻一、轻二、轻三） */
  next?: Record<string, string>;
  events?: MoveEvent[];
  air?: boolean;            // 空中招
  invul?: [number, number]; // 无敌帧
  armor?: [number, number]; // 霸体帧（挨打不中断，照样掉血）
  ghost?: [number, number]; // 这几帧不和对手互相推挤（穿身而过的突进）
  cost?: number;            // 耗气
  kind: 'normal' | 'special' | 'throw' | 'ult';
  el?: Element;
  /** 这招在空中结束后落地的硬直 */
  landLag?: number;
  fade?: number;            // 动作淡入时间（秒）
  /** 大招定格：定格多少帧，定格期间动作从哪演到哪（秒） */
  freezeFrames?: number;
  freezeSpan?: [number, number];
}

export interface ProjectileDef {
  id: string;
  speed: number;
  life: number;             // 帧
  box: [number, number, number, number];
  y: number;                // 出手高度（米）
  hit: Omit<HitDef, 'f' | 'a'>;
  el: Element;
  ground?: boolean;         // 贴地前进（地火、冰棘）
  hits?: number;            // 能打几下
  hitGap?: number;
}

export interface CinePlan {
  /** 攻击方播的动作 */
  clip: string;
  /** 演出总帧数 */
  total: number;
  /** 每一下：帧、伤害、受击反应 */
  beats: { f: number; dmg: number; react: React; limb?: Limb; heavy?: boolean; final?: boolean }[];
  warp: [number, number][];
  /** 最后一击把对手打飞的速度 */
  launch: [number, number];
  /** 两人演出时的间距（米） */
  gap: number;
}

export interface FighterDef {
  id: string;
  name: string;
  title: string;
  el: Element;
  height: number;
  walkF: number; walkB: number;       // 行走速度（米每秒）
  dashF: number; dashB: number;       // 冲刺距离（米）
  jumpV: number; jumpVx: number;
  hp: number;
  moves: Record<string, MoveDef>;
  projectiles: Record<string, ProjectileDef>;
  cine?: CinePlan;
  /** 输入 → 招式。键是“方向+按钮”，方向 n 中立、f 前、b 后、d 下；空中前面加 air。 */
  commands: Record<string, string>;
  /** 动作名的替换表（替身角色用现成动作顶替） */
  clipAlias?: Record<string, string>;
  color: number;
}

export type FState =
  | 'intro' | 'stand' | 'dash' | 'prejump' | 'air' | 'land' | 'attack' | 'block' | 'blockstun' | 'parried'
  | 'hitstun' | 'grabbed' | 'launched' | 'down' | 'getup' | 'dizzy' | 'cine' | 'cineVictim' | 'ko' | 'win' | 'lose';

/** 模拟发给表现层的事件 */
export type FightEvent =
  | { type: 'hit'; att: number; def: number; hit: HitDef; move: string; x: number; y: number; blocked: boolean; parry: boolean; combo: number; dmg: number; counter: boolean; proj?: boolean; kill: boolean; air: boolean }
  | { type: 'whiff'; who: number; move: string; heavy: boolean }
  | { type: 'moveStart'; who: number; move: string }
  | { type: 'moveEvent'; who: number; move: string; ev: MoveEvent }
  | { type: 'projSpawn'; who: number; id: number; def: string }
  | { type: 'projEnd'; id: number; x: number; y: number; hit: boolean }
  | { type: 'jump'; who: number } | { type: 'land'; who: number; hard: boolean }
  | { type: 'dash'; who: number; dir: number }
  | { type: 'step'; who: number }
  | { type: 'bounce'; who: number; x: number } | { type: 'getup'; who: number }
  | { type: 'guardBreak'; who: number }
  | { type: 'superFreeze'; who: number; move: string }
  | { type: 'cineStart'; who: number } | { type: 'cineBeat'; who: number; beat: number; final: boolean } | { type: 'cineEnd'; who: number }
  | { type: 'ko'; who: number; by: number }
  | { type: 'round'; phase: 'intro' | 'fight' | 'ko' | 'timeup' | 'win' | 'matchEnd'; round: number; winner?: number };
