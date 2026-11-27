// 对局规则（阶段 4）：小兵、防御塔、水晶、血量、金钱和经验、死亡复活、视野、胜负。
// 这里只有规则和数值，不碰画面：每一帧把发生的事记进 events，画面那边（view.ts）读走去播动作、出特效。
//
// 规矩按王者荣耀的简化版：
//   · 三条线，每 26 秒两边各出一波兵（两个近战一个远程，三分钟后加一个近战），沿兵线走到对方水晶。
//   · 每条线的塔要从外往里一座一座拆；拆掉任意一条线的高地塔，水晶才打得动。
//   · 塔和水晶先打小兵，身边没有小兵才打英雄，而且越打越疼。
//   · 补到最后一刀才有金币；附近死的小兵都给经验。
//   · 我方单位周围一圈是看得见的，其余地方的对方小兵看不见。

import { A_CORNER, CORE_D, FOUNTAIN_D, GATES, bossSpots, campSpots, coreSpots, fountainSpots, sample, sideLaneW, toWorld, towerSpots } from "../layout";
import type { Nav } from "./nav";
import type { ItemHooks } from "./items_fx";

export type Kind = "hero" | "melee" | "ranged" | "tower" | "core" | "dummy" | "monster";
/** 队伍：0 我方（绿，左下），1 对方（红，右上），2 中立（野怪和 Boss：不主动打人，小兵和塔也不理它们） */
export type Team = 0 | 1 | 2;
/** 英雄的属性。等级、装备、增益都算进去以后的结果放在 HeroData.stat 里 */
export interface Stats { hp: number; mana: number; ad: number; ap: number; armor: number; mr: number; ms: number; as: number; range: number; cdr: number; ls: number; hpRegen: number; manaRegen: number; }
/** 对属性的一份修改（一件装备、一个增益）。数值是直接加上去的；msMul、asMul 是乘上去的；dmgTaken 是受到的伤害乘几 */
export type Mod = Partial<Stats> & { msMul?: number; asMul?: number; adMul?: number; apMul?: number; dmgTaken?: number };
export interface HeroData {
  kit: string; level: number; xp: number; gold: number; cs: number; kills: number; deaths: number; assists: number; respawnIn: number; mana: number; dmg: number;      // dmg：对英雄造成的伤害合计（结算用）
  hitBy: Map<number, number>;                                  // 最近被哪些英雄打过（单位 id → 时间）：算击杀归谁、谁有助攻
  base: Stats; stat: Stats; items: string[]; itemMods: Mod[]; mods: Map<string, { m: Mod; left: number; end?: () => void }>;      // base：一级时的属性；stat：现在的；mods：有时限的增益
  quest?: { ch: number; t: number; got: number };      // 第九轮 balance：辅助位的任务收入（见 RULES.sup）：还剩几层、离回一层还差几秒、一共拿了多少
  spree?: number; dead?: number;      // 第九轮 balance：连杀（上次阵亡以后拿了几个人头）、连死（上次拿人头或助攻以后死了几次），算赏金用
  pos: string; camps: number;      // 第九轮（5v5）：这一局打什么位置（top jungle mid adc sup，见 heroes/index.ts；测试场、单人是空的）；清掉了几个野怪营地（战况统计用）
}
export type DmgType = "phys" | "magic" | "true";
export interface DmgOpts { big?: boolean; type?: DmgType; skill?: boolean; }
export interface Ent {
  id: number; kind: Kind; team: Team; x: number; z: number; r: number;
  hp: number; max: number; alive: boolean; seen: boolean; seen1: boolean;      // seen：我方现在看不看得见；seen1：对方看不看得见（电脑对手只打它看得见的）
  ad: number; range: number; cd: number; period: number; sight: number;  // 攻击力、射程、离下一次出手还有几秒、出手间隔、视野半径
  target: Ent | null; hurtAt: number; deadAt: number; yaw: number;
  // 小兵
  lane: number; s: number; off: number; state: "walk" | "attack" | "idle" | "heavy" | "roar"; swing: number; struck: boolean; think: number;
  // 塔和水晶
  tier: number; open: boolean; streak: number; big: boolean;
  // 阶段 5：护甲和魔抗；状态（数字是还剩几秒）；护盾；被击退或拉拽时的速度；隐身和不可选中；英雄的数据
  armor: number; mr: number; stun: number; root: number; silence: number; slow: number; slowK: number; taunt: number; tauntBy: Ent | null;
  shield: number; shieldT: number; fly: number; fvx: number; fvz: number; invis: boolean; untarget: boolean; h: HeroData | null;
  vuln: number; vulnT: number;                                                                                      // 易伤：受到的伤害多几成、还剩几秒
  // 阶段 6：野怪和 Boss。mob 是哪一种（MOBS 里的名字）；camp 属于哪个营地；hx、hz、hyaw 是它守的位置和朝向；
  // fight 还剩几秒脱战（挨打时续上，归零就回去）；heavyCd 离下一次重击还有几秒；hvx、hvz、hvr 是这次重击砸在哪、多大；raged 咆哮过没有
  mob: string; camp: number; hx: number; hz: number; hyaw: number; fight: number; heavyCd: number; hvx: number; hvz: number; hvr: number; raged: boolean;
  route: [number, number][] | null; stall: number; lx: number; lz: number;
  skip: Ent | null; skipT: number; stuckT: number;      // stuckT：连着多少秒没挪动（兜底用）      // 第九轮：追不过去的目标（被兵堆、墙挡着，连着两次绕路都没挪动）：这几秒内不再选它      // 小兵被墙角或塔座卡住时临时绕路用：route 是寻路给的拐点；stall、lx、lz 用来量这半秒走了多远                             // open：现在打得动；streak：连着打同一个英雄的次数；big：超级兵
}
export interface Shot { id: number; x: number; y: number; z: number; to: Ent; from: Ent; dmg: number; speed: number; kind: "tower" | "ranged"; alive: boolean; }
export type SimEvent =
  | { t: "hit"; e: Ent; dmg: number; src: Ent | null; big?: boolean; type?: DmgType; skill?: boolean; block?: boolean } | { t: "heal"; e: Ent; n: number } | { t: "die"; e: Ent; by: Ent | null } | { t: "spawn"; e: Ent }
  | { t: "shot"; s: Shot } | { t: "gold"; n: number; e: Ent } | { t: "level"; n: number; e?: Ent } | { t: "end"; win: boolean } | { t: "respawn"; e?: Ent }
  // 阶段 6：warn 重击的预警圈（sec 秒后落下）；slam 重击落下；roar Boss 咆哮；kill 英雄被击杀（by 可能是空的：被小兵、塔、野怪打死而且没有英雄参与）；
  // camp 营地刷出来了；boss 一只 Boss 被 team 那一队打掉；buff 一个英雄拿到增益
  | { t: "warn"; x: number; z: number; r: number; sec: number; src: Ent } | { t: "slam"; x: number; z: number; r: number; src: Ent } | { t: "roar"; e: Ent }
  | { t: "kill"; e: Ent; by: Ent | null; assists: Ent[] } | { t: "camp"; camp: Camp } | { t: "boss"; mob: string; team: Team; by: Ent | null } | { t: "buff"; e: Ent; id: string }
  // 阶段 8：cast 一个英雄放出了一个技能（只给音效用）
  | { t: "cast"; e: Ent; key: string };

