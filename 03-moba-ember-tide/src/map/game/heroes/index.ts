// 英雄名册：id 对应到技能文件。加一个英雄：写 heroes/<id>.ts，在这里登记一行；模型和动作时间表放 public/assets/hero/<id>.glb、<id>.json。
//
// 第九轮（5v5）：名册里十个英雄，五个位置各两个。英雄的阵营（side）只决定造型和特效颜色，和这一局在哪一队无关——任何英雄都能在任何一队，
// 一队之内不重复，两队之间可以撞（照 LoL 的匹配模式，排两队的代码在 lineup.ts）。
// 能不能选是数据决定的：KITS 里登记了技能的就能选、电脑也会用；只在 SOON 里有名字的显示“即将上线”。第三批写好卡兹、赫达、乌戈、塞伦的技能以后，
// 在 KITS 里加一行，SOON 里那一行留着也不碍事（KITS 优先）。
import type { HeroKit } from "../skills";
import { lan } from "./lan";
import { gorran } from "./gorran";
import { vero } from "./vero";
import { osen } from "./osen";
import { moko } from "./moko";
import { torg } from "./torg";
import { hedda } from "./hedda";
import { ugo } from "./ugo";
import { kaz } from "./kaz";
import { seren } from "./seren";
import { iti } from "./iti";      // 第四阶段 iti-kit：新刺客伊缇

export const KITS: Record<string, HeroKit> = { lan, gorran, vero, osen, moko, torg, hedda, ugo, kaz, seren, iti };

/** 五个位置（照 LoL 的分法）：上单走上路、打野在野区、中单走中路、射手和辅助一起走下路 */
export type Pos = "top" | "jungle" | "mid" | "adc" | "sup";
/** 位置的顺序：选人的栏位、顶栏的头像、计分板、载入画面都按这个排 */
export const POS: Pos[] = ["top", "jungle", "mid", "adc", "sup"];
export const POS_NAME: Record<Pos, string> = { top: "上单", jungle: "打野", mid: "中单", adc: "射手", sup: "辅助" };
/** 每个位置走哪条线：0 中、1 上、2 下（和 sim 的兵线编号一样）；打野是 -1，不走线 */
export const POS_LANE: Record<Pos, number> = { top: 1, jungle: -1, mid: 0, adc: 2, sup: 2 };
/** 位置的图标（uikit.ts 的 ICON 里的名字）：射手用下路的图标，辅助用“游走” */
export const POS_ICON: Record<Pos, string> = { top: "上单", jungle: "打野", mid: "中路", adc: "下路", sup: "游走" };
export const isPos = (v: unknown): v is Pos => typeof v === "string" && (POS as string[]).includes(v);

/** 名册：十个英雄的主位置（顺序就是选人界面里的顺序：按位置排，同一个位置先沉月会再烬誓庭） */
export const ROSTER: { id: string; pos: Pos }[] = [
  { id: "torg", pos: "top" }, { id: "gorran", pos: "top" },
  { id: "lan", pos: "jungle" }, { id: "kaz", pos: "jungle" },
  { id: "ugo", pos: "mid" }, { id: "osen", pos: "mid" }, { id: "iti", pos: "mid" },      // 伊缇（第四阶段）：中路刺客，中单变成三个
  { id: "seren", pos: "adc" }, { id: "vero", pos: "adc" },
  { id: "moko", pos: "sup" }, { id: "hedda", pos: "sup" },
];
/** 技能代码还没写的英雄：名册和选人界面只要这几项（设计在 docs/round9/heroes/DESIGN.md） */
export interface HeroInfo { id: string; name: string; title: string; role: string; side: 0 | 1; color: number; }
const SOON: Record<string, HeroInfo> = {
  kaz: { id: "kaz", name: "卡兹", title: "焚爪", role: "斗士", side: 1, color: 0xd8432a },      // 设计里写的是“猛兽”：更肉、会单挑、没有隐身，职业分类里归斗士
  ugo: { id: "ugo", name: "乌戈", title: "渊灯", role: "法师", side: 0, color: 0x7c8cff },
  seren: { id: "seren", name: "塞伦", title: "珠铳", role: "射手", side: 0, color: 0xf07c5e },
  hedda: { id: "hedda", name: "赫达", title: "缚钳", role: "辅助", side: 1, color: 0xffc864 },
};

/** 名册里所有英雄（含即将上线的） */
export const ALL = ROSTER.map(r => r.id);
/** 能选的英雄（有技能代码的），按名册的顺序 */
export const ORDER = ALL.filter(id => KITS[id]);
export const canPick = (id: string) => !!KITS[id];
/** 名字、称号、职业、阵营、颜色：有技能代码的从 kit 里拿，没有的从 SOON 里拿 */
export const infoOf = (id: string): HeroInfo | undefined => KITS[id] ?? SOON[id];
/** 英雄的主位置（不在名册里的按中单算） */
export const posOf = (id: string): Pos => ROSTER.find(r => r.id === id)?.pos ?? "mid";
export const kitOf = (id: string): HeroKit => KITS[id] ?? lan;
