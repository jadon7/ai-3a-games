// 装备（第九轮重做，第 6 条意见：“道具太少，每个道具会有升级过程，有被动，放到特定职业上效果更适合”）。
// 结构照 LoL / Dota 2：三层合成。
//   基础件（300–400）：一项属性，直接买。
//   进阶件（850–1150）：两件基础件加一点合成费，属性组合或者一个小被动；鞋子的进阶也在这一层。
//   成装（2400–3200）：两三件配件加合成费，带一个有特色的被动。坦克、斗士、刺客、法师、射手、辅助各三件“本命装”。
// 买卖的规矩照 LoL：站在自己出生点里（或者阵亡的时候）才能买卖；最多六格；买成装时自动用掉身上已有的配件、只付差价（配件不在身上就往下一层找它的配件）；
// 卖掉退总价的六成；只能带一双鞋。
// 价钱按现在的经济定的（见 docs/round9/items/ITEMS.md 的“经济”一节）：一局 15–25 分钟，核心位 15 分钟一件成装加鞋，25 分钟三件左右。
// 被动的实现在 items_fx.ts；这里只有数据、买卖和电脑的买法。

import { RULES, type Ent, type Mod, type Sim } from "./sim";

export type Role = "坦克" | "斗士" | "刺客" | "法师" | "射手" | "辅助";
export type Tag = "攻击" | "法术" | "防御" | "辅助" | "鞋子";
/** 规则（sim.ts 的 Stats）里没有、由 items_fx.ts 算的几项：攻速（百分比，几件相加，不连乘）、暴击率、暴击伤害加成、护甲穿透、法术穿透（点数和百分比）、韧性 */
export interface ItemEx { as?: number; crit?: number; critDmg?: number; apen?: number; mpen?: number; mpenPct?: number; ten?: number; }
export interface Item {
  id: string; name: string;
  cost: number;                     // 总价（连配件一起）。从配件合成时只付差价，见 plan()
  tier: 1 | 2 | 3; tag: Tag; from?: string[];      // tier：1 基础、2 进阶、3 成装；from：由哪几件合成（界面的合成路线读这个）
  mod: Mod; ex?: ItemEx;
  desc: string;                     // 属性，一项一句，用“，”隔开（商店里拆成几行）
  passive?: { name: string; text: string };
  roles?: Role[]; fit?: string;     // 适合哪些职业（第一个是主要的）；fit 是写给玩家看的一句“适合谁”
  boots?: boolean; lore?: string;
}

