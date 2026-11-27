// 对局之外的几个界面（阶段 7 做的，第九轮按“顶流 MOBA”的完成度重做）：主菜单、选人、载入、结算。设计说明和线框在 docs/round9/ui/DESIGN.md。
//   · 主菜单：背景还是游戏里的地图（主程序让镜头在上空慢慢转），左边压暗，压上专门做的标题字（public/assets/ui/kit/wordmark.webp）、
//     一个亮铜的主按钮“开始对局”和两张模式卡（观战、测试场）；右上是设置（声音、全屏、画质）；右下是名册里十个英雄的头像（两个阵营各一排，即将上线的变暗），点一个直接带着它进选人。
//   · 选人：照 LoL 的选人布局：左右两列是两队的栏位（立绘、位置图标、名字，每队五个），中间是职业筛选和英雄卡，
//     下面一条是选中英雄的名字、职业、难度、技能预览、电脑难度和位置，最后是“锁定”。锁定有一段一秒的演出：卡片盖章、栏位亮一圈、名字横幅飞进来，然后才进载入。
//     第九轮（5v5）：先选位置（上单、打野、中单、射手、辅助，或者“随便”＝按英雄的主位置），再选英雄；队友按剩下的位置由电脑补齐（换位置、换英雄时跟着换），
//     对面五个在锁定的那一下才翻出来（照 LoL 的盲选）。英雄不分阵营，谁都能在任何一队。名册里还没有技能代码的英雄显示“即将上线”、不能选；海报还没出来的用名字的头一个字垫着。
//   · 载入：照 LoL 的载入画面：上下两排，每人一张竖的英雄卡（立绘、名字、称号、职业、分路），自己那张描亮铜；底下一句玩法提示和真的进度条。
//   · 结算：顶上胜负大字（获胜方的队伍色）加用时和比分，下面两队各一张表（头像、等级、战绩、补刀、金币、伤害条、装备），最佳和自己那行高亮。
// 画风 B（b-ui）换了皮：深海蓝玻璃 + 亮金描边，颜色和零件都在 uikit.ts（开头有说明）；首页、选人、载入、结算的底色从近黑的青灰换成深海蓝，布局和交互没动。
// 这几个界面之间不保留状态：选好以后把选择写进网址重新载入，直接进对局（带 ?h= 的网址本来就是这么进的，测试脚本走的也是这条路）。

import type { Sim } from "./sim";
import { ALL, KITS, ORDER, POS, POS_ICON, POS_NAME, ROSTER, canPick, infoOf, isPos, posOf, type Pos } from "./heroes";
import { lineupQuery, makeLineup, readLineup, seeded, type Lineup, type Slot } from "./lineup";
import { itemOf } from "./items";
import { canFullscreen, canInstall, install, installHint, toggleFullscreen } from "./mobile";
import { sfx } from "./sfx";
import { TOUCH } from "../quality";
import { DIFFICULTY, ICON, art, faceUrl, pips, roleIcon, splashUrl, useKit, wideUrl } from "./uikit";

