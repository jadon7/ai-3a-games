// 界面的共用零件（第九轮做的，换画风 B 时 b-ui 换了皮）：对局界面（hud.ts）和对局外的几个界面（lobby.ts）用同一套设计语言，设计说明在 docs/round9/ui/DESIGN.md（第 10 节是画风 B 的这一套）。
//   · 颜色（画风 B）：地图换成了明亮的卡通，原来的“黑铁加旧铜”压在亮地图上发闷、发脏，换成王者荣耀亮场景那一路：底是半透明的深海蓝玻璃（不是黑），
//     描边是亮金，玻璃的上沿一道白色细高光。绿是自己 / 增益、蓝是队友、红是对方、金是钱、靛蓝是法力，这几个意思全界面不挪作他用（第九轮定的，没动）。
//     阵营色只在讲阵营的地方出现：沉月会是潮青，烬誓庭是余烬橙。
//   · 面板：从上往下由亮到暗的蓝玻璃（底下的东西隐约透出来），外面一圈金边：最外一条深蓝细线（压在亮地面上也有边）、一条亮金线（上沿最亮、下沿深一档，像光从上面来）、
//     里面一条很淡的白线（玻璃的厚度）。金边用 border-image 画（一张 SVG 九宫格），挂在 ::after 上，不占布局、不跟着内容重排。大面板四角再压一个干净的金色折角，没有花纹和铆钉。
//   · 形状：按钮、面板的角是小圆角（画风 B 的“圆润”），不再是切角的铁牌。主按钮是一整块亮金（深棕字），一屏只有一个。
//   · 字：标题用宋体的粗体（字距拉开），正文用黑体，数字一律等宽。字的阴影是深蓝不是黑。
//   · 图标：24 格的线描，1.7 粗、圆头，统一用 currentColor 上色；定位、分路、属性、按钮都从这里拿。
//   · 动效：悬停 120 毫秒，面板打开 180 毫秒（略放大加淡入），换界面 260 毫秒；曲线都是先快后慢的同一条。只做位置、缩放、透明度和颜色，不做会让整页重排的动画。
//   · 毛玻璃（backdrop-filter）只给临时弹出来的面板和对局外的界面用；对局里一直开着的东西（小地图、手机的按键）不用，每帧重新模糊一遍底下的 3D 画面太费。