export const ITEMS: Item[] = [
  // ---- 基础件 ----
  { id: "blade", name: "潮铁短刃", cost: 350, tier: 1, tag: "攻击", mod: { ad: 20 }, desc: "+20 攻击", lore: "沉月会的铁匠用退潮时露出来的黑铁打的，刃口常年带着水腥气。" },
  { id: "bow", name: "连枝弩机", cost: 350, tier: 1, tag: "攻击", mod: {}, ex: { as: 0.12 }, desc: "+12% 攻速", lore: "弩臂上缠着活的藤枝，上弦的力气有一半是它出的。" },
  { id: "fang", name: "鲸牙吊坠", cost: 350, tier: 1, tag: "攻击", mod: { ls: 0.06 }, desc: "+6% 普攻吸血", lore: "老捕鲸人说，鲸牙记得每一口咬下去的血。" },
  { id: "tome", name: "烛油手卷", cost: 400, tier: 1, tag: "法术", mod: { ap: 35 }, desc: "+35 法强", lore: "烛语者抄经时滴满蜡油的手卷，字已经糊了，念出来还管用。" },
  { id: "vial", name: "潮汐泪瓶", cost: 300, tier: 1, tag: "法术", mod: { mana: 250 }, desc: "+250 法力", lore: "瓶里的海水跟着月亮涨落，涨潮的时候摸上去是温的。" },
  { id: "charm", name: "引潮护符", cost: 300, tier: 1, tag: "辅助", mod: { cdr: 0.06 }, desc: "+6% 冷却缩减", lore: "引潮人出海前都会带一枚，螺口朝里。" },
  { id: "coral", name: "红珊瑚坠", cost: 400, tier: 1, tag: "防御", mod: { hp: 350 }, desc: "+350 生命", lore: "深水里长了三百年的红珊瑚，断口还会慢慢长回去。" },
  { id: "plate", name: "砧铁胸甲", cost: 300, tier: 1, tag: "防御", mod: { armor: 25 }, desc: "+25 护甲", lore: "照着砧卫的铁砧打的胸甲，挨了打会响。" },
  { id: "cloak", name: "鳞织斗篷", cost: 300, tier: 1, tag: "防御", mod: { mr: 25 }, desc: "+25 魔抗", lore: "深水大鱼的鳞一片片缝起来的，法术落在上面会滑开。" },
  { id: "boots", name: "轻潮靴", cost: 300, tier: 1, tag: "鞋子", boots: true, mod: { ms: 0.6 }, desc: "+0.6 移速", lore: "踩水不沉的皮靴，跑起来脚边带一点浪。" },

  // ---- 进阶件 ----
  { id: "edge", name: "裂甲锥", cost: 900, tier: 2, tag: "攻击", from: ["blade", "blade"], mod: { ad: 30 }, ex: { apen: 12 }, desc: "+30 攻击，+12 护甲穿透", roles: ["刺客"], fit: "刺客：三件刺客装都从它合成", lore: "三面开槽的锥子，专找甲片的缝。" },
  { id: "great", name: "鲸骨重剑", cost: 1050, tier: 2, tag: "攻击", from: ["blade", "coral"], mod: { ad: 25, hp: 300 }, desc: "+25 攻击，+300 生命",
    passive: { name: "涨潮", text: "普攻命中后 2 秒内移速 +0.5（远程英雄 +0.25）" }, roles: ["斗士"], fit: "斗士：贴身打的", lore: "一整根鲸肋磨出来的大剑，砍中的时候像涨潮。" },
  { id: "zeal", name: "黄铜瞄镜", cost: 1000, tier: 2, tag: "攻击", from: ["bow", "bow"], mod: { ms: 0.3 }, ex: { as: 0.15, crit: 0.1 }, desc: "+15% 攻速，+10% 暴击，+0.3 移速", roles: ["射手"], fit: "射手：靠普攻输出的", lore: "烬誓庭的镜匠磨的镜片，看得见三百步外箭靶上的钉子。" },
  { id: "vamp", name: "赤珊钩", cost: 950, tier: 2, tag: "攻击", from: ["blade", "fang"], mod: { ad: 22, ls: 0.1 }, desc: "+22 攻击，+10% 普攻吸血", roles: ["射手", "斗士"], fit: "射手、斗士：要靠普攻续航的", lore: "骨钩上嵌的珊瑚是红的，挂过东西以后会更红。" },
  { id: "forge", name: "炉火刻印", cost: 900, tier: 2, tag: "攻击", from: ["vial", "charm"], mod: { mana: 250, cdr: 0.08 }, desc: "+250 法力，+8% 冷却缩减",
    passive: { name: "淬火", text: "放技能后 10 秒内，下一次普攻额外造成 100% 基础攻击的物理伤害（冷却 1.5 秒）" }, roles: ["斗士"], fit: "斗士：技能和普攻穿插着打的", lore: "炉匠在新兵的护手上烙的印，烧红一次能记住一辈子。" },
  { id: "orb", name: "月潮珠", cost: 950, tier: 2, tag: "法术", from: ["tome", "vial"], mod: { ap: 40, mana: 250, cdr: 0.08 }, desc: "+40 法强，+250 法力，+8% 冷却缩减", roles: ["法师", "辅助"], fit: "法师、辅助：技能放得勤的", lore: "珠子里封着一小片不肯退的潮。" },
  { id: "rod", name: "黑铁法杖", cost: 1100, tier: 2, tag: "法术", from: ["tome", "tome"], mod: { ap: 80 }, desc: "+80 法强", roles: ["法师"], fit: "法师", lore: "杖芯里封着一块没烧完的炭，握久了手心发烫。" },
  { id: "heart", name: "沉钟之心", cost: 1050, tier: 2, tag: "防御", from: ["coral", "coral"], mod: { hp: 800, hpRegen: 0.002 }, desc: "+800 生命，生命恢复 +0.2%/秒", roles: ["坦克", "斗士"], fit: "坦克、斗士", lore: "沉在海底的那口钟还在跳。" },
  { id: "mail", name: "铆钉锁甲", cost: 850, tier: 2, tag: "防御", from: ["plate", "plate"], mod: { armor: 45 }, desc: "+45 护甲",
    passive: { name: "倒刺", text: "被普攻时，对攻击者造成 15 + 10% 护甲的魔法伤害" }, roles: ["坦克"], fit: "坦克：顶在前面挨打的", lore: "每一颗铆钉都磨尖了，抱上来的人自己会松手。" },
  { id: "scale", name: "珊瑚鳞甲", cost: 950, tier: 2, tag: "防御", from: ["cloak", "coral"], mod: { mr: 30, hp: 300 }, desc: "+30 魔抗，+300 生命",
    passive: { name: "回潮", text: "受到英雄伤害后 5 秒内，生命恢复 +1%/秒" }, roles: ["坦克", "辅助"], fit: "坦克、辅助：对面法师多的时候", lore: "珊瑚片一层压一层，像退潮后露出来的礁。" },
  { id: "conch", name: "引潮铜铃", cost: 950, tier: 2, tag: "辅助", from: ["coral", "charm"], mod: { hp: 300, cdr: 0.1 }, desc: "+300 生命，+10% 冷却缩减", roles: ["辅助", "刺客"], fit: "辅助、刺客：靠技能吃饭的", lore: "铃声能传到水下，鱼群听见会掉头。" },

  // ---- 鞋子（基础鞋 → 五种进阶鞋，只能带一双） ----
  { id: "boots_as", name: "疾潮靴", cost: 950, tier: 2, tag: "鞋子", boots: true, from: ["boots", "bow"], mod: { ms: 0.8 }, ex: { as: 0.2 }, desc: "+0.8 移速，+20% 攻速", roles: ["射手"], fit: "射手", lore: "黄铜护胫里装着簧片，每一步都往前弹一下。" },
  { id: "boots_ar", name: "铁砧靴", cost: 950, tier: 2, tag: "鞋子", boots: true, from: ["boots", "plate"], mod: { ms: 0.8, armor: 25 }, desc: "+0.8 移速，+25 护甲",
    passive: { name: "砧面", text: "受到的普攻伤害减少 10%（防御塔的除外）" }, roles: ["坦克", "斗士", "刺客"], fit: "坦克、斗士、刺客：对面普攻的多", lore: "鞋底是一整块铁砧，站定了谁也推不动。" },
  { id: "boots_mr", name: "缚潮靴", cost: 950, tier: 2, tag: "鞋子", boots: true, from: ["boots", "cloak"], mod: { ms: 0.8, mr: 25 }, ex: { ten: 0.3 }, desc: "+0.8 移速，+25 魔抗，+30% 韧性", roles: ["斗士", "坦克", "辅助"], fit: "斗士、坦克、辅助：对面控制多的", lore: "鱼鳞编的靴面，绳子套上来会滑脱。" },
  { id: "boots_ap", name: "烛影靴", cost: 1000, tier: 2, tag: "鞋子", boots: true, from: ["boots"], mod: { ms: 0.8 }, ex: { mpen: 12 }, desc: "+0.8 移速，+12 法术穿透", roles: ["法师"], fit: "法师", lore: "脚踝上挂着一盏小烛灯，走过的地方影子会慢半拍。" },
  { id: "boots_cd", name: "潮行靴", cost: 950, tier: 2, tag: "鞋子", boots: true, from: ["boots", "charm"], mod: { ms: 0.9, cdr: 0.12 }, desc: "+0.9 移速，+12% 冷却缩减", roles: ["刺客", "辅助", "法师"], fit: "刺客、辅助、法师：技能比普攻要紧的", lore: "靴边的鳍是活的，顺着潮走能快一倍。" },

  // ---- 成装 · 坦克 ----
  { id: "furnace", name: "黑铁炉壁", cost: 2500, tier: 3, tag: "防御", from: ["heart", "mail"], mod: { hp: 850, armor: 45 }, desc: "+850 生命，+45 护甲",
    passive: { name: "炉膛", text: "每秒对身边 3.5 米内的敌人造成 20 + 1% 最大生命的魔法伤害（对野怪多五成）" }, roles: ["坦克", "斗士"], fit: "坦克：贴着人站、在兵堆里扛线的；血越厚烧得越疼", lore: "砧卫把炉门拆下来当盾背着，走到哪儿哪儿就是炉膛。" },
  { id: "thorn", name: "鲸骨棘甲", cost: 2400, tier: 3, tag: "防御", from: ["mail", "coral", "plate"], mod: { armor: 80, hp: 350 }, desc: "+80 护甲，+350 生命",
    passive: { name: "倒刺", text: "被普攻时，对攻击者造成 30 + 25% 护甲的魔法伤害（对小兵和野怪减半）；打你的英雄攻速降低 20%，持续 2 秒" }, roles: ["坦克", "辅助"], fit: "坦克：专克对面的射手和普攻型刺客", lore: "甲面上倒插着一排鲸骨刺，抱住它的东西都没再松开过——是松不开。" },
  { id: "bulwark", name: "沉钟壁垒", cost: 2700, tier: 3, tag: "防御", from: ["scale", "heart"], mod: { mr: 55, hp: 950 }, ex: { ten: 0.2 }, desc: "+55 魔抗，+950 生命，+20% 韧性",
    passive: { name: "钟鸣", text: "被眩晕、定身、嘲讽、击飞时，获得 12% 最大生命的护盾，持续 3 秒（冷却 18 秒）" }, roles: ["坦克", "斗士", "辅助"], fit: "坦克、斗士：冲进去开团、先吃控制的", lore: "整口沉钟改成的盾，挨一下就响一声，响声里有它的回音。" },
  // ---- 成装 · 斗士（上单） ----
  { id: "tide", name: "鲸骨潮斩", cost: 2700, tier: 3, tag: "攻击", from: ["great", "vamp"], mod: { ad: 50, hp: 350, ls: 0.1 }, desc: "+50 攻击，+350 生命，+10% 普攻吸血",
    passive: { name: "浪斩", text: "普攻命中时，目标身边 3 米内的其他敌人受到 40% 攻击力的物理伤害（远程英雄 20%）" }, roles: ["斗士", "刺客"], fit: "斗士：近战、站在人堆里砍的；清兵、打野也快", lore: "整根鲸脊磨成的刀，砍下去的时候连浪一起劈开。" },
  { id: "trinity", name: "炉心三锻", cost: 2800, tier: 3, tag: "攻击", from: ["forge", "great", "bow"], mod: { ad: 35, hp: 300, cdr: 0.12 }, ex: { as: 0.15 }, desc: "+35 攻击，+300 生命，+15% 攻速，+12% 冷却缩减",
    passive: { name: "三锻", text: "放技能后 10 秒内，下一次普攻额外造成 160% 基础攻击的物理伤害（冷却 1.5 秒）；普攻命中后 2 秒内移速 +0.6" }, roles: ["斗士", "刺客"], fit: "斗士：放一个技能接一下普攻的打法", lore: "红铁、黄铜、白蜡三样一起锻，锤一下换一种火。" },
  { id: "anchor", name: "沉锚", cost: 2700, tier: 3, tag: "攻击", from: ["great", "heart"], mod: { ad: 45, hp: 800 }, desc: "+45 攻击，+800 生命",
    passive: { name: "锚定", text: "受到伤害后生命低于 35% 时，获得 25% 最大生命的护盾，持续 4 秒，期间韧性 +30%（冷却 45 秒）" }, roles: ["斗士", "射手", "刺客"], fit: "斗士：冲在前面又要打输出的；射手、刺客的保命装", lore: "沉月会的船从不翻：锚落下去，海就停了。" },
  // ---- 成装 · 刺客（打野） ----
  { id: "ambush", name: "暗潮獠牙", cost: 2500, tier: 3, tag: "攻击", from: ["edge", "blade", "blade"], mod: { ad: 65 }, ex: { apen: 18 }, desc: "+65 攻击，+18 护甲穿透",
    passive: { name: "伏击", text: "4 秒内没有伤害过敌方英雄时，对英雄造成的下一次伤害额外附带 80 + 40% 额外攻击的物理伤害（冷却 8 秒）" }, roles: ["刺客"], fit: "刺客：从草里、迷雾里摸出来打第一下的", lore: "潮水退下去的时候，礁石缝里有东西在等。" },
  { id: "hunter", name: "裂潮猎刃", cost: 2500, tier: 3, tag: "攻击", from: ["edge", "conch"], mod: { ad: 45, hp: 300, cdr: 0.12 }, ex: { apen: 12 }, desc: "+45 攻击，+300 生命，+12% 冷却缩减，+12 护甲穿透",
    passive: { name: "猎杀", text: "击杀或助攻敌方英雄后，立刻刷新 Q、W、E 的冷却，3 秒内移速 +30%" }, roles: ["刺客", "斗士"], fit: "刺客：一套技能杀一个、马上找下一个的", lore: "刀柄上的鳍护手是从一条活鲨身上取的，它到现在还在追猎物。" },
  { id: "reaper", name: "断首弯刀", cost: 2600, tier: 3, tag: "攻击", from: ["edge", "zeal"], mod: { ad: 45, ms: 0.3 }, ex: { apen: 15, as: 0.15, crit: 0.15 }, desc: "+45 攻击，+15 护甲穿透，+15% 攻速，+15% 暴击，+0.3 移速",
    passive: { name: "断首", text: "把敌方英雄打到 6% 生命以下时，直接斩杀" }, roles: ["刺客", "射手"], fit: "刺客、射手：收残血的", lore: "烬誓庭的行刑刀，黄铜刀背上刻着每一个名字。" },
  // ---- 成装 · 法师 ----
  { id: "staff", name: "千烛权杖", cost: 3200, tier: 3, tag: "法术", from: ["rod", "rod"], mod: { ap: 160, apMul: 1.3 }, desc: "+160 法强",
    passive: { name: "烛海", text: "法强提高 30%（连其它装备、增益的一起算）" }, roles: ["法师", "辅助"], fit: "法师：已经有一两件法强装、要把伤害堆上去的", lore: "杖头的蜡烛谁也数不清有多少根，灭一根就再长一根。" },
  { id: "ember", name: "余烬法典", cost: 2600, tier: 3, tag: "法术", from: ["rod", "tome", "coral"], mod: { ap: 115, hp: 350 }, desc: "+115 法强，+350 生命",
    passive: { name: "余烬", text: "技能命中敌人后点燃 3 秒，每秒造成 20 + 1.2% 目标最大生命的魔法伤害（对野怪每秒最多 80）" }, roles: ["法师", "辅助"], fit: "法师：范围技能多、打持续伤害的；越打坦克越疼", lore: "书页烧了几百年也烧不完，翻开哪一页都是热的。" },
  { id: "abyss", name: "沉渊之眼", cost: 2700, tier: 3, tag: "法术", from: ["orb", "rod"], mod: { ap: 110, mana: 250, cdr: 0.1 }, ex: { mpenPct: 0.25 }, desc: "+110 法强，+250 法力，+10% 冷却缩减，+25% 法术穿透",
    passive: { name: "回响", text: "技能命中英雄时，对他和身边 5 米内另外 2 个敌人各造成 70 + 15% 法强的魔法伤害（冷却 6 秒）" }, roles: ["法师"], fit: "法师：一套技能打爆发的", lore: "深渊里睁开的那只眼，看见谁，谁就听见回声。" },
  // ---- 成装 · 射手 ----
  { id: "inferno", name: "烬焰连弩", cost: 2800, tier: 3, tag: "攻击", from: ["zeal", "blade", "blade"], mod: { ad: 55, ms: 0.3 }, ex: { as: 0.15, crit: 0.2, critDmg: 0.5 }, desc: "+55 攻击，+15% 攻速，+20% 暴击，+0.3 移速",
    passive: { name: "爆燃", text: "普攻暴击的伤害从 175% 提高到 225%" }, roles: ["射手"], fit: "射手：站在后排一直普攻的", lore: "弩槽里烧着炉火，射出去的不是箭，是一截火。" },
  { id: "harpoon", name: "鲸弦急射", cost: 2700, tier: 3, tag: "攻击", from: ["zeal", "bow", "blade"], mod: { ad: 30, ms: 0.3 }, ex: { as: 0.3, crit: 0.1 }, desc: "+30 攻击，+30% 攻速，+10% 暴击，+0.3 移速",
    passive: { name: "三连", text: "每第三次普攻额外造成 50 + 50% 额外攻击的真实伤害" }, roles: ["射手"], fit: "射手：攻速快的；专打肉", lore: "鲸骨鱼叉配鲸须做的弦，第三下总是扎得最深。" },
  { id: "fury", name: "怒潮弩机", cost: 2600, tier: 3, tag: "攻击", from: ["vamp", "bow", "bow"], mod: { ad: 35, ls: 0.1 }, ex: { as: 0.3 }, desc: "+35 攻击，+30% 攻速，+10% 普攻吸血",
    passive: { name: "渐狂", text: "普攻命中后攻速 +6%，最多 6 层，3 秒不打就清空；叠满时普攻额外造成 30 + 15% 额外攻击的魔法伤害" }, roles: ["射手", "斗士"], fit: "射手：打持久战的", lore: "弩臂上的火越打越旺，停下来就灭。" },
  // ---- 成装 · 辅助 ----
  { id: "locket", name: "潮信法螺", cost: 2400, tier: 3, tag: "辅助", from: ["conch", "scale"], mod: { hp: 550, mr: 30, cdr: 0.1 }, desc: "+550 生命，+30 魔抗，+10% 冷却缩减",
    passive: { name: "护潮", text: "身边 9 米内的友方英雄（包括自己）生命降到 40% 以下时，给他套上 180 + 25×等级的护盾，持续 3 秒（冷却 20 秒）" }, roles: ["辅助", "坦克"], fit: "辅助：跟着队友、替他挡一下的", lore: "螺壳里藏着一段潮信，吹开了，潮水就替人挡一下。" },
  { id: "horn", name: "涌浪号角", cost: 2400, tier: 3, tag: "辅助", from: ["orb", "conch"], mod: { ap: 50, hp: 250, mana: 250, cdr: 0.15 }, desc: "+50 法强，+250 生命，+250 法力，+15% 冷却缩减",
    passive: { name: "涌浪", text: "放技能时，身边 8 米内的其他友方英雄获得 25% 攻速和 +0.8 移速，持续 4 秒（冷却 8 秒）" }, roles: ["辅助"], fit: "辅助：身边跟着射手、刺客的", lore: "号角一响，浪就往前推，人也跟着往前。" },
  { id: "banner", name: "黄铜战旗", cost: 2400, tier: 3, tag: "辅助", from: ["mail", "scale"], mod: { armor: 45, mr: 30, hp: 350 }, desc: "+45 护甲，+30 魔抗，+350 生命",
    passive: { name: "庇护（光环）", text: "身边 10 米内的其他友方英雄护甲 +15、魔抗 +15" }, roles: ["辅助", "坦克"], fit: "辅助、坦克：抱团打架的时候", lore: "烬誓庭行军时立在最前面的那面旗，旗下的人不退。" },
];
const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
export const itemOf = (id: string) => BY_ID.get(id);
/** 由这件装备合成的那些（“可以合成”） */
export const intoOf = (id: string) => ITEMS.filter(i => i.from?.includes(id));

