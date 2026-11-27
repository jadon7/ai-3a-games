// 全局常量与坐标换算。场景数据沿用 Blender 的坐标（Z 向上），进 three.js 前统一换算成 Y 向上。
import * as THREE from 'three';

export const FPS = 30;

// Blender (x, y, z) -> three (x, z, -y)
export function b2t(x, y, z, out = new THREE.Vector3()) { return out.set(x, z, -y); }
export const C_B2T = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
export const C_T2B = new THREE.Matrix4().makeRotationX(Math.PI / 2);
// 行主序的 16 个数 -> three 矩阵（Blender 世界）
export function matFromRows(a, out = new THREE.Matrix4()) { return out.set(...a); }

// 记录仪镜头：等立体角鱼眼，焦距 17.3mm，画幅 36 x 20.25mm（对角视场约 146 度）
export const LENS = { f: 17.3, sw: 36.0, sh: 20.25, tanV: 1.62 };
LENS.tanH = LENS.tanV * 16 / 9;

// 场景尺寸（Blender 坐标）
export const FLOOR_Z = 0.42;
export const GROUND_Z = 0.40;
export const HDRI_P0 = [12.6, 2.0, GROUND_Z + 1.6];   // 把全景照片投影到门外地面时的"拍摄点"
export const DOOR = { x: 16.98, y0: 0.6, y1: 3.3 };

// 光照模式
export const MODES = {
  day:  { K: 1.0,  amb: 1.0,  win: 11.0, tint: [1.0, 1.0, 1.0],    flashK: 1.0, maxGain: 24.0, aeTarget: 0.215, puffEmit: 0.42 },
  dusk: { K: 0.06, amb: 0.06, win: 1.1,  tint: [0.74, 0.90, 1.16], flashK: 0.4, maxGain: 5.5,  aeTarget: 0.19,  puffEmit: 0.42 * 0.06 },
};

export const params = new URLSearchParams(location.search);
export const QS = {
  mode: params.get('mode') === 'dusk' ? 'dusk' : 'day',
  demo: params.has('demo'),
  frame: params.has('frame') ? parseFloat(params.get('frame')) : null,
  shots: params.get('shots') ? params.get('shots').split(',').map(Number) : null,
  scale: params.has('scale') ? parseFloat(params.get('scale')) : null,
  tex: params.get('tex') || '8k',
  fps: params.has('fps'),
  god: params.has('god'),
  raw: params.has('raw'),          // 关闭记录仪后期，只看原始渲染
  tag: params.get('tag') || '',
  auto: params.has('auto') ? (parseFloat(params.get('auto')) || 30) : null,   // 自动试玩并截图（秒）
  cap: parseFloat(params.get('cap') || '1'),                                  // 自动试玩时每隔几秒截一张
  rec: params.has('rec'),                                                     // 自动试玩时逐帧保存（做录屏）
  bot: params.has('bot'),                                                     // 实时自动试玩（看效果/测帧率）
  react: parseFloat(params.get('react') || '0.22'),                           // 自动试玩的反应时间（秒）
  perf: params.has('perf') ? (parseFloat(params.get('perf')) || 12) : null,     // 自动试玩若干秒后把帧率统计发给本地服务器
  nolock: params.has('nolock'),                                               // 开始界面直接给出"不锁鼠标"的按钮
  seed: params.has('seed') ? parseInt(params.get('seed')) : null,
  rgain: params.has('rgain') ? parseFloat(params.get('rgain')) : null,        // 小房间/走廊相对大厅的亮度（调试）
  tour: params.has('tour'),                                                   // 自动试玩时按路线把各个房间走一遍
  pos: params.get('pos') ? params.get('pos').split(',').map(Number) : null,   // 起始位置 x,y,朝向（调试）
  rag: params.get('rag') || null,                                             // 倒地检查（调试）：机位x,y,朝向,俯仰,层;敌人x,y,层,转身角,部位,子弹偏角;...
  noragdoll: params.has('noragdoll'),                                         // 倒地只放原来那段动画（对照用）
  phantom: params.has('phantom'),                                             // 自检：找出"看得见但能穿过去"的墙面，结果存到 _shots/phantom.txt
  mute: params.has('mute'),                                                   // 一开始就静音（调试时用，别吵到人）
  noguard: params.has('noguard'),                                             // 不放蹲守在别的楼层的敌人
  nofoe: params.has('nofoe') || params.has('vmt'),                                                 // 不出敌人（看场景用）
  nav: params.has('nav'),                                                     // 把可行走网格存成图（调试）
  views: params.get('views') || null,                                         // 按给定的机位列表截图（调试）：x,y,yaw,pitch;...
  ent: params.get('ent') || null,
  start: params.get('start') === 'pool' ? 'pool' : 'house',                    // 开局位置：小楼的大厅，还是池核
  vmt: params.get('vmt') || null,                                             // 手臂和枪的动作逐帧检查（调试）：枪,x,y,朝向,俯仰,层;动作@秒;...
  T: parseFloat(params.get('T') || '3'),                                      // 上面这个检查跑几秒                                             // 敌人动作检查（调试）
};