export const svgUrl = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/** 金边的九宫格（54×54，每边切 18）：外深蓝线、亮金线（竖向渐变：上沿最亮）、内白线；四角各一小段加粗的亮金折角 */
const FRAME = `<svg xmlns='http://www.w3.org/2000/svg' width='54' height='54' viewBox='0 0 54 54' fill='none'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff2c6'/><stop offset='.32' stop-color='#f1c96c'/><stop offset='.7' stop-color='#d9a547'/><stop offset='1' stop-color='#a8772c'/></linearGradient></defs>
<rect x='.5' y='.5' width='53' height='53' rx='4' stroke='#061331' stroke-opacity='.8'/><rect x='1.75' y='1.75' width='50.5' height='50.5' rx='3' stroke='url(#g)' stroke-width='1.5'/><rect x='3' y='3' width='48' height='48' rx='2' stroke='#fff' stroke-opacity='.16'/>
${[0, 90, 180, 270].map(r => `<path transform='rotate(${r} 27 27)' d='M1.9 13V4.6A2.8 2.8 0 0 1 4.6 1.9H13' stroke='#fff0c2' stroke-width='2.6' stroke-linecap='round'/>`).join("")}</svg>`;
/** 小一号的边（技能格、装备格、头像这些小东西用）：深蓝线、金线，没有折角 */
const FRAME_S = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><rect x='.5' y='.5' width='23' height='23' rx='2' stroke='#061331'/><rect x='1.5' y='1.5' width='21' height='21' rx='1.5' stroke='#e9be62' stroke-opacity='.9'/></svg>`;
/** 大面板的四角（左上那一个，别的三个转过去）：外面一道粗的亮金折角、里面一道细的，拐角上一颗小菱形 */
const ORN = (r: number) => `<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60' fill='none'><g transform='rotate(${r} 30 30)'><path d='M7 40V12A5 5 0 0 1 12 7H40' stroke='#061331' stroke-opacity='.75' stroke-width='5.4' stroke-linecap='round'/><path d='M7 40V12A5 5 0 0 1 12 7H40' stroke='#f3cd72' stroke-width='3' stroke-linecap='round'/><path d='M7.6 26V12.4A4.8 4.8 0 0 1 12.4 7.6H26' stroke='#fff6d8' stroke-width='1.2' stroke-linecap='round'/><path d='M13.5 22V15.5A2 2 0 0 1 15.5 13.5H22' stroke='#f3cd72' stroke-opacity='.8' stroke-width='1.3' stroke-linecap='round'/><path d='M7 1.6 12.4 7 7 12.4 1.6 7Z' fill='#fff1c4' stroke='#061331' stroke-opacity='.8' stroke-width='1.1'/><path d='M7 4.4 9.6 7 7 9.6 4.4 7Z' fill='#d9a547'/></g></svg>`;
/** 分隔条（标题下、英雄栏顶边、大字播报下）：一条两头淡出的亮金线，正中一颗金框的菱形宝石，左半潮青、右半余烬（两个阵营） */
const DIVIDER = `<svg xmlns='http://www.w3.org/2000/svg' width='460' height='24' viewBox='0 0 460 24' fill='none'><defs><linearGradient id='l' x1='0' x2='1'><stop offset='0' stop-color='#f1c96c' stop-opacity='0'/><stop offset='.3' stop-color='#f1c96c' stop-opacity='.95'/><stop offset='.7' stop-color='#f1c96c' stop-opacity='.95'/><stop offset='1' stop-color='#f1c96c' stop-opacity='0'/></linearGradient></defs>
<path d='M8 12H452' stroke='#061331' stroke-opacity='.55' stroke-width='3.4'/><path d='M8 12H452' stroke='url(#l)' stroke-width='1.6'/><circle cx='204' cy='12' r='2.6' fill='#fff1c4' stroke='#061331' stroke-opacity='.7'/><circle cx='256' cy='12' r='2.6' fill='#fff1c4' stroke='#061331' stroke-opacity='.7'/>
<path d='M230 1.5 240.5 12 230 22.5 219.5 12Z' fill='#f3cd72' stroke='#061331' stroke-opacity='.8'/><path d='M230 5.2 236.8 12 230 18.8Z' fill='#ff9a52'/><path d='M230 5.2 223.2 12 230 18.8Z' fill='#5fdcd2'/><path d='M230 5.2 233 8.2 230 11.2 227 8.2Z' fill='#fff' fill-opacity='.55'/></svg>`;
export const DIVIDER_URL = `data:image/svg+xml,${encodeURIComponent(DIVIDER)}`;