// ---- 出装：每个英雄（没写的按职业） ----
// 第一件成装、进阶鞋、第二件……共六格。电脑照这个顺序买；商店里“推荐”一栏也是这一份
export const ROLE_BUILD: Record<Role, string[]> = {
  坦克: ["furnace", "boots_ar", "bulwark", "thorn", "banner", "anchor"],
  斗士: ["trinity", "boots_mr", "tide", "anchor", "bulwark", "thorn"],
  刺客: ["ambush", "boots_cd", "hunter", "reaper", "anchor", "bulwark"],
  法师: ["abyss", "boots_ap", "ember", "staff", "bulwark", "locket"],
  射手: ["inferno", "boots_as", "harpoon", "fury", "anchor", "bulwark"],
  辅助: ["horn", "boots_cd", "locket", "banner", "bulwark", "thorn"],
};
export const BUILDS: Record<string, string[]> = {
  lan: ["ambush", "boots_cd", "hunter", "reaper", "anchor", "bulwark"],          // 刺客：先伏击（爆发），再猎杀（连着收人头）
  kaz: ["hunter", "boots_ar", "tide", "ambush", "anchor", "bulwark"],            // 猛兽打野：贴身久一点，先猎杀、潮斩
  iti: ["ambush", "boots_cd", "hunter", "reaper", "anchor", "bulwark"],          // 伊缇（第四阶段）：中路刺客，照岚出（伏击打第一下、猎杀刷新接着找下一个）
  torg: ["trinity", "boots_mr", "tide", "anchor", "bulwark", "thorn"],           // 斗士：Q、R 吃攻击，横扫一下接一下普攻
  gorran: ["furnace", "boots_ar", "bulwark", "thorn", "anchor", "banner"],       // 坦克：冲进去烧、挨打反伤
  osen: ["abyss", "boots_ap", "ember", "staff", "bulwark", "locket"],            // 法师：先回响打爆发，再余烬烧肉
  ugo: ["ember", "boots_ap", "abyss", "staff", "bulwark", "locket"],
  vero: ["inferno", "boots_as", "harpoon", "fury", "anchor", "bulwark"],         // 射手
  seren: ["harpoon", "boots_as", "inferno", "fury", "anchor", "bulwark"],        // 普攻射手：攻速先行
  moko: ["horn", "boots_cd", "locket", "banner", "staff", "bulwark"],            // 奶妈：技能放得勤，给队友加速、套盾
  hedda: ["locket", "boots_mr", "banner", "horn", "bulwark", "thorn"],           // 开团辅助：先抗住
};
export const buildFor = (id: string, role?: string): string[] => BUILDS[id] ?? ROLE_BUILD[role as Role] ?? ROLE_BUILD.斗士;

