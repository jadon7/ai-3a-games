// 换画风 B · b-fx：特效在明快卡通的亮地面上怎么读得清。所有特效零件（fxlib、fx_*.ts、英雄文件里自己的着色器）共用这里的几样东西。
//
// 为什么要改：原来的特效是按暗青绿的厚涂地面调的——身子是叠加发光的浅青、浅黄，底下垫一层近黑的深海蓝、焦黑。
// B 的地面很亮（我方石板亮度 0.89、草 0.68、浅青的水 0.6 上下），叠加发光的浅色加在上面只会变成一片白（或者根本看不出），
// 近黑的垫底和焦痕成了一块块污渍。王者荣耀那种亮场景里的特效是另一个路子：
//   · 身子是饱和的、有颜色的、“实”的（普通混合盖住地面，不是加亮），亮的只有芯和刃口那一道；
//   · 边缘和垫底用同色系深一档的颜色，不用黑；
//   · 地上的痕迹是有颜色的（水是湿印、火是暖褐的焦痕）。
// 这里给的：
//   FXB        开关和几个参数（?fxb=0 退回原来的混合，并排对比用；?fxbp=键:值 临时调参数）
//   PREMUL     预乘透明的混合方式（着色器输出“颜色×不透明度, 盖住多少”）
//   BOUT       一段 GLSL：bOut_(颜色, 不透明度) —— 越接近白越按叠加发光，越暗越有颜色越按普通混合；给原来叠加发光的着色器换上
//   deep()     同色系深一档：色相不变，饱和度提上去、明度压下来（刀光、拖尾的身子，垫底的颜色）
import * as THREE from "three";
import { TOON_ON } from "../toon";

const q = new URLSearchParams(location.search);
/** on：亮地面的那一套（style-b 默认开）。occ：身子盖住地面多少（1 就是普通混合）；l0 / l1：颜色的亮度（sRGB 的相对亮度）低于 l0 全按身子算，高于 l1 全按发光算；
 *  d0 / d1：比 d1 暗的又慢慢退回叠加，到 d0 全是叠加——原来叠加发光的东西常常“淡到黑”当作消失（火星由橙变暗红变黑），这些暗色不能变成盖在地上的黑点；
 *  flash：闪光那团柔光的大小乘几（亮地面上叠加的柔光就是一块白斑）；lamp：闪光带的点光强度乘几（点光照在亮地面上一下就过曝）；ghost：残影的不透明度乘几 */
export const FXB = { on: TOON_ON && q.get("fxb") !== "0", occ: 0.85, l0: 0.5, l1: 0.9, d0: 0.05, d1: 0.2, flash: 0.72, lamp: 0.4, ghost: 1.6 };
for (const kv of (q.get("fxbp") ?? "").split(",")) { const [k, v] = kv.split(":"); if (k && v !== undefined && Number.isFinite(+v) && k in FXB) (FXB as any)[k] = +v; }

/** 预乘透明：着色器输出 (颜色 × 不透明度, 盖住地面多少)。盖住 0 就是叠加发光，盖住和不透明度一样就是普通混合 */
export const PREMUL = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;
/** 原来叠加发光的材质在 B 下换成什么混合：B 开着是 PREMUL，关着照旧叠加 */
export const glowBlend = () => (FXB.on ? PREMUL : { blending: THREE.AdditiveBlending });

const f = (x: number) => x.toFixed(4);
/** GLSL：bOut_(c, a) 给“原来输出 vec4(c * a, a)、叠加混合”的着色器用（c 是线性颜色）；bOutS_(c, a) 给“原来输出 vec4(c, a)、叠加混合”的（贴花）。
 *  返回值直接赋给 gl_FragColor（已经换好输出的色彩空间，后面不要再 #include <colorspace_fragment>）。
 *  b 是“身子”的成分：颜色越暗、越有颜色越接近 1（普通混合，盖住地面），越接近白越接近 0（叠加，只加亮）。白芯和原来一样亮 */
export const BOUT = /* glsl */ `
  float bBody_(vec3 s) { float l = dot(s, vec3(0.2126, 0.7152, 0.0722)); return (1.0 - smoothstep(${f(FXB.l0)}, ${f(FXB.l1)}, l)) * smoothstep(${f(FXB.d0)}, ${f(FXB.d1)}, l); }
  vec4 bOut_(vec3 c, float a) { vec3 s = linearToOutputTexel(vec4(c, 1.0)).rgb; float b = bBody_(s), ha = pow(max(a, 1e-4), 1.4545);      // ha：原来叠加时这一点加上去多亮（sRGB(c·a)·a 约等于 sRGB(c)·a^1.45，省一次色彩空间换算）
    return vec4(s * mix(ha, a, b), a * b * ${f(FXB.occ)}); }
  vec4 bOutS_(vec3 c, float a) { vec3 s = linearToOutputTexel(vec4(c, 1.0)).rgb; float b = bBody_(s); return vec4(s * a, a * b * ${f(FXB.occ)}); }
`;
/** 把一句“gl_FragColor = vec4(X * A, A); #include <colorspace_fragment>”换成 B 的写法：给着色器字符串用，B 关着原样返回 */
export const glowOut = (c: string, a: string) => (FXB.on ? `gl_FragColor = bOut_(${c}, ${a});` : `gl_FragColor = vec4((${c}) * (${a}), ${a});\n#include <colorspace_fragment>`);

const H = { h: 0, s: 0, l: 0 }, tmp = new THREE.Color();
/** 同色系深一档（sRGB 的 HSL 上算）：色相不变，饱和度至少 s，明度压到 l。白、灰（没有色相的）原样返回 */
export function deep(c: number, l = 0.38, s = 0.7): number {
  tmp.setHex(c).getHSL(H, THREE.SRGBColorSpace); if (H.s < 0.08) return c;
  return tmp.setHSL(H.h, Math.max(H.s, s), Math.min(H.l, l), THREE.SRGBColorSpace).getHex();
}
const SMOKE = new THREE.Color().setHex(0x9a8c80);      // 暖的浅灰褐（sRGB），亮地面上的烟往它靠
/** 烟的颜色（线性值，原地改）：越黑往暖灰褐拉得越多。原来火烧完冒的是近黑的烟，暗地面上是“烟”，亮地面上是一团团脏的黑；王者荣耀亮场景里的烟是浅一些的暖灰。
 *  亮的烟（白的水汽、浅灰的土）不动 */
export function smokeB(c: THREE.Color): THREE.Color { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, k = 0.55 * Math.max(0, 1 - l / 0.12); return c.lerp(SMOKE, k); }
/** B 开着用 b，关着用 a（各英雄的配色常量：亮地面上换一套） */
export const pick = <T>(a: T, b: T): T => (FXB.on ? b : a);
