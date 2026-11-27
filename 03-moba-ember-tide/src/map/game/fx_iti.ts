// 伊缇 · 绯刃的全部特效（第四阶段）。技能代码（heroes/iti.ts）只在时机点调这里的函数，传位置、目标、范围；
// 画什么、顿帧、震屏、压暗、闪白、镜头推拉、全屏效果全由特效决定（iti-fx3 任务写）。技能代码自己不调 fx.hitstop / fx.shake。
//
// 这个文件只留接口：类型，和 ITI_FX 这个名字。真的实现在 fx_iti_core.ts（每个函数什么时候调、画什么，注释都在那边），
// 零件在 fx_iti_kit.ts，屏幕级的演出在 fx_iti_screen.ts。调度写的那版占位（用通用特效库画个大概）第二步接进游戏时换掉了。
// 函数名和参数是技能代码和特效之间的约定（docs/hero_iti/PHASE4.md）：可以加可选参数、加新函数，不改已有的签名。
// 第二步新加的两个：rGather（大招在中心现身、往下落的那一拍，落地前 sec 秒调）、refresh（参与击杀后 Q 回满的那一下）。
import type { Ent } from "./sim";
import type { Actor } from "./actor";
import type { Api } from "./skills";
import type { FxLib } from "./fxlib";
import { ITI_FX_CORE, warmIti } from "./fx_iti_core";

/** 特效拿到的东西：技能里的 c 直接传进来就行（Cast 和 kit 的几个回调都有这四样） */
export interface ItiCtx { me: Ent; a: Actor; api: Api; fx: FxLib }
export type P2 = { x: number; z: number };
/** W 留下的残影：跟着位置走（换位时挪到她原来站的地方）、收掉 */
export interface EchoFx { move(x: number, z: number): void; remove(): void }
/** R 的法阵：大招结束（或被打断）时 end */
export interface FieldFx { end(): void }

export const ITI_FX = ITI_FX_CORE;
export { warmIti };