/** 现在能不能买卖：在自己出生点里，或者阵亡着。free 为真时哪里都能买（测试场） */
export const atShop = (sim: Sim, e: Ent, free = false) => free || !e.alive || Math.hypot(e.x - sim.fountain[e.team][0], e.z - sim.fountain[e.team][1]) < RULES.fountainR;
/** 身上的装备变了：把属性重新挂到英雄身上。攻速按百分比相加成一项（几件 +15% 是 +45%，不是连乘） */
function sync(sim: Sim, e: Ent) { const h = e.h!; let as = 0; h.itemMods = h.items.map(id => { const it = itemOf(id)!; as += it.ex?.as ?? 0; return it.mod; }); if (as) h.itemMods.push({ asMul: 1 + as }); sim.recalc(e); }

/** 买 id 时会用掉身上的哪几件（格子下标）、实际要付多少。照 LoL：配方里列的配件身上有就用掉；没有就往下一层找它的配件 */
export function plan(items: string[], id: string): { use: number[]; cost: number } {
  const it = itemOf(id); if (!it) return { use: [], cost: Infinity };
  const used = new Set<number>(); let save = 0;
  const claim = (cid: string) => { const i = items.findIndex((x, k) => x === cid && !used.has(k)); if (i >= 0) { used.add(i); save += itemOf(cid)!.cost; return; } for (const g of itemOf(cid)?.from ?? []) claim(g); };
  for (const c of it.from ?? []) claim(c);
  return { use: [...used].sort((a, b) => a - b), cost: it.cost - save };
}
/** 合成树上哪些配件身上已经有了（界面画合成路线用）：返回“路径 → 有没有”，路径是从根往下的下标，比如 "0"、"1.0" */
export function owned(items: string[], id: string): Set<string> {
  const used = new Set<number>(), got = new Set<string>();
  const walk = (cid: string, path: string) => { const i = items.findIndex((x, k) => x === cid && !used.has(k)); if (i >= 0) { used.add(i); got.add(path); return; } (itemOf(cid)?.from ?? []).forEach((g, j) => walk(g, path + "." + j)); };
  (itemOf(id)?.from ?? []).forEach((c, j) => walk(c, String(j)));
  return got;
}
/** 买不买得了；买不了的话为什么 */
export function check(h: { items: string[]; gold: number }, id: string): { ok: boolean; cost: number; why?: string } {
  const it = itemOf(id); if (!it) return { ok: false, cost: 0, why: "没有这件装备" };
  const p = plan(h.items, id);
  if (h.items.length - p.use.length + 1 > 6) return { ok: false, cost: p.cost, why: "装备栏满了" };
  if (it.boots && h.items.some((x, i) => itemOf(x)?.boots && !p.use.includes(i))) return { ok: false, cost: p.cost, why: "只能带一双鞋" };
  if (h.gold < p.cost) return { ok: false, cost: p.cost, why: `金币不够，还差 ${Math.ceil(p.cost - h.gold)}` };
  return { ok: true, cost: p.cost };
}
/** 买一件。返回买没买成，没买成的原因写在 why 里；cost 是实际付了多少 */
export function buy(sim: Sim, e: Ent, id: string, free = false): { ok: boolean; why?: string; cost?: number } {
  const h = e.h; if (!h || !itemOf(id)) return { ok: false, why: "没有这件装备" };
  if (!atShop(sim, e, free)) return { ok: false, why: "回到出生点才能买" };
  const c = check(h, id); if (!c.ok) return { ok: false, why: c.why };
  const p = plan(h.items, id), at = p.use.length ? p.use[0] : h.items.length, rest = h.items.filter((_, i) => !p.use.includes(i));
  h.gold -= p.cost; rest.splice(Math.min(at, rest.length), 0, id); h.items = rest; sync(sim, e); return { ok: true, cost: p.cost };      // 合成出来的放在第一件配件原来的格子里
}
export function sell(sim: Sim, e: Ent, slot: number, free = false): boolean {
  const h = e.h; if (!h || !h.items[slot] || !atShop(sim, e, free)) return false;
  h.gold += Math.round(itemOf(h.items[slot])!.cost * 0.6); h.items.splice(slot, 1); sync(sim, e); return true;
}

