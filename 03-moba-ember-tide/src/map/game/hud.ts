// 对局界面（阶段 7 做的布局，第九轮按“顶流 MOBA”的完成度重做外观）。布局照 LoL / Dota 2 的行业习惯，对标清单见 docs/benchmark.md 第四节（D1 到 D13），
// 第九轮的设计说明在 docs/round9/ui/DESIGN.md（颜色、面板、图标、动效都从 uikit.ts 拿，和主菜单、选人、载入、结算是同一套）：
//   · 底部正中一条（第九轮 ui2 照 LoL 的主次重排，清单见 docs/round9/ui2/GAPS.md）：左边是英雄的 3D 动态头像（主程序把英雄的头单独再画一遍，画在这里留出来的方框里），
//     右下角一枚铜章写等级、外面一圈经验环；栏里是属性（单独一块深色底）、技能（被动加 Q W E R：76 的大格，键位写在格子下沿的铜牌上，耗蓝、冷却转盘和大号数字、
//     没到等级上锁、能放时边框亮铜、大招能放时呼吸光、转好时亮一圈、悬停出说明）、R 右边两个小格（回城 B、商店 P，放在召唤师技能的位置）、
//     下面血条（满一千一道刻度，掉血时后面拖一截浅色的）蓝条；最右六个装备格、下面一整条金币（进账时飘一个 +多少，点开商店）。按 1920 宽设计，别的屏幕整体缩放（--k）。
//   · 顶部正中：两队的头像（血量、阵亡变灰加倒计时、对面不在视野里变淡；按每队五个人排得下）、击杀数、时钟、剩几座塔。
//   · 右上：击杀条（击杀者头像 → 被杀者头像，助攻的小头像，从右边滑进来）；屏幕上方的大字播报（第一滴血、双杀三杀、团灭、Boss、拆塔）。
//   · 左下：小地图（铜边加四个铜花角）。左上：菜单键和自己的战绩。按住 Tab：计分板。按 P 或者点金币：商店（分类、列表、合成路线、详情四块）。
// 画风 B（b-ui）换了皮：面板是深海蓝玻璃 + 亮金描边（原来的黑铁加旧铜压在亮地图上发闷），等级章、分隔条、四角都改成代码画的；手机的摇杆在亮地面上加了深蓝底和白圈；布局、按键、尺寸都没动。
// 颜色有固定的意思（第九轮 ui2 起照 LoL）：队伍色是队友蓝、自己绿、对方红；界面上绿另外表示增益和“已有”，金是钱，法力是偏深的蓝。图标和头像都是图片（public/assets/ui/…），没有图的时候退回名字的第一个字。观战（导播）时不显示底部那一条。
// 每帧更新的东西只改文字、宽度和类名（不重建元素、不读布局），商店和计分板开着的时候才刷新它们。