export const RULES = {
  wave: { first: 5, every: 30, grow: 240 },
  hero: { hp: 3400, ad: 168, regen: 0.006, sight: 15, perLevel: 0.085 },
  melee: { hp: 1000, ad: 105, range: 0.9, period: 1.15, wind: 0.4, speed: 3.5, sight: 9, r: 0.55, gold: 38, xp: 58 },
  ranged: { hp: 600, ad: 150, range: 7.5, period: 1.45, wind: 0.5, speed: 3.5, sight: 10, r: 0.5, gold: 30, xp: 48 },
  // 第九轮：塔的射程 9.5 → 11.5、水晶 10 → 14（视野跟着放大）。射程按“塔心到目标的边”算（目标的半径算进去，英雄 0.6），英雄普攻按“英雄心到塔的边”算（塔半径 1.9、水晶 4.4 算进去）。
  // 原来远程英雄（射程 8.5）离塔心 10.4 米就点得到塔，塔要 10.1 米以内才打得到英雄：站在 10.2 米白拆塔。现在塔能打到 12.1 米、水晶 14.6 米，比任何英雄普攻够到它的距离（塔 10.4、水晶 12.9）远 1.7 米以上
  // 第九轮（5v5）：塔 4200 / 4800 / 5600 → 4700 / 5400 / 6300，水晶 7000 → 8000。一队五个人推线比三个人快，照三对三的血量试下来最短一局 14 分半（一个打野带一波兵就把水晶拆了），守的一方人还没聚齐塔就倒了；
  // 加两成试过一局困难的打了 31 分钟，太长，取一成多
  tower: { hp: [0, 4700, 5400, 6300], ad: 340, adHero: 330, range: 11.5, period: 1.0, sight: 13.5, r: 1.9, gold: 160, xp: 180 },
  // 阶段 6：塔的血从 5200 / 6000 / 6800 降到 4200 / 4800 / 5600，水晶 8000 → 7000。有了守塔的英雄以后，电脑互打一局要二十多分钟，太长
  super: { hp: 3, ad: 2, r: 0.75, gold: 60, xp: 80 },      // 超级兵：对方那条线的高地塔倒了以后，我方那条线每波多出一个；血和攻击是近战兵的几倍
  core: { hp: 8000, ad: 320, adHero: 380, range: 14, period: 0.9, sight: 15, r: 4.4 },
  aggro: 8.5, leash: 11, shotSpeed: 24, fountainR: 7.5, respawn: [7, 1.6, 600, 0.04],      // 复活时间 = 7 秒 + 每级 1.6 秒；开局十分钟以后每过一秒再加 0.04 秒（二十分钟时多 24 秒），后期一波团战能定胜负
  startGold: 450,                                      // 第九轮（5v5）：开局带 450 金币（够买一件三四百的配件），装备有了合成以后开局两手空空，五分钟时不少电脑身上还是空的（装备任务提的）
  goldPerSec: 2, xpRange: 15, level: (n: number) => 80 + 55 * n,      // 阶段 6 加快了升级：三个人分三条线，一条线的经验要够一个人在四分钟左右到 6 级
  xpShare: [1, 1, 0.65, 0.5, 0.42, 0.36],              // 第九轮（5v5）：一个小兵死了，附近有几个对面的英雄就按这一格分经验（照 LoL：两个人各拿六成五，合起来比一个人多三成）。原来是每人都拿整份，下路两个人和单人线升级一样快
  kill: { gold: 300, assist: 130, window: 10 },        // 击杀和助攻的金币；最近多少秒内打过他才算参与
  // 第九轮 balance：赏金（照 LoL 的连死、终结）。被杀的人连着死（中间没拿过人头和助攻）一次，他的人头少 15%，最低一半；被杀的人连着杀了 3 个以上，终结他多给 75 × (连杀 - 2)，最多 300。
  // 改之前八局里一半是 0:14、3:16 这种一边倒的局：一个人领先以后人头越拿越多，落后的一边送一个就是满额 300
  bounty: { streakCut: 0.15, floor: 0.5, spree: 3, per: 75, max: 300 },
  // 第九轮 balance：辅助位的任务收入（照 LoL 的辅助装“世界地图集”）：身边 near 米内有友方英雄时，打到敌方英雄或建筑一下拿 tribute 金币，
  // 一层一次，最多 charges 层，每 every 秒回一层；一共拿满 cap 就是任务完成，不再给（LoL 也是攒满 1000 升级完就不再出钱）。只认这一局打辅助位的人（h.pos），不占装备格。
  // 改之前八局里辅助 10 分钟身家只有射手的 58%，打完一局只有一两件装备（全靠每秒 2 金和助攻）
  sup: { tribute: 15, charges: 3, every: 15, near: 12, cap: 1000 },
  // 第九轮 balance：打野的经验曲线（照 LoL：打野比全场平均等级高的时候野怪给的经验打折，落后的时候多给，追得上也甩不开）。每高一级少 lv，最低 min 倍；每低一级多 lv，最高 max 倍。Boss 不算
  jungleXp: { lv: 0.1, min: 0.5, max: 1.3 },
  pvp: 1.25,                                           // 英雄打英雄的伤害乘这个数。阶段 5 的血量是按“一个人打小兵和塔”定的，英雄互相打起来太肉：打半天谁也打不死谁
  regen: [0.3, 0.7],                                   // 回血的快慢：[挨打后五秒内, 脱战以后] 各是属性里“每秒回血”的几倍（阶段 5 是 1 和 2.5：脱战十秒回 15%，对线时消耗等于白打）
  // 第九轮 balance：[0.35, 1.0] → [0.3, 0.7]。改之前八局里上单十分钟互相打了两万四的伤害、平均 0.3 个人头：英雄每秒回 0.5%–0.8% 的血，脱战一分钟回三四成（LoL 一分钟一成五上下），消耗打出去一会儿就回满了，谁也打不死谁
  camp: { first: 20, small: 60, buff: 90, leash: 9, grow: 0.045, buffSec: 100 },      // 营地：开局多久刷、清掉后多久再刷、追出去多远就回头、每分钟血和攻击涨多少、增益持续多久
  boss: { beast: [150, 170], troll: [300, 220], leash: 11, buffSec: [120, 150] },      // 两只 Boss：[第一次出现的时间, 被打掉后多久再出现]；队伍增益持续多久（巨兽、巨魔）
};

/** 野怪和 Boss 的数值。heavy 是重击：every 每隔几秒来一次；wind 蓄力多久（地上有预警圈）；r 范围；mul 伤害是攻击力的几倍；front 圈心在它面前多远；
 *  slow [几成, 几秒]、stun 几秒、push 推开几米是附带的效果；rest 砸完以后缓多久 */
export interface MobDef { name: string; boss?: boolean; hp: number; ad: number; armor: number; mr: number; range: number; period: number; wind: number; speed: number; r: number; sight: number; gold: number; xp: number;
  heavy?: { every: number; wind: number; r: number; mul: number; front: number; rest: number; slow?: [number, number]; stun?: number; push?: number }; }
// 第九轮 balance：小野怪和增益怪的金币各降两成左右（狼 34 → 27、山魈 52 → 41、两只增益怪 110 → 90），小营地 50 → 60 秒、增益怪 80 → 90 秒再刷（RULES.camp）。改之前八局里 10 分钟打野的身家是射手的 1.18 倍（LoL 打野大约是射手的八五成），卡兹 10 分钟已经 12.9 级
export const MOBS: Record<string, MobDef> = {
  wolf: { name: "苔背狼", hp: 1150, ad: 62, armor: 10, mr: 10, range: 1.1, period: 1.25, wind: 0.42, speed: 5.4, r: 0.6, sight: 8, gold: 27, xp: 50 },
  mandrill: { name: "骨面山魈", hp: 1900, ad: 96, armor: 20, mr: 15, range: 1.6, period: 1.6, wind: 0.7, speed: 5.6, r: 0.75, sight: 8, gold: 41, xp: 80 },      // 跑得快一点：它的跑步是冲刺的步子，走慢了像慢动作
  toad: { name: "石背巨蟾", hp: 4400, ad: 150, armor: 30, mr: 30, range: 1.9, period: 1.7, wind: 0.55, speed: 3.6, r: 1.35, sight: 9, gold: 90, xp: 220, heavy: { every: 8, wind: 1.3, r: 4.2, mul: 2.0, front: 0, rest: 0.9, slow: [0.4, 1.5] } },
  boar: { name: "烬鬃野猪", hp: 4400, ad: 165, armor: 30, mr: 30, range: 2.0, period: 1.7, wind: 0.7, speed: 4.6, r: 1.3, sight: 9, gold: 90, xp: 220, heavy: { every: 8, wind: 1.6, r: 3.4, mul: 2.2, front: 2.6, rest: 0.8, push: 3 } },      // 出手时间照它的动作定（上挑 0.8 秒、刨地蓄力后前顶 1.85 秒）
  beast: { name: "岩甲巨兽", boss: true, hp: 15000, ad: 240, armor: 45, mr: 45, range: 3.2, period: 1.8, wind: 0.7, speed: 2.6, r: 2.6, sight: 11, gold: 180, xp: 350, heavy: { every: 9, wind: 1.8, r: 5.6, mul: 2.4, front: 3.2, rest: 0.8, stun: 0.8 } },      // 走得慢：它的步子按 1.77 米/秒做的，走快了步子碎；重击蓄力 1.8 秒，对上“人立起来再砸下”的动作
  troll: { name: "岩石巨魔", boss: true, hp: 24000, ad: 320, armor: 55, mr: 55, range: 3.0, period: 2.0, wind: 0.8, speed: 3.4, r: 1.9, sight: 11, gold: 250, xp: 450, heavy: { every: 10, wind: 1.45, r: 6.2, mul: 2.6, front: 2.6, rest: 1.0, stun: 1.0 } },      // 双拳砸地：动作里拳头在 1.52 秒落在身前 2.6 米
};
/** 一个营地：里面是哪种怪、几只；side 是哪一方的野区（Boss 是 2）；buff 是打掉以后给的增益；nextAt 是下次刷出来的时间（现在有怪的时候没意义） */
export interface Camp { id: number; x: number; z: number; r: number; fx: number; fz: number; kind: "buff" | "small" | "boss"; mob: string; n: number; side: Team; top: boolean; buff: "" | "blue" | "red"; mobs: Ent[]; up: boolean; nextAt: number; }
/** 增益的名字（界面和播报用） */
export const BUFFS: Record<string, { name: string; desc: string; color: number }> = {
  blue: { name: "潮纹", desc: "技能冷却缩减 15%，法力恢复大幅加快", color: 0x6cc8ff },
  red: { name: "烬纹", desc: "普攻附带灼烧和减速，生命恢复加快", color: 0xff7a3c },
  beast: { name: "兽鳞", desc: "全队攻击和法强提高 12%，护甲和魔抗各加 15", color: 0x8fe6de },
  troll: { name: "巨魔之怒", desc: "全队对建筑的伤害提高 30%；每波兵在三条线上各多一个超级兵", color: 0xd8d2c0 },
};