// ---- 电脑怎么买 ----
/** 这一件（成装或进阶件）还缺的配件：合成树上身上没有的节点（任何一层），每个带上现在买它要付多少 */
function missing(items: string[], id: string): { id: string; cost: number }[] {
  const used = new Set<number>(), out: string[] = [];
  const walk = (cid: string) => { const i = items.findIndex((x, k) => x === cid && !used.has(k)); if (i >= 0) { used.add(i); return; } out.push(cid); for (const g of itemOf(cid)?.from ?? []) walk(g); };
  for (const c of itemOf(id)?.from ?? []) walk(c);
  return out.map(c => ({ id: c, cost: plan(items, c).cost }));
}
/** 出装单上下一件要的（身上还没有的第一件）。身上已经有一双进阶鞋了，单子上别的鞋就跳过（只能带一双，不然会卡在那一件上什么都不买） */
export const nextTarget = (items: string[], build: string[]) => { const shod = items.some(x => itemOf(x)?.boots && itemOf(x)!.tier >= 2); return build.find(id => !items.includes(id) && !(shod && itemOf(id)?.boots)) ?? null; };
/** 这一步买什么：钱够就直接合成目标；不够就买缺的配件里买得起的最贵的那件；没鞋而且有闲钱先买双基础鞋。返回 null 是现在什么都买不了 */
export function nextBuy(h: { items: string[]; gold: number }, build: string[]): string | null {
  const t = nextTarget(h.items, build); if (!t) return null;
  if (check(h, t).ok) return t;
  const opts = missing(h.items, t).filter(o => check(h, o.id).ok).sort((a, b) => b.cost - a.cost);
  if (opts[0] && opts[0].cost >= 600) return opts[0].id;      // 先攒进阶件：一次买两件基础件的钱，合成费也一起付了
  if (!h.items.some(x => itemOf(x)?.boots) && build.some(x => itemOf(x)?.boots) && check(h, "boots").ok) return "boots";
  return opts[0]?.id ?? null;
}
/** 电脑在商店里：能买就一直买 */
export function autoBuy(sim: Sim, e: Ent, build: string[]): number {
  let n = 0; for (let i = 0; i < 10; i++) { const id = nextBuy(e.h!, build); if (!id || !buy(sim, e, id).ok) break; n++; } return n;
}
/** 值得专门回家一趟的钱：能把目标合成出来，或者能买下最贵的那件缺的进阶件 */
export function tripCost(items: string[], build: string[]): number {
  const t = nextTarget(items, build); if (!t) return Infinity;
  const full = plan(items, t).cost, mids = missing(items, t).filter(o => itemOf(o.id)!.tier >= 2).map(o => o.cost);
  return Math.min(full, mids.length ? Math.max(...mids) : full);
}

// 测试脚本用（tools/items_test.mjs、对局记录）：买卖、算价钱、装备表
if (typeof window !== "undefined") (window as any).__items = { ITEMS, itemOf, buy, sell, check, plan, nextBuy, autoBuy, buildFor };