/** 共用的样式：颜色、字、面板、按钮、图标格、动效。两边的界面都会插这一段（只插一次） */
export const KIT_CSS = `
:root{--ink0:#050d22;--ink1:#0a1834;--ink2:#102449;--ink3:#17325f;--ink4:#224478;--bz:#ecc264;--bz-l:#ffe8a6;--bz-d:#a8772c;--pearl:#fbf6ea;--txt:#e9f0fa;--mute:#95a9c6;--dim:#647b9e;
  --me:#4fa6f5;--foe:#e2584a;--gold:#f0c75e;--mana:#4a8fe0;--tide:#6fe0d6;--ember:#ff8f46;      /* 第九轮 polish-lib：--me（我方）从绿 #63d17a 改成蓝，和对局里 0 队的血条、头像框（hud.ts 的 --ally）一个颜色，照 LoL；对局里“自己”仍是亮绿，界面上的“你”是亮金 */
  --line:#061331;--glass:linear-gradient(180deg,rgba(40,78,136,.84),rgba(20,43,88,.86) 40%,rgba(11,27,60,.9));--glass-hi:inset 0 1px 0 rgba(255,255,255,.26),inset 0 0 0 1px rgba(150,195,255,.08);
  --fd:"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC",serif;--f:"Avenir Next","PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
  --ez:cubic-bezier(.2,.75,.25,1);--tex:linear-gradient(transparent,transparent)}      /* --tex：原来是锻铁的纹理图，B 里的玻璃不要纹理；变量留着，别处还在引用 */
/* 面板：蓝玻璃（上亮下暗），上沿一道白色细高光，外面一圈金边 */
.ui-panel{position:relative;border-radius:4px;background:var(--glass);box-shadow:0 12px 32px rgba(4,14,40,.42),var(--glass-hi);-webkit-backdrop-filter:blur(10px) saturate(1.25);backdrop-filter:blur(10px) saturate(1.25)}
.ui-frame::after,.ui-panel.ui-frame::after{content:"";position:absolute;inset:-2px;border:16px solid transparent;border-image:${svgUrl(FRAME)} 18 / 16px stretch;pointer-events:none;z-index:3}
.ui-frame-s::after{content:"";position:absolute;inset:0;border:7px solid transparent;border-image:${svgUrl(FRAME_S)} 8 / 7px stretch;pointer-events:none;z-index:3}
/* 大面板的四个角：干净的金色折角（代码画的，原来是即梦出的铜花角），压在金边上 */
.ui-orn::before{content:"";position:absolute;--o:var(--orn,58px);inset:calc(var(--o) * -.11);background:${svgUrl(ORN(0))} left top/var(--o) no-repeat,${svgUrl(ORN(90))} right top/var(--o) no-repeat,${svgUrl(ORN(270))} left bottom/var(--o) no-repeat,${svgUrl(ORN(180))} right bottom/var(--o) no-repeat;pointer-events:none;z-index:4}
.ui-div{height:22px;background:url("${DIVIDER_URL}") center/contain no-repeat}
/* 金色的标题条：两头淡出的细线中间一个小菱形 */
.ui-rule{display:flex;align-items:center;gap:10px;color:var(--bz)}.ui-rule::before,.ui-rule::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(241,201,108,.85))}.ui-rule::after{background:linear-gradient(90deg,rgba(241,201,108,.85),transparent)}
.ui-rule i{width:6px;height:6px;transform:rotate(45deg);background:var(--bz-l);box-shadow:0 0 0 1px var(--line),0 0 0 3px rgba(241,201,108,.28);flex:none}
.ui-h{font:900 20px/1.2 var(--fd);letter-spacing:.32em;color:var(--pearl);text-shadow:0 1px 0 rgba(6,19,49,.9),0 2px 10px rgba(6,19,49,.5)}
.ui-cap{font:700 11px/1 var(--f);letter-spacing:.28em;color:var(--mute)}
.ui-num{font-variant-numeric:tabular-nums}
/* 按钮：小圆角的蓝玻璃牌，1 像素金边。主按钮是一整块亮金（深棕字），一屏只有一个 */
.ui-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 26px;border:0;border-radius:6px;color:var(--txt);font:600 14px/1 var(--f);letter-spacing:.2em;cursor:pointer;
  background:linear-gradient(180deg,rgba(255,232,166,.85),rgba(190,140,56,.75)) border-box;box-shadow:0 0 0 1px rgba(6,19,49,.55),0 4px 12px rgba(4,14,40,.3);transition:filter .12s var(--ez),transform .12s var(--ez);isolation:isolate}
.ui-btn::before{content:"";position:absolute;inset:1px;z-index:-1;border-radius:5px;background:linear-gradient(180deg,#2f5b9c,#1a3a70 55%,#132d5c);box-shadow:inset 0 1px 0 rgba(255,255,255,.24)}
.ui-btn:hover{filter:brightness(1.15)}.ui-btn:active{transform:translateY(1px) scale(.985);filter:brightness(.95)}
.ui-btn.on{background:linear-gradient(180deg,#fff2c6,#d9a547) border-box;color:#fff}.ui-btn.on::before{background:linear-gradient(180deg,#3a6cb4,#1f4584)}
.ui-btn svg{width:18px;height:18px;flex:none}
.ui-btn.main{padding:16px 46px;font:800 18px/1 var(--f);letter-spacing:.42em;text-indent:.42em;color:#4a2b02;background:linear-gradient(180deg,#fff7d8,#e3a43a) border-box;text-shadow:0 1px 0 rgba(255,248,220,.65);box-shadow:0 0 0 1px rgba(6,19,49,.6),0 6px 18px rgba(4,14,40,.35),0 0 18px rgba(255,214,110,.18)}
.ui-btn.main::before{background:linear-gradient(180deg,#ffe795,#fbcf58 46%,#f0b63e 54%,#f6c64e);box-shadow:inset 0 1px 0 rgba(255,255,255,.75),inset 0 -2px 0 rgba(170,100,10,.22)}
.ui-btn.main::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.5) 48%,transparent 62%) -160% 0/60% 100% no-repeat;transition:background-position 0s;pointer-events:none}
.ui-btn.main:hover::after{background-position:260% 0;transition:background-position .7s var(--ez)}
.ui-btn.main:disabled{filter:grayscale(.75) brightness(.72);cursor:default}
/* 小的圆形图标键（设置、声音、菜单）：蓝玻璃的圆，一圈亮金 */
.ui-ib{width:38px;height:38px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;color:#fff1cc;cursor:pointer;background:radial-gradient(circle at 50% 30%,#3c6cb0,#173468 70%);box-shadow:0 0 0 1px var(--line),inset 0 0 0 1.5px rgba(241,201,108,.9),inset 0 2px 0 rgba(255,255,255,.28),0 3px 10px rgba(4,14,40,.35);transition:filter .12s,transform .12s}
.ui-ib:hover{filter:brightness(1.18)}.ui-ib:active{transform:scale(.94)}.ui-ib svg{width:55%;height:55%}
/* 图标格：图片铺满，没有图的时候是名字的第一个字 */
.ui-ico{position:relative;background:#11264d center/cover no-repeat;display:grid;place-items:center;font-weight:700;color:#d6e2f3;overflow:hidden}.ui-ico.has{color:transparent}
/* 难度：三颗菱形 */
.ui-pips{display:inline-flex;gap:3px}.ui-pips i{width:7px;height:7px;transform:rotate(45deg);background:rgba(160,195,240,.18);box-shadow:inset 0 0 0 1px rgba(241,201,108,.5)}.ui-pips i.on{background:var(--bz-l);box-shadow:0 0 0 1px var(--line),0 0 6px rgba(255,232,166,.45)}
/* 动效 */
@keyframes ui-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes ui-fade{from{opacity:0}to{opacity:1}}
@keyframes ui-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
@keyframes ui-ring{0%{box-shadow:0 0 0 0 rgba(255,232,166,.9),inset 0 0 0 2px rgba(255,248,222,.95)}100%{box-shadow:0 0 0 14px rgba(255,232,166,0),inset 0 0 0 2px rgba(255,248,222,0)}}
@keyframes ui-sheen{from{background-position:-160% 0}to{background-position:260% 0}}
@keyframes ui-float{0%{opacity:0;transform:translateY(4px)}15%{opacity:1}100%{opacity:0;transform:translateY(-22px)}}
@media (prefers-reduced-motion:reduce){.ui-anim,.ui-anim *{animation:none!important;transition:none!important}}
`;
let kitStyled = false;
export const useKit = () => { if (kitStyled) return; kitStyled = true; const s = document.createElement("style"); s.textContent = KIT_CSS; document.head.appendChild(s); };