const CSS = `
.lob{position:fixed;inset:0;z-index:8;font-family:var(--f);color:var(--txt);user-select:none;-webkit-user-select:none}
.lob *{box-sizing:border-box}.lob [hidden]{display:none!important}.lob button{font-family:var(--f);color:inherit;cursor:pointer}
/* ---------- 主菜单 ---------- */
.lob-home{position:absolute;inset:0;animation:ui-fade .6s var(--ez)}
.lob-home .hm-shade{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 58% 80% at 17% 64%,rgba(9,28,68,.66),rgba(9,28,68,.16) 70%,transparent),linear-gradient(90deg,rgba(9,28,68,.5),rgba(9,28,68,.06) 55%,rgba(9,28,68,.16)),linear-gradient(0deg,rgba(9,28,68,.52),transparent 32%),linear-gradient(180deg,rgba(9,28,68,.28),transparent 18%)}
.lob-home .hm-main{position:absolute;left:max(6vw,28px,calc(env(safe-area-inset-left,0px) + 18px));bottom:max(9vh,36px);display:flex;flex-direction:column;align-items:flex-start;width:min(560px,46vw)}
.lob-home .hm-mark{width:min(560px,40vw);height:auto;margin-left:-2%;filter:drop-shadow(0 10px 28px rgba(4,10,26,.6));animation:ui-in .9s var(--ez) both}
.lob-home .sub{margin:4px 0 34px;font:600 14px/1.6 var(--f);letter-spacing:.5em;color:#b0bbcc;animation:ui-in .9s .1s var(--ez) both}
.lob-home nav{display:flex;flex-direction:column;gap:14px;align-items:stretch;width:min(420px,100%);animation:ui-in .9s .18s var(--ez) both}
.lob-home .ui-btn.main{padding:20px 46px;font-size:21px}
.lob-home .hm-alt{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.hm-mode{position:relative;display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:3px 11px;align-items:center;padding:12px 14px;border:0;text-align:left;border-radius:5px;background:var(--glass);box-shadow:inset 0 0 0 1px rgba(241,201,108,.5),inset 0 2px 0 rgba(255,255,255,.18),0 0 0 1px rgba(6,19,49,.5),0 6px 18px rgba(4,14,40,.3);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:box-shadow .12s,transform .12s,background .12s}
.hm-mode:hover{box-shadow:inset 0 0 0 1px rgba(255,232,166,.95),inset 0 2px 0 rgba(255,255,255,.22),0 0 0 1px rgba(6,19,49,.5),0 0 18px rgba(255,220,130,.22),0 6px 22px rgba(4,14,40,.35);transform:translateY(-1px)}.hm-mode:active{transform:translateY(1px)}
.hm-mode svg{grid-row:1/3;width:30px;height:30px;color:var(--bz-l)}.hm-mode b{font:800 16px/1.2 var(--fd);letter-spacing:.24em;color:var(--pearl)}.hm-mode small{font:500 11.5px/1.45 var(--f);color:var(--mute)}
.hm-mode.wide{grid-column:1/-1}
.lob-home .tip{margin:14px 0 0;font:500 12.5px/1.6 var(--f);color:#ecce88;letter-spacing:.04em}
.lob-home .hm-top{position:absolute;top:max(18px,env(safe-area-inset-top,0px));right:max(22px,calc(env(safe-area-inset-right,0px) + 14px));display:flex;gap:10px}
.lob-home .hm-roster{position:absolute;right:max(3.4vw,22px,calc(env(safe-area-inset-right,0px) + 14px));bottom:max(9vh,36px);display:flex;flex-direction:column;align-items:flex-end;gap:10px;animation:ui-in .9s .28s var(--ez) both}
.hm-roster h5{margin:0;width:100%}.hm-roster .row{display:flex;gap:8px}
.hm-roster button{position:relative;width:62px;height:62px;padding:0;border:0;overflow:hidden;transform:rotate(45deg);background:#10295a center/150% no-repeat;box-shadow:0 0 0 1px #03060c,0 0 0 2.5px rgba(233,187,79,.55),0 6px 16px rgba(4,10,26,.5);transition:box-shadow .15s,filter .15s;filter:saturate(.85) brightness(.85);margin:8px}
.hm-roster button>i{position:absolute;inset:-22%;transform:rotate(-45deg);background:inherit;background-size:cover;background-position:center 20%}
.hm-roster button:hover{filter:none;box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l),0 0 18px rgba(251,223,158,.35)}
.hm-roster button.t{box-shadow:0 0 0 1px #03060c,0 0 0 2.5px rgba(111,224,214,.6),0 6px 16px rgba(4,10,26,.5)}.hm-roster button.e{box-shadow:0 0 0 1px #03060c,0 0 0 2.5px rgba(255,143,70,.6),0 6px 16px rgba(4,10,26,.5)}
.hm-roster .fac{white-space:nowrap;display:flex;align-items:center;gap:8px;font:700 12px/1 var(--fd);letter-spacing:.3em}.hm-roster .fac svg{width:16px;height:16px}.hm-roster .fac.t{color:var(--tide)}.hm-roster .fac.e{color:var(--ember)}
/* 设置 */
.lob-set{position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,24,58,.45);z-index:3;animation:ui-fade .18s var(--ez)}
.set-box{width:min(440px,92vw);padding:26px 30px 24px;animation:ui-in .2s var(--ez)}
.set-box h3{margin:0 0 4px;text-align:center}.set-box .ui-rule{margin:6px 30px 18px}
.set-row{display:grid;grid-template-columns:80px 1fr;align-items:center;gap:12px;padding:10px 0;border-top:1px solid rgba(255,255,255,.05);font:600 13px/1.3 var(--f);color:#aebacb;letter-spacing:.12em}
.set-row small{grid-column:2;font:500 11.5px/1.5 var(--f);color:var(--mute);letter-spacing:.02em;margin-top:-4px}
.ui-seg{display:flex;gap:4px}.ui-seg button{flex:1;padding:9px 4px;border:0;border-radius:4px;font:600 13px/1 var(--f);letter-spacing:.1em;color:#9eacc1;background:linear-gradient(180deg,#22427a,#15305e);box-shadow:inset 0 0 0 1px rgba(233,187,79,.22);transition:box-shadow .12s,color .12s,background .12s;display:inline-flex;align-items:center;justify-content:center;gap:5px}
.ui-seg button:hover{color:#fff}.ui-seg button.on{color:#fff8e5;background:linear-gradient(180deg,#3a6db6,#22498a);box-shadow:inset 0 0 0 1px var(--bz-l),inset 0 -2px 0 var(--bz)}.ui-seg button svg{width:16px;height:16px}
.set-box .close{display:flex;justify-content:center;margin-top:18px}
/* ---------- 选人 ---------- */
.lob-pick{position:absolute;inset:0;display:grid;grid-template-columns:clamp(210px,16.5vw,320px) minmax(0,1fr) clamp(210px,16.5vw,320px);grid-template-rows:auto minmax(0,1fr);gap:clamp(8px,1.4vh,18px) clamp(14px,1.8vw,34px);padding:clamp(12px,2vh,26px) max(clamp(14px,2.2vw,42px),env(safe-area-inset-right,0px)) clamp(12px,2.2vh,28px) max(clamp(14px,2.2vw,42px),env(safe-area-inset-left,0px));overflow:hidden;background:#0d2552;animation:ui-fade .3s var(--ez)}
.pk-bg{position:absolute;inset:0;background:#0d2552 center 18%/cover no-repeat;transform:scale(1.03);transition:transform 1.1s var(--ez),filter .6s;filter:saturate(.95) brightness(.92)}
.pk-bg.swap{animation:ui-fade .45s var(--ez)}
.lob-pick::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 60% 42% at 50% -8%,rgba(130,190,255,.26),transparent 70%),linear-gradient(90deg,rgba(9,25,58,.86),rgba(9,25,58,.42) 22%,rgba(9,25,58,.14) 50%,rgba(9,25,58,.42) 78%,rgba(9,25,58,.86)),linear-gradient(0deg,rgba(9,25,58,.88),rgba(9,25,58,.1) 45%,rgba(9,25,58,.36));pointer-events:none;z-index:1}      /* 压色的这一层原来排在 .pk-bg 下面，从来没盖上去（背景只靠 brightness 压暗）；画风 B 修好：抬到 1，内容抬到 2 */
.lob-pick>*:not(.pk-bg):not(.pk-banner){position:relative;z-index:2}
.pk-head{grid-column:1/-1;display:grid;grid-template-columns:1fr auto 1fr;align-items:center}
.pk-head .ui-ib{justify-self:start}.pk-title{text-align:center}.pk-title h2{margin:0;font-size:clamp(20px,1.7vw,30px)}.pk-title .ui-rule{width:min(420px,40vw);margin:6px auto 4px}.pk-title p{margin:0}
.pk-head .side{justify-self:end;display:flex;align-items:center;gap:8px;font:500 12px/1.4 var(--f);color:var(--mute);letter-spacing:.06em;max-width:280px;text-align:right}.pk-head .side svg{width:18px;height:18px;flex:none;color:var(--bz)}
.pk-team{display:flex;flex-direction:column;gap:clamp(6px,1vh,10px);min-height:0}
.pk-team h5{margin:0 0 2px;display:flex;align-items:baseline;gap:10px;font:900 15px/1 var(--fd);letter-spacing:.3em;color:var(--pearl)}.pk-team h5 i{font:600 11px/1 var(--f);font-style:normal;letter-spacing:.2em}
.pk-team.a h5{color:#a8d4ff}.pk-team.b{text-align:right}.pk-team.b h5{justify-content:flex-end;color:#ffb0a2}
.pk-team h5 i.t{color:var(--tide)}.pk-team h5 i.e{color:var(--ember)}
.slot{position:relative;height:min(clamp(64px,10.4vh,118px),calc((100vh - 230px)/5));display:grid;grid-template-columns:1fr;align-items:end;overflow:hidden;background:#10295a center 18%/cover no-repeat;box-shadow:inset 0 0 0 1px rgba(233,187,79,.3),0 6px 16px rgba(4,10,26,.4);transition:box-shadow .3s}
.slot::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(9,25,58,.92) 20%,rgba(9,25,58,.62) 46%,rgba(9,25,58,.15) 80%,rgba(9,25,58,.08))}      /* b-polish：新海报亮，名字那一列（左边四成）压不住，深蓝往右多铺一点 */
.pk-team.b .slot::before{background:linear-gradient(270deg,rgba(9,25,58,.92) 20%,rgba(9,25,58,.62) 46%,rgba(9,25,58,.15) 80%,rgba(9,25,58,.08))}
.slot>div{position:relative;display:flex;align-items:center;gap:10px;padding:0 14px;height:100%}.pk-team.b .slot>div{flex-direction:row-reverse}
.slot svg{width:22px;height:22px;flex:none;color:var(--bz-l);opacity:.9}
.slot b{display:block;font:800 17px/1.25 var(--fd);letter-spacing:.14em;color:#fff;text-shadow:0 1px 2px rgba(6,19,49,.95),0 0 8px rgba(6,19,49,.7)}.slot small{display:block;font:500 11.5px/1.4 var(--f);color:#b4c0d2;letter-spacing:.06em;text-shadow:0 1px 2px rgba(6,19,49,.95)}
.slot.a{border-left:3px solid var(--me)}.slot.b{border-right:3px solid var(--foe)}
.slot.you{box-shadow:inset 0 0 0 1.5px var(--bz-l),0 0 22px rgba(251,223,158,.18)}.slot.you b::after{content:"你";margin-left:8px;padding:2px 5px;font:800 10px/1 var(--f);letter-spacing:0;color:#1b1407;background:var(--bz-l);vertical-align:3px}
.slot.empty{background-image:none!important;background:repeating-linear-gradient(135deg,rgba(160,200,255,.035) 0 8px,transparent 8px 16px),rgba(14,34,74,.42)}.slot.empty b{color:var(--dim)}
.pk-mid{display:flex;flex-direction:column;gap:clamp(8px,1.4vh,14px);min-height:0;min-width:0}
.pk-filter{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.pk-filter button{display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:0;border-radius:999px;font:600 12.5px/1 var(--f);letter-spacing:.14em;color:#8b9cb5;background:rgba(16,36,76,.7);box-shadow:inset 0 0 0 1px rgba(233,187,79,.2);transition:color .12s,box-shadow .12s}
.pk-filter button svg{width:16px;height:16px}.pk-filter button:hover{color:#fff}.pk-filter button.on{color:#fff7e0;box-shadow:inset 0 0 0 1px var(--bz-l),inset 0 -2px 0 var(--bz);background:rgba(44,84,148,.85)}
.lob-pick .grid{flex:1;min-height:0;overflow:auto;padding:4px;scrollbar-width:thin}
.lob-pick .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(clamp(104px,8.6vw,176px),1fr));gap:clamp(8px,.7vw,12px)}
.lob-pick .card{position:relative;aspect-ratio:3/4;padding:0;border:0;overflow:hidden;text-align:left;background:#10295a;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.28),0 8px 20px rgba(4,10,26,.45);transition:box-shadow .15s,transform .15s var(--ez),filter .15s;filter:saturate(.82) brightness(.84)}
.card .cd-art{position:absolute;inset:0;background:center 5%/cover no-repeat;transition:transform .35s var(--ez)}
.card::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(9,25,58,.96) 4%,rgba(9,25,58,.68) 22%,rgba(9,25,58,.3) 40%,transparent 58%);pointer-events:none}      /* b-polish：新海报亮，名字下面那行小字压在亮处发虚，下半截加深一点 */
.card .cd-t{position:absolute;left:0;right:0;bottom:0;z-index:1;padding:0 10px 9px}.card .cd-t b{display:block;font:800 clamp(14px,1vw,18px)/1.25 var(--fd);letter-spacing:.14em;color:#fff;text-shadow:0 1px 2px rgba(6,19,49,.95),0 0 8px rgba(6,19,49,.75)}.card .cd-t small{display:block;font:500 11px/1.4 var(--f);color:#b9c5d6;letter-spacing:.06em;text-shadow:0 1px 2px rgba(6,19,49,.95)}
.card .cd-r{position:absolute;left:7px;top:7px;z-index:1;width:26px;height:26px;display:grid;place-items:center;color:var(--bz-l);background:rgba(9,25,58,.75);box-shadow:inset 0 0 0 1px rgba(233,187,79,.5);transform:rotate(45deg)}.card .cd-r svg{width:15px;height:15px;transform:rotate(-45deg)}
.card .cd-f{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:2}.card.t .cd-f{background:linear-gradient(90deg,transparent,var(--tide),transparent)}.card.e .cd-f{background:linear-gradient(90deg,transparent,var(--ember),transparent)}
.card:hover{filter:none;transform:translateY(-3px)}.card:hover .cd-art{transform:scale(1.05)}
.card.sel{filter:none;box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l),0 0 26px rgba(251,223,158,.3),0 10px 24px rgba(4,10,26,.5)}
.card.sel::before{content:"";position:absolute;right:7px;top:7px;z-index:2;width:18px;height:18px;transform:rotate(45deg);background:var(--bz-l);box-shadow:0 0 0 2px rgba(9,25,58,.8)}
.card.taken{filter:grayscale(.9) brightness(.45)}
.pk-info{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.25fr) minmax(250px,.95fr);gap:clamp(12px,1.4vw,24px);align-items:stretch;padding:clamp(12px,1.6vh,18px) clamp(14px,1.4vw,22px)}
.pk-who{display:flex;flex-direction:column;gap:6px;min-width:0;justify-content:center}
.pk-who h3{margin:0;font:900 clamp(26px,2.4vw,44px)/1.1 var(--fd);letter-spacing:.16em;color:#fff;text-shadow:0 2px 16px rgba(4,10,26,.6)}
.pk-who .tt{font:600 13px/1.4 var(--f);color:#c3cbd8;letter-spacing:.18em}
.pk-who .tags{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font:600 12px/1 var(--f);color:#9eacc1;letter-spacing:.08em}
.pk-who .tags span{display:inline-flex;align-items:center;gap:5px}.pk-who .tags svg{width:16px;height:16px;color:var(--bz-l)}
.fac-tag{padding:4px 8px;font:700 11px/1 var(--fd)!important;letter-spacing:.24em!important}.fac-tag.t{color:var(--tide)!important;box-shadow:inset 0 0 0 1px rgba(111,224,214,.45)}.fac-tag.e{color:var(--ember)!important;box-shadow:inset 0 0 0 1px rgba(255,143,70,.45)}
.pk-sk{display:flex;flex-direction:column;gap:8px;min-width:0}
.pk-sk .sks{display:flex;gap:8px}
.pk-sk .s{position:relative;width:clamp(40px,3.1vw,56px);aspect-ratio:1;padding:0;border:0;cursor:help;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.35);transition:box-shadow .12s,transform .12s}
.pk-sk .s kbd{position:absolute;left:0;bottom:0;z-index:4;padding:2px 4px;font:700 10px/1 var(--f);color:#faedca;background:rgba(9,25,58,.85)}
.pk-sk .s.on{box-shadow:0 0 0 1px #03060c,0 0 0 2px var(--bz-l),0 0 14px rgba(251,223,158,.3);transform:translateY(-2px)}
.pk-sk .sd{margin:0;font:400 12.5px/1.6 var(--f);color:#bdc6d4;overflow:auto;min-height:0;flex:1}.pk-sk .sd b{color:#fff7e0;font-weight:700;letter-spacing:.08em;margin-right:6px}.pk-sk .sd em{font-style:normal;color:var(--mute);margin-left:6px;font-size:11.5px}
.pk-go{display:flex;flex-direction:column;gap:8px;justify-content:flex-end}
.pk-go .opt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 10px;align-items:center;font:600 11.5px/1 var(--f);color:var(--mute);letter-spacing:.16em}
.pk-go .ui-seg button{padding:8px 2px;font-size:12px}
.pk-go .ui-btn.main{margin-top:4px;padding:15px 20px;width:100%}
/* 锁定的演出 */
.lob-pick.locking .pk-bg{transform:scale(1.09);filter:saturate(1.05) brightness(.8)}
.lob-pick.locking .card:not(.sel){filter:grayscale(1) brightness(.3);transition:filter .5s}
.lob-pick.locking .card.sel{animation:pk-stamp .5s var(--ez)}
@keyframes pk-stamp{0%{transform:scale(1)}35%{transform:scale(1.07)}100%{transform:scale(1)}}
.card .seal{position:absolute;left:50%;top:42%;z-index:3;transform:translate(-50%,-50%) rotate(-8deg);padding:7px 12px;font:900 15px/1 var(--fd);letter-spacing:.3em;color:#1b1407;background:linear-gradient(180deg,#fff4d6,#e9bb4f);box-shadow:0 0 0 2px rgba(9,25,58,.85),0 0 22px rgba(251,223,158,.55);animation:ui-pop .4s .1s var(--ez) both}
.lob-pick.locking .slot.you{animation:ui-ring .9s var(--ez) 2}
.pk-banner{position:absolute;left:0;right:0;top:42%;z-index:5;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;animation:pk-fly .9s var(--ez) both}
.pk-banner b{font:900 clamp(44px,5.4vw,96px)/1 var(--fd);letter-spacing:.24em;padding-left:.24em;color:#fff;text-shadow:0 4px 30px rgba(4,10,26,.8),0 0 40px rgba(251,223,158,.35)}.pk-banner .ui-rule{width:min(640px,70vw)}.pk-banner small{font:600 14px/1 var(--f);letter-spacing:.5em;color:var(--bz-l)}
@keyframes pk-fly{0%{opacity:0;transform:translateX(-6%) scale(.96)}30%{opacity:1;transform:none}100%{opacity:1}}
/* ---------- 载入 ---------- */
.lob-load{position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto minmax(0,1fr) auto;justify-items:center;gap:clamp(6px,1.4vh,16px);padding:clamp(12px,2.4vh,30px) max(16px,env(safe-area-inset-right,0px)) clamp(12px,2.2vh,26px) max(16px,env(safe-area-inset-left,0px));background:#0d2552;overflow:hidden}
.ld-bg{position:absolute;inset:-30px;background:#0d2552 center/cover no-repeat;filter:blur(14px) saturate(.45) brightness(.72);transform:scale(1.04)}
.lob-load::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 75% 60% at 50% 46%,rgba(56,112,200,.42),rgba(16,42,94,.7) 58%,rgba(8,22,52,.9));pointer-events:none;z-index:1}      /* 同上：原来盖不到 .ld-bg 上 */
.lob-load>*:not(.ld-bg){position:relative;z-index:2}
.ld-head{display:flex;align-items:center;gap:18px}.ld-head img{height:clamp(30px,5vh,56px);width:auto;filter:drop-shadow(0 4px 12px rgba(4,10,26,.6))}.ld-head .ui-cap{font-size:12px}
.ld-team{display:flex;gap:clamp(8px,1vw,18px);align-items:stretch;justify-content:center;height:100%;min-height:0}
.ld-card{position:relative;height:100%;aspect-ratio:3/4.1;max-width:calc((100vw - 120px)/5.3);overflow:hidden;background:#10295a center 4%/cover no-repeat;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.32),0 12px 30px rgba(4,10,26,.55);animation:ui-in .6s var(--ez) both}
.ld-card::before{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(9,25,58,.97) 8%,rgba(9,25,58,.82) 24%,rgba(9,25,58,.42) 40%,transparent 58%)}      /* b-polish：b-art 的新海报比旧的亮得多，名字、称号压在海报中段的亮处看不清（岚的“汐刃”压在白浪上）；底下的深蓝铺高、加深一点，字再加一层深蓝的字影（界面的字影都是深蓝） */
.ld-card .t{position:absolute;left:0;right:0;bottom:0;padding:0 8% 7%;text-align:center}
.ld-card b{display:block;font:900 clamp(15px,2.1vh,26px)/1.2 var(--fd);letter-spacing:.16em;padding-left:.16em;color:#fff;text-shadow:0 1px 2px rgba(6,19,49,.95),0 0 10px rgba(6,19,49,.75)}
.ld-card small{display:block;margin-top:2px;font:500 clamp(10px,1.25vh,13px)/1.4 var(--f);color:#c3cede;letter-spacing:.12em;text-shadow:0 1px 2px rgba(6,19,49,.95),0 0 8px rgba(6,19,49,.8)}
.ld-card .ln{display:flex;justify-content:center;gap:10px;margin-top:clamp(4px,.8vh,9px);padding-top:clamp(4px,.8vh,8px);border-top:1px solid rgba(233,187,79,.28);font:600 clamp(10px,1.2vh,12px)/1 var(--f);color:#e9d29c;letter-spacing:.08em}
.ld-card .ln span{display:inline-flex;align-items:center;gap:4px}.ld-card .ln svg{width:1.35em;height:1.35em;color:var(--bz-l)}
.ld-card .bar{position:absolute;left:0;right:0;top:0;height:3px}.ld-team.a .bar{background:var(--me)}.ld-team.b .bar{background:var(--foe)}
.ld-card.you{box-shadow:0 0 0 1px #03060c,0 0 0 2.5px var(--bz-l),0 0 30px rgba(251,223,158,.3),0 12px 30px rgba(4,10,26,.55)}
.ld-card.you::after{content:"你";position:absolute;right:8px;top:10px;padding:3px 6px;font:800 11px/1 var(--f);color:#1b1407;background:var(--bz-l)}
.ld-card .fx{position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.18) 50%,transparent 65%) -160% 0/60% 100% no-repeat;animation:ui-sheen 1.4s var(--ez) both}
.ld-note{align-self:center;max-width:420px;padding:18px 24px;font:500 13px/1.7 var(--f);color:#bbc5d4;text-align:center}
.ld-vs{display:flex;align-items:center;gap:16px;width:min(900px,80vw)}.ld-vs .ui-rule{flex:1}.ld-vs b{font:900 clamp(18px,2.6vh,30px)/1 var(--fd);letter-spacing:.3em;padding-left:.3em;color:var(--bz-l);text-shadow:0 0 18px rgba(251,223,158,.3)}
.ld-foot{width:min(980px,92vw);display:flex;flex-direction:column;gap:9px;align-items:center}
.ld-tip{margin:0;font:500 clamp(11.5px,1.5vh,14px)/1.6 var(--f);color:#c9d1dc;letter-spacing:.04em;text-align:center}.ld-tip b{color:var(--bz-l);font-weight:700;margin-right:10px;letter-spacing:.2em}
.ld-bar{display:flex;align-items:center;gap:12px;width:100%}.ld-bar u{flex:1;position:relative;height:6px;background:rgba(9,25,58,.8);box-shadow:inset 0 0 0 1px rgba(233,187,79,.35);overflow:hidden;text-decoration:none}
.ld-bar u i{position:absolute;left:1px;top:1px;bottom:1px;width:0;background:linear-gradient(90deg,#c08b20,#fbdf9e);box-shadow:0 0 10px rgba(251,223,158,.5);transition:width .35s linear}
.ld-bar u.idle i{width:30%;animation:ld-run 1.2s linear infinite}@keyframes ld-run{from{transform:translateX(-100%)}to{transform:translateX(340%)}}
.ld-bar span{min-width:3.2em;font:700 13px/1 var(--f);color:var(--bz-l);text-align:right;font-variant-numeric:tabular-nums}
/* ---------- 结算 ---------- */
.hud-end{position:fixed;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(10px,2.2vh,24px);padding:clamp(12px,3vh,36px) max(16px,env(safe-area-inset-right,0px)) clamp(12px,3vh,36px) max(16px,env(safe-area-inset-left,0px));background:radial-gradient(ellipse 80% 60% at 50% 28%,rgba(36,82,152,.88),rgba(10,28,64,.94) 62%,rgba(8,20,48,.97));font-family:var(--f);color:var(--txt);animation:ui-fade .7s var(--ez);overflow:auto;user-select:none;-webkit-user-select:none}
.hud-end *{box-sizing:border-box}
.ed-banner{display:flex;flex-direction:column;align-items:center;gap:8px;animation:ui-in .8s var(--ez) both}
.hud-end h2{margin:0;font:900 clamp(48px,7.6vw,118px)/1 var(--fd);letter-spacing:.34em;padding-left:.34em;text-shadow:0 0 50px currentColor,0 4px 0 rgba(4,10,26,.5)}
.hud-end h2.win{color:#a8d4ff}.hud-end h2.lose{color:#ff9a84}
.ed-banner .ui-rule{width:min(720px,80vw)}
.ed-sub{display:flex;align-items:center;gap:22px;font:600 14px/1 var(--f);color:#b0bbcc;letter-spacing:.14em}.ed-sub b{font:800 30px/1 var(--f);font-variant-numeric:tabular-nums;letter-spacing:0}.ed-sub b.a{color:var(--me)}.ed-sub b.b{color:var(--foe)}.ed-sub span{display:inline-flex;align-items:center;gap:6px}.ed-sub svg{width:16px;height:16px;color:var(--bz-l)}
.ed-teams{display:grid;grid-template-columns:1fr 1fr;gap:clamp(12px,1.6vw,28px);width:min(1500px,100%)}
.ed-team{padding:14px 16px 12px;animation:ui-in .7s var(--ez) both}.ed-team.b{animation-delay:.12s}
.ed-team header{display:flex;align-items:center;gap:10px;padding:0 4px 9px;margin-bottom:4px;border-bottom:1px solid rgba(233,187,79,.25)}
.ed-team header b{font:900 17px/1 var(--fd);letter-spacing:.3em}.ed-team.a header b{color:#a8d4ff}.ed-team.b header b{color:#ffb0a2}
.ed-team header em{font-style:normal;padding:3px 7px;font:800 11px/1 var(--f);letter-spacing:.2em}.ed-team header em.w{color:#1b1407;background:var(--bz-l)}.ed-team header em.l{color:var(--mute);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.ed-team header span{margin-left:auto;font:700 12px/1 var(--f);color:var(--mute);letter-spacing:.12em}
.ed-th,.ed-row{display:grid;grid-template-columns:minmax(150px,1.6fr) 42px 92px 50px 64px minmax(70px,1fr) 150px;gap:10px;align-items:center;padding:0 6px}
.ed-th{font:700 10.5px/1 var(--f);letter-spacing:.2em;color:var(--dim);padding-top:4px;padding-bottom:6px}
.ed-row{position:relative;min-height:54px;font:600 13.5px/1 var(--f);font-variant-numeric:tabular-nums;border-top:1px solid rgba(255,255,255,.04);animation:ui-in .5s var(--ez) both}
.ed-row.you{background:linear-gradient(90deg,rgba(251,223,158,.12),rgba(251,223,158,.02));box-shadow:inset 3px 0 0 var(--bz-l)}
.ed-row .who{display:flex;align-items:center;gap:10px;min-width:0}.ed-row .who .ui-ico{width:42px;height:42px;flex:none;box-shadow:0 0 0 1px #03060c,0 0 0 2px rgba(233,187,79,.35)}
.ed-row .who b{display:block;font:800 14.5px/1.25 var(--fd);letter-spacing:.1em;white-space:nowrap}.ed-row .who small{display:block;font:500 11px/1.3 var(--f);color:var(--mute)}
.ed-row .mvp{display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:2px 5px;font:800 10px/1 var(--f);color:#1b1407;background:var(--bz-l);vertical-align:2px}.ed-row .mvp svg{width:11px;height:11px}
.ed-row .lv{display:grid;place-items:center;width:28px;height:28px;font:700 12px/1 var(--f);color:var(--bz-l);transform:rotate(45deg);box-shadow:inset 0 0 0 1px rgba(233,187,79,.6);background:rgba(9,25,58,.6)}.ed-row .lv i{transform:rotate(-45deg);font-style:normal}
.ed-row .g{color:var(--gold)}.ed-row .k i{color:var(--dim);font-style:normal;margin:0 3px}
.ed-row .dm{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:#bec7d5}.ed-row .dm u{display:block;height:4px;background:rgba(255,255,255,.07);text-decoration:none}.ed-row .dm u i{display:block;height:100%;background:linear-gradient(90deg,#c08b20,#fbdf9e)}
.ed-row .its{display:grid;grid-template-columns:repeat(6,22px);gap:3px}.ed-row .its i{width:22px;height:22px;background:rgba(6,18,44,.5) center/cover;box-shadow:inset 0 0 0 1px rgba(160,200,255,.1)}
.hud-end nav{display:flex;gap:14px;animation:ui-in .7s .3s var(--ez) both}.hud-end nav .ui-btn{min-width:180px}
.lob-pick .grid,.pk-sk .sd,.hud-end{touch-action:pan-y;-webkit-overflow-scrolling:touch}
/* ---------- 第九轮 5v5：选位置、即将上线的英雄、位置的分段键 ---------- */
.pk-pos{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;animation:ui-in .3s var(--ez)}
.pk-pos h3{margin:0;font-size:clamp(18px,1.5vw,26px)}.pk-pos .ui-rule{width:min(460px,60%)}.pk-pos .ui-cap{margin:0 0 clamp(8px,1.6vh,18px)}
.pk-pos .tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1vw,16px);width:min(860px,100%)}
.pk-pos .tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:clamp(12px,2vh,22px) 10px clamp(10px,1.6vh,16px);border:0;text-align:center;border-radius:6px;background:var(--glass);box-shadow:inset 0 0 0 1px rgba(241,201,108,.48),inset 0 2px 0 rgba(255,255,255,.16),0 0 0 1px rgba(6,19,49,.5),0 8px 22px rgba(4,14,40,.35);transition:box-shadow .12s,transform .12s var(--ez),background .12s}
.pk-pos .tile:hover{box-shadow:inset 0 0 0 1.5px rgba(255,232,166,.95),inset 0 2px 0 rgba(255,255,255,.2),0 0 0 1px rgba(6,19,49,.5),0 0 24px rgba(255,220,130,.2),0 8px 22px rgba(4,14,40,.4);transform:translateY(-2px);background:linear-gradient(180deg,rgba(62,110,180,.9),rgba(26,56,110,.92))}.pk-pos .tile:active{transform:translateY(1px)}
.pk-pos .tile>svg{width:clamp(30px,2.6vw,44px);height:clamp(30px,2.6vw,44px);color:var(--bz-l)}
.pk-pos .tile b{font:900 clamp(16px,1.3vw,22px)/1.2 var(--fd);letter-spacing:.3em;padding-left:.3em;color:var(--pearl)}.pk-pos .tile small{font:500 11.5px/1.45 var(--f);color:var(--mute);letter-spacing:.04em}
.pk-pos .fc{display:flex;gap:8px;margin-top:4px;min-height:34px;align-items:center}.pk-pos .fc i{width:34px;height:34px;font-size:13px;font-style:normal;box-shadow:0 0 0 1px #03060c,0 0 0 1.5px rgba(233,187,79,.5)}.pk-pos .fc i.soon{filter:grayscale(.85) brightness(.55)}
.pk-pos .fc em{font:600 11px/1 var(--f);font-style:normal;color:var(--dim);letter-spacing:.14em}
.lob-pick .card.soon{cursor:default;filter:none}.lob-pick .card.soon:hover{transform:none}.card.soon .cd-art,.card.soon .cd-ph{filter:grayscale(.55) brightness(.5)}.card.soon .cd-t{opacity:.75}
.card .cd-ph{position:absolute;inset:0;display:grid;place-items:center;padding-bottom:30%;font:900 clamp(38px,3.4vw,64px)/1 var(--fd);font-style:normal;color:var(--hc,#e9bb4f);text-shadow:0 0 28px var(--hc,#e9bb4f);background:radial-gradient(ellipse 70% 52% at 50% 36%,color-mix(in srgb,var(--hc,#e9bb4f) 26%,transparent),transparent 72%),repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 8px,transparent 8px 16px),#10295a}
.card .cd-art.has+.cd-ph{display:none}
.card .cd-soon{position:absolute;left:0;right:0;top:57%;z-index:2;padding:5px 0;text-align:center;font:800 11.5px/1 var(--fd);letter-spacing:.32em;padding-left:.32em;color:#faedca;background:linear-gradient(90deg,transparent,rgba(9,25,58,.9) 16%,rgba(9,25,58,.9) 84%,transparent);box-shadow:inset 0 1px 0 rgba(233,187,79,.45),inset 0 -1px 0 rgba(233,187,79,.45)}
.card.fit .cd-t small{color:var(--bz-l)}.card.fit::after{background:linear-gradient(0deg,rgba(9,25,58,.96) 4%,rgba(9,25,58,.4) 34%,transparent 58%),linear-gradient(0deg,rgba(251,223,158,.16),transparent 22%)}
.pk-go .ui-seg.pos{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.pk-go .ui-seg.pos svg{width:15px;height:15px;flex:none}
.pk-who .tags .off{padding:3px 7px;color:var(--bz-l);box-shadow:inset 0 0 0 1px rgba(233,187,79,.45)}
.lob-pick.locking .slots.b .slot{animation:pk-flip .55s var(--ez) both}.lob-pick.locking .slots.b .slot:nth-child(2){animation-delay:.08s}.lob-pick.locking .slots.b .slot:nth-child(3){animation-delay:.16s}.lob-pick.locking .slots.b .slot:nth-child(4){animation-delay:.24s}.lob-pick.locking .slots.b .slot:nth-child(5){animation-delay:.32s}
@keyframes pk-flip{0%{opacity:0;transform:translateX(18px)}100%{opacity:1;transform:none}}
.hm-roster button.soon{filter:grayscale(.8) brightness(.5);cursor:default}.hm-roster button.soon:hover{filter:grayscale(.8) brightness(.5);box-shadow:0 0 0 1px #03060c,0 0 0 2.5px rgba(233,187,79,.4),0 6px 16px rgba(4,10,26,.5)}
.hm-roster button>i b{position:absolute;inset:0;display:grid;place-items:center;font:900 20px/1 var(--fd);color:#f5e8c3}.hm-roster button>i.has b{display:none}
/* 中等屏（1366 这一档）：选人下面那条三栏收紧 */
@media (max-width:1500px){.pk-info{grid-template-columns:minmax(0,.85fr) minmax(0,1.2fr) minmax(240px,.95fr)}.ed-th,.ed-row{grid-template-columns:minmax(130px,1.5fr) 36px 84px 44px 58px minmax(60px,1fr) 128px}.ed-row .its{grid-template-columns:repeat(6,18px)}.ed-row .its i{width:18px;height:18px}}
@media (max-width:700px){.lob-home .hm-roster{display:none}}
/* 窄而高的屏（竖着的平板）：选人两边的队伍收成头像 */
@media (max-width:900px) and (min-height:521px){.lob-pick{grid-template-columns:76px minmax(0,1fr) 76px}.slot>div{padding:0 6px;justify-content:center}.slot>div>div,.pk-team h5 i{display:none}.pk-info{grid-template-columns:1fr}.ed-teams{grid-template-columns:1fr}.lob-home .hm-roster{display:none}.lob-home .hm-main{width:auto;right:24px}}
/* 手机横屏（屏幕矮）：每一块都压到一屏放下，不用滚 */
@media (max-height:520px){
.lob-home .hm-main{bottom:max(5vh,14px);width:min(470px,56vw)}.lob-home .hm-mark{width:min(330px,40vw)}.lob-home .sub{margin:0 0 12px;font-size:11px;letter-spacing:.4em}
.lob-home .ui-btn.main{padding:13px 30px;font-size:16px}.lob-home nav{gap:8px;width:min(340px,100%)}.hm-mode{padding:8px 10px;gap:2px 8px}.hm-mode svg{width:22px;height:22px}.hm-mode b{font-size:13.5px}.hm-mode small{font-size:10px;line-height:1.35}
.lob-home .tip{margin-top:8px;font-size:11px}.lob-home .hm-top{top:10px}.lob-home .ui-ib{width:34px;height:34px}
.lob-home .hm-roster{bottom:max(5vh,14px);gap:4px}.hm-roster button{width:36px;height:36px;margin:5px}.hm-roster .row{gap:3px}.hm-roster .fac,.hm-roster h5{display:none}
.set-box{padding:16px 22px 16px}.set-row{padding:7px 0}.set-box .ui-rule{margin:4px 30px 10px}.set-box .close{margin-top:10px}
.lob-pick{grid-template-columns:68px minmax(0,1fr) 68px;gap:5px 10px;padding:8px max(10px,env(safe-area-inset-right,0px)) 8px max(10px,env(safe-area-inset-left,0px))}
.pk-head .ui-ib{width:30px;height:30px}.pk-title h2{font-size:17px}.pk-title .ui-rule{margin:3px auto 0;width:220px}.pk-title p,.pk-head .side{display:none}
.pk-team{gap:5px}.pk-team h5{font-size:11px;letter-spacing:.2em;justify-content:center!important}.pk-team h5 i{display:none}
.slot{height:min(58px,calc((100vh - 90px)/5));background-position:center 14%}.slot::before{background:linear-gradient(0deg,rgba(9,25,58,.9),transparent 70%)!important}.slot>div{padding:0 0 3px;justify-content:center;align-items:flex-end}.slot>div>div{display:none}.slot svg{width:16px;height:16px}.slot.you b::after{display:none}
.slot.you::after{content:"你";position:absolute;right:2px;top:2px;padding:1px 3px;font:800 9px/1 var(--f);color:#1b1407;background:var(--bz-l)}
.pk-mid{gap:5px}.pk-filter{gap:4px}.pk-filter button{padding:5px 8px;font-size:10.5px;letter-spacing:.06em;gap:4px}.pk-filter button svg{width:13px;height:13px}
.lob-pick .grid{flex:none;padding:3px;overflow:visible}.lob-pick .cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}.lob-pick .card{aspect-ratio:auto;height:min(36vh,150px)}.card .cd-art{background-position:center 8%}
.card .cd-t{padding:0 6px 5px}.card .cd-t b{font-size:13px}.card .cd-t small{font-size:9.5px}.card .cd-r{width:20px;height:20px;left:5px;top:5px}.card .cd-r svg{width:12px;height:12px}.card.sel::before{width:12px;height:12px}
.pk-info{flex:1;min-height:0;grid-template-columns:minmax(0,.8fr) minmax(0,1.25fr) minmax(200px,1fr);gap:10px;padding:8px 12px}
.pk-who{gap:3px}.pk-who h3{font-size:22px}.pk-who .tt{font-size:11px}.pk-who .tags{gap:4px 8px;font-size:10.5px}.pk-who .tags svg{width:13px;height:13px}.fac-tag{padding:3px 5px}
.pk-sk{gap:5px}.pk-sk .sks{gap:5px}.pk-sk .s{width:32px}.pk-sk .sd{font-size:10.5px;line-height:1.45}
.pk-go{gap:5px}.pk-go .opt{gap:4px 6px;font-size:10px;letter-spacing:.08em}.pk-go .ui-seg button{padding:6px 2px;font-size:11px}.pk-go .ui-seg button svg{width:13px;height:13px}.pk-go .ui-btn.main{padding:10px 14px;font-size:15px;margin-top:2px}
.card .seal{font-size:11px;padding:5px 8px}.pk-banner{top:24%}.pk-banner b{font-size:34px}.pk-banner small{font-size:11px}.ed-row .mvp{font-size:0;gap:0;padding:2px 3px}
.lob-load{gap:4px;padding:6px max(10px,env(safe-area-inset-right,0px)) 6px max(10px,env(safe-area-inset-left,0px))}.ld-head img{height:22px}.ld-head .ui-cap{font-size:9.5px}.ld-vs b{font-size:14px}.ld-foot{gap:4px}.ld-tip{font-size:10.5px;line-height:1.4}.ld-bar u{height:4px}.ld-bar span{font-size:10.5px}
.ld-card .ln{gap:6px}.ld-card b{letter-spacing:.08em;padding:0}.ld-card::before{background:linear-gradient(0deg,rgba(9,25,58,.97) 10%,rgba(9,25,58,.85) 30%,rgba(9,25,58,.5) 46%,transparent 64%)}      /* 手机横屏的载入卡矮，名字、称号在卡片 55%–70% 高的地方（b-polish） */
.hud-end{justify-content:flex-start;gap:6px;padding-top:8px;padding-bottom:8px}.hud-end h2{font-size:36px}.ed-banner{gap:2px;flex-direction:row;gap:20px}.ed-banner .ui-rule{display:none}.ed-sub{gap:12px;font-size:11px}.ed-sub b{font-size:20px}
.ed-teams{gap:8px}.ed-team{padding:6px 8px 6px}.ed-team header{padding:0 2px 4px;margin:0}.ed-team header b{font-size:12.5px}.ed-th{display:none}
.ed-th,.ed-row{grid-template-columns:minmax(0,1.5fr) 62px 46px 66px;gap:6px}.ed-row{min-height:38px;font-size:11.5px}.ed-row .who{gap:6px}.ed-row .who .ui-ico{width:30px;height:30px}.ed-row .who b{font-size:12px}.ed-row .who small{display:none}
.ed-row .lv,.ed-row .cs,.ed-row .dm{display:none}.ed-row .its{grid-template-columns:repeat(3,13px);gap:2px}.ed-row .its i{width:13px;height:13px}
.hud-end nav{gap:8px}.hud-end nav .ui-btn{min-width:0;padding:10px 22px;font-size:13px}.hud-end nav .ui-btn.main{font-size:14px;padding:11px 26px}}
/* 第九轮 5v5 的手机横屏：名册里的英雄卡排一排（只留名字，张数在 --n 里），选位置的六块排一排 */
@media (max-height:520px){
.lob-pick .cards{grid-template-columns:repeat(var(--n,10),minmax(0,1fr));gap:5px}.lob-pick .card{height:min(33vh,128px)}.card .cd-t small{display:none}.card .cd-t{padding:0 3px 5px;text-align:center}.card .cd-t b{font-size:12px;letter-spacing:.04em}
.card .cd-ph{font-size:30px}.card .cd-soon{font-size:9px;letter-spacing:.1em;padding:3px 0}
.pk-pos{gap:4px}.pk-pos h3{font-size:16px}.pk-pos .ui-cap{font-size:9.5px;margin-bottom:6px}.pk-pos .tiles{grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.pk-pos .tile{padding:10px 5px 8px;gap:4px}.pk-pos .tile>svg{width:24px;height:24px}.pk-pos .tile b{font-size:14px;letter-spacing:.14em;padding-left:.14em}.pk-pos .tile small{font-size:9.5px;line-height:1.35}.pk-pos .fc{gap:4px;min-height:26px}.pk-pos .fc i{width:26px;height:26px}
.card .seal{white-space:nowrap;font-size:10px;letter-spacing:.12em;padding:4px 6px}.pk-go .ui-seg.pos{gap:3px}.pk-go .ui-seg.pos svg{width:12px;height:12px}.pk-go .ui-seg.pos button{font-size:10.5px;gap:3px}.pk-who .tags .off{padding:2px 4px}}
/* 小手机横屏（iPhone SE 那么宽）：十一张卡每张只有 40 像素宽，三个字的名字收小一号、不折行 */
@media (max-height:520px) and (max-width:720px){.card .cd-t{padding:0 1px 4px}.card .cd-t b{font-size:11px;letter-spacing:0;white-space:nowrap}}
`;
let styled = false; const style = () => { useKit(); if (styled) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); };
const SIDE = ["沉月会", "烬誓庭"], DIFF_NAME: Record<string, string> = { easy: "简单", normal: "普通", hard: "困难", show: "观战" };
const go = (q: Record<string, string>) => { const u = new URL(location.href); u.search = ""; for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); location.href = u.toString(); };
/** 回主菜单 */
export const goHome = () => go({});
const fac = (side: number) => (side ? "e" : "t");
const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const ROLES = ["坦克", "斗士", "刺客", "法师", "射手", "辅助"];
/** 位置的图标（“随便”是一颗骰子，和 uikit 的图标一样是 24 格线描） */
const FILL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/></svg>`;
const posIcon = (p: Pos | "") => (p ? ICON[POS_ICON[p]] : FILL);
/** 栏位里名字下面那一行：位置 · 职业；两个一样（射手打射手、辅助打辅助）就换成称号，不写“射手 · 射手” */
const posRole = (p: Pos, k: { role: string; title: string }) => `${POS_NAME[p]} · ${k.role === POS_NAME[p] ? k.title : k.role}`;
const POS_DESC: Record<string, string> = { "": "按你挑的英雄的主位置", top: "上路单人 · 抗压、单挑", jungle: "不走线 · 刷野、抓人、拿 Boss", mid: "中路单人 · 清线快、支援两边", adc: "下路 · 和辅助一起，后期的输出", sup: "下路 · 跟着射手，保人、开团" };
/** 载入画面底下的玩法提示（都是这个游戏里真的有的规矩） */
const TIPS = ["回到出生点或者阵亡的时候才能买装备，按 P 打开商店。", "按 B 原地回城，站 5 秒回到出生点；挨打会被打断。", "河道里的 Boss 被击杀后，击杀它的一队全队获得增益。", "站进草丛里，对面看不到你，除非他们也走进来。", "防御塔优先打走进塔下、正在打英雄的人。跟着小兵一起推塔更安全。", "击杀和助攻都给金币；补到小兵的最后一刀才有补刀的钱。", "按住 Tab 看计分板，空格把镜头拉回英雄身上。"];
const TOUCH_TIPS = ["技能键点一下自动对准；按住拖动自己瞄，拖进“取消”圈里松手就不放。", "点左上角的金币打开商店；只在出生点或者阵亡时能买卖。", "点顶上的比分看计分板，点小地图看别处。", "河道里的 Boss 被击杀后，击杀它的一队全队获得增益。", "站进草丛里，对面看不到你，除非他们也走进来。"];

/** 主菜单和选人。选好以后带着选择重新载入，直接进对局 */
export function createLobby(): void {
  style(); const root = document.createElement("div"); root.className = "lob ui-anim"; document.body.appendChild(root);
  const home = () => {
    // 名册：两个阵营各一排（阵营只是英雄的出身，不分队）；还没有技能代码的变暗、点不了，海报还没出来的显示名字的头一个字
    const roster = [0, 1].map(s => `<div class="fac ${fac(s)}">${s ? ICON.flame : ICON.wave}${SIDE[s]}</div><div class="row">${ALL.filter(i => infoOf(i)?.side === s).map(i => { const k = infoOf(i)!, soon = !canPick(i); return `<button type="button" class="${fac(s)}${soon ? " soon" : ""}" ${soon ? "disabled" : `data-h="${i}"`} title="${k.name} · ${k.title}（${POS_NAME[posOf(i)]} · ${k.role}）${soon ? " · 即将上线" : ""}"><i data-f="${i}"><b>${k.name[0]}</b></i></button>`; }).join("")}</div>`).join("");
    root.innerHTML = `<div class="lob-home"><div class="hm-shade"></div>
      <div class="hm-top"><button type="button" class="ui-ib" data-a="set" title="设置">${ICON.gear}</button></div>
      <div class="hm-main"><img class="hm-mark" src="/assets/ui/kit/wordmark.webp" alt="烬与潮"><p class="sub">五对五 · 三条线 · 一条河</p>
        <nav><button type="button" class="ui-btn main" data-a="play">开始对局</button>
          <div class="hm-alt"><button type="button" class="hm-mode" data-a="watch">${ICON.eye}<b>观战</b><small>十个英雄都交给电脑，镜头跟着打架走</small></button><button type="button" class="hm-mode" data-a="arena">${ICON.target}<b>测试场</b><small>摆好靶子，试技能、试打野怪</small></button>
          <button type="button" class="hm-mode wide" data-a="install" hidden>${ICON.home}<b>安装到桌面</b><small>以后从桌面打开，全屏玩</small></button></div></nav>
        ${installHint() ? `<p class="tip">${installHint()}</p>` : ""}</div>
      <div class="hm-roster"><h5 class="ui-cap ui-rule">英雄</h5>${roster}</div></div>`;
    root.querySelectorAll<HTMLElement>("[data-f]").forEach(el => art(el, splashUrl(el.dataset.f!)));
    const ib = root.querySelector('[data-a="install"]') as HTMLElement; const showInstall = () => { if (ib.isConnected) ib.hidden = false; }; if (canInstall(showInstall)) showInstall();
    root.querySelector(".lob-home")!.addEventListener("click", e => { const t = (e.target as HTMLElement).closest<HTMLElement>("[data-a],[data-h]"); if (!t) return; const a = t.dataset.a;
      if (t.dataset.h) pick(t.dataset.h); else if (a === "play") pick(); else if (a === "set") settings(); else if (a === "install") install().then(ok => { if (ok) ib.hidden = true; });
      else if (a === "watch") { const h = ORDER[Math.floor(Math.random() * ORDER.length)], L = makeLineup(h, ""); loading(h, { mode: "watch", lineup: L }); go({ director: "1", h, ...lineupQuery(L) }); } else if (a === "arena") { loading("lan", { mode: "arena" }); go({ arena: "1", h: "lan" }); } }); };
  // 设置：声音、全屏、画质（画质记在这个标签页里，下一局生效；见 quality.ts 开头）
  function settings() {
    const getQ = () => { try { return sessionStorage.getItem("moba_q") ?? "auto"; } catch { return "auto"; } };
    const box = document.createElement("div"); box.className = "lob-set";
    const draw = () => { const q = getQ(), m = sfx.muted();
      box.innerHTML = `<div class="set-box ui-panel ui-frame ui-orn"><h3 class="ui-h">设置</h3><div class="ui-rule"><i></i></div>
        <div class="set-row"><span>声音</span><div class="ui-seg"><button type="button" data-s="snd" data-v="1" class="${m ? "" : "on"}">${ICON.snd}开</button><button type="button" data-s="snd" data-v="0" class="${m ? "on" : ""}">${ICON.mute}关</button></div></div>
        ${canFullscreen() ? `<div class="set-row"><span>全屏</span><div class="ui-seg"><button type="button" data-s="fs">${ICON.full}进入 / 退出全屏</button></div></div>` : ""}
        <div class="set-row"><span>画质</span><div class="ui-seg">${[["auto", "自动"], ["full", "高"], ["lite", "流畅"]].map(([v, n]) => `<button type="button" data-s="q" data-v="${v}" class="${q === v ? "on" : ""}">${n}</button>`).join("")}</div><small>“自动”：电脑用高、手机用流畅。下一局生效。</small></div>
        <div class="close"><button type="button" class="ui-btn" data-s="x">完成</button></div></div>`; };
    draw(); root.appendChild(box);
    box.addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-s]"); if (!b) { if (e.target === box) box.remove(); return; } const s = b.dataset.s;
      if (s === "snd") sfx.setMuted(b.dataset.v === "0"); else if (s === "fs") toggleFullscreen(); else if (s === "x") { box.remove(); return; }
      else if (s === "q") { try { if (b.dataset.v === "auto") sessionStorage.removeItem("moba_q"); else sessionStorage.setItem("moba_q", b.dataset.v!); } catch { /* 不让存就算了 */ } }
      draw(); }); }
  /** 选人（第九轮 5v5）。first：从主菜单的名册点了一个英雄进来（位置直接按它的主位置）；没有就先选位置 */
  function pick(first?: string) {
    let cur = first && canPick(first) ? first : ORDER[0], diff = "normal", pos: Pos | "" = first ? posOf(cur) : "", shown = 0, role = "", locked = false, choosing = !first, sorted = "?";
    const seed = 1 + Math.floor(Math.random() * 1e9), lu = (): Lineup => makeLineup(cur, pos, seeded(seed));      // 同一次选人里队友排法固定：换位置、换英雄时只补空出来的位置，不乱跳
    root.innerHTML = `<div class="lob-pick"><div class="pk-bg"></div>
      <header class="pk-head"><button type="button" class="ui-ib" data-a="back" title="返回">${ICON.back}</button><div class="pk-title"><h2 class="ui-h">选择你的英雄</h2><div class="ui-rule"><i></i></div><p class="ui-cap">五对五 · 对战电脑</p></div><div class="side">${ICON.swords}英雄不分阵营：谁都能在任何一队，一队之内不重复</div></header>
      <aside class="pk-team a"><h5>我方<i>左下基地</i></h5><div class="slots a"></div></aside>
      <main class="pk-mid"><section class="pk-pos" hidden><p class="ui-cap">先定位置，再挑英雄 · 剩下的位置电脑来补</p><div class="tiles"></div></section>
        <div class="pk-filter"><button type="button" data-r="" class="on">全部</button>${ROLES.filter(r => ALL.some(i => infoOf(i)?.role === r)).map(r => `<button type="button" data-r="${r}">${roleIcon(r)}${r}</button>`).join("")}</div>
        <div class="grid"><div class="cards"></div></div>
        <section class="pk-info ui-panel ui-frame ui-orn" style="--orn:46px"><div class="pk-who"></div><div class="pk-sk"><div class="sks"></div><p class="sd"></p></div>
          <div class="pk-go"><div class="opt"><span>电脑</span><div class="ui-seg" data-o="diff"><button type="button" data-v="easy">简单</button><button type="button" data-v="normal">普通</button><button type="button" data-v="hard">困难</button></div>
            <span>位置</span><div class="ui-seg pos" data-o="pos">${["", ...POS].map(p => `<button type="button" data-v="${p}" title="${p ? POS_NAME[p as Pos] : "随便"}：${POS_DESC[p]}">${posIcon(p as Pos | "")}<span>${p ? POS_NAME[p as Pos] : "随便"}</span></button>`).join("")}</div></div>
            <button type="button" class="ui-btn main" data-a="lock">锁定</button></div></section></main>
      <aside class="pk-team b"><h5><i>右上基地</i>对方</h5><div class="slots b"></div></aside></div>`;
    const wrap = root.querySelector(".lob-pick") as HTMLElement, cards = root.querySelector(".cards") as HTMLElement, bg = root.querySelector(".pk-bg") as HTMLElement, posBox = root.querySelector(".pk-pos") as HTMLElement;
    // 英雄卡：名册里十个都摆出来；没有技能代码的挂“即将上线”、点不了；海报还没有的用名字的头一个字垫着（阵营色的光）
    for (const id of ALL) { const k = infoOf(id); if (!k) continue; const soon = !canPick(id), b = document.createElement("button"); b.type = "button"; b.className = "card " + fac(k.side) + (soon ? " soon" : ""); b.dataset.id = id; b.style.setProperty("--hc", hex(k.color)); if (soon) { b.disabled = true; b.title = `${k.name} · ${k.title}：即将上线`; }
      b.innerHTML = `<i class="cd-art"></i><i class="cd-ph">${k.name[0]}</i><span class="cd-r" title="${k.role}">${roleIcon(k.role)}</span><span class="cd-t"><b>${k.name}</b><small>${k.title} · ${POS_NAME[posOf(id)]}</small></span>${soon ? `<span class="cd-soon">即将上线</span>` : ""}<i class="cd-f"></i>`; art(b.firstElementChild as HTMLElement, splashUrl(id));
      if (!soon) b.addEventListener("click", () => { if (locked) return; if (cur !== id) { cur = id; shown = 0; draw(true); } }); cards.appendChild(b); }
    cards.style.setProperty("--n", String(cards.children.length));      // 手机横屏一排摆几张：跟着名册走（伊缇进来以后是 11 张，写死 10 会挤成两排，把锁定键顶出屏幕）
    // 选位置：六块铜牌（随便 + 五个位置），每块底下是这个位置的两个英雄
    posBox.querySelector(".tiles")!.innerHTML = ["", ...POS].map(p => `<button type="button" class="tile" data-p="${p}">${posIcon(p as Pos | "")}<b>${p ? POS_NAME[p as Pos] : "随便"}</b><small>${POS_DESC[p]}</small><span class="fc">${p ? ROSTER.filter(r => r.pos === p).map(r => `<i class="ui-ico${canPick(r.id) ? "" : " soon"}" data-f="${r.id}" title="${infoOf(r.id)?.name ?? r.id}${canPick(r.id) ? "" : "（即将上线）"}">${infoOf(r.id)?.name[0] ?? "?"}</i>`).join("") : `<em>${ORDER.length} 位可选</em>`}</span></button>`).join("");
    posBox.querySelectorAll<HTMLElement>("[data-f]").forEach(el => art(el, faceUrl(el.dataset.f!)));
    posBox.addEventListener("click", e => { const t = (e.target as HTMLElement).closest<HTMLElement>("[data-p]"); if (!t) return; setPos(t.dataset.p as Pos | ""); choosing = false; sfx.ui("click"); draw(true); });
    /** 换位置：选了一个位置而现在的英雄不是这个位置的，换成这个位置第一个能选的英雄（玩家也可以再换回去：任何英雄都能打任何位置） */
    const setPos = (p: Pos | "") => { pos = isPos(p) ? p : ""; if (pos && posOf(cur) !== pos) { const f = ORDER.find(id => posOf(id) === pos); if (f) { cur = f; shown = 0; } } };
    const slot = (s: Slot, t: "a" | "b", you: boolean, hide: boolean) => { const k = hide ? null : infoOf(s.id);
      return `<div class="slot ${t}${you ? " you" : ""}${k ? "" : " empty"}" ${k ? `data-s="${s.id}"` : ""}><div>${ICON[POS_ICON[s.pos]]}<div><b>${k ? k.name : t === "a" ? "等待中" : "未知"}</b><small>${k ? posRole(s.pos, k) : POS_NAME[s.pos] + (t === "a" ? "" : " · 对方选择中")}</small></div></div></div>`; };
    function draw(swap = false) { const k = KITS[cur], L = lu();
      posBox.hidden = !choosing; for (const sel of [".pk-filter", ".grid", ".pk-info"]) (root.querySelector(sel) as HTMLElement).hidden = choosing;
      root.querySelector(".pk-title h2")!.textContent = choosing ? "选择你的位置" : "选择你的英雄";
      root.querySelector(".slots.a")!.innerHTML = L.teams[0].map(s => slot(s, "a", s.pos === L.me && !choosing, choosing)).join("");      // 还在选位置：我方五格只写位置
      root.querySelector(".slots.b")!.innerHTML = L.teams[1].map(s => slot(s, "b", false, !locked)).join("");      // 对面的五个在锁定那一下才翻出来（盲选）
      root.querySelectorAll<HTMLElement>(".slots [data-s]").forEach(el => art(el, splashUrl(el.dataset.s!)));
      // 选了位置：这个位置的英雄排到前面、名字下的位置字样描亮（别的英雄照样能选）
      const key = pos + "|" + role; if (key !== sorted) { sorted = key; const list = Array.from(cards.children) as HTMLElement[]; list.sort((p, q) => (pos ? +(posOf(q.dataset.id!) === pos) - +(posOf(p.dataset.id!) === pos) : 0) || +p.classList.contains("soon") - +q.classList.contains("soon") || ALL.indexOf(p.dataset.id!) - ALL.indexOf(q.dataset.id!)); for (const c of list) cards.appendChild(c); }
      cards.querySelectorAll<HTMLElement>(".card").forEach(c => { c.classList.toggle("sel", c.dataset.id === cur); c.classList.toggle("fit", !!pos && posOf(c.dataset.id!) === pos); });
      if (swap || !bg.style.backgroundImage) { bg.classList.remove("swap"); void bg.offsetWidth; bg.classList.add("swap"); art(bg, wideUrl(cur), splashUrl(cur)); }
      root.querySelector(".pk-who")!.innerHTML = `<span class="tags"><span class="fac-tag ${fac(k.side)}">${SIDE[k.side]}</span></span><h3>${k.name}</h3><div class="tt">${k.title}</div><div class="tags"><span>${roleIcon(k.role)}${k.role}</span><span>难度 ${pips(DIFFICULTY[cur] ?? 2)}</span><span>${ICON[POS_ICON[posOf(cur)]]}主位置 ${POS_NAME[posOf(cur)]}</span>${L.me !== posOf(cur) ? `<span class="off">这一局打${POS_NAME[L.me]}</span>` : ""}</div>`;
      const sks = root.querySelector(".sks") as HTMLElement, sd = root.querySelector(".sd") as HTMLElement;
      sks.innerHTML = k.skills.map((d, i) => `<button type="button" class="s ui-ico ui-frame-s${i === shown ? " on" : ""}" data-i="${i}" data-s2="${d.icon}">${d.name[0]}<kbd>${d.cast === "passive" ? "被动" : d.key}</kbd></button>`).join("");
      const text = () => { const d = k.skills[shown]; sd.innerHTML = `<b>${d.cast === "passive" ? "被动" : d.key} · ${d.name}</b>${d.desc}${d.cast !== "passive" ? `<em>冷却 ${d.cd ?? 0} 秒${d.mana ? ` · 法力 ${d.mana}` : ""}</em>` : ""}`; }; text();
      sks.querySelectorAll<HTMLElement>(".s").forEach(el => { art(el, `/assets/ui/skill/${el.dataset.s2}.webp`); const show = () => { shown = +el.dataset.i!; text(); sks.querySelectorAll(".s").forEach(x => x.classList.toggle("on", x === el)); }; el.addEventListener("pointerenter", show); el.addEventListener("click", show); });
      root.querySelectorAll<HTMLElement>(".pk-go .ui-seg").forEach(seg => seg.querySelectorAll<HTMLElement>("button").forEach(b => b.classList.toggle("on", seg.dataset.o === "diff" ? b.dataset.v === diff : b.dataset.v === pos))); }
    root.querySelectorAll<HTMLElement>(".pk-go .ui-seg button").forEach(b => b.addEventListener("click", () => { if (locked) return; if ((b.parentElement as HTMLElement).dataset.o === "diff") diff = b.dataset.v!; else setPos(b.dataset.v as Pos | ""); draw(true); }));
    root.querySelector(".pk-filter")!.addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-r]"); if (!b) return; role = b.dataset.r!; root.querySelectorAll(".pk-filter button").forEach(x => x.classList.toggle("on", x === b)); cards.querySelectorAll<HTMLElement>(".card").forEach(c => { c.hidden = !!role && infoOf(c.dataset.id!)?.role !== role; }); });
    root.querySelector('[data-a="back"]')!.addEventListener("click", () => { if (locked) return; if (!choosing && !first) { choosing = true; draw(); } else home(); });      // 挑英雄时返回：回到选位置；选位置时返回：回主菜单
    root.querySelector('[data-a="lock"]')!.addEventListener("click", e => { if (locked) return; locked = true; (e.currentTarget as HTMLButtonElement).disabled = true; sfx.ui("buy");
      // 锁定的演出：卡片盖章、自己的栏位亮一圈、对面五个翻出来、背景推近、名字横幅飞进来；一秒多以后进载入
      const L = lu(); draw(); const c = cards.querySelector(".card.sel") as HTMLElement | null; if (c) c.insertAdjacentHTML("beforeend", `<span class="seal">锁定</span>`); wrap.classList.add("locking");
      wrap.insertAdjacentHTML("beforeend", `<div class="pk-banner"><b>${KITS[cur].name}</b><div class="ui-rule"><i></i></div><small>${KITS[cur].title} · ${POS_NAME[L.me]}</small></div>`);
      setTimeout(() => { loading(cur, { diff, lineup: L }); go({ h: cur, diff, ...lineupQuery(L) }); }, 1250); });
    (window as any).__pick = { pos: (p: string) => { setPos(p as Pos | ""); choosing = false; draw(true); }, hero: (id: string) => { if (canPick(id)) { cur = id; shown = 0; choosing = false; draw(true); } }, lineup: () => lu() };      // 测试和截图用
    draw(true);
  }
  function loading(id: string, o: LoadOpt) { root.innerHTML = ""; root.appendChild(buildLoad(id, o)); }
  home();
}

interface LoadOpt { mode?: "watch" | "arena" | ""; diff?: string; lineup?: Lineup }
/** 载入画面：上下两排英雄卡（每队五个，按位置排），中间一个“对”，底下提示和进度条。lineup 不给就从网址里读（和主程序读的是同一份） */
function buildLoad(kitId: string, o: LoadOpt): HTMLElement {
  const k = KITS[kitId], el = document.createElement("div"); el.className = "lob-load"; const spec = o.mode === "watch", L = o.lineup ?? readLineup(new URLSearchParams(location.search), kitId);
  const [mine, foes]: Slot[][] = o.mode === "arena" ? [[{ id: kitId, pos: L.me }], []] : L.teams;
  const card = (s: Slot, i: number, t: number) => { const h = infoOf(s.id)!, you = t === 0 && s.pos === L.me && !spec && o.mode !== "arena"; return `<div class="ld-card${you ? " you" : ""}" data-w="${s.id}" style="animation-delay:${(t * 5 + i) * 0.07}s"><i class="bar"></i><div class="t"><b>${h.name}</b><small>${h.title}</small><div class="ln">${o.mode !== "arena" && h.role === POS_NAME[s.pos] ? "" : `<span>${roleIcon(h.role)}${h.role}</span>`}${o.mode === "arena" ? "" : `<span>${ICON[POS_ICON[s.pos]]}${POS_NAME[s.pos]}</span>`}</div></div><i class="fx" style="animation-delay:${0.4 + (t * 5 + i) * 0.07}s"></i></div>`; };
  const mode = o.mode === "arena" ? "测试场 · 靶子和野怪" : spec ? "观战 · 十个英雄都交给电脑" : `五对五 · 对战电脑（${DIFF_NAME[o.diff ?? "normal"] ?? "普通"}）`;
  const tips = TOUCH ? TOUCH_TIPS : TIPS, tip = tips[Math.floor(Math.random() * tips.length)];
  el.innerHTML = `<div class="ld-bg"></div><header class="ld-head"><img src="/assets/ui/kit/wordmark.webp" alt="烬与潮"><span class="ui-cap">${mode}</span></header>
    <section class="ld-team a">${mine.map((s, i) => card(s, i, 0)).join("")}</section>
    <div class="ld-vs"><div class="ui-rule"><i></i></div><b>${o.mode === "arena" ? "试" : "对"}</b><div class="ui-rule"><i></i></div></div>
    <section class="ld-team b">${foes.length ? foes.map((s, i) => card(s, i, 1)).join("") : `<p class="ld-note ui-panel">测试场里没有对手：中路河边摆着几个不动的靶子，旁边的野怪可以随便打。英雄直接满级。</p>`}</section>
    <footer class="ld-foot"><p class="ld-tip"><b>提示</b>${tip}</p><div class="ld-bar"><u class="idle"><i></i></u><span>载入中</span></div></footer>`;
  el.querySelectorAll<HTMLElement>("[data-w]").forEach(c => art(c, splashUrl(c.dataset.w!)));
  if (k) art(el.querySelector(".ld-bg") as HTMLElement, wideUrl(kitId), splashUrl(kitId));
  return el;
}

/** 载入画面上的进度（0 到 1）。主程序按已经到了多少个模型和贴图来报；没报过的时候进度条是来回跑的那种 */
export function setLoad(p: number): void { const u = document.querySelector(".lob-load .ld-bar u") as HTMLElement | null; if (!u) return; const v = Math.max(0, Math.min(1, p)); u.classList.remove("idle"); (u.firstElementChild as HTMLElement).style.width = `calc(${v * 100}% - 2px)`; const s = u.nextElementSibling as HTMLElement; s.textContent = `${Math.round(v * 100)}%`; }

/** 进对局时盖在最上面的载入画面。返回一个函数，调它就撤掉。title：“观战”“测试场”或者空（普通的一局）；两队、位置和难度从网址里拿 */
export function showLoading(kitId: string, title = ""): () => void {
  style(); const p = new URLSearchParams(location.search), root = document.createElement("div"); root.className = "lob ui-anim";
  root.appendChild(buildLoad(kitId, { mode: title === "观战" ? "watch" : title === "测试场" ? "arena" : "", diff: p.get("diff") ?? "normal" }));
  document.body.appendChild(root); return () => { setLoad(1); root.style.transition = "opacity .5s"; setTimeout(() => { root.style.opacity = "0"; }, 180); setTimeout(() => root.remove(), 720); };
}

/** 结算。winTeam：哪一队赢了；me：玩家的英雄（观战时没有）；dmg：每个英雄对英雄造成的伤害（单位 id → 数） */
export function showResult(sim: Sim, o: { spectate?: boolean; dmg?: Map<number, number>; onAgain?: () => void } = {}): void {
  style(); const win = sim.over === 1, spec = !!o.spectate, m = Math.floor(sim.time / 60), s = Math.floor(sim.time % 60), el = document.createElement("div"); el.className = "hud-end ui-anim " + (win ? "won" : "lost");
  const hs = sim.heroes().filter(e => e.h).sort((p, q) => POS.indexOf(p.h!.pos as Pos) - POS.indexOf(q.h!.pos as Pos)), score = (e: (typeof hs)[number]) => e.h!.kills * 3 + e.h!.assists * 1.5 - e.h!.deaths * 1.2 + (o.dmg?.get(e.id) ?? 0) / 4000, mvp = hs.filter(e => e.team === (win ? 0 : 1)).sort((a, b) => score(b) - score(a))[0];
  const top = Math.max(1, ...hs.map(e => o.dmg?.get(e.id) ?? 0)), worth = (e: (typeof hs)[number]) => Math.floor(e.h!.gold + e.h!.items.reduce((a, id) => a + (itemOf(id)?.cost ?? 0), 0));
  const row = (e: (typeof hs)[number], i: number) => { const h = e.h!, k = KITS[h.kit], d = Math.round(o.dmg?.get(e.id) ?? 0);
    return `<div class="ed-row${e === sim.hero && !spec ? " you" : ""}" style="animation-delay:${0.25 + i * 0.06}s"><div class="who"><div class="ui-ico" data-f="${h.kit}">${k?.name[0] ?? "?"}</div><div><b>${k?.name ?? h.kit}${e === mvp ? `<span class="mvp">${ICON.crown}最佳</span>` : ""}</b><small>${isPos(h.pos) && k ? posRole(h.pos, k) : `${k?.title ?? ""} · ${k?.role ?? ""}`}</small></div></div>
      <span class="lv"><i>${h.level}</i></span><span class="k">${h.kills}<i>/</i>${h.deaths}<i>/</i>${h.assists}</span><span class="cs">${h.cs}</span><span class="g">${worth(e)}</span>
      <span class="dm">${o.dmg ? `${d}<u><i style="width:${(d / top) * 100}%"></i></u>` : "—"}</span><span class="its">${Array.from({ length: 6 }, (_, j) => { const id = h.items[j]; return `<i ${id ? `style="background-image:url(/assets/ui/item/${id}.webp)" title="${itemOf(id)?.name ?? ""}"` : ""}></i>`; }).join("")}</span></div>`; };
  const team = (t: 0 | 1) => { const list = hs.filter(e => e.team === t), w = (t === 0) === win, nm = spec ? (t === 0 ? "蓝方" : "红方") : t === 0 ? "我方" : "对方";
    return `<section class="ed-team ${t ? "b" : "a"} ui-panel ui-frame ui-orn"><header><b>${nm}</b><em class="${w ? "w" : "l"}">${w ? "胜" : "负"}</em><span>击杀 ${sim.kills[t]}</span></header>
      <div class="ed-th"><span>英雄</span><span>等级</span><span>战绩</span><span>补刀</span><span>经济</span><span>对英雄伤害</span><span>装备</span></div>${list.map(row).join("")}</section>`; };
  el.innerHTML = `<header class="ed-banner"><h2 class="${win ? "win" : "lose"}">${spec ? (win ? "蓝方胜利" : "红方胜利") : win ? "胜利" : "失败"}</h2><div class="ui-rule"><i></i></div>
      <div class="ed-sub"><b class="a">${sim.kills[0]}</b><span>${ICON.clock}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}</span><b class="b">${sim.kills[1]}</b></div></header>
    <div class="ed-teams">${team(0)}${team(1)}</div>
    <nav><button type="button" class="ui-btn main" data-a="again">再来一局</button><button type="button" class="ui-btn" data-a="home">${ICON.home}回主菜单</button></nav>`;
  el.querySelectorAll<HTMLElement>("[data-f]").forEach(x => art(x, faceUrl(x.dataset.f!)));
  el.addEventListener("pointerdown", e => e.stopPropagation()); el.querySelector("nav")!.addEventListener("click", e => { const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a; if (a === "again") (o.onAgain ?? (() => location.reload()))(); else if (a === "home") goHome(); });
  document.body.appendChild(el);
}