export interface Sim {
  ents: Ent[]; shots: Shot[]; events: SimEvent[]; hero: Ent; time: number; over: 0 | 1 | -1;
  reveal: boolean;                                              // 观战：全图都看得见（不算视野）
  camps: Camp[]; kills: [number, number]; teamBuff: { beast: [number, number]; troll: [number, number] };      // 营地和 Boss；两队的击杀数；两队的 Boss 增益各到什么时候为止
  /** team 这一队现在看不看得见这个单位（自己人、建筑一直看得见） */
  sees: (team: number, e: Ent) => boolean;
  /** 给英雄挂一个增益（blue、red、beast、troll） */
  giveBuff: (e: Ent, id: string, sec: number) => void;
  gold: number; level: number; xp: number; cs: number; deaths: number; respawnIn: number; fountain: [number, number][];
  lanes: { pts: [number, number][]; len: number[] }[];                  // 三条兵线（我方出发的方向），按顺序：中、上、下
  /** 兵线上离 team 那一方起点 s 米的位置和前进方向：[x, z, 方向x, 方向z] */
  along: (lane: number, team: number, s: number) => [number, number, number, number]; laneLen: (lane: number) => number;
  /** 一个位置在某条兵线上对应的 s（离 team 那一方起点多远）和离兵线多远 */
  onLane: (lane: number, team: number, x: number, z: number) => [number, number];
  update: (dt: number) => void;
  /** 造成伤害。返回实际扣掉的血。第四个参数可以只写 true（大数字），也可以写明伤害类型和是不是技能 */
  damage: (e: Ent, dmg: number, src: Ent | null, o?: boolean | DmgOpts) => number;
  heal: (e: Ent, n: number) => void;
  /** 放一个英雄。x、z 也是它复活的地方（在自己出生点里的话；五个人各有一格，见 lineup.ts 的 spawnAt）。pos：这一局打什么位置 */
  addHero: (team: 0 | 1, x: number, z: number, kit: string, base: Stats, pos?: string) => Ent;
  /** 立刻刷出一个营地的怪（测试用；平时到时间自己刷） */
  spawnCamp: (c: Camp) => void;
  /** 把一个单位推开（速度、多少秒）。英雄的位移归它的控制器管，技能框架建好以后会把这个换成它那一份 */
  shove: (e: Ent, vx: number, vz: number, sec: number) => void;
  recalc: (e: Ent) => void;                                    // 等级、装备、增益变了以后重算属性
  gainXp: (e: Ent, n: number) => void;
  heroes: () => Ent[];
  heroAd: () => number;
  enemiesNear: (x: number, z: number, team: number, range: number) => Ent[];
  pick: (x: number, z: number, team: number, range: number, ok?: (e: Ent) => boolean) => Ent | null;
  add: (kind: Kind, team: Team, x: number, z: number, o?: Partial<Ent>) => Ent;
  towersLeft: (team: number) => number;
  /** 第九轮：装备的被动（items_fx.ts 的 bindItems 挂上来；没挂就是没有） */
  itemFx?: ItemHooks;
}

/** 没指定英雄时用的一级属性（岚） */
export const BASE_STATS: Stats = { hp: 3400, mana: 600, ad: 168, ap: 0, armor: 30, mr: 25, ms: 6.0, as: 1.5, range: 2.1, cdr: 0, ls: 0, hpRegen: 0.006, manaRegen: 0.012 };