/** 把一张图贴到一个格子上：有图就显示图，没有就留着格子里的字。fallback：第一张拿不到时换这一张（横版海报还没有时退回竖版） */
export function art(el: HTMLElement, url: string, fallback?: string): void { const im = new Image(); im.onload = () => { el.style.backgroundImage = `url(${url})`; el.classList.add("has"); }; if (fallback) im.onerror = () => art(el, fallback); im.src = url; }

// ---- 图标（24 格线描，currentColor） ----
const ic = (body: string, fill = false) => `<svg viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICON: Record<string, string> = {
  // 职业（kit.role）
  坦克: ic(`<path d="M12 3 5 6v5.5c0 4.2 3 7.6 7 9.5 4-1.9 7-5.3 7-9.5V6Z"/><path d="M12 7.5v9M8.5 11h7"/>`),
  斗士: ic(`<path d="M6 4.5 15.5 14M4.5 6 6 4.5M13.6 15.9l1.9-1.9 3.5 3.5-1.9 1.9Z"/><path d="M18 4.5 8.5 14M19.5 6 18 4.5M10.4 15.9 8.5 14 5 17.5l1.9 1.9Z"/>`),
  刺客: ic(`<path d="M17.5 3.5 9 12l3 3 8.5-8.5.5-3.5Z"/><path d="m7.5 13.5 3 3M6 18l3-3M4.5 19.5l1.5-1.5"/>`),
  法师: ic(`<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>`),
  射手: ic(`<path d="M6 4c6 1.5 10.5 6 12 12"/><path d="M6 4l-1 4M6 4l4-1M4.5 19.5 17 7M17 7h-3.2M17 7v3.2"/>`),
  辅助: ic(`<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20Z"/><path d="M12 11v4.5M9.8 13.2h4.4"/>`),
  // 分路 / 位置：方块是整张图，亮的那一段是走的那条线
  上单: ic(`<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-opacity=".35"/><path d="M4 20V4h16" stroke-width="2.6"/>`),
  中路: ic(`<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-opacity=".35"/><path d="M5 19 19 5" stroke-width="2.6"/>`),
  下路: ic(`<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-opacity=".35"/><path d="M4 20h16V4" stroke-width="2.6"/>`),
  打野: ic(`<path d="M7 4c1 4 .5 8-2 12M12 3.5c.8 4.5.3 9-1.6 13.5M17 4c.6 4.2 0 8.4-2 12.5"/><path d="M5 20h14" stroke-opacity=".5"/>`),
  游走: ic(`<path d="M12 3.5 5.5 6v5c0 4 2.8 7.2 6.5 9 3.7-1.8 6.5-5 6.5-9V6Z"/><path d="m12 8.5 1.1 2.3 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3Z" fill="currentColor" stroke-width="1"/>`),
  // 属性
  ad: ic(`<path d="M18.5 3.5 8 14l2 2L20.5 5.5V3.5Z"/><path d="m6 12 6 6M7.5 16.5 4 20"/>`),
  ap: ic(`<path d="M12 3c3 3.5 5 6 5 9a5 5 0 0 1-10 0c0-1.6.6-3 1.6-4.3.4 1.5 1.2 2.4 2.2 2.8C10.4 8.2 11 5.6 12 3Z"/>`),
  ar: ic(`<path d="M12 3 5 6v5.5c0 4.2 3 7.6 7 9.5 4-1.9 7-5.3 7-9.5V6Z"/><path d="M5 11h14"/>`),
  mr: ic(`<path d="M12 3 5 6v5.5c0 4.2 3 7.6 7 9.5 4-1.9 7-5.3 7-9.5V6Z"/><path d="M12 8v3l2 1.5"/><circle cx="12" cy="11.5" r="3.6" stroke-opacity=".6"/>`),
  as: ic(`<path d="M4 19 13 10M13 10h-3.5M13 10v3.5M9 19l9-9M18 10h-3.5M18 10v3.5"/>`),
  ms: ic(`<path d="M7 4v8.5c0 1 .6 1.8 1.5 2.2l6 2.6c1 .4 1.5 1.1 1.5 2.2V20H5v-6"/><path d="M19.5 7h-6M20.5 11h-4.5"/>`),
  // 杂项
  menu: ic(`<path d="M5 7h14M5 12h14M5 17h14"/>`),
  gear: ic(`<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/><circle cx="12" cy="12" r="6.6" stroke-opacity=".55"/>`),
  snd: ic(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`),
  mute: ic(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>`),
  full: ic(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`),
  back: ic(`<path d="M15 5 8 12l7 7"/>`),
  lock: ic(`<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>`),
  eye: ic(`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>`),
  target: ic(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>`),
  play: ic(`<path d="M7.5 5v14l11-7Z" fill="currentColor"/>`),
  swords: ic(`<path d="M5 4.5 14.5 14M3.5 6 5 4.5M12.6 15.9l1.9-1.9 3.2 3.2-1.9 1.9Z"/><path d="M19 4.5 9.5 14M20.5 6 19 4.5M11.4 15.9 9.5 14l-3.2 3.2 1.9 1.9Z"/>`),
  crown: ic(`<path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10Z"/><path d="M4.5 20h15"/>`),
  tower: ic(`<path d="M7 20V9l-1.5-2V3.5h3V5h2V3.5h3V5h2V3.5h3V7L17 9v11Z"/><path d="M10.5 20v-4h3v4"/>`),
  clock: ic(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  bag: ic(`<path d="M6 8h12l-1 12H7Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>`),
  search: ic(`<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>`),
  close: ic(`<path d="m6 6 12 12M18 6 6 18"/>`),
  home: ic(`<path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5"/>`),
  redo: ic(`<path d="M19 8.5A8 8 0 1 0 20 13"/><path d="M19.5 3.5v5h-5"/>`),
  quality: ic(`<path d="M3.5 6.5h17v11h-17Z"/><path d="m7 15 3.5-4 2.5 2.5 2-2 2 3.5"/>`),
  wave: ic(`<path d="M3 14c2.2 0 2.2-2.5 4.5-2.5S9.7 14 12 14s2.2-2.5 4.5-2.5S18.8 14 21 14"/><path d="M3 18c2.2 0 2.2-2.5 4.5-2.5S9.7 18 12 18s2.2-2.5 4.5-2.5S18.8 18 21 18" stroke-opacity=".5"/><path d="M8 9c1-3 4-5 7-4.5"/>`),
  flame: ic(`<path d="M12 3c3 3.5 5.5 6 5.5 10a5.5 5.5 0 0 1-11 0c0-2.2 1-4 2.5-5.5.3 1.9 1.1 3 2.3 3.6C10.8 8.6 11 5.8 12 3Z"/><path d="M12 20a2.4 2.4 0 0 1-2.4-2.4c0-1.6 1.4-2.6 2.4-4.1 1 1.5 2.4 2.5 2.4 4.1A2.4 2.4 0 0 1 12 20Z" stroke-opacity=".6"/>`),
};
/** 职业的图标；没有就用一个菱形 */
export const roleIcon = (role: string) => ICON[role] ?? ic(`<path d="M12 4 20 12 12 20 4 12Z"/>`);

/** 分路：现在的三条线，以后的五个位置。lane：0 中，1 上，2 下（和 bot.ts 的 LANE_OF 一样） */
export const LANE_NAME = ["中路", "上单", "下路"], LANE_ICON = ["中路", "上单", "下路"];

/** 每个英雄的上手难度（1 到 3）。英雄的数据里没有这一项，先按技能的操作量定在这里 */
export const DIFFICULTY: Record<string, number> = { lan: 3, torg: 2, moko: 2, gorran: 1, vero: 2, osen: 3, iti: 3 };      // 伊缇（第四阶段）：Q 三段、W 换回、E 指向、R 选落点，操作量最大的一档
export const pips = (n: number, of = 3) => `<span class="ui-pips" title="上手难度 ${n} / ${of}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;

/** 横版海报（加载和首页用）：新的那批还没出来时退回竖版 */
export const wideUrl = (id: string) => `/assets/ui/wide/${id}.webp`, splashUrl = (id: string) => `/assets/ui/splash/${id}.webp`, faceUrl = (id: string) => `/assets/ui/face/${id}.webp`;