import type { Play } from "./play";
import type { Ent, Sim, SimEvent } from "./sim";
import { BUFFS, MOBS, RULES } from "./sim";
import type { SkillDef, SkillKey } from "./skills";
import { ITEMS, atShop, buildFor, buy, check, intoOf, itemOf, owned, sell, type Item, type Role } from "./items";
import { itemBadge } from "./items_fx";
import { KITS, POS, POS_NAME, isPos, type Pos } from "./heroes";
import { TOUCH } from "../quality";
import { bindTouch, type Touch } from "./touch";
import { canFullscreen, toggleFullscreen } from "./mobile";
import { sfx } from "./sfx";
import { DIVIDER_URL, ICON, art as artKit, useKit } from "./uikit";

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;z-index:5;font-family:var(--f);color:var(--txt);user-select:none;-webkit-user-select:none;--k:1;--ally:#4fa6f5;--self:#72d957}      /* 第九轮 ui2：对局里队伍色照 LoL，队友（我方）蓝、自己绿、对方红；--k 是桌面版整体缩放（1920 宽为 1） */
.hud *{box-sizing:border-box}
.hud [hidden]{display:none!important}
.hud .ico{position:relative;background:#09101f center/cover no-repeat;display:grid;place-items:center;font-weight:700;color:#cad2dd;overflow:hidden;box-shadow:0 0 0 1px #03060c,inset 0 0 0 1px rgba(255,255,255,.08)}
.hud .ico.has{color:transparent}
.hud .num{font-variant-numeric:tabular-nums}
/* ---- 顶栏（第九轮 ui2）：中间一块盾形铜牌写比分、时钟、剩几座塔；两边是两队的头像，头像下面是血条（队友蓝、自己绿、对方红，照 LoL），每队底下一道队伍色的细线 ---- */
.hud-top{position:absolute;top:0;left:50%;transform:translateX(-50%) scale(var(--k));transform-origin:50% 0;display:flex;align-items:flex-start;filter:drop-shadow(0 4px 10px rgba(4,10,26,.6))}
.hud-top .squad{position:relative;display:flex;gap:4px;padding:5px 6px 10px}.hud-top .squad.me{flex-direction:row-reverse;--tc:var(--ally)}.hud-top .squad.foe{--tc:var(--foe)}
.hud-top .squad::after{content:"";position:absolute;left:4px;right:4px;bottom:2px;height:2px;background:linear-gradient(90deg,transparent,var(--tc) 22%,var(--tc) 78%,transparent);opacity:.7}
.hud-top .hd{position:relative;width:60px;height:53px}
.hud-top .hd .ico{width:60px;height:44px;font-size:18px;background-position:center 18%;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.5),0 0 0 3px #03060c,inset 0 -14px 14px -8px rgba(4,10,26,.7)}
.hud-top .hd.you .ico{box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l),0 0 0 3.5px #03060c,0 0 14px rgba(251,223,158,.4),inset 0 -14px 14px -8px rgba(4,10,26,.7)}
.hud-top .hd u{position:absolute;left:0;right:0;top:47px;height:6px;background:#060a14;box-shadow:0 0 0 1px #03060c}.hud-top .hd u i{display:block;height:100%;background:linear-gradient(#93d0ff,#2a78d2);transition:width .25s}
.hud-top .hd.you u i{background:linear-gradient(#b0f27e,#3a9c2c)}.hud-top .foe .hd u i{background:linear-gradient(#ff8a72,#b8382a)}
.hud-top .hd b{position:absolute;left:0;right:0;top:0;height:44px;display:none;place-items:center;font:800 19px/1 var(--f);color:#fff;text-shadow:0 1px 3px #040a1a}
.hud-top .hd.dead .ico{filter:grayscale(1) brightness(.4)}.hud-top .hd.dead b{display:grid}.hud-top .hd.fog .ico{filter:brightness(.62) saturate(.45)}
.hud-top .hd em{position:absolute;right:-2px;bottom:4px;min-width:17px;height:15px;padding:0 3px;display:grid;place-items:center;background:linear-gradient(#12213e,#070c17);font:800 10.5px/1 var(--f);font-style:normal;color:var(--bz-l);box-shadow:0 0 0 1px #03060c,inset 0 0 0 1px rgba(233,187,79,.55)}
.hud-top .mid{position:relative;isolation:isolate;display:flex;align-items:center;gap:16px;height:62px;padding:0 36px 7px;margin:0 4px;clip-path:polygon(0 0,100% 0,calc(100% - 17px) 74%,50% 100%,17px 74%);background:linear-gradient(180deg,#fdebb8,#dbaa3a 38%,#8c6416)}
.hud-top .mid::before{content:"";position:absolute;inset:0 2px 2.5px;z-index:-1;clip-path:polygon(0 0,100% 0,calc(100% - 15.5px) 73.5%,50% 99%,15.5px 73.5%);background:radial-gradient(120% 80% at 50% 0,rgba(110,160,230,.32),transparent 70%),linear-gradient(180deg,rgba(36,72,130,.96),rgba(16,36,76,.97) 55%,rgba(10,24,56,.98))}
.hud-top .k{font:800 30px/1 var(--f);min-width:1.3em;text-align:center;text-shadow:0 1px 0 #040a1a,0 0 14px var(--g)}.hud-top .k.a{color:#8fcbff;--g:rgba(79,166,245,.45)}.hud-top .k.b{color:#ff9483;--g:rgba(226,88,74,.45)}
.hud-top .clock{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:70px;margin-top:-3px}.hud-top .clock b{font:700 18px/1 var(--f);color:#fff;letter-spacing:.05em;text-shadow:0 1px 0 #040a1a}
.hud-top .clock small{display:flex;align-items:center;gap:4px;padding-top:4px;border-top:1px solid rgba(233,187,79,.28);font:700 11px/1 var(--f);color:#a2b0c4;white-space:nowrap}.hud-top .clock small svg{width:12px;height:12px;color:var(--bz)}
/* ---- 左上：菜单键和战绩 ---- */
.hud-me{position:absolute;left:12px;top:10px;display:flex;gap:10px;align-items:center;pointer-events:auto;font:600 13px/1 var(--f);color:#a3b0c4;transform:scale(var(--k));transform-origin:0 0}
.hud-me button{width:36px;height:36px}
.hud-me span{display:flex;gap:14px;align-items:center;padding:8px 14px 8px 12px;background:linear-gradient(90deg,rgba(8,15,28,.9),rgba(8,15,28,.45));box-shadow:inset 0 -1px 0 rgba(233,187,79,.45),inset 1px 0 0 rgba(233,187,79,.35)}.hud-me span i{display:inline-flex;align-items:center;gap:6px;font-style:normal}.hud-me span svg{width:15px;height:15px;color:var(--bz)}
.hud-me b{color:#ebeff5;font-weight:700}
/* ---- 击杀条和大字播报 ---- */
.hud-feed{position:absolute;right:12px;top:76px;display:flex;flex-direction:column;gap:6px;align-items:flex-end;transform:scale(var(--k));transform-origin:100% 0}
.hud-feed .row{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;transition:opacity .5s;font:600 13px/1 var(--f);background:linear-gradient(90deg,rgba(7,12,23,.2),rgba(8,15,28,.92) 26%);box-shadow:inset -3px 0 0 var(--c,#7d90ac),inset 0 1px 0 rgba(233,187,79,.16),inset 0 -1px 0 rgba(4,10,26,.6);animation:feed-in .32s var(--ez)}
@keyframes feed-in{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
.hud-feed .row.a{--c:var(--ally)}.hud-feed .row.b{--c:var(--foe)}.hud-feed .row.n{--c:#e3c57d}
.hud-feed .ico{width:46px;height:33px;font-size:13px;background-position:center 18%;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.42)}.hud-feed .row>.ico:first-child{box-shadow:0 0 0 1px #03060c,0 0 0 2px var(--c)}
.hud-feed .as .ico{width:24px;height:19px;font-size:10px;box-shadow:0 0 0 1px #03060c,0 0 0 1.5px rgba(233,187,79,.3)}.hud-feed .as{display:flex;gap:3px;opacity:.92;margin-left:-2px}
.hud-feed .x{width:19px;height:19px;color:#f9ecc7;filter:drop-shadow(0 1px 1px #040a1a)}.hud-feed span{white-space:nowrap;color:#dde3ed}
.hud-ann{position:absolute;top:15%;left:50%;transform:translateX(-50%);text-align:center;transition:opacity .6s;white-space:nowrap;animation:ann-in .45s var(--ez)}
@keyframes ann-in{0%{opacity:0;transform:translateX(-50%) scale(1.25)}100%{opacity:1;transform:translateX(-50%) scale(1)}}
.hud-ann h3{margin:0;font:900 40px/1.15 var(--fd);letter-spacing:.26em;padding-left:.26em;text-shadow:0 2px 14px rgba(4,10,26,.9),0 0 2px #040a1a,0 0 30px currentColor}.hud-ann h3.a{color:#b9dcff}.hud-ann h3.b{color:#ffaa98}.hud-ann h3.n{color:#fdf0cc}
.hud-ann p{margin:4px 0 0;font:600 14px/1.4 var(--f);color:#dde3ed;letter-spacing:.08em;text-shadow:0 1px 6px #040a1a}
.hud-ann .ui-div{width:min(460px,60vw);margin:2px auto 0}
.hud-msg{position:absolute;top:27%;left:50%;transform:translateX(-50%);padding:10px 26px;font:600 15px/1.4 var(--f);text-align:center;color:#ffd6cc;background:linear-gradient(90deg,transparent,rgba(60,14,10,.82) 18%,rgba(60,14,10,.82) 82%,transparent);box-shadow:inset 0 1px 0 rgba(226,88,74,.5),inset 0 -1px 0 rgba(226,88,74,.5);letter-spacing:.1em}
/* ---- 底部英雄栏（第九轮 ui2 重排，照 LoL 的主次）：
   左边一块竖的 3D 头像（比栏高出一截，像 Dota），右下角压一枚等级章，章外一圈铜色的经验环；
   栏里从左到右：属性（三行两列）| 被动 + Q W E R（大格，键位写在格子下面的小铜牌上）+ 回城、商店两个小格（放在召唤师技能的位置）、下面血条蓝条 | 六格装备、下面金币。
   1920 宽设计，别的屏幕按 --k 整体缩放（主程序不用管，见 createHud 里的 fit） ---- */
.hud-hero{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;align-items:flex-end;pointer-events:none;transform:scale(var(--k));transform-origin:50% 100%}
.hud-hero>*{pointer-events:auto}
.hb-face{position:relative;z-index:2;width:150px;height:192px;margin-right:-1px;background:transparent center 12%/cover no-repeat;box-shadow:0 0 0 1px #03060c,0 0 0 3px #b18329,0 0 0 4px #03060c,0 10px 26px rgba(4,10,26,.55)}
.hb-face::after{content:"";position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(251,223,158,.5),inset 0 -46px 34px -24px rgba(4,10,26,.7),inset 0 0 24px rgba(4,10,26,.35);pointer-events:none}
.hb-face.dead{background-color:#09101f;filter:grayscale(1) brightness(.5)}
.hb-face .nm{position:absolute;left:-8px;right:-8px;top:-30px;height:25px;font:800 13.5px/25px var(--fd);letter-spacing:.24em;text-align:center;color:var(--pearl);background:linear-gradient(90deg,transparent,rgba(8,15,28,.94) 14%,rgba(8,15,28,.94) 86%,transparent);box-shadow:inset 0 1px 0 rgba(233,187,79,.55),inset 0 -1px 0 rgba(233,187,79,.2);white-space:nowrap;overflow:hidden;text-shadow:0 1px 0 #040a1a}
.hb-lv{position:absolute;right:-26px;bottom:8px;z-index:4;width:56px;height:56px;border-radius:50%;background:radial-gradient(circle at 50% 30%,#3d70b8,#183872 62%,#10285a);box-shadow:0 0 0 1px var(--line),inset 0 0 0 2.5px #efc66a,inset 0 0 0 3.5px rgba(6,19,49,.55),inset 0 4px 0 rgba(255,255,255,.22);display:grid;place-items:center;font:800 19px/1 var(--f);color:#fff6dc;text-shadow:0 1px 2px #061331;filter:drop-shadow(0 2px 5px rgba(4,14,40,.5));--xp:0}
.hb-lv::before{content:"";position:absolute;inset:-5px;border-radius:50%;background:conic-gradient(from 0deg,#ffe08a calc(var(--xp) * 1turn),rgba(8,22,52,.88) 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#040a1a calc(100% - 4.5px));mask:radial-gradient(farthest-side,transparent calc(100% - 5px),#040a1a calc(100% - 4.5px));box-shadow:0 0 0 1px #03060c;pointer-events:none}
.hb-lv.up{animation:lv-up .9s var(--ez)}@keyframes lv-up{0%{transform:scale(1)}25%{transform:scale(1.35);color:#fff;filter:drop-shadow(0 0 12px rgba(255,236,184,.95))}100%{transform:scale(1)}}
.hb-rs{position:absolute;inset:0;display:none;place-items:center;font:900 46px/1 var(--fd);color:#fff;text-shadow:0 2px 6px #040a1a;filter:none}.hb-face.dead .hb-rs{display:grid}
.hb{position:relative;display:flex;align-items:stretch;height:176px;padding:14px 18px 14px 40px}
.hb-crest{position:absolute;left:50%;top:-11px;width:min(440px,60%);transform:translateX(-50%);pointer-events:none;z-index:4}
.hb-stats{align-self:center;display:grid;grid-template-columns:auto auto;gap:0 16px;padding:6px 14px;font:700 14.5px/1 var(--f);color:#d4dce9;background:linear-gradient(180deg,rgba(4,14,36,.42),rgba(4,14,36,.24));border-radius:3px;box-shadow:inset 0 0 0 1px rgba(4,12,30,.5),inset 0 1px 0 rgba(255,255,255,.06),0 1px 0 rgba(255,255,255,.08)}
.hb-stats span{display:flex;gap:9px;align-items:center;justify-content:space-between;height:34px;white-space:nowrap;border-bottom:1px solid rgba(160,200,255,.08)}.hb-stats span:nth-last-child(-n+2){border-bottom:0}
.hb-stats svg{width:17px;height:17px;color:var(--bz);flex:none}.hb-stats b{font-weight:700;min-width:2.6em;text-align:right}
.hb-mid{display:flex;flex-direction:column;justify-content:flex-end;gap:5px;width:572px;padding:0 22px}
.hb-act{display:flex;align-items:flex-start;padding-bottom:13px}
.skills{display:flex;gap:10px;align-items:flex-start}
.sk{position:relative;width:76px;height:76px;padding:0;border:0;cursor:pointer;font:700 24px/1 var(--f);border-radius:0;touch-action:manipulation;outline:0;transition:transform .12s var(--ez),filter .12s,box-shadow .2s}.hud .sk{overflow:visible}      /* 键位的小铜牌挂在格子下沿外面，不能裁掉 */
.sk:not(.p){box-shadow:0 0 0 1px #03060c,0 0 0 2.5px #9b7323,0 0 0 3.5px #03060c,inset 0 0 0 1px rgba(255,255,255,.1),0 7px 14px rgba(4,10,26,.5)}
.sk.ready:not(.p){box-shadow:0 0 0 1px #03060c,0 0 0 2.5px #fad784,0 0 0 3.5px #03060c,0 0 16px rgba(251,223,158,.32),inset 0 0 0 1px rgba(255,249,232,.3),0 7px 14px rgba(4,10,26,.5)}
.sk:not(.p):not(.lock):hover{transform:translateY(-2px);filter:brightness(1.12)}.sk:not(.p):active{transform:translateY(1px) scale(.97)}
.sk.p{width:50px;height:50px;font-size:18px;cursor:default;margin:13px 4px 0 0;border-radius:50%;box-shadow:0 0 0 1px #03060c,0 0 0 2.5px rgba(233,187,79,.6),0 0 0 3.5px #03060c,0 5px 10px rgba(4,10,26,.45)}
.sk kbd{position:absolute;left:50%;bottom:-13px;z-index:5;transform:translateX(-50%);min-width:21px;height:17px;padding:0 5px;display:grid;place-items:center;background:linear-gradient(#182c54,#0a1121);font:800 11.5px/1 var(--f);color:var(--bz-l);box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.6),0 2px 4px rgba(4,10,26,.6)}
.sk .mp{position:absolute;right:4px;bottom:3px;z-index:3;font:800 12px/1 var(--f);color:#a9d4ff;text-shadow:0 0 3px #040a1a,0 0 3px #040a1a,0 1px 2px #040a1a}
.sk .cd{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font:800 28px/1 var(--f);color:#fff;text-shadow:0 1px 4px #040a1a,0 0 10px #040a1a;z-index:2}
.sk .dim{position:absolute;inset:0;pointer-events:none;z-index:1}
.sk.cool .cd{display:flex}.sk.nomana:not(.cool) .dim{background:rgba(20,48,120,.62)}.sk.nomana .mp{color:#ff9a8a}
.sk .lk{position:absolute;inset:0;z-index:3;display:none;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:700 11px/1 var(--f);color:#e2e0d4;background:rgba(6,10,20,.55)}.sk .lk svg{width:19px;height:19px;color:var(--bz)}
.sk.lock{filter:grayscale(1) brightness(.62)}.sk.lock kbd{filter:brightness(.7)}.sk.lock .mp{visibility:hidden}.sk.lock .lk{display:flex}
.sk.aim:not(.p){box-shadow:0 0 0 1px #03060c,0 0 0 3px #fff7e2,0 0 20px rgba(255,244,214,.65)}.sk:focus-visible{box-shadow:0 0 0 2px var(--tide)}
.sk.ready::before{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,rgba(255,247,224,.16),transparent 38%);box-shadow:inset 0 0 14px rgba(251,223,158,.14);pointer-events:none}
.sk.ult.ready{animation:ult-glow 2.4s ease-in-out infinite}@keyframes ult-glow{0%,100%{filter:none}50%{filter:brightness(1.1) drop-shadow(0 0 7px rgba(251,222,153,.55))}}
.sk.flash::after{content:"";position:absolute;inset:-2px;z-index:4;pointer-events:none;animation:ui-ring .55s var(--ez)}
.hb-sub{display:flex;gap:8px;margin:13px 0 0 14px;padding-left:14px;border-left:1px solid rgba(4,10,26,.6);box-shadow:-1px 0 0 rgba(233,187,79,.15)}
.hb-sub button{position:relative;width:50px;height:50px;padding:0;border:0;cursor:pointer;color:#f4e9c9;background:#0a1121 center/cover no-repeat;display:grid;place-items:center;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.5),0 0 0 3px #03060c,0 5px 10px rgba(4,10,26,.45);transition:filter .12s,transform .12s var(--ez)}
.hb-sub button:hover{filter:brightness(1.22);transform:translateY(-1px)}.hb-sub button:active{transform:translateY(1px) scale(.97)}
.hb-sub .rc{background-image:url(/assets/ui/recall.webp)}.hb-sub .sh{background:radial-gradient(circle at 50% 38%,#1d3565,#0a1121 75%)}.hb-sub .sh svg{width:26px;height:26px;color:var(--bz-l)}
.hb-sub kbd{position:absolute;left:50%;bottom:-12px;transform:translateX(-50%);min-width:19px;height:16px;padding:0 4px;display:grid;place-items:center;background:linear-gradient(#182c54,#0a1121);font:800 10.5px/1 var(--f);color:var(--bz-l);box-shadow:0 0 0 1px #03060c,0 0 0 1.5px rgba(233,187,79,.5)}
.bar{position:relative;height:26px;background:#060a14;overflow:hidden;width:100%;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.32)}
.bar i{position:absolute;inset:1px auto 1px 1px;width:100%;max-width:calc(100% - 2px);z-index:1}.bar .lag{z-index:0;background:rgba(255,242,206,.7);transition:width .45s .25s ease-out}
.bar.hp i:not(.lag){background:linear-gradient(#a8ef80,#4cb53a 48%,#2a7c22);box-shadow:inset 0 1px 0 rgba(255,255,255,.42),inset 0 -3px 5px rgba(4,10,26,.25)}
.bar .tk{position:absolute;inset:1px;z-index:2;pointer-events:none;background:repeating-linear-gradient(90deg,transparent 0 calc(var(--t,100%) - 1px),rgba(4,10,26,.5) calc(var(--t,100%) - 1px) var(--t,100%))}
.bar.hp b{position:absolute;top:1px;bottom:1px;width:0;z-index:1;background:linear-gradient(#fff,#b0bbcc)}
.bar.mp{height:16px}.bar.mp i:not(.lag){background:linear-gradient(#86c2fa,#3374d6 55%,#2457a8);box-shadow:inset 0 1px 0 rgba(255,255,255,.36),inset 0 -2px 3px rgba(4,10,26,.25)}
.bar span{position:absolute;inset:0;z-index:3;display:grid;place-items:center;font:700 14px/1 var(--f);letter-spacing:.02em;text-shadow:0 1px 2px #040a1a,0 0 3px rgba(4,10,26,.85)}.bar.mp span{font-size:11.5px}
.bar small{position:absolute;right:8px;top:0;bottom:0;z-index:3;display:grid;place-items:center;font:700 11.5px/1 var(--f);color:#e2f7da;text-shadow:0 1px 2px #040a1a}
.hb-right{display:flex;flex-direction:column;justify-content:center;gap:9px;padding-left:20px;border-left:1px solid rgba(4,10,26,.6);box-shadow:-1px 0 0 rgba(233,187,79,.16)}
.inv{display:grid;grid-template-columns:repeat(3,50px);gap:6px}
.inv b{width:50px;height:50px;font-size:15px;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.28),inset 0 2px 10px rgba(4,10,26,.8);background-color:#070d18;transition:filter .12s}.inv b.has{box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.6),0 3px 8px rgba(4,10,26,.4)}.inv b.has:hover{filter:brightness(1.15)}
.gold{position:relative;display:flex;align-items:center;justify-content:center;gap:8px;height:33px;font:800 18px/1 var(--f);color:var(--gold);background:linear-gradient(180deg,#244a86,#122a58);border-radius:3px;box-shadow:0 0 0 1px var(--line),0 0 0 2px rgba(240,199,94,.62),inset 0 1px 0 rgba(255,255,255,.2);padding:0 10px;cursor:pointer;transition:filter .12s;text-shadow:0 1px 2px #040a1a}
.gold:hover{filter:brightness(1.18)}.gold::before{content:"";width:20px;height:20px;flex:none;border-radius:50%;background:url(/assets/ui/gold.webp) center/cover;box-shadow:0 0 0 1px rgba(4,10,26,.6)}
.gold .gf{position:absolute;right:8px;top:-8px;font:800 13px/1 var(--f);color:#ffe9a6;text-shadow:0 1px 3px #040a1a;pointer-events:none;animation:ui-float 1.1s var(--ez) forwards}
.buffs{position:absolute;left:40px;bottom:calc(100% + 16px);display:flex;gap:6px;pointer-events:auto}
.buffs span{position:relative;width:38px;height:38px;animation:ui-pop .35s var(--ez)}.buffs span i{position:absolute;right:2px;bottom:1px;font:700 11px/1.2 var(--f);font-style:normal;color:#fff;text-shadow:0 0 3px #040a1a,0 1px 2px #040a1a}
.recall{position:absolute;left:50%;bottom:calc(100% + 60px);transform:translateX(-50%);width:280px;height:22px;background:#060a14;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(111,224,214,.45),0 4px 14px rgba(4,10,26,.5);overflow:hidden}
.recall i{position:absolute;inset:1px auto 1px 1px;background:linear-gradient(#e4fbf7,#6fc9c0);box-shadow:0 0 10px rgba(111,224,214,.6)}.recall span{position:absolute;inset:0;display:grid;place-items:center;font:700 12px/1 var(--f);color:#0a1121;letter-spacing:.14em}
/* ---- 说明框：标题、消耗、正文、背景描述，分段之间一条细线 ---- */
.tip{position:absolute;left:50%;bottom:calc(100% + 34px);transform:translateX(-50%);width:min(380px,88vw);padding:4px 2px;font:400 13px/1.6 var(--f);pointer-events:none;animation:ui-in .14s var(--ez)}
.tip header{display:flex;gap:11px;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(233,187,79,.22)}.tip header .ico{width:44px;height:44px;flex:none;font-size:18px;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.55)}
.tip h4{margin:0;font:900 16px/1.3 var(--fd);color:#fff;letter-spacing:.14em}.tip header small{display:block;font:500 11.5px/1.5 var(--f);color:var(--mute)}.tip header em{margin-left:auto;padding:3px 7px;font:800 13px/1 var(--f);font-style:normal;color:var(--bz-l);box-shadow:inset 0 0 0 1px rgba(233,187,79,.5);white-space:nowrap}
.tip p{margin:0;padding:10px 14px;color:#cbd2dd}.tip .meta{display:flex;gap:16px;padding:8px 14px 9px;border-top:1px solid rgba(233,187,79,.22);font:600 12px/1.4 var(--f);color:var(--mute)}.tip .meta b{color:#9fd0ff;font-weight:700}.tip .meta u{text-decoration:none;color:#ebeff5}
/* ---- 商店：分类 | 列表 | 合成路线和详情 ---- */
.shop{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(1000px,95vw);height:min(660px,80vh);display:grid;grid-template-columns:132px minmax(0,1fr) 300px;grid-template-rows:auto minmax(0,1fr) auto;pointer-events:auto;animation:shop-in .18s var(--ez)}
@keyframes shop-in{from{opacity:0;transform:translate(-50%,-48%) scale(.985)}to{opacity:1;transform:translate(-50%,-50%)}}
.shop>header{grid-column:1/-1;display:flex;align-items:center;gap:16px;padding:14px 20px 12px;border-bottom:1px solid rgba(233,187,79,.22)}
.shop h3{margin:0;font-size:19px}.shop .why{margin:0;font-size:12.5px;color:var(--mute);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.shop .why.bad{color:#ffb38a}
.shop .q{display:flex;align-items:center;gap:6px;padding:0 10px;height:30px;width:200px;background:rgba(4,8,15,.6);box-shadow:inset 0 0 0 1px rgba(233,187,79,.3);color:var(--mute)}.shop .q svg{width:15px;height:15px;flex:none}
.shop .q input{flex:1;min-width:0;border:0;outline:0;background:none;color:var(--txt);font:500 13px/1 var(--f)}.shop .q input::placeholder{color:var(--dim)}
.shop header>b{display:flex;align-items:center;gap:6px;font:800 16px/1 var(--f);color:var(--gold)}.shop header>b::before{content:"";width:18px;height:18px;border-radius:50%;background:url(/assets/ui/gold.webp) center/cover}
.shop .x{width:32px;height:32px}
.shop .cats{display:flex;flex-direction:column;gap:3px;padding:12px 0 12px 12px;border-right:1px solid rgba(233,187,79,.18)}
.shop .cats button{display:flex;align-items:center;gap:8px;padding:10px 10px;border:0;background:none;color:#8b9cb5;font:600 13px/1 var(--f);letter-spacing:.14em;text-align:left;cursor:pointer;transition:color .12s,background .12s;border-left:2px solid transparent}
.shop .cats button svg{width:17px;height:17px;flex:none;color:var(--bz)}.shop .cats button:hover{color:#fff;background:rgba(255,255,255,.03)}.shop .cats button.on{color:#fff7e0;background:linear-gradient(90deg,rgba(233,187,79,.18),transparent);border-left-color:var(--bz-l)}
.shop .list{padding:10px 14px 14px;overflow:auto;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}
.shop .cat h5{margin:0 0 7px;display:flex;align-items:center;gap:8px;font:800 12px/1 var(--fd);letter-spacing:.3em;color:var(--bz)}.shop .cat h5 small{font:600 10.5px/1 var(--f);letter-spacing:.08em;color:var(--dim)}.shop .cat h5::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(233,187,79,.4),transparent)}
.shop .cat>div{display:flex;flex-wrap:wrap;gap:6px}
.shop .cat>.roles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px}.shop .rg{display:flex;align-items:flex-start;gap:6px}.shop .rg>div{display:flex;gap:6px}
.shop .rg>i{flex:none;writing-mode:vertical-rl;height:40px;display:grid;place-items:center;padding:0 3px 0 0;font:700 10.5px/1 var(--f);font-style:normal;letter-spacing:.3em;color:var(--bz-l);border-right:1px solid rgba(233,187,79,.4)}
.shop .cat[data-s="path"]{order:-1}.shop .cat>.path{align-items:flex-start;gap:4px}.shop .path .ar{flex:none;width:6px;height:6px;margin:17px 1px 0 -1px;border:solid rgba(233,187,79,.65);border-width:1.5px 1.5px 0 0;transform:rotate(45deg)}
.shop .it{position:relative;width:52px;padding:0;border:0;background:none;color:inherit;font-family:var(--f);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;transition:transform .12s var(--ez)}
.shop .it:hover{transform:translateY(-2px)}.shop .it .ico{width:48px;height:40px;font-size:16px;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.35)}
.shop .it span{font:700 11px/1 var(--f);color:var(--gold)}.shop .it.poor span{color:#bf9644}.shop .it.poor .ico{filter:brightness(.55) saturate(.6)}
.shop .it.sel .ico{box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l),0 0 14px rgba(251,223,158,.35)}
.shop .it.rec::before{content:"";position:absolute;left:-3px;top:-3px;z-index:2;width:9px;height:9px;transform:rotate(45deg);background:var(--bz-l);box-shadow:0 0 0 1.5px #060a14}
.shop .it.own::after{content:"已有";position:absolute;right:1px;top:1px;z-index:2;padding:1px 3px;font:700 9px/1.2 var(--f);color:#0c1a0f;background:var(--me)}
.shop .it .no{position:absolute;left:-4px;top:-5px;z-index:3;min-width:15px;height:15px;display:grid;place-items:center;font:800 10px/1 var(--f);color:#1a1306;background:var(--bz-l);box-shadow:0 0 0 1.5px #060a14}
.shop .det{border-left:1px solid rgba(233,187,79,.18);padding:12px 16px;display:flex;flex-direction:column;gap:9px;min-height:0;overflow:auto;scrollbar-width:thin}
.shop .tree{display:flex;flex-direction:column;align-items:center;padding:2px 0 10px;border-bottom:1px solid rgba(233,187,79,.18)}
.shop .tree h6{align-self:stretch;margin:0 0 8px;display:flex;justify-content:space-between;font:700 11px/1 var(--f);letter-spacing:.28em;color:var(--mute)}.shop .tree h6 b{letter-spacing:.04em;color:var(--me)}
.shop .tn{position:relative;display:flex;flex-direction:column;align-items:center}.shop .tn>small{margin-top:3px;font:700 10px/1.1 var(--f);color:var(--gold)}.shop .tn>small.got{color:var(--me)}
.shop .tk{position:relative;display:flex;justify-content:center;padding-top:8px}.shop .tk::before{content:"";position:absolute;top:0;left:50%;height:8px;border-left:1px solid rgba(233,187,79,.55)}
.shop .tk>.tn{padding:7px 3px 0}.shop .tk>.tn::before{content:"";position:absolute;top:0;left:50%;height:7px;border-left:1px solid rgba(233,187,79,.55)}.shop .tk>.tn::after{content:"";position:absolute;top:0;left:0;right:0;border-top:1px solid rgba(233,187,79,.55)}
.shop .tk>.tn:first-child::after{left:50%}.shop .tk>.tn:last-child::after{right:50%}.shop .tk>.tn:only-child::after{display:none}
.shop .tree .n{width:40px;height:34px;cursor:pointer;font-size:13px;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.45)}.shop .tree .tk .tk .n{width:32px;height:27px;font-size:11px}.shop .tree .n.root{width:52px;height:44px;box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l)}
.shop .tree .n.got{box-shadow:0 0 0 1px #03060c,0 0 0 2px var(--me)}.shop .tree .n.got::after{content:"✓";position:absolute;right:0;bottom:0;padding:0 2px;font:800 9px/1.35 var(--f);color:#0c1a0f;background:var(--me)}
.shop .tree p{margin:6px 0 0;font:500 11.5px/1.5 var(--f);color:var(--dim);text-align:center}.shop .tree p b{color:var(--gold)}
.shop .tree .up{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;margin-top:9px;font:600 11px/1 var(--f);color:var(--mute)}.shop .tree .up .n{width:32px;height:27px}
.shop .det .hd{display:flex;gap:12px;align-items:center}.shop .det .hd .ico{width:62px;height:52px;flex:none;font-size:22px;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.6)}
.shop .det h4{margin:0;font:900 18px/1.3 var(--fd);color:#fff;letter-spacing:.12em}.shop .det em{display:flex;align-items:center;gap:5px;font:800 14px/1 var(--f);font-style:normal;color:var(--gold);margin-top:4px}.shop .det em::before{content:"";width:14px;height:14px;border-radius:50%;background:url(/assets/ui/gold.webp) center/cover}.shop .det em s{margin-left:4px;font:600 11px/1 var(--f);text-decoration:none;color:var(--mute)}
.shop .det small.tg{font:600 11px/1 var(--f);color:var(--mute);letter-spacing:.14em}
.shop .det ul,.tip ul{margin:0;padding:0;list-style:none;font-size:13px;line-height:1.7;color:#a9e8b4}.shop .det ul li::before,.tip ul li::before{content:"+ ";color:#6fae7a}
.shop .pv,.tip .pv{font:400 12.5px/1.6 var(--f);color:#cdd7e5;padding:7px 10px;background:linear-gradient(90deg,rgba(233,187,79,.13),rgba(233,187,79,.02));box-shadow:inset 2px 0 0 var(--bz-l)}.shop .pv b,.tip .pv b{display:block;margin-bottom:1px;font:800 12px/1.4 var(--f);letter-spacing:.12em;color:var(--bz-l)}
.shop .fit,.tip .fit{font:500 12px/1.55 var(--f);color:var(--mute)}.shop .fit b,.tip .fit b{color:#f3e8cc;font-weight:700;margin-right:6px}
.shop .det p{margin:0;font-size:12.5px;line-height:1.65;color:var(--mute);font-style:italic;padding:9px 11px;background:rgba(4,8,15,.4);border-left:2px solid rgba(233,187,79,.35)}
.shop .buy{position:sticky;bottom:0;z-index:2;margin-top:auto;width:100%;flex:none;white-space:nowrap;letter-spacing:.12em;box-shadow:0 -10px 14px -4px rgba(6,11,21,.85)}      /* 详情长了要滚：购买键贴在底下，一直看得见 */.shop .buy:disabled{filter:grayscale(1) brightness(.5)}
.tip ul{padding:8px 14px 0}.tip .pv{margin:8px 14px 0}.tip .fit{padding:8px 14px 9px;margin-top:8px;border-top:1px solid rgba(233,187,79,.22)}
.inv b .bn{position:absolute;right:2px;bottom:1px;z-index:2;font:800 11px/1 var(--f);color:#fff;text-shadow:0 1px 2px #040a1a,0 0 3px #040a1a}.inv b .bc{position:absolute;inset:0;z-index:1;pointer-events:none}
.shop>footer{grid-column:1/-1;padding:9px 20px 12px;border-top:1px solid rgba(233,187,79,.18);font-size:12px;color:var(--mute)}
/* ---- 计分板：两队上下两张表 ---- */
.board{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(900px,95vw);padding:16px 20px 16px;animation:ui-fade .14s var(--ez)}
.board .bh{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:6px}.board .bh h3{margin:0;font-size:17px}.board .bh span{display:flex;align-items:center;gap:6px;font:700 13px/1 var(--f);color:var(--mute)}.board .bh svg{width:14px;height:14px;color:var(--bz)}
.board .bh b.a{color:#8fcbff;font:800 20px/1 var(--f)}.board .bh b.b{color:var(--foe);font:800 20px/1 var(--f)}
.board table{width:100%;border-collapse:collapse;font:600 13px/1 var(--f)}.board th{font:700 10.5px/1 var(--f);letter-spacing:.2em;color:var(--dim);padding:10px 8px 6px;text-align:left}.board td{padding:5px 8px;border-top:1px solid rgba(255,255,255,.045)}
.board tr.tm td{padding:12px 8px 4px;border:0;font:900 13px/1 var(--fd);letter-spacing:.3em}.board tr.tm.a td{color:#a9d6ff}.board tr.tm.b td{color:#ffb0a2}
.board tr.a td:first-child{box-shadow:inset 3px 0 0 var(--ally)}.board tr.b td:first-child{box-shadow:inset 3px 0 0 var(--foe)}.board tr.tm td:first-child{box-shadow:none}
.board tr.you td{background:linear-gradient(90deg,rgba(251,223,158,.12),rgba(251,223,158,.03))}.board tr.dead td{color:#5a6f8e}.board tr.dead .ico{filter:grayscale(1) brightness(.5)}
.board .who{display:flex;align-items:center;gap:10px}.board .who .ico{width:48px;height:32px;font-size:13px;background-position:center 18%}.board .who b{font:800 14px/1.2 var(--fd);letter-spacing:.1em}.board .who small{display:block;font:500 11px/1.2 var(--f);color:var(--mute);margin-top:2px}
.board .lv{display:inline-grid;place-items:center;width:24px;height:24px;transform:rotate(45deg);box-shadow:inset 0 0 0 1px rgba(233,187,79,.6);background:rgba(6,10,20,.6);color:var(--bz-l);font-size:11.5px}.board .lv i{transform:rotate(-45deg);font-style:normal}
.board .its{display:flex;gap:3px}.board .its .ico,.board .its i{width:26px;height:22px;font-size:10px}.board .its i{display:block;background:rgba(4,8,15,.5);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.board td.g{color:var(--gold)}
/* ---- 小地图 ---- */
.hud-map{position:absolute;left:0;bottom:0;width:256px;height:256px;pointer-events:auto;cursor:crosshair;touch-action:none;overflow:visible;padding:10px;--orn:42px;transform:scale(var(--k));transform-origin:0 100%;-webkit-backdrop-filter:none;backdrop-filter:none}
.hud-map canvas{width:100%;height:100%;display:block;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.35)}
/* ---- 菜单 ---- */
.hud-menu{position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,22,52,.5);pointer-events:auto;animation:ui-fade .16s var(--ez)}
.hud-menu>div{display:flex;flex-direction:column;gap:9px;padding:26px 30px 22px;min-width:300px;animation:ui-in .2s var(--ez)}.hud-menu h3{margin:0;text-align:center}.hud-menu .ui-div{margin:0 0 6px}
.hud-menu .ui-btn{width:100%;justify-content:flex-start;padding:12px 18px}.hud-menu .ui-btn.main{justify-content:center}
.hud-menu small{margin-top:6px;font-size:12px;color:var(--mute);text-align:center;line-height:1.8}
.sk{isolation:isolate}.shop,.board{z-index:6}.hud-menu{z-index:7}
/* ---- 触屏（阶段 8 的布局，第九轮换皮，第九轮 ui2 照王者荣耀 / LoL 手游再过一遍）：尺寸都按 --u 走（屏幕高 390 时是 16 像素），刘海和底部横条让开 ----
   技能键、攻击键是“玻璃底 + 一道细铜圈 + 外面一圈半透明的暗环”（王者荣耀的路子，比整块铜章轻）；能放的技能铜圈变亮、外环带一点光；大招再大一圈。
   摇杆是一圈细铜线加四个小箭头，手指按下才亮；回城是一颗小圆钮，字写在下面。金币和商店在小地图下面一块。 */
.hud.touch{--u:clamp(13px,4.1vh,21px);--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--sb:env(safe-area-inset-bottom,0px)}
.hud.touch .hud-map{left:calc(var(--sl) + 6px);top:6px;bottom:auto;width:calc(var(--u)*8.4);height:calc(var(--u)*8.4);padding:5px;--orn:22px;transform:none}
.hud.touch .hud-me{left:auto;right:calc(var(--sr) + 8px);top:6px;transform:none}.hud.touch .hud-me span{display:none}.hud.touch .hud-me button{width:calc(var(--u)*2.5);height:calc(var(--u)*2.5)}
.hud.touch .hud-top .mid{pointer-events:auto;height:calc(var(--u)*3);gap:calc(var(--u)*.6);padding:0 calc(var(--u)*1.5) 4px}.hud.touch .hud-top .k{font-size:calc(var(--u)*1.4)}.hud.touch .hud-top .clock b{font-size:calc(var(--u)*.9)}.hud.touch .hud-top .clock small{font-size:calc(var(--u)*.6);padding-top:2px}.hud.touch .hud-top .clock small svg{width:calc(var(--u)*.65);height:calc(var(--u)*.65)}.hud.touch .hud-top .clock{gap:2px;min-width:0;margin-top:-2px}
.hud.touch .hud-top .squad{padding:3px 2px 7px;gap:2px}
.hud.touch .hud-top .hd{width:calc(var(--u)*2.5);height:calc(var(--u)*2.2)}.hud.touch .hud-top .hd .ico{width:100%;height:calc(var(--u)*1.75)}.hud.touch .hud-top .hd u{top:calc(var(--u)*1.75 + 2px);height:4px}.hud.touch .hud-top .hd b{height:calc(var(--u)*1.75);font-size:calc(var(--u)*.9)}.hud.touch .hud-top .hd em{font-size:9px;min-width:13px;height:12px;bottom:5px;right:-1px}
.hud.touch .hud-feed{top:calc(var(--u)*3.6);right:calc(var(--sr) + 8px);transform:scale(.7);transform-origin:top right}
.hud.touch .hud-ann{top:18%}.hud.touch .hud-ann h3{font-size:calc(var(--u)*1.6)}.hud.touch .hud-ann p{font-size:calc(var(--u)*.78);margin-top:2px}.hud.touch .hud-ann .ui-div{height:14px;width:260px}
.hud.touch .hud-msg{top:30%;font-size:calc(var(--u)*.85);padding:6px 20px}
/* 金币和商店：小地图下面一块铜边的圆角牌，左边金币右边“商店”，点开商店 */
.hud.touch .gold{position:absolute;left:calc(var(--sl) + 6px);top:calc(var(--u)*8.4 + 14px);height:calc(var(--u)*2.2);flex:none;gap:calc(var(--u)*.35);padding:0 calc(var(--u)*.75) 0 calc(var(--u)*.4);border-radius:999px;font-size:calc(var(--u)*1.02);pointer-events:auto;touch-action:manipulation;background:linear-gradient(180deg,rgba(40,78,138,.92),rgba(16,36,76,.94));box-shadow:0 0 0 1px var(--line),0 0 0 2.5px rgba(240,199,94,.7),0 0 0 3.5px rgba(6,19,49,.6),inset 0 1px 0 rgba(255,255,255,.25),0 4px 12px rgba(4,14,40,.35)}
.hud.touch .gold::before{width:calc(var(--u)*1.35);height:calc(var(--u)*1.35);box-shadow:0 0 0 1px rgba(4,10,26,.6),0 0 8px rgba(250,213,127,.35)}
.hud.touch .gold::after{content:"商店";margin-left:.25em;padding-left:.6em;border-left:1px solid rgba(255,232,166,.35);font-weight:800;color:#fff4d6;letter-spacing:.14em;font-size:.82em}
/* 底部正中：装备小格一排，下面等级章（带经验环）、血条蓝条、被动 */
.tc-vitals{position:absolute;left:calc(var(--sl) + var(--u)*11);right:calc(var(--sr) + var(--u)*17.8);bottom:calc(var(--sb) + 5px);max-width:calc(var(--u)*16.5);margin:0 auto;display:flex;flex-direction:column;gap:5px;pointer-events:none}
.tc-row{display:flex;align-items:flex-end;gap:4px;min-height:calc(var(--u)*1.6);padding-left:calc(var(--u)*2.75)}.tc-row>*{pointer-events:auto}
.hud.touch .inv{display:flex;gap:4px}.hud.touch .inv b{width:calc(var(--u)*1.7);height:calc(var(--u)*1.7);font-size:10px;box-shadow:0 0 0 1px #03060c,0 0 0 1.5px rgba(233,187,79,.3),inset 0 2px 6px rgba(4,10,26,.8)}.hud.touch .inv b.has{box-shadow:0 0 0 1px #03060c,0 0 0 1.5px rgba(233,187,79,.65)}.hud.touch .inv b:not(.has):empty{opacity:.55}
.hud.touch .buffs{position:static;margin-left:auto}.hud.touch .buffs span{width:calc(var(--u)*1.55);height:calc(var(--u)*1.55)}.hud.touch .buffs span i{font-size:9px}
.tc-bars{display:flex;align-items:center;gap:7px}
.hud.touch .hb-lv{position:static;flex:none;width:calc(var(--u)*2.3);height:calc(var(--u)*2.3);font-size:calc(var(--u)*.92)}.hud.touch .hb-lv::before{inset:-3.5px;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#040a1a calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#040a1a calc(100% - 3px))}
.tc-b{flex:1;min-width:0;position:relative;display:flex;flex-direction:column;gap:3px}
.hud.touch .bar{height:calc(var(--u)*1.1)}.hud.touch .bar.mp{height:calc(var(--u)*.5)}.hud.touch .bar.mp span,.hud.touch .bar small{display:none}.hud.touch .bar span{font-size:calc(var(--u)*.72)}
.hud.touch .recall{position:static;transform:none;width:100%;height:calc(var(--u)*1.05)}
.hud.touch .sk.p{position:static;flex:none;width:calc(var(--u)*2);height:calc(var(--u)*2);margin:0;font-size:calc(var(--u)*.8)}
/* 右下：攻击键是锚点，技能键按 --x --y（以 --u 为单位，从攻击键的圆心算）摆成一段弧 */
.tc-pad{position:absolute;right:calc(var(--sr) + var(--u)*4.4);bottom:calc(var(--sb) + var(--u)*4.2);width:0;height:0}
.tc-pad button{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent}
.tc-atk{position:absolute;left:calc(var(--u)*-2.8);top:calc(var(--u)*-2.8);width:calc(var(--u)*5.6);height:calc(var(--u)*5.6);border-radius:50%;border:0;padding:0;background:radial-gradient(circle at 50% 30%,rgba(58,104,176,.9),rgba(20,44,92,.92) 62%,rgba(12,28,62,.94));box-shadow:0 0 0 1.5px var(--line),0 0 0 3.5px #e9bd5c,0 0 0 4.5px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.55) rgba(12,32,72,.3),inset 0 2px 0 rgba(255,255,255,.22),inset 0 calc(var(--u)*-.6) calc(var(--u)*1.1) rgba(4,14,40,.35),0 6px 16px rgba(4,14,40,.35);display:grid;place-items:center;transition:transform .07s,box-shadow .07s,filter .07s}
.tc-atk::before{content:"";position:absolute;inset:9%;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,232,166,.32);pointer-events:none}
.tc-atk svg{width:44%;height:44%;filter:drop-shadow(0 2px 3px rgba(4,10,26,.8))}.tc-atk.hold{transform:scale(.93);filter:brightness(1.2);box-shadow:0 0 0 1.5px var(--line),0 0 0 3.5px #ffe8a6,0 0 0 4.5px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.55) rgba(255,232,166,.2),0 0 18px rgba(255,220,130,.4)}
.hud.touch .skills{display:block;position:absolute;left:0;top:0;width:0;height:0}
.hud.touch .skills .sk{position:absolute;width:calc(var(--u)*3.8);height:calc(var(--u)*3.8);left:calc(var(--u)*var(--x) - var(--u)*1.9);top:calc(var(--u)*var(--y) - var(--u)*1.9);border-radius:50%;box-shadow:0 0 0 1.5px var(--line),0 0 0 3px #b98d3c,0 0 0 4px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.4) rgba(12,32,72,.32),inset 0 0 0 1px rgba(255,255,255,.16),0 4px 12px rgba(4,14,40,.35);font-size:calc(var(--u)*1.3);transition:transform .07s,box-shadow .2s}
.hud.touch .skills .sk.ready{box-shadow:0 0 0 1.5px var(--line),0 0 0 3px #ffdc80,0 0 0 4px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.4) rgba(255,226,140,.2),0 0 14px rgba(255,220,130,.32),inset 0 0 0 1px rgba(255,249,232,.32),0 4px 12px rgba(4,14,40,.35)}
.hud.touch .skills .sk.big{width:calc(var(--u)*4.3);height:calc(var(--u)*4.3);left:calc(var(--u)*var(--x) - var(--u)*2.15);top:calc(var(--u)*var(--y) - var(--u)*2.15)}
.hud.touch .skills .sk.big.ready{box-shadow:0 0 0 1.5px var(--line),0 0 0 3.5px #ffe08e,0 0 0 4.5px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.45) rgba(255,206,110,.24),0 0 18px rgba(255,206,120,.42),inset 0 0 0 1px rgba(255,249,232,.32),0 4px 14px rgba(4,14,40,.35)}
.hud.touch .sk kbd,.hud.touch .sk .mp{display:none}.hud.touch .sk .cd{font-size:calc(var(--u)*1.35)}.hud.touch .sk .lk{border-radius:50%;font-size:calc(var(--u)*.62)}.hud.touch .sk .lk svg{width:calc(var(--u)*1.1);height:calc(var(--u)*1.1)}
.hud.touch .sk .dim,.hud.touch .sk.ready::before{border-radius:50%}.hud.touch .sk.flash::after{border-radius:50%}
.hud.touch .sk.hold,.hud.touch .sk.aim{transform:scale(1.08);box-shadow:0 0 0 1.5px #03060c,0 0 0 3.5px #fff5d9,0 0 0 4.5px #03060c,0 0 20px rgba(255,244,214,.55)!important}
.tc-rc{position:absolute;left:calc(var(--u)*-12.9);top:calc(var(--u)*.4);width:calc(var(--u)*2.8);height:calc(var(--u)*2.8);border-radius:50%;border:0;padding:0;background:url(/assets/ui/recall.webp) center/cover;box-shadow:0 0 0 1.5px var(--line),0 0 0 3px rgba(111,224,214,.75),0 0 0 4px rgba(6,19,49,.7),0 0 0 calc(var(--u)*.35) rgba(12,32,72,.28),0 3px 10px rgba(4,14,40,.35);color:transparent;font-size:0}
.tc-rc::after{content:"回城";position:absolute;left:50%;top:calc(100% - .55em);transform:translateX(-50%);padding:2px 6px;font:800 calc(var(--u)*.6)/1 var(--f);letter-spacing:.1em;color:#e6fbf8;background:rgba(14,34,74,.82);border-radius:3px;box-shadow:inset 0 0 0 1px rgba(111,224,214,.45);white-space:nowrap}
.tc-rc:active{transform:scale(.94)}
.tc-stick{position:absolute;left:0;bottom:0;width:44%;height:60%;pointer-events:auto;touch-action:none}
.tc-stick .base{position:absolute;left:calc(var(--sl) + var(--u)*6.6);top:calc(100% - var(--sb) - var(--u)*5.6);width:calc(var(--u)*7.6);height:calc(var(--u)*7.6);margin:calc(var(--u)*-3.8) 0 0 calc(var(--u)*-3.8);border-radius:50%;background:STICK_BG center/100% no-repeat,radial-gradient(rgba(10,30,70,.16) 38%,rgba(10,30,70,.36) 69%,rgba(10,30,70,0) 70.5%);opacity:.7;transition:opacity .15s;pointer-events:none}
.tc-stick.on .base{opacity:1}
.tc-stick .knob{position:absolute;left:50%;top:50%;width:calc(var(--u)*3);height:calc(var(--u)*3);margin:calc(var(--u)*-1.5);border-radius:50%;background:radial-gradient(circle at 42% 30%,rgba(255,255,255,.95),rgba(214,232,255,.72) 34%,rgba(92,142,214,.62) 72%,rgba(40,82,156,.7));box-shadow:0 0 0 1.5px rgba(6,19,49,.55),0 3px 10px rgba(4,14,40,.35),inset 0 0 0 1.5px rgba(255,255,255,.75),inset 0 -4px 7px rgba(10,40,100,.25)}
.tc-cancel{position:absolute;right:calc(var(--sr) + var(--u)*1.2);top:calc(var(--u)*5.6);width:calc(var(--u)*3.6);height:calc(var(--u)*3.6);border-radius:50%;display:grid;place-items:center;align-content:center;gap:2px;font:800 calc(var(--u)*.68)/1 var(--f);letter-spacing:.08em;background:radial-gradient(circle,rgba(30,20,18,.85),rgba(12,8,8,.9));box-shadow:0 0 0 1.5px #03060c,0 0 0 3px rgba(226,88,74,.55),0 0 0 4px #03060c;color:#ffd8d0;transition:transform .1s,background .1s}
.tc-cancel svg{width:calc(var(--u)*1.2);height:calc(var(--u)*1.2)}
.tc-cancel.hot{background:radial-gradient(circle,#e04a38,#8e1f14);box-shadow:0 0 0 1.5px #03060c,0 0 0 3px #fff,0 0 18px rgba(255,90,70,.7);transform:scale(1.1);color:#fff}
.hud.touch .shop{top:50%;width:min(900px,calc(100vw - var(--sl) - var(--sr) - 20px));height:calc(100vh - 16px);height:calc(100dvh - 16px);grid-template-columns:calc(var(--u)*5.6) minmax(0,1fr) min(290px,38%)}
@keyframes shop-in-t{from{opacity:0}to{opacity:1}}.hud.touch .shop{animation-name:shop-in-t}
.hud.touch .shop>header{padding:7px 14px;gap:10px}.hud.touch .shop h3{font-size:15px}.hud.touch .shop .q{display:none}.hud.touch .shop .x{width:34px;height:34px}
.hud.touch .shop .cats{padding:6px 0 6px 6px;gap:1px}.hud.touch .shop .cats button{padding:7px 6px;font-size:11px;letter-spacing:.04em;gap:5px}.hud.touch .shop .cats button svg{width:14px;height:14px}
.hud.touch .shop .list{padding:8px 10px;gap:7px}.hud.touch .shop .cat h5{margin-bottom:5px;font-size:10.5px}.hud.touch .shop .cat>div,.hud.touch .shop .rg>div{gap:5px}.hud.touch .shop .cat>.roles{gap:6px 8px}.hud.touch .shop .it{width:42px}.hud.touch .shop .it .ico{width:40px;height:33px;font-size:13px}.hud.touch .shop .it span{font-size:10px}.hud.touch .shop .rg>i{height:33px;font-size:9.5px}.hud.touch .shop .path .ar{margin-top:14px}
.hud.touch .shop .det{padding:8px 10px;gap:6px}.hud.touch .shop .tree{padding-bottom:6px}.hud.touch .shop .tree h6{margin-bottom:4px}.hud.touch .shop .tree p{margin-top:4px;font-size:10.5px}.hud.touch .shop .tree .n{width:32px;height:27px}.hud.touch .shop .tree .tk .tk .n{width:25px;height:21px}.hud.touch .shop .tree .n.root{width:42px;height:35px}.hud.touch .shop .tk>.tn{padding:7px 2px 0}.hud.touch .shop .tn>small{font-size:9px}.hud.touch .shop .det .hd .ico{width:46px;height:38px}.hud.touch .shop .det h4{font-size:15px}.hud.touch .shop .det ul{display:flex;flex-wrap:wrap;gap:0 10px;font-size:12px;line-height:1.55}.hud.touch .shop .pv{font-size:11px;padding:5px 7px}.hud.touch .shop .pv b{font-size:11px}.hud.touch .shop .fit{font-size:10.5px}.hud.touch .shop .det p{display:none}.hud.touch .shop .buy{padding:9px}
.hud.touch .shop>footer{padding:5px 14px 7px;font-size:10.5px}
.hud.touch .board{top:50%;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);overflow:auto;pointer-events:auto;padding:8px 14px}.hud.touch .board td{padding:3px 8px}.hud.touch .board tr.tm td{padding:6px 8px 2px}.hud.touch .board .bh{margin:0}.hud.touch .board th{padding:4px 8px}.hud.touch .board .who .ico{height:24px;width:36px}.hud.touch .board .who small{display:none}.hud.touch .board .who b{font-size:12.5px}.hud.touch .board .ui-div{height:12px}.hud.touch .board .its .ico,.hud.touch .board .its i{width:20px;height:17px}.hud.touch .board .lv{width:20px;height:20px;font-size:10px}
.hud.touch .hud-menu .ui-btn{padding:calc(var(--u)*.7) 16px}.hud.touch .hud-menu>div{padding:16px 24px 14px;gap:6px}
/* 第九轮 5v5 的触屏：顶栏两边各五个头像，摆在小地图和菜单键中间那一段的正中（不是屏幕正中，窄屏时会压到小地图上）；头像宽度跟着那一段的宽度收，667 宽的屏也排得下 */
.hud.touch .hud-top{left:calc((var(--sl) + var(--u)*8.4 + 16px + 100vw - var(--sr) - var(--u)*2.5 - 12px) / 2)}
.hud.touch .hud-top .hd{width:min(calc(var(--u)*2.5),calc((100vw - var(--sl) - var(--sr) - var(--u)*10.9 - 250px) / 10))}      /* 250：中间铜牌（第九轮 ui2 放大了）加两队的边距 */
/* 计分板十行：每行压矮一点，一屏放得下不用滚 */
.hud.touch .board td{padding:2px 8px}.hud.touch .board tr.tm td{padding:4px 8px 1px}.hud.touch .board .who .ico{height:20px;width:30px}.hud.touch .board .its .ico,.hud.touch .board .its i{width:18px;height:15px}.hud.touch .board table{font-size:12px}
@media (max-width:900px){.hud-map{width:150px;height:150px;bottom:auto;top:62px;padding:5px;--orn:24px;transform:none}.hud-ann h3{font-size:24px}.hud-me span{display:none}}
/* 第四阶段 iti-kit：多段施放（SkillDef.recast，伊缇的 Q 三段、W 再按一次换位）。照 LoL：按钮左上角一块小牌写着再按是第几段（或者“换”），下沿一条随窗口剩余时间缩短的亮条，外圈换成更亮的白金色。
   只有带 recast 的技能有这两个元素，别的英雄的按钮不变 */
.sk .rc{position:absolute;left:-6px;top:-7px;z-index:6;display:none;min-width:24px;height:19px;padding:0 5px;place-items:center;background:linear-gradient(#fff3cf,#e9bb4f);font:800 12px/1 var(--f);color:#2a1606;border-radius:3px;box-shadow:0 0 0 1px #03060c,0 2px 5px rgba(4,10,26,.6)}
.sk .rcb{position:absolute;left:0;right:0;bottom:0;height:5px;z-index:4;display:none;background:rgba(4,8,10,.65)}.sk .rcb::after{content:"";position:absolute;left:0;top:0;bottom:0;width:var(--rc,100%);background:linear-gradient(90deg,#fff2c8,#f4c75c)}
.sk.recast .rc{display:grid}.sk.recast .rcb{display:block}.sk.recast .mp{visibility:hidden}      /* 后面几段不花法力：右下角的法力数收起来 */
.sk.recast:not(.p){box-shadow:0 0 0 1px #03060c,0 0 0 2.5px #fff2c8,0 0 0 3.5px #03060c,0 0 18px rgba(255,236,180,.55),inset 0 0 0 1px rgba(255,249,232,.4),0 7px 14px rgba(4,10,26,.5)}
.hud.touch .sk .rc{left:0;top:0;min-width:calc(var(--u)*1.2);height:calc(var(--u)*.9);font-size:calc(var(--u)*.55);border-radius:calc(var(--u)*.45)}
.hud.touch .sk .rcb{left:24%;right:24%;bottom:11%;height:calc(var(--u)*.22);border-radius:99px;overflow:hidden}
.hud.touch .skills .sk.recast{box-shadow:0 0 0 1.5px var(--line),0 0 0 3px #fff2c8,0 0 0 4px rgba(6,19,49,.75),0 0 0 calc(var(--u)*.4) rgba(255,236,180,.24),0 0 16px rgba(255,236,180,.45),inset 0 0 0 1px rgba(255,249,232,.32),0 4px 12px rgba(4,14,40,.35)}
`;
/** 摇杆的底盘（画风 B）：外圈一道白线、外面贴一道深蓝细线（亮地面、暗地面上都看得见），四个方向的小箭头同样白加深蓝描边，里面一圈很淡的圆 */
const STICK = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='none'><circle cx='50' cy='50' r='48' stroke='#061331' stroke-opacity='.45' stroke-width='3.6'/><circle cx='50' cy='50' r='48' stroke='#fff' stroke-opacity='.92' stroke-width='1.8'/><circle cx='50' cy='50' r='30' stroke='#fff' stroke-opacity='.28' stroke-width='1.2'/>${[0, 90, 180, 270].map(r => `<g transform='rotate(${r} 50 50)' stroke-linecap='round' stroke-linejoin='round'><path d='M45.5 10.5l4.5-4.5 4.5 4.5' stroke='#061331' stroke-opacity='.45' stroke-width='3.8'/><path d='M45.5 10.5l4.5-4.5 4.5 4.5' stroke='#fff' stroke-width='1.8'/></g>`).join("")}</svg>`;

export interface Hud { update: (dt: number, quad: [number, number][]) => void;
  /** 3D 动态头像画在屏幕上的哪一块（没有头像框、或者英雄阵亡时返回 null）。主程序每帧把英雄的头单独画进去 */
  faceRect: () => DOMRect | null; }

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
/** 把一张图贴到一个图标格子上：有图就显示图，没有就留着格子里的字 */
const art = (el: HTMLElement, url: string) => artKit(el, url);
const face = (el: HTMLElement, id: string) => art(el, `/assets/ui/face/${id}.webp`);
/** 商店的分类：推荐、全部，再是装备自己的五类（第九轮加了鞋子） */
const CATS: { id: string; name: string; icon: string }[] = [{ id: "rec", name: "推荐", icon: ICON.crown }, { id: "all", name: "全部", icon: ICON.bag }, { id: "攻击", name: "攻击", icon: ICON.ad }, { id: "法术", name: "法术", icon: ICON.ap }, { id: "防御", name: "防御", icon: ICON.ar }, { id: "辅助", name: "辅助", icon: ICON.wave }, { id: "鞋子", name: "鞋子", icon: ICON.ms }];
/** 一件装备由哪几件合成 */
const fromOf = (it: Item): string[] => (it.from ?? []).filter(id => itemOf(id));
const TIER = ["", "基础", "进阶", "成装"], ROLES: Role[] = ["坦克", "斗士", "刺客", "法师", "射手", "辅助"];
/** 一件装备的说明（商店的详情和装备格的浮层共用）：属性一行一条、被动、适合谁 */
const itemBody = (it: Item) => `<ul>${it.desc.split("，").map(x => `<li>${x.replace(/^\+\s*/, "")}</li>`).join("")}</ul>${it.passive ? `<div class="pv"><b>被动 · ${it.passive.name}</b>${it.passive.text}</div>` : ""}${it.fit ? `<div class="fit"><b>适合</b>${it.fit}</div>` : ""}`;

export function createHud(o: { sim: Sim; play: Play; fow: HTMLCanvasElement; half: number; onJump: (x: number, z: number) => void; feed?: SimEvent[]; diff?: string; spectate?: boolean; onMenu?: (what: "restart" | "home") => void; /** 镜头现在的朝向（弧度）。触屏的摇杆和技能拖拽要按它把屏幕上的方向转成地面上的方向 */ yaw?: () => number }): Hud {
  useKit(); const { sim, play } = o, style = document.createElement("style"); style.textContent = CSS.replace("STICK_BG", `url("data:image/svg+xml,${encodeURIComponent(STICK)}")`); document.head.appendChild(style);
  const actor = play.actor, kit = actor.kit, hh = sim.hero.h!, spec = !!o.spectate, touch = TOUCH && !spec;
  const root = document.createElement("div"); root.className = "hud ui-anim" + (touch ? " touch" : "");
  root.innerHTML = `<div class="hud-top"><span class="squad me" data-k="sq0"></span><div class="mid"><span class="k a num" data-k="k0">0</span><span class="clock"><b class="num" data-k="time">00:00</b><small>${ICON.tower}<span data-k="t0">9</span> · <span data-k="t1">9</span>${ICON.tower}</small></span><span class="k b num" data-k="k1">0</span></div><span class="squad foe" data-k="sq1"></span></div>
    <div class="hud-me"><button type="button" class="ui-ib" data-k="menu" title="菜单（Esc）">${ICON.menu}</button><span ${spec ? "hidden" : ""}><i>${ICON.swords}<b class="num" data-k="kda">0 / 0 / 0</b></i><i>补刀 <b class="num" data-k="cs">0</b></i></span></div>
    <div class="hud-feed"></div><div class="hud-ann" hidden></div>
    <div class="hud-map ui-panel ui-frame ui-orn"><canvas width="408" height="408"></canvas></div>
    <div class="hud-msg" hidden></div>
    ${touch ? TOUCH_HTML : ""}<div class="hud-hero" ${spec || touch ? "hidden" : ""}><div class="hb-face" data-k="face"><div class="nm">${kit.name} · ${kit.title}</div><div class="hb-lv num" data-k="lv" title="等级（外圈是经验）">1</div><div class="hb-rs num" data-k="rs"></div></div><div class="hb ui-panel ui-frame">
      <img class="hb-crest" src="${DIVIDER_URL}" alt="">
      <div class="hb-stats num"><span title="攻击">${ICON.ad}<b data-k="ad"></b></span><span title="法强">${ICON.ap}<b data-k="ap"></b></span><span title="护甲">${ICON.ar}<b data-k="ar"></b></span><span title="魔抗">${ICON.mr}<b data-k="mr"></b></span><span title="攻速">${ICON.as}<b data-k="as"></b></span><span title="移速">${ICON.ms}<b data-k="ms"></b></span></div>
      <div class="hb-mid"><div class="hb-act"><div class="skills"></div><div class="hb-sub"><button type="button" class="rc" data-k="recall" title="回城：原地站 5 秒回到出生点，挨打会打断"><kbd>B</kbd></button><button type="button" class="sh" data-k="shopbtn" title="商店（P）">${ICON.bag}<kbd>P</kbd></button></div></div><div class="bar hp"><i class="lag"></i><i></i><b></b><i class="tk"></i><span class="num" data-k="hp"></span><small class="num" data-k="hpr"></small></div><div class="bar mp"><i></i><span class="num" data-k="mp"></span></div></div>
      <div class="hb-right"><div class="inv">${'<b class="ico"></b>'.repeat(6)}</div><div class="gold num" data-k="goldbox" title="打开商店（P）"><span data-k="gold">0</span></div></div>
      <div class="tip ui-panel ui-frame" hidden></div><div class="buffs"></div><div class="recall" hidden><i></i><span>回城</span></div>
    </div></div>
    <div class="shop ui-panel ui-frame ui-orn" hidden><header><h3 class="ui-h">商店</h3><label class="q">${ICON.search}<input type="search" placeholder="搜索装备" enterkeyhint="search"></label><p class="why"></p><b class="num"><span data-k="gold2">0</span></b><button type="button" class="x ui-ib" aria-label="关闭">${ICON.close}</button></header>
      <nav class="cats">${CATS.map(c => `<button type="button" data-c="${c.id}">${c.icon}${c.name}</button>`).join("")}</nav><div class="list"></div><div class="det"></div>
      <footer>${touch ? "点一件看说明和合成路线，点“购买”买下（身上有的配件自动抵扣）；商店开着时点装备栏里的装备卖掉，退六成。只有在出生点或者阵亡时能买卖。" : "点一件看说明和合成路线，双击或者点“购买”买下（身上有的配件自动抵扣，只付差价）；点下方装备栏里的装备卖掉，退六成。只有在出生点或者阵亡时能买卖。"}</footer></div>
    <div class="board ui-panel ui-frame ui-orn" hidden></div>`;
  if (touch) root.querySelector(".hud-hero")!.remove();
  document.body.appendChild(root);
  // 桌面版按 1920×1080 设计，别的屏幕整体缩放（第九轮 ui2）：1366×768 缩到 0.78，再窄就按宽度收，栏和小地图不打架；大屏放大到 1.3 为止。触屏有自己的一套（--u）
  if (!touch) { const fit = () => { const k = Math.min(1.3, Math.max(0.78, Math.min(innerWidth / 1920, innerHeight / 1080)), innerWidth / 1400); root.style.setProperty("--k", k.toFixed(3)); }; fit(); addEventListener("resize", fit); }
  const q = (k: string) => root.querySelector(`[data-k="${k}"]`) as HTMLElement, set = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };
  const hpBar = root.querySelector(".bar.hp i:not(.lag):not(.tk)") as HTMLElement, hpLag = root.querySelector(".bar.hp .lag") as HTMLElement | null, hpTk = root.querySelector(".bar.hp .tk") as HTMLElement | null, shBar = root.querySelector(".bar.hp b") as HTMLElement, mpBar = root.querySelector(".bar.mp i") as HTMLElement,  msg = root.querySelector(".hud-msg") as HTMLElement, tip = root.querySelector(".tip") as HTMLElement, faceEl = q("face");
  const nameOf = (e: Ent | null) => (!e ? "" : e.h ? KITS[e.h.kit]?.name ?? e.h.kit : e.kind === "monster" ? MOBS[e.mob]?.name ?? "野怪" : e.kind === "tower" ? "防御塔" : e.kind === "core" ? "水晶" : "小兵");

  const board = root.querySelector(".board") as HTMLElement;
  // ---- 技能键：被动小一号、圆的；图标是图片 ----
  const btns: Partial<Record<SkillKey, HTMLButtonElement>> = {}, bar = root.querySelector(".skills")!;
  const skillTip = (d: SkillDef) => `<header><div class="ico">${d.name[0]}</div><div><h4>${d.name}</h4><small>${d.cast === "passive" ? "被动" : ({ self: "直接施放", dir: "朝一个方向", point: "选一个位置", unit: "选一个单位" } as Record<string, string>)[d.cast]}${d.minLevel ? ` · ${d.minLevel} 级学会` : ""}</small></div>${d.cast === "passive" ? "" : `<em>${d.key}</em>`}</header><p>${d.desc}</p>${d.cast === "passive" ? "" : `<div class="meta"><span>冷却 <u>${d.cd ?? 0} 秒</u></span>${d.mana ? `<span>法力 <b>${d.mana}</b></span>` : ""}${d.range ? `<span>距离 <u>${d.range} 米</u></span>` : ""}</div>`}`;
  for (const d of kit.skills) {
    const b = document.createElement("button"); b.type = "button"; b.className = "sk ico" + (d.cast === "passive" ? " p" : d.key === "R" ? " ult" : "");
    b.innerHTML = `${d.name[0]}${d.cast === "passive" ? "" : `<kbd>${d.key}</kbd>${d.mana ? `<span class="mp">${d.mana}</span>` : ""}<span class="dim"></span><span class="cd"></span><span class="lk">${ICON.lock}${d.minLevel ?? 1} 级</span>`}`; art(b, `/assets/ui/skill/${d.icon}.webp`);
    if (d.recast) b.insertAdjacentHTML("beforeend", `<span class="rc"></span><i class="rcb"></i>`);      // 第四阶段 iti-kit：多段施放的段数牌和剩余时间条（见样式里 .sk .rc）
    if (d.cast !== "passive" && !touch) b.addEventListener("click", e => { e.stopPropagation(); play.cancel(); play.cast(d.key); (e.currentTarget as HTMLElement).blur(); });
    if (touch && d.cast === "passive") { (root.querySelector(".tc-bars") as HTMLElement).appendChild(b); btns[d.key] = b; continue; }      // 被动的小图标放在血条旁边
    b.addEventListener("pointerenter", () => { tip.hidden = false; tip.innerHTML = skillTip(d); art(tip.querySelector(".ico") as HTMLElement, `/assets/ui/skill/${d.icon}.webp`); });
    b.addEventListener("pointerleave", () => { tip.hidden = true; });
    bar.appendChild(b); btns[d.key] = b; }
  let tc: Touch | null = null;
  if (touch) {      // 技能键绕着攻击键排成一段弧：从正左边往上排到正上方，大招在最上面、大一圈
    const act = kit.skills.filter(d => d.cast !== "passive"), n = act.length, A = n >= 4 ? [186, 153, 120, 87] : n === 3 ? [184, 137, 90] : [180, 120], R = 7.3;
    act.forEach((d, i) => { const b = btns[d.key]!, a = (A[Math.min(i, A.length - 1)] * Math.PI) / 180; b.style.setProperty("--x", (Math.cos(a) * R).toFixed(2)); b.style.setProperty("--y", (-Math.sin(a) * R).toFixed(2)); if (d.key === "R") b.classList.add("big"); });
    tc = bindTouch({ play, yaw: o.yaw ?? (() => 0), skills: act.map(d => ({ key: d.key, el: btns[d.key]! })), atk: q("atk"), stick: root.querySelector(".tc-stick") as HTMLElement, cancel: root.querySelector(".tc-cancel") as HTMLElement });
    root.querySelector(".hud-top .mid")!.addEventListener("click", e => { e.stopPropagation(); board.hidden = !board.hidden; if (!board.hidden) drawBoard(); });      // 点顶上的比分：开关计分板
    root.querySelector(".board")!.addEventListener("click", () => { board.hidden = true; });
  }
  const cdWas = new Map<HTMLElement, boolean>();
  const showCd = (b: HTMLButtonElement, v: number, max: number) => { const on = v > 0.05, dim = b.querySelector(".dim") as HTMLElement; b.classList.toggle("cool", on);
    if (on) { set(b.querySelector(".cd") as HTMLElement, v.toFixed(v < 1 ? 1 : 0)); const a = (1 - v / Math.max(0.01, max)) * 360; dim.style.background = `conic-gradient(rgba(0,0,0,.15) ${a}deg, rgba(255,240,200,.75) ${a}deg ${a + 1.2}deg, rgba(4,8,10,.76) 0)`; } else if (dim.style.background) dim.style.background = "";
    if (cdWas.get(b) && !on) { b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 600); }      // 冷却转好：亮一圈
    cdWas.set(b, on); };

  // ---- 装备栏和商店（第九轮：四十四件、三层合成；成装按职业分组；“推荐”是这个英雄的出装顺序；合成路线上标出身上已有的配件、只付差价） ----
  const free = new URLSearchParams(location.search).has("arena"), shop = root.querySelector(".shop") as HTMLElement, why = shop.querySelector(".why") as HTMLElement, slots = Array.from(root.querySelectorAll<HTMLElement>(".inv b")), det = shop.querySelector(".det") as HTMLElement, list = shop.querySelector(".list") as HTMLElement, search = shop.querySelector(".q input") as HTMLInputElement;
  const itemArt = (el: HTMLElement, id: string) => { el.textContent = itemOf(id)!.name[0]; el.classList.remove("has"); el.style.backgroundImage = ""; art(el, `/assets/ui/item/${id}.webp`); };
  const say = (t: string, bad = false) => { why.textContent = t; why.classList.toggle("bad", bad); };
  const build = buildFor(kit.id, kit.role), top = new Set(build), rec = new Set<string>(), addRec = (id: string) => { if (rec.has(id)) return; rec.add(id); for (const c of itemOf(id)?.from ?? []) addRec(c); }; build.forEach(addRec);      // rec：出装单上的和它们的全部配件
  let invKey = "?", sel = build[0] ?? ITEMS[0].id, cat = "all", priceT = 0;
  const badges: { bn: HTMLElement; bc: HTMLElement; id: string }[] = [];
  const drawInv = () => { const k = hh.items.join(","); if (k === invKey) return; invKey = k; badges.length = 0;
    slots.forEach((el, i) => { const id = hh.items[i]; el.textContent = ""; el.style.backgroundImage = ""; el.classList.remove("has"); el.style.cursor = id ? "pointer" : ""; if (!id) return; itemArt(el, id);
      const bn = document.createElement("i"), bc = document.createElement("u"); bn.className = "bn num"; bc.className = "bc"; el.append(bc, bn); badges[i] = { bn, bc, id }; });
    if (!shop.hidden) { list.querySelectorAll<HTMLElement>(".it").forEach(b => b.classList.toggle("own", hh.items.includes(b.dataset.id!))); prices(); } };
  /** 列表上的价钱按“现在买要付多少”显示（身上有配件就是差价）；买不起的压暗 */
  const prices = () => list.querySelectorAll<HTMLElement>(".it").forEach(b => { const c = check(hh, b.dataset.id!), sp = b.lastElementChild as HTMLElement; set(sp, String(c.cost)); b.classList.toggle("poor", hh.gold < c.cost); });
  const doBuy = (id: string) => { const r = buy(sim, sim.hero, id, free); sfx.ui(r.ok ? "buy" : "deny"); say(r.ok ? `买了${itemOf(id)!.name}${r.cost! < itemOf(id)!.cost ? `（配件抵了 ${itemOf(id)!.cost - r.cost!}，付了 ${r.cost}）` : ""}` : r.why ?? "", !r.ok); showDet(); };
  /** 合成树：一层一层往下画（成装 → 进阶件 → 基础件）。身上已有的那一格描绿、打勾，它下面就不用再画了 */
  const treeHtml = (id: string, got: Set<string>, path: string): string => { const it = itemOf(id)!, has = got.has(path), kids = has ? [] : fromOf(it);
    return `<div class="tn"><div class="ico n${has ? " got" : ""}" data-n="${id}"></div><small class="num${has ? " got" : ""}">${has ? "已有" : it.cost}</small>${kids.length ? `<div class="tk">${kids.map((c, j) => treeHtml(c, got, path ? path + "." + j : String(j))).join("")}</div>` : ""}</div>`; };
  function showDet() { const it = itemOf(sel)!, c = check(hh, it.id), can = atShop(sim, sim.hero, free) && c.ok, kids = fromOf(it), ups = intoOf(it.id), got = owned(hh.items, it.id);
    const root = `<div class="tn"><div class="ico n root" data-n="${it.id}"></div>${kids.length ? `<div class="tk">${kids.map((k, j) => treeHtml(k, got, String(j))).join("")}</div>` : ""}</div>`;
    det.innerHTML = `<div class="tree"><h6>合成路线${got.size ? `<b>配件抵 ${it.cost - c.cost}</b>` : ""}</h6>${root}${kids.length ? "" : `<p>基础装备：直接购买，不需要材料</p>`}${ups.length ? `<div class="up">可以合成 ${ups.map(x => `<div class="ico n" data-n="${x.id}"></div>`).join("")}</div>` : ""}</div>
      <div class="hd"><div class="ico"></div><div><h4>${it.name}</h4><em class="num">${it.cost}${c.cost < it.cost ? `<s>还需 ${c.cost}</s>` : ""}</em></div></div><small class="tg">${TIER[it.tier]} · ${it.tag}${top.has(it.id) ? " · 推荐给" + kit.name : rec.has(it.id) ? " · 推荐出装的配件" : ""}</small>${itemBody(it)}${it.lore ? `<p>${it.lore}</p>` : ""}<button type="button" class="buy ui-btn main" ${can ? "" : "disabled"}>${kids.length && c.cost < it.cost ? "合成" : "购买"} · ${c.cost}</button>`;
    itemArt(det.querySelector(".hd .ico") as HTMLElement, it.id); det.querySelectorAll<HTMLElement>("[data-n]").forEach(el => { itemArt(el, el.dataset.n!); el.title = itemOf(el.dataset.n!)!.name; el.addEventListener("click", e => { e.stopPropagation(); sel = el.dataset.n!; showDet(); }); });
    det.querySelector(".buy")!.addEventListener("click", e => { e.stopPropagation(); doBuy(sel); });
    list.querySelectorAll<HTMLElement>(".it").forEach(b => b.classList.toggle("sel", b.dataset.id === sel)); prices(); }
  /** 详情开着的时候钱在涨：购买键是否可按、差价跟着变 */
  const refreshBuy = () => { const bt = det.querySelector(".buy") as HTMLButtonElement | null; if (!bt) return; const it = itemOf(sel)!, c = check(hh, it.id), can = atShop(sim, sim.hero, free) && c.ok; if (bt.disabled === can) bt.disabled = !can; };
  slots.forEach((el, i) => { el.addEventListener("click", e => { e.stopPropagation(); if (!shop.hidden && hh.items[i]) { const nm = itemOf(hh.items[i])!.name; if (sell(sim, sim.hero, i, free)) say(`卖掉了${nm}`); else say("回到出生点才能卖", true); tip.hidden = true; showDet(); } });
    // 装备格的说明浮层（桌面）：名字、价钱（商店开着时是卖价）、属性、被动、适合谁
    if (!touch) { el.addEventListener("pointerenter", () => { const id = hh.items[i], it = id && itemOf(id); if (!it) return; tip.hidden = false;
      tip.innerHTML = `<header><div class="ico"></div><div><h4>${it.name}</h4><small>${TIER[it.tier]} · ${it.tag}</small></div><em class="num">${shop.hidden ? it.cost : "卖 " + Math.round(it.cost * 0.6)}</em></header>${itemBody(it)}`; itemArt(tip.querySelector(".ico") as HTMLElement, it.id); });
      el.addEventListener("pointerleave", () => { tip.hidden = true; }); } });
  const tile = (it: Item, no = 0) => { const b = document.createElement("button"); b.type = "button"; b.className = "it" + (!no && top.has(it.id) ? " rec" : ""); b.dataset.id = it.id; b.title = it.name + (top.has(it.id) ? "（推荐）" : ""); b.innerHTML = `<div class="ico"></div>${no ? `<b class="no num">${no}</b>` : ""}<span class="num">${it.cost}</span>`; itemArt(b.querySelector(".ico") as HTMLElement, it.id);
    b.addEventListener("click", e => { e.stopPropagation(); sel = it.id; showDet(); b.blur(); }); b.addEventListener("dblclick", e => { e.stopPropagation(); doBuy(it.id); }); return b; };
  const section = (key: string, title: string, sub = "") => { const c = document.createElement("div"); c.className = "cat"; c.dataset.s = key; c.innerHTML = `<h5>${title}${sub ? `<small>${sub}</small>` : ""}</h5><div></div>`; list.appendChild(c); return c.lastElementChild as HTMLElement; };
  const byCost = (a: Item, b: Item) => a.cost - b.cost || ITEMS.indexOf(a) - ITEMS.indexOf(b);
  { const row = section("boots", "鞋子", "只能带一双"); for (const it of ITEMS.filter(x => x.boots).sort(byCost)) row.appendChild(tile(it)); }
  for (const t of [1, 2] as const) { const row = section("t" + t, TIER[t], t === 1 ? "一项属性" : "两件基础件合成，带小被动"); for (const it of ITEMS.filter(x => x.tier === t && !x.boots).sort(byCost)) row.appendChild(tile(it)); }
  { const row = section("t3", "成装", "按职业：放在这个职业身上效果最好"); row.className = "roles";
    for (const r of ROLES) { const g = document.createElement("div"); g.className = "rg"; g.dataset.r = r; g.innerHTML = `<i>${r}</i><div></div>`; for (const it of ITEMS.filter(x => x.tier === 3 && x.roles?.[0] === r)) g.lastElementChild!.appendChild(tile(it)); row.appendChild(g); } }
  { // 推荐出装（只在“推荐”里显示）：按顺序一排，中间小箭头。放在最后、靠 CSS 的 order 排到最上面：第一个 .it 还是鞋子那一排（触屏回归测试点的是第一件）
    const row = section("path", "推荐出装", `${kit.name} · ${kit.role}`); row.className = "path"; build.forEach((id, i) => { if (i) row.appendChild(Object.assign(document.createElement("em"), { className: "ar" })); row.appendChild(tile(itemOf(id)!, i + 1)); }); }
  /** 分类和搜索：只切元素的 hidden，不重建 */
  const filter = () => { const s = search.value.trim(); shop.querySelectorAll<HTMLElement>(".cats button").forEach(b => b.classList.toggle("on", b.dataset.c === cat));
    const ok = (it: Item) => (cat === "all" || (cat === "rec" ? rec.has(it.id) : it.tag === cat)) && (!s || it.name.includes(s) || it.desc.includes(s) || !!it.passive?.text.includes(s) || !!it.passive?.name.includes(s) || !!it.fit?.includes(s));
    list.querySelectorAll<HTMLElement>(".cat").forEach(c => { if (c.dataset.s === "path") { c.hidden = cat !== "rec" || !!s; return; } if (c.dataset.s === "t3" && cat === "rec" && !s) { c.hidden = true; return; } let any = false;      /* “推荐”里成装已经在上面那一排了，下面只列配件 */
      c.querySelectorAll<HTMLElement>(".it").forEach(b => { const v = ok(itemOf(b.dataset.id!)!); b.hidden = !v; any ||= v; }); c.querySelectorAll<HTMLElement>(".rg").forEach(g => { g.hidden = !g.querySelector(".it:not([hidden])"); }); c.hidden = !any; }); };
  shop.querySelector(".cats")!.addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]"); if (!b) return; e.stopPropagation(); cat = b.dataset.c!; filter(); });
  search.addEventListener("input", filter); search.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") { search.blur(); toggleShop(false); } }); search.addEventListener("keyup", e => e.stopPropagation());      // 打字的时候不要触发游戏的快捷键
  const toggleShop = (on = shop.hidden) => { if (spec) return; if (on === shop.hidden) sfx.ui("open"); shop.hidden = !on; if (on) { invKey = "?"; drawInv(); filter(); say(atShop(sim, sim.hero, free) ? "带菱形的是推荐给这个英雄的；身上有的配件合成时自动抵扣。" : "现在只能看：回到出生点（或者阵亡时）才能买卖。", !atShop(sim, sim.hero, free)); showDet(); } else search.blur(); };
  q("goldbox").addEventListener("click", e => { e.stopPropagation(); toggleShop(); }); root.querySelector('[data-k="shopbtn"]')?.addEventListener("click", e => { e.stopPropagation(); toggleShop(); (e.currentTarget as HTMLElement).blur(); }); shop.querySelector(".x")!.addEventListener("click", () => toggleShop(false)); shop.addEventListener("pointerdown", e => e.stopPropagation());
  q("recall").addEventListener("click", e => { e.stopPropagation(); play.actor.recall(); (e.currentTarget as HTMLElement).blur(); });
  (window as any).__shop = { open: () => toggleShop(true), close: () => toggleShop(false), buy: (id: string) => buy(sim, sim.hero, id, free), sell: (i: number) => sell(sim, sim.hero, i, free), select: (id: string, c?: string) => { if (c) { cat = c; filter(); } sel = id; showDet(); } };

  // ---- 菜单（Esc 或者左上角的键）和计分板（按住 Tab）----
  let menu: HTMLElement | null = null;
  const toggleMenu = () => { if (menu) { menu.remove(); menu = null; return; } menu = document.createElement("div"); menu.className = "hud-menu";
    menu.innerHTML = `<div class="ui-panel ui-frame ui-orn"><h3 class="ui-h">菜单</h3><div class="ui-div"></div><button type="button" class="ui-btn main" data-a="go">继续</button><button type="button" class="ui-btn" data-a="snd">${sfx.muted() ? ICON.mute : ICON.snd}<span>声音：${sfx.muted() ? "关" : "开"}</span></button><button type="button" class="ui-btn" data-a="restart">${ICON.redo}重新开始这一局</button>${canFullscreen() ? `<button type="button" class="ui-btn" data-a="fs">${ICON.full}全屏 / 退出全屏</button>` : ""}<button type="button" class="ui-btn" data-a="home">${ICON.home}回主菜单</button><small>${o.diff ? `电脑：${({ easy: "简单", normal: "普通", hard: "困难" } as Record<string, string>)[o.diff] ?? o.diff}<br>` : ""}${touch ? "左下摇杆移动，也可以直接点地面<br>技能键点一下自动对准，按住拖动自己瞄，拖进“取消”不放<br>点顶上的比分看计分板，点小地图看别处" : "右键 移动 / 攻击（按住右键拖着走）· 左键 确认技能，按住拖动看别处<br>Q W E R 技能 · A 攻击最近的 · S 停下 · B 回城<br>P 商店 · Tab 计分板 · 空格 镜头回到英雄"}</small></div>`;
    menu.addEventListener("pointerdown", e => e.stopPropagation()); menu.addEventListener("click", e => { const t = (e.target as HTMLElement).closest<HTMLElement>("[data-a]"), a = t?.dataset.a; if (!a || !t) return; if (a === "go") toggleMenu(); else if (a === "snd") { sfx.setMuted(!sfx.muted()); t.innerHTML = `${sfx.muted() ? ICON.mute : ICON.snd}<span>声音：${sfx.muted() ? "关" : "开"}</span>`; } else if (a === "fs") { toggleFullscreen(); toggleMenu(); } else if (a === "restart") (o.onMenu ?? (() => location.reload()))("restart"); else (o.onMenu ?? (() => { location.href = location.pathname; }))("home"); }); root.appendChild(menu); };
  q("menu").addEventListener("click", e => { e.stopPropagation(); toggleMenu(); });
  addEventListener("keydown", e => { if (e.metaKey || e.ctrlKey) return;
    if (e.code === "KeyP" && !e.repeat) toggleShop();
    else if (e.code === "Escape" && !e.repeat) { if (!shop.hidden) toggleShop(false); else if (menu || !play.aiming()) toggleMenu(); }
    else if (e.code === "Tab") { e.preventDefault(); if (!e.repeat) { board.hidden = false; drawBoard(); } } });
  addEventListener("keyup", e => { if (e.code === "Tab") board.hidden = true; }); addEventListener("blur", () => { board.hidden = true; });
  /** 计分板：两队各一段（按每队五个人排得下），自己那行描亮。开着的时候每半秒重画一次 */
  function drawBoard() { const hs = sim.heroes().filter(e => e.h).sort((p, r) => posIdx(p) - posIdx(r)), m = Math.floor(sim.time / 60), s = Math.floor(sim.time % 60);      // 第九轮：每队按位置排，名字下面写位置
    const tr = (e: Ent) => { const h = e.h!, k = KITS[h.kit]; return `<tr class="${e.team === 0 ? "a" : "b"}${e === sim.hero && !spec ? " you" : ""}${e.alive ? "" : " dead"}"><td><div class="who"><div class="ico" data-f="${h.kit}">${k?.name[0] ?? "?"}</div><div><b>${k?.name ?? h.kit}</b><small>${isPos(h.pos) ? POS_NAME[h.pos] : k?.title ?? ""} · ${isPos(h.pos) && k?.role === POS_NAME[h.pos] ? k?.title : k?.role ?? ""}${e.alive ? "" : ` · ${Math.ceil(h.respawnIn)} 秒复活`}</small></div></div></td><td><span class="lv num"><i>${h.level}</i></span></td><td class="num">${h.kills} / ${h.deaths} / ${h.assists}</td><td class="num">${h.cs}</td><td class="num g">${e.team === 0 || sim.over || spec ? Math.floor(h.gold) : "—"}</td><td><div class="its">${Array.from({ length: 6 }, (_, j) => { const id = h.items[j]; return id ? `<div class="ico" data-i="${id}">${itemOf(id)?.name[0] ?? ""}</div>` : "<i></i>"; }).join("")}</div></td></tr>`; };
    const side = (t: number) => (spec ? (t === 0 ? "蓝方" : "红方") : t === 0 ? "我方" : "对方");
    board.innerHTML = `<div class="bh"><b class="a num">${sim.kills[0]}</b><h3 class="ui-h">计分板</h3><b class="b num">${sim.kills[1]}</b><span>${ICON.clock}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}</span></div><div class="ui-div"></div><table><thead><tr><th>英雄</th><th>等级</th><th>击杀 / 阵亡 / 助攻</th><th>补刀</th><th>金币</th><th>装备</th></tr></thead><tbody>${[0, 1].map(t => `<tr class="tm ${t ? "b" : "a"}"><td colspan="6">${side(t)} · 击杀 ${sim.kills[t]} · 剩 ${sim.towersLeft(t)} 塔</td></tr>${hs.filter(e => e.team === t).map(tr).join("")}`).join("")}</tbody></table>`;
    board.querySelectorAll<HTMLElement>("[data-f]").forEach(el => face(el, el.dataset.f!)); board.querySelectorAll<HTMLElement>("[data-i]").forEach(el => art(el, `/assets/ui/item/${el.dataset.i}.webp`)); }

  // ---- 顶栏两侧的头像 ----
  const squads: { e: Ent; el: HTMLElement; hp: HTMLElement; cd: HTMLElement; lv: HTMLElement }[] = [];
  // 第九轮（5v5）：两边都按位置从左往右排（上单、打野、中单、射手、辅助，照 Dota 2 顶栏的习惯）。电脑的英雄是陆续载进来的，来一个就重排一次
  const posIdx = (e: Ent) => { const i = POS.indexOf(e.h!.pos as Pos); return i < 0 ? 9 : i; };
  const squad = () => { let added = false; for (const e of sim.heroes()) { if (squads.some(s => s.e === e) || !e.h) continue; const k = KITS[e.h.kit], el = document.createElement("div"); el.className = "hd" + (e === sim.hero && !spec ? " you" : ""); el.title = k ? `${k.name} · ${k.title}${isPos(e.h.pos) ? `（${POS_NAME[e.h.pos]}）` : ""}` : e.h.kit;
      el.innerHTML = `<div class="ico" style="background-color:${hex(k?.color ?? 0x556066)}">${k?.name[0] ?? "?"}</div><em class="num"></em><u><i></i></u><b class="num"></b>`; face(el.firstElementChild as HTMLElement, e.h.kit);
      q(e.team === 0 ? "sq0" : "sq1").appendChild(el); squads.push({ e, el, hp: el.querySelector("u i") as HTMLElement, cd: el.querySelector("b") as HTMLElement, lv: el.querySelector("em") as HTMLElement }); added = true; }
    if (added) for (const tm of [0, 1]) { const box = q(tm === 0 ? "sq0" : "sq1"), mine = squads.filter(s => s.e.team === tm).sort((p, r) => posIdx(p.e) - posIdx(r.e)); if (tm === 0) mine.reverse(); for (const s of mine) box.appendChild(s.el); } };      // 我方那一栏是 row-reverse（第一个挨着比分），倒着放进去，看上去就是从左往右

  // ---- 击杀条和大字播报 ----
  const feedEl = root.querySelector(".hud-feed") as HTMLElement, ann = root.querySelector(".hud-ann") as HTMLElement, buffsEl = root.querySelector(".buffs") as HTMLElement, rcEl = root.querySelector(".recall") as HTMLElement; let annT = 0, first = true, buffKey = "", buffIds = "";
  const streak = new Map<number, { n: number; t: number }>(), cls = (e: Ent | null) => (!e || e.team === 2 ? "n" : e.team === 0 ? "a" : "b");
  const chip = (e: Ent | null) => (e && e.h ? `<div class="ico" data-f="${e.h.kit}" style="background-color:${hex(KITS[e.h.kit]?.color ?? 0x556066)}">${nameOf(e)[0]}</div>` : `<span>${nameOf(e) || "小兵"}</span>`);
  const SWORD = ICON.swords.replace("<svg ", `<svg class="x" `);
  const row = (c: string, html: string) => { const d = document.createElement("div"); d.className = "row " + c; d.innerHTML = html; d.querySelectorAll<HTMLElement>("[data-f]").forEach(el => face(el, el.dataset.f!)); feedEl.appendChild(d); while (feedEl.children.length > 5) feedEl.firstChild!.remove(); setTimeout(() => { d.style.opacity = "0"; setTimeout(() => d.remove(), 600); }, 7000); };
  const announce = (c: string, big: string, small = "", sec = 3.2) => { ann.innerHTML = `<h3 class="${c}">${big}</h3><div class="ui-div"></div>${small ? `<p>${small}</p>` : ""}`; ann.hidden = false; ann.style.opacity = "1"; ann.style.animation = "none"; void ann.offsetWidth; ann.style.animation = ""; annT = sec; };
  const side = (tm: number) => (spec ? (tm === 0 ? "蓝方" : "红方") : tm === 0 ? "我方" : "对方");
  function feed() { const f = o.feed; if (!f || !f.length) return;
    for (const ev of f) {
      if (ev.t === "kill") { const by = ev.by && ev.by.h ? ev.by : null;
        row(cls(ev.by ?? null), `${chip(ev.by ?? null)}${SWORD}${chip(ev.e)}${ev.assists.length ? `<div class="as">${ev.assists.map(chip).join("")}</div>` : ""}`);
        if (by) { const s = streak.get(by.id), n = s && sim.time - s.t < 10 ? s.n + 1 : 1; streak.set(by.id, { n, t: sim.time });
          const wiped = sim.heroes().filter(e => e.team === ev.e.team).every(e => !e.alive);
          if (first) { first = false; announce(cls(by), "第一滴血", `${nameOf(by)} 击杀了 ${nameOf(ev.e)}`); }
          else if (wiped) announce(cls(by), "团灭", `${side(by.team)}把对面全部击杀`, 4);
          else if (n >= 2) announce(cls(by), ["", "", "双杀", "三杀", "四杀", "五杀"][Math.min(n, 5)], `${nameOf(by)}`);
          else if (!spec && ev.e === sim.hero) announce("b", "你被击杀了", `${nameOf(by)}`, 2.4); else if (!spec && by === sim.hero) announce("a", "击杀", `${nameOf(ev.e)}`, 2.2); } }
      else if (ev.t === "boss") { const B = BUFFS[ev.mob]; row(cls(ev.by), `${chip(ev.by)}${SWORD}<span>${MOBS[ev.mob].name}</span>`); announce(ev.team === 0 ? "a" : "b", `${side(ev.team)}击杀了${MOBS[ev.mob].name}`, `${B.name}：${B.desc}`, 5); }
      else if (ev.t === "camp" && ev.camp.kind === "boss") announce("n", `${MOBS[ev.camp.mob].name}出现了`, `在${ev.camp.top ? "上" : "下"}河道。击杀它，全队获得${BUFFS[ev.camp.mob].name}`, 4.5);
      else if (ev.t === "die" && ev.e.kind === "tower") { row(ev.e.team === 0 ? "b" : "a", `<span>${side(1 - ev.e.team)}摧毁了一座防御塔</span>`); if (!spec && annT <= 0) announce(ev.e.team === 0 ? "b" : "a", ev.e.team === 0 ? "我方防御塔被摧毁" : "摧毁敌方防御塔", "", 2.4); }
    }
    f.length = 0; }

  // ---- 小地图 ----
  const cv = root.querySelector(".hud-map canvas") as HTMLCanvasElement, c = cv.getContext("2d")!, S = cv.width, H = o.half, P = (v: number) => ((v + H) / (2 * H)) * S;
  const bg = new Image(); let bgOk = false; bg.onload = () => { bgOk = true; }; bg.src = "/assets/map/ground_all.webp";
  const shade = document.createElement("canvas"); shade.width = shade.height = 192; const sc = shade.getContext("2d")!;
  const jump = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); o.onJump(((e.clientX - r.left) / r.width) * 2 * H - H, ((e.clientY - r.top) / r.height) * 2 * H - H); };
  let dragging = false; const wrap = cv.parentElement!;
  wrap.addEventListener("pointerdown", e => { dragging = true; wrap.setPointerCapture(e.pointerId); jump(e); e.stopPropagation(); });
  wrap.addEventListener("pointermove", e => { if (dragging) jump(e); }); wrap.addEventListener("pointerup", () => { dragging = false; }); wrap.addEventListener("pointercancel", () => { dragging = false; });
  const TEAM = ["#4fa6f5", "#e2584a", "#f6b53d"]      /* 第九轮 ui2 照 LoL：我方蓝、对方红、野怪琥珀；自己的头像是一圈亮金 */, faces = new Map<string, HTMLImageElement>();
  const faceImg = (id: string) => { let im = faces.get(id); if (!im) { im = new Image(); im.src = `/assets/ui/face/${id}.webp`; faces.set(id, im); } return im.complete && im.naturalWidth ? im : null; };
  function drawMap(quad: [number, number][]) {
    c.fillStyle = "#0d1a33"; c.fillRect(0, 0, S, S);
    if (bgOk) c.drawImage(bg, 0, 0, S, S);      /* 画风 B 的地面贴图本身就亮，不再像原来那样整体提亮一档 */
    sc.globalCompositeOperation = "source-over"; sc.fillStyle = "#a3b1cc"; sc.fillRect(0, 0, 192, 192); sc.globalCompositeOperation = "destination-out"; sc.drawImage(o.fow, 0, 0);      // 看不见的地方：和场景里的迷雾一样，压暗、偏冷、去饱和（第九轮，原来是盖一层黑）；画风 B 的地面亮，压得轻一点，不然整张小地图发黑
    if (!spec) { c.globalCompositeOperation = "multiply"; c.drawImage(shade, 0, 0, S, S); c.globalCompositeOperation = "saturation"; c.globalAlpha = 0.42; c.drawImage(shade, 0, 0, S, S); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; }
    for (const e of sim.ents) {
      if (!e.alive || (e.team !== 0 && !e.seen && !spec && e.kind !== "tower" && e.kind !== "core")) continue; const x = P(e.x), y = P(e.z); c.fillStyle = TEAM[e.team];
      if (e.kind === "tower") { c.fillRect(x - 5, y - 5, 10, 10); c.strokeStyle = "rgba(0,0,0,.7)"; c.lineWidth = 1.5; c.strokeRect(x - 5, y - 5, 10, 10); }
      else if (e.kind === "core") { c.beginPath(); c.moveTo(x, y - 10); c.lineTo(x + 10, y); c.lineTo(x, y + 10); c.lineTo(x - 10, y); c.closePath(); c.fill(); c.strokeStyle = "rgba(0,0,0,.7)"; c.lineWidth = 1.5; c.stroke(); }
      else if (e.kind === "monster") { const b = !!MOBS[e.mob]?.boss, r = b ? 7 : MOBS[e.mob]?.heavy ? 4.5 : 3; c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); if (b) { c.strokeStyle = "rgba(0,0,0,.8)"; c.lineWidth = 1.5; c.stroke(); } }
      else if (e.kind !== "hero") { c.beginPath(); c.arc(x, y, 3.2, 0, 6.283); c.fill(); }
    }
    if (quad.length === 4) { c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2; c.beginPath(); quad.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z)))); c.closePath(); c.stroke(); }
    // 英雄：圆形的小头像，外面一圈队伍色；自己的是白圈
    for (const e of sim.ents) { if (e.kind !== "hero" || !e.alive || (e.team === 1 && !e.seen && !spec)) continue; const x = P(e.x), y = P(e.z), r = 11, im = faceImg(e.h!.kit);
      c.save(); c.beginPath(); c.arc(x, y, r, 0, 6.283); c.closePath(); c.fillStyle = hex(KITS[e.h!.kit]?.color ?? 0x556066); c.fill(); if (im) { c.clip(); const s = Math.min(im.naturalWidth, im.naturalHeight) * 0.8; c.drawImage(im, (im.naturalWidth - s) / 2, 0, s, s, x - r, y - r, r * 2, r * 2); } c.restore();
      const me = e === sim.hero && !spec; c.strokeStyle = "rgba(2,4,5,.85)"; c.lineWidth = me ? 6 : 5; c.beginPath(); c.arc(x, y, r + 0.5, 0, 6.283); c.stroke(); c.strokeStyle = me ? "#f6e3ae" : TEAM[e.team]; c.lineWidth = me ? 3.5 : 2.5; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.stroke(); }
  }

  let mapT = 1, boardT = 0, lvWas = hh.level, goldWas = -1, hpWas = 1, maxWas = 0, gfN = 0;
  const lvEl = q("lv"), goldBox = q("goldbox");
  return { faceRect: () => (spec || !sim.hero.alive ? null : faceEl.getBoundingClientRect()),
    update(dt, quad) {
    const h = sim.hero, m = Math.floor(sim.time / 60), s = Math.floor(sim.time % 60), st = hh.stat;
    set(q("time"), `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`); set(q("t0"), String(sim.towersLeft(0))); set(q("t1"), String(sim.towersLeft(1))); set(q("k0"), String(sim.kills[0])); set(q("k1"), String(sim.kills[1]));
    squad(); for (const sq of squads) { const e = sq.e, dead = !e.alive; sq.el.classList.toggle("dead", dead); sq.el.classList.toggle("fog", !dead && e.team === 1 && !e.seen && !spec); sq.hp.style.width = `${Math.max(0, e.hp / e.max) * 100}%`; set(sq.lv, String(e.h!.level)); if (dead) set(sq.cd, String(Math.ceil(e.h!.respawnIn))); }
    feed(); if (annT > 0 && (annT -= dt) <= 0) { ann.style.opacity = "0"; setTimeout(() => { if (annT <= 0) ann.hidden = true; }, 600); }
    if (!board.hidden && (boardT += dt) > 0.5) { boardT = 0; drawBoard(); }
    mapT += dt; if (mapT > 0.1) { mapT = 0; drawMap(quad); }
    if (spec) return;
    tc?.update(dt);
    set(q("kda"), `${hh.kills} / ${hh.deaths} / ${hh.assists}`); set(q("cs"), String(hh.cs));
    set(lvEl, String(hh.level)); if (hh.level > lvWas) { lvEl.classList.remove("up"); void lvEl.offsetWidth; lvEl.classList.add("up"); } lvWas = hh.level;      // 升级：铜章跳一下
    { const sh = h.shield > 0 ? h.shield : 0, tot = Math.max(h.max, h.hp + sh), r = h.hp / tot; set(q("hp"), sh > 0 ? `${Math.ceil(h.hp)} +${Math.ceil(sh)} / ${h.max}` : `${Math.ceil(h.hp)} / ${h.max}`); hpBar.style.width = `${r * 100}%`; shBar.style.left = `${r * 100}%`; shBar.style.width = `${(sh / tot) * 100}%`; set(q("hpr"), h.alive && h.hp < h.max ? `+${(h.max * st.hpRegen * RULES.regen[sim.time - h.hurtAt > 5 ? 1 : 0]).toFixed(1)}` : "");
      if (hpLag && Math.abs(r - hpWas) > 0.002) { hpLag.style.transition = r > hpWas ? "none" : ""; hpLag.style.width = `${r * 100}%`; hpWas = r; }      // 掉血：浅色的一截慢半拍跟上；回血直接跟
      if (hpTk && tot !== maxWas) { maxWas = tot; hpTk.style.setProperty("--t", `${Math.min(100, (1000 / tot) * 100)}%`); } }      // 满一千一道刻度
    set(q("mp"), `${Math.floor(hh.mana)} / ${st.mana}`); mpBar.style.width = `${st.mana > 0 ? (hh.mana / st.mana) * 100 : 0}%`;
    { const xs = (hh.level >= 15 ? 1 : Math.min(1, hh.xp / RULES.level(hh.level))).toFixed(3); if (lvEl.style.getPropertyValue("--xp") !== xs) lvEl.style.setProperty("--xp", xs); }      // 经验：等级章外面那一圈（第九轮 ui2；原来是栏底一条 3 像素的细线，看不见）
    { const g = Math.floor(hh.gold); set(q("gold"), String(g)); if (goldWas >= 0 && g - goldWas >= 15 && gfN < 3) { const f = document.createElement("i"); f.className = "gf"; f.textContent = `+${g - goldWas}`; goldBox.appendChild(f); gfN++; setTimeout(() => { f.remove(); gfN--; }, 1150); } goldWas = g; }      // 进账（击杀、补刀、卖装备）飘一个数；被动的细水长流不飘
    drawInv();
    // 装备格上的层数（渐狂、三连）和冷却（伏击、锚定、钟鸣……）
    for (const g of badges) { if (!g) continue; const b = itemBadge(h, g.id); set(g.bn, b?.cd ? String(Math.ceil(b.cd)) : b?.n ? String(b.n) : ""); const bg = b?.cd ? `conic-gradient(rgba(3,6,8,.74) ${((b.cd / b.max!) * 360).toFixed(0)}deg, transparent 0)` : ""; if (g.bc.style.background !== bg) g.bc.style.background = bg; }
    if (!shop.hidden) { set(q("gold2"), String(Math.floor(hh.gold))); if ((priceT -= dt) <= 0) { priceT = 0.25; prices(); refreshBuy(); } }
    set(q("ad"), String(st.ad)); set(q("ap"), String(st.ap)); set(q("ar"), String(Math.round(st.armor))); set(q("mr"), String(Math.round(st.mr))); set(q("as"), st.as.toFixed(2)); set(q("ms"), st.ms.toFixed(1));
    const aim = play.aiming();
    for (const d of kit.skills) { const b = btns[d.key]!; if (d.cast === "passive") continue; const cdl = actor.cdLeft(d.key), lock = hh.level < (d.minLevel ?? 1), poor = hh.mana < (d.mana ?? 0); showCd(b, cdl, actor.cdMax(d.key)); b.classList.toggle("nomana", poor); b.classList.toggle("lock", lock); b.classList.toggle("aim", aim === d.key); b.classList.toggle("ready", cdl <= 0.05 && !lock && !poor); }
    // 第四阶段 iti-kit：多段施放的窗口里，按钮上标出再按是第几段、窗口还剩多久（段间隔里转着的冷却照常显示）；这一段不要法力时不显示“法力不够”
    for (const d of kit.skills) { if (!d.recast) continue; const b = btns[d.key]!, r = h.alive ? d.recast({ me: h, a: actor, now: sim.time }) : null; b.classList.toggle("recast", !!r);
      if (r) { set(b.querySelector(".rc") as HTMLElement, r.label ?? `${r.n}/${r.of}`); const w = `${Math.max(0, Math.min(1, r.left / Math.max(0.01, r.dur))) * 100}%`; const bar = b.querySelector(".rcb") as HTMLElement; if (bar.style.getPropertyValue("--rc") !== w) bar.style.setProperty("--rc", w); const pa = actor.skill(d.key); if (pa && !(pa.mana ?? 0)) b.classList.remove("nomana"); b.classList.toggle("ready", actor.cdLeft(d.key) <= 0.05); } }
    // 头像框：活着的时候是空的（主程序把 3D 的头画在后面）；阵亡时换成变灰的静态头像加倒计时
    { const dead = !h.alive && !sim.over; if (dead !== faceEl.classList.contains("dead")) { faceEl.classList.toggle("dead", dead); faceEl.style.backgroundImage = dead ? `url(/assets/ui/splash/${kit.id}.webp)` : ""; } if (dead) set(q("rs"), String(Math.ceil(sim.respawnIn))); }
    if (!h.alive && !sim.over) { msg.hidden = false; set(msg, `阵亡 · ${Math.ceil(sim.respawnIn)} 秒后在出生点复活`); } else if (!msg.hidden) msg.hidden = true;
    { const lst = [...hh.mods].filter(([id]) => id.startsWith("buff_")).map(([id, v]) => [id.slice(5), Math.ceil(v.left)] as const), key = lst.map(([id, t]) => id + t).join(","); if (key !== buffKey) { const now = lst.map(([id]) => id).join(","); buffKey = key;
        if (buffIds !== now) { buffIds = now; buffsEl.innerHTML = lst.map(([id]) => `<span class="ico" data-b="${id}" title="${BUFFS[id]?.name ?? id}：${BUFFS[id]?.desc ?? ""}" style="box-shadow:0 0 0 1px #020405,0 0 0 2px ${hex(BUFFS[id]?.color ?? 0xffffff)}">${BUFFS[id]?.name[0] ?? ""}<i class="num"></i></span>`).join(""); buffsEl.querySelectorAll<HTMLElement>("[data-b]").forEach(el => art(el, `/assets/ui/buff/${el.dataset.b}.webp`)); }
        lst.forEach(([, t], i) => { const el = buffsEl.children[i]?.querySelector("i"); if (el) el.textContent = String(t); }); } }
    { const rc = actor.recalling(); rcEl.hidden = rc <= 0; if (rc > 0) { (rcEl.firstElementChild as HTMLElement).style.width = `${(1 - rc / 5) * 100}%`; set(rcEl.lastElementChild as HTMLElement, `回城 ${rc.toFixed(1)}`); } }
  } };
}

/** 触屏时底部那一条换成这几块（元素的 data-k 和桌面版一样，每帧更新的代码两边通用）：
 *  中间是装备小格、增益、回城读条、等级、血条蓝条；右下是攻击键、技能键、回城键；左下是摇杆；左上小地图下面是金币（点开商店） */
const ATK_SVG = `<svg viewBox="0 0 32 32" fill="none" stroke="#f6e7bf" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M25.5 6.5 12 20M25.5 6.5l-5.2.6L10.2 17.2M25.5 6.5l-.6 5.2L14.8 21.8" /><path d="M8 15.5 16.5 24M10.4 21.6 6.5 25.5" /><circle cx="5.6" cy="26.4" r="1.4" fill="#f6e7bf"/></svg>`;
const TOUCH_HTML = `<div class="tc-stick"><i class="base"><b class="knob"></b></i></div>
    <div class="tc-vitals"><div class="recall" hidden><i></i><span>回城</span></div><div class="tc-row"><div class="inv">${'<b class="ico"></b>'.repeat(6)}</div><div class="buffs"></div></div>
      <div class="tc-bars"><div class="hb-lv num" data-k="lv">1</div><div class="tc-b"><div class="bar hp"><i class="lag"></i><i></i><b></b><i class="tk"></i><span class="num" data-k="hp"></span><small class="num" data-k="hpr"></small></div><div class="bar mp"><i></i><span class="num" data-k="mp"></span></div></div></div></div>
    <div class="tc-pad"><div class="skills"></div><button type="button" class="tc-atk" data-k="atk" aria-label="攻击">${ATK_SVG}</button><button type="button" class="tc-rc" data-k="recall" aria-label="回城">回城</button></div>
    <div class="gold num" data-k="goldbox"><span data-k="gold">0</span></div><div class="tc-cancel" hidden>${ICON.close}取消</div>
    <div hidden><div data-k="face"></div><span data-k="rs"></span><span data-k="kda"></span><span data-k="cs"></span><span data-k="ad"></span><span data-k="ap"></span><span data-k="ar"></span><span data-k="mr"></span><span data-k="as"></span><span data-k="ms"></span><div class="tip"></div></div>`;