export function createSim(nav: Nav, heroStart: [number, number], heroKit: { kit: string; base: Stats } = { kit: "lan", base: BASE_STATS }, opt: { waves?: boolean; camps?: boolean } = {}): Sim {
  let nextId = 1; const ents: Ent[] = [], shots: Shot[] = [], events: SimEvent[] = [];
  const blank = (kind: Kind, team: Team, x: number, z: number): Ent => ({ id: nextId++, kind, team, x, z, r: 0.5, hp: 1, max: 1, alive: true, seen: team === 0, seen1: team === 1, mob: "", camp: -1, hx: x, hz: z, hyaw: 0, fight: 0, heavyCd: 0, hvx: 0, hvz: 0, hvr: 0, raged: false, ad: 0, range: 1, cd: 0, period: 1, sight: 0, target: null, hurtAt: -9, deadAt: 0, yaw: 0, lane: 0, s: 0, off: 0, state: "idle", swing: 0, struck: false, think: Math.random() * 0.3, tier: 0, open: true, streak: 0, big: false, route: null, stall: 0, lx: x, lz: z, skip: null, skipT: 0, stuckT: 0,
    armor: 0, mr: 0, stun: 0, root: 0, silence: 0, slow: 0, slowK: 0, taunt: 0, tauntBy: null, shield: 0, shieldT: 0, fly: 0, fvx: 0, fvz: 0, invis: false, untarget: false, h: null, vuln: 0, vulnT: 0 });
  const add: Sim["add"] = (kind, team, x, z, o = {}) => { const e = Object.assign(blank(kind, team, x, z), o); e.hp = e.max; ents.push(e); events.push({ t: "spawn", e }); return e; };

  // ---- 三条兵线：先在路向坐标里写出大致的拐点（塔在兵线正中，从它右手边绕过去），再用寻路把拐点连成能走的折线 ----
  const [gA, gW] = GATES[1].o, coreA = A_CORNER - CORE_D;
  const rough = (lane: number): [number, number][] => {                 // 我方（左下）出发；lane 0 中、1 上（v 负的一侧）、2 下
    const pts: [number, number][] = [];
    if (lane === 0) { for (let u = -(coreA - 7); u <= coreA - 7 + 0.1; u += 4.5) pts.push([u, [22, 45, A_CORNER - 44 + 7].some(t => Math.abs(Math.abs(u) - t) < 4) ? 3.2 : 0]); }
    else { const sv = lane === 1 ? -1 : 1; pts.push([-(coreA - 5), sv * 5]);
      for (let a = gA + 3; a >= -(gA + 3) - 0.1; a -= 4.5) { const aa = Math.abs(a), near = [25, 51, 77].some(t => Math.abs(aa - t) < 4); pts.push([-a, sv * (sideLaneW(Math.min(aa, gA)) + (near ? -3.2 : 0))]); }
      pts.push([coreA - 5, sv * 5]); }
    return pts.map(([u, v]) => { const [x, z] = toWorld(u, v); return nav.walkable(x, z) ? [x, z] : nav.nearest(x, z); });
  };
  const lanes = [0, 1, 2].map(l => { const r = rough(l), pts: [number, number][] = [r[0]];
    for (let i = 1; i < r.length; i++) { const a = pts[pts.length - 1], p = nav.path(a[0], a[1], r[i][0], r[i][1]); for (const q of p.length ? p : [r[i]]) pts.push(q); }
    // 第九轮 balance：只留 0 队这一半（河道以前），后一半照河道镜像过去（u → -u 在世界坐标里就是 x、z 对调），两队走的兵线一模一样。
    // 原来整条用寻路连出来，拐点的取样和寻路的走法两头不一样：边路上 1 队的二塔、高地塔离自己的出兵点比 0 队近 2 米，只放小兵跑十分钟，0 队的兵对兵多打一成二的伤害、先推掉 1 队的塔
    const uOf = (p: [number, number]) => (p[0] - p[1]) / Math.SQRT2, k = pts.findIndex(p => uOf(p) >= 0);
    if (k > 0) { const a = pts[k - 1], b = pts[k], t = -uOf(a) / Math.max(1e-6, uOf(b) - uOf(a)), half = [...pts.slice(0, k), [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number]];
      pts.length = 0; pts.push(...half, ...half.slice(0, -1).reverse().map(([x, z]): [number, number] => nav.walkable(z, x) ? [z, x] : nav.nearest(z, x))); }
    const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, len }; });
  /** 兵线上离起点 s 米的位置和方向。team 1 是反着走的 */
  const along = (lane: number, team: number, s: number): [number, number, number, number] => { const L = lanes[lane], T = L.len[L.len.length - 1], d = Math.max(0, Math.min(T, team === 0 ? s : T - s));
    let i = 1; while (i < L.len.length - 1 && L.len[i] < d) i++; const a = L.pts[i - 1], b = L.pts[i], k = (d - L.len[i - 1]) / Math.max(1e-6, L.len[i] - L.len[i - 1]), sg = team === 0 ? 1 : -1, tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, ((b[0] - a[0]) / tl) * sg, ((b[1] - a[1]) / tl) * sg]; };
  const laneLen = (lane: number) => lanes[lane].len[lanes[lane].len.length - 1];
  const project = (lane: number, team: number, x: number, z: number, from: number) => { let best = from, bd = 1e9; for (let s = Math.max(0, from - 4); s <= from + 14; s += 1) { const [px, pz] = along(lane, team, s), d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = s; } } return best; };

  // ---- 建筑 ----
  for (const t of towerSpots()) add("tower", t.team, t.x, t.z, { tier: t.tier, lane: t.lane === "mid" ? 0 : t.lane === "top" ? 1 : 2, max: RULES.tower.hp[t.tier], ad: RULES.tower.ad, range: RULES.tower.range, period: RULES.tower.period, sight: RULES.tower.sight, r: RULES.tower.r, seen: true });
  for (const c of coreSpots()) add("core", c.team, c.x, c.z, { max: RULES.core.hp, ad: RULES.core.ad, range: RULES.core.range, period: RULES.core.period, sight: RULES.core.sight, r: RULES.core.r, seen: true });
  const fountain = [0, 1].map(tm => { const f = fountainSpots().find(s => s.team === tm)!; return [f.x, f.z] as [number, number]; });
  // ---- 野怪营地和两只 Boss（阶段 6）：每方野区上下各一个增益怪（一蓝一红，两方对角摆）、一窝狼、一窝山魈；上面的河心岛是巨魔，下面的是巨兽 ----
  const camps: Camp[] = [];
  if (opt.camps !== false) {
    for (const c of campSpots()) { const buff = c.kind === "buff" ? ((c.team === 0) === c.top ? "blue" : "red") : "";
      camps.push({ id: camps.length, x: c.x, z: c.z, r: c.r, fx: c.fx, fz: c.fz, kind: c.kind, mob: c.kind === "buff" ? (buff === "blue" ? "toad" : "boar") : c.i === 1 ? "wolf" : "mandrill", n: c.kind === "buff" ? 1 : c.i === 1 ? 3 : 2, side: c.team, top: c.top, buff, mobs: [], up: false, nextAt: RULES.camp.first }); }
    for (const b of bossSpots()) { const mob = b.top ? "troll" : "beast", l = Math.hypot(b.x, b.z) || 1;
      camps.push({ id: camps.length, x: b.x, z: b.z, r: 6, fx: -b.x / l, fz: -b.z / l, kind: "boss", mob, n: 1, side: 2, top: b.top, buff: "", mobs: [], up: false, nextAt: RULES.boss[mob][0] }); }
  }
  function spawnCamp(c: Camp) {
    const D = MOBS[c.mob], grow = 1 + RULES.camp.grow * Math.floor(sim.time / 60), yaw = Math.atan2(c.fx, c.fz), rx = c.fz, rz = -c.fx; c.mobs = []; c.up = true;
    for (let i = 0; i < c.n; i++) {      // 一只站正中；两只并排；三只是前一后二
      const [f, r] = c.n === 1 ? [0, 0] : c.n === 2 ? [0, i ? 1.5 : -1.5] : i === 0 ? [1.1, 0] : [-0.9, i === 1 ? -1.6 : 1.6];
      let x = c.x + c.fx * f + rx * r, z = c.z + c.fz * f + rz * r; if (!nav.walkable(x, z)) [x, z] = nav.nearest(x, z);
      c.mobs.push(add("monster", 2, x, z, { mob: c.mob, camp: c.id, hx: x, hz: z, hyaw: yaw, yaw, max: Math.round(D.hp * grow), ad: Math.round(D.ad * grow), armor: D.armor, mr: D.mr, range: D.range, period: D.period, sight: 0, r: D.r, seen: false, seen1: false, heavyCd: D.heavy ? D.heavy.every * 0.6 : 0 }));
    }
    events.push({ t: "camp", camp: c });
  }
  function giveBuff(e: Ent, id: string, sec: number) { const h = e.h; if (!h || !e.alive) return;
    const m: Mod = id === "blue" ? { cdr: 0.15, manaRegen: 0.02 } : id === "red" ? { hpRegen: 0.006 } : id === "beast" ? { adMul: 1.12, apMul: 1.12, armor: 15, mr: 15 } : {};
    h.mods.set("buff_" + id, { m, left: sec }); recalc(e); events.push({ t: "buff", e, id }); }
  function recalc(e: Ent) {
    const h = e.h!, b = h.base, L = h.level - 1, k = 1 + RULES.hero.perLevel * L, s = h.stat, old = s.hp;
    let hp = b.hp * k, mana = b.mana * (1 + 0.05 * L), ad = b.ad * k, ap = b.ap, armor = b.armor + 2.5 * L, mr = b.mr + 1.3 * L, ms = b.ms, as = b.as * (1 + 0.02 * L), range = b.range, cdr = b.cdr, ls = b.ls, hr = b.hpRegen, mg = b.manaRegen, msMul = 1, asMul = 1, adMul = 1, apMul = 1;
    const put = (m: Mod) => { hp += m.hp ?? 0; mana += m.mana ?? 0; ad += m.ad ?? 0; ap += m.ap ?? 0; armor += m.armor ?? 0; mr += m.mr ?? 0; ms += m.ms ?? 0; as += m.as ?? 0; range += m.range ?? 0; cdr += m.cdr ?? 0; ls += m.ls ?? 0; hr += m.hpRegen ?? 0; mg += m.manaRegen ?? 0; msMul *= m.msMul ?? 1; asMul *= m.asMul ?? 1; adMul *= m.adMul ?? 1; apMul *= m.apMul ?? 1; };
    for (const m of h.itemMods) put(m); for (const v of h.mods.values()) put(v.m);
    Object.assign(s, { hp: Math.round(hp), mana: Math.round(mana), ad: Math.round(ad * adMul), ap: Math.round(ap * apMul), armor, mr, ms: ms * msMul, as: as * asMul, range, cdr: Math.min(0.4, cdr), ls, hpRegen: hr, manaRegen: mg });
    e.max = s.hp; e.ad = s.ad; e.range = s.range; e.armor = s.armor; e.mr = s.mr;
    if (e.alive) e.hp = Math.max(1, Math.min(e.max, e.hp + Math.max(0, s.hp - old)));      // 血量上限涨了，当前血量跟着涨；降了就截掉
    h.mana = Math.min(h.mana, s.mana);
  }
  const addHero: Sim["addHero"] = (team, x, z, kit, base, pos = "") => {
    const e = add("hero", team, x, z, { max: base.hp, ad: base.ad, range: base.range, sight: RULES.hero.sight, r: 0.6, seen: team === 0 });      // hx、hz（出生的那一格）留着，复活时回到这里
    e.h = { kit, level: 1, xp: 0, gold: RULES.startGold, cs: 0, kills: 0, deaths: 0, assists: 0, dmg: 0, hitBy: new Map(), respawnIn: 0, mana: base.mana, base: { ...base }, stat: { ...base }, items: [], itemMods: [], mods: new Map(), pos, camps: 0 }; recalc(e); e.hp = e.max; return e;
  };
  const hero = addHero(0, heroStart[0], heroStart[1], heroKit.kit, heroKit.base);

  const sim: Sim = {
    ents, shots, events, hero, time: 0, over: 0, gold: 0, level: 1, xp: 0, cs: 0, deaths: 0, respawnIn: 0, fountain, lanes, reveal: false, camps, kills: [0, 0], teamBuff: { beast: [0, 0], troll: [0, 0] },
    along, laneLen, onLane: (lane, team, x, z) => { let best = 0, bd = 1e9; const T = laneLen(lane); for (let s = 0; s <= T; s += 2) { const [px, pz] = along(lane, team, s), d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = s; } } return [best, bd]; },
    sees: (team, e) => e.team === team || e.kind === "tower" || e.kind === "core" || (team === 0 ? e.seen : e.seen1), giveBuff, spawnCamp, shove: (e, vx, vz, sec) => { e.fvx = vx; e.fvz = vz; e.fly = sec; },      // gold、level 这几项下面换成读写玩家英雄身上的数（界面和测试脚本一直是这么读的）
    update, damage, heal, add, addHero, recalc, gainXp, heroes: () => ents.filter(e => e.kind === "hero"), heroAd: () => hero.h!.stat.ad,
    enemiesNear: (x, z, team, range) => ents.filter(e => e.alive && e.team !== team && Math.hypot(e.x - x, e.z - z) <= range + e.r),
    pick: (x, z, team, range, ok) => { let best: Ent | null = null, bd = 1e9; for (const e of ents) { if (!e.alive || e.team === team || (ok && !ok(e))) continue; const d = Math.hypot(e.x - x, e.z - z) - e.r; if (d <= range && d < bd) { bd = d; best = e; } } return best; },
    towersLeft: team => ents.filter(e => e.kind === "tower" && e.team === team && e.alive).length,
  };

  for (const k of ["gold", "level", "xp", "cs", "deaths", "respawnIn"] as const) Object.defineProperty(sim, k, { get: () => hero.h![k], set: (v: number) => { hero.h![k] = v; }, enumerable: true });

  function heal(e: Ent, n: number) { if (!e.alive || n <= 0) return; const v = Math.min(e.max - e.hp, n); e.hp += v; if (v >= 1) events.push({ t: "heal", e, n: Math.round(v) }); }
  function damage(e: Ent, dmg: number, src: Ent | null, o: boolean | DmgOpts = false): number {
    const opt: DmgOpts = typeof o === "boolean" ? { big: o } : o, type = opt.type ?? "phys";
    if (!e.alive || sim.over || dmg <= 0 || e.untarget) return 0;
    if ((e.kind === "tower" || e.kind === "core") && !e.open) { events.push({ t: "hit", e, dmg: 0, src }); return 0; }      // 前面的塔还在：打不动
    if ((e.kind === "tower" || e.kind === "core") && src && src.h && sim.teamBuff.troll[src.team as 0 | 1] > sim.time) dmg *= 1.3;      // 巨魔之怒：英雄拆建筑更快
    if (src && src.kind === "hero" && src !== e) {      // 英雄打了谁：打对面英雄，记下来（击杀和助攻用），附近的塔和小兵转过来打他；打野怪，整个营地醒过来
      if (e.h && src.team !== e.team) { e.h.hitBy.set(src.id, sim.time); aggroOn(src, e); }
      else if (e.kind === "monster") provoke(e, src); }
    if (e.h && src && src.h && src.team !== e.team) dmg *= RULES.pvp;
    if (sim.itemFx) dmg = sim.itemFx.pre(e, dmg, src, opt, type);      // 装备被动：暴击、穿甲穿法、淬火、伏击、铁砧靴（items_fx.ts）
    if (type !== "true") { const res = type === "phys" ? e.armor : e.mr; dmg *= res >= 0 ? 100 / (100 + res) : 2 - 100 / (100 - res); }      // 护甲 100 就是只吃一半
    if (e.h) for (const v of e.h.mods.values()) if (v.m.dmgTaken !== undefined) dmg *= v.m.dmgTaken;
    if (e.vulnT > 0) dmg *= 1 + e.vuln;
    if (e.shield > 0) { const a = Math.min(e.shield, dmg); e.shield -= a; dmg -= a; if (dmg < 0.5) { events.push({ t: "hit", e, dmg: 0, src, block: true }); return 0; } }      // 护盾先顶
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg; e.hurtAt = sim.time; events.push({ t: "hit", e, dmg, src, big: opt.big, type, skill: opt.skill }); if (e.h && src && src.h && src.team !== e.team) src.h.dmg += Math.min(dmg, e.hp + dmg);
    if (src && src.h && src.alive && !opt.skill && src.h.stat.ls > 0) heal(src, dmg * src.h.stat.ls);      // 普攻吸血
    if (src && src.h && !opt.skill && src.h.mods.has("buff_red") && e.kind !== "tower" && e.kind !== "core" && e.hp > 0) {      // 烬纹：普攻附带灼烧（真实伤害，两秒半）和一点减速
      const old = burns.find(b => b.e === e && b.src === src), dps = 14 + 5 * src.h.level; if (old) { old.left = 2.5; old.dps = dps; } else burns.push({ e, src, dps, left: 2.5, acc: 0 });
      if (e.slow <= 0 || e.slowK < 0.18) e.slowK = 0.18; e.slow = Math.max(e.slow, 1.2); }
    if (src && src.h && src.h.pos === "sup" && src.team !== e.team && (e.h || e.kind === "tower" || e.kind === "core")) tribute(src, e);      // 辅助的任务收入
    sim.itemFx?.post(e, dmg, src, opt, type);      // 装备被动：叠层、溅射、反伤、点燃、低血护盾、斩杀（附加伤害排队到 tick 里打）
    if (e.hp > 0) return dmg;
    e.hp = 0; e.alive = false; e.deadAt = sim.time; e.target = null; e.stun = e.root = e.silence = e.slow = e.taunt = e.fly = 0; e.shield = 0; events.push({ t: "die", e, by: src });
    sim.itemFx?.die(e, src);      // 装备被动：击杀刷新
    // 小兵和塔死了：对面的英雄拿钱和经验。最后一刀是哪个英雄打的，金币和补刀数就给谁；塔的钱对面每个英雄都有；经验给附近的对面英雄
    const R = e.kind === "melee" ? RULES.melee : e.kind === "ranged" ? RULES.ranged : e.kind === "tower" ? RULES.tower : null;
    if (R) { const gold = e.big ? RULES.super.gold : R.gold, xp = e.big ? RULES.super.xp : R.xp;
      const near = (hh: Ent) => hh.alive && Math.hypot(e.x - hh.x, e.z - hh.z) < RULES.xpRange, share = e.kind === "tower" ? 1 : RULES.xpShare[Math.min(RULES.xpShare.length - 1, ents.filter(hh => hh.kind === "hero" && hh.team !== e.team && near(hh)).length)];      // 第九轮：小兵的经验附近几个人分（下路两个人各拿六成五）；塔的经验全队都是整份
      for (const hh of ents) { if (hh.kind !== "hero" || hh.team === e.team || !hh.h) continue;
        if (hh === src || e.kind === "tower") { hh.h.gold += gold; if (hh === hero) events.push({ t: "gold", n: gold, e }); if (e.kind !== "tower") hh.h.cs++; }
        if (hh.alive && (e.kind === "tower" || near(hh))) gainXp(hh, xp * share); } }
    if (e.h) {      // 英雄阵亡：最后一下是对面英雄打的就算他的；不是（被小兵、塔、野怪打死）就算最近打过他的那个英雄。其余最近打过他的算助攻
      const hb = e.h.hitBy, rec = [...hb].filter(([, t]) => sim.time - t <= RULES.kill.window).map(([id]) => ents.find(o => o.id === id)).filter((o): o is Ent => !!o && !!o.h && o.team !== e.team).sort((a, b) => hb.get(b.id)! - hb.get(a.id)!);
      const killer = src && src.h && src.team !== e.team ? src : rec[0] ?? null, assists = rec.filter(o => o !== killer);
      const B = RULES.bounty, bounty = Math.round(RULES.kill.gold * Math.max(B.floor, 1 - B.streakCut * (e.h.dead ?? 0)) + Math.min(B.max, B.per * Math.max(0, (e.h.spree ?? 0) - (B.spree - 1))));      // 赏金：他连死几次打折，他连杀几个加钱
      e.h.spree = 0; e.h.dead = (e.h.dead ?? 0) + 1;
      if (killer) { const kh = killer.h!; kh.kills++; kh.spree = (kh.spree ?? 0) + 1; kh.dead = 0; kh.gold += bounty; gainXp(killer, 220 + 40 * e.h.level); if (killer === hero) events.push({ t: "gold", n: bounty, e }); sim.kills[killer.team as 0 | 1]++;
        for (const id of ["blue", "red"]) { const v = e.h.mods.get("buff_" + id); if (v && v.left > 5) giveBuff(killer, id, Math.max(v.left, 40)); } }      // 身上的野怪增益归击杀他的人
      for (const a of assists) { a.h!.assists++; a.h!.dead = 0; a.h!.gold += RULES.kill.assist; gainXp(a, 110 + 20 * e.h.level); if (a === hero) events.push({ t: "gold", n: RULES.kill.assist, e }); }
      events.push({ t: "kill", e, by: killer ?? src, assists }); hb.clear(); }
    if (e.kind === "monster") {      // 野怪：钱给打最后一下的英雄，经验给他和身边的队友；增益怪的增益给他。Boss：全队都有钱、经验和增益
      const D = MOBS[e.mob], c = camps[e.camp], killer = src && src.h ? src : null, gone = !c || c.mobs.every(o => !o.alive);
      if (killer && D.boss) { const tm = killer.team as 0 | 1, id = e.mob as "beast" | "troll", sec = RULES.boss.buffSec[id === "beast" ? 0 : 1]; sim.teamBuff[id][tm] = sim.time + sec;
        for (const hh of ents) if (hh.h && hh.team === tm) { hh.h.gold += D.gold; gainXp(hh, D.xp); if (hh === hero) events.push({ t: "gold", n: D.gold, e }); giveBuff(hh, id, sec); }
        events.push({ t: "boss", mob: e.mob, team: tm, by: killer }); }
      else if (killer) { killer.h!.gold += D.gold; killer.h!.cs++; if (killer === hero) events.push({ t: "gold", n: D.gold, e });
        for (const hh of ents) if (hh.h && hh.alive && hh.team === killer.team && (hh === killer || Math.hypot(e.x - hh.x, e.z - hh.z) < RULES.xpRange)) gainXp(hh, (hh === killer ? D.xp : D.xp * 0.6) * jungleXp(hh));
        if (c && c.buff && gone) giveBuff(killer, c.buff, RULES.camp.buffSec); if (gone) killer.h!.camps++; }
      if (c && gone) { c.up = false; c.nextAt = sim.time + (c.kind === "boss" ? RULES.boss[e.mob as "beast" | "troll"][1] : c.kind === "buff" ? RULES.camp.buff : RULES.camp.small); } }
    if (e.kind === "core") { sim.over = e.team === 1 ? 1 : -1; events.push({ t: "end", win: e.team === 1 }); }
    if (e.h) { e.h.deaths++; e.h.respawnIn = RULES.respawn[0] + RULES.respawn[1] * e.h.level + Math.max(0, sim.time - RULES.respawn[2]) * RULES.respawn[3]; e.h.mods.clear(); recalc(e); e.hp = 0; }
    return dmg;
  }
  /** 一个英雄在塔下、兵堆里打了对面的英雄：够得着他的塔转过来打他（接下来两秒半不换目标），附近的小兵也转过来 */
  function aggroOn(att: Ent, victim: Ent) {
    for (const o of ents) { if (!o.alive || o.team !== victim.team) continue; const d = Math.hypot(att.x - o.x, att.z - o.z);
      if (o.kind === "tower" || o.kind === "core") { if (d <= o.range + att.r && Math.hypot(victim.x - o.x, victim.z - o.z) <= o.range + 5) { if (o.target !== att) { o.target = att; o.streak = 0; } o.think = 2.5; } }
      else if ((o.kind === "melee" || o.kind === "ranged") && o.state !== "attack" && o.taunt <= 0 && (!o.target || o.target.kind !== "hero") && d < 7.5 && Math.hypot(victim.x - o.x, victim.z - o.z) < 9) { o.target = att; o.route = null; o.think = 2.5; } }
  }
  /** 野怪挨了英雄的打：同一个营地的都醒过来。没有目标的（或者目标已经不在了的）盯上这个英雄 */
  function provoke(m: Ent, src: Ent) { const c = camps[m.camp]; if (!c) return;
    for (const o of c.mobs) { if (!o.alive) continue; o.fight = 6; if (!o.target || !o.target.alive) o.target = src; } }
  const burns: { e: Ent; src: Ent; dps: number; left: number; acc: number }[] = [];
  /** 打野的经验曲线（RULES.jungleXp）：按这个英雄比全场英雄的平均等级高几级打折 */
  function jungleXp(e: Ent) { const hs = ents.filter(o => o.h); if (hs.length < 2) return 1; const avg = hs.reduce((s, o) => s + o.h!.level, 0) / hs.length, J = RULES.jungleXp;
    return Math.max(J.min, Math.min(J.max, 1 - J.lv * (e.h!.level - avg))); }
  /** 辅助的任务收入（RULES.sup）：辅助位的英雄打到对面的英雄或建筑，身边有队友，就拿一层的钱 */
  function tribute(s: Ent, at: Ent) { const h = s.h!, S = RULES.sup, q = (h.quest ??= { ch: S.charges, t: 0, got: 0 }); if (q.ch < 1 || q.got >= S.cap) return;
    if (!ents.some(o => o !== s && o.h && o.alive && o.team === s.team && Math.hypot(o.x - s.x, o.z - s.z) < S.near)) return;
    const n = Math.min(S.tribute, S.cap - q.got); q.ch--; q.got += n; h.gold += n; if (s === hero) events.push({ t: "gold", n, e: at }); }
  function gainXp(e: Ent, n: number) { const h = e.h; if (!h) return; h.xp += n; while (h.level < 15 && h.xp >= RULES.level(h.level)) { h.xp -= RULES.level(h.level); h.level++; recalc(e); events.push({ t: "level", n: h.level, e }); } }

  let nextWave = RULES.wave.first, waveNo = 0;
  function spawnWave() {
    waveNo++; const mins = Math.floor(sim.time / 60), grow = 1 + 0.03 * mins + 0.04 * Math.max(0, mins - 9),      /* 十分钟以后小兵涨得更快：后期两边都满级满装，得靠兵线把僵局压破 */ list: Kind[] = sim.time > RULES.wave.grow ? ["melee", "melee", "melee", "ranged"] : ["melee", "melee", "ranged"];
    for (const team of [0, 1] as const) for (let lane = 0; lane < 3; lane++) {
      const sup = sim.teamBuff.troll[team] > sim.time || ents.some(o => o.kind === "tower" && o.team !== team && o.lane === lane && o.tier === 3 && !o.alive);      // 对方这条线的高地塔倒了（或者我方有巨魔之怒）：这一波多一个超级兵，走在最前面
      (sup ? ["melee" as Kind, ...list] : list).forEach((kind, i) => {
        const big = sup && i === 0, R = kind === "melee" ? RULES.melee : RULES.ranged, s0 = 2 - i * 1.6, [x, z, tx, tz] = along(lane, team, Math.max(0, s0)), off = big ? 0 : (i % 2 ? 1 : -1) * (kind === "ranged" ? 0.4 : 1.1) * (team === 1 ? -1 : 1);      /* 第九轮 balance：1 队的左右反过来，两队的队形照河道镜像（原来两队都按“自己前进方向的左边”排，镜像过去左右是反的） */
        add(kind, team, x - tz * off, z + tx * off, { lane, s: Math.max(0, s0), off, big, max: Math.round(R.hp * grow * (big ? RULES.super.hp : 1)), ad: Math.round(R.ad * grow * (big ? RULES.super.ad : 1)), range: R.range, period: R.period, sight: R.sight, r: big ? RULES.super.r : R.r, state: "walk", yaw: Math.atan2(tx, tz), seen: team === 0 });
      });
    }
  }

  function minion(m: Ent, dt: number) {
    const R = m.kind === "melee" ? RULES.melee : RULES.ranged; m.cd -= dt; m.think -= dt;
    if (m.fly > 0 || m.stun > 0) { m.state = "idle"; m.swing = 0; return; }      // 被击飞、拉拽、眩晕的时候什么都做不了
    if (m.taunt > 0 && m.tauntBy && m.tauntBy.alive) m.target = m.tauntBy;        // 被嘲讽：只能打嘲讽它的那个
    if (m.target && (!m.target.alive || m.target.untarget || (m.target.invis && m.taunt <= 0) || Math.hypot(m.target.x - m.x, m.target.z - m.z) > RULES.leash + m.target.r)) { m.target = null; m.route = null; }
    if (m.think <= 0 && m.state !== "attack" && m.taunt <= 0) { m.think = 0.3;      // 找目标：最近的；同样远的话先打小兵，再打英雄，最后才是建筑
      let best: Ent | null = null, bs = 1e9;
      for (const e of ents) { if (!e.alive || e.team === m.team || e.team === 2 || e.untarget || e.invis || (e === m.skip && sim.time < m.skipT)) continue; if ((e.kind === "tower" || e.kind === "core") && !e.open) continue; const d = Math.hypot(e.x - m.x, e.z - m.z) - e.r; if (d > RULES.aggro) continue;
        const sc = d + (e.kind === "tower" || e.kind === "core" ? 4 : e.kind === "hero" ? 2 : 0); if (sc < bs) { bs = sc; best = e; } }
      if (best !== m.target) m.route = null; m.target = best; }
    let mx = 0, mz = 0, moving = false;
    /** 照着绕路的拐点走，返回这一帧的方向（走完了返回 null）。
     *  第九轮修卡兵：原来是“离拐点不到 0.5 米就跳到下一个”。寻路给的第一个拐点常常就是贴着墙角、离小兵不到半米的那一格，
     *  跳过它以后下一个拐点隔着墙，小兵直着往墙里顶，半秒后重新寻路又是同一条路——在塔座和河岸的拐角卡几十秒。
     *  现在反过来：下一个拐点能直着走到才跳过去，否则老老实实走到当前这个拐点（0.25 米内）再说 */
    const follow = (): [number, number] | null => { const r = m.route!; while (r.length > 1 && nav.clear(m.x, m.z, r[1][0], r[1][1])) r.shift();
      const [gx, gz] = r[0], ex = gx - m.x, ez = gz - m.z, el = Math.hypot(ex, ez); if (el < 0.25) { r.shift(); if (!r.length) m.route = null; return null; } return [ex / el, ez / el]; };
    if (m.state === "attack") {                                 // 出手中：到了时间点算命中（远程是放出一发）
      m.swing += dt; const tg = m.target;
      if (!m.struck && m.swing >= R.wind) { m.struck = true; if (tg && tg.alive) { if (m.kind === "melee") damage(tg, m.ad, m); else fire(m, tg, m.ad, "ranged"); } }
      if (m.swing >= R.period * 0.8) { m.state = "idle"; m.cd = R.period * 0.2; }
      if (tg) m.yaw = Math.atan2(tg.x - m.x, tg.z - m.z);
    } else if (m.target) {
      const tg = m.target, dx = tg.x - m.x, dz = tg.z - m.z, d = Math.hypot(dx, dz), gap = d - tg.r - m.r;
      if (gap > m.range) { if (m.route && m.route.length) { const v = follow(); if (v) [mx, mz] = v; } if (!mx && !mz) { mx = dx / d; mz = dz / d; } moving = true; }
      else if (m.cd <= 0) { m.state = "attack"; m.swing = 0; m.struck = false; m.yaw = Math.atan2(dx, dz); }
      else m.state = "idle";
    } else {                                                    // 没有目标：沿兵线往前走
      m.s = project(m.lane, m.team, m.x, m.z, m.s);
      if (m.route && m.route.length) { const v = follow(); if (v) { [mx, mz] = v; moving = true; } }      // 正在绕路
      if (!moving && !m.route) { const [px, pz, tx, tz] = along(m.lane, m.team, Math.min(laneLen(m.lane), m.s + 2.2));
        // 一波兵并排走：各自在兵线左右偏开一点（off）。兵线是寻路拉直出来的，过塔座、河岸拐角时贴着障碍物走，
        // 里侧那一排偏出去的目标点就落在塔座或者墙里了（第九轮查出来的卡兵主因之一）。直着走不过去就把偏移收小，再不行走兵线正中
        let gx = px - tz * m.off, gz = pz + tx * m.off; if (!nav.clear(m.x, m.z, gx, gz)) { gx = px - tz * m.off * 0.35; gz = pz + tx * m.off * 0.35; if (!nav.clear(m.x, m.z, gx, gz)) { gx = px; gz = pz; } }
        const dx = gx - m.x, dz = gz - m.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { mx = dx / d; mz = dz / d; moving = true; } }
    }
    if (moving && m.root <= 0) {
      // 别和自己人挤在一起：被身边的小兵轻轻推开
      let px = 0, pz = 0; for (const o of ents) { if (o === m || !o.alive || o.team !== m.team || (o.kind !== "melee" && o.kind !== "ranged")) continue; const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz); if (d < 1.25 && d > 1e-3) { px += (dx / d) * (1.25 - d); pz += (dz / d) * (1.25 - d); } }
      // 第九轮：挤的力正好顶着要走的方向时（前面的自己人站着在打，后面的想往前），两股力抵消，小兵站在原地“走”不动。
      // 顶着的那一截去掉大半，再往旁边让一点（按 id 分左右），后面的兵就从旁边绕上去
      { const pd = px * mx + pz * mz; if (pd < 0) { px -= pd * mx * 0.85; pz -= pd * mz * 0.85; const sd = m.off > 0 || (m.off === 0 && m.id % 2) ? 1 : -1;      /* 第九轮 balance：往哪边让按队形里站的那一侧（原来按 id 单双，两队对不上） */ px += -mz * sd * -pd * 0.6; pz += mx * sd * -pd * 0.6; } }
      let vx = mx + px * 1.4, vz = mz + pz * 1.4; const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      const spd = R.speed * (m.slow > 0 ? 1 - m.slowK : 1), nx = m.x + vx * spd * dt, nz = m.z + vz * spd * dt;
      if (nav.walkable(nx, nz)) { m.x = nx; m.z = nz; } else if (nav.walkable(nx, m.z)) m.x = nx; else if (nav.walkable(m.x, nz)) m.z = nz;
      else { const ox = m.x + mx * spd * dt, oz = m.z + mz * spd * dt; if (nav.walkable(ox, oz)) { m.x = ox; m.z = oz; } }      // 被自己人挤得往墙里推：不管挤，照原来要走的方向走
      // 半秒里几乎没挪地方：是被墙角或塔座卡住了（直着走过不去，贴着滑也滑不动）。让寻路给一条绕过去的路，照着走完再回到兵线上
      m.stall += dt; if (m.stall >= 0.5) { const moved = Math.hypot(m.x - m.lx, m.z - m.lz); m.lx = m.x; m.lz = m.z; m.stall = 0;
        // 兜底（根因在上面修过：拐点、兵线偏移、挤的力）：连着 2 秒都没挪动，就沿着寻路的方向往前挪半米（站在被挡住的格子里就挪到最近的能走的格子）。只是防万一，不是主要的走法
        m.stuckT = moved < spd * 0.5 * 0.3 ? m.stuckT + 0.5 : 0;
        if (m.stuckT >= 2) { m.stuckT = 0; if (!nav.walkable(m.x, m.z)) [m.x, m.z] = nav.nearest(m.x, m.z); else if (m.route && m.route.length) { const [gx, gz] = m.route[0], dl = Math.hypot(gx - m.x, gz - m.z), k = Math.min(1, 0.5 / Math.max(dl, 1e-3)), nx = m.x + (gx - m.x) * k, nz = m.z + (gz - m.z) * k; if (nav.walkable(nx, nz)) { m.x = nx; m.z = nz; } } m.lx = m.x; m.lz = m.z; }
        if (moved < spd * 0.5 * 0.3 && m.target && m.target.kind !== "tower" && m.target.kind !== "core" && m.stuckT >= 1) { m.skip = m.target; m.skipT = sim.time + 3; m.target = null; m.route = null; }      // 连着一秒挪不动（绕了路也不行）：这个目标够不着，换一个（兵堆后面的、墙那边的）
        else if (moved < spd * 0.5 * 0.3) { let gx: number, gz: number; if (m.target) { gx = m.target.x; gz = m.target.z; } else [gx, gz] = along(m.lane, m.team, Math.min(laneLen(m.lane), m.s + 9));      /* 原来减速时不重新寻路（m.slow <= 0），被减速的兵贴着墙一直顶 */
          const to = nav.walkable(gx, gz) ? [gx, gz] : nav.nearest(gx, gz), path = nav.path(m.x, m.z, to[0], to[1]); m.route = path.length ? path.slice(0, 12) : null; } }
      let dy = Math.atan2(mx, mz) - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); m.yaw += Math.max(-9 * dt, Math.min(9 * dt, dy)); m.state = "walk";
    }
  }
  // ---- 野怪和 Boss：平时站在营地里不动；被英雄打了才还手，追出营地一段就回头，回到原位很快回满 ----
  const turn = (m: Ent, to: number, dt: number, rate: number) => { let dy = to - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); m.yaw += Math.max(-rate * dt, Math.min(rate * dt, dy)); };
  function walk(m: Ent, x: number, z: number, speed: number, dt: number) {
    // 第九轮：野怪原来直着朝目标（或者原位）走，人绕到营地的墙后面它就顶着墙不动。直线过不去就寻路，照着拐点走。
    // 野怪不用小兵那几个字段，借来用：route 拐点、lx/lz 这条路是朝哪个点算的、stall 离下次重新寻路还有几秒
    m.stall -= dt;
    if (nav.clear(m.x, m.z, x, z)) m.route = null;
    else { if (!m.route || m.stall <= 0 || Math.hypot(m.lx - x, m.lz - z) > 1.5) { const to = nav.walkable(x, z) ? [x, z] : nav.nearest(x, z), p = nav.path(m.x, m.z, to[0], to[1]); m.route = p.length ? p : null; m.lx = x; m.lz = z; m.stall = 0.8; }
      const r = m.route; if (r) { while (r.length > 1 && nav.clear(m.x, m.z, r[1][0], r[1][1])) r.shift(); if (Math.hypot(r[0][0] - m.x, r[0][1] - m.z) < 0.25 && r.length > 1) r.shift(); [x, z] = r[0]; } }
    let dx = x - m.x, dz = z - m.z; const d = Math.hypot(dx, dz); if (d < 1e-3) return; dx /= d; dz /= d;
    for (const o of camps[m.camp]?.mobs ?? []) { if (o === m || !o.alive) continue; const ex = m.x - o.x, ez = m.z - o.z, el = Math.hypot(ex, ez), min = m.r + o.r + 0.3; if (el < min && el > 1e-3) { let px = (ex / el) * (min - el) * 1.5, pz = (ez / el) * (min - el) * 1.5; const pd = px * dx + pz * dz; if (pd < 0) { px -= pd * dx * 0.85; pz -= pd * dz * 0.85; } dx += px; dz += pz; } }      // 同一窝的别叠在一起（顶着要走的方向的那一截去掉：第九轮查出三只狼互相顶住、谁也走不动）
    const l = Math.hypot(dx, dz) || 1, spd = speed * (m.slow > 0 ? 1 - m.slowK * (MOBS[m.mob].boss ? 0.4 : 1) : 1), step = Math.min(d, spd * dt), nx = m.x + (dx / l) * step, nz = m.z + (dz / l) * step;
    turn(m, Math.atan2(dx, dz), dt, 8); if (m.root > 0) { m.state = "idle"; return; } m.state = "walk";
    if (nav.walkable(nx, nz)) { m.x = nx; m.z = nz; } else if (nav.walkable(nx, m.z)) m.x = nx; else if (nav.walkable(m.x, nz)) m.z = nz;
  }
  function monster(m: Ent, dt: number) {
    const D = MOBS[m.mob], c = camps[m.camp], leash = D.boss ? RULES.boss.leash : RULES.camp.leash; m.cd -= dt; m.heavyCd -= dt; if (m.fight > 0) m.fight -= dt;
    if (m.fly > 0 || m.stun > 0) { m.state = "idle"; m.swing = 0; return; }      // 被眩晕、击退：手上的动作断掉（重击的蓄力也断，这是打断它的办法）。Boss 不吃这些，见 update
    if (m.taunt > 0 && m.tauntBy && m.tauntBy.alive) { m.target = m.tauntBy; m.fight = Math.max(m.fight, 2); }
    const okT = (e: Ent | null): e is Ent => !!e && e.alive && !e.untarget && !e.invis && Math.hypot(e.x - c.x, e.z - c.z) < leash + 2.5;
    let tg = m.target;
    if (m.state !== "attack" && m.state !== "heavy" && m.state !== "roar" && (!okT(tg) || m.fight <= 0)) {      // 目标没了、隐身了、跑出营地了：换成营地里离得最近的英雄；没有就不打了
      tg = null; if (m.fight > 0) { let bd = 1e9; for (const e of ents) { if (e.kind !== "hero" || !okT(e)) continue; const d = Math.hypot(e.x - m.x, e.z - m.z); if (d < bd) { bd = d; tg = e; } } }
      m.target = tg; if (!tg) m.fight = 0; }
    if (m.state === "roar") { m.swing += dt; if (m.swing >= 2.0) m.state = "idle"; return; }
    if (m.state === "heavy") {            // 重击：蓄力（地上有预警圈）→ 落下 → 缓一会儿
      const H = D.heavy!; m.swing += dt;
      if (!m.struck && m.swing >= H.wind) { m.struck = true; events.push({ t: "slam", x: m.hvx, z: m.hvz, r: H.r, src: m });
        for (const e of [...ents]) { if (!e.alive || e.team === 2 || e.untarget || e.kind === "tower" || e.kind === "core" || Math.hypot(e.x - m.hvx, e.z - m.hvz) > H.r + e.r) continue;
          damage(e, m.ad * H.mul, m, { type: "phys", big: true }); if (!e.alive) continue;
          if (H.stun) e.stun = Math.max(e.stun, H.stun); if (H.slow) { if (e.slow <= 0 || e.slowK < H.slow[0]) e.slowK = H.slow[0]; e.slow = Math.max(e.slow, H.slow[1]); }
          if (H.push) { const px = e.x - m.x, pz = e.z - m.z, pl = Math.hypot(px, pz) || 1; sim.shove(e, (px / pl) * H.push / 0.25, (pz / pl) * H.push / 0.25, 0.25); } } }
      if (m.swing >= H.wind + H.rest) { m.state = "idle"; m.cd = 0.4; }
      return; }
    if (m.state === "attack") { m.swing += dt;
      if (!m.struck && m.swing >= D.wind) { m.struck = true; if (tg && tg.alive && Math.hypot(tg.x - m.x, tg.z - m.z) - tg.r - m.r < m.range + 1.5) damage(tg, m.ad, m); }      // 出手的那一刻人已经躲开一大截：打空
      if (m.swing >= m.period * 0.8) { m.state = "idle"; m.cd = m.period * 0.2; }
      if (tg && !m.struck) turn(m, Math.atan2(tg.x - m.x, tg.z - m.z), dt, 6); return; }
    if (!tg) {                             // 没在打：走回原位，面朝外站好；回血很快，回满以后脾气也消了
      if (Math.hypot(m.x - m.hx, m.z - m.hz) > 0.25) walk(m, m.hx, m.hz, D.speed * 1.3, dt); else { m.state = "idle"; turn(m, m.hyaw, dt, 5); }
      if (m.hp < m.max) m.hp = Math.min(m.max, m.hp + m.max * 0.15 * dt); else if (m.raged) { m.raged = false; m.period = D.period; }
      return; }
    if (D.boss && !m.raged && m.hp < m.max * 0.5) { m.raged = true; m.state = "roar"; m.swing = 0; m.period = D.period * 0.8; events.push({ t: "roar", e: m }); return; }      // Boss 掉到半血咆哮一次，之后出手更快
    const dx = tg.x - m.x, dz = tg.z - m.z, d = Math.hypot(dx, dz) || 1e-3, gap = d - tg.r - m.r;
    if (D.heavy && m.heavyCd <= 0 && gap < D.heavy.front + D.heavy.r * 0.6) {      // 重击：圈定在出手这一刻它面前（front 是 0 就在脚下），之后不跟人，走得出去
      const H = D.heavy, f = Math.min(H.front, d); m.state = "heavy"; m.swing = 0; m.struck = false; m.heavyCd = H.every * (m.raged ? 0.75 : 1); m.hvx = m.x + (dx / d) * f; m.hvz = m.z + (dz / d) * f; m.hvr = H.r; m.yaw = Math.atan2(dx, dz);
      events.push({ t: "warn", x: m.hvx, z: m.hvz, r: H.r, sec: H.wind, src: m }); return; }
    if (gap > m.range) walk(m, tg.x, tg.z, D.speed, dt);
    else if (m.cd <= 0) { m.state = "attack"; m.swing = 0; m.struck = false; turn(m, Math.atan2(dx, dz), 1, 99); }
    else { m.state = "idle"; turn(m, Math.atan2(dx, dz), dt, 6); }
  }
  function fire(from: Ent, to: Ent, dmg: number, kind: Shot["kind"]) { const s: Shot = { id: nextId++, x: from.x, y: kind === "tower" ? (from.kind === "core" ? 6.5 : 4.6 + from.tier * 0.9) : 1.5, z: from.z, to, from, dmg, speed: RULES.shotSpeed, kind, alive: true }; shots.push(s); events.push({ t: "shot", s }); }
  function building(b: Ent, dt: number) {
    const R = b.kind === "core" ? RULES.core : RULES.tower; b.cd -= dt; if (b.think > 0) b.think -= dt;      // think：被“打了我方英雄”的人吸引过去以后，这么多秒内不换目标
    if (b.target && (!b.target.alive || b.target.untarget || Math.hypot(b.target.x - b.x, b.target.z - b.z) > b.range + b.target.r)) { b.target = null; b.streak = 0; }
    if (!b.target || (b.target.kind === "hero" && b.cd <= 0 && b.think <= 0)) {    // 先打小兵；身边没有小兵才打英雄
      let best: Ent | null = null, bs = 1e9;
      for (const e of ents) { if (!e.alive || e.team === b.team || e.team === 2 || e.untarget || e.kind === "tower" || e.kind === "core") continue; const d = Math.hypot(e.x - b.x, e.z - b.z) - e.r; if (d > b.range) continue; const sc = d + (e.kind === "hero" ? 100 : 0);      /* 塔看得见隐身的 */ if (sc < bs) { bs = sc; best = e; } }
      if (best !== b.target) { b.target = best; b.streak = 0; }
    }
    if (b.target && b.cd <= 0) { const hero_ = b.target.kind === "hero"; fire(b, b.target, hero_ ? Math.round(R.adHero * (1 + 0.3 * Math.min(4, b.streak))) : b.ad, "tower"); if (hero_) b.streak++; b.cd = b.period; }
  }

  let seeT = 0, flip = false;
  function update(dt: number) {
    if (sim.over) return;
    sim.time += dt;
    // 状态的倒计时；被击退、拉拽的位移（英雄的位移由它自己的控制器走，见 actor.ts）
    for (const e of ents) { if (!e.alive) continue;
      if (e.stun > 0) e.stun -= dt; if (e.root > 0) e.root -= dt; if (e.silence > 0) e.silence -= dt; if (e.slow > 0) e.slow -= dt; if (e.taunt > 0) e.taunt -= dt;
      if (e.shieldT > 0) { e.shieldT -= dt; if (e.shieldT <= 0) e.shield = 0; } if (e.vulnT > 0) e.vulnT -= dt;
      if (e.kind === "monster" && MOBS[e.mob].boss) e.stun = e.root = e.fly = e.taunt = 0;      // Boss 不吃眩晕、定身、击退、嘲讽（减速只吃四成）
      if (e.fly > 0 && e.kind !== "hero") { const st = Math.min(dt, e.fly), nx = e.x + e.fvx * st, nz = e.z + e.fvz * st; if (e.kind !== "tower" && e.kind !== "core" && nav.walkable(nx, nz)) { e.x = nx; e.z = nz; } e.fly -= dt; } }
    if (opt.waves !== false && sim.time >= nextWave) { nextWave += RULES.wave.every; spawnWave(); }
    if (opt.waves !== false) for (const c of camps) if (!c.up && sim.time >= c.nextAt) spawnCamp(c);      // 测试场不自己刷野怪，要的话脚本调 spawnCamp
    for (let i = burns.length - 1; i >= 0; i--) { const b = burns[i]; b.left -= dt; b.acc += dt; if (b.acc >= 0.5) { b.acc -= 0.5; if (b.e.alive) damage(b.e, b.dps * 0.5, b.src, { type: "true", skill: true }); } if (b.left <= 0 || !b.e.alive) burns.splice(i, 1); }
    sim.itemFx?.tick(dt);      // 装备被动：光环、炉膛、护潮、韧性、放技能、排队的附加伤害
    // 哪些塔现在打得动：外塔一直能打；里面的要等同一条线上外面那座倒了。任意一座高地塔倒了，水晶才打得动
    for (const b of ents) { if (b.kind === "tower") b.open = b.tier === 1 || !ents.some(o => o.kind === "tower" && o.team === b.team && o.lane === b.lane && o.tier === b.tier - 1 && o.alive); else if (b.kind === "core") b.open = ents.some(o => o.kind === "tower" && o.team === b.team && o.tier === 3 && !o.alive); }
    // 第九轮 balance：小兵、塔、野怪每一步正着、倒着轮流过一遍。原来一直是 ents 的顺序（每一波 0 队的兵先放进去），两边同一刻出手时 0 队的先算、先打死人：
    // 只放小兵跑 20 分钟，1 队三座外塔都倒了、0 队一座没倒（docs/round9/balance/sym_before.json）
    const order = [...ents]; if ((flip = !flip)) order.reverse();
    for (const e of order) { if (!e.alive) continue; if (e.kind === "melee" || e.kind === "ranged") minion(e, dt); else if (e.kind === "tower" || e.kind === "core") building(e, dt); else if (e.kind === "monster") monster(e, dt); }
    for (const s of shots) { if (!s.alive) continue; const ty = s.to.kind === "hero" ? 1.4 : s.to.kind === "tower" ? 3 : 1.0, dx = s.to.x - s.x, dy = ty - s.y, dz = s.to.z - s.z, d = Math.hypot(dx, dy, dz), step = s.speed * dt;
      if (!s.to.alive) { s.alive = false; continue; } if (d <= step + 0.3) { s.alive = false; damage(s.to, s.dmg, s.from); } else { s.x += (dx / d) * step; s.y += (dy / d) * step; s.z += (dz / d) * step; } }
    for (let i = shots.length - 1; i >= 0; i--) if (!shots[i].alive) shots.splice(i, 1);
    for (let i = ents.length - 1; i >= 0; i--) { const e = ents[i]; if (!e.alive && ((e.kind === "melee" || e.kind === "ranged") ? sim.time - e.deadAt > 4 : e.kind === "monster" && sim.time - e.deadAt > 8)) ents.splice(i, 1); }
    // 英雄：自然涨钱；回血回蓝，在自己出生点回得很快；站进对方出生点会被烧；阵亡后倒计时复活；有时限的增益到点失效
    for (const e of ents) { const h = e.h; if (!h) continue; h.gold += RULES.goldPerSec * dt; const mine = fountain[e.team], foe = fountain[1 - e.team];
      if (h.quest && h.quest.ch < RULES.sup.charges && (h.quest.t += dt) >= RULES.sup.every) { h.quest.t = 0; h.quest.ch++; }      // 辅助任务回一层
      for (const [id, v] of h.mods) { v.left -= dt; if (v.left <= 0) { h.mods.delete(id); recalc(e); v.end?.(); } }
      if (e.alive) { const home = Math.hypot(e.x - mine[0], e.z - mine[1]) < RULES.fountainR;
        e.hp = Math.min(e.max, e.hp + e.max * (home ? 0.14 : h.stat.hpRegen * RULES.regen[sim.time - e.hurtAt > 5 ? 1 : 0]) * dt); h.mana = Math.min(h.stat.mana, h.mana + h.stat.mana * (home ? 0.16 : h.stat.manaRegen) * dt);
        if (Math.hypot(e.x - foe[0], e.z - foe[1]) < RULES.fountainR) damage(e, 520 * dt, null, { type: "true" }); }
      else if (h.respawnIn > 0) { h.respawnIn -= dt; if (h.respawnIn <= 0) { const slot = Math.hypot(e.hx - mine[0], e.hz - mine[1]) < RULES.fountainR - 1;      // 第九轮：五个人各回自己出生的那一格（一起阵亡的不叠在出生点正中）；出生在别处的（测试场、?hero=）回出生点正中
        e.alive = true; e.hp = e.max; h.mana = h.stat.mana; e.x = slot ? e.hx : mine[0]; e.z = slot ? e.hz : mine[1]; e.hurtAt = -9; e.invis = false; e.untarget = false; events.push({ t: "respawn", e });
        for (const id of ["beast", "troll"] as const) { const left = sim.teamBuff[id][e.team as 0 | 1] - sim.time; if (left > 1) giveBuff(e, id, left); } } } }      // 队伍的 Boss 增益还在：复活以后接着有
    // 视野：对方的小兵只有在我方单位的视野里才看得见；躲在草丛里的要贴近了才看得见。每秒算八次
    seeT -= dt; if (seeT <= 0) { seeT = 0.125; const eyes = [0, 1].map(tm => ents.filter(e => e.alive && e.team === tm && e.sight > 0));
      for (const e of ents) { if (e.kind === "tower" || e.kind === "core") { e.seen = e.seen1 = true; continue; } if (!e.alive) continue; const hid = sample(e.x, e.z).brush;
        const see = (tm: number) => e.team === tm || (!e.invis && eyes[tm].some(a => { const d = Math.hypot(a.x - e.x, a.z - e.z); return d < (hid ? Math.min(a.sight, 3.5) : a.sight); }));
        e.seen = sim.reveal || see(0); e.seen1 = see(1); } }
  }
  return sim;
}
